import { beforeEach, describe, expect, it } from 'bun:test';
import { indexedDB as fakeIndexedDb } from 'fake-indexeddb';
import { buildResumePayload } from '@/core/resume/payload';
import { createChromeLocalFallbackStorage, createResumeStorage, type FallbackStorage } from '@/core/resume/storage';
import { RESUME_DB, STORAGE_KEYS } from '@/platform/chrome/storage-keys';

class MemoryFallbackStorage implements FallbackStorage {
    private readonly store = new Map<string, unknown>();

    async get<T>(key: string) {
        return this.store.get(key) as T | undefined;
    }

    async set<T>(key: string, value: T) {
        this.store.set(key, value);
    }

    async remove(key: string) {
        this.store.delete(key);
    }

    has(key: string) {
        return this.store.has(key);
    }

    setRaw(key: string, value: unknown) {
        this.store.set(key, value);
    }

    getRaw<T>(key: string) {
        return this.store.get(key) as T | undefined;
    }
}

type MockIndexedDbMode =
    | 'open-error-event'
    | 'read-request-error'
    | 'read-abort'
    | 'write-error'
    | 'write-abort'
    | 'clear-error'
    | 'clear-abort';

const shouldAbortReadTransaction = (txMode: 'readonly' | 'readwrite', mode: MockIndexedDbMode) => {
    return txMode === 'readonly' && mode === 'read-abort';
};

const shouldErrorWriteTransaction = (txMode: 'readonly' | 'readwrite', mode: MockIndexedDbMode) => {
    return txMode === 'readwrite' && (mode === 'write-error' || mode === 'clear-error');
};

const shouldAbortWriteTransaction = (txMode: 'readonly' | 'readwrite', mode: MockIndexedDbMode) => {
    return txMode === 'readwrite' && (mode === 'write-abort' || mode === 'clear-abort');
};

const triggerMockTransactionOutcome = (
    txMode: 'readonly' | 'readwrite',
    mode: MockIndexedDbMode,
    tx: { onerror?: (() => void) | null; onabort?: (() => void) | null },
) => {
    if (shouldAbortReadTransaction(txMode, mode)) {
        tx.onabort?.();
        return;
    }

    if (shouldErrorWriteTransaction(txMode, mode)) {
        tx.onerror?.();
        return;
    }

    if (shouldAbortWriteTransaction(txMode, mode)) {
        tx.onabort?.();
    }
};

const createMockIndexedDbFactory = (mode: MockIndexedDbMode) => {
    const db = {
        close() {},
        transaction(_storeName: string, txMode: 'readonly' | 'readwrite') {
            const tx: {
                error: Error;
                objectStore: (_name: string) => {
                    get: (_key: string) => {
                        onsuccess?: (() => void) | null;
                        onerror?: (() => void) | null;
                        result: unknown;
                        error: Error | null;
                    };
                    clear: () => void;
                    put: (_value: unknown, _key?: string) => void;
                };
                oncomplete?: (() => void) | null;
                onerror?: (() => void) | null;
                onabort?: (() => void) | null;
            } = {
                error: new Error(`${mode}:tx`),
                objectStore() {
                    return {
                        get() {
                            const request = {
                                result: null as unknown,
                                error: new Error(`${mode}:request`),
                                onsuccess: null as (() => void) | null,
                                onerror: null as (() => void) | null,
                            };

                            queueMicrotask(() => {
                                if (mode === 'read-request-error' && txMode === 'readonly') {
                                    request.onerror?.();
                                    return;
                                }
                                request.onsuccess?.();
                            });

                            return request;
                        },
                        clear() {},
                        put() {},
                    };
                },
            };

            queueMicrotask(() => {
                triggerMockTransactionOutcome(txMode, mode, tx);
            });

            return tx as unknown as IDBTransaction;
        },
    } as unknown as IDBDatabase;

    return {
        open() {
            const request = {
                result: db,
                error: new Error(`${mode}:open`),
                onsuccess: null as (() => void) | null,
                onerror: null as (() => void) | null,
                onupgradeneeded: null as (() => void) | null,
            };

            queueMicrotask(() => {
                if (mode === 'open-error-event') {
                    request.onerror?.();
                    return;
                }
                request.onsuccess?.();
            });

            return request as unknown as IDBOpenDBRequest;
        },
    } as unknown as IDBFactory;
};

beforeEach(() => {
    // fake-indexeddb handles isolated state per DB name in this test context.
});

describe('resume storage integration', () => {
    it('should persist and restore using IndexedDB primary path', async () => {
        const fallback = new MemoryFallbackStorage();
        const storage = createResumeStorage({
            indexedDbFactory: fakeIndexedDb,
            fallbackStorage: fallback,
        });

        const payload = buildResumePayload({
            username: 'example',
            tweets: [{ id: '1' }],
            meta: null,
            savedAt: Date.now(),
        });

        expect(await storage.persist(payload)).toBe(true);

        const restored = await storage.restore('example');
        expect(restored?.tweets).toHaveLength(1);
        expect(restored?.username).toBe('example');
    });

    it('should fall back when IndexedDB is unavailable', async () => {
        const fallback = new MemoryFallbackStorage();
        const storage = createResumeStorage({
            indexedDbFactory: undefined,
            fallbackStorage: fallback,
        });

        const payload = buildResumePayload({
            username: 'example',
            tweets: [{ id: '2' }],
            meta: null,
            savedAt: Date.now(),
        });

        expect(await storage.persist(payload)).toBe(true);

        const restored = await storage.restore('example');
        expect(restored?.tweets[0]?.id).toBe('2');
    });

    it('should fall back when IndexedDB write throws and still restore', async () => {
        const fallback = new MemoryFallbackStorage();
        const brokenIndexedDb = {
            open() {
                throw new Error('Quota exceeded');
            },
        } as unknown as IDBFactory;

        const storage = createResumeStorage({
            indexedDbFactory: brokenIndexedDb,
            fallbackStorage: fallback,
        });

        const payload = buildResumePayload({
            username: 'example',
            tweets: [{ id: 'broken-idb' }],
            meta: null,
            savedAt: Date.now(),
        });

        expect(await storage.persist(payload)).toBe(true);
        const restored = await storage.restore('example');
        expect(restored?.tweets[0]?.id).toBe('broken-idb');
    });

    it('should chunk oversized fallback payloads and restore them losslessly', async () => {
        const fallback = new MemoryFallbackStorage();
        const storage = createResumeStorage({
            indexedDbFactory: undefined,
            fallbackStorage: fallback,
        });

        const largeText = 'x'.repeat(700_000);
        const payload = buildResumePayload({
            username: 'example',
            tweets: [{ id: 'large', text: largeText }],
            meta: null,
            savedAt: Date.now(),
        });

        expect(await storage.persist(payload)).toBe(true);
        const manifest = await fallback.get<{ version: number; chunkCount: number }>(
            STORAGE_KEYS.RESUME_PAYLOAD_FALLBACK,
        );

        expect(manifest?.version).toBe(2);
        expect((manifest?.chunkCount ?? 0) > 1).toBe(true);

        const restored = await storage.restore('example');
        expect(restored?.tweets[0]?.id).toBe('large');
        expect(restored?.tweets[0]?.text).toBe(largeText);
    });

    it('should clear persisted payload from both stores', async () => {
        const fallback = new MemoryFallbackStorage();
        const storage = createResumeStorage({
            indexedDbFactory: fakeIndexedDb,
            fallbackStorage: fallback,
        });

        const payload = buildResumePayload({
            username: 'example',
            tweets: [{ id: '3' }],
            meta: null,
            savedAt: Date.now(),
        });

        await storage.persist(payload);
        await storage.clear();

        const restored = await storage.restore('example');
        expect(restored).toBeNull();
    });

    it('should evict stale payloads during restore', async () => {
        const fallback = new MemoryFallbackStorage();
        const storage = createResumeStorage({
            indexedDbFactory: undefined,
            fallbackStorage: fallback,
            maxAgeMs: 1,
        });

        const payload = buildResumePayload({
            username: 'example',
            tweets: [{ id: 'old' }],
            meta: null,
            savedAt: Date.now() - 10_000,
        });

        await storage.persist(payload);
        const restored = await storage.restore('example');

        expect(restored).toBeNull();
        expect(fallback.has(STORAGE_KEYS.RESUME_PAYLOAD_FALLBACK)).toBe(false);
    });

    it('should return null when username does not match target', async () => {
        const fallback = new MemoryFallbackStorage();
        const storage = createResumeStorage({
            indexedDbFactory: undefined,
            fallbackStorage: fallback,
        });

        const payload = buildResumePayload({
            username: 'alice',
            tweets: [{ id: 'x' }],
            meta: null,
            savedAt: Date.now(),
        });

        await storage.persist(payload);
        const restored = await storage.restore('bob');
        expect(restored).toBeNull();
        expect(fallback.has(STORAGE_KEYS.RESUME_PAYLOAD_FALLBACK)).toBe(true);
    });

    it('should return false when payload is invalid and cannot be normalized', async () => {
        const fallback = new MemoryFallbackStorage();
        const storage = createResumeStorage({
            indexedDbFactory: undefined,
            fallbackStorage: fallback,
        });

        const persisted = await storage.persist({ username: '', tweets: [] } as never);
        expect(persisted).toBe(false);
    });

    it('should return false when payload has tweets but username cannot be normalized', async () => {
        const fallback = new MemoryFallbackStorage();
        const storage = createResumeStorage({
            indexedDbFactory: undefined,
            fallbackStorage: fallback,
        });

        const persisted = await storage.persist({
            username: '',
            saved_at: Date.now(),
            meta: null,
            tweets: [{ id: 'x' }],
        } as never);
        expect(persisted).toBe(false);
    });

    it('should return false when no storage backends are configured', async () => {
        const storage = createResumeStorage();
        const payload = buildResumePayload({
            username: 'example',
            tweets: [{ id: 'x' }],
            meta: null,
            savedAt: Date.now(),
        });

        const persisted = await storage.persist(payload);
        expect(persisted).toBe(false);
    });

    it('should return false when fallback write fails', async () => {
        const fallback: FallbackStorage = {
            async get() {
                return undefined;
            },
            async set() {
                throw new Error('write failed');
            },
            async remove() {},
        };

        const storage = createResumeStorage({
            indexedDbFactory: undefined,
            fallbackStorage: fallback,
        });

        const payload = buildResumePayload({
            username: 'example',
            tweets: [{ id: 'x' }],
            meta: null,
            savedAt: Date.now(),
        });

        const persisted = await storage.persist(payload);
        expect(persisted).toBe(false);
    });

    it('should restore direct raw fallback payload for backward compatibility', async () => {
        const fallback = new MemoryFallbackStorage();
        fallback.setRaw(STORAGE_KEYS.RESUME_PAYLOAD_FALLBACK, {
            username: 'example',
            saved_at: Date.now(),
            meta: null,
            tweets: [{ id: 'legacy-raw' }],
        });

        const storage = createResumeStorage({
            indexedDbFactory: undefined,
            fallbackStorage: fallback,
        });

        const restored = await storage.restore('example');
        expect(restored?.tweets[0]?.id).toBe('legacy-raw');
    });

    it('should ignore invalid fallback manifests', async () => {
        const fallback = new MemoryFallbackStorage();
        fallback.setRaw(STORAGE_KEYS.RESUME_PAYLOAD_FALLBACK, { version: 1, chunkCount: 2 });

        const storage = createResumeStorage({
            indexedDbFactory: undefined,
            fallbackStorage: fallback,
        });

        const restored = await storage.restore('example');
        expect(restored).toBeNull();
    });

    it('should ignore fallback manifests with non-positive chunk counts', async () => {
        const fallback = new MemoryFallbackStorage();
        fallback.setRaw(STORAGE_KEYS.RESUME_PAYLOAD_FALLBACK, { version: 2, chunkCount: 0 });

        const storage = createResumeStorage({
            indexedDbFactory: undefined,
            fallbackStorage: fallback,
        });

        const restored = await storage.restore('example');
        expect(restored).toBeNull();
    });

    it('should return null when fallback chunk is missing or not a string', async () => {
        const fallback = new MemoryFallbackStorage();
        fallback.setRaw(STORAGE_KEYS.RESUME_PAYLOAD_FALLBACK, { version: 2, chunkCount: 1 });
        fallback.setRaw(`${STORAGE_KEYS.RESUME_PAYLOAD_FALLBACK}:chunk:0`, 123);

        const storage = createResumeStorage({
            indexedDbFactory: undefined,
            fallbackStorage: fallback,
        });

        const restored = await storage.restore('example');
        expect(restored).toBeNull();
    });

    it('should return null when fallback chunk payload is invalid JSON', async () => {
        const fallback = new MemoryFallbackStorage();
        fallback.setRaw(STORAGE_KEYS.RESUME_PAYLOAD_FALLBACK, { version: 2, chunkCount: 1 });
        fallback.setRaw(`${STORAGE_KEYS.RESUME_PAYLOAD_FALLBACK}:chunk:0`, '{');

        const storage = createResumeStorage({
            indexedDbFactory: undefined,
            fallbackStorage: fallback,
        });

        const restored = await storage.restore('example');
        expect(restored).toBeNull();
    });

    it('should remove stale chunk keys when writing a smaller fallback payload', async () => {
        const fallback = new MemoryFallbackStorage();
        const storage = createResumeStorage({
            indexedDbFactory: undefined,
            fallbackStorage: fallback,
        });

        const largePayload = buildResumePayload({
            username: 'example',
            tweets: [{ id: 'large', text: 'x'.repeat(700_000) }],
            meta: null,
            savedAt: Date.now(),
        });
        await storage.persist(largePayload);
        const largeManifest = fallback.getRaw<{ chunkCount: number }>(STORAGE_KEYS.RESUME_PAYLOAD_FALLBACK);
        expect((largeManifest?.chunkCount ?? 0) > 1).toBe(true);
        expect(fallback.has(`${STORAGE_KEYS.RESUME_PAYLOAD_FALLBACK}:chunk:1`)).toBe(true);

        const smallPayload = buildResumePayload({
            username: 'example',
            tweets: [{ id: 'small', text: 'ok' }],
            meta: null,
            savedAt: Date.now(),
        });
        await storage.persist(smallPayload);

        const smallManifest = fallback.getRaw<{ chunkCount: number }>(STORAGE_KEYS.RESUME_PAYLOAD_FALLBACK);
        expect(smallManifest?.chunkCount).toBe(1);
        expect(fallback.has(`${STORAGE_KEYS.RESUME_PAYLOAD_FALLBACK}:chunk:1`)).toBe(false);
    });

    it('should restore legacy unchunked IndexedDB payloads', async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = fakeIndexedDb.open(RESUME_DB.NAME, RESUME_DB.VERSION);
            request.onupgradeneeded = () => {
                request.result.createObjectStore(RESUME_DB.STORE);
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });

        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(RESUME_DB.STORE, 'readwrite');
            tx.objectStore(RESUME_DB.STORE).put(
                {
                    username: 'example',
                    saved_at: Date.now(),
                    meta: null,
                    tweets: [{ id: 'legacy-idb' }],
                },
                RESUME_DB.ACTIVE_KEY,
            );
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
        db.close();

        const storage = createResumeStorage({
            indexedDbFactory: fakeIndexedDb,
            fallbackStorage: new MemoryFallbackStorage(),
        });
        const restored = await storage.restore('example');
        expect(restored?.tweets[0]?.id).toBe('legacy-idb');
    });

    it('should return null when IndexedDB chunked payload contains non-string chunk', async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = fakeIndexedDb.open(RESUME_DB.NAME, RESUME_DB.VERSION);
            request.onupgradeneeded = () => {
                request.result.createObjectStore(RESUME_DB.STORE);
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });

        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(RESUME_DB.STORE, 'readwrite');
            tx.objectStore(RESUME_DB.STORE).clear();
            tx.objectStore(RESUME_DB.STORE).put({ version: 2, chunkCount: 1 }, `${RESUME_DB.ACTIVE_KEY}:manifest`);
            tx.objectStore(RESUME_DB.STORE).put(123, `${RESUME_DB.ACTIVE_KEY}:chunk:0`);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
        db.close();

        const storage = createResumeStorage({
            indexedDbFactory: fakeIndexedDb,
            fallbackStorage: new MemoryFallbackStorage(),
        });
        const restored = await storage.restore('example');
        expect(restored).toBeNull();
    });

    it('should return null when IndexedDB chunked payload is invalid JSON', async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = fakeIndexedDb.open(RESUME_DB.NAME, RESUME_DB.VERSION);
            request.onupgradeneeded = () => {
                request.result.createObjectStore(RESUME_DB.STORE);
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });

        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(RESUME_DB.STORE, 'readwrite');
            tx.objectStore(RESUME_DB.STORE).clear();
            tx.objectStore(RESUME_DB.STORE).put({ version: 2, chunkCount: 1 }, `${RESUME_DB.ACTIVE_KEY}:manifest`);
            tx.objectStore(RESUME_DB.STORE).put('{', `${RESUME_DB.ACTIVE_KEY}:chunk:0`);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
        db.close();

        const storage = createResumeStorage({
            indexedDbFactory: fakeIndexedDb,
            fallbackStorage: new MemoryFallbackStorage(),
        });
        const restored = await storage.restore('example');
        expect(restored).toBeNull();
    });

    it('should clear fallback payloads when IndexedDB clear throws', async () => {
        const fallback = new MemoryFallbackStorage();
        await fallback.set(
            STORAGE_KEYS.RESUME_PAYLOAD_FALLBACK,
            buildResumePayload({
                username: 'example',
                tweets: [{ id: 'persisted' }],
                meta: null,
                savedAt: Date.now(),
            }),
        );

        const failingIndexedDb = {
            open() {
                throw new Error('clear failed');
            },
        } as unknown as IDBFactory;

        const storage = createResumeStorage({
            indexedDbFactory: failingIndexedDb,
            fallbackStorage: fallback,
        });

        await storage.clear();
        expect(fallback.has(STORAGE_KEYS.RESUME_PAYLOAD_FALLBACK)).toBe(false);
    });

    it('should use chrome local fallback adapter methods', async () => {
        const adapter = createChromeLocalFallbackStorage();
        await adapter.set('k1', { ok: true });
        const value = await adapter.get<{ ok: boolean }>('k1');
        expect(value?.ok).toBe(true);

        await adapter.remove('k1');
        const afterRemove = await adapter.get('k1');
        expect(afterRemove).toBe(undefined);
    });

    it('should fall back when IndexedDB open triggers error event', async () => {
        const fallback = new MemoryFallbackStorage();
        const storage = createResumeStorage({
            indexedDbFactory: createMockIndexedDbFactory('open-error-event'),
            fallbackStorage: fallback,
        });

        const payload = buildResumePayload({
            username: 'example',
            tweets: [{ id: 'fallback-open-error' }],
            meta: null,
            savedAt: Date.now(),
        });

        expect(await storage.persist(payload)).toBe(true);
        expect((await storage.restore('example'))?.tweets[0]?.id).toBe('fallback-open-error');
    });

    it('should return null when IndexedDB read request errors', async () => {
        const storage = createResumeStorage({
            indexedDbFactory: createMockIndexedDbFactory('read-request-error'),
            fallbackStorage: new MemoryFallbackStorage(),
        });

        expect(await storage.restore('example')).toBeNull();
    });

    it('should return null when IndexedDB readonly transaction aborts', async () => {
        const storage = createResumeStorage({
            indexedDbFactory: createMockIndexedDbFactory('read-abort'),
            fallbackStorage: new MemoryFallbackStorage(),
        });

        expect(await storage.restore('example')).toBeNull();
    });

    it('should fall back when IndexedDB write transaction errors', async () => {
        const fallback = new MemoryFallbackStorage();
        const storage = createResumeStorage({
            indexedDbFactory: createMockIndexedDbFactory('write-error'),
            fallbackStorage: fallback,
        });

        const payload = buildResumePayload({
            username: 'example',
            tweets: [{ id: 'fallback-write-error' }],
            meta: null,
            savedAt: Date.now(),
        });

        expect(await storage.persist(payload)).toBe(true);
        expect((await storage.restore('example'))?.tweets[0]?.id).toBe('fallback-write-error');
    });

    it('should fall back when IndexedDB write transaction aborts', async () => {
        const fallback = new MemoryFallbackStorage();
        const storage = createResumeStorage({
            indexedDbFactory: createMockIndexedDbFactory('write-abort'),
            fallbackStorage: fallback,
        });

        const payload = buildResumePayload({
            username: 'example',
            tweets: [{ id: 'fallback-write-abort' }],
            meta: null,
            savedAt: Date.now(),
        });

        expect(await storage.persist(payload)).toBe(true);
        expect((await storage.restore('example'))?.tweets[0]?.id).toBe('fallback-write-abort');
    });

    it('should continue fallback cleanup when IndexedDB clear emits error', async () => {
        const fallback = new MemoryFallbackStorage();
        fallback.setRaw(STORAGE_KEYS.RESUME_PAYLOAD_FALLBACK, {
            username: 'example',
            saved_at: Date.now(),
            meta: null,
            tweets: [{ id: 'to-clear' }],
        });

        const storage = createResumeStorage({
            indexedDbFactory: createMockIndexedDbFactory('clear-error'),
            fallbackStorage: fallback,
        });

        await storage.clear();
        expect(fallback.has(STORAGE_KEYS.RESUME_PAYLOAD_FALLBACK)).toBe(false);
    });

    it('should continue fallback cleanup when IndexedDB clear aborts', async () => {
        const fallback = new MemoryFallbackStorage();
        fallback.setRaw(STORAGE_KEYS.RESUME_PAYLOAD_FALLBACK, {
            username: 'example',
            saved_at: Date.now(),
            meta: null,
            tweets: [{ id: 'to-clear' }],
        });

        const storage = createResumeStorage({
            indexedDbFactory: createMockIndexedDbFactory('clear-abort'),
            fallbackStorage: fallback,
        });

        await storage.clear();
        expect(fallback.has(STORAGE_KEYS.RESUME_PAYLOAD_FALLBACK)).toBe(false);
    });
});

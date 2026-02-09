import { buildResumePayload, normalizeUsername } from '@/core/resume/payload';
import { RESUME_DB, STORAGE_KEYS } from '@/platform/chrome/storage-keys';
import type { ResumePayload } from '@/types/domain';

const DEFAULT_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const SERIALIZED_CHUNK_SIZE = 512 * 1024;
const SERIALIZED_CHUNK_VERSION = 2;
const IDB_MANIFEST_KEY = `${RESUME_DB.ACTIVE_KEY}:manifest`;
const IDB_CHUNK_PREFIX = `${RESUME_DB.ACTIVE_KEY}:chunk:`;
const FALLBACK_CHUNK_PREFIX = `${STORAGE_KEYS.RESUME_PAYLOAD_FALLBACK}:chunk:`;

export type FallbackStorage = {
    get<T>(key: string): Promise<T | undefined>;
    set<T>(key: string, value: T): Promise<void>;
    remove(key: string): Promise<void>;
};

export type ResumeStorage = {
    persist(payload: ResumePayload): Promise<boolean>;
    restore(targetUsername?: string): Promise<ResumePayload | null>;
    clear(): Promise<void>;
};

type ResumeStorageOptions = {
    indexedDbFactory?: IDBFactory;
    fallbackStorage?: FallbackStorage;
    maxAgeMs?: number;
};

type SerializedManifest = {
    version: number;
    chunkCount: number;
};

const normalizeResumePayload = (payload: unknown): ResumePayload | null => {
    if (!payload || typeof payload !== 'object') {
        return null;
    }

    const candidate = payload as Partial<ResumePayload>;
    if (!Array.isArray(candidate.tweets) || candidate.tweets.length === 0) {
        return null;
    }

    const username = normalizeUsername(candidate.username);
    if (!username) {
        return null;
    }

    return buildResumePayload({
        username,
        tweets: candidate.tweets,
        meta: (candidate.meta ?? null) as ResumePayload['meta'],
        savedAt: Number(candidate.saved_at) || Date.now(),
    });
};

const splitIntoChunks = (value: string, chunkSize: number): string[] => {
    if (value.length === 0) {
        return [''];
    }

    const chunks: string[] = [];
    for (let index = 0; index < value.length; index += chunkSize) {
        chunks.push(value.slice(index, index + chunkSize));
    }
    return chunks;
};

const parseSerializedManifest = (value: unknown): SerializedManifest | null => {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const candidate = value as Partial<SerializedManifest>;
    const chunkCount = Number(candidate.chunkCount);
    if (candidate.version !== SERIALIZED_CHUNK_VERSION || !Number.isInteger(chunkCount)) {
        return null;
    }
    if (chunkCount <= 0) {
        return null;
    }

    return {
        version: SERIALIZED_CHUNK_VERSION,
        chunkCount,
    };
};

const idbChunkKey = (index: number): string => {
    return `${IDB_CHUNK_PREFIX}${index}`;
};

const fallbackChunkKey = (index: number): string => {
    return `${FALLBACK_CHUNK_PREFIX}${index}`;
};

const openResumeDb = async (indexedDbFactory: IDBFactory): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
        const request = indexedDbFactory.open(RESUME_DB.NAME, RESUME_DB.VERSION);

        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(RESUME_DB.STORE)) {
                db.createObjectStore(RESUME_DB.STORE);
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB for resume state'));
    });
};

const readStoreValue = async (db: IDBDatabase, key: string): Promise<unknown> => {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(RESUME_DB.STORE, 'readonly');
        const request = tx.objectStore(RESUME_DB.STORE).get(key);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error(`Failed to read IndexedDB key ${key}`));
        tx.onabort = () => reject(tx.error ?? new Error(`IndexedDB transaction aborted while reading key ${key}`));
    });
};

const putResumePayload = async (indexedDbFactory: IDBFactory, payload: ResumePayload): Promise<void> => {
    const serialized = JSON.stringify(payload);
    const chunks = splitIntoChunks(serialized, SERIALIZED_CHUNK_SIZE);
    const db = await openResumeDb(indexedDbFactory);

    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(RESUME_DB.STORE, 'readwrite');
        const store = tx.objectStore(RESUME_DB.STORE);
        store.clear();
        store.put(
            { version: SERIALIZED_CHUNK_VERSION, chunkCount: chunks.length } satisfies SerializedManifest,
            IDB_MANIFEST_KEY,
        );
        chunks.forEach((chunk, index) => {
            store.put(chunk, idbChunkKey(index));
        });

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('Failed to persist resume payload in IndexedDB'));
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted while persisting payload'));
    });

    db.close();
};

const getResumePayload = async (indexedDbFactory: IDBFactory): Promise<ResumePayload | null> => {
    const db = await openResumeDb(indexedDbFactory);

    const manifest = parseSerializedManifest(await readStoreValue(db, IDB_MANIFEST_KEY));
    if (manifest) {
        const chunks: string[] = [];

        for (let index = 0; index < manifest.chunkCount; index += 1) {
            const chunk = await readStoreValue(db, idbChunkKey(index));
            if (typeof chunk !== 'string') {
                db.close();
                return null;
            }
            chunks.push(chunk);
        }

        db.close();
        try {
            return normalizeResumePayload(JSON.parse(chunks.join('')));
        } catch {
            return null;
        }
    }

    // Backward compatibility with legacy unchunked payload storage.
    const legacyPayload = await readStoreValue(db, RESUME_DB.ACTIVE_KEY);

    db.close();
    return normalizeResumePayload(legacyPayload);
};

const clearResumePayload = async (indexedDbFactory: IDBFactory): Promise<void> => {
    const db = await openResumeDb(indexedDbFactory);

    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(RESUME_DB.STORE, 'readwrite');
        tx.objectStore(RESUME_DB.STORE).clear();

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('Failed to clear resume payload from IndexedDB'));
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted while clearing payload'));
    });

    db.close();
};

export const createChromeLocalFallbackStorage = (): FallbackStorage => {
    return {
        async get<T>(key: string): Promise<T | undefined> {
            const value = await chrome.storage.local.get([key]);
            return value[key] as T | undefined;
        },
        async set<T>(key: string, value: T): Promise<void> {
            await chrome.storage.local.set({ [key]: value });
        },
        async remove(key: string): Promise<void> {
            await chrome.storage.local.remove(key);
        },
    };
};

const writeFallbackPayload = async (fallbackStorage: FallbackStorage, payload: ResumePayload): Promise<void> => {
    const serialized = JSON.stringify(payload);
    const chunks = splitIntoChunks(serialized, SERIALIZED_CHUNK_SIZE);

    const existingManifest = parseSerializedManifest(
        await fallbackStorage.get<unknown>(STORAGE_KEYS.RESUME_PAYLOAD_FALLBACK),
    );
    const oldChunkCount = existingManifest?.chunkCount ?? 0;

    for (let index = 0; index < chunks.length; index += 1) {
        await fallbackStorage.set(fallbackChunkKey(index), chunks[index]);
    }

    await fallbackStorage.set(STORAGE_KEYS.RESUME_PAYLOAD_FALLBACK, {
        version: SERIALIZED_CHUNK_VERSION,
        chunkCount: chunks.length,
    } satisfies SerializedManifest);

    for (let index = chunks.length; index < oldChunkCount; index += 1) {
        await fallbackStorage.remove(fallbackChunkKey(index));
    }
};

const readFallbackPayload = async (fallbackStorage: FallbackStorage): Promise<ResumePayload | null> => {
    const raw = await fallbackStorage.get<unknown>(STORAGE_KEYS.RESUME_PAYLOAD_FALLBACK);
    const normalizedRaw = normalizeResumePayload(raw);
    if (normalizedRaw) {
        return normalizedRaw;
    }

    const manifest = parseSerializedManifest(raw);
    if (!manifest) {
        return null;
    }

    const chunks: string[] = [];
    for (let index = 0; index < manifest.chunkCount; index += 1) {
        const chunk = await fallbackStorage.get<unknown>(fallbackChunkKey(index));
        if (typeof chunk !== 'string') {
            return null;
        }
        chunks.push(chunk);
    }

    try {
        return normalizeResumePayload(JSON.parse(chunks.join('')));
    } catch {
        return null;
    }
};

const clearFallbackPayload = async (fallbackStorage: FallbackStorage): Promise<void> => {
    const raw = await fallbackStorage.get<unknown>(STORAGE_KEYS.RESUME_PAYLOAD_FALLBACK);
    const manifest = parseSerializedManifest(raw);

    if (manifest) {
        for (let index = 0; index < manifest.chunkCount; index += 1) {
            await fallbackStorage.remove(fallbackChunkKey(index));
        }
    }

    await fallbackStorage.remove(STORAGE_KEYS.RESUME_PAYLOAD_FALLBACK);
};

export const createResumeStorage = (options: ResumeStorageOptions = {}): ResumeStorage => {
    const indexedDbFactory = options.indexedDbFactory;
    const fallbackStorage = options.fallbackStorage;
    const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;

    const persist = async (payload: ResumePayload): Promise<boolean> => {
        const normalized = normalizeResumePayload(payload);
        if (!normalized) {
            return false;
        }

        if (indexedDbFactory) {
            try {
                await putResumePayload(indexedDbFactory, normalized);
                return true;
            } catch {
                // fall through to fallback storage
            }
        }

        if (!fallbackStorage) {
            return false;
        }

        try {
            await writeFallbackPayload(fallbackStorage, normalized);
            return true;
        } catch {
            return false;
        }
    };

    const restore = async (targetUsername?: string): Promise<ResumePayload | null> => {
        let payload: ResumePayload | null = null;

        if (indexedDbFactory) {
            try {
                payload = await getResumePayload(indexedDbFactory);
            } catch {
                payload = null;
            }
        }

        if (!payload && fallbackStorage) {
            payload = await readFallbackPayload(fallbackStorage);
        }

        if (!payload) {
            return null;
        }

        if (Date.now() - payload.saved_at > maxAgeMs) {
            await clear();
            return null;
        }

        const expected = normalizeUsername(targetUsername);
        if (expected && payload.username !== expected) {
            return null;
        }

        return payload;
    };

    const clear = async (): Promise<void> => {
        if (indexedDbFactory) {
            try {
                await clearResumePayload(indexedDbFactory);
            } catch {
                // ignore and continue to fallback cleanup
            }
        }

        if (fallbackStorage) {
            await clearFallbackPayload(fallbackStorage);
        }
    };

    return { persist, restore, clear };
};

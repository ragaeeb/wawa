import { describe, expect, it } from 'bun:test';
import { indexedDB as fakeIndexedDb } from 'fake-indexeddb';
import { buildResumePayload } from '@/core/resume/payload';
import { createResumeStorage, type FallbackStorage } from '@/core/resume/storage';
import { STORAGE_KEYS } from '@/platform/chrome/storage-keys';

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

    setRaw(key: string, value: unknown) {
        this.store.set(key, value);
    }
}

const buildPayload = (text: string) =>
    buildResumePayload({
        username: 'example',
        tweets: [{ id: '1', text }],
        meta: null,
        savedAt: Date.now(),
    });

describe('createResumeStorage', () => {
    it('should restore large chunked payloads from IndexedDB', async () => {
        const storage = createResumeStorage({
            indexedDbFactory: fakeIndexedDb,
        });

        const payload = buildPayload('x'.repeat(700_000));
        expect(await storage.persist(payload)).toBe(true);

        await expect(storage.restore('example')).resolves.toEqual(payload);
    });

    it('should restore large chunked payloads from fallback storage', async () => {
        const fallbackStorage = new MemoryFallbackStorage();
        const storage = createResumeStorage({
            fallbackStorage,
        });

        const payload = buildPayload('y'.repeat(700_000));
        expect(await storage.persist(payload)).toBe(true);

        await expect(storage.restore('example')).resolves.toEqual(payload);
    });

    it('should still restore legacy unchunked fallback payloads', async () => {
        const fallbackStorage = new MemoryFallbackStorage();
        const storage = createResumeStorage({
            fallbackStorage,
        });
        const payload = buildPayload('legacy');

        fallbackStorage.setRaw(STORAGE_KEYS.RESUME_PAYLOAD_FALLBACK, payload);

        await expect(storage.restore('example')).resolves.toEqual(payload);
    });
});

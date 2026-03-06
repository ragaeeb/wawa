import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { indexedDB as fakeIndexedDb } from 'fake-indexeddb';
import {
    createRuntimeResumeStorage,
    SEARCH_AUTOSTART_STORAGE_KEY,
    saveSearchAutoStartContext,
} from '@/content/runtime-browser';
import { buildResumePayload } from '@/core/resume/payload';

type ChromeTestHelpers = {
    clearStorage: () => void;
};

describe('runtime-browser', () => {
    const originalIndexedDb = globalThis.indexedDB;

    beforeEach(() => {
        (globalThis as { __wawaChromeMock?: ChromeTestHelpers }).__wawaChromeMock?.clearStorage();
    });

    afterEach(() => {
        Object.defineProperty(globalThis, 'indexedDB', {
            value: originalIndexedDb,
            configurable: true,
            writable: true,
        });
    });

    it('should save search auto-start context using the shared storage key', async () => {
        const context = { autoStart: true, username: 'tester' };

        await saveSearchAutoStartContext(context);

        const stored = await chrome.storage.local.get([SEARCH_AUTOSTART_STORAGE_KEY]);
        expect(stored[SEARCH_AUTOSTART_STORAGE_KEY]).toEqual(context);
    });

    it('should create resume storage that uses IndexedDB when available', async () => {
        Object.defineProperty(globalThis, 'indexedDB', {
            value: fakeIndexedDb,
            configurable: true,
            writable: true,
        });

        const storage = createRuntimeResumeStorage();
        const payload = buildResumePayload({
            username: 'tester',
            tweets: [{ id: '1', text: 'hello' }],
            meta: null,
            savedAt: Date.now(),
        });

        await expect(storage.persist(payload)).resolves.toBe(true);
        await expect(storage.restore('tester')).resolves.toEqual(payload);
    });

    it('should create resume storage that falls back to chrome storage when IndexedDB is unavailable', async () => {
        Object.defineProperty(globalThis, 'indexedDB', {
            value: undefined,
            configurable: true,
            writable: true,
        });

        const storage = createRuntimeResumeStorage();
        const payload = buildResumePayload({
            username: 'tester',
            tweets: [{ id: '1', text: 'fallback' }],
            meta: null,
            savedAt: Date.now(),
        });

        await expect(storage.persist(payload)).resolves.toBe(true);
        await expect(storage.restore('tester')).resolves.toEqual(payload);
    });
});

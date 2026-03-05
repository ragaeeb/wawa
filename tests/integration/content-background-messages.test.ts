import { describe, expect, it } from 'bun:test';
import { createBackgroundService, createChromeSettingsStore } from '@/core/background/service';

describe('background message integration', () => {
    it('should bridge settings through chrome storage wrappers', async () => {
        (globalThis as { __wawaChromeMock?: { clearStorage: () => void } }).__wawaChromeMock?.clearStorage();

        const store = createChromeSettingsStore();
        await store.set({
            minimalData: false,
            includeReplies: true,
            maxCount: 88,
        });

        const settings = await store.get();
        expect(settings.minimalData).toBe(false);
        expect(settings.includeReplies).toBe(true);
        expect(settings.maxCount).toBe(88);
    });

    it('should handle log and retrieval message roundtrip', async () => {
        const service = createBackgroundService({
            async get() {
                return { minimalData: true, includeReplies: false, maxCount: 0 };
            },
            async set() {},
        });

        await service.handleMessage({
            type: 'log',
            entry: {
                timestamp: '2026-02-08T00:00:00.000Z',
                level: 'info',
                message: 'hello',
            },
        });

        const logsResponse = await service.handleMessage({ type: 'getLogs' });

        expect('logs' in logsResponse).toBe(true);
        if ('logs' in logsResponse) {
            expect(logsResponse.logs).toHaveLength(1);
            expect(logsResponse.logs[0]?.message).toBe('hello');
        }
    });

    it('should read and save settings with typed contract', async () => {
        let saved: Record<string, unknown> = {};

        const service = createBackgroundService({
            async get() {
                return { minimalData: true, includeReplies: true, maxCount: 120 };
            },
            async set(settings) {
                saved = settings;
            },
        });

        const getResult = await service.handleMessage({ type: 'getSettings' });
        expect('includeReplies' in getResult).toBe(true);

        const saveResult = await service.handleMessage({
            type: 'saveSettings',
            includeReplies: false,
            maxCount: 10,
        });

        expect(saveResult).toEqual({ success: true });
        expect(saved).toEqual({ includeReplies: false, maxCount: 10, minimalData: undefined });
    });

    it('should include minimalData when saveSettings message provides it', async () => {
        let saved: Record<string, unknown> = {};

        const service = createBackgroundService({
            async get() {
                return { minimalData: true, includeReplies: true, maxCount: 120 };
            },
            async set(settings) {
                saved = settings;
            },
        });

        const saveResult = await service.handleMessage({
            type: 'saveSettings',
            minimalData: false,
        });

        expect(saveResult).toEqual({ success: true });
        expect(saved.minimalData).toBe(false);
    });

    it('should clear logs and cap total log entries', async () => {
        const service = createBackgroundService({
            async get() {
                return { minimalData: true, includeReplies: true, maxCount: 100 };
            },
            async set() {},
        });

        for (let index = 0; index < 510; index += 1) {
            await service.handleMessage({
                type: 'log',
                entry: {
                    timestamp: `2026-02-08T00:00:${String(index % 60).padStart(2, '0')}.000Z`,
                    level: 'debug',
                    message: `entry-${index}`,
                },
            });
        }

        const logsResponse = await service.handleMessage({ type: 'getLogs' });
        if ('logs' in logsResponse) {
            expect(logsResponse.logs).toHaveLength(500);
            expect(logsResponse.logs[0]?.message).toBe('entry-10');
        }

        const clearResponse = await service.handleMessage({ type: 'clearLogs' });
        expect(clearResponse).toEqual({ success: true });

        const afterClear = await service.handleMessage({ type: 'getLogs' });
        if ('logs' in afterClear) {
            expect(afterClear.logs).toHaveLength(0);
        }
    });

    it('should store and return last export summary', async () => {
        const service = createBackgroundService({
            async get() {
                return { minimalData: true, includeReplies: false, maxCount: 0 };
            },
            async set() {},
        });

        await service.handleMessage({
            type: 'exportComplete',
            username: 'example',
            count: 123,
        });

        const result = await service.handleMessage({ type: 'getLastExport' });
        expect('lastExport' in result).toBe(true);
        if ('lastExport' in result) {
            expect(result.lastExport?.username).toBe('example');
            expect(result.lastExport?.count).toBe(123);
            expect(typeof result.lastExport?.timestamp).toBe('string');
        }
    });

    it('should reject unsupported message types', async () => {
        const service = createBackgroundService({
            async get() {
                return { minimalData: true, includeReplies: false, maxCount: 0 };
            },
            async set() {},
        });

        await expect(service.handleMessage({ type: 'unknown' } as never)).rejects.toThrow('Unsupported message type');
    });

    it('should expose state snapshot through getState', () => {
        const service = createBackgroundService({
            async get() {
                return { minimalData: true, includeReplies: false, maxCount: 0 };
            },
            async set() {},
        });

        const state = service.getState();
        expect(state.logs).toEqual([]);
        expect(state.lastExport).toBeNull();
    });

    it('should download the best tracked video for a tab', async () => {
        const downloads = {
            async download() {
                return 77;
            },
        };

        const service = createBackgroundService(
            {
                async get() {
                    return { minimalData: true, includeReplies: false, maxCount: 0 };
                },
                async set() {},
            },
            downloads,
        );

        service.trackVideoUrl(55, 'https://video.twimg.com/ext_tw_video/123/pu/vid/320x180/foo.mp4?tag=1');
        service.trackVideoUrl(55, 'https://video.twimg.com/ext_tw_video/123/pu/vid/1280x720/foo.mp4?tag=12');

        const result = await service.handleMessage(
            {
                type: 'downloadVideo',
                mediaId: '123',
                tweetId: '2028737230844710988',
            },
            { tab: { id: 55 } as chrome.tabs.Tab },
        );

        expect(result).toEqual({
            ok: true,
            downloadId: 77,
            url: 'https://video.twimg.com/ext_tw_video/123/pu/vid/1280x720/foo.mp4?tag=12',
        });
    });

    it('should fall back to the content-provided url when no tracked request exists', async () => {
        const service = createBackgroundService(
            {
                async get() {
                    return { minimalData: true, includeReplies: false, maxCount: 0 };
                },
                async set() {},
            },
            {
                async download() {
                    return 12;
                },
            },
        );

        const result = await service.handleMessage(
            {
                type: 'downloadVideo',
                fallbackUrl: 'https://video.twimg.com/ext_tw_video/999/pu/vid/640x360/bar.mp4',
            },
            { tab: { id: 3 } as chrome.tabs.Tab },
        );

        expect(result).toEqual({
            ok: true,
            downloadId: 12,
            url: 'https://video.twimg.com/ext_tw_video/999/pu/vid/640x360/bar.mp4',
        });
    });

    it('should report an error when video download cannot resolve a url', async () => {
        const service = createBackgroundService({
            async get() {
                return { minimalData: true, includeReplies: false, maxCount: 0 };
            },
            async set() {},
        });

        const result = await service.handleMessage(
            {
                type: 'downloadVideo',
            },
            { tab: { id: 9 } as chrome.tabs.Tab },
        );

        expect(result).toEqual({
            ok: false,
            error: 'No downloadable MP4 found yet. Play the video for a second and try again.',
        });
    });
});

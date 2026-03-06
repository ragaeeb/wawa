import { describe, expect, it, mock } from 'bun:test';
import { createBackgroundService } from '@/core/background/service';

const createService = (
    downloads: { download: (options: chrome.downloads.DownloadOptions) => Promise<number> } = {
        download: async () => 1,
    },
) => {
    return createBackgroundService(
        {
            async get() {
                return { minimalData: true, includeReplies: false, maxCount: 0 };
            },
            async set() {},
        },
        downloads,
    );
};

describe('background service', () => {
    it('should ignore invalid tracked video urls', async () => {
        const service = createService();

        service.trackVideoUrl(-1, 'https://video.twimg.com/ext_tw_video/123/pu/vid/1280x720/foo.mp4?tag=12');
        service.trackVideoUrl(1, 'https://example.com/not-video.mp4');

        await expect(
            service.handleMessage(
                {
                    type: 'downloadVideo',
                },
                { tab: { id: 1 } as chrome.tabs.Tab },
            ),
        ).resolves.toEqual({
            ok: false,
            error: 'No downloadable MP4 found yet. Play the video for a second and try again.',
        });
    });

    it('should prefer higher tag scores and support videos without media ids', async () => {
        const download = mock(async (_options: chrome.downloads.DownloadOptions) => 22);
        const service = createService({ download });

        service.trackVideoUrl(1, 'https://video.twimg.com/amplify_video/123/pl/source.mp4?tag=3');
        service.trackVideoUrl(1, 'https://video.twimg.com/amplify_video/123/pl/source.mp4?tag=9');

        const result = await service.handleMessage(
            {
                type: 'downloadVideo',
                tweetId: 'tweet-123',
            },
            { tab: { id: 1 } as chrome.tabs.Tab },
        );

        expect(result).toEqual({
            ok: true,
            downloadId: 22,
            url: 'https://video.twimg.com/amplify_video/123/pl/source.mp4?tag=9',
        });
        expect(download).toHaveBeenCalledWith(
            expect.objectContaining({
                filename: 'wawa-video-tweet-123.mp4',
            }),
        );
    });

    it('should clear tracked tab videos', async () => {
        const service = createService();

        service.trackVideoUrl(9, 'https://video.twimg.com/ext_tw_video/456/pu/vid/320x180/foo.mp4');
        service.clearTab(9);

        await expect(
            service.handleMessage(
                {
                    type: 'downloadVideo',
                    mediaId: '456',
                },
                { tab: { id: 9 } as chrome.tabs.Tab },
            ),
        ).resolves.toEqual({
            ok: false,
            error: 'No downloadable MP4 found yet. Play the video for a second and try again.',
        });
    });

    it('should reject downloads without sender tab context', async () => {
        const service = createService();

        await expect(
            service.handleMessage({
                type: 'downloadVideo',
            }),
        ).resolves.toEqual({
            ok: false,
            error: 'Missing sender tab context',
        });
    });

    it('should surface download adapter errors', async () => {
        const service = createService({
            download: async () => {
                throw new Error('downloads disabled');
            },
        });

        service.trackVideoUrl(12, 'https://video.twimg.com/ext_tw_video/789/pu/vid/640x360/fail.mp4');

        await expect(
            service.handleMessage(
                {
                    type: 'downloadVideo',
                    mediaId: '789',
                },
                { tab: { id: 12 } as chrome.tabs.Tab },
            ),
        ).resolves.toEqual({
            ok: false,
            error: 'downloads disabled',
        });
    });
});

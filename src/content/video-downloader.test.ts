import { describe, expect, it, mock } from 'bun:test';
import { hasResolvableDownloadTarget, requestVideoDownload } from '@/content/video-downloader';
import type { sendRuntimeMessage } from '@/platform/chrome/runtime';

describe('video downloader', () => {
    it('should reject download messages with no identifiers or fallback url', () => {
        expect(
            hasResolvableDownloadTarget({
                type: 'downloadVideo',
            }),
        ).toBe(false);
        expect(
            hasResolvableDownloadTarget({
                type: 'downloadVideo',
                tweetId: '123',
            }),
        ).toBe(true);
    });

    it('should not send a runtime message when a video has no resolvable identifiers', async () => {
        const video = document.createElement('video');
        const button = document.createElement('button');
        const sendMessage = mock(async () => ({
            ok: true,
            downloadId: 1,
            url: 'https://example.com/video.mp4',
        })) as unknown as typeof sendRuntimeMessage;
        const logger = {
            logInfo: mock(() => {}),
            logWarn: mock(() => {}),
            logError: mock(() => {}),
        };

        await requestVideoDownload({
            video,
            button,
            sendMessage,
            logger,
        });

        expect(sendMessage).not.toHaveBeenCalled();
        expect(button.textContent).toBe('Retry');
        expect(button.title).toBe('This video cannot be downloaded from the current page state.');
        expect(logger.logWarn).toHaveBeenCalledWith('Download skipped: no resolvable identifiers', {
            videoId: null,
        });
    });
});

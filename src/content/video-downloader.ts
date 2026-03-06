import { createRuntimeLogger } from '@/content/runtime-logger';
import { sendRuntimeMessage } from '@/platform/chrome/runtime';
import type { DownloadVideoMessage } from '@/types/messages';

const BUTTON_CLASS = 'wawa-video-download-button';
const ROOT_ATTR = 'data-wawa-video-download-root';
const VIDEO_ID_ATTR = 'data-wawa-video-id';

let bootstrapped = false;
let nextVideoId = 0;
let pendingScan = false;

const runtimeLogger = createRuntimeLogger({
    prefixLabel: 'Wawa Video',
    onEntry: (entry) => {
        try {
            if (chrome.runtime?.id) {
                chrome.runtime.sendMessage({ type: 'log', entry }).catch(() => {});
            }
        } catch {}
    },
});

const getOrCreateVideoId = (video: HTMLVideoElement) => {
    const existing = video.getAttribute(VIDEO_ID_ATTR);
    if (existing) {
        return existing;
    }

    const created = `${++nextVideoId}`;
    video.setAttribute(VIDEO_ID_ATTR, created);
    return created;
};

const extractTweetIdFromHref = (href: string) => {
    const match = href.match(/\/status\/(\d+)/);
    return match?.[1];
};

const extractTweetId = (video: HTMLVideoElement) => {
    const tweetArticle = video.closest('article');
    if (!tweetArticle) {
        return undefined;
    }

    const links = tweetArticle.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]');
    for (const link of links) {
        const tweetId = extractTweetIdFromHref(link.href);
        if (tweetId) {
            return tweetId;
        }
    }

    return undefined;
};

const extractMediaId = (value?: string | null) => {
    if (!value) {
        return undefined;
    }

    const thumbMatch = value.match(/\/(?:ext_tw_video_thumb|amplify_video_thumb)\/(\d+)\//);
    if (thumbMatch?.[1]) {
        return thumbMatch[1];
    }

    const videoMatch = value.match(/\/(?:ext_tw_video|amplify_video)\/(\d+)\//);
    return videoMatch?.[1];
};

const getFallbackUrl = (video: HTMLVideoElement) => {
    const sourceCandidates = [video.currentSrc, video.src]
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value));

    return sourceCandidates.find((candidate) => /video\.twimg\.com/.test(candidate) && /\.mp4(?:\?|$)/.test(candidate));
};

const getContainer = (video: HTMLVideoElement) => {
    const container = video.parentElement;
    if (!container) {
        return null;
    }

    if (window.getComputedStyle(container).position === 'static') {
        container.style.position = 'relative';
    }

    return container;
};

const buildDownloadVideoMessage = (video: HTMLVideoElement): DownloadVideoMessage => {
    const message: DownloadVideoMessage = {
        type: 'downloadVideo',
    };

    const tweetId = extractTweetId(video);
    if (tweetId) {
        message.tweetId = tweetId;
    }

    const mediaId = extractMediaId(video.poster) ?? extractMediaId(video.currentSrc) ?? extractMediaId(video.src);
    if (mediaId) {
        message.mediaId = mediaId;
    }

    const fallbackUrl = getFallbackUrl(video);
    if (fallbackUrl) {
        message.fallbackUrl = fallbackUrl;
    }

    return message;
};

export const hasResolvableDownloadTarget = (message: DownloadVideoMessage) => {
    return Boolean(message.tweetId || message.mediaId || message.fallbackUrl);
};

const setButtonState = (button: HTMLButtonElement, state: 'idle' | 'working' | 'done' | 'error') => {
    switch (state) {
        case 'idle':
            button.disabled = false;
            button.textContent = 'Download';
            return;
        case 'working':
            button.disabled = true;
            button.textContent = 'Preparing...';
            return;
        case 'done':
            button.disabled = false;
            button.textContent = 'Queued';
            window.setTimeout(() => {
                if (button.isConnected) {
                    setButtonState(button, 'idle');
                }
            }, 1200);
            return;
        case 'error':
            button.disabled = false;
            button.textContent = 'Retry';
            return;
    }
};

type RequestVideoDownloadInput = {
    video: HTMLVideoElement;
    button: HTMLButtonElement;
    sendMessage?: typeof sendRuntimeMessage;
    logger?: Pick<typeof runtimeLogger, 'logInfo' | 'logWarn' | 'logError'>;
};

export const requestVideoDownload = async (input: RequestVideoDownloadInput) => {
    const sendMessage = input.sendMessage ?? sendRuntimeMessage;
    const logger = input.logger ?? runtimeLogger;
    const { video, button } = input;

    setButtonState(button, 'working');
    button.title = '';

    const message = buildDownloadVideoMessage(video);
    if (!hasResolvableDownloadTarget(message)) {
        button.title = 'This video cannot be downloaded from the current page state.';
        logger.logWarn('Download skipped: no resolvable identifiers', {
            videoId: video.getAttribute(VIDEO_ID_ATTR),
        });
        setButtonState(button, 'error');
        return;
    }

    logger.logInfo('Download requested', {
        mediaId: message.mediaId,
        tweetId: message.tweetId,
        videoId: video.getAttribute(VIDEO_ID_ATTR),
    });

    try {
        const response = await sendMessage(message);

        if (response.ok) {
            logger.logInfo('Download queued', {
                downloadId: response.downloadId,
                mediaId: message.mediaId,
                tweetId: message.tweetId,
            });
            setButtonState(button, 'done');
            return;
        }

        button.title = response.error;
        logger.logWarn('Download failed', {
            error: response.error,
            mediaId: message.mediaId,
            tweetId: message.tweetId,
        });
        setButtonState(button, 'error');
    } catch (error) {
        const messageText = error instanceof Error ? error.message : String(error);
        button.title = messageText;
        logger.logError('Download request crashed', { error: messageText });
        setButtonState(button, 'error');
    }
};

const createButton = (video: HTMLVideoElement) => {
    const button = document.createElement('button');
    button.className = BUTTON_CLASS;
    setButtonState(button, 'idle');

    button.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await requestVideoDownload({ video, button });
    });

    return button;
};

const ensureStyles = () => {
    if (document.getElementById('wawa-video-download-style')) {
        return;
    }

    const style = document.createElement('style');
    style.id = 'wawa-video-download-style';
    style.textContent = `
.${BUTTON_CLASS} {
    background: rgba(15, 20, 25, 0.92);
    border: 1px solid rgba(255, 255, 255, 0.22);
    border-radius: 999px;
    color: #ffffff;
    cursor: pointer;
    font-size: 12px;
    font-weight: 700;
    line-height: 1;
    min-width: 84px;
    padding: 8px 12px;
}
.${BUTTON_CLASS}:hover {
    background: #1d9bf0;
    border-color: #1d9bf0;
}
.${BUTTON_CLASS}:disabled {
    cursor: wait;
    opacity: 0.8;
}
`;

    document.head.appendChild(style);
};

const attachButton = (video: HTMLVideoElement) => {
    const container = getContainer(video);
    if (!container) {
        return false;
    }

    const videoId = getOrCreateVideoId(video);
    if (container.querySelector(`[${ROOT_ATTR}="${videoId}"]`)) {
        return false;
    }

    const root = document.createElement('div');
    root.setAttribute(ROOT_ATTR, videoId);
    root.style.position = 'absolute';
    root.style.insetBlockStart = '10px';
    root.style.insetInlineEnd = '10px';
    root.style.zIndex = '9999';
    root.style.pointerEvents = 'none';

    const button = createButton(video);
    button.style.pointerEvents = 'auto';

    root.appendChild(button);
    container.appendChild(root);

    runtimeLogger.logDebug('Attached video download button', {
        mediaId: extractMediaId(video.poster),
        tweetId: extractTweetId(video),
        videoId,
    });

    return true;
};

const scanForVideos = () => {
    const videos = document.querySelectorAll<HTMLVideoElement>('video');
    let attachedCount = 0;
    for (const video of videos) {
        if (attachButton(video)) {
            attachedCount += 1;
        }
    }

    if (attachedCount > 0) {
        runtimeLogger.logDebug('Video scan attached buttons', {
            attachedCount,
            totalVideos: videos.length,
        });
    }
};

const scheduleScan = () => {
    if (pendingScan) {
        return;
    }

    pendingScan = true;
    window.setTimeout(() => {
        pendingScan = false;
        scanForVideos();
    }, 80);
};

export const bootstrapVideoDownloader = () => {
    if (bootstrapped) {
        return;
    }
    bootstrapped = true;

    ensureStyles();
    scheduleScan();

    const observer = new MutationObserver(() => {
        scheduleScan();
    });

    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
    });

    window.setInterval(() => {
        scheduleScan();
    }, 2000);

    runtimeLogger.logInfo('Video downloader bootstrapped', {
        href: window.location.href,
    });
};

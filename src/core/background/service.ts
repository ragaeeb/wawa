import { DEFAULT_SETTINGS, getSettings as getStoredSettings, saveSettings } from '@/platform/chrome/storage';
import type { ExportSummary, ExtensionSettings, LogEntry } from '@/types/domain';
import type { RuntimeMessage, RuntimeResponseMap } from '@/types/messages';

export type BackgroundState = {
    logs: LogEntry[];
    lastExport: ExportSummary | null;
};

export type SettingsStore = {
    get(): Promise<ExtensionSettings>;
    set(settings: Partial<ExtensionSettings>): Promise<void>;
};

type VideoEntry = {
    mediaId?: string;
    score: number;
    updatedAt: number;
    url: string;
};

type TabVideoStore = {
    byMediaId: Map<string, VideoEntry>;
    latest?: VideoEntry;
};

type DownloadsAdapter = {
    download(options: chrome.downloads.DownloadOptions): Promise<number>;
};

export type BackgroundService = {
    handleMessage(
        message: RuntimeMessage,
        sender?: chrome.runtime.MessageSender,
    ): Promise<RuntimeResponseMap[keyof RuntimeResponseMap]>;
    trackVideoUrl(tabId: number, url: string): void;
    clearTab(tabId: number): void;
    getState(): BackgroundState;
};

const MAX_LOG_ENTRIES = 500;

const getTabVideoStore = (videoStore: Map<number, TabVideoStore>, tabId: number) => {
    const existing = videoStore.get(tabId);
    if (existing) {
        return existing;
    }

    const created: TabVideoStore = {
        byMediaId: new Map(),
    };
    videoStore.set(tabId, created);
    return created;
};

const extractMediaId = (url: string) => {
    const match = url.match(/\/(?:ext_tw_video|amplify_video)\/(\d+)\//);
    return match?.[1];
};

const scoreVideoUrl = (url: string) => {
    const resolution = url.match(/\/vid\/(\d+)x(\d+)\//);
    if (resolution) {
        const width = Number(resolution[1]);
        const height = Number(resolution[2]);
        if (Number.isFinite(width) && Number.isFinite(height)) {
            return width * height;
        }
    }

    const tagMatch = url.match(/[?&]tag=(\d+)/);
    if (tagMatch) {
        return Number(tagMatch[1]) * 100;
    }

    return 1;
};

const isSupportedVideoUrl = (url: string) => /video\.twimg\.com/.test(url) && /\.mp4(?:\?|$)/.test(url);

const sanitizeSegment = (value: string) =>
    value
        .replace(/[^a-z0-9_-]+/gi, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase();

const buildFilename = (url: string, tweetId?: string, mediaId?: string) => {
    const id = sanitizeSegment(tweetId ?? mediaId ?? `${Date.now()}`) || `${Date.now()}`;
    const extMatch = new URL(url).pathname.match(/\.([a-z0-9]+)$/i);
    const ext = extMatch?.[1]?.toLowerCase() ?? 'mp4';
    return `wawa-video-${id}.${ext}`;
};

export const createChromeSettingsStore = () => {
    const settingsStore: SettingsStore = {
        get: () => getStoredSettings(),
        set: async (settings) => {
            await saveSettings(settings);
        },
    };

    return settingsStore;
};

export const createBackgroundService = (
    settingsStore: SettingsStore,
    downloads: DownloadsAdapter = {
        download: (options) => chrome.downloads.download(options),
    },
) => {
    const state: BackgroundState = {
        logs: [],
        lastExport: null,
    };
    const videoStore = new Map<number, TabVideoStore>();

    const addLog = (entry: LogEntry) => {
        state.logs.push(entry);
        if (state.logs.length > MAX_LOG_ENTRIES) {
            state.logs = state.logs.slice(-MAX_LOG_ENTRIES);
        }
    };

    const getSettingsResponse = async () => {
        const settings = await settingsStore.get();
        return {
            minimalData: settings.minimalData ?? DEFAULT_SETTINGS.minimalData,
            includeReplies: settings.includeReplies ?? DEFAULT_SETTINGS.includeReplies,
            maxCount: settings.maxCount ?? DEFAULT_SETTINGS.maxCount,
        };
    };

    const saveSettingsMessage = async (message: Extract<RuntimeMessage, { type: 'saveSettings' }>) => {
        const nextSettings: Partial<ExtensionSettings> = {};
        if (message.minimalData !== undefined) {
            nextSettings.minimalData = message.minimalData;
        }
        if (message.includeReplies !== undefined) {
            nextSettings.includeReplies = message.includeReplies;
        }
        if (message.maxCount !== undefined) {
            nextSettings.maxCount = message.maxCount;
        }

        await settingsStore.set(nextSettings);
        return { success: true } as const;
    };

    const handleBasicMessage = async (message: Exclude<RuntimeMessage, { type: 'saveSettings' | 'downloadVideo' }>) => {
        if (message.type === 'log') {
            addLog(message.entry);
            return { success: true } as const;
        }

        if (message.type === 'getLogs') {
            return { logs: state.logs } as const;
        }

        if (message.type === 'clearLogs') {
            state.logs = [];
            return { success: true } as const;
        }

        if (message.type === 'exportComplete') {
            state.lastExport = {
                username: message.username,
                count: message.count,
                timestamp: new Date().toISOString(),
            };
            return { success: true } as const;
        }

        if (message.type === 'getLastExport') {
            return { lastExport: state.lastExport } as const;
        }

        if (message.type === 'getSettings') {
            return getSettingsResponse();
        }

        throw new Error(`Unsupported message type: ${String((message as { type?: unknown }).type)}`);
    };

    const trackVideoUrl = (tabId: number, url: string) => {
        if (tabId < 0 || !isSupportedVideoUrl(url)) {
            return;
        }

        const store = getTabVideoStore(videoStore, tabId);
        const mediaId = extractMediaId(url);
        const nextEntry: VideoEntry = {
            score: scoreVideoUrl(url),
            updatedAt: Date.now(),
            url,
        };
        if (mediaId) {
            nextEntry.mediaId = mediaId;
        }

        if (!store.latest || nextEntry.score >= store.latest.score) {
            store.latest = nextEntry;
        }

        if (!nextEntry.mediaId) {
            return;
        }

        const current = store.byMediaId.get(nextEntry.mediaId);
        if (!current || nextEntry.score >= current.score) {
            store.byMediaId.set(nextEntry.mediaId, nextEntry);
        }
    };

    const clearTab = (tabId: number) => {
        videoStore.delete(tabId);
    };

    const downloadVideo = async (
        message: Extract<RuntimeMessage, { type: 'downloadVideo' }>,
        sender?: chrome.runtime.MessageSender,
    ) => {
        const tabId = sender?.tab?.id;
        if (tabId === undefined || tabId < 0) {
            return { ok: false, error: 'Missing sender tab context' } as const;
        }

        const store = getTabVideoStore(videoStore, tabId);
        const entry = message.mediaId ? store.byMediaId.get(message.mediaId) : store.latest;
        const url = entry?.url ?? message.fallbackUrl;

        if (!url) {
            return {
                ok: false,
                error: 'No downloadable MP4 found yet. Play the video for a second and try again.',
            } as const;
        }

        try {
            const downloadId = await downloads.download({
                conflictAction: 'uniquify',
                filename: buildFilename(url, message.tweetId, message.mediaId),
                saveAs: true,
                url,
            });

            return { ok: true, downloadId, url } as const;
        } catch (error) {
            return {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            } as const;
        }
    };

    const handleMessage = async (message: RuntimeMessage, sender?: chrome.runtime.MessageSender) => {
        if (message.type === 'saveSettings') {
            return saveSettingsMessage(message);
        }

        if (message.type === 'downloadVideo') {
            return downloadVideo(message, sender);
        }

        return handleBasicMessage(message);
    };

    return {
        handleMessage,
        trackVideoUrl,
        clearTab,
        getState: () => state,
    };
};

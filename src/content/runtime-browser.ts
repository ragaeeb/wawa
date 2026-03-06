import { createChromeLocalFallbackStorage, createResumeStorage } from '@/core/resume/storage';

export const SEARCH_AUTOSTART_STORAGE_KEY = 'wawa_search_autostart';

export const createRuntimeResumeStorage = () => {
    const options: Parameters<typeof createResumeStorage>[0] = {};

    if (typeof indexedDB !== 'undefined') {
        options.indexedDbFactory = indexedDB;
    }

    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        options.fallbackStorage = createChromeLocalFallbackStorage();
    }

    return createResumeStorage(options);
};

export const saveSearchAutoStartContext = async (context: Record<string, unknown>) => {
    await chrome.storage.local.set({ [SEARCH_AUTOSTART_STORAGE_KEY]: context });
};

export const downloadFile = (filename: string, content: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = filename;
    link.click();

    URL.revokeObjectURL(url);
};

export const downloadJsonFile = (filename: string, payload: unknown) => {
    downloadFile(filename, JSON.stringify(payload, null, 2), 'application/json');
};

export const sleep = (milliseconds: number) =>
    new Promise<void>((resolve) => {
        setTimeout(resolve, milliseconds);
    });

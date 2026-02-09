import type { ExtensionSettings } from '@/types/domain';

export const DEFAULT_SETTINGS: ExtensionSettings = {
    minimalData: true,
    includeReplies: false,
    maxCount: 0,
};

/**
 * Reads extension settings with defaults applied for missing keys.
 */
export const getSettings = async () => {
    return chrome.storage.local.get(DEFAULT_SETTINGS) as Promise<ExtensionSettings>;
};

/**
 * Persists partial settings after merging with current defaults.
 */
export const saveSettings = async (settings: Partial<ExtensionSettings>) => {
    const next: ExtensionSettings = {
        minimalData: settings.minimalData ?? DEFAULT_SETTINGS.minimalData,
        includeReplies: settings.includeReplies ?? DEFAULT_SETTINGS.includeReplies,
        maxCount: settings.maxCount ?? DEFAULT_SETTINGS.maxCount,
    };

    await chrome.storage.local.set(next);
};

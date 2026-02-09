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

export type BackgroundService = {
    handleMessage(message: RuntimeMessage): Promise<RuntimeResponseMap[keyof RuntimeResponseMap]>;
    getState(): BackgroundState;
};

const MAX_LOG_ENTRIES = 500;

export const createChromeSettingsStore = () => {
    const settingsStore: SettingsStore = {
        get: () => getStoredSettings(),
        set: async (settings) => {
            await saveSettings(settings);
        },
    };

    return settingsStore;
};

export const createBackgroundService = (settingsStore: SettingsStore) => {
    const state: BackgroundState = {
        logs: [],
        lastExport: null,
    };

    const addLog = (entry: LogEntry) => {
        state.logs.push(entry);
        if (state.logs.length > MAX_LOG_ENTRIES) {
            state.logs = state.logs.slice(-MAX_LOG_ENTRIES);
        }
    };

    const handleMessage = async (message: RuntimeMessage) => {
        switch (message.type) {
            case 'log': {
                addLog(message.entry);
                return { success: true };
            }

            case 'getLogs': {
                return { logs: state.logs };
            }

            case 'clearLogs': {
                state.logs = [];
                return { success: true };
            }

            case 'exportComplete': {
                state.lastExport = {
                    username: message.username,
                    count: message.count,
                    timestamp: new Date().toISOString(),
                };
                return { success: true };
            }

            case 'getLastExport': {
                return { lastExport: state.lastExport };
            }

            case 'getSettings': {
                const settings = await settingsStore.get();
                return {
                    minimalData: settings.minimalData ?? DEFAULT_SETTINGS.minimalData,
                    includeReplies: settings.includeReplies ?? DEFAULT_SETTINGS.includeReplies,
                    maxCount: settings.maxCount ?? DEFAULT_SETTINGS.maxCount,
                };
            }

            case 'saveSettings': {
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
                return { success: true };
            }

            default: {
                throw new Error(`Unsupported message type: ${String((message as { type?: unknown }).type)}`);
            }
        }
    };

    return {
        handleMessage,
        getState: () => state,
    };
};

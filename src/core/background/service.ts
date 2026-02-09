import {
  DEFAULT_SETTINGS,
  getSettings as getStoredSettings,
  saveSettings,
} from "../../platform/chrome/storage";
import type { ExportSummary, ExtensionSettings, LogEntry } from "../../types/domain";
import type { RuntimeMessage, RuntimeResponseMap } from "../../types/messages";

export interface BackgroundState {
  logs: LogEntry[];
  lastExport: ExportSummary | null;
}

export interface SettingsStore {
  get(): Promise<ExtensionSettings>;
  set(settings: Partial<ExtensionSettings>): Promise<void>;
}

export interface BackgroundService {
  handleMessage(message: RuntimeMessage): Promise<RuntimeResponseMap[keyof RuntimeResponseMap]>;
  getState(): BackgroundState;
}

const MAX_LOG_ENTRIES = 500;

export function createChromeSettingsStore(): SettingsStore {
  return {
    get: () => getStoredSettings(),
    set: async (settings) => {
      await saveSettings(settings);
    },
  };
}

export function createBackgroundService(settingsStore: SettingsStore): BackgroundService {
  const state: BackgroundState = {
    logs: [],
    lastExport: null,
  };

  function addLog(entry: LogEntry): void {
    state.logs.push(entry);
    if (state.logs.length > MAX_LOG_ENTRIES) {
      state.logs = state.logs.slice(-MAX_LOG_ENTRIES);
    }
  }

  async function handleMessage(
    message: RuntimeMessage,
  ): Promise<RuntimeResponseMap[keyof RuntimeResponseMap]> {
    switch (message.type) {
      case "log": {
        addLog(message.entry);
        return { success: true };
      }

      case "getLogs": {
        return { logs: state.logs };
      }

      case "clearLogs": {
        state.logs = [];
        return { success: true };
      }

      case "exportComplete": {
        state.lastExport = {
          username: message.username,
          count: message.count,
          timestamp: new Date().toISOString(),
        };
        return { success: true };
      }

      case "getLastExport": {
        return { lastExport: state.lastExport };
      }

      case "getSettings": {
        const settings = await settingsStore.get();
        return {
          minimalData: settings.minimalData ?? DEFAULT_SETTINGS.minimalData,
          includeReplies: settings.includeReplies ?? DEFAULT_SETTINGS.includeReplies,
          maxCount: settings.maxCount ?? DEFAULT_SETTINGS.maxCount,
        };
      }

      case "saveSettings": {
        const nextSettings: Partial<ExtensionSettings> = {};
        if (message.minimalData !== undefined) nextSettings.minimalData = message.minimalData;
        if (message.includeReplies !== undefined)
          nextSettings.includeReplies = message.includeReplies;
        if (message.maxCount !== undefined) nextSettings.maxCount = message.maxCount;

        await settingsStore.set(nextSettings);
        return { success: true };
      }

      default: {
        throw new Error(`Unsupported message type: ${(message as RuntimeMessage).type}`);
      }
    }
  }

  return {
    handleMessage,
    getState: () => state,
  };
}

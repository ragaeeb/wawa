import type { ExtensionSettings } from "../../types/domain";

export const DEFAULT_SETTINGS: ExtensionSettings = {
  minimalData: true,
  includeReplies: false,
  maxCount: 0,
};

export async function getSettings(): Promise<ExtensionSettings> {
  return chrome.storage.local.get(DEFAULT_SETTINGS) as Promise<ExtensionSettings>;
}

export async function saveSettings(settings: Partial<ExtensionSettings>): Promise<void> {
  const next: ExtensionSettings = {
    minimalData: settings.minimalData ?? DEFAULT_SETTINGS.minimalData,
    includeReplies: settings.includeReplies ?? DEFAULT_SETTINGS.includeReplies,
    maxCount: settings.maxCount ?? DEFAULT_SETTINGS.maxCount,
  };

  await chrome.storage.local.set(next);
}

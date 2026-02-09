import { createBackgroundService, createChromeSettingsStore } from '@/core/background/service';
import { DEFAULT_SETTINGS } from '@/platform/chrome/storage';
import type { RuntimeMessage } from '@/types/messages';

let backgroundStarted = false;

export const bootstrapBackground = () => {
    if (backgroundStarted) {
        return;
    }
    backgroundStarted = true;

    const service = createBackgroundService(createChromeSettingsStore());

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        service
            .handleMessage(message as RuntimeMessage)
            .then((response) => sendResponse(response))
            .catch((error: unknown) => {
                const messageText = error instanceof Error ? error.message : String(error);
                sendResponse({ success: false, error: messageText });
            });

        return true;
    });

    chrome.runtime.onInstalled.addListener(() => {
        chrome.storage.local.get(DEFAULT_SETTINGS as unknown as Record<string, unknown>, (existing) => {
            chrome.storage.local.set(existing as Record<string, unknown>);
        });
    });
};

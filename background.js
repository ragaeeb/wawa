// TwExport Minimal - Background Service Worker
// Manages logs and settings for the popup to display.

let logs = [];
let lastExport = null;

function addLog(entry) {
    logs.push(entry);
    // Keep logs manageable
    if (logs.length > 500) {
        logs = logs.slice(-500);
    }
}

function clearLogs() {
    logs = [];
}

// Message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
        case "log":
            addLog(message.entry);
            sendResponse({ success: true });
            return false;

        case "getLogs":
            sendResponse({ logs });
            return false;

        case "clearLogs":
            clearLogs();
            sendResponse({ success: true });
            return false;

        case "exportComplete":
            lastExport = {
                username: message.username,
                count: message.count,
                timestamp: new Date().toISOString()
            };
            sendResponse({ success: true });
            return false;

        case "getLastExport":
            sendResponse({ lastExport });
            return false;

        case "getSettings":
            chrome.storage.local.get({
                minimalData: true,
                includeReplies: false,
                maxCount: 0
            }, (settings) => {
                sendResponse(settings);
            });
            return true; // async response

        case "saveSettings":
            chrome.storage.local.set({
                minimalData: message.minimalData ?? true,
                includeReplies: message.includeReplies ?? false,
                maxCount: message.maxCount ?? 0
            }, () => {
                sendResponse({ success: true });
            });
            return true; // async response

        default:
            return false;
    }
});

// Initialize default settings on install
chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.get({
        minimalData: true,
        includeReplies: false,
        maxCount: 0
    }, (existing) => {
        // Only set if not already set
        chrome.storage.local.set(existing);
    });
});

type RuntimeListener = (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
) => boolean | undefined;

type InstalledListener = () => void;

const storageState = new Map<string, unknown>();
const runtimeListeners = new Set<RuntimeListener>();
const installedListeners = new Set<InstalledListener>();
const badgeTextByTab = new Map<number, string>();
const badgeBackgroundColorByTab = new Map<number, string>();
const badgeTitleByTab = new Map<number, string>();

const resolveTabKey = (tabId?: number) => tabId ?? -1;

const chromeMock: typeof chrome = {
    runtime: {
        id: 'test-extension-id',
        onMessage: {
            addListener(listener: RuntimeListener) {
                runtimeListeners.add(listener);
            },
            removeListener(listener: RuntimeListener) {
                runtimeListeners.delete(listener);
            },
            hasListener(listener: RuntimeListener) {
                return runtimeListeners.has(listener);
            },
        },
        onInstalled: {
            addListener(listener: InstalledListener) {
                installedListeners.add(listener);
            },
            removeListener(listener: InstalledListener) {
                installedListeners.delete(listener);
            },
            hasListener(listener: InstalledListener) {
                return installedListeners.has(listener);
            },
        },
        async sendMessage(message: unknown) {
            const listener = Array.from(runtimeListeners).at(-1);
            if (!listener) {
                return undefined;
            }

            return await new Promise((resolve) => {
                const maybeAsync = listener(message, {} as chrome.runtime.MessageSender, (response) => {
                    resolve(response);
                });

                if (!maybeAsync) {
                    resolve(undefined);
                }
            });
        },
    } as typeof chrome.runtime,
    action: {
        async setBadgeText(details) {
            badgeTextByTab.set(resolveTabKey(details.tabId), details.text);
        },
        async setBadgeBackgroundColor(details) {
            badgeBackgroundColorByTab.set(resolveTabKey(details.tabId), String(details.color));
        },
        async setTitle(details) {
            badgeTitleByTab.set(resolveTabKey(details.tabId), details.title);
        },
    } as typeof chrome.action,
    storage: {
        local: {
            get(
                keys?: string | string[] | Record<string, unknown> | null,
                callback?: (items: Record<string, unknown>) => void,
            ) {
                const out: Record<string, unknown> = {};

                if (!keys) {
                    for (const [key, value] of storageState.entries()) {
                        out[key] = value;
                    }
                } else if (typeof keys === 'string') {
                    out[keys] = storageState.get(keys);
                } else if (Array.isArray(keys)) {
                    keys.forEach((key) => {
                        out[key] = storageState.get(key);
                    });
                } else {
                    Object.entries(keys).forEach(([key, defaultValue]) => {
                        out[key] = storageState.has(key) ? storageState.get(key) : defaultValue;
                    });
                }

                if (callback) {
                    callback(out);
                    return;
                }

                return Promise.resolve(out);
            },
            set(items: Record<string, unknown>, callback?: () => void) {
                Object.entries(items).forEach(([key, value]) => {
                    storageState.set(key, value);
                });
                if (callback) {
                    callback();
                    return;
                }
                return Promise.resolve();
            },
            remove(keys: string | string[], callback?: () => void) {
                if (Array.isArray(keys)) {
                    keys.forEach((key) => {
                        storageState.delete(key);
                    });
                } else {
                    storageState.delete(keys);
                }

                if (callback) {
                    callback();
                    return;
                }

                return Promise.resolve();
            },
        } as typeof chrome.storage.local,
    } as typeof chrome.storage,
} as typeof chrome;

Object.defineProperty(globalThis, 'chrome', {
    value: chromeMock,
    configurable: true,
    writable: true,
});

Object.defineProperty(globalThis, '__wawaChromeMock', {
    value: {
        clearStorage: () => {
            storageState.clear();
            badgeTextByTab.clear();
            badgeBackgroundColorByTab.clear();
            badgeTitleByTab.clear();
        },
        triggerInstalled: () => {
            installedListeners.forEach((listener) => {
                listener();
            });
        },
        getBadgeState: (tabId?: number) => {
            const key = resolveTabKey(tabId);
            return {
                text: badgeTextByTab.get(key) ?? '',
                color: badgeBackgroundColorByTab.get(key) ?? '',
                title: badgeTitleByTab.get(key) ?? '',
            };
        },
    },
    configurable: true,
    writable: false,
});

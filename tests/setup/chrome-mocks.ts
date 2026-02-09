type RuntimeListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
) => boolean | undefined;

type InstalledListener = () => void;

const storageState = new Map<string, unknown>();
const runtimeListeners = new Set<RuntimeListener>();
const installedListeners = new Set<InstalledListener>();

const chromeMock: typeof chrome = {
  runtime: {
    id: "test-extension-id",
    onMessage: {
      addListener(listener: RuntimeListener): void {
        runtimeListeners.add(listener);
      },
      removeListener(listener: RuntimeListener): void {
        runtimeListeners.delete(listener);
      },
      hasListener(listener: RuntimeListener): boolean {
        return runtimeListeners.has(listener);
      },
    },
    onInstalled: {
      addListener(listener: InstalledListener): void {
        installedListeners.add(listener);
      },
      removeListener(listener: InstalledListener): void {
        installedListeners.delete(listener);
      },
      hasListener(listener: InstalledListener): boolean {
        return installedListeners.has(listener);
      },
    },
    async sendMessage(message: unknown): Promise<unknown> {
      const listener = Array.from(runtimeListeners).at(-1);
      if (!listener) return undefined;

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
  storage: {
    local: {
      get(
        keys?: string | string[] | Record<string, unknown> | null,
        callback?: (items: Record<string, unknown>) => void,
      ): Promise<Record<string, unknown>> | undefined {
        const out: Record<string, unknown> = {};

        if (!keys) {
          for (const [key, value] of storageState.entries()) out[key] = value;
        } else if (typeof keys === "string") {
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
      set(items: Record<string, unknown>, callback?: () => void): Promise<void> | undefined {
        Object.entries(items).forEach(([key, value]) => {
          storageState.set(key, value);
        });
        if (callback) {
          callback();
          return;
        }
        return Promise.resolve();
      },
      remove(keys: string | string[], callback?: () => void): Promise<void> | undefined {
        if (Array.isArray(keys)) {
          keys.forEach((key) => {
            storageState.delete(key);
          });
        } else storageState.delete(keys);

        if (callback) {
          callback();
          return;
        }

        return Promise.resolve();
      },
    } as typeof chrome.storage.local,
  } as typeof chrome.storage,
} as typeof chrome;

Object.defineProperty(globalThis, "chrome", {
  value: chromeMock,
  configurable: true,
  writable: true,
});

Object.defineProperty(globalThis, "__twexportChromeMock", {
  value: {
    clearStorage: (): void => storageState.clear(),
    triggerInstalled: (): void => {
      installedListeners.forEach((listener) => {
        listener();
      });
    },
  },
  configurable: true,
  writable: false,
});

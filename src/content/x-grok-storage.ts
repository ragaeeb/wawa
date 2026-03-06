import type { XGrokGraphqlContext } from '@/core/x-grok/types';

export const X_GROK_CONTEXT_STORAGE_KEY = 'wawa_x_grok_context';

export const readStoredXGrokContext = async () => {
    const result = await chrome.storage.local.get({ [X_GROK_CONTEXT_STORAGE_KEY]: null });
    const context = result[X_GROK_CONTEXT_STORAGE_KEY];
    if (!context || typeof context !== 'object') {
        return null;
    }
    return context as XGrokGraphqlContext;
};

export const writeStoredXGrokContext = async (context: XGrokGraphqlContext) => {
    await chrome.storage.local.set({ [X_GROK_CONTEXT_STORAGE_KEY]: context });
};

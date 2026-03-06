import type { XGrokGraphqlContext } from '@/core/x-grok/types';

export const X_GROK_CONTEXT_STORAGE_KEY = 'wawa_x_grok_context';

const isStoredXGrokContext = (value: unknown): value is XGrokGraphqlContext => {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as Record<string, unknown>;
    const isOptionalString = (key: keyof XGrokGraphqlContext) =>
        candidate[key] === undefined || typeof candidate[key] === 'string';

    return (
        typeof candidate.updatedAt === 'number' &&
        isOptionalString('historyQueryId') &&
        isOptionalString('detailQueryId') &&
        isOptionalString('detailFeatures') &&
        isOptionalString('detailFieldToggles')
    );
};

export const readStoredXGrokContext = async () => {
    const result = await chrome.storage.local.get({ [X_GROK_CONTEXT_STORAGE_KEY]: null });
    const context = result[X_GROK_CONTEXT_STORAGE_KEY];
    if (!isStoredXGrokContext(context)) {
        return null;
    }
    return context;
};

export const writeStoredXGrokContext = async (context: XGrokGraphqlContext) => {
    await chrome.storage.local.set({ [X_GROK_CONTEXT_STORAGE_KEY]: context });
};

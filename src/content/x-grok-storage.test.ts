import { beforeEach, describe, expect, it } from 'bun:test';
import { readStoredXGrokContext, writeStoredXGrokContext, X_GROK_CONTEXT_STORAGE_KEY } from '@/content/x-grok-storage';

describe('x-grok storage', () => {
    beforeEach(() => {
        (globalThis as { __wawaChromeMock?: { clearStorage: () => void } }).__wawaChromeMock?.clearStorage();
    });

    it('should round-trip valid stored x-grok context', async () => {
        const context = {
            historyQueryId: 'history-id',
            detailQueryId: 'detail-id',
            detailFeatures: '{"feature":true}',
            detailFieldToggles: '{"withGrok":true}',
            updatedAt: 123,
        };

        await writeStoredXGrokContext(context);

        await expect(readStoredXGrokContext()).resolves.toEqual(context);
    });

    it('should reject malformed stored x-grok context objects', async () => {
        await chrome.storage.local.set({
            [X_GROK_CONTEXT_STORAGE_KEY]: {
                updatedAt: 'bad',
                detailQueryId: 123,
            },
        });

        await expect(readStoredXGrokContext()).resolves.toBeNull();
    });
});

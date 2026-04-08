import { describe, expect, it, mock } from 'bun:test';
import { persistGrokBulkLimitChange, runGrokBulkExport, runGrokClearAll } from './grok-bulk-export';

describe('runGrokBulkExport', () => {
    it('should surface setup failures and always release the busy state', async () => {
        const setStatus = mock(() => {});
        const setBusy = mock(() => {});

        await runGrokBulkExport({
            rawLimit: '5',
            normalizeLimit: (value) => value,
            setLimitValue: mock(() => {}),
            saveLimit: async () => {
                throw new Error('storage boom');
            },
            getActiveTabId: async () => 99,
            sendTabMessage: async () => ({
                ok: true,
                result: {
                    attempted: 1,
                    discovered: 1,
                    elapsedMs: 1,
                    exported: 1,
                    failed: 0,
                    warnings: [],
                },
            }),
            setStatus,
            setBusy,
        });

        expect(setStatus).toHaveBeenCalledWith('Bulk export failed: storage boom', true);
        expect(setBusy).toHaveBeenNthCalledWith(1, true);
        expect(setBusy).toHaveBeenLastCalledWith(false);
    });

    it('should stop cleanly when no active tab is available', async () => {
        const setStatus = mock(() => {});
        const setBusy = mock(() => {});

        await runGrokBulkExport({
            rawLimit: '7',
            normalizeLimit: (value) => value,
            setLimitValue: mock(() => {}),
            saveLimit: async () => {},
            getActiveTabId: async () => null,
            sendTabMessage: async () => {
                throw new Error('should not run');
            },
            setStatus,
            setBusy,
        });

        expect(setStatus).toHaveBeenCalledWith('No active tab found.', true);
        expect(setBusy).toHaveBeenLastCalledWith(false);
    });
});

describe('runGrokClearAll', () => {
    it('should delete all chats and always release the busy state', async () => {
        const setStatus = mock(() => {});
        const setBusy = mock(() => {});

        await runGrokClearAll({
            getActiveTabId: async () => 99,
            sendTabMessage: async () => ({ ok: true }),
            setStatus,
            setBusy,
        });

        expect(setStatus).toHaveBeenCalledWith('Deleting all Grok chats...');
        expect(setStatus).toHaveBeenCalledWith('Deleted all Grok chats.');
        expect(setBusy).toHaveBeenNthCalledWith(1, true);
        expect(setBusy).toHaveBeenLastCalledWith(false);
    });

    it('should surface delete failures and always release the busy state', async () => {
        const setStatus = mock(() => {});
        const setBusy = mock(() => {});

        await runGrokClearAll({
            getActiveTabId: async () => 99,
            sendTabMessage: async () => ({ ok: false, error: 'forbidden' }),
            setStatus,
            setBusy,
        });

        expect(setStatus).toHaveBeenCalledWith('Delete all chats failed: forbidden', true);
        expect(setBusy).toHaveBeenLastCalledWith(false);
    });
});

describe('persistGrokBulkLimitChange', () => {
    it('should report persistence errors from the change handler', async () => {
        const setStatus = mock(() => {});

        await persistGrokBulkLimitChange({
            rawLimit: '9',
            normalizeLimit: (value) => value,
            setLimitValue: mock(() => {}),
            saveLimit: async () => {
                throw new Error('storage boom');
            },
            setStatus,
        });

        expect(setStatus).toHaveBeenCalledWith('Failed to save Grok export limit: storage boom', true);
    });
});

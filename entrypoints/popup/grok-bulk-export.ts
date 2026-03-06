import {
    isXGrokBulkExportMessage,
    WAWA_X_GROK_BULK_EXPORT_MESSAGE,
    type XGrokBulkExportResponse,
} from '@/content/x-grok-contracts';

type BulkExportSuccessResponse = XGrokBulkExportResponse & { ok: true };

type BulkExportInput = {
    rawLimit: string;
    normalizeLimit: (value: number) => number;
    setLimitValue: (value: string) => void;
    saveLimit: (value: number) => Promise<void>;
    getActiveTabId: () => Promise<number | null>;
    sendTabMessage: (tabId: number, limit: number) => Promise<XGrokBulkExportResponse | undefined>;
    setStatus: (message: string, isError?: boolean) => void;
    setBusy: (busy: boolean) => void;
};

type BulkLimitChangeInput = Pick<
    BulkExportInput,
    'rawLimit' | 'normalizeLimit' | 'setLimitValue' | 'saveLimit' | 'setStatus'
>;

const formatBulkExportStatus = (response: BulkExportSuccessResponse) => {
    const { result } = response;
    const warningText = result.warnings.length > 0 ? ` Warnings: ${result.warnings.join(' | ')}` : '';
    return `Exported ${result.exported}/${result.attempted} Grok chats.${warningText}`;
};

export const persistGrokBulkLimitChange = async (input: BulkLimitChangeInput) => {
    try {
        const limit = input.normalizeLimit(Number(input.rawLimit));
        input.setLimitValue(String(limit));
        await input.saveLimit(limit);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        input.setStatus(`Failed to save Grok export limit: ${message}`, true);
    }
};

export const runGrokBulkExport = async (input: BulkExportInput): Promise<void> => {
    input.setBusy(true);

    try {
        const limit = input.normalizeLimit(Number(input.rawLimit));
        input.setLimitValue(String(limit));
        await input.saveLimit(limit);

        const tabId = await input.getActiveTabId();
        if (tabId === null) {
            input.setStatus('No active tab found.', true);
            return;
        }

        input.setStatus('Exporting Grok chats...');

        const message = {
            type: WAWA_X_GROK_BULK_EXPORT_MESSAGE,
            limit,
        };
        if (!isXGrokBulkExportMessage(message)) {
            throw new Error('Invalid Grok export request.');
        }

        const response = await input.sendTabMessage(tabId, limit);
        if (!response) {
            throw new Error('No response from the content script. Open an x.com tab and try again.');
        }
        if (!response.ok) {
            throw new Error(response.error);
        }

        input.setStatus(formatBulkExportStatus(response));
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        input.setStatus(`Bulk export failed: ${message}`, true);
    } finally {
        input.setBusy(false);
    }
};

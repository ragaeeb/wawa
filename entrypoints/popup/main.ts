import {
    DEFAULT_X_GROK_BULK_EXPORT_LIMIT,
    isXGrokBulkExportMessage,
    normalizeXGrokBulkExportLimit,
    WAWA_X_GROK_BULK_EXPORT_MESSAGE,
    X_GROK_BULK_EXPORT_LIMIT_STORAGE_KEY,
    type XGrokBulkExportResponse,
} from '@/content/x-grok-contracts';
import { sendRuntimeMessage } from '@/platform/chrome/runtime';
import type { LogEntry } from '@/types/domain';
import './style.css';

const elements = {
    status: document.getElementById('status') as HTMLDivElement,
    log: document.getElementById('log') as HTMLPreElement,
    refreshLogs: document.getElementById('refreshLogs') as HTMLButtonElement,
    clearLogs: document.getElementById('clearLogs') as HTMLButtonElement,
    grokBulkLimit: document.getElementById('grokBulkLimit') as HTMLInputElement,
    exportGrokChats: document.getElementById('exportGrokChats') as HTMLButtonElement,
};

const getActiveTabId = async () => {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return typeof activeTab?.id === 'number' ? activeTab.id : null;
};

const setStatus = (message: string, isError = false) => {
    elements.status.textContent = message;
    elements.status.dataset.state = isError ? 'error' : 'success';
};

const loadBulkExportLimit = async () => {
    try {
        const result = await chrome.storage.local.get({
            [X_GROK_BULK_EXPORT_LIMIT_STORAGE_KEY]: DEFAULT_X_GROK_BULK_EXPORT_LIMIT,
        });
        elements.grokBulkLimit.value = String(
            normalizeXGrokBulkExportLimit(result[X_GROK_BULK_EXPORT_LIMIT_STORAGE_KEY]),
        );
    } catch {
        elements.grokBulkLimit.value = String(DEFAULT_X_GROK_BULK_EXPORT_LIMIT);
    }
};

const saveBulkExportLimit = async (value: number) => {
    await chrome.storage.local.set({
        [X_GROK_BULK_EXPORT_LIMIT_STORAGE_KEY]: normalizeXGrokBulkExportLimit(value),
    });
};

const formatBulkExportStatus = (response: XGrokBulkExportResponse & { ok: true }) => {
    const { result } = response;
    const warningText = result.warnings.length > 0 ? ` Warnings: ${result.warnings.join(' | ')}` : '';
    return `Exported ${result.exported}/${result.attempted} Grok chats.${warningText}`;
};

const formatLogEntry = (entry: LogEntry): string => {
    const time = entry.timestamp.split('T')[1]?.split('.')[0] ?? entry.timestamp;
    const level = entry.level.toUpperCase().padEnd(5);
    let line = `[${time}] ${level} ${entry.message}`;

    if (entry.data !== undefined) {
        line += ` ${JSON.stringify(entry.data)}`;
    }

    return line;
};

const loadLogs = async (): Promise<void> => {
    try {
        const response = await sendRuntimeMessage({ type: 'getLogs' });
        const logs = response.logs ?? [];

        if (logs.length === 0) {
            elements.log.textContent = "No logs yet. Navigate to a Twitter profile and click 'Export Tweets'.";
            return;
        }

        elements.log.textContent = logs.map(formatLogEntry).join('\n');
        elements.log.scrollTop = elements.log.scrollHeight;
    } catch (error) {
        elements.log.textContent = `Failed to load logs: ${String(error)}`;
    }
};

const clearLogs = async (): Promise<void> => {
    try {
        await sendRuntimeMessage({ type: 'clearLogs' });
        elements.log.textContent = 'Logs cleared.';
    } catch (error) {
        elements.log.textContent = `Failed to clear logs: ${String(error)}`;
    }
};

const exportGrokChats = async (): Promise<void> => {
    const limit = normalizeXGrokBulkExportLimit(Number(elements.grokBulkLimit.value));
    elements.grokBulkLimit.value = String(limit);
    await saveBulkExportLimit(limit);

    const tabId = await getActiveTabId();
    if (tabId === null) {
        setStatus('No active tab found.', true);
        return;
    }

    elements.exportGrokChats.disabled = true;
    setStatus('Exporting Grok chats...');

    try {
        const message = {
            type: WAWA_X_GROK_BULK_EXPORT_MESSAGE,
            limit,
        };
        if (!isXGrokBulkExportMessage(message)) {
            throw new Error('Invalid Grok export request.');
        }

        const response = (await chrome.tabs.sendMessage(tabId, message)) as XGrokBulkExportResponse | undefined;
        if (!response) {
            throw new Error('No response from the content script. Open an x.com tab and try again.');
        }
        if (!response.ok) {
            throw new Error(response.error);
        }

        setStatus(formatBulkExportStatus(response));
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setStatus(`Bulk export failed: ${message}`, true);
    } finally {
        elements.exportGrokChats.disabled = false;
    }
};

elements.refreshLogs.addEventListener('click', () => {
    void loadLogs();
});

elements.clearLogs.addEventListener('click', () => {
    void clearLogs();
});

elements.grokBulkLimit.addEventListener('change', () => {
    const limit = normalizeXGrokBulkExportLimit(Number(elements.grokBulkLimit.value));
    elements.grokBulkLimit.value = String(limit);
    void saveBulkExportLimit(limit);
});

elements.exportGrokChats.addEventListener('click', () => {
    void exportGrokChats();
});

void loadBulkExportLimit();
void loadLogs();

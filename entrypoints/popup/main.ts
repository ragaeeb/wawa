import {
    DEFAULT_X_GROK_BULK_EXPORT_LIMIT,
    normalizeXGrokBulkExportLimit,
    WAWA_X_GROK_BULK_EXPORT_MESSAGE,
    WAWA_X_GROK_CLEAR_ALL_MESSAGE,
    X_GROK_BULK_EXPORT_LIMIT_STORAGE_KEY,
} from '@/content/x-grok-contracts';
import { sendRuntimeMessage } from '@/platform/chrome/runtime';
import type { LogEntry } from '@/types/domain';
import { persistGrokBulkLimitChange, runGrokBulkExport, runGrokClearAll } from './grok-bulk-export';
import './style.css';

const elements = {
    status: document.getElementById('status') as HTMLDivElement,
    log: document.getElementById('log') as HTMLPreElement,
    refreshLogs: document.getElementById('refreshLogs') as HTMLButtonElement,
    clearLogs: document.getElementById('clearLogs') as HTMLButtonElement,
    grokBulkLimit: document.getElementById('grokBulkLimit') as HTMLInputElement,
    exportGrokChats: document.getElementById('exportGrokChats') as HTMLButtonElement,
    showDeleteGrokChatsConfirm: document.getElementById('showDeleteGrokChatsConfirm') as HTMLButtonElement,
    deleteGrokChatsConfirm: document.getElementById('deleteGrokChatsConfirm') as HTMLDivElement,
    confirmDeleteGrokChats: document.getElementById('confirmDeleteGrokChats') as HTMLButtonElement,
    cancelDeleteGrokChats: document.getElementById('cancelDeleteGrokChats') as HTMLButtonElement,
};

const getActiveTabId = async () => {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return typeof activeTab?.id === 'number' ? activeTab.id : null;
};

const setStatus = (message: string, isError = false) => {
    elements.status.textContent = message;
    elements.status.dataset.state = isError ? 'error' : 'success';
};

const setDeleteConfirmationVisible = (visible: boolean) => {
    elements.deleteGrokChatsConfirm.hidden = !visible;
    elements.showDeleteGrokChatsConfirm.hidden = visible;
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
    await runGrokBulkExport({
        rawLimit: elements.grokBulkLimit.value,
        normalizeLimit: normalizeXGrokBulkExportLimit,
        setLimitValue: (value) => {
            elements.grokBulkLimit.value = value;
        },
        saveLimit: saveBulkExportLimit,
        getActiveTabId,
        sendTabMessage: (tabId, limit) => {
            return chrome.tabs.sendMessage(tabId, {
                type: WAWA_X_GROK_BULK_EXPORT_MESSAGE,
                limit,
            });
        },
        setStatus,
        setBusy: (busy) => {
            elements.exportGrokChats.disabled = busy;
            elements.showDeleteGrokChatsConfirm.disabled = busy;
            elements.confirmDeleteGrokChats.disabled = busy;
            elements.cancelDeleteGrokChats.disabled = busy;
        },
    });
};

const deleteGrokChats = async (): Promise<void> => {
    await runGrokClearAll({
        getActiveTabId,
        sendTabMessage: (tabId) => {
            return chrome.tabs.sendMessage(tabId, {
                type: WAWA_X_GROK_CLEAR_ALL_MESSAGE,
            });
        },
        setStatus,
        setBusy: (busy) => {
            elements.exportGrokChats.disabled = busy;
            elements.showDeleteGrokChatsConfirm.disabled = busy;
            elements.confirmDeleteGrokChats.disabled = busy;
            elements.cancelDeleteGrokChats.disabled = busy;
        },
    });
};

elements.refreshLogs.addEventListener('click', () => {
    void loadLogs();
});

elements.clearLogs.addEventListener('click', () => {
    void clearLogs();
});

elements.grokBulkLimit.addEventListener('change', () => {
    void persistGrokBulkLimitChange({
        rawLimit: elements.grokBulkLimit.value,
        normalizeLimit: normalizeXGrokBulkExportLimit,
        setLimitValue: (value) => {
            elements.grokBulkLimit.value = value;
        },
        saveLimit: saveBulkExportLimit,
        setStatus,
    });
});

elements.exportGrokChats.addEventListener('click', () => {
    void exportGrokChats();
});

elements.showDeleteGrokChatsConfirm.addEventListener('click', () => {
    setDeleteConfirmationVisible(true);
    setStatus('Confirm to permanently delete all Grok chats.', true);
});

elements.cancelDeleteGrokChats.addEventListener('click', () => {
    setDeleteConfirmationVisible(false);
    setStatus('Delete all Grok chats cancelled.');
});

elements.confirmDeleteGrokChats.addEventListener('click', () => {
    setDeleteConfirmationVisible(false);
    void deleteGrokChats();
});

void loadBulkExportLimit();
setDeleteConfirmationVisible(false);
void loadLogs();

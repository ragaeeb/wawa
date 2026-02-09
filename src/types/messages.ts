import type { ExportSummary, ExtensionSettings, LogEntry } from '@/types/domain';

export type LogMessage = {
    type: 'log';
    entry: LogEntry;
};

export type GetLogsMessage = {
    type: 'getLogs';
};

export type ClearLogsMessage = {
    type: 'clearLogs';
};

export type ExportCompleteMessage = {
    type: 'exportComplete';
    username: string;
    count: number;
};

export type GetLastExportMessage = {
    type: 'getLastExport';
};

export type GetSettingsMessage = {
    type: 'getSettings';
};

export type SaveSettingsMessage = {
    type: 'saveSettings';
    minimalData?: boolean;
    includeReplies?: boolean;
    maxCount?: number;
};

export type RuntimeMessage =
    | LogMessage
    | GetLogsMessage
    | ClearLogsMessage
    | ExportCompleteMessage
    | GetLastExportMessage
    | GetSettingsMessage
    | SaveSettingsMessage;

export type RuntimeResponseMap = {
    log: { success: true };
    getLogs: { logs: LogEntry[] };
    clearLogs: { success: true };
    exportComplete: { success: true };
    getLastExport: { lastExport: ExportSummary | null };
    getSettings: ExtensionSettings;
    saveSettings: { success: true };
};

export type RuntimeResponseFor<T extends RuntimeMessage> = T extends { type: infer K }
    ? K extends keyof RuntimeResponseMap
        ? RuntimeResponseMap[K]
        : never
    : never;

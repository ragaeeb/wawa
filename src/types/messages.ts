import type { ExportSummary, ExtensionSettings, LogEntry } from '@/types/domain';

type LogMessage = {
    type: 'log';
    entry: LogEntry;
};

type GetLogsMessage = {
    type: 'getLogs';
};

type ClearLogsMessage = {
    type: 'clearLogs';
};

type ExportCompleteMessage = {
    type: 'exportComplete';
    username: string;
    count: number;
};

type GetLastExportMessage = {
    type: 'getLastExport';
};

type GetSettingsMessage = {
    type: 'getSettings';
};

type SaveSettingsMessage = {
    type: 'saveSettings';
    minimalData?: boolean;
    includeReplies?: boolean;
    maxCount?: number;
};

export type DownloadVideoMessage = {
    type: 'downloadVideo';
    tweetId?: string;
    mediaId?: string;
    fallbackUrl?: string;
};

export type RuntimeMessage =
    | LogMessage
    | GetLogsMessage
    | ClearLogsMessage
    | ExportCompleteMessage
    | GetLastExportMessage
    | GetSettingsMessage
    | SaveSettingsMessage
    | DownloadVideoMessage;

export type RuntimeResponseMap = {
    log: { success: true };
    getLogs: { logs: LogEntry[] };
    clearLogs: { success: true };
    exportComplete: { success: true };
    getLastExport: { lastExport: ExportSummary | null };
    getSettings: ExtensionSettings;
    saveSettings: { success: true };
    downloadVideo: { ok: true; downloadId: number; url: string } | { ok: false; error: string };
};

export type RuntimeResponseFor<T extends RuntimeMessage> = T extends { type: infer K }
    ? K extends keyof RuntimeResponseMap
        ? RuntimeResponseMap[K]
        : never
    : never;

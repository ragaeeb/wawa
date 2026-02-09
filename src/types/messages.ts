import type { ExportSummary, ExtensionSettings, LogEntry } from "./domain";

export interface LogMessage {
  type: "log";
  entry: LogEntry;
}

export interface GetLogsMessage {
  type: "getLogs";
}

export interface ClearLogsMessage {
  type: "clearLogs";
}

export interface ExportCompleteMessage {
  type: "exportComplete";
  username: string;
  count: number;
}

export interface GetLastExportMessage {
  type: "getLastExport";
}

export interface GetSettingsMessage {
  type: "getSettings";
}

export interface SaveSettingsMessage {
  type: "saveSettings";
  minimalData?: boolean;
  includeReplies?: boolean;
  maxCount?: number;
}

export type RuntimeMessage =
  | LogMessage
  | GetLogsMessage
  | ClearLogsMessage
  | ExportCompleteMessage
  | GetLastExportMessage
  | GetSettingsMessage
  | SaveSettingsMessage;

export interface RuntimeResponseMap {
  log: { success: true };
  getLogs: { logs: LogEntry[] };
  clearLogs: { success: true };
  exportComplete: { success: true };
  getLastExport: { lastExport: ExportSummary | null };
  getSettings: ExtensionSettings;
  saveSettings: { success: true };
}

export type RuntimeResponseFor<T extends RuntimeMessage> = T extends { type: infer K }
  ? K extends keyof RuntimeResponseMap
    ? RuntimeResponseMap[K]
    : never
  : never;

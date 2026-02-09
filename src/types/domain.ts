export interface TweetAuthor {
  id?: string;
  username?: string;
  name?: string;
  verified?: boolean;
  followers_count?: number;
  following_count?: number;
  [key: string]: unknown;
}

export interface TweetItem {
  id?: string;
  author?: TweetAuthor;
  text?: string;
  created_at?: string;
  type?: string;
  [key: string]: unknown;
}

export interface MergeInfo {
  previous_count: number;
  new_count: number;
  duplicates_removed: number;
  final_count: number;
}

export interface ExportMeta {
  username: string;
  user_id?: string;
  name?: string;
  export_started_at?: string;
  export_completed_at?: string;
  collected_count?: number;
  new_collected_count?: number;
  previous_collected_count?: number;
  reported_count?: number | null;
  collection_method?: string;
  scroll_responses_captured?: number;
  previous_export_started_at?: string;
  previous_export_completed_at?: string;
  merge_info?: MergeInfo;
  [key: string]: unknown;
}

export interface ExportPayload {
  meta: ExportMeta;
  items: TweetItem[];
}

export interface ResumePayload {
  username: string;
  saved_at: number;
  meta: ExportMeta | null;
  tweets: TweetItem[];
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: unknown;
}

export interface ExportSummary {
  username: string;
  count: number;
  timestamp: string;
}

export interface ExtensionSettings {
  minimalData: boolean;
  includeReplies: boolean;
  maxCount: number;
}

import type { ExportMeta, ResumePayload, TweetItem } from "../../types/domain";

export interface ResumeParseResult {
  tweets: TweetItem[];
  meta: ExportMeta | null;
  username: string | null;
}

export function parseTweetDate(dateStr: string | undefined): Date | null {
  if (!dateStr) return null;

  const customMatch = dateStr.match(
    /(\d{4})\s*-\s*(\d{2})\s*-\s*(\d{2})\s*(\d{2}):(\d{2}):(\d{2})/,
  );
  if (customMatch) {
    const [_, year, month, day, hour, minute, second] = customMatch;
    return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
  }

  const parsed = new Date(dateStr);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function extractTweetsFromExportData(data: unknown): TweetItem[] {
  if (Array.isArray(data)) return data as TweetItem[];
  if (!data || typeof data !== "object") return [];

  const payload = data as { items?: unknown; tweets?: unknown };
  if (Array.isArray(payload.items)) return payload.items as TweetItem[];
  if (Array.isArray(payload.tweets)) return payload.tweets as TweetItem[];
  return [];
}

export function parseResumeInput(data: unknown): ResumeParseResult {
  const tweets = extractTweetsFromExportData(data);

  if (!data || typeof data !== "object") {
    return { tweets, meta: null, username: null };
  }

  const payload = data as {
    meta?: ExportMeta;
    metadata?: ExportMeta;
  };

  const meta = payload.meta ?? payload.metadata ?? null;
  const username = normalizeUsername(meta?.username);

  return { tweets, meta, username };
}

export function normalizeUsername(username: unknown): string | null {
  if (typeof username !== "string") return null;
  const normalized = username.trim().replace(/^@/, "").toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

export function buildResumePayload(input: {
  username: string;
  tweets: TweetItem[];
  meta: ExportMeta | null;
  savedAt?: number;
}): ResumePayload {
  return {
    username: input.username.trim().replace(/^@/, "").toLowerCase(),
    saved_at: input.savedAt ?? Date.now(),
    meta: input.meta,
    tweets: input.tweets,
  };
}

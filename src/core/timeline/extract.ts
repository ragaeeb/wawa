interface TimelineInstruction {
  type?: string;
  entries?: TimelineEntry[];
  entry?: TimelineEntry;
}

interface TimelineEntry {
  entryId?: string;
  content?: {
    cursorType?: string;
    value?: string;
    itemContent?: {
      tweet_results?: {
        result?: unknown;
      };
    };
    items?: Array<{
      item?: {
        itemContent?: {
          tweet_results?: {
            result?: unknown;
          };
        };
      };
    }>;
  };
}

export interface ExtractedTimeline<T> {
  items: T[];
  nextCursor: string | null;
}

export type TweetItemType = "Tweet" | "Retweet";

export type TimelineRowBuilder<T> = (
  tweetResult: Record<string, unknown>,
  type: TweetItemType,
) => T | null;

export function normalizeTweetResult(result: unknown): Record<string, unknown> | null {
  if (!result || typeof result !== "object") return null;

  const candidate = result as {
    __typename?: string;
    tweet?: Record<string, unknown>;
  };

  if (candidate.__typename === "Tweet") return candidate as Record<string, unknown>;
  if (candidate.__typename === "TweetWithVisibilityResults") return candidate.tweet ?? null;

  return candidate as Record<string, unknown>;
}

export function getTimelineInstructions(data: unknown): TimelineInstruction[] {
  if (!data || typeof data !== "object") return [];

  const payload = data as {
    data?: {
      user?: {
        result?: {
          timeline_v2?: { timeline?: { instructions?: TimelineInstruction[] } };
          timeline?: { timeline?: { instructions?: TimelineInstruction[] } };
        };
      };
      search_by_raw_query?: {
        search_timeline?: {
          timeline?: {
            instructions?: TimelineInstruction[];
          };
        };
      };
    };
  };

  return (
    payload.data?.user?.result?.timeline_v2?.timeline?.instructions ??
    payload.data?.user?.result?.timeline?.timeline?.instructions ??
    payload.data?.search_by_raw_query?.search_timeline?.timeline?.instructions ??
    []
  );
}

export function extractTimeline<T>(
  data: unknown,
  buildRow: TimelineRowBuilder<T>,
): ExtractedTimeline<T> {
  const instructions = getTimelineInstructions(data);
  const items: T[] = [];
  let nextCursor: string | null = null;

  for (const instruction of instructions) {
    if (instruction.type !== "TimelineAddEntries" && instruction.type !== "TimelineReplaceEntry") {
      continue;
    }

    const entries = instruction.entries ?? (instruction.entry ? [instruction.entry] : []);

    for (const entry of entries) {
      const entryId = entry.entryId ?? "";
      if (entryId.startsWith("promoted-tweet-")) continue;

      if (entryId.startsWith("tweet-")) {
        const normalized = normalizeTweetResult(entry.content?.itemContent?.tweet_results?.result);
        if (!normalized) continue;

        const hasRetweet = Boolean(
          (normalized as { legacy?: { retweeted_status_result?: { result?: unknown } } }).legacy
            ?.retweeted_status_result?.result,
        );
        const type: TweetItemType = hasRetweet ? "Retweet" : "Tweet";
        const row = buildRow(normalized, type);
        if (row) items.push(row);
        continue;
      }

      if (entryId.startsWith("profile-conversation-")) {
        const conversationItems = entry.content?.items ?? [];
        for (const convoItem of conversationItems) {
          const normalized = normalizeTweetResult(
            convoItem.item?.itemContent?.tweet_results?.result,
          );
          if (!normalized) continue;
          const row = buildRow(normalized, "Tweet");
          if (row) items.push(row);
        }
        continue;
      }

      if (entryId.startsWith("cursor-bottom-") && entry.content?.cursorType === "Bottom") {
        nextCursor = entry.content.value ?? null;
      }
    }
  }

  return { items, nextCursor };
}

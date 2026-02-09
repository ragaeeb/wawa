import type { MergeInfo, TweetItem } from "../../types/domain";
import { parseTweetDate } from "./payload";

export interface MergeResult {
  tweets: TweetItem[];
  mergeInfo: MergeInfo | null;
}

function pickRicherTweet(existing: TweetItem, candidate: TweetItem): TweetItem {
  const existingSize = Object.keys(existing).length;
  const candidateSize = Object.keys(candidate).length;
  return candidateSize > existingSize ? candidate : existing;
}

function tweetKey(tweet: TweetItem, source: "new" | "previous", index: number): string {
  if (tweet.id) return `id:${tweet.id}`;
  return `${source}:${index}:${tweet.created_at ?? ""}:${tweet.text ?? ""}`;
}

export function sortTweetsByDateDesc(tweets: TweetItem[]): TweetItem[] {
  return [...tweets].sort((a, b) => {
    const dateA = parseTweetDate(a.created_at) ?? new Date(0);
    const dateB = parseTweetDate(b.created_at) ?? new Date(0);
    return dateB.getTime() - dateA.getTime();
  });
}

export function mergeTweets(newTweets: TweetItem[], previousTweets: TweetItem[]): MergeResult {
  if (previousTweets.length === 0) {
    return { tweets: sortTweetsByDateDesc(newTweets), mergeInfo: null };
  }

  const merged = new Map<string, TweetItem>();
  let duplicates = 0;

  newTweets.forEach((tweet, index) => {
    merged.set(tweetKey(tweet, "new", index), tweet);
  });

  previousTweets.forEach((tweet, index) => {
    const key = tweetKey(tweet, "previous", index);
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, tweet);
      return;
    }

    duplicates += 1;
    merged.set(key, pickRicherTweet(existing, tweet));
  });

  const tweets = sortTweetsByDateDesc(Array.from(merged.values()));
  const mergeInfo: MergeInfo = {
    previous_count: previousTweets.length,
    new_count: newTweets.length,
    duplicates_removed: duplicates,
    final_count: tweets.length,
  };

  return { tweets, mergeInfo };
}

import { createInitialLifecycle, type ExportLifecycleSnapshot } from '@/core/rate-limit/state';
import type { TweetItem } from '@/types/domain';

export type InterceptedResponsePayload = Record<string, unknown>;
export type AutoStartContext = Record<string, unknown>;
export type CollectedTweet = TweetItem;

export type RuntimeWindow = Window &
    typeof globalThis & {
        wawaSkipCooldown?: boolean;
        wawaStop?: () => void;
    };

export type RuntimeState = {
    /**
     * Compact export buffer: retain only unique collected tweets plus a raw response count.
     * Raw intercepted GraphQL payloads are parsed immediately and then discarded.
     */
    collectedTweets: CollectedTweet[];
    seenCollectedTweetIds: Set<string>;
    capturedResponsesCount: number;
    isRateLimited: boolean;
    isPendingDone: boolean;
    isExporting: boolean;
    currentExportUserId: string | null;
    abortController: AbortController | null;
    pendingAutoStartContext: AutoStartContext | null;
    timelineActivityAt: number;
    lifecycle: ExportLifecycleSnapshot;
    isXGrokExporting: boolean;
    isXGrokBulkExporting: boolean;
};

export const createRuntimeState = (): RuntimeState => {
    const now = Date.now();

    return {
        collectedTweets: [],
        seenCollectedTweetIds: new Set(),
        capturedResponsesCount: 0,
        isRateLimited: false,
        isPendingDone: false,
        isExporting: false,
        currentExportUserId: null,
        abortController: null,
        pendingAutoStartContext: null,
        timelineActivityAt: now,
        lifecycle: createInitialLifecycle(now),
        isXGrokExporting: false,
        isXGrokBulkExporting: false,
    };
};

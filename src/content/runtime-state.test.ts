import { describe, expect, it } from 'bun:test';
import { createRuntimeState } from '@/content/runtime-state';

describe('createRuntimeState', () => {
    it('should create the default runtime state snapshot', () => {
        const state = createRuntimeState();

        expect(state.collectedTweets).toEqual([]);
        expect(Array.from(state.seenCollectedTweetIds)).toEqual([]);
        expect(state.capturedResponsesCount).toBe(0);
        expect(state.isRateLimited).toBe(false);
        expect(state.isPendingDone).toBe(false);
        expect(state.isExporting).toBe(false);
        expect(state.currentExportUserId).toBeNull();
        expect(state.abortController).toBeNull();
        expect(state.pendingAutoStartContext).toBeNull();
        expect(state.lifecycle.status).toBe('idle');
        expect(state.isXGrokExporting).toBe(false);
        expect(state.isXGrokBulkExporting).toBe(false);
        expect(Math.abs(Date.now() - state.timelineActivityAt)).toBeLessThan(1000);
    });

    it('should create isolated state objects for each runtime instance', () => {
        const first = createRuntimeState();
        const second = createRuntimeState();

        first.collectedTweets.push({ id: '1' });
        first.seenCollectedTweetIds.add('1');
        first.capturedResponsesCount = 1;
        first.isExporting = true;

        expect(second.collectedTweets).toEqual([]);
        expect(Array.from(second.seenCollectedTweetIds)).toEqual([]);
        expect(second.capturedResponsesCount).toBe(0);
        expect(second.isExporting).toBe(false);
    });
});

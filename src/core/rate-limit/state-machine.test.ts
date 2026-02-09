import { describe, expect, it } from 'bun:test';
import { createInitialLifecycle, reduceExportLifecycle, shouldPromptLooksDone } from './state';

describe('rate limit lifecycle state machine', () => {
    it('should transition cooldown -> running and reset activity timestamp', () => {
        let state = createInitialLifecycle(1000);
        state = reduceExportLifecycle(state, { type: 'start', at: 1100 });
        state = reduceExportLifecycle(state, { type: 'enter_cooldown', at: 1200 });

        expect(state.status).toBe('cooldown');

        state = reduceExportLifecycle(state, { type: 'exit_cooldown', at: 5000 });
        expect(state.status).toBe('running');
        expect(state.lastActivityAt).toBe(5000);
    });

    it('should transition paused_rate_limit -> running on manual resume', () => {
        let state = createInitialLifecycle(1000);
        state = reduceExportLifecycle(state, { type: 'start', at: 1100 });
        state = reduceExportLifecycle(state, { type: 'pause_rate_limit', at: 2000 });

        expect(state.status).toBe('paused_rate_limit');

        state = reduceExportLifecycle(state, { type: 'resume_manual', at: 9000 });
        expect(state.status).toBe('running');
        expect(state.lastActivityAt).toBe(9000);
    });

    it('should not mark looks-done immediately after cooldown/manual resume', () => {
        let state = createInitialLifecycle(1000);
        state = reduceExportLifecycle(state, { type: 'start', at: 1000 });
        state = reduceExportLifecycle(state, { type: 'enter_cooldown', at: 2000 });
        state = reduceExportLifecycle(state, { type: 'exit_cooldown', at: 10000 });

        const shouldPrompt = shouldPromptLooksDone(state, {
            now: 10010,
            idleThresholdMs: 30000,
            scrollCount: 100,
            responsesCaptured: 40,
            heightStable: true,
        });

        expect(shouldPrompt).toBe(false);
    });

    it('should update activity timestamp while running', () => {
        let state = createInitialLifecycle(1000);
        state = reduceExportLifecycle(state, { type: 'start', at: 1000 });
        state = reduceExportLifecycle(state, { type: 'activity', at: 4000 });

        expect(state.status).toBe('running');
        expect(state.lastActivityAt).toBe(4000);
    });

    it('should not prompt looks-done when lifecycle is not running', () => {
        let state = createInitialLifecycle(1000);
        state = reduceExportLifecycle(state, { type: 'start', at: 1000 });
        state = reduceExportLifecycle(state, { type: 'pause_rate_limit', at: 3000 });

        const shouldPrompt = shouldPromptLooksDone(state, {
            now: 100000,
            idleThresholdMs: 30000,
            scrollCount: 999,
            responsesCaptured: 999,
            heightStable: true,
        });

        expect(shouldPrompt).toBe(false);
    });

    it('should complete lifecycle through pending_done and complete transitions', () => {
        let state = createInitialLifecycle(1000);
        state = reduceExportLifecycle(state, { type: 'start', at: 1100 });
        state = reduceExportLifecycle(state, { type: 'mark_pending_done' });
        expect(state.status).toBe('pending_done');

        state = reduceExportLifecycle(state, { type: 'complete' });
        expect(state.status).toBe('completed');
    });

    it('should transition to cancelled on cancel action', () => {
        let state = createInitialLifecycle(1000);
        state = reduceExportLifecycle(state, { type: 'start', at: 1100 });
        state = reduceExportLifecycle(state, { type: 'cancel' });
        expect(state.status).toBe('cancelled');
    });

    it('should not prompt looks-done when no responses were captured', () => {
        const state = reduceExportLifecycle(createInitialLifecycle(1000), { type: 'start', at: 1000 });
        const shouldPrompt = shouldPromptLooksDone(state, {
            now: 200000,
            idleThresholdMs: 1000,
            scrollCount: 50,
            responsesCaptured: 0,
            heightStable: true,
        });
        expect(shouldPrompt).toBe(false);
    });

    it('should not prompt looks-done when scroll count is too low', () => {
        const state = reduceExportLifecycle(createInitialLifecycle(1000), { type: 'start', at: 1000 });
        const shouldPrompt = shouldPromptLooksDone(state, {
            now: 200000,
            idleThresholdMs: 1000,
            scrollCount: 10,
            responsesCaptured: 20,
            heightStable: true,
        });
        expect(shouldPrompt).toBe(false);
    });

    it('should not prompt looks-done when height is not stable', () => {
        const state = reduceExportLifecycle(createInitialLifecycle(1000), { type: 'start', at: 1000 });
        const shouldPrompt = shouldPromptLooksDone(state, {
            now: 200000,
            idleThresholdMs: 1000,
            scrollCount: 50,
            responsesCaptured: 20,
            heightStable: false,
        });
        expect(shouldPrompt).toBe(false);
    });
});

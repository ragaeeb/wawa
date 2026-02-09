import { describe, expect, it } from 'bun:test';
import type { RateLimitState } from '@/content/rate-limit-controller';
import {
    applyRateLimitInfo,
    createRateLimitState,
    getCooldownDetails,
    resetRateLimitStateForRun,
} from '@/content/rate-limit-controller';

describe('createRateLimitState', () => {
    it('should create initial rate limit state with default values', () => {
        const state = createRateLimitState();

        expect(state.mode as RateLimitState['mode']).toBe('normal');
        expect(state.requestCount).toBe(0);
        expect(state.limit).toBe(150);
        expect(state.remaining).toBe(150);
        expect(state.resetTime).toBe(0);
        expect(state.lastRequestTime).toBe(0);
        expect(state.retryCount).toBe(0);
        expect(state.dynamicDelay).toBe(2500);
    });

    it('should create a new state object each time', () => {
        const state1 = createRateLimitState();
        const state2 = createRateLimitState();

        expect(state1).not.toBe(state2);
    });
});

describe('applyRateLimitInfo', () => {
    it('should return no triggers when rateLimitInfo is null', () => {
        const state = createRateLimitState();
        const result = applyRateLimitInfo(state, null);

        expect(result.triggeredBatchCooldown).toBe(false);
        expect(result.triggeredLowRemainingCooldown).toBe(false);
    });

    it('should update limit, remaining, and resetTime from rateLimitInfo', () => {
        const state = createRateLimitState();
        applyRateLimitInfo(state, {
            limit: 100,
            remaining: 50,
            reset: 1234567890,
        });

        expect(state.limit).toBe(100);
        expect(state.remaining).toBe(50);
        expect(state.resetTime).toBe(1234567890);
    });

    it('should increment request count', () => {
        const state = createRateLimitState();

        applyRateLimitInfo(state, {});
        expect(state.requestCount).toBe(1);

        applyRateLimitInfo(state, {});
        expect(state.requestCount).toBe(2);
    });

    it('should update lastRequestTime', () => {
        const state = createRateLimitState();
        const before = Date.now();

        applyRateLimitInfo(state, {});

        expect(state.lastRequestTime).toBeGreaterThanOrEqual(before);
        expect(state.lastRequestTime).toBeLessThanOrEqual(Date.now());
    });

    it('should trigger batch cooldown at 20 request intervals', () => {
        const state = createRateLimitState();

        for (let i = 1; i < 20; i++) {
            const result = applyRateLimitInfo(state, {});
            expect(result.triggeredBatchCooldown).toBe(false);
        }

        const result = applyRateLimitInfo(state, {});
        expect(result.triggeredBatchCooldown).toBe(true);
    });

    it('should trigger batch cooldown at request 40, 60, etc', () => {
        const state = createRateLimitState();
        state.requestCount = 39;

        const result40 = applyRateLimitInfo(state, {});
        expect(result40.triggeredBatchCooldown).toBe(true);

        state.requestCount = 59;
        const result60 = applyRateLimitInfo(state, {});
        expect(result60.triggeredBatchCooldown).toBe(true);
    });

    it('should trigger low remaining cooldown when remaining < 10', () => {
        const state = createRateLimitState();

        const result = applyRateLimitInfo(state, { remaining: 9 });
        expect(result.triggeredLowRemainingCooldown).toBe(true);
    });

    it('should not trigger low remaining cooldown when remaining >= 10', () => {
        const state = createRateLimitState();

        const result = applyRateLimitInfo(state, { remaining: 10 });
        expect(result.triggeredLowRemainingCooldown).toBe(false);
    });

    it('should set dynamic delay based on remaining count', () => {
        const state = createRateLimitState();

        applyRateLimitInfo(state, { remaining: 50 });
        expect(state.dynamicDelay).toBe(3000);

        applyRateLimitInfo(state, { remaining: 15 });
        expect(state.dynamicDelay).toBe(5000);

        applyRateLimitInfo(state, { remaining: 5 });
        expect(state.dynamicDelay).toBe(8000);
    });

    it('should handle undefined values in rateLimitInfo', () => {
        const state = createRateLimitState();
        state.limit = 100;
        state.remaining = 50;
        state.resetTime = 12345;

        applyRateLimitInfo(state, {
            limit: undefined,
            remaining: undefined,
            reset: undefined,
        });

        expect(state.limit).toBe(100);
        expect(state.remaining).toBe(50);
        expect(state.resetTime).toBe(12345);
    });

    it('should handle null values in rateLimitInfo', () => {
        const state = createRateLimitState();
        state.limit = 100;
        state.remaining = 50;
        state.resetTime = 12345;

        applyRateLimitInfo(state, {
            limit: null,
            remaining: null,
            reset: null,
        });

        expect(state.limit).toBe(100);
        expect(state.remaining).toBe(50);
        expect(state.resetTime).toBe(12345);
    });

    it('should handle string numbers in rateLimitInfo', () => {
        const state = createRateLimitState();

        applyRateLimitInfo(state, {
            limit: '200',
            remaining: '100',
            reset: '9999999',
        });

        expect(state.limit).toBe(200);
        expect(state.remaining).toBe(100);
        expect(state.resetTime).toBe(9999999);
    });

    it('should ignore invalid number values', () => {
        const state = createRateLimitState();
        state.limit = 100;

        applyRateLimitInfo(state, {
            limit: 'invalid',
        });

        expect(state.limit).toBe(100);
    });

    it('should handle both triggers simultaneously', () => {
        const state = createRateLimitState();
        state.requestCount = 19;

        const result = applyRateLimitInfo(state, { remaining: 5 });

        expect(result.triggeredBatchCooldown).toBe(true);
        expect(result.triggeredLowRemainingCooldown).toBe(true);
    });
});

describe('getCooldownDetails', () => {
    it('should return default cooldown for batch pacing', () => {
        const state = createRateLimitState();
        state.requestCount = 20;

        const result = getCooldownDetails(state);

        expect(result.cooldownTime).toBe(180000);
        expect(result.reason).toContain('batch pacing');
        expect(result.reason).toContain('20 requests');
    });

    it('should calculate cooldown based on reset time when remaining < 10', () => {
        const state = createRateLimitState();
        const futureReset = Date.now() / 1000 + 300; // 300 seconds from now
        state.remaining = 5;
        state.resetTime = futureReset;

        const result = getCooldownDetails(state);

        expect(result.cooldownTime).toBeGreaterThan(300000); // 300s + 10s buffer
        expect(result.cooldownTime).toBeLessThan(320000); // with some tolerance
        expect(result.reason).toContain('API limit low');
        expect(result.reason).toContain('5 left');
    });

    it('should use default cooldown when reset time is in the past', () => {
        const state = createRateLimitState();
        const pastReset = Date.now() / 1000 - 100;
        state.remaining = 5;
        state.resetTime = pastReset;
        state.requestCount = 20;

        const result = getCooldownDetails(state);

        expect(result.cooldownTime).toBe(180000);
        expect(result.reason).toContain('batch pacing');
    });

    it('should use default cooldown when resetTime is 0', () => {
        const state = createRateLimitState();
        state.remaining = 5;
        state.resetTime = 0;
        state.requestCount = 40;

        const result = getCooldownDetails(state);

        expect(result.cooldownTime).toBe(180000);
        expect(result.reason).toContain('batch pacing');
        expect(result.reason).toContain('40 requests');
    });

    it('should format reset time in reason message', () => {
        const state = createRateLimitState();
        const futureReset = Date.now() / 1000 + 100;
        state.remaining = 3;
        state.resetTime = futureReset;

        const result = getCooldownDetails(state);

        expect(result.reason).toContain('reset at');
        expect(result.reason).toContain('3 left');
    });
});

describe('resetRateLimitStateForRun', () => {
    it('should reset all counters for new run', () => {
        const state = createRateLimitState();
        state.mode = 'cooldown';
        state.requestCount = 100;
        state.retryCount = 5;
        state.remaining = 10;
        state.dynamicDelay = 8000;

        resetRateLimitStateForRun(state);

        expect(state.mode as RateLimitState['mode']).toBe('normal');
        expect(state.requestCount).toBe(0);
        expect(state.retryCount).toBe(0);
        expect(state.remaining).toBe(150);
        expect(state.dynamicDelay).toBe(3000);
    });

    it('should not reset limit and resetTime', () => {
        const state = createRateLimitState();
        state.limit = 200;
        state.resetTime = 12345;

        resetRateLimitStateForRun(state);

        expect(state.limit).toBe(200);
        expect(state.resetTime).toBe(12345);
    });

    it('should not reset lastRequestTime', () => {
        const state = createRateLimitState();
        state.lastRequestTime = 99999;

        resetRateLimitStateForRun(state);

        expect(state.lastRequestTime).toBe(99999);
    });
});

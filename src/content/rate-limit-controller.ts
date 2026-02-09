type AnyRecord = Record<string, any>;

export type RateLimitState = {
    mode: 'normal' | 'cooldown' | 'paused';
    requestCount: number;
    limit: number;
    remaining: number;
    resetTime: number;
    lastRequestTime: number;
    retryCount: number;
    dynamicDelay: number;
};

export type RateLimitUpdateResult = {
    triggeredBatchCooldown: boolean;
    triggeredLowRemainingCooldown: boolean;
};

const parseOptionalNumber = (value: unknown) => {
    if (value === undefined || value === null) {
        return null;
    }

    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) ? parsed : null;
};

const calculateDynamicDelay = (remaining: number) => {
    if (remaining < 10) {
        return 8000;
    }
    if (remaining < 20) {
        return 5000;
    }
    return 3000;
};

/**
 * Creates mutable runtime rate-limit counters used by scroll pacing logic.
 */
export const createRateLimitState = () => ({
    mode: 'normal',
    requestCount: 0,
    limit: 150,
    remaining: 150,
    resetTime: 0,
    lastRequestTime: 0,
    retryCount: 0,
    dynamicDelay: 2500,
});

/**
 * Applies latest rate-limit headers and returns cooldown triggers.
 */
export const applyRateLimitInfo = (state: RateLimitState, rateLimitInfo: AnyRecord | null) => {
    if (!rateLimitInfo) {
        return {
            triggeredBatchCooldown: false,
            triggeredLowRemainingCooldown: false,
        };
    }

    const limit = parseOptionalNumber(rateLimitInfo.limit);
    const remaining = parseOptionalNumber(rateLimitInfo.remaining);
    const resetTime = parseOptionalNumber(rateLimitInfo.reset);

    if (limit !== null) {
        state.limit = limit;
    }
    if (remaining !== null) {
        state.remaining = remaining;
    }
    if (resetTime !== null) {
        state.resetTime = resetTime;
    }

    state.requestCount += 1;
    state.lastRequestTime = Date.now();
    state.dynamicDelay = calculateDynamicDelay(state.remaining);

    return {
        triggeredBatchCooldown: state.requestCount > 0 && state.requestCount % 20 === 0,
        triggeredLowRemainingCooldown: state.remaining < 10,
    };
};

/**
 * Resolves cooldown duration/reason from current state and server reset window.
 */
export const getCooldownDetails = (state: RateLimitState) => {
    let cooldownTime = 180000;
    let reason = `batch pacing (${state.requestCount} requests)`;

    if (state.remaining < 10 && state.resetTime > 0) {
        const waitSeconds = state.resetTime - Date.now() / 1000;
        if (waitSeconds > 0) {
            cooldownTime = waitSeconds * 1000 + 10000;
            reason = `API limit low (${state.remaining} left), reset at ${new Date(state.resetTime * 1000).toLocaleTimeString()}`;
        }
    }

    return { cooldownTime, reason };
};

/**
 * Resets mutable counters for a brand-new export run.
 */
export const resetRateLimitStateForRun = (state: RateLimitState) => {
    state.mode = 'normal';
    state.requestCount = 0;
    state.retryCount = 0;
    state.remaining = 150;
    state.dynamicDelay = 3000;
};

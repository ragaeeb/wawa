import { applyRateLimitInfo, type RateLimitState } from '@/content/rate-limit-controller';
import type { InterceptedResponsePayload } from '@/content/runtime-state';
import type { ExportLifecycleAction, ExportLifecycleSnapshot } from '@/core/rate-limit/state';

type AnyRecord = Record<string, any>;

type CreateRateLimitHandlersInput = {
    rateLimitState: RateLimitState;
    getIsExporting: () => boolean;
    getIsRateLimited: () => boolean;
    setIsRateLimited: (value: boolean) => void;
    getLifecycle: () => ExportLifecycleSnapshot;
    setLifecycle: (value: ExportLifecycleSnapshot) => void;
    reduceLifecycle: (state: ExportLifecycleSnapshot, action: ExportLifecycleAction) => ExportLifecycleSnapshot;
    markTimelineActivity: () => void;
    addInterceptedResponse: (payload: InterceptedResponsePayload) => void;
    getInterceptedResponseCount: () => number;
    onRateLimitUiRequired: () => void;
    logInfo: (message: string, data?: unknown) => void;
    logDebug: (message: string, data?: unknown) => void;
    logWarn: (message: string, data?: unknown) => void;
    logError: (message: string, data?: unknown) => void;
};

export type RateLimitHandlers = {
    applyRateLimitUpdate: (rateLimitInfo: AnyRecord | null | undefined) => void;
    handleRateLimitMessage: (payload: AnyRecord | null | undefined) => void;
    handleAuthErrorMessage: () => void;
    handleInterceptedResponseMessage: (payload: InterceptedResponsePayload) => void;
};

export const createRateLimitHandlers = (input: CreateRateLimitHandlersInput) => {
    const asAnyRecord = (value: unknown): AnyRecord | null =>
        value && typeof value === 'object' ? (value as AnyRecord) : null;

    const applyRateLimitUpdate = (rateLimitInfo: AnyRecord | null | undefined) => {
        const result = applyRateLimitInfo(input.rateLimitState, rateLimitInfo ?? null);

        if (!rateLimitInfo) {
            return;
        }

        input.logDebug(
            `Rate limit update: ${input.rateLimitState.remaining}/${input.rateLimitState.limit} remaining, delay: ${Math.round(input.rateLimitState.dynamicDelay)}ms`,
        );

        if (result.triggeredBatchCooldown) {
            input.rateLimitState.mode = 'cooldown';
            input.setLifecycle(input.reduceLifecycle(input.getLifecycle(), { type: 'enter_cooldown' }));
            input.logInfo(`Entering cooldown mode after ${input.rateLimitState.requestCount} requests`);
        }

        if (result.triggeredLowRemainingCooldown) {
            input.rateLimitState.mode = 'cooldown';
            input.setLifecycle(input.reduceLifecycle(input.getLifecycle(), { type: 'enter_cooldown' }));
            input.logWarn(`Low remaining requests (${input.rateLimitState.remaining}), entering cooldown`);
        }
    };

    const handleRateLimitMessage = (payload: AnyRecord | null | undefined) => {
        if (input.getIsRateLimited() || !input.getIsExporting()) {
            return;
        }

        input.setIsRateLimited(true);
        input.rateLimitState.mode = 'paused';
        input.rateLimitState.retryCount += 1;
        input.setLifecycle(input.reduceLifecycle(input.getLifecycle(), { type: 'pause_rate_limit' }));

        applyRateLimitUpdate(payload?.rateLimitInfo);

        input.logWarn(`Rate limit hit! Retry #${input.rateLimitState.retryCount}`);
        input.onRateLimitUiRequired();
    };

    const handleAuthErrorMessage = () => {
        input.logError('Authentication error - session may have expired');
        input.setIsRateLimited(true);
        input.rateLimitState.mode = 'paused';
        input.setLifecycle(input.reduceLifecycle(input.getLifecycle(), { type: 'pause_rate_limit' }));
        input.onRateLimitUiRequired();
    };

    const handleInterceptedResponseMessage = (payload: InterceptedResponsePayload) => {
        input.addInterceptedResponse(payload);
        input.markTimelineActivity();

        applyRateLimitUpdate(asAnyRecord(payload.rateLimitInfo));

        if (input.getIsRateLimited() && input.rateLimitState.mode !== 'paused') {
            input.setIsRateLimited(false);
            input.rateLimitState.retryCount = 0;
        }

        input.logInfo(`Received response #${input.getInterceptedResponseCount()}`, {
            remaining: input.rateLimitState.remaining,
            delay: `${Math.round(input.rateLimitState.dynamicDelay)}ms`,
        });
    };

    return {
        applyRateLimitUpdate,
        handleRateLimitMessage,
        handleAuthErrorMessage,
        handleInterceptedResponseMessage,
    };
};

import type { RateLimitState } from '@/content/rate-limit-controller';
import { renderRateLimitPanel } from '@/content/runtime-ui';

type ShowRateLimitPanelInput = {
    container: HTMLDivElement | null;
    rateLimitState: RateLimitState;
    batchesCollected: number;
    onTryNow: () => void;
    onSaveProgress: () => void;
    onResumeLink: () => void;
    onCancel: () => void;
    logInfo: (message: string, data?: unknown) => void;
};

export const showRateLimitPanel = (input: ShowRateLimitPanelInput) => {
    if (!input.container) {
        return;
    }

    if (document.getElementById('wawa-rl-controls')) {
        return;
    }

    input.logInfo('Showing rate limit UI...');

    const resetTimeLabel = input.rateLimitState.resetTime
        ? new Date(input.rateLimitState.resetTime * 1000).toLocaleTimeString()
        : 'unknown';

    renderRateLimitPanel({
        container: input.container,
        retryCount: input.rateLimitState.retryCount,
        remaining: input.rateLimitState.remaining,
        limit: input.rateLimitState.limit,
        batchesCollected: input.batchesCollected,
        resetTimeLabel,
        onTryNow: input.onTryNow,
        onSaveProgress: input.onSaveProgress,
        onResumeLink: input.onResumeLink,
        onCancel: input.onCancel,
    });
};

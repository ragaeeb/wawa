import { showLooksDonePanel, showRouteChangePanel } from '@/content/pending-panels';
import type { RateLimitState } from '@/content/rate-limit-controller';
import { showRateLimitPanel } from '@/content/rate-limit-panel-controller';

type CreateRuntimePanelsInput = {
    getContainer: () => HTMLDivElement | null;
    rateLimitState: RateLimitState;
    getBatchesCollected: () => number;
    onDownloadConfirmed: () => void;
    onContinueScrolling: () => void;
    onRouteGoBack: () => void;
    onTryNow: () => void;
    onSaveProgress: () => void;
    onResumeLink: () => void;
    onCancel: () => void;
    logInfo: (message: string, data?: unknown) => void;
    logWarn: (message: string, data?: unknown) => void;
};

export const createRuntimePanels = (input: CreateRuntimePanelsInput) => {
    const showLooksDone = (batchCount: number) => {
        showLooksDonePanel({
            container: input.getContainer(),
            batchCount,
            onDownload: input.onDownloadConfirmed,
            onContinue: input.onContinueScrolling,
            onResumeLink: input.onResumeLink,
            onCancel: input.onCancel,
            logInfo: input.logInfo,
        });
    };

    const showRouteChange = (batchCount: number) => {
        showRouteChangePanel({
            container: input.getContainer(),
            batchCount,
            onGoBack: input.onRouteGoBack,
            onSaveProgress: input.onSaveProgress,
            onResumeLink: input.onResumeLink,
            onCancel: input.onCancel,
            logWarn: input.logWarn,
        });
    };

    const showRateLimit = () => {
        showRateLimitPanel({
            container: input.getContainer(),
            rateLimitState: input.rateLimitState,
            batchesCollected: input.getBatchesCollected(),
            onTryNow: input.onTryNow,
            onSaveProgress: input.onSaveProgress,
            onResumeLink: input.onResumeLink,
            onCancel: input.onCancel,
            logInfo: input.logInfo,
        });
    };

    return {
        showLooksDone,
        showRouteChange,
        showRateLimit,
    };
};

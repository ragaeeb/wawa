import { createInitialLifecycle, type ExportLifecycleSnapshot } from '@/core/rate-limit/state';

export type InterceptedResponsePayload = Record<string, any>;
export type AutoStartContext = Record<string, unknown>;

export type RuntimeWindow = Window &
    typeof globalThis & {
        wawaSkipCooldown?: boolean;
        wawaStop?: () => void;
    };

export type RuntimeState = {
    interceptedResponses: InterceptedResponsePayload[];
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
        interceptedResponses: [],
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

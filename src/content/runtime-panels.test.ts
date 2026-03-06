import { describe, expect, it, mock, spyOn } from 'bun:test';
import * as pendingPanels from '@/content/pending-panels';
import { createRateLimitState } from '@/content/rate-limit-controller';
import * as rateLimitPanelController from '@/content/rate-limit-panel-controller';
import { createRuntimePanels } from '@/content/runtime-panels';

describe('createRuntimePanels', () => {
    const createInput = () => {
        const rateLimitState = createRateLimitState();

        return {
            getContainer: () => document.createElement('div'),
            rateLimitState,
            getBatchesCollected: () => 42,
            onDownloadConfirmed: mock(() => {}),
            onContinueScrolling: mock(() => {}),
            onRouteGoBack: mock(() => {}),
            onTryNow: mock(() => {}),
            onSaveProgress: mock(() => {}),
            onResumeLink: mock(() => {}),
            onCancel: mock(() => {}),
            logInfo: mock(() => {}),
            logWarn: mock(() => {}),
        };
    };

    it('should delegate looks-done rendering to the pending panel helper', () => {
        const input = createInput();
        const showLooksDonePanel = spyOn(pendingPanels, 'showLooksDonePanel').mockImplementation(() => {});
        const panels = createRuntimePanels(input);

        panels.showLooksDone(12);

        expect(showLooksDonePanel).toHaveBeenCalledWith({
            container: expect.any(HTMLDivElement),
            batchCount: 12,
            onDownload: input.onDownloadConfirmed,
            onContinue: input.onContinueScrolling,
            onResumeLink: input.onResumeLink,
            onCancel: input.onCancel,
            logInfo: input.logInfo,
        });
    });

    it('should delegate route-change rendering to the pending panel helper', () => {
        const input = createInput();
        const showRouteChangePanel = spyOn(pendingPanels, 'showRouteChangePanel').mockImplementation(() => {});
        const panels = createRuntimePanels(input);

        panels.showRouteChange(5);

        expect(showRouteChangePanel).toHaveBeenCalledWith({
            container: expect.any(HTMLDivElement),
            batchCount: 5,
            onGoBack: input.onRouteGoBack,
            onSaveProgress: input.onSaveProgress,
            onResumeLink: input.onResumeLink,
            onCancel: input.onCancel,
            logWarn: input.logWarn,
        });
    });

    it('should delegate rate-limit rendering to the rate-limit panel helper', () => {
        const input = createInput();
        const showRateLimitPanel = spyOn(rateLimitPanelController, 'showRateLimitPanel').mockImplementation(() => {});
        const panels = createRuntimePanels(input);

        panels.showRateLimit();

        expect(showRateLimitPanel).toHaveBeenCalledWith({
            container: expect.any(HTMLDivElement),
            rateLimitState: input.rateLimitState,
            batchesCollected: 42,
            onTryNow: input.onTryNow,
            onSaveProgress: input.onSaveProgress,
            onResumeLink: input.onResumeLink,
            onCancel: input.onCancel,
            logInfo: input.logInfo,
        });
    });
});

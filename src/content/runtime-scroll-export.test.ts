import { describe, expect, it, mock } from 'bun:test';
import { createRateLimitState } from '@/content/rate-limit-controller';
import { createResumeSessionState } from '@/content/resume-session';
import { createRuntimeScrollExport } from '@/content/runtime-scroll-export';
import { createRuntimeState, type RuntimeWindow } from '@/content/runtime-state';
import type { ResumeStorage } from '@/core/resume/storage';

type ScrollExportInput = Parameters<typeof createRuntimeScrollExport>[0];
type ScrollExportImplementations = Required<NonNullable<ScrollExportInput['implementations']>>;

const createResumeStorage = (): ResumeStorage => ({
    persist: mock(async () => true),
    restore: mock(async () => null),
    clear: mock(async () => {}),
});

const createInput = (): ScrollExportInput & { implementations: ScrollExportImplementations } => {
    const state = createRuntimeState();
    const resumeSession = createResumeSessionState();
    const resumeStorage = createResumeStorage();
    const rateLimitState = createRateLimitState();
    const container = document.createElement('div');

    const buttonUi = {
        getContainer: () => container,
        updateButton: mock(() => {}),
        resetButton: mock(() => {}),
        showCooldownUI: mock(() => {}),
        updateCooldownTimer: mock(() => {}),
        removeCooldownUI: mock(() => {}),
    };

    const loggers = {
        logInfo: mock(() => {}),
        logDebug: mock(() => {}),
        logWarn: mock(() => {}),
        logError: mock(() => {}),
    };

    const implementations: ScrollExportImplementations = {
        redirectProfileExportToSearch: mock(
            async () => {},
        ) as ScrollExportImplementations['redirectProfileExportToSearch'],
        ensureResumeStateForSearch: mock(async () => true) as ScrollExportImplementations['ensureResumeStateForSearch'],
        startResumeFromFile: mock(() => {}) as ScrollExportImplementations['startResumeFromFile'],
        runScrollToLoadMore: mock(async () => 0) as ScrollExportImplementations['runScrollToLoadMore'],
        runScrollExportSession: mock(async () => {}) as ScrollExportImplementations['runScrollExportSession'],
        resolveUserForExport: mock(async () => ({
            id: 'user-1',
            legacy: { statuses_count: 10 },
        })) as ScrollExportImplementations['resolveUserForExport'],
    };

    return {
        state,
        runtimeWindow: window as RuntimeWindow,
        resumeSession,
        resumeStorage,
        rateLimitState,
        buttonUi,
        getCsrfToken: () => 'csrf-token',
        getUserByScreenName: mock(async () => ({ id: 'user-1', legacy: { statuses_count: 10 } })),
        getUsernameFromUrl: mock(() => 'tester'),
        extractTweetsFromInterceptedResponses: mock(() => []),
        startFetchInterception: mock(async () => {}),
        stopFetchInterception: mock(() => {}),
        saveAutoStartContext: mock(async () => {}),
        downloadFile: mock(() => {}),
        sleep: mock(async () => {}),
        getLocationPathname: mock(() => '/search'),
        getLocationSearch: mock(() => '?q=from%3Atester'),
        navigateTo: mock(() => {}),
        alertUser: mock(() => {}),
        writeToClipboard: mock(async () => {}),
        goBack: mock(() => {}),
        resetRateLimitStateForRun: mock(() => {}),
        getRateLimitCooldownDetails: mock(() => ({ cooldownTime: 1000, reason: 'batch' })),
        implementations,
        loggers,
    };
};

describe('createRuntimeScrollExport', () => {
    it('should cancel an active export and stop interception', () => {
        const input = createInput();
        const runtime = createRuntimeScrollExport(input);

        input.state.isExporting = true;
        input.state.isRateLimited = true;
        const abortController = new AbortController();
        input.state.abortController = abortController;

        runtime.handleCancelExport();

        expect(abortController.signal.aborted).toBeTrue();
        expect(input.state.isExporting).toBe(false);
        expect(input.state.isRateLimited).toBe(false);
        expect(input.state.lifecycle.status).toBe('cancelled');
        expect(input.stopFetchInterception).toHaveBeenCalled();
        expect(input.buttonUi.updateButton).toHaveBeenCalledWith('❌ Cancelled');
    });

    it('should ignore intercepted responses when no export is running', () => {
        const input = createInput();
        const runtime = createRuntimeScrollExport(input);

        runtime.handleInterceptedResponseMessage({ data: { ok: true } });

        expect(input.state.collectedTweets).toEqual([]);
        expect(input.state.capturedResponsesCount).toBe(0);
    });

    it('should show an error when no username can be resolved', async () => {
        const input = createInput();
        input.getUsernameFromUrl = (() => null) as typeof input.getUsernameFromUrl;
        const runtime = createRuntimeScrollExport(input);

        await runtime.handleScrollExport();

        expect(input.buttonUi.updateButton).toHaveBeenCalledWith('❌ Navigate to a profile', true);
        expect(input.implementations.redirectProfileExportToSearch).not.toHaveBeenCalled();
        expect(input.implementations.runScrollExportSession).not.toHaveBeenCalled();
        expect(input.state.isExporting).toBe(false);
    });

    it('should redirect profile exports to search view before running', async () => {
        const input = createInput();
        input.getLocationPathname = mock(() => '/tester');
        const runtime = createRuntimeScrollExport(input);

        await runtime.handleScrollExport();

        expect(input.implementations.redirectProfileExportToSearch).toHaveBeenCalledWith(
            expect.objectContaining({
                username: 'tester',
                getCsrfToken: input.getCsrfToken,
                getUserByScreenName: input.getUserByScreenName,
                updateButton: input.buttonUi.updateButton,
            }),
        );
        expect(input.implementations.ensureResumeStateForSearch).not.toHaveBeenCalled();
    });

    it('should stop before resolving the user when resume state is unavailable', async () => {
        const input = createInput();
        input.implementations.ensureResumeStateForSearch = mock(
            async () => false,
        ) as ScrollExportImplementations['ensureResumeStateForSearch'];
        const runtime = createRuntimeScrollExport(input);

        await runtime.handleScrollExport();

        expect(input.implementations.ensureResumeStateForSearch).toHaveBeenCalled();
        expect(input.implementations.resolveUserForExport).not.toHaveBeenCalled();
        expect(input.state.isExporting).toBe(false);
    });

    it('should run a scroll export session and finalize runtime state', async () => {
        const input = createInput();
        input.implementations.runScrollExportSession = mock(
            async (sessionInput: Parameters<ScrollExportImplementations['runScrollExportSession']>[0]) => {
                sessionInput.setCurrentExportUserId('user-1');
                sessionInput.finalizeRuntimeState();
            },
        ) as ScrollExportImplementations['runScrollExportSession'];
        const runtime = createRuntimeScrollExport(input);

        await runtime.handleScrollExport();

        expect(input.implementations.runScrollExportSession).toHaveBeenCalledWith(
            expect.objectContaining({
                username: 'tester',
                userId: 'user-1',
                pathname: '/search',
            }),
        );
        expect(input.state.currentExportUserId).toBe('user-1');
        expect(input.state.isExporting).toBe(false);
        expect(input.state.abortController).toBeNull();
    });

    it('should clear collected state on cancellation', () => {
        const input = createInput();
        const runtime = createRuntimeScrollExport(input);

        input.state.isExporting = true;
        input.state.currentExportUserId = 'user-1';
        input.state.collectedTweets = [{ id: '1' }];
        input.state.seenCollectedTweetIds.add('1');
        input.state.capturedResponsesCount = 3;

        runtime.handleCancelExport();

        expect(input.state.collectedTweets).toEqual([]);
        expect(Array.from(input.state.seenCollectedTweetIds)).toEqual([]);
        expect(input.state.capturedResponsesCount).toBe(0);
        expect(input.state.currentExportUserId).toBeNull();
    });

    it('should clear collected state when scroll export setup fails', async () => {
        const input = createInput();
        input.state.collectedTweets = [{ id: 'stale' }];
        input.state.seenCollectedTweetIds.add('stale');
        input.state.capturedResponsesCount = 2;
        input.implementations.resolveUserForExport = mock(async () => {
            throw new Error('resolve failed');
        }) as ScrollExportImplementations['resolveUserForExport'];
        const runtime = createRuntimeScrollExport(input);

        await runtime.handleScrollExport();

        expect(input.stopFetchInterception).toHaveBeenCalled();
        expect(input.state.collectedTweets).toEqual([]);
        expect(Array.from(input.state.seenCollectedTweetIds)).toEqual([]);
        expect(input.state.capturedResponsesCount).toBe(0);
        expect(input.state.currentExportUserId).toBeNull();
        expect(input.state.isExporting).toBe(false);
    });

    it('should delegate resume-from-file handling and expose the reset callback', () => {
        const input = createInput();
        input.resumeSession.previousTweets = [{ id: '1' }];
        input.resumeSession.isResumeMode = true;

        input.implementations.startResumeFromFile = mock(
            (_resumeInput: Parameters<ScrollExportImplementations['startResumeFromFile']>[0]) => {},
        ) as ScrollExportImplementations['startResumeFromFile'];

        const runtime = createRuntimeScrollExport(input);
        runtime.handleResumeFromFile();

        expect(input.implementations.startResumeFromFile).toHaveBeenCalled();
        const startResumeCall = (input.implementations.startResumeFromFile as ReturnType<typeof mock>).mock
            .calls[0]?.[0] as Parameters<ScrollExportImplementations['startResumeFromFile']>[0] | undefined;
        startResumeCall?.resetResumeFlowState();
        expect(input.resumeSession.previousTweets).toEqual([]);
        expect(input.resumeSession.isResumeMode).toBe(false);
        expect(input.buttonUi.resetButton).toHaveBeenCalled();
    });
});

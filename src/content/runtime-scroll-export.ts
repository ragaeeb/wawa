import { extractSearchUser, resolveUserForExport } from '@/content/export-flow';
import { ensureResumeStateForSearch, redirectProfileExportToSearch } from '@/content/export-launch';
import type { RateLimitState } from '@/content/rate-limit-controller';
import { createRateLimitHandlers } from '@/content/rate-limit-handlers';
import { createResumeActions } from '@/content/resume-actions';
import { startResumeFromFile } from '@/content/resume-file-flow';
import {
    clearInMemoryResumeState as clearResumeSessionInMemory,
    clearPersistedResumeState as clearResumeSessionPersisted,
    getConsolidatedCollectedTweets as getResumeConsolidatedTweets,
    mergeWithPreviousTweets as mergeResumeTweets,
    persistResumeState as persistResumeSessionState,
    type ResumeSessionState,
    restoreResumeStateFromStorage as restoreResumeSessionState,
    setResumeState as setResumeSessionState,
} from '@/content/resume-session';
import { createRuntimePanels } from '@/content/runtime-panels';
import type { InterceptedResponsePayload, RuntimeState, RuntimeWindow } from '@/content/runtime-state';
import { runScrollExportSession } from '@/content/scroll-export-session';
import { runScrollToLoadMore } from '@/content/scroll-runner';
import { createInitialLifecycle, reduceExportLifecycle, shouldPromptLooksDone } from '@/core/rate-limit/state';
import { parseTweetDate as parseTweetDateCore } from '@/core/resume/payload';
import type { ResumeStorage } from '@/core/resume/storage';
import type { ExportMeta, TweetItem } from '@/types/domain';

type RuntimeLoggers = {
    logInfo: (message: string, data?: unknown) => void;
    logDebug: (message: string, data?: unknown) => void;
    logWarn: (message: string, data?: unknown) => void;
    logError: (message: string, data?: unknown) => void;
};

type RuntimeButtonUi = {
    getContainer: () => HTMLDivElement | null;
    updateButton: (text: string, isError?: boolean) => void;
    resetButton: () => void;
    showCooldownUI: (duration: number) => void;
    updateCooldownTimer: (milliseconds: number) => void;
    removeCooldownUI: () => void;
};

type RuntimeExportUser = Awaited<ReturnType<typeof resolveUserForExport>>;
type ResumeMetaInput = (Partial<ExportMeta> & Record<string, unknown>) | null;

type RuntimeScrollExportImplementations = {
    redirectProfileExportToSearch: typeof redirectProfileExportToSearch;
    ensureResumeStateForSearch: typeof ensureResumeStateForSearch;
    startResumeFromFile: typeof startResumeFromFile;
    runScrollToLoadMore: typeof runScrollToLoadMore;
    runScrollExportSession: typeof runScrollExportSession;
    resolveUserForExport: typeof resolveUserForExport;
};

type CreateRuntimeScrollExportInput = {
    state: RuntimeState;
    runtimeWindow: RuntimeWindow;
    resumeSession: ResumeSessionState;
    resumeStorage: ResumeStorage;
    rateLimitState: RateLimitState;
    buttonUi: RuntimeButtonUi;
    getCsrfToken: () => string | null;
    getUserByScreenName: (csrfToken: string, username: string) => Promise<RuntimeExportUser>;
    getUsernameFromUrl: () => string | null;
    extractTweetsFromInterceptedResponses: (targetUserId: string) => TweetItem[];
    startFetchInterception: () => Promise<void>;
    stopFetchInterception: () => void;
    saveAutoStartContext: (context: Record<string, unknown>) => Promise<void>;
    downloadFile: (filename: string, content: string, mime: string) => void;
    sleep: (milliseconds: number) => Promise<void>;
    getLocationPathname?: () => string;
    getLocationSearch?: () => string;
    navigateTo?: (url: string) => void;
    alertUser?: (message: string) => void;
    writeToClipboard?: (value: string) => Promise<void>;
    goBack?: () => void;
    implementations?: Partial<RuntimeScrollExportImplementations>;
    resetRateLimitStateForRun: (state: RateLimitState) => void;
    getRateLimitCooldownDetails: (state: RateLimitState) => { cooldownTime: number; reason: string };
    loggers: RuntimeLoggers;
};

export type RuntimeScrollExport = {
    handleCancelExport: () => void;
    handleResumeFromFile: () => void;
    handleScrollExport: () => Promise<void>;
    handleRateLimitMessage: (payload: Record<string, any> | null | undefined) => void;
    handleAuthErrorMessage: () => void;
    handleInterceptedResponseMessage: (payload: InterceptedResponsePayload) => void;
};

const defaultImplementations: RuntimeScrollExportImplementations = {
    redirectProfileExportToSearch,
    ensureResumeStateForSearch,
    startResumeFromFile,
    runScrollToLoadMore,
    runScrollExportSession,
    resolveUserForExport,
};

export const createRuntimeScrollExport = (input: CreateRuntimeScrollExportInput): RuntimeScrollExport => {
    const implementations = {
        ...defaultImplementations,
        ...input.implementations,
    };
    const parseTweetDate = parseTweetDateCore;
    const getLocationPathname = input.getLocationPathname ?? (() => window.location.pathname);
    const getLocationSearch = input.getLocationSearch ?? (() => window.location.search);
    const navigateTo = input.navigateTo ?? ((url: string) => window.location.assign(url));
    const alertUser = input.alertUser ?? ((message: string) => alert(message));
    const writeToClipboard = input.writeToClipboard ?? ((value: string) => navigator.clipboard.writeText(value));
    const goBack = input.goBack ?? (() => window.history.back());

    const clearInterceptedResponses = () => {
        input.state.interceptedResponses = [];
    };

    const abortActiveRun = () => {
        input.state.abortController?.abort();
    };

    const markTimelineActivity = () => {
        input.state.timelineActivityAt = Date.now();
        input.state.lifecycle = reduceExportLifecycle(input.state.lifecycle, {
            type: 'activity',
            at: input.state.timelineActivityAt,
        });
    };

    const persistResumeSnapshot = (username: string, tweets: TweetItem[], exportMeta: ResumeMetaInput) => {
        return persistResumeSessionState({
            resumeStorage: input.resumeStorage,
            username,
            tweets,
            exportMeta,
            loggers: input.loggers,
        });
    };

    const handleResumeFromFile = () => {
        const resetResumeFlowState = () => {
            clearResumeSessionInMemory(input.resumeSession);
            input.buttonUi.resetButton();
        };

        implementations.startResumeFromFile({
            getFallbackUsername: input.getUsernameFromUrl,
            updateButton: input.buttonUi.updateButton,
            setResumeState: (tweets, sourceMeta) => {
                setResumeSessionState(input.resumeSession, tweets, sourceMeta);
            },
            resetResumeFlowState,
            persistResumeState: persistResumeSnapshot,
            saveAutoStartContext: input.saveAutoStartContext,
            navigateTo,
            logInfo: input.loggers.logInfo,
            logError: input.loggers.logError,
            alertUser,
        });
    };

    const resumeActions = createResumeActions({
        getCurrentUsername: input.getUsernameFromUrl,
        getCurrentSearchQuery: () => {
            return new URLSearchParams(getLocationSearch()).get('q');
        },
        getLiveCollectedTweets: () => {
            return input.extractTweetsFromInterceptedResponses(input.state.currentExportUserId ?? 'unknown');
        },
        mergeCollectedTweets: (tweets) => {
            return mergeResumeTweets(input.resumeSession, tweets);
        },
        consolidateCollectedTweets: (tweets) => {
            return getResumeConsolidatedTweets(input.resumeSession, tweets);
        },
        getPreviousMeta: () => {
            return input.resumeSession.previousExportMeta || null;
        },
        isResumeMode: () => {
            return input.resumeSession.isResumeMode;
        },
        parseTweetDate,
        persistResumeSnapshot,
        saveAutoStartContext: input.saveAutoStartContext,
        downloadFile: input.downloadFile,
        writeToClipboard,
        alertUser,
        loggers: input.loggers,
    });

    const resumeManually = (buttonText: string, logMessage: string) => {
        input.state.isPendingDone = false;
        input.state.lifecycle = reduceExportLifecycle(input.state.lifecycle, {
            type: 'resume_manual',
            at: Date.now(),
        });
        markTimelineActivity();
        input.buttonUi.updateButton(buttonText);
        input.loggers.logInfo(logMessage);
    };

    const cancelAndResetRuntime = () => {
        input.state.isPendingDone = false;
        input.state.lifecycle = reduceExportLifecycle(input.state.lifecycle, { type: 'cancel' });
        abortActiveRun();
        input.state.isExporting = false;
        input.state.isRateLimited = false;
        input.stopFetchInterception();
        input.buttonUi.resetButton();
    };

    const runtimePanels = createRuntimePanels({
        getContainer: input.buttonUi.getContainer,
        rateLimitState: input.rateLimitState,
        getBatchesCollected: () => input.state.interceptedResponses.length,
        onDownloadConfirmed: () => {
            input.state.isPendingDone = false;
            abortActiveRun();
            input.loggers.logInfo('User confirmed download');
        },
        onContinueScrolling: () => {
            resumeManually('🟢 Continuing...', 'User chose to continue scrolling');
        },
        onRouteGoBack: () => {
            goBack();
            resumeManually('🟢 Returning...', 'User clicked Go Back');
        },
        onTryNow: () => {
            input.state.isRateLimited = false;
            input.state.isPendingDone = false;
            input.rateLimitState.mode = 'normal';
            document.getElementById('wawa-rl-controls')?.remove();
            resumeManually('📜 Resuming...', 'User clicked Try Now - resuming scroll');
        },
        onSaveProgress: () => {
            resumeActions.savePartialExport();
        },
        onResumeLink: () => {
            resumeActions.copyResumeLink();
        },
        onCancel: cancelAndResetRuntime,
        logInfo: input.loggers.logInfo,
        logWarn: input.loggers.logWarn,
    });

    const rateLimitHandlers = createRateLimitHandlers({
        rateLimitState: input.rateLimitState,
        getIsExporting: () => input.state.isExporting,
        getIsRateLimited: () => input.state.isRateLimited,
        setIsRateLimited: (value) => {
            input.state.isRateLimited = value;
        },
        getLifecycle: () => input.state.lifecycle,
        setLifecycle: (value) => {
            input.state.lifecycle = value;
        },
        reduceLifecycle: reduceExportLifecycle,
        markTimelineActivity,
        addInterceptedResponse: (payload) => {
            input.state.interceptedResponses.push(payload);
        },
        getInterceptedResponseCount: () => input.state.interceptedResponses.length,
        onRateLimitUiRequired: () => {
            runtimePanels.showRateLimit();
        },
        ...input.loggers,
    });

    const updateScrollProgress = (responsesCaptured: number) => {
        if (!input.buttonUi.getContainer() || input.state.isRateLimited) {
            return;
        }

        const modeIcon = input.rateLimitState.mode === 'cooldown' ? '🟠' : '🟢';
        input.buttonUi.updateButton(
            `${modeIcon} Scrolling... (${responsesCaptured} batches, ${input.rateLimitState.remaining} left)`,
        );
    };

    const handleRouteChangedDuringScroll = (_currentPathname: string, responsesCaptured: number) => {
        if (input.state.isPendingDone) {
            return;
        }

        input.state.isPendingDone = true;
        input.state.lifecycle = reduceExportLifecycle(input.state.lifecycle, { type: 'mark_pending_done' });
        runtimePanels.showRouteChange(responsesCaptured);
    };

    const handleLooksDoneDetected = (responsesCaptured: number) => {
        if (input.state.isPendingDone) {
            return;
        }

        input.state.isPendingDone = true;
        input.state.lifecycle = reduceExportLifecycle(input.state.lifecycle, { type: 'mark_pending_done' });
        input.loggers.logInfo('Timeline appears complete - waiting for user confirmation');
        runtimePanels.showLooksDone(responsesCaptured);
    };

    const runScrollLoop = async (maxScrolls = 100) => {
        const startingPathname = getLocationPathname();

        return implementations.runScrollToLoadMore({
            maxScrolls,
            startingPathname,
            getAbortSignal: () => input.state.abortController?.signal || null,
            isPendingDone: () => input.state.isPendingDone,
            onRouteChanged: handleRouteChangedDuringScroll,
            isRateLimited: () => input.state.isRateLimited,
            getRateLimitMode: () => input.rateLimitState.mode,
            enterCooldown: () => {
                input.state.lifecycle = reduceExportLifecycle(input.state.lifecycle, { type: 'enter_cooldown' });
            },
            getCooldownConfig: () => input.getRateLimitCooldownDetails(input.rateLimitState),
            showCooldownUI: input.buttonUi.showCooldownUI,
            updateCooldownTimer: input.buttonUi.updateCooldownTimer,
            removeCooldownUI: input.buttonUi.removeCooldownUI,
            isExporting: () => input.state.isExporting,
            shouldSkipCooldown: () => Boolean(input.runtimeWindow.wawaSkipCooldown),
            clearCooldownSkip: () => {
                input.runtimeWindow.wawaSkipCooldown = false;
            },
            onCooldownComplete: () => {
                input.rateLimitState.mode = 'normal';
                input.rateLimitState.requestCount = 0;
                input.state.lifecycle = reduceExportLifecycle(input.state.lifecycle, {
                    type: 'exit_cooldown',
                    at: Date.now(),
                });
                markTimelineActivity();
            },
            sleep: input.sleep,
            getResponsesCaptured: () => input.state.interceptedResponses.length,
            shouldPromptLooksDone: (scrollState) => {
                return shouldPromptLooksDone(input.state.lifecycle, scrollState);
            },
            onLooksDoneDetected: handleLooksDoneDetected,
            updateProgress: updateScrollProgress,
            getCurrentDelay: () => input.rateLimitState.dynamicDelay,
            markTimelineActivity,
            updateButton: input.buttonUi.updateButton,
            ...input.loggers,
        });
    };

    const resetRunState = () => {
        input.state.isRateLimited = false;
        input.state.isPendingDone = false;
        const runStartAt = Date.now();
        input.state.lifecycle = createInitialLifecycle(runStartAt);
        input.state.lifecycle = reduceExportLifecycle(input.state.lifecycle, { type: 'start', at: runStartAt });
        markTimelineActivity();
        input.resetRateLimitStateForRun(input.rateLimitState);
    };

    const completeExportUi = (count: number) => {
        input.state.lifecycle = reduceExportLifecycle(input.state.lifecycle, { type: 'complete' });
        input.buttonUi.updateButton(`✅ Exported ${count} tweets!`);
        setTimeout(input.buttonUi.resetButton, 5000);
    };

    const handleCancelExport = () => {
        if (!input.state.isExporting) {
            return;
        }

        input.loggers.logInfo('User requested export cancellation');
        abortActiveRun();
        input.state.lifecycle = reduceExportLifecycle(input.state.lifecycle, { type: 'cancel' });
        input.state.isExporting = false;
        input.state.isRateLimited = false;
        input.stopFetchInterception();
        input.buttonUi.updateButton('❌ Cancelled');
        setTimeout(input.buttonUi.resetButton, 2000);
    };

    const handleScrollExport = async () => {
        if (input.state.isExporting) {
            handleCancelExport();
            return;
        }

        const autoStartCtx = input.state.pendingAutoStartContext;
        input.state.pendingAutoStartContext = null;

        const username = input.getUsernameFromUrl();
        if (!username) {
            input.loggers.logError('Cannot determine username from current URL');
            input.buttonUi.updateButton('❌ Navigate to a profile', true);
            setTimeout(input.buttonUi.resetButton, 3000);
            return;
        }

        input.loggers.logInfo('Starting scroll export...');

        if (getLocationPathname() !== '/search') {
            await implementations.redirectProfileExportToSearch({
                username,
                getCsrfToken: input.getCsrfToken,
                getUserByScreenName: input.getUserByScreenName,
                updateButton: input.buttonUi.updateButton,
                saveAutoStartContext: input.saveAutoStartContext,
                navigateTo,
                logInfo: input.loggers.logInfo,
                logWarn: input.loggers.logWarn,
            });
            return;
        }

        const params = new URLSearchParams(getLocationSearch());
        const searchUser = extractSearchUser(params.get('q'), username);
        const hasResumeState = await implementations.ensureResumeStateForSearch({
            searchUser,
            params,
            autoStartCtx,
            restoreResumeState: async (targetUsername) => {
                return restoreResumeSessionState({
                    state: input.resumeSession,
                    resumeStorage: input.resumeStorage,
                    targetUsername,
                    loggers: input.loggers,
                });
            },
            getPriorTweetsCount: () => input.resumeSession.previousTweets.length,
            updateButton: input.buttonUi.updateButton,
            resetButton: input.buttonUi.resetButton,
            alertUser,
            logInfo: input.loggers.logInfo,
            logError: input.loggers.logError,
        });

        if (!hasResumeState) {
            return;
        }

        input.loggers.logInfo(`Starting Scroll Export for ${searchUser}`);

        input.state.isExporting = true;
        input.state.abortController = new AbortController();

        try {
            const user = await implementations.resolveUserForExport({
                username: searchUser,
                getCsrfToken: input.getCsrfToken,
                getUserByScreenName: input.getUserByScreenName,
                updateButton: input.buttonUi.updateButton,
                loggers: {
                    logInfo: input.loggers.logInfo,
                    logWarn: input.loggers.logWarn,
                    logError: input.loggers.logError,
                },
            });

            await implementations.runScrollExportSession({
                username: searchUser,
                userId: user.id,
                user,
                pathname: getLocationPathname(),
                resumeSession: input.resumeSession,
                getAbortSignal: () => input.state.abortController?.signal || null,
                setCurrentExportUserId: (userId) => {
                    input.state.currentExportUserId = userId;
                },
                resetRunState,
                startFetchInterception: input.startFetchInterception,
                scrollToLoadMore: async (maxScrolls) => {
                    await runScrollLoop(maxScrolls);
                },
                updateButton: input.buttonUi.updateButton,
                extractTweetsFromInterceptedResponses: input.extractTweetsFromInterceptedResponses,
                parseTweetDate,
                mergeWithPreviousTweets: (tweets) => {
                    return mergeResumeTweets(input.resumeSession, tweets);
                },
                downloadFile: input.downloadFile,
                getCapturedResponsesCount: () => input.state.interceptedResponses.length,
                clearResumeState: async () => {
                    clearResumeSessionInMemory(input.resumeSession);
                    await clearResumeSessionPersisted(input.resumeStorage, input.loggers);
                },
                completeExportUi,
                stopFetchInterception: input.stopFetchInterception,
                clearInterceptedResponses,
                finalizeRuntimeState: () => {
                    input.state.isExporting = false;
                    input.state.abortController = null;
                },
                logInfo: input.loggers.logInfo,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            input.loggers.logError('Scroll export failed', { error: message });
            input.buttonUi.updateButton('❌ Export failed');
            setTimeout(input.buttonUi.resetButton, 3000);
            input.state.isExporting = false;
            input.state.abortController = null;
        }
    };

    return {
        handleCancelExport,
        handleResumeFromFile,
        handleScrollExport,
        handleRateLimitMessage: rateLimitHandlers.handleRateLimitMessage,
        handleAuthErrorMessage: rateLimitHandlers.handleAuthErrorMessage,
        handleInterceptedResponseMessage: (payload) => {
            if (!input.state.isExporting) {
                return;
            }

            rateLimitHandlers.handleInterceptedResponseMessage(payload);
        },
    };
};

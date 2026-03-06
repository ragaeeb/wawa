import {
    BEARER_TOKEN,
    ENDPOINTS,
    USER_BY_SCREEN_NAME_FEATURES,
    USER_BY_SCREEN_NAME_FIELD_TOGGLES,
} from '@/content/constants';
import { createInterceptorBridge } from '@/content/interceptor-bridge';
import {
    createRateLimitState,
    getCooldownDetails as getRateLimitCooldownDetails,
    resetRateLimitStateForRun,
} from '@/content/rate-limit-controller';
import { createResumeSessionState } from '@/content/resume-session';
import { bootstrapAutoStart, initializeForCurrentRoute, observeUrlChanges } from '@/content/runtime-bootstrap';
import {
    createRuntimeResumeStorage,
    downloadFile,
    SEARCH_AUTOSTART_STORAGE_KEY,
    saveSearchAutoStartContext,
    sleep,
} from '@/content/runtime-browser';
import { createRuntimeButtonController } from '@/content/runtime-button-controller';
import { createRuntimeLogger } from '@/content/runtime-logger';
import { createRuntimeScrollExport } from '@/content/runtime-scroll-export';
import { createRuntimeState, type RuntimeWindow } from '@/content/runtime-state';
import { createRuntimeXGrok } from '@/content/runtime-x-grok';
import { getCsrfTokenFromCookieString, resolveUserByScreenName } from '@/content/twitter-user-api';
import { extractUsernameFromLocation } from '@/content/url-username';

(() => {
    const state = createRuntimeState();
    const runtimeWindow = window as RuntimeWindow;
    const resumeSession = createResumeSessionState();
    const resumeStorage = createRuntimeResumeStorage();
    const rateLimitState = createRateLimitState();

    let scrollExportRuntime: ReturnType<typeof createRuntimeScrollExport> | null = null;
    let xGrokRuntime: ReturnType<typeof createRuntimeXGrok> | null = null;
    let interceptorBridge: ReturnType<typeof createInterceptorBridge> | null = null;

    const runtimeLogger = createRuntimeLogger({
        prefixLabel: 'Wawa',
        maxEntries: 500,
        onEntry: (entry) => {
            try {
                if (chrome.runtime?.id) {
                    chrome.runtime.sendMessage({ type: 'log', entry }).catch(() => {});
                }
            } catch {}
        },
    });

    const logInfo = runtimeLogger.logInfo;
    const logDebug = runtimeLogger.logDebug;
    const logWarn = runtimeLogger.logWarn;
    const logError = runtimeLogger.logError;

    const clearCollectedTweetState = () => {
        state.collectedTweets = [];
        state.seenCollectedTweetIds.clear();
        state.capturedResponsesCount = 0;
    };

    const downloadRuntimeFile = (filename: string, content: string, mime: string) => {
        logInfo('Downloading file', { filename, size: content.length });
        downloadFile(filename, content, mime);
    };

    const downloadRuntimeJson = (filename: string, payload: unknown) => {
        downloadRuntimeFile(filename, JSON.stringify(payload, null, 2), 'application/json');
    };

    const getCsrfToken = () => {
        const token = getCsrfTokenFromCookieString(document.cookie);
        logDebug('Retrieved CSRF token', { found: !!token });
        return token;
    };

    const getUserByScreenName = async (csrfToken: string, username: string) => {
        const signal = state.abortController?.signal;

        return resolveUserByScreenName({
            host: window.location.hostname,
            csrfToken,
            username,
            bearerToken: BEARER_TOKEN,
            endpoint: ENDPOINTS.userByScreenName,
            features: USER_BY_SCREEN_NAME_FEATURES,
            fieldToggles: USER_BY_SCREEN_NAME_FIELD_TOGGLES,
            loggers: {
                logInfo,
                logDebug,
                logError,
            },
            ...(signal ? { signal } : {}),
        });
    };

    const getUsernameFromUrl = () => {
        return extractUsernameFromLocation(window.location.pathname, window.location.search);
    };

    const extractTweetsFromInterceptedResponses = (_targetUserId: string) => {
        return state.collectedTweets.slice();
    };

    const getInterceptorBridge = () => {
        if (interceptorBridge) {
            return interceptorBridge;
        }

        interceptorBridge = createInterceptorBridge({
            getScriptUrl: () => chrome.runtime.getURL('/interceptor.js'),
            onRateLimit: (payload) => {
                scrollExportRuntime?.handleRateLimitMessage(payload);
            },
            onAuthError: () => {
                scrollExportRuntime?.handleAuthErrorMessage();
            },
            onInterceptedResponse: (payload) => {
                if (typeof payload?.url === 'string') {
                    void xGrokRuntime?.observeInterceptedUrl(payload.url).catch((error) => {
                        const message = error instanceof Error ? error.message : String(error);
                        logWarn('Failed to persist observed x-grok context', { error: message, url: payload.url });
                    });
                }

                scrollExportRuntime?.handleInterceptedResponseMessage(payload);
            },
            getCapturedCount: () => state.capturedResponsesCount,
            logInfo,
            logError,
        });

        return interceptorBridge;
    };

    const startFetchInterception = async () => {
        clearCollectedTweetState();
        await getInterceptorBridge().start();
    };

    const stopFetchInterception = () => {
        interceptorBridge?.stop();
    };

    const buttonController = createRuntimeButtonController({
        onExportToggle: () => {
            if (!scrollExportRuntime) {
                return;
            }

            if (state.isExporting) {
                scrollExportRuntime.handleCancelExport();
                return;
            }

            void scrollExportRuntime.handleScrollExport();
        },
        onResume: () => {
            if (!state.isExporting) {
                scrollExportRuntime?.handleResumeFromFile();
            }
        },
        onCancelExport: () => {
            scrollExportRuntime?.handleCancelExport();
        },
        isExporting: () => state.isExporting,
        isPendingDone: () => state.isPendingDone,
        logInfo,
    });

    scrollExportRuntime = createRuntimeScrollExport({
        state,
        runtimeWindow,
        resumeSession,
        resumeStorage,
        rateLimitState,
        buttonUi: {
            getContainer: () => buttonController.getContainer(),
            updateButton: (text, isError) => {
                buttonController.updateButton(text, isError);
            },
            resetButton: () => {
                buttonController.resetButton();
            },
            showCooldownUI: (duration) => {
                buttonController.showCooldownUI(duration);
            },
            updateCooldownTimer: (milliseconds) => {
                buttonController.updateCooldownTimer(milliseconds);
            },
            removeCooldownUI: () => {
                buttonController.removeCooldownUI();
            },
        },
        getCsrfToken,
        getUserByScreenName,
        getUsernameFromUrl,
        extractTweetsFromInterceptedResponses,
        startFetchInterception,
        stopFetchInterception,
        saveAutoStartContext: saveSearchAutoStartContext,
        downloadFile: downloadRuntimeFile,
        sleep,
        getLocationPathname: () => window.location.pathname,
        getLocationSearch: () => window.location.search,
        navigateTo: (url) => {
            window.location.href = url;
        },
        alertUser: (message) => {
            alert(message);
        },
        writeToClipboard: async (value) => {
            await navigator.clipboard.writeText(value);
        },
        goBack: () => {
            window.history.back();
        },
        resetRateLimitStateForRun,
        getRateLimitCooldownDetails,
        loggers: { logInfo, logDebug, logWarn, logError },
    });

    xGrokRuntime = createRuntimeXGrok({
        state,
        getLocationPathname: () => window.location.pathname,
        getLocationSearch: () => window.location.search,
        getCsrfToken,
        getLanguage: () => navigator.language ?? 'en-US',
        downloadJson: downloadRuntimeJson,
        ensureInterception: async () => {
            await getInterceptorBridge().start();
        },
        removeMainButton: () => {
            buttonController.removeButton();
        },
        loggers: { logInfo, logDebug, logWarn, logError },
    });

    const shouldShowButton = () => {
        return Boolean(getUsernameFromUrl());
    };

    const initializeOrUpdate = () => {
        if (xGrokRuntime?.syncRouteUi()) {
            return;
        }

        initializeForCurrentRoute({
            shouldShowButton,
            createButton: () => {
                buttonController.createButton();
            },
            removeButton: () => {
                buttonController.removeButton();
            },
        });
    };

    const runtimeMessageListener = (
        message: unknown,
        _sender: chrome.runtime.MessageSender,
        sendResponse: Parameters<NonNullable<typeof xGrokRuntime>['handleRuntimeMessage']>[1],
    ) => {
        return xGrokRuntime?.handleRuntimeMessage(message, sendResponse);
    };

    chrome.runtime.onMessage.addListener(runtimeMessageListener);

    logInfo('Wawa content script loaded');

    bootstrapAutoStart({
        key: SEARCH_AUTOSTART_STORAGE_KEY,
        staleAfterMs: 60000,
        delayMs: 3000,
        logInfo,
        onFreshContext: (context) => {
            state.pendingAutoStartContext = context;
            void scrollExportRuntime?.handleScrollExport();
        },
    });

    runtimeWindow.wawaStop = () => {
        scrollExportRuntime?.handleCancelExport();
    };

    initializeOrUpdate();

    const handlePopState = () => {
        initializeOrUpdate();
    };

    const urlObserver = observeUrlChanges(initializeOrUpdate);
    const handleBeforeUnload = () => {
        urlObserver.disconnect();
        interceptorBridge?.dispose();
        xGrokRuntime?.dispose();
        chrome.runtime.onMessage.removeListener(runtimeMessageListener);
        window.removeEventListener('popstate', handlePopState);
        window.removeEventListener('beforeunload', handleBeforeUnload);
    };

    window.addEventListener('popstate', handlePopState);
    window.addEventListener('beforeunload', handleBeforeUnload);
})();

type ScrollLoopState = {
    lastScrollHeight: number;
    noChangeCount: number;
    scrollCount: number;
};

const DOM_CLEANUP_INTERVAL = 5;
const DOM_CLEANUP_THRESHOLD = 50;
const DOM_CLEANUP_KEEP_COUNT = 20;
const HEIGHT_STABILITY_LOG_THRESHOLD = 3;
const HEIGHT_STABILITY_THRESHOLD = 8;
const TWITTER_ERROR_RETRY_DELAY_MS = 5000;
const LOOKS_DONE_IDLE_THRESHOLD_MS = 30000;
const MIN_SCROLL_DELAY_MS = 3000;
const WAIT_STATE_POLL_MS = 1000;

type LooksDoneInput = {
    now: number;
    idleThresholdMs: number;
    scrollCount: number;
    responsesCaptured: number;
    heightStable: boolean;
};

type ScrollRunnerDeps = {
    maxScrolls: number;
    startingPathname: string;
    getAbortSignal: () => AbortSignal | null;
    isPendingDone: () => boolean;
    onRouteChanged: (currentPathname: string, responsesCaptured: number) => void;
    isRateLimited: () => boolean;
    getRateLimitMode: () => string;
    enterCooldown: () => void;
    getCooldownConfig: () => { cooldownTime: number; reason: string };
    showCooldownUI: (duration: number) => void;
    updateCooldownTimer: (remainingMs: number) => void;
    removeCooldownUI: () => void;
    isExporting: () => boolean;
    shouldSkipCooldown: () => boolean;
    clearCooldownSkip: () => void;
    onCooldownComplete: () => void;
    sleep: (milliseconds: number) => Promise<void>;
    getResponsesCaptured: () => number;
    shouldPromptLooksDone: (input: LooksDoneInput) => boolean;
    onLooksDoneDetected: (responsesCaptured: number) => void;
    updateProgress: (responsesCaptured: number) => void;
    getCurrentDelay: () => number;
    markTimelineActivity: () => void;
    updateButton: (text: string) => void;
    logInfo: (message: string, data?: unknown) => void;
    logDebug: (message: string, data?: unknown) => void;
    logWarn: (message: string, data?: unknown) => void;
};

const createScrollLoopState = () => ({
    lastScrollHeight: 0,
    noChangeCount: 0,
    scrollCount: 0,
});

const cleanupTweetDom = (scrollCount: number, logDebug: ScrollRunnerDeps['logDebug']) => {
    if (scrollCount % DOM_CLEANUP_INTERVAL !== 0) {
        return;
    }

    try {
        const tweets = document.querySelectorAll('article[data-testid="tweet"]');
        if (tweets.length <= DOM_CLEANUP_THRESHOLD) {
            return;
        }

        const toRemove = tweets.length - DOM_CLEANUP_KEEP_COUNT;
        logDebug(`Cleaning up DOM: removing ${toRemove} tweets`);

        for (let index = 0; index < toRemove; index += 1) {
            tweets[index]?.remove();
        }
    } catch {
        // Ignore cleanup errors in page DOM churn conditions.
    }
};

const findRetryButton = () => {
    const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
    return buttons.find((button) => {
        const label = button.textContent?.trim().toLowerCase() ?? '';
        return label === 'retry' || label === 'try again';
    });
};

const hasTwitterErrorText = () => {
    const bodyText = document.body?.innerText ?? '';
    return bodyText.includes('Something went wrong') || bodyText.includes('Try again');
};

const recoverFromTwitterError = async (deps: ScrollRunnerDeps) => {
    const retryButton = findRetryButton();
    if (!retryButton && !hasTwitterErrorText()) {
        return false;
    }

    deps.logWarn('Twitter error state detected, attempting auto-retry...');
    deps.updateButton('⚠️ Twitter error - retrying...');

    if (retryButton instanceof HTMLElement) {
        retryButton.click();
        deps.logInfo('Clicked Retry button');
    }

    await deps.sleep(TWITTER_ERROR_RETRY_DELAY_MS);
    deps.markTimelineActivity();
    return true;
};

const updateHeightStability = (
    state: ScrollLoopState,
    currentHeight: number,
    logDebug: ScrollRunnerDeps['logDebug'],
) => {
    if (currentHeight === state.lastScrollHeight) {
        state.noChangeCount += 1;
        if (state.noChangeCount > HEIGHT_STABILITY_LOG_THRESHOLD) {
            logDebug(`No height change (attempt ${state.noChangeCount}/${HEIGHT_STABILITY_THRESHOLD})`);
        }
        return;
    }

    state.noChangeCount = 0;
    state.lastScrollHeight = currentHeight;
};

const hasRouteChanged = (startingPathname: string) => {
    return window.location.pathname !== startingPathname;
};

const shouldBreakLoop = (state: ScrollLoopState, maxScrolls: number) => {
    return state.scrollCount >= maxScrolls || state.noChangeCount >= HEIGHT_STABILITY_THRESHOLD;
};

const runCooldownCycle = async (deps: ScrollRunnerDeps) => {
    deps.enterCooldown();
    const { cooldownTime, reason } = deps.getCooldownConfig();
    deps.logInfo(`Cooldown mode: pausing for ${Math.round(cooldownTime / 1000)}s due to ${reason}`);

    deps.showCooldownUI(cooldownTime);
    const endTime = Date.now() + cooldownTime;

    while (Date.now() < endTime && deps.isExporting() && !deps.shouldSkipCooldown()) {
        deps.updateCooldownTimer(Math.max(0, endTime - Date.now()));
        await deps.sleep(WAIT_STATE_POLL_MS);
    }

    if (deps.shouldSkipCooldown()) {
        deps.logInfo('Cooldown skipped by user');
        deps.clearCooldownSkip();
    }

    deps.removeCooldownUI();
    deps.onCooldownComplete();
    deps.updateButton('🟢 Resuming...');
    await deps.sleep(WAIT_STATE_POLL_MS);
};

const handleWaitStates = async (deps: ScrollRunnerDeps, state: ScrollLoopState) => {
    if (deps.getAbortSignal()?.aborted) {
        return 'break';
    }

    if (deps.isPendingDone()) {
        await deps.sleep(WAIT_STATE_POLL_MS);
        return 'continue';
    }

    if (hasRouteChanged(deps.startingPathname)) {
        deps.logWarn(`Route changed! Was: ${deps.startingPathname}, Now: ${window.location.pathname}`);
        deps.logWarn('Navigation detected - possibly clicked on a tweet. Pausing export.');
        deps.onRouteChanged(window.location.pathname, deps.getResponsesCaptured());
        await deps.sleep(WAIT_STATE_POLL_MS);
        return 'continue';
    }

    if (deps.isRateLimited() || deps.getRateLimitMode() === 'paused') {
        await deps.sleep(WAIT_STATE_POLL_MS);
        return 'continue';
    }

    if (deps.getRateLimitMode() === 'cooldown') {
        await runCooldownCycle(deps);
        state.noChangeCount = 0;
        return 'continue';
    }

    return 'proceed';
};

const performScrollIteration = async (deps: ScrollRunnerDeps, state: ScrollLoopState) => {
    state.scrollCount += 1;
    cleanupTweetDom(state.scrollCount, deps.logDebug);
    window.scrollTo(0, document.body.scrollHeight);

    await deps.sleep(Math.max(deps.getCurrentDelay(), MIN_SCROLL_DELAY_MS));

    if (await recoverFromTwitterError(deps)) {
        state.noChangeCount = 0;
        return 'continue';
    }

    const currentHeight = document.body.scrollHeight;
    const responsesCaptured = deps.getResponsesCaptured();

    if (
        deps.shouldPromptLooksDone({
            now: Date.now(),
            idleThresholdMs: LOOKS_DONE_IDLE_THRESHOLD_MS,
            scrollCount: state.scrollCount,
            responsesCaptured,
            heightStable: currentHeight === state.lastScrollHeight,
        })
    ) {
        deps.onLooksDoneDetected(responsesCaptured);
        await deps.sleep(WAIT_STATE_POLL_MS);
        return 'continue';
    }

    updateHeightStability(state, currentHeight, deps.logDebug);
    deps.updateProgress(responsesCaptured);
    return 'proceed';
};

export const runScrollToLoadMore = async (deps: ScrollRunnerDeps) => {
    deps.logInfo(`Starting scroll - based loading(max ${deps.maxScrolls} scrolls)`);

    const state = createScrollLoopState();

    while (!shouldBreakLoop(state, deps.maxScrolls)) {
        const waitAction = await handleWaitStates(deps, state);
        if (waitAction === 'break') {
            break;
        }
        if (waitAction === 'continue') {
            continue;
        }

        await performScrollIteration(deps, state);
    }

    const responsesCaptured = deps.getResponsesCaptured();
    deps.logInfo(`Scroll loading complete: ${state.scrollCount} scrolls, ${responsesCaptured} responses captured`);
    return responsesCaptured;
};

import { afterEach, describe, expect, it, mock } from 'bun:test';
import { runScrollToLoadMore } from '@/content/scroll-runner';

const originalScrollTo = window.scrollTo;
const originalQuerySelectorAll = document.querySelectorAll.bind(document);
const originalScrollHeight = Object.getOwnPropertyDescriptor(document.body, 'scrollHeight');

const mockScrollHeight = (getHeight: () => number) => {
    Object.defineProperty(document.body, 'scrollHeight', {
        configurable: true,
        get: getHeight,
    });
};

const restoreDom = () => {
    document.body.innerHTML = '';
    Object.defineProperty(document, 'querySelectorAll', {
        configurable: true,
        value: originalQuerySelectorAll,
    });
    window.scrollTo = originalScrollTo;

    if (originalScrollHeight) {
        Object.defineProperty(document.body, 'scrollHeight', originalScrollHeight);
        return;
    }

    delete (document.body as { scrollHeight?: unknown }).scrollHeight;
};

afterEach(() => {
    restoreDom();
});

const createDeps = (overrides: Partial<Parameters<typeof runScrollToLoadMore>[0]> = {}) => {
    return {
        maxScrolls: 10,
        startingPathname: window.location.pathname,
        getAbortSignal: () => null,
        isPendingDone: () => false,
        onRouteChanged: mock(() => {}),
        isRateLimited: () => false,
        getRateLimitMode: () => 'normal',
        enterCooldown: mock(() => {}),
        getCooldownConfig: () => ({ cooldownTime: 1000, reason: 'test' }),
        showCooldownUI: mock(() => {}),
        updateCooldownTimer: mock(() => {}),
        removeCooldownUI: mock(() => {}),
        isExporting: () => true,
        shouldSkipCooldown: () => false,
        clearCooldownSkip: mock(() => {}),
        onCooldownComplete: mock(() => {}),
        sleep: mock(async () => {}),
        getResponsesCaptured: () => 0,
        shouldPromptLooksDone: () => false,
        onLooksDoneDetected: mock(() => {}),
        updateProgress: mock(() => {}),
        getCurrentDelay: () => 0,
        markTimelineActivity: mock(() => {}),
        updateButton: mock(() => {}),
        logInfo: mock(() => {}),
        logDebug: mock(() => {}),
        logWarn: mock(() => {}),
        ...overrides,
    };
};

describe('runScrollToLoadMore', () => {
    it('should skip tweet-dom cleanup queries before the cleanup interval', async () => {
        let height = 100;
        mockScrollHeight(() => height);
        window.scrollTo = mock(() => {
            height += 100;
        });

        const tweetQuery = mock(() => document.createElement('div').querySelectorAll('article'));
        Object.defineProperty(document, 'querySelectorAll', {
            configurable: true,
            value: ((selector: string) => {
                if (selector === 'article[data-testid="tweet"]') {
                    return tweetQuery() as ReturnType<typeof document.querySelectorAll>;
                }

                return originalQuerySelectorAll(selector);
            }) as typeof document.querySelectorAll,
        });

        await runScrollToLoadMore(
            createDeps({
                maxScrolls: 4,
            }),
        );

        expect(tweetQuery).not.toHaveBeenCalled();
    });

    it('should trim old tweet nodes on the cleanup interval', async () => {
        let height = 100;
        mockScrollHeight(() => height);
        window.scrollTo = mock(() => {
            height += 100;
        });

        for (let index = 0; index < 55; index += 1) {
            const article = document.createElement('article');
            article.setAttribute('data-testid', 'tweet');
            document.body.appendChild(article);
        }

        const deps = createDeps({
            maxScrolls: 5,
        });

        await runScrollToLoadMore(deps);

        expect(document.querySelectorAll('article[data-testid="tweet"]')).toHaveLength(20);
        expect(deps.logDebug).toHaveBeenCalledWith('Cleaning up DOM: removing 35 tweets');
    });

    it('should stop after repeated stable heights even when maxScrolls is much larger', async () => {
        mockScrollHeight(() => 100);
        window.scrollTo = mock(() => {});

        const deps = createDeps({
            maxScrolls: 50,
        });

        await runScrollToLoadMore(deps);

        expect(deps.updateProgress).toHaveBeenCalledTimes(9);
        expect(deps.logInfo).toHaveBeenLastCalledWith('Scroll loading complete: 9 scrolls, 0 responses captured');
    });
});

type AutoStartContext = {
    autoStart?: boolean;
    timestamp?: number;
};

type AutoStartBootstrapInput = {
    key: string;
    staleAfterMs: number;
    delayMs: number;
    logInfo: (message: string, data?: unknown) => void;
    onFreshContext: (context: Record<string, unknown>) => void;
};

export const initializeForCurrentRoute = (input: {
    shouldShowButton: () => boolean;
    createButton: () => void;
    removeButton: () => void;
}) => {
    if (input.shouldShowButton()) {
        input.createButton();
        return;
    }

    input.removeButton();
};

export const observeUrlChanges = (onChange: () => void) => {
    let lastUrl = window.location.href;
    const observer = new MutationObserver(() => {
        if (window.location.href === lastUrl) {
            return;
        }

        lastUrl = window.location.href;
        onChange();
    });

    observer.observe(document.body, { childList: true, subtree: true });
    return observer;
};

const isFreshAutoStartContext = (context: AutoStartContext, staleAfterMs: number) => {
    if (!context?.autoStart) {
        return false;
    }

    const timestamp = Number(context.timestamp ?? 0);
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
        return false;
    }

    return Date.now() - timestamp < staleAfterMs;
};

export const bootstrapAutoStart = (input: AutoStartBootstrapInput) => {
    if (!chrome.storage?.local) {
        return;
    }

    chrome.storage.local.get([input.key], (result) => {
        const context = result[input.key] as AutoStartContext | undefined;
        if (!isFreshAutoStartContext(context ?? {}, input.staleAfterMs)) {
            return;
        }

        input.logInfo('Auto-start flag detected! Starting export...');
        chrome.storage.local.remove(input.key);

        setTimeout(() => {
            input.onFreshContext((context ?? {}) as Record<string, unknown>);
        }, input.delayMs);
    });
};

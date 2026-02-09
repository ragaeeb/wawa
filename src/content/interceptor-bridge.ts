type AnyRecord = Record<string, any>;

type CreateInterceptorBridgeInput = {
    getScriptUrl: () => string;
    onRateLimit: (payload: AnyRecord | null) => void;
    onAuthError: () => void;
    onInterceptedResponse: (payload: AnyRecord) => void;
    getCapturedCount: () => number;
    logInfo: (message: string, data?: unknown) => void;
    logError: (message: string, data?: unknown) => void;
};

const isWindowMessageEvent = (event: MessageEvent) => {
    return event.source === window;
};

export const createInterceptorBridge = (input: CreateInterceptorBridgeInput) => {
    let isListening = false;
    let isIntercepting = false;

    const handleMessage = (event: MessageEvent) => {
        if (!isWindowMessageEvent(event)) {
            return;
        }

        const type = event.data?.type;
        if (type === 'WAWA_RATE_LIMIT') {
            input.onRateLimit(event.data?.payload ?? null);
            return;
        }

        if (type === 'WAWA_AUTH_ERROR') {
            input.onAuthError();
            return;
        }

        if (type === 'WAWA_INTERCEPTED_RESPONSE') {
            input.onInterceptedResponse(event.data.payload);
        }
    };

    const ensureListener = () => {
        if (isListening) {
            return;
        }

        window.addEventListener('message', handleMessage);
        isListening = true;
    };

    const removeListener = () => {
        if (!isListening) {
            return;
        }

        window.removeEventListener('message', handleMessage);
        isListening = false;
    };

    const start = async () => {
        ensureListener();
        if (isIntercepting) {
            return;
        }

        isIntercepting = true;

        await new Promise<void>((resolve, reject) => {
            const script = document.createElement('script');
            const scriptUrl = input.getScriptUrl();
            script.src = scriptUrl;

            input.logInfo(`Injecting interceptor from: ${scriptUrl}`);

            script.onload = () => {
                input.logInfo('Interceptor script loaded successfully');
                script.remove();
                setTimeout(resolve, 500);
            };
            script.onerror = (error) => {
                input.logError('Failed to load interceptor script', { error });
                reject(new Error('Failed to load interceptor script'));
            };

            (document.head || document.documentElement).appendChild(script);
        });
    };

    const stop = () => {
        if (!isIntercepting) {
            return;
        }

        isIntercepting = false;
        input.logInfo(`Stopped fetch interception, captured ${input.getCapturedCount()} responses`);
    };

    const resetCaptured = () => {
        // Kept for interface symmetry; captured data lives in runtime state.
    };

    const dispose = () => {
        stop();
        removeListener();
    };

    ensureListener();

    return {
        start,
        stop,
        resetCaptured,
        dispose,
    };
};

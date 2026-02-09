import { describe, expect, it, mock } from 'bun:test';
import { createRateLimitState } from '@/content/rate-limit-controller';
import { createRateLimitHandlers } from '@/content/rate-limit-handlers';

describe('createRateLimitHandlers', () => {
    const createMockInput = () => {
        const rateLimitState = createRateLimitState();
        const lifecycle = { phase: 'idle' };

        return {
            rateLimitState,
            getIsExporting: mock(() => false),
            getIsRateLimited: mock(() => false),
            setIsRateLimited: mock(() => {}),
            getLifecycle: mock(() => lifecycle),
            setLifecycle: mock(() => {}),
            reduceLifecycle: mock((state, action) => ({ ...state, action })),
            markTimelineActivity: mock(() => {}),
            addInterceptedResponse: mock(() => {}),
            getInterceptedResponseCount: mock(() => 10),
            onRateLimitUiRequired: mock(() => {}),
            logInfo: mock(() => {}),
            logDebug: mock(() => {}),
            logWarn: mock(() => {}),
            logError: mock(() => {}),
        };
    };

    describe('applyRateLimitUpdate', () => {
        it('should update rate limit state', () => {
            const input = createMockInput();
            const handlers = createRateLimitHandlers(input);

            handlers.applyRateLimitUpdate({ limit: 100, remaining: 50 });

            expect(input.rateLimitState.limit).toBe(100);
            expect(input.rateLimitState.remaining).toBe(50);
        });

        it('should not update when rateLimitInfo is null', () => {
            const input = createMockInput();
            const handlers = createRateLimitHandlers(input);

            const originalLimit = input.rateLimitState.limit;
            handlers.applyRateLimitUpdate(null);

            expect(input.rateLimitState.limit).toBe(originalLimit);
        });

        it('should not update when rateLimitInfo is undefined', () => {
            const input = createMockInput();
            const handlers = createRateLimitHandlers(input);

            const originalLimit = input.rateLimitState.limit;
            handlers.applyRateLimitUpdate(undefined);

            expect(input.rateLimitState.limit).toBe(originalLimit);
        });

        it('should enter cooldown on batch trigger', () => {
            const input = createMockInput();
            input.rateLimitState.requestCount = 19;
            const handlers = createRateLimitHandlers(input);

            handlers.applyRateLimitUpdate({ remaining: 100 });

            expect(input.rateLimitState.mode).toBe('cooldown');
            expect(input.setLifecycle).toHaveBeenCalled();
            expect(input.logInfo).toHaveBeenCalled();
        });

        it('should enter cooldown on low remaining trigger', () => {
            const input = createMockInput();
            const handlers = createRateLimitHandlers(input);

            handlers.applyRateLimitUpdate({ remaining: 5 });

            expect(input.rateLimitState.mode).toBe('cooldown');
            expect(input.setLifecycle).toHaveBeenCalled();
            expect(input.logWarn).toHaveBeenCalled();
        });
    });

    describe('handleRateLimitMessage', () => {
        it('should set rate limited state when exporting', () => {
            const input = createMockInput();
            input.getIsExporting = mock(() => true);
            const handlers = createRateLimitHandlers(input);

            handlers.handleRateLimitMessage({ rateLimitInfo: {} });

            expect(input.setIsRateLimited).toHaveBeenCalledWith(true);
            expect(input.rateLimitState.mode).toBe('paused');
        });

        it('should increment retry count', () => {
            const input = createMockInput();
            input.getIsExporting = mock(() => true);
            const handlers = createRateLimitHandlers(input);

            handlers.handleRateLimitMessage({});

            expect(input.rateLimitState.retryCount).toBe(1);

            handlers.handleRateLimitMessage({});

            expect(input.rateLimitState.retryCount).toBe(2);
        });

        it('should update lifecycle to pause_rate_limit', () => {
            const input = createMockInput();
            input.getIsExporting = mock(() => true);
            const handlers = createRateLimitHandlers(input);

            handlers.handleRateLimitMessage({});

            expect(input.reduceLifecycle).toHaveBeenCalledWith(expect.anything(), { type: 'pause_rate_limit' });
        });

        it('should call onRateLimitUiRequired', () => {
            const input = createMockInput();
            input.getIsExporting = mock(() => true);
            const handlers = createRateLimitHandlers(input);

            handlers.handleRateLimitMessage({});

            expect(input.onRateLimitUiRequired).toHaveBeenCalled();
        });

        it('should not handle when already rate limited', () => {
            const input = createMockInput();
            input.getIsExporting = mock(() => true);
            input.getIsRateLimited = mock(() => true);
            const handlers = createRateLimitHandlers(input);

            handlers.handleRateLimitMessage({});

            expect(input.setIsRateLimited).not.toHaveBeenCalled();
        });

        it('should not handle when not exporting', () => {
            const input = createMockInput();
            input.getIsExporting = mock(() => false);
            const handlers = createRateLimitHandlers(input);

            handlers.handleRateLimitMessage({});

            expect(input.setIsRateLimited).not.toHaveBeenCalled();
        });

        it('should apply rate limit update from payload', () => {
            const input = createMockInput();
            input.getIsExporting = mock(() => true);
            const handlers = createRateLimitHandlers(input);

            handlers.handleRateLimitMessage({
                rateLimitInfo: { limit: 100, remaining: 50 },
            });

            expect(input.rateLimitState.limit).toBe(100);
            expect(input.rateLimitState.remaining).toBe(50);
        });

        it('should handle null payload', () => {
            const input = createMockInput();
            input.getIsExporting = mock(() => true);
            const handlers = createRateLimitHandlers(input);

            expect(() => handlers.handleRateLimitMessage(null)).not.toThrow();
        });

        it('should handle undefined payload', () => {
            const input = createMockInput();
            input.getIsExporting = mock(() => true);
            const handlers = createRateLimitHandlers(input);

            expect(() => handlers.handleRateLimitMessage(undefined)).not.toThrow();
        });
    });

    describe('handleAuthErrorMessage', () => {
        it('should set rate limited state', () => {
            const input = createMockInput();
            const handlers = createRateLimitHandlers(input);

            handlers.handleAuthErrorMessage();

            expect(input.setIsRateLimited).toHaveBeenCalledWith(true);
            expect(input.rateLimitState.mode).toBe('paused');
        });

        it('should update lifecycle to pause_rate_limit', () => {
            const input = createMockInput();
            const handlers = createRateLimitHandlers(input);

            handlers.handleAuthErrorMessage();

            expect(input.reduceLifecycle).toHaveBeenCalledWith(expect.anything(), { type: 'pause_rate_limit' });
        });

        it('should call onRateLimitUiRequired', () => {
            const input = createMockInput();
            const handlers = createRateLimitHandlers(input);

            handlers.handleAuthErrorMessage();

            expect(input.onRateLimitUiRequired).toHaveBeenCalled();
        });

        it('should log error message', () => {
            const input = createMockInput();
            const handlers = createRateLimitHandlers(input);

            handlers.handleAuthErrorMessage();

            expect(input.logError).toHaveBeenCalledWith(expect.stringContaining('Authentication error'));
        });
    });

    describe('handleInterceptedResponseMessage', () => {
        it('should add intercepted response', () => {
            const input = createMockInput();
            const handlers = createRateLimitHandlers(input);

            const payload = { data: 'test' };
            handlers.handleInterceptedResponseMessage(payload);

            expect(input.addInterceptedResponse).toHaveBeenCalledWith(payload);
        });

        it('should mark timeline activity', () => {
            const input = createMockInput();
            const handlers = createRateLimitHandlers(input);

            handlers.handleInterceptedResponseMessage({});

            expect(input.markTimelineActivity).toHaveBeenCalled();
        });

        it('should apply rate limit update', () => {
            const input = createMockInput();
            const handlers = createRateLimitHandlers(input);

            handlers.handleInterceptedResponseMessage({
                rateLimitInfo: { limit: 100, remaining: 80 },
            });

            expect(input.rateLimitState.limit).toBe(100);
            expect(input.rateLimitState.remaining).toBe(80);
        });

        it('should clear rate limited flag when recovering', () => {
            const input = createMockInput();
            input.getIsRateLimited = mock(() => true);
            input.rateLimitState.mode = 'normal';
            const handlers = createRateLimitHandlers(input);

            handlers.handleInterceptedResponseMessage({});

            expect(input.setIsRateLimited).toHaveBeenCalledWith(false);
            expect(input.rateLimitState.retryCount).toBe(0);
        });

        it('should not clear rate limited flag when mode is paused', () => {
            const input = createMockInput();
            input.getIsRateLimited = mock(() => true);
            input.rateLimitState.mode = 'paused';
            const handlers = createRateLimitHandlers(input);

            handlers.handleInterceptedResponseMessage({});

            expect(input.setIsRateLimited).not.toHaveBeenCalled();
        });

        it('should not clear rate limited flag when not rate limited', () => {
            const input = createMockInput();
            input.getIsRateLimited = mock(() => false);
            const handlers = createRateLimitHandlers(input);

            handlers.handleInterceptedResponseMessage({});

            expect(input.setIsRateLimited).not.toHaveBeenCalled();
        });

        it('should log info message with response count', () => {
            const input = createMockInput();
            input.getInterceptedResponseCount = mock(() => 42);
            const handlers = createRateLimitHandlers(input);

            handlers.handleInterceptedResponseMessage({});

            expect(input.logInfo).toHaveBeenCalledWith(
                expect.stringContaining('Received response #42'),
                expect.anything(),
            );
        });

        it('should handle payload without rateLimitInfo', () => {
            const input = createMockInput();
            const handlers = createRateLimitHandlers(input);

            expect(() => handlers.handleInterceptedResponseMessage({})).not.toThrow();
        });
    });

    describe('createRateLimitHandlers return value', () => {
        it('should return all handler methods', () => {
            const input = createMockInput();
            const handlers = createRateLimitHandlers(input);

            expect(handlers.applyRateLimitUpdate).toBeDefined();
            expect(handlers.handleRateLimitMessage).toBeDefined();
            expect(handlers.handleAuthErrorMessage).toBeDefined();
            expect(handlers.handleInterceptedResponseMessage).toBeDefined();
        });
    });
});

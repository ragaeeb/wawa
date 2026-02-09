import { beforeEach, describe, expect, it } from 'bun:test';
import { bootstrapBackground } from '@/background/index';

const testLogEntry = {
    timestamp: '2026-02-09T00:00:00.000Z',
    level: 'info' as const,
    message: 'bootstrap test',
};

describe('background bootstrap integration', () => {
    beforeEach(() => {
        (globalThis as { __wawaChromeMock?: { clearStorage: () => void } }).__wawaChromeMock?.clearStorage();
    });

    it('should register handlers once and process runtime messages', async () => {
        bootstrapBackground();
        bootstrapBackground();

        const logResponse = await chrome.runtime.sendMessage({
            type: 'log',
            entry: testLogEntry,
        });
        expect(logResponse).toEqual({ success: true });

        const logsResponse = (await chrome.runtime.sendMessage({
            type: 'getLogs',
        })) as { logs?: Array<{ message?: string }> };

        expect(Array.isArray(logsResponse.logs)).toBe(true);
        expect(logsResponse.logs?.[0]?.message).toBe('bootstrap test');
    });

    it('should return structured error response for unsupported messages', async () => {
        bootstrapBackground();

        const response = (await chrome.runtime.sendMessage({
            type: 'unknown',
        })) as { success?: boolean; error?: string };

        expect(response.success).toBe(false);
        expect(typeof response.error).toBe('string');
    });

    it('should seed default settings on installed event', async () => {
        bootstrapBackground();

        (globalThis as { __wawaChromeMock?: { triggerInstalled: () => void } }).__wawaChromeMock?.triggerInstalled();

        const settings = (await chrome.runtime.sendMessage({
            type: 'getSettings',
        })) as { minimalData?: boolean; includeReplies?: boolean; maxCount?: number };

        expect(settings.minimalData).toBe(true);
        expect(settings.includeReplies).toBe(false);
        expect(settings.maxCount).toBe(0);
    });
});

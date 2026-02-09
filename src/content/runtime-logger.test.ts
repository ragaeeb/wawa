import { describe, expect, it, mock, spyOn } from 'bun:test';
import type { RuntimeLogEntry } from '@/content/runtime-logger';
import { createRuntimeLogger } from '@/content/runtime-logger';

describe('createRuntimeLogger', () => {
    it('should create logger with default max entries', () => {
        const logger = createRuntimeLogger({ prefixLabel: 'TEST' });

        logger.logInfo('test message');
        const entries = logger.getEntries();

        expect(entries).toHaveLength(1);
        expect(entries[0].message).toBe('test message');
        expect(entries[0].level).toBe('info');
    });

    it('should create logger with custom max entries', () => {
        const logger = createRuntimeLogger({ prefixLabel: 'TEST', maxEntries: 3 });

        logger.logInfo('message 1');
        logger.logInfo('message 2');
        logger.logInfo('message 3');
        logger.logInfo('message 4');

        const entries = logger.getEntries();

        expect(entries).toHaveLength(3);
        expect(entries[0].message).toBe('message 2');
        expect(entries[2].message).toBe('message 4');
    });

    it('should log info messages', () => {
        const logger = createRuntimeLogger({ prefixLabel: 'TEST' });

        logger.logInfo('info message', { key: 'value' });
        const entries = logger.getEntries();

        expect(entries).toHaveLength(1);
        expect(entries[0].level).toBe('info');
        expect(entries[0].message).toBe('info message');
        expect(entries[0].data).toEqual({ key: 'value' });
    });

    it('should log debug messages', () => {
        const logger = createRuntimeLogger({ prefixLabel: 'TEST' });

        logger.logDebug('debug message');
        const entries = logger.getEntries();

        expect(entries).toHaveLength(1);
        expect(entries[0].level).toBe('debug');
        expect(entries[0].message).toBe('debug message');
    });

    it('should log warn messages', () => {
        const logger = createRuntimeLogger({ prefixLabel: 'TEST' });

        logger.logWarn('warning message');
        const entries = logger.getEntries();

        expect(entries).toHaveLength(1);
        expect(entries[0].level).toBe('warn');
        expect(entries[0].message).toBe('warning message');
    });

    it('should log error messages', () => {
        const logger = createRuntimeLogger({ prefixLabel: 'TEST' });

        logger.logError('error message');
        const entries = logger.getEntries();

        expect(entries).toHaveLength(1);
        expect(entries[0].level).toBe('error');
        expect(entries[0].message).toBe('error message');
    });

    it('should write to console.log for info', () => {
        const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
        const logger = createRuntimeLogger({ prefixLabel: 'TEST' });

        logger.logInfo('test');

        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
    });

    it('should write to console.debug for debug', () => {
        const consoleSpy = spyOn(console, 'debug').mockImplementation(() => {});
        const logger = createRuntimeLogger({ prefixLabel: 'TEST' });

        logger.logDebug('test');

        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
    });

    it('should write to console.warn for warn', () => {
        const consoleSpy = spyOn(console, 'warn').mockImplementation(() => {});
        const logger = createRuntimeLogger({ prefixLabel: 'TEST' });

        logger.logWarn('test');

        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
    });

    it('should write to console.error for error', () => {
        const consoleSpy = spyOn(console, 'error').mockImplementation(() => {});
        const logger = createRuntimeLogger({ prefixLabel: 'TEST' });

        logger.logError('test');

        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
    });

    it('should call onEntry callback when provided', () => {
        const onEntry = mock<(entry: RuntimeLogEntry) => void>(() => {});
        const logger = createRuntimeLogger({ prefixLabel: 'TEST', onEntry });

        logger.logInfo('test message', { data: 'value' });

        expect(onEntry).toHaveBeenCalledTimes(1);
        const [entry] = onEntry.mock.calls[0] ?? [];
        if (!entry) {
            throw new Error('Expected onEntry to be called with a log entry.');
        }
        expect(entry.level).toBe('info');
        expect(entry.message).toBe('test message');
        expect(entry.data).toEqual({ data: 'value' });
        expect(entry.timestamp).toBeDefined();
    });

    it('should include timestamp in log entries', () => {
        const logger = createRuntimeLogger({ prefixLabel: 'TEST' });

        logger.logInfo('test');
        const entries = logger.getEntries();

        expect(entries[0].timestamp).toBeDefined();
        expect(typeof entries[0].timestamp).toBe('string');
        expect(entries[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should handle data as null when not provided', () => {
        const logger = createRuntimeLogger({ prefixLabel: 'TEST' });

        logger.logInfo('test');
        const entries = logger.getEntries();

        expect(entries[0].data).toBeNull();
    });

    it('should use generic log method', () => {
        const logger = createRuntimeLogger({ prefixLabel: 'TEST' });

        logger.log('info', 'generic message', { custom: true });
        const entries = logger.getEntries();

        expect(entries).toHaveLength(1);
        expect(entries[0].level).toBe('info');
        expect(entries[0].message).toBe('generic message');
        expect(entries[0].data).toEqual({ custom: true });
    });

    it('should return shallow copy of entries', () => {
        const logger = createRuntimeLogger({ prefixLabel: 'TEST' });

        logger.logInfo('test 1');
        const entries1 = logger.getEntries();

        logger.logInfo('test 2');
        const entries2 = logger.getEntries();

        expect(entries1).toHaveLength(1);
        expect(entries2).toHaveLength(2);
        expect(entries1).not.toBe(entries2);
    });

    it('should maintain entry order', () => {
        const logger = createRuntimeLogger({ prefixLabel: 'TEST' });

        logger.logInfo('first');
        logger.logWarn('second');
        logger.logError('third');

        const entries = logger.getEntries();

        expect(entries[0].message).toBe('first');
        expect(entries[1].message).toBe('second');
        expect(entries[2].message).toBe('third');
    });

    it('should handle complex data objects', () => {
        const logger = createRuntimeLogger({ prefixLabel: 'TEST' });

        const complexData = {
            nested: {
                array: [1, 2, 3],
                object: { key: 'value' },
            },
            number: 42,
            boolean: true,
        };

        logger.logInfo('complex', complexData);
        const entries = logger.getEntries();

        expect(entries[0].data).toEqual(complexData);
    });

    it('should trim old entries when maxEntries is exceeded', () => {
        const logger = createRuntimeLogger({ prefixLabel: 'TEST', maxEntries: 2 });

        logger.logInfo('1');
        logger.logInfo('2');
        logger.logInfo('3');
        logger.logInfo('4');

        const entries = logger.getEntries();

        expect(entries).toHaveLength(2);
        expect(entries[0].message).toBe('3');
        expect(entries[1].message).toBe('4');
    });
});

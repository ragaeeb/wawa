import { describe, expect, it } from 'bun:test';
import {
    isXGrokBulkExportMessage,
    isXGrokClearAllMessage,
    normalizeXGrokBulkExportLimit,
    WAWA_X_GROK_BULK_EXPORT_MESSAGE,
    WAWA_X_GROK_CLEAR_ALL_MESSAGE,
} from '@/content/x-grok-contracts';

describe('x-grok contracts', () => {
    it('should normalize non-integer limits to valid values', () => {
        expect(normalizeXGrokBulkExportLimit(12.9)).toBe(12);
        expect(normalizeXGrokBulkExportLimit(-5)).toBe(0);
    });

    it('should reject bulk export messages with negative or fractional limits', () => {
        expect(
            isXGrokBulkExportMessage({
                type: WAWA_X_GROK_BULK_EXPORT_MESSAGE,
                limit: -1,
            }),
        ).toBe(false);
        expect(
            isXGrokBulkExportMessage({
                type: WAWA_X_GROK_BULK_EXPORT_MESSAGE,
                limit: 1.5,
            }),
        ).toBe(false);
    });

    it('should accept bulk export messages with integer limits', () => {
        expect(
            isXGrokBulkExportMessage({
                type: WAWA_X_GROK_BULK_EXPORT_MESSAGE,
                limit: 0,
            }),
        ).toBe(true);
        expect(
            isXGrokBulkExportMessage({
                type: WAWA_X_GROK_BULK_EXPORT_MESSAGE,
                limit: 5,
            }),
        ).toBe(true);
    });

    it('should accept clear-all messages', () => {
        expect(
            isXGrokClearAllMessage({
                type: WAWA_X_GROK_CLEAR_ALL_MESSAGE,
            }),
        ).toBe(true);
        expect(
            isXGrokClearAllMessage({
                type: WAWA_X_GROK_BULK_EXPORT_MESSAGE,
            }),
        ).toBe(false);
    });
});

import { describe, expect, it } from 'bun:test';
import { buildConsolidatedMeta } from '@/core/export/meta';

describe('export metadata assembly', () => {
    it('should build accurate consolidated metadata for resumed exports', () => {
        const meta = buildConsolidatedMeta({
            username: 'example',
            userId: '123',
            name: 'Example Name',
            startedAt: '2026-02-08T10:00:00.000Z',
            completedAt: '2026-02-08T11:00:00.000Z',
            newCollectedCount: 200,
            previousCollectedCount: 800,
            reportedCountCurrent: 900,
            previousMeta: {
                username: 'example',
                export_started_at: '2026-02-07T10:00:00.000Z',
                export_completed_at: '2026-02-07T11:00:00.000Z',
                reported_count: 1000,
                scroll_responses_captured: 20,
            },
            collectionMethod: 'scroll-interception-resumed',
            scrollResponsesCapturedCurrent: 30,
            mergeInfo: {
                previous_count: 800,
                new_count: 200,
                duplicates_removed: 40,
                final_count: 960,
            },
        });

        expect(meta.collected_count).toBe(960);
        expect(meta.new_collected_count).toBe(200);
        expect(meta.previous_collected_count).toBe(800);
        expect(meta.reported_count).toBe(1000);
        expect(meta.export_started_at).toBe('2026-02-07T10:00:00.000Z');
        expect(meta.scroll_responses_captured).toBe(50);
    });

    it('should use runtime counts for fresh exports with no merge metadata', () => {
        const meta = buildConsolidatedMeta({
            username: 'fresh',
            startedAt: '2026-02-08T10:00:00.000Z',
            completedAt: '2026-02-08T11:00:00.000Z',
            newCollectedCount: 42,
            previousCollectedCount: 0,
            reportedCountCurrent: 50,
            previousMeta: null,
            collectionMethod: 'scroll-interception',
            scrollResponsesCapturedCurrent: 8,
            mergeInfo: null,
        });

        expect(meta.collected_count).toBe(42);
        expect(meta.reported_count).toBe(50);
        expect(meta.scroll_responses_captured).toBe(8);
        expect(meta.merge_info).toBe(undefined);
    });

    it('should fallback to legacy started_at and finished_at fields', () => {
        const meta = buildConsolidatedMeta({
            username: 'example',
            startedAt: '2026-03-01T10:00:00.000Z',
            completedAt: '2026-03-01T11:00:00.000Z',
            newCollectedCount: 10,
            previousCollectedCount: 5,
            reportedCountCurrent: null,
            previousMeta: {
                username: 'example',
                started_at: '2026-02-01T10:00:00.000Z',
                finished_at: '2026-02-01T11:00:00.000Z',
            },
            collectionMethod: 'scroll-interception-resumed',
            scrollResponsesCapturedCurrent: 2,
            mergeInfo: null,
        });

        expect(meta.previous_export_started_at).toBe('2026-02-01T10:00:00.000Z');
        expect(meta.previous_export_completed_at).toBe('2026-02-01T11:00:00.000Z');
        expect(meta.export_started_at).toBe('2026-02-01T10:00:00.000Z');
    });
});

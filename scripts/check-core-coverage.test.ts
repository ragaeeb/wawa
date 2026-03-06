import { describe, expect, it } from 'bun:test';
import {
    CORE_FUNCTION_THRESHOLD,
    CORE_LINE_THRESHOLD,
    parseLcovCoverage,
    summarizeCoreCoverage,
} from './check-core-coverage';

describe('check-core-coverage', () => {
    it('should parse lcov records', () => {
        const records = parseLcovCoverage(
            ['SF:/repo/src/core/example.ts', 'FNF:10', 'FNH:9', 'LF:20', 'LH:19', 'end_of_record'].join('\n'),
        );

        expect(records).toEqual([
            {
                file: '/repo/src/core/example.ts',
                functionFound: 10,
                functionHit: 9,
                lineFound: 20,
                lineHit: 19,
            },
        ]);
    });

    it('should summarize only src/core coverage records', () => {
        const summary = summarizeCoreCoverage([
            {
                file: 'src/core/example-a.ts',
                functionFound: 10,
                functionHit: 10,
                lineFound: 20,
                lineHit: 20,
            },
            {
                file: '/repo/src/core/example-b.ts',
                functionFound: 5,
                functionHit: 4,
                lineFound: 10,
                lineHit: 9,
            },
            {
                file: '/repo/src/content/runtime.ts',
                functionFound: 50,
                functionHit: 1,
                lineFound: 100,
                lineHit: 1,
            },
        ]);

        expect(summary.linePercent).toBeCloseTo(96.6667, 3);
        expect(summary.functionPercent).toBeCloseTo(93.3333, 3);
        expect(summary.totalLineFound).toBe(30);
        expect(summary.totalLineHit).toBe(29);
        expect(summary.totalFunctionFound).toBe(15);
        expect(summary.totalFunctionHit).toBe(14);
    });

    it('should require the configured thresholds', () => {
        expect(CORE_LINE_THRESHOLD).toBe(99);
        expect(CORE_FUNCTION_THRESHOLD).toBe(99);
    });

    it('should throw when there are no src/core records', () => {
        expect(() =>
            summarizeCoreCoverage([
                {
                    file: '/repo/src/content/runtime.ts',
                    functionFound: 1,
                    functionHit: 1,
                    lineFound: 1,
                    lineHit: 1,
                },
            ]),
        ).toThrow('No src/core coverage records found');
    });
});

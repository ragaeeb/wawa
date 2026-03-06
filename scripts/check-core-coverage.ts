import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const CORE_LINE_THRESHOLD = 99;
export const CORE_FUNCTION_THRESHOLD = 99;
export const DEFAULT_LCOV_PATH = join(process.cwd(), 'coverage', 'lcov.info');

export type CoverageRecord = {
    file: string;
    lineFound: number;
    lineHit: number;
    functionFound: number;
    functionHit: number;
};

export type CoverageSummary = {
    linePercent: number;
    functionPercent: number;
    totalLineFound: number;
    totalLineHit: number;
    totalFunctionFound: number;
    totalFunctionHit: number;
};

const normalizeFilePath = (file: string) => {
    return file.replaceAll('\\', '/');
};

const createEmptyRecord = (file: string): CoverageRecord => ({
    file,
    lineFound: 0,
    lineHit: 0,
    functionFound: 0,
    functionHit: 0,
});

const applyCoverageValue = (record: CoverageRecord, prefix: string, value: string) => {
    const parsedValue = Number(value) || 0;

    switch (prefix) {
        case 'LF':
            record.lineFound = parsedValue;
            return;
        case 'LH':
            record.lineHit = parsedValue;
            return;
        case 'FNF':
            record.functionFound = parsedValue;
            return;
        case 'FNH':
            record.functionHit = parsedValue;
            return;
        default:
            return;
    }
};

export const parseLcovCoverage = (lcov: string) => {
    const records: CoverageRecord[] = [];
    let current: CoverageRecord | null = null;

    for (const rawLine of lcov.split('\n')) {
        const line = rawLine.trim();

        if (line.startsWith('SF:')) {
            if (current) {
                records.push(current);
            }

            current = createEmptyRecord(normalizeFilePath(line.slice(3)));
            continue;
        }

        if (!current) {
            continue;
        }

        if (line === 'end_of_record') {
            records.push(current);
            current = null;
            continue;
        }

        const delimiterIndex = line.indexOf(':');
        if (delimiterIndex < 0) {
            continue;
        }

        applyCoverageValue(current, line.slice(0, delimiterIndex), line.slice(delimiterIndex + 1));
    }

    if (current) {
        records.push(current);
    }

    return records;
};

export const summarizeCoreCoverage = (records: CoverageRecord[]): CoverageSummary => {
    const coreRecords = records.filter((record) => {
        const file = normalizeFilePath(record.file);
        return file === 'src/core' || file.startsWith('src/core/') || file.includes('/src/core/');
    });

    if (coreRecords.length === 0) {
        throw new Error('No src/core coverage records found in lcov report.');
    }

    const totalLineFound = coreRecords.reduce((sum, record) => sum + record.lineFound, 0);
    const totalLineHit = coreRecords.reduce((sum, record) => sum + record.lineHit, 0);
    const totalFunctionFound = coreRecords.reduce((sum, record) => sum + record.functionFound, 0);
    const totalFunctionHit = coreRecords.reduce((sum, record) => sum + record.functionHit, 0);

    return {
        linePercent: totalLineFound === 0 ? 100 : (totalLineHit / totalLineFound) * 100,
        functionPercent: totalFunctionFound === 0 ? 100 : (totalFunctionHit / totalFunctionFound) * 100,
        totalLineFound,
        totalLineHit,
        totalFunctionFound,
        totalFunctionHit,
    };
};

export const checkCoreCoverage = (lcovPath = DEFAULT_LCOV_PATH) => {
    const records = parseLcovCoverage(readFileSync(lcovPath, 'utf8'));
    const summary = summarizeCoreCoverage(records);

    if (summary.linePercent < CORE_LINE_THRESHOLD || summary.functionPercent < CORE_FUNCTION_THRESHOLD) {
        throw new Error(
            `Core coverage gate failed: lines ${summary.linePercent.toFixed(2)}% (need ${CORE_LINE_THRESHOLD}%), functions ${summary.functionPercent.toFixed(2)}% (need ${CORE_FUNCTION_THRESHOLD}%).`,
        );
    }

    return summary;
};

if (import.meta.main) {
    const summary = checkCoreCoverage();

    console.log(
        `Core coverage OK: lines ${summary.linePercent.toFixed(2)}% (${summary.totalLineHit}/${summary.totalLineFound}), functions ${summary.functionPercent.toFixed(2)}% (${summary.totalFunctionHit}/${summary.totalFunctionFound})`,
    );
}

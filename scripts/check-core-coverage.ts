import { readFileSync } from 'node:fs';

const LCOV_PATH = 'coverage/lcov.info';
const THRESHOLD = Number.parseFloat(process.env.CORE_COVERAGE_THRESHOLD ?? '99');

type CoverageTotals = {
    lineFound: number;
    lineHit: number;
    fnFound: number;
    fnHit: number;
};

const parseLcov = (lcov: string): CoverageTotals => {
    const totals: CoverageTotals = {
        lineFound: 0,
        lineHit: 0,
        fnFound: 0,
        fnHit: 0,
    };

    const records = lcov.split('end_of_record');

    for (const record of records) {
        const lines = record.trim().split('\n');
        if (lines.length === 0) {
            continue;
        }

        const sourceLine = lines.find((line) => line.startsWith('SF:'));
        if (!sourceLine) {
            continue;
        }

        const sourcePath = sourceLine.slice(3).replaceAll('\\', '/');
        if (!sourcePath.includes('src/core/')) {
            continue;
        }

        const lineFound = Number.parseInt(lines.find((line) => line.startsWith('LF:'))?.slice(3) ?? '0', 10);
        const lineHit = Number.parseInt(lines.find((line) => line.startsWith('LH:'))?.slice(3) ?? '0', 10);
        const fnFound = Number.parseInt(lines.find((line) => line.startsWith('FNF:'))?.slice(4) ?? '0', 10);
        const fnHit = Number.parseInt(lines.find((line) => line.startsWith('FNH:'))?.slice(4) ?? '0', 10);

        totals.lineFound += lineFound;
        totals.lineHit += lineHit;
        totals.fnFound += fnFound;
        totals.fnHit += fnHit;
    }

    return totals;
};

const percent = (hit: number, found: number): number => {
    if (found === 0) {
        return 100;
    }
    return (hit / found) * 100;
};

const lcov = readFileSync(LCOV_PATH, 'utf8');
const totals = parseLcov(lcov);

const linePct = percent(totals.lineHit, totals.lineFound);
const fnPct = percent(totals.fnHit, totals.fnFound);

console.log(
    `[coverage] core lines: ${linePct.toFixed(2)}% (${totals.lineHit}/${totals.lineFound}), core funcs: ${fnPct.toFixed(2)}% (${totals.fnHit}/${totals.fnFound})`,
);

if (linePct < THRESHOLD || fnPct < THRESHOLD) {
    console.error(
        `[coverage] threshold failed: expected >= ${THRESHOLD.toFixed(2)}% for both lines and functions in src/core`,
    );
    process.exit(1);
}

console.log(`[coverage] threshold passed (>= ${THRESHOLD.toFixed(2)}%)`);

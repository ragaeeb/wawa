import type { ExportMeta, MergeInfo } from '@/types/domain';

export type BuildMetaInput = {
    username: string;
    userId?: string;
    name?: string;
    startedAt: string;
    completedAt: string;
    newCollectedCount: number;
    previousCollectedCount: number;
    reportedCountCurrent?: number | null;
    previousMeta?: ExportMeta | null;
    collectionMethod: string;
    scrollResponsesCapturedCurrent: number;
    mergeInfo?: MergeInfo | null;
};

const parseIsoDate = (value: string | undefined): Date | null => {
    if (!value) {
        return null;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const earliestIsoDate = (...values: Array<string | undefined>): string | undefined => {
    const dates = values
        .map((value) => parseIsoDate(value))
        .filter((value): value is Date => value !== null)
        .sort((a, b) => a.getTime() - b.getTime());

    return dates[0]?.toISOString();
};

const extractPreviousReportedCount = (previousMeta: ExportMeta | null | undefined): number => {
    if (!previousMeta) {
        return Number.NaN;
    }

    const reportedField = typeof previousMeta.reported_count === 'number' ? previousMeta.reported_count : Number.NaN;
    const totalReportedField =
        typeof previousMeta.total_tweets_reported === 'number' ? previousMeta.total_tweets_reported : Number.NaN;

    return Number(Number.isFinite(reportedField) ? reportedField : totalReportedField);
};

const calculateBestReportedCount = (
    currentReported: number | null | undefined,
    previousReported: number,
): number | null => {
    const candidates = [currentReported, previousReported].filter(
        (value): value is number => Number.isFinite(value as number) && Number(value) > 0,
    );

    return candidates.length > 0 ? Math.max(...candidates) : null;
};

const extractPreviousScrollResponsesCaptured = (previousMeta: ExportMeta | null | undefined): number => {
    const priorCaptured = Number(previousMeta?.scroll_responses_captured ?? Number.NaN);
    return Number.isFinite(priorCaptured) && priorCaptured > 0 ? priorCaptured : 0;
};

const extractPreviousStartedAt = (previousMeta: ExportMeta | null | undefined): string | undefined => {
    if (!previousMeta) {
        return undefined;
    }

    return typeof previousMeta.export_started_at === 'string'
        ? previousMeta.export_started_at
        : typeof previousMeta.started_at === 'string'
          ? previousMeta.started_at
          : undefined;
};

const extractPreviousCompletedAt = (previousMeta: ExportMeta | null | undefined): string | undefined => {
    if (!previousMeta) {
        return undefined;
    }

    return typeof previousMeta.export_completed_at === 'string'
        ? previousMeta.export_completed_at
        : typeof previousMeta.finished_at === 'string'
          ? previousMeta.finished_at
          : undefined;
};

const calculateConsolidatedCount = (input: BuildMetaInput): number => {
    return input.mergeInfo ? input.mergeInfo.final_count : input.newCollectedCount + input.previousCollectedCount;
};

const calculateTotalScrollResponsesCaptured = (input: BuildMetaInput, previousCaptured: number): number => {
    return input.scrollResponsesCapturedCurrent + (input.mergeInfo ? previousCaptured : 0);
};

export const buildConsolidatedMeta = (input: BuildMetaInput): ExportMeta => {
    const previousReported = extractPreviousReportedCount(input.previousMeta);
    const reportedCount = calculateBestReportedCount(input.reportedCountCurrent, previousReported);
    const previousCaptured = extractPreviousScrollResponsesCaptured(input.previousMeta);
    const previousStartedAt = extractPreviousStartedAt(input.previousMeta);
    const previousCompletedAt = extractPreviousCompletedAt(input.previousMeta);

    const effectiveStart = earliestIsoDate(previousStartedAt, input.startedAt) ?? input.startedAt;
    const consolidatedCount = calculateConsolidatedCount(input);
    const totalScrollResponses = calculateTotalScrollResponsesCaptured(input, previousCaptured);

    const meta: ExportMeta = {
        username: input.username,
        export_started_at: effectiveStart,
        export_completed_at: input.completedAt,
        collected_count: consolidatedCount,
        new_collected_count: input.newCollectedCount,
        previous_collected_count: input.previousCollectedCount,
        reported_count: reportedCount,
        collection_method: input.collectionMethod,
        scroll_responses_captured: totalScrollResponses,
    };

    if (input.userId) {
        meta.user_id = input.userId;
    }
    if (input.name) {
        meta.name = input.name;
    }
    if (previousStartedAt) {
        meta.previous_export_started_at = previousStartedAt;
    }
    if (previousCompletedAt) {
        meta.previous_export_completed_at = previousCompletedAt;
    }
    if (input.mergeInfo) {
        meta.merge_info = input.mergeInfo;
    }

    return meta;
};

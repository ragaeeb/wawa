import type { ExportMeta, MergeInfo } from "../../types/domain";

export interface BuildMetaInput {
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
}

function parseIsoDate(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function earliestIsoDate(...values: Array<string | undefined>): string | undefined {
  const dates = values
    .map((value) => parseIsoDate(value))
    .filter((value): value is Date => value !== null)
    .sort((a, b) => a.getTime() - b.getTime());

  return dates[0]?.toISOString();
}

export function buildConsolidatedMeta(input: BuildMetaInput): ExportMeta {
  const previous = input.previousMeta;
  const previousReportedField =
    typeof previous?.reported_count === "number" ? previous.reported_count : Number.NaN;
  const previousTotalReportedField =
    typeof previous?.total_tweets_reported === "number"
      ? previous.total_tweets_reported
      : Number.NaN;
  const previousReported = Number(
    Number.isFinite(previousReportedField) ? previousReportedField : previousTotalReportedField,
  );

  const reportedCandidates = [input.reportedCountCurrent, previousReported].filter(
    (value): value is number => Number.isFinite(value as number) && Number(value) > 0,
  );

  const priorCaptured = Number(previous?.scroll_responses_captured ?? Number.NaN);
  const priorCapturedSafe = Number.isFinite(priorCaptured) && priorCaptured > 0 ? priorCaptured : 0;

  const previousStartedAt =
    typeof previous?.export_started_at === "string"
      ? previous.export_started_at
      : typeof previous?.started_at === "string"
        ? previous.started_at
        : undefined;

  const previousCompletedAt =
    typeof previous?.export_completed_at === "string"
      ? previous.export_completed_at
      : typeof previous?.finished_at === "string"
        ? previous.finished_at
        : undefined;

  const effectiveStart = earliestIsoDate(previousStartedAt, input.startedAt) ?? input.startedAt;
  const consolidatedCount = input.mergeInfo
    ? input.mergeInfo.final_count
    : input.newCollectedCount + input.previousCollectedCount;

  const meta: ExportMeta = {
    username: input.username,
    export_started_at: effectiveStart,
    export_completed_at: input.completedAt,
    collected_count: consolidatedCount,
    new_collected_count: input.newCollectedCount,
    previous_collected_count: input.previousCollectedCount,
    reported_count: reportedCandidates.length > 0 ? Math.max(...reportedCandidates) : null,
    collection_method: input.collectionMethod,
    scroll_responses_captured:
      input.scrollResponsesCapturedCurrent + (input.mergeInfo ? priorCapturedSafe : 0),
  };

  if (input.userId) meta.user_id = input.userId;
  if (input.name) meta.name = input.name;
  if (previousStartedAt) meta.previous_export_started_at = previousStartedAt;
  if (previousCompletedAt) meta.previous_export_completed_at = previousCompletedAt;
  if (input.mergeInfo) meta.merge_info = input.mergeInfo;

  return meta;
}

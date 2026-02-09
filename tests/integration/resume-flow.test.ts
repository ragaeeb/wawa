import { describe, expect, it } from "bun:test";
import { buildConsolidatedMeta } from "../../src/core/export/meta";
import { mergeTweets } from "../../src/core/resume/merge";
import { parseResumeInput } from "../../src/core/resume/payload";

describe("resume flow integration", () => {
  it("should parse prior export, merge with new tweets, and create accurate top metadata", () => {
    const priorExport = {
      meta: {
        username: "example",
        export_started_at: "2026-02-01T10:00:00.000Z",
        export_completed_at: "2026-02-01T11:00:00.000Z",
        reported_count: 1200,
        scroll_responses_captured: 12,
      },
      items: [
        { id: "1", created_at: "2026-01-01 00:00:00", text: "old" },
        { id: "2", created_at: "2026-01-02 00:00:00", text: "old 2" },
      ],
    };

    const parsed = parseResumeInput(priorExport);

    const newlyCollected = [
      { id: "2", created_at: "2026-01-02 00:00:00", text: "old 2 updated", view_count: 10 },
      { id: "3", created_at: "2026-01-03 00:00:00", text: "new" },
    ];

    const merged = mergeTweets(newlyCollected, parsed.tweets);

    const meta = buildConsolidatedMeta({
      username: "example",
      userId: "123",
      name: "Example",
      startedAt: "2026-02-08T09:00:00.000Z",
      completedAt: "2026-02-08T10:00:00.000Z",
      newCollectedCount: newlyCollected.length,
      previousCollectedCount: parsed.tweets.length,
      previousMeta: parsed.meta,
      reportedCountCurrent: 1000,
      collectionMethod: "scroll-interception-resumed",
      scrollResponsesCapturedCurrent: 20,
      mergeInfo: merged.mergeInfo,
    });

    expect(merged.tweets.map((item) => item.id)).toEqual(["3", "2", "1"]);
    expect(meta.collected_count).toBe(3);
    expect(meta.reported_count).toBe(1200);
    expect(meta.export_started_at).toBe("2026-02-01T10:00:00.000Z");
  });
});

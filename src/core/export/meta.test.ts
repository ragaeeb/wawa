import { describe, expect, it } from "bun:test";
import { buildConsolidatedMeta } from "./meta";

describe("export metadata assembly", () => {
  it("should build accurate consolidated metadata for resumed exports", () => {
    const meta = buildConsolidatedMeta({
      username: "example",
      userId: "123",
      name: "Example Name",
      startedAt: "2026-02-08T10:00:00.000Z",
      completedAt: "2026-02-08T11:00:00.000Z",
      newCollectedCount: 200,
      previousCollectedCount: 800,
      reportedCountCurrent: 900,
      previousMeta: {
        username: "example",
        export_started_at: "2026-02-07T10:00:00.000Z",
        export_completed_at: "2026-02-07T11:00:00.000Z",
        reported_count: 1000,
        scroll_responses_captured: 20,
      },
      collectionMethod: "scroll-interception-resumed",
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
    expect(meta.export_started_at).toBe("2026-02-07T10:00:00.000Z");
    expect(meta.scroll_responses_captured).toBe(50);
  });
});

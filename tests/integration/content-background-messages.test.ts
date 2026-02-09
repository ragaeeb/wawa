import { describe, expect, it } from "bun:test";
import { createBackgroundService } from "../../src/core/background/service";

describe("background message integration", () => {
  it("should handle log and retrieval message roundtrip", async () => {
    const service = createBackgroundService({
      async get() {
        return { minimalData: true, includeReplies: false, maxCount: 0 };
      },
      async set() {},
    });

    await service.handleMessage({
      type: "log",
      entry: {
        timestamp: "2026-02-08T00:00:00.000Z",
        level: "info",
        message: "hello",
      },
    });

    const logsResponse = await service.handleMessage({ type: "getLogs" });

    expect("logs" in logsResponse).toBe(true);
    if ("logs" in logsResponse) {
      expect(logsResponse.logs).toHaveLength(1);
      expect(logsResponse.logs[0]?.message).toBe("hello");
    }
  });

  it("should read and save settings with typed contract", async () => {
    let saved: Record<string, unknown> = {};

    const service = createBackgroundService({
      async get() {
        return { minimalData: true, includeReplies: true, maxCount: 120 };
      },
      async set(settings) {
        saved = settings;
      },
    });

    const getResult = await service.handleMessage({ type: "getSettings" });
    expect("includeReplies" in getResult).toBe(true);

    const saveResult = await service.handleMessage({
      type: "saveSettings",
      includeReplies: false,
      maxCount: 10,
    });

    expect(saveResult).toEqual({ success: true });
    expect(saved).toEqual({ includeReplies: false, maxCount: 10, minimalData: undefined });
  });
});

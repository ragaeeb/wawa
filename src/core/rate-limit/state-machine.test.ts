import { describe, expect, it } from "bun:test";
import { createInitialLifecycle, reduceExportLifecycle, shouldPromptLooksDone } from "./state";

describe("rate limit lifecycle state machine", () => {
  it("should transition cooldown -> running and reset activity timestamp", () => {
    let state = createInitialLifecycle(1000);
    state = reduceExportLifecycle(state, { type: "start", at: 1100 });
    state = reduceExportLifecycle(state, { type: "enter_cooldown", at: 1200 });

    expect(state.status).toBe("cooldown");

    state = reduceExportLifecycle(state, { type: "exit_cooldown", at: 5000 });
    expect(state.status).toBe("running");
    expect(state.lastActivityAt).toBe(5000);
  });

  it("should transition paused_rate_limit -> running on manual resume", () => {
    let state = createInitialLifecycle(1000);
    state = reduceExportLifecycle(state, { type: "start", at: 1100 });
    state = reduceExportLifecycle(state, { type: "pause_rate_limit", at: 2000 });

    expect(state.status).toBe("paused_rate_limit");

    state = reduceExportLifecycle(state, { type: "resume_manual", at: 9000 });
    expect(state.status).toBe("running");
    expect(state.lastActivityAt).toBe(9000);
  });

  it("should not mark looks-done immediately after cooldown/manual resume", () => {
    let state = createInitialLifecycle(1000);
    state = reduceExportLifecycle(state, { type: "start", at: 1000 });
    state = reduceExportLifecycle(state, { type: "enter_cooldown", at: 2000 });
    state = reduceExportLifecycle(state, { type: "exit_cooldown", at: 10000 });

    const shouldPrompt = shouldPromptLooksDone(state, {
      now: 10010,
      idleThresholdMs: 30000,
      scrollCount: 100,
      responsesCaptured: 40,
      heightStable: true,
    });

    expect(shouldPrompt).toBe(false);
  });
});

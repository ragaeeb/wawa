export type ExportLifecycleState =
  | "idle"
  | "running"
  | "cooldown"
  | "paused_rate_limit"
  | "pending_done"
  | "cancelled"
  | "completed";

export interface ExportLifecycleSnapshot {
  status: ExportLifecycleState;
  lastActivityAt: number;
}

export type ExportLifecycleAction =
  | { type: "start"; at?: number }
  | { type: "activity"; at?: number }
  | { type: "enter_cooldown"; at?: number }
  | { type: "exit_cooldown"; at?: number }
  | { type: "pause_rate_limit"; at?: number }
  | { type: "resume_manual"; at?: number }
  | { type: "mark_pending_done" }
  | { type: "cancel" }
  | { type: "complete" };

function now(actionAt?: number): number {
  return actionAt ?? Date.now();
}

export function createInitialLifecycle(at?: number): ExportLifecycleSnapshot {
  return {
    status: "idle",
    lastActivityAt: now(at),
  };
}

export function reduceExportLifecycle(
  state: ExportLifecycleSnapshot,
  action: ExportLifecycleAction,
): ExportLifecycleSnapshot {
  switch (action.type) {
    case "start":
      return { status: "running", lastActivityAt: now(action.at) };

    case "activity":
      return { ...state, lastActivityAt: now(action.at) };

    case "enter_cooldown":
      return { ...state, status: "cooldown" };

    case "exit_cooldown":
      return { status: "running", lastActivityAt: now(action.at) };

    case "pause_rate_limit":
      return { ...state, status: "paused_rate_limit" };

    case "resume_manual":
      return { status: "running", lastActivityAt: now(action.at) };

    case "mark_pending_done":
      return { ...state, status: "pending_done" };

    case "cancel":
      return { ...state, status: "cancelled" };

    case "complete":
      return { ...state, status: "completed" };

    default:
      return state;
  }
}

export interface LooksDoneParams {
  now: number;
  idleThresholdMs: number;
  scrollCount: number;
  responsesCaptured: number;
  heightStable: boolean;
}

export function shouldPromptLooksDone(
  state: ExportLifecycleSnapshot,
  params: LooksDoneParams,
): boolean {
  if (state.status !== "running") return false;
  if (params.responsesCaptured <= 0) return false;
  if (params.scrollCount <= 10) return false;
  if (!params.heightStable) return false;

  const idleFor = params.now - state.lastActivityAt;
  return idleFor > params.idleThresholdMs;
}

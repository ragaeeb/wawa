/**
 * Export lifecycle state machine for managing rate limits and workflow states.
 *
 * This module implements a finite state machine (FSM) to track export progress
 * through various states (idle → running → cooldown → paused → completed).
 *
 * The state machine prevents race conditions and ensures clean state transitions
 * during complex asynchronous operations like rate limit handling and user pauses.
 */

/**
 * All possible states in the export lifecycle.
 *
 * State transitions:
 * ```
 * idle
 *   ↓ (start)
 * running
 *   ↓ (enter_cooldown)        ↓ (pause_rate_limit)    ↓ (mark_pending_done)
 * cooldown                 paused_rate_limit         pending_done
 *   ↓ (exit_cooldown)          ↓ (resume_manual)        ↓ (complete)
 * running                    running                  completed
 *   ↓ (cancel)
 * cancelled
 * ```
 */
export type ExportLifecycleState =
    /** No export in progress; initial state */
    | 'idle'

    /** Export actively collecting tweets */
    | 'running'

    /** Proactive pause to avoid hitting rate limits (auto-resumes after delay) */
    | 'cooldown'

    /** Hard rate limit hit (HTTP 429); requires manual user intervention */
    | 'paused_rate_limit'

    /** Export appears complete; awaiting user confirmation */
    | 'pending_done'

    /** Export cancelled by user */
    | 'cancelled'

    /** Export successfully completed */
    | 'completed';

/**
 * Immutable state snapshot for the export lifecycle.
 *
 * @example
 * ```typescript
 * const state: ExportLifecycleSnapshot = {
 *   status: "running",
 *   lastActivityAt: Date.now()
 * };
 *
 * // Check if export is idle:
 * if (state.status === "idle") {
 *   console.log("No export in progress");
 * }
 *
 * // Check if export is stuck (no activity for 5 minutes):
 * const idleTime = Date.now() - state.lastActivityAt;
 * if (idleTime > 300000 && state.status === "running") {
 *   console.log("Export may be stalled");
 * }
 * ```
 */
export type ExportLifecycleSnapshot = {
    /** Current state of the export */
    status: ExportLifecycleState;

    /**
     * Unix timestamp (milliseconds) of last activity.
     *
     * "Activity" includes:
     * - Tweet collection events
     * - Manual user interactions (pause, resume)
     * - State transitions (cooldown → running)
     *
     * Used to detect idle exports and implement "looks done" heuristic.
     */
    lastActivityAt: number;
};

/**
 * Actions that trigger state transitions in the lifecycle FSM.
 *
 * Each action type has an optional `at` timestamp (defaults to Date.now()).
 * This enables deterministic testing and precise activity tracking.
 */
export type ExportLifecycleAction =
    /** User initiates new export */
    | { type: 'start'; at?: number }

    /** Tweet collected or other activity detected (resets idle timer) */
    | { type: 'activity'; at?: number }

    /** Proactive cooldown started (to avoid rate limits) */
    | { type: 'enter_cooldown'; at?: number }

    /** Cooldown period ended, resume collection */
    | { type: 'exit_cooldown'; at?: number }

    /** Hard rate limit hit (HTTP 429 response) */
    | { type: 'pause_rate_limit'; at?: number }

    /** User manually resumes from paused state */
    | { type: 'resume_manual'; at?: number }

    /** Export appears complete (idle + no new data heuristics) */
    | { type: 'mark_pending_done' }

    /** User cancels export */
    | { type: 'cancel' }

    /** Export finalized and saved */
    | { type: 'complete' };

/**
 * Determines the timestamp for an action.
 *
 * @param actionAt - Optional timestamp from action
 * @returns Provided timestamp or current time
 */
const now = (actionAt?: number): number => {
    return actionAt ?? Date.now();
};

/**
 * Creates initial lifecycle state (idle, no activity).
 *
 * @param at - Optional timestamp for initialization (defaults to Date.now())
 * @returns New lifecycle snapshot in idle state
 *
 * @example
 * ```typescript
 * const state = createInitialLifecycle();
 * console.log(state.status); // "idle"
 * console.log(state.lastActivityAt); // ~Date.now()
 *
 * // For testing with deterministic timestamps:
 * const testState = createInitialLifecycle(1000);
 * console.log(testState.lastActivityAt); // 1000
 * ```
 */
export const createInitialLifecycle = (at?: number): ExportLifecycleSnapshot => {
    return {
        status: 'idle',
        lastActivityAt: now(at),
    };
};

/**
 * Pure reducer function for state transitions (follows Redux pattern).
 *
 * Takes current state + action → returns new state (no mutations).
 *
 * Transition Rules:
 * - `start`: idle → running (reset activity)
 * - `activity`: any state → same state (update lastActivityAt)
 * - `enter_cooldown`: running → cooldown (preserve activity)
 * - `exit_cooldown`: cooldown → running (reset activity)
 * - `pause_rate_limit`: any state → paused_rate_limit
 * - `resume_manual`: paused_rate_limit → running (reset activity)
 * - `mark_pending_done`: running → pending_done
 * - `cancel`: any state → cancelled
 * - `complete`: any state → completed
 *
 * @param state - Current lifecycle snapshot
 * @param action - Action to apply
 * @returns New lifecycle snapshot with updated state
 *
 * @example
 * ```typescript
 * let state = createInitialLifecycle(1000);
 *
 * // Start export:
 * state = reduceExportLifecycle(state, { type: "start", at: 1100 });
 * console.log(state.status); // "running"
 * console.log(state.lastActivityAt); // 1100
 *
 * // Enter cooldown:
 * state = reduceExportLifecycle(state, { type: "enter_cooldown", at: 2000 });
 * console.log(state.status); // "cooldown"
 * console.log(state.lastActivityAt); // 1100 (preserved)
 *
 * // Exit cooldown:
 * state = reduceExportLifecycle(state, { type: "exit_cooldown", at: 5000 });
 * console.log(state.status); // "running"
 * console.log(state.lastActivityAt); // 5000 (reset)
 * ```
 *
 * @remarks
 * This function is pure (no side effects) and deterministic, making it easy to test.
 */
export const reduceExportLifecycle = (
    state: ExportLifecycleSnapshot,
    action: ExportLifecycleAction,
): ExportLifecycleSnapshot => {
    switch (action.type) {
        case 'start':
            return { status: 'running', lastActivityAt: now(action.at) };

        case 'activity':
            return { ...state, lastActivityAt: now(action.at) };

        case 'enter_cooldown':
            return { ...state, status: 'cooldown' };

        case 'exit_cooldown':
            return { status: 'running', lastActivityAt: now(action.at) };

        case 'pause_rate_limit':
            return { ...state, status: 'paused_rate_limit' };

        case 'resume_manual':
            return { status: 'running', lastActivityAt: now(action.at) };

        case 'mark_pending_done':
            return { ...state, status: 'pending_done' };

        case 'cancel':
            return { ...state, status: 'cancelled' };

        case 'complete':
            return { ...state, status: 'completed' };

        default:
            return state;
    }
};

/**
 * Parameters for determining if export looks complete.
 *
 * Used by {@link shouldPromptLooksDone} to implement heuristic detection
 * of export completion when Twitter's API stops returning new data.
 */
export type LooksDoneParams = {
    /** Current timestamp (milliseconds) */
    now: number;

    /** Milliseconds of inactivity before considering export "done" (e.g., 30000 = 30 seconds) */
    idleThresholdMs: number;

    /** Number of scroll/fetch operations performed */
    scrollCount: number;

    /** Number of GraphQL responses captured */
    responsesCaptured: number;

    /** Whether page scroll height has stabilized (no new content loading) */
    heightStable: boolean;
};

/**
 * Heuristic to determine if export appears complete.
 *
 * "Looks done" criteria (all must be true):
 * 1. State is "running" (not already paused/completed)
 * 2. At least 1 API response captured (export started)
 * 3. At least 10 scroll operations performed (not too early)
 * 4. Page height stable (no new tweets loading)
 * 5. No activity for idleThresholdMs (typically 30 seconds)
 *
 * This prevents false positives early in exports and after cooldowns/resumes.
 *
 * @param state - Current lifecycle state
 * @param params - Export activity parameters
 * @returns true if export should prompt user for completion
 *
 * @example
 * ```typescript
 * const state: ExportLifecycleSnapshot = {
 *   status: "running",
 *   lastActivityAt: Date.now() - 35000 // 35 seconds ago
 * };
 *
 * const params: LooksDoneParams = {
 *   now: Date.now(),
 *   idleThresholdMs: 30000, // 30 seconds
 *   scrollCount: 50,
 *   responsesCaptured: 45,
 *   heightStable: true
 * };
 *
 * const shouldPrompt = shouldPromptLooksDone(state, params);
 * console.log(shouldPrompt); // true (meets all criteria)
 *
 * // After cooldown (lastActivityAt just reset):
 * const afterCooldown = {
 *   status: "running" as const,
 *   lastActivityAt: Date.now() - 5000 // 5 seconds ago
 * };
 *
 * const shouldPrompt2 = shouldPromptLooksDone(afterCooldown, params);
 * console.log(shouldPrompt2); // false (not idle long enough)
 * ```
 *
 * @remarks
 * This heuristic prevents:
 * - Premature "done" prompts during rate limit cooldowns
 * - False positives after manual resume (user expects more data)
 * - Triggering on tiny exports (<10 scroll operations)
 */
export const shouldPromptLooksDone = (state: ExportLifecycleSnapshot, params: LooksDoneParams): boolean => {
    if (state.status !== 'running') {
        return false;
    }
    if (params.responsesCaptured <= 0) {
        return false;
    }
    if (params.scrollCount <= 10) {
        return false;
    }
    if (!params.heightStable) {
        return false;
    }

    const idleFor = params.now - state.lastActivityAt;
    return idleFor > params.idleThresholdMs;
};

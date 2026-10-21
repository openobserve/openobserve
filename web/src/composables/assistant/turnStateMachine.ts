// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import type { TurnOutcomeRecord } from "@/ts/interfaces/chat";
import type { I18nKey, I18nText, TranslateFn } from "@/types/i18n";
import { sqlStreamOf } from "@/utils/assistant/explorerRoutes";

import {
  ERROR_LEDGER,
  isAssistantErrorCode,
  toAssistantError,
  type ProviderReason,
} from "./assistantErrors";
import type {
  AssistantError,
  AssistantErrorAction,
  AssistantErrorCode,
  TurnMeta,
} from "./assistantStore.types";
import type { AssistantFrame } from "./frames";
import {
  isTerminal,
  type TurnClientEvent,
  type TurnEvent,
  type TurnState,
  type TurnTerminal,
} from "./turnStates";

// WP-01's TurnMeta has no slot for the stall, the approval pause, "Caught up" or an unconfirmed cancel.
declare module "./assistantStore.types" {
  interface TurnMeta {
    lastFrameAt?: number | null;
    pausedAt?: number | null;
    pausedMs?: number;
    caughtUpAt?: number | null;
    cancelUnconfirmed?: boolean;
    restored?: boolean;
    compacted?: boolean;
    /** B-02 `retrying`: the agent is calling the provider again; cleared by the next answer frame. */
    retrying?: { attempt: number; reason?: string; retryAfterMs?: number; at: number } | null;
    /** B-02 `compacting`: earlier messages are being condensed; cleared by the next answer frame. */
    compacting?: boolean;
    /** When the turn ended; a refusal's `retry_after` counts from it in every container that shows it. */
    endedAt?: number | null;
  }
}

/** No frame of any kind for this long shows "No response for {n} s" (HT-01 AC 3). */
export const STALL_MS = 30_000;

export const ELAPSED_AFTER_MS = 5_000;

/** Stopping becomes stopped after the cancel ack or this long (HT-04 AC 3). */
export const STOP_TIMEOUT_MS = 3_000;

export const CAUGHT_UP_MS = 2_000;

export const MAX_RECONNECTS = 3;

const CLIENT_EVENTS: ReadonlySet<string> = new Set<TurnClientEvent["type"]>([
  "send",
  "admitted",
  "first_byte",
  "keepalive",
  "stop",
  "cancel_acked",
  "consent_enable",
  "consent_cancel",
  "approval_decided",
  "approval_expired",
  "tail_caught_up",
  "eof",
  "fetch_error",
  "signed_out",
]);

/** Frames that only prove the agent is working: they move `connecting` to thinking and nothing else. */
const QUIET_FRAMES: ReadonlySet<string> = new Set([
  "status",
  "title",
  "usage",
  "turn_started",
  "retrying",
  "compacting",
  "query",
  "findings",
  "resource_changed",
  "confirmation_resolved",
  "navigation_action",
  "permission_denied",
  "sync",
  "sync_state",
]);

const STATUS_KEYS: Partial<Record<TurnState["state"], I18nKey>> = {
  queued: "assistant.turn.sending",
  connecting: "assistant.turn.connecting",
  "responding.thinking": "assistant.turn.thinking",
  "responding.writing": "assistant.turn.writing",
  awaiting_approval: "assistant.turn.waitingApproval",
  awaiting_consent: "assistant.turn.waitingConsent",
  reconnecting: "assistant.turn.reconnecting",
  stopping: "assistant.turn.stopping",
};

// The approval and consent cards announce themselves with their title, expiry and org.
const ANNOUNCED: ReadonlySet<TurnState["state"]> = new Set([
  "queued",
  "connecting",
  "responding.writing",
  "reconnecting",
  "stopping",
]);

const NO_ELAPSED: ReadonlySet<TurnState["state"]> = new Set(["queued", "reconnecting", "stopping"]);

// Frames that prove the provider answered, so a pending retry or compaction line is over.
const PROGRESS_FRAMES: ReadonlySet<string> = new Set([
  "message_delta",
  "message",
  "tool_call",
  "tool_result",
  "step",
]);

const STEP_ENDS: ReadonlySet<string> = new Set(["done", "failed", "interrupted"]);

const STEP_KEYS: Record<string, I18nKey> = {
  SearchSQL: "assistant.step.SearchSQL",
  StreamSchema: "assistant.step.StreamSchema",
  StreamList: "assistant.step.StreamList",
  SearchPromQL: "assistant.step.SearchPromQL",
  TraceSearch: "assistant.step.TraceSearch",
};

const TARGETED_STEPS: ReadonlySet<string> = new Set(["SearchSQL", "StreamSchema"]);

// The actions a stored outcome may name; anything else falls back to its code's row.
const OUTCOME_ACTIONS: ReadonlySet<string> = new Set<AssistantErrorAction>([
  "retry",
  "sign_in",
  "ask_admin",
  "open_iam_roles",
  "open_settings",
  "manage_usage",
  "view_plans",
  "stop_it",
  "reload_chat",
  "edit_resend",
  "retry_save",
  "ask_again",
  "send_again",
  "change_level",
  "none",
]);

const REASONS: ReadonlySet<string> = new Set<ProviderReason>([
  "overloaded",
  "timed_out",
  "model_unavailable",
  "request_too_large",
]);

const REASON_KEYS: Record<ProviderReason, I18nKey> = {
  overloaded: "assistant.error.provider_error.reason.overloaded",
  timed_out: "assistant.error.provider_error.reason.timedOut",
  model_unavailable: "assistant.error.provider_error.reason.modelUnavailable",
  request_too_large: "assistant.error.provider_error.reason.requestTooLarge",
};

/** What the pure reducer needs beyond the event; the engine supplies it from the stream state. */
export interface TurnReducerCtx {
  now: number;
  /** Steps of the current answer, for `stopped{steps}` and the empty-turn rule. */
  steps?: number;
  /** Text or a card streamed, for `stopped{partial}` and the empty-turn rule. */
  partial?: boolean;
  /** The one `session_owner_unavailable` restore is still unused (constraint 11). */
  canRestore?: boolean;
  /** False when the cancel failed or timed out (HT-04 AC 4). */
  cancelConfirmed?: boolean;
  /** The values the error titles name (`{org}`, `{product}`, `{elapsed}`, `{reason}`). */
  copy?: TurnCopy;
}

export interface TurnCopy {
  t?: TranslateFn;
  org?: string;
  product?: string;
  elapsedMs?: number;
}

export type TurnEndOutcome = "done" | "done_not_saved" | "stopped" | "failed" | "refused" | "lost";

/** Everything a transition asks for; `effects.ts` and the engine are the only ones that act on them. */
export type TurnEffect =
  | { kind: "track_sent" }
  | { kind: "track_admitted" }
  | { kind: "track_first_byte" }
  | {
      kind: "track_state";
      state: "running_tool" | "awaiting_approval" | "awaiting_consent" | "reconnecting";
      tool?: string;
    }
  | { kind: "track_ended"; outcome: TurnEndOutcome; error: AssistantError | null }
  | { kind: "track_stop"; partial: boolean }
  | { kind: "announce"; key: I18nKey; params?: Record<string, unknown> }
  | { kind: "meta"; patch: Partial<TurnMeta> }
  | { kind: "pause" }
  | { kind: "resume" }
  | { kind: "restore_draft" }
  | { kind: "cancel" }
  | { kind: "restore" }
  | { kind: "reconnect"; attempt: number }
  | { kind: "consent"; error: AssistantError }
  | { kind: "capability"; note: "forbidden" | "agent_unavailable" | "admitted" }
  | { kind: "not_saved" }
  | { kind: "save" };

/** The status row of a live turn; `null` for idle and every terminal (the outcome block owns those). */
export interface TurnStatusText {
  line: I18nText;
  second?: I18nText;
  tone: "neutral" | "warning";
}

type Step = { state: TurnState; effects: TurnEffect[] };

/** One transition of `00` §5.3; pure, so the same table drives the live chat, the helper and RCA. */
export function turnReducer(
  turn: TurnState,
  event: TurnEvent,
  ctx: TurnReducerCtx,
): { turn: TurnState; effects: TurnEffect[] } {
  const frame = CLIENT_EVENTS.has(event.type) ? null : (event as AssistantFrame);
  const next = frame
    ? onFrame(turn, frame, ctx)
    : onClientEvent(turn, event as TurnClientEvent, ctx);
  const meta = frame && isLive(next.state) ? lifecycleMeta(frame, ctx.now) : null;
  const effects = [...next.effects, ...entryEffects(turn, next.state)];
  return { turn: next.state, effects: meta ? [...effects, meta] : effects };
}

/** The only source of status copy (HT-01); `now` is injected so elapsed never comes from a component timer. */
export function turnStatusText(
  turn: TurnState,
  meta: TurnMeta,
  t: TranslateFn,
  now: number,
): TurnStatusText | null {
  if (turn.state === "idle" || isTerminal(turn)) return null;
  const line = statusLine(turn, meta, t, now);
  const silentMs = now - (meta.lastFrameAt ?? meta.startedAt ?? now);
  const watching = !turn.state.startsWith("awaiting") && turn.state !== "stopping";
  if (watching && silentMs >= STALL_MS) {
    const n = Math.floor(silentMs / 1000);
    return { line, second: t("assistant.turn.noResponse", { n }), tone: "warning" };
  }
  return { line, tone: "neutral" };
}

/** The `assistant.step.*` label of a tool; "Running {tool}" when no template fits. */
export function stepLabel(
  tool: string,
  target: string | null,
): { key: I18nKey; params: Record<string, unknown> } {
  const key = STEP_KEYS[tool];
  if (key && (!TARGETED_STEPS.has(tool) || target)) return { key, params: { stream: target } };
  const verb = mutationVerb(tool);
  if (verb && target) return { key: `assistant.step.${verb}`, params: { resource: target } };
  return { key: "assistant.step.fallback", params: { tool } };
}

/** The step label of a stored `tool_call` block, read from its context as the live status row reads its frame. */
export function stepLabelOf(
  tool: string,
  context: Record<string, unknown> | undefined,
): { key: I18nKey; params: Record<string, unknown> } {
  return stepLabel(tool, targetOf(context));
}

/** `ai_turn_ended.outcome` of a terminal (`99` §3.3). */
export function outcomeOf(terminal: TurnTerminal): TurnEndOutcome {
  if (terminal.state === "done") return terminal.saved === "not_saved" ? "done_not_saved" : "done";
  if (terminal.state === "failed")
    return terminal.error.code === "stream_dropped" ? "lost" : "failed";
  return terminal.state;
}

/** Elapsed since `queued`, paused while the turn waits on the user (HT-01 AC 4). */
export function elapsedMs(meta: TurnMeta, now: number): number {
  if (meta.startedAt === null) return 0;
  return Math.max(0, (meta.pausedAt ?? now) - meta.startedAt - (meta.pausedMs ?? 0));
}

/** The stored block of a turn that did not simply answer (`30` §4.2); `null` for an answer and a refusal, which store nothing. */
export function outcomeRecordOf(
  terminal: TurnTerminal,
  ids: {
    at: number;
    turnId?: string;
    sessionId?: string;
    traceId?: string | null;
    cancelUnconfirmed?: boolean;
    elapsedMs?: number;
  },
): TurnOutcomeRecord | null {
  if (terminal.state === "stopped")
    return {
      kind: "stopped",
      steps: terminal.steps,
      at: ids.at,
      ...(ids.cancelUnconfirmed && { cancelUnconfirmed: true }),
      ...(ids.turnId && { turnId: ids.turnId }),
    };
  if (terminal.state !== "failed") return null;
  const { error } = terminal;
  const kind =
    error.code === "cancelled_elsewhere"
      ? "cancelledElsewhere"
      : error.code === "approval_expired"
        ? "expired"
        : "failed";
  const traceId = error.traceId ?? ids.traceId ?? undefined;
  return {
    kind,
    code: error.code,
    action: error.action,
    retryable: error.retryable,
    at: ids.at,
    ...(ids.elapsedMs !== undefined && { elapsedMs: ids.elapsedMs }),
    ...(error.httpStatus !== undefined && { httpStatus: error.httpStatus }),
    ...(traceId && { traceId }),
    ...((error.turnId ?? ids.turnId) && { turnId: error.turnId ?? ids.turnId }),
    ...((error.sessionId ?? ids.sessionId) && { sessionId: error.sessionId ?? ids.sessionId }),
    ...(error.serverMessage && { serverMessage: error.serverMessage }),
    ...(error.reason && { reason: error.reason }),
  };
}

/** The ledger error an outcome block names; an unknown stored code reads as `unknown` (constraint 12). */
export function outcomeError(record: TurnOutcomeRecord): AssistantError {
  const code = isAssistantErrorCode(record.code) ? record.code : "unknown";
  const row = ERROR_LEDGER[code];
  const action =
    record.action && OUTCOME_ACTIONS.has(record.action)
      ? (record.action as AssistantErrorAction)
      : row.action;
  const error: AssistantError = {
    code,
    phase: "post_admission",
    retryable: record.retryable ?? row.retryable,
    action,
  };
  if (record.httpStatus !== undefined) error.httpStatus = record.httpStatus;
  if (record.traceId) error.traceId = record.traceId;
  if (record.turnId) error.turnId = record.turnId;
  if (record.sessionId) error.sessionId = record.sessionId;
  if (record.serverMessage) error.serverMessage = record.serverMessage;
  if (record.reason && REASONS.has(record.reason)) error.reason = record.reason as ProviderReason;
  return error;
}

export function errorTitleKey(code: AssistantErrorCode): I18nKey {
  return `assistant.error.${code}.title`;
}

/** The title key and its params of an error; a provider failure without a known reason has its own title. */
export function errorTitle(
  error: AssistantError,
  copy: TurnCopy = {},
): { key: I18nKey; params: Record<string, unknown> } {
  const params: Record<string, unknown> = {};
  if (copy.org !== undefined) params.org = copy.org;
  if (copy.product !== undefined) params.product = copy.product;
  if (copy.t && copy.elapsedMs !== undefined) params.elapsed = elapsedText(copy.elapsedMs, copy.t);
  // A `retry_after` countdown is on the button, so the title gives no estimate of its own.
  if (error.code === "rate_limited" && error.retryAfterMs)
    return { key: "assistant.error.rate_limited.titleTimed", params };
  if (error.code !== "provider_error") return { key: errorTitleKey(error.code), params };
  if (!error.reason) return { key: "assistant.error.provider_error.titleNoReason", params };
  if (copy.t) params.reason = copy.t(REASON_KEYS[error.reason]);
  return { key: errorTitleKey(error.code), params };
}

function onClientEvent(turn: TurnState, event: TurnClientEvent, ctx: TurnReducerCtx): Step {
  switch (event.type) {
    case "send":
      return isLive(turn) ? same(turn) : step({ state: "queued" }, { kind: "track_sent" });
    case "admitted":
      return onAdmitted(turn, event.result, ctx);
    case "first_byte":
      if (turn.state !== "connecting") return same(turn);
      return step(
        { state: "responding.thinking" },
        { kind: "track_first_byte" },
        { kind: "meta", patch: { firstByteAt: ctx.now } },
      );
    case "keepalive":
      return turn.state === "connecting" ? step({ state: "responding.thinking" }) : same(turn);
    case "fetch_error":
      return isLive(turn) && turn.state !== "stopping"
        ? onError(turn, event.error, ctx)
        : same(turn);
    case "eof":
      return onEof(turn, event.hasTail, ctx);
    case "signed_out":
      return isLive(turn) ? end(failure("signed_out", "post_admission"), ctx) : same(turn);
    default:
      return onUserEvent(turn, event, ctx);
  }
}

function onUserEvent(turn: TurnState, event: TurnClientEvent, ctx: TurnReducerCtx): Step {
  switch (event.type) {
    case "stop":
      if (turn.state === "awaiting_consent") return declined(ctx);
      if (turn.state === "queued") return withdrawn();
      if (!isLive(turn) || turn.state === "stopping") return same(turn);
      return step({ state: "stopping" }, { kind: "cancel" });
    case "cancel_acked":
      return turn.state === "stopping" ? stopped(ctx) : same(turn);
    case "consent_enable":
      return turn.state === "awaiting_consent" ? step({ state: "queued" }) : same(turn);
    case "consent_cancel":
      return turn.state === "awaiting_consent" ? declined(ctx) : same(turn);
    case "approval_decided":
      return turn.state === "awaiting_approval" && turn.callId === event.callId
        ? step({ state: "responding.thinking" })
        : same(turn);
    case "approval_expired":
      return turn.state === "awaiting_approval"
        ? end(failure("approval_expired", "post_admission"), ctx)
        : same(turn);
    case "tail_caught_up":
      if (turn.state !== "reconnecting") return same(turn);
      return step(
        { state: "responding.thinking" },
        { kind: "announce", key: "assistant.turn.caughtUp" },
        { kind: "meta", patch: { caughtUpAt: ctx.now } },
      );
    default:
      return same(turn);
  }
}

function onAdmitted(
  turn: TurnState,
  result: Extract<TurnClientEvent, { type: "admitted" }>["result"],
  ctx: TurnReducerCtx,
): Step {
  if (turn.state !== "queued" && turn.state !== "reconnecting") return same(turn);
  if (result.ok) {
    const admitted = step({ state: "connecting" }, { kind: "capability", note: "admitted" });
    // A reconnect resumes a turn whose admission was already tracked.
    if (turn.state === "queued") admitted.effects.push({ kind: "track_admitted" });
    return admitted;
  }
  const error = result.error;
  // The 412 consent prompt is a wait on the user, never a refusal (constraint 30).
  if (error.httpStatus === 412 && error.code === "consent_declined")
    return step({ state: "awaiting_consent" }, { kind: "consent", error });
  return onError(turn, error, ctx);
}

function onError(turn: TurnState, error: AssistantError, ctx: TurnReducerCtx): Step {
  if (error.code === "session_owner_unavailable" && ctx.canRestore)
    return step({ state: "reconnecting", attempt: 1 }, { kind: "restore" });
  const terminal: TurnTerminal =
    error.phase === "pre_admission" && turn.state !== "reconnecting"
      ? { state: "refused", error }
      : { state: "failed", error: { ...error, phase: "post_admission" } };
  return end(terminal, ctx);
}

function onEof(turn: TurnState, hasTail: boolean, ctx: TurnReducerCtx): Step {
  // `complete` ended the turn; its one `ai_turn_ended` waits for the end of the stream so `persistence_failed` can land first.
  if (turn.state === "done") return step(turn, endedEffect(turn));
  if (!isLive(turn) || turn.state === "stopping" || turn.state === "awaiting_consent")
    return same(turn);
  // Nothing arrived, so nothing was admitted to remember (HT-06 AC 5).
  if (turn.state === "queued" || turn.state === "connecting")
    return end({ state: "refused", error: failure("unreachable", "pre_admission") }, ctx);
  const attempt = turn.state === "reconnecting" ? turn.attempt + 1 : 1;
  if (hasTail && attempt <= MAX_RECONNECTS)
    return step({ state: "reconnecting", attempt }, { kind: "reconnect", attempt });
  return end(failure("stream_dropped", "post_admission"), ctx);
}

function onFrame(turn: TurnState, frame: AssistantFrame, ctx: TurnReducerCtx): Step {
  if (turn.state === "done") return onFrameAfterComplete(turn, frame);
  if (!isLive(turn) || turn.state === "awaiting_consent") return same(turn);
  if (turn.state === "stopping") return frame.type === "cancelled" ? stopped(ctx) : same(turn);
  switch (frame.type) {
    case "message_delta":
    case "message":
      return turn.state === "responding.writing"
        ? same(turn)
        : step({ state: "responding.writing" });
    case "tool_call":
      return runningTool(frame.tool, targetOf(frame.context), frame.call_id ?? frame.tool);
    case "step":
      return onStep(turn, frame);
    case "tool_result":
      return turn.state === "running_tool" && matchesCall(turn, frame.call_id, frame.tool)
        ? step({ state: "responding.thinking" })
        : same(turn);
    case "confirmation_required":
      return step({ state: "awaiting_approval", callId: frame.call_id ?? frame.id ?? frame.tool });
    case "error":
      return onErrorFrame(turn, frame, ctx);
    case "complete":
      return onComplete(frame, ctx);
    case "cancelled":
      // B-02 names who stopped it: a sign-out elsewhere reads as that, anything else as another tab or the server.
      return end(
        failure(frame.by === "signed_out" ? "signed_out" : "cancelled_elsewhere", "post_admission"),
        ctx,
      );
    default:
      return QUIET_FRAMES.has(frame.type) && turn.state === "connecting"
        ? step({ state: "responding.thinking" })
        : same(turn);
  }
}

function onFrameAfterComplete(turn: TurnState, frame: AssistantFrame): Step {
  if (frame.type !== "error" || frame.code !== "persistence_failed") return same(turn);
  return step(
    { state: "done", saved: "not_saved" },
    { kind: "announce", key: "assistant.turn.notSaved" },
  );
}

function onErrorFrame(
  turn: TurnState,
  frame: Extract<AssistantFrame, { type: "error" }>,
  ctx: TurnReducerCtx,
): Step {
  const error = toAssistantError(frame, { phase: "post_admission" });
  // Before `complete` a save failure only marks the answer; the turn still ends `done` (constraint 14).
  if (error.code === "persistence_failed") return step(turn, { kind: "not_saved" });
  return onError(turn, { ...error, phase: "post_admission" }, ctx);
}

function onComplete(
  frame: Extract<AssistantFrame, { type: "complete" }>,
  ctx: TurnReducerCtx,
): Step {
  // B-02 types the empty turn; before it an answer with no text, step or card is detected here (HT-02 AC 9).
  const untyped = frame.empty === undefined && ctx.steps === 0 && ctx.partial === false;
  if (frame.empty === true || untyped) return end(failure("empty_response", "post_admission"), ctx);
  const persisted = frame.persisted;
  const saved = persisted === false ? "not_saved" : persisted === true ? "server" : "local";
  return step(
    { state: "done", saved },
    {
      kind: "announce",
      key: saved === "not_saved" ? "assistant.turn.notSaved" : "assistant.turn.done",
    },
    { kind: "save" },
  );
}

// B-02 keys a step on its top-level `call_id` (params as the fallback) and says when it ended; the tool name comes from its `tool_call`.
function onStep(turn: TurnState, frame: Extract<AssistantFrame, { type: "step" }>): Step {
  const fromParams = frame.params?.call_id;
  const callId =
    frame.call_id ??
    (typeof fromParams === "string" ? fromParams : undefined) ??
    frame.id ??
    frame.kind;
  if (STEP_ENDS.has(frame.state ?? "running")) {
    return turn.state === "running_tool" && turn.callId === callId
      ? step({ state: "responding.thinking" })
      : same(turn);
  }
  if (turn.state === "running_tool" && turn.callId === callId) return same(turn);
  return runningTool(frame.kind, targetOf(frame.params), callId);
}

function lifecycleMeta(frame: AssistantFrame, now: number): TurnEffect | null {
  if (frame.type === "retrying") {
    const retryAfterMs =
      typeof frame.retry_after === "number" ? frame.retry_after * 1000 : undefined;
    const retrying = { attempt: frame.attempt, reason: frame.reason, retryAfterMs, at: now };
    return { kind: "meta", patch: { retrying, compacting: false } };
  }
  if (frame.type === "compacting") return { kind: "meta", patch: { compacting: true } };
  if (PROGRESS_FRAMES.has(frame.type))
    return { kind: "meta", patch: { retrying: null, compacting: false } };
  return null;
}

function runningTool(tool: string, target: string | null, callId: string): Step {
  return step(
    { state: "running_tool", tool, target, callId },
    { kind: "track_state", state: "running_tool", tool },
  );
}

function stopped(ctx: TurnReducerCtx): Step {
  const steps = ctx.steps ?? 0;
  const partial = ctx.partial ?? false;
  const done = end({ state: "stopped", steps, partial }, ctx);
  done.effects.unshift(
    { kind: "track_stop", partial },
    { kind: "meta", patch: { cancelUnconfirmed: ctx.cancelConfirmed === false } },
  );
  return done;
}

function declined(ctx: TurnReducerCtx): Step {
  return end({ state: "refused", error: failure("consent_declined", "pre_admission") }, ctx);
}

// Stop before admission sent nothing worth keeping: the draft comes back, nothing is cancelled or saved.
function withdrawn(): Step {
  const state: TurnTerminal = {
    state: "refused",
    error: failure("stopped_before_send", "pre_admission"),
  };
  return {
    state,
    effects: [
      endedEffect(state),
      { kind: "announce", key: "assistant.turn.messageRestored" },
      { kind: "restore_draft" },
    ],
  };
}

// Entering a terminal: one `ai_turn_ended`, one announcement, and a save unless nothing was admitted.
function end(terminal: TurnTerminal | AssistantError, ctx: TurnReducerCtx): Step {
  const state: TurnTerminal = "code" in terminal ? { state: "failed", error: terminal } : terminal;
  const effects: TurnEffect[] = [
    { kind: "meta", patch: { endedAt: ctx.now } },
    endedEffect(state),
    terminalAnnouncement(state, ctx),
  ];
  if (state.state === "refused") effects.push({ kind: "restore_draft" });
  else effects.push({ kind: "save" });
  const error = "error" in state ? state.error : null;
  if (error?.httpStatus === 403) effects.push({ kind: "capability", note: "forbidden" });
  if (error?.code === "agent_unavailable")
    effects.push({ kind: "capability", note: "agent_unavailable" });
  return { state, effects };
}

function endedEffect(terminal: TurnTerminal): TurnEffect {
  const error = "error" in terminal ? terminal.error : null;
  return { kind: "track_ended", outcome: outcomeOf(terminal), error };
}

function terminalAnnouncement(terminal: TurnTerminal, ctx: TurnReducerCtx): TurnEffect {
  if (terminal.state === "stopped") {
    if (terminal.steps === 0 || !terminal.partial)
      return { kind: "announce", key: "assistant.turn.stopped" };
    const params = { n: terminal.steps };
    return { kind: "announce", key: "assistant.turn.stoppedWithSteps", params };
  }
  if (terminal.state === "done") {
    const key = terminal.saved === "not_saved" ? "assistant.turn.notSaved" : "assistant.turn.done";
    return { kind: "announce", key };
  }
  const title = errorTitle(terminal.error, ctx.copy);
  return { kind: "announce", key: title.key, params: title.params };
}

// Telemetry and announcements that belong to entering a state, whatever event caused it.
function entryEffects(prev: TurnState, next: TurnState): TurnEffect[] {
  const effects: TurnEffect[] = [];
  if (isAwaiting(next) && !isAwaiting(prev)) effects.push({ kind: "pause" });
  if (isAwaiting(prev) && !isAwaiting(next)) effects.push({ kind: "resume" });
  // HT-06 AC 1 and 9: one `ai_turn_state` per attempt, one announcement per reconnect.
  if (
    next.state === "reconnecting" &&
    (prev.state !== "reconnecting" || prev.attempt !== next.attempt)
  )
    effects.push({ kind: "track_state", state: "reconnecting" });
  if (
    next.state === "running_tool" &&
    (prev.state !== "running_tool" || prev.callId !== next.callId)
  ) {
    const label = stepLabel(next.tool, next.target);
    effects.push({ kind: "announce", key: label.key, params: label.params });
  }
  if (next.state === prev.state) return effects;
  if (next.state === "awaiting_approval" || next.state === "awaiting_consent")
    effects.push({ kind: "track_state", state: next.state });
  const key = STATUS_KEYS[next.state];
  if (key && ANNOUNCED.has(next.state)) effects.push({ kind: "announce", key });
  return effects;
}

function statusLine(turn: TurnState, meta: TurnMeta, t: TranslateFn, now: number): I18nText {
  if (meta.caughtUpAt && now - meta.caughtUpAt < CAUGHT_UP_MS && turn.state !== "reconnecting")
    return t("assistant.turn.caughtUp");
  const label = turn.state === "running_tool" ? stepLabel(turn.tool, turn.target) : null;
  const status = label
    ? t(label.key, label.params)
    : (lifecycleLine(turn, meta, t, now) ??
      t(STATUS_KEYS[turn.state] ?? "assistant.turn.thinking"));
  const elapsed = elapsedMs(meta, now);
  if (NO_ELAPSED.has(turn.state) || elapsed < ELAPSED_AFTER_MS) return status;
  return t("assistant.turn.withElapsed", { status, elapsed: elapsedText(elapsed, t) });
}

// The provider retry and the compaction are said only while the turn has nothing else to show.
function lifecycleLine(
  turn: TurnState,
  meta: TurnMeta,
  t: TranslateFn,
  now: number,
): I18nText | null {
  if (turn.state !== "connecting" && turn.state !== "responding.thinking") return null;
  if (meta.compacting) return t("assistant.turn.compacting");
  const retrying = meta.retrying;
  if (!retrying) return null;
  const left = retrying.retryAfterMs ? retrying.at + retrying.retryAfterMs - now : 0;
  if (left > 0)
    return t("assistant.turn.retryingIn", { n: retrying.attempt, s: Math.ceil(left / 1000) });
  return t("assistant.turn.retrying", { n: retrying.attempt });
}

function elapsedText(ms: number, t: TranslateFn): I18nText {
  const total = Math.floor(ms / 1000);
  if (total < 60) return t("assistant.turn.elapsedSeconds", { n: total });
  return t("assistant.turn.elapsedMinutes", { m: Math.floor(total / 60), s: total % 60 });
}

function mutationVerb(tool: string): "create" | "update" | "delete" | null {
  const name = tool.replace(/^o2_/, "");
  if (/^delete/i.test(name)) return "delete";
  if (/^update/i.test(name)) return "update";
  if (/^create/i.test(name)) return "create";
  return null;
}

function targetOf(context: Record<string, unknown> | undefined): string | null {
  const value = context?.stream_name ?? context?.stream ?? context?.name;
  return typeof value === "string" && value ? value : (sqlStreamOf(context?.sql) ?? null);
}

function matchesCall(
  turn: Extract<TurnState, { state: "running_tool" }>,
  callId: string | undefined,
  tool: string,
): boolean {
  return callId ? turn.callId === callId : turn.tool === tool;
}

function failure(code: AssistantErrorCode, phase: AssistantError["phase"]): AssistantError {
  const { retryable, action } = ERROR_LEDGER[code];
  return { code, phase, retryable, action };
}

function isAwaiting(turn: TurnState): boolean {
  return turn.state === "awaiting_approval" || turn.state === "awaiting_consent";
}

function isLive(turn: TurnState): boolean {
  return turn.state !== "idle" && !isTerminal(turn);
}

function step(state: TurnState, ...effects: TurnEffect[]): Step {
  return { state, effects };
}

function same(turn: TurnState): Step {
  return { state: turn, effects: [] };
}

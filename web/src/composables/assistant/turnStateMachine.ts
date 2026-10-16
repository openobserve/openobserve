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

import type { I18nKey, I18nText, TranslateFn } from "@/types/i18n";

import { ERROR_LEDGER, toAssistantError, type ProviderReason } from "./assistantErrors";
import type { AssistantError, AssistantErrorCode, TurnMeta } from "./assistantStore.types";
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

const ANNOUNCED: ReadonlySet<TurnState["state"]> = new Set([
  "queued",
  "connecting",
  "responding.writing",
  "awaiting_approval",
  "awaiting_consent",
  "reconnecting",
  "stopping",
]);

const NO_ELAPSED: ReadonlySet<TurnState["state"]> = new Set(["queued", "reconnecting", "stopping"]);

const STEP_KEYS: Record<string, I18nKey> = {
  SearchSQL: "assistant.step.SearchSQL",
  StreamSchema: "assistant.step.StreamSchema",
  StreamList: "assistant.step.StreamList",
  SearchPromQL: "assistant.step.SearchPromQL",
  TraceSearch: "assistant.step.TraceSearch",
};

const TARGETED_STEPS: ReadonlySet<string> = new Set(["SearchSQL", "StreamSchema"]);

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
  const next = CLIENT_EVENTS.has(event.type)
    ? onClientEvent(turn, event as TurnClientEvent, ctx)
    : onFrame(turn, event as AssistantFrame, ctx);
  return { turn: next.state, effects: [...next.effects, ...entryEffects(turn, next.state)] };
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
      return runningTool(
        frame.kind,
        targetOf(frame.params),
        String(frame.params?.call_id ?? frame.kind),
      );
    case "tool_result":
      return turn.state === "running_tool" && matchesCall(turn, frame.call_id, frame.tool)
        ? step({ state: "responding.thinking" })
        : same(turn);
    case "confirmation_required":
      return step({ state: "awaiting_approval", callId: frame.call_id ?? frame.id ?? frame.tool });
    case "error":
      return onErrorFrame(turn, frame, ctx);
    case "complete":
      return onComplete(frame.persisted, ctx);
    case "cancelled":
      return end(failure("cancelled_elsewhere", "post_admission"), ctx);
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

function onComplete(persisted: boolean | undefined, ctx: TurnReducerCtx): Step {
  // o2-ai's empty-turn notice is not typed yet, so an answer with no text, step or card is detected here (HT-02 AC 9).
  if (ctx.steps === 0 && ctx.partial === false)
    return end(failure("empty_response", "post_admission"), ctx);
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
  const effects: TurnEffect[] = [endedEffect(state), terminalAnnouncement(state, ctx)];
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
    if (terminal.steps === 0) return { kind: "announce", key: "assistant.turn.stopped" };
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
    : t(STATUS_KEYS[turn.state] ?? "assistant.turn.thinking");
  const elapsed = elapsedMs(meta, now);
  if (NO_ELAPSED.has(turn.state) || elapsed < ELAPSED_AFTER_MS) return status;
  return t("assistant.turn.withElapsed", { status, elapsed: elapsedText(elapsed, t) });
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
  return typeof value === "string" && value ? value : null;
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

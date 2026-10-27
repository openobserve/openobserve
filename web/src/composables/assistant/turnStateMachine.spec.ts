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

import { describe, expect, it } from "vitest";

import locale from "@/locales/languages/en-US.json";
import type { TranslateFn } from "@/types/i18n";

import { toAssistantError } from "./assistantErrors";
import type { AssistantError, TurnMeta } from "./assistantStore.types";
import { createSseParser } from "./sseParser";
import {
  STALL_MS,
  outcomeOf,
  stepLabel,
  turnReducer,
  turnStatusText,
  type TurnEffect,
  type TurnReducerCtx,
} from "./turnStateMachine";
import { isTerminal, type TurnEvent, type TurnState } from "./turnStates";

// en-US through the real message syntax: `{name}` params and `a | b` plurals by count.
const t = ((key: string, named?: Record<string, unknown>, plural?: number) => {
  let text = key.split(".").reduce<any>((node, part) => node?.[part], locale) as string;
  if (typeof text !== "string") return key;
  if (text.includes(" | ")) text = text.split(" | ")[plural === 1 ? 0 : 1];
  return text.replace(/\{(\w+)\}/g, (_m, name) => String(named?.[name] ?? `{${name}}`));
}) as TranslateFn;

const ctx = (over: Partial<TurnReducerCtx> = {}): TurnReducerCtx => ({ now: 1_000, ...over });

const run = (turn: TurnState, event: TurnEvent, over: Partial<TurnReducerCtx> = {}) =>
  turnReducer(turn, event, ctx(over));

const kinds = (effects: TurnEffect[]) => effects.map((effect) => effect.kind);

const error = (body: unknown, phase?: AssistantError["phase"]) => toAssistantError(body, { phase });

const meta = (over: Partial<TurnMeta> = {}): TurnMeta => ({
  turnId: "t1",
  serverTurnId: null,
  ownedByThisTab: true,
  startedAt: 0,
  firstByteAt: null,
  traceId: null,
  lastSeq: null,
  usage: null,
  contextUsed: null,
  lastFrameAt: 0,
  ...over,
});

const S = {
  idle: { state: "idle" } as TurnState,
  queued: { state: "queued" } as TurnState,
  connecting: { state: "connecting" } as TurnState,
  thinking: { state: "responding.thinking" } as TurnState,
  writing: { state: "responding.writing" } as TurnState,
  tool: { state: "running_tool", tool: "SearchSQL", target: "default", callId: "c1" } as TurnState,
  approval: { state: "awaiting_approval", callId: "c9" } as TurnState,
  consent: { state: "awaiting_consent" } as TurnState,
  reconnecting: { state: "reconnecting", attempt: 1 } as TurnState,
  stopping: { state: "stopping" } as TurnState,
  done: { state: "done", saved: "server" } as TurnState,
};

const consentError = error({
  status: 412,
  body: { error_type: "paid_overage_consent_required", consent: { feature: "ai_credits" } },
});

// Every row of `00` §5.3 and HT §0.1: from, event, ctx, the state entered, effects that must be present.
const TABLE: [
  string,
  TurnState,
  TurnEvent,
  Partial<TurnReducerCtx>,
  Partial<TurnState>,
  string[],
][] = [
  [
    "Send queues and counts the send",
    S.idle,
    { type: "send", turnId: "t1" },
    {},
    { state: "queued" },
    ["track_sent", "announce"],
  ],
  [
    "Send after a terminal starts a new turn",
    S.done,
    { type: "send", turnId: "t2" },
    {},
    { state: "queued" },
    ["track_sent"],
  ],
  [
    "admission opens the connection",
    S.queued,
    { type: "admitted", result: { ok: true, status: 200 } },
    {},
    { state: "connecting" },
    ["capability", "track_admitted"],
  ],
  [
    "a reconnect's admission tracks no second send",
    S.reconnecting,
    { type: "admitted", result: { ok: true, status: 200 } },
    {},
    { state: "connecting" },
    ["capability"],
  ],
  [
    "first byte starts thinking",
    S.connecting,
    { type: "first_byte" },
    {},
    { state: "responding.thinking" },
    ["track_first_byte", "meta"],
  ],
  [
    "a keepalive alone also leaves connecting",
    S.connecting,
    { type: "keepalive" },
    {},
    { state: "responding.thinking" },
    [],
  ],
  [
    "a status frame thinks",
    S.connecting,
    { type: "status", message: "processing" },
    {},
    { state: "responding.thinking" },
    [],
  ],
  [
    "text writes",
    S.thinking,
    { type: "message_delta", content: "a" },
    {},
    { state: "responding.writing" },
    ["announce"],
  ],
  [
    "a tool call runs the tool",
    S.writing,
    { type: "tool_call", tool: "SearchSQL", call_id: "c1", context: { stream_name: "default" } },
    {},
    { state: "running_tool", tool: "SearchSQL", target: "default", callId: "c1" },
    ["track_state", "announce"],
  ],
  [
    "a tool call with only its SQL is named by the stream it reads",
    S.writing,
    {
      type: "tool_call",
      tool: "SearchSQL",
      call_id: "c1",
      context: { sql: 'SELECT * FROM "default"' },
    },
    {},
    { state: "running_tool", tool: "SearchSQL", target: "default", callId: "c1" },
    ["track_state", "announce"],
  ],
  [
    "a B-02 step runs the tool",
    S.thinking,
    { type: "step", kind: "query", label: "query_logs", params: { stream: "default" } },
    {},
    { state: "running_tool", tool: "query", target: "default" },
    ["track_state"],
  ],
  [
    "its result goes back to thinking",
    S.tool,
    { type: "tool_result", tool: "SearchSQL", call_id: "c1" },
    {},
    { state: "responding.thinking" },
    [],
  ],
  [
    "another call's result changes nothing",
    S.tool,
    { type: "tool_result", tool: "SearchSQL", call_id: "c2" },
    {},
    { state: "running_tool", callId: "c1" },
    [],
  ],
  [
    "a confirmation waits for approval",
    S.writing,
    { type: "confirmation_required", tool: "o2_delete", call_id: "c9" },
    {},
    { state: "awaiting_approval", callId: "c9" },
    ["track_state", "pause"],
  ],
  [
    "the decision resumes",
    S.approval,
    { type: "approval_decided", callId: "c9", approved: true },
    {},
    { state: "responding.thinking" },
    ["resume"],
  ],
  [
    "expiry fails the turn with Ask again",
    S.approval,
    { type: "approval_expired", callId: "c9" },
    {},
    { state: "failed" },
    ["track_ended", "save", "resume"],
  ],
  [
    "a 412 waits for consent",
    S.queued,
    { type: "admitted", result: { ok: false, error: consentError } },
    {},
    { state: "awaiting_consent" },
    ["consent", "track_state", "pause"],
  ],
  [
    "Enable resends the same turn",
    S.consent,
    { type: "consent_enable" },
    {},
    { state: "queued" },
    ["resume"],
  ],
  [
    "Cancel refuses and restores the draft",
    S.consent,
    { type: "consent_cancel" },
    {},
    { state: "refused" },
    ["restore_draft", "track_ended"],
  ],
  [
    "Stop while waiting on consent is Cancel",
    S.consent,
    { type: "stop" },
    {},
    { state: "refused" },
    ["restore_draft"],
  ],
  ["Stop stops", S.tool, { type: "stop" }, {}, { state: "stopping" }, ["cancel", "announce"]],
  [
    "the ack ends stopped with steps",
    S.stopping,
    { type: "cancel_acked" },
    { steps: 3, partial: true, cancelConfirmed: true },
    { state: "stopped", steps: 3, partial: true },
    ["track_stop", "track_ended", "save"],
  ],
  [
    "a cancelled frame while stopping is the ack",
    S.stopping,
    { type: "cancelled" },
    { steps: 0, partial: false },
    { state: "stopped", steps: 0 },
    ["track_stop"],
  ],
  [
    "a cancelled frame nobody here caused",
    S.writing,
    { type: "cancelled" },
    {},
    { state: "failed" },
    ["track_ended"],
  ],
  [
    "complete is done",
    S.writing,
    { type: "complete", persisted: true },
    { steps: 1, partial: true },
    { state: "done", saved: "server" },
    ["save", "announce"],
  ],
  [
    "complete with persisted:false is answered, not saved",
    S.writing,
    { type: "complete", persisted: false },
    { partial: true },
    { state: "done", saved: "not_saved" },
    ["save"],
  ],
  [
    "complete without the flag is a local save",
    S.writing,
    { type: "complete" },
    { partial: true },
    { state: "done", saved: "local" },
    [],
  ],
  [
    "an empty complete fails as empty_response",
    S.thinking,
    { type: "complete" },
    { steps: 0, partial: false },
    { state: "failed" },
    ["track_ended"],
  ],
  [
    "persistence_failed after complete keeps done",
    S.done,
    { type: "error", code: "persistence_failed" },
    {},
    { state: "done", saved: "not_saved" },
    ["announce"],
  ],
  [
    "persistence_failed before complete only marks it",
    S.writing,
    { type: "error", code: "persistence_failed" },
    {},
    { state: "responding.writing" },
    ["not_saved"],
  ],
  [
    "eof after complete emits the one ai_turn_ended",
    S.done,
    { type: "eof", hasTail: false },
    {},
    { state: "done" },
    ["track_ended"],
  ],
  [
    "eof without complete drops the stream",
    S.writing,
    { type: "eof", hasTail: false },
    {},
    { state: "failed" },
    ["track_ended", "save"],
  ],
  [
    "eof with a tail reconnects",
    S.writing,
    { type: "eof", hasTail: true },
    {},
    { state: "reconnecting", attempt: 1 },
    ["reconnect", "track_state", "announce"],
  ],
  [
    "a failed tail tries again",
    S.reconnecting,
    { type: "eof", hasTail: true },
    {},
    { state: "reconnecting", attempt: 2 },
    ["reconnect", "track_state"],
  ],
  [
    "the third failed tail gives up",
    { state: "reconnecting", attempt: 3 },
    { type: "eof", hasTail: true },
    {},
    { state: "failed" },
    ["track_ended"],
  ],
  [
    "the tail catches up",
    S.reconnecting,
    { type: "tail_caught_up" },
    {},
    { state: "responding.thinking" },
    ["announce", "meta"],
  ],
  [
    "eof before any frame is unreachable, not sent",
    S.connecting,
    { type: "eof", hasTail: false },
    {},
    { state: "refused" },
    ["restore_draft"],
  ],
  [
    "the owner race restores once",
    S.writing,
    { type: "error", category: "session_owner_unavailable", message: "x" },
    { canRestore: true },
    { state: "reconnecting", attempt: 1 },
    ["restore"],
  ],
  [
    "the owner race fails after the restore",
    S.writing,
    { type: "error", code: "session_owner_unavailable" },
    { canRestore: false },
    { state: "failed" },
    ["track_ended"],
  ],
  [
    "a pre-admission owner 409 restores once too",
    S.queued,
    {
      type: "admitted",
      result: {
        ok: false,
        error: error({ status: 409, body: { code: "session_owner_unavailable" } }),
      },
    },
    { canRestore: true },
    { state: "reconnecting" },
    ["restore"],
  ],
  [
    "an error frame fails the turn",
    S.tool,
    { type: "error", error_type: "llm_overload", message: "busy" },
    {},
    { state: "failed" },
    ["track_ended", "save"],
  ],
  [
    "a pre-admission refusal restores the draft",
    S.queued,
    {
      type: "admitted",
      result: { ok: false, error: error({ status: 429, body: { error_code: "turn_limit" } }) },
    },
    {},
    { state: "refused" },
    ["restore_draft", "track_ended"],
  ],
  [
    "a 403 refuses and notes the capability",
    S.queued,
    { type: "admitted", result: { ok: false, error: error({ status: 403, body: {} }) } },
    {},
    { state: "refused" },
    ["capability"],
  ],
  [
    "a 502 fails after admission and notes the outage",
    S.queued,
    {
      type: "admitted",
      result: { ok: false, error: error({ status: 502, body: { error: "down" } }) },
    },
    {},
    { state: "failed" },
    ["capability", "save"],
  ],
  [
    "offline refuses",
    S.queued,
    {
      type: "fetch_error",
      error: { code: "offline", phase: "pre_admission", retryable: true, action: "retry" },
    },
    {},
    { state: "refused" },
    ["restore_draft"],
  ],
  [
    "an oversized line fails the turn",
    S.writing,
    {
      type: "fetch_error",
      error: {
        code: "stream_oversized",
        phase: "post_admission",
        retryable: true,
        action: "retry",
      },
    },
    {},
    { state: "failed" },
    ["track_ended"],
  ],
  [
    "signed out elsewhere fails the turn",
    S.writing,
    { type: "signed_out" },
    {},
    { state: "failed" },
    ["track_ended"],
  ],
];

describe("turnReducer: every transition", () => {
  it.each(TABLE)("%s", (_name, from, event, over, expected, effects) => {
    const next = run(from, event, over);
    expect(next.turn).toMatchObject(expected);
    expect(kinds(next.effects)).toEqual(expect.arrayContaining(effects));
  });

  it("names the code of each failure", () => {
    expect(run(S.writing, { type: "eof", hasTail: false }).turn).toMatchObject({
      error: { code: "stream_dropped", phase: "post_admission", action: "retry" },
    });
    expect(run(S.approval, { type: "approval_expired", callId: "c9" }).turn).toMatchObject({
      error: { code: "approval_expired", action: "ask_again" },
    });
    expect(run(S.writing, { type: "cancelled" }).turn).toMatchObject({
      error: { code: "cancelled_elsewhere", action: "none" },
    });
    expect(run(S.consent, { type: "consent_cancel" }).turn).toMatchObject({
      error: { code: "consent_declined", phase: "pre_admission" },
    });
    expect(run(S.connecting, { type: "eof", hasTail: false }).turn).toMatchObject({
      error: { code: "unreachable" },
    });
  });

  it("treats Stop while queued as a refusal that restores the draft, with no cancel or save", () => {
    const next = run(S.queued, { type: "stop" });
    expect(next.turn).toMatchObject({
      state: "refused",
      error: { code: "stopped_before_send", phase: "pre_admission", retryable: true },
    });
    expect(next.effects).toContainEqual({
      kind: "track_ended",
      outcome: "refused",
      error: expect.objectContaining({ code: "stopped_before_send" }),
    });
    expect(kinds(next.effects)).toEqual(["track_ended", "announce", "restore_draft"]);
    expect(next.effects).toContainEqual({
      kind: "announce",
      key: "assistant.turn.messageRestored",
    });
  });

  it("announces a failure with the values its title names (round 3 #4)", () => {
    const copy = { t, org: "acme", product: "O2 Assistant", elapsedMs: 42_000 };
    const dropped = run(S.writing, { type: "eof", hasTail: false }, { copy });
    expect(dropped.effects).toContainEqual({
      kind: "announce",
      key: "assistant.error.stream_dropped.title",
      params: { org: "acme", product: "O2 Assistant", elapsed: "42 s" },
    });
    const overloaded = run(
      S.writing,
      { type: "error", error_type: "llm_overload", message: "x" },
      { copy },
    );
    expect(overloaded.effects).toContainEqual(
      expect.objectContaining({
        key: "assistant.error.provider_error.title",
        params: expect.objectContaining({ reason: "overloaded" }),
      }),
    );
    const untyped = run(S.writing, { type: "error", category: "llm", message: "x" }, { copy });
    expect(untyped.effects).toContainEqual(
      expect.objectContaining({ key: "assistant.error.provider_error.titleNoReason" }),
    );
    expect(t("assistant.error.credits_exhausted.title", { org: "acme" })).toBe(
      "AI credits are used up for acme.",
    );
  });

  it("marks an unacknowledged cancel on the turn (HT-04 AC 4)", () => {
    const next = run(S.stopping, { type: "cancel_acked" }, { cancelConfirmed: false });
    expect(next.effects).toContainEqual({ kind: "meta", patch: { cancelUnconfirmed: true } });
  });

  it("flips O2AIChat.stream.spec.ts:2004: a reader failure mid-stream ends failed{stream_dropped}", () => {
    // parseStream turns a body read failure into "eof", so the turn never ends silently.
    const next = run(S.writing, { type: "eof", hasTail: false });
    expect(next.turn).toMatchObject({ state: "failed", error: { code: "stream_dropped" } });
    expect(next.effects).toContainEqual({
      kind: "track_ended",
      outcome: "lost",
      error: expect.objectContaining({ code: "stream_dropped" }),
    });
  });
});

describe("turnReducer: one terminal per turn", () => {
  const terminals: TurnState[] = [
    { state: "done", saved: "server" },
    { state: "stopped", steps: 1, partial: true },
    { state: "failed", error: error({ type: "error", message: "x" }) },
    { state: "refused", error: error({ status: 429, body: {} }) },
  ];
  const later: TurnEvent[] = [
    { type: "message_delta", content: "late" },
    { type: "tool_call", tool: "SearchSQL" },
    { type: "complete" },
    { type: "cancelled" },
    { type: "error", message: "late" },
    { type: "stop" },
    { type: "eof", hasTail: true },
    { type: "fetch_error", error: error({ status: 502, body: {} }) },
    { type: "signed_out" },
  ];

  it.each(terminals)("never leaves $state for a late frame or event", (terminal) => {
    for (const event of later) {
      const next = run(terminal, event);
      expect(isTerminal(next.turn)).toBe(true);
      expect(next.turn.state).toBe(terminal.state);
    }
  });

  it("stamps the end time on the turn, so retry_after counts from the refusal itself (V6)", () => {
    const refused = run(
      { state: "connecting" },
      {
        type: "fetch_error",
        error: error({ status: 429, body: { error_code: "rate_limited", retry_after: 30 } }),
      },
      { now: 1_234 },
    );
    expect(refused.turn.state).toBe("refused");
    expect(refused.effects).toContainEqual({ kind: "meta", patch: { endedAt: 1_234 } });
  });

  it("emits ai_turn_ended exactly once over a whole turn, done included", () => {
    const events: TurnEvent[] = [
      { type: "send", turnId: "t1" },
      { type: "admitted", result: { ok: true, status: 200 } },
      { type: "first_byte" },
      { type: "tool_call", tool: "SearchSQL", call_id: "c1" },
      { type: "tool_result", tool: "SearchSQL", call_id: "c1" },
      { type: "message_delta", content: "answer" },
      { type: "complete", persisted: true },
      { type: "error", code: "persistence_failed" },
      { type: "message_delta", content: "late" },
      { type: "eof", hasTail: false },
    ];
    let turn: TurnState = S.idle;
    const ended: TurnEffect[] = [];
    for (const event of events) {
      const next = run(turn, event, { steps: 1, partial: true });
      turn = next.turn;
      ended.push(...next.effects.filter((effect) => effect.kind === "track_ended"));
    }
    expect(turn).toEqual({ state: "done", saved: "not_saved" });
    expect(ended).toEqual([{ kind: "track_ended", outcome: "done_not_saved", error: null }]);
  });

  it("maps each terminal to its ai_turn_ended outcome", () => {
    expect(outcomeOf({ state: "done", saved: "local" })).toBe("done");
    expect(outcomeOf({ state: "done", saved: "not_saved" })).toBe("done_not_saved");
    expect(outcomeOf({ state: "stopped", steps: 0, partial: false })).toBe("stopped");
    expect(outcomeOf({ state: "refused", error: error({ status: 403, body: {} }) })).toBe(
      "refused",
    );
    expect(
      outcomeOf({
        state: "failed",
        error: { ...error({ type: "error", message: "x" }), code: "stream_dropped" },
      }),
    ).toBe("lost");
  });

  it("counts one ai_turn_state per reconnect attempt and announces only the first", () => {
    const first = run(S.writing, { type: "eof", hasTail: true });
    const second = run(first.turn, { type: "eof", hasTail: true });
    expect(first.effects.filter((e) => e.kind === "track_state")).toHaveLength(1);
    expect(second.effects.filter((e) => e.kind === "track_state")).toHaveLength(1);
    expect(second.effects.some((e) => e.kind === "announce")).toBe(false);
  });
});

describe("turnStatusText", () => {
  it("is the only status copy, and says nothing for idle or terminals", () => {
    expect(turnStatusText(S.idle, meta(), t, 0)).toBeNull();
    expect(turnStatusText(S.done, meta(), t, 0)).toBeNull();
    expect(turnStatusText(S.queued, meta(), t, 9_000)?.line).toBe("Sending…");
    expect(turnStatusText(S.connecting, meta(), t, 1_000)?.line).toBe("Connecting…");
    expect(turnStatusText(S.stopping, meta(), t, 9_000)?.line).toBe("Stopping…");
    expect(turnStatusText(S.reconnecting, meta(), t, 9_000)?.line).toBe("Reconnecting…");
    expect(turnStatusText(S.consent, meta(), t, 1_000)?.line).toBe(
      "Waiting for your decision on paid usage",
    );
  });

  it("shows elapsed from startedAt only after 5 s, in seconds then minutes", () => {
    expect(turnStatusText(S.thinking, meta(), t, 4_000)?.line).toBe("Thinking");
    expect(turnStatusText(S.thinking, meta(), t, 6_200)?.line).toBe("Thinking · 6 s");
    const later = meta({ lastFrameAt: 70_000 });
    expect(turnStatusText(S.writing, later, t, 75_000)?.line).toBe(
      "Writing the answer · 1 min 15 s",
    );
  });

  it("flips O2AIChat.stream.spec.ts:1268: an active tool reads as its step label, in a neutral tone", () => {
    const status = turnStatusText(S.tool, meta({ lastFrameAt: 3_000 }), t, 4_000);
    expect(status).toEqual({ line: "Querying default", tone: "neutral" });
    expect(turnStatusText(S.tool, meta({ lastFrameAt: 8_000 }), t, 12_000)?.line).toBe(
      "Querying default · 12 s",
    );
  });

  it("falls back to Running {tool} when no template fits", () => {
    const tool: TurnState = { state: "running_tool", tool: "kubectl", target: null, callId: "k" };
    expect(turnStatusText(tool, meta(), t, 1_000)?.line).toBe("Running kubectl");
    expect(stepLabel("SearchSQL", null).key).toBe("assistant.step.fallback");
    expect(stepLabel("o2_UpdateAlert", "checkout")).toEqual({
      key: "assistant.step.update",
      params: { resource: "checkout" },
    });
  });

  it("adds the stall line after 30 s without a frame, amber, state unchanged (HT-01 AC 3)", () => {
    const quiet = meta({ startedAt: 0, lastFrameAt: 0 });
    expect(turnStatusText(S.tool, quiet, t, STALL_MS - 1)?.tone).toBe("neutral");
    expect(turnStatusText(S.tool, quiet, t, STALL_MS)).toEqual({
      line: "Querying default · 30 s",
      second: "No response for 30 s",
      tone: "warning",
    });
  });

  it("never stalls a turn that waits on the user, and pauses elapsed meanwhile (HT-01 AC 4)", () => {
    const paused = meta({ startedAt: 0, lastFrameAt: 0, pausedAt: 8_000, pausedMs: 0 });
    expect(turnStatusText(S.approval, paused, t, 60_000)).toEqual({
      line: "Waiting for your approval · 8 s",
      tone: "neutral",
    });
    const resumed = meta({ startedAt: 0, lastFrameAt: 60_000, pausedAt: null, pausedMs: 52_000 });
    expect(turnStatusText(S.thinking, resumed, t, 62_000)?.line).toBe("Thinking · 10 s");
  });

  it("reads Caught up for 2 s after the tail catches up", () => {
    const caught = meta({ caughtUpAt: 10_000, lastFrameAt: 10_000 });
    expect(turnStatusText(S.thinking, caught, t, 11_000)?.line).toBe("Caught up");
    expect(turnStatusText(S.thinking, caught, t, 12_500)?.line).toBe("Thinking · 12 s");
  });

  it("flips O2AIChat.reducer.spec.ts tail flush: the final-chunk frame reaches the machine", () => {
    const frames: TurnEvent[] = [];
    const parser = createSseParser({
      frame: (frame) => frames.push(frame),
      keepalive: () => undefined,
      unknown: () => undefined,
    });
    parser.push('data: {"type":"message_delta","content":"x"}\n');
    parser.push('data: {"type":"confirmation_required","tool":"o2_delete","call_id":"c9"}');
    parser.end();
    let turn: TurnState = S.thinking;
    for (const frame of frames) turn = run(turn, frame).turn;
    expect(turn).toEqual({ state: "awaiting_approval", callId: "c9" });
  });
});

describe("turnReducer: WP-23 lifecycle frames", () => {
  const stepFrame = (state: string, callId = "c1") =>
    ({
      type: "step",
      id: callId,
      call_id: callId,
      kind: "query",
      label: "SearchSQL",
      params: { stream: "default" },
      state,
    }) as TurnEvent;

  it("keys a step on its top-level call_id and honours its state", () => {
    const running = run(S.thinking, stepFrame("running", "c7"));
    expect(running.turn).toMatchObject({ state: "running_tool", callId: "c7" });
    expect(run(running.turn, stepFrame("done", "c7")).turn.state).toBe("responding.thinking");
    expect(run(running.turn, stepFrame("failed", "c8")).turn).toBe(running.turn);
  });

  it("keeps the tool name of the tool_call when its running step follows", () => {
    const step = run(S.tool, stepFrame("running", "c1"));
    expect(step.turn).toBe(S.tool);
    expect(step.effects.filter((effect) => effect.kind === "announce")).toEqual([]);
  });

  it("falls back to params.call_id when the step carries no top-level id", () => {
    const frame = {
      type: "step",
      kind: "query",
      label: "x",
      params: { call_id: "c3" },
    } as TurnEvent;
    expect(run(S.thinking, frame).turn).toMatchObject({ state: "running_tool", callId: "c3" });
  });

  it("ends a cancelled{by:signed_out} turn as signed_out, any other cancel as elsewhere", () => {
    const signedOut = run(S.writing, { type: "cancelled", by: "signed_out" } as TurnEvent);
    expect(signedOut.turn).toMatchObject({ state: "failed", error: { code: "signed_out" } });
    const server = run(S.writing, { type: "cancelled", by: "server", turn_id: "t1" } as TurnEvent);
    expect(server.turn).toMatchObject({ error: { code: "cancelled_elsewhere" } });
  });

  it("reads complete{empty:true} as empty_response even with the notice text, and trusts empty:false", () => {
    const empty = run(S.writing, { type: "complete", empty: true } as TurnEvent, {
      steps: 0,
      partial: true,
    });
    expect(empty.turn).toMatchObject({ state: "failed", error: { code: "empty_response" } });
    const answered = run(S.thinking, { type: "complete", empty: false } as TurnEvent, {
      steps: 0,
      partial: false,
    });
    expect(answered.turn.state).toBe("done");
  });

  it("says a provider retry and its countdown, then clears it on the next answer frame", () => {
    const retry = run(S.thinking, {
      type: "retrying",
      attempt: 2,
      reason: "rate_limit",
      retry_after: 12,
    } as TurnEvent);
    const patch = retry.effects.find((effect) => effect.kind === "meta");
    expect(patch).toMatchObject({
      patch: { retrying: { attempt: 2, retryAfterMs: 12_000, at: 1_000 } },
    });
    const m = meta({ ...(patch as { patch: Partial<TurnMeta> }).patch, startedAt: 0 });
    expect(turnStatusText(S.thinking, m, t, 4_000)?.line).toBe(
      "Retrying the AI provider in 9 s · attempt 2",
    );
    expect(turnStatusText(S.thinking, m, t, 20_000)?.line).toBe(
      "Retrying the AI provider · attempt 2 · 20 s",
    );
    const delta = run(S.thinking, { type: "message_delta", content: "x" } as TurnEvent);
    expect(delta.effects).toContainEqual({
      kind: "meta",
      patch: { retrying: null, compacting: false },
    });
  });

  it("says compaction while the agent condenses earlier messages", () => {
    const compacting = run(S.thinking, { type: "compacting" } as TurnEvent);
    expect(compacting.effects).toContainEqual({ kind: "meta", patch: { compacting: true } });
    expect(turnStatusText(S.thinking, meta({ compacting: true }), t, 1_000)?.line).toBe(
      "Condensing earlier messages",
    );
  });

  it("adds no lifecycle patch once the turn has ended", () => {
    const ended = run(S.writing, { type: "complete" } as TurnEvent, { steps: 1, partial: true });
    expect(ended.effects.filter((effect) => effect.kind === "meta")).toEqual([]);
  });
});

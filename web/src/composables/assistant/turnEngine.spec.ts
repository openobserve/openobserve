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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { trackAssistant, trackAssistantAdmitted } from "@/services/assistantAnalytics";
import { raw } from "@/types/i18n";

import { toAssistantError } from "./assistantErrors";
import {
  createAssistantStore,
  inertAssistantDeps,
  type AssistantStoreInternal,
} from "./assistantStore";
import type { AssistantCapability, AssistantSession, TurnEngine } from "./assistantStore.types";
import { createDraftStore } from "./drafts";
import type { AssistantFrame } from "./frames";
import { resetPrefsForTests } from "./prefs";
import { RECONNECT_DELAYS_MS, createTurnEngine } from "./turnEngine";
import { STALL_MS, STOP_TIMEOUT_MS } from "./turnStateMachine";
import type { TurnTerminal } from "./turnStates";
import { useAssistantClient } from "./useAssistantClient";
import type {
  AssistantClient,
  ClientSendRequest,
  FrameSink,
  SendResult,
} from "./useAssistantClient";

vi.mock("@/services/assistantAnalytics", () => ({
  trackAssistant: vi.fn(),
  trackAssistantAdmitted: vi.fn(),
}));

const CAPABILITY: AssistantCapability = {
  gate: "available",
  edition: "ee",
  configured: true,
  health: "ok",
  canChat: "yes",
  canWrite: "yes",
  canShare: "yes",
  canShareRead: "yes",
  persistence: true,
  publicLinks: false,
  publicMaxExpiryDays: 30,
  isAdmin: true,
  rcaEnabled: false,
  source: "heuristic",
  reasonCode: "available",
};

const ORIGIN = { entryKind: "header_button", objectKind: "none", container: "sidebar" } as const;

const OK: SendResult = { ok: true, status: 200, traceId: null };

interface Sent {
  req: ClientSendRequest;
  sink: FrameSink;
  signal: AbortSignal;
}

let clock = 0;

function setup(
  opts: { persistence?: boolean; tail?: boolean; hidden?: boolean; client?: AssistantClient } = {},
) {
  const persistence = { value: opts.persistence ?? true };
  const sends: Sent[] = [];
  const tails: (Sent & { fromSeq: number; turnId: string })[] = [];
  const results: (SendResult | Promise<SendResult>)[] = [];
  const tailResults: SendResult[] = [];
  const client: AssistantClient = {
    send: vi.fn(async (req, sink, signal) => {
      sends.push({ req, sink, signal });
      return results.shift() ?? OK;
    }),
    tail: vi.fn(async (_org, _sid, turnId, fromSeq, sink, signal) => {
      tails.push({ req: {} as ClientSendRequest, sink, signal, fromSeq, turnId });
      return tailResults.shift() ?? OK;
    }),
    stop: vi.fn().mockResolvedValue(undefined),
    confirm: vi.fn(),
    feedback: vi.fn(),
  };
  const capability = {
    noteForbidden: vi.fn(),
    noteAgentUnavailable: vi.fn(),
    noteAdmitted: vi.fn(),
    persistence: () => persistence.value,
  };
  let visible: (() => void) | null = null;
  const visibility = {
    hidden: () => !!opts.hidden && visible === null,
    onVisible: (cb: () => void) => {
      visible = cb;
      return () => undefined;
    },
  };
  let n = 0;
  const deps = inertAssistantDeps({
    getOrg: () => ({ identifier: "org1", name: "Org 1" }),
    getUser: () => ({ email: "a@b.c", role: "admin" }),
    now: () => clock,
    uuid: () => `0190f3a0-0000-7000-8000-${String((n += 1)).padStart(12, "0")}`,
  });
  const save = vi.fn().mockResolvedValue("server");
  deps.history = { ...deps.history, save };
  let store!: AssistantStoreInternal;
  const engine: TurnEngine = createTurnEngine({
    client: opts.client ?? client,
    store: () => store,
    capability: () => capability,
    history: () => deps.history,
    now: () => clock,
    uuid: () => deps.uuid(),
    pageContext: async () => ({
      currentPage: "logs",
      selectedStreams: ["default"],
      secret: "nope",
    }),
    uiVersion: () => "ui1",
    tailEnabled: () => !!opts.tail,
    raf: (cb) => cb(),
    visibility,
  });
  deps.engine = engine;
  store = createAssistantStore(deps, {
    drafts: createDraftStore({ delayMs: 0 }),
    viewportRem: () => 80,
  });
  store.setIdentity({ userOrgKey: "k1", org: "org1" });
  store.syncCapability({ ...CAPABILITY, persistence: persistence.value });
  const sid = store.createSession({ origin: ORIGIN, thread: "new" });
  const session = () => store.state.sessions[current.sid] as AssistantSession;
  const current = { sid };
  const type = (text: string) => {
    store.setDraft(current.sid, { text });
  };
  const last = () => sends[sends.length - 1];
  const feed = (...frames: (AssistantFrame | { id: string; frame: AssistantFrame })[]) => {
    for (const item of frames) {
      if ("frame" in item) last().sink.onFrame(item.frame, item.id);
      else last().sink.onFrame(item, null);
    }
  };
  return {
    store,
    engine,
    client,
    capability,
    sends,
    tails,
    results,
    tailResults,
    save,
    persistence,
    current,
    session,
    type,
    last,
    feed,
    end: (reason: "eof" | "abort" | "oversized" = "eof") => last().sink.onEnd(reason),
    show: () => visible?.(),
  };
}

const settle = () => vi.advanceTimersByTimeAsync(0);

const refusal = (status: number, body: unknown): SendResult => ({
  ok: false,
  error: toAssistantError({ status, body }, { turnId: "x" }),
  body,
});

const consentBody = {
  code: 412,
  message: "Paid usage requires organization consent.",
  error_type: "paid_overage_consent_required",
  consent: {
    feature: "ai_credits",
    organization: { org_id: "org1", enabled: false, can_manage: true },
    effective: false,
    billing_status: "eligible",
  },
};

const tracked = (name: string) =>
  vi.mocked(trackAssistant).mock.calls.filter(([event]) => event === name);

beforeEach(() => {
  vi.useFakeTimers();
  clock = 1_000_000;
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  sessionStorage.clear();
  resetPrefsForTests();
  vi.clearAllMocks();
});

describe("turnEngine: send", () => {
  it("snapshots, appends the message, clears the composer and drafts, then sends", async () => {
    const h = setup();
    h.type("why is checkout failing?");
    h.store.addChip(h.current.sid, {
      id: "chip1",
      kind: "stream",
      label: raw("default"),
      sizeBytes: 10,
      provenance: "page",
      sent: "whitelist",
    });
    const drafts = vi.spyOn(h.store.drafts, "remove");
    void h.store.send(h.current.sid);
    expect(h.session().turn).toEqual({ state: "queued" });
    expect(h.session().messages).toEqual([{ role: "user", content: "why is checkout failing?" }]);
    expect(h.session().composer).toMatchObject({ text: "", chips: [], images: [] });
    expect(drafts).toHaveBeenCalledWith("k1", h.current.sid);
    await settle();
    expect(h.session().turn).toEqual({ state: "connecting" });
    const { req } = h.last();
    expect(req).toMatchObject({
      org: "org1",
      sid: h.current.sid,
      turnId: h.session().turnMeta.turnId,
      message: { text: "why is checkout failing?" },
    });
    expect(req.context).toEqual({
      currentPage: "logs",
      selectedStreams: ["default"],
      client: {
        container: "sidebar",
        entry_kind: "header_button",
        entry_verb: "ask",
        object_kind: "none",
        ui_version: "ui1",
      },
      user_timezone: expect.any(String),
    });
    expect(h.capability.noteAdmitted).toHaveBeenCalled();
  });

  it("streams one turn to done and emits the lifecycle once (HT-11 AC 2, 6)", async () => {
    const h = setup();
    h.type("why?");
    const run = h.store.send(h.current.sid);
    await settle();
    h.feed(
      { type: "status", message: "processing" },
      { type: "tool_call", tool: "SearchSQL", call_id: "c1", context: { stream_name: "default" } },
      { type: "tool_result", tool: "SearchSQL", call_id: "c1", summary: "4 rows" },
      { type: "message_delta", content: "Answer." },
      {
        type: "complete",
        persisted: true,
        trace_id: "tr-9",
        usage: { input_tokens: 10, output_tokens: 3 },
      },
    );
    h.end();
    await expect(run).resolves.toEqual({ state: "done", saved: "server" });
    const s = h.session();
    expect(s.turnMeta).toMatchObject({ traceId: "tr-9", usage: { tokensIn: 10, tokensOut: 3 } });
    expect(s.messages[1].contentBlocks?.[0]).toMatchObject({ call_id: "c1", stepState: "done" });
    expect(h.save).toHaveBeenCalledWith(h.current.sid);
    expect(vi.mocked(trackAssistant).mock.calls.map(([name]) => name)).toEqual([
      "ai_turn_sent",
      "ai_turn_first_byte",
      "ai_turn_state",
      "ai_turn_ended",
    ]);
    expect(trackAssistantAdmitted).toHaveBeenCalledTimes(1);
    expect(tracked("ai_turn_ended")[0][1]).toMatchObject({
      outcome: "done",
      tool_calls: 1,
      tokens_in: 10,
    });
  });

  it("sends only the new message and known_seq on a persisted chat (HT-07 AC 2)", async () => {
    const h = setup({ persistence: true });
    h.session().messages.push(
      { role: "user", content: raw("old") },
      { role: "assistant", content: raw("reply") },
    );
    h.session().record.cachedLastSeq = 40;
    h.type("next");
    void h.store.send(h.current.sid);
    await settle();
    expect(h.last().req.knownSeq).toBe(40);
    expect(h.last().req.transcript).toBeUndefined();
  });

  it("sends the transcript as today on a browser-only chat, with images only on the new message", async () => {
    const h = setup({ persistence: false });
    h.session().messages.push(
      {
        role: "user",
        content: raw("old"),
        images: [{ data: "OLD", mimeType: "image/png", filename: "o.png", size: 3 }],
      },
      { role: "assistant", content: raw("reply") },
    );
    h.type("next");
    h.store.addImage(h.current.sid, {
      data: "NEW",
      mimeType: "image/png",
      filename: "n.png",
      size: 3,
    });
    void h.store.send(h.current.sid);
    await settle();
    expect(h.last().req.transcript).toEqual([
      { role: "user", content: "old" },
      { role: "assistant", content: "reply" },
    ]);
    expect(h.last().req.message.images?.map((i) => i.data)).toEqual(["NEW"]);
    expect(h.last().req.knownSeq).toBeUndefined();
  });

  it("uses the request builder WP-05 installs", async () => {
    const h = setup();
    const builder = vi.fn((session: AssistantSession) => ({
      org: session.org,
      sid: session.sid,
      turnId: session.turnMeta.turnId ?? "",
      message: { text: "serialized" },
      context: { currentPage: "x", client: {} as never, user_timezone: "UTC" },
    }));
    h.engine.setRequestBuilder(builder);
    h.type("raw text");
    void h.store.send(h.current.sid);
    await settle();
    expect(builder).toHaveBeenCalled();
    expect(h.last().req.message.text).toBe("serialized");
  });

  it("refuses an empty composer without sending", async () => {
    const h = setup();
    await expect(h.store.send(h.current.sid)).resolves.toMatchObject({ state: "refused" });
    expect(h.client.send).not.toHaveBeenCalled();
  });
});

describe("turnEngine: refusals and retry (HT-03)", () => {
  const withChip = (h: ReturnType<typeof setup>) => {
    h.type("explain this");
    h.store.addChip(h.current.sid, {
      id: "row1",
      kind: "log_row",
      label: raw("row"),
      data: { message: "boom" },
      sizeBytes: 50,
      provenance: "door",
      sent: "serialized",
    });
    h.store.addImage(h.current.sid, {
      data: "IMG",
      mimeType: "image/png",
      filename: "a.png",
      size: 3,
    });
  };

  it("gives back text, chips with payloads and images, and stores nothing", async () => {
    const h = setup();
    withChip(h);
    h.results.push(refusal(429, { code: 429, error_code: "turn_limit" }));
    const terminal = await h.store.send(h.current.sid);
    expect(terminal).toMatchObject({ state: "refused", error: { code: "turn_limit" } });
    const s = h.session();
    expect(s.messages).toEqual([]);
    expect(s.composer.text).toBe("explain this");
    expect(s.composer.chips[0]).toMatchObject({ id: "row1", data: { message: "boom" } });
    expect(s.composer.images.map((i) => i.data)).toEqual(["IMG"]);
    expect(h.save).not.toHaveBeenCalled();
  });

  it("flips useChatStream.spec.ts:163-171: an offline send is refused{offline} with the snapshot back", async () => {
    const h = setup();
    withChip(h);
    h.results.push({
      ok: false,
      error: { code: "offline", phase: "pre_admission", retryable: true, action: "retry" },
    });
    await expect(h.store.send(h.current.sid)).resolves.toMatchObject({
      state: "refused",
      error: { code: "offline" },
    });
    expect(h.session().composer.text).toBe("explain this");
    expect(h.session().composer.chips).toHaveLength(1);
  });

  it("retries a refusal with the same turn id exactly once, then mints a new one (constraint 16)", async () => {
    const h = setup();
    withChip(h);
    h.results.push(
      refusal(429, { error_code: "turn_limit" }),
      refusal(429, { error_code: "turn_limit" }),
    );
    await h.store.send(h.current.sid);
    const first = h.last().req.turnId;
    await h.store.retry(h.current.sid);
    expect(h.last().req.turnId).toBe(first);
    expect(h.last().req.message).toMatchObject({ text: "explain this" });
    const retried = tracked("ai_turn_sent").at(-1)?.[1];
    expect(retried).toMatchObject({ input: "retry", chip_count: 1 });
    void h.store.retry(h.current.sid);
    await settle();
    expect(h.last().req.turnId).not.toBe(first);
  });

  it("types a 409 lease as turn_busy carrying the running turn (SH-08)", async () => {
    const h = setup();
    h.type("q");
    h.results.push(refusal(409, { error_code: "turn_busy", active_turn_id: "running-1" }));
    await expect(h.store.send(h.current.sid)).resolves.toMatchObject({
      state: "refused",
      error: { code: "turn_busy", turnId: "running-1", action: "stop_it" },
    });
  });

  it("notes a 403 on the capability and an agent outage too", async () => {
    const h = setup();
    h.type("q");
    h.results.push(refusal(403, {}));
    await h.store.send(h.current.sid);
    expect(h.capability.noteForbidden).toHaveBeenCalled();
    h.type("q2");
    h.results.push(refusal(502, { code: 502, error: "down" }));
    await expect(h.store.send(h.current.sid)).resolves.toMatchObject({
      state: "failed",
      error: { code: "agent_unavailable" },
    });
    expect(h.capability.noteAgentUnavailable).toHaveBeenCalled();
  });

  it("reads a connection closed before any frame as unreachable, not sent (HT-06 AC 5)", async () => {
    const h = setup();
    withChip(h);
    const run = h.store.send(h.current.sid);
    await settle();
    h.end();
    await expect(run).resolves.toMatchObject({ state: "refused", error: { code: "unreachable" } });
    expect(h.session().composer.text).toBe("explain this");
  });
});

describe("turnEngine: consent (CC-06)", () => {
  it("waits on consent with the snapshot, resends the same turn once on Enable", async () => {
    const h = setup();
    const handler = vi.fn();
    h.engine.setConsentHandler(handler);
    h.type("why?");
    h.results.push(refusal(412, consentBody));
    const run = h.store.send(h.current.sid);
    await settle();
    expect(h.session().turn).toEqual({ state: "awaiting_consent" });
    expect(h.session().pendingConsent).toMatchObject({
      org: "org1",
      feature: "ai_credits",
      turnId: h.last().req.turnId,
      snapshot: { text: "why?" },
      status: { billing_status: "eligible" },
    });
    expect(handler).toHaveBeenCalledWith(
      h.current.sid,
      expect.objectContaining({ code: "consent_declined", httpStatus: 412 }),
    );
    const turnId = h.last().req.turnId;
    void h.engine.send(h.current.sid, { turnId });
    await settle();
    expect(h.sends).toHaveLength(2);
    expect(h.last().req.turnId).toBe(turnId);
    h.feed({ type: "message_delta", content: "ok" }, { type: "complete", persisted: true });
    h.end();
    await expect(run).resolves.toEqual({ state: "done", saved: "server" });
  });

  it("refuses consent_still_required when the same-turn retry answers 412 again", async () => {
    const h = setup();
    h.type("why?");
    h.results.push(refusal(412, consentBody), refusal(412, consentBody));
    const run = h.store.send(h.current.sid);
    await settle();
    void h.engine.send(h.current.sid, { turnId: h.last().req.turnId });
    await expect(run).resolves.toMatchObject({
      state: "refused",
      error: { code: "consent_still_required" },
    });
    expect(h.session().composer.text).toBe("why?");
  });

  it("treats Stop while waiting on consent as Cancel (HT-04 edge)", async () => {
    const h = setup();
    h.type("why?");
    h.results.push(refusal(412, consentBody));
    const run = h.store.send(h.current.sid);
    await settle();
    await h.store.stop(h.current.sid);
    await expect(run).resolves.toMatchObject({
      state: "refused",
      error: { code: "consent_declined" },
    });
    expect(h.session().pendingConsent).toBeNull();
    expect(h.session().composer.text).toBe("why?");
    expect(h.client.stop).not.toHaveBeenCalled();
  });
});

describe("turnEngine: restore once (constraint 11)", () => {
  it("restores an owner race mid-stream with the same turn id and page context", async () => {
    const h = setup({ persistence: true });
    h.type("why?");
    const run = h.store.send(h.current.sid);
    await settle();
    const first = h.last();
    h.feed(
      { type: "message_delta", content: "par" },
      { type: "error", category: "session_owner_unavailable", message: "moved" },
    );
    expect(h.session().turn).toMatchObject({ state: "reconnecting" });
    await settle();
    expect(first.signal.aborted).toBe(true);
    expect(h.sends).toHaveLength(2);
    expect(h.last().req.turnId).toBe(first.req.turnId);
    expect(h.last().req.sid).toBe(first.req.sid);
    expect(h.last().req.context).toEqual(first.req.context);
    expect(h.session().messages).toHaveLength(1);
    expect(h.session().turnMeta.restored).toBe(true);
    h.feed({ type: "message_delta", content: "whole" }, { type: "complete", persisted: true });
    h.end();
    await expect(run).resolves.toEqual({ state: "done", saved: "server" });
    expect(String(h.session().messages[1].content)).toBe("whole");
  });

  it("fails the second owner race instead of restoring again", async () => {
    const h = setup();
    h.type("why?");
    const run = h.store.send(h.current.sid);
    await settle();
    h.feed({ type: "error", code: "session_owner_unavailable" });
    await settle();
    h.feed({ type: "error", code: "session_owner_unavailable" });
    await expect(run).resolves.toMatchObject({
      state: "failed",
      error: { code: "session_owner_unavailable" },
    });
    expect(h.sends).toHaveLength(2);
  });

  it("restores a browser-only chat under a new session id, moving the session (constraint 7)", async () => {
    const h = setup({ persistence: false });
    h.type("why?");
    const oldSid = h.current.sid;
    void h.store.send(oldSid);
    await settle();
    h.results.push(OK);
    h.feed({ type: "error", code: "session_owner_unavailable" });
    await settle();
    const newSid = h.last().req.sid;
    expect(newSid).not.toBe(oldSid);
    expect(h.store.state.sessions[oldSid]).toBeUndefined();
    expect(h.store.state.sessions[newSid]?.sid).toBe(newSid);
    expect(h.store.state.shell.activeSid).toBe(newSid);
    expect(h.last().req.turnId).toBe(h.sends[0].req.turnId);
  });

  it("restores a pre-admission owner 409 once with the same turn id", async () => {
    const h = setup();
    h.type("why?");
    h.results.push(refusal(409, { code: "session_owner_unavailable", error: "moved" }));
    void h.store.send(h.current.sid);
    await settle();
    expect(h.sends).toHaveLength(2);
    expect(h.sends[1].req.turnId).toBe(h.sends[0].req.turnId);
  });
});

describe("turnEngine: stop (HT-04)", () => {
  it("aborts, posts the cancel with the turn id and ends stopped with the steps kept", async () => {
    const h = setup();
    h.type("why?");
    const run = h.store.send(h.current.sid);
    await settle();
    h.feed(
      { type: "tool_call", tool: "StreamList", call_id: "a" },
      { type: "tool_result", tool: "StreamList", call_id: "a" },
      { type: "tool_call", tool: "SearchSQL", call_id: "b" },
      { type: "message_delta", content: "so far" },
    );
    const signal = h.last().signal;
    clock += 120;
    await h.store.stop(h.current.sid);
    await expect(run).resolves.toEqual({ state: "stopped", steps: 2, partial: true });
    expect(signal.aborted).toBe(true);
    expect(h.client.stop).toHaveBeenCalledWith(
      "org1",
      expect.objectContaining({ sid: h.current.sid, turnId: h.last().req.turnId }),
    );
    const blocks = h.session().messages[1].contentBlocks ?? [];
    expect(blocks.filter((b) => b.stepState).map((b) => b.stepState)).toEqual([
      "done",
      "interrupted",
    ]);
    expect(tracked("ai_stop")[0][1]).toEqual({
      surface: "chat",
      server_cancel_ms: 0,
      partial_kept: true,
    });
    expect(h.session().turnMeta.cancelUnconfirmed).toBe(false);
  });

  it("ends stopped and unconfirmed at once when the cancel fails, never claiming it (HT-04 AC 4)", async () => {
    const h = setup();
    h.type("why?");
    vi.mocked(h.client.stop).mockRejectedValue(new Error("503"));
    const run = h.store.send(h.current.sid);
    await settle();
    void h.store.stop(h.current.sid);
    await settle();
    await expect(run).resolves.toMatchObject({ state: "stopped" });
    expect(h.session().turnMeta.cancelUnconfirmed).toBe(true);
    expect(tracked("ai_stop")[0][1]).toMatchObject({ server_cancel_ms: null });
  });

  it("waits out the 3 s for a cancel that never answers, then reads unconfirmed", async () => {
    const h = setup();
    h.type("why?");
    vi.mocked(h.client.stop).mockReturnValue(new Promise(() => undefined));
    const run = h.store.send(h.current.sid);
    await settle();
    void h.store.stop(h.current.sid);
    await vi.advanceTimersByTimeAsync(STOP_TIMEOUT_MS - 1);
    expect(h.session().turn).toEqual({ state: "stopping" });
    await vi.advanceTimersByTimeAsync(1);
    await expect(run).resolves.toMatchObject({ state: "stopped" });
    expect(h.session().turnMeta.cancelUnconfirmed).toBe(true);
  });

  it("flips O2AIChat.session.spec.ts:485: stopAll(org_switch) aborts and cancels under the captured key", async () => {
    const h = setup();
    h.type("why?");
    const run = h.store.send(h.current.sid);
    await settle();
    const signal = h.last().signal;
    h.store.setIdentity({ userOrgKey: "k2", org: "org2" });
    await h.engine.stopAll("org_switch");
    await expect(run).resolves.toMatchObject({ state: "stopped" });
    expect(signal.aborted).toBe(true);
    expect(h.client.stop).toHaveBeenCalledWith(
      "org1",
      expect.objectContaining({ sid: h.current.sid }),
    );
    expect(h.session().userOrgKey).toBe("k1");
    expect(h.save).toHaveBeenCalledWith(h.current.sid);
  });

  it("fails a cancelled frame this tab did not cause (HT-04 edge)", async () => {
    const h = setup();
    h.type("why?");
    const run = h.store.send(h.current.sid);
    await settle();
    h.feed({ type: "message_delta", content: "x" }, { type: "cancelled" });
    await expect(run).resolves.toMatchObject({
      state: "failed",
      error: { code: "cancelled_elsewhere" },
    });
  });
});

describe("turnEngine: reconnect (HT-06)", () => {
  it("tails from the last seq with back-off and applies overlapping frames once", async () => {
    const h = setup({ tail: true });
    h.type("why?");
    const run = h.store.send(h.current.sid);
    await settle();
    h.feed(
      { id: "1", frame: { type: "message_delta", content: "Hel" } },
      { id: "2", frame: { type: "message_delta", content: "lo" } },
    );
    h.end();
    expect(h.session().turn).toEqual({ state: "reconnecting", attempt: 1 });
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[0] - 1);
    expect(h.client.tail).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(h.tails[0]).toMatchObject({ fromSeq: 2, turnId: h.last().req.turnId });
    const tail = h.tails[0].sink;
    tail.onFrame({ type: "message_delta", content: "lo" }, "2");
    tail.onFrame({ type: "message_delta", content: "!" }, "3");
    expect(h.session().turnMeta.caughtUpAt).toBe(clock);
    tail.onFrame({ type: "complete", persisted: true }, "4");
    tail.onEnd("eof");
    await expect(run).resolves.toEqual({ state: "done", saved: "server" });
    expect(String(h.session().messages[1].content)).toBe("Hello!");
  });

  it("ends stream_dropped without a tail, keeping the text (HT-06 AC 3-4)", async () => {
    const h = setup({ tail: false });
    h.type("why?");
    const run = h.store.send(h.current.sid);
    await settle();
    h.feed(
      { type: "tool_call", tool: "SearchSQL", call_id: "c1" },
      { type: "message_delta", content: "partial" },
    );
    h.end();
    await expect(run).resolves.toMatchObject({
      state: "failed",
      error: { code: "stream_dropped" },
    });
    expect(h.session().messages[1].contentBlocks?.[0].stepState).toBe("interrupted");
    expect(tracked("ai_turn_ended")[0][1]).toMatchObject({ outcome: "lost" });
  });

  it("gives up after three failed tails", async () => {
    const h = setup({ tail: true });
    h.type("why?");
    const run = h.store.send(h.current.sid);
    await settle();
    h.feed({ id: "1", frame: { type: "message_delta", content: "x" } });
    h.tailResults.push(refusal(404, {}), refusal(404, {}), refusal(404, {}));
    h.end();
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS.reduce((a, b) => a + b, 0));
    await expect(run).resolves.toMatchObject({
      state: "failed",
      error: { code: "stream_dropped" },
    });
    expect(h.client.tail).toHaveBeenCalledTimes(3);
  });

  it("waits for a hidden tab to be visible before reconnecting (HT-06 AC 8)", async () => {
    const h = setup({ tail: true, hidden: true });
    h.type("why?");
    void h.store.send(h.current.sid);
    await settle();
    h.feed({ id: "1", frame: { type: "message_delta", content: "x" } });
    h.end();
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[0] + 1_000);
    expect(h.client.tail).not.toHaveBeenCalled();
    h.show();
    await settle();
    expect(h.client.tail).toHaveBeenCalledTimes(1);
  });
});

describe("turnEngine: outcomes", () => {
  // Wrapped, so awaiting the start never waits for the turn itself.
  const start = async (h: ReturnType<typeof setup>) => {
    h.type("why?");
    const run = h.store.send(h.current.sid);
    await settle();
    return { run };
  };

  it("fails an empty answer as empty_response (HT-02 AC 9)", async () => {
    const h = setup();
    const { run } = await start(h);
    h.feed({ type: "status" }, { type: "complete" });
    h.end();
    await expect(run).resolves.toMatchObject({
      state: "failed",
      error: { code: "empty_response" },
    });
  });

  it.each([
    [
      "after",
      [
        { type: "message_delta", content: "a" },
        { type: "complete", persisted: true },
        { type: "error", code: "persistence_failed" },
      ],
    ],
    [
      "before",
      [
        { type: "message_delta", content: "a" },
        { type: "error", code: "persistence_failed" },
        { type: "complete" },
      ],
    ],
  ])(
    "keeps a turn done when persistence fails %s complete (constraint 14)",
    async (_when, frames) => {
      const h = setup();
      const { run } = await start(h);
      h.feed(...(frames as AssistantFrame[]));
      h.end();
      await expect(run).resolves.toMatchObject({ state: "done" });
      expect(h.session().turn).toEqual({ state: "done", saved: "not_saved" });
      expect(tracked("ai_turn_ended")).toHaveLength(1);
      expect(tracked("ai_turn_ended")[0][1]).toMatchObject({ outcome: "done_not_saved" });
    },
  );

  it("fails an oversized line as stream_oversized", async () => {
    const h = setup();
    const { run } = await start(h);
    h.feed({ type: "message_delta", content: "a" });
    h.end("oversized");
    await expect(run).resolves.toMatchObject({
      state: "failed",
      error: { code: "stream_oversized" },
    });
  });

  it("closes a done turn whose stream stays open after complete", async () => {
    const h = setup();
    const { run } = await start(h);
    h.feed({ type: "message_delta", content: "a" }, { type: "complete", persisted: true });
    await expect(run).resolves.toEqual({ state: "done", saved: "server" });
    expect(tracked("ai_turn_ended")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(h.last().signal.aborted).toBe(true);
    expect(tracked("ai_turn_ended")).toHaveLength(1);
  });

  it("emits the stall event after 30 s without a frame (HT-01 AC 3)", async () => {
    const h = setup();
    await start(h);
    h.feed({ type: "tool_call", tool: "SearchSQL", call_id: "c1" });
    h.last().sink.onKeepalive();
    await vi.advanceTimersByTimeAsync(STALL_MS);
    expect(tracked("ai_turn_state").map(([, props]) => props.state)).toContain("stall");
    expect(h.session().turn.state).toBe("running_tool");
  });

  it("expires an unanswered approval as approval_expired and cancels on the server", async () => {
    const h = setup();
    const { run } = await start(h);
    h.feed({
      type: "confirmation_required",
      tool: "o2_delete",
      call_id: "c9",
      expires_at: clock + 25_000,
    });
    expect(h.session().turn).toEqual({ state: "awaiting_approval", callId: "c9" });
    await vi.advanceTimersByTimeAsync(25_000);
    await expect(run).resolves.toMatchObject({
      state: "failed",
      error: { code: "approval_expired", action: "ask_again" },
    });
    expect(h.client.stop).toHaveBeenCalled();
  });

  it("still closes a done stream left open after an approval that carried a TTL", async () => {
    const h = setup();
    const { run } = await start(h);
    h.feed(
      {
        type: "confirmation_required",
        tool: "o2_delete",
        call_id: "c9",
        expires_at: clock + 25_000,
      },
      { type: "tool_result", tool: "o2_delete", call_id: "c9" },
      { type: "message_delta", content: "Deleted." },
      { type: "complete", persisted: true },
    );
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(run).resolves.toEqual({ state: "done", saved: "server" });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.session().turn).toEqual({ state: "done", saved: "server" });
  });

  it("never expires a later turn with an earlier turn's approval TTL", async () => {
    const h = setup();
    const first = await start(h);
    h.feed({
      type: "confirmation_required",
      tool: "o2_delete",
      call_id: "c9",
      expires_at: clock + 25_000,
    });
    await h.store.stop(h.current.sid);
    await first.run;
    const second = await start(h);
    h.feed({ type: "confirmation_required", tool: "o2_delete", call_id: "c9" });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.session().turn).toEqual({ state: "awaiting_approval", callId: "c9" });
    h.feed(
      { type: "tool_result", tool: "o2_delete", call_id: "c9" },
      { type: "message_delta", content: "ok" },
      { type: "complete", persisted: true },
    );
    h.end();
    await expect(second.run).resolves.toEqual({ state: "done", saved: "server" });
  });

  it("reports ai_turn_ended for each attempt of a same-id Retry (refused, then done)", async () => {
    const h = setup();
    h.type("why?");
    h.results.push(refusal(429, { error_code: "turn_limit" }));
    await h.store.send(h.current.sid);
    const retry = h.store.retry(h.current.sid);
    await settle();
    expect(h.last().req.turnId).toBe(h.sends[0].req.turnId);
    h.feed({ type: "message_delta", content: "a" }, { type: "complete", persisted: true });
    h.end();
    await retry;
    const ended = tracked("ai_turn_ended");
    expect(ended.map(([, props]) => props.outcome)).toEqual(["refused", "done"]);
    expect(ended.map(([, , scope]) => scope?.turnId)).toEqual([
      h.sends[0].req.turnId,
      h.sends[0].req.turnId,
    ]);
  });

  it("offers Ask again after a mutating tool ran, with a new turn id on Retry", async () => {
    const h = setup();
    const { run } = await start(h);
    h.feed(
      { type: "tool_call", tool: "o2_UpdateAlert", call_id: "u1" },
      { type: "tool_result", tool: "o2_UpdateAlert", call_id: "u1" },
      { type: "error", error_type: "llm_overload", message: "busy" },
    );
    const failed = (await run) as Extract<TurnTerminal, { state: "failed" }>;
    expect(failed.error.action).toBe("ask_again");
    const firstTurn = h.last().req.turnId;
    void h.store.retry(h.current.sid);
    await settle();
    expect(h.last().req.turnId).not.toBe(firstTurn);
    expect(h.last().req.message.text).toBe("why?");
  });

  it("stages Continue with the previous chips and never sends (30 §8.4)", async () => {
    const h = setup();
    h.store.addChip(h.current.sid, {
      id: "s",
      kind: "stream",
      label: raw("default"),
      sizeBytes: 5,
      provenance: "page",
      sent: "whitelist",
    });
    const { run } = await start(h);
    await h.store.stop(h.current.sid);
    await run;
    h.store.continueTurn(h.current.sid);
    expect(h.session().composer.text).toBe("Continue");
    expect(h.session().composer.chips.map((c) => c.id)).toEqual(["s"]);
    expect(h.sends).toHaveLength(1);
  });

  it("re-posts a not-saved turn in server mode only", async () => {
    const h = setup({ persistence: true });
    const { run } = await start(h);
    h.feed({ type: "message_delta", content: "a" }, { type: "complete", persisted: false });
    h.end();
    await run;
    h.save.mockClear();
    await h.store.retrySave(h.current.sid, h.session().turnMeta.turnId ?? "");
    expect(h.save).toHaveBeenCalledWith(h.current.sid);
    expect(h.session().turn).toEqual({ state: "done", saved: "server" });
    h.persistence.value = false;
    h.save.mockClear();
    await h.store.retrySave(h.current.sid, h.session().turnMeta.turnId ?? "");
    expect(h.save).not.toHaveBeenCalled();
  });

  it("keeps no controller, reader or timer in reactive state (constraint 65)", async () => {
    const h = setup();
    await start(h);
    const values = JSON.stringify(h.session(), (_key, value) =>
      value instanceof AbortController || value instanceof AbortSignal ? "LEAK" : value,
    );
    expect(values).not.toContain("LEAK");
  });

  it("returns the running turn's promise to a second send", async () => {
    const h = setup();
    const { run } = await start(h);
    const again = h.engine.send(h.current.sid);
    expect(h.sends).toHaveLength(1);
    h.feed({ type: "message_delta", content: "a" }, { type: "complete", persisted: true });
    h.end();
    await expect(again).resolves.toEqual(await run);
  });
});

describe("turnEngine: round 3 follow-ups", () => {
  const begin = async (h: ReturnType<typeof setup>, text = "why?") => {
    h.type(text);
    const run = h.store.send(h.current.sid);
    await settle();
    return { run };
  };

  it("reaches connecting before a frame the real client already buffered (admission race)", async () => {
    const body = [
      { type: "message_delta", content: "Hello" },
      { type: "complete", persisted: true },
    ]
      .map((frame) => `data: ${JSON.stringify(frame)}\n\n`)
      .join("");
    const fetchImpl = vi.fn().mockImplementation(async () => {
      clock += 40;
      return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    });
    const client = useAssistantClient({ fetchImpl, baseUrl: () => "http://o2.test" });
    const h = setup({ client });
    const announce = vi.spyOn(h.store, "announce");
    const { run } = await begin(h);
    await vi.advanceTimersByTimeAsync(10);
    await expect(run).resolves.toEqual({ state: "done", saved: "server" });
    const keys = announce.mock.calls.map(([, key]) => key);
    expect(keys.indexOf("assistant.turn.connecting")).toBeGreaterThan(-1);
    expect(keys.indexOf("assistant.turn.connecting")).toBeLessThan(
      keys.indexOf("assistant.turn.writing"),
    );
    expect(tracked("ai_turn_first_byte")).toHaveLength(1);
    expect(tracked("ai_turn_first_byte")[0][1]).toEqual({ ttfb_ms: 40 });
    expect(h.capability.noteAdmitted).toHaveBeenCalledTimes(1);
  });

  it("ends a turn whose request builder throws as a named refusal, draft back", async () => {
    const h = setup();
    h.engine.setRequestBuilder(() => {
      throw new Error("builder bug");
    });
    const { run } = await begin(h, "keep me");
    await expect(run).resolves.toMatchObject({
      state: "refused",
      error: { code: "unknown", phase: "pre_admission" },
    });
    expect(h.session().composer.text).toBe("keep me");
  });

  it("reports a serialisation TypeError as unknown, never offline or unreachable (F7)", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    const h = setup();
    vi.mocked(h.client.send).mockImplementationOnce(() => {
      throw new TypeError("Converting circular structure to JSON");
    });
    const { run } = await begin(h);
    await expect(run).resolves.toMatchObject({
      state: "refused",
      error: { code: "unknown", phase: "pre_admission" },
    });
    vi.unstubAllGlobals();
  });

  it("fails, never refuses, a throw that lands after admission, keeping the answer (F7)", async () => {
    const h = setup();
    vi.mocked(h.client.send).mockImplementationOnce(async (_req, sink) => {
      sink.onAdmitted({ ok: true, status: 200, traceId: null });
      sink.onFrame({ type: "message_delta", content: "partial" }, null);
      throw new Error("bug after admission");
    });
    const { run } = await begin(h);
    await expect(run).resolves.toMatchObject({
      state: "failed",
      error: { code: "unknown", phase: "post_admission" },
    });
    expect(String(h.session().messages[1].content)).toBe("partial");
    expect(h.session().composer.text).toBe("");
  });

  it("ignores the tail's own admission, so a reconnect catches up once (F5)", async () => {
    const h = setup({ tail: true });
    const announce = vi.spyOn(h.store, "announce");
    vi.mocked(h.client.tail).mockImplementation(async (_org, _sid, _turnId, _from, sink) => {
      const admitted = { ok: true as const, status: 200, traceId: null };
      sink.onAdmitted(admitted);
      sink.onFrame({ type: "message_delta", content: "lo" }, "2");
      sink.onFrame({ type: "complete", persisted: true }, "3");
      sink.onEnd("eof");
      return admitted;
    });
    const { run } = await begin(h);
    h.feed({ id: "1", frame: { type: "message_delta", content: "Hel" } });
    const firstByteAt = h.session().turnMeta.firstByteAt;
    h.end();
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[0]);
    await expect(run).resolves.toEqual({ state: "done", saved: "server" });
    expect(h.session().turnMeta.caughtUpAt).not.toBeNull();
    expect(announce.mock.calls.map(([, key]) => key)).toContain("assistant.turn.caughtUp");
    expect(tracked("ai_turn_first_byte")).toHaveLength(1);
    expect(h.session().turnMeta.firstByteAt).toBe(firstByteAt);
    expect(h.capability.noteAdmitted).toHaveBeenCalledTimes(1);
    expect(String(h.session().messages[1].content)).toBe("Hello");
  });

  it("stops a running turn on sign-out within 300 ms and still settles it after the reset (F6)", async () => {
    const h = setup();
    vi.mocked(h.client.stop).mockReturnValue(new Promise(() => undefined));
    const { run } = await begin(h);
    const signal = h.last().signal;
    const signOut = h.store.onSignOut();
    expect(signal.aborted).toBe(true);
    expect(h.client.stop).toHaveBeenCalledWith(
      "org1",
      expect.objectContaining({ turnId: h.last().req.turnId }),
    );
    await vi.advanceTimersByTimeAsync(300);
    await expect(signOut).resolves.toBe("proceed");
    expect(h.store.state.sessions).toEqual({});
    await vi.advanceTimersByTimeAsync(STOP_TIMEOUT_MS);
    await expect(run).resolves.toMatchObject({ state: "stopped" });
  });

  it("names the org, the elapsed time and the provider reason in the announcement", async () => {
    const h = setup();
    const announce = vi.spyOn(h.store, "announce");
    h.results.push(refusal(402, { code: 402, error_type: "ai_credits_exhausted" }));
    await begin(h);
    expect(announce).toHaveBeenCalledWith(
      h.current.sid,
      "assistant.error.credits_exhausted.title",
      expect.objectContaining({ org: "org1", product: "O2 Assistant" }),
    );
    const second = await begin(h);
    clock += 12_000;
    h.feed(
      { type: "message_delta", content: "a" },
      { type: "error", error_type: "llm_overload", message: "busy" },
    );
    await second.run;
    expect(announce).toHaveBeenCalledWith(
      h.current.sid,
      "assistant.error.provider_error.title",
      expect.objectContaining({ reason: "overloaded" }),
    );
    const third = await begin(h);
    clock += 40_000;
    h.feed({ type: "message_delta", content: "a" });
    h.end();
    await third.run;
    expect(announce).toHaveBeenCalledWith(
      h.current.sid,
      "assistant.error.stream_dropped.title",
      expect.objectContaining({ elapsed: "40 s" }),
    );
  });

  it("starts the restored turn's seq afresh, so its frames are not dropped as replays", async () => {
    const h = setup({ persistence: true });
    const { run } = await begin(h);
    h.feed(
      { id: "1", frame: { type: "message_delta", content: "a" } },
      { id: "2", frame: { type: "error", code: "session_owner_unavailable" } },
    );
    await settle();
    expect(h.session().turnMeta.lastSeq).toBeNull();
    h.feed(
      { id: "1", frame: { type: "message_delta", content: "whole" } },
      { id: "2", frame: { type: "complete", persisted: true } },
    );
    h.end();
    await expect(run).resolves.toEqual({ state: "done", saved: "server" });
    expect(String(h.session().messages[1].content)).toBe("whole");
  });

  it("never sends one turn id a third time across a same-id Retry and a consent resume", async () => {
    const h = setup();
    h.results.push(refusal(429, { error_code: "turn_limit" }), refusal(412, consentBody));
    await begin(h);
    const retry = h.store.retry(h.current.sid);
    await settle();
    expect(h.session().turn).toEqual({ state: "awaiting_consent" });
    void h.engine.send(h.current.sid, { turnId: h.sends[1].req.turnId });
    await settle();
    const ids = h.sends.map((sent) => sent.req.turnId);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[0]);
    expect(h.session().turnMeta.turnId).toBe(ids[2]);
    h.feed({ type: "message_delta", content: "a" }, { type: "complete", persisted: true });
    h.end();
    await expect(retry).resolves.toEqual({ state: "done", saved: "server" });
  });

  it("does not restore a turn whose id was already reused once", async () => {
    const h = setup();
    h.results.push(refusal(412, consentBody));
    const { run } = await begin(h);
    void h.engine.send(h.current.sid, { turnId: h.sends[0].req.turnId });
    await settle();
    h.feed({ type: "error", code: "session_owner_unavailable" });
    await expect(run).resolves.toMatchObject({
      state: "failed",
      error: { code: "session_owner_unavailable" },
    });
    expect(h.sends).toHaveLength(2);
  });

  it.each([
    [false, 0],
    [true, 1],
  ])(
    "treats Stop while queued as a refusal: draft back, no save (persistence %s, %i cancels)",
    async (persistence, cancels) => {
      const h = setup({ persistence });
      let sent: AbortSignal | null = null;
      vi.mocked(h.client.send).mockImplementationOnce(
        (_req, _sink, signal) =>
          new Promise((resolve) => {
            sent = signal;
            signal.addEventListener("abort", () =>
              resolve({
                ok: false,
                aborted: true,
                error: toAssistantError(new TypeError("aborted")),
              }),
            );
          }),
      );
      const { run } = await begin(h, "draft text");
      expect(h.session().turn).toEqual({ state: "queued" });
      await h.store.stop(h.current.sid);
      await expect(run).resolves.toMatchObject({
        state: "refused",
        error: { code: "stopped_before_send", phase: "pre_admission" },
      });
      expect(h.session().composer.text).toBe("draft text");
      expect(h.session().messages).toEqual([]);
      expect(h.client.stop).toHaveBeenCalledTimes(cancels);
      expect(h.save).not.toHaveBeenCalled();
      expect(sent?.aborted).toBe(true);
    },
  );

  it("closes a lingering turn and starts the new one on a Send during the linger", async () => {
    const h = setup();
    const first = await begin(h);
    h.feed({ type: "message_delta", content: "a" }, { type: "complete", persisted: true });
    await first.run;
    const firstSignal = h.last().signal;
    const second = await begin(h, "next question");
    expect(firstSignal.aborted).toBe(true);
    expect(tracked("ai_turn_ended")).toHaveLength(1);
    expect(h.sends).toHaveLength(2);
    expect(h.last().req.message.text).toBe("next question");
    h.feed({ type: "message_delta", content: "b" }, { type: "complete", persisted: true });
    h.end();
    await expect(second.run).resolves.toEqual({ state: "done", saved: "server" });
  });

  it("fails the turn by name when a frame handler throws (stream end `error`)", async () => {
    const h = setup();
    const { run } = await begin(h);
    h.feed({ type: "message_delta", content: "a" });
    h.end("error");
    await expect(run).resolves.toMatchObject({ state: "failed", error: { code: "unknown" } });
  });

  it("sends the edited composer on Retry, with the snapshot's chips and a new turn id", async () => {
    const h = setup();
    h.type("first try");
    h.store.addChip(h.current.sid, {
      id: "row1",
      kind: "log_row",
      label: raw("row"),
      sizeBytes: 5,
      provenance: "door",
      sent: "serialized",
    });
    h.results.push(refusal(429, { error_code: "turn_limit" }));
    await h.store.send(h.current.sid);
    h.store.setDraft(h.current.sid, { text: "edited try" });
    void h.store.retry(h.current.sid);
    await settle();
    expect(h.last().req.message.text).toBe("edited try");
    expect(h.last().req.turnId).not.toBe(h.sends[0].req.turnId);
    expect(h.session().messages[0].content).toBe("edited try");
    const sent = tracked("ai_turn_sent").at(-1)?.[1];
    expect(sent).toMatchObject({ input: "retry", chip_count: 1 });
  });

  it("aborts every stream at once on stopAll, before any cancel answers", async () => {
    const h = setup();
    vi.mocked(h.client.stop).mockReturnValue(new Promise(() => undefined));
    await begin(h);
    const signal = h.last().signal;
    void h.engine.stopAll("sign_out");
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe("sign_out");
  });
});

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
import type {
  ApprovalsService,
  AssistantCapability,
  AssistantSession,
  TurnEngine,
} from "./assistantStore.types";
import { createDraftStore } from "./drafts";
import type { AssistantFrame } from "./frames";
import { resetPrefsForTests } from "./prefs";
import { createSseParser } from "./sseParser";
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
  opts: {
    persistence?: boolean;
    rcaChatMode?: boolean;
    tail?: boolean;
    hidden?: boolean;
    client?: AssistantClient;
    approvals?: Pick<ApprovalsService, "onConfirmationRequired" | "onResolved">;
  } = {},
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
    rcaChatMode: () => opts.rcaChatMode === true,
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
    ...(opts.approvals && { approvals: () => opts.approvals! }),
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
  it.each([
    [true, undefined, "chat"],
    [true, "chat", "chat"],
    [false, undefined, undefined],
    [false, "chat", undefined],
    [true, "generate_query", "generate_query"],
  ] as const)(
    "with rca_chat_mode=%s a %s turn goes as mode %s",
    async (rcaChatMode, mode, wire) => {
      const h = setup({ rcaChatMode });
      h.type("why is checkout failing?");
      void h.store.send(h.current.sid, mode ? { mode } : undefined);
      await settle();
      const { req } = h.last();
      if (wire) expect(req.mode).toBe(wire);
      else expect(req).not.toHaveProperty("mode");
    },
  );

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
    expect(h.session().messages).toEqual([
      {
        role: "user",
        content: "why is checkout failing?",
        sentAt: expect.any(Number),
        turnId: h.session().turnMeta.turnId,
        chips: [expect.objectContaining({ id: "chip1", kind: "stream" })],
      },
    ]);
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

  it("titles the chat from the title frame without beating a name the user gave", async () => {
    const h = setup();
    h.type("why?");
    const run = h.store.send(h.current.sid);
    await settle();
    h.feed({ type: "title", title: `  ${"Checkout 5xx".padEnd(260, "!")}  ` });
    await settle();
    expect(String(h.session().title)).toHaveLength(200);
    expect(h.session().titleSource).toBe("generated");
    h.store.setTitle(h.current.sid, raw("Mine"), "renamed");
    h.feed({ type: "title", title: "Later title" }, { type: "complete", persisted: true });
    h.end();
    await run;
    expect(String(h.session().title)).toBe("Mine");
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

  it("empties the composer again when Retry resends what the refusal gave back", async () => {
    const h = setup();
    withChip(h);
    h.results.push(refusal(429, { error_code: "turn_limit" }));
    await h.store.send(h.current.sid);
    expect(h.session().composer.text).toBe("explain this");
    void h.store.retry(h.current.sid);
    await settle();
    expect(h.session().composer).toMatchObject({ text: "", chips: [], images: [] });
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

  it("ends a turn whose paid usage went on after a Stop unsent, the prompt back, with no claim it stayed off", async () => {
    const h = setup();
    h.type("why?");
    h.results.push(refusal(412, consentBody));
    const run = h.store.send(h.current.sid);
    await settle();
    h.engine.consentWithdrawn?.(h.current.sid);
    await expect(run).resolves.toMatchObject({
      state: "refused",
      error: { code: "stopped_before_send" },
    });
    expect(h.session().pendingConsent).toBeNull();
    expect(h.session().composer.text).toBe("why?");
    expect(h.sends).toHaveLength(1);
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
    expect(h.session().messages).toHaveLength(2);
    expect(h.session().messages[1].contentBlocks).toEqual([
      { type: "turn_outcome", outcome: expect.objectContaining({ kind: "restored" }) },
    ]);
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

// The server's wire, through the real parser: `id: N` with data is a frame past seq N, and an `id: N` message alone marks seq N complete (WP-18).
function wire(sink: FrameSink, sse: string) {
  const parser = createSseParser({
    frame: (frame, id) => sink.onFrame(frame, id),
    keepalive: () => sink.onKeepalive(),
    unknown: (type) => sink.onUnknown(type),
    boundary: (id) => sink.onBoundary?.(id),
  });
  parser.push(sse);
}

const sse = (id: number, frame?: AssistantFrame) =>
  frame ? `id: ${id}\ndata: ${JSON.stringify(frame)}\n\n` : `id: ${id}\n\n`;

const delta = (content: string): AssistantFrame => ({ type: "message_delta", content });

describe("turnEngine: the SSE id rule (WP-18, D2)", () => {
  it("applies every frame of a live stream whose ids repeat: -1 for turn_started and status, one id per seq", async () => {
    const h = setup({ tail: true });
    h.type("Reply with exactly: alpha beta gamma. Then a second sentence: delta epsilon.");
    const run = h.store.send(h.current.sid);
    await settle();
    wire(
      h.last().sink,
      [
        sse(-1, { type: "turn_started", turn_id: h.last().req.turnId } as AssistantFrame),
        sse(-1, { type: "status", message: "Thinking" } as AssistantFrame),
        sse(-1, delta("alpha")),
        sse(0),
        sse(0, delta(" beta")),
        sse(0, delta(" gamma.")),
        sse(1),
        sse(1, delta(" Then delta epsilon.")),
        sse(1, { type: "complete", persisted: true }),
        sse(2),
      ].join(""),
    );
    h.end();
    await expect(run).resolves.toEqual({ state: "done", saved: "server" });
    expect(String(h.session().messages[1].content)).toBe("alpha beta gamma. Then delta epsilon.");
    expect(h.client.tail).not.toHaveBeenCalled();
    expect(h.session().turnMeta.lastSeq).toBe(2);
  });

  it("resumes the tail from the last complete seq and shows what it resends only once", async () => {
    const h = setup({ tail: true });
    h.type("why?");
    const run = h.store.send(h.current.sid);
    await settle();
    wire(
      h.last().sink,
      [sse(-1, delta("alpha")), sse(0), sse(0, delta(" beta")), sse(0, delta(" gam"))].join(""),
    );
    h.end();
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[0]);
    expect(h.tails[0]).toMatchObject({ fromSeq: 0 });
    // The tail's frames past seq 0 come as runs: the delta is the whole suffix since seq 0.
    wire(
      h.tails[0].sink,
      [
        sse(0, delta(" beta gamma.")),
        sse(1),
        sse(1, delta(" delta epsilon.")),
        sse(1, { type: "complete", persisted: true }),
        sse(2),
      ].join(""),
    );
    h.tails[0].sink.onEnd("eof");
    await expect(run).resolves.toEqual({ state: "done", saved: "server" });
    expect(String(h.session().messages[1].content)).toBe("alpha beta gamma. delta epsilon.");
  });

  it("keeps a regenerated answer's earlier versions when a tail rebuilds it", async () => {
    const h = setup({ tail: true });
    h.type("why?");
    const first = h.store.send(h.current.sid);
    await settle();
    wire(
      h.last().sink,
      [sse(-1, delta("first")), sse(-1, { type: "complete", persisted: true }), sse(0)].join(""),
    );
    h.end();
    await first;
    const run = h.store.regenerate(h.current.sid);
    await settle();
    wire(h.last().sink, [sse(-1, delta("sec")), sse(0), sse(0, delta("ond"))].join(""));
    h.end();
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[0]);
    wire(
      h.tails[0].sink,
      [sse(0, delta("ond")), sse(0, { type: "complete", persisted: true }), sse(1)].join(""),
    );
    h.tails[0].sink.onEnd("eof");
    await expect(run).resolves.toEqual({ state: "done", saved: "server" });
    const answer = h.session().messages[1];
    expect(String(answer.content)).toBe("second");
    expect(answer.versions?.map((v) => String(v.content))).toEqual(["first"]);
  });

  it("matches a resent tool call and text by position, across a second drop of the tail", async () => {
    const h = setup({ tail: true });
    h.type("why?");
    const run = h.store.send(h.current.sid);
    await settle();
    const call: AssistantFrame = { type: "tool_call", tool: "SearchSQL", call_id: "c1" };
    wire(
      h.last().sink,
      [sse(-1, delta("Hi.")), sse(3), sse(3, call), sse(3, delta("ab"))].join(""),
    );
    h.end();
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[0]);
    expect(h.tails[0]).toMatchObject({ fromSeq: 3 });
    // The first tail repeats the call and part of the text, then drops too.
    wire(h.tails[0].sink, [sse(3, call), sse(3, delta("a"))].join(""));
    h.tails[0].sink.onEnd("eof");
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[1]);
    expect(h.tails[1]).toMatchObject({ fromSeq: 3 });
    wire(
      h.tails[1].sink,
      [
        sse(3, call),
        sse(3, delta("abcd")),
        sse(4),
        sse(4, { type: "complete", persisted: true }),
        sse(5),
      ].join(""),
    );
    h.tails[1].sink.onEnd("eof");
    await expect(run).resolves.toEqual({ state: "done", saved: "server" });
    const blocks = h.session().messages[1].contentBlocks ?? [];
    expect(blocks.filter((block) => block.type === "tool_call")).toHaveLength(1);
    expect(String(h.session().messages[1].content)).toBe("Hi.abcd");
  });

  // Live, then a drop, then one tail; returns the answer text and the turn's end.
  async function dropAndTail(live: string, resent: string) {
    const h = setup({ tail: true });
    h.type("why?");
    const run = h.store.send(h.current.sid);
    await settle();
    wire(h.last().sink, live);
    h.end();
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[0]);
    wire(h.tails[0].sink, resent);
    h.tails[0].sink.onEnd("eof");
    return { h, end: await run, text: String(h.session().messages[1].content) };
  }

  it("shows a resent text once when a status sat between its deltas: the tail merges the run (F1)", async () => {
    const status = { type: "status", message: "Searching" } as AssistantFrame;
    const { end, text } = await dropAndTail(
      [sse(-1, delta("Hi. ")), sse(3), sse(3, delta("a")), sse(3, status), sse(3, delta("b"))].join(
        "",
      ),
      [sse(3, delta("ab")), sse(4), sse(4, { type: "complete", persisted: true }), sse(5)].join(""),
    );
    expect(end).toEqual({ state: "done", saved: "server" });
    expect(text).toBe("Hi. ab");
  });

  it("shows a resent text once when the tail leaves out turn_started and status (F1)", async () => {
    const { end, text } = await dropAndTail(
      [
        sse(-1, { type: "turn_started", turn_id: "t1" } as AssistantFrame),
        sse(-1, { type: "status", message: "Thinking" } as AssistantFrame),
        sse(-1, delta("alpha")),
      ].join(""),
      [
        sse(-1, delta("alpha beta")),
        sse(0),
        sse(0, { type: "complete", persisted: true }),
        sse(1),
      ].join(""),
    );
    expect(end).toEqual({ state: "done", saved: "server" });
    expect(text).toBe("alpha beta");
  });

  it("applies the next seq in full after a resend that stopped short of what was shown (F2)", async () => {
    const { end, text } = await dropAndTail(
      [sse(-1, delta("x")), sse(3), sse(3, delta("ab"))].join(""),
      [
        sse(3, delta("a")),
        sse(4),
        sse(4, delta("zc")),
        sse(4, { type: "complete", persisted: true }),
        sse(5),
      ].join(""),
    );
    expect(end).toEqual({ state: "done", saved: "server" });
    // Seq 4 is what the tail says it is: the "b" shown live but never resent does not stay on screen.
    expect(text).toBe("xazc");
  });

  it("keeps the text shown since the cursor when no tail delivers (HT-06 AC 3)", async () => {
    const h = setup({ tail: true });
    h.type("why?");
    const run = h.store.send(h.current.sid);
    await settle();
    wire(h.last().sink, [sse(-1, delta("one")), sse(0), sse(0, delta(" two"))].join(""));
    h.tailResults.push(refusal(404, {}), refusal(404, {}), refusal(404, {}));
    h.end();
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS.reduce((a, b) => a + b, 0));
    await expect(run).resolves.toMatchObject({
      state: "failed",
      error: { code: "stream_dropped" },
    });
    expect(String(h.session().messages[1].content)).toBe("one two");
  });

  it("drops a tail frame from before the resume point, and a frame without an id is always applied", async () => {
    const h = setup({ tail: true });
    h.type("why?");
    const run = h.store.send(h.current.sid);
    await settle();
    wire(h.last().sink, [sse(-1, delta("one")), sse(2), sse(2, delta(" two"))].join(""));
    h.end();
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[0]);
    wire(h.tails[0].sink, [sse(1, delta("one")), sse(2, delta(" two three")), sse(3)].join(""));
    h.tails[0].sink.onFrame({ type: "complete", persisted: true }, null);
    h.tails[0].sink.onEnd("eof");
    await expect(run).resolves.toEqual({ state: "done", saved: "server" });
    expect(String(h.session().messages[1].content)).toBe("one two three");
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
    await vi.advanceTimersByTimeAsync(26_000);
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
      // A frame tagged 1 comes after seq 1, so the tail from 1 sends that text again, merged (WP-18).
      sink.onFrame({ type: "message_delta", content: "Hello" }, "1");
      sink.onFrame({ type: "complete", persisted: true }, "2");
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

  it("ends a running turn as signed out when another tab signs out, posting its cancel and never reloading", async () => {
    const h = setup();
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    const { run } = await begin(h);
    const signal = h.last().signal;
    await h.engine.signedOutElsewhere?.();
    expect(signal.aborted).toBe(true);
    expect(h.client.stop).toHaveBeenCalledWith(
      "org1",
      expect.objectContaining({ turnId: h.last().req.turnId }),
    );
    await expect(run).resolves.toMatchObject({
      state: "failed",
      error: { code: "signed_out", action: "sign_in" },
    });
    expect(reload).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
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

  it("keeps the restored marker when a tail rolls the restored answer back to its cursor (F4)", async () => {
    const h = setup({ persistence: true, tail: true });
    const { run } = await begin(h);
    h.feed({ type: "error", code: "session_owner_unavailable" });
    await settle();
    const restored = {
      type: "turn_outcome",
      outcome: expect.objectContaining({ kind: "restored" }),
    };
    wire(h.last().sink, [sse(-1, delta("one")), sse(0), sse(0, delta(" tw"))].join(""));
    h.end();
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[0]);
    wire(
      h.tails[0].sink,
      [sse(0, delta(" two")), sse(1), sse(1, { type: "complete", persisted: true }), sse(2)].join(
        "",
      ),
    );
    h.tails[0].sink.onEnd("eof");
    await expect(run).resolves.toEqual({ state: "done", saved: "server" });
    const answer = h.session().messages[1];
    expect(String(answer.content)).toBe("one two");
    expect(answer.contentBlocks?.[0]).toEqual(restored);
    expect(answer.contentBlocks?.filter((block) => block.type === "turn_outcome")).toHaveLength(1);
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

describe("turnEngine: WP-06 outcomes, Regenerate and Edit and resend", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clock = 0;
    resetPrefsForTests();
  });
  afterEach(() => vi.useRealTimers());

  it("writes a failure into its answer, so a reload renders the same block (HT-01 AC 7)", async () => {
    const h = setup({ persistence: false });
    h.type("why?");
    const run = h.store.send(h.current.sid);
    await settle();
    h.feed({ type: "message_delta", content: "partial" });
    clock = 40_000;
    h.end();
    await run;
    const answer = h.session().messages[1];
    expect(answer.contentBlocks?.at(-1)).toMatchObject({
      type: "turn_outcome",
      outcome: {
        kind: "failed",
        code: "stream_dropped",
        action: "retry",
        elapsedMs: 40_000,
        sessionId: h.current.sid,
      },
    });
  });

  it("writes a stop with nothing streamed into a new empty answer", async () => {
    const h = setup();
    h.type("why?");
    const run = h.store.send(h.current.sid);
    await settle();
    h.feed({ type: "status", message: "thinking" });
    const stopping = h.store.stop(h.current.sid);
    await settle();
    await stopping;
    await run;
    expect(h.session().messages).toHaveLength(2);
    expect(h.session().messages[1].contentBlocks).toEqual([
      { type: "turn_outcome", outcome: expect.objectContaining({ kind: "stopped", steps: 0 }) },
    ]);
  });

  it("stores nothing for a refusal and offers its Retry while the snapshot exists (HT-03 AC 5)", async () => {
    const h = setup();
    h.results.push(refusal(429, { code: 429, error_code: "turn_limit", message: "busy" }));
    h.type("why?");
    await h.store.send(h.current.sid);
    expect(h.session().messages).toEqual([]);
    expect(h.store.canRetry(h.current.sid)).toBe(true);
  });

  it("regenerates the latest prompt as a new attempt; the old answer becomes a version and the draft stays (EB-09 AC 2)", async () => {
    const h = setup();
    h.type("why?");
    const first = h.store.send(h.current.sid);
    await settle();
    h.feed(
      { type: "message_delta", content: "first answer" },
      { type: "complete", persisted: true },
    );
    h.end();
    await first;
    h.type("check cart too");
    const again = h.store.regenerate(h.current.sid);
    await settle();
    expect(h.last().req.message.text).toBe("why?");
    expect(h.session().composer.text).toBe("check cart too");
    h.feed(
      { type: "message_delta", content: "second answer" },
      { type: "complete", persisted: true },
    );
    h.end();
    await again;
    const messages = h.session().messages;
    expect(messages).toHaveLength(2);
    expect(String(messages[1].content)).toBe("second answer");
    expect(messages[1].versions?.map((v) => String(v.content))).toEqual(["first answer"]);
    expect(tracked("ai_turn_sent").at(-1)?.[1]).toMatchObject({ input: "regenerate" });
  });

  it("puts the previous answer back when a regenerate is refused", async () => {
    const h = setup();
    h.type("why?");
    const first = h.store.send(h.current.sid);
    await settle();
    h.feed({ type: "message_delta", content: "kept" }, { type: "complete", persisted: true });
    h.end();
    await first;
    h.results.push(refusal(429, { code: 429, error_code: "turn_limit", message: "busy" }));
    await h.store.regenerate(h.current.sid);
    expect(h.session().messages.map((m) => String(m.content))).toEqual(["why?", "kept"]);
    expect(h.session().composer.text).toBe("");
  });

  const answered = async (h: ReturnType<typeof setup>, text: string) => {
    h.type("why?");
    const first = h.store.send(h.current.sid);
    await settle();
    h.feed({ type: "message_delta", content: text }, { type: "complete", persisted: true });
    h.end();
    await first;
  };

  it("keeps turn_started's trace for Details when the turn fails before complete (S11)", async () => {
    const h = setup();
    h.type("why?");
    const run = h.store.send(h.current.sid);
    await settle();
    h.feed({ type: "turn_started", turn_id: "srv-1", trace_id: "tr-early" });
    await settle();
    h.feed({ type: "error", error_type: "provider_error", message: "down" });
    h.end();
    await run;
    const outcome = h
      .session()
      .messages.at(-1)
      ?.contentBlocks?.find((block) => block.type === "turn_outcome")?.outcome;
    expect(outcome).toMatchObject({ kind: "failed", traceId: "tr-early" });
  });

  it("shows the new attempt of a regenerate even when an older version was selected (F2)", async () => {
    const h = setup();
    await answered(h, "kept");
    const userTurn = h.session().messages[0].turnId ?? "";
    h.store.selectVersion(h.current.sid, userTurn, 1);
    const again = h.store.regenerate(h.current.sid);
    await settle();
    expect(h.session().ui.activeVersion[userTurn]).toBeUndefined();
    h.feed({ type: "message_delta", content: "new" }, { type: "complete", persisted: true });
    h.end();
    await again;
  });

  it("retries a refused regenerate as a new version, keeping one prompt and the draft (F3, S4)", async () => {
    const h = setup();
    await answered(h, "kept");
    h.type("half-typed draft");
    h.results.push(refusal(429, { code: 429, error_code: "rate_limited", message: "slow" }));
    await h.store.regenerate(h.current.sid);
    const again = h.store.retry(h.current.sid);
    await settle();
    expect(h.last().req.message.text).toBe("why?");
    expect(h.session().composer.text).toBe("half-typed draft");
    h.feed({ type: "message_delta", content: "fresh" }, { type: "complete", persisted: true });
    h.end();
    await again;
    const messages = h.session().messages;
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(String(messages[1].content)).toBe("fresh");
    expect(messages[1].versions?.map((v) => String(v.content))).toEqual(["kept"]);
  });

  it("retries a failed regenerate as another version, not a second prompt (F3)", async () => {
    const h = setup();
    await answered(h, "kept");
    const again = h.store.regenerate(h.current.sid);
    await settle();
    h.feed({ type: "error", error_type: "provider_error", message: "down" });
    h.end();
    await again;
    expect(h.session().turn.state).toBe("failed");
    const retry = h.store.retry(h.current.sid);
    await settle();
    h.feed({ type: "message_delta", content: "fresh" }, { type: "complete", persisted: true });
    h.end();
    await retry;
    const messages = h.session().messages;
    expect(messages.filter((m) => m.role === "user")).toHaveLength(1);
    expect(String(messages.at(-1)?.content)).toBe("fresh");
    expect(messages.at(-1)?.versions?.map((v) => String(v.content))).toEqual(["kept"]);
  });

  it("keeps the draft when an edit is refused, and Retry resends the edit (S7)", async () => {
    const h = setup();
    await answered(h, "kept");
    h.type("my draft");
    h.results.push(refusal(429, { code: 429, error_code: "rate_limited", message: "slow" }));
    await h.store.editResend(h.current.sid, {
      text: "edited",
      chips: [],
      images: [],
      editedFrom: 1,
    });
    expect(h.session().composer.text).toBe("my draft");
    const retry = h.store.retry(h.current.sid);
    await settle();
    expect(h.last().req.message.text).toBe("edited");
    expect(h.session().messages.at(-1)).toMatchObject({ content: "edited", editedFrom: 1 });
    expect(h.session().composer.text).toBe("my draft");
    h.feed({ type: "message_delta", content: "ok" }, { type: "complete", persisted: true });
    h.end();
    await retry;
  });

  it("gives a refused edit back to an empty composer", async () => {
    const h = setup();
    await answered(h, "kept");
    h.results.push(refusal(429, { code: 429, error_code: "rate_limited", message: "slow" }));
    await h.store.editResend(h.current.sid, {
      text: "edited",
      chips: [],
      images: [],
      editedFrom: 1,
    });
    expect(h.session().composer.text).toBe("edited");
  });

  it("sends an edit as a new turn captioned with its source, the composer untouched (EB-09 AC 4)", async () => {
    const h = setup();
    h.type("draft in progress");
    const edit = h.store.editResend(h.current.sid, {
      text: "edited",
      chips: [],
      images: [],
      editedFrom: 1,
    });
    await settle();
    expect(h.last().req.message.text).toBe("edited");
    expect(h.session().messages[0]).toMatchObject({
      role: "user",
      content: "edited",
      editedFrom: 1,
    });
    expect(h.session().composer.text).toBe("draft in progress");
    h.feed({ type: "message_delta", content: "ok" }, { type: "complete", persisted: true });
    h.end();
    await edit;
  });

  it("cancels a turn this tab does not run, for Stop it", async () => {
    const h = setup();
    await expect(h.store.cancelTurn(h.current.sid, "active-1")).resolves.toBe(true);
    expect(h.client.stop).toHaveBeenCalledWith(
      "org1",
      expect.objectContaining({ turnId: "active-1" }),
    );
  });
});

describe("turn engine: approval cards", () => {
  const start = async (h: ReturnType<typeof setup>) => {
    h.type("why?");
    const run = h.store.send(h.current.sid);
    await settle();
    return { run };
  };

  const approvalsFor = (expiresIn?: number) => {
    let store: AssistantStoreInternal | null = null;
    const approvals = {
      onConfirmationRequired: vi.fn((sid: string, frame: AssistantFrame & { call_id?: string }) => {
        const session = store?.state.sessions[sid];
        if (!session) return;
        session.pendingApproval = {
          id: frame.call_id ?? (frame as { id?: string }).id ?? "c9",
          sessionId: sid,
          turnId: session.turnMeta.turnId ?? "",
          kind: "delete",
          destructive: true,
          operation: "",
          tool: "o2_delete",
          targets: [],
          askedIn: "here",
          grantable: false,
          editable: false,
          question: "",
          ...(expiresIn !== undefined && { expiresAt: clock + expiresIn }),
        };
      }),
      onResolved: vi.fn(),
    };
    const h = setup({ approvals });
    store = h.store;
    return { h, approvals };
  };

  it("hands the card frame to the approvals runtime and ends the turn just after the card's own expiry", async () => {
    const { h, approvals } = approvalsFor(5_000);
    const { run } = await start(h);
    h.feed({ type: "confirmation_required", tool: "o2_delete", call_id: "c9" });
    expect(approvals.onConfirmationRequired).toHaveBeenCalledWith(
      h.current.sid,
      expect.objectContaining({ call_id: "c9" }),
    );
    expect(h.session().messages.at(-1)?.contentBlocks?.at(-1)?.type).toBe("approval");
    // The card's own decline goes out at its expiry; the turn waits a moment longer before it ends.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.session().turn.state).toBe("awaiting_approval");
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(run).resolves.toMatchObject({ error: { code: "approval_expired" } });
  });

  it("saves the answer the moment a card arrives, so a reload finds the card it waits on", async () => {
    const { h } = approvalsFor(5_000);
    await start(h);
    h.save.mockClear();
    h.feed({ type: "confirmation_required", tool: "o2_delete", call_id: "c9" });
    expect(h.save).toHaveBeenCalledWith(h.current.sid);
  });

  it("stops waiting once the card is answered, so its TTL no longer ends the turn", async () => {
    const { h } = approvalsFor(5_000);
    await start(h);
    h.feed({ type: "confirmation_required", tool: "o2_delete", call_id: "c9" });
    h.engine.approvalDecided?.(h.current.sid);
    expect(h.session().turn.state).toBe("responding.thinking");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.session().turn.state).toBe("responding.thinking");
  });

  it("follows More time: the turn's own TTL moves with the card's expiry", async () => {
    const { h } = approvalsFor(5_000);
    const { run } = await start(h);
    h.feed({ type: "confirmation_required", tool: "o2_delete", call_id: "c9" });
    h.session().pendingApproval!.expiresAt = clock + 60_000;
    h.engine.approvalExtended?.(h.current.sid);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.session().turn.state).toBe("awaiting_approval");
    await vi.advanceTimersByTimeAsync(55_000);
    await expect(run).resolves.toMatchObject({ error: { code: "approval_expired" } });
  });

  it("pauses the card's expiry while a decision is on its way, so no cancel goes mid-confirm", async () => {
    const { h } = approvalsFor(5_000);
    const { run } = await start(h);
    h.feed({ type: "confirmation_required", tool: "o2_delete", call_id: "c9" });
    h.engine.approvalSending?.(h.current.sid);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.session().turn.state).toBe("awaiting_approval");
    expect(h.client.stop).not.toHaveBeenCalled();
    h.engine.approvalExtended?.(h.current.sid, clock + 15_000);
    await vi.advanceTimersByTimeAsync(16_000);
    await expect(run).resolves.toMatchObject({ error: { code: "approval_expired" } });
  });

  it("drops a card frame redelivered while its card waits, and shows a re-ask after the decision", async () => {
    const { h, approvals } = approvalsFor();
    await start(h);
    const frame = { type: "confirmation_required", tool: "bash", args: { command: "ls" } };
    h.feed(frame, frame);
    expect(approvals.onConfirmationRequired).toHaveBeenCalledTimes(1);
    h.session().pendingApproval = null;
    h.feed(frame);
    expect(approvals.onConfirmationRequired).toHaveBeenCalledTimes(2);
  });

  it("gives an untyped card an id of its own, never the tool name", async () => {
    const { h, approvals } = approvalsFor();
    await start(h);
    h.feed({ type: "confirmation_required", tool: "o2_delete" });
    const frame = approvals.onConfirmationRequired.mock.calls[0]?.[1] as { id?: string };
    expect(frame.id).toMatch(/:1$/);
    expect(frame.id).not.toBe("o2_delete");
  });

  it("lands a delete batch proposed after complete on that answer", async () => {
    const { h, approvals } = approvalsFor();
    const { run } = await start(h);
    h.feed(
      { type: "message_delta", content: "I'll delete it." },
      { type: "complete", persisted: true },
    );
    await run;
    h.feed({ type: "confirmation_required", tool: "o2_delete", call_id: "c9" });
    await settle();
    expect(approvals.onConfirmationRequired).toHaveBeenCalled();
    expect(h.session().pendingApproval?.id).toBe("c9");
    expect(
      h
        .session()
        .messages.at(-1)
        ?.contentBlocks?.some((b) => b.type === "approval"),
    ).toBe(true);
  });

  it("passes confirmation_resolved to the runtime", async () => {
    const { h, approvals } = approvalsFor();
    await start(h);
    h.feed(
      { type: "confirmation_required", tool: "o2_delete", call_id: "c9" },
      { type: "confirmation_resolved", id: "c9", approved: true },
    );
    expect(approvals.onResolved).toHaveBeenCalledWith(
      h.current.sid,
      expect.objectContaining({ id: "c9", approved: true }),
    );
  });

  it("names the card a reply answers on the turn it sends", async () => {
    const h = setup();
    void h.store.resend(
      h.current.sid,
      { text: "use staging", chips: [], images: [], mentions: [], timeOverride: null },
      "typed",
      { replyToApproval: "c9" },
    );
    await settle();
    expect(h.last().req.replyToApproval).toBe("c9");
  });
});

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
import { createAssistantStore, inertAssistantDeps } from "./assistantStore";
import type { AssistantCapability, AssistantSession, Sid } from "./assistantStore.types";
import { createDraftStore } from "./drafts";
import {
  SAVE_INTERVAL_MS,
  createEffectsRunner,
  type EffectScope,
  type SessionWork,
} from "./effects";
import { resetPrefsForTests } from "./prefs";
import { emptyExtras, reduce, type ReducerCtx, type StreamState } from "./reducer";

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

const ctx: ReducerCtx = {
  isActive: true,
  autoNavigationEnabled: false,
  phase: "live",
  t: ((key: string) => key) as never,
  generateNavigation: () => null,
};

let clock = 0;
let frames: (() => void)[] = [];

function setup() {
  let n = 0;
  const deps = inertAssistantDeps({
    getOrg: () => ({ identifier: "org1", name: "Org 1" }),
    getUser: () => ({ email: "a@b.c", role: "admin" }),
    now: () => clock,
    uuid: () => `0190f3a0-0000-7000-8000-${String((n += 1)).padStart(12, "0")}`,
  });
  const store = createAssistantStore(deps, {
    drafts: createDraftStore({ delayMs: 0 }),
    viewportRem: () => 80,
  });
  store.setIdentity({ userOrgKey: "k1", org: "org1" });
  store.syncCapability(CAPABILITY);
  const sid = store.createSession({
    origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
    thread: "new",
  });
  const save = vi.fn().mockResolvedValue("server");
  const commits: Sid[] = [];
  const engine = vi.fn();
  const scope: EffectScope = {
    turnId: "turn-1",
    snapshot: { text: "why?", chips: [], images: [], mentions: [], timeOverride: null },
    userIndex: 0,
    newSession: true,
    input: "typed",
    source: "composer",
    surface: "chat",
    toolCalls: 0,
    toolErrors: 0,
    cancelMs: null,
  };
  const runner = createEffectsRunner({
    store: () => store,
    history: () => ({ save }),
    now: () => clock,
    raf: (cb) => void frames.push(cb),
    commit: (id, write) => {
      commits.push(id);
      const session = store.state.sessions[id] as AssistantSession | undefined;
      if (session) write(session);
    },
    engine,
    scope: () => scope,
  });
  return { store, sid, runner, save, commits, engine, scope };
}

const runFrame = () => {
  const pending = frames;
  frames = [];
  pending.forEach((cb) => cb());
};

const stream = (session: AssistantSession): StreamState => ({
  messages: session.messages,
  activeToolCall: null,
  textSegment: "",
  streamingMsg: "",
  title: undefined,
  lastTraceId: null,
  ownerUnavailable: false,
  pendingConfirmation: null,
  messageComplete: false,
  halted: false,
  extras: emptyExtras(),
});

const delta =
  (state: () => StreamState, content: string): SessionWork =>
  () => ({
    stream: reduce(state(), { type: "message_delta", content }, ctx),
    turn: [],
  });

beforeEach(() => {
  clock = 1_000_000;
  frames = [];
});

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetPrefsForTests();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("effects: one commit per animation frame (HT-08 AC 2)", () => {
  it("applies a burst of 400 deltas in a single store commit", () => {
    const { store, sid, runner, commits } = setup();
    const session = store.state.sessions[sid] as AssistantSession;
    let state: StreamState | null = null;
    const get = () => (state ??= stream(session));
    for (let i = 0; i < 400; i++) runner.schedule(sid, delta(get, `w${i} `));
    expect(commits).toHaveLength(0);
    expect(frames).toHaveLength(1);
    runFrame();
    expect(commits).toEqual([sid]);
    expect(String(session.messages[0].content)).toContain("w399");
    expect(session.messages[0].contentBlocks).toHaveLength(1);
  });

  it("runs queued work at once on flush, ahead of the event that needs it", () => {
    const { store, sid, runner, commits } = setup();
    const session = store.state.sessions[sid] as AssistantSession;
    let state: StreamState | null = null;
    const get = () => (state ??= stream(session));
    runner.schedule(sid, delta(get, "a"));
    runner.flush(sid, delta(get, "b"));
    expect(commits).toEqual([sid]);
    expect(String(session.messages[0].content)).toBe("ab");
    runFrame();
    expect(commits).toEqual([sid]);
  });

  it("counts unseen content once per batch while follow is off", () => {
    const { store, sid, runner } = setup();
    const session = store.state.sessions[sid] as AssistantSession;
    session.ui.follow = false;
    let state: StreamState | null = null;
    const get = () => (state ??= stream(session));
    for (let i = 0; i < 5; i++) runner.schedule(sid, delta(get, "x"));
    runFrame();
    expect(session.ui.unseen).toBe(1);
  });
});

describe("effects: saves (00 §14)", () => {
  it("saves at most once per 3 s while streaming, then once more on the terminal", () => {
    vi.useFakeTimers();
    const { sid, runner, save } = setup();
    const throttled: SessionWork = () => ({
      stream: [{ kind: "throttledSave", force: false }],
      turn: [],
    });
    const start = clock;
    for (let i = 0; i < 6; i++) {
      runner.flush(sid, throttled);
      clock += 500;
    }
    expect(save).toHaveBeenCalledTimes(1);
    clock = start + SAVE_INTERVAL_MS;
    vi.advanceTimersByTime(SAVE_INTERVAL_MS);
    expect(save).toHaveBeenCalledTimes(2);
    runner.flush(sid, throttled);
    expect(save).toHaveBeenCalledTimes(2);
    runner.applyEffects(sid, { stream: [], turn: [{ kind: "save" }] });
    expect(save).toHaveBeenCalledTimes(3);
    expect(save).toHaveBeenCalledWith(sid);
  });

  it("drops a pending trailing save when the turn is forgotten", () => {
    vi.useFakeTimers();
    const { sid, runner, save } = setup();
    const throttled: SessionWork = () => ({
      stream: [{ kind: "throttledSave", force: false }],
      turn: [],
    });
    runner.flush(sid, throttled);
    clock += 500;
    runner.flush(sid, throttled);
    runner.forget(sid);
    vi.advanceTimersByTime(SAVE_INTERVAL_MS);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("keeps a session with a save in flight from being released", () => {
    const { store, sid, runner } = setup();
    const track = vi.spyOn(store, "trackSave");
    runner.applyEffects(sid, { stream: [], turn: [{ kind: "save" }] });
    expect(track).toHaveBeenCalledWith(sid, expect.any(Promise));
  });
});

describe("effects: store, telemetry and engine", () => {
  it("announces through the store and hands network effects to the engine", () => {
    const { store, sid, runner, engine } = setup();
    const announce = vi.spyOn(store, "announce");
    runner.applyEffects(sid, {
      stream: [{ kind: "animateText" }, { kind: "dashboardEvent", payload: {} as never }],
      turn: [
        { kind: "announce", key: "assistant.turn.sending" },
        { kind: "cancel" },
        { kind: "restore" },
      ],
    });
    expect(announce).toHaveBeenCalledWith(sid, "assistant.turn.sending", undefined);
    expect(engine.mock.calls.map(([, effect]) => effect.kind)).toEqual(["cancel", "restore"]);
  });

  it("restores the snapshot and removes the optimistic user message on a refusal (constraint 13)", () => {
    const { store, sid, runner, scope } = setup();
    const session = store.state.sessions[sid] as AssistantSession;
    session.messages.push({ role: "user", content: raw("why?") });
    scope.snapshot = {
      text: "why?",
      chips: [
        {
          id: "c",
          kind: "stream",
          label: raw("default"),
          sizeBytes: 10,
          provenance: "page",
          sent: "whitelist",
        },
      ],
      images: [],
      mentions: [],
      timeOverride: null,
    };
    runner.applyEffects(sid, { stream: [], turn: [{ kind: "restore_draft" }] });
    expect(session.messages).toEqual([]);
    expect(session.composer.text).toBe("why?");
    expect(session.composer.chips.map((c) => c.id)).toEqual(["c"]);
  });

  it("emits ai_turn_ended once per turn id and fills the turn envelope", () => {
    const { store, sid, runner } = setup();
    const session = store.state.sessions[sid] as AssistantSession;
    Object.assign(session.turnMeta, {
      turnId: "turn-1",
      startedAt: clock - 4_000,
      firstByteAt: clock - 3_000,
      traceId: "tr",
    });
    const ended = { kind: "track_ended" as const, outcome: "done" as const, error: null };
    runner.applyEffects(sid, { stream: [], turn: [ended] });
    runner.applyEffects(sid, { stream: [], turn: [ended] });
    const calls = vi.mocked(trackAssistant).mock.calls.filter(([name]) => name === "ai_turn_ended");
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toMatchObject({
      outcome: "done",
      duration_ms: 4_000,
      ttfb_ms: 1_000,
      error_code: null,
    });
    expect(calls[0][2]).toEqual({ sid, turnId: "turn-1", traceId: "tr" });
  });

  it("builds ai_turn_sent from the snapshot with counts only", () => {
    const { sid, runner, scope } = setup();
    scope.snapshot = {
      text: "why is checkout failing?",
      chips: [
        {
          id: "c",
          kind: "log_row",
          label: raw("row"),
          sizeBytes: 120,
          provenance: "door",
          sent: "serialized",
        },
      ],
      images: [{ data: "AA", mimeType: "image/png", filename: "a.png", size: 30 }],
      mentions: [],
      timeOverride: null,
    };
    runner.applyEffects(sid, { stream: [], turn: [{ kind: "track_sent" }] });
    expect(trackAssistant).toHaveBeenCalledWith(
      "ai_turn_sent",
      {
        input: "typed",
        chip_count: 1,
        chip_kinds: ["log_row"],
        image_count: 1,
        attached_bytes: 150,
        prompt_chars: 24,
        new_session: true,
      },
      expect.objectContaining({ turnId: "turn-1" }),
    );
  });

  it("fires the legacy send event once per sent turn, at admission and never after its end", () => {
    const { sid, runner } = setup();
    const admitted = { kind: "track_admitted" as const };
    runner.applyEffects(sid, { stream: [], turn: [admitted] });
    expect(trackAssistantAdmitted).not.toHaveBeenCalled();
    runner.applyEffects(sid, { stream: [], turn: [{ kind: "track_sent" }, admitted, admitted] });
    expect(trackAssistantAdmitted).toHaveBeenCalledTimes(1);
    expect(trackAssistantAdmitted).toHaveBeenCalledWith(
      expect.objectContaining({ sid, turnId: "turn-1" }),
    );
    const ended = { kind: "track_ended" as const, outcome: "refused" as const, error: null };
    runner.applyEffects(sid, { stream: [], turn: [{ kind: "track_sent" }, ended, admitted] });
    expect(trackAssistantAdmitted).toHaveBeenCalledTimes(1);
  });

  it("reports a turn's history_unavailable as agent_unavailable, the 99 §3.5 code", () => {
    const { sid, runner } = setup();
    const error = toAssistantError({ status: 503, body: { error_code: "history_unavailable" } });
    expect(error.code).toBe("history_unavailable");
    const ended = { kind: "track_ended" as const, outcome: "refused" as const, error };
    runner.applyEffects(sid, { stream: [], turn: [ended] });
    const calls = vi.mocked(trackAssistant).mock.calls.filter(([name]) => name === "ai_turn_ended");
    expect(calls[0][1]).toMatchObject({ error_code: "agent_unavailable", http_status: 503 });
  });

  it("applies meta, pause and resume inside the commit", () => {
    const { store, sid, runner } = setup();
    const session = store.state.sessions[sid] as AssistantSession;
    runner.flush(sid, () => ({
      stream: [],
      turn: [{ kind: "pause" }, { kind: "meta", patch: { caughtUpAt: 5 } }],
    }));
    expect(session.turnMeta).toMatchObject({ pausedAt: clock, caughtUpAt: 5 });
    clock += 2_000;
    runner.flush(sid, () => ({ stream: [], turn: [{ kind: "resume" }] }));
    expect(session.turnMeta).toMatchObject({ pausedAt: null, pausedMs: 2_000 });
  });

  it("counts an unknown frame type", () => {
    const { runner } = setup();
    runner.trackUnknown("thinking_v2");
    expect(trackAssistant).toHaveBeenCalledWith("ai_frame_unknown", { type: "thinking_v2" });
  });
});

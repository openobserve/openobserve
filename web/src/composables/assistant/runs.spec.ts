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
import { nextTick, ref } from "vue";

import { fakeAssistant, hintBus } from "@/components/ai-assistant/__tests__/fakeAssistant";
import assistantService, { type ChatSummaryWire } from "@/services/assistant";
import { raw } from "@/types/i18n";

import type { AssistantSession, TurnState } from "./assistantStore.types";
import type { RemoteTurn } from "./lifecycle";
import {
  RUNS_CLEARED_PREFIX,
  UNSEEN_RUN_MS,
  createRuns,
  otherOrgRuns,
  readRunsCleared,
  runAgentKey,
  runsCounts,
  runsList,
  shownSids,
  useAssistantRuns,
  writeRunsCleared,
  type RunsDeps,
  type RunsInput,
} from "./runs";

const NOW = 10_000_000;
const KEY = "user:org1";

function session(sid: string, over: Record<string, unknown> = {}): AssistantSession {
  return {
    sid,
    org: "org1",
    userOrgKey: KEY,
    title: raw(`Chat ${sid}`),
    turn: { state: "idle" },
    turnMeta: { turnId: "t-" + sid, startedAt: NOW - 5_000, ownedByThisTab: true },
    unread: false,
    pendingApproval: null,
    pendingConsent: null,
    record: { ephemeral: false },
    ...over,
  } as unknown as AssistantSession;
}

const answering = (sid: string, over: Record<string, unknown> = {}) =>
  session(sid, { turn: { state: "responding.writing" }, ...over });

function chat(sid: string, over: Partial<ChatSummaryWire> = {}): ChatSummaryWire {
  return { session_id: sid, title: `Server ${sid}`, updated_at: NOW * 1000, ...over } as never;
}

function input(over: Partial<RunsInput> = {}): RunsInput {
  return {
    sessions: [],
    chats: [],
    remote: [],
    cleared: {},
    org: "org1",
    userOrgKey: KEY,
    clientId: "me",
    now: NOW,
    ...over,
  };
}

describe("runsList", () => {
  it("orders needs you, answering, failed, ready, and newest first inside a group", () => {
    const rows = runsList(
      input({
        sessions: [
          session("ready", {
            unread: true,
            turn: { state: "done" },
            turnMeta: { endedAt: NOW - 1, startedAt: NOW - 9, ownedByThisTab: true },
          }),
          session("failed", {
            unread: true,
            turn: { state: "failed", error: {} } as TurnState,
            turnMeta: { endedAt: NOW - 1, ownedByThisTab: true },
          }),
          answering("old", {
            turnMeta: { startedAt: NOW - 100, ownedByThisTab: true, turnId: "a" },
          }),
          answering("new", {
            turnMeta: { startedAt: NOW - 10, ownedByThisTab: true, turnId: "b" },
          }),
          session("waits", {
            pendingApproval: { id: "c1", expiresAt: NOW + 1_000, userExtendsLeft: 4 },
          }),
        ],
      }),
    );
    expect(rows.map((row) => row.sid)).toEqual(["waits", "new", "old", "failed", "ready"]);
    expect(rows[0]).toMatchObject({
      status: "needsApproval",
      request: "c1",
      expiresAt: NOW + 1_000,
      extendsLeft: 4,
    });
  });

  it("lists one consent request once, however many chats wait on it", () => {
    const rows = runsList(
      input({
        sessions: [
          session("a", { pendingConsent: { id: "x" } }),
          session("b", { pendingConsent: { id: "x" } }),
          session("c", { turn: { state: "awaiting_consent" } }),
        ],
      }),
    );
    expect(rows.map((row) => row.sid)).toEqual(["a"]);
  });

  it("keeps out ephemeral chats and another account's sessions", () => {
    const rows = runsList(
      input({
        sessions: [
          answering("helper", { record: { ephemeral: true } }),
          answering("theirs", { userOrgKey: "user:org2" }),
        ],
      }),
    );
    expect(rows).toEqual([]);
  });

  it("claims another tab only on evidence: a fresh beat or another client id (PO B3)", () => {
    const follower = { turnMeta: { ownedByThisTab: false, startedAt: NOW - 1, turnId: "t" } };
    const noEvidence = runsList(input({ sessions: [answering("s", follower)] }));
    expect(noEvidence[0].status).toBe("reconnecting");
    const beat: RemoteTurn = { sid: "s", org: "org1", state: "working", beatAt: NOW - 4_999 };
    const live = runsList(input({ sessions: [answering("s", follower)], remote: [beat] }));
    expect(live[0].status).toBe("elsewhere");
    const old: RemoteTurn = { ...beat, beatAt: NOW - 5_000 };
    const stale = runsList(input({ sessions: [answering("s", follower)], remote: [old] }));
    expect(stale[0].status).toBe("reconnecting");
    const owned = runsList(
      input({
        sessions: [answering("s", follower)],
        chats: [chat("s", { active_turn: true, owner_client_id: "other" })],
      }),
    );
    expect(owned[0].status).toBe("elsewhere");
  });

  it("never claims a turn the server says this very client owns", () => {
    const rows = runsList(
      input({ chats: [chat("s", { active_turn: true, owner_client_id: "me" })] }),
    );
    expect(rows[0].status).toBe("reconnecting");
  });

  it("builds rows from the server for chats this tab never opened", () => {
    const rows = runsList(
      input({
        chats: [
          chat("waits", { pending_approval: true }),
          chat("runs", { active_turn: true, active_turn_id: "t9", agent_type: "sre" }),
        ],
      }),
    );
    expect(rows.map((row) => [row.sid, row.status])).toEqual([
      ["waits", "needsApproval"],
      ["runs", "reconnecting"],
    ]);
    expect(rows[1]).toMatchObject({ turnId: "t9", agent: "sre" });
  });

  it("claims a finished chat only when the server says it is unseen", () => {
    const finished = { last_turn_status: "completed", last_turn_ended_at: NOW * 1000 };
    const unknown = runsList(input({ chats: [chat("s", finished)] }));
    expect(unknown).toEqual([]);
    const unseen = runsList(input({ chats: [chat("s", { ...finished, seen: false })] }));
    expect(unseen[0]).toMatchObject({ status: "ready", group: "ready", stale: false });
    const failed = runsList(
      input({
        chats: [chat("s", { ...finished, seen: false, last_turn_status: "interrupted" })],
      }),
    );
    expect(failed[0]).toMatchObject({ status: "failed", group: "failed" });
    const open = runsList(
      input({ chats: [chat("s", { ...finished, seen: false })], sessions: [session("s")] }),
    );
    expect(open).toEqual([]);
  });

  it("marks a finished row stale after 30 minutes", () => {
    const at = NOW - UNSEEN_RUN_MS;
    const rows = runsList(
      input({
        chats: [
          chat("s", {
            seen: false,
            last_turn_status: "completed",
            last_turn_ended_at: at * 1000,
          }),
        ],
      }),
    );
    expect(rows[0].stale).toBe(true);
  });

  it("drops a cleared finished row, and lists it again once the chat finishes later", () => {
    const finished = (endedAt: number) =>
      session("s", {
        unread: true,
        turn: { state: "done" },
        turnMeta: { endedAt, ownedByThisTab: true },
      });
    expect(runsList(input({ sessions: [finished(NOW)], cleared: { s: NOW } }))).toEqual([]);
    const again = runsList(input({ sessions: [finished(NOW + 1)], cleared: { s: NOW } }));
    expect(again.map((row) => row.sid)).toEqual(["s"]);
  });

  it("hides helper chats the server lists", () => {
    const rows = runsList(
      input({ chats: [chat("s", { active_turn: true, agent_type: "generate_query" })] }),
    );
    expect(rows).toEqual([]);
  });
});

describe("otherOrgRuns", () => {
  it("lists another org's running sessions and remote turns, never this org's", () => {
    const rows = otherOrgRuns(
      input({
        sessions: [
          answering("mine"),
          answering("kept", { userOrgKey: "user:org2", org: "org2" }),
          session("idle", { userOrgKey: "user:org2", org: "org2" }),
        ],
        remote: [
          { sid: "r", org: "org3", state: "needs_you", beatAt: null },
          { sid: "here", org: "org1", state: "working", beatAt: null },
        ],
      }),
    );
    expect(rows.map((row) => [row.sid, row.org, row.status, row.otherOrg])).toEqual([
      ["kept", "org2", "working", true],
      ["r", "org3", "needsApproval", true],
    ]);
  });
});

describe("small helpers", () => {
  it("counts per signal", () => {
    const rows = runsList(
      input({
        sessions: [answering("a"), answering("b"), session("c", { pendingApproval: { id: "1" } })],
      }),
    );
    expect(runsCounts(rows)).toEqual({ needs: 1, answering: 2, failed: 0, ready: 0 });
  });

  it("counts a floating window that is open as visible, and a tray bar or a hidden shell as not", () => {
    const shell = (kind: string, windows: unknown = []) =>
      ({ shell: { placement: { kind }, activeSid: "a", windows } }) as never;
    expect(shownSids(shell("sidebar"))).toEqual(["a"]);
    expect(shownSids(shell("hidden"))).toEqual([]);
    expect(
      shownSids(
        shell("hidden", [
          { sid: "w", state: "open" },
          { sid: "t", state: "tray" },
        ]),
      ),
    ).toEqual(["w"]);
  });

  it("shows sre-rca as Investigator and never names an unknown agent", () => {
    expect(runAgentKey("sre-rca")).toBe("investigator");
    expect(runAgentKey("sre")).toBe("investigator");
    expect(runAgentKey("generate-query")).toBe("queryBuilder");
    expect(runAgentKey("o2-ai")).toBe("general");
    expect(runAgentKey(null)).toBe("general");
  });

  it("merges two tabs' clears and survives blocked storage", () => {
    localStorage.clear();
    writeRunsCleared(KEY, ["a"], 1);
    writeRunsCleared(KEY, ["b"], 2);
    expect(readRunsCleared(KEY)).toEqual({ a: 1, b: 2 });
    localStorage.setItem(`${RUNS_CLEARED_PREFIX}${KEY}`, "not json");
    expect(readRunsCleared(KEY)).toEqual({});
    expect(readRunsCleared(null)).toEqual({});
  });

  it("gives a usable empty list before the runtime exists", async () => {
    const runs = useAssistantRuns();
    expect(runs.rows.value).toEqual([]);
    expect(runs.cap.value).toBe(3);
    expect(runs.light()).toBeNull();
    await expect(runs.requestOpen()).resolves.toBeUndefined();
  });
});

describe("createRuns", () => {
  let dispose: () => void = () => undefined;

  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function setup(over: Partial<RunsDeps> = {}) {
    const fake = fakeAssistant();
    const hints = hintBus();
    const store = fake.store;
    let feed: (chats: ChatSummaryWire[]) => void = () => undefined;
    const remote = ref<RemoteTurn[]>([]);
    const deps = {
      store: () => store,
      hints,
      remote: () => remote.value,
      now: () => Date.now(),
      org: () => "default",
      clientId: () => "me",
      serverMode: () => true,
      watchActive: vi.fn((_org: string, onChats: (chats: ChatSummaryWire[]) => void) => {
        feed = onChats;
        return () => undefined;
      }),
      invalidateActive: vi.fn(),
      reveal: vi.fn(async () => undefined),
      focusCard: vi.fn(() => true),
      stopElsewhere: vi.fn(async () => undefined),
      approvalElsewhere: vi.fn(() => false),
      ...over,
    };
    const runs = createRuns(deps as RunsDeps);
    dispose = () => runs.dispose();
    const sid = store.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
      thread: "new",
    });
    return {
      store,
      hints,
      deps,
      runs,
      sid,
      remote,
      feed: (chats: ChatSummaryWire[]) => feed(chats),
    };
  }

  it("counts a chat waiting on an approval as running, and each decision once", async () => {
    const { store, runs, sid, feed } = setup();
    store.state.sessions[sid].pendingApproval = { id: "c1" } as never;
    feed([chat("other", { active_turn: true }), chat("far", { pending_approval: true })]);
    await nextTick();
    expect(runs.active.value).toBe(3);
    expect(runs.needsCount.value).toBe(2);
  });

  it("leaves out of the count a chat waiting on paid usage, which was never admitted", async () => {
    const { store, runs, sid } = setup();
    store.state.sessions[sid].pendingConsent = { id: "x" } as never;
    await nextTick();
    expect(runs.active.value).toBe(0);
    expect(runs.needsCount.value).toBe(1);
  });

  it("lists as a decision only what no visible container shows", async () => {
    const { store, runs, sid } = setup();
    store.state.sessions[sid].pendingApproval = { id: "c1" } as never;
    await nextTick();
    expect(runs.decisions.value.map((row) => row.sid)).toEqual([sid]);
    store.state.shell.activeSid = sid;
    store.state.shell.placement = { kind: "sidebar" } as never;
    await nextTick();
    expect(runs.decisions.value).toEqual([]);
  });

  it("leads the decisions with the request ending first", async () => {
    const { store, runs, sid } = setup();
    const other = store.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
      detached: true,
    });
    store.state.sessions[sid].pendingApproval = { id: "c1", expiresAt: NOW + 90_000 } as never;
    store.state.sessions[other].pendingApproval = { id: "c2", expiresAt: NOW + 30_000 } as never;
    await nextTick();
    expect(runs.decisions.value.map((row) => row.sid)).toEqual([other, sid]);
  });

  it("stops following the active read when the org changes, and never in browser mode", async () => {
    const org = ref("default");
    const stop = vi.fn();
    const watchActive = vi.fn(() => stop);
    setup({ org: () => org.value, watchActive });
    expect(watchActive).toHaveBeenCalledTimes(1);
    org.value = "other";
    await nextTick();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(watchActive).toHaveBeenCalledTimes(2);
    dispose();
    const browserOnly = vi.fn(() => stop);
    setup({ serverMode: () => false, watchActive: browserOnly });
    expect(browserOnly).not.toHaveBeenCalled();
  });

  it("clears an opened row across tabs: the row leaves, and the hint carries only the id", async () => {
    const { hints, runs, feed, store } = setup();
    feed([chat("s", { seen: false, last_turn_status: "completed" })]);
    await nextTick();
    expect(runs.rows.value).toHaveLength(1);
    await runs.open(runs.rows.value[0]);
    await nextTick();
    expect(runs.rows.value).toEqual([]);
    expect(hints.post).toHaveBeenCalledWith({ v: 1, type: "runs_cleared", sid: "s", at: NOW });
    expect(readRunsCleared(store.state.userOrgKey)).toEqual({ s: NOW });
  });

  it("re-reads the cleared set when another tab clears", async () => {
    const { hints, runs, feed, store } = setup();
    feed([chat("s", { seen: false, last_turn_status: "completed" })]);
    await nextTick();
    writeRunsCleared(store.state.userOrgKey, ["s"], NOW);
    hints.fire({ type: "runs_cleared", sid: "s" });
    await nextTick();
    expect(runs.rows.value).toEqual([]);
  });

  it("stops by the route that fits who runs the turn", async () => {
    const cancel = vi.spyOn(assistantService, "cancelTurn").mockResolvedValue(undefined as never);
    const { store, runs, deps, feed, sid } = setup();
    const own = vi.spyOn(store, "stop").mockResolvedValue(undefined as never);
    store.state.sessions[sid].turn = { state: "responding.writing" };
    store.state.sessions[sid].turnMeta.ownedByThisTab = true;
    await nextTick();
    await runs.stop(runs.rows.value[0]);
    expect(own).toHaveBeenCalledWith(sid);
    feed([chat("far", { active_turn: true, active_turn_id: "t9" })]);
    await nextTick();
    const far = runs.rows.value.find((row) => row.sid === "far")!;
    await runs.stop(far);
    expect(cancel).toHaveBeenCalledWith("default", "far", "t9");
    expect(deps.invalidateActive).toHaveBeenCalledWith("default");
  });

  it("asks another tab to decline its card before the turn is cancelled", async () => {
    const stopElsewhere = vi.fn(async () => undefined);
    const { runs, feed } = setup({ stopElsewhere, approvalElsewhere: () => true });
    feed([chat("far", { active_turn: true, active_turn_id: "t9" })]);
    await nextTick();
    await runs.stop(runs.rows.value[0]);
    expect(stopElsewhere).toHaveBeenCalledWith("far");
  });

  it("opens a row, reveals the container, and lands on the card for Review", async () => {
    const { store, runs, deps, sid } = setup();
    const open = vi.spyOn(store, "openSession").mockResolvedValue(sid);
    store.state.sessions[sid].pendingApproval = { id: "c1" } as never;
    await nextTick();
    const opening = runs.open(runs.rows.value[0], { focus: "card" });
    await vi.advanceTimersByTimeAsync(10);
    await opening;
    expect(open).toHaveBeenCalledWith({ sid }, { focus: false });
    expect(deps.reveal).toHaveBeenCalledTimes(1);
    expect(deps.focusCard).toHaveBeenCalled();
  });

  it("holds a request for the list until a Runs button takes it", async () => {
    const { runs, deps } = setup();
    await runs.requestOpen();
    expect(deps.reveal).toHaveBeenCalledTimes(1);
    expect(runs.openRequested.value).toBe(true);
    runs.takeOpenRequest();
    expect(runs.openRequested.value).toBe(false);
  });

  it("takes the real cap from a refused send", async () => {
    const { store, runs, sid } = setup();
    expect(runs.cap.value).toBe(3);
    store.state.shell.activeSid = sid;
    store.state.sessions[sid].turn = {
      state: "refused",
      error: { code: "run_limit_member", limit: 7 },
    } as never;
    await nextTick();
    expect(runs.cap.value).toBe(7);
  });

  it("lights the header from chats no tab of this browser runs", async () => {
    const { runs, feed } = setup();
    feed([chat("far", { active_turn: true })]);
    await nextTick();
    expect(runs.light()).toEqual({ state: "working", sid: "far" });
    feed([chat("far", { active_turn: true }), chat("wait", { pending_approval: true })]);
    expect(runs.light()).toEqual({ state: "needs_you", sid: "wait" });
  });
});

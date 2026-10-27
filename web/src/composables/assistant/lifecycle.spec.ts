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

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computed, defineComponent, h, nextTick } from "vue";
import { RouterView, createMemoryHistory, createRouter } from "vue-router";

import { raw } from "@/types/i18n";

import { fakeRuntime } from "./__tests__/fakeRuntime";
import { inertAssistantDeps } from "./assistantStore";
import type { AssistantHint, Sid, TurnEngine } from "./assistantStore.types";
import type { AssistantHintChannel } from "./hints";
import {
  APPROVAL_HEARTBEAT_MS,
  APPROVAL_STALE_MS,
  LIVE_TURN_TTL_MS,
  STOP_RELAY_MS,
  createLifecycle,
  readLiveTurns,
  registerLifecycleDialogs,
  resetLifecycleForTests,
  runLeaveGuards,
  useLifecycleQuestion,
  writeLiveTurn,
  type AssistantLifecycleRuntime,
} from "./lifecycle";
import { setRuntimeHandle } from "./runtimeHandle";

const { track } = vi.hoisted(() => ({ track: vi.fn() }));

vi.mock("@/services/assistantAnalytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/assistantAnalytics")>()),
  trackAssistant: track,
}));

const USER_HASH = "abcdef0123456789";

// The app stores its login as base64 JSON under `userInfo`.
const login = (email: string) => btoa(JSON.stringify({ email }));

type Handler = (hint: AssistantHint) => void;

function fakeHints() {
  const handlers = new Map<string, Set<Handler>>();
  const hints = {
    post: vi.fn(),
    postFor: vi.fn(),
    rebind: vi.fn(),
    close: vi.fn(),
    bindUser: vi.fn(async () => undefined),
    userHash: () => USER_HASH,
    on(type: string, handler: Handler) {
      const set = handlers.get(type) ?? new Set();
      set.add(handler);
      handlers.set(type, set);
      return () => set.delete(handler);
    },
  };
  const receive = (hint: AssistantHint) => handlers.get(hint.type)?.forEach((fn) => fn(hint));
  return { hints: hints as unknown as AssistantHintChannel & typeof hints, receive };
}

function setup(engine: Partial<TurnEngine> = {}, now: () => number = () => Date.now()) {
  const { hints, receive } = fakeHints();
  const fullEngine = {
    stopAll: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    signedOutElsewhere: vi.fn(async () => undefined),
    ...engine,
  };
  const base = fakeRuntime({
    engine: { ...inertAssistantDeps().engine, ...fullEngine } as TurnEngine,
    hints,
  });
  const { store } = base;
  const client = { stop: vi.fn(async () => undefined) };
  const decide = vi.spyOn(store, "decideApproval").mockResolvedValue({
    status: "done",
    items: [],
    resolvedBy: "",
    resolvedAt: 0,
  });
  const lifecycle = createLifecycle({
    store,
    hints,
    engine: fullEngine as unknown as TurnEngine,
    client,
    now,
    currentOrgName: () => "Org 1",
    currentOrg: () => "org1",
    currentEmail: () => "ada@example.com",
  });
  lifecycles.push(lifecycle);
  return { store, hints, receive, client, engine: fullEngine, lifecycle, decide };
}

const lifecycles: AssistantLifecycleRuntime[] = [];

function running(store: ReturnType<typeof fakeRuntime>["store"], turnId = "t1"): Sid {
  const sid = store.createSession({
    origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
    thread: "new",
  });
  store.state.sessions[sid].turn = { state: "responding.writing" };
  store.state.sessions[sid].turnMeta.turnId = turnId;
  return sid;
}

// The dialogs component answers through this, as a click would.
async function answerWith(choice: string): Promise<void> {
  await flushPromises();
  const open = useLifecycleQuestion().value;
  expect(open).not.toBeNull();
  open!.answer(choice);
}

let unregisterDialogs: () => void = () => undefined;

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  track.mockClear();
  unregisterDialogs = registerLifecycleDialogs();
});

afterEach(() => {
  unregisterDialogs();
  lifecycles.splice(0).forEach((lifecycle) => lifecycle.dispose());
  resetLifecycleForTests();
  vi.useRealTimers();
});

describe("onSignOut", () => {
  it("asks nothing and waits for nothing when no answer runs, but still signs the other tabs out", async () => {
    const { lifecycle, store, engine, hints } = setup();
    sessionStorage.setItem("o2.assistant.placement:k1", "{}");
    await expect(lifecycle.onSignOut()).resolves.toBe("proceed");
    expect(useLifecycleQuestion().value).toBeNull();
    expect(engine.stopAll).toHaveBeenCalledWith("sign_out");
    expect(hints.post).toHaveBeenCalledWith(expect.objectContaining({ type: "signed_out" }));
    expect(hints.post.mock.invocationCallOrder[0]).toBeLessThan(
      engine.stopAll.mock.invocationCallOrder[0],
    );
    expect(sessionStorage.getItem("o2.assistant.placement:k1")).toBeNull();
    expect(store.state.shell.placement.kind).toBe("hidden");
  });

  it("asks once with the count, and Cancel signs nothing out", async () => {
    const { lifecycle, store, engine } = setup();
    running(store);
    const asked = lifecycle.onSignOut();
    await answerWith("cancel");
    await expect(asked).resolves.toBe("cancel");
    expect(engine.stopAll).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith("ai_sign_out_with_turns", { count: 1, choice: "cancel" });
  });

  it("stops this tab's turns and keepalive-cancels other tabs' turns from the ledger, waiting at most 300 ms", async () => {
    vi.useFakeTimers();
    const { lifecycle, store, engine, client } = setup({
      stopAll: vi.fn(() => new Promise<void>(() => undefined)),
    });
    running(store);
    writeLiveTurn(USER_HASH, {
      add: { org: "org2", sid: "other-sid", origin: "chat", turnId: "t9", at: Date.now() },
    });
    const done = lifecycle.onSignOut();
    await vi.advanceTimersByTimeAsync(0);
    useLifecycleQuestion().value!.answer("proceed");
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.stopAll).toHaveBeenCalledWith("sign_out");
    expect(client.stop).toHaveBeenCalledWith(
      "org2",
      expect.objectContaining({ sid: "other-sid", turnId: "t9" }),
    );
    await vi.advanceTimersByTimeAsync(300);
    await expect(done).resolves.toBe("proceed");
    expect(readLiveTurns(USER_HASH)).toEqual([]);
    expect(track).toHaveBeenCalledWith("ai_sign_out_with_turns", { count: 2, choice: "proceed" });
  });

  it("asks nothing on a forced sign-out (a changed password), yet stops, cancels and purges", async () => {
    const { lifecycle, store, engine, client } = setup();
    running(store);
    writeLiveTurn(USER_HASH, {
      add: { org: "org2", sid: "other-sid", origin: "chat", turnId: "t9", at: Date.now() },
    });
    const { useAssistantLeaveGuard } = await import("./lifecycle");
    useAssistantLeaveGuard({ host: "alert", isDirty: () => true, name: () => raw("checkout") });
    await expect(lifecycle.onSignOut({ forced: true })).resolves.toBe("proceed");
    expect(useLifecycleQuestion().value).toBeNull();
    expect(engine.stopAll).toHaveBeenCalledWith("sign_out");
    expect(client.stop).toHaveBeenCalledWith("org2", expect.objectContaining({ sid: "other-sid" }));
    expect(readLiveTurns(USER_HASH)).toEqual([]);
  });

  it("lets the forced sign-out's route leave pass a dirty guard unasked", async () => {
    const { lifecycle } = setup();
    const { useAssistantLeaveGuard } = await import("./lifecycle");
    const Editor = defineComponent({
      setup() {
        useAssistantLeaveGuard({ host: "alert", isDirty: () => true, name: () => raw("checkout") });
        return () => h("div");
      },
    });
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/alert", component: Editor },
        { path: "/logout", component: { render: () => null } },
      ],
    });
    await router.push("/alert");
    const wrapper = mount({ render: () => h(RouterView) }, { global: { plugins: [router] } });
    await flushPromises();
    await expect(lifecycle.onSignOut({ forced: true })).resolves.toBe("proceed");
    const left = router.push("/logout");
    await flushPromises();
    expect(useLifecycleQuestion().value).toBeNull();
    await left;
    expect(router.currentRoute.value.path).toBe("/logout");
    wrapper.unmount();
  });

  it("runs the host's leave guard first; Keep editing cancels before the assistant asks", async () => {
    const { lifecycle, store } = setup();
    running(store);
    const { useAssistantLeaveGuard } = await import("./lifecycle");
    useAssistantLeaveGuard({ host: "alert", isDirty: () => true, name: () => raw("checkout") });
    const asked = lifecycle.onSignOut();
    await flushPromises();
    expect(useLifecycleQuestion().value?.question).toEqual({
      kind: "leave_guard",
      name: "checkout",
    });
    useLifecycleQuestion().value!.answer("keep");
    await expect(asked).resolves.toBe("cancel");
    expect(track).toHaveBeenCalledWith("ai_leave_guard", { host: "alert", choice: "keep" });
  });
});

describe("onOrgSwitch", () => {
  it("switches without a question when nothing runs, hiding the old org's chat", async () => {
    const { lifecycle, store, hints } = setup();
    store.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
    });
    await expect(lifecycle.onOrgSwitch({ org: "org2", userOrgKey: "k2" })).resolves.toBe("proceed");
    expect(store.state.shell.activeSid).toBeNull();
    expect(hints.rebind).toHaveBeenCalledWith("k2");
  });

  it("Stop cancels every running turn of this org before switching", async () => {
    const { lifecycle, store, engine } = setup();
    const sid = running(store);
    const asked = lifecycle.onOrgSwitch({ org: "org2", userOrgKey: "k2" });
    await flushPromises();
    expect(useLifecycleQuestion().value?.question).toEqual({
      kind: "org_switch",
      count: 1,
      waiting: 0,
      org: "Org 1",
    });
    useLifecycleQuestion().value!.answer("stop");
    await expect(asked).resolves.toBe("proceed");
    expect(engine.stop).toHaveBeenCalledWith(sid);
  });

  it("Keep lets the turn run under the old key, withdraws a pending card and drops pending consent", async () => {
    const { lifecycle, store, engine, decide } = setup();
    const sid = running(store);
    const carded = running(store, "t2");
    store.state.sessions[carded].pendingApproval = { id: "call-1" } as never;
    const consenting = running(store, "t3");
    store.state.sessions[consenting].turn = { state: "awaiting_consent" };
    const asked = lifecycle.onOrgSwitch({ org: "org2", userOrgKey: "k2" });
    await answerWith("keep");
    await expect(asked).resolves.toBe("proceed");
    expect(decide).toHaveBeenCalledWith(carded, { approved: false, reason: "withdrawn" });
    expect(engine.stop).toHaveBeenCalledWith(consenting);
    expect(engine.stop).not.toHaveBeenCalledWith(sid);
    expect(store.state.sessions[sid].userOrgKey).toBe("k1");
    expect(store.state.sessions[sid].turn.state).toBe("responding.writing");
    expect(track).toHaveBeenCalledWith("ai_org_switch_with_turns", { count: 3, choice: "keep" });
  });

  it("Cancel keeps the org, the active chat and every turn", async () => {
    const { lifecycle, store, engine } = setup();
    const sid = running(store);
    const asked = lifecycle.onOrgSwitch({ org: "org2", userOrgKey: "k2" });
    await answerWith("cancel");
    await expect(asked).resolves.toBe("cancel");
    expect(store.state.shell.activeSid).toBe(sid);
    expect(engine.stop).not.toHaveBeenCalled();
  });

  it("closes a dock once the switch is certain, after the host's guard let it go", async () => {
    const { lifecycle, store } = setup();
    store.open({ kind: "docked", hostId: "regex" }, { focus: "none" });
    await lifecycle.onOrgSwitch({ org: "org2", userOrgKey: "k2" });
    expect(store.state.shell.placement.kind).toBe("hidden");
  });

  it("leaves the docked chat open when the switch is cancelled, and counts waiting approvals", async () => {
    const { lifecycle, store } = setup();
    const sid = running(store);
    store.state.sessions[sid].pendingApproval = { id: "call-1" } as never;
    store.open({ kind: "docked", hostId: "regex" }, { sid, focus: "none" });
    const asked = lifecycle.onOrgSwitch({ org: "org2", userOrgKey: "k2" });
    await flushPromises();
    expect(useLifecycleQuestion().value?.question).toMatchObject({ waiting: 1 });
    useLifecycleQuestion().value!.answer("cancel");
    await expect(asked).resolves.toBe("cancel");
    expect(store.state.shell.placement).toEqual({ kind: "docked", hostId: "regex" });
    expect(track).not.toHaveBeenCalledWith("ai_container_closed", expect.anything());
  });
});

describe("other tabs", () => {
  it("ends this tab's turns as signed out on the hint, never reloading", async () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    const { lifecycle, receive, engine } = setup();
    receive({ v: 1, type: "signed_out", at: Date.now() });
    expect(engine.signedOutElsewhere).toHaveBeenCalledTimes(1);
    expect(lifecycle.signedOutElsewhere.value).toBe(true);
    receive({ v: 1, type: "signed_out", at: Date.now() });
    expect(engine.signedOutElsewhere).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("takes the login data's removal in another tab as the same signal", () => {
    const { lifecycle } = setup();
    window.dispatchEvent(
      new StorageEvent("storage", { key: "userInfo", oldValue: "x", newValue: null }),
    );
    expect(lifecycle.signedOutElsewhere.value).toBe(true);
  });

  it("unlocks again when this tab's own user signs in: in another tab, or after the Sign in tab", () => {
    const { lifecycle, receive } = setup();
    receive({ v: 1, type: "signed_out", at: Date.now() });
    expect(lifecycle.signedOutElsewhere.value).toBe(true);
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "userInfo",
        oldValue: null,
        newValue: login("ada@example.com"),
      }),
    );
    expect(lifecycle.signedOutElsewhere.value).toBe(false);
    receive({ v: 1, type: "signed_out", at: Date.now() });
    expect(lifecycle.signedOutElsewhere.value).toBe(true);
    localStorage.setItem("userInfo", login("ada@example.com"));
    lifecycle.onSignedIn();
    expect(lifecycle.signedOutElsewhere.value).toBe(false);
  });

  it("keeps the lock when another account signs in, and asks for a reload instead", () => {
    const { lifecycle, receive } = setup();
    receive({ v: 1, type: "signed_out", at: Date.now() });
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "userInfo",
        oldValue: null,
        newValue: login("bob@example.com"),
      }),
    );
    expect(lifecycle.signedOutElsewhere.value).toBe(true);
    expect(lifecycle.otherAccountSignedIn.value).toBe(true);
    localStorage.setItem("userInfo", login("bob@example.com"));
    lifecycle.onSignedIn();
    expect(lifecycle.signedOutElsewhere.value).toBe(true);
    lifecycle.onSignedIn("not base64 at all");
    expect(lifecycle.signedOutElsewhere.value).toBe(true);
  });

  it("lets another tab's approval go once its holder falls silent, and on its pagehide at once", async () => {
    vi.useFakeTimers();
    const { lifecycle, receive } = setup({}, () => Date.now());
    const lock = computed(() => lifecycle.approvalElsewhere("z"));
    receive({ v: 1, type: "approval_pending", sid: "z", turnId: "t", callId: "c", at: 1 });
    expect(lock.value).toBe(true);
    await vi.advanceTimersByTimeAsync(APPROVAL_HEARTBEAT_MS);
    receive({ v: 1, type: "approval_pending", sid: "z", turnId: "t", callId: "c", at: 2 });
    await vi.advanceTimersByTimeAsync(APPROVAL_STALE_MS - APPROVAL_HEARTBEAT_MS);
    expect(lock.value).toBe(true);
    await vi.advanceTimersByTimeAsync(APPROVAL_STALE_MS);
    expect(lock.value).toBe(false);
    setRuntimeHandle(null);
  });

  it("keeps a throttled holder's card across one-minute beats, but not past the card's own expiry", async () => {
    vi.useFakeTimers();
    const { lifecycle, receive } = setup({}, () => Date.now());
    const beat = (expiresAt?: number) =>
      receive({
        v: 1,
        type: "approval_pending",
        sid: "z",
        turnId: "t",
        callId: "c",
        ...(expiresAt && { expiresAt }),
        at: 1,
      });
    expect(APPROVAL_STALE_MS).toBeGreaterThanOrEqual(2.5 * 60_000);
    beat();
    await vi.advanceTimersByTimeAsync(60_000);
    beat();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(lifecycle.approvalElsewhere("z")).toBe(true);
    expect(lifecycle.turnLock("z")).toBe("approval_elsewhere");
    beat(Date.now() + 30_000);
    await vi.advanceTimersByTimeAsync(40_000);
    expect(lifecycle.approvalElsewhere("z")).toBe(false);
    expect(lifecycle.turnLock("z")).toBeNull();
  });

  it("beats at once when it hides or shows, and says hello again after a back-forward restore", async () => {
    vi.useFakeTimers();
    const { store, hints } = setup();
    const sid = running(store);
    store.state.sessions[sid].pendingApproval = { id: "call-1", expiresAt: 9e12 } as never;
    await nextTick();
    const count = (type: string) =>
      hints.postFor.mock.calls.filter(([, hint]) => hint.type === type).length;
    expect(count("approval_pending")).toBe(1);
    expect(hints.postFor).toHaveBeenCalledWith(
      "k1",
      expect.objectContaining({ type: "approval_pending", expiresAt: 9e12 }),
    );
    document.dispatchEvent(new Event("visibilitychange"));
    expect(count("approval_pending")).toBe(2);
    const turns = count("turn_started");
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false }));
    expect(count("approval_pending")).toBe(2);
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    expect(count("approval_pending")).toBe(3);
    expect(count("turn_started")).toBe(turns + 1);
  });

  it("lets go of a card whose chat is gone here, so no other tab stays locked by it", async () => {
    const { store, hints } = setup();
    const sid = running(store);
    store.state.sessions[sid].pendingApproval = { id: "call-1" } as never;
    await nextTick();
    delete store.state.sessions[sid];
    await nextTick();
    expect(hints.postFor).toHaveBeenCalledWith(
      "k1",
      expect.objectContaining({ type: "approval_resolved", sid, approved: false }),
    );
  });

  it("re-announces a card it holds on a heartbeat and releases it on pagehide", async () => {
    vi.useFakeTimers();
    const { store, hints } = setup();
    const sid = running(store);
    store.state.sessions[sid].pendingApproval = { id: "call-1" } as never;
    await nextTick();
    const announced = () =>
      hints.postFor.mock.calls.filter(([, hint]) => hint.type === "approval_pending").length;
    expect(announced()).toBe(1);
    await vi.advanceTimersByTimeAsync(APPROVAL_HEARTBEAT_MS);
    expect(announced()).toBe(2);
    window.dispatchEvent(new Event("pagehide"));
    expect(hints.postFor).toHaveBeenCalledWith(
      "k1",
      expect.objectContaining({ type: "approval_resolved", sid, approved: false }),
    );
    expect(hints.postFor).toHaveBeenCalledWith(
      "k1",
      expect.objectContaining({ type: "turn_ended", sid, status: "interrupted" }),
    );
  });

  it("lets another tab's light go once it is older than the ledger keeps a turn", () => {
    let clock = 1_000;
    const { lifecycle, receive } = setup({}, () => clock);
    receive({ v: 1, type: "approval_pending", sid: "z", turnId: "t", at: 1 });
    expect(lifecycle.approvalElsewhere("z")).toBe(true);
    clock += LIVE_TURN_TTL_MS;
    expect(lifecycle.remoteLight()).toBeNull();
    expect(lifecycle.approvalElsewhere("z")).toBe(false);
  });

  it("withdraws a card here once another tab continues the same chat", () => {
    const { store, receive, decide } = setup();
    const sid = running(store);
    store.state.sessions[sid].pendingApproval = { id: "call-1" } as never;
    receive({ v: 1, type: "turn_started", org: "org1", sid, turnId: "t5", origin: "chat", at: 1 });
    expect(decide).toHaveBeenCalledWith(sid, { approved: false, reason: "withdrawn" });
  });

  it("lights the header for another tab's working turn of this org only", () => {
    const { lifecycle, receive } = setup();
    receive({
      v: 1,
      type: "turn_started",
      org: "org9",
      sid: "x",
      turnId: "t",
      origin: "chat",
      at: 1,
    });
    expect(lifecycle.remoteLight()).toBeNull();
    receive({
      v: 1,
      type: "turn_started",
      org: "org1",
      sid: "y",
      turnId: "t",
      origin: "chat",
      at: 1,
    });
    expect(lifecycle.remoteLight()).toEqual({ state: "working", sid: "y" });
    receive({ v: 1, type: "approval_pending", sid: "z", turnId: "t", at: 1 });
    expect(lifecycle.remoteLight()).toEqual({ state: "needs_you", sid: "z" });
    expect(lifecycle.approvalElsewhere("z")).toBe(true);
    expect(lifecycle.approvalElsewhere("y")).toBe(false);
    receive({
      v: 1,
      type: "turn_ended",
      org: "org1",
      sid: "y",
      turnId: "t",
      status: "completed",
      at: 2,
    });
    receive({ v: 1, type: "approval_resolved", sid: "z", approved: true, at: 2 });
    expect(lifecycle.remoteLight()).toBeNull();
  });
});

describe("Stop on another tab's card", () => {
  it("leaves the cancel to a holder that beats back, and cancels itself only for a silent one", async () => {
    vi.useFakeTimers();
    try {
      const { store, hints, receive, lifecycle } = setup();
      const cancel = vi.spyOn(store, "cancelTurn").mockResolvedValue(true);
      receive({ v: 1, type: "approval_pending", sid: "z", turnId: "t", callId: "c", at: 1 });
      const stopping = lifecycle.stopElsewhere("z");
      expect(hints.postFor).toHaveBeenCalledWith(
        "k1",
        expect.objectContaining({ type: "approval_stop", sid: "z" }),
      );
      receive({ v: 1, type: "approval_pending", sid: "z", turnId: "t", callId: "c", at: 2 });
      await vi.advanceTimersByTimeAsync(0);
      await stopping;
      await vi.advanceTimersByTimeAsync(STOP_RELAY_MS);
      expect(cancel).not.toHaveBeenCalled();
      receive({ v: 1, type: "approval_pending", sid: "y", turnId: "t", callId: "c", at: 3 });
      const silent = lifecycle.stopElsewhere("y");
      await vi.advanceTimersByTimeAsync(STOP_RELAY_MS);
      await silent;
      expect(cancel).toHaveBeenCalledWith("y", null);
      expect(cancel).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels at once when the card is released instead of answered, so a Stop is never dropped", async () => {
    vi.useFakeTimers();
    try {
      const { store, receive, lifecycle } = setup();
      const cancel = vi.spyOn(store, "cancelTurn").mockResolvedValue(true);
      receive({ v: 1, type: "approval_pending", sid: "z", turnId: "t", callId: "c", at: 1 });
      const stopping = lifecycle.stopElsewhere("z");
      receive({ v: 1, type: "approval_resolved", sid: "z", approved: true, at: 2 });
      await vi.advanceTimersByTimeAsync(0);
      await stopping;
      expect(cancel).toHaveBeenCalledWith("z", null);
      expect(cancel).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("beats back at once when the waiting tab asks, then stops its own turn, which declines the card first", async () => {
    const { store, hints, receive } = setup();
    const sid = running(store);
    store.state.sessions[sid].pendingApproval = { id: "c" } as never;
    await nextTick();
    hints.postFor.mockClear();
    const stop = vi.spyOn(store, "stop").mockResolvedValue();
    receive({ v: 1, type: "approval_stop", sid, at: 1 });
    expect(hints.postFor).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: "approval_pending", sid }),
    );
    expect(stop).toHaveBeenCalledWith(sid);
    receive({ v: 1, type: "approval_stop", sid: "other", at: 1 });
    expect(stop).toHaveBeenCalledTimes(1);
  });
});

describe("turn mirror and live-turn ledger", () => {
  it("announces this tab's turn on its own key and keeps it in the ledger until it ends", async () => {
    const { store, hints } = setup();
    const sid = running(store);
    await nextTick();
    expect(hints.postFor).toHaveBeenCalledWith(
      "k1",
      expect.objectContaining({
        type: "turn_started",
        sid,
        turnId: "t1",
        org: "org1",
        origin: "chat",
      }),
    );
    expect(readLiveTurns(USER_HASH)).toMatchObject([{ sid, turnId: "t1", org: "org1" }]);
    store.state.sessions[sid].turn = { state: "done", saved: "local" };
    await nextTick();
    expect(hints.postFor).toHaveBeenCalledWith(
      "k1",
      expect.objectContaining({ type: "turn_ended", sid, status: "completed" }),
    );
    expect(readLiveTurns(USER_HASH)).toEqual([]);
  });

  it("prunes ledger entries older than an hour and merges two tabs' writes", () => {
    const now = 10 * LIVE_TURN_TTL_MS;
    writeLiveTurn(
      USER_HASH,
      {
        add: { org: "o", sid: "old", origin: "chat", turnId: "t", at: now - LIVE_TURN_TTL_MS - 1 },
      },
      now,
    );
    writeLiveTurn(
      USER_HASH,
      { add: { org: "o", sid: "a", origin: "chat", turnId: "t", at: now } },
      now,
    );
    writeLiveTurn(
      USER_HASH,
      { add: { org: "o", sid: "b", origin: "rca", turnId: "t", at: now } },
      now,
    );
    expect(readLiveTurns(USER_HASH, now).map((entry) => entry.sid)).toEqual(["a", "b"]);
    localStorage.setItem("o2.assistant.liveTurns:" + USER_HASH, "not json");
    expect(readLiveTurns(USER_HASH, now)).toEqual([]);
  });
});

describe("lifecycle questions", () => {
  it("never shows two questions: a second one is refused while the first is open", async () => {
    const { askLifecycle } = await import("./lifecycle");
    const first = askLifecycle({ kind: "sign_out", count: 1 });
    await expect(askLifecycle({ kind: "org_switch", count: 1, org: "o" })).resolves.toBe("cancel");
    await expect(askLifecycle({ kind: "leave_guard", name: raw("x") })).resolves.toBe("keep");
    useLifecycleQuestion().value!.answer("proceed");
    await expect(first).resolves.toBe("proceed");
  });

  it("asks one guard for a move inside its page and leaves every other guard armed", async () => {
    const { askLeaveGuard, useAssistantLeaveGuard } = await import("./lifecycle");
    const other = { host: "alert" as const, isDirty: () => true, name: () => raw("checkout") };
    const mine = { host: "settings" as const, isDirty: () => true, name: () => raw("policy") };
    useAssistantLeaveGuard(other);
    useAssistantLeaveGuard(mine);
    const asked = askLeaveGuard(mine);
    await flushPromises();
    expect(useLifecycleQuestion().value?.question).toEqual({ kind: "leave_guard", name: "policy" });
    useLifecycleQuestion().value!.answer("discard");
    await expect(asked).resolves.toBe(true);
    const all = runLeaveGuards();
    await flushPromises();
    expect(useLifecycleQuestion().value?.question).toEqual({
      kind: "leave_guard",
      name: "checkout",
    });
    useLifecycleQuestion().value!.answer("keep");
    await expect(all).resolves.toBe(false);
  });

  it("takes the safe default when no dialog host is mounted", async () => {
    unregisterDialogs();
    unregisterDialogs = () => undefined;
    const { askLifecycle } = await import("./lifecycle");
    await expect(askLifecycle({ kind: "leave_guard", name: raw("x") })).resolves.toBe("discard");
    await expect(runLeaveGuards()).resolves.toBe(true);
  });
});

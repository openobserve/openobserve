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

import { flushPromises } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { computed, isReactive, ref } from "vue";

import { raw } from "@/types/i18n";
import type { ImageAttachment } from "@/ts/interfaces/chat";

import {
  IDLE_SESSION_LIMIT,
  SIGN_OUT_STOP_WAIT_MS,
  MAX_CHIP_BYTES,
  UNDO_WINDOW_MS,
  createAssistantStore,
  headerLightOf,
  withRemoteLight,
  inertAssistantDeps,
  sessionView,
  useAssistantPlacement,
  useAssistantSession,
  type AssistantStoreInternal,
  type AssistantStoreOptions,
} from "./assistantStore";
import type {
  AssistantCapability,
  AssistantStoreDeps,
  PendingApproval,
  SessionOrigin,
  Sid,
} from "./assistantStore.types";
import type { ContextChip } from "./context/types";
import { createDraftStore, type DraftStore } from "./drafts";
import { sidebarWidthFor } from "./sidebarWidth";
import {
  TAB_HEARTBEAT_MS,
  markTabAlive,
  pushRecall,
  resetPrefsForTests,
  writeAnnotation,
} from "./prefs";
import type { TurnTerminal } from "./turnStates";

const ORIGIN: SessionOrigin = {
  entryKind: "header_button",
  objectKind: "none",
  container: "sidebar",
};

const DONE: TurnTerminal = { state: "done", saved: "server" };

const capability = (gate: AssistantCapability["gate"]): AssistantCapability => ({
  gate,
  edition: "ee",
  configured: gate !== "not_configured",
  health: "ok",
  canChat: "yes",
  canWrite: "yes",
  canShare: "yes",
  canShareRead: "yes",
  persistence: true,
  publicLinks: true,
  publicMaxExpiryDays: 30,
  isAdmin: true,
  rcaEnabled: false,
  source: "heuristic",
  reasonCode: gate,
});

const chip = (id: string, over: Partial<ContextChip> = {}): ContextChip => ({
  id,
  kind: "log_row",
  label: raw(id),
  sizeBytes: 100,
  provenance: "door",
  sent: "serialized",
  ...over,
});

const image = (filename: string, over: Partial<ImageAttachment> = {}): ImageAttachment => ({
  data: "AAAA",
  mimeType: "image/png",
  filename,
  size: 1024,
  ...over,
});

const approval = (sessionId: string): PendingApproval => ({
  id: "call-1",
  sessionId,
  turnId: "t1",
  kind: "delete",
  destructive: true,
  operation: "delete",
  tool: "o2_delete",
  targets: [],
  askedIn: "here",
  grantable: false,
  editable: false,
  question: "",
});

function makeStore(
  overrides: Partial<AssistantStoreDeps> = {},
  gate: AssistantCapability["gate"] = "available",
  options: AssistantStoreOptions = {},
) {
  let n = 0;
  const clock = { now: 1_000_000 };
  const deps = inertAssistantDeps({
    getOrg: () => ({ identifier: "org1", name: "Org 1" }),
    getUser: () => ({ email: "a@b.c", role: "admin" }),
    now: () => clock.now,
    uuid: () => `0190f3a0-0000-7000-8000-${String((n += 1)).padStart(12, "0")}`,
    ...overrides,
  });
  const drafts = createDraftStore({ delayMs: 0 });
  draftStores.push(drafts);
  const store = createAssistantStore(deps, { drafts, viewportRem: () => 80, ...options });
  store.setIdentity({ userOrgKey: "k1", org: "org1" });
  store.syncCapability(capability(gate));
  return { store, deps, clock, drafts };
}

const draftStores: DraftStore[] = [];

const newSession = (store: AssistantStoreInternal) =>
  store.createSession({ origin: ORIGIN, thread: "new" });

afterEach(() => {
  draftStores.splice(0).forEach((drafts) => drafts.flush());
  localStorage.clear();
  sessionStorage.clear();
  resetPrefsForTests();
  vi.useRealTimers();
});

describe("sessions", () => {
  it("creates a session under the current user+org and makes it active", () => {
    const { store } = makeStore();
    const sid = newSession(store);
    const session = store.state.sessions[sid];
    expect(session).toMatchObject({ userOrgKey: "k1", org: "org1", origin: ORIGIN, title: null });
    expect(session.chatId).toBe(parseInt("0190f3a00000", 16));
    expect(store.state.shell.activeSid).toBe(sid);
    expect(store.state.recent[0]).toBe(sid);
  });

  it("returns the active session unchanged while it has no messages and no draft", () => {
    const { store } = makeStore();
    const first = newSession(store);
    expect(newSession(store)).toBe(first);
    store.setDraft(first, { text: "draft" });
    expect(newSession(store)).not.toBe(first);
  });

  it("applies the new door's origin, title and hand-off messages to a reused blank session", () => {
    const { store } = makeStore();
    const first = store.createSession({ origin: ORIGIN, title: raw("Alert · cpu"), thread: "new" });
    const docked: SessionOrigin = {
      entryKind: "editor_button",
      objectKind: "alert",
      container: "docked.alert",
    };
    const messages = [{ role: "assistant" as const, content: raw("Here is the query") }];
    expect(store.createSession({ origin: docked, thread: "new", messages })).toBe(first);
    expect(store.state.sessions[first]).toMatchObject({
      origin: docked,
      title: null,
      titleSource: "generated",
      messages,
    });
    store.state.sessions[first].messages = [];
    store.createSession({ origin: ORIGIN, title: raw("Dashboard · api"), thread: "new" });
    expect(store.state.sessions[first]).toMatchObject({
      origin: ORIGIN,
      title: "Dashboard · api",
      titleSource: "object",
    });
  });

  it("opens a known session without a load and loads an unknown one through history", async () => {
    const open = vi.fn().mockResolvedValue("loaded");
    const { store } = makeStore({ history: { ...inertAssistantDeps().history, open } });
    const sid = newSession(store);
    store.setActive(null);
    await expect(store.openSession({ sid })).resolves.toBe(sid);
    expect(open).not.toHaveBeenCalled();
    expect(store.state.shell.activeSid).toBe(sid);
    await expect(store.openSession({ chatId: 42 })).resolves.toBe("loaded");
    expect(open).toHaveBeenCalledWith({ chatId: 42 });
    await expect(makeStore().store.openSession({ chatId: 7 })).rejects.toThrow();
  });

  it("drops a session with its draft and its active slot", async () => {
    const { store } = makeStore();
    const sid = newSession(store);
    store.setDraft(sid, { text: "keep me" });
    await flushPromises();
    await new Promise((r) => setTimeout(r));
    expect(sessionStorage.getItem(`o2.assistant.draft:k1:${sid}`)).toContain("keep me");
    store.dropSession(sid, "deleted");
    expect(store.state.sessions[sid]).toBeUndefined();
    expect(store.state.shell.activeSid).toBeNull();
    expect(store.state.recent).not.toContain(sid);
    expect(sessionStorage.getItem(`o2.assistant.draft:k1:${sid}`)).toBeNull();
  });

  it("lets a rename beat later generated titles", () => {
    const { store } = makeStore();
    const sid = newSession(store);
    store.setTitle(sid, raw("Generated"), "generated");
    store.setTitle(sid, raw("Log row · cart"), "object");
    store.setTitle(sid, raw("Later frame"), "generated");
    expect(store.state.sessions[sid].title).toBe("Log row · cart");
    store.setTitle(sid, raw("Mine"), "renamed");
    store.setTitle(sid, raw("Object again"), "object");
    expect(store.state.sessions[sid]).toMatchObject({ title: "Mine", titleSource: "renamed" });
  });

  it("marks a session read and records post-completion annotations", () => {
    const { store } = makeStore();
    const sid = newSession(store);
    store.state.sessions[sid].unread = true;
    store.markRead(sid);
    expect(store.state.sessions[sid].unread).toBe(false);
    store.annotate(sid, "b1", { linkOutcome: { openedAt: 5 } });
    store.annotate(sid, "b1", { feedback: { rating: "up" } });
    expect(store.state.sessions[sid].annotations.b1).toEqual({
      linkOutcome: { openedAt: 5 },
      feedback: { rating: "up" },
    });
  });

  it("keeps a chat's votes and Opened times across a reload, for its own user and org only", () => {
    const { store } = makeStore();
    const sid = newSession(store);
    store.annotate(sid, "turn:t1:feedback", { feedback: { rating: "down", reason: "too_slow" } });
    store.annotate(sid, "b1", { linkOutcome: { openedAt: 5 } });
    const reloaded = makeStore().store;
    const again = newSession(reloaded);
    expect(again).toBe(sid);
    expect(reloaded.state.sessions[again].annotations).toEqual({
      "turn:t1:feedback": { feedback: { rating: "down", reason: "too_slow" } },
      b1: { linkOutcome: { openedAt: 5 } },
    });
    const other = makeStore().store;
    other.setIdentity({ userOrgKey: "k2", org: "org2" });
    expect(other.state.sessions[newSession(other)].annotations).toEqual({});
  });
});

describe("placement", () => {
  it("opens, records the invoker outside reactive state, and closes", () => {
    const { store } = makeStore();
    const sid = newSession(store);
    const button = document.createElement("button");
    store.open({ kind: "sidebar", mode: "pinned" }, { sid, focus: "composer", invoker: button });
    expect(store.state.shell.placement).toEqual({ kind: "sidebar", mode: "pinned" });
    expect(store.invokerOf(sid)).toBe(button);
    expect(isReactive(store.state.shell.invoker)).toBe(false);
    expect(store.focusRequest.value).toMatchObject({ target: "composer" });
    store.close("escape");
    expect(store.state.shell.placement).toEqual({ kind: "hidden" });
  });

  it("restores the previous placement when a docked host closes", () => {
    const { store } = makeStore();
    newSession(store);
    store.open({ kind: "sidebar", mode: "floating" }, { focus: "none" });
    store.open({ kind: "docked", hostId: "alert_query" }, { focus: "composer" });
    expect(store.state.shell.previousPlacement).toEqual({ kind: "sidebar", mode: "floating" });
    store.open({ kind: "docked", hostId: "regex" }, { focus: "composer" });
    expect(store.state.shell.previousPlacement).toEqual({ kind: "sidebar", mode: "floating" });
    store.close("host_closed");
    expect(store.state.shell.placement).toEqual({ kind: "sidebar", mode: "floating" });
    expect(store.state.shell.previousPlacement).toBeNull();
  });

  it("returns from the full view to the previous placement only when the route is left", () => {
    const { store } = makeStore();
    store.open({ kind: "sidebar", mode: "pinned" }, { focus: "none" });
    store.moveTo({ kind: "full" });
    store.close("route");
    expect(store.state.shell.placement).toEqual({ kind: "sidebar", mode: "pinned" });
    store.moveTo({ kind: "full" });
    store.close("close");
    expect(store.state.shell.placement).toEqual({ kind: "hidden" });
  });

  it("writes the placement per tab and restores it on reload", () => {
    const { store } = makeStore();
    store.open({ kind: "sidebar", mode: "pinned" }, { focus: "none" });
    expect(JSON.parse(sessionStorage.getItem("o2.assistant.placement:k1")!)).toMatchObject({
      placement: { kind: "sidebar", mode: "pinned" },
    });
    window.dispatchEvent(new Event("pagehide"));
    resetPrefsForTests();
    const reloaded = makeStore().store;
    expect(reloaded.state.shell.placement).toEqual({ kind: "sidebar", mode: "pinned" });
  });

  it("starts a duplicated tab hidden with an empty draft", () => {
    const { store } = makeStore();
    const sid = newSession(store);
    store.open({ kind: "sidebar", mode: "pinned" }, { focus: "none" });
    sessionStorage.setItem(`o2.assistant.draft:k1:${sid}`, JSON.stringify({ text: "copied" }));
    // The duplicate is a new page load over a copy of this tab's sessionStorage.
    resetPrefsForTests();
    const duplicate = makeStore().store;
    expect(duplicate.state.shell.placement).toEqual({ kind: "hidden" });
    expect(sessionStorage.getItem(`o2.assistant.draft:k1:${sid}`)).toBeNull();
  });

  it("keeps an org's drafts when the tab switches away and back, before and after a reload", () => {
    const { store } = makeStore();
    const sid = newSession(store);
    sessionStorage.setItem(`o2.assistant.draft:k1:${sid}`, JSON.stringify({ text: "half typed" }));
    store.setIdentity({ userOrgKey: "k2", org: "org2" });
    store.setIdentity({ userOrgKey: "k1", org: "org1" });
    expect(sessionStorage.getItem(`o2.assistant.draft:k1:${sid}`)).toContain("half typed");
    store.setIdentity({ userOrgKey: "k2", org: "org2" });
    window.dispatchEvent(new Event("pagehide"));
    resetPrefsForTests();
    const reloaded = createAssistantStore(inertAssistantDeps(), { viewportRem: () => 80 });
    reloaded.setIdentity({ userOrgKey: "k2", org: "org2" });
    reloaded.syncCapability(capability("available"));
    reloaded.setIdentity({ userOrgKey: "k1", org: "org1" });
    expect(sessionStorage.getItem(`o2.assistant.draft:k1:${sid}`)).toContain("half typed");
  });

  it("stores sidebar width and mode by user+org and clamps the width", () => {
    const { store } = makeStore();
    store.setSidebarWidth(10);
    expect(store.state.shell.sidebarWidthRem).toBe(20);
    store.setSidebarWidth(70);
    expect(store.state.shell.sidebarWidthRem).toBe(40);
    store.setSidebarMode("floating");
    store.setSheetSnap("full");
    expect(JSON.parse(localStorage.getItem("o2.assistant.sidebar:k1")!)).toEqual({
      widthRem: 40,
      mode: "floating",
    });
    expect(store.hasStoredSidebarMode()).toBe(true);
    expect(store.state.shell.sheetSnap).toBe("full");
  });

  it("reloads the sidebar prefs when another tab changes them while the panel is closed", () => {
    const { store } = makeStore();
    localStorage.setItem("o2.assistant.sidebar:k1", JSON.stringify({ widthRem: 28 }));
    window.dispatchEvent(new StorageEvent("storage", { key: "o2.assistant.sidebar:k1" }));
    expect(store.state.shell.sidebarWidthRem).toBe(28);
  });

  it("exposes the container as a rendering of the placement", () => {
    const { store } = makeStore();
    const view = useAssistantPlacement(store);
    expect(view.container.value).toBeNull();
    store.open({ kind: "docked", hostId: "function" }, { focus: "none" });
    expect(view.container.value).toBe("docked.function");
    expect(view.isVisible.value).toBe(true);
    expect(view.sidebarForcedFloating.value).toBe(false);
  });

  it("refuses every turn start in a chat under the cross-tab lock, naming why", async () => {
    const engine = { ...inertAssistantDeps().engine, send: vi.fn(), retry: vi.fn() };
    let lock: "signed_out" | "account_changed" | "approval_elsewhere" | null = "approval_elsewhere";
    const { store } = makeStore({ engine }, "available", { turnLock: () => lock });
    const sid = newSession(store);
    await expect(store.send(sid)).resolves.toMatchObject({
      state: "refused",
      error: { code: "approval_elsewhere", phase: "pre_admission" },
    });
    await expect(store.retry(sid)).resolves.toMatchObject({ state: "refused" });
    await expect(store.regenerate(sid)).resolves.toMatchObject({ state: "refused" });
    await expect(
      store.editResend(sid, { text: "x", chips: [], images: [], editedFrom: 1 }),
    ).resolves.toMatchObject({ state: "refused" });
    lock = "account_changed";
    await expect(store.send(sid)).resolves.toMatchObject({ error: { code: "account_changed" } });
    lock = "signed_out";
    await expect(store.send(sid)).resolves.toMatchObject({ error: { code: "session_expired" } });
    expect(engine.send).not.toHaveBeenCalled();
    expect(engine.retry).not.toHaveBeenCalled();
    expect(store.turnLockOf(sid)).toBe("signed_out");
  });

  it("holds a wide stored width instead of floating, and floats only where 20 rem cannot sit beside <main>", () => {
    const viewportPx = ref(1024);
    const { store } = makeStore({}, "available", { viewportRem: () => viewportPx.value / 16 });
    const view = useAssistantPlacement(store);
    store.setSidebarWidth(32);
    expect(view.sidebarForcedFloating.value).toBe(false);
    expect(sidebarWidthFor(store.state.shell.sidebarWidthRem, 64, false)).toBe(26.5);
    viewportPx.value = 900;
    expect(view.sidebarForcedFloating.value).toBe(true);
    viewportPx.value = 1100;
    expect(view.sidebarForcedFloating.value).toBe(false);
  });

  it("pins for one open without writing pinned into the stored placement", () => {
    const { store } = makeStore();
    const view = useAssistantPlacement(store);
    store.open({ kind: "sidebar", mode: "floating" }, { focus: "none", forcePinned: true });
    expect(view.sidebarForcedPinned.value).toBe(true);
    expect(store.state.shell.placement).toEqual({ kind: "sidebar", mode: "floating" });
    expect(JSON.parse(sessionStorage.getItem("o2.assistant.placement:k1")!).placement).toEqual({
      kind: "sidebar",
      mode: "floating",
    });
    store.open({ kind: "sidebar", mode: "floating" }, { focus: "composer" });
    expect(view.sidebarForcedPinned.value).toBe(true);
    store.close("close");
    expect(view.sidebarForcedPinned.value).toBe(false);
    store.open({ kind: "sidebar", mode: "floating" }, { focus: "none" });
    expect(view.sidebarForcedPinned.value).toBe(false);
  });
});

describe("composer", () => {
  it("stages chips deduped and text replace-or-append", () => {
    const { store } = makeStore();
    const sid = newSession(store);
    store.stage(sid, { chips: [chip("a")], text: "Explain", mode: "replace" });
    store.stage(sid, { chips: [chip("a")], text: "and this", mode: "append" });
    expect(store.state.sessions[sid].composer).toMatchObject({ text: "Explain\nand this" });
    expect(store.state.sessions[sid].composer.chips).toHaveLength(1);
  });

  it("never appends a prompt identical to the composer's last line", () => {
    const { store } = makeStore();
    const sid = newSession(store);
    store.stage(sid, { text: "Explain this row", mode: "replace" });
    store.stage(sid, { text: "Explain this row", mode: "append" });
    store.stage(sid, { text: " Explain this row ", mode: "append" });
    expect(store.state.sessions[sid].composer.text).toBe("Explain this row");
    store.setDraft(sid, { text: "Explain this row\nand the next" });
    store.stage(sid, { text: "Explain this row", mode: "append" });
    expect(store.state.sessions[sid].composer.text).toBe(
      "Explain this row\nand the next\nExplain this row",
    );
  });

  it("caps chips at 20 rows and 32 KB, and refuses images as chips", () => {
    const { store } = makeStore();
    const sid = newSession(store);
    expect(store.addChip(sid, chip("rows", { count: 20 }))).toEqual({ ok: true });
    expect(store.addChip(sid, chip("one more"))).toEqual({ ok: false, cap: "rows" });
    expect(store.addChip(sid, chip("big", { kind: "query", sizeBytes: MAX_CHIP_BYTES }))).toEqual({
      ok: false,
      cap: "bytes",
    });
    expect(store.addChip(sid, chip("img", { kind: "image" }))).toEqual({ ok: false, cap: "type" });
    expect(store.addChip(sid, chip("rows", { count: 20 }))).toEqual({ ok: true });
  });

  it("caps images at four PNG or JPEG files of 2 MB", () => {
    const { store } = makeStore();
    const sid = newSession(store);
    for (const name of ["1", "2", "3", "4"])
      expect(store.addImage(sid, image(name))).toEqual({ ok: true });
    expect(store.addImage(sid, image("5"))).toEqual({ ok: false, cap: "images" });
    store.removeImage(sid, store.state.sessions[sid].composer.images[3].id!);
    expect(store.addImage(sid, image("gif", { mimeType: "image/gif" as "image/png" }))).toEqual({
      ok: false,
      cap: "type",
    });
    expect(store.addImage(sid, image("huge", { size: 3 * 1024 * 1024 }))).toEqual({
      ok: false,
      cap: "size",
    });
  });

  it("keys images by a generated id, so two pastes named alike are both kept", () => {
    const { store } = makeStore();
    const sid = newSession(store);
    expect(store.addImage(sid, image("image.png"))).toEqual({ ok: true });
    expect(store.addImage(sid, image("image.png", { data: "BBBB" }))).toEqual({ ok: true });
    const [first, second] = store.state.sessions[sid].composer.images;
    expect(first.id).toBeTruthy();
    expect(second.id).not.toBe(first.id);
    expect(store.addImage(sid, { ...first })).toEqual({ ok: true });
    expect(store.state.sessions[sid].composer.images).toHaveLength(2);
    store.removeImage(sid, "image.png");
    expect(store.state.sessions[sid].composer.images).toHaveLength(2);
    store.removeImage(sid, first.id!);
    expect(store.state.sessions[sid].composer.images.map((i) => i.data)).toEqual(["BBBB"]);
  });

  it("turns a removed page chip into an add-back key and clears it when re-added", () => {
    const { store } = makeStore();
    const sid = newSession(store);
    store.addChip(sid, chip("time", { kind: "time", provenance: "page" }));
    store.removeChip(sid, "time");
    expect(store.state.sessions[sid].composer.removedPageKeys).toEqual(["time"]);
    store.addBackChip(sid, "time");
    expect(store.state.sessions[sid].composer.removedPageKeys).toEqual([]);
  });

  it("restores a refused draft byte for byte", () => {
    const { store } = makeStore();
    const sid = newSession(store);
    const snapshot = {
      text: "why?",
      chips: [chip("a")],
      images: [image("x")],
      mentions: [],
      timeOverride: { from: 1, to: 2 },
    };
    store.restoreDraft(sid, snapshot);
    expect(store.state.sessions[sid].composer).toMatchObject({
      text: "why?",
      chips: [chip("a")],
      images: [image("x")],
      timeOverride: { from: 1, to: 2 },
    });
  });

  it("sets a time override and switches to reply and back", () => {
    const { store } = makeStore();
    const sid = newSession(store);
    store.setTimeOverride(sid, { from: 5, to: 6, period: "15m" });
    store.startReply(sid, "call-1");
    expect(store.state.sessions[sid].composer).toMatchObject({
      mode: "reply",
      replyApprovalId: "call-1",
      timeOverride: { from: 5, to: 6, period: "15m" },
    });
    store.cancelReply(sid);
    expect(store.state.sessions[sid].composer.mode).toBe("compose");
    expect(store.state.sessions[sid].composer.replyApprovalId).toBeUndefined();
  });

  it("sets the draft aside while Reply holds the box, and gives it back whichever way Reply ends", () => {
    const { store } = makeStore();
    const sid = newSession(store);
    store.setDraft(sid, { text: "and check cart too" });
    store.startReply(sid, "call-1");
    expect(store.state.sessions[sid].composer.text).toBe("");
    store.setDraft(sid, { text: "use 5%" });
    store.startReply(sid, "call-1");
    store.cancelReply(sid);
    expect(store.state.sessions[sid].composer).toMatchObject({
      mode: "compose",
      text: "and check cart too",
    });
    expect(store.state.sessions[sid].composer.replyStash).toBeUndefined();
  });

  it("answers an Enable on its way before a Stop: the stop waits on the consent runtime", async () => {
    const consent = {
      onConsentRequired: vi.fn(),
      resolve: vi.fn(),
      cancel: vi.fn(),
      busy: vi.fn(() => true),
    };
    const engine = { ...inertAssistantDeps().engine, stop: vi.fn(async () => undefined) };
    const { store } = makeStore({ consent, engine });
    const sid = newSession(store);
    await store.stop(sid);
    expect(consent.cancel).toHaveBeenCalledWith(sid, "stopped");
    expect(engine.stop).not.toHaveBeenCalled();
  });

  it("rebuilds a chat's action ledger from its kept records, newest 200 only", () => {
    const sid = "0190f3a0-0000-7000-8000-000000000777";
    for (let card = 0; card < 3; card++)
      writeAnnotation(
        "k1",
        sid,
        `approval:t${card}:1`,
        {
          ledger: Array.from({ length: 100 }, (_, i) => ({
            id: `led-${card}-${i}`,
            approvalId: `t${card}:1`,
            turnId: `t${card}`,
            tool: "o2_delete",
            op: "delete" as const,
            resource: { type: "alert", name: `a${i}` },
            status: "done" as const,
            undoable: true,
            at: card * 1_000 + i,
          })),
        },
        card,
      );
    const { store } = makeStore({ uuid: () => sid });
    const created = newSession(store);
    const ledger = store.state.sessions[created].ledger;
    expect(ledger).toHaveLength(200);
    expect(ledger[0].id).toBe("led-1-0");
    expect(ledger.at(-1)?.id).toBe("led-2-99");
  });

  it("clears a draft with a 10 s undo token, and never across orgs", () => {
    const { store, clock } = makeStore();
    const sid = newSession(store);
    store.stage(sid, { chips: [chip("a")], text: "draft", mode: "replace" });
    const token = store.clearDraft(sid, "new_chat")!;
    expect(store.state.sessions[sid].composer).toMatchObject({ text: "", chips: [] });
    store.undoClear(sid, token);
    expect(store.state.sessions[sid].composer).toMatchObject({ text: "draft", chips: [chip("a")] });
    const late = store.clearDraft(sid, "new_chat")!;
    clock.now += UNDO_WINDOW_MS + 1;
    store.undoClear(sid, late);
    expect(store.state.sessions[sid].composer.text).toBe("");
    store.setDraft(sid, { text: "org A" });
    expect(store.clearDraft(sid, "org_switch")).toBeNull();
  });

  it("refuses an undo into a session of another user+org", () => {
    const { store } = makeStore();
    const sid = newSession(store);
    store.setDraft(sid, { text: "from k1" });
    const token = store.clearDraft(sid, "new_chat")!;
    store.setIdentity({ userOrgKey: "k2", org: "org2" });
    const other = newSession(store);
    store.undoClear(other, token);
    expect(store.state.sessions[other].composer.text).toBe("");
  });

  it("recalls older and newer prompts and gives back the live draft", async () => {
    const { store } = makeStore();
    const sid = newSession(store);
    for (const text of ["first", "second"]) {
      store.setDraft(sid, { text });
      await store.send(sid);
    }
    store.setDraft(sid, { text: "live" });
    store.recall(sid, "older");
    expect(store.state.sessions[sid].composer.text).toBe("second");
    store.recall(sid, "older");
    store.recall(sid, "older");
    expect(store.state.sessions[sid].composer).toMatchObject({ text: "first", recallIndex: 1 });
    store.recall(sid, "newer");
    store.recall(sid, "newer");
    expect(store.state.sessions[sid].composer).toMatchObject({ text: "live", recallIndex: -1 });
  });

  it("keeps a door's helper line until the next edit", () => {
    const { store } = makeStore();
    const sid = newSession(store);
    store.setEntryNotice(sid, "assistant.entry.addedToDraft");
    expect(useAssistantSession(sid, store).entryNotice.value).toBe("assistant.entry.addedToDraft");
    store.setDraft(sid, { text: "edited" });
    expect(store.entryNotice(sid)).toBeNull();
  });
});

describe("transcript view state", () => {
  it("toggles steps, follow and versions on the session", () => {
    const { store } = makeStore();
    const sid = newSession(store);
    store.toggleStep(sid, "c1");
    store.toggleStep(sid, "c2");
    store.toggleStep(sid, "c1");
    store.state.sessions[sid].ui.unseen = 3;
    store.setFollow(sid, true);
    store.selectVersion(sid, "t1", 2);
    expect(store.state.sessions[sid].ui).toEqual({
      expandedSteps: ["c2"],
      follow: true,
      unseen: 0,
      activeVersion: { t1: 2 },
    });
  });
});

describe("turn actions", () => {
  it("delegates to the engine, services and dispatcher", async () => {
    const deps = inertAssistantDeps();
    const engine = {
      ...deps.engine,
      send: vi.fn().mockResolvedValue(DONE),
      stop: vi.fn(),
      retry: vi.fn().mockResolvedValue(DONE),
      continueTurn: vi.fn(),
      retrySave: vi.fn(),
    };
    const approvals = { ...deps.approvals, decide: vi.fn().mockResolvedValue({ status: "done" }) };
    const consent = { ...deps.consent, resolve: vi.fn() };
    const actions = { apply: vi.fn().mockResolvedValue({ ok: true }) };
    const { store } = makeStore({ engine, approvals, consent, actions });
    const sid = newSession(store);
    await expect(store.send(sid, { mode: "chat" })).resolves.toEqual(DONE);
    expect(engine.send).toHaveBeenCalledWith(sid, { mode: "chat" });
    await store.stop(sid);
    await store.retry(sid);
    store.continueTurn(sid);
    await store.retrySave(sid, "t1");
    await store.decideApproval(sid, { approved: true, scope: "once" });
    await store.resolveConsent(sid, true, true);
    await store.dispatch(sid, { kind: "retry" });
    expect(engine.stop).toHaveBeenCalledWith(sid);
    expect(engine.retry).toHaveBeenCalledWith(sid);
    expect(engine.continueTurn).toHaveBeenCalledWith(sid);
    expect(engine.retrySave).toHaveBeenCalledWith(sid, "t1");
    expect(approvals.decide).toHaveBeenCalledWith(
      sid,
      { approved: true, scope: "once" },
      undefined,
    );
    expect(consent.resolve).toHaveBeenCalledWith(sid, true, true);
    expect(actions.apply).toHaveBeenCalledWith(sid, { kind: "retry" });
  });

  it("returns the in-flight result to a second send", async () => {
    let finish!: (t: TurnTerminal) => void;
    const deps = inertAssistantDeps();
    const send = vi.fn(() => new Promise<TurnTerminal>((r) => (finish = r)));
    const { store } = makeStore({ engine: { ...deps.engine, send } });
    const sid = newSession(store);
    const first = store.send(sid);
    expect(store.send(sid)).toBe(first);
    finish(DONE);
    await first;
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("shares one in-flight guard between send and retry", async () => {
    let finish!: (t: TurnTerminal) => void;
    const deps = inertAssistantDeps();
    const send = vi.fn(() => new Promise<TurnTerminal>((r) => (finish = r)));
    const retry = vi.fn().mockResolvedValue(DONE);
    const { store } = makeStore({ engine: { ...deps.engine, send, retry } });
    const sid = newSession(store);
    const first = store.send(sid);
    expect(store.retry(sid)).toBe(first);
    finish(DONE);
    await first;
    const again = store.retry(sid);
    expect(store.retry(sid)).toBe(again);
    expect(store.send(sid)).toBe(again);
    await again;
    expect(send).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("clears the sent draft when the turn ends but keeps one typed while it ran", async () => {
    let finish!: (t: TurnTerminal) => void;
    const deps = inertAssistantDeps();
    const send = vi.fn(() => new Promise<TurnTerminal>((r) => (finish = r)));
    const { store, drafts } = makeStore({ engine: { ...deps.engine, send } });
    const sid = newSession(store);
    store.setDraft(sid, { text: "why 5xx" });
    const sent = store.send(sid);
    finish(DONE);
    await sent;
    expect(drafts.read("k1", sid)).toBeNull();
    store.setDraft(sid, { text: "second question" });
    const next = store.send(sid);
    store.setDraft(sid, { text: "typed while it ran" });
    finish(DONE);
    await next;
    expect(drafts.read("k1", sid)?.text).toBe("typed while it ran");
  });

  it("records a new turn's terminal over the previous turn's", async () => {
    const deps = inertAssistantDeps();
    const send = vi
      .fn()
      .mockResolvedValueOnce(DONE)
      .mockResolvedValueOnce({ state: "failed", error: { code: "provider_error" } });
    const { store } = makeStore({ engine: { ...deps.engine, send } });
    const sid = newSession(store);
    await store.send(sid);
    await store.send(sid);
    expect(store.state.sessions[sid].turn.state).toBe("failed");
    expect(store.headerLight.value).toMatchObject({ state: "unread", failed: true });
  });

  it("keeps a terminal the engine already wrote for this turn", async () => {
    const deps = inertAssistantDeps();
    const engineWritten: TurnTerminal = { state: "done", saved: "local" };
    let target: { turn: unknown } | undefined;
    const send = vi.fn(async () => {
      target!.turn = engineWritten;
      return DONE;
    });
    const { store } = makeStore({ engine: { ...deps.engine, send } });
    const sid = newSession(store);
    target = store.state.sessions[sid];
    await store.send(sid);
    expect(store.state.sessions[sid].turn).toEqual(engineWritten);
  });

  it("refuses with unknown by default (the inert engine)", async () => {
    const { store } = makeStore();
    const sid = newSession(store);
    await expect(store.send(sid)).resolves.toMatchObject({
      state: "refused",
      error: { code: "unknown" },
    });
  });

  it("marks a hidden session unread when its turn ends and a local write failure as not saved", async () => {
    const deps = inertAssistantDeps();
    const { store } = makeStore({
      engine: { ...deps.engine, send: vi.fn().mockResolvedValue(DONE) },
    });
    const sid = newSession(store);
    await store.send(sid);
    expect(store.state.sessions[sid]).toMatchObject({ unread: true, turn: DONE });
    store.markNotSaved(sid);
    expect(store.state.sessions[sid].turn).toEqual({ state: "done", saved: "not_saved" });
  });

  it("re-renders an outcome when a link on a completed turn is clicked", async () => {
    const deps = inertAssistantDeps();
    const { store } = makeStore({
      engine: { ...deps.engine, send: vi.fn().mockResolvedValue(DONE) },
    });
    const sid = newSession(store);
    store.state.sessions[sid].messages = [{ role: "assistant", content: raw("answer") }];
    await store.send(sid);
    const block = store.state.sessions[sid].messages[0];
    expect(isReactive(block)).toBe(false);
    const outcome = computed(() => store.state.sessions[sid].annotations.b1?.linkOutcome ?? null);
    expect(outcome.value).toBeNull();
    store.annotate(sid, "b1", { linkOutcome: { openedAt: 9 } });
    expect(outcome.value).toEqual({ openedAt: 9 });
  });
});

describe("idle-session release (rule 10)", () => {
  const reloadable = (over: Partial<AssistantStoreDeps["history"]> = {}) => ({
    history: { ...inertAssistantDeps().history, canReload: computed(() => true), ...over },
  });
  const fill = (store: AssistantStoreInternal, count: number): Sid[] =>
    Array.from({ length: count }, () => {
      const sid = store.createSession({ origin: ORIGIN, thread: "new" });
      store.state.sessions[sid].messages = [{ role: "user", content: raw("q") }];
      return sid;
    });

  it("keeps at most ten idle transcripts, releasing the least recently used", () => {
    const { store } = makeStore(reloadable());
    const sids = fill(store, IDLE_SESSION_LIMIT + 3);
    store.setActive(null);
    const holding = sids.filter((sid) => store.state.sessions[sid].messages.length > 0);
    expect(holding).toHaveLength(IDLE_SESSION_LIMIT);
    expect(store.state.sessions[sids[0]].messages).toEqual([]);
    expect(store.state.sessions[sids[0]].title).toBeNull();
    expect(store.state.sessions[sids.at(-1)!].messages).toHaveLength(1);
  });

  it("releases nothing while history cannot reload a transcript", () => {
    const { store } = makeStore();
    const sids = fill(store, IDLE_SESSION_LIMIT + 3);
    store.setActive(null);
    for (const sid of sids) expect(store.state.sessions[sid].messages).toHaveLength(1);
  });

  it("never releases an active, running, drafted or carded session", () => {
    const { store } = makeStore(reloadable());
    const [running, drafted, carded] = fill(store, 3);
    store.state.sessions[running].turn = { state: "connecting" };
    store.state.sessions[drafted].composer.text = "half typed";
    store.state.sessions[carded].pendingApproval = approval(carded);
    fill(store, IDLE_SESSION_LIMIT + 2);
    const active = store.state.shell.activeSid!;
    for (const sid of [running, drafted, carded, active])
      expect(store.state.sessions[sid].messages).toHaveLength(1);
  });

  it("never evicts an unsaved answer and waits for an in-flight save", async () => {
    const { store } = makeStore(reloadable());
    const [unsaved, saving] = fill(store, 2);
    store.state.sessions[unsaved].turn = { state: "done", saved: "not_saved" };
    let flush!: () => void;
    store.trackSave(saving, new Promise<void>((r) => (flush = r)));
    fill(store, IDLE_SESSION_LIMIT + 2);
    expect(store.state.sessions[unsaved].messages).toHaveLength(1);
    expect(store.state.sessions[saving].messages).toHaveLength(1);
    flush();
    await flushPromises();
    expect(store.state.sessions[saving].messages).toEqual([]);
  });

  it("re-reads a released session through history when it is opened", async () => {
    const open = vi.fn(async ({ sid }: { sid: Sid }) => sid);
    const { store } = makeStore(reloadable({ open }));
    const [oldest] = fill(store, IDLE_SESSION_LIMIT + 2);
    await store.openSession({ sid: oldest });
    expect(open).toHaveBeenCalledWith({ sid: oldest });
  });
});

describe("derived views", () => {
  it("lets two containers on one fresh store observe one session", () => {
    const { store } = makeStore();
    const sid = newSession(store);
    const sidebar = useAssistantSession(sid, store);
    const full = useAssistantSession(() => sid, store);
    sidebar.setDraft({ text: "typed in the sidebar" });
    expect(full.composer.value?.text).toBe("typed in the sidebar");
    expect(full.session.value).toBe(sidebar.session.value);
  });

  it("orders the header light needs_you > working > unread > open > idle", () => {
    const { store } = makeStore();
    const first = newSession(store);
    expect(headerLightOf(store.state).state).toBe("idle");
    store.open({ kind: "sidebar", mode: "pinned" }, { focus: "none" });
    expect(headerLightOf(store.state).state).toBe("open");
    store.setDraft(first, { text: "x" });
    const second = newSession(store);
    store.state.sessions[first].unread = true;
    expect(store.headerLight.value).toMatchObject({ state: "unread", sid: first });
    store.state.sessions[second].turn = { state: "responding.writing" };
    expect(store.headerLight.value.state).toBe("working");
    store.state.sessions[second].pendingApproval = approval(second);
    expect(store.headerLight.value).toMatchObject({ state: "needs_you", sid: second });
  });

  it("leaves ephemeral helper and analysis sessions out of the light", () => {
    const { store } = makeStore();
    const sid = store.createSession({
      origin: { entryKind: "shortcut", objectKind: "query", container: "inline_helper" },
      ephemeral: true,
    });
    store.state.sessions[sid].unread = true;
    expect(store.headerLight.value.state).toBe("idle");
    store.state.sessions[sid].turn = { state: "connecting" };
    expect(store.headerLight.value.state).toBe("idle");
  });

  it("stages a door's Time chip as the composer's range instead of a hidden chip", () => {
    const { store } = makeStore();
    const sid = newSession(store);
    store.stage(sid, {
      chips: [
        {
          id: "door:time:1",
          kind: "time",
          label: raw("02:00 – 03:00"),
          ref: { type: "time", org: "org1", from: 1_000, to: 2_000 },
          sizeBytes: 0,
          provenance: "door",
          sent: "whitelist",
        },
      ],
    });
    expect(store.state.sessions[sid].composer.timeOverride).toEqual({ from: 1_000, to: 2_000 });
    expect(store.state.sessions[sid].composer.chips).toHaveLength(0);
  });

  it("never writes a helper or analysis prompt as a draft", () => {
    const { store, drafts } = makeStore();
    const sid = store.createSession({
      origin: { entryKind: "shortcut", objectKind: "query", container: "inline_helper" },
      ephemeral: true,
    });
    store.setDraft(sid, { text: "errors per service" });
    drafts.flush();
    expect(drafts.read("k1", sid)).toBeNull();
  });

  it("leaves other user+org sessions out of the light", () => {
    const { store } = makeStore();
    const sid = newSession(store);
    store.state.sessions[sid].turn = { state: "connecting" };
    store.setIdentity({ userOrgKey: "k2", org: "org2" });
    expect(store.headerLight.value.state).toBe("idle");
  });

  it("derives elsewhere, not-saved and needs-you per session", () => {
    const { store } = makeStore();
    const sid = newSession(store);
    const session = store.state.sessions[sid];
    session.turn = { state: "running_tool", tool: "SearchSQL", target: null, callId: "c" };
    session.turnMeta.ownedByThisTab = false;
    expect(sessionView(session, store.state.shell)).toMatchObject({
      running: true,
      elsewhere: true,
      visible: false,
    });
    session.turn = { state: "awaiting_consent" };
    expect(sessionView(session, store.state.shell).needsYou).toBe(true);
  });
});

describe("gates and isolation", () => {
  it.each(["loading", "not_entitled", "not_configured", "no_permission"] as const)(
    "is inert on %s: not ready, no session, no key written",
    (gate) => {
      const { store } = makeStore({}, gate);
      expect(store.state.ready).toBe(false);
      expect(() => newSession(store)).toThrow();
      store.open({ kind: "sidebar", mode: "pinned" }, { focus: "composer" });
      store.setSidebarWidth(30);
      store.setSidebarMode("floating");
      store.setActive(null);
      expect(store.state.shell.placement).toEqual({ kind: "hidden" });
      expect(localStorage.length).toBe(0);
      expect(sessionStorage.length).toBe(0);
    },
  );

  it("refuses a storage write for a session of another user+org", async () => {
    const { store } = makeStore();
    const sid = newSession(store);
    store.setIdentity({ userOrgKey: "k2", org: "org2" });
    store.setDraft(sid, { text: "org A secret" });
    await new Promise((r) => setTimeout(r));
    expect(Object.keys(sessionStorage).filter((k) => k.startsWith("o2.assistant.draft:"))).toEqual(
      [],
    );
  });

  it("refuses to send or retry into a session of another user+org", async () => {
    const deps = inertAssistantDeps();
    const engine = {
      ...deps.engine,
      send: vi.fn().mockResolvedValue(DONE),
      retry: vi.fn().mockResolvedValue(DONE),
    };
    const { store } = makeStore({ engine });
    const sid = newSession(store);
    store.setIdentity({ userOrgKey: "k2", org: "org2" });
    await expect(store.send(sid)).resolves.not.toEqual(DONE);
    await expect(store.retry(sid)).resolves.not.toEqual(DONE);
    expect(engine.send).not.toHaveBeenCalled();
    expect(engine.retry).not.toHaveBeenCalled();
  });
});

describe("lifecycle seams", () => {
  it("resets the visible session and rebinds hints on an org switch", async () => {
    const rebind = vi.fn();
    const { store } = makeStore({ hints: { ...inertAssistantDeps().hints, rebind } });
    const sid = newSession(store);
    store.open({ kind: "sidebar", mode: "pinned" }, { focus: "none" });
    await expect(store.onOrgSwitch({ org: "org2", userOrgKey: "k2" })).resolves.toBe("proceed");
    expect(store.state.shell.activeSid).toBeNull();
    expect(store.state.shell.placement.kind).toBe("sidebar");
    expect(store.state.sessions[sid]).toBeDefined();
    expect(rebind).toHaveBeenCalledWith("k2");
  });

  it("clears the user's session keys and recall, posts signed_out and resets on sign-out", async () => {
    const post = vi.fn();
    const { store } = makeStore({ hints: { ...inertAssistantDeps().hints, post } });
    const sid = newSession(store);
    store.setDraft(sid, { text: "secret" });
    await store.send(sid);
    store.open({ kind: "sidebar", mode: "pinned" }, { focus: "none" });
    await expect(store.onSignOut()).resolves.toBe("proceed");
    expect(Object.keys(sessionStorage).filter((k) => k.includes(":k1"))).toEqual([]);
    expect(localStorage.getItem("o2.assistant.recall:k1")).toBeNull();
    expect(localStorage.getItem("ai-chat-query-history:k1")).toBeNull();
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "signed_out" }));
    expect(store.state.sessions).toEqual({});
    expect(store.state.shell.placement).toEqual({ kind: "hidden" });
  });

  it("posts signed_out before it stops this tab's turns, so other tabs cancel in parallel", async () => {
    const order: string[] = [];
    const { store } = makeStore({
      hints: { ...inertAssistantDeps().hints, post: () => void order.push("hint") },
      engine: {
        ...inertAssistantDeps().engine,
        stopAll: async () => void order.push("stop"),
      },
    });
    await store.onSignOut();
    expect(order).toEqual(["hint", "stop"]);
  });

  it("merges another tab's light: its needs-you outranks working here, its working outranks only unread and open", () => {
    const local = (state: "needs_you" | "working" | "unread" | "open" | "idle") => ({
      state,
      sid: "here",
      failed: false,
    });
    const working = { state: "working" as const, sid: "there" };
    const waiting = { state: "needs_you" as const, sid: "there" };
    expect(withRemoteLight(local("working"), waiting)).toMatchObject({
      state: "needs_you",
      sid: "there",
    });
    expect(withRemoteLight(local("needs_you"), waiting)).toMatchObject({ sid: "here" });
    expect(withRemoteLight(local("working"), working)).toMatchObject({ sid: "here" });
    expect(withRemoteLight(local("unread"), working)).toMatchObject({
      state: "working",
      sid: "there",
    });
    expect(withRemoteLight(local("idle"), null)).toMatchObject({ state: "idle" });
  });

  it("purges every org this tab used and every org's recall on sign-out", async () => {
    vi.useFakeTimers();
    const signOutKeys = vi.fn().mockResolvedValue(["k1", "k2", "k3"]);
    const { store, drafts } = makeStore({}, "available", { signOutKeys });
    const first = newSession(store);
    store.setDraft(first, { text: "org 1 draft" });
    store.setIdentity({ userOrgKey: "k2", org: "org2" });
    const second = newSession(store);
    store.setDraft(second, { text: "org 2 draft" });
    store.open({ kind: "sidebar", mode: "pinned" }, { focus: "none" });
    markTabAlive("k4");
    sessionStorage.setItem("o2.assistant.selected:k4", "sid-4");
    for (const key of ["k1", "k2", "k3"]) pushRecall(key, { text: "secret", chips: [], at: 1 });
    localStorage.setItem("ai-chat-query-history:k3", JSON.stringify(["legacy secret"]));
    localStorage.setItem("ai-chat-query-history:other", JSON.stringify(["someone else"]));
    drafts.flush();
    await store.onSignOut();
    expect(Object.keys(sessionStorage).filter((k) => /:k[1-4](:|$)/.test(k))).toEqual([]);
    expect(Object.keys(localStorage).filter((k) => /recall|query-history/.test(k))).toEqual([
      "ai-chat-query-history:other",
    ]);
    expect(drafts.read("k1", first)).toBeNull();
    expect(drafts.read("k2", second)).toBeNull();
    // Neither the heartbeat nor a later pagehide writes a purged org's tab marker back.
    vi.advanceTimersByTime(TAB_HEARTBEAT_MS * 2);
    window.dispatchEvent(new Event("pagehide"));
    expect(Object.keys(sessionStorage).filter((k) => k.startsWith("o2.assistant.tab:"))).toEqual(
      [],
    );
  });

  it("stops this tab's turns before the sign-out reset, waiting no longer than 300 ms", async () => {
    vi.useFakeTimers();
    const seen: number[] = [];
    let stopAll!: ReturnType<typeof vi.fn>;
    const { store } = makeStore({
      engine: {
        ...inertAssistantDeps().engine,
        stopAll: (stopAll = vi.fn(() => {
          seen.push(Object.keys(store.state.sessions).length);
          return new Promise<void>(() => undefined);
        })),
      },
    });
    newSession(store);
    const signOut = store.onSignOut();
    expect(stopAll).toHaveBeenCalledWith("sign_out");
    expect(seen).toEqual([1]);
    await vi.advanceTimersByTimeAsync(SIGN_OUT_STOP_WAIT_MS);
    await expect(signOut).resolves.toBe("proceed");
    expect(store.state.sessions).toEqual({});
  });

  it("queues announcements for the turn region and reloads prefs on a prefs hint", () => {
    const { store } = makeStore();
    store.announce("s1", "assistant.entry.open");
    expect(store.announcement.value).toMatchObject({
      seq: 1,
      sid: "s1",
      key: "assistant.entry.open",
    });
    localStorage.setItem("o2.assistant.sidebar:k1", JSON.stringify({ mode: "floating" }));
    store.applyHint({ v: 1, type: "prefs_changed", key: "sidebar_mode", at: 1 });
    expect(store.state.shell.sidebarMode).toBe("floating");
  });
});

describe("draft restore after a reload (WP-05)", () => {
  it("brings a selected chat back with its stored draft when history cannot re-read it (CT-06 AC 3)", async () => {
    const sid = "0190f3a0-0000-7000-8000-000000000099";
    sessionStorage.setItem("o2.assistant.selected:k1", sid);
    sessionStorage.setItem(
      `o2.assistant.draft:k1:${sid}`,
      JSON.stringify({ text: "half a thought", chips: [chip("c1")], imageCount: 1 }),
    );
    const { store } = makeStore();
    await flushPromises();
    expect(store.state.shell.activeSid).toBe(sid);
    expect(store.state.sessions[sid].composer).toMatchObject({
      text: "half a thought",
      images: [],
    });
    expect(store.state.sessions[sid].composer.chips.map((c) => c.id)).toEqual(["c1"]);
    expect(store.takeRestoredDraft(sid)).toEqual({ imageCount: 1 });
    expect(store.takeRestoredDraft(sid)).toBeNull();
  });

  it.each([
    [{ status: 404 }, false],
    [{ response: { status: 403 } }, false],
    [{ status: 503 }, true],
    [new TypeError("Failed to fetch"), true],
  ])(
    "keeps the stored draft unless history says the chat is gone or forbidden (S9): %o",
    async (error, kept) => {
      const sid = "0190f3a0-0000-7000-8000-000000000097";
      sessionStorage.setItem("o2.assistant.selected:k1", sid);
      sessionStorage.setItem(`o2.assistant.draft:k1:${sid}`, JSON.stringify({ text: "draft" }));
      const { store } = makeStore({
        history: {
          ...inertAssistantDeps().history,
          canReload: computed(() => true),
          open: () => Promise.reject(error),
        },
      });
      await flushPromises();
      expect(store.state.sessions[sid]).toBeUndefined();
      expect(sessionStorage.getItem(`o2.assistant.draft:k1:${sid}`) !== null).toBe(kept);
    },
  );

  it("brings a draft back on a blank chat when history never saw the chat saved", async () => {
    const sid = "0190f3a0-0000-7000-8000-000000000096";
    sessionStorage.setItem("o2.assistant.selected:k1", sid);
    sessionStorage.setItem(`o2.assistant.draft:k1:${sid}`, JSON.stringify({ text: "draft" }));
    const { store } = makeStore({
      history: {
        ...inertAssistantDeps().history,
        canReload: computed(() => true),
        open: () => Promise.reject(Object.assign(new Error("not_found"), { code: "not_found" })),
      },
    });
    await flushPromises();
    expect(store.state.shell.activeSid).toBe(sid);
    expect(store.state.sessions[sid].composer.text).toBe("draft");
  });

  it("starts empty when the selected chat left no draft", async () => {
    sessionStorage.setItem("o2.assistant.selected:k1", "0190f3a0-0000-7000-8000-000000000098");
    const { store } = makeStore();
    await flushPromises();
    expect(Object.keys(store.state.sessions)).toEqual([]);
  });

  it("keeps the image count with the draft so the reload notice can name it", () => {
    const { store, drafts } = makeStore();
    const sid = newSession(store);
    store.addImage(sid, image("shot.png"));
    drafts.flush();
    expect(drafts.read("k1", sid)).toMatchObject({ imageCount: 1 });
    store.removeImage(sid, store.state.sessions[sid].composer.images[0].id!);
    drafts.flush();
    expect(drafts.read("k1", sid)?.imageCount).toBeUndefined();
    expect(sessionStorage.getItem(`o2.assistant.draft:k1:${sid}`)).toBeNull();
  });
});

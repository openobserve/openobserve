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

import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import { raw } from "@/types/i18n";

import { createAssistantStore, inertAssistantDeps } from "./assistantStore";
import type {
  AssistantCapability,
  AssistantHostAdapter,
  DockHostId,
  GateCode,
  HostRegistry,
  OpenAssistantResult,
  PendingApproval,
} from "./assistantStore.types";
import type { ContextChip } from "./context/types";
import { createDraftStore } from "./drafts";
import {
  ASSISTANT_QUERY_KEYS,
  DOOR_REPEAT_MS,
  THREAD_APPEND_WINDOW_MS,
  createOpenAssistant,
  type OpenAssistantCall,
  type OpenAssistantEnv,
} from "./openAssistant";
import { resetPrefsForTests } from "./prefs";
import type { TurnTerminal } from "./turnStates";

const DONE: TurnTerminal = { state: "done", saved: "server" };

const chip = (id: string, org = "org1"): ContextChip => ({
  id,
  kind: "log_row",
  label: raw(`Log row · ${id}`),
  sizeBytes: 64,
  provenance: "door",
  sent: "serialized",
  ref: { type: "log_row", id, org },
});

const explain = (over: Partial<OpenAssistantCall> = {}): OpenAssistantCall =>
  ({
    entryKind: "object_verb",
    entryVerb: "explain",
    objectKind: "log_row",
    intent: "send",
    payload: { chips: [chip("r1")], text: "Explain this log row" },
    ...over,
  }) as OpenAssistantCall;

const addToChat = (id = "r2"): OpenAssistantCall => ({
  entryKind: "object_verb",
  entryVerb: "add_to_chat",
  objectKind: "log_row",
  intent: "stage",
  payload: { chips: [chip(id)] },
});

const headerOpen: OpenAssistantCall = {
  entryKind: "header_button",
  entryVerb: "ask",
  objectKind: "none",
  intent: "open",
};

const approval: PendingApproval = {
  id: "call-1",
  sessionId: "s",
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
};

const capability: AssistantCapability = {
  gate: "available",
  edition: "ee",
  configured: true,
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
  reasonCode: "available",
};

interface Setup {
  gate?: GateCode;
  route?: string;
  prefersFloating?: boolean;
  mounted?: DockHostId[];
  adapters?: Partial<Record<DockHostId, AssistantHostAdapter>>;
  lgUp?: boolean;
  turnLock?: () => "signed_out" | "account_changed" | "approval_elsewhere" | null;
}

// The fields `openAssistant` reads of a host: its row width, its minimum and its object's title.
function hostAt(rowRem: number, title = "Alert · checkout", minWidthRem?: number) {
  return {
    dockRowRem: () => rowRem,
    objectTitle: () => raw(title),
    dockSlot: { value: null },
    ...(minWidthRem !== undefined && { minWidthRem }),
  } as unknown as AssistantHostAdapter;
}

function setup(options: Setup = {}) {
  let n = 0;
  const clock = { now: 10_000_000 };
  const send = vi.fn().mockResolvedValue(DONE);
  const deps = inertAssistantDeps({
    getOrg: () => ({ identifier: "org1", name: "Org 1" }),
    now: () => clock.now,
    uuid: () => `0190f3a0-0000-7000-8000-${String((n += 1)).padStart(12, "0")}`,
  });
  deps.engine.send = send;
  const store = createAssistantStore(deps, {
    drafts: createDraftStore({ delayMs: 0 }),
    viewportRem: () => 80,
    ...(options.turnLock && { turnLock: options.turnLock }),
  });
  const gate = options.gate ?? "available";
  store.setIdentity({ userOrgKey: "k1", org: "org1" });
  store.syncCapability({ ...capability, gate });
  const mounted = new Set(options.mounted ?? []);
  const hosts = {
    has: (id: DockHostId) => mounted.has(id),
    get: (id: DockHostId) => (mounted.has(id) ? options.adapters?.[id] : undefined),
  } as unknown as HostRegistry;
  const notify = vi.fn();
  const pushRoute = vi.fn();
  const env: OpenAssistantEnv = {
    store,
    capability: () => ({ ...capability, gate }),
    hosts,
    routeName: () => options.route ?? "logs",
    routePrefersFloating: () => options.prefersFloating ?? false,
    pushRoute,
    lgUp: () => options.lgUp ?? true,
    viewportPx: () => 1280,
    currentOrg: () => "org1",
    now: () => clock.now,
    notify,
  };
  return { store, open: createOpenAssistant(env), send, notify, pushRoute, clock };
}

const events = () => window.__o2telemetry ?? [];

const ok = (result: OpenAssistantResult) => {
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result;
};

beforeEach(() => {
  window.__O2_TELEMETRY_SINK__ = true;
  window.__o2telemetry = [];
});

afterEach(() => {
  delete window.__O2_TELEMETRY_SINK__;
  delete window.__o2telemetry;
  localStorage.clear();
  sessionStorage.clear();
  resetPrefsForTests();
});

describe("gate first (DG-02 AC 8)", () => {
  it.each(["not_entitled", "not_configured", "off_for_org", "no_permission"] as const)(
    "refuses on %s, opens and stages nothing, and reports ai_gate_blocked",
    async (gate) => {
      const { store, open, send } = setup({ gate });
      await expect(open(explain())).resolves.toEqual({ ok: false, reason: gate });
      expect(store.state.sessions).toEqual({});
      expect(store.state.shell.placement).toEqual({ kind: "hidden" });
      expect(send).not.toHaveBeenCalled();
      expect(events().map((e) => e.name)).toEqual(["ai_gate_blocked"]);
      expect(events()[0].properties).toMatchObject({ reason: gate });
    },
  );

  it("opens nothing during loading and reports the click without a gate reason", async () => {
    const { store, open } = setup({ gate: "loading" });
    await expect(open(headerOpen)).resolves.toEqual({ ok: false, reason: "loading" });
    expect(store.state.shell.placement.kind).toBe("hidden");
    expect(events().map((e) => e.name)).toEqual(["ai_entry_clicked"]);
    expect(events()[0].properties).toMatchObject({ gate: "loading", sends: false, queued: false });
  });

  it("reports the click when the store is not ready yet behind an open gate", async () => {
    const { store, open } = setup();
    store.setIdentity(null);
    await expect(open(explain())).resolves.toEqual({ ok: false, reason: "loading" });
    expect(events().map((e) => e.name)).toEqual(["ai_entry_clicked"]);
    expect(events()[0].properties).toMatchObject({ gate: "available", sends: false });
  });

  it.each(["available", "unhealthy"] as const)("lets doors through on %s", async (gate) => {
    const { open } = setup({ gate });
    expect((await open(headerOpen)).ok).toBe(true);
  });
});

describe("intent × thread", () => {
  it("send + new: a new titled session, the prompt as text, the chip attached, sent once", async () => {
    const { store, open, send } = setup();
    const first = ok(await open(addToChat("seed")));
    const result = ok(await open(explain({ thread: "new" })));
    expect(result).toMatchObject({ container: "sidebar", staged: 1, sent: true, queued: false });
    expect(result.sid).not.toBe(first.sid);
    const session = store.state.sessions[result.sid];
    expect(session.composer.text).toBe("Explain this log row");
    expect(session.title).toBe("Explain this log row");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(result.sid, undefined);
    expect(store.state.sessions[first.sid].composer.chips).toHaveLength(1);
  });

  it("stage + current: appends the chip to the open session, keeps the draft, sends nothing", async () => {
    const { store, open, send } = setup();
    const { sid } = ok(await open(headerOpen));
    store.setDraft(sid, { text: "my draft" });
    const result = ok(await open(addToChat()));
    expect(result).toMatchObject({ sid, staged: 1, sent: false, queued: false });
    expect(store.state.sessions[sid].composer.text).toBe("my draft");
    expect(send).not.toHaveBeenCalled();
  });

  it("stage + new: a fresh session even with one open", async () => {
    const { open, store } = setup();
    const first = ok(await open(addToChat("a")));
    const result = ok(await open({ ...addToChat("b"), thread: "new" }));
    expect(result.sid).not.toBe(first.sid);
    expect(store.state.sessions[first.sid].composer.chips).toHaveLength(1);
  });

  it("send + current: sends into the open, empty-composer session", async () => {
    const { open, send } = setup();
    const { sid } = ok(await open(headerOpen));
    const result = ok(await open(explain({ thread: "current" })));
    expect(result).toMatchObject({ sid, sent: true });
    expect(send).toHaveBeenCalledWith(sid, undefined);
  });

  it("open + auto: reuses a chat whose last turn ended under 30 minutes ago, else a new one", async () => {
    const { open, clock, store } = setup();
    const { sid } = ok(await open(explain()));
    await Promise.resolve();
    await store.send(sid);
    clock.now += THREAD_APPEND_WINDOW_MS - 1;
    expect(ok(await open({ ...headerOpen, thread: "auto" })).sid).toBe(sid);
    clock.now += DOOR_REPEAT_MS;
    expect(ok(await open({ ...headerOpen, thread: "auto" })).sid).not.toBe(sid);
  });

  it("open + new and open + current with nothing open create one session", async () => {
    const { open, store } = setup();
    const a = ok(await open({ ...headerOpen, thread: "new" }));
    const b = ok(await open({ ...headerOpen, thread: "current" }));
    expect(b.sid).toBe(a.sid);
    expect(Object.keys(store.state.sessions)).toHaveLength(1);
  });

  it("decides the thread on the target container's session, not on the other container's", async () => {
    const { open, store } = setup({ mounted: ["alert_query"] });
    const sidebar = ok(await open(headerOpen)).sid;
    await store.send(sidebar);
    const dockDoor = {
      ...headerOpen,
      entryKind: "editor_toggle",
      dockHost: "alert_query",
      thread: "auto",
    } as const;
    const docked = ok(await open(dockDoor));
    expect(docked.container).toBe("docked.alert_query");
    expect(docked.sid).not.toBe(sidebar);
    expect(store.state.sessions[docked.sid].origin.container).toBe("docked.alert_query");
    const page = ok(await open(addToChat()));
    expect(page).toMatchObject({ container: "sidebar", sid: sidebar });
  });

  it("a send door staged into a chat in use keeps that chat's title; a new thread takes the door's (F9)", async () => {
    const { open, store } = setup();
    const { sid } = ok(await open(explain()));
    await store.send(sid);
    const before = store.state.sessions[sid].title;
    const titled = (thread: "current" | "new") =>
      explain({
        intent: "stage",
        thread,
        payload: { chips: [chip("d1")], text: "Fix this", title: raw("Database · orders-db") },
      });
    const staged = ok(await open(titled("current")));
    expect(staged.sid).toBe(sid);
    expect(store.state.sessions[sid].title).toEqual(before);
    const fresh = ok(await open(titled("new")));
    expect(fresh.sid).not.toBe(sid);
    expect(String(store.state.sessions[fresh.sid].title)).toBe("Database · orders-db");
  });

  it("send + auto with a stale chat starts a new one", async () => {
    const { open, clock, store } = setup();
    const { sid } = ok(await open(explain()));
    await store.send(sid);
    clock.now += THREAD_APPEND_WINDOW_MS + 1;
    expect(ok(await open(explain({ thread: "auto" }))).sid).not.toBe(sid);
  });
});

describe("add to chat while hidden (WP-07 U11)", () => {
  it("stages into the current chat without opening a container", async () => {
    const { store, open } = setup();
    const result = ok(await open(addToChat()));
    expect(result).toMatchObject({ staged: 1, sent: false });
    expect(store.state.shell.placement.kind).toBe("hidden");
    expect(store.state.shell.activeSid).toBe(result.sid);
    expect(store.state.sessions[result.sid].composer.chips).toHaveLength(1);
  });

  it("still opens for a send door", async () => {
    const { store, open } = setup();
    ok(await open(explain()));
    expect(store.state.shell.placement.kind).not.toBe("hidden");
  });
});

describe("send degrades to stage", () => {
  it("queues behind a running turn with the helper line and no second request", async () => {
    const { store, open, send } = setup();
    const { sid } = ok(await open(headerOpen));
    store.state.sessions[sid].turn = { state: "responding.writing" };
    const result = ok(await open(explain({ thread: "current" })));
    expect(result).toMatchObject({ sid, sent: false, queued: true, staged: 1 });
    expect(store.entryNotice(sid)).toBe("assistant.entry.queuedWhileRunning");
    expect(send).not.toHaveBeenCalled();
    expect(events().at(-1)?.properties).toMatchObject({ sends: false, queued: true });
  });

  it("stages a send door into a draft on a new line and does not send (round 1 X-06)", async () => {
    const { store, open, send } = setup();
    const { sid } = ok(await open(headerOpen));
    store.setDraft(sid, { text: "what I was typing" });
    const result = ok(await open(explain({ thread: "current" })));
    expect(result).toMatchObject({ sent: false, queued: false });
    expect(store.state.sessions[sid].composer.text).toBe("what I was typing\nExplain this log row");
    expect(store.entryNotice(sid)).toBe("assistant.entry.addedToDraft");
    expect(send).not.toHaveBeenCalled();
  });

  it("shows no helper line when the door's prompt and chip are already in the draft", async () => {
    const { store, open, send } = setup();
    const { sid } = ok(await open(headerOpen));
    store.addChip(sid, chip("r1"));
    store.setDraft(sid, { text: "Explain this log row" });
    const result = ok(await open(explain({ thread: "current" })));
    expect(result).toMatchObject({ sid, sent: false, staged: 0 });
    expect(store.state.sessions[sid].composer.text).toBe("Explain this log row");
    expect(store.entryNotice(sid)).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it("stages beneath a pending card and offers Open in a toast", async () => {
    const { store, open, send, notify } = setup();
    const { sid } = ok(await open(headerOpen));
    store.state.sessions[sid].pendingApproval = approval;
    const result = ok(await open(addToChat()));
    expect(result).toMatchObject({ sid, sent: false, staged: 1 });
    expect(notify).toHaveBeenCalledWith("assistant.entry.addedBehindCard", {
      label: "assistant.entry.open",
      handler: expect.any(Function),
    });
    ok(await open(explain({ thread: "current" })));
    expect(send).not.toHaveBeenCalled();
  });
});

describe("container resolution (10 §3.3)", () => {
  it("resolves the full view on the assistant route and never opens the sidebar there", async () => {
    const { open, store, pushRoute } = setup({ route: "assistant" });
    const result = ok(await open(headerOpen));
    expect(result.container).toBe("full_view");
    expect(store.state.shell.placement).toEqual({ kind: "full" });
    expect(pushRoute).not.toHaveBeenCalled();
  });

  it("routes the launcher to the full view", async () => {
    const { open, pushRoute } = setup();
    const result = ok(
      await open({
        entryKind: "home_launcher",
        entryVerb: "ask",
        objectKind: "none",
        intent: "send",
        thread: "new",
        payload: { chips: [], text: "hello" },
      }),
    );
    expect(result.container).toBe("full_view");
    expect(pushRoute).toHaveBeenCalledWith({ name: "assistant", params: { chatId: result.sid } });
  });

  it("docks into a mounted host the door names, recording the previous placement", async () => {
    const { open, store } = setup({ mounted: ["alert_query"] });
    ok(await open(headerOpen));
    const result = ok(
      await open({ ...headerOpen, entryKind: "editor_toggle", dockHost: "alert_query" }),
    );
    expect(result.container).toBe("docked.alert_query");
    expect(store.state.shell.previousPlacement).toMatchObject({ kind: "sidebar" });
  });

  it("opens the sidebar for a host that is not mounted and for a page door outside a dock", async () => {
    const { open, store } = setup({ mounted: ["regex"] });
    expect(ok(await open({ ...headerOpen, dockHost: "function" })).container).toBe("sidebar");
    ok(await open({ ...headerOpen, entryKind: "editor_toggle", dockHost: "regex" }));
    expect(ok(await open(addToChat())).container).toBe("sidebar");
    expect(store.state.shell.placement.kind).toBe("sidebar");
  });

  it("focuses an already open dock for the header button and the chord", async () => {
    const { open } = setup({ mounted: ["json_editor"] });
    ok(await open({ ...headerOpen, entryKind: "editor_toggle", dockHost: "json_editor" }));
    expect(ok(await open({ ...headerOpen, entryKind: "shortcut" })).container).toBe(
      "docked.json_editor",
    );
  });

  it("opens the sidebar with a notice when the host cannot give the dock 20 rem beside 32", async () => {
    const { open, store, notify } = setup({
      mounted: ["regex"],
      adapters: { regex: hostAt(48) },
    });
    const result = ok(await open({ ...headerOpen, entryKind: "editor_toggle", dockHost: "regex" }));
    expect(result.container).toBe("sidebar");
    expect(store.state.shell.placement.kind).toBe("sidebar");
    expect(notify).toHaveBeenCalledWith("assistant.editor.tooNarrow", undefined);
  });

  it("docks when the row gives both, and a phone never refuses because the dock is a sheet", async () => {
    const wide = setup({ mounted: ["regex"], adapters: { regex: hostAt(52) } });
    expect(
      ok(await wide.open({ ...headerOpen, entryKind: "editor_toggle", dockHost: "regex" }))
        .container,
    ).toBe("docked.regex");
    const phone = setup({ mounted: ["regex"], adapters: { regex: hostAt(23) }, lgUp: false });
    ok(await phone.open({ ...headerOpen, entryKind: "editor_toggle", dockHost: "regex" }));
    expect(phone.store.state.shell.placement).toEqual({ kind: "docked", hostId: "regex" });
    expect(phone.notify).not.toHaveBeenCalled();
  });

  it("keeps a dock's thread to its object: another alert in the same editor starts its own chat", async () => {
    const adapter = hostAt(80, "Alert · checkout");
    const { open, store } = setup({ mounted: ["alert_query"], adapters: { alert_query: adapter } });
    const dockDoor = {
      ...headerOpen,
      entryKind: "editor_toggle" as const,
      dockHost: "alert_query" as const,
      thread: "current" as const,
      payload: { chips: [], title: raw("Alert · checkout") },
    };
    const first = ok(await open(dockDoor));
    store.setDraft(first.sid, { text: "keep me" });
    store.close("close");
    expect(ok(await open(dockDoor)).sid).toBe(first.sid);
    store.close("close");
    (adapter as { objectTitle: () => unknown }).objectTitle = () => raw("Alert · payments");
    const other = ok(
      await open({ ...dockDoor, payload: { chips: [], title: raw("Alert · payments") } }),
    );
    expect(other.sid).not.toBe(first.sid);
  });

  it("stages a send door's prompt instead of sending while this tab may not start a turn", async () => {
    const { open, store, send, notify } = setup({ turnLock: () => "approval_elsewhere" });
    const result = ok(await open(explain()));
    expect(result.sent).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(store.state.sessions[result.sid].composer.text).toBe("Explain this log row");
    expect(notify).toHaveBeenCalledWith("assistant.shell.approvalElsewhere", undefined);
    const clicked = events()
      .filter((e) => e.name === "ai_entry_clicked")
      .at(-1);
    expect(clicked?.properties.sends).toBe(false);
  });

  it("names the sheet below lg while the placement stays the sidebar", async () => {
    const { open, store } = setup({ lgUp: false });
    expect(ok(await open(headerOpen)).container).toBe("sheet");
    expect(store.state.shell.placement.kind).toBe("sidebar");
  });

  it("opens floating on a prefers-floating route but pinned when floating would cover the source", async () => {
    const { open, store } = setup({ prefersFloating: true });
    const rect = (left: number, right: number, top: number, bottom: number) =>
      ({ left, right, top, bottom }) as DOMRect;
    const leftPanel = document.createElement("div");
    leftPanel.getBoundingClientRect = () => rect(100, 400, 200, 400);
    ok(await open({ ...headerOpen, invoker: leftPanel }));
    expect(store.state.shell.placement).toEqual({ kind: "sidebar", mode: "floating" });
    store.close("close");
    // The header's own button sits above the card's top, so it is not covered either.
    const headerButton = document.createElement("button");
    headerButton.getBoundingClientRect = () => rect(1180, 1210, 4, 32);
    ok(await open({ ...headerOpen, invoker: headerButton }));
    expect(store.sidebarForcedPinned.value).toBe(false);
    store.close("close");
    const right = document.createElement("div");
    right.getBoundingClientRect = () => rect(900, 1200, 200, 400);
    ok(await open({ ...headerOpen, invoker: right }));
    expect(store.sidebarForcedPinned.value).toBe(true);
    expect(store.state.shell.placement).toEqual({ kind: "sidebar", mode: "floating" });
    expect(JSON.parse(sessionStorage.getItem("o2.assistant.placement:k1")!).placement).toEqual({
      kind: "sidebar",
      mode: "floating",
    });
    expect(store.state.shell.sidebarMode).toBe("pinned");
    expect(store.hasStoredSidebarMode()).toBe(false);
  });

  it("moves focus to the composer, except for a send into a visible container", async () => {
    const { open, store } = setup();
    ok(await open(headerOpen));
    const opened = store.focusRequest.value?.seq;
    ok(await open(explain({ thread: "new" })));
    expect(store.focusRequest.value?.seq).toBe(opened);
    store.close("close");
    ok(await open(explain({ thread: "new" })));
    expect(store.focusRequest.value?.seq).toBe((opened ?? 0) + 1);
  });
});

describe("org safety and ordering", () => {
  it("refuses a payload built under another user+org and creates nothing", async () => {
    const { open, store, notify } = setup();
    await expect(open({ ...addToChat(), userOrgKey: "k-stale" })).resolves.toEqual({
      ok: false,
      reason: "org_changed",
    });
    await expect(
      open({ ...addToChat(), payload: { chips: [chip("x", "other-org")] } }),
    ).resolves.toEqual({ ok: false, reason: "org_changed" });
    expect(notify).toHaveBeenCalledWith("assistant.entry.orgChanged", undefined);
    expect(store.state.sessions).toEqual({});
  });

  it("runs two doors in one tick in call order, so the second sees the first's session", async () => {
    const { open } = setup();
    const [first, second] = await Promise.all([open(explain()), open(addToChat())]);
    expect(ok(second).sid).toBe(ok(first).sid);
  });

  it("answers a repeated activation of the same door with the first result", async () => {
    const { open, store, send, clock } = setup();
    const first = ok(await open(explain()));
    const again = await open(explain());
    expect(again).toBe(first);
    expect(send).toHaveBeenCalledTimes(1);
    expect(store.state.sessions[first.sid].composer.text).toBe("Explain this log row");
    expect(Object.keys(store.state.sessions)).toHaveLength(1);
    clock.now += DOOR_REPEAT_MS;
    expect(ok(await open(explain())).sid).not.toBe(first.sid);
  });

  it("runs a repeated door again once its container was closed", async () => {
    const { open, store } = setup();
    ok(await open(headerOpen));
    store.close("escape");
    ok(await open(headerOpen));
    expect(store.state.shell.placement.kind).toBe("sidebar");
  });

  it("reports the click on an org_changed refusal", async () => {
    const { open } = setup();
    await open({ ...addToChat(), userOrgKey: "k-stale" });
    expect(events().map((e) => e.name)).toEqual(["ai_entry_clicked"]);
    expect(events()[0].properties).toMatchObject({ entry_verb: "add_to_chat", sends: false });
  });

  it("emits ai_entry_clicked with the door envelope and no content", async () => {
    const { open } = setup({ mounted: ["regex"] });
    ok(await open({ ...explain(), dockHost: "regex" }));
    const event = events().find((e) => e.name === "ai_entry_clicked")!;
    expect(event.properties).toMatchObject({
      entry_kind: "object_verb",
      entry_verb: "explain",
      object_kind: "log_row",
      sends: true,
      queued: false,
      host: "regex",
      text_len_bucket: "1_20",
    });
    expect(JSON.stringify(event.properties)).not.toContain("Explain this log row");
  });

  it("reserves the deep-link query keys", () => {
    expect(ASSISTANT_QUERY_KEYS).toEqual(["assistant", "object", "ref"]);
  });
});

describe("types", () => {
  it("allows send only for explain, troubleshoot, fix and the Home launcher", () => {
    expectTypeOf<{
      entryKind: "object_verb";
      entryVerb: "add_to_chat";
      objectKind: "log_row";
      intent: "send";
    }>().not.toMatchTypeOf<OpenAssistantCall>();
    expectTypeOf<{
      entryKind: "object_verb";
      entryVerb: "fix";
      objectKind: "dbm_finding";
      intent: "send";
    }>().toMatchTypeOf<OpenAssistantCall>();
    expectTypeOf<{
      entryKind: "home_launcher";
      entryVerb: "ask";
      objectKind: "none";
      intent: "send";
    }>().toMatchTypeOf<OpenAssistantCall>();
    expectTypeOf<{
      entryKind: "home_launcher";
      entryVerb: "add_to_chat";
      objectKind: "none";
      intent: "send";
    }>().not.toMatchTypeOf<OpenAssistantCall>();
    const { open } = setup();
    // @ts-expect-error -- add_to_chat never sends (DG-02 rule 3)
    void open({
      entryKind: "object_verb",
      entryVerb: "add_to_chat",
      objectKind: "log_row",
      intent: "send",
    });
  });
});

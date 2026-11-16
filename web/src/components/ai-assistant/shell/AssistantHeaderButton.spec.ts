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

import { gateLearnOpen } from "@/components/ai-assistant/gate/AssistantGateState.vue";
import type { AssistantCapability, GateCode } from "@/composables/assistant";
import { isLauncherDismissed, setLauncherDismissed } from "@/composables/assistant/prefs";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { raw } from "@/types/i18n";

import { fakeAssistant, fakeRouter, fakeVuex } from "../__tests__/fakeAssistant";
import AssistantHeaderButton from "./AssistantHeaderButton.vue";
import { closeLockedPanel, useLockedPanel } from "./lockedPanel";

const { fake, openAssistant, track, toast, lg } = vi.hoisted(() => ({
  lg: { value: true },
  fake: { current: null as any },
  openAssistant: vi.fn(async () => ({ ok: true })),
  track: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/composables/useBreakpoint", async () => {
  const { computed } = await import("vue");
  return {
    default: () => ({
      lgUp: computed(() => lg.value),
      mdUp: computed(() => lg.value),
      isMobile: computed(() => !lg.value),
      isTablet: computed(() => false),
      isDesktop: computed(() => lg.value),
    }),
  };
});
vi.mock("@/composables/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/assistant")>()),
  useAssistantStore: () => fake.current.store,
  useAssistantCapability: () => fake.current.handle,
  useAssistantHistory: () => fake.current.history,
  openAssistant,
}));
vi.mock("@/services/assistantAnalytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/assistantAnalytics")>()),
  trackAssistant: track,
}));
vi.mock("@/lib/feedback/Toast/useToast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/feedback/Toast/useToast")>()),
  toast,
}));

function setup(
  gate: GateCode = "available",
  over: Partial<AssistantCapability> = {},
  remote: { state: "needs_you" | "working"; sid: string } | null = null,
) {
  fake.current = fakeAssistant(gate, over, {}, 80, false, {}, { remoteLight: () => remote });
  const wrapper = mount(AssistantHeaderButton, {
    global: { plugins: [fakeRouter(), fakeVuex()] },
    attachTo: document.body,
  });
  return { wrapper, store: fake.current.store, capability: fake.current.capability };
}

function session(store: any, title: string) {
  const sid = store.createSession({
    origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
    thread: "new",
  });
  store.setTitle(sid, raw(title), "renamed");
  store.state.sessions[sid].turnMeta.turnId = `turn-${sid}`;
  return sid;
}

const button = (wrapper: any) => wrapper.find('[data-test="menu-link-ai-item"]');
const tooltip = (wrapper: any) => wrapper.findComponent(OTooltip).props("content");

beforeEach(() => {
  lg.value = true;
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  document.body.innerHTML = "";
  closeLockedPanel();
  openAssistant.mockClear();
  track.mockClear();
  toast.mockClear();
});

describe("AssistantHeaderButton gates", () => {
  it("reserves the slot with a skeleton until the gate resolves", () => {
    const { wrapper } = setup("loading");
    expect(button(wrapper).exists()).toBe(false);
    expect(wrapper.find('[data-test="assistant-header-skeleton"]').exists()).toBe(true);
  });

  it("is locked with the lock in its name on OSS and opens the pitch", async () => {
    const { wrapper } = setup("not_entitled");
    const el = button(wrapper);
    expect(el.attributes("data-state")).toBe("locked");
    expect(el.attributes("aria-label")).toBe("O2 Assistant, Enterprise and Cloud feature");
    expect(tooltip(wrapper)).toBe("O2 Assistant is part of OpenObserve Enterprise and Cloud");
    expect(el.find(".rounded-default.absolute svg").exists()).toBe(true);
    expect(wrapper.find('[data-test^="assistant-"]').exists()).toBe(false);
    await el.trigger("click");
    await flushPromises();
    expect(
      document.body.querySelector('[data-gate="not_entitled"][data-size="hero"]'),
    ).not.toBeNull();
    expect(openAssistant).not.toHaveBeenCalled();
  });

  it("is hidden for a member and muted, never aria-disabled, for an admin when not configured", async () => {
    expect(button(setup("not_configured", { isAdmin: false }).wrapper).exists()).toBe(false);
    document.body.innerHTML = "";
    const { wrapper } = setup("not_configured", { isAdmin: true });
    const el = button(wrapper);
    expect(el.attributes("data-state")).toBe("off");
    expect(el.attributes("aria-label")).toBe("O2 Assistant, not set up");
    expect(el.attributes("aria-disabled")).toBeUndefined();
    expect(el.attributes("disabled")).toBeUndefined();
    await el.trigger("click");
    await flushPromises();
    expect(document.body.querySelector('[data-gate="not_configured"]')).not.toBeNull();
  });

  it("closes the setup sheet below lg by Escape or × and returns focus to the button", async () => {
    lg.value = false;
    const { wrapper } = setup("not_configured", { isAdmin: true });
    for (const close of ["escape", "button"] as const) {
      await button(wrapper).trigger("click");
      await flushPromises();
      const sheet = document.body.querySelector<HTMLElement>(
        '[data-test="assistant-header-gate-sheet"]',
      );
      expect(sheet?.querySelector('[data-gate="not_configured"]')).not.toBeNull();
      if (close === "escape")
        sheet!
          .querySelector("button")!
          .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      else
        document.body
          .querySelector<HTMLElement>('[data-test="assistant-header-gate-sheet-close"]')!
          .click();
      await flushPromises();
      expect(document.body.querySelector('[data-test="assistant-header-gate-sheet"]')).toBeNull();
      expect(document.activeElement).toBe(button(wrapper).element);
    }
    // Every header button binds the one learn dialog, so a stale one would answer the next test's open.
    wrapper.unmount();
  });

  it("reserves the button's phone-sized slot while loading", () => {
    const classes = setup("loading")
      .wrapper.get('[data-test="assistant-header-skeleton"]')
      .classes();
    expect(classes).toEqual(
      expect.arrayContaining(["size-7.5", "max-md:size-11", "pointer-coarse:size-11"]),
    );
  });

  it("anchors the locked gate popover on the button and hands focus back on Escape", async () => {
    const { wrapper } = setup("no_permission");
    await button(wrapper).trigger("click");
    await flushPromises();
    expect(wrapper.findComponent({ name: "OPopover" }).props("anchor")).toBe(
      button(wrapper).element,
    );
    (document.activeElement as HTMLElement).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await flushPromises();
    expect(document.body.querySelector('[data-test="assistant-gate-state"]')).toBeNull();
    expect(document.activeElement).toBe(button(wrapper).element);
    wrapper.unmount();
  });

  it("is locked on G2 and opens the gate popover, never an empty container (D7 decision 2)", async () => {
    const { wrapper } = setup("no_permission");
    const el = button(wrapper);
    expect(el.attributes("aria-label")).toBe("O2 Assistant, locked");
    expect(tooltip(wrapper)).toBe("Ask an admin for AI access");
    await el.trigger("click");
    await flushPromises();
    const gate = document.body.querySelector('[data-test="assistant-gate-state"]');
    expect(gate?.getAttribute("data-size")).toBe("popover");
    expect(gate?.getAttribute("data-gate")).toBe("no_permission");
    // The popover is teleported to body, so it must carry the assistant roles itself (`90` §2.2).
    const ask = gate!.querySelector<HTMLElement>('[data-test="assistant-gate-ask-admin"]')!;
    expect(ask.closest("[data-assistant-surface]")).not.toBeNull();
    expect(button(wrapper).element.closest("[data-assistant-surface]")).toBeNull();
    ask.click();
    await flushPromises();
    const request = document.body.querySelector('[data-test="assistant-ask-admin"]');
    expect(request?.closest("[data-assistant-surface]")).not.toBeNull();
    expect(useLockedPanel().value).toBeNull();
    expect(openAssistant).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("opens the locked gate as a sheet below md, and Learn what it does as a dialog", async () => {
    lg.value = false;
    const { wrapper } = setup("no_permission");
    await button(wrapper).trigger("click");
    await flushPromises();
    const gate = document.body.querySelector('[data-test="assistant-gate-state"]');
    expect(gate?.getAttribute("data-gate")).toBe("no_permission");
    expect(gate?.getAttribute("data-size")).toBe("hero");
    document.body.querySelector<HTMLElement>('[data-test="assistant-gate-learn-more"]')!.click();
    await flushPromises();
    expect(gateLearnOpen.value).toBe(true);
    gateLearnOpen.value = false;
    wrapper.unmount();
  });

  it("is muted with the unavailable name when the agent is down", () => {
    const { wrapper } = setup("unhealthy");
    expect(button(wrapper).attributes("aria-label")).toBe("O2 Assistant, unavailable");
    expect(tooltip(wrapper)).toBe("O2 Assistant is unavailable right now");
  });
});

describe("AssistantHeaderButton light", () => {
  it("is a plain idle button with no aria-expanded or aria-pressed", async () => {
    const { wrapper } = setup();
    const el = button(wrapper);
    expect(el.attributes("data-state")).toBe("idle");
    expect(el.attributes("aria-label")).toBe("O2 Assistant");
    expect(el.attributes("aria-expanded")).toBeUndefined();
    expect(el.attributes("aria-pressed")).toBeUndefined();
    expect(el.attributes("data-entry")).toBe("ai-entry-header-ask");
    await el.trigger("click");
    expect(openAssistant).toHaveBeenCalledWith(
      expect.objectContaining({ entryKind: "header_button", entryVerb: "ask", intent: "open" }),
    );
  });

  it("shows open with the neutral pressed border while a container is visible", async () => {
    const { wrapper, store } = setup();
    session(store, "Checkout");
    store.open({ kind: "sidebar" }, { focus: "none" });
    await flushPromises();
    const el = button(wrapper);
    expect(el.attributes("data-state")).toBe("open");
    expect(el.attributes("aria-label")).toBe("Close O2 Assistant");
    expect(el.classes()).toContain("border-border-strong");
    expect(tooltip(wrapper)).toBe("Close O2 Assistant");
  });

  it("mutes its tooltip while a container shows, keeps the state in its name, and closes the sidebar (D1, E2)", async () => {
    const { wrapper, store } = setup();
    session(store, "Checkout");
    store.open({ kind: "sidebar" }, { focus: "none" });
    await flushPromises();
    expect(wrapper.findComponent(OTooltip).props("disabled")).toBe(true);
    expect(button(wrapper).attributes("aria-label")).toBe("Close O2 Assistant");
    openAssistant.mockClear();
    await button(wrapper).trigger("click");
    expect(store.state.shell.placement.kind).toBe("hidden");
    expect(openAssistant).not.toHaveBeenCalled();
  });

  it("opens the sidebar on a new chat when only a floating window shows (E1)", async () => {
    const { wrapper, store } = setup();
    const sid = session(store, "Checkout");
    store.state.shell.windows.push({
      sid,
      state: "open",
      geometry: { x: 0, y: 0, widthRem: 24, heightRem: 30 },
    } as never);
    await flushPromises();
    expect(button(wrapper).attributes("aria-label")).toBe("Go to O2 Assistant");
    expect(tooltip(wrapper)).toBe("Go to O2 Assistant");
    openAssistant.mockClear();
    await button(wrapper).trigger("click");
    expect(openAssistant).toHaveBeenCalledWith(
      expect.objectContaining({ container: "sidebar", thread: "new", entryKind: "header_button" }),
    );
  });

  it.each<[string, (store: any, sid: string) => void]>([
    ["running", (store, sid) => (store.state.sessions[sid].turn = { state: "responding.writing" })],
    [
      "waiting",
      (store, sid) =>
        (store.state.sessions[sid].turn = { state: "awaiting_approval", callId: "c1" }),
    ],
  ])(
    "opens a new sidebar chat over a %s floating chat, never just raising it (E1)",
    async (_n, light) => {
      const { wrapper, store } = setup();
      const sid = session(store, "Checkout");
      store.state.shell.windows.push({
        sid,
        state: "open",
        geometry: { x: 0, y: 0, widthRem: 24, heightRem: 30 },
      } as never);
      light(store, sid);
      await flushPromises();
      openAssistant.mockClear();
      await button(wrapper).trigger("click");
      expect(openAssistant).toHaveBeenCalledWith(
        expect.objectContaining({ container: "sidebar", thread: "new" }),
      );
    },
  );

  it("closes an open sidebar even while another, hidden chat is lit (E2)", async () => {
    const { wrapper, store } = setup();
    const lit = session(store, "Elsewhere");
    store.state.sessions[lit].turn = { state: "responding.writing" };
    const shown = session(store, "Checkout");
    store.setActive(shown);
    store.open({ kind: "sidebar" }, { focus: "none" });
    await flushPromises();
    openAssistant.mockClear();
    await button(wrapper).trigger("click");
    expect(store.state.shell.placement.kind).toBe("hidden");
    expect(openAssistant).not.toHaveBeenCalled();
  });

  it.each<[string, (store: any, sid: string) => void]>([
    [
      "needs you",
      (store, sid) =>
        (store.state.sessions[sid].turn = { state: "awaiting_approval", callId: "c1" }),
    ],
    [
      "answering",
      (store, sid) => (store.state.sessions[sid].turn = { state: "responding.writing" }),
    ],
    [
      "unread",
      (store, sid) => {
        store.state.sessions[sid].turn = { state: "done", saved: "local" };
        store.state.sessions[sid].unread = true;
      },
    ],
  ])("looks and reads like idle while a chat is %s", async (_n, light) => {
    const { wrapper, store } = setup();
    const sid = session(store, "Hidden");
    store.setActive(null);
    await flushPromises();
    const idle = button(wrapper).classes();
    light(store, sid);
    await flushPromises();
    const el = button(wrapper);
    expect(el.attributes("aria-label")).toBe("O2 Assistant");
    expect(tooltip(wrapper)).toBe("O2 Assistant");
    expect(el.attributes("data-state")).toBe("idle");
    expect(el.classes()).toEqual(idle);
  });

  it("opens the container on the lit session", async () => {
    const { wrapper, store } = setup();
    const a = session(store, "Lit");
    store.setActive(null);
    session(store, "Other");
    store.state.sessions[a].unread = true;
    store.state.sessions[a].turn = { state: "done", saved: "local" };
    await flushPromises();
    await button(wrapper).trigger("click");
    expect(store.state.shell.activeSid).toBe(a);
    expect(openAssistant).toHaveBeenCalledWith(expect.objectContaining({ thread: "current" }));
  });

  it("brings a dismissed launcher back when it opens the assistant", async () => {
    const { wrapper, store } = setup();
    setLauncherDismissed(store.state.userOrgKey, true);
    expect(isLauncherDismissed(store.state.userOrgKey)).toBe(true);
    await button(wrapper).trigger("click");
    expect(isLauncherDismissed(store.state.userOrgKey)).toBe(false);
  });

  it("fires ai_status_light once per change", async () => {
    const { store } = setup();
    const a = session(store, "x");
    store.state.sessions[a].turn = { state: "queued" };
    await flushPromises();
    store.state.sessions[a].turn = { state: "connecting" };
    await flushPromises();
    expect(track.mock.calls.filter(([name]) => name === "ai_status_light")).toEqual([
      ["ai_status_light", { state: "working" }],
    ]);
  });
});

describe("AssistantHeaderButton announcements and toasts", () => {
  const region = (wrapper: any) =>
    wrapper.get('[data-test="assistant-header-status-region"]').text();

  it("speaks for a hidden session and stays quiet for the one a container shows", async () => {
    const { wrapper, store } = setup();
    const a = session(store, "Hidden");
    store.state.sessions[a].turn = { state: "awaiting_approval", callId: "c" };
    await flushPromises();
    expect(region(wrapper)).toBe("O2 Assistant needs you: Hidden.");
    document.body.innerHTML = "";
    const shown = setup();
    const b = session(shown.store, "Shown");
    shown.store.open({ kind: "sidebar" }, { focus: "none" });
    shown.store.state.sessions[b].turn = { state: "awaiting_approval", callId: "c" };
    await flushPromises();
    expect(region(shown.wrapper)).toBe("");
  });

  it("raises one silent, masked toast per hidden turn", async () => {
    const { store } = setup();
    const a = session(store, "Quiet");
    store.state.sessions[a].turn = { state: "done", saved: "local" };
    store.state.sessions[a].unread = true;
    await flushPromises();
    store.state.sessions[a].turnMeta.lastSeq = 3;
    store.state.sessions[a].ui.unseen = 1;
    await flushPromises();
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Answer ready · Quiet",
        mask: true,
        live: "off",
        timeout: 6000,
      }),
    );
    toast.mock.calls[0][0].action.handler();
    expect(track).toHaveBeenCalledWith("ai_toast", { kind: "ready", action: "open" });
    expect(openAssistant).toHaveBeenCalledWith(expect.objectContaining({ entryKind: "toast" }));
  });

  it("tells of a chat that failed out of view once, with Open", async () => {
    const { store } = setup();
    const sid = session(store, "Latency alert draft");
    store.state.sessions[sid].turn = { state: "failed" } as never;
    store.state.sessions[sid].unread = true;
    await flushPromises();
    store.state.sessions[sid].turnMeta.lastSeq = 3;
    await flushPromises();
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Latency alert draft failed" }),
    );
  });

  it("raises no toast for an ephemeral helper or analysis turn", async () => {
    const { store } = setup();
    const sid = store.createSession({
      origin: { entryKind: "object_verb", objectKind: "incident", container: "rca" },
      ephemeral: true,
    });
    store.state.sessions[sid].turnMeta.turnId = "turn-rca";
    store.state.sessions[sid].turn = { state: "done", saved: "local" };
    store.state.sessions[sid].unread = true;
    await flushPromises();
    expect(toast).not.toHaveBeenCalled();
  });

  it("raises no toast for the session a container shows", async () => {
    const { store } = setup();
    const a = session(store, "Visible");
    store.open({ kind: "sidebar" }, { focus: "none" });
    store.state.sessions[a].turn = { state: "awaiting_approval", callId: "c" };
    await flushPromises();
    expect(toast).not.toHaveBeenCalled();
  });
});

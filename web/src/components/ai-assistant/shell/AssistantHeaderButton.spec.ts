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

import type { AssistantCapability, GateCode } from "@/composables/assistant";
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
  });

  it("reserves the button's phone-sized slot while loading", () => {
    const classes = setup("loading")
      .wrapper.get('[data-test="assistant-header-skeleton"]')
      .classes();
    expect(classes).toEqual(
      expect.arrayContaining(["size-7.5", "max-md:size-11", "pointer-coarse:size-11"]),
    );
  });

  it("is locked on G2 and opens the locked sidebar", async () => {
    const { wrapper } = setup("no_permission");
    const el = button(wrapper);
    expect(el.attributes("aria-label")).toBe("O2 Assistant, locked");
    expect(tooltip(wrapper)).toBe("Ask an admin for AI access");
    await el.trigger("click");
    expect(useLockedPanel().value?.invoker).toBe(el.element);
    expect(openAssistant).not.toHaveBeenCalled();
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
    store.open({ kind: "sidebar", mode: "pinned" }, { focus: "none" });
    await flushPromises();
    const el = button(wrapper);
    expect(el.attributes("data-state")).toBe("open");
    expect(el.attributes("aria-label")).toBe("O2 Assistant, open");
    expect(el.classes()).toContain("border-border-strong");
    expect(tooltip(wrapper)).toBe("O2 Assistant · Open");
  });

  it("shows working with the title, and a count for more than one", async () => {
    const { wrapper, store } = setup();
    const a = session(store, "Checkout 5xx");
    store.state.sessions[a].turn = { state: "responding.writing" };
    await flushPromises();
    expect(button(wrapper).attributes("data-state")).toBe("working");
    expect(button(wrapper).attributes("aria-label")).toBe("O2 Assistant, answering");
    expect(tooltip(wrapper)).toBe("Answering: Checkout 5xx");
    expect(
      wrapper.find('[data-test="assistant-header-status-light"]').attributes("data-shape"),
    ).toBe("ring");
    store.setActive(null);
    const b = session(store, "Payments");
    store.state.sessions[b].turn = { state: "queued" };
    await flushPromises();
    expect(tooltip(wrapper)).toBe("2 answers running");
  });

  it("names another tab's answer by its history row, else claims no title", async () => {
    const remote = { state: "working" as const, sid: "0190ffff-c3d4-7e5f-8a9b-000000000001" };
    const unknown = setup("available", {}, remote);
    await flushPromises();
    expect(button(unknown.wrapper).attributes("data-state")).toBe("working");
    expect(tooltip(unknown.wrapper)).toBe("O2 Assistant, answering");
    unknown.wrapper.unmount();
    const known = setup("available", { persistence: false }, remote);
    known.store.setIdentity({ userOrgKey: "k1", org: "default" });
    fake.current.db.rows.set(1, {
      id: 1,
      timestamp: new Date().toISOString(),
      title: "Remote chat",
      messages: [{ role: "user", content: raw("q") }],
      sessionId: remote.sid,
      userOrgKey: "k1",
    });
    fake.current.history.ensureLoaded();
    await flushPromises();
    expect(tooltip(known.wrapper)).toBe("Answering: Remote chat");
  });

  it("shows no count badge for another tab's waiting chat", async () => {
    const { wrapper } = setup("available", {}, { state: "needs_you", sid: "elsewhere" });
    await flushPromises();
    expect(button(wrapper).attributes("data-state")).toBe("needs_you");
    expect(wrapper.find('[data-test="assistant-header-status-light"]').text()).toBe("");
  });

  it("ranks needs you above working and shows the count", async () => {
    const { wrapper, store } = setup();
    const a = session(store, "Running");
    store.state.sessions[a].turn = { state: "queued" };
    store.setActive(null);
    const b = session(store, "Delete alerts");
    store.state.sessions[b].turn = { state: "awaiting_approval", callId: "c1" };
    await flushPromises();
    expect(button(wrapper).attributes("data-state")).toBe("needs_you");
    expect(button(wrapper).attributes("aria-label")).toBe("O2 Assistant, needs you, 1 waiting");
    expect(tooltip(wrapper)).toBe("Waiting for your approval");
    expect(wrapper.find('[data-test="assistant-header-status-light"]').text()).toBe("1");
  });

  it("names the visible needs-you count so the label matches the content", async () => {
    const { wrapper, store } = setup();
    for (const title of ["Delete alerts", "Mute monitors"]) {
      const sid = session(store, title);
      store.state.sessions[sid].turn = { state: "awaiting_approval", callId: title };
    }
    await flushPromises();
    const count = wrapper.get('[data-test="assistant-header-status-light"]').text();
    expect(count).toBe("2");
    expect(button(wrapper).attributes("aria-label")).toBe(
      `O2 Assistant, needs you, ${count} waiting`,
    );
  });

  it("uses the one consent key when the decision is about paid usage", async () => {
    const { wrapper, store } = setup();
    const a = session(store, "Costly");
    store.state.sessions[a].turn = { state: "awaiting_consent" };
    await flushPromises();
    expect(tooltip(wrapper)).toBe("Waiting for your decision on paid usage");
  });

  it("shows an unread answer, ready or failed, until a container shows it", async () => {
    const { wrapper, store } = setup();
    const a = session(store, "Latency");
    store.state.sessions[a].turn = { state: "done", saved: "local" };
    store.state.sessions[a].unread = true;
    await flushPromises();
    expect(button(wrapper).attributes("aria-label")).toBe("O2 Assistant, answer ready");
    expect(tooltip(wrapper)).toBe("Answer ready: Latency");
    store.state.sessions[a].turn = {
      state: "failed",
      error: { code: "unknown", phase: "post_admission", retryable: true, action: "retry" },
    };
    await flushPromises();
    expect(button(wrapper).attributes("aria-label")).toBe("O2 Assistant, last answer failed");
    expect(
      wrapper.find('[data-test="assistant-header-status-light"]').attributes("data-shape"),
    ).toBe("glyph");
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
    shown.store.open({ kind: "sidebar", mode: "pinned" }, { focus: "none" });
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
    store.open({ kind: "sidebar", mode: "pinned" }, { focus: "none" });
    store.state.sessions[a].turn = { state: "awaiting_approval", callId: "c" };
    await flushPromises();
    expect(toast).not.toHaveBeenCalled();
  });
});

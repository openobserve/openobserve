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
import { computed, ref } from "vue";

import type { AssistantCapability, GateCode, Starter } from "@/composables/assistant";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { raw } from "@/types/i18n";

import { fakeAssistant, fakeRouter, fakeVuex } from "../__tests__/fakeAssistant";
import AssistantShell, {
  SHELL_ROUTE_CONTEXT,
  type AssistantShellProps,
  type ShellRouteState,
} from "./AssistantShell.vue";
import { closeLockedPanel, lockedPanelMoved, openLockedPanel, useLockedPanel } from "./lockedPanel";

const STARTER: Starter = {
  id: "s1",
  kind: "page",
  label: raw("Why did errors spike?"),
  prompt: "Why did errors spike?",
  chips: [],
  dataTest: "assistant-starter-0",
};

const { fake, starters } = vi.hoisted(() => ({
  fake: { current: null as any },
  starters: vi.fn(),
}));

vi.mock("@/composables/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/assistant")>()),
  useAssistantStore: () => fake.current.store,
  useAssistantCapability: () => fake.current.handle,
  useAssistantStarters: (...args: unknown[]) => {
    starters(...args);
    return {
      starters: computed(() => [STARTER]),
      loading: computed(() => false),
      scope: computed(() => ({ org: "default", streamCount: 3, timeRange: null, canWrite: "yes" })),
    };
  },
}));
vi.mock("@/services/assistantAnalytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/assistantAnalytics")>()),
  trackAssistant: vi.fn(),
}));

function setup(
  props: Partial<AssistantShellProps> = {},
  gate: GateCode = "available",
  over: Partial<AssistantCapability> = {},
  routed?: ShellRouteState,
) {
  fake.current = fakeAssistant(gate, over);
  const router = fakeRouter();
  const routeState = ref<ShellRouteState>(routed ?? "idle");
  const newChat = vi.fn();
  const wrapper = mount(AssistantShell, {
    props: { placement: "sidebar", ...props },
    slots: {
      transcript: '<div data-test="assistant-transcript">transcript</div>',
      composer: '<div data-test="assistant-composer">composer</div>',
    },
    global: {
      plugins: [router, fakeVuex()],
      provide: routed ? { [SHELL_ROUTE_CONTEXT as symbol]: { state: routeState, newChat } } : {},
    },
    attachTo: document.body,
  });
  return {
    wrapper,
    router,
    store: fake.current.store,
    capability: fake.current.capability,
    newChat,
    routeState,
  };
}

const root = (wrapper: any) => wrapper.get("[data-assistant-root]");

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  starters.mockClear();
});

afterEach(() => {
  document.body.innerHTML = "";
  closeLockedPanel();
});

describe("AssistantShell landmark", () => {
  it("is an aside named O2 Assistant in the sidebar, masked for session replay", () => {
    const el = root(setup().wrapper);
    expect(el.element.tagName).toBe("ASIDE");
    expect(el.attributes("aria-label")).toBe("O2 Assistant");
    expect(el.attributes("data-dd-privacy")).toBe("mask");
    expect(el.attributes("data-test")).toBe("assistant-shell-sidebar");
    expect(el.attributes("data-placement")).toBe("sidebar");
  });

  it("is a named region in the full view and no landmark inside the sheet's dialog", () => {
    const full = root(setup({ placement: "full", density: "roomy" }).wrapper);
    expect(full.element.tagName).toBe("SECTION");
    expect(full.attributes("role")).toBe("region");
    expect(full.attributes("aria-label")).toBe("O2 Assistant");
    document.body.innerHTML = "";
    const sheet = root(setup({ sheet: true }).wrapper);
    expect(sheet.element.tagName).toBe("DIV");
    expect(sheet.attributes("aria-label")).toBeUndefined();
  });
});

describe("AssistantShell states", () => {
  it("performs no store write on mount", () => {
    fake.current = fakeAssistant();
    const before = JSON.stringify(fake.current.store.state);
    const wrapper = mount(AssistantShell, {
      props: { placement: "sidebar" },
      global: { plugins: [fakeRouter(), fakeVuex()] },
    });
    expect(JSON.stringify(fake.current.store.state)).toBe(before);
    wrapper.unmount();
  });

  it("hosts the inline gate on G2 with close and the full-view move, no composer or welcome", () => {
    openLockedPanel(null);
    const { wrapper } = setup({}, "no_permission");
    expect(root(wrapper).attributes("data-state")).toBe("gate");
    expect(wrapper.find('[data-gate="no_permission"][data-size="inline"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="assistant-shell-close"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="assistant-shell-open-in-full-view"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="assistant-shell-menu"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="assistant-composer"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="assistant-welcome"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="assistant-shell-title"]').exists()).toBe(false);
    expect(starters).not.toHaveBeenCalled();
  });

  it("moves the locked sidebar to the full view's hero and closes the panel", async () => {
    openLockedPanel(null);
    const { wrapper, router } = setup({}, "no_permission");
    await wrapper.get('[data-test="assistant-shell-open-in-full-view"]').trigger("click");
    await flushPromises();
    expect(useLockedPanel().value).toBeNull();
    expect(lockedPanelMoved()).toBe(true);
    expect(router.currentRoute.value.name).toBe("assistant");
  });

  it("clears the locked panel whatever × closes", async () => {
    const { wrapper, store } = setup();
    openLockedPanel(null);
    store.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
    });
    store.open({ kind: "sidebar", mode: "pinned" }, { focus: "none" });
    await wrapper.get('[data-test="assistant-shell-close"]').trigger("click");
    expect(useLockedPanel().value).toBeNull();
    expect(store.state.shell.placement.kind).toBe("hidden");
  });

  it("says why when the user opens the locked sidebar", async () => {
    const { wrapper } = setup({}, "no_permission");
    openLockedPanel(null);
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-status-region"]').text()).toBe(
      "O2 Assistant isn't available to your role.",
    );
  });

  it("shows three message-shaped skeleton rows while a chat loads", () => {
    const { wrapper } = setup({ placement: "full" }, "available", {}, "loading");
    const loading = wrapper.get('[data-test="assistant-shell-loading"]');
    expect(loading.findAllComponents(OSkeleton)).toHaveLength(3);
    expect(loading.text()).toContain("Loading your chat…");
    expect(wrapper.find('[data-test="assistant-welcome"]').exists()).toBe(false);
  });

  it("offers a new chat when the routed chat isn't available", async () => {
    const { wrapper, newChat } = setup({ placement: "full" }, "available", {}, "not_found");
    const empty = wrapper.get('[data-test="assistant-shell-not-found"]');
    expect(empty.text()).toContain("This chat isn't available");
    await empty.get("button").trigger("click");
    expect(newChat).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[data-test="assistant-composer"]').exists()).toBe(false);
  });

  it("shows the welcome for an empty session and stages a starter without sending", async () => {
    const { wrapper, store } = setup();
    expect(root(wrapper).attributes("data-state")).toBe("empty");
    expect(wrapper.find('[data-test="assistant-welcome"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="assistant-composer"]').exists()).toBe(true);
    const send = vi.spyOn(store, "send");
    await wrapper.get('[data-test="assistant-starter-0"]').trigger("click");
    const sid = store.state.shell.activeSid;
    expect(store.state.sessions[sid].composer.text).toBe("Why did errors spike?");
    expect(send).not.toHaveBeenCalled();
  });

  it("renders the transcript slot once messages exist", async () => {
    const { wrapper, store } = setup();
    const sid = store.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
    });
    store.state.sessions[sid].messages.push({ role: "user", content: raw("hi") });
    await flushPromises();
    expect(root(wrapper).attributes("data-state")).toBe("conversation");
    expect(wrapper.find('[data-test="assistant-transcript"]').exists()).toBe(true);
  });

  it("keeps a live composer with the unknown-role notice", () => {
    const { wrapper } = setup({}, "available", { canChat: "unknown" });
    expect(wrapper.get('[data-test="assistant-gate-unknown-notice"]').text()).toBe(
      "Your role may not include O2 Assistant. If sending fails, ask an admin.",
    );
    expect(wrapper.find('[data-test="assistant-composer"]').exists()).toBe(true);
  });

  it("keeps the composer and offers Try again when the agent is down without B-06", async () => {
    const { wrapper, store } = setup({}, "unhealthy");
    const sid = store.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
    });
    const retry = vi.spyOn(store, "retry").mockResolvedValue({ state: "done", saved: "local" });
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-shell-unhealthy-notice"]').text()).toContain(
      "O2 Assistant isn't responding. Your last message wasn't answered.",
    );
    expect(wrapper.find('[data-test="assistant-composer"]').exists()).toBe(true);
    await wrapper.get('[data-test="assistant-shell-unhealthy-notice-retry"]').trigger("click");
    expect(retry).toHaveBeenCalledWith(sid);
  });

  it("swaps the composer for the gate only when B-06 reports the agent down", () => {
    const { wrapper } = setup({}, "unhealthy", { source: "capabilities" });
    expect(wrapper.find('[data-test="assistant-shell-unhealthy-notice"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="assistant-composer"]').exists()).toBe(false);
    expect(wrapper.find('[data-gate="unhealthy"][data-size="inline"]').exists()).toBe(true);
  });
});

describe("AssistantShell chrome and focus", () => {
  it("offers full view and the layout menu in the sidebar, close everywhere but docked", () => {
    const { wrapper } = setup();
    expect(wrapper.find('[data-test="assistant-shell-open-in-full-view"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="assistant-shell-menu"]').exists()).toBe(true);
    expect(wrapper.get('[data-test="assistant-shell-close"]').attributes("aria-label")).toBe(
      "Close O2 Assistant",
    );
    document.body.innerHTML = "";
    const sheet = setup({ sheet: true }).wrapper;
    expect(sheet.find('[data-test="assistant-shell-open-in-full-view"]').exists()).toBe(false);
    document.body.innerHTML = "";
    expect(
      setup({ placement: "docked" }).wrapper.find('[data-test="assistant-shell-close"]').exists(),
    ).toBe(false);
  });

  it("closes through the store from ×, keeping the session", async () => {
    const { wrapper, store } = setup();
    store.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
    });
    store.open({ kind: "sidebar", mode: "pinned" }, { focus: "none" });
    const sid = store.state.shell.activeSid;
    await wrapper.get('[data-test="assistant-shell-close"]').trigger("click");
    expect(store.state.shell.placement.kind).toBe("hidden");
    expect(store.state.sessions[sid]).toBeDefined();
  });

  it("moves focus into the visible container once on an explicit open and announces it", async () => {
    const { wrapper, store } = setup();
    store.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
    });
    store.open({ kind: "sidebar", mode: "pinned" }, { focus: "composer" });
    await flushPromises();
    expect(document.activeElement).toBe(root(wrapper).element);
    expect(wrapper.get('[data-test="assistant-status-region"]').text()).toBe(
      "O2 Assistant opened.",
    );
  });

  it("says nothing on a silent open", async () => {
    const { wrapper, store } = setup();
    store.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
    });
    store.open({ kind: "sidebar", mode: "pinned" }, { focus: "none" });
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-status-region"]').text()).toBe("");
  });

  it("speaks the store's turn announcements for the session it shows", async () => {
    const { wrapper, store } = setup();
    const sid = store.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
    });
    store.open({ kind: "sidebar", mode: "pinned" }, { focus: "none" });
    store.announce(sid, "assistant.turn.done");
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-status-region"]').text()).toBe("Done");
  });
});

describe("AssistantShell rows ⑤–⑦ (WP-05)", () => {
  function live(props: Partial<AssistantShellProps> = {}) {
    fake.current = fakeAssistant();
    const wrapper = mount(AssistantShell, {
      props: { placement: "sidebar", ...props },
      global: { plugins: [fakeRouter(), fakeVuex()] },
      attachTo: document.body,
    });
    return { wrapper, store: fake.current.store };
  }

  it("fills the tray, the composer and the disclosure line in their rows", async () => {
    const { wrapper } = live();
    await flushPromises();
    expect(wrapper.find('[data-test="assistant-context-tray"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="assistant-composer-root"]').exists()).toBe(true);
    expect(wrapper.get('[data-test="assistant-context-disclosure"]').text()).toBe(
      "Sends the chips and this page's time range",
    );
  });

  it("puts focus in the composer textbox at the end on an explicit open", async () => {
    const { wrapper, store } = live();
    const sid = store.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
    });
    store.setDraft(sid, { text: "half" });
    store.open({ kind: "sidebar", mode: "pinned" }, { focus: "composer" });
    await flushPromises();
    const textarea = wrapper.get<HTMLTextAreaElement>(
      '[data-test="assistant-composer-field"]',
    ).element;
    expect(document.activeElement).toBe(textarea);
    expect(textarea.selectionStart).toBe(4);
  });

  it("offers the first starter as the composer's ghost", async () => {
    const { wrapper, store } = live();
    store.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
    });
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-ghost"]').text()).toBe(
      'Try: "Why did errors spike?"',
    );
  });

  it("keeps chat A's draft on New chat, says so, and moves it only on Bring it here (CT-06 AC 5, S7, V6)", async () => {
    const { wrapper, store } = live();
    const first = store.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
    });
    store.setDraft(first, { text: "keep me" });
    const vm = wrapper.vm as unknown as { $: { setupState: { newChat(): void } } };
    vm.$.setupState.newChat();
    await flushPromises();
    const next = store.state.shell.activeSid;
    expect(next).not.toBe(first);
    expect(wrapper.get('[data-test="assistant-composer-cleared"]').text()).toContain(
      "New chat. Your draft stayed in the previous chat",
    );
    expect(store.state.sessions[first].composer.text).toBe("keep me");
    expect(store.state.sessions[next].composer.text).toBe("");
    const bring = wrapper.get('[data-test="assistant-composer-undo"]');
    expect(bring.text()).toBe("Bring it here");
    await bring.trigger("click");
    expect(store.state.sessions[next].composer.text).toBe("keep me");
    expect(store.state.sessions[first].composer.text).toBe("");
  });

  it("ends the Bring it here offer on any edit in the new chat, so it never overwrites a choice (V6)", async () => {
    const { wrapper, store } = live();
    const first = store.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
    });
    store.setDraft(first, { text: "keep me", timeOverride: { from: 0, to: 1, period: "7d" } });
    const vm = wrapper.vm as unknown as { $: { setupState: { newChat(): void } } };
    vm.$.setupState.newChat();
    await flushPromises();
    const next = store.state.shell.activeSid!;
    expect(wrapper.find('[data-test="assistant-composer-cleared"]').exists()).toBe(true);
    store.setTimeOverride(next, { from: 0, to: 1, period: "1h" });
    await flushPromises();
    expect(wrapper.find('[data-test="assistant-composer-cleared"]').exists()).toBe(false);
    expect(store.state.sessions[next].composer.timeOverride?.period).toBe("1h");
  });

  it("shows the fuller disclosure once on the first attachment, with a named dismiss (CT-04 AC 5)", async () => {
    const { wrapper, store } = live();
    const sid = store.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
    });
    store.addChip(sid, {
      id: "r1",
      kind: "log_row",
      label: raw("Log row"),
      sizeBytes: 3,
      provenance: "door",
      sent: "serialized",
    });
    await flushPromises();
    const banner = wrapper.get('[data-test="assistant-context-disclosure-banner"]');
    expect(banner.text()).toContain(
      "Attached data is sent to the assistant and saved with this chat.",
    );
    const dismiss = wrapper.get('[data-test="assistant-context-disclosure-dismiss"]');
    expect(dismiss.attributes("aria-label")).toBe("Dismiss the data notice");
    await dismiss.trigger("click");
    expect(wrapper.find('[data-test="assistant-context-disclosure-banner"]').exists()).toBe(false);
    expect(JSON.parse(localStorage.getItem("o2.assistant.hints:k1") ?? "{}")).toEqual({
      disclosure: true,
    });
  });
});

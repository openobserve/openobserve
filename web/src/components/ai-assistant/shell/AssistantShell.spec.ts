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
import type { HistoryDeps } from "@/composables/assistant/useAssistantHistory";
import { raw } from "@/types/i18n";

import { fakeAssistant, fakeRouter, fakeVuex, hintBus } from "../__tests__/fakeAssistant";
import AssistantShell, {
  SHELL_ROUTE_CONTEXT,
  STEP_ANNOUNCE_MS,
  type AssistantShellProps,
  type ShellRouteState,
} from "./AssistantShell.vue";
import { closeLockedPanel, lockedPanelMoved, openLockedPanel, useLockedPanel } from "./lockedPanel";
import { setRuntimeHandle } from "@/composables/assistant/runtimeHandle";

const STARTER: Starter = {
  id: "s1",
  kind: "page",
  label: raw("Why did errors spike?"),
  prompt: "Why did errors spike?",
  chips: [],
  dataTest: "assistant-starter-0",
};

const { fake, starters, creditUsage } = vi.hoisted(() => ({
  fake: { current: null as any },
  starters: vi.fn(),
  creditUsage: { current: null as null | Record<string, unknown> },
}));

vi.mock("@/composables/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/assistant")>()),
  useAssistantStore: () => fake.current.store,
  useAssistantHistory: () => fake.current.history,
  useAssistantCapability: () => fake.current.handle,
  useAssistantCredits: () => ({
    usage: computed(() => creditUsage.current),
    overage: computed(() => null),
    status: computed(() => (creditUsage.current ? "ready" : "error")),
    canManage: computed(() => true),
    refusal: computed(() => ({})),
    retry: vi.fn(),
  }),
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
  historyDeps: Partial<HistoryDeps> = {},
) {
  fake.current = fakeAssistant(gate, over, {}, 80, false, historyDeps);
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

  it("holds Try again under another tab's approval lock and says why when pressed", async () => {
    setRuntimeHandle({
      lifecycle: {
        signedOutElsewhere: computed(() => false),
        otherAccountSignedIn: computed(() => false),
        turnLock: () => "approval_elsewhere",
      },
    } as never);
    const { wrapper, store } = setup({}, "unhealthy");
    store.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
    });
    const retry = vi.spyOn(store, "retry");
    await flushPromises();
    const button = wrapper.get('[data-test="assistant-shell-unhealthy-notice-retry"]');
    expect(button.attributes("aria-disabled")).toBe("true");
    await button.trigger("click");
    await flushPromises();
    expect(retry).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("Another tab is waiting for your approval on this chat.");
    setRuntimeHandle(null);
  });

  it("swaps the composer for the gate only when B-06 reports the agent down", () => {
    const { wrapper } = setup({}, "unhealthy", { source: "capabilities" });
    expect(wrapper.find('[data-test="assistant-shell-unhealthy-notice"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="assistant-composer"]').exists()).toBe(false);
    expect(wrapper.find('[data-gate="unhealthy"][data-size="inline"]').exists()).toBe(true);
  });
});

describe("AssistantShell chrome and focus", () => {
  it("offers full view and the layout menu in the sidebar, and close in every container", () => {
    const { wrapper } = setup();
    expect(wrapper.find('[data-test="assistant-shell-open-in-full-view"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="assistant-thread-menu"]').exists()).toBe(true);
    expect(wrapper.get('[data-test="assistant-shell-close"]').attributes("aria-label")).toBe(
      "Close O2 Assistant",
    );
    document.body.innerHTML = "";
    const sheet = setup({ sheet: true }).wrapper;
    expect(sheet.find('[data-test="assistant-shell-open-in-full-view"]').exists()).toBe(false);
    document.body.innerHTML = "";
    const docked = setup({ placement: "docked" }).wrapper;
    expect(docked.find('[data-test="assistant-shell-close"]').exists()).toBe(true);
    expect(docked.get('[data-test="assistant-shell-chrome"]').classes()).toContain("h-15");
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

describe("AssistantShell mounted after the open", () => {
  const origin = { entryKind: "header_button", objectKind: "none", container: "sidebar" } as const;
  const mountShell = () =>
    mount(AssistantShell, {
      props: { placement: "sidebar" },
      global: { plugins: [fakeRouter(), fakeVuex()] },
      attachTo: document.body,
    });
  const pageButton = (name: string) => {
    const el = document.createElement("button");
    el.dataset.test = name;
    document.body.appendChild(el);
    return el;
  };
  const openFrom = (invoker: HTMLElement | null, focus: "composer" | "none" = "composer") => {
    invoker?.focus();
    fake.current!.store.open({ kind: "sidebar", mode: "pinned" }, { focus });
  };

  beforeEach(() => {
    fake.current = fakeAssistant();
    fake.current.store.createSession({ origin });
  });

  it("takes the focus an open asked for before the host loaded, and announces it", async () => {
    openFrom(pageButton("header"));
    const wrapper = mountShell();
    await flushPromises();
    expect(document.activeElement).toBe(
      wrapper.get('[data-test="assistant-composer-field"]').element,
    );
    expect(wrapper.get('[data-test="assistant-status-region"]').text()).toBe(
      "O2 Assistant opened.",
    );
  });

  it("leaves focus on a page control the reader moved to while the host loaded", async () => {
    openFrom(pageButton("header"));
    const other = pageButton("other");
    other.focus();
    const wrapper = mountShell();
    await flushPromises();
    expect(document.activeElement).toBe(other);
    expect(wrapper.get('[data-test="assistant-status-region"]').text()).toBe("");
  });

  it("retires a request it turned down, so a later remount never replays it", async () => {
    const header = pageButton("header");
    openFrom(header);
    pageButton("other").focus();
    const first = mountShell();
    await flushPromises();
    expect(first.get('[data-test="assistant-status-region"]').text()).toBe("");
    first.unmount();
    header.focus();
    const again = mountShell();
    await flushPromises();
    expect(document.activeElement).toBe(header);
    expect(again.get('[data-test="assistant-status-region"]').text()).toBe("");
  });

  it("retires a request turned down during the mount tick as well", async () => {
    const header = pageButton("header");
    openFrom(header);
    const first = mountShell();
    pageButton("other").focus();
    await flushPromises();
    first.unmount();
    header.focus();
    const again = mountShell();
    await flushPromises();
    expect(document.activeElement).toBe(header);
    expect(again.get('[data-test="assistant-status-region"]').text()).toBe("");
  });

  it("drops a request that a later silent open superseded", async () => {
    openFrom(null);
    openFrom(null, "none");
    const wrapper = mountShell();
    await flushPromises();
    expect(wrapper.element.contains(document.activeElement)).toBe(false);
    expect(wrapper.get('[data-test="assistant-status-region"]').text()).toBe("");
  });

  it("drops the request when focus moves away during the mount tick", async () => {
    const header = pageButton("header");
    openFrom(header);
    const other = pageButton("other");
    const wrapper = mountShell();
    other.focus();
    await flushPromises();
    expect(document.activeElement).toBe(other);
    expect(wrapper.get('[data-test="assistant-status-region"]').text()).toBe("");
  });

  it("never serves the same request again when the shell remounts", async () => {
    openFrom(null);
    mountShell().unmount();
    await flushPromises();
    const outside = pageButton("outside");
    outside.focus();
    const again = mountShell();
    await flushPromises();
    expect(document.activeElement).toBe(outside);
    expect(again.get('[data-test="assistant-status-region"]').text()).toBe("");
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

describe("WP-06 conversation wiring", () => {
  function live(
    turn: Record<string, unknown>,
    messages: unknown[] = [],
    before: (store: any) => void = () => undefined,
  ) {
    fake.current = fakeAssistant();
    const store = fake.current.store;
    before(store);
    const sid = store.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
    });
    store.open({ kind: "sidebar", mode: "pinned" }, { sid, focus: "none" });
    store.state.sessions[sid].messages.push(...(messages as never[]));
    store.state.sessions[sid].turn = turn as never;
    const wrapper = mount(AssistantShell, {
      props: { placement: "sidebar" },
      slots: { composer: '<div data-test="assistant-composer">composer</div>' },
      global: {
        plugins: [
          fakeRouter([{ path: "/close-tab", name: "closeTab", component: {} }]),
          fakeVuex(),
        ],
      },
      attachTo: document.body,
    });
    return { wrapper, store, sid };
  }

  const MESSAGES = [
    { role: "user", content: raw("why 5xx?"), sentAt: 0, turnId: "t1" },
    {
      role: "assistant",
      content: raw("Because."),
      contentBlocks: [{ type: "text", text: "Because." }],
    },
  ];

  it("renders the transcript in ③ and Go to answer in the strip after a finished answer (X-28)", async () => {
    const { wrapper } = live({ state: "done", saved: "server" }, MESSAGES);
    await flushPromises();
    expect(wrapper.find('section[role="log"]').exists()).toBe(true);
    await wrapper.get('[data-test="assistant-strip-go-to-answer"]').trigger("click");
    expect(document.activeElement?.getAttribute("data-test")).toBe("assistant-answer-t1");
  });

  it("offers Jump to latest with the unseen count once following stops (EB-11)", async () => {
    const { wrapper, store, sid } = live({ state: "responding.writing" }, MESSAGES);
    store.setFollow(sid, false);
    store.state.sessions[sid].ui.unseen = 2;
    await flushPromises();
    const jump = wrapper.get('[data-test="assistant-scroll-latest"]');
    expect(jump.text()).toBe("Jump to latest · 2 new");
    expect(jump.attributes("aria-label")).toBe("Jump to latest, 2 new");
    await jump.trigger("click");
    expect(store.state.sessions[sid].ui.follow).toBe(true);
  });

  it("renders a refusal above the composer, never in the log (`30` §4.2)", async () => {
    const error = { code: "turn_limit", phase: "pre_admission", retryable: true, action: "retry" };
    let retry!: ReturnType<typeof vi.fn>;
    const { wrapper, sid } = live({ state: "refused", error }, [], (store) => {
      retry = vi
        .spyOn(store, "retry")
        .mockResolvedValue({ state: "done", saved: "server" }) as never;
      vi.spyOn(store, "canRetry").mockReturnValue(true);
    });
    await flushPromises();
    const lower = wrapper.get('[data-test="assistant-shell-lower"]');
    const outcome = lower.get('[data-test="assistant-turn-outcome"]');
    expect(outcome.attributes("data-kind")).toBe("refused");
    expect(wrapper.find('section[role="log"] [data-test="assistant-turn-outcome"]').exists()).toBe(
      false,
    );
    await outcome.get('[data-test="assistant-turn-outcome-action"]').trigger("click");
    expect(retry).toHaveBeenCalledWith(sid);
  });

  it("names the action in the failure announcement (`95` §2.2)", async () => {
    const error = {
      code: "agent_unavailable",
      phase: "post_admission",
      retryable: true,
      action: "retry",
    };
    const { wrapper, store, sid } = live({ state: "failed", error }, MESSAGES);
    await flushPromises();
    store.announce(sid, "assistant.error.agent_unavailable.title");
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-status-region"]').text()).toBe(
      "Failed. The assistant service didn't respond. Retry available.",
    );
  });

  const RATE_LIMITED = {
    code: "rate_limited",
    phase: "pre_admission",
    retryable: true,
    action: "retry",
    retryAfterMs: 30_000,
  };

  it("names the wait, not an available Retry, while retry_after runs (V5)", async () => {
    const { wrapper, store, sid } = live({ state: "refused", error: RATE_LIMITED });
    store.state.sessions[sid].turnMeta.endedAt = Date.now();
    await flushPromises();
    store.announce(sid, "assistant.error.rate_limited.titleTimed");
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-status-region"]').text()).toBe(
      "Not sent. The AI provider is rate-limiting requests. Retry in 30 s.",
    );
  });

  it("counts retry_after from the refusal's own end, so a remounted shell keeps the deadline (V6)", async () => {
    const first = live({ state: "refused", error: RATE_LIMITED });
    first.store.state.sessions[first.sid].turnMeta.endedAt = Date.now() - 10_000;
    await flushPromises();
    const label = (w: typeof first.wrapper) =>
      w.get('[data-test="assistant-turn-outcome-action"]').text();
    expect(label(first.wrapper)).toMatch(/^Retry in 20 s/);
    first.wrapper.unmount();
    const again = mount(AssistantShell, {
      props: { placement: "sidebar" },
      slots: { composer: '<div data-test="assistant-composer">composer</div>' },
      global: {
        plugins: [
          fakeRouter([{ path: "/close-tab", name: "closeTab", component: {} }]),
          fakeVuex(),
        ],
      },
      attachTo: document.body,
    });
    await flushPromises();
    expect(label(again)).toMatch(/^Retry in 20 s/);
  });

  it("keeps focus on Stop it when the cancel fails, and never takes focus the reader moved (V7)", async () => {
    const busy = {
      code: "turn_busy",
      phase: "pre_admission",
      retryable: false,
      action: "stop_it",
      turnId: "run-1",
    };
    const failed = live({ state: "refused", error: busy });
    vi.spyOn(failed.store, "cancelTurn").mockResolvedValue(false);
    await flushPromises();
    const button = failed.wrapper.get('[data-test="assistant-turn-outcome-action"]');
    (button.element as HTMLElement).focus();
    await button.trigger("click");
    await flushPromises();
    expect(document.activeElement).toBe(button.element);
    failed.wrapper.unmount();

    const moved = live({ state: "refused", error: busy });
    let settle!: (value: boolean) => void;
    vi.spyOn(moved.store, "cancelTurn").mockReturnValue(new Promise((r) => (settle = r)));
    await flushPromises();
    const outside = document.createElement("input");
    document.body.appendChild(outside);
    const action = moved.wrapper.get('[data-test="assistant-turn-outcome-action"]');
    (action.element as HTMLElement).focus();
    await action.trigger("click");
    outside.focus();
    settle(true);
    await flushPromises();
    expect(document.activeElement).toBe(outside);
  });

  it("grows a half sheet when a new outcome lands, and hides Go to answer with no answer text (U12)", async () => {
    const { wrapper, store } = live(
      {
        state: "failed",
        error: { code: "unknown", phase: "post_admission", retryable: true, action: "retry" },
      },
      [
        { role: "user", content: raw("why?"), sentAt: 0, turnId: "t1" },
        {
          role: "assistant",
          content: raw(""),
          contentBlocks: [{ type: "turn_outcome", outcome: { kind: "failed", code: "unknown" } }],
        },
      ],
    );
    await flushPromises();
    expect(wrapper.find('[data-test="assistant-strip-go-to-answer"]').exists()).toBe(false);
    await wrapper.setProps({ sheet: true });
    store.setSheetSnap("half");
    wrapper.findComponent({ name: "AssistantTranscript" }).vm.$emit("outcome-shown");
    await flushPromises();
    expect(store.state.shell.sheetSnap).toBe("full");
  });

  it("keeps the failure line when a real failed turn grows the half sheet (W4)", async () => {
    const { wrapper, store, sid } = live({ state: "connecting" }, [
      { role: "user", content: raw("why 5xx?"), sentAt: 0, turnId: "t1" },
      {
        role: "assistant",
        content: raw("partial"),
        contentBlocks: [{ type: "text", text: "partial" }],
      },
    ]);
    await wrapper.setProps({ sheet: true });
    store.setSheetSnap("half");
    await flushPromises();
    const session = store.state.sessions[sid];
    session.messages[1].contentBlocks.push({
      type: "turn_outcome",
      outcome: { kind: "failed", code: "agent_unavailable" },
    });
    session.turn = {
      state: "failed",
      error: {
        code: "agent_unavailable",
        phase: "post_admission",
        retryable: true,
        action: "retry",
      },
    };
    store.announce(sid, "assistant.error.agent_unavailable.title");
    await flushPromises();
    expect(store.state.shell.sheetSnap).toBe("full");
    expect(wrapper.get('[data-test="assistant-status-region"]').text()).toMatch(/^Failed\. /);
  });

  it("says Not sent for a refusal (HT-10 AC 2)", async () => {
    const error = { code: "turn_limit", phase: "pre_admission", retryable: true, action: "retry" };
    const { wrapper, store, sid } = live({ state: "refused", error });
    await flushPromises();
    store.announce(sid, "assistant.error.turn_limit.title");
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-status-region"]').text()).toBe(
      "Not sent. Too many answers are running. Wait for one to finish. Retry available.",
    );
  });

  it("speaks tool steps at most once per 3 s, the latest winning (`95` §2.2)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { wrapper, store, sid } = live({ state: "connecting" });
    await flushPromises();
    const region = () => wrapper.get('[data-test="assistant-status-region"]').text();
    store.announce(sid, "assistant.step.StreamList");
    await flushPromises();
    expect(region()).toBe("Listing streams");
    store.announce(sid, "assistant.step.SearchSQL", { stream: "a" });
    store.announce(sid, "assistant.step.SearchSQL", { stream: "b" });
    await flushPromises();
    expect(region()).toBe("Listing streams");
    vi.advanceTimersByTime(STEP_ANNOUNCE_MS);
    await flushPromises();
    expect(region()).toBe("Querying b");
    vi.useRealTimers();
  });

  it("opens the sign-in in a new tab with noopener and keeps this page (ERR-02)", async () => {
    const tab = { opener: window } as unknown as Window;
    const open = vi.spyOn(window, "open").mockReturnValue(tab);
    const error = {
      code: "session_expired",
      phase: "pre_admission",
      retryable: false,
      action: "sign_in",
    };
    const { wrapper } = live({ state: "refused", error });
    await flushPromises();
    await wrapper.get('[data-test="assistant-turn-outcome-action"]').trigger("click");
    expect(open).toHaveBeenCalledWith("/close-tab", "_blank");
    expect(tab.opener).toBeNull();
    expect(wrapper.find('[data-test="assistant-turn-outcome-popup-blocked"]').exists()).toBe(false);
    open.mockRestore();
  });

  it("offers Open here when the browser blocks the sign-in tab (`80` §1.7)", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const error = {
      code: "session_expired",
      phase: "pre_admission",
      retryable: false,
      action: "sign_in",
    };
    const { wrapper } = live({ state: "refused", error });
    await flushPromises();
    await wrapper.get('[data-test="assistant-turn-outcome-action"]').trigger("click");
    expect(wrapper.find('[data-test="assistant-turn-outcome-open-here"]').exists()).toBe(true);
    open.mockRestore();
  });
});

describe("AssistantShell after a sign-out in another tab", () => {
  afterEach(() => setRuntimeHandle(null));

  it("shows the signed-out notice with Sign in, unannounced, and keeps Send off", async () => {
    const signedOut = ref(true);
    setRuntimeHandle({
      lifecycle: {
        signedOutElsewhere: computed(() => signedOut.value),
        otherAccountSignedIn: computed(() => false),
        turnLock: () => (signedOut.value ? "signed_out" : null),
      },
    } as never);
    const { wrapper } = setup();
    await flushPromises();
    const block = wrapper.get('[data-test="assistant-shell-signed-out-block"]');
    expect(block.text()).toContain("You signed out in another tab.");
    expect(block.attributes("role")).toBe("presentation");
    expect(wrapper.find('[data-test="assistant-shell-signed-out-sign-in"]').text()).toBe("Sign in");
    signedOut.value = false;
    await flushPromises();
    expect(wrapper.find('[data-test="assistant-shell-signed-out-block"]').exists()).toBe(false);
  });

  it("asks for a reload when another account signed in, keeping this tab's chats locked", async () => {
    setRuntimeHandle({
      lifecycle: {
        signedOutElsewhere: computed(() => true),
        otherAccountSignedIn: computed(() => true),
        turnLock: () => "account_changed",
      },
    } as never);
    const { wrapper } = setup();
    await flushPromises();
    expect(wrapper.find('[data-test="assistant-shell-signed-out-block"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="assistant-shell-other-account-block"]').text()).toContain(
      "Another account signed in.",
    );
    expect(wrapper.get('[data-test="assistant-shell-other-account-reload"]').text()).toBe("Reload");
  });

  it("leaves the stopped turn's own outcome to say it, without a second notice", async () => {
    setRuntimeHandle({
      lifecycle: {
        signedOutElsewhere: computed(() => true),
        otherAccountSignedIn: computed(() => false),
        turnLock: () => "signed_out",
      },
    } as never);
    const { wrapper, store } = setup();
    const sid = store.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
    });
    store.state.sessions[sid].turn = {
      state: "failed",
      error: { code: "signed_out", phase: "post_admission", retryable: false, action: "sign_in" },
    };
    await flushPromises();
    expect(wrapper.find('[data-test="assistant-shell-signed-out-block"]').exists()).toBe(false);
  });
});

describe("AssistantShell decision cards", () => {
  const ORIGIN = { entryKind: "header_button", objectKind: "none", container: "sidebar" } as const;
  const DELETE = {
    type: "confirmation_required",
    tool: "o2_delete",
    message: "Delete?",
    args: { items: [{ resource_type: "alert", name: "checkout-latency-old", id: "a1" }] },
  };

  async function mountWithCard(card: "approval" | "consent" | "none" = "approval", open = true) {
    localStorage.clear();
    sessionStorage.clear();
    fake.current = fakeAssistant("available");
    const store = fake.current.store;
    const { approvalOf } = await import("@/composables/assistant/reducer");
    const approval = { ...approvalOf(DELETE), id: "t1:1" };
    const sid = store.createSession({
      origin: ORIGIN,
      thread: "new",
      messages: [
        { role: "user", content: raw("clean up"), turnId: "t1" },
        {
          role: "assistant",
          content: raw(""),
          turnId: "t1",
          contentBlocks: [{ type: "approval", approval }],
        },
      ],
    });
    if (card === "approval")
      store.state.sessions[sid].pendingApproval = {
        ...approval,
        sessionId: sid,
        turnId: "t1",
        askedIn: "here",
        expiresAt: Date.now() + 25_000,
      };
    if (card === "consent")
      store.state.sessions[sid].pendingConsent = {
        org: "default",
        feature: "ai_credits",
        turnId: "t1",
        snapshot: { text: "why?", chips: [], images: [], mentions: [], timeOverride: null },
        status: {
          feature: "ai_credits",
          organization: { org_id: "default", enabled: false, can_manage: true },
          payer: null,
          effective: false,
          billing_status: "eligible",
        },
      };
    if (open) store.open({ kind: "sidebar", mode: "pinned" }, { sid, focus: "none" });
    const wrapper = mount(AssistantShell, {
      props: { placement: "sidebar" },
      slots: { composer: '<div data-test="assistant-composer">composer</div>' },
      global: { plugins: [fakeRouter(), fakeVuex()] },
      attachTo: document.body,
    });
    await flushPromises();
    return { wrapper, store, sid };
  }

  afterEach(() => setRuntimeHandle(null));

  it("renders the pending card in the visible container, and nowhere while hidden", async () => {
    const shown = await mountWithCard();
    expect(shown.wrapper.find('[data-test="assistant-approval-card"]').exists()).toBe(true);
    shown.wrapper.unmount();
    const hidden = await mountWithCard("approval", false);
    expect(hidden.store.state.shell.placement.kind).toBe("hidden");
    expect(hidden.wrapper.find('[data-test="assistant-approval-card"]').exists()).toBe(false);
  });

  it("posts the card's decision through the store, and Reply puts the composer in reply mode", async () => {
    const { wrapper, store, sid } = await mountWithCard();
    const decide = vi.spyOn(store, "decideApproval").mockResolvedValue({} as never);
    wrapper
      .get('[data-test="assistant-approval-deny"]')
      .element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    await flushPromises();
    expect(decide).toHaveBeenCalledWith(sid, { approved: false, reason: "deny" }, "t1:1");
    wrapper
      .get('[data-test="assistant-approval-reply"]')
      .element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    await flushPromises();
    expect(store.state.sessions[sid].composer).toMatchObject({
      mode: "reply",
      replyApprovalId: "t1:1",
    });
  });

  it("keeps Review request in the strip while a card waits, and it lands on Deny", async () => {
    const { wrapper } = await mountWithCard();
    const close = wrapper.get('[data-test="assistant-shell-close"]').element as HTMLElement;
    close.focus();
    await flushPromises();
    const review = wrapper.get('[data-test="assistant-strip-review"]');
    expect(review.text()).toMatch(/^Review request · expires in \d+:\d\d$/);
    expect(review.attributes("aria-label")).toBe("Review request");
    await review.trigger("click");
    await flushPromises();
    expect(document.activeElement).toBe(
      wrapper.get('[data-test="assistant-approval-deny"]').element,
    );
    // It never leaves while the card waits, so the strip cannot shift under a pointer.
    expect(wrapper.find('[data-test="assistant-strip-review"]').exists()).toBe(true);
  });

  it("shows the waiting line with Stop where another tab holds the card", async () => {
    const stopElsewhere = vi.fn(async () => undefined);
    setRuntimeHandle({
      lifecycle: {
        signedOutElsewhere: computed(() => false),
        otherAccountSignedIn: computed(() => false),
        turnLock: () => "approval_elsewhere",
        stopElsewhere,
      },
    } as never);
    const { wrapper, sid } = await mountWithCard("none");
    expect(wrapper.find('[data-test="assistant-approval-card"]').exists()).toBe(false);
    await wrapper.get('[data-test="assistant-approval-result-stop"]').trigger("click");
    expect(stopElsewhere).toHaveBeenCalledWith(sid);
  });

  it("renders the consent card named by its org, and Cancel declines through the store", async () => {
    const { wrapper, store, sid } = await mountWithCard("consent");
    const resolve = vi.spyOn(store, "resolveConsent").mockResolvedValue();
    expect(wrapper.get('[data-test="assistant-consent-card-org"]').text()).toBe(
      "Enable paid AI usage for default?",
    );
    wrapper
      .get('[data-test="assistant-consent-card-cancel"]')
      .element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    await flushPromises();
    expect(resolve).toHaveBeenCalledWith(sid, false, false);
  });

  it("clears the declined-consent note on the first keystroke after it", async () => {
    const { wrapper, store, sid } = await mountWithCard("none");
    const session = store.state.sessions[sid];
    session.composer.text = "why?";
    session.turn = {
      state: "refused",
      error: { code: "consent_declined", phase: "pre_admission", retryable: false, action: "none" },
    };
    await flushPromises();
    const note = () => wrapper.findAll('[data-test="assistant-turn-outcome"]');
    expect(note()).toHaveLength(1);
    store.setDraft(sid, { text: "why?!" });
    await flushPromises();
    expect(note()).toHaveLength(0);
  });

  it("declines a card the old chat waits on when a new chat starts", async () => {
    const { wrapper, store, sid } = await mountWithCard();
    const decide = vi.spyOn(store, "decideApproval").mockResolvedValue({} as never);
    (wrapper.vm as unknown as { $: { setupState: { newChat(): void } } }).$.setupState.newChat();
    await flushPromises();
    expect(decide).toHaveBeenCalledWith(sid, { approved: false, reason: "new_chat" });
  });
});

describe("AssistantShell history states", () => {
  const open = (store: ReturnType<typeof setup>["store"]) => {
    const sid = store.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
    });
    store.state.sessions[sid].messages.push({ role: "user", content: raw("q") });
    store.open({ kind: "sidebar", mode: "pinned" }, { focus: "none" });
    return sid;
  };

  it("renders the thread header as the chrome row, the shell's controls at its end", async () => {
    const { wrapper, store } = setup();
    open(store);
    await flushPromises();
    const header = wrapper.get('[data-test="assistant-thread-header"]');
    expect(header.find('[data-test="assistant-shell-close"]').exists()).toBe(true);
    expect(header.find('[data-test="assistant-thread-menu"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="assistant-shell-menu"]').exists()).toBe(false);
  });

  it("follows a turn another tab runs with its status line and Stop", async () => {
    const { wrapper, store } = setup();
    const sid = open(store);
    store.state.sessions[sid].turn = { state: "responding.writing" } as never;
    store.state.sessions[sid].turnMeta.ownedByThisTab = false;
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-shell-elsewhere-status"]').text()).toBe(
      "Answering in another tab",
    );
    expect(wrapper.find('[data-test="assistant-shell-elsewhere-stop"]').exists()).toBe(true);
  });

  it("says history is unavailable with Retry while the cached transcript stays", async () => {
    const { wrapper, store } = setup();
    const sid = open(store);
    store.state.sessions[sid].record.historyUnavailable = true;
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-shell-history-unavailable"]').text()).toContain(
      "History unavailable",
    );
    expect(wrapper.find('[data-test="assistant-transcript"]').exists()).toBe(true);
  });

  it("puts history unavailable before the credit notice, which shows once history is back", async () => {
    creditUsage.current = { mode: "free", credits_used: 75, credits_limit: 100 };
    const { wrapper, store } = setup({}, "available", { edition: "cloud" });
    const sid = open(store);
    store.state.sessions[sid].record.historyUnavailable = true;
    await flushPromises();
    const row = wrapper.get('[data-test="assistant-shell-notice-row"]');
    expect(row.find('[data-test="assistant-shell-history-unavailable"]').exists()).toBe(true);
    expect(row.find('[data-test="assistant-credit-notice"]').exists()).toBe(false);
    store.state.sessions[sid].record.historyUnavailable = false;
    await flushPromises();
    expect(wrapper.find('[data-test="assistant-shell-history-unavailable"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="assistant-credit-notice"]').exists()).toBe(true);
    creditUsage.current = null;
  });

  it("keeps history unavailable first when credits are used up, and the used-up notice follows once history is back", async () => {
    creditUsage.current = { mode: "free", credits_used: 100, credits_limit: 100 };
    const { wrapper, store } = setup({}, "available", { edition: "cloud" });
    store.state.capability.creditMode = "exhausted";
    const sid = open(store);
    store.state.sessions[sid].record.historyUnavailable = true;
    await flushPromises();
    const row = wrapper.get('[data-test="assistant-shell-notice-row"]');
    expect(row.find('[data-test="assistant-shell-history-unavailable"]').exists()).toBe(true);
    expect(row.find('[data-test="assistant-credit-notice"]').exists()).toBe(false);
    store.state.sessions[sid].record.historyUnavailable = false;
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-credit-notice"]').text()).toContain("90");
    store.state.capability.creditMode = undefined;
    creditUsage.current = null;
  });

  it("replaces the body when another tab deletes the open chat, and writes nothing back", async () => {
    const hints = hintBus();
    const { wrapper, store } = setup({}, "available", {}, undefined, { hints: hints as never });
    const sid = open(store);
    await flushPromises();
    hints.fire({ type: "history_changed", sid, op: "delete" });
    await flushPromises();
    expect(root(wrapper).attributes("data-state")).toBe("deleted_elsewhere");
    expect(wrapper.get('[data-test="assistant-shell-deleted"]').text()).toContain(
      "This chat was deleted in another tab",
    );
    expect(store.state.sessions[sid]).toBeUndefined();
    await fake.current.history.save(sid);
    expect(fake.current.db.rows.size).toBe(0);
  });

  it("speaks one history outcome once, from the visible shell only", async () => {
    const { wrapper, store } = setup();
    open(store);
    const second = mount(AssistantShell, {
      props: { placement: "sidebar" },
      global: { plugins: [fakeRouter(), fakeVuex()] },
      attachTo: document.body,
    });
    await flushPromises();
    fake.current.history.announceText(raw("Chat deleted"));
    await flushPromises();
    const spoken = [wrapper, second].map((shell) =>
      shell.get('[data-test="assistant-status-region"]').text(),
    );
    expect(spoken.filter((text) => text === "Chat deleted")).toHaveLength(1);
    second.unmount();
  });

  it("says a chat opened from the list was deleted elsewhere, but never over a transcript", async () => {
    const { wrapper, store } = setup();
    store.open({ kind: "sidebar", mode: "pinned" }, { focus: "none" });
    await flushPromises();
    const notice = fake.current.history.deletedNotice as { value: unknown };
    notice.value = { sid: "gone", via: "server", opening: true };
    await flushPromises();
    expect(root(wrapper).attributes("data-state")).toBe("deleted_elsewhere");
    expect(wrapper.get('[data-test="assistant-shell-deleted"]').text()).toContain(
      "This chat was deleted elsewhere",
    );
    await wrapper.get('[data-test="assistant-shell-deleted"] button').trigger("click");
    open(store);
    await flushPromises();
    notice.value = { sid: "gone-too", via: "server", opening: true };
    await flushPromises();
    expect(root(wrapper).attributes("data-state")).toBe("conversation");
  });
});

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
import { defineComponent, h, ref } from "vue";

import { fakeAssistant, fakeRouter, fakeVuex } from "../__tests__/fakeAssistant";
import AssistantSidebarHost from "./AssistantSidebarHost.vue";
import { tearOffRequest } from "./assistantWindowHost";
import { closeLockedPanel, openLockedPanel, useLockedPanel } from "./lockedPanel";
import {
  followedRcaRun,
  stopFollowingRca,
  useRcaFollow,
} from "@/components/ai-assistant/shell/rcaFollow";

const { fake, lg, closers, shortcuts, track, deep } = vi.hoisted(() => ({
  deep: { blocked: null as null | "no_permission" | "off_for_org" },
  fake: { current: null as any },
  lg: { value: true },
  closers: [] as (() => void)[],
  shortcuts: vi.fn(),
  track: vi.fn(),
}));

vi.mock("@/composables/useBreakpoint", async () => {
  const { computed, reactive } = await import("vue");
  const state = reactive(lg);
  return {
    default: () => ({
      lgUp: computed(() => state.value),
      mdUp: computed(() => state.value),
      isMobile: computed(() => !state.value),
      isTablet: computed(() => false),
      isDesktop: computed(() => state.value),
    }),
    __state: state,
  };
});
vi.mock("@/composables/assistant", async (importOriginal) => {
  const { computed } = await import("vue");
  const original = await importOriginal<typeof import("@/composables/assistant")>();
  return {
    ...original,
    // A test may block the deep-link door to render its gate; every other test gets the real door.
    useDeepLinkDoor: () => {
      const real = original.useDeepLinkDoor();
      return deep.blocked ? { ...real, blocked: computed(() => deep.blocked) } : real;
    },
    useAssistantStore: () => fake.current.store,
    useAssistantHistory: () => fake.current.history,
    useAssistantCapability: () => fake.current.handle,
    useAssistantShortcuts: shortcuts,
    registerContainerCloser: (close: () => void) => {
      closers.push(close);
      return () => closers.splice(closers.indexOf(close), 1);
    },
    useAssistantStarters: () => ({
      starters: computed(() => []),
      loading: computed(() => false),
      scope: computed(() => ({ org: "default", streamCount: 1, timeRange: null, canWrite: "yes" })),
    }),
  };
});
vi.mock("@/services/assistantAnalytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/assistantAnalytics")>()),
  trackAssistant: track,
}));

async function setup(path = "/logs") {
  fake.current = fakeAssistant();
  const router = fakeRouter();
  await router.push(path);
  const invoker = ref<HTMLElement | null>(null);
  const wrapper = mount(
    defineComponent({
      setup: () => () =>
        h("div", [
          h("main", [h("button", { "data-test": "door", ref: invoker }, "door")]),
          h(AssistantSidebarHost),
        ]),
    }),
    { global: { plugins: [router, fakeVuex()] }, attachTo: document.body },
  );
  await flushPromises();
  const store = fake.current.store;
  const open = () => {
    store.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
    });
    store.open({ kind: "sidebar" }, { focus: "composer", invoker: invoker.value });
  };
  return { wrapper, store, router, open, invoker };
}

const column = () =>
  document.body.querySelector<HTMLElement>('[data-test="assistant-sidebar-host"]');

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  lg.value = true;
  closers.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
  stopFollowingRca();
  window.innerWidth = 1024;
  document.body.innerHTML = "";
  closeLockedPanel();
  track.mockClear();
  document.documentElement.style.removeProperty("--o-assistant-inset-end");
});

describe("AssistantSidebarHost", () => {
  it("gives the blocked deep-link gate and its Ask an admin request the assistant roles (`90` §2.2)", async () => {
    deep.blocked = "no_permission";
    fake.current = fakeAssistant("no_permission");
    const router = fakeRouter();
    await router.push("/logs");
    const wrapper = mount(
      defineComponent({
        setup: () => () =>
          h("div", [h("main", { "data-test": "main-content" }), h(AssistantSidebarHost)]),
      }),
      { global: { plugins: [router, fakeVuex()] }, attachTo: document.body },
    );
    await flushPromises();
    const gate = document.body.querySelector<HTMLElement>(
      '[data-test="assistant-deep-link-gate"] [data-test="assistant-gate-state"]',
    )!;
    expect(gate.closest("[data-assistant-surface]")).not.toBeNull();
    gate.querySelector<HTMLElement>('[data-test="assistant-gate-ask-admin"]')!.click();
    await flushPromises();
    const copy = document.body.querySelector('[data-test="assistant-ask-admin-copy"]');
    expect(copy).not.toBeNull();
    expect(copy!.closest("[data-assistant-surface]")).not.toBeNull();
    deep.blocked = null;
    wrapper.unmount();
  });

  it("stays mounted and toggles with v-show, binding the chords once", async () => {
    const { open } = await setup();
    expect(shortcuts).toHaveBeenCalled();
    expect(column()).not.toBeNull();
    expect(column()!.style.display).toBe("none");
    open();
    await flushPromises();
    expect(column()!.style.display).toBe("");
    expect(column()!.querySelector('[data-test="assistant-shell-sidebar"]')).not.toBeNull();
  });

  it("renders the pinned column at the stored width without an inline width", async () => {
    const { open, store } = await setup();
    open();
    store.setSidebarWidth(26);
    await flushPromises();
    expect(column()!.style.getPropertyValue("--o-assistant-sidebar-width")).toBe("26");
    expect(column()!.style.width).toBe("");
  });

  it("draws the panel as a second page card in the page's gutter", async () => {
    const { open } = await setup();
    open();
    await flushPromises();
    expect(column()!.classList).toContain("bg-surface-chrome-deeper");
    expect(column()!.classList).toContain("pe-2");
    const card = column()!.querySelector('[data-test="assistant-sidebar-card"]')!;
    for (const cls of ["rounded-surface", "border", "shadow-md", "bg-surface-base"])
      expect(card.classList).toContain(cls);
    expect(card.querySelector('[data-test="assistant-shell-sidebar"]')).not.toBeNull();
  });

  it("puts the resize handle on the panel's inner edge; a key step stores the width", async () => {
    window.innerWidth = 1280;
    const { open, store } = await setup();
    open();
    store.setSidebarWidth(24);
    await flushPromises();
    const handle = column()!.querySelector<HTMLElement>(
      '[data-test="assistant-shell-resize-handle"]',
    )!;
    expect(handle.getAttribute("aria-valuenow")).toBe("24");
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    await flushPromises();
    expect(store.state.shell.sidebarWidthRem).toBe(25);
    expect(handle.getAttribute("aria-valuenow")).toBe("25");
    handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await flushPromises();
    expect(store.state.shell.sidebarWidthRem).toBe(24);
  });

  it("holds a stored width too wide for the window and reports what it draws", async () => {
    window.innerWidth = 1100;
    const { open, store } = await setup();
    open();
    store.setSidebarWidth(34);
    await flushPromises();
    const handle = column()!.querySelector<HTMLElement>(
      '[data-test="assistant-shell-resize-handle"]',
    )!;
    expect(column()!.style.getPropertyValue("--o-assistant-sidebar-width")).toBe("31.25");
    expect(handle.getAttribute("aria-valuenow")).toBe("31.3");
    expect(Number(handle.getAttribute("aria-valuenow"))).toBeLessThanOrEqual(
      Number(handle.getAttribute("aria-valuemax")),
    );
  });

  it("follows a drag live without storing, then stores once on release", async () => {
    window.innerWidth = 1280;
    const { open, store } = await setup();
    open();
    store.setSidebarWidth(24);
    await flushPromises();
    const handle = column()!.querySelector<HTMLElement>(
      '[data-test="assistant-shell-resize-handle"]',
    )!;
    handle.setPointerCapture = () => undefined;
    handle.releasePointerCapture = () => undefined;
    handle.dispatchEvent(
      new PointerEvent("pointerdown", { button: 0, clientX: 900, pointerId: 7 }),
    );
    handle.dispatchEvent(new PointerEvent("pointermove", { clientX: 836, pointerId: 7 }));
    await flushPromises();
    expect(column()!.style.getPropertyValue("--o-assistant-sidebar-width")).toBe("28");
    expect(column()!.hasAttribute("data-dragging")).toBe(true);
    expect(store.state.shell.sidebarWidthRem).toBe(24);
    handle.dispatchEvent(new PointerEvent("pointerup", { clientX: 836, pointerId: 7 }));
    await flushPromises();
    expect(store.state.shell.sidebarWidthRem).toBe(28);
    expect(column()!.hasAttribute("data-dragging")).toBe(false);
  });

  it("keeps the legacy expanded width once on the first revamped open", async () => {
    window.innerWidth = 1280;
    const vuexWithLegacy = fakeVuex();
    (vuexWithLegacy.state as Record<string, unknown>).isAiChatExpanded = true;
    fake.current = fakeAssistant();
    fake.current.store.setIdentity(null);
    const router = fakeRouter();
    await router.push("/logs");
    mount(AssistantSidebarHost, {
      global: { plugins: [router, vuexWithLegacy] },
      attachTo: document.body,
    });
    fake.current.store.setIdentity({ userOrgKey: "k1", org: "default" });
    await flushPromises();
    expect(fake.current.store.state.shell.sidebarWidthRem).toBe(40);
  });

  it("renders the same session as the sheet at half below lg", async () => {
    lg.value = false;
    const { open, store } = await setup();
    open();
    await flushPromises();
    const sheet = document.body.querySelector('[data-test="assistant-shell-sheet"]');
    expect(sheet?.getAttribute("role")).toBe("dialog");
    expect(sheet?.getAttribute("data-snap")).toBe("half");
    expect(store.state.shell.placement.kind).toBe("sidebar");
    expect(sheet?.querySelector("[data-assistant-root][data-sheet]")).not.toBeNull();
  });

  it("hides while docked and on the full view route", async () => {
    const { open, store, router } = await setup();
    open();
    await flushPromises();
    store.open({ kind: "docked", hostId: "regex" }, { focus: "none" });
    await flushPromises();
    expect(column()!.style.display).toBe("none");
    store.moveTo({ kind: "sidebar" });
    await router.push("/?thread=");
    await flushPromises();
    expect(column()!.style.display).toBe("none");
  });

  it("closes on rung f, says so outside the hidden column and returns focus to the invoker", async () => {
    const { open, store } = await setup();
    open();
    await flushPromises();
    closers.forEach((close) => close());
    await flushPromises();
    expect(store.state.shell.placement.kind).toBe("hidden");
    expect(track).toHaveBeenCalledWith("ai_container_closed", { reason: "escape" });
    expect(
      document.body.querySelector('[data-test="assistant-container-status"]')?.textContent,
    ).toContain("O2 Assistant closed.");
    expect(document.activeElement?.getAttribute("data-test")).toBe("door");
  });

  it("opens the locked panel on G2 without touching placement", async () => {
    const { store } = await setup();
    fake.current.capability.value = { ...fake.current.capability.value, gate: "no_permission" };
    openLockedPanel(null);
    await flushPromises();
    expect(column()!.style.display).toBe("");
    expect(column()!.querySelector('[data-gate="no_permission"]')).not.toBeNull();
    expect(store.state.shell.placement.kind).toBe("hidden");
    closers.forEach((close) => close());
    await flushPromises();
    expect(column()!.style.display).toBe("none");
  });

  it("tears the chat off the chrome once the pointer leaves toward the page", async () => {
    const { open, store } = await setup();
    open();
    await flushPromises();
    const sid = store.state.shell.activeSid;
    const chrome = column()!.querySelector("[data-assistant-chrome]")!;
    const fire = (type: string, clientX: number) =>
      chrome.dispatchEvent(
        new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX, clientY: 20 }),
      );
    fire("pointerdown", 900);
    fire("pointermove", 890);
    expect(store.windowOf(sid)).toBeNull();
    fire("pointermove", 880);
    expect(store.windowOf(sid)).toMatchObject({ state: "open" });
    expect(store.state.shell.placement.kind).toBe("hidden");
    expect(track).toHaveBeenCalledWith("ai_window_opened", { from: "tear_off" });
    tearOffRequest.value = null;
  });

  it("never tears off from a control in the chrome", async () => {
    const { open, store } = await setup();
    open();
    await flushPromises();
    const sid = store.state.shell.activeSid;
    const button = column()!.querySelector('[data-test="assistant-shell-close"]')!;
    const fire = (type: string, clientX: number) =>
      button.dispatchEvent(
        new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX, clientY: 20 }),
      );
    fire("pointerdown", 900);
    fire("pointermove", 800);
    expect(store.windowOf(sid)).toBeNull();
  });

  it("says nothing of a close when the chat floats away", async () => {
    const { open, store } = await setup();
    open();
    await flushPromises();
    store.floatChat(store.state.shell.activeSid!, { focus: "none" });
    await flushPromises();
    const region = column()!.ownerDocument.querySelector('[data-test="assistant-status-region"]');
    expect(region?.textContent ?? "").not.toContain("closed");
  });

  it("treats a move to the full view or a dock as a move, not a close", async () => {
    const { open, store, router } = await setup();
    open();
    await flushPromises();
    const status = () =>
      document.body.querySelector('[data-test="assistant-container-status"]')?.textContent ?? "";
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    store.open({ kind: "docked", hostId: "regex" }, { focus: "none" });
    await flushPromises();
    expect(status()).not.toContain("closed");
    expect(document.activeElement).toBe(outside);
    store.moveTo({ kind: "sidebar" });
    await flushPromises();
    store.moveTo({ kind: "full" });
    await router.push("/assistant");
    await flushPromises();
    expect(status()).not.toContain("closed");
    expect(document.activeElement).toBe(outside);
    expect(track).not.toHaveBeenCalledWith("ai_container_closed", expect.anything());
  });

  it("keeps the sheet's shell mounted, so an explicit open below lg focuses the composer and announces", async () => {
    lg.value = false;
    const { open } = await setup();
    const sheetRoot = () =>
      document.body.querySelector<HTMLElement>(
        '[data-test="assistant-shell-sheet"] [data-assistant-root]',
      );
    expect(sheetRoot()).not.toBeNull();
    open();
    await flushPromises();
    expect(document.activeElement).toBe(sheetRoot()!.querySelector("[data-assistant-composer]"));
    expect(
      sheetRoot()!.querySelector('[data-test="assistant-status-region"]')?.textContent,
    ).toContain("O2 Assistant opened.");
  });

  it("shows the title in the peek row", async () => {
    lg.value = false;
    const { open, store } = await setup();
    open();
    await flushPromises();
    store.setSheetSnap("peek");
    await flushPromises();
    const row = document.body.querySelector('[data-test="assistant-shell-sheet-peek-row"]');
    expect(row?.textContent).toContain("New chat");
  });

  it("drops the locked panel once the gate stops locking", async () => {
    await setup();
    fake.current.capability.value = { ...fake.current.capability.value, gate: "no_permission" };
    openLockedPanel(null);
    await flushPromises();
    fake.current.capability.value = { ...fake.current.capability.value, gate: "available" };
    await flushPromises();
    expect(useLockedPanel().value).toBeNull();
  });

  it("says nothing of a close when the locked sidebar moves to the full view", async () => {
    await setup();
    fake.current.capability.value = { ...fake.current.capability.value, gate: "no_permission" };
    const status = () =>
      document.body.querySelector('[data-test="assistant-container-status"]')?.textContent ?? "";
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    openLockedPanel(outside);
    await flushPromises();
    const elsewhere = document.createElement("button");
    document.body.appendChild(elsewhere);
    elsewhere.focus();
    closeLockedPanel("move");
    await flushPromises();
    expect(status()).not.toContain("closed");
    expect(document.activeElement).toBe(elsewhere);
    openLockedPanel(outside);
    await flushPromises();
    closeLockedPanel();
    await flushPromises();
    expect(status()).toContain("O2 Assistant closed.");
    expect(document.activeElement).toBe(outside);
  });
});

describe("opening and Follow in thread", () => {
  // Swapped in and back by hand, so the setup's own matchMedia stays for the composer.
  const reduce = (on: boolean) => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: on && query.includes("reduce"),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
    })) as unknown as typeof window.matchMedia;
    return { mockRestore: () => (window.matchMedia = original) };
  };

  it("slides the panel in on the open that shows it, then drops the class once the sequence played", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const media = reduce(false);
    const { open } = await setup();
    expect(column()!.classList.contains("assistant-panel-in")).toBe(false);
    open();
    await flushPromises();
    expect(column()!.classList.contains("assistant-panel-in")).toBe(true);
    expect(column()!.hasAttribute("data-opening")).toBe(true);
    vi.advanceTimersByTime(1_400);
    await flushPromises();
    expect(column()!.classList.contains("assistant-panel-in")).toBe(false);
    media.mockRestore();
  });

  it("keeps a reduced-motion open to the short fade, ending with it", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const media = reduce(true);
    const { open } = await setup();
    open();
    await flushPromises();
    expect(column()!.classList.contains("assistant-panel-in")).toBe(true);
    vi.advanceTimersByTime(210);
    await flushPromises();
    expect(column()!.classList.contains("assistant-panel-in")).toBe(false);
    media.mockRestore();
  });

  it("never replays the opening on a panel that was already open when it mounted", async () => {
    fake.current = fakeAssistant();
    const { store } = fake.current;
    store.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
    });
    store.open({ kind: "sidebar" }, { focus: "none" });
    const router = fakeRouter();
    await router.push("/logs");
    mount(AssistantSidebarHost, {
      global: { plugins: [router, fakeVuex()] },
      attachTo: document.body,
    });
    await flushPromises();
    expect(column()!.classList.contains("assistant-panel-in")).toBe(false);
  });

  it("follows a run in the panel in place of the chat, gives the chat back on close, and ends on a panel close", async () => {
    const { store } = await setup();
    const door = useRcaFollowOutside();
    door.follow({ org: "default", incidentId: "inc-482", runId: "run-1" });
    await vi.dynamicImportSettled();
    await flushPromises();
    expect(store.state.shell.placement.kind).toBe("sidebar");
    const card = () =>
      document.body.querySelector<HTMLElement>('[data-test="assistant-sidebar-card"]')!;
    const shell = () => card().querySelector<HTMLElement>('[data-test="assistant-shell-sidebar"]')!;
    expect(card().querySelector('[data-test="assistant-rca-thread"]')).not.toBeNull();
    expect(shell().style.display).toBe("none");
    card().querySelector<HTMLElement>('[data-test="assistant-rca-thread-close"]')!.click();
    await flushPromises();
    expect(followedRcaRun().value).toBeNull();
    expect(card().querySelector('[data-test="assistant-rca-thread"]')).toBeNull();
    expect(shell().style.display).toBe("");
    door.follow({ org: "default", incidentId: "inc-482", runId: "run-1" });
    await flushPromises();
    store.close("close");
    await flushPromises();
    expect(followedRcaRun().value).toBeNull();
  });

  it("ends a followed run on an org switch and on sign-out, so the panel never acts on the old org's incident (R2-01)", async () => {
    const { store } = await setup();
    const door = useRcaFollowOutside();
    door.follow({ org: "default", incidentId: "inc-482", runId: "run-1" });
    await vi.dynamicImportSettled();
    await flushPromises();
    expect(document.body.querySelector('[data-test="assistant-rca-thread"]')).not.toBeNull();
    store.setIdentity({ userOrgKey: "k2", org: "other" });
    await flushPromises();
    expect(followedRcaRun().value).toBeNull();
    expect(document.body.querySelector('[data-test="assistant-rca-thread"]')).toBeNull();
    door.follow({ org: "other", incidentId: "inc-9", runId: "run-9" });
    await flushPromises();
    expect(followedRcaRun().value).toMatchObject({ runId: "run-9" });
    store.setIdentity(null);
    await flushPromises();
    expect(followedRcaRun().value).toBeNull();
  });

  it("switches to the new run when the followed thread re-analyzes, instead of snapping back", async () => {
    const { wrapper } = await setup();
    const door = useRcaFollowOutside();
    door.follow({ org: "default", incidentId: "inc-482", runId: "run-1" });
    await vi.dynamicImportSettled();
    await flushPromises();
    const thread = wrapper.findComponent({ name: "AssistantRcaThread" });
    expect(thread.props("runId")).toBe("run-1");
    thread.vm.$emit("reanalyze", { runId: "run-2" });
    await flushPromises();
    expect(followedRcaRun().value).toEqual({
      org: "default",
      incidentId: "inc-482",
      runId: "run-2",
    });
    expect(wrapper.findComponent({ name: "AssistantRcaThread" }).props("runId")).toBe("run-2");
    stopFollowingRca();
  });
});

// The follow door outside a component; it reads the same store the host does.
function useRcaFollowOutside() {
  let door!: ReturnType<typeof useRcaFollow>;
  mount(
    defineComponent({
      setup() {
        door = useRcaFollow();
        return () => null;
      },
    }),
  );
  return door;
}

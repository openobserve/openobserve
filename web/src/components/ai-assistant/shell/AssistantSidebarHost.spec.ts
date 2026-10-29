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
import AssistantSidebarHost, { coveredBy } from "./AssistantSidebarHost.vue";
import { closeLockedPanel, openLockedPanel, useLockedPanel } from "./lockedPanel";

const { fake, lg, closers, shortcuts, track } = vi.hoisted(() => ({
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
  return {
    ...(await importOriginal<typeof import("@/composables/assistant")>()),
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
  const open = (mode: "pinned" | "floating" = "pinned") => {
    store.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
    });
    store.open({ kind: "sidebar", mode }, { focus: "composer", invoker: invoker.value });
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
  window.innerWidth = 1024;
  document.body.innerHTML = "";
  closeLockedPanel();
  track.mockClear();
  document.documentElement.style.removeProperty("--o-assistant-inset-end");
});

describe("AssistantSidebarHost", () => {
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
    expect(column()!.dataset.mode).toBe("pinned");
    expect(column()!.style.getPropertyValue("--o-assistant-sidebar-width")).toBe("26");
    expect(column()!.style.width).toBe("");
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

  it("holds a stored width too wide for the window instead of floating, and reports what it draws", async () => {
    window.innerWidth = 1100;
    const { open, store } = await setup();
    open();
    store.setSidebarWidth(34);
    await flushPromises();
    const handle = column()!.querySelector<HTMLElement>(
      '[data-test="assistant-shell-resize-handle"]',
    )!;
    expect(column()!.dataset.mode).toBe("pinned");
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

  it("rings the source a door opened from while its chat sits pinned beside it", async () => {
    const { store, invoker } = await setup();
    const sid = store.createSession({
      origin: { entryKind: "object_verb", objectKind: "panel", container: "sidebar" },
    });
    store.open(
      { kind: "sidebar", mode: "floating" },
      { sid, focus: "none", invoker: invoker.value, forcePinned: true },
    );
    await flushPromises();
    expect(invoker.value!.hasAttribute("data-assistant-source")).toBe(true);
    expect(invoker.value!.classList.contains("ring-2")).toBe(true);
    expect(invoker.value!.classList.contains("ring-inset")).toBe(true);
    store.close("close");
    await flushPromises();
    expect(invoker.value!.hasAttribute("data-assistant-source")).toBe(false);
    expect(invoker.value!.classList.contains("ring-focus-ring-accent")).toBe(false);
  });

  it("rings the panel a toolbar door sits in, not the door itself", async () => {
    const { store, invoker } = await setup();
    const panel = document.createElement("div");
    panel.setAttribute("data-assistant-source-scope", "");
    document.body.appendChild(panel);
    panel.appendChild(invoker.value!);
    const sid = store.createSession({
      origin: { entryKind: "object_verb", objectKind: "panel", container: "sidebar" },
    });
    store.open(
      { kind: "sidebar", mode: "floating" },
      { sid, focus: "none", invoker: invoker.value, forcePinned: true },
    );
    await flushPromises();
    expect(panel.hasAttribute("data-assistant-source")).toBe(true);
    expect(panel.classList.contains("ring-2")).toBe(true);
    expect(invoker.value!.hasAttribute("data-assistant-source")).toBe(false);
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
    store.moveTo({ kind: "sidebar", mode: "pinned" });
    await router.push("/assistant");
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

  it("pins the floating card for this open when a focused control lies even partly under it", async () => {
    const { open, invoker } = await setup();
    open("floating");
    await flushPromises();
    vi.spyOn(column()!, "getBoundingClientRect").mockReturnValue({
      left: 900,
      right: 1280,
      top: 40,
      bottom: 800,
    } as DOMRect);
    vi.spyOn(invoker.value!, "getBoundingClientRect").mockReturnValue({
      left: 880,
      right: 905,
      top: 100,
      bottom: 130,
    } as DOMRect);
    invoker.value!.focus();
    await flushPromises();
    expect(column()!.dataset.mode).toBe("pinned");
  });

  it("pins the floating card for this open when a focused control lies entirely under it", async () => {
    const { open, store, invoker } = await setup();
    open("floating");
    await flushPromises();
    expect(column()!.dataset.mode).toBe("floating");
    expect(document.documentElement.style.getPropertyValue("--o-assistant-inset-end")).not.toBe("");
    vi.spyOn(column()!, "getBoundingClientRect").mockReturnValue({
      left: 900,
      right: 1280,
      top: 40,
      bottom: 800,
    } as DOMRect);
    vi.spyOn(invoker.value!, "getBoundingClientRect").mockReturnValue({
      left: 1000,
      right: 1100,
      top: 100,
      bottom: 130,
    } as DOMRect);
    invoker.value!.focus();
    await flushPromises();
    expect(store.sidebarForcedPinned.value).toBe(true);
    expect(column()!.dataset.mode).toBe("pinned");
    expect(store.state.shell.sidebarMode).toBe("pinned");
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
    store.moveTo({ kind: "sidebar", mode: "pinned" });
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

  it("counts any overlap as covered and a rect that only touches the card's edge as clear", () => {
    const card = { left: 10, right: 20, top: 0, bottom: 50 } as DOMRect;
    expect(coveredBy({ left: 12, right: 18, top: 5, bottom: 10 } as DOMRect, card)).toBe(true);
    expect(coveredBy({ left: 5, right: 11, top: 5, bottom: 10 } as DOMRect, card)).toBe(true);
    expect(coveredBy({ left: 0, right: 10, top: 5, bottom: 10 } as DOMRect, card)).toBe(false);
    expect(coveredBy({ left: 12, right: 18, top: 50, bottom: 60 } as DOMRect, card)).toBe(false);
  });
});

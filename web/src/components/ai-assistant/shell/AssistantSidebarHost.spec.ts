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

  it("judges coverage by the whole rect", () => {
    const card = { left: 10, right: 20, top: 0, bottom: 50 } as DOMRect;
    expect(coveredBy({ left: 12, right: 18, top: 5, bottom: 10 } as DOMRect, card)).toBe(true);
    expect(coveredBy({ left: 5, right: 18, top: 5, bottom: 10 } as DOMRect, card)).toBe(false);
  });
});

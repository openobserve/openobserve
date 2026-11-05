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

import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";

import { runEscapeLadder } from "@/composables/assistant";

import { fakeAssistant, fakeRouter, fakeVuex } from "../__tests__/fakeAssistant";
import AssistantWindow from "./AssistantWindow.vue";

const { fake, lg, track } = vi.hoisted(() => ({
  fake: { current: null as any },
  lg: { value: true },
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
  };
});
vi.mock("@/composables/assistant", async (importOriginal) => {
  const { computed } = await import("vue");
  const original = await importOriginal<typeof import("@/composables/assistant")>();
  return {
    ...original,
    useAssistantStore: () => fake.current.store,
    useAssistantHistory: () => fake.current.history,
    useAssistantCapability: () => fake.current.handle,
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

const ORIGIN = { entryKind: "header_button", objectKind: "none", container: "window" } as const;

const AREA = { start: 6, end: 90, top: 3, bottom: 60, viewport: 90 };

function setup(over: Record<string, unknown> = {}) {
  const { store } = fake.current;
  const sid = store.createSession({ origin: ORIGIN, detached: true });
  store.floatChat(sid, { focus: "none" });
  const wrapper = mount(AssistantWindow, {
    props: { win: store.windowOf(sid), area: AREA, bandRem: 0, focused: true, ...over },
    global: { plugins: [fakeRouter(), fakeVuex()] },
    attachTo: document.body,
  });
  mounted.push(wrapper);
  return { wrapper, store, sid };
}

const mounted: VueWrapper[] = [];

const dialog = (wrapper: VueWrapper) => wrapper.get('[data-test="assistant-window"]');

const vars = (wrapper: VueWrapper) => {
  const { style } = dialog(wrapper).element as HTMLElement;
  return ["x", "y", "w", "h"].map((k) => Number(style.getPropertyValue(`--o-window-${k}`)));
};

const pointer = async (wrapper: VueWrapper, type: string, at: [number, number], target?: Element) =>
  (target ?? dialog(wrapper).element).dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      button: 0,
      pointerId: 1,
      clientX: at[0],
      clientY: at[1],
    }),
  );

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  lg.value = true;
  fake.current = fakeAssistant();
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  mounted.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
  track.mockClear();
});

describe("AssistantWindow", () => {
  it("is a non-modal dialog with its own chat, drawn at its geometry", async () => {
    const { wrapper, sid } = setup();
    await flushPromises();
    const el = dialog(wrapper);
    expect(el.attributes("role")).toBe("dialog");
    expect(el.attributes("aria-modal")).toBe("false");
    expect(el.attributes("aria-label")).toContain("O2 Assistant");
    expect(el.attributes("data-assistant-window")).toBe(sid);
    expect(wrapper.get('[data-test="assistant-shell-window"]').attributes("data-sid")).toBe(sid);
    expect(vars(wrapper)).toEqual([65.5, 23.5, 24, 36]);
  });

  it("minimises and closes through its title bar", async () => {
    const { wrapper } = setup();
    await wrapper.get('[data-test="assistant-window-minimise"]').trigger("click");
    expect(wrapper.emitted("minimise")).toEqual([["button"]]);
    const close = wrapper.get('[data-test="assistant-window-close"]');
    expect(close.attributes("aria-label")).toBe("Close window");
    await close.trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("draws the focused window with the strong border and heading title, the others muted", async () => {
    const { wrapper } = setup();
    await flushPromises();
    expect(dialog(wrapper).classes()).toContain("border-border-strong");
    expect(dialog(wrapper).classes()).not.toContain("border-border-default");
    const bar = () => wrapper.get('[data-test="assistant-window-titlebar"]').classes();
    expect(bar()).toContain("[&_[data-test=assistant-thread-title]]:text-text-heading");
    await wrapper.setProps({ focused: false });
    expect(dialog(wrapper).classes()).toContain("border-border-default");
    expect(dialog(wrapper).classes()).not.toContain("border-border-strong");
    expect(bar()).toContain("[&_[data-test=assistant-thread-title]]:text-text-secondary");
  });

  it("drags from the title bar and stores the geometry, snapped near a corner", async () => {
    const { wrapper, store, sid } = setup();
    const bar = wrapper.get('[data-test="assistant-window-titlebar"]').element;
    await pointer(wrapper, "pointerdown", [800, 400], bar);
    await pointer(wrapper, "pointermove", [160, 90]);
    await nextTick();
    expect(vars(wrapper).slice(0, 2)).toEqual([25.5, 3.5]);
    await pointer(wrapper, "pointerup", [160, 90]);
    expect(store.windowOf(sid).geometry).toMatchObject({ corner: "top-start" });
    expect(track).toHaveBeenCalledWith("ai_window_moved", { snap: "edge" });
  });

  it("never starts a drag from a title bar control", async () => {
    const { wrapper } = setup();
    const before = vars(wrapper);
    const button = wrapper.get('[data-test="assistant-window-minimise"]').element;
    await pointer(wrapper, "pointerdown", [800, 400], button);
    await pointer(wrapper, "pointermove", [100, 100]);
    await nextTick();
    expect(vars(wrapper)).toEqual(before);
  });

  it("offers the tray and the sidebar as drop targets while dragging", async () => {
    const { wrapper } = setup();
    const bar = wrapper.get('[data-test="assistant-window-titlebar"]').element;
    await pointer(wrapper, "pointerdown", [800, 400], bar);
    await pointer(wrapper, "pointermove", [800, 950]);
    expect(wrapper.emitted("drop-target")?.at(-1)).toEqual(["tray"]);
    await pointer(wrapper, "pointerup", [800, 950]);
    expect(wrapper.emitted("minimise")).toEqual([["drop"]]);

    await pointer(wrapper, "pointerdown", [800, 400], bar);
    await pointer(wrapper, "pointermove", [1420, 400]);
    await pointer(wrapper, "pointerup", [1420, 400]);
    expect(wrapper.emitted("pin")).toHaveLength(1);
  });

  it("resizes from an edge and stores the size", async () => {
    const { wrapper, store, sid } = setup();
    const edge = wrapper.get('[data-resize-edge="w"]').element;
    await pointer(wrapper, "pointerdown", [500, 400], edge);
    await pointer(wrapper, "pointermove", [436, 400]);
    await pointer(wrapper, "pointerup", [436, 400]);
    expect(store.windowOf(sid).geometry.wRem).toBe(28);
    expect(track).toHaveBeenCalledWith("ai_window_resized", {});
  });

  it("raises on pointer down inside the transcript, not only on focus", async () => {
    const { wrapper, store, sid } = setup();
    const other = store.createSession({ origin: ORIGIN, detached: true });
    store.floatChat(other, { focus: "none" });
    expect(store.state.shell.lastFocusedContainer).toEqual({ window: other });
    await pointer(wrapper, "pointerdown", [800, 500], dialog(wrapper).element);
    expect(store.state.shell.lastFocusedContainer).toEqual({ window: sid });
  });

  it("keeps Layout on a default window's bar, which its borders leave 2 px under 24 rem", async () => {
    const rect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ width: 382 } as DOMRect);
    const { wrapper } = setup();
    await flushPromises();
    expect(wrapper.find('[data-test="assistant-layout-button"]').exists()).toBe(true);
    rect.mockRestore();
  });

  it("folds Layout into the title menu below 24 rem and keeps Minimise and Close direct (PO A15)", async () => {
    const wide = setup();
    expect(wide.wrapper.find('[data-test="assistant-layout-button"]').exists()).toBe(true);
    wide.wrapper.unmount();
    const { wrapper, store, sid } = setup();
    store.setWindowGeometry(sid, { ...store.windowOf(sid).geometry, wRem: 20 });
    await wrapper.setProps({ win: { ...store.windowOf(sid) } });
    await flushPromises();
    expect(wrapper.find('[data-test="assistant-layout-button"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="assistant-window-minimise"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="assistant-window-close"]').exists()).toBe(true);
  });

  it("keeps a focusable grip; arrows move, Shift+arrows resize, Enter places (B95)", async () => {
    const { wrapper, store, sid } = setup();
    const grip = wrapper.get('[data-test="assistant-window-grip"]');
    expect(grip.attributes("data-o2-btn")).toBeDefined();
    expect(grip.attributes("aria-label")).toContain("Move");
    expect(wrapper.find('[data-test="assistant-window-move-mode"]').exists()).toBe(false);
    await grip.trigger("keydown", { key: "ArrowLeft" });
    await grip.trigger("keydown", { key: "ArrowUp" });
    await nextTick();
    expect(wrapper.emitted("mode-started")).toEqual([["move"]]);
    expect(wrapper.get('[data-test="assistant-window-move-mode"]').text()).toContain("Arrows move");
    expect(vars(wrapper).slice(0, 2)).toEqual([64.5, 22.5]);
    const size = vars(wrapper).slice(2, 4);
    await grip.trigger("keydown", { key: "ArrowLeft", shiftKey: true });
    await nextTick();
    expect(wrapper.emitted("mode-started")).toEqual([["move"], ["resize"]]);
    expect(grip.attributes("aria-label")).toContain("Resize");
    expect(vars(wrapper)[2]).toBe(size[0] - 1);
    await grip.trigger("keydown", { key: "Enter" });
    await nextTick();
    expect(wrapper.find('[data-test="assistant-window-move-mode"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="assistant-window-grip"]').exists()).toBe(true);
    expect(wrapper.emitted("announce")).toEqual([["windowPlaced"]]);
    expect(store.windowOf(sid).geometry).toMatchObject({ dxRem: 2.5, wRem: size[0] - 1 });
  });

  it("caps a resize at the page's bottom gap instead of moving the window up", async () => {
    const { wrapper } = setup();
    const grip = wrapper.get('[data-test="assistant-window-grip"]');
    const [, y] = vars(wrapper);
    await grip.trigger("keydown", { key: "ArrowDown", shiftKey: true });
    await grip.trigger("keydown", { key: "ArrowDown", shiftKey: true });
    await nextTick();
    expect(vars(wrapper)[1]).toBe(y);
    expect(vars(wrapper)[1] + vars(wrapper)[3]).toBe(AREA.bottom - 0.5);
    const edge = wrapper.get('[data-resize-edge="s"]').element;
    await pointer(wrapper, "pointerdown", [500, 900], edge);
    await pointer(wrapper, "pointermove", [500, 1200]);
    expect(vars(wrapper)[1]).toBe(y);
    expect(vars(wrapper)[1] + vars(wrapper)[3]).toBe(AREA.bottom - 0.5);
  });

  it("keeps the window 8 px inside every edge of the page", async () => {
    const { wrapper } = setup();
    const grip = wrapper.get('[data-test="assistant-window-grip"]');
    for (let i = 0; i < 80; i++) await grip.trigger("keydown", { key: "ArrowLeft" });
    for (let i = 0; i < 30; i++) await grip.trigger("keydown", { key: "ArrowUp" });
    await nextTick();
    expect(vars(wrapper).slice(0, 2)).toEqual([AREA.start + 0.5, AREA.top + 0.5]);
  });

  it("restores the geometry on rung e and stays in the window", async () => {
    const { wrapper, store, sid } = setup();
    const start = { ...store.windowOf(sid).geometry };
    await (wrapper.vm as unknown as { startMode(m: string): Promise<void> }).startMode("move");
    await flushPromises();
    const grip = wrapper.get('[data-test="assistant-window-grip"]');
    await grip.trigger("keydown", { key: "ArrowLeft" });
    let handled = false;
    grip.element.addEventListener(
      "keydown",
      (e) => (handled = runEscapeLadder(e as KeyboardEvent)),
      {
        once: true,
      },
    );
    grip.element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(handled).toBe(true);
    await nextTick();
    expect(store.windowOf(sid).geometry).toMatchObject({ dxRem: start.dxRem, dyRem: start.dyRem });
    expect(wrapper.emitted("announce")).toEqual([["moveCancelled"]]);
  });
});

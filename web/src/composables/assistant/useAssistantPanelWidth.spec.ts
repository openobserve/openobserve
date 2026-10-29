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

import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import { createStore } from "vuex";

import * as breakpoint from "@/composables/useBreakpoint";

import { fakeRuntime } from "./__tests__/fakeRuntime";
import { reportDockWidth } from "./hostAdapter";
import { setRuntimeHandle } from "./runtimeHandle";
import {
  RESIZE_SIGNAL_FALLBACK_MS,
  resetPanelWidthForTests,
  scheduleResizeSignal,
  useAssistantPanelWidth,
  type AssistantPanelWidth,
} from "./useAssistantPanelWidth";

const { flag, runtime, lg } = vi.hoisted(() => ({
  flag: { on: false },
  runtime: { current: null as any },
  lg: { value: true },
}));

vi.mock("./flags", () => ({ isAssistantV2: () => flag.on }));
vi.mock("@/composables/useBreakpoint", async () => {
  const { computed, reactive } = await import("vue");
  const state = reactive(lg);
  return {
    default: () => ({ lgUp: computed(() => state.value), mdUp: computed(() => true) }),
    __state: state,
  };
});

function read(vuexState: Record<string, unknown> = {}): AssistantPanelWidth {
  let width: AssistantPanelWidth | null = null;
  mount(
    defineComponent({
      setup() {
        width = useAssistantPanelWidth();
        return () => h("div");
      },
    }),
    { global: { plugins: [createStore({ state: () => vuexState })] } },
  );
  return width!;
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  resetPanelWidthForTests();
  vi.stubGlobal("innerWidth", 1280);
  flag.on = false;
  (breakpoint as unknown as { __state: { value: boolean } }).__state.value = true;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useAssistantPanelWidth with the revamp off", () => {
  it("returns the legacy flag-derived width, so the readers migrate once", () => {
    expect(read({ isAiChatEnabled: false }).panelWidthRem.value).toBe(0);
    const open = read({ isAiChatEnabled: true, isAiChatExpanded: false });
    expect(open.panelWidthRem.value).toBe(20);
    expect(open.placement.value).toBe("sidebar");
    expect(open.floating.value).toBe(false);
    expect(read({ isAiChatEnabled: true, isAiChatExpanded: true }).panelWidthRem.value).toBe(40);
  });
});

describe("useAssistantPanelWidth with the revamp on", () => {
  beforeEach(() => {
    flag.on = true;
    runtime.current = fakeRuntime();
    setRuntimeHandle(runtime.current);
  });

  it("reports the width the pinned sidebar draws at: stored, held so <main> keeps 32 rem", async () => {
    const { store } = runtime.current;
    const width = read();
    expect(width.panelWidthRem.value).toBe(0);
    store.open({ kind: "sidebar", mode: "pinned" }, { focus: "none" });
    store.setSidebarWidth(24);
    expect(width.panelWidthRem.value).toBe(24);
    store.setSidebarWidth(30);
    expect(width.panelWidthRem.value).toBe(26.5);
    vi.stubGlobal("innerWidth", 960);
    window.dispatchEvent(new Event("resize"));
    await nextTick();
    expect(width.panelWidthRem.value).toBe(22.5);
  });

  it("reports 0 while floating, so nothing squeezes under the card", () => {
    const { store } = runtime.current;
    const width = read();
    store.setSidebarMode("floating");
    store.open({ kind: "sidebar", mode: "floating" }, { focus: "none" });
    expect(width.floating.value).toBe(true);
    expect(width.panelWidthRem.value).toBe(0);
  });

  it("reports the open dock's measured width, and 0 below lg where it is a sheet", () => {
    const { store, hosts } = runtime.current;
    hosts.register({ id: "alert_query" } as never);
    const width = read();
    store.open({ kind: "docked", hostId: "alert_query" }, { focus: "none" });
    reportDockWidth("alert_query", 28);
    expect(width.panelWidthRem.value).toBe(28);
    expect(width.placement.value).toBe("docked");
    (breakpoint as unknown as { __state: { value: boolean } }).__state.value = false;
    expect(width.panelWidthRem.value).toBe(0);
  });

  it("dispatches one window resize after the layout settles, never in the same tick", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => frames.push(fn));
    const resized = vi.fn();
    window.addEventListener("resize", resized);
    const { store } = runtime.current;
    const width = read();
    store.open({ kind: "sidebar", mode: "pinned" }, { focus: "none" });
    await nextTick();
    store.setSidebarWidth(26);
    await nextTick();
    expect(width.panelWidthRem.value).toBe(26);
    expect(resized).not.toHaveBeenCalled();
    for (let i = 0; i < 20 && frames.length; i++) frames.shift()!(0);
    expect(resized).toHaveBeenCalledTimes(1);
    window.removeEventListener("resize", resized);
  });
});

describe("scheduleResizeSignal", () => {
  it("waits for the column's transitionend, with a fallback when none comes", () => {
    vi.useFakeTimers();
    const column = document.createElement("div");
    column.style.transitionProperty = "width";
    column.style.transitionDuration = "0.15s";
    Object.defineProperty(column, "offsetWidth", { value: 384 });
    document.body.appendChild(column);
    const resized = vi.fn();
    window.addEventListener("resize", resized);
    scheduleResizeSignal(column);
    scheduleResizeSignal(column);
    expect(resized).not.toHaveBeenCalled();
    column.dispatchEvent(new Event("transitionend"));
    expect(resized).toHaveBeenCalledTimes(1);
    scheduleResizeSignal(column);
    vi.advanceTimersByTime(RESIZE_SIGNAL_FALLBACK_MS);
    expect(resized).toHaveBeenCalledTimes(2);
    window.removeEventListener("resize", resized);
    column.remove();
  });
});

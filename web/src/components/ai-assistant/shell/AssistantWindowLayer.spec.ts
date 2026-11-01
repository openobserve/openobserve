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
import { defineComponent, h, nextTick } from "vue";

import { runEscapeLadder } from "@/composables/assistant";

import { fakeAssistant, fakeRouter, fakeVuex } from "../__tests__/fakeAssistant";
import AssistantWindowLayer from "./AssistantWindowLayer.vue";

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

const newChat = () => fake.current.store.createSession({ origin: ORIGIN, detached: true });

const mounted: VueWrapper[] = [];

async function setup(path = "/logs") {
  const router = fakeRouter();
  await router.push(path);
  const wrapper = mount(
    defineComponent({
      setup: () => () =>
        h("div", [
          h("main", { "data-test": "main-content" }, [h("button", { id: "page" }, "page")]),
          h(AssistantWindowLayer),
        ]),
    }),
    { global: { plugins: [router, fakeVuex()] }, attachTo: document.body },
  );
  mounted.push(wrapper);
  await flushPromises();
  return { wrapper, router };
}

const windows = () => document.body.querySelectorAll('[data-test="assistant-window"]');

const tray = () => document.body.querySelector('[data-test="assistant-tray"]');

const status = () =>
  document.body.querySelector('[data-test="assistant-window-status"]')?.textContent ?? "";

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  lg.value = true;
  fake.current = fakeAssistant();
  vi.stubGlobal("CSS", { escape: (value: string) => value });
});

afterEach(() => {
  mounted.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
  document.body.style.pointerEvents = "";
  vi.unstubAllGlobals();
  track.mockClear();
});

describe("AssistantWindowLayer", () => {
  it("renders one window per open chat, each with its own chat, and a bar per minimised one", async () => {
    const { store } = fake.current;
    const [a, b, c] = [newChat(), newChat(), newChat()];
    for (const sid of [a, b, c]) store.floatChat(sid, { focus: "none" });
    await setup();
    expect(windows()).toHaveLength(2);
    const shown = [...windows()].map((w) => (w as HTMLElement).dataset.assistantWindow);
    expect(shown.sort()).toEqual([b, c].sort());
    expect(document.body.querySelectorAll('[data-test="assistant-tray-bar"]')).toHaveLength(1);
  });

  it("shows nothing below lg or on the full view, and keeps the windows for when they return", async () => {
    const { store } = fake.current;
    const sid = newChat();
    store.floatChat(sid, { focus: "none" });
    await setup("/assistant");
    expect(windows()).toHaveLength(0);
    expect(store.windowOf(sid)?.state).toBe("open");
    mounted.splice(0).forEach((wrapper) => wrapper.unmount());
    lg.value = false;
    await setup();
    expect(windows()).toHaveLength(0);
  });

  it("minimises on Escape from inside a window (rung g) and reports the reason", async () => {
    const { store } = fake.current;
    const sid = newChat();
    store.floatChat(sid, { focus: "none" });
    await setup();
    const el = windows()[0] as HTMLElement;
    let handled = false;
    el.addEventListener("keydown", (e) => (handled = runEscapeLadder(e as KeyboardEvent)), {
      once: true,
    });
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(handled).toBe(true);
    expect(store.windowOf(sid)?.state).toBe("minimised");
    expect(track).toHaveBeenCalledWith("ai_window_minimised", { reason: "escape" });
    await flushPromises();
    expect(windows()).toHaveLength(0);
    expect(tray()).not.toBeNull();
  });

  it("leaves Escape outside a window to the other rungs", async () => {
    const { store } = fake.current;
    const sid = newChat();
    store.floatChat(sid, { focus: "none" });
    await setup();
    const page = document.getElementById("page")!;
    page.addEventListener("keydown", (e) => runEscapeLadder(e as KeyboardEvent), { once: true });
    page.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(store.windowOf(sid)?.state).toBe("open");
  });

  it("speaks a move through its own status region", async () => {
    const { store } = fake.current;
    const sid = newChat();
    await setup();
    store.floatChat(sid, { focus: "none" });
    await flushPromises();
    expect(status()).toContain("is now a floating window.");
  });

  it("goes inert under a modal scrim", async () => {
    const { store } = fake.current;
    store.floatChat(newChat(), { focus: "none" });
    await setup();
    document.body.style.pointerEvents = "none";
    await flushPromises();
    await nextTick();
    expect(
      document.body.querySelector('[data-test="assistant-window-layer"]')!.hasAttribute("inert"),
    ).toBe(true);
  });

  it("reserves the tray's band for page content while a bar shows", async () => {
    const { store } = fake.current;
    const sid = newChat();
    store.floatChat(sid, { focus: "none" });
    await setup();
    const band = () =>
      document.documentElement.style.getPropertyValue("--o-assistant-inset-bottom");
    expect(band()).toBe("");
    store.minimiseWindow(sid, "button");
    await flushPromises();
    expect(band()).toBe("56");
    store.closeWindow(sid);
    await flushPromises();
    expect(band()).toBe("");
  });

  it("collapses a window that fully covers a keyboard-focused page control, and undoes it (SC 2.4.11)", async () => {
    const { store } = fake.current;
    const sid = newChat();
    store.floatChat(sid, { focus: "none" });
    await setup();
    const el = windows()[0] as HTMLElement;
    const page = document.getElementById("page")!;
    el.getBoundingClientRect = () => ({ left: 0, right: 500, top: 0, bottom: 500 }) as DOMRect;
    page.getBoundingClientRect = () =>
      ({ left: 100, right: 200, top: 300, bottom: 340 }) as DOMRect;
    vi.spyOn(page, "matches").mockReturnValue(true);
    page.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await flushPromises();
    expect(el.hasAttribute("data-collapsed")).toBe(true);
    document.body.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await flushPromises();
    expect(el.hasAttribute("data-collapsed")).toBe(false);
  });

  it("returns focus to the page control it came from after the last window minimises", async () => {
    const { store } = fake.current;
    const sid = newChat();
    store.floatChat(sid, { focus: "none" });
    await setup();
    const page = document.getElementById("page")!;
    page.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    const minimise = document.body.querySelector<HTMLElement>(
      '[data-test="assistant-window-minimise"]',
    )!;
    minimise.focus();
    minimise.click();
    await flushPromises();
    expect(document.activeElement).toBe(page);
  });
});

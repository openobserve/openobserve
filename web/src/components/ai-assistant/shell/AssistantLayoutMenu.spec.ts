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
import { defineComponent, h } from "vue";

import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";

import { fakeAssistant, fakeRouter, fakeVuex } from "../__tests__/fakeAssistant";
import { historyStubs } from "../__tests__/historyStubs";
import AssistantLayoutMenu, { placementMode } from "./AssistantLayoutMenu.vue";
import type { AssistantLayoutMenuProps } from "./AssistantLayoutMenu.vue";
import { assistantWindowHostKey, type AssistantWindowHost } from "./assistantWindowHost";

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

const ORIGIN = { entryKind: "header_button", objectKind: "none", container: "sidebar" } as const;

// The bare menu renders its items inside whichever dropdown hosts it, so a spec opens one around it.
async function setup(props: Partial<AssistantLayoutMenuProps>, windowHost?: AssistantWindowHost) {
  const router = fakeRouter();
  await router.push("/logs");
  const wrapper = mount(
    defineComponent({
      setup: () => () =>
        h(
          ODropdown,
          { open: true },
          {
            trigger: () => h("button", "open"),
            default: () =>
              h(AssistantLayoutMenu, {
                placement: "sidebar",
                sid: fake.current.store.state.shell.activeSid,
                bare: true,
                ...props,
              }),
          },
        ),
    }),
    {
      global: {
        plugins: [router, fakeVuex()],
        stubs: { ODropdownSub: historyStubs.ODropdownSub },
        provide: windowHost ? { [assistantWindowHostKey as symbol]: windowHost } : {},
      },
      attachTo: document.body,
    },
  );
  await flushPromises();
  return { wrapper, router };
}

const item = (name: string) =>
  document.body.querySelector<HTMLElement>(`[data-test="assistant-shell-place-${name}"]`);

const anyTest = (name: string) => document.body.querySelector<HTMLElement>(`[data-test="${name}"]`);

const windowHost = (): AssistantWindowHost => ({
  otherCorners: () => ["top-start", "top-end", "bottom-start"],
  moveTo: vi.fn(),
  sizeLimited: (step) => step === "narrower",
  stepSize: vi.fn(),
  resetSize: vi.fn(),
  startMode: vi.fn(),
});

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  lg.value = true;
  fake.current = fakeAssistant();
  fake.current.store.createSession({ origin: ORIGIN });
  fake.current.store.open({ kind: "sidebar" }, { focus: "none" });
});

afterEach(() => {
  document.body.innerHTML = "";
  track.mockClear();
});

describe("Places", () => {
  it("offers sidebar, window and full view on a desktop sidebar with the current one checked", async () => {
    await setup({});
    expect(item("sidebar")!.getAttribute("aria-checked")).toBe("true");
    expect(item("window")!.getAttribute("aria-checked")).toBe("false");
    expect(item("full")).not.toBeNull();
    expect(item("dock")).toBeNull();
  });

  it("floats the chat and closes the sidebar", async () => {
    const { store } = fake.current;
    const sid = store.state.shell.activeSid;
    await setup({});
    item("window")!.click();
    await flushPromises();
    expect(store.windowOf(sid)).toMatchObject({ state: "open" });
    expect(store.state.shell.placement.kind).toBe("hidden");
    expect(track).toHaveBeenCalledWith("ai_window_opened", { from: "layout" });
    expect(track).toHaveBeenCalledWith("ai_container_moved", {
      from: "sidebar",
      to: "window",
      turn_running: false,
    });
  });

  it("disables Floating window at the cap of 4 and names the limit", async () => {
    const { store } = fake.current;
    const sid = store.state.shell.activeSid;
    for (let i = 0; i < 4; i += 1)
      store.floatChat(store.createSession({ origin: ORIGIN, detached: true }), { focus: "none" });
    await setup({ sid });
    expect(item("window")!.getAttribute("aria-disabled")).toBe("true");
    expect(item("window")!.textContent).toContain("Limit is 4. Close one first.");
  });

  it("drops Floating window below lg, where windows do not exist", async () => {
    lg.value = false;
    await setup({ placement: "full" });
    expect(item("window")).toBeNull();
    expect(item("sidebar")).not.toBeNull();
    expect(item("full")).not.toBeNull();
  });

  it("offers only Full view on the sheet", async () => {
    lg.value = false;
    await setup({ sheet: true });
    expect(item("sidebar")).toBeNull();
    expect(item("window")).toBeNull();
    expect(item("full")).not.toBeNull();
  });

  it("offers only Full view in a modal dock (decision 11)", async () => {
    await setup({ placement: "docked", dockHost: "alert_query" });
    expect(item("window")).toBeNull();
    expect(item("sidebar")).toBeNull();
    expect(item("full")).not.toBeNull();
  });

  it("moves a window's chat to the full view by its own sid", async () => {
    const { store } = fake.current;
    const sid = store.state.shell.activeSid;
    store.floatChat(sid);
    const { router } = await setup({ placement: "window", sid });
    item("full")!.click();
    await flushPromises();
    expect(store.windowOf(sid)).toBeNull();
    expect(store.state.shell.activeSid).toBe(sid);
    expect(router.currentRoute.value.name).toBe("assistant");
  });

  it("pins a window's chat from Sidebar", async () => {
    const { store } = fake.current;
    const sid = store.state.shell.activeSid;
    store.floatChat(sid);
    await setup({ placement: "window", sid });
    item("sidebar")!.click();
    await flushPromises();
    expect(store.windowOf(sid)).toBeNull();
    expect(store.state.shell.placement.kind).toBe("sidebar");
  });
});

describe("Width submenu", () => {
  it("shows on a desktop sidebar only", async () => {
    await setup({});
    expect(anyTest("assistant-shell-width-default")).not.toBeNull();
    expect(anyTest("assistant-shell-width-expanded")).not.toBeNull();
    document.body.innerHTML = "";
    await setup({ placement: "full" });
    expect(anyTest("assistant-shell-width-default")).toBeNull();
  });

  it("steps by 4 rem and keeps the menu open", async () => {
    const { store } = fake.current;
    store.setSidebarWidth(24);
    await setup({});
    anyTest("assistant-shell-width-narrower")!.click();
    await flushPromises();
    expect(store.state.shell.sidebarWidthRem).toBe(20);
    expect(anyTest("assistant-shell-width-narrower")!.getAttribute("aria-disabled")).toBe("true");
  });
});

describe("Position and Size", () => {
  it("lists the other three corners and hands a pick to the window", async () => {
    const host = windowHost();
    const { store } = fake.current;
    const sid = store.state.shell.activeSid;
    store.floatChat(sid);
    await setup({ placement: "window", sid }, host);
    expect(anyTest("assistant-window-move-to-bottom-right")).toBeNull();
    anyTest("assistant-window-move-to-top-left")!.click();
    expect(host.moveTo).toHaveBeenCalledWith("top-start");
  });

  it("disables a step at the limit and hands the rest to the window", async () => {
    const host = windowHost();
    const { store } = fake.current;
    const sid = store.state.shell.activeSid;
    store.floatChat(sid);
    await setup({ placement: "window", sid }, host);
    expect(anyTest("assistant-window-narrower")!.getAttribute("aria-disabled")).toBe("true");
    anyTest("assistant-window-wider")!.click();
    expect(host.stepSize).toHaveBeenCalledWith("wider");
    anyTest("assistant-window-move-keyboard")!.click();
    expect(host.startMode).toHaveBeenCalledWith("move");
  });
});

describe("placementMode", () => {
  it("names the sheet, and every other placement as itself", () => {
    expect(placementMode("sidebar", true)).toBe("sheet");
    expect(placementMode("sidebar", false)).toBe("sidebar");
    expect(placementMode("window", false)).toBe("window");
    expect(placementMode("full", false)).toBe("full");
  });
});

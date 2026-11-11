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
import { raw } from "@/types/i18n";

import { fakeAssistant, fakeRouter, fakeVuex } from "../__tests__/fakeAssistant";
import { historyStubs } from "../__tests__/historyStubs";
import AssistantOpenAsMenu, { placementMode } from "./AssistantOpenAsMenu.vue";
import type { AssistantOpenAsMenuProps } from "./AssistantOpenAsMenu.vue";

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
async function setup(props: Partial<AssistantOpenAsMenuProps>) {
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
              h(AssistantOpenAsMenu, {
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
      },
      attachTo: document.body,
    },
  );
  await flushPromises();
  return { wrapper, router };
}

const item = (name: string) =>
  document.body.querySelector<HTMLElement>(`[data-test="assistant-shell-place-${name}"]`);

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

describe("Open as", () => {
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

  it("disables Floating window at the cap of 4", async () => {
    const { store } = fake.current;
    const sid = store.state.shell.activeSid;
    for (let i = 0; i < 4; i += 1)
      store.floatChat(store.createSession({ origin: ORIGIN, detached: true }), { focus: "none" });
    await setup({ sid });
    expect(item("window")!.getAttribute("aria-disabled")).toBe("true");
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

  it("starts an empty full-page chat from a chat with messages, leaving that chat as it was", async () => {
    const { store } = fake.current;
    const sid = store.state.shell.activeSid;
    store.state.sessions[sid].messages.push({
      role: "user",
      content: raw("why 5xx?"),
      turnId: "t1",
    });
    const { router } = await setup({});
    expect(item("full-new")!.textContent).toContain("New chat in full page");
    item("full-new")!.click();
    await flushPromises();
    const fresh = store.state.shell.activeSid;
    expect(fresh).not.toBe(sid);
    expect(store.state.sessions[fresh].messages).toHaveLength(0);
    expect(store.state.sessions[sid].messages).toHaveLength(1);
    expect(store.state.shell.placement.kind).toBe("full");
    expect(router.currentRoute.value.name).toBe("assistant");
    expect(router.currentRoute.value.params.chatId).toBeFalsy();
  });

  it("offers no separate new full-page chat when the chat is already empty", async () => {
    await setup({});
    expect(item("full")).not.toBeNull();
    expect(item("full-new")).toBeNull();
  });

  it("pins a window's chat from Side panel", async () => {
    const { store } = fake.current;
    const sid = store.state.shell.activeSid;
    store.floatChat(sid);
    await setup({ placement: "window", sid });
    item("sidebar")!.click();
    await flushPromises();
    expect(store.windowOf(sid)).toBeNull();
    expect(store.state.shell.placement.kind).toBe("sidebar");
  });

  it("names the moves Side panel, Full page and Floating window, in the board's order", async () => {
    await setup({});
    const items = document.body.querySelectorAll('[role="menuitemradio"], [role="menuitem"]');
    expect([...items].map((el) => el.getAttribute("data-test"))).toEqual([
      "assistant-shell-place-sidebar",
      "assistant-shell-place-full",
      "assistant-shell-place-window",
    ]);
    expect([...items].map((el) => el.textContent?.trim())).toEqual([
      "Side panel",
      "Full page",
      "Floating window",
    ]);
    expect(document.body.querySelector('[role="separator"]')).toBeNull();
  });

  it("opens from its own Open as trigger with the moves under one label", async () => {
    const router = fakeRouter();
    await router.push("/logs");
    const wrapper = mount(AssistantOpenAsMenu, {
      props: { placement: "sidebar", sid: fake.current.store.state.shell.activeSid },
      global: { plugins: [router, fakeVuex()] },
      attachTo: document.body,
    });
    await flushPromises();
    const trigger = wrapper.get('[data-test="assistant-open-as-button"]');
    expect(trigger.attributes("aria-label")).toBe("Open as");
    await trigger.trigger("click");
    await flushPromises();
    expect(document.body.querySelector('[data-test="assistant-open-as"]')?.textContent).toContain(
      "Open as",
    );
    expect(item("full")).not.toBeNull();
    wrapper.unmount();
  });

  it("reads Open as on the full page, where the bar has room for the word", async () => {
    const router = fakeRouter();
    await router.push("/logs");
    const wrapper = mount(AssistantOpenAsMenu, {
      props: { placement: "full", sid: null, labelled: true },
      global: { plugins: [router, fakeVuex()] },
      attachTo: document.body,
    });
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-open-as-button"]').text()).toBe("Open as");
    wrapper.unmount();
  });

  it("drops the labelled button's word to assistive tech on a phone, keeping its name, so the title has room", async () => {
    const router = fakeRouter();
    await router.push("/logs");
    const wrapper = mount(AssistantOpenAsMenu, {
      props: { placement: "full", sid: null, labelled: true },
      global: { plugins: [router, fakeVuex()] },
      attachTo: document.body,
    });
    await flushPromises();
    const button = wrapper.get('[data-test="assistant-open-as-button"]');
    expect(button.attributes("aria-label")).toBe("Open as");
    expect(button.get("span.max-md\\:sr-only").text()).toBe("Open as");
    expect(button.classes()).toContain("max-md:min-w-11");
    wrapper.unmount();
  });

  it("drops the labelled button's chevron on a phone, so the bar keeps one 44px icon (B-shell3-7)", async () => {
    const router = fakeRouter();
    await router.push("/logs");
    const mountMenu = () =>
      mount(AssistantOpenAsMenu, {
        props: { placement: "full", sid: null, labelled: true },
        global: { plugins: [router, fakeVuex()] },
        attachTo: document.body,
      });
    const wide = mountMenu();
    await flushPromises();
    const icons = (w: typeof wide) =>
      w.get('[data-test="assistant-open-as-button"]').findAllComponents({ name: "OIcon" }).length;
    const wideIcons = icons(wide);
    wide.unmount();
    lg.value = false;
    const phone = mountMenu();
    await flushPromises();
    expect(icons(phone)).toBe(wideIcons - 1);
    phone.unmount();
    lg.value = true;
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

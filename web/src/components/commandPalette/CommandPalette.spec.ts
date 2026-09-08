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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { h } from "vue";
import { createRouter, createMemoryHistory } from "vue-router";
import { createStore } from "vuex";
import { raw } from "@/types/i18n";
import i18n from "@/locales";
import CommandPalette from "./CommandPalette.vue";
import { useFrecency } from "./useFrecency";

vi.mock("./providers/entities", () => ({
  createEntityProviders: () => [
    {
      id: "dashboards",
      scope: "dashboard",
      enabled: () => true,
      list: async () => [
        {
          id: "dashboard:default/d1",
          type: "dashboard",
          label: "Payments overview",
          subtitle: "default",
          icon: "dashboard",
          route: { path: "/dashboards/view", query: { dashboard: "d1", folder: "default" } },
        },
      ],
    },
  ],
}));

vi.mock("@/composables/useStreams", () => ({
  default: () => ({ getPaginatedStreams: vi.fn().mockResolvedValue({ list: [] }) }),
}));

vi.mock("@/services/settings", () => ({
  default: {
    getSetting: vi.fn().mockRejectedValue({}),
    setUserSetting: vi.fn().mockResolvedValue({}),
  },
}));

const ODialogStub = {
  props: ["open"],
  emits: ["update:open"],
  template:
    '<div v-if="open" data-test="dialog"><slot name="header" /><slot /><slot name="footer" /></div>',
};
const OSearchInputStub = {
  inheritAttrs: false,
  props: ["modelValue", "placeholder"],
  emits: ["update:modelValue"],
  setup(
    props: { modelValue: string },
    { emit }: { emit: (e: "update:modelValue", v: string) => void },
  ) {
    return () =>
      h("input", {
        "data-test": "command-palette-search-field",
        placeholder: props.placeholder,
        value: props.modelValue,
        onInput: (e: Event) => emit("update:modelValue", (e.target as HTMLInputElement).value),
      });
  },
};
const stub = { template: "<span />" };

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "home", component: { template: "<div />" } },
      { path: "/logs", name: "logs", component: { template: "<div />" } },
      { path: "/alerts", name: "alertList", component: { template: "<div />" } },
      { path: "/dashboards", name: "dashboards", component: { template: "<div />" } },
    ],
  });
}

const store = createStore({
  state: () => ({
    theme: "light",
    zoConfig: {},
    organizationData: {},
    selectedOrganization: { identifier: "org1" },
    userInfo: { email: "me@example.com" },
  }),
  actions: { appTheme: vi.fn() },
});

const navLinks = [
  { name: "home", link: "/", title: raw("Home"), icon: "home" },
  { name: "logs", link: "/logs", title: raw("Logs"), icon: "search" },
  { name: "alertList", link: "/alerts", title: raw("Alerts"), icon: "shield" },
];

describe("CommandPalette", () => {
  let wrapper: VueWrapper;
  let router: ReturnType<typeof makeRouter>;

  beforeEach(async () => {
    useFrecency().reset();
    window.localStorage.clear();
    router = makeRouter();
    await router.push("/");
    wrapper = mount(CommandPalette, {
      props: { open: true, navLinks },
      attachTo: document.body,
      global: {
        plugins: [store, i18n, router],
        stubs: {
          ODialog: ODialogStub,
          OSearchInput: OSearchInputStub,
          OShortcut: stub,
          OIcon: stub,
          OEmptyState: stub,
        },
      },
    });
    await flushPromises();
  });

  afterEach(() => {
    wrapper.unmount();
    vi.restoreAllMocks();
  });

  const rowIds = () => wrapper.findAll('[role="option"]').map((r) => r.attributes("data-item-id"));

  it("lists actions then pages when the query is empty", () => {
    const ids = rowIds();
    expect(ids).toContain("action:newAlert");
    expect(ids).toContain("page:logs");
    expect(ids.indexOf("action:newAlert")).toBeLessThan(ids.indexOf("page:logs"));
    expect(wrapper.find('[data-test="command-palette-group-h:actions"]').exists()).toBe(true);
  });

  it("filters as the user types and Enter opens the active row with org_identifier", async () => {
    const push = vi.spyOn(router, "push").mockResolvedValue(undefined as any);
    await wrapper.find('[data-test="command-palette-search-field"]').setValue("log");
    expect(rowIds()).toEqual(["page:logs"]);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flushPromises();
    expect(push).toHaveBeenCalledWith({ path: "/logs", query: { org_identifier: "org1" } });
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
  });

  it("moves the selection with the arrow keys and wraps", async () => {
    const count = rowIds().length;
    const active = () =>
      wrapper.find('[role="option"][aria-selected="true"]').attributes("data-item-id");
    const first = active();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));
    await flushPromises();
    expect(active()).toBe(rowIds()[count - 1]);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    await flushPromises();
    expect(active()).toBe(first);
  });

  it("opens in a new tab on Meta+Enter and records frecency", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    await wrapper.find('[data-test="command-palette-search-field"]').setValue("alerts");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true }));
    await flushPromises();
    expect(open).toHaveBeenCalledWith(
      expect.stringContaining("/alerts?org_identifier=org1"),
      "_blank",
      "noopener",
    );
    expect(useFrecency().topItems("palette_item", 1)).toEqual(["page:alertList"]);
  });

  it("shows the frecency block first on the next open", async () => {
    useFrecency().record("palette_item", "page:logs");
    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });
    await flushPromises();
    expect(wrapper.find('[data-test="command-palette-group-h:recent"]').exists()).toBe(true);
    expect(rowIds()[0]).toBe("page:logs");
  });

  it("emits open-shortcuts for the shortcuts row", async () => {
    await wrapper.find('[data-test="command-palette-search-field"]').setValue("keyboard");
    await wrapper.find('[role="option"]').trigger("click");
    expect(wrapper.emitted("open-shortcuts")).toHaveLength(1);
  });

  it("lists entities from providers and ranks them with pages", async () => {
    await wrapper.find('[data-test="command-palette-search-field"]').setValue("payments");
    expect(rowIds()).toEqual(["dashboard:default/d1"]);
  });

  it("toggles scope chips with Tab, supports multi-select, and Backspace pops the last scope", async () => {
    expect(wrapper.find('[data-test="command-palette-scopes"]').exists()).toBe(false);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    await flushPromises();
    expect(wrapper.find('[data-test="command-palette-scopes"]').exists()).toBe(true);
    await wrapper.find('[data-test="command-palette-scope-dashboard"]').trigger("click");
    await flushPromises();
    expect(rowIds()).toEqual(["action:newDashboard", "dashboard:default/d1"]);
    const pressed = () =>
      wrapper
        .findAll('[data-test^="command-palette-scope-"][aria-pressed="true"]')
        .map((c) => c.attributes("data-test"));
    expect(pressed()).toEqual(["command-palette-scope-dashboard"]);
    await wrapper.find('[data-test="command-palette-scope-pages"]').trigger("click");
    await flushPromises();
    expect(pressed()).toHaveLength(2);
    expect(rowIds()).toContain("page:logs");
    expect(rowIds()).toContain("dashboard:default/d1");
    expect(rowIds()).not.toContain("action:newAlert");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace" }));
    await flushPromises();
    expect(pressed()).toEqual(["command-palette-scope-dashboard"]);
    expect(rowIds()).not.toContain("page:logs");
    await wrapper.find('[data-test="command-palette-scope-clear"]').trigger("click");
    await flushPromises();
    expect(pressed()).toEqual([]);
    expect(wrapper.find('[data-test="command-palette-scope-clear"]').exists()).toBe(false);
  });

  it("summarises the selected scopes in the placeholder and drops it when all are selected", async () => {
    const placeholder = () =>
      wrapper.find('[data-test="command-palette-search-field"]').attributes("placeholder");
    const initial = placeholder();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    await flushPromises();
    const chips = wrapper
      .findAll('[data-test^="command-palette-scope-"]')
      .filter((c) => !c.attributes("data-test")!.endsWith("-clear"));
    await chips[0].trigger("click");
    await flushPromises();
    expect(placeholder()).not.toBe(initial);
    expect(placeholder()).not.toContain("+");
    for (const chip of chips.slice(1)) await chip.trigger("click");
    await flushPromises();
    expect(placeholder()).toBe(initial);
  });

  it("moves along the chip row with the arrows and toggles with Enter", async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    await flushPromises();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await flushPromises();
    expect(
      wrapper.find('[data-test="command-palette-scope-pages"]').attributes("aria-pressed"),
    ).toBe("true");
    expect(wrapper.emitted("update:open")).toBeUndefined();
  });

  it("keeps chip order fixed while open and reorders only on the next open", async () => {
    const chips = () =>
      wrapper
        .findAll('[data-test^="command-palette-scope-"]')
        .map((c) => c.attributes("data-test"));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    await flushPromises();
    const before = chips();
    expect(before[0]).toBe("command-palette-scope-actions");
    await wrapper.find('[data-test="command-palette-scope-dashboard"]').trigger("click");
    await flushPromises();
    expect(chips().filter((c) => c !== "command-palette-scope-clear")).toEqual(before);
    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });
    await flushPromises();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    await flushPromises();
    expect(chips()[0]).toBe("command-palette-scope-dashboard");
  });

  it("offers the AI hand-off only when enabled and nothing matches", async () => {
    await wrapper.find('[data-test="command-palette-search-field"]').setValue("zzqxv");
    expect(rowIds()).toEqual([]);
    await wrapper.setProps({ aiEnabled: true });
    await flushPromises();
    expect(rowIds()).toEqual(["ai:ask"]);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await flushPromises();
    expect(wrapper.emitted("ask-ai")).toEqual([["zzqxv"]]);
  });
});

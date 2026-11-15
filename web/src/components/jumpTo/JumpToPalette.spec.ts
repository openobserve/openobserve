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

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computed, defineComponent, h, nextTick } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { createStore } from "vuex";
import i18n from "@/locales";
import { raw } from "@/types/i18n";
import { PAGE_NAV_CONTEXT_KEY } from "@/lib/core/PageHeader/pageContext";
import type { NavItem } from "@/lib/core/Navbar/ONavbar.types";
import JumpToPalette from "./JumpToPalette.vue";

const Page = defineComponent({ render: () => h("div") });
const ROUTE_NAMES = [
  ["home", "/"],
  ["logs", "/logs"],
  ["alertList", "/alerts"],
  ["alertDestinations", "/alert-destinations"],
  ["billings", "/billings"],
  ["settings", "/settings"],
  ["general", "/settings/general"],
  ["organizationSettings", "/settings/organization"],
  ["ingestion", "/ingestion"],
  ["addAlert", "/alerts/add"],
  ["dashboards", "/dashboards"],
] as const;

const links: NavItem[] = [
  { title: raw("Home"), icon: "home", link: "/", name: "home" },
  { title: raw("Logs"), icon: "search", link: "/logs", name: "logs" },
  { title: raw("Alerts"), icon: "shield-alert-outline", link: "/alerts", name: "alertList" },
  { title: raw("Billing"), icon: "payments", link: "/billings", name: "billings", locked: true },
  { title: raw("Settings"), icon: "settings", link: "/settings", name: "settings" },
  { title: raw("Data sources"), icon: "data-plus-line", link: "/ingestion", name: "ingestion" },
  { title: raw("Dashboards"), icon: "dashboard", link: "/dashboards", name: "dashboards" },
];

// The dialog is stubbed so its body renders inline; the palette owns every key it handles.
const ODialogStub = defineComponent({
  props: { open: Boolean },
  emits: ["update:open"],
  setup:
    (props, { slots }) =>
    () =>
      props.open ? h("div", { "data-stub-dialog": "" }, slots.default?.()) : null,
});

let router: Router;
let wrapper: VueWrapper | undefined;

const mountPalette = async (open = true) => {
  router = createRouter({
    history: createMemoryHistory(),
    routes: ROUTE_NAMES.map(([name, path]) => ({ name, path, component: Page })),
  });
  await router.push("/logs");
  const store = createStore({
    state: {
      selectedOrganization: { identifier: "default" },
      zoConfig: {},
      organizationData: { organizationSettings: {} },
    },
  });
  wrapper = mount(JumpToPalette, {
    props: { open, "onUpdate:open": (v: boolean) => wrapper?.setProps({ open: v }) },
    global: {
      plugins: [i18n, router, store],
      provide: {
        [PAGE_NAV_CONTEXT_KEY as symbol]: {
          links: computed(() => links),
          flat: computed(() => false),
        },
      },
      stubs: { ODialog: ODialogStub },
    },
  });
  await flushPromises();
  return wrapper;
};

const search = () => wrapper!.get('[data-test="jump-to-palette-search"] input');
const items = () =>
  wrapper!.findAll('[data-test^="jump-to-palette-item-"]').map((i) => i.attributes("data-test"));
const active = () => wrapper!.get('[aria-selected="true"]').attributes("data-test");

describe("JumpToPalette", () => {
  beforeEach(() => window.localStorage.removeItem("o2.jumpTo.areaVisits"));
  afterEach(() => wrapper?.unmount());

  it("lists the rail's destinations under their area heading, each with its icon and label", async () => {
    await mountPalette();
    expect(items()).toEqual(
      expect.arrayContaining([
        "jump-to-palette-item-home",
        "jump-to-palette-item-logs",
        "jump-to-palette-item-reliability:alertList:",
        "jump-to-palette-item-reliability:alertDestinations:",
      ]),
    );
    const row = wrapper!.get('[data-test="jump-to-palette-item-logs"]');
    const icon = wrapper!
      .findAllComponents({ name: "OIcon" })
      .find((i) => row.element.contains(i.element));
    expect(icon?.props("name")).toBe("search");
    expect(row.text()).toBe("Logs");
    const group = wrapper!.get('[data-test="jump-to-palette-group-observability"]');
    expect(group.text()).toContain("Observability");
    expect(group.element.contains(row.element)).toBe(true);
    expect(wrapper!.find('[data-test="jump-to-palette-group-reliability"]').exists()).toBe(true);
  });

  it("leaves out a locked destination the rail shows inert", async () => {
    await mountPalette();
    expect(items()).not.toContain("jump-to-palette-item-billings");
  });

  it("lists a module rail's own sections instead of its landing link", async () => {
    await mountPalette();
    expect(items()).toEqual(
      expect.arrayContaining([
        "jump-to-palette-item-settings:general",
        "jump-to-palette-item-settings:organization",
      ]),
    );
    expect(items()).not.toContain("jump-to-palette-item-settings");
  });

  it("filters by a substring of the label or the area and says when nothing matches", async () => {
    await mountPalette();
    await search().setValue("destin");
    await flushPromises();
    expect(items()).toEqual(["jump-to-palette-item-reliability:alertDestinations:"]);

    await search().setValue("observab");
    await flushPromises();
    expect(items()).toEqual([
      "jump-to-palette-item-home",
      "jump-to-palette-item-logs",
      "jump-to-palette-item-dashboards",
    ]);

    await search().setValue("nothing-like-this");
    await flushPromises();
    expect(items()).toEqual([]);
    expect(wrapper!.find('[data-test="jump-to-palette-empty"]').exists()).toBe(true);
  });

  it("moves with the arrow keys, wrapping at the ends", async () => {
    await mountPalette();
    expect(active()).toBe(items()[0]);
    await search().trigger("keydown", { key: "ArrowDown" });
    expect(active()).toBe(items()[1]);
    await search().trigger("keydown", { key: "ArrowUp" });
    await search().trigger("keydown", { key: "ArrowUp" });
    expect(active()).toBe(items()[items().length - 1]);
  });

  it("opens the active destination on Enter and closes", async () => {
    await mountPalette();
    await search().setValue("destin");
    await flushPromises();
    await search().trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("alertDestinations");
    expect(router.currentRoute.value.query.org_identifier).toBe("default");
    expect(wrapper!.emitted("update:open")?.at(-1)).toEqual([false]);
  });

  it("closes on Escape even with text in the field", async () => {
    await mountPalette();
    await search().setValue("log");
    await search().trigger("keydown", { key: "Escape" });
    expect(wrapper!.emitted("update:open")?.at(-1)).toEqual([false]);
  });

  it("puts the areas this browser visits most first when the query is empty", async () => {
    await mountPalette();
    const firstArea = () =>
      wrapper!.find('[data-test^="jump-to-palette-group-"]').attributes("data-test");
    expect(firstArea()).toBe("jump-to-palette-group-observability");

    await router.push("/alerts");
    await router.push("/alert-destinations");
    await flushPromises();
    await wrapper!.setProps({ open: false });
    await wrapper!.setProps({ open: true });
    await nextTick();
    expect(firstArea()).toBe("jump-to-palette-group-reliability");
  });

  it("lists no actions until something is typed", async () => {
    await mountPalette();
    expect(wrapper!.find('[data-test="jump-to-palette-group-actions"]').exists()).toBe(false);
  });

  it("puts matching actions in their own group above the pages, naming the page each opens", async () => {
    await mountPalette();
    await search().setValue("new");
    await flushPromises();
    const groups = wrapper!.findAll('[data-test^="jump-to-palette-group-"]');
    expect(groups[0].attributes("data-test")).toBe("jump-to-palette-group-actions");
    expect(items()).toEqual([
      "jump-to-palette-item-actions:newAlert",
      "jump-to-palette-item-actions:newDashboard",
    ]);
    expect(wrapper!.get('[data-test="jump-to-palette-hint-actions:newAlert"]').text()).toBe(
      "All alerts",
    );
  });

  it("leaves out an action whose page the rails do not offer", async () => {
    await mountPalette();
    await search().setValue("new pipeline");
    await flushPromises();
    expect(items()).toEqual([]);
  });

  it("finds Add data by its page's name and by the name in its URL", async () => {
    await mountPalette();
    await search().setValue("add");
    await flushPromises();
    expect(items()[0]).toBe("jump-to-palette-item-actions:addData");

    await search().setValue("ingestion");
    await flushPromises();
    expect(items()).toEqual([
      "jump-to-palette-item-actions:addData",
      "jump-to-palette-item-data:ingestion:",
    ]);
  });

  it("ranks a page above an action that matches it less well", async () => {
    await mountPalette();
    await search().setValue("dash");
    await flushPromises();
    expect(items()[0]).toBe("jump-to-palette-item-dashboards");
    expect(items()).toContain("jump-to-palette-item-actions:newDashboard");
  });

  it("runs an action on Enter with the org in its link", async () => {
    await mountPalette();
    await search().setValue("new alert");
    await flushPromises();
    await search().trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("addAlert");
    expect(router.currentRoute.value.query.org_identifier).toBe("default");

    await wrapper!.setProps({ open: true });
    await search().setValue("new dash");
    await flushPromises();
    await search().trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("dashboards");
    expect(router.currentRoute.value.query.action).toBe("add");
  });
});

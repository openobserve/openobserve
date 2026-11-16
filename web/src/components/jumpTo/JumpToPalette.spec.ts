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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computed, defineComponent, h, nextTick } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { createStore } from "vuex";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import i18n from "@/locales";
import { raw } from "@/types/i18n";
import { PAGE_NAV_CONTEXT_KEY } from "@/lib/core/PageHeader/pageContext";
import type { NavItem } from "@/lib/core/Navbar/ONavbar.types";
import { b64DecodeUnicode } from "@/utils/formatters";
import alerts from "@/services/alerts";
import dashboards from "@/services/dashboards";
import stream from "@/services/stream";
import JumpToPalette from "./JumpToPalette.vue";

vi.mock("@/services/alerts", () => ({ default: { listByFolderId: vi.fn() } }));
vi.mock("@/services/dashboards", () => ({ default: { list: vi.fn() } }));
vi.mock("@/services/stream", () => ({ default: { nameList: vi.fn() } }));

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
  ["alertDetail", "/alerts/detail/:alert_id"],
  ["viewDashboard", "/dashboards/view"],
  ["logstreams", "/streams"],
  ["metrics", "/metrics"],
] as const;

const links: NavItem[] = [
  { title: raw("Home"), icon: "home", link: "/", name: "home" },
  { title: raw("Logs"), icon: "search", link: "/logs", name: "logs" },
  { title: raw("Alerts"), icon: "shield-alert-outline", link: "/alerts", name: "alertList" },
  { title: raw("Billing"), icon: "payments", link: "/billings", name: "billings", locked: true },
  { title: raw("Settings"), icon: "settings", link: "/settings", name: "settings" },
  { title: raw("Data sources"), icon: "data-plus-line", link: "/ingestion", name: "ingestion" },
  { title: raw("Dashboards"), icon: "dashboard", link: "/dashboards", name: "dashboards" },
  { title: raw("Metrics"), icon: "bar-chart", link: "/metrics", name: "metrics" },
  { title: raw("Streams"), icon: "window", link: "/streams", name: "streams" },
];

type Lists = {
  alerts?: { alert_id: string; name: string; folder_id: string; folder_name: string }[];
  dashboards?: { dashboard_id: string; title: string; folder_id: string; folder_name: string }[];
  streams?: Record<string, { name: string }[]>;
};

// Each list answers from the rows given, and a dashboard search filters by title as the server does.
const serve = ({ alerts: alertRows = [], dashboards: boards = [], streams = {} }: Lists = {}) => {
  vi.mocked(alerts.listByFolderId).mockResolvedValue({ data: { list: alertRows } } as any);
  vi.mocked(dashboards.list).mockImplementation((async (...args: any[]) => ({
    data: {
      dashboards: boards.filter((d) => d.title.toLowerCase().includes(String(args[7]))),
    },
  })) as any);
  vi.mocked(stream.nameList).mockImplementation((async (_org: string, type: string) => ({
    data: { list: streams[type] ?? [] },
  })) as any);
};

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

const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

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
      plugins: [
        i18n,
        router,
        store,
        [
          VueQueryPlugin,
          { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        ],
      ],
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
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    serve();
  });
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
      "jump-to-palette-item-metrics",
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

  describe("objects", () => {
    const groupKeys = () =>
      wrapper!
        .findAll('[data-test^="jump-to-palette-group-"]')
        .map((g) => g.attributes("data-test")!.replace("jump-to-palette-group-", ""));

    it("finds alerts, dashboards and streams by name, each kind ending in its Show all row", async () => {
      serve({
        alerts: [{ alert_id: "a1", name: "payments_5xx", folder_id: "f1", folder_name: "Ops" }],
        dashboards: [
          { dashboard_id: "d1", title: "Payments latency", folder_id: "f2", folder_name: "Biz" },
        ],
        streams: { logs: [{ name: "payments" }], metrics: [{ name: "cpu" }] },
      });
      await mountPalette();
      await search().setValue("pay");
      await settle();
      await flushPromises();
      expect(groupKeys()).toEqual([
        "objects:alerts",
        "objects:dashboards",
        "objects:streams",
        "search-logs",
      ]);
      expect(items()).toEqual([
        "jump-to-palette-item-objects:alerts:a1",
        "jump-to-palette-item-objects:alerts:all",
        "jump-to-palette-item-objects:dashboards:d1",
        "jump-to-palette-item-objects:dashboards:all",
        "jump-to-palette-item-objects:streams:logs:payments",
        "jump-to-palette-item-objects:streams:all",
        "jump-to-palette-item-search-logs",
      ]);
      expect(wrapper!.get('[data-test="jump-to-palette-hint-objects:alerts:a1"]').text()).toBe(
        "Ops",
      );
      expect(wrapper!.get('[data-test="jump-to-palette-item-objects:alerts:all"]').text()).toBe(
        "Show all in Alerts",
      );
    });

    it("opens a kind's list with the text searched across folders", async () => {
      serve({
        alerts: [{ alert_id: "a1", name: "payments_5xx", folder_id: "f1", folder_name: "Ops" }],
        dashboards: [{ dashboard_id: "d1", title: "Payments", folder_id: "f", folder_name: "f" }],
      });
      await mountPalette();
      for (const [kind, page] of [
        ["alerts", "alertList"],
        ["dashboards", "dashboards"],
      ]) {
        await wrapper!.setProps({ open: true });
        await search().setValue("pay");
        await settle();
        await flushPromises();
        await wrapper!
          .get(`[data-test="jump-to-palette-item-objects:${kind}:all"]`)
          .trigger("click");
        await flushPromises();
        expect(router.currentRoute.value.name).toBe(page);
        expect(router.currentRoute.value.query).toEqual({
          org_identifier: "default",
          "v.search": "pay",
          "v.all": "true",
        });
      }
    });

    it("shows at most five of a kind before its Show all row", async () => {
      serve({
        alerts: Array.from({ length: 7 }, (_, i) => ({
          alert_id: `a${i}`,
          name: `pay ${i}`,
          folder_id: "default",
          folder_name: "default",
        })),
      });
      await mountPalette();
      await search().setValue("pay");
      await flushPromises();
      const alertRows = items().filter((key) => key!.includes("objects:alerts:"));
      expect(alertRows).toHaveLength(6);
      expect(alertRows.at(-1)).toBe("jump-to-palette-item-objects:alerts:all");
    });

    it("opens an alert's own page on Enter", async () => {
      serve({
        alerts: [{ alert_id: "a1", name: "slow_checkout", folder_id: "f1", folder_name: "Ops" }],
      });
      await mountPalette();
      await search().setValue("slow");
      await flushPromises();
      await search().trigger("keydown", { key: "Enter" });
      await flushPromises();
      expect(router.currentRoute.value.name).toBe("alertDetail");
      expect(router.currentRoute.value.params.alert_id).toBe("a1");
      expect(router.currentRoute.value.query).toMatchObject({
        org_identifier: "default",
        folder: "f1",
      });
    });

    it("keeps the Dashboards page first for dash, above a dashboard named like it", async () => {
      serve({
        dashboards: [{ dashboard_id: "d1", title: "uxinv dash", folder_id: "f", folder_name: "f" }],
      });
      await mountPalette();
      await search().setValue("dash");
      await settle();
      await flushPromises();
      expect(items()).toContain("jump-to-palette-item-objects:dashboards:d1");
      expect(active()).toBe("jump-to-palette-item-dashboards");
      await search().trigger("keydown", { key: "Enter" });
      await flushPromises();
      expect(router.currentRoute.value.name).toBe("dashboards");
    });

    it("searches the logs for the text in the stream Logs last used", async () => {
      serve({ streams: { logs: [{ name: "app_logs" }, { name: "nginx" }] } });
      window.localStorage.setItem(
        "oo_logs_selected_stream_logs_default",
        JSON.stringify(["nginx"]),
      );
      await mountPalette();
      await search().setValue("it's down");
      await flushPromises();
      expect(items()).toEqual(["jump-to-palette-item-search-logs"]);
      expect(wrapper!.get('[data-test="jump-to-palette-item-search-logs"]').text()).toBe(
        `Search logs for "it's down"`,
      );
      await search().trigger("keydown", { key: "Enter" });
      await flushPromises();
      const { query } = router.currentRoute.value;
      expect(router.currentRoute.value.path).toBe("/logs");
      expect(query).toMatchObject({ stream: "nginx", period: "15m", sql_mode: "false" });
      expect(b64DecodeUnicode(String(query.query))).toBe("it's down");
    });

    it("leaves out a kind the user may not read, and keeps the others", async () => {
      serve({ streams: { logs: [{ name: "payments" }] } });
      vi.mocked(alerts.listByFolderId).mockRejectedValue({ response: { status: 403 } });
      await mountPalette();
      await search().setValue("pay");
      await flushPromises();
      expect(groupKeys()).toEqual(["objects:streams", "search-logs"]);
      expect(vi.mocked(alerts.listByFolderId).mock.calls[0].at(-1)).toEqual({
        silentForbidden: true,
      });
    });

    it("reads each list once and searches dashboards only once typing settles", async () => {
      await mountPalette();
      for (const text of ["p", "pa", "pay", "paym"]) await search().setValue(text);
      await flushPromises();
      expect(dashboards.list).not.toHaveBeenCalled();
      await settle();
      await flushPromises();
      expect(alerts.listByFolderId).toHaveBeenCalledTimes(1);
      // This rail has no Traces page, so its streams are not read.
      expect(vi.mocked(stream.nameList).mock.calls.map((call) => call[1])).toEqual([
        "logs",
        "metrics",
      ]);
      expect(dashboards.list).toHaveBeenCalledTimes(1);
      expect(vi.mocked(dashboards.list).mock.calls[0][7]).toBe("paym");
    });

    it("keeps a row the user moved to while later results arrive", async () => {
      serve({
        alerts: [{ alert_id: "a1", name: "payments", folder_id: "f", folder_name: "f" }],
        dashboards: [{ dashboard_id: "d1", title: "Payments", folder_id: "f", folder_name: "f" }],
      });
      await mountPalette();
      await search().setValue("payments");
      await flushPromises();
      await search().trigger("keydown", { key: "ArrowDown" });
      expect(active()).toBe("jump-to-palette-item-objects:alerts:all");
      await settle();
      await flushPromises();
      expect(items()).toContain("jump-to-palette-item-objects:dashboards:d1");
      expect(active()).toBe("jump-to-palette-item-objects:alerts:all");
    });
  });
});

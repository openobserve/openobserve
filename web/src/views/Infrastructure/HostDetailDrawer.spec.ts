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

// Host detail drawer (design 4.8/§6) — assertions run on the captured dashboard object, never ECharts.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { createStore } from "vuex";
import { createRouter, createMemoryHistory } from "vue-router";
import { defineComponent } from "vue";
import HostDetailDrawer from "./HostDetailDrawer.vue";
import searchService from "@/services/search";
import i18n from "@/locales";

const { importHostMetricsDashboard, toastMock } = vi.hoisted(() => ({
  importHostMetricsDashboard: vi.fn(),
  toastMock: vi.fn(),
}));

vi.mock("@/composables/useHostMetricsDashboard", () => ({ importHostMetricsDashboard }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: toastMock }));

vi.mock("@/services/search", () => ({
  default: { search: vi.fn(), metrics_query: vi.fn(), metrics_query_range: vi.fn() },
}));

const searchMock = vi.mocked(searchService.search);

let lastDashboardData: any = null;
const renderChartsStub = defineComponent({
  name: "RenderDashboardCharts",
  props: ["dashboardData", "currentTimeObj", "viewOnly", "searchType", "initialVariableValues"],
  created() {
    lastDashboardData = (this as any).dashboardData;
  },
  updated() {
    lastDashboardData = (this as any).dashboardData;
  },
  template: "<div class='render-stub' />",
});

// Captures all picker attrs so the init-from-page-range pin needn't hardcode the prop name.
const dateTimeCapture: Record<string, any> = {};
const dateTimeStub = defineComponent({
  name: "DateTime",
  inheritAttrs: false,
  created() {
    Object.assign(dateTimeCapture, (this as any).$attrs);
  },
  template: "<div data-test='drawer-datetime-stub' />",
});

const RANGE = { from: 1_700_000_000_000_000, to: 1_700_000_900_000_000 };

const allDashboardQueries = (): string[] => {
  const tabs = lastDashboardData?.tabs ?? [];
  return tabs.flatMap((t: any) =>
    (t.panels ?? []).flatMap((p: any) => (p.queries ?? []).map((q: any) => q.query as string)),
  );
};

const t = (key: string) => i18n.global.t(key);

describe("HostDetailDrawer", () => {
  let wrapper: VueWrapper<any>;
  let router: any;

  const mountDrawer = async (props: Record<string, any> = {}) => {
    const store = createStore({
      state: {
        selectedOrganization: { identifier: "test-org" },
        timezone: "UTC",
        theme: "light",
        zoConfig: {},
      },
    });
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/", component: { template: "<div />" } },
        { path: "/logs", name: "logs", component: { template: "<div />" } },
        { path: "/traces", name: "traces", component: { template: "<div />" } },
        { path: "/dashboards/view", name: "viewDashboard", component: { template: "<div />" } },
      ],
    });
    vi.spyOn(router, "push");
    const w = mount(HostDetailDrawer, {
      props: { hostName: "web-01", status: "ACTIVE", range: { ...RANGE }, ...props },
      global: {
        plugins: [store, router, i18n],
        stubs: {
          RenderDashboardCharts: renderChartsStub,
          DateTime: dateTimeStub,
          ODrawer: { template: "<div><slot /><slot name='footer' /></div>" },
          teleport: true,
        },
      },
    });
    await flushPromises();
    return w;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    lastDashboardData = null;
    for (const k of Object.keys(dateTimeCapture)) delete dateTimeCapture[k];
    searchMock.mockResolvedValue({ data: { hits: [{ _timestamp: 1, log: "x" }] } } as any);
    importHostMetricsDashboard.mockResolvedValue({
      status: "created",
      dashboardId: "dash-1",
      folderId: "default",
    });
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  it("renders the Metrics / Logs / Traces tabs", async () => {
    wrapper = await mountDrawer();
    expect(wrapper.find('[data-test="host-drawer-tab-metrics"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="host-drawer-tab-logs"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="host-drawer-tab-traces"]').exists()).toBe(true);
  });

  describe("built inline dashboard", () => {
    it("is a v8 document with no variables, every query pinned to the literal host", async () => {
      wrapper = await mountDrawer();
      expect(lastDashboardData).toBeTruthy();
      expect(lastDashboardData.version).toBe(8);
      // Single host is fixed — a variables block would render dead selectors.
      expect(lastDashboardData.variables?.list ?? []).toHaveLength(0);
      const queries = allDashboardQueries();
      expect(queries.length).toBeGreaterThan(0);
      for (const q of queries) {
        expect(q).toContain('host_name="web-01"');
        expect(q).not.toContain("$host_name");
      }
    });

    it("backslash-escapes a double quote in the host name instead of excluding the host", async () => {
      wrapper = await mountDrawer({ hostName: 'he"llo' });
      const queries = allDashboardQueries();
      expect(queries.length).toBeGreaterThan(0);
      for (const q of queries) {
        expect(q).toContain('host_name="he\\"llo"');
      }
    });

    it("backslash-escapes a backslash in the host name in PromQL string values", async () => {
      // 4.8: escape " AND \ — an unescaped \ silently corrupts the matcher.
      wrapper = await mountDrawer({ hostName: "corp\\web-01" });
      const queries = allDashboardQueries();
      expect(queries.length).toBeGreaterThan(0);
      for (const q of queries) {
        expect(q).toContain('host_name="corp\\\\web-01"');
      }
    });
  });

  // The Logs/Traces panes may render lazily — open the tab before asserting.
  const openTab = async (tab: string) => {
    await wrapper.find(`[data-test="host-drawer-tab-${tab}"]`).trigger("click");
    await flushPromises();
  };

  describe("logs tab", () => {
    it("previews the last 100 logs for the host over the picker window", async () => {
      wrapper = await mountDrawer();
      await openTab("logs");
      expect(searchMock).toHaveBeenCalled();
      const args: any = searchMock.mock.calls[0][0];
      const sql: string = args.query.query.sql;
      expect(sql).toContain('FROM "default"');
      expect(sql).toContain("host_name = 'web-01'");
      expect(sql).toContain("ORDER BY _timestamp DESC");
      expect(sql).toContain("LIMIT 100");
      expect(args.query.query.start_time).toBe(RANGE.from);
      expect(args.query.query.end_time).toBe(RANGE.to);
    });

    it("doubles a single quote in the host name in the SQL literal", async () => {
      wrapper = await mountDrawer({ hostName: "o'brien" });
      await openTab("logs");
      const args: any = searchMock.mock.calls[0][0];
      expect(args.query.query.sql).toContain("'o''brien'");
    });

    it("names the stream in the zero-row state so a wrong constant self-diagnoses", async () => {
      searchMock.mockResolvedValue({ data: { hits: [] } } as any);
      wrapper = await mountDrawer();
      await openTab("logs");
      const empty = wrapper.find('[data-test="host-drawer-logs-empty"]');
      expect(empty.exists()).toBe(true);
      expect(empty.text()).toContain("No logs found in stream");
      // {stream} resolved to the LOGS_STREAM constant — scoped so "default" can't match elsewhere.
      expect(empty.text()).toContain("default");
    });

    it("builds the Explore-in-Logs URL with all nine constructLogsUrl params", async () => {
      wrapper = await mountDrawer();
      await openTab("logs");
      const link = wrapper.find('[data-test="host-drawer-explore-logs"]');
      expect(link.exists()).toBe(true);
      const href = link.attributes("href") ?? "";
      for (const param of [
        "stream_type",
        "stream",
        "from",
        "to",
        "sql_mode",
        "query",
        "org_identifier",
        "quick_mode",
        "show_histogram",
      ]) {
        expect(href, param).toContain(`${param}=`);
      }
    });
  });

  describe("traces tab", () => {
    it("hands off to /traces carrying the time range and the host filter", async () => {
      wrapper = await mountDrawer();
      await openTab("traces");
      const link = wrapper.find('[data-test="host-drawer-traces-link"]');
      expect(link.exists()).toBe(true);
      const href = link.attributes("href") ?? "";
      expect(href).toContain("/traces");
      expect(href).toContain("from=");
      expect(href).toContain("to=");
      expect(href).toContain("host_name");
      // The filter must carry the actual host value, not just the label name.
      expect(href).toContain("web-01");
    });
  });

  it("initializes its DateTime picker from the Hosts page picker's range", async () => {
    // The drawer must open showing the window the row was computed over.
    wrapper = await mountDrawer();
    const captured = JSON.stringify(dateTimeCapture);
    expect(captured).toContain(String(RANGE.from));
    expect(captured).toContain(String(RANGE.to));
  });

  describe("footer — Open Host Metrics dashboard", () => {
    it("imports if absent, then navigates carrying var-host_name plus the drawer range", async () => {
      wrapper = await mountDrawer();
      await wrapper.find('[data-test="host-drawer-open-dashboard"]').trigger("click");
      await flushPromises();
      // A user can reach /infra/hosts without the setup flow (pass-4 finding 7).
      expect(importHostMetricsDashboard).toHaveBeenCalledWith("test-org");
      expect(router.push).toHaveBeenCalledTimes(1);
      const target: any = vi.mocked(router.push).mock.calls[0][0];
      expect(target.path).toBe("/dashboards/view");
      expect(target.query.dashboard).toBe("dash-1");
      expect(target.query.folder).toBe("default");
      expect(target.query["var-host_name"]).toBe("web-01");
      expect(Number(target.query.from)).toBe(RANGE.from);
      expect(Number(target.query.to)).toBe(RANGE.to);
    });

    it("navigates to the existing dashboard on exists", async () => {
      importHostMetricsDashboard.mockResolvedValue({
        status: "exists",
        dashboardId: "dash-old",
        folderId: "default",
      });
      wrapper = await mountDrawer();
      await wrapper.find('[data-test="host-drawer-open-dashboard"]').trigger("click");
      await flushPromises();
      const target: any = vi.mocked(router.push).mock.calls[0][0];
      expect(target.query.dashboard).toBe("dash-old");
    });

    it("shows the cause-naming toast by kind and does NOT navigate on error", async () => {
      importHostMetricsDashboard.mockResolvedValue({
        status: "error",
        kind: "forbidden",
        message: "403",
      });
      wrapper = await mountDrawer();
      await wrapper.find('[data-test="host-drawer-open-dashboard"]').trigger("click");
      await flushPromises();
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: t("ingestion.setupCard.hostDashboardImportForbidden"),
        }),
      );
      expect(router.push).not.toHaveBeenCalled();
    });
  });
});

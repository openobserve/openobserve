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
import { mount, flushPromises } from "@vue/test-utils";
import { inject, reactive } from "vue";
import { encodeMetricsConfig, getMetricsConfig } from "@/composables/metrics/metricsUrlState";

// Only an explicit Run writes history; auto-refresh, deep links and refresh share runQuery.

const api = vi.hoisted(() => ({
  record: vi.fn(),
  list: vi.fn(),
  star: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@/services/query_history", () => ({ default: api }));

const route = vi.hoisted(() => ({ query: {} as Record<string, any> }));
vi.mock("vue-router", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(() => Promise.resolve()) }),
  useRoute: () => ({
    get query() {
      return route.query;
    },
    fullPath: "/metrics/editor",
  }),
}));

const mockStore = vi.hoisted(() => ({
  state: {
    theme: "light",
    selectedOrganization: { identifier: "org1" },
    zoConfig: { min_auto_refresh_interval: 5 },
  },
}));
vi.mock("vuex", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  useStore: () => mockStore,
}));

const showErrorNotification = vi.hoisted(() => vi.fn());
vi.mock("@/composables/useNotifications", () => ({
  default: () => ({ showErrorNotification }),
}));

const shortcuts = vi.hoisted(() => ({ handlers: {} as Record<string, () => void> }));
vi.mock("@/lib/vue-shortcut-manager", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  useShortcuts: (list: Array<{ id: string; handler: () => void }>) =>
    list.forEach((s) => (shortcuts.handlers[s.id] = s.handler)),
}));

const validatePanel = vi.hoisted(() => vi.fn());
const panel = vi.hoisted(() => ({ current: null as any }));
vi.mock("../../composables/dashboard/useDashboardPanel", () => ({
  default: () => ({
    dashboardPanelData: panel.current,
    resetDashboardPanelData: vi.fn(),
    resetAggregationFunction: vi.fn(),
    validatePanel,
  }),
}));

vi.mock("@/aws-exports", () => ({ default: { isEnterprise: "false", isCloud: "false" } }));
vi.mock("@/composables/dashboard/useDefaultPanelFields", () => ({
  default: () => ({ applyDefaultPanelFields: vi.fn() }),
}));

import MetricsIndex from "./Index.vue";

const editorRunQuery = vi.fn();
type RunQuery = (withoutCache?: boolean) => void;
const injected = { runQuery: null as RunQuery | null };
const picker = {
  refresh: vi.fn(),
  setSavedDate: vi.fn(),
  getConsumableDateTime: vi.fn(() => ({ startTime: 1_000_000, endTime: 2_000_000 })),
};

const makePanel = () =>
  reactive({
    data: {
      title: "",
      type: "line",
      queryType: "promql",
      config: {},
      queries: [
        { query: "up", customQuery: true, fields: { stream_type: "metrics", stream: "" } },
        { query: "rate(x[5m])", customQuery: true, fields: { stream_type: "metrics", stream: "" } },
      ],
    },
    meta: { dateTime: {} },
    layout: { showQueryBar: true, isConfigPanelOpen: false, currentQueryIndex: 0 },
  });

const mountIndex = () =>
  mount(MetricsIndex, {
    global: {
      stubs: {
        ShareButton: true,
        SyntaxGuideMetrics: true,
        MetricLegends: true,
        AddToDashboard: true,
        QueryHistoryDrawer: {
          emits: ["load"],
          template: '<div data-test="metrics-history" />',
        },
        PanelEditor: {
          setup: (_: any, { expose }: any) => {
            injected.runQuery = inject<RunQuery | null>("runQuery", null);
            expose({ runQuery: editorRunQuery });
            return {};
          },
          template: "<div />",
        },
        DateTimePickerDashboard: {
          setup: (_: any, { expose }: any) => {
            expose(picker);
            return {};
          },
          template: "<div />",
        },
        AutoRefreshInterval: {
          emits: ["trigger"],
          template: '<div data-test="metrics-auto-refresh" @click="$emit(\'trigger\')" />',
        },
      },
    },
  });

describe("Metrics editor — query history", () => {
  let consoleError: any;

  beforeEach(() => {
    vi.clearAllMocks();
    shortcuts.handlers = {};
    route.query = {};
    panel.current = makePanel();
    validatePanel.mockImplementation(() => {});
    api.record.mockResolvedValue({ data: {} });
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => consoleError.mockRestore());

  it("records the visible queries, joined, when the Run button is clicked", async () => {
    const wrapper = mountIndex();
    await flushPromises();

    await wrapper.find('[data-test="metrics-apply"]').trigger("click");
    await flushPromises();

    expect(editorRunQuery).toHaveBeenCalled();
    expect(api.record).toHaveBeenCalledTimes(1);
    const [org, body] = api.record.mock.calls[0];
    expect(org).toBe("org1");
    expect(body.query).toBe("up\nrate(x[5m])");
    expect(body.context).toMatchObject({ chart_type: "line", time_range: { period: "15m" } });
    expect(typeof body.context.metrics_data).toBe("string");
  });

  it("records from the run shortcut", async () => {
    mountIndex();
    await flushPromises();

    shortcuts.handlers.metricsRunQuery();
    await flushPromises();
    expect(api.record).toHaveBeenCalledTimes(1);
  });

  // The editor's Cmd+Enter calls this injected runQuery; DashboardQueryEditor.spec covers that half.
  it("provides runQuery as the user's Run: one call runs and records once", async () => {
    mountIndex();
    await flushPromises();

    injected.runQuery?.(false);
    await flushPromises();

    expect(editorRunQuery).toHaveBeenCalledTimes(1);
    expect(api.record).toHaveBeenCalledTimes(1);
  });

  it("records nothing for the refresh shortcut or an auto-refresh tick", async () => {
    const wrapper = mountIndex();
    await flushPromises();

    shortcuts.handlers.metricsRefresh();
    await wrapper.find('[data-test="metrics-auto-refresh"]').trigger("click");
    await flushPromises();

    expect(editorRunQuery).toHaveBeenCalledTimes(2);
    expect(api.record).not.toHaveBeenCalled();
  });

  it("records nothing for a deep-link auto-run", async () => {
    route.query = { metrics_data: encodeMetricsConfig(getMetricsConfig(makePanel())) };
    mountIndex();
    await flushPromises();

    expect(editorRunQuery).toHaveBeenCalled();
    expect(api.record).not.toHaveBeenCalled();
  });

  it("records nothing when the query fails validation", async () => {
    validatePanel.mockImplementation((errors: string[]) => errors.push("bad"));
    const wrapper = mountIndex();
    await flushPromises();

    await wrapper.find('[data-test="metrics-apply"]').trigger("click");
    await flushPromises();
    expect(api.record).not.toHaveBeenCalled();
  });

  it("a failed record only logs: the run still happens and nothing is toasted", async () => {
    api.record.mockRejectedValue(new Error("boom"));
    const wrapper = mountIndex();
    await flushPromises();

    await wrapper.find('[data-test="metrics-apply"]').trigger("click");
    await flushPromises();

    expect(editorRunQuery).toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
    expect(showErrorNotification).not.toHaveBeenCalled();
  });

  describe("loading an entry applies it live", () => {
    const blobFor = (type: string, query: string) => {
      const p = makePanel();
      p.data.type = type;
      p.data.queries = [{ query, customQuery: true, fields: { stream_type: "metrics" } } as any];
      return encodeMetricsConfig(getMetricsConfig(p));
    };

    it("restores the query, chart type and range for each of two consecutive loads", async () => {
      const wrapper = mountIndex();
      await flushPromises();
      const data = panel.current.data;
      const history = wrapper.findComponent('[data-test="metrics-history"]');

      history.vm.$emit("load", {
        metricsData: blobFor("bar", "sum(a)"),
        timeRange: { valueType: "relative", relativeTimePeriod: "6h" },
      });
      await flushPromises();

      expect(panel.current.data).toBe(data);
      expect(data.type).toBe("bar");
      expect(data.queries.map((q: any) => q.query)).toEqual(["sum(a)"]);
      expect(picker.setSavedDate).toHaveBeenLastCalledWith({
        type: "relative",
        relativeTimePeriod: "6h",
      });
      expect((wrapper.vm as any).selectedDate.relativeTimePeriod).toBe("6h");
      expect(editorRunQuery).toHaveBeenCalledTimes(1);

      history.vm.$emit("load", {
        metricsData: blobFor("area", "max(b)"),
        timeRange: { valueType: "absolute", startTime: 5000, endTime: 9000 },
      });
      await flushPromises();

      expect(data.type).toBe("area");
      expect(data.queries.map((q: any) => q.query)).toEqual(["max(b)"]);
      expect(picker.setSavedDate).toHaveBeenLastCalledWith({
        type: "absolute",
        startTime: 5000,
        endTime: 9000,
      });
      expect(editorRunQuery).toHaveBeenCalledTimes(2);
      // Loading an entry is not a new run of it.
      expect(api.record).not.toHaveBeenCalled();
    });
  });
});

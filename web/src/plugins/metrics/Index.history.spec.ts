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
import { inject, nextTick, reactive, type SetupContext } from "vue";
import { encodeMetricsConfig, getMetricsConfig } from "@/composables/metrics/metricsUrlState";
import { metricsRestore } from "@/utils/queryHistory/metrics";
import { openRecentOnItsPage, recentSearchRoute } from "@/utils/queryHistory/routes";
import type { QueryHistoryEntry } from "@/services/query_history";
import { landingRouter } from "@/test/unit/helpers/recentLanding";

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
    zoConfig: { min_auto_refresh_interval: 5, query_history_enabled: true },
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

interface PanelRun {
  state: { panels: Record<string, boolean> } | null;
  emitError: ((e: unknown) => void) | null;
}
const panelRun: PanelRun = { state: null, emitError: null };
const editorRunQuery = vi.fn(() => {
  if (panelRun.state) panelRun.state.panels.p1 = true;
});
const finishRun = async (error?: { message: string; code: string | number }) => {
  if (error) panelRun.emitError?.(error);
  if (panelRun.state) panelRun.state.panels.p1 = false;
  await flushPromises();
  await nextTick();
};
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
          emits: ["chartApiError", "renderer-error"],
          setup: (_: unknown, { expose, emit }: SetupContext) => {
            injected.runQuery = inject<RunQuery | null>("runQuery", null);
            panelRun.state = inject<PanelRun["state"]>("variablesAndPanelsDataLoadingState", null);
            panelRun.emitError = (e: unknown) => emit("renderer-error", e);
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
    expect(api.record).not.toHaveBeenCalled();

    await finishRun();
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
    await finishRun();
    expect(api.record).toHaveBeenCalledTimes(1);
  });

  it("provides runQuery as the user's Run: one call runs and records once", async () => {
    mountIndex();
    await flushPromises();

    injected.runQuery?.(false);
    await flushPromises();
    await finishRun();

    expect(editorRunQuery).toHaveBeenCalledTimes(1);
    expect(api.record).toHaveBeenCalledTimes(1);
  });

  it("records nothing for the refresh shortcut or an auto-refresh tick", async () => {
    const wrapper = mountIndex();
    await flushPromises();

    shortcuts.handlers.metricsRefresh();
    await wrapper.find('[data-test="metrics-auto-refresh"]').trigger("click");
    await flushPromises();
    await finishRun();

    expect(editorRunQuery).toHaveBeenCalledTimes(2);
    expect(api.record).not.toHaveBeenCalled();
  });

  it("records nothing for a deep-link auto-run", async () => {
    route.query = { metrics_data: encodeMetricsConfig(getMetricsConfig(makePanel())) };
    mountIndex();
    await flushPromises();
    await finishRun();

    expect(editorRunQuery).toHaveBeenCalled();
    expect(api.record).not.toHaveBeenCalled();
  });

  describe("a recent search restored from another page", () => {
    const entry = (): QueryHistoryEntry => ({
      id: "m",
      source: "metrics",
      query: "up",
      query_key: "k",
      streams: ["up"],
      context: {
        metrics_data: encodeMetricsConfig(getMetricsConfig(makePanel())),
        time_range: { period: "15m" },
      },
      status: "ok",
      starred: false,
      run_count: 1,
      created_at: 1,
      updated_at: 2,
    });
    const land = async (run: boolean) => {
      await openRecentOnItsPage(landingRouter().router, entry(), "now", "org1", run);
      route.query = recentSearchRoute(entry(), "now", "org1", run ? "run" : "load")!.query;
      const wrapper = mountIndex();
      await flushPromises();
      await finishRun();
      return wrapper;
    };

    it("runs and records it when it was restored with Run", async () => {
      await land(true);
      expect(editorRunQuery).toHaveBeenCalledTimes(1);
      expect(api.record).toHaveBeenCalledTimes(1);
    });

    it("loads it without running or recording when it was restored with Load without running", async () => {
      await land(false);
      expect(editorRunQuery).not.toHaveBeenCalled();
      expect(api.record).not.toHaveBeenCalled();
    });

    it("uses the restore once: reopening the same URL afterwards runs without recording", async () => {
      const first = await land(true);
      first.unmount();
      mountIndex();
      await flushPromises();
      await finishRun();
      expect(editorRunQuery).toHaveBeenCalledTimes(2);
      expect(api.record).toHaveBeenCalledTimes(1);
    });
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
    await finishRun();

    expect(editorRunQuery).toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
    expect(showErrorNotification).not.toHaveBeenCalled();
  });

  it("records the run's window in microseconds and reopens it at that window", async () => {
    const startUs = 1_761_500_000_000_000;
    const endUs = startUs + 3_600_000_000;
    picker.getConsumableDateTime.mockReturnValue({ startTime: startUs, endTime: endUs });
    const wrapper = mountIndex();
    await flushPromises();
    await wrapper.find('[data-test="metrics-apply"]').trigger("click");
    await flushPromises();
    await finishRun();
    const body = api.record.mock.calls[0][1];
    expect(body.context.time).toMatchObject({ start_time: startUs, end_time: endUs });

    const reopened = metricsRestore(
      {
        ...body,
        id: "r",
        query_key: "k",
        starred: false,
        run_count: 1,
        created_at: 1,
        updated_at: 2,
      },
      "original",
    );
    wrapper
      .findComponent('[data-test="metrics-history"]')
      .vm.$emit("load", { ...reopened, run: false });
    await flushPromises();
    const saved = picker.setSavedDate.mock.calls.at(-1)?.[0];
    expect(saved).toEqual({ type: "absolute", startTime: startUs, endTime: endUs });
    // DateTime.setSavedDate reads these as microseconds and divides by 1000 for its labels.
    expect(new Date(saved.startTime / 1000).getUTCFullYear()).toBe(2025);
    picker.getConsumableDateTime.mockReturnValue({ startTime: 1_000_000, endTime: 2_000_000 });
  });

  it("names the metric the custom query selects, not the stream picker's last choice", async () => {
    panel.current.data.queries = [
      {
        query: "sum(rate(http_requests_total[5m])) by (service)",
        customQuery: true,
        fields: { stream_type: "metrics", stream: "node_memory_MemAvailable_bytes" },
      },
    ];
    const wrapper = mountIndex();
    await flushPromises();
    await wrapper.find('[data-test="metrics-apply"]').trigger("click");
    await flushPromises();
    await finishRun();
    expect(api.record.mock.calls[0][1].streams).toEqual(["http_requests_total"]);
  });

  it("records a query error as failed, with its message", async () => {
    const wrapper = mountIndex();
    await flushPromises();
    await wrapper.find('[data-test="metrics-apply"]').trigger("click");
    await flushPromises();
    await finishRun({ message: "parse error: unexpected <EOF>", code: 400 });

    expect(api.record).toHaveBeenCalledTimes(1);
    expect(api.record.mock.calls[0][1]).toMatchObject({
      status: "error",
      context: { error: "parse error: unexpected <EOF>" },
    });
  });

  it("records a timeout as ok with a warning", async () => {
    const wrapper = mountIndex();
    await flushPromises();
    await wrapper.find('[data-test="metrics-apply"]').trigger("click");
    await flushPromises();
    await finishRun({ message: "timed out", code: 20010 });
    expect(api.record.mock.calls[0][1]).toMatchObject({
      status: "ok",
      context: { warning: "timed out" },
    });
  });

  it("records nothing for a cancelled run", async () => {
    const wrapper = mountIndex();
    await flushPromises();
    await wrapper.find('[data-test="metrics-apply"]').trigger("click");
    await flushPromises();
    await finishRun({ message: "query cancelled", code: 20009 });
    expect(api.record).not.toHaveBeenCalled();
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
    });

    it("records a re-run from history once it settles, like a Run", async () => {
      const wrapper = mountIndex();
      await flushPromises();
      wrapper.findComponent('[data-test="metrics-history"]').vm.$emit("load", {
        metricsData: blobFor("bar", "sum(a)"),
        timeRange: { valueType: "relative", relativeTimePeriod: "6h" },
        run: true,
      });
      await flushPromises();
      await finishRun();
      expect(editorRunQuery).toHaveBeenCalledTimes(1);
      expect(api.record).toHaveBeenCalledTimes(1);
      expect(api.record.mock.calls[0][1]).toMatchObject({ source: "metrics", query: "sum(a)" });
    });

    it("loads without running or recording when asked to load only", async () => {
      const wrapper = mountIndex();
      await flushPromises();
      const data = panel.current.data;
      wrapper.findComponent('[data-test="metrics-history"]').vm.$emit("load", {
        metricsData: blobFor("bar", "sum(a)"),
        timeRange: { valueType: "relative", relativeTimePeriod: "6h" },
        run: false,
      });
      await flushPromises();
      expect(data.queries.map((q: { query: string }) => q.query)).toEqual(["sum(a)"]);
      expect(editorRunQuery).not.toHaveBeenCalled();
      expect(api.record).not.toHaveBeenCalled();
    });
  });
});

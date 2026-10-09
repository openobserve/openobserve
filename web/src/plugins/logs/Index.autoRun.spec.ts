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

import { describe, expect, it, beforeEach, vi, afterEach, Mock } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

import { initializeLogsIndexDom } from "@/test/unit/helpers/logsIndex";
import Index from "@/plugins/logs/Index.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
vi.mock("@/stores", async () => {
  const { default: store } = await import("@/test/unit/helpers/store");
  return { default: store };
});
import { createRouter, createMemoryHistory } from "vue-router";

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: "/", name: "home", component: { template: "<div />" } },
    { path: "/logs", name: "logs", component: { template: "<div />" } },
  ],
});
import { getFieldsFromQuery } from "@/utils/query/sqlUtils";

initializeLogsIndexDom();

const loaderCalls = vi.hoisted(() => [] as string[]);
const loadRuns = vi.hoisted(() => [] as Promise<unknown>[]);
vi.mock("@/composables/useLogs", async () => {
  const actual =
    await vi.importActual<typeof import("@/composables/useLogs")>("@/composables/useLogs");

  return {
    ...actual,
    default: (...args: Parameters<typeof actual.default>) => {
      const api = actual.default(...args);
      return {
        ...api,
        loadLogsData: (...loadArgs: Parameters<typeof api.loadLogsData>) => {
          loaderCalls.push("logs");
          const run = api.loadLogsData(...loadArgs);
          loadRuns.push(run);
          return run;
        },
        loadVisualizeData: () => {
          loaderCalls.push("visualize");
          return api.loadVisualizeData();
        },
      };
    },
    clearSearchObj: vi.fn(),
  };
});

vi.mock("@/composables/useLogs/usePatterns", () => ({
  default: () => ({
    extractPatterns: vi.fn().mockResolvedValue(undefined),
    patternsState: { value: { patterns: null, loading: false, error: null, lastQuery: null } },
  }),
  patternsState: { value: { patterns: null, loading: false, error: null, lastQuery: null } },
}));

vi.mock("@/plugins/traces/metrics/TracesAnalysisDashboard.vue", () => ({
  __esModule: true,
  default: {
    name: "TracesAnalysisDashboard",
    props: {
      embedded: Boolean,
      streamName: null,
      streamType: null,
      timeRange: null,
      rateFilter: null,
      baseFilter: null,
      streamFields: null,
      logSamples: null,
      analysisType: null,
      availableAnalysisTypes: null,
    },
    template: '<div data-test="drill-down-dashboard-stub" />',
  },
}));

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStreams: vi.fn(async () => ({
      list: [{ name: "k8s_json", stream_type: "logs", stats: { doc_time_max: 0 }, schema: [] }],
    })),
    getStream: vi.fn(async () => ({ name: "k8s_json", schema: [{ name: "_timestamp" }] })),
    isStreamExists: vi.fn(() => true),
    isStreamFetched: vi.fn(() => true),
    getMultiStreams: vi.fn(async () => []),
  }),
}));

describe("Logs Index — first landing and URL loads (item 2)", { timeout: 30000 }, () => {
  let wrapper: any;
  const org = store.state.selectedOrganization.identifier;
  const originalZoConfig = { ...store.state.zoConfig };

  const land = async (query: Record<string, string>, zoConfig: Record<string, unknown>) => {
    store.state.zoConfig = { ...originalZoConfig, ...zoConfig };
    (store.state as any).logs = { isInitialized: false, logs: {} };
    vi.spyOn(store, "dispatch").mockResolvedValue(undefined as any);
    (getFieldsFromQuery as Mock).mockResolvedValue({ fields: [], filters: [], streamName: "" });
    await router.replace({ name: "logs", query: { org_identifier: org, ...query } });
    loadRuns.length = 0;
    wrapper = mount(Index, {
      attachTo: "#app",
      global: { provide: { store }, plugins: [i18n, router] },
    });
    const logs = vi.fn();
    wrapper.vm.autoRun.setExecutors({ logs });
    await vi.waitFor(() => expect(loadRuns.length).toBeGreaterThan(0), { timeout: 10000 });
    await Promise.allSettled(loadRuns);
    await vi.waitFor(() => expect(wrapper.vm.autoRun.engine.hasPendingRequest()).toBe(false));
    await flushPromises();
    expect(wrapper.vm.searchObj.data.stream.streamLists.length).toBeGreaterThan(0);
    return logs;
  };

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(async () => {
    wrapper?.unmount();
    store.state.zoConfig = originalZoConfig;
    vi.restoreAllMocks();
    localStorage.clear();
    await router.replace({ path: router.currentRoute.value.path, query: {} });
  });

  it("#14759: Auto Run off restores the last stream and runs nothing", async () => {
    localStorage.setItem("oo_toggle_auto_run", "false");
    localStorage.setItem(`oo_logs_selected_stream_logs_${org}`, '["k8s_json"]');
    const logs = await land(
      {},
      { auto_query_enabled: true, query_on_stream_selection: true, auto_query_max_scan_mb: 0 },
    );
    expect(wrapper.vm.searchObj.data.stream.selectedStream).toEqual(["k8s_json"]);
    expect(logs).not.toHaveBeenCalled();
    expect(wrapper.vm.searchObj.meta.searchApplied).toBe(false);
    await vi.waitFor(() =>
      expect(wrapper.find('[data-test="logs-search-apply-search-text"]').exists()).toBe(true),
    );
  });

  it("AQE=false: no restore and no preselect, as today", async () => {
    localStorage.setItem(`oo_logs_selected_stream_logs_${org}`, '["k8s_json"]');
    const logs = await land(
      {},
      { auto_query_enabled: false, query_on_stream_selection: true, auto_query_max_scan_mb: 500 },
    );
    expect(wrapper.vm.searchObj.data.stream.selectedStream).toEqual([]);
    expect(logs).not.toHaveBeenCalled();
  });

  it("a URL naming an unreadable stream shows the error state and sends no search (AC3.2)", async () => {
    const logs = await land(
      { stream: "secret_stream", stream_type: "logs", period: "15m" },
      { auto_query_enabled: true, query_on_stream_selection: true },
    );
    expect(wrapper.vm.searchObj.data.stream.selectedStream).toEqual([]);
    expect(wrapper.vm.searchObj.data.filterErrMsg).toContain("secret_stream");
    expect(logs).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(wrapper.find('[data-test="logs-search-filter-error-message"]').exists()).toBe(true),
    );
  });

  it("a readable URL stream is an entry point: it runs once even with Auto Run off", async () => {
    localStorage.setItem("oo_toggle_auto_run", "false");
    const logs = await land(
      { stream: "k8s_json", stream_type: "logs", period: "15m" },
      { auto_query_enabled: true, query_on_stream_selection: true, auto_query_max_scan_mb: 0 },
    );
    await vi.waitFor(() => expect(logs).toHaveBeenCalledTimes(1));
    expect(logs.mock.calls[0][0]).toMatchObject({ reason: "url", kind: "entry" });
  });

  describe("entry points and explicit runs after landing", () => {
    const ready = async (zoConfig: Record<string, unknown> = {}) => {
      const logs = await land(
        { stream: "k8s_json", stream_type: "logs", period: "15m" },
        { auto_query_enabled: true, query_on_stream_selection: true, ...zoConfig },
      );
      const histogram = vi.fn();
      const patterns = vi.fn();
      const visualize = vi.fn();
      wrapper.vm.autoRun.setExecutors({ histogram, patterns, visualize });
      expect(logs.mock.calls.some((call: any[]) => call[0].reasons.includes("url"))).toBe(true);
      const engine = wrapper.vm.autoRun.engine;
      const landed = engine.currentGeneration("grid");
      if (landed) engine.settleGeneration(landed.id);
      logs.mockClear();
      return { logs, histogram, patterns, visualize };
    };

    it("auto-refresh ticks go through requestRun and pause while results are stale (P3)", async () => {
      const { logs } = await ready();
      const engine = wrapper.vm.autoRun.engine;
      const landed = engine.currentGeneration("grid");
      wrapper.vm.searchObj.meta.executed = {
        generation: landed.id,
        signature: wrapper.vm.autoRun.readSignature(),
        req: {},
        complete: true,
      };
      wrapper.vm.searchObj.meta.consentedScope = null;
      vi.useFakeTimers();
      try {
        wrapper.vm.searchObj.meta.refreshInterval = 5;
        wrapper.vm.refreshData();
        const refreshes = () =>
          logs.mock.calls.filter((call: any[]) => call[0].reason === "refresh").length;
        await vi.advanceTimersByTimeAsync(5001);
        expect(refreshes()).toBe(1);
        engine.settleGeneration(engine.currentGeneration("grid").id);

        wrapper.vm.searchObj.data.query = "level='error'";
        await vi.advanceTimersByTimeAsync(5001);
        expect(refreshes()).toBe(1);
        expect(engine.hasMissedTick()).toBe(true);
      } finally {
        wrapper.vm.searchObj.meta.refreshInterval = 0;
        wrapper.vm.refreshData();
        vi.useRealTimers();
      }
    });

    it("pagination and page size are explicit page runs", async () => {
      const { logs } = await ready();
      wrapper.vm.searchObj.meta.refreshInterval = 0;
      wrapper.vm.searchObj.meta.jobId = "";
      await wrapper.vm.getMoreData();
      await wrapper.vm.getMoreDataRecordsPerPage();
      expect(logs.mock.calls.map((c: any[]) => [c[0].reason, c[0].op])).toEqual([
        ["pagination", "page"],
        ["page-size", "page"],
      ]);
    });

    it("the histogram reveal sends a histogram request and no hits request (C14)", async () => {
      const { logs, histogram } = await ready();
      wrapper.vm.searchObj.data.queryResults = { hits: [{ a: 1 }] };
      wrapper.vm.searchObj.meta.jobId = "";
      const request = vi.spyOn(wrapper.vm.autoRun, "request");
      wrapper.vm.searchObj.meta.showHistogram = false;
      await flushPromises();
      wrapper.vm.searchObj.meta.histogramDirtyFlag = true;
      await flushPromises();
      wrapper.vm.searchObj.meta.showHistogram = true;
      await flushPromises();
      await vi.waitFor(() => expect(histogram).toHaveBeenCalledTimes(1));
      expect(wrapper.vm.autoRun.engine.hasPendingRequest()).toBe(false);
      expect(request.mock.results.map((r: any) => r.value)).toEqual(["scheduled"]);
      expect(logs).not.toHaveBeenCalled();
    });

    it("keep-alive reactivation on Visualize is a guarded visualize-restore (C21)", async () => {
      const { visualize } = await ready();
      wrapper.vm.searchObj.meta.logsVisualizeToggle = "visualize";
      await wrapper.vm.handleActivation();
      await vi.waitFor(() => expect(visualize).toHaveBeenCalledTimes(1));
      expect(visualize.mock.calls[0][0]).toMatchObject({
        reason: "visualize-restore",
        kind: "entry",
      });
    });

    it("Cmd/Ctrl+Enter during a streaming run cancels it and starts a new one", async () => {
      const { logs } = await ready();
      wrapper.vm.searchData();
      const first = wrapper.vm.autoRun.engine.currentGeneration("grid");
      wrapper.vm.searchObj.loading = true;
      wrapper.vm.searchBarRef.handleRunQueryFn();
      const second = wrapper.vm.autoRun.engine.currentGeneration("grid");
      expect(first.cancelled).toBe(true);
      expect(second.id).not.toBe(first.id);
      expect(logs).toHaveBeenCalledTimes(2);
    });

    it("blocks an over-budget URL load, shows the guard, and Run anyway runs it once (J5)", async () => {
      localStorage.setItem("oo_toggle_auto_run", "false");
      const logs = await land(
        { stream: "k8s_json", stream_type: "logs", period: "7d" },
        { auto_query_enabled: true, query_on_stream_selection: true, auto_query_max_scan_mb: 1 },
      );
      wrapper.vm.searchObj.data.streamResults.list[0].stats = {
        doc_time_min: Date.now() * 1000 - 3600e6 * 48,
        doc_time_max: Date.now() * 1000,
        storage_size: 4800,
      };
      wrapper.vm.autoRun.engine.resetScope("url");
      wrapper.vm.autoRun.request("url");
      await vi.waitFor(() =>
        expect(wrapper.vm.searchObj.meta.autoRunBlocked).toMatchObject({ reason: "url" }),
      );
      expect(wrapper.vm.autoRun.engine.hasPendingRequest()).toBe(false);
      expect(logs).not.toHaveBeenCalled();
      await vi.waitFor(() =>
        expect(wrapper.find('[data-test="logs-auto-run-guard"]').exists()).toBe(true),
      );
      expect(wrapper.find('[data-test="logs-auto-run-guard-estimate"]').text()).toContain(
        "k8s_json",
      );

      await wrapper.find('[data-test="logs-auto-run-guard-run-btn"]').trigger("click");
      expect(logs).toHaveBeenCalledTimes(1);
      expect(logs.mock.calls[0][0]).toMatchObject({ reason: "run-anyway", kind: "explicit" });
      expect(wrapper.vm.searchObj.meta.autoRunBlocked).toBeNull();
    });

    it("Narrow to sets only the date and runs once after re-checking the guard", async () => {
      const logs = await land(
        { stream: "k8s_json", stream_type: "logs", period: "7d" },
        { auto_query_enabled: true, query_on_stream_selection: true, auto_query_max_scan_mb: 5 },
      );
      wrapper.vm.searchObj.data.streamResults.list[0].stats = {
        doc_time_min: Date.now() * 1000 - 3600e6 * 48,
        doc_time_max: Date.now() * 1000,
        storage_size: 4800,
      };
      logs.mockClear();
      wrapper.vm.onGuardNarrow("1m");
      expect(wrapper.vm.searchObj.data.datetime).toMatchObject({
        type: "relative",
        relativeTimePeriod: "1m",
      });
      expect(logs).toHaveBeenCalledTimes(1);
      expect(logs.mock.calls[0][0]).toMatchObject({ reason: "narrow" });
    });
  });
});

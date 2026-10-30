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
import { nextTick, reactive, type SetupContext } from "vue";

// A fresh panel-data object per test so mounting can reset it in place and the
// assertions see the metrics defaults the container applied.
const makePanelData = () => ({
  data: {
    type: "",
    queryType: "",
    queries: [{ customQuery: true, fields: { stream_type: "", stream: "" } }],
  },
  layout: { showQueryBar: false, currentQueryIndex: 0 },
  // The panel's time window — the component writes the toolbar's range here and
  // the template binds PanelEditor's selected-date-time to it.
  meta: { dateTime: {} },
});

const panelData = vi.hoisted(() => ({ current: null as any }));
const resetDashboardPanelData = vi.hoisted(() => vi.fn());
const validatePanel = vi.hoisted(() => vi.fn());

vi.mock("@/composables/dashboard/useDashboardPanel", () => ({
  default: () => ({
    dashboardPanelData: panelData.current,
    resetDashboardPanelData,
    validatePanel,
  }),
}));

/** The stub's runQuery — the real PanelEditor exposes one, so the stub must too. */
const editorRunQuery = vi.hoisted(() => vi.fn());
/** What the query editor inside PanelEditor injects as `runQuery` for ⌘/Ctrl+Enter. */
const injectedRunQuery = vi.hoisted(() => ({ current: null as any }));
/** The stub's exposed staleness state, as refs so the container's computed tracks them. */
const editorState = vi.hoisted(() => ({ current: null as any }));
const emitChartError = vi.hoisted(() => ({ current: null as ((e: unknown) => void) | null }));

// The real PanelEditor pulls in ECharts + the whole dashboard config surface;
// none of that is what this container's own logic needs. Stub it, but keep its
// emit so the add-to-dashboard handshake can be driven, and EXPOSE runQuery —
// the container drives the chart through `panelEditorRef.runQuery()`, so a stub
// without it makes the auto-run silently no-op and the test prove nothing.
vi.mock("@/components/dashboards/PanelEditor", async () => {
  const { inject, ref } = await import("vue");
  return {
    PanelEditor: {
      name: "PanelEditor",
      props: ["allowedChartTypes"],
      emits: ["add-to-dashboard", "chart-api-error", "renderer-error"],
      setup: (_: unknown, { expose, emit }: SetupContext) => {
        injectedRunQuery.current = inject("runQuery", null);
        emitChartError.current = (e: unknown) => emit("renderer-error", e);
        editorState.current = {
          isOutDated: ref(false),
          isLoading: ref(false),
          chartData: ref(undefined),
        };
        // Like the real editor, a run snapshots the panel it ran with.
        const runQuery = (...args: any[]) => {
          editorRunQuery(...args);
          editorState.current.isLoading.value = true;
          editorState.current.chartData.value = JSON.parse(JSON.stringify(panelData.current.data));
        };
        expose({ runQuery, ...editorState.current });
        return {};
      },
      template:
        '<div data-test="panel-editor-stub"><button data-test="stub-add" @click="$emit(\'add-to-dashboard\')" /></div>',
    },
  };
});

vi.mock("../AddToDashboard.vue", () => ({
  default: {
    name: "AddToDashboard",
    props: ["open", "dashboardPanelData"],
    template: '<div data-test="add-to-dashboard-stub" />',
  },
}));

const showErrorNotification = vi.fn();
vi.mock("@/composables/useNotifications", () => ({
  default: () => ({ showErrorNotification }),
}));

vi.mock("@/utils/streamPersist", () => ({
  restoreMetricsStream: vi.fn(() => ""),
}));

// partial: the panel seed path reaches @/stores, which needs the real createStore
const storeState = vi.hoisted(() => ({
  selectedOrganization: { identifier: "org1" },
  zoConfig: { auto_query_enabled: false, query_history_enabled: true },
}));
vi.mock("vuex", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vuex")>()),
  useStore: () => ({ state: storeState }),
}));

const historyApi = vi.hoisted(() => ({
  record: vi.fn(),
  list: vi.fn(),
  star: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@/services/query_history", () => ({ default: historyApi }));

import MetricsVisualize from "./MetricsVisualize.vue";

interface VisualizeApi {
  onUserRun: (range: object) => void;
}

const finishRun = async (error?: { message: string; code: number }) => {
  if (error) emitChartError.current?.(error);
  editorState.current.isLoading.value = false;
  await flushPromises();
  await nextTick();
};
import { encodeMetricsConfig } from "@/composables/metrics/metricsUrlState";
import { LIVE_PREVIEW_DEBOUNCE_MS } from "@/composables/dashboard/usePanelLivePreview";

const mountVisualize = (props: Record<string, any> = {}) =>
  mount(MetricsVisualize, {
    props,
    global: {
      stubs: {
        // any leftover global component; PanelEditor + AddToDashboard are mocked
      },
    },
  });

describe("MetricsVisualize", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    panelData.current = makePanelData();
    storeState.zoConfig.auto_query_enabled = false;
  });

  it("applies the metrics panel defaults on mount (line + promql + query bar)", async () => {
    mountVisualize();
    await flushPromises();

    expect(resetDashboardPanelData).toHaveBeenCalled();
    expect(panelData.current.data.type).toBe("line");
    expect(panelData.current.data.queryType).toBe("promql");
    expect(panelData.current.data.queries[0].customQuery).toBe(false);
    expect(panelData.current.data.queries[0].fields.stream_type).toBe("metrics");
    expect(panelData.current.layout.showQueryBar).toBe(true);
  });

  it("does not restrict chart types — matches AddPanel (ChartSelection's PromQL rules govern)", async () => {
    // The pane used to pass a narrow allowedChartTypes list, disabling stacked,
    // gauge, pie, heatmap, etc. AddPanel passes none; the metrics pane must not
    // silently drop chart types the dashboard offers for the same PromQL panel.
    const wrapper = mountVisualize();
    await flushPromises();

    const allowed = wrapper.findComponent({ name: "PanelEditor" }).props("allowedChartTypes");
    expect(allowed).toBeUndefined();
  });

  it("opens the add-to-dashboard dialog only when the panel validates", async () => {
    validatePanel.mockImplementation(() => {}); // no errors pushed
    const wrapper = mountVisualize();
    await flushPromises();

    await wrapper.find('[data-test="stub-add"]').trigger("click");
    expect(validatePanel).toHaveBeenCalled();
    // The dialog is shown (open prop true) and no error toast fired.
    expect(wrapper.findComponent({ name: "AddToDashboard" }).props("open")).toBe(true);
    expect(showErrorNotification).not.toHaveBeenCalled();
  });

  it("blocks the dialog and surfaces the error when the panel is invalid", async () => {
    validatePanel.mockImplementation((errors: string[]) => {
      errors.push("Add a query first");
    });
    const wrapper = mountVisualize();
    await flushPromises();

    await wrapper.find('[data-test="stub-add"]').trigger("click");
    expect(showErrorNotification).toHaveBeenCalledWith("Add a query first");
    expect(wrapper.findComponent({ name: "AddToDashboard" }).props("open")).toBe(false);
  });

  /**
   * Opening a card in Visualize must PAINT the metric, not hand the user a fully
   * populated query bar above a blank chart and make them press Refresh to see
   * the thing they just clicked.
   */
  describe("run-query staleness and Auto Run", () => {
    const mountEdited = async (props: Record<string, any> = {}) => {
      validatePanel.mockImplementation(() => {});
      panelData.current = reactive(makePanelData());
      const wrapper = mountVisualize({
        selectedDateTime: { startTime: 1000, endTime: 2000 },
        ...props,
      });
      await flushPromises();
      panelData.current.data.queries[0].query = "avg(up)";
      (wrapper.vm as any).runQuery();
      await flushPromises();
      await finishRun();
      editorRunQuery.mockClear();
      window.dispatchEvent(new Event("pointerdown"));
      return wrapper;
    };

    afterEach(() => {
      vi.useRealTimers();
    });

    it("with Auto Run off, a builder edit turns Run pending without running, and a run clears it", async () => {
      const wrapper = await mountEdited();
      const vm = wrapper.vm as any;
      expect(vm.isRunQueryPending).toBe(false);

      panelData.current.data.queries[0].query = "up";
      await flushPromises();
      expect(vm.isRunQueryPending).toBe(true);
      expect(editorRunQuery).not.toHaveBeenCalled();

      vm.onUserRun({ valueType: "relative", relativeTimePeriod: "15m" });
      await flushPromises();
      await finishRun();
      expect(vm.isRunQueryPending).toBe(false);
      expect(historyApi.record).toHaveBeenCalledTimes(1);
    });

    it("with Auto Run on, a builder edit runs after the debounce, never shows pending and records nothing", async () => {
      storeState.zoConfig.auto_query_enabled = true;
      vi.useFakeTimers();
      const wrapper = await mountEdited();
      const vm = wrapper.vm as any;

      panelData.current.data.queries[0].query = "up";
      await flushPromises();
      expect(vm.isRunQueryPending).toBe(false);
      expect(editorRunQuery).not.toHaveBeenCalled();

      vi.advanceTimersByTime(LIVE_PREVIEW_DEBOUNCE_MS);
      await flushPromises();
      expect(editorRunQuery).toHaveBeenCalledTimes(1);
      expect(vm.isRunQueryPending).toBe(false);
      expect(historyApi.record).not.toHaveBeenCalled();
    });

    it("with Auto Run off, a new time range waits for Run; with it on, it re-runs at once", async () => {
      const wrapper = await mountEdited();
      await wrapper.setProps({ selectedDateTime: { startTime: 3000, endTime: 4000 } });
      await flushPromises();
      expect(editorRunQuery).not.toHaveBeenCalled();
      expect((wrapper.vm as any).isRunQueryPending).toBe(true);

      storeState.zoConfig.auto_query_enabled = true;
      const on = await mountEdited();
      await on.setProps({ selectedDateTime: { startTime: 5000, endTime: 6000 } });
      await flushPromises();
      expect(editorRunQuery).toHaveBeenCalledTimes(1);
      expect((on.vm as any).isRunQueryPending).toBe(false);
    });

    it("Refresh Cache & Run runs without cache and records like an explicit run", async () => {
      const wrapper = await mountEdited();
      (wrapper.vm as any).onUserRun({ valueType: "relative", relativeTimePeriod: "15m" }, true);
      await flushPromises();
      await finishRun();
      expect(editorRunQuery).toHaveBeenCalledWith(true);
      expect(historyApi.record).toHaveBeenCalledTimes(1);
    });
  });

  describe("a seeded open runs its query", () => {
    const SEED = {
      type: "line",
      queryType: "promql",
      queries: [
        {
          query: "avg(rate(apiserver_admission_webhook_request_total{}[5m]))",
          customQuery: true,
          fields: { stream: "apiserver_admission_webhook_request_total" },
        },
      ],
      config: {},
    };

    it("fires the query for a card's Open", async () => {
      const wrapper = mountVisualize({
        seed: SEED,
        selectedDateTime: { startTime: 1000, endTime: 2000 },
      });
      await flushPromises();
      await flushPromises();

      expect(editorRunQuery).toHaveBeenCalled();
      wrapper.unmount();
    });

    it("still fires when the parent nulls the seed on `seed-consumed` (as it really does)", async () => {
      // The REAL parent binds `@seed-consumed="visualizeSeed = null"`, and the
      // emit happens in the child's `onBeforeMount` — so the prop is already
      // gone by `onMounted`. Reproduce that exactly: a parent that nulls the
      // seed the instant the child asks it to. Mounting the child alone and
      // calling setProps afterwards is TOO LATE to catch this — the mutant
      // survives it.
      const Parent = {
        components: { MetricsVisualize },
        data: () => ({ seed: SEED as any }),
        template:
          '<MetricsVisualize :seed="seed" :selected-date-time="{ startTime: 1000, endTime: 2000 }" @seed-consumed="seed = null" />',
      };

      const wrapper = mount(Parent);
      await flushPromises();
      await flushPromises();

      // The component must remember it WAS seeded rather than re-read the prop.
      expect(editorRunQuery).toHaveBeenCalled();
      wrapper.unmount();
    });

    it("does NOT fire for a blank Visualize — there is no query to run", async () => {
      const wrapper = mountVisualize({
        selectedDateTime: { startTime: 1000, endTime: 2000 },
      });
      await flushPromises();
      await flushPromises();

      // Entering the tab directly just sets the window and waits for the user to
      // build a query; querying an empty panel would be a guaranteed error.
      expect(editorRunQuery).not.toHaveBeenCalled();
      wrapper.unmount();
    });
  });

  describe("query history", () => {
    const RANGE = {
      valueType: "relative",
      relativeTimePeriod: "1h",
      startTime: null,
      endTime: null,
    };
    const withQuery = (query: string) => {
      panelData.current.data.queries = [{ query, customQuery: true, fields: {} }];
    };
    let consoleError: any;

    beforeEach(() => {
      historyApi.record.mockResolvedValue({ data: {} });
      validatePanel.mockImplementation(() => {});
      consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => consoleError.mockRestore());

    it("an explicit run runs the query and records it", async () => {
      const wrapper = mountVisualize({ selectedDateTime: { startTime: 1000, endTime: 2000 } });
      await flushPromises();
      withQuery("sum(up)");

      (wrapper.vm as any).onUserRun(RANGE);
      await flushPromises();
      expect(historyApi.record).not.toHaveBeenCalled();
      await finishRun();

      expect(editorRunQuery).toHaveBeenCalledTimes(1);
      expect(historyApi.record).toHaveBeenCalledWith(
        "org1",
        expect.objectContaining({
          query: "sum(up)",
          context: expect.objectContaining({ time_range: { period: "1h" }, chart_type: "line" }),
        }),
      );
    });

    it("the editor's ⌘/Ctrl+Enter asks the parent for the same Run as the button", async () => {
      const wrapper = mountVisualize({ selectedDateTime: { startTime: 1000, endTime: 2000 } });
      await flushPromises();
      expect(injectedRunQuery.current).toBeTypeOf("function");

      injectedRunQuery.current(false);

      // The parent's Run handler owns the range and the history write; nothing runs here first.
      expect(wrapper.emitted("run")).toHaveLength(1);
      expect(editorRunQuery).not.toHaveBeenCalled();
      expect(historyApi.record).not.toHaveBeenCalled();
    });

    it("does not record a query that fails validation", async () => {
      validatePanel.mockImplementation((errors: string[]) => errors.push("bad"));
      const wrapper = mountVisualize();
      await flushPromises();
      withQuery("sum(up)");

      (wrapper.vm as any).onUserRun(RANGE);
      await flushPromises();
      expect(historyApi.record).not.toHaveBeenCalled();
    });

    it("a failed record is logged and never blocks the run", async () => {
      historyApi.record.mockRejectedValue(new Error("boom"));
      const wrapper = mountVisualize();
      await flushPromises();
      withQuery("sum(up)");

      (wrapper.vm as any).onUserRun(RANGE);
      await flushPromises();
      await finishRun();
      expect(editorRunQuery).toHaveBeenCalledTimes(1);
      expect(consoleError).toHaveBeenCalled();
      expect(showErrorNotification).not.toHaveBeenCalled();
    });

    it("the seed auto-run and the time-range watcher record nothing", async () => {
      storeState.zoConfig.auto_query_enabled = true;
      const wrapper = mountVisualize({
        seed: { type: "line", queries: [{ query: "sum(up)", customQuery: true, fields: {} }] },
        selectedDateTime: { startTime: 1000, endTime: 2000 },
      });
      await flushPromises();
      await flushPromises();
      await wrapper.setProps({ selectedDateTime: { startTime: 3000, endTime: 4000 } });
      await flushPromises();

      expect(editorRunQuery).toHaveBeenCalledTimes(2);
      expect(historyApi.record).not.toHaveBeenCalled();
    });

    it("records a failed run as error and a cancelled run not at all", async () => {
      const wrapper = mountVisualize({ selectedDateTime: { startTime: 1000, endTime: 2000 } });
      await flushPromises();
      withQuery("sum(up{");

      (wrapper.vm as unknown as VisualizeApi).onUserRun(RANGE);
      await flushPromises();
      await finishRun({ message: "parse error: unclosed left brace", code: 400 });
      expect(historyApi.record.mock.calls[0][1]).toMatchObject({
        status: "error",
        context: { error: "parse error: unclosed left brace" },
      });

      historyApi.record.mockClear();
      (wrapper.vm as unknown as VisualizeApi).onUserRun(RANGE);
      await flushPromises();
      await finishRun({ message: "cancelled", code: 20009 });
      expect(historyApi.record).not.toHaveBeenCalled();
    });

    it("applies two consecutive entries live, each with its range, running once each", async () => {
      // A parent that owns the range, as the explorer does.
      const Parent = {
        components: { MetricsVisualize },
        data: () => ({ range: { startTime: 1000, endTime: 2000 } as any }),
        template:
          '<MetricsVisualize ref="viz" :selected-date-time="range" @update:time-range="(r) => (range = { startTime: r.startTime, endTime: r.endTime })" />',
      };
      const wrapper = mount(Parent);
      await flushPromises();
      const viz: any = wrapper.vm.$refs.viz;
      const data = panelData.current.data;
      const blob = (type: string, query: string) =>
        encodeMetricsConfig({ v: 1, data: { type, queries: [{ query, fields: {} }] } });

      await viz.applyPanelData(blob("bar", "sum(a)"), {
        valueType: "absolute",
        startTime: 5000,
        endTime: 9000,
      });
      await flushPromises();
      expect(panelData.current.data).toBe(data);
      expect(data.type).toBe("bar");
      expect(data.queries[0].query).toBe("sum(a)");
      expect(panelData.current.meta.dateTime.start_time).toEqual(new Date(5000));
      expect(editorRunQuery).toHaveBeenCalledTimes(1);

      await viz.applyPanelData(blob("area", "max(b)"), {
        valueType: "absolute",
        startTime: 7000,
        endTime: 8000,
      });
      await flushPromises();
      expect(data.type).toBe("area");
      expect(data.queries[0].query).toBe("max(b)");
      expect(panelData.current.meta.dateTime.start_time).toEqual(new Date(7000));
      expect(editorRunQuery).toHaveBeenCalledTimes(2);
      await finishRun();
      expect(historyApi.record).toHaveBeenCalledTimes(1);

      await viz.applyPanelData(blob("bar", "sum(c)"), RANGE, false);
      await flushPromises();
      expect(data.queries[0].query).toBe("sum(c)");
      expect(editorRunQuery).toHaveBeenCalledTimes(2);
    });
  });
});

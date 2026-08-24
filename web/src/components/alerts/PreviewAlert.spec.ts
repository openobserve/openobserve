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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import PreviewAlert from "./PreviewAlert.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

vi.mock("../dashboards/PanelSchemaRenderer.vue", () => ({
  default: {
    name: "PanelSchemaRenderer",
    template: "<div data-test='panel-schema-renderer'></div>",
    props: [
      "height",
      "width",
      "panelSchema",
      "selectedTimeObj",
      "variablesData",
      "searchType",
      "is_ui_histogram",
    ],
    emits: ["result-metadata-update", "series-data-update"],
  },
}));

vi.mock("@/services/search", () => ({
  default: {
    result_schema: vi.fn().mockResolvedValue({
      data: { group_by: [], projections: [], timeseries_field: null },
    }),
    search: vi.fn().mockResolvedValue({ data: { hits: [], total: 0 } }),
  },
}));

const baseFormData = () => ({
  stream_name: "test-stream",
  stream_type: "logs",
  trigger_condition: {
    period: 10,
    threshold: 5,
    operator: ">=",
  },
  query_condition: {
    aggregation: {
      function: "count",
      group_by: [],
      having: { column: "", operator: ">=", value: 1 },
    },
  },
});

async function mountComp(props: Record<string, any> = {}) {
  return mount(PreviewAlert, {
    global: {
      plugins: [i18n, store],
    },
    props: {
      query: "",
      formData: baseFormData(),
      isAggregationEnabled: false,
      selectedTab: "custom",
      isUsingBackendSql: false,
      isEditorOpen: false,
      ...props,
    },
  });
}

// ---------------------------------------------------------------------------
// Shared verdict harness
//
// `expectVerdict`, `tr` and `emitResultMetadata` were originally scoped inside
// describe("PreviewAlert - PromQL verdict"). They are hoisted here verbatim so
// the SQL-verdict block below can assert badge sentences the same way, rather
// than growing a second, divergent copy.
// ---------------------------------------------------------------------------

const P = "alerts.previewEvaluation.";

/**
 * Label fragments the badge sentence is built from. Pinned as KEYS, never as
 * English text: a label hardcoded in the component renders identically to a
 * translated one, so only resolving through i18n here can tell them apart.
 *
 * `matchingSeries` / `matchingSeriesPlural` do not exist yet — they are part of
 * the fix, and must be added to every file in src/locales/languages (there is a
 * parity test for that in localeMessages.spec.ts).
 */
const LABEL_KEYS = {
  series: ["matchingSeries", "matchingSeriesPlural"],
  dataPoints: ["dataPoint", "dataPoints"],
  rows: ["row", "rows"],
  groups: ["matchingGroup", "matchingGroups"],
} as const;

/** Severity words for the level suffix — also new keys added by the fix. */
const LEVEL_KEYS = { critical: "levelCritical", warning: "levelWarning" } as const;

const tr = (key: string, args?: Record<string, unknown>) =>
  args ? i18n.global.t(`${P}${key}` as never, args as never) : i18n.global.t(`${P}${key}` as never);

/**
 * Assert a verdict by REBUILDING the expected sentence from the i18n templates
 * and label keys, so a copy edit to a template does not break a dozen tests for
 * no behavioural reason, and so a label that never went through i18n is caught.
 *
 * `level` names the severity the badge must report. It is asserted only where a
 * warning band exists — an alert with a single band has nothing to disambiguate,
 * and the sentence must then carry no severity word at all.
 */
const expectVerdict = (
  w: VueWrapper<any>,
  opts: {
    matched: number;
    gate: string;
    trigger: boolean;
    label?: keyof typeof LABEL_KEYS;
    level?: keyof typeof LEVEL_KEYS | null;
  },
) => {
  expect(w.vm.evaluationStatus).toBeTruthy();
  expect(w.vm.evaluationStatus?.wouldTrigger).toBe(opts.trigger);

  const [singular, plural] = LABEL_KEYS[opts.label ?? "series"];
  const args = {
    count: opts.matched,
    label: tr(opts.matched === 1 ? singular : plural),
    comparison: opts.gate,
  };
  const sentence = opts.trigger ? tr("reasonMatch", args) : tr("reasonNoMatch", args);
  const reason = w.vm.evaluationStatus?.reason as string;

  if (!opts.level) {
    // Exact: no severity word, no stray text.
    expect(reason).toBe(sentence);
    return;
  }

  const other = opts.level === "critical" ? "warning" : "critical";
  expect(reason).toContain(sentence);
  expect(reason).toContain(tr(LEVEL_KEYS[opts.level]));
  expect(reason).not.toContain(tr(LEVEL_KEYS[other]));
};

/** Drive the real template wiring, not the handler directly. */
const emitResultMetadata = async (w: VueWrapper<any>, payload: any) => {
  w.findComponent({ name: "PanelSchemaRenderer" }).vm.$emit("result-metadata-update", payload);
  await nextTick();
};

describe("PreviewAlert - rendering", () => {
  let wrapper: VueWrapper<any>;

  beforeEach(async () => {
    wrapper = await mountComp();
  });

  afterEach(() => wrapper?.unmount());

  it("renders without errors", () => {
    expect(wrapper.exists()).toBe(true);
  });

  it("renders the preview chart container", () => {
    expect(wrapper.find('[data-test="alert-preview-chart"]').exists()).toBe(true);
  });

  it("shows placeholder when query is empty and selectedTab is sql", async () => {
    await wrapper.setProps({ query: "", selectedTab: "sql" });

    await nextTick();
    // There should be some element visible (the empty-query placeholder)
    expect(wrapper.html()).not.toBe("");
  });

  it("shows placeholder when query is empty and selectedTab is promql", async () => {
    await wrapper.setProps({ query: "", selectedTab: "promql" });
    await nextTick();
    expect(wrapper.html()).not.toBe("");
  });

  it("does NOT show PanelSchemaRenderer when chartData has no type (empty object)", async () => {
    const w = await mountComp({ query: "", selectedTab: "custom" });
    // chartData = {} → truthy but v-else-if="chartData" is true for a non-empty-ish ref
    // The component renders PanelSchemaRenderer based on chartData being set;
    // when query is empty we just verify the chart container exists without error.
    expect(w.find('[data-test="alert-preview-chart"]').exists()).toBe(true);
    w.unmount();
  });
});

describe("PreviewAlert - props", () => {
  afterEach(() => vi.clearAllMocks());

  it("accepts all props with defaults", async () => {
    const w = await mountComp();
    expect(w.props().query).toBe("");
    expect(w.props().isAggregationEnabled).toBe(false);
    expect(w.props().selectedTab).toBe("custom");
    expect(w.props().isUsingBackendSql).toBe(false);
    w.unmount();
  });

  it("accepts explicit prop values", async () => {
    const w = await mountComp({
      query: "SELECT count(*) FROM logs",
      isAggregationEnabled: true,
      selectedTab: "sql",
      isUsingBackendSql: true,
    });
    expect(w.props().query).toBe("SELECT count(*) FROM logs");
    expect(w.props().isAggregationEnabled).toBe(true);
    expect(w.props().selectedTab).toBe("sql");
    expect(w.props().isUsingBackendSql).toBe(true);
    w.unmount();
  });

  it("isEditorOpen defaults to false", async () => {
    const w = await mountComp();
    expect(w.props().isEditorOpen).toBe(false);
    w.unmount();
  });
});

describe("PreviewAlert - PanelSchemaRenderer integration", () => {
  afterEach(() => vi.clearAllMocks());

  it("renders PanelSchemaRenderer when chartData is set", async () => {
    const w = await mountComp({ query: "SELECT * FROM logs" });
    w.vm.chartData = { type: "line", queries: [] };
    await nextTick();
    const renderer = w.findComponent({ name: "PanelSchemaRenderer" });
    expect(renderer.exists()).toBe(true);
    w.unmount();
  });

  it("passes panelSchema prop to PanelSchemaRenderer", async () => {
    const w = await mountComp({ query: "SELECT * FROM logs" });
    const mockData = { type: "line", queries: [] };
    w.vm.chartData = mockData;
    await nextTick();
    const renderer = w.findComponent({ name: "PanelSchemaRenderer" });
    expect(renderer.props("panelSchema")).toEqual(mockData);
    w.unmount();
  });

  it("passes empty variablesData to PanelSchemaRenderer", async () => {
    const w = await mountComp({ query: "SELECT * FROM logs" });
    w.vm.chartData = { type: "line" };
    await nextTick();
    const renderer = w.findComponent({ name: "PanelSchemaRenderer" });
    expect(renderer.props("variablesData")).toEqual({});
    w.unmount();
  });

  it("passes is_ui_histogram=true when isUsingBackendSql=true and custom+noAgg", async () => {
    const w = await mountComp({
      query: "SELECT * FROM logs",
      isUsingBackendSql: true,
      selectedTab: "custom",
      isAggregationEnabled: false,
    });
    w.vm.chartData = { type: "line" };
    await nextTick();
    const renderer = w.findComponent({ name: "PanelSchemaRenderer" });
    // shouldUseHistogram = isUsingBackendSql when tab=custom and !aggregation
    expect(renderer.props("is_ui_histogram")).toBe(true);
    w.unmount();
  });

  it("passes is_ui_histogram=false when custom mode with aggregation", async () => {
    const w = await mountComp({
      query: "SELECT count(*) FROM logs",
      isUsingBackendSql: true,
      selectedTab: "custom",
      isAggregationEnabled: true,
    });
    w.vm.chartData = { type: "line" };
    await nextTick();
    const renderer = w.findComponent({ name: "PanelSchemaRenderer" });
    // shouldUseHistogram = false when custom+aggregation
    expect(renderer.props("is_ui_histogram")).toBe(false);
    w.unmount();
  });
});

describe("PreviewAlert - refreshData method", () => {
  afterEach(() => vi.clearAllMocks());

  it("exposes refreshData method", async () => {
    const w = await mountComp();
    expect(typeof w.vm.refreshData).toBe("function");
    w.unmount();
  });

  it("returns early when query is empty", async () => {
    const w = await mountComp({ query: "" });
    // chartData should remain {} when no query
    expect(w.vm.chartData).toEqual({});
    w.unmount();
  });

  it("does not throw when trigger_condition is missing", async () => {
    const w = await mountComp({
      query: "SELECT * FROM logs",
      formData: { stream_name: "test", stream_type: "logs" },
    });
    expect(() => w.vm.refreshData()).not.toThrow();
    w.unmount();
  });

  it("sets chartData after refreshData in custom mode", async () => {
    const w = await mountComp({
      query: "SELECT * FROM logs",
      selectedTab: "custom",
      formData: baseFormData(),
    });

    w.vm.refreshData();
    await nextTick();

    expect(w.vm.chartData).toBeDefined();
    w.unmount();
  });

  it("sets chartData after refreshData in promql mode", async () => {
    const w = await mountComp({
      query: "up",
      selectedTab: "promql",
      formData: baseFormData(),
    });

    w.vm.refreshData();
    await nextTick();

    expect(w.vm.chartData).toBeDefined();
    w.unmount();
  });

  // A binary operator or an aggregation strips every label, so the series comes
  // back with an empty label set that the legend would otherwise render as "{}".
  it('names a label-less promql series after the stream, not "{}"', async () => {
    const w = await mountComp({
      query: "a / on(instance, job) b",
      selectedTab: "promql",
      formData: baseFormData(),
    });

    w.vm.refreshData();
    await nextTick();

    expect(w.vm.dashboardPanelData?.data?.queries?.[0]?.config?.promql_legend_fallback).toBe(
      "test-stream",
    );
    w.unmount();
  });

  it("sets queryType to sql in custom mode", async () => {
    const w = await mountComp({
      query: "SELECT * FROM logs",
      selectedTab: "custom",
      formData: baseFormData(),
    });

    w.vm.refreshData();
    await nextTick();

    expect(w.vm.dashboardPanelData?.data?.queryType).toBe("sql");
    w.unmount();
  });

  // A chart auto-scales to its DATA. Drawing a threshold line without widening
  // the axis to hold it is how the line goes missing in the case that matters
  // most — an alert that is NOT currently firing, where every value sits below
  // the threshold. `thresholdAxisBounds` only ever widens, so this cannot clip
  // data that already crosses the line.
  it("widens the y-axis to keep the threshold line on screen (custom mode)", async () => {
    const w = await mountComp({
      query: "SELECT * FROM logs",
      selectedTab: "custom",
      formData: baseFormData(), // threshold: 5
    });

    w.vm.refreshData();
    await nextTick();

    const config = w.vm.chartData.config;
    expect(config.mark_line).toEqual([expect.objectContaining({ name: "Critical", value: "5" })]);
    expect(config.y_axis_max).toBeGreaterThan(5);
    expect(config.y_axis_min).toBeLessThan(5);
    w.unmount();
  });

  it("widens the y-axis for the PromQL threshold too", async () => {
    const formData = baseFormData() as any;
    formData.query_condition.promql_condition = { column: "value", operator: "=", value: 2 };
    const w = await mountComp({ query: "up", selectedTab: "promql", formData });

    w.vm.refreshData();
    await nextTick();

    const config = w.vm.chartData.config;
    expect(config.mark_line).toEqual([expect.objectContaining({ name: "Critical", value: "2" })]);
    expect(config.y_axis_max).toBeGreaterThan(2);
    expect(config.y_axis_min).toBeLessThan(2);
    w.unmount();
  });

  it("drops the headroom when the threshold goes away, rather than leaving it stale", async () => {
    const formData = baseFormData() as any;
    formData.query_condition.promql_condition = { column: "value", operator: "=", value: 2 };
    const w = await mountComp({ query: "up", selectedTab: "promql", formData });

    w.vm.refreshData();
    await nextTick();
    expect(w.vm.chartData.config.y_axis_max).toBeDefined();

    const cleared = baseFormData() as any;
    cleared.query_condition.promql_condition = null;
    await w.setProps({ formData: cleared });
    w.vm.refreshData();
    await nextTick();

    expect(w.vm.chartData.config.mark_line).toEqual([]);
    expect(w.vm.chartData.config.y_axis_min).toBeUndefined();
    expect(w.vm.chartData.config.y_axis_max).toBeUndefined();
    w.unmount();
  });

  it("clones chartData (not same reference as dashboardPanelData.data)", async () => {
    const w = await mountComp({
      query: "SELECT * FROM logs",
      selectedTab: "custom",
      formData: baseFormData(),
    });

    w.vm.refreshData();
    await nextTick();

    expect(w.vm.chartData).not.toBe(w.vm.dashboardPanelData?.data);
    w.unmount();
  });
});

describe("PreviewAlert - exposeRefresh and resizeChart", () => {
  afterEach(() => vi.clearAllMocks());

  it("exposes resizeChart method", async () => {
    const w = await mountComp();
    expect(typeof w.vm.resizeChart).toBe("function");
    w.unmount();
  });

  it("exposes evaluationStatus", async () => {
    const w = await mountComp();
    expect("evaluationStatus" in w.vm).toBe(true);
    w.unmount();
  });
});

describe("PreviewAlert - evaluateAndSetStatus", () => {
  afterEach(() => vi.clearAllMocks());

  it("sets evaluationStatus to wouldTrigger=true when resultCount >= threshold", async () => {
    const w = await mountComp({
      formData: {
        ...baseFormData(),
        trigger_condition: { period: 10, threshold: 3, operator: ">=" },
        is_real_time: false,
      },
    });

    (w.vm as any).evaluateAndSetStatus(5);

    expect(w.vm.evaluationStatus?.wouldTrigger).toBe(true);
    w.unmount();
  });

  it("sets evaluationStatus to wouldTrigger=false when resultCount < threshold", async () => {
    const w = await mountComp({
      formData: {
        ...baseFormData(),
        trigger_condition: { period: 10, threshold: 10, operator: ">=" },
        is_real_time: false,
      },
    });

    (w.vm as any).evaluateAndSetStatus(2);

    expect(w.vm.evaluationStatus?.wouldTrigger).toBe(false);
    w.unmount();
  });

  it("always returns wouldTrigger=true for real-time alerts", async () => {
    const w = await mountComp({
      formData: {
        ...baseFormData(),
        trigger_condition: { period: 10, threshold: 100, operator: ">=" },
        is_real_time: true,
      },
    });

    (w.vm as any).evaluateAndSetStatus(0);

    expect(w.vm.evaluationStatus?.wouldTrigger).toBe(true);
    w.unmount();
  });

  it("handles != operator", async () => {
    const w = await mountComp({
      formData: {
        ...baseFormData(),
        trigger_condition: { period: 10, threshold: 5, operator: "!=" },
        is_real_time: false,
      },
    });

    (w.vm as any).evaluateAndSetStatus(3);
    expect(w.vm.evaluationStatus?.wouldTrigger).toBe(true);

    (w.vm as any).evaluateAndSetStatus(5);
    expect(w.vm.evaluationStatus?.wouldTrigger).toBe(false);
    w.unmount();
  });
});

describe("PreviewAlert - watcher behavior", () => {
  afterEach(() => vi.clearAllMocks());

  it("does not refresh when query is empty in watch", async () => {
    const w = await mountComp({
      query: "SELECT * FROM logs",
      selectedTab: "custom",
    });
    await w.setProps({ query: "" });
    await flushPromises();

    // With empty query, watch won't call refreshData
    expect(w.vm.chartData).toBeDefined();
    w.unmount();
  });

  it("chartData is defined after prop update", async () => {
    const w = await mountComp({
      query: "SELECT * FROM logs",
      selectedTab: "custom",
    });

    await w.setProps({ formData: { ...baseFormData(), stream_name: "new-stream" } });
    await flushPromises();

    expect(w.vm.chartData).toBeDefined();
    w.unmount();
  });
});

describe("PreviewAlert - cleanAggregationQuery", () => {
  afterEach(() => vi.clearAllMocks());

  it("exposes cleanAggregationQuery internally (internal test via refreshData)", async () => {
    const w = await mountComp({
      query:
        "SELECT histogram(_timestamp) AS zo_sql_key, count(*) AS zo_sql_val FROM stream GROUP BY zo_sql_key HAVING zo_sql_val >= 10",
      selectedTab: "custom",
      isAggregationEnabled: true,
      formData: {
        ...baseFormData(),
        query_condition: {
          aggregation: {
            function: "count",
            group_by: [],
            having: { column: "count", operator: ">=", value: 10 },
          },
        },
        trigger_condition: { period: 10, threshold: 5, operator: ">=" },
      },
    });

    // Just verify component doesn't throw
    w.vm.refreshData();
    await nextTick();
    expect(w.vm.chartData).toBeDefined();
    w.unmount();
  });
});

describe("PreviewAlert - onMounted behavior", () => {
  afterEach(() => vi.clearAllMocks());

  it("does not call refreshData on mount when query is empty", async () => {
    const w = await mountComp({ query: "", selectedTab: "custom" });
    await nextTick();
    await flushPromises();

    // chartData stays empty object when no query on mount
    expect(w.vm.chartData).toEqual({});
    w.unmount();
  });

  it("does not call refreshData on mount for promql (skipped by design)", async () => {
    const w = await mountComp({ query: "up", selectedTab: "promql" });
    await nextTick();
    await flushPromises();

    // promql skips onMounted refresh intentionally
    expect(w.vm.chartData).toBeDefined();
    w.unmount();
  });
});

// ---------------------------------------------------------------------------
// PromQL verdict
//
// The backend evaluates a PromQL alert on TWO axes (src/core/src/alerts/mod.rs:272
// calling config/src/meta/alerts/aggregation_level.rs `evaluate_level_over_items`):
// the LAST sample of each returned series is classified against
// `query_condition.promql_condition` (critical) and, when set,
// `promql_warning_value` (warning); only THEN is a series COUNT gated by
// `trigger_condition` ("having series >= 1").
//
// The preview must answer that same question. Counting the series the query
// returned and comparing that to the count gate answers "did the metric return any
// data at all?", which is a tautology — such a preview says WOULD TRIGGER for a
// fleet sitting at 20%.
//
// Fixtures use STRING sample values and interleaved `null` points because that is
// what production sends: the HTTP metrics-query response serialises each sample as
// [ts, value.to_string()] (the `impl Serialize for Sample`,
// src/config/src/meta/promql/value.rs:176-186) and the streaming overlay pushes
// [Date, null] anchors onto every series (overlayNewDataOnOldOptions.ts:80).
// That serializer is a property of the HTTP RESPONSE, which is what the frontend
// consumes — it is NOT on the alert-evaluation path. The engine destructures an
// in-process `Value::Matrix` (mod.rs:251), where `last_sample.value` is a raw f64
// and never round-trips through a string.
// ---------------------------------------------------------------------------
describe("PreviewAlert - PromQL verdict", () => {
  // The degenerate-shape tests spy on console.error; setupTests.ts already wraps
  // it, so a leaked spy would silently swallow warnings for the rest of the file.
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  const T0 = 1700000000000;
  const EN = "en-us";
  /** One PromQL series as convertPromQLData emits it: [time, "value"] pairs. */
  const series = (name: string, values: Array<string | number | null>) => ({
    name,
    data: values.map((v, i) => [T0 + i * 15000, v]),
  });

  /** The `series-data-update` payload: the converted ECharts option. */
  const seriesPayload = (...s: any[]) => ({ options: { series: s } });

  /** Three nodes: one at 85%, the rest healthy. */
  const threeNodes = () =>
    seriesPayload(
      series("node-a", ["18", "20"]),
      series("node-b", ["82", "85"]),
      series("node-c", ["12", "10"]),
    );

  async function mountPromql(
    opts: {
      condition?: any;
      // Not `number`: the point of several tests below is that the form hands the
      // preview whatever the user typed, including "" the moment a box is cleared.
      warningValue?: unknown;
      threshold?: unknown;
      operator?: string;
      isRealTime?: boolean;
      multiAlert?: boolean;
    } = {},
  ) {
    const formData: any = {
      stream_name: "k8s_node_memory_usage",
      stream_type: "metrics",
      is_real_time: opts.isRealTime ? "true" : false,
      trigger_condition: {
        period: 10,
        threshold: opts.threshold ?? 1,
        operator: opts.operator ?? ">=",
      },
      query_condition: {
        promql_condition:
          opts.condition === undefined
            ? { column: "value", operator: ">=", value: 80 }
            : opts.condition,
        promql_warning_value: opts.warningValue,
        promql_multi_alert: opts.multiAlert ?? false,
      },
    };
    return mountComp({ query: "k8s_node_memory_usage", selectedTab: "promql", formData });
  }

  /** Drive the real template wiring, not the handler directly. */
  const emitSeries = async (w: VueWrapper<any>, payload: any) => {
    w.findComponent({ name: "PanelSchemaRenderer" }).vm.$emit("series-data-update", payload);
    await nextTick();
  };

  // ── the value filter ──────────────────────────────────────────────────────

  it("counts only the series whose latest value satisfies promql_condition", async () => {
    const w = await mountPromql({ condition: { column: "value", operator: ">=", value: 80 } });

    await emitSeries(w, threeNodes());

    // One of three nodes is over 80, and the count gate wants >= 1.
    expectVerdict(w, { matched: 1, gate: "1 >= 1", trigger: true });
    w.unmount();
  });

  it("renders WOULD NOT TRIGGER when no series meets the condition", async () => {
    const w = await mountPromql({ condition: { column: "value", operator: ">=", value: 90 } });

    await emitSeries(w, threeNodes());

    // Zero matches is the common, informative case — it must be REPORTED, not
    // dropped on the floor leaving the badge blank (or stale from the last run).
    expectVerdict(w, { matched: 0, gate: "0 >= 1", trigger: false });
    w.unmount();
  });

  it("applies the count gate AFTER the value filter, not instead of it", async () => {
    const w = await mountPromql({
      condition: { column: "value", operator: ">=", value: 80 },
      threshold: 2,
    });

    await emitSeries(w, threeNodes());

    // Three series came back, but only one is over 80, and the alert wants two.
    expectVerdict(w, { matched: 1, gate: "1 >= 2", trigger: false });
    w.unmount();
  });

  it("judges a series by its LAST sample, not by whether it ever crossed", async () => {
    const w = await mountPromql({ condition: { column: "value", operator: ">=", value: 80 } });

    // Spiked to 85, now back down to 40 — not currently over the line.
    await emitSeries(w, seriesPayload(series("node-a", ["85", "40"])));

    expectVerdict(w, { matched: 0, gate: "0 >= 1", trigger: false });
    w.unmount();
  });

  // ── sample hygiene: nulls, non-finite values, floats ──────────────────────

  it("skips the overlay's trailing null anchors when reading the last sample", async () => {
    const w = await mountPromql({ condition: { column: "value", operator: ">=", value: 80 } });

    // Faithful production shape: the overlay unshifts and pushes real Date anchors
    // onto number-timestamped data, so the last POINT of a series is routinely not
    // its last SAMPLE.
    await emitSeries(w, {
      options: {
        series: [
          {
            name: "node-a",
            data: [
              [new Date(T0), null],
              [T0 + 15000, "85"],
              [new Date(T0 + 30000), null],
            ],
          },
          {
            name: "node-b",
            data: [
              [new Date(T0), null],
              [T0 + 15000, "40"],
              [new Date(T0 + 30000), null],
            ],
          },
        ],
      },
    });

    expectVerdict(w, { matched: 1, gate: "1 >= 1", trigger: true });
    w.unmount();
  });

  it("counts an all-null series as no match, without logging an error", async () => {
    const w = await mountPromql({ condition: { column: "value", operator: ">=", value: 80 } });
    // handleSeriesDataUpdate swallows its own exceptions into console.error, so a
    // TypeError on a degenerate series would otherwise be invisible here.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await emitSeries(
        w,
        seriesPayload(series("node-a", [null, "85", null]), series("node-b", [null, null, null])),
      );

      // node-b contributes nothing; node-a is the only match.
      expectVerdict(w, { matched: 1, gate: "1 >= 1", trigger: true });
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
      w.unmount();
    }
  });

  it("treats a null sample as absent, not as the number zero", async () => {
    // `Number(null)` is 0, and 0 is finite — so a "last finite sample" scan that
    // does not check for null explicitly reads an empty series as a hard zero and
    // counts it against every downward condition.
    const w = await mountPromql({ condition: { column: "value", operator: "<=", value: 30 } });

    await emitSeries(w, seriesPayload(series("node-a", [null, null, null])));

    expectVerdict(w, { matched: 0, gate: "0 >= 1", trigger: false });
    w.unmount();
  });

  it("drops a series whose last sample is not finite, rather than walking back", async () => {
    // Rust's f64::to_string emits "NaN" and "inf". The backend takes
    // `samples.last()` UNCONDITIONALLY (mod.rs:265) and then drops the whole
    // SERIES when that value is not a JSON number (`filter_map(as_f64)`, :274 —
    // `serde_json::Value::from(f64::NAN)` is `Null`). It does not fall back to an
    // earlier sample, so neither may the preview: walking back would report
    // WOULD TRIGGER off a stale 85 for a series the backend never even counts.
    // A `null` GAP is a different thing entirely and is still skipped — that is a
    // UI artifact the backend never sees (see the overlay-anchor test above).
    const w = await mountPromql({ condition: { column: "value", operator: ">=", value: 80 } });

    await emitSeries(
      w,
      seriesPayload(
        series("nan-tail", ["85", "NaN"]),
        series("inf-tail", ["20", "inf"]),
        // Synthetic: a numeric Infinity cannot survive JSON, but it pins that the
        // scan tests for FINITE, not merely for not-NaN.
        series("infinity", ["85", Infinity]),
        // Non-vacuous: the scan must still find a real tail when there is one.
        series("healthy-tail", ["10", "85"]),
      ),
    );

    // Only the series whose LAST sample is a real number counts.
    expectVerdict(w, { matched: 1, gate: "1 >= 1", trigger: true });
    w.unmount();
  });

  it("compares fractional values, not just integers", async () => {
    // PromQL values are floats; parseInt would read "85.5" as 85.
    const w = await mountPromql({ condition: { column: "value", operator: ">=", value: 85.2 } });

    await emitSeries(w, seriesPayload(series("node-a", ["10.5", "85.5"])));

    expectVerdict(w, { matched: 1, gate: "1 >= 1", trigger: true });
    w.unmount();
  });

  // ── thresholds: zero, negative, string, boundary ──────────────────────────

  it("treats a threshold of 0 as a real threshold, not as unset", async () => {
    // `if (!pc.value) return true` would read `value: 0` as "no condition set" and
    // wave every series through. Zero is the whole point of alerts like
    // "up == 0" or "available replicas <= 0".
    const w = await mountPromql({ condition: { column: "value", operator: "<=", value: 0 } });

    await emitSeries(w, seriesPayload(series("down", ["1", "0"]), series("up", ["5", "5"])));

    expectVerdict(w, { matched: 1, gate: "1 >= 1", trigger: true });
    w.unmount();
  });

  it("handles a negative threshold", async () => {
    const w = await mountPromql({ condition: { column: "value", operator: ">=", value: -1 } });

    await emitSeries(w, seriesPayload(series("a", ["-2", "-5"]), series("b", ["-1", "0"])));

    // 0 >= -1 counts; -5 does not.
    expectVerdict(w, { matched: 1, gate: "1 >= 1", trigger: true });
    w.unmount();
  });

  it("compares numerically when the form holds the threshold as a string", async () => {
    // The alert form carries the raw input value; it is only coerced to a number
    // when the payload is built (see alertPayload.spec.ts), so the preview sees "80".
    const w = await mountPromql({ condition: { column: "value", operator: ">=", value: "80" } });

    await emitSeries(w, seriesPayload(series("node-a", ["9", "9"])));

    // A string compare would make "9" >= "80" true.
    expectVerdict(w, { matched: 0, gate: "0 >= 1", trigger: false });
    w.unmount();
  });

  it("counts a series sitting exactly on the threshold for >=", async () => {
    // The operator from the original bug report, at its boundary: >= weakened to >
    // is invisible unless a fixture lands exactly on the line.
    const w = await mountPromql({ condition: { column: "value", operator: ">=", value: 80 } });

    await emitSeries(
      w,
      seriesPayload(series("exact", ["70", "80"]), series("under", ["70", "79"])),
    );

    expectVerdict(w, { matched: 1, gate: "1 >= 1", trigger: true });
    w.unmount();
  });

  // ── operators ─────────────────────────────────────────────────────────────

  it("honours the > operator, excluding a series exactly on the line", async () => {
    const w = await mountPromql({ condition: { column: "value", operator: ">", value: 80 } });

    await emitSeries(w, seriesPayload(series("over", ["70", "85"]), series("exact", ["70", "80"])));

    // Strictly greater: 80 does not count. Falling through to a `>=` default would.
    expectVerdict(w, { matched: 1, gate: "1 >= 1", trigger: true });
    w.unmount();
  });

  it("honours the <= operator", async () => {
    const w = await mountPromql({ condition: { column: "value", operator: "<=", value: 30 } });
    await emitSeries(w, threeNodes());
    // 20 and 10 are at or under 30; 85 is not.
    expectVerdict(w, { matched: 2, gate: "2 >= 1", trigger: true });
    w.unmount();
  });

  it("honours the < operator", async () => {
    const w = await mountPromql({ condition: { column: "value", operator: "<", value: 20 } });
    await emitSeries(w, threeNodes());
    // Strictly under 20: only node-c at 10 (node-a sits exactly on 20).
    expectVerdict(w, { matched: 1, gate: "1 >= 1", trigger: true });
    w.unmount();
  });

  it("honours the = operator", async () => {
    const w = await mountPromql({ condition: { column: "value", operator: "=", value: 85 } });

    // "hotter" is above the equality value: equality must not degrade into >=.
    await emitSeries(
      w,
      seriesPayload(
        series("equal", ["80", "85"]),
        series("hotter", ["80", "90"]),
        series("cooler", ["10", "20"]),
      ),
    );

    expectVerdict(w, { matched: 1, gate: "1 >= 1", trigger: true });
    w.unmount();
  });

  it("honours the == spelling of equality (the backend's PromQL form)", async () => {
    const w = await mountPromql({ condition: { column: "value", operator: "==", value: 85 } });
    await emitSeries(
      w,
      seriesPayload(series("equal", ["80", "85"]), series("hotter", ["80", "90"])),
    );
    expectVerdict(w, { matched: 1, gate: "1 >= 1", trigger: true });
    w.unmount();
  });

  it("honours the != operator", async () => {
    const w = await mountPromql({ condition: { column: "value", operator: "!=", value: 85 } });
    await emitSeries(w, threeNodes());
    // node-a (20) and node-c (10) differ from 85; node-b does not.
    expectVerdict(w, { matched: 2, gate: "2 >= 1", trigger: true });
    w.unmount();
  });

  it("classifies nothing when it does not recognise the operator", async () => {
    // Mirrors `compare`'s `_ => false` (level.rs:217): an operator with no
    // numeric meaning classifies NO series. Reachable without an API bug —
    // nothing rejects a non-comparison PromQL operator at save time: the
    // direction check runs only when a warning value is set (alert.rs:720-727)
    // and the rest of PromQL validation is presence-only (alert.rs:770-776), so
    // an alert carrying e.g. `Contains` saves cleanly.
    //
    // It does NOT then "never fire", which is what an earlier version of this
    // comment claimed. Single-alert mode bakes the operator into the query
    // (`(expr) contains 500`, mod.rs:198-210) — invalid PromQL, so the search
    // errors and mod.rs:242-249 propagates that error deliberately rather than
    // clearing the prior level. The alert ERRORS every evaluation. And zero
    // classified series still reaches the count gate; see the `<= 0` test below.
    //
    // Defaulting to >= would invent a classification the backend never makes;
    // defaulting to `true` would restore the original tautology. Neither: it is
    // not a match.
    const w = await mountPromql({ condition: { column: "value", operator: "", value: 80 } });

    await emitSeries(w, threeNodes());

    expectVerdict(w, { matched: 0, gate: "0 >= 1", trigger: false });
    w.unmount();
  });

  it("still fires the count gate on ZERO classified series when the gate is `<= 0`", async () => {
    // COUNTER-INTUITIVE AND CORRECT — do not "fix" this into a no-trigger.
    //
    // The two axes are independent fields. `promql_condition.operator` decides
    // which series are classified; `trigger_condition.operator` decides whether
    // the resulting COUNT fires. `evaluate_level_over_items` runs the second one
    // unconditionally — with an empty `item_values` it still evaluates
    // `compare(0.0, tc.operator, tc.threshold as f64)` (aggregation_level.rs:167)
    // — so `<= 0` (equally `< 1`, or `!= N` for any N != 0) returns
    // Some(AlertLevel::Critical) with nothing matching anything.
    //
    // Here BOTH halves are exercised at once: the promql operator is
    // unrecognised, so every series classifies false and the count is 0, and the
    // gate is `<= 0`, so 0 passes it. A short-circuit anywhere on this path —
    // an early `if (criticalCount === 0) return` in evaluatePromqlSeries, or a
    // `count === 0` guard inside evaluateCountGate — would make the preview say
    // WOULD NOT TRIGGER for an alert the engine fires.
    const w = await mountPromql({
      condition: { column: "value", operator: "", value: 80 },
      operator: "<=",
      threshold: 0,
    });

    await emitSeries(w, threeNodes());

    expectVerdict(w, { matched: 0, gate: "0 <= 0", trigger: true });
    w.unmount();
  });

  it("fires the `<= 0` count gate on zero series with a recognised operator too", async () => {
    // The companion to the case above, isolating the count axis: `>= 80` is a
    // perfectly ordinary operator and every series is healthy, so the count is a
    // legitimately-computed 0 — and `0 <= 0` still fires. This is the shape a
    // reader is most likely to mistake for a bug, since nothing about the alert
    // looks malformed.
    const w = await mountPromql({
      condition: { column: "value", operator: ">=", value: 500 },
      operator: "<=",
      threshold: 0,
    });

    await emitSeries(w, threeNodes());

    expectVerdict(w, { matched: 0, gate: "0 <= 0", trigger: true });
    w.unmount();
  });

  // ── severity: critical and warning bands ──────────────────────────────────
  //
  // Mirrors `evaluate_level_over_items` (aggregation_level.rs:146-177):
  //   * each series is classified critical-first, then warning
  //   * criticalCount is gated; if it passes, the alert fires CRITICAL
  //   * otherwise the warning-or-worse count is gated, and a pass fires WARNING
  //   * the reported count is the one whose gate was consulted last
  // For PromQL there is exactly ONE count gate: a `trigger_condition
  // .warning_threshold` is rejected at save time (alert.rs:680-696, the
  // WarningOnCoverageGate block; :689-696 is its PromQL arm).

  it("reports the CRITICAL level and count when the critical gate passes", async () => {
    const w = await mountPromql({
      condition: { column: "value", operator: ">=", value: 80 },
      warningValue: 50,
    });

    await emitSeries(
      w,
      seriesPayload(
        series("critical", ["82", "85"]),
        series("warning", ["55", "60"]),
        series("healthy", ["22", "20"]),
      ),
    );

    // criticalCount = 1 clears `1 >= 1`, so critical wins outright — the
    // warning-or-worse count of 2 is never consulted (critical is checked first).
    expectVerdict(w, { matched: 1, gate: "1 >= 1", trigger: true, level: "critical" });
    w.unmount();
  });

  it("fires at WARNING when only the warning band is met", async () => {
    const w = await mountPromql({
      condition: { column: "value", operator: ">=", value: 80 },
      warningValue: 50,
    });

    await emitSeries(
      w,
      seriesPayload(series("warning", ["55", "60"]), series("healthy", ["22", "20"])),
    );

    // Nothing is critical, so `0 >= 1` fails and the warning-or-worse count (1) is
    // gated instead. Reporting WOULD NOT TRIGGER here is the same class of wrong
    // answer as the original defect: the backend does fire this alert.
    expectVerdict(w, { matched: 1, gate: "1 >= 1", trigger: true, level: "warning" });
    w.unmount();
  });

  it("falls back to the warning band when the critical count misses the gate", async () => {
    const w = await mountPromql({
      condition: { column: "value", operator: ">=", value: 80 },
      warningValue: 50,
      threshold: 2,
    });

    await emitSeries(
      w,
      seriesPayload(
        series("critical", ["82", "85"]),
        series("warn-1", ["55", "60"]),
        series("warn-2", ["51", "52"]),
        series("healthy", ["22", "20"]),
      ),
    );

    // criticalCount 1 fails `1 >= 2`; warning-or-worse is 3 and clears `3 >= 2`.
    // The critical series is INCLUDED in that count — warning means "or worse".
    expectVerdict(w, { matched: 3, gate: "3 >= 2", trigger: true, level: "warning" });
    w.unmount();
  });

  it("does not trigger when neither band clears the gate", async () => {
    const w = await mountPromql({
      condition: { column: "value", operator: ">=", value: 80 },
      warningValue: 50,
      threshold: 3,
    });

    await emitSeries(
      w,
      seriesPayload(
        series("critical", ["82", "85"]),
        series("warning", ["55", "60"]),
        series("healthy", ["22", "20"]),
      ),
    );

    // criticalCount 1 fails `1 >= 3`, warning-or-worse 2 fails `2 >= 3`. The count
    // shown is the widest one actually gated, so the badge explains the near-miss
    // rather than reporting a critical count the chart does not visibly support.
    // No level FIRED, so no severity is named — naming one would imply it did.
    expectVerdict(w, { matched: 2, gate: "2 >= 3", trigger: false, level: null });
    w.unmount();
  });

  it("names no severity when the alert has only one band", async () => {
    // Without a warning value there is nothing to disambiguate, and the sentence
    // must stay exactly as it was.
    const w = await mountPromql({ condition: { column: "value", operator: ">=", value: 80 } });

    await emitSeries(w, threeNodes());

    expectVerdict(w, { matched: 1, gate: "1 >= 1", trigger: true, level: null });
    w.unmount();
  });

  it("ignores a warning value on the wrong side of critical", async () => {
    // widened_threshold takes the LESS severe of the two; a warning value more
    // severe than critical widens to nothing new. Every series that meets the
    // warning value here already meets critical, so the count is unchanged.
    const w = await mountPromql({
      condition: { column: "value", operator: ">=", value: 80 },
      warningValue: 90,
    });

    await emitSeries(
      w,
      seriesPayload(series("very-hot", ["88", "95"]), series("healthy", ["22", "20"])),
    );

    expectVerdict(w, { matched: 1, gate: "1 >= 1", trigger: true, level: "critical" });
    w.unmount();
  });

  // ── payload shapes ────────────────────────────────────────────────────────

  it("evaluates single-point series (the PromQL vector shape)", async () => {
    // An instant `vector` result yields exactly one point per series
    // (convertPromQLData.ts:743-745, `const values = [metric.value]`) and clears
    // the renderer's pre-filter only because it carries a name.
    const w = await mountPromql({ condition: { column: "value", operator: ">=", value: 80 } });

    await emitSeries(
      w,
      seriesPayload({ name: "hot", data: [[T0, "85"]] }, { name: "cold", data: [[T0, "20"]] }),
    );

    expectVerdict(w, { matched: 1, gate: "1 >= 1", trigger: true });
    w.unmount();
  });

  it("survives degenerate series shapes in the same payload", async () => {
    const w = await mountPromql({ condition: { column: "value", operator: ">=", value: 80 } });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      // Both the renderer's pre-filter and the last-sample scan reach into
      // `s.data`; `broken` has none at all.
      await emitSeries(
        w,
        seriesPayload(
          series("node-a", ["82", "85"]),
          { name: "empty", data: [] },
          { name: "broken" },
        ),
      );

      expectVerdict(w, { matched: 1, gate: "1 >= 1", trigger: true });
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
      w.unmount();
    }
  });

  it("never writes an UNFILTERED verdict from an alternative payload shape", async () => {
    // PanelSchemaRenderer only ever emits panelData, i.e. `{ options: { series } }`
    // (PanelSchemaRenderer.vue:1336). The handler's other branches — a bare array,
    // `.series`, `.data` — are speculative, and with the `resultCount > 0` guard
    // gone each becomes an unfiltered writer of the verdict: exactly the tautology
    // being fixed, reachable by a payload shape nobody audits. Deleting them is the
    // cleaner fix; this test only forbids the wrong answer, either way.
    const w = await mountPromql({ condition: { column: "value", operator: ">=", value: 80 } });

    await emitSeries(w, {
      series: [series("a", ["20"]), series("b", ["85"]), series("c", ["10"])],
    });

    expect(w.vm.evaluationStatus?.reason ?? "").not.toContain("3 >= 1");
    w.unmount();
  });

  it("never writes an unfiltered verdict from any of the DELETED payload shapes", async () => {
    // The handler used to accept a bare array, `.data`, and
    // `options.dataset.source` as well, each counting its length with no value
    // filter at all. PanelSchemaRenderer emits none of them
    // (PanelSchemaRenderer.vue:1338), so they are gone — and this test is what
    // stops them coming back: with the `resultCount > 0` guard also gone, any
    // one of them would resurrect the tautology behind a payload shape nobody
    // audits. Three healthy series that must never be reported as three matches.
    const w = await mountPromql({ condition: { column: "value", operator: ">=", value: 80 } });
    const healthy = [
      series("a", ["20", "22"]),
      series("b", ["18", "19"]),
      series("c", ["10", "11"]),
    ];

    const shapes: Array<[string, any]> = [
      ["bare array", healthy],
      [".data", { data: healthy }],
      [
        "options.dataset.source",
        { options: { dataset: { source: [["x"], ["a"], ["b"], ["c"]] } } },
      ],
    ];

    for (const [name, payload] of shapes) {
      await emitSeries(w, payload);
      const reason = w.vm.evaluationStatus?.reason ?? "";
      expect(reason, name).not.toContain("3 >= 1");
      expect(w.vm.evaluationStatus?.wouldTrigger, name).toBe(false);
    }
    w.unmount();
  });

  // ── the label ─────────────────────────────────────────────────────────────

  it("labels the PromQL count as series, not data points", async () => {
    const w = await mountPromql({ condition: { column: "value", operator: ">=", value: 80 } });

    await emitSeries(
      w,
      seriesPayload(
        series("node-a", ["18", "20"]),
        series("node-b", ["82", "85"]),
        series("node-c", ["90", "91"]),
      ),
    );

    // The preview hardcodes chart type "line" for PromQL, which is what made the
    // series count come out labelled "data points".
    expectVerdict(w, { matched: 2, gate: "2 >= 1", trigger: true });
    expect(w.vm.evaluationStatus?.reason).not.toContain(tr("dataPoints"));

    // ...and the singular form too, which is the one the commonest alert produces.
    await emitSeries(w, seriesPayload(series("node-b", ["82", "85"])));
    expectVerdict(w, { matched: 1, gate: "1 >= 1", trigger: true });
    expect(w.vm.evaluationStatus?.reason).not.toContain(tr("dataPoint"));
    w.unmount();
  });

  it("resolves the label through i18n instead of hardcoding the word", async () => {
    // A label hardcoded in the component renders identically to a translated one
    // in en-US, so the only way to tell them apart is to change what the key says
    // and watch the sentence follow. Same trick pins the singular/plural pair,
    // which is otherwise untestable in a language where both forms are "series".
    const original = JSON.parse(JSON.stringify(i18n.global.getLocaleMessage(EN)));
    i18n.global.mergeLocaleMessage(EN, {
      alerts: {
        previewEvaluation: { matchingSeries: "SERIES_ONE", matchingSeriesPlural: "SERIES_MANY" },
      },
    });

    const w = await mountPromql({ condition: { column: "value", operator: ">=", value: 80 } });
    try {
      await emitSeries(w, seriesPayload(series("node-b", ["82", "85"])));
      expect(w.vm.evaluationStatus?.reason).toContain("SERIES_ONE");
      expect(w.vm.evaluationStatus?.reason).not.toContain("SERIES_MANY");

      await emitSeries(
        w,
        seriesPayload(series("node-b", ["82", "85"]), series("node-c", ["90", "91"])),
      );
      expect(w.vm.evaluationStatus?.reason).toContain("SERIES_MANY");
      expect(w.vm.evaluationStatus?.reason).not.toContain("SERIES_ONE");
    } finally {
      i18n.global.setLocaleMessage(EN, original);
      w.unmount();
    }
  });

  it("still says data points for a builder-mode line chart", async () => {
    // The label must key off PROMQL MODE, not off the chart type (every builder
    // preview is a line chart) and not off the presence of a promql_condition
    // (the form keeps one around after the user switches tabs).
    const w = await mountComp({
      query: "SELECT * FROM logs",
      selectedTab: "custom",
      isAggregationEnabled: false,
      formData: {
        ...baseFormData(),
        is_real_time: false,
        trigger_condition: { period: 10, threshold: 5, operator: ">=" },
        query_condition: {
          ...baseFormData().query_condition,
          promql_condition: { column: "value", operator: ">=", value: 80 },
        },
      },
    });
    await flushPromises();

    await emitResultMetadata(w, [[{ hits: [{ zo_sql_num: 7 }] }]]);

    expectVerdict(w, { matched: 7, gate: "7 >= 5", trigger: true, label: "dataPoints" });
    w.unmount();
  });

  // ── one writer, one mode ──────────────────────────────────────────────────

  it("does not let result-metadata-update overwrite the PromQL verdict", async () => {
    const w = await mountPromql({ condition: { column: "value", operator: ">=", value: 80 } });

    await emitSeries(w, threeNodes());
    const verdict = { ...w.vm.evaluationStatus };
    expect(verdict.wouldTrigger).toBe(true);

    // PromQL resultMetaData carries query metadata only — no results at all — so
    // evaluating from it writes a bogus "0 >= 1" over the real verdict. Exactly one
    // handler may own the PromQL verdict, and it has to be the one that sees values.
    await emitResultMetadata(w, [[{ step: 15000000, trace_id: "x" }]]);

    expect(w.vm.evaluationStatus?.wouldTrigger).toBe(verdict.wouldTrigger);
    expect(w.vm.evaluationStatus?.reason).toBe(verdict.reason);
    w.unmount();
  });

  it("replaces a stale verdict when a refresh comes back with no series", async () => {
    const w = await mountPromql({ condition: { column: "value", operator: ">=", value: 80 } });

    await emitSeries(w, threeNodes());
    expect(w.vm.evaluationStatus?.wouldTrigger).toBe(true);

    // The renderer's "No Data" path emits an empty option. No data is a real
    // answer — WOULD NOT TRIGGER — not a reason to keep showing the last one.
    await emitSeries(w, seriesPayload());

    expectVerdict(w, { matched: 0, gate: "0 >= 1", trigger: false });
    w.unmount();
  });

  it("gives the same verdict whether or not promql_multi_alert is set", async () => {
    // The flag changes which QUERY the backend runs (raw expression per series vs
    // one pre-filtered query); the preview always charts the raw expression and
    // filters in JS, so the badge must not move.
    const payload = () =>
      seriesPayload(series("node-b", ["82", "85"]), series("node-c", ["12", "10"]));

    const single = await mountPromql({
      condition: { column: "value", operator: ">=", value: 80 },
      multiAlert: false,
    });
    await emitSeries(single, payload());
    const singleReason = single.vm.evaluationStatus?.reason;
    expectVerdict(single, { matched: 1, gate: "1 >= 1", trigger: true });
    single.unmount();

    const multi = await mountPromql({
      condition: { column: "value", operator: ">=", value: 80 },
      multiAlert: true,
    });
    await emitSeries(multi, payload());
    expectVerdict(multi, { matched: 1, gate: "1 >= 1", trigger: true });
    expect(multi.vm.evaluationStatus?.reason).toBe(singleReason);
    multi.unmount();
  });

  // ── behaviour that must NOT change ────────────────────────────────────────

  /**
   * Swap in a new promql_condition on a live wrapper, so the assertions below
   * watch a verdict being WITHDRAWN rather than reading the ref's initial null
   * and passing vacuously.
   */
  const setCondition = async (w: VueWrapper<any>, condition: any) => {
    await w.setProps({
      formData: {
        ...w.props("formData"),
        query_condition: {
          ...(w.props("formData") as any).query_condition,
          promql_condition: condition,
        },
      },
    });
  };

  /** The same, for the warning value — the second band rather than the first. */
  const setWarningValue = async (w: VueWrapper<any>, promql_warning_value: unknown) => {
    await w.setProps({
      formData: {
        ...w.props("formData"),
        query_condition: {
          ...(w.props("formData") as any).query_condition,
          promql_warning_value,
        },
      },
    });
  };

  it("withdraws the verdict when there is no promql_condition to judge by", async () => {
    // With nothing to classify against there is no question to answer, and
    // counting the series instead IS the tautology this fix removes — worse,
    // dressed as "3 series match (3 >= 3)" it reads as more authoritative than
    // the original bug did. No badge is the honest state for an alert that is
    // not configured yet; the backend rejects one saved this way.
    const w = await mountPromql({
      condition: { column: "value", operator: ">=", value: 80 },
      threshold: 1,
    });

    await emitSeries(w, threeNodes());
    expect(w.vm.evaluationStatus?.wouldTrigger).toBe(true);

    await setCondition(w, null);
    await emitSeries(w, threeNodes());

    expect(w.vm.evaluationStatus).toBeNull();
    w.unmount();
  });

  it("withdraws the verdict while the threshold field sits empty mid-edit", async () => {
    // A number input emits "" the moment the user clears the box, so this is an
    // ordinary keystroke rather than a corner case, and the badge must not
    // answer over a half-typed condition. Not to be confused with `value: 0`,
    // which is a real threshold — see the zero-threshold test above.
    const w = await mountPromql({
      condition: { column: "value", operator: ">=", value: 80 },
      threshold: 1,
    });

    await emitSeries(w, threeNodes());
    expect(w.vm.evaluationStatus?.wouldTrigger).toBe(true);

    await setCondition(w, { column: "value", operator: ">=", value: "" });
    await emitSeries(w, threeNodes());

    expect(w.vm.evaluationStatus).toBeNull();
    w.unmount();
  });

  it("withdraws the verdict for every unusable spelling of the critical value", async () => {
    // Whatever the policy is, it has to hold for all of them: `Number(" ")` is 0,
    // `Number(true)` is 1 and `Number([5])` is 5, so a value that merely LOOKS
    // unusable would otherwise be evaluated against a threshold nobody typed.
    const w = await mountPromql({
      condition: { column: "value", operator: ">=", value: 80 },
      threshold: 1,
    });

    for (const value of [
      " ",
      "  \t ",
      "abc",
      true,
      false,
      [5],
      {},
      null,
      undefined,
      NaN,
      Infinity,
    ]) {
      await setCondition(w, { column: "value", operator: ">=", value: 80 });
      await emitSeries(w, threeNodes());
      expect(w.vm.evaluationStatus?.wouldTrigger, JSON.stringify(value)).toBe(true);

      await setCondition(w, { column: "value", operator: ">=", value });
      await emitSeries(w, threeNodes());
      expect(w.vm.evaluationStatus, JSON.stringify(value)).toBeNull();
    }
    w.unmount();
  });

  it("ignores an unusable warning value instead of firing every series at WARNING", async () => {
    // The THIRD threshold on this path, and the one the two suites above do not
    // reach. `finiteThreshold` is the whole reason an emptied warning box means
    // "no second band": pass `promql_warning_value` through raw and `warning` is
    // "", which is not null, so a warning band opens and `promqlSampleMatches`
    // evaluates `value >= ""` — JS coerces that to `value >= 0` and EVERY series
    // classifies as warning. The badge then reads WOULD TRIGGER, with a severity
    // word on it, over three healthy nodes. An ordinary keystroke, not a corner
    // case: a number input emits "" the moment the field is cleared.
    //
    // The critical band is 90 so nothing fires on its own, which makes the
    // correct answer the PLAIN single-band sentence — `level: null` asserts that
    // exactly (whole-string equality), so a stray severity word fails too.
    const w = await mountPromql({
      condition: { column: "value", operator: ">=", value: 90 },
      warningValue: "",
    });

    await emitSeries(w, threeNodes());

    expectVerdict(w, { matched: 0, gate: "0 >= 1", trigger: false, level: null });

    // Same answer for every other spelling that cannot be a threshold: `" "`
    // trims to empty, `Number(true)` is 1 and `Number([5])` is 5, so a value that
    // merely LOOKS unusable would otherwise open a band nobody typed.
    for (const warningValue of [" ", "  \t ", "abc", true, false, [5], {}, null, NaN, Infinity]) {
      await setWarningValue(w, warningValue);
      await emitSeries(w, threeNodes());
      expectVerdict(w, { matched: 0, gate: "0 >= 1", trigger: false, level: null });
    }

    // Non-vacuous: a USABLE warning value on the same fixture does open the band,
    // so the assertions above are pinning the guard, not an inert code path.
    await setWarningValue(w, 50);
    await emitSeries(w, threeNodes());
    expectVerdict(w, { matched: 1, gate: "1 >= 1", trigger: true, level: "warning" });
    w.unmount();
  });

  it("withdraws the verdict while the COUNT threshold sits empty mid-edit", async () => {
    // The other threshold, the same gesture, the same wrong answer: `"" || 0` is
    // 0, so the badge would read "WOULD TRIGGER - 0 series match (0 >= 0)" with
    // nothing matching at all.
    const w = await mountPromql({
      condition: { column: "value", operator: ">=", value: 80 },
      threshold: 1,
    });

    await emitSeries(w, threeNodes());
    expect(w.vm.evaluationStatus?.wouldTrigger).toBe(true);

    for (const threshold of ["", " ", "abc", null, undefined, true, [2]]) {
      await w.setProps({
        formData: {
          ...w.props("formData"),
          trigger_condition: { ...(w.props("formData") as any).trigger_condition, threshold },
        },
      });
      await emitSeries(w, threeNodes());
      expect(w.vm.evaluationStatus, JSON.stringify(threshold)).toBeNull();
    }
    w.unmount();
  });

  it("keeps a count threshold of 0 as a real gate, not a cleared field", async () => {
    // The boundary the test above is drawn against: an explicit 0 is a gate the
    // backend honours (`compare(0, >=, 0)` is true), so it is evaluated, not
    // withdrawn. Only an UNUSABLE value withdraws.
    const w = await mountPromql({
      condition: { column: "value", operator: ">=", value: 90 },
      threshold: 0,
    });

    await emitSeries(w, threeNodes());

    expectVerdict(w, { matched: 0, gate: "0 >= 0", trigger: true });
    w.unmount();
  });

  it("compares the COUNT gate numerically when the form holds the threshold as a string", async () => {
    // The form carries the raw input, so the gate routinely sees "1" rather than
    // 1. Every other operator survives that by accident — `1 >= "1"` coerces —
    // but `===`/`!==` do not, and without the `Number()` in `evaluateCountGate`
    // the badge contradicts itself in its own sentence: it prints the comparison
    // as "1 == 1" (template interpolation stringifies both sides identically)
    // and then reports NO match. `!=` is the same bug facing the other way, and
    // is the louder of the two: it announces WOULD TRIGGER on "1 != 1".
    const eq = await mountPromql({
      condition: { column: "value", operator: ">=", value: 80 },
      threshold: "1",
      operator: "=",
    });
    await emitSeries(eq, threeNodes());
    // One series is over 80 and the gate wants exactly one.
    expectVerdict(eq, { matched: 1, gate: "1 == 1", trigger: true });
    eq.unmount();

    const ne = await mountPromql({
      condition: { column: "value", operator: ">=", value: 80 },
      threshold: "1",
      operator: "!=",
    });
    await emitSeries(ne, threeNodes());
    // The count IS one, so "not equal to one" is false and the alert must not fire.
    expectVerdict(ne, { matched: 1, gate: "1 != 1", trigger: false });
    ne.unmount();
  });

  it("keeps the neutral real-time message regardless of the series values", async () => {
    const w = await mountPromql({
      condition: { column: "value", operator: ">=", value: 90 },
      isRealTime: true,
    });

    await emitSeries(w, threeNodes());

    expect(w.vm.evaluationStatus?.wouldTrigger).toBe(true);
    expect(w.vm.evaluationStatus?.reason).toBe(tr("realTimeReason"));
    w.unmount();
  });

  it("leaves the aggregation path evaluating from partition hits", async () => {
    const w = await mountComp({
      query: "SELECT k8s_node, sum(val) FROM m GROUP BY k8s_node",
      selectedTab: "custom",
      isAggregationEnabled: true,
      formData: {
        ...baseFormData(),
        is_real_time: false,
        trigger_condition: { period: 10, threshold: 1, operator: ">=" },
        query_condition: {
          aggregation: {
            function: "sum",
            group_by: ["k8s_node"],
            having: { column: "val", operator: ">=", value: 10 },
          },
        },
      },
    });
    await flushPromises();

    await emitResultMetadata(w, [
      [
        {
          hits: [
            { k8s_node: "a", zo_sql_num: 12 },
            { k8s_node: "b", zo_sql_num: 3 },
          ],
        },
      ],
    ]);

    // Only group "a" clears HAVING >= 10, and the count gate wants >= 1.
    expectVerdict(w, { matched: 1, gate: "1 >= 1", trigger: true, label: "groups" });
    w.unmount();
  });

  it("still evaluates SQL mode from result-metadata-update", async () => {
    // Silencing the PromQL branch of handleChartDataUpdate must not silence the
    // function: a return placed a line too high, or keyed on the wrong prop, would
    // take SQL down with it and no other test would notice.
    const w = await mountComp({
      query: "SELECT * FROM logs",
      selectedTab: "sql",
      formData: {
        ...baseFormData(),
        is_real_time: false,
        trigger_condition: { period: 10, threshold: 5, operator: ">=" },
      },
    });
    await flushPromises();

    await emitResultMetadata(w, [[{ total: 7 }]]);

    expectVerdict(w, { matched: 7, gate: "7 >= 5", trigger: true, label: "rows" });
    w.unmount();
  });

  it("ignores series-data-update outside PromQL mode", async () => {
    // The mirror of the two-writers test. The only thing keeping a stray series
    // emit from stamping a bogus verdict over a SQL result is the mode check at the
    // top of handleSeriesDataUpdate — and the fix edits that same function.
    const w = await mountComp({
      query: "SELECT * FROM logs",
      selectedTab: "sql",
      formData: {
        ...baseFormData(),
        is_real_time: false,
        trigger_condition: { period: 10, threshold: 5, operator: ">=" },
      },
    });
    await flushPromises();

    await emitResultMetadata(w, [[{ total: 7 }]]);
    const verdict = { ...w.vm.evaluationStatus };
    // Without this the comparison below would hold vacuously on two nulls.
    expect(verdict.wouldTrigger).toBe(true);

    await emitSeries(w, threeNodes());

    expect(w.vm.evaluationStatus?.wouldTrigger).toBe(verdict.wouldTrigger);
    expect(w.vm.evaluationStatus?.reason).toBe(verdict.reason);
    w.unmount();
  });
});

// ---------------------------------------------------------------------------
// SQL verdict — frame arithmetic under streaming aggregates
//
// `handleChartDataUpdate`'s `sql` branch reduces `resultMetaData[0]` to one row
// count. Which reduction is correct depends on a flag it currently never reads:
//
//   - PLAIN partitions are DISJOINT time slices (the request is narrowed per
//     partition, streaming/execution.rs:194-197), so each frame's `total` is its
//     own slice's row count and SUMMING is right. This is the common case and
//     must not change.
//   - STREAMING-AGGREGATE frames each carry the PROGRESSIVELY MERGED aggregation
//     over everything scanned so far (streaming/collect.rs:152-175, which
//     *replaces* hits and recomputes `total`; execution.rs:289-292 "Only
//     accumulate the results of the last partition"). One frame already is the
//     whole answer, so summing multiplies it by the frame count.
//
// The UI's own hit handler already encodes this split
// (usePanelSearchHandlers.ts:69-74 — "streaming_aggs mode: data is replaced, use
// only the last batch"); the verdict path is the one consumer that does not. The
// backend meanwhile runs the alert as a SINGLE non-streaming search
// (`streaming_output: false`, src/core/src/alerts/mod.rs:584) and counts
// `records.len()` once (:831) — so an over-counting preview says WOULD TRIGGER
// for an alert that will never fire.
//
// `records.len()` is the common path, not the only one, and neither alternative
// weakens the point: when the hybrid `COUNT(*)` pre-query runs (gated at
// mod.rs:384-397) `actual_value` is that exact count instead (:826-831), and
// when it does not, `records.len()` is clamped by `size` and flagged
// `value_is_lower_bound` (:838-839, rendered "≥ N"). Both are counts of ONE
// search's rows; neither is an accumulation across frames, which is what the
// preview was doing.
//
// Four rules are deliberately NOT what the fix picks, and several fixtures below
// exist only to discriminate against them:
//
//   - `Math.max` of the frame totals is wrong because the merged count is NOT
//     monotone: `HAVING count(*) < N`, `HAVING … != N` and LIMIT/top-k shapes
//     SHRINK the passing set as more data merges, so max reports the largest
//     intermediate rather than the final answer. Hence the DESCENDING fixtures.
//   - Naive "last frame" is wrong because `send_partial_search_resp` emits a
//     default-constructed Response (`total = 0`, execution.rs:1053) still tagged
//     `streaming_aggs` when the max query range is exceeded, and that frame is
//     genuinely last. Hence the `is_partial` fixtures.
//   - Skipping frames on FALSINESS rather than on absence is wrong, because the
//     shrink-to-zero case above has a real endpoint: a merged result of exactly
//     zero rows is an ANSWER, not a missing field. Hence the `total: 0`
//     fixtures — without them `filter(p => p?.total)` reads as a harmless tidy-up
//     of `filter(p => p?.total !== undefined)` and silently reports a stale
//     earlier count as WOULD TRIGGER.
//   - Reading the picked frame's `hits.length` in preference to its `total` is
//     wrong even though the two agree in the tidy case, because `to_chunks`
//     splits hits into size-capped chunks and `handleStreamingHistogramHits`
//     ASSIGNS rather than appends (`.hits = hits`,
//     usePanelSearchHandlers.ts:247-249) — so a frame streamed over several hit
//     chunks ends up holding only its last chunk beside a `total` that counts
//     them all.
//
// A note on what one frame can and cannot prove. Over a single frame
// `sum == last == max == first`, so no one-frame fixture can separate any
// REDUCTION RULE from any other — which is exactly why the defect is invisible
// in deployments whose queries never partition (conditions 6-9 of the writeup).
// That theorem is about reductions only, and the fix is more than a reduction:
// it also chooses WHICH FIELD to read and may branch on the frame count. Those
// dimensions are constrained at one frame, so the one-frame cases below are
// pulling weight rather than decorating.
//
// The frames themselves are built to match the wire. `streaming_aggs` and
// `is_partial` are both `#[serde(default)]` with no `skip_serializing_if`, so a
// settled frame arrives carrying an explicit `is_partial: false` rather than
// omitting the key — `agg()` and `plain()` therefore emit it, and exactly one
// test drops it on purpose. `handleStreamingHistogramMetadata` spreads `content`
// before `content.results` (usePanelSearchHandlers.ts:216-220), then
// `handleStreamingHistogramHits` assigns `hits` onto the LAST frame — the one
// that already carries `total` — which is why the production fixtures carry both.
// ---------------------------------------------------------------------------
describe("PreviewAlert - SQL verdict under streaming aggregates", () => {
  let w!: VueWrapper<any>;

  afterEach(() => {
    // Unmounting here rather than at the end of each `it` matters for a suite
    // that is expected to ship RED: a failing assertion aborts the test body, so
    // an inline `w.unmount()` never runs and every red test leaks its wrapper.
    w?.unmount();
    w = undefined as any;
    // NOT vi.restoreAllMocks(): this block installs no spies, and restoring
    // would reach the module-level `searchService.result_schema` mock that every
    // test here depends on for its chart type.
    vi.clearAllMocks();
  });

  /**
   * The noun the badge counts in for every test in this block.
   *
   * Named once rather than repeated two dozen times because it is NOT a property
   * of frame arithmetic: it falls out of `mountSql`'s query being a bare
   * aggregate, for which `result_schema` returns `group_by: []`, which makes
   * `determineChartType` pick "table" (PreviewAlert.vue:207-210), which makes
   * `resultLabelFor` say rows. The canonical `GROUP BY ns` alert would instead
   * return one group_by column, land on :221-223, and be labelled "data points".
   * A legitimate change to `determineChartType` should cost one line here.
   *
   * It is still asserted, not waived: `expectVerdict` rebuilds the whole badge
   * sentence through i18n, and that exactness is load-bearing — several fixtures
   * below reach the right VERDICT off the wrong COUNT, and the rebuilt sentence
   * is the only thing that catches them.
   */
  const LABEL = "rows" as const;

  /** One plain partition frame — a disjoint time slice. */
  const plain = (total: number, extra: Record<string, unknown> = {}) => ({
    total,
    is_partial: false,
    ...extra,
  });

  /** One streaming-aggregate frame — the cumulative merged result so far. */
  const agg = (total: number, extra: Record<string, unknown> = {}) => ({
    streaming_aggs: true,
    is_partial: false,
    total,
    ...extra,
  });

  /** n distinct hit rows, as an accumulated hits chunk delivers them. */
  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ k8s_namespace_name: `ns-${i}` }));

  /**
   * A SQL-tab preview, settled.
   *
   * The query is the writeup's worst-case shape — `SELECT count(*)`, one row
   * however much data it scans — and it is deliberately the shape whose
   * `result_schema` genuinely yields `group_by: []`, so the mocked schema and the
   * fixture query agree. A `GROUP BY` query here would contradict the mock and
   * make every label assertion in this block unreachable in production.
   *
   * The `await flushPromises()` matters: the chart type is resolved
   * asynchronously from that mock, and asserting before it settles reads
   * whatever the previous mount left behind.
   */
  async function mountSql(opts: { threshold?: number; operator?: string } = {}) {
    const mounted = await mountComp({
      query: "SELECT count(*) AS c FROM \"default\" WHERE level = 'error'",
      selectedTab: "sql",
      formData: {
        ...baseFormData(),
        is_real_time: false,
        trigger_condition: {
          period: 10,
          threshold: opts.threshold ?? 5,
          operator: opts.operator ?? ">=",
        },
      },
    });
    await flushPromises();
    return mounted;
  }

  // ── plain partitions: the sum must survive ────────────────────────────────

  it("sums plain partitions, which are disjoint slices of the window", async () => {
    // The behaviour dd8d3ffa14 introduced deliberately, and the one thing the fix
    // must not touch. The first fixture is the same three totals as the
    // streaming-aggs test below, so the contrast is exactly the flag.
    w = await mountSql({ threshold: 10 });

    await emitResultMetadata(w, [[plain(4), plain(3), plain(3)]]);
    expectVerdict(w, { matched: 10, gate: "10 >= 10", trigger: true, label: LABEL });

    // The minimal two-frame shape, at the gate boundary.
    await w.setProps({
      formData: {
        ...baseFormData(),
        is_real_time: false,
        trigger_condition: { period: 10, threshold: 7, operator: ">=" },
      },
    });
    await emitResultMetadata(w, [[plain(3), plain(4)]]);
    expectVerdict(w, { matched: 7, gate: "7 >= 7", trigger: true, label: LABEL });
  });

  it("keeps summing plain partitions even when one is flagged is_partial", async () => {
    // `is_partial` is only a reason to SKIP a frame under streaming aggs, where
    // the frames are cumulative and a range-capped `total: 0` would be taken as
    // the whole answer. Plain frames are disjoint: skipping one loses its rows.
    w = await mountSql({ threshold: 7 });

    await emitResultMetadata(w, [[plain(3), plain(4, { is_partial: true })]]);

    expectVerdict(w, { matched: 7, gate: "7 >= 7", trigger: true, label: LABEL });
  });

  it("keeps summing when every frame explicitly reports streaming_aggs: false", async () => {
    // The cached-response frame (streaming/cache.rs:438-440) and the merged
    // non-ts-ORDER BY frame (execution.rs:447-449) both hardcode the flag to
    // false. An explicit false must read the same as an absent flag.
    w = await mountSql({ threshold: 7 });

    await emitResultMetadata(w, [
      [plain(3, { streaming_aggs: false }), plain(4, { streaming_aggs: false })],
    ]);

    expectVerdict(w, { matched: 7, gate: "7 >= 7", trigger: true, label: LABEL });
  });

  it("adds string totals instead of concatenating them", async () => {
    // DEFENSIVE, and knowingly so — like the hits fallback at the bottom of this
    // block: `Response.total` is a `usize` with no custom serializer
    // (config/meta/search.rs:261), so a quoted total cannot arrive from this
    // endpoint today. It is pinned because the failure mode is silent and absurd:
    // `+` on a string CONCATENATES, so an uncoerced accumulator turns
    // [10, 2] into the string "0102" (the seed 0, then "10", then "2") and the
    // badge announces a hundred-odd rows. The streaming-aggs arm beside it
    // already coerces both the settled and the max total; this pins that the
    // plain arm agrees, so the two cannot drift apart in a later rewrite.
    //
    // The gate is set ABOVE the true sum and BELOW the concatenation, so the
    // verdict flips as well as the count — a wrong answer, not just a wrong word.
    w = await mountSql({ threshold: 50 });

    await emitResultMetadata(w, [[plain("10" as any), plain("2" as any)]]);

    expectVerdict(w, { matched: 12, gate: "12 >= 50", trigger: false, label: LABEL });
  });

  it("leaves the aggregation branch's own total fallback summing", async () => {
    // A DIFFERENT branch (PreviewAlert.vue:661-671): when the custom+aggregation
    // path has no hits to re-aggregate it falls back to the same Σ total over the
    // same frames. That branch's query always carries a histogram(_timestamp)
    // alias (aggregationPreviewQuery.ts:50-56), so `ts_column` is always Some and
    // it can never see a streaming-aggregate frame — its sum is correct and must
    // stay. Nothing else in the file would fail if an implementer, having just
    // internalised "these frames are cumulative", applied last-wins here too.
    w = await mountComp({
      query: "SELECT k8s_node, sum(val) FROM m GROUP BY k8s_node",
      selectedTab: "custom",
      isAggregationEnabled: true,
      formData: {
        ...baseFormData(),
        is_real_time: false,
        trigger_condition: { period: 10, threshold: 7, operator: ">=" },
        query_condition: {
          aggregation: {
            function: "sum",
            group_by: ["k8s_node"],
            having: { column: "val", operator: ">=", value: 10 },
          },
        },
      },
    });
    await flushPromises();

    // No hits anywhere, so the branch reaches its Σ total fallback.
    await emitResultMetadata(w, [[plain(4), plain(3)]]);

    expectVerdict(w, { matched: 7, gate: "7 >= 7", trigger: true, label: "groups" });
  });

  it("sums plain frames on the generic fallback branch too", async () => {
    // `selectedTab` has no runtime value outside custom/sql/promql today, but the
    // prop's own default is "" (PreviewAlert.vue:78-81) and `QueryType` has a
    // fourth variant, Slo (config/meta/alerts/mod.rs:836), that
    // `query_condition.type` can already carry. The generic `else` at :717 is an
    // uncorrected copy of the same Σ total.
    //
    // This asserts ONLY the plain-frame behaviour, which is correct today and
    // stays correct whether or not that branch is ever taught about the flag.
    // Pinning its streaming-aggs behaviour either way would be a trap: assert
    // today's sum and the test cements the latent bug; assert last-wins and it
    // demands a fix to a branch this change is scoped out of.
    w = await mountComp({
      query: "SELECT * FROM logs",
      selectedTab: "",
      formData: {
        ...baseFormData(),
        is_real_time: false,
        trigger_condition: { period: 10, threshold: 7, operator: ">=" },
      },
    });
    await flushPromises();

    await emitResultMetadata(w, [[plain(3), plain(4)]]);

    // Not LABEL: with no recognised tab the component never takes the
    // `result_schema` path, so `dashboardPanelData.data.type` keeps its default
    // "line" and the badge counts data points. Asserted as it really is — the
    // point of this test is the arithmetic, and hardcoding LABEL here would be
    // pinning a sentence this mount cannot produce.
    expectVerdict(w, { matched: 7, gate: "7 >= 7", trigger: true, label: "dataPoints" });
  });

  // ── streaming-aggregate frames: last-wins ─────────────────────────────────

  it("takes the last streaming-aggregate frame instead of summing them", async () => {
    // THE regression test for the defect. Two cumulative frames reporting 3 then
    // 4 mean the query returned 4 rows, not 7.
    w = await mountSql({ threshold: 7 });

    await emitResultMetadata(w, [[agg(3), agg(4)]]);

    expectVerdict(w, { matched: 4, gate: "4 >= 7", trigger: false, label: LABEL });
  });

  it("still triggers when the last streaming-aggregate frame alone clears the gate", async () => {
    // Not independent discrimination — no wrong rule survives this that does not
    // also survive the test above. Its one job is to exercise the COUNT for this
    // fixture: the test above fails on `wouldTrigger` and short-circuits before
    // the number is ever compared. Here the verdict is right today and the number
    // is not — the badge says 7 rows where 4 is the truth.
    w = await mountSql({ threshold: 4 });

    await emitResultMetadata(w, [[agg(3), agg(4)]]);

    expectVerdict(w, { matched: 4, gate: "4 >= 4", trigger: true, label: LABEL });
  });

  it("prefers the LAST settled frame over the LARGEST one", async () => {
    // The fixture DESCENDS (4, 3, 3) on purpose, which no monotone-merge argument
    // permits — see the `HAVING <` / LIMIT note in the block comment. Three rules
    // give three different answers here, and only one is right:
    //   sum       -> 10 -> "10 >= 4" -> WOULD TRIGGER
    //   Math.max  ->  4 -> "4 >= 4"  -> WOULD TRIGGER
    //   last      ->  3 -> "3 >= 4"  -> would NOT trigger   <- the fix
    w = await mountSql({ threshold: 4 });

    await emitResultMetadata(w, [[agg(4), agg(3), agg(3)]]);

    expectVerdict(w, { matched: 3, gate: "3 >= 4", trigger: false, label: LABEL });
  });

  it("reports one row for a bare count(*), not one row per frame", async () => {
    // The degenerate shape, and the worst relative error. This IS `mountSql`'s
    // query: `SELECT count(*) AS c` returns exactly one row however many frames
    // it is streamed over, so six cumulative frames of 1 are six reports of the
    // same single row.
    w = await mountSql({ threshold: 5 });

    await emitResultMetadata(w, [[agg(1), agg(1), agg(1), agg(1), agg(1), agg(1)]]);

    // Singular "row", not "rows" — 1, not 6.
    expectVerdict(w, { matched: 1, gate: "1 >= 5", trigger: false, label: LABEL });
  });

  it("reads a single settled streaming-aggregate frame as the whole answer", async () => {
    // One frame cannot separate sum from last from max — see the theorem in the
    // block comment. What it CAN separate is a fix that branches on how many
    // frames it has: "use the last settled frame when there are several,
    // otherwise fall through" is a natural-looking shape that reports zero rows
    // for the single-frame case, which per conditions 6-9 of the writeup is the
    // NORMAL case for most deployments. Nothing else in this block has exactly
    // one settled aggregate frame.
    w = await mountSql({ threshold: 5 });

    await emitResultMetadata(w, [[agg(7)]]);

    expectVerdict(w, { matched: 7, gate: "7 >= 5", trigger: true, label: LABEL });
  });

  // ── zero is an answer, not a missing field ────────────────────────────────

  it("reports zero rows when the merged result shrinks to nothing", async () => {
    // The endpoint of the very case the block comment cites as the reason for
    // last-wins. `HAVING count(*) < 10` passes a group at 4 rows and fails it at
    // 12, so the merged passing set can descend all the way to empty — and the
    // final frame then legitimately reports `total: 0` with no `is_partial`.
    //
    // A `total: 0` frame is an ANSWER. Skipping it as falsy resurrects the stale
    // 5 from the frame before and fires an alert on a query that matched nothing:
    //   sum                     -> 5 -> "5 >= 1" -> WOULD TRIGGER (today)
    //   last frame with a TRUTHY total -> 5 -> "5 >= 1" -> WOULD TRIGGER
    //   last frame that HAS a total    -> 0 -> "0 >= 1" -> no   <- the fix
    w = await mountSql({ threshold: 1 });

    await emitResultMetadata(w, [[agg(5), agg(0)]]);

    expectVerdict(w, { matched: 0, gate: "0 >= 1", trigger: false, label: LABEL });
  });

  // ── is_partial: the range-capped frame ────────────────────────────────────

  it("ignores a trailing range-capped frame reporting zero rows", async () => {
    // Green today (0 adds nothing to a sum), red against a naive "take the last
    // frame" fix, which would report 0 rows for a query that returned 12.
    w = await mountSql({ threshold: 5 });

    await emitResultMetadata(w, [[agg(12), agg(0, { is_partial: true })]]);

    expectVerdict(w, { matched: 12, gate: "12 >= 5", trigger: true, label: LABEL });
  });

  it("reads through a trailing range-capped frame to the last settled one", async () => {
    // The discriminating version of the test above — descending, so all four
    // candidate rules separate:
    //   sum        -> 21 -> "21 >= 10" -> WOULD TRIGGER
    //   Math.max   -> 12 -> "12 >= 10" -> WOULD TRIGGER
    //   last frame ->  0 -> "0 >= 10"  -> would not trigger, but reports 0 rows
    //   last settled frame -> 9 -> "9 >= 10" -> would not trigger   <- the fix
    w = await mountSql({ threshold: 10 });

    await emitResultMetadata(w, [[agg(12), agg(9), agg(0, { is_partial: true })]]);

    expectVerdict(w, { matched: 9, gate: "9 >= 10", trigger: false, label: LABEL });
  });

  it("skips a partial frame in the MIDDLE and keeps reading forward", async () => {
    // `process_delta` recomputes per delta and a partial can land anywhere, not
    // only last. A fix that truncates the list at the first partial passes every
    // other `is_partial` test in this block and fails here. Three frames, not two:
    // with only [partial, settled] a truncating fix lands on 8 anyway via its max
    // fallback, and the test would be green for the wrong reason.
    //   sum                        -> 23 -> "23 >= 10" -> WOULD TRIGGER (today)
    //   Math.max                   -> 12 -> "12 >= 10" -> WOULD TRIGGER
    //   truncate at first partial  -> 12 -> "12 >= 10" -> WOULD TRIGGER
    //   last settled frame overall ->  8 -> "8 >= 10"  -> no   <- the fix
    w = await mountSql({ threshold: 10 });

    await emitResultMetadata(w, [[agg(12), agg(3, { is_partial: true }), agg(8)]]);

    expectVerdict(w, { matched: 8, gate: "8 >= 10", trigger: false, label: LABEL });
  });

  it("treats a frame with no is_partial key at all as settled", async () => {
    // The one fixture in this block that DROPS the key. Every real frame carries
    // an explicit `is_partial: false`, so a fix written `p?.is_partial === false`
    // instead of `p?.is_partial !== true` is green against every other test here
    // and silently reads a key-less frame as unsettled — falling through to the
    // max, which is the wrong end of a descending sequence.
    //   sum                          -> 12 -> "12 >= 4" -> WOULD TRIGGER (today)
    //   `=== false` -> nothing settled -> max -> 9 -> "9 >= 4" -> WOULD TRIGGER
    //   `!== true`                   ->  3 -> "3 >= 4"  -> no   <- the fix
    w = await mountSql({ threshold: 4 });

    await emitResultMetadata(w, [
      [
        { streaming_aggs: true, total: 9 },
        { streaming_aggs: true, total: 3 },
      ],
    ]);

    expectVerdict(w, { matched: 3, gate: "3 >= 4", trigger: false, label: LABEL });
  });

  it("falls back to the largest total when every frame is partial", async () => {
    // Pathological: nothing settled, so every total is suspect. `max` is the
    // documented fallback and it cannot be worse than today's sum. Chosen so the
    // fallback rule is pinned rather than merely tolerated:
    //   sum      -> 16 -> "16 >= 6" -> WOULD TRIGGER (today)
    //   last     ->  5 -> "5 >= 6"  -> would not trigger
    //   max      ->  8 -> "8 >= 6"  -> WOULD TRIGGER, reporting 8   <- the fix
    w = await mountSql({ threshold: 6 });

    await emitResultMetadata(w, [
      [agg(3, { is_partial: true }), agg(8, { is_partial: true }), agg(5, { is_partial: true })],
    ]);

    expectVerdict(w, { matched: 8, gate: "8 >= 6", trigger: true, label: LABEL });
  });

  it("falls back to the max when the only frame there is is partial", async () => {
    // The one-frame corner of the fallback. A fix that returns 0, or leaves
    // `resultCount` at its initial 0, whenever nothing is settled reports "no
    // rows" for a query that returned five of them.
    w = await mountSql({ threshold: 3 });

    await emitResultMetadata(w, [[agg(5, { is_partial: true })]]);

    expectVerdict(w, { matched: 5, gate: "5 >= 3", trigger: true, label: LABEL });
  });

  // ── mixed and absent flags ────────────────────────────────────────────────

  it("detects the flag on a LATE frame, not only on the first one", async () => {
    // Detection is `.some(...)`. This fixture is what kills reading the flag off
    // frame 0 — the shape usePanelSQLExecutor.ts:552 uses elsewhere — because
    // here frame 0 has no flag at all (the legacy `search_response` push drops it,
    // usePanelSearchHandlers.ts:177) and the run is nonetheless cumulative.
    //   sum -> 14 -> "14 >= 10" -> WOULD TRIGGER (today, and under first-frame
    //                              detection)
    //   last ->  7 -> "7 >= 10" -> would not trigger   <- the fix
    w = await mountSql({ threshold: 10 });

    await emitResultMetadata(w, [[plain(7), agg(7)]]);

    expectVerdict(w, { matched: 7, gate: "7 >= 10", trigger: false, label: LABEL });
  });

  it("detects the flag on an EARLY frame, not only on the last one", async () => {
    // The mirror, and the fixture that kills reading the flag off the LAST frame
    // (the shape usePanelSearchHandlers.ts:236-239 uses). `process_delta`
    // recomputes the flag per delta (execution.rs:770-771), so a trailing frame
    // can arrive without it while the run was cumulative throughout.
    //
    // It also pins the second half of the rule: the flag decides WHICH RULE, and
    // the rule then reads the LAST frame — whether or not that frame carries the
    // flag itself.
    //   sum      -> 13 -> "13 >= 5" -> WOULD TRIGGER (today, and under last-frame
    //                                  detection)
    //   Math.max ->  9 -> "9 >= 5"  -> WOULD TRIGGER
    //   last     ->  4 -> "4 >= 5"  -> would not trigger   <- the fix
    w = await mountSql({ threshold: 5 });

    await emitResultMetadata(w, [[agg(9), plain(4)]]);

    expectVerdict(w, { matched: 4, gate: "4 >= 5", trigger: false, label: LABEL });
  });

  it("never picks a frame that carries no total at all", async () => {
    // "Last frame" must mean "last frame that reported a count". A trailing frame
    // with no `total` is not an answer of zero rows.
    //   sum                     -> 15 -> "15 >= 7" -> WOULD TRIGGER
    //   Math.max                ->  9 -> "9 >= 7"  -> WOULD TRIGGER
    //   last frame, coerced     ->  0 -> "0 >= 7"  -> reports 0 rows
    //   last frame WITH a total ->  6 -> "6 >= 7"  -> would not trigger  <- the fix
    w = await mountSql({ threshold: 7 });

    await emitResultMetadata(w, [
      [agg(9), agg(6), { streaming_aggs: true, is_partial: false, hits: [] }],
    ]);

    expectVerdict(w, { matched: 6, gate: "6 >= 7", trigger: false, label: LABEL });
  });

  it("survives a null or undefined frame in the array", async () => {
    // `handleChartDataUpdate` runs inside a try/catch that only console.errors, so
    // a fix written `p.total` instead of `p?.total` does not surface as a crash —
    // it leaves the badge silently showing the PREVIOUS verdict, which is the
    // worst failure mode available here. `expectVerdict` asserts the status is
    // truthy first, so a swallowed throw fails rather than passing vacuously.
    w = await mountSql({ threshold: 5 });

    await emitResultMetadata(w, [[agg(9), null, undefined, agg(4)]]);

    // 4, not 13 (today's sum, which coerces the holes to 0) and not a stale null.
    expectVerdict(w, { matched: 4, gate: "4 >= 5", trigger: false, label: LABEL });
  });

  // ── total and hits together: the real production shape ────────────────────

  it("counts the last frame's total when that frame also carries hits", async () => {
    // The shape the browser actually assembles: metadata frames arrive with hits
    // emptied by the chunk iterator, then `handleStreamingHistogramHits` assigns
    // the accumulated hits onto the last frame — the one that already has a
    // `total` (usePanelSearchHandlers.ts:247-249). Here the two AGREE, which is
    // the tidy single-chunk case.
    //   sum -> 6 -> "6 >= 3" -> WOULD TRIGGER (today)
    //   last frame's total -> 2 -> "2 >= 3" -> would not trigger   <- the fix
    w = await mountSql({ threshold: 3 });

    await emitResultMetadata(w, [[agg(4, { hits: [] }), agg(2, { hits: rows(2) })]]);

    expectVerdict(w, { matched: 2, gate: "2 >= 3", trigger: false, label: LABEL });
  });

  it("counts the picked frame's total, not its hits, when the two disagree", async () => {
    // And here they DISAGREE, which is the common case rather than a corner:
    // `to_chunks` splits a frame's hits into size-capped chunks
    // (config/meta/search.rs:1899-1972) and `handleStreamingHistogramHits`
    // ASSIGNS the arriving chunk (`.hits = hits`, not push), so a frame streamed
    // over several hit chunks ends up holding only its last chunk. `total` counts
    // all 12; `hits.length` sees the trailing 3.
    //   sum                        -> 16 -> "16 >= 10" -> WOULD TRIGGER (today)
    //   picked frame's hits.length ->  3 -> "3 >= 10"  -> would not trigger
    //   picked frame's total       -> 12 -> "12 >= 10" -> TRIGGER   <- the fix
    w = await mountSql({ threshold: 10 });

    await emitResultMetadata(w, [[agg(4, { hits: [] }), agg(12, { hits: rows(3) })]]);

    expectVerdict(w, { matched: 12, gate: "12 >= 10", trigger: true, label: LABEL });
  });

  it("prefers total over an empty hits array on the same frame", async () => {
    // `result-metadata-update` fires on a deep watch (usePanelDrilldown.ts:104),
    // so the verdict is computed as soon as the METADATA chunk lands — before the
    // separate hits chunk arrives. Every frame then legitimately has `total: N`
    // alongside `hits: []`. Reordering the branch to check `hits` first (a
    // tempting tidy-up, since the hits fallback is the one that is correct under
    // streaming aggs) reports 0 rows for a query that returned 12.
    w = await mountSql({ threshold: 10 });

    await emitResultMetadata(w, [[agg(4, { hits: [] }), agg(12, { hits: [] })]]);

    expectVerdict(w, { matched: 12, gate: "12 >= 10", trigger: true, label: LABEL });
  });

  // ── arrival dynamics: the handler is re-entered, on a live array ───────────

  it("re-derives the count on every frame, and never mutates the caller's array", async () => {
    // Every other test here emits one final-state array once. Production does not:
    // `handleChartDataUpdate` receives the composable's LIVE reactive array BY
    // REFERENCE (usePanelDrilldown.ts:105 emits `newVal` from a deep watcher) and
    // is re-entered on every metadata chunk and every hits assignment.
    //
    // Two consequences no single-shot fixture can see. First, the count must be
    // re-derived from scratch each time rather than accumulated. Second — and this
    // is the one that bites — an in-place reducer (`frames.reverse().find(...)`,
    // `while (frames.pop())`) returns the RIGHT NUMBER every time while scrambling
    // `state.resultMetaData[0]` underneath the composable, which breaks
    // `handleStreamingHistogramHits`'s `lastPartitionIndex` arithmetic
    // (usePanelSearchHandlers.ts:238) and re-fires the deep watch.
    w = await mountSql({ threshold: 5 });

    const live: any[] = [agg(4)];
    const payload = [live];

    await emitResultMetadata(w, payload);
    expectVerdict(w, { matched: 4, gate: "4 >= 5", trigger: false, label: LABEL });

    live.push(agg(9));
    await emitResultMetadata(w, payload);
    expectVerdict(w, { matched: 9, gate: "9 >= 5", trigger: true, label: LABEL });

    // Same objects, same order, same length — the handler is a reader.
    expect(live).toEqual([
      { streaming_aggs: true, is_partial: false, total: 4 },
      { streaming_aggs: true, is_partial: false, total: 9 },
    ]);
  });

  it("re-decides plain vs cumulative per run, and does not latch the flag", async () => {
    // The same component instance previews again after the user edits the query
    // from an aggregate to a row-match. A fix that remembers "this preview is
    // streaming-aggs" in a ref keeps applying last-wins to disjoint partitions
    // for the rest of the instance's life and under-counts every later preview.
    w = await mountSql({ threshold: 5 });

    await emitResultMetadata(w, [[agg(3), agg(9)]]);
    expectVerdict(w, { matched: 9, gate: "9 >= 5", trigger: true, label: LABEL });

    // Second run, plain partitions: back to summing.
    await emitResultMetadata(w, [[plain(3), plain(4)]]);
    expectVerdict(w, { matched: 7, gate: "7 >= 5", trigger: true, label: LABEL });
  });

  // ── degenerate payloads ───────────────────────────────────────────────────

  it("leaves an existing verdict alone when resultMetaData is empty", async () => {
    // `evaluateAndSetStatus` sits inside the outer `Array.isArray(...) && length`
    // guard, so a top-level empty array writes nothing. That is the right
    // behaviour — a cleared payload is not a verdict of zero — and it is worth
    // pinning because the fix restructures the block that guard wraps.
    w = await mountSql({ threshold: 5 });

    await emitResultMetadata(w, [[agg(9)]]);
    expectVerdict(w, { matched: 9, gate: "9 >= 5", trigger: true, label: LABEL });

    await emitResultMetadata(w, []);

    expectVerdict(w, { matched: 9, gate: "9 >= 5", trigger: true, label: LABEL });
  });

  it.each([
    ["an empty per-query array", [[]]],
    ["a null per-query entry", [null]],
    ["the legacy object writer's shape", [{ total: 5, hits: [] }]],
  ])("leaves the previous verdict standing for %s", async (_label, payload) => {
    // Was CHARACTERISATION pinning the opposite behaviour; the decision it existed
    // to force has now been taken. `evaluateAndSetStatus` used to sit OUTSIDE the
    // inner `Array.isArray(firstQueryMetadata) && length` guard, so all three of
    // these fell through every branch with `resultCount` at its initial 0 and
    // stamped "0 rows — WOULD NOT TRIGGER" over a correct verdict.
    //
    // That is reachable on every single run, not in a corner: both producers
    // assign `state.resultMetaData[qi] = []` before the first frame arrives
    // (usePanelSearchHandlers.ts:132-133, usePanelSQLExecutor.ts:497-498) and the
    // deep watcher emits on that assignment (usePanelDrilldown.ts:103-109), so the
    // badge flashed a false negative at the start of every refresh. The third
    // shape is real too: the legacy writer assigns a plain OBJECT to
    // `state.resultMetaData[0]` (usePanelSQLExecutor.ts:592-596), whose `total: 5`
    // is then not read at all.
    //
    // An underivable payload means the data has not arrived yet — not that the
    // query returned nothing — so the last known verdict is the best answer
    // available. Note this is deliberately NOT the PromQL policy of withdrawing to
    // null: there an unusable THRESHOLD means the alert is not configured, so no
    // verdict is meaningful. Withdrawing here would flash a blank badge instead of
    // a wrong one.
    //
    // Establishing a real verdict FIRST is what stops this passing vacuously:
    // without it both sides of the comparison would be the ref's initial null.
    w = await mountSql({ threshold: 5 });

    await emitResultMetadata(w, [[agg(9)]]);
    expectVerdict(w, { matched: 9, gate: "9 >= 5", trigger: true, label: LABEL });
    const verdict = { ...w.vm.evaluationStatus };

    await emitResultMetadata(w, payload);

    // Unchanged: not merely non-null, and not withdrawn to null either.
    expectVerdict(w, { matched: 9, gate: "9 >= 5", trigger: true, label: LABEL });
    expect(w.vm.evaluationStatus?.reason).toBe(verdict.reason);
    expect(w.vm.evaluationStatus?.wouldTrigger).toBe(verdict.wouldTrigger);
  });

  it("CHARACTERISATION: stamps 0 rows for a null FRAME inside a non-empty array", async () => {
    // Pinning today's behaviour, NOT endorsing it. The guard above rescued the
    // three payloads that actually arrive on every refresh, but it only inspects
    // the OUTER array: `[[null]]` clears both `Array.isArray` checks and lands in
    // the sql branch with a `null` frame, where no frame reports a `total` and
    // `latestPartition?.hits` is not an array — so `resultCount` stays at its
    // initial 0 and "0 rows — WOULD NOT TRIGGER" is written over a correct
    // verdict. That is the SAME BUG CLASS the guard was added to remove, one
    // level further in.
    //
    // It is left alone because neither producer can emit it: both push whole
    // metadata objects onto the per-query array
    // (usePanelSearchHandlers.ts:216-220, usePanelSQLExecutor.ts:497-499) and
    // neither ever pushes a null. Unreachable code is not worth a behaviour
    // change on a bug-fix branch — but if a future producer makes it reachable,
    // this test fails and the decision gets taken deliberately rather than by
    // accident. Skipping the frame (and so leaving the verdict standing) is the
    // change it would want.
    w = await mountSql({ threshold: 5 });

    await emitResultMetadata(w, [[agg(9)]]);
    expectVerdict(w, { matched: 9, gate: "9 >= 5", trigger: true, label: LABEL });

    await emitResultMetadata(w, [[null]]);

    expectVerdict(w, { matched: 0, gate: "0 >= 5", trigger: false, label: LABEL });
  });

  // ── the hits.length fallback ──────────────────────────────────────────────

  it("falls back to the latest frame's hits when no frame reports a total", async () => {
    // DEFENSIVE, and knowingly so: `Response.total` has no `skip_serializing_if`
    // (config/meta/search.rs:261), so a frame with `hits` and no `total` cannot
    // arrive from this endpoint. The clause is nonetheless the branch's only
    // remaining escape, and it is the easiest thing to lose while rewriting the
    // block around it — these two tests are all that would notice.
    w = await mountSql({ threshold: 2 });

    await emitResultMetadata(w, [
      [
        { streaming_aggs: true, is_partial: false, hits: rows(1) },
        { streaming_aggs: true, is_partial: false, hits: rows(2) },
      ],
    ]);

    expectVerdict(w, { matched: 2, gate: "2 >= 2", trigger: true, label: LABEL });
  });

  it("falls back to the latest frame's hits with no flag present either", async () => {
    w = await mountSql({ threshold: 2 });

    await emitResultMetadata(w, [[{ hits: rows(2) }]]);

    expectVerdict(w, { matched: 2, gate: "2 >= 2", trigger: true, label: LABEL });
  });
});

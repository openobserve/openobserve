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

import { describe, it, expect } from "vitest";
import { mount, config } from "@vue/test-utils";
import { nextTick } from "vue";
import i18n from "@/locales";

config.global.plugins = [...(config.global.plugins ?? []), i18n];

import MetricCardChart from "./MetricCardChart.vue";
import { withSourceStreams } from "@/utils/metrics/metricsHandoff";
import { convertPromQLData } from "@/utils/dashboard/convertPromQLData";

const RESULTS = [{ resultType: "matrix", result: [{ metric: {}, values: [[1, "1"]] }] }];

// Records the props the card hands to the panel. The card is now a thin adapter
// over PanelSchemaRenderer — its job is to translate the queue's fetched results
// into a panel schema + injected data — so that translation is what we assert.
const PanelSchemaRendererStub = {
  name: "PanelSchemaRenderer",
  props: [
    "panelSchema",
    "selectedTimeObj",
    "variablesData",
    "injectedPromqlData",
    "allowAlertCreation",
    "allowAnnotationsAdd",
    "allowAnnotationsAPI",
  ],
  template: "<div data-test='panel-schema-renderer' />",
};

const mountChart = (props: Record<string, any> = {}) =>
  mount(MetricCardChart, {
    props: {
      results: RESULTS,
      queries: [{ expr: "up", legendTemplate: "" }],
      chartType: "line",
      unit: "custom",
      unitCustom: "c/s",
      bucketUnit: null,
      bucketUnitCustom: null,
      color: "#60a5fa",
      timeRange: { start_time: 1_000_000, end_time: 2_000_000 },
      ...props,
    },
    global: { stubs: { PanelSchemaRenderer: PanelSchemaRendererStub } },
  });

const panelProp = (wrapper: any, name: string) =>
  wrapper.findComponent(PanelSchemaRendererStub).props(name);

describe("MetricCardChart builds the panel schema from its props", () => {
  it("renders through PanelSchemaRenderer, not a bespoke chart", () => {
    const wrapper = mountChart();
    expect(wrapper.findComponent(PanelSchemaRendererStub).exists()).toBe(true);
  });

  /**
   * Two variants can share a chart type AND a canonical unit — `unit` is
   * "custom" for both — and differ only in `unit_custom` ("c/s" vs "s/s"). The
   * schema must track the live value so the axis is not formatted with a
   * superseded unit.
   */
  it("reflects unitCustom in the schema config and updates when it changes", async () => {
    const wrapper = mountChart();
    expect(panelProp(wrapper, "panelSchema").config.unit_custom).toBe("c/s");

    await wrapper.setProps({ unitCustom: "s/s" }); // `unit` stays "custom"
    await nextTick();

    expect(panelProp(wrapper, "panelSchema").config.unit_custom).toBe("s/s");
  });

  it("hands a heatmap a shared colour range and precision only when given them", () => {
    const own = panelProp(mountChart({ chartType: "heatmap" }), "panelSchema").config;
    expect(own.visual_map_range).toBeUndefined();
    expect(own.decimals).toBe(2);

    const shared = panelProp(
      mountChart({ chartType: "heatmap", visualMapRange: { min: 0, max: 40 }, decimals: 5 }),
      "panelSchema",
    ).config;
    expect(shared.visual_map_range).toEqual({ min: 0, max: 40 });
    expect(shared.decimals).toBe(5);
  });

  it("carries the histogram bucket unit for a heatmap and updates it", async () => {
    const wrapper = mountChart({
      chartType: "heatmap",
      bucketUnit: "seconds",
      bucketUnitCustom: null,
    });
    expect(panelProp(wrapper, "panelSchema").config.bucket_unit).toBe("seconds");

    await wrapper.setProps({ bucketUnit: "milliseconds" });
    await nextTick();

    expect(panelProp(wrapper, "panelSchema").config.bucket_unit).toBe("milliseconds");
  });

  it("puts the queries into the schema and updates them", async () => {
    const wrapper = mountChart();
    expect(panelProp(wrapper, "panelSchema").queries[0].query).toBe("up");

    await wrapper.setProps({
      queries: [{ expr: "sum(rate(up[5m]))", legendTemplate: "{le}" }],
    });
    await nextTick();

    expect(panelProp(wrapper, "panelSchema").queries[0].query).toBe("sum(rate(up[5m]))");
  });

  it("gives each query the stream it reads, so an alert from the chart has one", () => {
    const queries = withSourceStreams(
      [
        {
          expr: "histogram_quantile(0.9, sum by (le) (rate(req_bucket[5m])))",
          builder: { metric: "req_bucket", labels: [], operations: [] },
        },
        {
          expr: "sum(rate(req_count[5m]))",
          builder: { metric: "req_count", labels: [], operations: [] },
        },
        { expr: "avg(req_bucket)" },
      ] as any[],
      "req_bucket",
    );
    const schemaQueries = panelProp(mountChart({ queries }), "panelSchema").queries;

    expect(schemaQueries.map((q: any) => q.fields)).toEqual([
      { stream: "req_bucket", stream_type: "metrics" },
      { stream: "req_count", stream_type: "metrics" },
      { stream: "req_bucket", stream_type: "metrics" },
    ]);
  });

  it("leaves the stream out when a query does not name one", () => {
    expect(panelProp(mountChart(), "panelSchema").queries[0].fields).toEqual({
      stream_type: "metrics",
    });
  });

  it("pins the x-axis to the queried range (injected, non-streaming data)", () => {
    const wrapper = mountChart();
    expect(panelProp(wrapper, "panelSchema").config.pin_x_axis_to_range).toBe(true);
  });

  it("connects across null gaps so a sparse line is not fragmented", () => {
    const wrapper = mountChart();
    expect(panelProp(wrapper, "panelSchema").config.connect_nulls).toBe(true);
  });
});

/**
 * `fixed` resolves to `fixedColor[0]` for EVERY series name (colorPalette.ts),
 * and these charts carry no legend. So a multi-series variant — Percentiles,
 * Min / Max — drew every line in one colour: three indistinguishable lines, or,
 * when they coincided, something that looked like a single line and read as a
 * bug in the query.
 */
describe("MetricCardChart colours multi-series charts per series", () => {
  const matrix = (n: number) => [
    {
      resultType: "matrix",
      result: Array.from({ length: n }, (_, i) => ({
        metric: { le: String(i) },
        values: [[1, "1"]],
      })),
    },
  ];

  it("keeps the card's accent colour when there is a single series", () => {
    const color = panelProp(mountChart({ results: matrix(1) }), "panelSchema").config.color;
    expect(color).toEqual({ mode: "fixed", fixedColor: ["#60a5fa"] });
  });

  it("switches to a per-series palette once there is more than one", () => {
    const color = panelProp(mountChart({ results: matrix(3) }), "panelSchema").config.color;
    expect(color.mode).toBe("palette-classic-by-series");
  });

  it("counts series ACROSS queries — one per percentile, one series each", () => {
    // What the Percentiles variant actually returns: three separate responses.
    const results = [50, 90, 99].map(() => ({
      resultType: "matrix",
      result: [{ metric: {}, values: [[1, "1"]] }],
    }));
    const wrapper = mountChart({
      results,
      queries: [50, 90, 99].map((p) => ({ expr: `q${p}`, legendTemplate: `p${p}` })),
    });
    expect(panelProp(wrapper, "panelSchema").config.color.mode).toBe("palette-classic-by-series");
  });

  it("turns the legend on with the palette-classic colour mode when asked", () => {
    const config = panelProp(
      mountChart({ results: matrix(3), legend: true }),
      "panelSchema",
    ).config;
    expect(config.show_legends).toBe(true);
    expect(config.color.mode).toBe("palette-classic");
    expect(panelProp(mountChart({ results: matrix(3) }), "panelSchema").config.show_legends).toBe(
      false,
    );
  });

  it("re-evaluates when the results change", async () => {
    const wrapper = mountChart({ results: matrix(1) });
    expect(panelProp(wrapper, "panelSchema").config.color.mode).toBe("fixed");

    await wrapper.setProps({ results: matrix(4) });
    await nextTick();

    expect(panelProp(wrapper, "panelSchema").config.color.mode).toBe("palette-classic-by-series");
  });
});

describe("MetricCardChart feeds the queue's results in as injected data", () => {
  it("hands the results and the queried window (µs) to the panel", () => {
    const wrapper = mountChart();
    const injected = panelProp(wrapper, "injectedPromqlData");

    expect(injected.data).toEqual(RESULTS);
    expect(injected.metadata.queries[0]).toEqual({
      startTime: 1_000_000,
      endTime: 2_000_000,
    });
  });

  it("appends shifted results after the primaries, with their offset window and parent query", () => {
    const DAY_MS = 86_400_000;
    const past = { resultType: "matrix", result: [{ metric: {}, values: [[1, "3"]] }] };
    const wrapper = mountChart({
      results: [RESULTS[0], RESULTS[0]],
      queries: [{ expr: "a" }, { expr: "b" }],
      stepSeconds: 30,
      shifted: [{ result: past, gapMs: DAY_MS, periodAsStr: "1 day ago", parentIndex: 1 }],
    });
    const injected = panelProp(wrapper, "injectedPromqlData");

    expect(injected.data).toEqual([RESULTS[0], RESULTS[0], past]);
    expect(injected.metadata.queries).toEqual([
      { startTime: 1_000_000, endTime: 2_000_000 },
      { startTime: 1_000_000, endTime: 2_000_000 },
      {
        startTime: 1_000_000 - DAY_MS * 1000,
        endTime: 2_000_000 - DAY_MS * 1000,
        timeRangeGap: { seconds: DAY_MS, periodAsStr: "1 day ago" },
        panelQueryIndex: 1,
      },
    ]);
    expect(injected.resultMetaData).toEqual([
      [{ step: 30_000_000 }],
      [{ step: 30_000_000 }],
      [{ step: 30_000_000 }],
    ]);
    expect(panelProp(wrapper, "panelSchema").queries).toHaveLength(2);
  });

  it("draws a dashed twin per series, on the current x values, when the step does not divide the offset", async () => {
    const DAY_S = 86_400;
    const STEP = 35;
    const START_S = 1_700_000_005;
    const grid = (start: number) => Array.from({ length: 10 }, (_, i) => start + i * STEP);
    const series = (ts: number[]) => ({
      resultType: "matrix",
      result: [{ metric: { pod: "a" }, values: ts.map((t) => [t, "1"]) }],
    });
    const wrapper = mountChart({
      results: [series(grid(START_S))],
      queries: [{ expr: "x" }],
      timeRange: { start_time: START_S * 1e6, end_time: (START_S + 9 * STEP) * 1e6 },
      stepSeconds: STEP,
      shifted: [
        {
          result: series(grid(START_S - DAY_S + 17)),
          gapMs: DAY_S * 1000,
          periodAsStr: "1 day ago",
          parentIndex: 0,
        },
      ],
    });
    const injected = panelProp(wrapper, "injectedPromqlData");
    const { options } = await convertPromQLData(
      panelProp(wrapper, "panelSchema"),
      injected.data,
      { state: { zoConfig: { max_dashboard_series: 100 }, timezone: "UTC", theme: "light" } },
      { value: { offsetWidth: 500, offsetHeight: 300 } },
      null,
      [],
      injected.metadata,
      injected.resultMetaData,
      false,
    );

    const named = options.series.filter((s: any) => s.name);
    expect(named.map((s: any) => s.name)).toEqual(["a", "a (1 day ago)"]);
    expect(named[1].lineStyle.type).toBe("dashed");
    const xs = new Set(named.flatMap((s: any) => s.data.map((point: any) => String(point[0]))));
    expect(xs.size).toBe(10);
  });

  it("passes no shifted entries or step metadata without a comparison", () => {
    const injected = panelProp(mountChart(), "injectedPromqlData");
    expect(injected.data).toEqual(RESULTS);
    expect(injected.metadata.queries).toHaveLength(1);
    expect(injected.resultMetaData).toBeUndefined();
  });

  it("converts the µs window into the Date pair the panel expects", () => {
    const wrapper = mountChart();
    const time = panelProp(wrapper, "selectedTimeObj");

    // 1_000_000 µs = 1000 ms, 2_000_000 µs = 2000 ms.
    expect((time.start_time as Date).getTime()).toBe(1000);
    expect((time.end_time as Date).getTime()).toBe(2000);
  });
});

describe("MetricCardChart forwards alert-creation opt-in", () => {
  it("defaults alert creation off (function-preview tiles)", () => {
    const wrapper = mountChart();
    expect(panelProp(wrapper, "allowAlertCreation")).toBe(false);
  });

  it("passes allowAlertCreation through to the panel when set", () => {
    const wrapper = mountChart({ allowAlertCreation: true });
    expect(panelProp(wrapper, "allowAlertCreation")).toBe(true);
  });
});

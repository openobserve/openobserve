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

// The point menu on PromQL charts, with the series built by the real converters.
import { describe, expect, it, vi } from "vitest";
import { gt } from "@/types/i18n";
import { convertPromQLData } from "@/utils/dashboard/convertPromQLData";
import { usePanelDrilldown } from "./usePanelDrilldown";
import { PROMETHEUS_HISTOGRAM_MODE } from "@/utils/dashboard/promql/shared/histogramBuckets";

vi.mock("@/aws-exports", () => ({ default: { isEnterprise: "false" } }));
vi.mock("@/utils/dashboard/chartDimensionUtils", () => ({
  calculateOptimalFontSize: vi.fn(() => 14),
  calculateWidthText: vi.fn((text) => (text?.length || 0) * 8),
  calculateDynamicNameGap: vi.fn(() => 25),
  calculateRotatedLabelBottomSpace: vi.fn(() => 0),
  applyMeasuredYAxisLeftInset: vi.fn(),
}));

const MIN_US = 60_000_000;
const SHIFT_MS = 30 * 60_000;
const T0 = 1_700_000_000;
const ts = [T0, T0 + 60, T0 + 120];
const START_US = T0 * 1_000_000 - 60 * MIN_US;
const END_US = (T0 + 120) * 1_000_000;

const matrix = (labels: Record<string, string>[], shiftS = 0) => ({
  resultType: "matrix",
  result: labels.map((metric) => ({
    metric,
    values: ts.map((t, i) => [t - shiftS, String(i + 1)]),
  })),
});

const store = {
  state: {
    timezone: "UTC",
    theme: "light",
    selectedOrganization: { identifier: "org-1" },
    zoConfig: { max_dashboard_series: 100, features: {} },
  },
  dispatch: vi.fn(),
};

const panel = (type: string, queries: string[]) => ({
  id: "p1",
  type,
  queryType: "promql",
  config: { drilldown: [] },
  queries: queries.map((query) => ({
    query,
    config: {},
    fields: { stream: "", stream_type: "metrics" },
  })),
});

const meta = (entries: { panelQueryIndex: number; query: string; gapMs?: number }[]) => ({
  queries: entries.map(({ panelQueryIndex, query, gapMs = 0 }) => ({
    query,
    panelQueryIndex,
    startTime: START_US - gapMs * 1000,
    endTime: END_US - gapMs * 1000,
    timeRangeGap: { seconds: gapMs, periodAsStr: gapMs ? "30 Minutes ago" : "" },
  })),
});

const drilldown = async (schema: any, data: any[], metadata: any) => {
  const { options, extras } = await convertPromQLData(
    schema,
    data,
    store,
    { value: { offsetWidth: 500, offsetHeight: 300 } },
    null,
    [],
    metadata,
    data.map(() => [{ step: 60_000_000 }]),
    true,
  );
  const api = usePanelDrilldown({
    panelSchema: { value: schema },
    variablesData: { value: { values: [] } },
    selectedTimeObj: {
      value: { start_time: new Date(START_US), end_time: new Date(END_US) },
    },
    metadata: { value: metadata },
    data: { value: data },
    panelData: { value: { options, extras } },
    filteredData: { value: data },
    resultMetaData: { value: data.map(() => [{ step: 60_000_000 }]) },
    store,
    route: { query: {} },
    router: { push: vi.fn(), resolve: vi.fn(() => ({ href: "" })) },
    emit: vi.fn(),
    allowAnnotationsAdd: { value: false },
    isAddAnnotationMode: { value: false },
    editAnnotation: vi.fn(),
    handleAddAnnotation: vi.fn(),
    chartPanelRef: { value: { offsetHeight: 300, offsetWidth: 300 } },
    drilldownPopUpRef: { value: { style: {}, offsetHeight: 20, offsetWidth: 40 } },
    annotationPopupRef: { value: { style: {}, offsetHeight: 20, offsetWidth: 40 } },
    selectedAnnotationData: { value: null },
    isCursorOverPanel: { value: true },
    showErrorNotification: vi.fn(),
    t: gt,
    onExemplarClick: vi.fn(),
    findRelatedTelemetry: vi.fn(),
    allowPointExplore: { value: true },
  } as any);
  return { api, series: options.series as any[] };
};

describe("point menu on PromQL charts", () => {
  it("a time-shifted point opens its own query's expression over its own, earlier window", async () => {
    const schema = panel("line", ["rate(alpha[5m])", "rate(beta[5m])"]);
    const metadata = meta([
      { panelQueryIndex: 0, query: "rate(alpha[5m])" },
      { panelQueryIndex: 1, query: "rate(beta[5m])" },
      { panelQueryIndex: 1, query: "rate(beta[5m])", gapMs: SHIFT_MS },
    ]);
    const { api, series } = await drilldown(
      schema,
      [matrix([{ pod: "a" }]), matrix([{ pod: "b" }]), matrix([{ pod: "b" }], SHIFT_MS / 1000)],
      metadata,
    );
    const seriesIndex = series.findIndex((s) => s.name?.includes("30 Minutes ago"));
    expect(series[seriesIndex]._queryIndex).toBeUndefined();
    expect(series[seriesIndex]._resultIndex).toBe(2);
    const point = series[seriesIndex].data[1];
    await api.explorePoint({
      componentType: "series",
      seriesIndex,
      dataIndex: 1,
      value: point,
      event: { offsetX: 1, offsetY: 1 },
    });

    const shownUs = new Date(point[0]).getTime() * 1000;
    expect(api.pointExplore.value?.target).toMatchObject({
      stream: "beta",
      startTime: shownUs - SHIFT_MS * 1000 - 5 * MIN_US,
      endTime: shownUs - SHIFT_MS * 1000,
      timeSlice: "lookBack",
    });
    expect(api.pointExplore.value?.target.filters).toEqual([{ field: "pod", value: "b" }]);
  });

  it.each(["pie", "donut", "h-bar"])(
    "%s: a slice opens its own series' labels and query, not the whole metric",
    async (type) => {
      const schema = panel(type, ["sum by (pod) (alpha)", "sum by (pod) (beta)"]);
      const metadata = meta([
        { panelQueryIndex: 0, query: "sum by (pod) (alpha)" },
        { panelQueryIndex: 1, query: "sum by (pod) (beta)" },
      ]);
      const { api, series } = await drilldown(
        schema,
        [matrix([{ pod: "a1" }]), matrix([{ pod: "b1" }, { pod: "b2" }])],
        metadata,
      );
      const dataIndex = series[0].data.findIndex((item: any) => item._labels?.pod === "b2");
      expect(dataIndex).toBeGreaterThanOrEqual(0);
      await api.explorePoint({
        componentType: "series",
        seriesIndex: 0,
        dataIndex,
        data: series[0].data[dataIndex],
        name: "b2",
        value: series[0].data[dataIndex].value,
        event: { offsetX: 1, offsetY: 1 },
      });

      expect(api.pointExplore.value?.target.stream).toBe("beta");
      expect(api.pointExplore.value?.target.filters).toEqual([{ field: "pod", value: "b2" }]);
    },
  );

  it.each(["stacked", "h-stacked"])(
    "%s: a bar opens the look-back behind its own bucket, not the whole range",
    async (type) => {
      const schema = panel(type, ["rate(alpha[5m])"]);
      const metadata = meta([{ panelQueryIndex: 0, query: "rate(alpha[5m])" }]);
      const { api, series } = await drilldown(schema, [matrix([{ pod: "a" }])], metadata);
      await api.explorePoint({
        componentType: "series",
        seriesIndex: 0,
        dataIndex: 1,
        name: "bucket",
        value: series[0].data[1],
        event: { offsetX: 1, offsetY: 1 },
      });

      const bucketUs = ts[1] * 1_000_000;
      expect(api.pointExplore.value?.target).toMatchObject({
        startTime: bucketUs - 5 * MIN_US,
        endTime: bucketUs,
        timeSlice: "lookBack",
      });
      expect(api.pointExplore.value?.target.filters).toEqual([{ field: "pod", value: "a" }]);
    },
  );

  // A heatmap cell is [column, row, value]; the click carries it as both data and value.
  const clickCell = async (
    api: any,
    series: any[],
    match: (row: any) => boolean,
    seriesIndex = 0,
    column = 1,
  ) => {
    const heatmap = series[seriesIndex];
    const row = heatmap._rows.findIndex((tags: any) => tags && match(tags._labels));
    expect(row).toBeGreaterThanOrEqual(0);
    const dataIndex = heatmap.data.findIndex((cell: any) => cell[0] === column && cell[1] === row);
    const cell = heatmap.data[dataIndex];
    await api.explorePoint({
      componentType: "series",
      seriesIndex,
      dataIndex,
      data: cell,
      value: cell,
      event: { offsetX: 1, offsetY: 1 },
    });
    return heatmap._timestamps[column] * 1_000_000;
  };

  it("heatmap: a cell opens its own row's series over the look-back behind its column", async () => {
    const schema = panel("heatmap", ["max by (pod) (rate(alpha[5m]))"]);
    const metadata = meta([{ panelQueryIndex: 0, query: "max by (pod) (rate(alpha[5m]))" }]);
    const { api, series } = await drilldown(
      schema,
      [matrix([{ pod: "a" }, { pod: "b" }])],
      metadata,
    );
    const columnUs = await clickCell(api, series, (labels) => labels.pod === "b");

    expect(api.pointExplore.value?.target).toMatchObject({
      stream: "alpha",
      startTime: columnUs - 5 * MIN_US,
      endTime: columnUs,
      timeSlice: "lookBack",
    });
    expect(api.pointExplore.value?.target.filters).toEqual([{ field: "pod", value: "b" }]);
  });

  it("heatmap: a cell from the second query opens the second query", async () => {
    const schema = panel("heatmap", ["max by (pod) (alpha)", "max by (pod) (beta)"]);
    const metadata = meta([
      { panelQueryIndex: 0, query: "max by (pod) (alpha)" },
      { panelQueryIndex: 1, query: "max by (pod) (beta)" },
    ]);
    const { api, series } = await drilldown(
      schema,
      [matrix([{ pod: "a1" }]), matrix([{ pod: "b1" }])],
      metadata,
    );
    await clickCell(api, series, (labels) => labels.pod === "b1");

    expect(api.pointExplore.value?.target.stream).toBe("beta");
    expect(api.pointExplore.value?.target.filters).toEqual([{ field: "pod", value: "b1" }]);
  });

  it("heatmap: a cell that names no series offers no point section", async () => {
    const schema = panel("heatmap", ["max by (pod) (alpha)"]);
    const { api, series } = await drilldown(
      schema,
      [matrix([{ pod: "a" }])],
      meta([{ panelQueryIndex: 0, query: "max by (pod) (alpha)" }]),
    );
    series[0]._rows = [null];
    const cell = series[0].data[1];
    await api.explorePoint({
      componentType: "series",
      seriesIndex: 0,
      dataIndex: 1,
      data: cell,
      value: cell,
      event: { offsetX: 1, offsetY: 1 },
    });
    expect(api.pointExplore.value).toBeNull();
  });

  it("histogram heatmap: a cell opens its own bucket series of its own query", async () => {
    const expr = "sum by (le, job) (rate(lat_bucket[5m]))";
    const schema = {
      ...panel("heatmap", ["sum by (le) (rate(other_bucket[5m]))", expr]),
      config: { drilldown: [], heatmap_mode: PROMETHEUS_HISTOGRAM_MODE },
    };
    const metadata = meta([
      { panelQueryIndex: 0, query: "sum by (le) (rate(other_bucket[5m]))" },
      { panelQueryIndex: 1, query: expr },
    ]);
    const { api, series } = await drilldown(
      schema,
      [
        matrix([{ le: "1" }, { le: "+Inf" }]),
        matrix([
          { job: "api", le: "0.5" },
          { job: "api", le: "+Inf" },
        ]),
      ],
      metadata,
    );
    // Two histograms draw two heatmaps; the second is the second query's.
    const histogram = series.findIndex((s) => s._rows?.some((r: any) => r?._labels?.job === "api"));
    expect(histogram).toBeGreaterThanOrEqual(0);
    const columnUs = await clickCell(api, series, (labels) => labels.le === "0.5", histogram);

    expect(api.pointExplore.value?.target.stream).toBe("lat_bucket");
    expect(api.pointExplore.value?.target.filters).toEqual([
      { field: "job", value: "api" },
      { field: "le", value: "0.5" },
    ]);
    expect(api.pointExplore.value?.target).toMatchObject({
      endTime: columnUs,
      timeSlice: "lookBack",
    });
  });
});

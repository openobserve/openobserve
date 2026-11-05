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
import { flushPromises } from "@vue/test-utils";
import { gt } from "@/types/i18n";
import { usePanelDrilldown } from "./usePanelDrilldown";

const appConfig = vi.hoisted(() => ({ isEnterprise: "false" }));
vi.mock("@/aws-exports", () => ({ default: appConfig }));

const resultSchemaMock = vi.fn();
vi.mock("@/services/search", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { result_schema: (...args: any[]) => resultSchemaMock(...args) },
  });
});

const sqlUtils = vi.hoisted(() => ({ extractFields: null as any }));
vi.mock("@/utils/query/sqlUtils", async (importOriginal) => {
  const actual: any = await importOriginal();
  sqlUtils.extractFields = vi.fn((...args: any[]) => actual.extractFields(...args));
  return { ...actual, extractFields: (...args: any[]) => sqlUtils.extractFields(...args) };
});

const field = (alias: string, name: string, extra: Record<string, unknown> = {}) => ({
  alias,
  args: [{ type: "field", value: { field: name } }],
  ...extra,
});
const histogramX = field("x_axis_1", "_timestamp", { functionName: "histogram" });
const serviceBreakdown = field("breakdown_1", "service");

const START = Date.UTC(2026, 2, 18, 0, 0);
const END = Date.UTC(2026, 2, 18, 1, 0);
const BUCKET = Date.UTC(2026, 2, 18, 0, 5);

const makeDeps = (overrides: { type?: string; fields?: any; streamType?: string } = {}) => {
  const popup = () => ({
    style: { display: "none", top: "", left: "" },
    offsetHeight: 20,
    offsetWidth: 40,
  });
  return {
    panelSchema: {
      value: {
        type: overrides.type ?? "line",
        queryType: "sql",
        config: { drilldown: [] as any[] },
        queries: [
          {
            fields: {
              stream: "app",
              stream_type: overrides.streamType ?? "logs",
              x: [histogramX],
              y: [field("y_axis_1", "count", { functionName: "count" })],
              breakdown: [serviceBreakdown],
              ...overrides.fields,
            },
            query: 'SELECT histogram(_timestamp) AS x_axis_1 FROM "app"',
          },
        ],
      } as any,
    },
    variablesData: { value: { values: [] } },
    // The app builds these Dates from microseconds, so getTime() is in microseconds.
    selectedTimeObj: {
      value: { start_time: new Date(START * 1000), end_time: new Date(END * 1000) },
    },
    metadata: { value: { queries: [{ query: 'SELECT * FROM "app"' }] } },
    data: { value: [[]] as any[] },
    panelData: {
      value: {
        options: { series: [{ originalSeriesName: "cart" }] },
        extras: { isTimeSeries: true },
      } as any,
    },
    filteredData: { value: [] },
    resultMetaData: { value: [[{ histogram_interval: 300 }]] },
    store: {
      state: {
        timezone: "UTC",
        selectedOrganization: { identifier: "org-1" },
        zoConfig: { enable_cross_linking: false, sql_base64_enabled: false, features: {} },
      },
      dispatch: vi.fn(),
    },
    route: { query: {} },
    router: {
      push: vi.fn(),
      resolve: vi.fn(({ query }: any) => ({
        href: `/web/traces?${new URLSearchParams(query).toString()}`,
      })),
    },
    emit: vi.fn(),
    allowAnnotationsAdd: { value: false },
    isAddAnnotationMode: { value: false },
    editAnnotation: vi.fn(),
    handleAddAnnotation: vi.fn(),
    chartPanelRef: {
      value: { offsetHeight: 300, offsetWidth: 300, getBoundingClientRect: () => ({}) },
    },
    drilldownPopUpRef: { value: popup() },
    annotationPopupRef: { value: popup() },
    selectedAnnotationData: { value: null },
    isCursorOverPanel: { value: true },
    showErrorNotification: vi.fn(),
    t: gt,
    onExemplarClick: vi.fn(),
    findRelatedTelemetry: vi.fn(),
    allowPointExplore: { value: true },
  };
};

const lineClick = {
  componentType: "series",
  seriesIndex: 0,
  seriesName: "cart",
  event: { offsetX: 10, offsetY: 10 },
  value: [BUCKET, 4],
};

const menuOpen = (deps: ReturnType<typeof makeDeps>) =>
  deps.drilldownPopUpRef.value.style.display === "block";

describe("usePanelDrilldown point menu", () => {
  let openSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    appConfig.isEnterprise = "false";
    openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
  });

  afterEach(() => openSpy.mockRestore());

  describe("filters and time slice per chart family", () => {
    it("time chart: the clicked histogram bucket and the series' breakdown value", async () => {
      const deps = makeDeps();
      const api = usePanelDrilldown(deps as any);
      await api.onChartClick(lineClick);

      expect(menuOpen(deps)).toBe(true);
      expect(api.drilldownArray.value).toEqual([]);
      expect(api.pointExplore.value?.target).toEqual({
        queryIndex: 0,
        stream: "app",
        streamType: "logs",
        startTime: BUCKET * 1000,
        endTime: BUCKET * 1000 + 300_000_000,
        timeSlice: "bucket",
        filters: [{ field: "service", value: "cart" }],
      });
      expect(api.pointExplore.value?.logs).toEqual({
        state: "enabled",
        detail: "00:05–00:10 · service=cart",
      });
    });

    it("time h-bar: the bucket is read from the raw UTC category label", async () => {
      const deps = makeDeps({ type: "h-bar" });
      deps.panelData.value.extras = {};
      const api = usePanelDrilldown(deps as any);
      await api.onChartClick({ ...lineClick, name: "2026-03-18T00:05:00", value: 4 });

      expect(api.pointExplore.value?.target).toMatchObject({
        startTime: BUCKET * 1000,
        endTime: BUCKET * 1000 + 300_000_000,
        timeSlice: "bucket",
      });
    });

    it("category chart: the whole panel range and the clicked slice", async () => {
      const deps = makeDeps({
        type: "pie",
        fields: { x: [field("x_axis_1", "service")], breakdown: [] },
      });
      deps.panelData.value.extras = {};
      const api = usePanelDrilldown(deps as any);
      await api.onChartClick({ componentType: "series", seriesIndex: 0, name: "cart", value: 9 });

      expect(api.pointExplore.value?.target).toMatchObject({
        startTime: START * 1000,
        endTime: END * 1000,
        timeSlice: "panelRange",
        filters: [{ field: "service", value: "cart" }],
      });
      expect(api.pointExplore.value?.logs.detail).toBe("Whole range 00:00–01:00 · service=cart");
    });

    it("category bar without a time axis: the category and the series value", async () => {
      const deps = makeDeps({ type: "bar", fields: { x: [field("x_axis_1", "status")] } });
      deps.panelData.value.extras = { isTimeSeries: false };
      deps.data.value = [[{ x_axis_1: 500, breakdown_1: "cart", y_axis_1: 1 }]];
      const api = usePanelDrilldown(deps as any);
      await api.onChartClick({ ...lineClick, name: "500", value: ["500", 1] });

      expect(api.pointExplore.value?.target).toMatchObject({
        timeSlice: "panelRange",
        filters: [
          { field: "status", value: 500 },
          { field: "service", value: "cart" },
        ],
      });
    });

    it("heatmap: the clicked column's time span and the row value", async () => {
      const deps = makeDeps({
        type: "heatmap",
        fields: { y: [field("y_axis_1", "service")], breakdown: [] },
      });
      deps.panelData.value = {
        options: { xAxis: [{ data: ["00:05"] }], yAxis: { data: ["cart"] }, series: [{}] },
        extras: {
          heatmapRowValues: [["cart"]],
          heatmapTimeAxis: { columns: [{ start: BUCKET, end: BUCKET + 60_000 }] },
        },
      };
      const api = usePanelDrilldown(deps as any);
      await api.onChartClick({ componentType: "series", seriesIndex: 0, value: [0, 0, 3] });

      expect(api.pointExplore.value?.target).toMatchObject({
        startTime: BUCKET * 1000,
        endTime: (BUCKET + 60_000) * 1000,
        timeSlice: "bucket",
        filters: [{ field: "service", value: "cart" }],
      });
    });
  });

  describe("menu gating", () => {
    it("a host that does not allow the point menu keeps a plain click inert, as before", async () => {
      const deps = makeDeps();
      deps.allowPointExplore.value = false;
      const api = usePanelDrilldown(deps as any);
      await api.onChartClick(lineClick);

      expect(menuOpen(deps)).toBe(false);
      expect(api.pointExplore.value).toBeNull();
    });

    it.each(["gauge", "metric", "table", "sankey", "custom_chart", "bar-gauge"])(
      "%s without drilldowns opens no menu, as before",
      async (type) => {
        const deps = makeDeps({ type });
        const api = usePanelDrilldown(deps as any);
        await api.onChartClick({
          ...lineClick,
          target: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
          offsetX: 1,
          offsetY: 1,
        });

        expect(menuOpen(deps)).toBe(false);
        expect(api.pointExplore.value).toBeNull();
      },
    );

    it("keeps the panel's drilldowns at their own indexes below the point section", async () => {
      const deps = makeDeps();
      deps.panelSchema.value.config.drilldown = [
        { name: "First", type: "byUrl", targetBlank: true, data: { url: "https://a.example" } },
        { name: "Second", type: "byUrl", targetBlank: true, data: { url: "https://b.example" } },
      ];
      const api = usePanelDrilldown(deps as any);
      await api.onChartClick(lineClick);

      expect(api.pointExplore.value).not.toBeNull();
      expect(api.drilldownArray.value.map((d: any) => d.name)).toEqual(["First", "Second"]);
      await api.openDrilldown(1);
      expect(openSpy).toHaveBeenCalledWith("https://b.example", "_blank", "noopener,noreferrer");
    });

    it("an annotation marker keeps its own popup and gets no point section", async () => {
      const deps = makeDeps();
      const api = usePanelDrilldown(deps as any);
      await api.onChartClick({
        componentType: "markLine",
        event: { offsetX: 1, offsetY: 1 },
        data: { annotationDetails: { text: "deploy" } },
      });

      expect(api.pointExplore.value).toBeNull();
      expect(menuOpen(deps)).toBe(false);
      expect(deps.annotationPopupRef.value.style.display).toBe("block");
    });

    it("a query-source band, an exemplar and a treemap breadcrumb open no menu", async () => {
      const deps = makeDeps();
      const api = usePanelDrilldown(deps as any);
      await api.onChartClick({
        componentType: "markArea",
        data: { annotationDetails: { source: { id: "s" } } },
      });
      await api.onChartClick({ seriesId: "__exemplars__", componentType: "series" });
      deps.panelSchema.value.type = "treemap";
      await api.onChartClick({ selfType: "breadcrumb", componentType: "series" });

      expect(menuOpen(deps)).toBe(false);
      expect(api.pointExplore.value).toBeNull();
    });
  });

  describe("View logs and View traces availability", () => {
    it("PromQL: logs off with its reason; traces off without correlation", async () => {
      const deps = makeDeps({ streamType: "metrics" });
      deps.panelSchema.value.queryType = "promql";
      const api = usePanelDrilldown(deps as any);
      await api.onChartClick(lineClick);

      expect(api.pointExplore.value?.target.filters).toEqual([]);
      expect(api.pointExplore.value?.logs).toEqual({
        state: "disabled",
        detail: "Logs open only for SQL charts on a logs stream",
      });
      expect(api.pointExplore.value?.traces).toEqual({
        state: "disabled",
        detail: "No trace correlation for this stream",
      });
    });

    it("a traces stream opens the Traces page in a new tab with the slice and filters", async () => {
      const deps = makeDeps({ streamType: "traces" });
      const api = usePanelDrilldown(deps as any);
      await api.onChartClick(lineClick);
      expect(api.pointExplore.value?.traces.state).toBe("enabled");

      api.openPointTraces();

      const query = deps.router.resolve.mock.calls[0][0];
      expect(query).toEqual({
        name: "traces",
        query: {
          org_identifier: "org-1",
          stream: "app",
          from: String(BUCKET * 1000),
          to: String(BUCKET * 1000 + 300_000_000),
          filter: "service = 'cart'",
        },
      });
      expect(openSpy).toHaveBeenCalledWith(
        expect.stringContaining("/web/traces?"),
        "_blank",
        "noopener,noreferrer",
      );
    });

    it("OSS: a logs chart's traces item is off and no correlation is asked for", async () => {
      const deps = makeDeps();
      const api = usePanelDrilldown(deps as any);
      await api.onChartClick(lineClick);

      expect(api.pointExplore.value?.traces.detail).toBe("No trace correlation for this stream");
      expect(deps.findRelatedTelemetry).not.toHaveBeenCalled();
      api.openPointTraces();
      expect(openSpy).not.toHaveBeenCalled();
    });

    it("enterprise: correlates the clicked filters to a service and opens its traces", async () => {
      appConfig.isEnterprise = "true";
      const deps = makeDeps();
      let settle: (value: unknown) => void = () => undefined;
      deps.findRelatedTelemetry.mockImplementation(
        () => new Promise((resolve) => (settle = resolve)),
      );
      const api = usePanelDrilldown(deps as any);
      await api.onChartClick(lineClick);
      expect(api.pointExplore.value?.traces).toEqual({
        state: "pending",
        detail: "Finding the service for this point…",
      });
      api.openPointTraces();
      expect(openSpy).not.toHaveBeenCalled();
      settle({
        correlationData: {
          service_name: "cart",
          related_streams: {
            traces: [{ stream_name: "otel_traces", filters: { service_name: "cart-svc" } }],
          },
        },
      });
      await flushPromises();

      expect(deps.findRelatedTelemetry).toHaveBeenCalledWith(
        { timestamp: BUCKET * 1000, fields: { service: "cart" } },
        "logs",
        5,
        "app",
      );
      expect(api.pointExplore.value?.traces).toEqual({
        state: "enabled",
        detail: "Traces for service cart · 00:05–00:10",
      });
      api.openPointTraces();
      expect(deps.router.resolve.mock.calls[0][0].query).toMatchObject({
        stream: "otel_traces",
        filter: "service_name = 'cart-svc'",
      });
    });

    it("enterprise: no matching service turns the traces item off with its reason", async () => {
      appConfig.isEnterprise = "true";
      const deps = makeDeps();
      deps.findRelatedTelemetry.mockResolvedValue(null);
      const api = usePanelDrilldown(deps as any);
      await api.onChartClick(lineClick);
      await flushPromises();

      expect(api.pointExplore.value?.traces).toEqual({
        state: "disabled",
        detail: "No trace correlation for this stream",
      });
    });

    it("enterprise: a chart with no group-by values has no service field to correlate", async () => {
      appConfig.isEnterprise = "true";
      const deps = makeDeps({ fields: { breakdown: [] } });
      const api = usePanelDrilldown(deps as any);
      await api.onChartClick(lineClick);

      expect(api.pointExplore.value?.traces.detail).toBe(
        "This chart has no service field to correlate",
      );
      expect(deps.findRelatedTelemetry).not.toHaveBeenCalled();
    });

    it("a slow correlation from an earlier click never overwrites the newer point", async () => {
      appConfig.isEnterprise = "true";
      const deps = makeDeps();
      let settleFirst: (value: unknown) => void = () => undefined;
      deps.findRelatedTelemetry
        .mockImplementationOnce(() => new Promise((resolve) => (settleFirst = resolve)))
        .mockResolvedValueOnce(null);
      const api = usePanelDrilldown(deps as any);
      await api.onChartClick(lineClick);
      await api.onChartClick(lineClick);
      await flushPromises();
      settleFirst({
        correlationData: {
          service_name: "stale",
          related_streams: { traces: [{ stream_name: "t" }] },
        },
      });
      await flushPromises();

      expect(api.pointExplore.value?.traces.state).toBe("disabled");
    });
  });

  describe("review round", () => {
    it("several x fields: every value is read off the clicked row's own axes", async () => {
      const deps = makeDeps({
        type: "bar",
        fields: { x: [field("x_axis_1", "status"), field("x_axis_2", "service")], breakdown: [] },
      });
      deps.panelData.value = {
        options: { xAxis: [{ data: ["500", "404"] }, { data: ["cart", "auth"] }], series: [{}] },
        extras: { isTimeSeries: false },
      };
      deps.data.value = [[{ x_axis_1: 404, x_axis_2: "auth", y_axis_1: 2 }]];
      const api = usePanelDrilldown(deps as any);
      await api.onChartClick({
        componentType: "series",
        seriesIndex: 0,
        dataIndex: 1,
        name: "404",
      });
      expect(api.pointExplore.value?.target.filters).toEqual([
        { field: "status", value: 404 },
        { field: "service", value: "auth" },
      ]);

      // Axes that disagree with the clicked label are not trusted: only the label is used.
      await api.onChartClick({
        componentType: "series",
        seriesIndex: 0,
        dataIndex: 1,
        name: "500",
      });
      expect(api.pointExplore.value?.target.filters).toEqual([{ field: "status", value: "500" }]);
    });

    it("a time-shifted series explores the bucket its own query ran over", async () => {
      const deps = makeDeps();
      const weekMs = 7 * 86_400_000;
      deps.panelData.value.options.series = [
        { originalSeriesName: "cart", _queryIndex: 0, _panelQueryIndex: 0 },
        { originalSeriesName: "cart", _queryIndex: 1, _panelQueryIndex: 0 },
      ];
      deps.metadata.value = {
        queries: [
          { query: "q", timeRangeGap: { seconds: 0 } },
          { query: "q", timeRangeGap: { seconds: weekMs } },
        ],
      } as any;
      const api = usePanelDrilldown(deps as any);
      await api.onChartClick({ ...lineClick, seriesIndex: 1 });
      expect(api.pointExplore.value?.target).toMatchObject({
        startTime: (BUCKET - weekMs) * 1000,
        endTime: (BUCKET - weekMs) * 1000 + 300_000_000,
        timeSlice: "bucket",
      });
      await api.onChartClick({ ...lineClick, seriesIndex: 0 });
      expect(api.pointExplore.value?.target.startTime).toBe(BUCKET * 1000);
    });

    it("a category chart explores its query's own range from the metadata", async () => {
      const deps = makeDeps({
        type: "pie",
        fields: { x: [field("x_axis_1", "service")], breakdown: [] },
      });
      deps.panelData.value.extras = {};
      deps.metadata.value = { queries: [{ query: "q", startTime: 111, endTime: 999 }] } as any;
      const api = usePanelDrilldown(deps as any);
      await api.onChartClick({ componentType: "series", seriesIndex: 0, name: "cart", value: 9 });
      expect(api.pointExplore.value?.target).toMatchObject({
        startTime: 111,
        endTime: 999,
        timeSlice: "panelRange",
      });
    });

    const treemapDeps = (queries: any[]) => {
      const deps = makeDeps({ type: "treemap" });
      deps.panelSchema.value.queries = queries.map((extra) => ({
        query: "q",
        fields: {
          stream: "app",
          stream_type: "logs",
          x: [field("x_axis_1", "namespace")],
          y: [field("y_axis_1", "n", { functionName: "count" })],
          breakdown: [],
        },
        ...extra,
      }));
      deps.panelData.value = { options: { series: [{}] }, extras: {} };
      return deps;
    };
    const tileClick = {
      componentType: "series",
      seriesIndex: 0,
      name: "checkout",
      data: { path: ["checkout"] },
      event: { offsetX: 1, offsetY: 1 },
    };

    it("a multi-query treemap offers no point menu, since a tile names no query", async () => {
      const deps = treemapDeps([{}, {}]);
      const api = usePanelDrilldown(deps as any);
      await api.onChartClick(tileClick);
      expect(api.pointExplore.value).toBeNull();
      expect(menuOpen(deps)).toBe(false);
    });

    it("a treemap with one visible query explores that query", async () => {
      const deps = treemapDeps([{ config: { hide: true } }, {}]);
      deps.panelSchema.value.queries[1].fields.stream = "second";
      const api = usePanelDrilldown(deps as any);
      await api.onChartClick(tileClick);
      expect(api.pointExplore.value?.target).toMatchObject({
        queryIndex: 1,
        stream: "second",
        filters: [{ field: "namespace", value: "checkout" }],
      });
    });

    it("a custom SQL panel parses its query once, not on every click", async () => {
      const deps = makeDeps({
        fields: { x: [{ alias: "x_axis_1" }], breakdown: [{ alias: "svc" }] },
      });
      deps.panelSchema.value.queries[0].customQuery = true;
      deps.metadata.value = {
        queries: [
          {
            query:
              'SELECT histogram(_timestamp) AS x_axis_1, service AS svc, count(*) AS c FROM "app" GROUP BY x_axis_1, svc',
          },
        ],
      } as any;
      sqlUtils.extractFields.mockClear();
      const api = usePanelDrilldown(deps as any);
      await api.onChartClick(lineClick);
      await api.onChartClick(lineClick);
      expect(api.pointExplore.value?.target.filters).toEqual([{ field: "service", value: "cart" }]);
      // Other tests' table panels parse their own SQL late, so count only this query's parses.
      const parsesOfThisQuery = sqlUtils.extractFields.mock.calls.filter((c: any[]) =>
        JSON.stringify(c[0]).includes('"svc"'),
      );
      expect(parsesOfThisQuery).toHaveLength(1);
    });

    it("enterprise: a traces-stream chart is enabled at once and never asks correlation", async () => {
      appConfig.isEnterprise = "true";
      const deps = makeDeps({ streamType: "traces" });
      const api = usePanelDrilldown(deps as any);
      await api.onChartClick(lineClick);
      expect(api.pointExplore.value?.traces.state).toBe("enabled");
      await flushPromises();
      expect(deps.findRelatedTelemetry).not.toHaveBeenCalled();
    });
  });
});

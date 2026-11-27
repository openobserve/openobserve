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
import { filtersWhere } from "@/utils/dashboard/chartPointExplore";

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

// The point section is what the right-click menu lists; the left-click drilldown menu never holds it.
let lastApi: any = null;
const menuOpen = (_deps: ReturnType<typeof makeDeps>) => !!lastApi?.pointExplore.value;

describe("usePanelDrilldown point menu", () => {
  let openSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    lastApi = null;
    appConfig.isEnterprise = "false";
    openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
  });

  afterEach(() => openSpy.mockRestore());

  describe("filters and time slice per chart family", () => {
    it("time chart: the clicked histogram bucket and the series' breakdown value", async () => {
      const deps = makeDeps();
      const api = (lastApi = usePanelDrilldown(deps as any));
      await api.explorePoint(lineClick);

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
      const api = (lastApi = usePanelDrilldown(deps as any));
      await api.explorePoint({ ...lineClick, name: "2026-03-18T00:05:00", value: 4 });

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
      const api = (lastApi = usePanelDrilldown(deps as any));
      await api.explorePoint({ componentType: "series", seriesIndex: 0, name: "cart", value: 9 });

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
      const api = (lastApi = usePanelDrilldown(deps as any));
      await api.explorePoint({ ...lineClick, name: "500", value: ["500", 1] });

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
      const api = (lastApi = usePanelDrilldown(deps as any));
      await api.explorePoint({ componentType: "series", seriesIndex: 0, value: [0, 0, 3] });

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
      const api = (lastApi = usePanelDrilldown(deps as any));
      await api.explorePoint(lineClick);

      expect(menuOpen(deps)).toBe(false);
      expect(api.pointExplore.value).toBeNull();
    });

    it.each(["gauge", "metric", "table", "sankey", "custom_chart", "bar-gauge"])(
      "%s without drilldowns opens no menu, as before",
      async (type) => {
        const deps = makeDeps({ type });
        const api = (lastApi = usePanelDrilldown(deps as any));
        await api.explorePoint({
          ...lineClick,
          target: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
          offsetX: 1,
          offsetY: 1,
        });

        expect(menuOpen(deps)).toBe(false);
        expect(api.pointExplore.value).toBeNull();
      },
    );

    it("left-click opens only the panel's drilldowns, and never fills the point section", async () => {
      const deps = makeDeps();
      deps.panelSchema.value.config.drilldown = [
        { name: "First", type: "byUrl", targetBlank: true, data: { url: "https://a.example" } },
        { name: "Second", type: "byUrl", targetBlank: true, data: { url: "https://b.example" } },
      ];
      const api = (lastApi = usePanelDrilldown(deps as any));
      await api.onChartClick(lineClick);

      expect(deps.drilldownPopUpRef.value.style.display).toBe("block");
      expect(api.pointExplore.value).toBeNull();
      expect(api.drilldownArray.value.map((d: any) => d.name)).toEqual(["First", "Second"]);
      await api.openDrilldown(1);
      expect(openSpy).toHaveBeenCalledWith("https://b.example", "_blank", "noopener,noreferrer");
    });

    it("an annotation marker keeps its own popup and gets no point section", async () => {
      const deps = makeDeps();
      const api = (lastApi = usePanelDrilldown(deps as any));
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
      const api = (lastApi = usePanelDrilldown(deps as any));
      await api.onChartClick({
        componentType: "markArea",
        data: { annotationDetails: { source: { id: "s" } } },
      });
      await api.onChartClick({ seriesId: "__exemplars__", componentType: "series" });
      deps.panelSchema.value.type = "treemap";
      await api.onChartClick({ selfType: "breadcrumb", componentType: "series" });
      expect(deps.drilldownPopUpRef.value.style.display).not.toBe("block");
      // Right-click on a band is not a data point either.
      await api.explorePoint({
        componentType: "markArea",
        data: { annotationDetails: { source: { id: "s" } } },
      });

      expect(menuOpen(deps)).toBe(false);
      expect(api.pointExplore.value).toBeNull();
    });
  });

  describe("View logs and View traces availability", () => {
    it("PromQL without correlation: only View metrics opens, scoped to the series labels", async () => {
      const deps = makeDeps({ streamType: "metrics" });
      const expr = "sum by (service) (rate(http_requests_total[5m]))";
      deps.panelSchema.value.queryType = "promql";
      deps.panelSchema.value.queries[0].query = expr;
      (deps.metadata.value.queries[0] as any).query = expr;
      deps.panelData.value.options.series[0] = {
        name: "checkout",
        _labels: { service: "checkout" },
      } as any;
      const api = (lastApi = usePanelDrilldown(deps as any));
      await api.explorePoint(lineClick);

      expect(api.pointExplore.value?.logs.state).toBe("hidden");
      expect(api.pointExplore.value?.traces.state).toBe("hidden");
      expect(api.pointExplore.value?.metrics.state).toBe("enabled");
      expect(api.pointExplore.value?.target.filters).toEqual([
        { field: "service", value: "checkout" },
      ]);
      expect(api.pointExplore.value?.metricsTarget).toEqual({
        stream: "http_requests_total",
        filters: [{ field: "service", value: "checkout" }],
      });
      expect(menuOpen(deps)).toBe(true);
    });

    it("PromQL: a point explores the five-minute look-back behind it, not the whole range", async () => {
      const deps = makeDeps({ streamType: "metrics" });
      deps.panelSchema.value.queryType = "promql";
      deps.panelSchema.value.queries[0].query = "up";
      (deps.metadata.value.queries[0] as any).query = "up";
      deps.resultMetaData.value = [[{ step: 60_000_000 } as any]];
      deps.panelData.value.options.series[0] = { name: "up", _labels: { job: "api" } } as any;
      const api = (lastApi = usePanelDrilldown(deps as any));
      await api.explorePoint(lineClick);

      expect(api.pointExplore.value?.target).toMatchObject({
        startTime: BUCKET * 1000 - 5 * 60_000_000,
        endTime: BUCKET * 1000,
        timeSlice: "lookBack",
      });
      expect(api.pointExplore.value?.metrics.detail).toBe("00:00–00:05 · job=api");
    });

    it("PromQL: a wider range vector in the expression widens the look-back", async () => {
      const deps = makeDeps({ streamType: "metrics" });
      const expr = "sum(rate(http_requests_total[10m]))";
      deps.panelSchema.value.queryType = "promql";
      deps.panelSchema.value.queries[0].query = expr;
      (deps.metadata.value.queries[0] as any).query = expr;
      deps.panelData.value.options.series[0] = { name: "x", _labels: {} } as any;
      const api = (lastApi = usePanelDrilldown(deps as any));
      await api.explorePoint(lineClick);

      expect(api.pointExplore.value?.target).toMatchObject({
        startTime: BUCKET * 1000 - 10 * 60_000_000,
        endTime: BUCKET * 1000,
        timeSlice: "lookBack",
      });
    });

    it("PromQL: an offset in the query moves the window back for every row", async () => {
      const deps = makeDeps({ streamType: "metrics" });
      const expr = "rate(http_requests_total[5m] offset 1h)";
      deps.panelSchema.value.queryType = "promql";
      deps.panelSchema.value.queries[0].query = expr;
      (deps.metadata.value.queries[0] as any).query = expr;
      deps.panelData.value.options.series[0] = { name: "x", _labels: {} } as any;
      const api = (lastApi = usePanelDrilldown(deps as any));
      await api.explorePoint(lineClick);

      expect(api.pointExplore.value?.target).toMatchObject({
        startTime: BUCKET * 1000 - 65 * 60_000_000,
        endTime: BUCKET * 1000 - 60 * 60_000_000,
        timeSlice: "lookBack",
      });
    });

    it("PromQL: different offsets give a window covering them all", async () => {
      const deps = makeDeps({ streamType: "metrics" });
      const expr = "rate(a[5m]) - rate(a[5m] offset 1h)";
      deps.panelSchema.value.queryType = "promql";
      deps.panelSchema.value.queries[0].query = expr;
      (deps.metadata.value.queries[0] as any).query = expr;
      deps.panelData.value.options.series[0] = { name: "x", _labels: {} } as any;
      const api = (lastApi = usePanelDrilldown(deps as any));
      await api.explorePoint(lineClick);

      expect(api.pointExplore.value?.target).toMatchObject({
        startTime: BUCKET * 1000 - 65 * 60_000_000,
        endTime: BUCKET * 1000,
        timeSlice: "lookBack",
      });
    });

    it("PromQL: a pie slice keeps the whole panel range", async () => {
      const deps = makeDeps({ type: "pie", streamType: "metrics" });
      deps.panelSchema.value.queryType = "promql";
      deps.resultMetaData.value = [[{ step: 60_000_000 } as any]];
      deps.panelData.value.options.series[0] = { name: "up", _labels: { job: "api" } } as any;
      const api = (lastApi = usePanelDrilldown(deps as any));
      await api.explorePoint({ ...lineClick, name: "up", value: 4 });

      expect(api.pointExplore.value?.target.timeSlice).toBe("panelRange");
      expect(api.pointExplore.value?.target.startTime).toBe(START * 1000);
    });

    it("PromQL: the series __name__ names the metric and is no filter", async () => {
      const deps = makeDeps({ streamType: "metrics" });
      deps.panelSchema.value.queryType = "promql";
      deps.panelData.value.options.series[0] = {
        name: "up",
        _labels: { __name__: "up", job: "api" },
      } as any;
      const api = (lastApi = usePanelDrilldown(deps as any));
      await api.explorePoint(lineClick);

      expect(api.pointExplore.value?.target.stream).toBe("up");
      expect(api.pointExplore.value?.target.filters).toEqual([{ field: "job", value: "api" }]);
    });

    it("a SQL chart on a metrics stream opens View metrics at once on that stream", async () => {
      const deps = makeDeps({ streamType: "metrics" });
      const api = (lastApi = usePanelDrilldown(deps as any));
      await api.explorePoint(lineClick);

      expect(api.pointExplore.value?.metrics.state).toBe("enabled");
      expect(api.pointExplore.value?.metricsTarget).toMatchObject({
        stream: "app",
        filters: [{ field: "service", value: "cart" }],
      });
      expect(deps.findRelatedTelemetry).not.toHaveBeenCalled();
    });

    it("a traces stream opens View traces at once on that stream with the slice filters", async () => {
      const deps = makeDeps({ streamType: "traces" });
      const api = (lastApi = usePanelDrilldown(deps as any));
      await api.explorePoint(lineClick);

      expect(api.pointExplore.value?.traces.state).toBe("enabled");
      expect(api.pointExplore.value?.tracesTarget).toEqual({
        stream: "app",
        filter: "service = 'cart'",
        filters: [{ field: "service", value: "cart" }],
      });
    });

    it("OSS: a logs chart hides View traces and asks no correlation", async () => {
      const deps = makeDeps();
      const api = (lastApi = usePanelDrilldown(deps as any));
      await api.explorePoint(lineClick);

      expect(api.pointExplore.value?.logs.state).toBe("enabled");
      expect(api.pointExplore.value?.traces.state).toBe("hidden");
      expect(api.pointExplore.value?.metrics.state).toBe("hidden");
      expect(api.pointExplore.value?.tracesTarget).toBeNull();
      expect(deps.findRelatedTelemetry).not.toHaveBeenCalled();
    });

    it("enterprise: correlates the clicked filters to a service and opens its traces", async () => {
      appConfig.isEnterprise = "true";
      const deps = makeDeps();
      let settle: (value: unknown) => void = () => undefined;
      deps.findRelatedTelemetry.mockImplementation(
        () => new Promise((resolve) => (settle = resolve)),
      );
      const api = (lastApi = usePanelDrilldown(deps as any));
      await api.explorePoint(lineClick);
      expect(api.pointExplore.value?.traces).toEqual({
        state: "pending",
        detail: "Finding the service for this point…",
      });
      expect(api.pointExplore.value?.metrics.state).toBe("pending");
      expect(api.pointExplore.value?.tracesTarget).toBeNull();
      settle({
        correlationData: {
          service_name: "cart",
          related_streams: {
            traces: [{ stream_name: "otel_traces", filters: { service_name: "cart-svc" } }],
            metrics: [
              { stream_name: "k8s_pod_cpu", filters: { service_name: "cart-svc" } },
              { stream_name: "k8s_pod_memory" },
            ],
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
      expect(api.pointExplore.value?.tracesTarget).toEqual({
        stream: "otel_traces",
        filter: "service_name = 'cart-svc'",
        filters: [{ field: "service_name", value: "cart-svc" }],
      });
      // The one lookup also settles View metrics; it asks no second time.
      expect(deps.findRelatedTelemetry).toHaveBeenCalledTimes(1);
      expect(api.pointExplore.value?.metrics).toEqual({
        state: "enabled",
        detail: "Metrics for service cart · 00:05–00:10",
      });
      // The drawer opens the first related metric; it has no picker to switch to the others.
      expect(api.pointExplore.value?.metricsTarget).toEqual({
        stream: "k8s_pod_cpu",
        filters: [{ field: "service_name", value: "cart-svc" }],
      });
    });

    it("enterprise: a service with no metric streams hides View metrics and keeps View traces", async () => {
      appConfig.isEnterprise = "true";
      const deps = makeDeps();
      deps.findRelatedTelemetry.mockResolvedValue({
        correlationData: {
          service_name: "cart",
          related_streams: { traces: [{ stream_name: "otel_traces" }], metrics: [] },
        },
      });
      const api = (lastApi = usePanelDrilldown(deps as any));
      await api.explorePoint(lineClick);
      await flushPromises();

      expect(api.pointExplore.value?.traces.state).toBe("enabled");
      expect(api.pointExplore.value?.metrics.state).toBe("hidden");
      expect(api.pointExplore.value?.metricsTarget).toBeNull();
    });

    it("enterprise: a traces chart correlates for View metrics as a traces source", async () => {
      appConfig.isEnterprise = "true";
      const deps = makeDeps({ streamType: "traces" });
      deps.findRelatedTelemetry.mockResolvedValue(null);
      const api = (lastApi = usePanelDrilldown(deps as any));
      await api.explorePoint(lineClick);
      await flushPromises();

      expect(deps.findRelatedTelemetry).toHaveBeenCalledWith(expect.anything(), "traces", 5, "app");
      expect(api.pointExplore.value?.traces.state).toBe("enabled");
      expect(api.pointExplore.value?.metrics.state).toBe("hidden");
    });

    it("enterprise: no matching service hides View traces and keeps View logs", async () => {
      appConfig.isEnterprise = "true";
      const deps = makeDeps();
      deps.findRelatedTelemetry.mockResolvedValue(null);
      const api = (lastApi = usePanelDrilldown(deps as any));
      await api.explorePoint(lineClick);
      await flushPromises();

      expect(api.pointExplore.value?.traces.state).toBe("hidden");
      expect(api.pointExplore.value?.logs.state).toBe("enabled");
      expect(menuOpen(deps)).toBe(true);
    });

    it("enterprise: no matching service on a chart without View logs closes the empty menu", async () => {
      appConfig.isEnterprise = "true";
      // A JOIN hides View logs, leaving only the rows correlation settles.
      const deps = makeDeps();
      deps.panelSchema.value.queries[0].joins = [{ stream: "other" }];
      let settle: (value: unknown) => void = () => undefined;
      deps.findRelatedTelemetry.mockImplementation(
        () => new Promise((resolve) => (settle = resolve)),
      );
      const api = (lastApi = usePanelDrilldown(deps as any));
      await api.explorePoint(lineClick);
      expect(menuOpen(deps)).toBe(true);
      settle(null);
      await flushPromises();

      expect(api.pointExplore.value).toBeNull();
      expect(menuOpen(deps)).toBe(false);
    });

    it("enterprise: a miss that lands before the menu opens leaves no empty menu", async () => {
      appConfig.isEnterprise = "true";
      // A JOIN hides View logs, leaving only the rows correlation settles.
      const deps = makeDeps();
      deps.panelSchema.value.queries[0].joins = [{ stream: "other" }];
      deps.findRelatedTelemetry.mockResolvedValue(null);
      const api = (lastApi = usePanelDrilldown(deps as any));
      await api.explorePoint(lineClick);
      await flushPromises();

      expect(api.pointExplore.value).toBeNull();
      expect(menuOpen(deps)).toBe(false);
    });

    it("enterprise: a chart with no group-by values hides View traces without correlating", async () => {
      appConfig.isEnterprise = "true";
      const deps = makeDeps({ fields: { breakdown: [] } });
      const api = (lastApi = usePanelDrilldown(deps as any));
      await api.explorePoint(lineClick);

      expect(api.pointExplore.value?.traces.state).toBe("hidden");
      expect(deps.findRelatedTelemetry).not.toHaveBeenCalled();
    });

    it("a slow correlation from an earlier click never overwrites the newer point", async () => {
      appConfig.isEnterprise = "true";
      const deps = makeDeps();
      let settleFirst: (value: unknown) => void = () => undefined;
      deps.findRelatedTelemetry
        .mockImplementationOnce(() => new Promise((resolve) => (settleFirst = resolve)))
        .mockResolvedValueOnce(null);
      const api = (lastApi = usePanelDrilldown(deps as any));
      await api.explorePoint(lineClick);
      await api.explorePoint(lineClick);
      await flushPromises();
      settleFirst({
        correlationData: {
          service_name: "stale",
          related_streams: { traces: [{ stream_name: "t" }] },
        },
      });
      await flushPromises();

      expect(api.pointExplore.value?.traces.state).toBe("hidden");
    });
  });

  describe("JOIN charts", () => {
    // Enterprise keeps View traces pending, so the section stays and View logs can be read on its own.
    const joinDeps = () => {
      appConfig.isEnterprise = "true";
      const deps = makeDeps();
      deps.findRelatedTelemetry.mockImplementation(() => new Promise(() => undefined));
      return deps;
    };

    it("a custom SQL JOIN hides View logs", async () => {
      const deps = joinDeps();
      const sql =
        'SELECT histogram(a._timestamp) AS x_axis_1, b.service AS breakdown_1 FROM "app" a JOIN "users" b ON a.uid = b.id GROUP BY x_axis_1, breakdown_1';
      deps.panelSchema.value.queries[0].query = sql;
      deps.metadata.value = { queries: [{ query: sql }] } as any;
      const api = (lastApi = usePanelDrilldown(deps as any));
      await api.explorePoint(lineClick);

      expect(api.pointExplore.value?.logs.state).toBe("hidden");
      expect(api.pointExplore.value?.traces.state).toBe("pending");
    });

    it("a builder join hides View logs", async () => {
      const deps = joinDeps();
      (deps.panelSchema.value.queries[0] as any).joins = [{ stream: "users" }];
      const api = (lastApi = usePanelDrilldown(deps as any));
      await api.explorePoint(lineClick);

      expect(api.pointExplore.value?.logs.state).toBe("hidden");
    });

    it("a single-stream query keeps View logs", async () => {
      const deps = joinDeps();
      const api = (lastApi = usePanelDrilldown(deps as any));
      await api.explorePoint(lineClick);

      expect(api.pointExplore.value?.logs.state).toBe("enabled");
    });
  });

  describe("multi-query funnel", () => {
    const funnelDeps = () => {
      const deps = makeDeps({ type: "funnel" });
      deps.panelSchema.value.queries = [
        {
          fields: {
            stream: "web_events",
            stream_type: "logs",
            x: [field("x_axis_1", "step")],
            y: [field("y_axis_1", "count", { functionName: "count" })],
            breakdown: [],
          },
          query: 'SELECT step AS x_axis_1 FROM "web_events"',
        },
        {
          fields: {
            stream: "orders",
            stream_type: "logs",
            x: [field("x_axis_1", "stage")],
            y: [field("y_axis_1", "count", { functionName: "count" })],
            breakdown: [],
          },
          query: 'SELECT stage AS x_axis_1 FROM "orders"',
        },
      ];
      deps.data.value = [
        [{ x_axis_1: "Visited", y_axis_1: 100 }],
        [{ x_axis_1: "Purchased", y_axis_1: 12 }],
      ];
      deps.metadata.value = {
        queries: [
          { startTime: START * 1000, endTime: END * 1000 },
          { startTime: START * 1000, endTime: END * 1000 },
        ],
      } as any;
      deps.panelData.value = { options: { series: [{}] }, extras: {} } as any;
      return deps;
    };
    const stageClick = (name: string) => ({
      componentType: "series",
      seriesIndex: 0,
      dataIndex: 0,
      name,
      value: 1,
    });

    it("a stage from the second query opens that query's stream and stage field", async () => {
      const deps = funnelDeps();
      const api = (lastApi = usePanelDrilldown(deps as any));
      await api.explorePoint(stageClick("Purchased"));

      expect(api.pointExplore.value?.target).toMatchObject({
        queryIndex: 1,
        stream: "orders",
        timeSlice: "panelRange",
        filters: [{ field: "stage", value: "Purchased" }],
      });
    });

    it("a stage from the first query keeps the first query", async () => {
      const deps = funnelDeps();
      const api = (lastApi = usePanelDrilldown(deps as any));
      await api.explorePoint(stageClick("Visited"));

      expect(api.pointExplore.value?.target).toMatchObject({
        queryIndex: 0,
        stream: "web_events",
        filters: [{ field: "step", value: "Visited" }],
      });
    });

    it("a stage both queries return opens no point section", async () => {
      const deps = funnelDeps();
      deps.data.value[1].push({ x_axis_1: "Visited", y_axis_1: 5 });
      const api = (lastApi = usePanelDrilldown(deps as any));
      await api.explorePoint(stageClick("Visited"));

      expect(api.pointExplore.value).toBeNull();
      expect(menuOpen(deps)).toBe(false);
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
      const api = (lastApi = usePanelDrilldown(deps as any));
      await api.explorePoint({
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
      await api.explorePoint({
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
      const api = (lastApi = usePanelDrilldown(deps as any));
      await api.explorePoint({ ...lineClick, seriesIndex: 1 });
      expect(api.pointExplore.value?.target).toMatchObject({
        startTime: (BUCKET - weekMs) * 1000,
        endTime: (BUCKET - weekMs) * 1000 + 300_000_000,
        timeSlice: "bucket",
      });
      await api.explorePoint({ ...lineClick, seriesIndex: 0 });
      expect(api.pointExplore.value?.target.startTime).toBe(BUCKET * 1000);
    });

    it("a category chart explores its query's own range from the metadata", async () => {
      const deps = makeDeps({
        type: "pie",
        fields: { x: [field("x_axis_1", "service")], breakdown: [] },
      });
      deps.panelData.value.extras = {};
      deps.metadata.value = { queries: [{ query: "q", startTime: 111, endTime: 999 }] } as any;
      const api = (lastApi = usePanelDrilldown(deps as any));
      await api.explorePoint({ componentType: "series", seriesIndex: 0, name: "cart", value: 9 });
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
      const api = (lastApi = usePanelDrilldown(deps as any));
      await api.explorePoint(tileClick);
      expect(api.pointExplore.value).toBeNull();
      expect(menuOpen(deps)).toBe(false);
    });

    it("a treemap with one visible query explores that query", async () => {
      const deps = treemapDeps([{ config: { hide: true } }, {}]);
      deps.panelSchema.value.queries[1].fields.stream = "second";
      const api = (lastApi = usePanelDrilldown(deps as any));
      await api.explorePoint(tileClick);
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
      const api = (lastApi = usePanelDrilldown(deps as any));
      await api.explorePoint(lineClick);
      await api.explorePoint(lineClick);
      expect(api.pointExplore.value?.target.filters).toEqual([{ field: "service", value: "cart" }]);
      // Other tests' table panels parse their own SQL late, so count only this query's parses.
      const parsesOfThisQuery = sqlUtils.extractFields.mock.calls.filter((c: any[]) =>
        JSON.stringify(c[0]).includes('"svc"'),
      );
      expect(parsesOfThisQuery).toHaveLength(1);
    });

    it("enterprise: a traces-stream chart enables View traces at once; only View metrics correlates", async () => {
      appConfig.isEnterprise = "true";
      const deps = makeDeps({ streamType: "traces" });
      deps.findRelatedTelemetry.mockResolvedValue(null);
      const api = (lastApi = usePanelDrilldown(deps as any));
      await api.explorePoint(lineClick);
      expect(api.pointExplore.value?.traces.state).toBe("enabled");
      await flushPromises();
      expect(deps.findRelatedTelemetry).toHaveBeenCalledTimes(1);
      expect(api.pointExplore.value?.traces.state).toBe("enabled");
    });
  });

  describe("issue #17304", () => {
    const panelSql = (where: string) =>
      `SELECT histogram(_timestamp) AS x_axis_1, service AS breakdown_1 FROM "app" ${where} GROUP BY x_axis_1, breakdown_1`;

    it("View metrics keeps a metrics panel's own WHERE", async () => {
      const deps = makeDeps({ streamType: "metrics" });
      (deps.metadata.value.queries[0] as any).query = panelSql("WHERE client = 'user'");
      const api = (lastApi = usePanelDrilldown(deps as any));
      await api.explorePoint(lineClick);

      expect(api.pointExplore.value?.metricsTarget).toEqual({
        stream: "app",
        filters: [{ field: "service", value: "cart" }],
        baseWhere: "client = 'user'",
      });
      expect(String(api.pointExplore.value?.metrics.detail)).not.toContain("panel filter");
    });

    it("View traces keeps a traces panel's own WHERE", async () => {
      const deps = makeDeps({ streamType: "traces" });
      (deps.metadata.value.queries[0] as any).query = panelSql("WHERE status = 'ERROR'");
      const api = (lastApi = usePanelDrilldown(deps as any));
      await api.explorePoint(lineClick);

      expect(api.pointExplore.value?.tracesTarget).toMatchObject({
        filter: "(status = 'ERROR') AND service = 'cart'",
        baseWhere: "status = 'ERROR'",
      });
    });

    it("a WHERE that cannot be carried is said on the row, never silently dropped", async () => {
      const deps = makeDeps({ streamType: "metrics" });
      (deps.metadata.value.queries[0] as any).query =
        `SELECT service AS breakdown_1 FROM (SELECT * FROM "app") WHERE env = 'prod' GROUP BY breakdown_1`;
      const api = (lastApi = usePanelDrilldown(deps as any));
      await api.explorePoint(lineClick);

      expect(api.pointExplore.value?.metricsTarget?.baseWhere).toBeUndefined();
      expect(String(api.pointExplore.value?.metrics.detail)).toContain("panel filter not applied");
    });

    it("an untagged series never opens a hidden query: the first visible one instead", async () => {
      const deps = makeDeps();
      const q = deps.panelSchema.value.queries[0];
      deps.panelSchema.value.queries = [
        { ...q, config: { hide: true }, query: "hidden" },
        { ...q, config: {}, query: "visible" },
      ];
      const api = (lastApi = usePanelDrilldown(deps as any));
      await api.explorePoint(lineClick);

      expect(api.pointExplore.value?.target.queryIndex).toBe(1);
    });

    describe("a funnel's blank stages", () => {
      const funnel = (value: string | null) => {
        const deps = makeDeps({ type: "funnel" });
        deps.panelSchema.value.queries[0].fields = {
          ...deps.panelSchema.value.queries[0].fields,
          x: [field("x_axis_1", "svc")],
          breakdown: [],
        };
        deps.data.value = [
          [
            { x_axis_1: value, y_axis_1: 6 },
            { x_axis_1: "info", y_axis_1: 9 },
          ],
        ];
        deps.panelData.value = { options: { series: [{}] }, extras: {} } as any;
        return deps;
      };
      const click = (name: string, rawName: string | null) => ({
        componentType: "series",
        seriesIndex: 0,
        dataIndex: 0,
        name,
        value: 6,
        data: { name, rawName, value: 6 },
      });

      it.each([
        ["(empty)", "", "svc = ''"],
        ["(null)", null, "svc IS NULL"],
      ])("the %s stage opens the menu and filters its own value", async (name, raw, where) => {
        const deps = funnel(raw);
        const api = (lastApi = usePanelDrilldown(deps as any));
        await api.explorePoint(click(name, raw));

        expect(api.pointExplore.value?.target.filters).toEqual([{ field: "svc", value: raw }]);
        expect(filtersWhere("", api.pointExplore.value!.target.filters)).toBe(where);
      });
    });

    it("a computed group-by that cannot filter is said on the row", async () => {
      const deps = makeDeps({
        fields: { breakdown: [field("breakdown_1", "level", { functionName: "upper" })] },
      });
      const api = (lastApi = usePanelDrilldown(deps as any));
      await api.explorePoint(lineClick);

      expect(api.pointExplore.value?.target.filters).toEqual([]);
      expect(String(api.pointExplore.value?.logs.detail)).toBe("00:05–00:10 · series not filtered");
    });

    it("names the query it opens when several are visible, and not when one is", async () => {
      const deps = makeDeps();
      const q = deps.panelSchema.value.queries[0];
      deps.panelSchema.value.queries = [
        { ...q, config: { query_label: "errors {series}" } },
        { ...q, config: {} },
      ];
      deps.panelData.value.options.series = [
        { originalSeriesName: "cart", _panelQueryIndex: 0 },
        { originalSeriesName: "cart", _panelQueryIndex: 1 },
      ];
      const api = (lastApi = usePanelDrilldown(deps as any));
      await api.explorePoint(lineClick);
      expect(String(api.pointExplore.value?.logs.detail)).toBe(
        "00:05–00:10 · service=cart · errors",
      );
      await api.explorePoint({ ...lineClick, seriesIndex: 1 });
      expect(String(api.pointExplore.value?.logs.detail)).toBe(
        "00:05–00:10 · service=cart · Query 2",
      );

      deps.panelSchema.value.queries = [q];
      await api.explorePoint({ ...lineClick, seriesIndex: 0 });
      expect(String(api.pointExplore.value?.logs.detail)).toBe("00:05–00:10 · service=cart");
    });
  });
});

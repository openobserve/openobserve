// Copyright 2026 OpenObserve Inc.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { computed, defineComponent, h, nextTick, reactive } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { b64DecodeUnicode } from "@/utils/zincutils";
import type { DashboardFieldRow } from "./dashboard/dashboardFieldRows";
import type { ChipContext } from "./dashboard/dashboardFieldChips";

const valuesMock = vi.hoisted(() => ({
  fetchFieldValues: vi.fn(),
  cancelFieldStream: vi.fn(),
}));
const realStream = vi.hoisted(() => ({
  on: false,
  sent: [] as Record<string, unknown>[],
  inFlight: [] as {
    payload: Record<string, unknown>;
    handlers: Record<string, (...args: unknown[]) => void>;
  }[],
}));
vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: (
      payload: { queryReq: Record<string, unknown> },
      handlers: Record<string, (...args: unknown[]) => void>,
    ) => {
      realStream.sent.push(payload.queryReq);
      realStream.inFlight.push({ payload, handlers });
    },
    cancelStreamQueryBasedOnRequestId: vi.fn(),
  }),
}));

vi.mock("@/composables/useFieldValuesStream", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/composables/useFieldValuesStream")>();
  const { ref: vueRef } = await import("vue");
  return {
    ...actual,
    default: (t: Parameters<typeof actual.default>[0]) => {
      if (realStream.on) return actual.default(t);
      const fieldValues = vueRef<Record<string, unknown>>({});
      return {
        fieldValues,
        fieldValuesFinalizedValues: vueRef({}),
        fieldValuesCurrentSize: vueRef({}),
        fetchFieldValues: valuesMock.fetchFieldValues,
        fetchMoreFieldValues: valuesMock.fetchFieldValues,
        isFetchSettled: () => true,
        rememberUnfiltered: vi.fn(),
        restoreUnfiltered: () => null,
        forgetUnfiltered: vi.fn(),
        cancelFieldStream: valuesMock.cancelFieldStream,
        cancelAllFieldStreams: vi.fn(),
        resetFieldValues: (key: string, isLoading = false) => {
          fieldValues.value[key] = { values: [], isLoading, hasMore: false, errMsg: "" };
        },
      };
    },
  };
});

const STREAM_RESULTS = [
  { name: "app_logs", stream_type: "logs" },
  { name: "error_logs", stream_type: "logs" },
];

const RANGE = { start_time: 1_000_000, end_time: 2_000_000 };

interface TestFilter {
  filterType: string;
  logicalOperator: string;
  conditions: Record<string, unknown>[];
}

interface TestFields {
  stream_type: string;
  stream: string;
  filter?: TestFilter;
  [slot: string]: unknown;
}

const makePanelData = () =>
  reactive({
    data: {
      type: "bar",
      queryType: "sql",
      queries: [
        {
          fields: {
            stream_type: "logs",
            stream: "app_logs",
            x: [],
            y: [],
            filter: { filterType: "group", logicalOperator: "AND", conditions: [] },
          } as TestFields,
          joins: [] as unknown[],
          customQuery: false,
          query: "",
        },
      ],
    },
    layout: { currentQueryIndex: 0, showFieldList: true },
    meta: {
      stream: {
        streamResults: [...STREAM_RESULTS] as Record<string, unknown>[],
        streamResultsType: "logs",
        filterField: "",
        customQueryFields: [] as { name: string; type: string }[],
        vrlFunctionFieldList: [] as { name: string; type: string }[],
      },
      streamFields: { groupedFields: [] as Record<string, unknown>[] },
      dragAndDrop: { dragging: false, dragElement: null, dragSource: null, dragSourceIndex: null },
    },
  });

const makeMock = () => ({
  dashboardPanelData: makePanelData(),
  addXAxisItem: vi.fn(),
  addYAxisItem: vi.fn(),
  addZAxisItem: vi.fn(),
  addBreakDownAxisItem: vi.fn(),
  addFilteredItem: vi.fn(),
  addLatitude: vi.fn(),
  addLongitude: vi.fn(),
  addWeight: vi.fn(),
  addMapName: vi.fn(),
  addMapValue: vi.fn(),
  addSource: vi.fn(),
  addTarget: vi.fn(),
  addValue: vi.fn(),
  isAddXAxisNotAllowed: computed(() => false),
  isAddYAxisNotAllowed: computed(() => false),
  isAddZAxisNotAllowed: computed(() => false),
  isAddBreakdownNotAllowed: computed(() => false),
  unsupportedAxes: computed(() => ({ x: false, y: false, z: false, breakdown: false })),
  promqlMode: computed(() => false),
  cleanupDraggingFields: vi.fn(),
  updateGroupedFields: vi.fn(() => Promise.resolve()),
  fetchPromQLLabels: vi.fn(),
  getFilterValuesTimeRange: vi.fn(() => RANGE),
});

let mockReturn = makeMock();

vi.mock("@/composables/dashboard/useDashboardPanel", () => ({
  default: vi.fn(() => mockReturn),
}));

const mockGetStreams = vi.fn();
vi.mock("@/composables/useStreams", () => ({
  default: () => ({ getStreams: mockGetStreams, getStream: vi.fn().mockResolvedValue({}) }),
}));

vi.mock("@/composables/useNotifications", () => ({
  default: () => ({ showErrorNotification: vi.fn() }),
}));

vi.mock("@/composables/usePromqlSuggestions", () => ({
  default: () => ({ parsePromQlQuery: vi.fn().mockReturnValue({ metricName: null }) }),
}));

import useDashboardFieldSource, { type DashboardFieldSource } from "./useDashboardFieldSource";
import { buildDashboardChips } from "./dashboard/dashboardFieldChips";
import {
  buildDashboardFieldRows,
  FUNCTION_FIELDS_GROUP,
  QUERY_FIELDS_GROUP,
} from "./dashboard/dashboardFieldRows";
import DashboardFieldPanel from "@/components/dashboards/addPanel/DashboardFieldPanel.vue";
import { buildCondition } from "@/utils/dashboard/dashboardAutoQueryBuilder";

const panel = () => mockReturn.dashboardPanelData;
const query = () => panel().data.queries[0];
const fields = () => query().fields;

const APP_SCHEMA = [
  { name: "_timestamp", type: "Int64" },
  { name: "level", type: "Utf8" },
  { name: "status", type: "Int64" },
];

const withGroups = (...groups: Record<string, unknown>[]) => {
  panel().meta.streamFields.groupedFields = groups;
};

const appGroup = (extra: Record<string, unknown> = {}) => ({
  name: "app_logs",
  schema: APP_SCHEMA,
  settings: {},
  ...extra,
});

const translate = ((key: string) => key) as unknown as Parameters<typeof buildDashboardChips>[2];

const baseContext = (overrides: Partial<ChipContext> = {}): ChipContext => ({
  chartType: "bar",
  pageKey: "dashboard",
  promql: false,
  customQuery: false,
  filledSlots: new Set(),
  notAllowed: { x: false, y: false, z: false, breakdown: false },
  unsupported: { x: false, y: false, z: false, breakdown: false },
  ...overrides,
});

const STREAM_ROW = { group: "stream::app_logs" };
const QUERY_ROW = { group: QUERY_FIELDS_GROUP };
const FUNCTION_ROW = { group: FUNCTION_FIELDS_GROUP };

const chipIds = (ctx: ChipContext, row: { group?: string } = STREAM_ROW) =>
  buildDashboardChips(ctx, row, translate).map((chip) =>
    chip.testId.replace(/^dashboard-add-|-data$/g, ""),
  );

const mounted: VueWrapper[] = [];

function mountSource(pageKey = "dashboard", editMode = false) {
  let source!: DashboardFieldSource;
  const Host = defineComponent({
    setup() {
      source = useDashboardFieldSource({ pageKey, editMode });
      return () => h("div");
    },
  });
  mounted.push(mount(Host, { global: { plugins: [i18n, store] } }));
  return () => source;
}

function mountPanel(pageKey = "dashboard", props: Record<string, unknown> = {}) {
  const wrapper = mount(DashboardFieldPanel, {
    props,
    global: { plugins: [i18n, store], provide: { dashboardPanelDataPageKey: pageKey } },
  });
  mounted.push(wrapper);
  return wrapper;
}

const rowsOf = (source: DashboardFieldSource) => source.fields.value as DashboardFieldRow[];
const rowNamed = (source: DashboardFieldSource, name: string, group?: string) =>
  rowsOf(source).find(
    (row) => !row.isGroup && row.name === name && (!group || row.group === group),
  )!;

beforeEach(() => {
  vi.clearAllMocks();
  mockReturn = makeMock();
  mockGetStreams.mockResolvedValue({ list: STREAM_RESULTS });
  store.state.selectedOrganization = {
    identifier: "test-org",
  } as typeof store.state.selectedOrganization;
  store.state.zoConfig.user_defined_schemas_enabled = true;
});

afterEach(() => {
  mounted.splice(0).forEach((wrapper) => wrapper.unmount());
  localStorage.clear();
});

describe("chip matrix", () => {
  it.each([
    "area",
    "bar",
    "line",
    "h-stacked",
    "scatter",
    "area-stacked",
    "stacked",
    "state-timeline",
    "distribution",
    "treemap",
    "sunburst",
    "hostmap",
  ])("%s offers +X +Y +B +F", (chartType) => {
    expect(chipIds(baseContext({ chartType }))).toEqual(["x", "y", "b", "filter"]);
  });

  it("table offers +X +Y +P +F", () => {
    expect(chipIds(baseContext({ chartType: "table" }))).toEqual(["x", "y", "p", "filter"]);
  });

  it("heatmap offers +X +Y +Z +F", () => {
    expect(chipIds(baseContext({ chartType: "heatmap" }))).toEqual(["x", "y", "z", "filter"]);
  });

  it.each(["pie", "donut", "gauge", "bar-gauge", "metric", "funnel", "boxplot"])(
    "%s offers +X +Y +F",
    (chartType) => {
      expect(chipIds(baseContext({ chartType }))).toEqual(["x", "y", "filter"]);
    },
  );

  it("h-bar swaps the labels of the first two chips, not what they call", () => {
    const chips = buildDashboardChips(baseContext({ chartType: "h-bar" }), "level", translate);
    expect(chips.map((chip) => [chip.label, chip.target])).toEqual([
      ["+Y", "x"],
      ["+X", "y"],
      ["panel.addBreakdownShort", "breakdown"],
      ["panel.addFilterShort", "filter"],
    ]);
  });

  it("geomap offers +Lat +Lng +W +F", () => {
    expect(chipIds(baseContext({ chartType: "geomap" }))).toEqual([
      "latitude",
      "longitude",
      "weight",
      "filter",
    ]);
  });

  it("maps offers +N +V +F on the x / y ids", () => {
    const chips = buildDashboardChips(baseContext({ chartType: "maps" }), "level", translate);
    expect(chips.map((chip) => [chip.testId, chip.target])).toEqual([
      ["dashboard-add-x-data", "name"],
      ["dashboard-add-y-data", "value_for_maps"],
      ["dashboard-add-filter-data", "filter"],
    ]);
  });

  it.each(["sankey", "node-graph"])("%s offers +S +T +V +F", (chartType) => {
    expect(chipIds(baseContext({ chartType }))).toEqual(["source", "target", "value", "filter"]);
  });

  it.each(["custom_chart", "alert-list", "flame-graph", "logs"])(
    "%s offers no chip",
    (chartType) => {
      expect(chipIds(baseContext({ chartType }))).toEqual([]);
    },
  );

  it("hides every chip in PromQL mode and on the logs Visualize page", () => {
    expect(chipIds(baseContext({ promql: true }))).toEqual([]);
    expect(chipIds(baseContext({ pageKey: "logs" }))).toEqual([]);
  });

  it("custom SQL keeps chips for query and function fields only, without +F", () => {
    const ctx = baseContext({ customQuery: true });
    expect(chipIds(ctx, STREAM_ROW)).toEqual([]);
    expect(chipIds(ctx, QUERY_ROW)).toEqual(["x", "y", "b"]);
    expect(chipIds(ctx, FUNCTION_ROW)).toEqual(["x", "y", "b"]);
  });

  it("maps keeps +F in custom SQL", () => {
    const ctx = baseContext({ chartType: "maps", customQuery: true });
    expect(chipIds(ctx, QUERY_ROW)).toEqual(["x", "y", "filter"]);
  });
});

describe("chip limits", () => {
  const disabledOf = (ctx: ChipContext, row: { group?: string } = STREAM_ROW) =>
    Object.fromEntries(
      buildDashboardChips(ctx, row, translate).map((chip) => [chip.testId, chip.disabled]),
    );

  it("disables the axis chips the panel limits refuse", () => {
    const ctx = baseContext({
      chartType: "heatmap",
      notAllowed: { x: true, y: false, z: true, breakdown: false },
    });
    expect(disabledOf(ctx)).toMatchObject({
      "dashboard-add-x-data": true,
      "dashboard-add-y-data": false,
      "dashboard-add-z-data": true,
    });
    expect(
      disabledOf(
        baseContext({
          chartType: "table",
          notAllowed: { x: false, y: false, z: false, breakdown: true },
        }),
      ),
    ).toMatchObject({ "dashboard-add-p-data": true });
  });

  it("disables a single-slot chip once its slot is filled", () => {
    const ctx = baseContext({ chartType: "geomap", filledSlots: new Set(["latitude"]) });
    expect(disabledOf(ctx)).toMatchObject({
      "dashboard-add-latitude-data": true,
      "dashboard-add-longitude-data": false,
    });
    expect(
      disabledOf(baseContext({ chartType: "sankey", filledSlots: new Set(["value"]) })),
    ).toMatchObject({ "dashboard-add-value-data": true, "dashboard-add-source-data": false });
  });

  it("disables +F for a VRL field everywhere but maps", () => {
    expect(disabledOf(baseContext(), FUNCTION_ROW)["dashboard-add-filter-data"]).toBe(true);
    expect(disabledOf(baseContext(), STREAM_ROW)["dashboard-add-filter-data"]).toBe(false);
    expect(
      disabledOf(baseContext({ chartType: "maps" }), FUNCTION_ROW)["dashboard-add-filter-data"],
    ).toBe(false);
  });

  it("names the reason on every disabled chip and on no enabled one", () => {
    const named = ((key: string, values?: Record<string, unknown>) =>
      values ? `${key}(${String(values.target)})` : key) as unknown as typeof translate;
    const reasons = (ctx: ChipContext, row: { group?: string } = STREAM_ROW) =>
      Object.fromEntries(
        buildDashboardChips(ctx, row, named).map((chip) => [chip.testId, chip.reason]),
      );
    expect(
      reasons(
        baseContext({
          chartType: "bar",
          notAllowed: { x: true, y: false, z: false, breakdown: true },
        }),
      ),
    ).toEqual({
      "dashboard-add-x-data": "panel.chipFullReason(panel.xAxisShort)",
      "dashboard-add-y-data": undefined,
      "dashboard-add-b-data": "panel.chipFullReason(panel.breakdown)",
      "dashboard-add-filter-data": undefined,
    });
    expect(
      reasons(
        baseContext({
          chartType: "h-bar",
          notAllowed: { x: true, y: false, z: false, breakdown: false },
        }),
      )["dashboard-add-x-data"],
    ).toBe("panel.chipFullReason(panel.yAxisShort)");
    expect(
      reasons(baseContext({ chartType: "geomap", filledSlots: new Set(["latitude"]) }))[
        "dashboard-add-latitude-data"
      ],
    ).toBe("panel.chipFullReason(panel.latitude)");
    expect(reasons(baseContext(), FUNCTION_ROW)["dashboard-add-filter-data"]).toBe(
      "panel.chipFilterVrlReason",
    );
  });

  it("says an axis the chart type never takes is not used, not full", () => {
    const named = ((key: string, values?: Record<string, unknown>) =>
      values ? `${key}(${String(values.target)})` : key) as unknown as typeof translate;
    const reasonOf = (ctx: ChipContext, testId: string) =>
      buildDashboardChips(ctx, STREAM_ROW, named).find((chip) => chip.testId === testId)?.reason;
    const metric = baseContext({
      chartType: "metric",
      notAllowed: { x: true, y: false, z: false, breakdown: false },
      unsupported: { x: true, y: false, z: false, breakdown: false },
    });
    expect(reasonOf(metric, "dashboard-add-x-data")).toBe(
      "panel.chipUnusedReason(panel.xAxisShort)",
    );
    expect(reasonOf(metric, "dashboard-add-y-data")).toBeUndefined();
    const fullBreakdown = baseContext({
      chartType: "distribution",
      notAllowed: { x: true, y: false, z: false, breakdown: true },
      unsupported: { x: true, y: false, z: false, breakdown: false },
    });
    expect(reasonOf(fullBreakdown, "dashboard-add-b-data")).toBe(
      "panel.chipFullReason(panel.breakdown)",
    );
    expect(reasonOf(fullBreakdown, "dashboard-add-x-data")).toBe(
      "panel.chipUnusedReason(panel.xAxisShort)",
    );
  });

  it("reads the limits and filled slots from the current query", () => {
    mockReturn.isAddYAxisNotAllowed = computed(() => true);
    panel().data.type = "geomap";
    fields().weight = { label: "w" };
    withGroups(appGroup());
    const source = mountSource()();
    const chips = source.chips!(rowNamed(source, "level"));
    expect(chips.find((chip) => chip.target === "weight")?.disabled).toBe(true);
    panel().data.type = "bar";
    expect(
      source.chips!(rowNamed(source, "level")).find((chip) => chip.target === "y")?.disabled,
    ).toBe(true);
  });

  it("reads which axes the chart type never takes from the panel", () => {
    mockReturn.isAddXAxisNotAllowed = computed(() => true);
    mockReturn.unsupportedAxes = computed(() => ({
      x: true,
      y: false,
      z: false,
      breakdown: false,
    }));
    panel().data.type = "metric";
    withGroups(appGroup());
    const source = mountSource()();
    const x = source.chips!(rowNamed(source, "level")).find((chip) => chip.target === "x");
    expect(x?.reason).toBe("X-Axis is not used by this chart");
  });
});

describe("chip intents", () => {
  it.each([
    ["x", "addXAxisItem"],
    ["y", "addYAxisItem"],
    ["breakdown", "addBreakDownAxisItem"],
    ["filter", "addFilteredItem"],
    ["latitude", "addLatitude"],
    ["name", "addMapName"],
    ["value_for_maps", "addMapValue"],
    ["source", "addSource"],
    ["value", "addValue"],
  ] as const)("%s calls %s with the row", (target, fn) => {
    withGroups(appGroup({ stream_alias: "a" }));
    const source = mountSource()();
    const row = rowNamed(source, "level");
    source.chip!(row, target);
    expect(mockReturn[fn]).toHaveBeenCalledWith(row);
    expect(row).toMatchObject({ name: "level", stream: "app_logs", streamAlias: "a" });
  });

  it("an h-bar +Y chip in the panel calls addXAxisItem", async () => {
    panel().data.type = "h-bar";
    withGroups(appGroup());
    const wrapper = mountPanel();
    await flushPromises();
    const chip = wrapper.findAll('[data-test="dashboard-add-x-data"]')[0];
    expect(chip.text()).toBe("+Y");
    await chip.trigger("click");
    expect(mockReturn.addXAxisItem).toHaveBeenCalledWith(
      expect.objectContaining({ name: "_timestamp" }),
    );
  });
});

describe("drag", () => {
  const dragState = (setup: () => void, pageKey = "dashboard") => {
    setup();
    panel().meta.stream.customQueryFields = [{ name: "cnt", type: "Int64" }];
    withGroups(appGroup());
    const source = mountSource(pageKey)();
    return {
      capability: source.capabilities.value.drag,
      schemaRow: source.dragEnabled!(rowNamed(source, "level")),
      queryRow: source.dragEnabled!(rowNamed(source, "cnt")),
    };
  };

  it("drags every row in builder mode", () => {
    expect(dragState(() => {})).toEqual({ capability: true, schemaRow: true, queryRow: true });
  });

  it("keeps a schema row inert in custom SQL when a query field shares its name (F1)", () => {
    query().customQuery = true;
    panel().meta.stream.customQueryFields = [{ name: "level", type: "Utf8" }];
    panel().meta.stream.vrlFunctionFieldList = [{ name: "status", type: "Int64" }];
    withGroups(appGroup());
    const source = mountSource()();
    const schemaLevel = rowNamed(source, "level", "stream::app_logs");
    const queryLevel = rowNamed(source, "level", QUERY_FIELDS_GROUP);
    expect(source.dragEnabled!(schemaLevel)).toBe(false);
    expect(source.chips!(schemaLevel)).toEqual([]);
    expect(source.dragEnabled!(queryLevel)).toBe(true);
    expect(source.chips!(queryLevel).length).toBeGreaterThan(0);
  });

  it("leaves +F enabled on a schema row that shares a VRL output's name (F1)", () => {
    panel().meta.stream.vrlFunctionFieldList = [{ name: "level", type: "Utf8" }];
    withGroups(appGroup());
    const source = mountSource()();
    const filterOf = (group: string) =>
      source.chips!(rowNamed(source, "level", group)).find((chip) => chip.target === "filter");
    expect(filterOf("stream::app_logs")?.disabled).toBe(false);
    expect(filterOf(FUNCTION_FIELDS_GROUP)?.disabled).toBe(true);
  });

  it("does not drag in PromQL mode", () => {
    expect(dragState(() => (mockReturn.promqlMode = computed(() => true))).capability).toBe(false);
  });

  it("drags only query and function fields in custom SQL", () => {
    expect(dragState(() => (query().customQuery = true))).toEqual({
      capability: true,
      schemaRow: false,
      queryRow: true,
    });
  });

  it("does not drag on the logs Visualize page (B22)", () => {
    expect(dragState(() => {}, "logs").capability).toBe(false);
  });

  it("does not drag on a custom chart (B23)", () => {
    expect(dragState(() => (panel().data.type = "custom_chart")).capability).toBe(false);
  });

  it("marks the drag on start and clears it on end", () => {
    withGroups(appGroup());
    const source = mountSource()();
    const row = rowNamed(source, "level");
    source.dragStart!(row, new Event("dragstart") as DragEvent);
    expect(panel().meta.dragAndDrop).toMatchObject({
      dragging: true,
      dragElement: row,
      dragSource: "fieldList",
      dragSourceIndex: null,
    });
    source.dragEnd!(row, new Event("dragend") as DragEvent);
    expect(mockReturn.cleanupDraggingFields).toHaveBeenCalled();
  });

  it("renders the grip with its test id", async () => {
    withGroups(appGroup());
    const wrapper = mountPanel();
    await flushPromises();
    expect(wrapper.findAll('[data-test="o-field-list-drag-indicator"]').length).toBe(
      APP_SCHEMA.length,
    );
  });
});

describe("groups", () => {
  const labels = { queryFields: "Query Fields", functionFields: "Function Fields" };
  const input = {
    queryFields: [] as { name: string; type?: string }[],
    functionFields: [] as { name: string; type?: string }[],
    streamGroups: [] as {
      name: string;
      stream_alias?: string;
      schema: { name: string; type?: string }[];
      settings?: Record<string, string[]>;
    }[],
    timestampColumn: "_timestamp",
    allFieldsName: "_all",
    userDefinedSchemasEnabled: true,
    labels: labels as unknown as Parameters<typeof buildDashboardFieldRows>[0]["labels"],
  };

  it("orders query fields, function fields, then the main stream and each join", () => {
    const rows = buildDashboardFieldRows({
      ...input,
      queryFields: [{ name: "cnt", type: "Int64" }],
      functionFields: [{ name: "vrl_out", type: "Utf8" }],
      streamGroups: [
        { name: "app_logs", schema: [{ name: "status", type: "Int64" }] },
        { name: "app_logs", stream_alias: "b", schema: [{ name: "status", type: "Int64" }] },
      ],
    });
    expect(rows.filter((row) => row.isGroup).map((row) => row.groupName)).toEqual([
      "Query Fields",
      "Function Fields",
      "app_logs",
      "app_logs",
    ]);
    const status = rows.filter((row) => row.name === "status");
    expect(status.map((row) => row.streamAlias)).toEqual([undefined, "b"]);
    expect(new Set(rows.map((row) => row._uid)).size).toBe(rows.length);
  });

  it("gives query and function fields no stream and no values", () => {
    const [, row] = buildDashboardFieldRows({
      ...input,
      queryFields: [{ name: "cnt", type: "Int64" }],
    });
    expect(row).toMatchObject({ name: "cnt", isSchemaField: false, showValues: false });
    expect(row.stream).toBeUndefined();
  });

  it("lists timestamp, defined fields and the all-fields column with the UDS flag on", () => {
    const rows = buildDashboardFieldRows({
      ...input,
      streamGroups: [
        {
          name: "app_logs",
          schema: [
            { name: "a", type: "Utf8" },
            { name: "b", type: "Utf8" },
          ],
          settings: { defined_schema_fields: ["a"] },
        },
      ],
    });
    expect(rows.filter((row) => !row.isGroup).map((row) => [row.name, row.showValues])).toEqual([
      ["_timestamp", false],
      ["a", true],
      ["_all", false],
    ]);
  });

  it("lists the whole schema with the UDS flag off (B21b)", () => {
    const rows = buildDashboardFieldRows({
      ...input,
      userDefinedSchemasEnabled: false,
      streamGroups: [
        {
          name: "app_logs",
          schema: [
            { name: "a", type: "Utf8" },
            { name: "b", type: "Utf8" },
          ],
          settings: { defined_schema_fields: ["a"] },
        },
      ],
    });
    expect(rows.filter((row) => !row.isGroup).map((row) => row.name)).toEqual(["a", "b"]);
  });

  it("marks full-text keys from the stream settings", () => {
    const rows = buildDashboardFieldRows({
      ...input,
      streamGroups: [
        {
          name: "s",
          schema: [{ name: "body", type: "Utf8" }],
          settings: { full_text_search_keys: ["body"] },
        },
      ],
    });
    expect(rows[1].ftsKey).toBe(true);
  });

  it("keeps only headers with a matching child while searching (B20)", async () => {
    panel().meta.stream.customQueryFields = [{ name: "cnt", type: "Int64" }];
    withGroups(appGroup());
    panel().meta.stream.filterField = "lev";
    const wrapper = mountPanel();
    await flushPromises();
    expect(wrapper.find('[data-test="o-field-list-group-app_logs"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="o-field-list-group-Query Fields"]').exists()).toBe(false);
  });

  it("keeps a folded group folded across a remount", () => {
    withGroups(appGroup());
    const first = mountSource()();
    const group = rowNamed(first, "level").group!;
    first.toggleGroup(group);
    mounted.splice(0).forEach((wrapper) => wrapper.unmount());
    const second = mountSource()();
    expect(second.collapsedGroups.value.has(group)).toBe(true);
    // The fold outlives the test too, so it is undone for the specs that follow.
    second.toggleGroup(group);
  });

  it("binds search to the panel's filterField", () => {
    const source = mountSource()();
    source.setSearch("sta");
    expect(panel().meta.stream.filterField).toBe("sta");
    expect(source.search.value).toBe("sta");
  });
});

describe("stream picker", () => {
  const typeSelect = (wrapper: VueWrapper) =>
    wrapper.findComponent('[data-test="index-dropdown-stream_type"]');

  it("offers enrichment tables on the dashboard page", async () => {
    const wrapper = mountPanel("dashboard");
    await flushPromises();
    expect(
      (typeSelect(wrapper).props("options") as { value: string }[]).map((o) => o.value),
    ).toEqual(["logs", "metrics", "traces", "enrichment_tables"]);
  });

  it.each(["build", "logs"])("offers no enrichment tables on the %s page", (pageKey) => {
    const source = mountSource(pageKey)();
    expect(source.picker?.streamTypes?.value).toEqual(["logs", "metrics", "traces"]);
  });

  it("hides the type select on the metrics page", async () => {
    const wrapper = mountPanel("metrics");
    await flushPromises();
    expect(wrapper.find('[data-test="index-dropdown-stream_type"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="index-dropdown-stream"]').exists()).toBe(true);
  });

  it("disables both selects on the logs Visualize page", async () => {
    const wrapper = mountPanel("logs");
    await flushPromises();
    expect(typeSelect(wrapper).props("disabled")).toBe(true);
    expect(wrapper.findComponent('[data-test="index-dropdown-stream"]').props("disabled")).toBe(
      true,
    );
  });

  it("clears the stream when the type changes", () => {
    const source = mountSource()();
    source.changeStreamType("metrics");
    expect(fields()).toMatchObject({ stream: "", stream_type: "metrics" });
  });

  it("writes the picked stream into the query", () => {
    const source = mountSource()();
    source.selectStreams(["error_logs"]);
    expect(fields().stream).toBe("error_logs");
  });

  it("badges a metrics stream with its type initial", () => {
    fields().stream_type = "metrics";
    panel().meta.stream.streamResults = [
      {
        name: "cpu",
        stream_type: "metrics",
        metrics_meta: { metric_type: "Gauge", metric_family_name: "cpu" },
      },
    ];
    const source = mountSource()();
    expect(source.streams.value[0]).toMatchObject({ value: "cpu", badge: "G" });
  });

  it("shows the skeleton while the stream list loads", async () => {
    mockGetStreams.mockReturnValue(new Promise(() => {}));
    const source = mountSource()();
    await flushPromises();
    expect(source.loading.value).toBe(true);
  });

  it("settles to the empty text once loads finish with no fields", async () => {
    const wrapper = mountPanel();
    await flushPromises();
    expect(wrapper.text()).toContain("No fields found");
  });
});

describe("stream list loading", () => {
  it("loads the list for the current type on mount and again on a type change", async () => {
    mountSource();
    await flushPromises();
    expect(mockGetStreams).toHaveBeenCalledWith("logs", false);
    mockGetStreams.mockClear();
    fields().stream_type = "metrics";
    await flushPromises();
    expect(mockGetStreams).toHaveBeenCalledWith("metrics", false);
  });

  it("does not refetch when only the stream changes", async () => {
    mountSource();
    await flushPromises();
    mockGetStreams.mockClear();
    fields().stream = "error_logs";
    await flushPromises();
    expect(mockGetStreams).not.toHaveBeenCalled();
  });

  it("drops a list that lands after the type moved on", async () => {
    let resolveLogs: (value: unknown) => void = () => {};
    mockGetStreams
      .mockImplementationOnce(() => new Promise((resolve) => (resolveLogs = resolve)))
      .mockImplementationOnce(() =>
        Promise.resolve({ list: [{ name: "cpu", stream_type: "metrics" }] }),
      );
    mountSource();
    fields().stream_type = "metrics";
    await flushPromises();
    resolveLogs({ list: STREAM_RESULTS });
    await flushPromises();
    expect(panel().meta.stream.streamResultsType).toBe("metrics");
  });

  it("waits for a stream in edit mode", async () => {
    fields().stream = "";
    mountSource("dashboard", true);
    await flushPromises();
    expect(mockGetStreams).not.toHaveBeenCalled();
    fields().stream = "late";
    await flushPromises();
    fields().stream = "later";
    await flushPromises();
    expect(mockGetStreams).toHaveBeenCalledTimes(1);
  });

  it.each(["metrics", "build"])("loads at once in %s edit mode with no stream", async (pageKey) => {
    fields().stream = "";
    mountSource(pageKey, true);
    await flushPromises();
    expect(mockGetStreams).toHaveBeenCalledTimes(1);
  });

  it("loads at once in edit mode when the stream was seeded before mount", async () => {
    fields().stream = "seeded";
    mountSource("dashboard", true);
    await flushPromises();
    expect(mockGetStreams).toHaveBeenCalledTimes(1);
  });

  it("refetches grouped fields when the stream or joins change", async () => {
    mountSource();
    await flushPromises();
    expect(mockReturn.updateGroupedFields).toHaveBeenCalledTimes(1);
    query().joins = [{ stream: "error_logs", streamAlias: "b" }];
    await flushPromises();
    expect(mockReturn.updateGroupedFields).toHaveBeenCalledTimes(2);
  });
});

describe("auto-pick", () => {
  const mountWithoutStream = async (pageKey: string, editMode = false) => {
    fields().stream = "";
    mountSource(pageKey, editMode);
    await flushPromises();
  };

  it("opens a new dashboard panel on the remembered stream", async () => {
    localStorage.setItem("oo_dashboard_panel_stream_logs_test-org", "error_logs");
    await mountWithoutStream("dashboard");
    expect(fields().stream).toBe("error_logs");
  });

  it("prefers the freshest user stream when nothing is remembered", async () => {
    mockGetStreams.mockResolvedValue({
      list: [
        { name: "_internal", stream_type: "logs", stats: { doc_num: 1, doc_time_max: 9 } },
        { name: "app_logs", stream_type: "logs", stats: { doc_num: 0 } },
        { name: "error_logs", stream_type: "logs", stats: { doc_num: 3, doc_time_max: 5 } },
      ],
    });
    await mountWithoutStream("dashboard");
    expect(fields().stream).toBe("error_logs");
  });

  it.each([
    ["dashboard", true],
    ["build", false],
  ])("takes the first stream on %s (edit %s)", async (pageKey, editMode) => {
    localStorage.setItem("oo_dashboard_panel_stream_logs_test-org", "error_logs");
    await mountWithoutStream(pageKey, editMode);
    panel().meta.stream.streamResults = [...STREAM_RESULTS];
    await flushPromises();
    expect(fields().stream).toBe("app_logs");
  });
});

describe("PromQL stream change", () => {
  const METRICS = ["first_metric", "second_metric"].map((name) => ({
    name,
    stream_type: "metrics",
    metrics_meta: { metric_type: "Counter", metric_family_name: name, help: "", unit: "" },
    stats: { doc_num: 100 },
  }));

  const asPromqlPanel = () => {
    mockReturn.promqlMode = computed(() => true);
    mockGetStreams.mockResolvedValue({ list: METRICS });
    fields().stream_type = "metrics";
    query().customQuery = true;
  };

  it("leaves a hand-written query alone and fetches the new stream's labels", async () => {
    asPromqlPanel();
    mountSource("metrics");
    await flushPromises();
    const written = 'sum(rate(first_metric{code="500"}[1h])) * 60';
    query().query = written;
    fields().stream = "first_metric";
    await flushPromises();
    fields().stream = "second_metric";
    await flushPromises();
    expect(query().query).toBe(written);
    expect(mockReturn.fetchPromQLLabels).toHaveBeenCalledWith("second_metric");
  });

  it("reseeds an empty query", async () => {
    asPromqlPanel();
    mountSource("metrics");
    await flushPromises();
    query().query = "";
    fields().stream = "first_metric";
    await flushPromises();
    fields().stream = "second_metric";
    await flushPromises();
    expect(query().query).toContain("rate(second_metric{}");
  });

  it("does not reseed a dashboard's builder PromQL query", async () => {
    asPromqlPanel();
    query().customQuery = false;
    mountSource("dashboard");
    await flushPromises();
    query().query = "";
    fields().stream = "first_metric";
    await flushPromises();
    fields().stream = "second_metric";
    await flushPromises();
    expect(query().query).toBe("");
    expect(mockReturn.fetchPromQLLabels).not.toHaveBeenCalled();
  });
});

describe("values", () => {
  const STATUS_200 = {
    type: "condition",
    operator: "=",
    value: "200",
    values: [],
    column: { field: "status" },
    filterType: "condition",
    logicalOperator: "AND",
  };

  const openLevel = () => {
    withGroups(appGroup());
    const source = mountSource()();
    const row = rowNamed(source, "level");
    source.openField(row);
    return { source, row };
  };

  const sentSql = () => b64DecodeUnicode(valuesMock.fetchFieldValues.mock.calls.at(-1)![0].sql);

  it("asks for the same page again after a failed load more, through the real values stream (F2)", () => {
    realStream.on = true;
    realStream.sent.length = 0;
    realStream.inFlight.length = 0;
    try {
      const { source, row } = openLevel();
      const first = sentPage().size;
      settleStream(first);
      source.loadMoreValues(row._uid);
      expect(sentPage().size).toBe(first * 2);
      settleStream("fail");
      source.loadMoreValues(row._uid);
      expect(sentPage().size).toBe(first * 2);
      settleStream(first * 2);
      source.loadMoreValues(row._uid);
      expect(sentPage().size).toBe(first * 3);
    } finally {
      realStream.on = false;
    }
  });

  it("keeps an open list on screen, busy, while a filter change refetches it (X3)", async () => {
    realStream.on = true;
    realStream.sent.length = 0;
    realStream.inFlight.length = 0;
    try {
      const { source, row } = openLevel();
      settleStream(3);
      expect(source.fieldValues.value[row._uid].values).toHaveLength(3);
      fields().filter = {
        filterType: "group",
        logicalOperator: "AND",
        conditions: [
          {
            type: "condition",
            operator: "=",
            value: "200",
            values: [],
            column: { field: "status" },
            filterType: "condition",
            logicalOperator: "AND",
          },
        ],
      };
      await nextTick();
      await nextTick();
      expect(realStream.inFlight).toHaveLength(1);
      expect(source.fieldValues.value[row._uid]).toMatchObject({ isLoading: true });
      expect(source.fieldValues.value[row._uid].values).toHaveLength(3);
      settleStream(5);
      expect(source.fieldValues.value[row._uid]).toMatchObject({ isLoading: false });
      expect(source.fieldValues.value[row._uid].values).toHaveLength(5);
    } finally {
      realStream.on = false;
    }
  });

  it("asks the stream for the field's values over the panel's range, keyed by row", () => {
    const { row } = openLevel();
    expect(valuesMock.fetchFieldValues).toHaveBeenCalledWith(
      expect.objectContaining({
        fields: ["level"],
        stream_name: "app_logs",
        stream_type: "logs",
        start_time: RANGE.start_time,
        end_time: RANGE.end_time,
        size: 10,
      }),
      row._uid,
    );
    expect(sentSql()).toBe('SELECT * FROM "app_logs"');
  });

  it("scopes the values by the builder filter minus the field's own conditions and variables", () => {
    fields().filter = {
      filterType: "group",
      logicalOperator: "AND",
      conditions: [
        {
          type: "list",
          values: ["error"],
          column: { field: "level" },
          filterType: "condition",
          logicalOperator: "AND",
          operator: null,
          value: null,
        },
        {
          type: "condition",
          operator: "=",
          value: "200",
          values: [],
          column: { field: "status" },
          filterType: "condition",
          logicalOperator: "AND",
        },
        {
          type: "condition",
          operator: "=",
          value: "$env",
          values: [],
          column: { field: "env" },
          filterType: "condition",
          logicalOperator: "AND",
        },
      ],
    };
    openLevel();
    expect(sentSql()).toBe('SELECT * FROM "app_logs" WHERE (status = 200)');
  });

  it("ignores the builder filter once the query joins another stream", () => {
    fields().filter = {
      filterType: "group",
      logicalOperator: "AND",
      conditions: [
        {
          type: "condition",
          operator: "=",
          value: "200",
          values: [],
          column: { field: "status" },
          filterType: "condition",
          logicalOperator: "AND",
        },
      ],
    };
    query().joins = [{ stream: "error_logs", streamAlias: "b" }];
    openLevel();
    expect(sentSql()).toBe('SELECT * FROM "app_logs"');
  });

  it("settles empty without a request before the panel has a range", () => {
    mockReturn.getFilterValuesTimeRange = vi.fn(
      () => null,
    ) as unknown as typeof mockReturn.getFilterValuesTimeRange;
    const { source, row } = openLevel();
    expect(valuesMock.fetchFieldValues).not.toHaveBeenCalled();
    expect(source.fieldValues.value[row._uid]).toMatchObject({ isLoading: false, values: [] });
  });

  it("include writes a list condition with the picked values", () => {
    const { source, row } = openLevel();
    source.addValueFilters(row._uid, ["error", "warn"], []);
    expect(fields().filter!.conditions).toEqual([
      expect.objectContaining({
        type: "list",
        values: ["error", "warn"],
        column: { field: "level", streamAlias: undefined },
      }),
    ]);
    expect(source.activeIncludeValues.value[row._uid]).toEqual(["error", "warn"]);
  });

  it("writes included and excluded values side by side, each keeping its operator (U6)", () => {
    const { source, row } = openLevel();
    source.addValueFilters(row._uid, ["error"], []);
    source.addValueFilters(row._uid, ["error"], ["debug", "info"]);
    expect(fields().filter!.conditions).toEqual([
      expect.objectContaining({ type: "list", values: ["error"], logicalOperator: "AND" }),
      expect.objectContaining({
        type: "condition",
        operator: "NOT IN",
        value: "debug,info",
        logicalOperator: "AND",
      }),
    ]);
    expect(source.activeIncludeValues.value[row._uid]).toEqual(["error"]);
    expect(source.activeExcludeValues.value[row._uid]).toEqual(["debug", "info"]);
    source.addValueFilters(row._uid, [], ["debug"]);
    expect(fields().filter!.conditions).toEqual([
      expect.objectContaining({ operator: "NOT IN", value: "debug" }),
    ]);
  });

  it("exclude replaces it with a NOT IN condition in the same place", () => {
    const { source, row } = openLevel();
    fields().filter!.conditions.push({
      type: "condition",
      operator: ">",
      value: "1",
      values: [],
      column: { field: "status" },
      filterType: "condition",
      logicalOperator: "AND",
    });
    source.addValueFilters(row._uid, ["error"], []);
    (fields().filter!.conditions as { logicalOperator: string }[])[1].logicalOperator = "OR";
    source.addValueFilters(row._uid, [], ["debug", "a,b"]);
    const conditions = fields().filter!.conditions as Record<string, unknown>[];
    expect(conditions).toHaveLength(2);
    expect(conditions[1]).toMatchObject({
      type: "condition",
      operator: "NOT IN",
      value: "debug,'a,b'",
      logicalOperator: "OR",
    });
    expect(source.activeExcludeValues.value[row._uid]).toEqual(["debug", "a,b"]);
  });

  it("unchecking every value removes only the field's value condition", () => {
    const { source, row } = openLevel();
    fields().filter!.conditions.push({
      type: "condition",
      operator: "=",
      value: "x",
      values: [],
      column: { field: "level" },
      filterType: "condition",
      logicalOperator: "AND",
    });
    source.addValueFilters(row._uid, ["error"], []);
    source.removeFieldFilter(row._uid);
    expect(fields().filter!.conditions).toEqual([
      expect.objectContaining({ operator: "=", value: "x" }),
    ]);
  });

  it("writes a picked null as Is Null, alone or ORed with other values in a group, and reads it back as checked", () => {
    const { source, row } = openLevel();
    source.addValueFilters(row._uid, ["null"], []);
    expect(fields().filter!.conditions).toEqual([
      expect.objectContaining({ type: "condition", operator: "Is Null", logicalOperator: "AND" }),
    ]);
    expect(source.activeIncludeValues.value[row._uid]).toEqual(["null"]);
    source.addValueFilters(row._uid, ["null", "error"], []);
    expect(fields().filter!.conditions).toEqual([
      {
        filterType: "group",
        logicalOperator: "AND",
        conditions: [
          expect.objectContaining({ type: "list", values: ["error"] }),
          expect.objectContaining({ operator: "Is Null", logicalOperator: "OR" }),
        ],
      },
    ]);
    expect(source.activeIncludeValues.value[row._uid]).toEqual(["error", "null"]);
    expect(buildCondition(fields().filter, panel())).toBe(
      "((level IN ('error') OR level IS NULL))",
    );
    source.addValueFilters(row._uid, ["error"], []);
    expect(fields().filter!.conditions).toEqual([
      expect.objectContaining({ type: "list", values: ["error"] }),
    ]);
  });

  it("clears a mixed null pick as one group, leaving no empty group (F8)", () => {
    const { source, row } = openLevel();
    fields().filter!.conditions.push(STATUS_200);
    source.addValueFilters(row._uid, ["error", "null"], ["debug"]);
    expect(fields().filter!.conditions).toHaveLength(3);
    source.removeFieldFilter(row._uid);
    expect(fields().filter!.conditions).toEqual([STATUS_200]);
    expect(source.activeIncludeValues.value[row._uid]).toBeUndefined();
    expect(source.activeExcludeValues.value[row._uid]).toBeUndefined();
  });

  it("drops a user group the clear leaves empty at any depth, and keeps one that still holds a condition (F8)", () => {
    const mixed = () => ({
      filterType: "group",
      logicalOperator: "AND",
      conditions: [
        { ...LEVEL_IN, column: { field: "level" }, logicalOperator: "AND" },
        {
          type: "condition",
          operator: "Is Null",
          value: null,
          values: [],
          column: { field: "level" },
          filterType: "condition",
          logicalOperator: "OR",
        },
      ],
    });
    fields().filter!.conditions.push(
      {
        filterType: "group",
        logicalOperator: "AND",
        conditions: [{ filterType: "group", logicalOperator: "OR", conditions: [mixed()] }],
      },
      { filterType: "group", logicalOperator: "OR", conditions: [STATUS_200, mixed()] },
    );
    const { source, row } = openLevel();
    expect(source.activeIncludeValues.value[row._uid]).toEqual(["error", "null", "error", "null"]);
    source.removeFieldFilter(row._uid);
    expect(fields().filter!.conditions).toEqual([
      { filterType: "group", logicalOperator: "OR", conditions: [STATUS_200] },
    ]);
  });

  it("replaces a mixed null group in place and drops its duplicate elsewhere without leaving an empty group (F8)", () => {
    const { source, row } = openLevel();
    source.addValueFilters(row._uid, ["error", "null"], []);
    fields().filter!.conditions.push({
      filterType: "group",
      logicalOperator: "AND",
      conditions: [{ ...LEVEL_IN, column: { field: "level" }, logicalOperator: "AND" }],
    });
    source.addValueFilters(row._uid, ["warn"], []);
    expect(fields().filter!.conditions).toEqual([
      expect.objectContaining({ type: "list", values: ["warn"] }),
    ]);
  });

  it("writes an excluded null as Is Not Null next to the NOT IN, and clears both", () => {
    const { source, row } = openLevel();
    fields().filter!.conditions.push(STATUS_200);
    source.addValueFilters(row._uid, [], ["debug", "null"]);
    expect(fields().filter!.conditions).toEqual([
      STATUS_200,
      expect.objectContaining({ operator: "NOT IN", value: "debug" }),
      expect.objectContaining({ operator: "Is Not Null", logicalOperator: "AND" }),
    ]);
    expect(source.activeExcludeValues.value[row._uid]).toEqual(["debug", "null"]);
    source.removeFieldFilter(row._uid);
    expect(fields().filter!.conditions).toEqual([STATUS_200]);
  });

  const nestedLevel = (leaf: Record<string, unknown>) => ({
    filterType: "group",
    logicalOperator: "OR",
    conditions: [STATUS_200, { ...leaf, column: { field: "level" }, logicalOperator: "OR" }],
  });
  const LEVEL_IN = {
    type: "list",
    values: ["error"],
    filterType: "condition",
    operator: null,
    value: null,
  };

  it("reads checked values from a nested group (round 2 F1)", () => {
    fields().filter!.conditions.push(nestedLevel(LEVEL_IN));
    const { source, row } = openLevel();
    expect(source.activeIncludeValues.value[row._uid]).toEqual(["error"]);
  });

  it("replaces a nested value leaf in its own group instead of adding a root one (round 2 F1)", () => {
    fields().filter!.conditions.push(nestedLevel(LEVEL_IN));
    const { source, row } = openLevel();
    source.addValueFilters(row._uid, [], ["warn"]);
    const root = fields().filter!.conditions;
    expect(root).toHaveLength(1);
    const group = root[0] as { logicalOperator: string; conditions: Record<string, unknown>[] };
    expect(group.logicalOperator).toBe("OR");
    expect(group.conditions).toEqual([
      STATUS_200,
      expect.objectContaining({ operator: "NOT IN", value: "warn", logicalOperator: "OR" }),
    ]);
    expect(source.activeExcludeValues.value[row._uid]).toEqual(["warn"]);
  });

  it("drops a duplicate value leaf at another depth when replacing (round 2 F1)", () => {
    fields().filter!.conditions.push(
      { ...LEVEL_IN, column: { field: "level" }, logicalOperator: "AND" },
      nestedLevel(LEVEL_IN),
    );
    const { source, row } = openLevel();
    source.addValueFilters(row._uid, ["warn"], []);
    expect(source.activeIncludeValues.value[row._uid]).toEqual(["warn"]);
    expect((fields().filter!.conditions[1] as { conditions: unknown[] }).conditions).toEqual([
      STATUS_200,
    ]);
  });

  it("clears a nested value leaf and keeps the group (round 2 F1)", () => {
    fields().filter!.conditions.push(nestedLevel(LEVEL_IN));
    const { source, row } = openLevel();
    source.removeFieldFilter(row._uid);
    expect(fields().filter!.conditions).toEqual([
      expect.objectContaining({ filterType: "group", conditions: [STATUS_200] }),
    ]);
    expect(source.activeIncludeValues.value[row._uid]).toBeUndefined();
  });

  it("keeps two same-named join fields apart", () => {
    withGroups(appGroup(), {
      name: "error_logs",
      stream_alias: "b",
      schema: APP_SCHEMA,
      settings: {},
    });
    const source = mountSource()();
    const joined = rowsOf(source).filter((row) => row.name === "level");
    source.openField(joined[1]);
    expect(source.expandedFields.value).toEqual([joined[1]._uid]);
    source.addValueFilters(joined[1]._uid, ["x"], []);
    expect(source.activeIncludeValues.value).toEqual({ [joined[1]._uid]: ["x"] });
  });

  it("offers value filters only where a builder filter exists", () => {
    expect(mountSource()().capabilities.value.valueFilters).toBe(true);
    expect(mountSource("logs")().capabilities.value.valueFilters).toBe(false);
    query().customQuery = true;
    expect(mountSource()().capabilities.value.valueFilters).toBe(false);
  });

  it("fetches an open field again without the builder filter once a join is added (F2)", async () => {
    fields().filter!.conditions.push(STATUS_200);
    openLevel();
    expect(sentSql()).toBe('SELECT * FROM "app_logs" WHERE (status = 200)');
    query().joins = [{ stream: "error_logs", streamAlias: "b" }];
    await flushPromises();
    expect(valuesMock.fetchFieldValues).toHaveBeenCalledTimes(2);
    expect(sentSql()).toBe('SELECT * FROM "app_logs"');
  });

  it("fetches an open field again when the builder filter or stream type changes (F2)", async () => {
    openLevel();
    fields().filter!.conditions.push(STATUS_200);
    await flushPromises();
    expect(sentSql()).toBe('SELECT * FROM "app_logs" WHERE (status = 200)');
    fields().stream_type = "traces";
    await flushPromises();
    expect(valuesMock.fetchFieldValues.mock.calls.at(-1)![0].stream_type).toBe("traces");
    expect(valuesMock.fetchFieldValues).toHaveBeenCalledTimes(3);
  });

  it("fetches an open field again over a new range, and not when nothing it reads changed (F2)", async () => {
    const range = reactive({ value: RANGE });
    mockReturn.getFilterValuesTimeRange = vi.fn(
      () => range.value,
    ) as unknown as typeof mockReturn.getFilterValuesTimeRange;
    const { source, row } = openLevel();
    source.addValueFilters(row._uid, ["error"], []);
    await flushPromises();
    expect(valuesMock.fetchFieldValues).toHaveBeenCalledTimes(1);
    range.value = { start_time: 5, end_time: 6 };
    await flushPromises();
    expect(valuesMock.fetchFieldValues).toHaveBeenCalledTimes(2);
    expect(valuesMock.fetchFieldValues.mock.calls.at(-1)![0]).toMatchObject({
      start_time: 5,
      end_time: 6,
    });
  });

  it("closes an open field whose row left the list", async () => {
    const { source, row } = openLevel();
    withGroups();
    await flushPromises();
    expect(source.expandedFields.value).not.toContain(row._uid);
  });
});

describe("panel host", () => {
  it("keeps the dashboard ids and the collapse button", async () => {
    withGroups(appGroup());
    const wrapper = mountPanel();
    await flushPromises();
    expect(wrapper.find('[data-test="index-dropdown-stream"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="index-dropdown-stream_type"]').exists()).toBe(true);
    await wrapper.find('[data-test="panel-field-list-collapse-btn"]').trigger("click");
    expect(wrapper.emitted("collapse")).toHaveLength(1);
  });

  it("drops the title row when frameless", async () => {
    const wrapper = mountPanel("dashboard", { frameless: true });
    await flushPromises();
    expect(wrapper.find('[data-test="panel-field-list-collapse-btn"]').exists()).toBe(false);
  });

  it("pages at 50 rows", async () => {
    withGroups(
      appGroup({ schema: Array.from({ length: 60 }, (_, i) => ({ name: `f${i}`, type: "Utf8" })) }),
    );
    const wrapper = mountPanel();
    await flushPromises();
    expect(wrapper.findAll('[data-test^="o-field-list-row-"]')).toHaveLength(50);
    expect(
      wrapper.find('[data-test="dashboard-panel-fields-list-pagination-page-2-button"]').exists(),
    ).toBe(true);
  });
});

const settleStream = (count: number | "fail") => {
  realStream.inFlight.splice(0).forEach(({ payload, handlers }) => {
    if (count === "fail") {
      handlers.error(payload, new Error("boom"));
      return;
    }
    const values = Array.from({ length: count }, (_, i) => ({
      zo_sql_key: `v${i}`,
      zo_sql_num: 100 - i,
    }));
    handlers.data(payload, {
      type: "search_response_hits",
      content: { results: { hits: [{ values }] } },
    });
    handlers.complete(payload, payload.traceId);
  });
};
const sentPage = () => {
  const { size, from } = realStream.sent.at(-1) as { size: number; from?: number };
  return { size, from };
};

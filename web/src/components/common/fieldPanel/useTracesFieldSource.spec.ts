// Copyright 2026 OpenObserve Inc.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, nextTick, reactive } from "vue";
import { createStore } from "vuex";
import { Parser } from "@openobserve/node-sql-parser/build/datafusionsql";
import { b64DecodeUnicode } from "@/utils/zincutils";

const awsConfig = vi.hoisted(() => ({ isEnterprise: "false", isCloud: "false" }));
vi.mock("@/aws-exports", () => ({ default: awsConfig }));

const correlation = vi.hoisted(() => ({
  keyFieldsByOrg: {} as Record<string, Promise<Record<string, unknown>>>,
}));
const toastMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/feedback/Toast/useToast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/feedback/Toast/useToast")>()),
  toast: toastMock,
}));
// Reads the org through the real vuex injection, like the actual composable, so the adapter
// must create it in setup; a watcher-created instance has no store and rejects.
vi.mock("@/composables/useServiceCorrelation", async () => {
  const { useStore } = await import("vuex");
  return {
    useServiceCorrelation: () => {
      const store = useStore();
      const org = () => store.state.selectedOrganization.identifier as string;
      return {
        loadSemanticGroups: vi.fn(async () => []),
        loadKeyFields: vi.fn(() => correlation.keyFieldsByOrg[org()]),
        loadFieldGrouping: vi.fn(async () => ({})),
      };
    },
  };
});

const valuesMock = vi.hoisted(() => ({
  fetchFieldValues: vi.fn(),
  cancelFieldStream: vi.fn(),
  cancelAllFieldStreams: vi.fn(),
  resetFieldValues: vi.fn(),
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
        cancelAllFieldStreams: valuesMock.cancelAllFieldStreams,
        resetFieldValues: (name: string, isLoading = false) => {
          valuesMock.resetFieldValues(name, isLoading);
          fieldValues.value[name] = { values: [], isLoading, hasMore: false, errMsg: "" };
        },
      };
    },
  };
});

const parser = vi.hoisted(() => ({ instance: null as unknown }));
vi.mock("@/composables/useLogs/logsUtils", () => ({
  logsUtils: () => ({
    fnParsedSQL: (query: string) => {
      try {
        return (parser.instance as { astify: (q: string) => unknown }).astify(query);
      } catch {
        return { where: null };
      }
    },
  }),
}));

const traces = vi.hoisted(() => ({
  searchObj: null as unknown,
  updatedLocalLogFilterField: vi.fn(),
}));
vi.mock("@/composables/useTraces", () => ({
  default: () => ({
    searchObj: traces.searchObj,
    updatedLocalLogFilterField: traces.updatedLocalLogFilterField,
    tracesParser: { value: parser.instance },
  }),
  DEFAULT_TRACE_COLUMNS: {
    spans: ["service_name", "operation_name", "duration", "span_status"],
    traces: ["service_name", "operation_name", "duration", "spans", "status", "service_latency"],
  },
}));

import useTracesFieldSource, {
  buildTracesFieldList,
  buildTracesValueFilter,
  mapSpanKindValues,
  TRACES_LOCKED_FIELD_NAMES,
  type TracesFieldSource,
} from "./useTracesFieldSource";
import DurationPercentilesBody from "./DurationPercentilesBody.vue";
import StreamFieldPanel from "./StreamFieldPanel.vue";
import { applyFilterTerm } from "@/utils/traces/filterUtils";
import { MISSING_VALUE_KEY } from "./valueFilterExpression";
import type { FieldPanelCapabilities, PanelField } from "./fieldPanel.types";

const SCHEMA = [
  { name: "_timestamp", type: "Int64" },
  { name: "zebra", type: "Utf8" },
  { name: "service_name", type: "Utf8" },
  { name: "duration", type: "Int64" },
  { name: "_start_time_ns", type: "Int64" },
  { name: "end_time", type: "Int64" },
  { name: "span_kind", type: "Utf8" },
  { name: "body", type: "Utf8" },
  { name: "k8s_pod", type: "Utf8" },
  { name: "k8s_ns", type: "Utf8" },
  { name: "_end_time_ns", type: "Int64" },
];

const FTS_KEYS = new Set(["body"]);

const store = createStore({
  state: {
    selectedOrganization: { identifier: "org" },
    zoConfig: {
      timestamp_column: "_timestamp",
      query_values_default_num: 10,
      show_fts_field_values: false,
    },
  },
});

interface SearchObj {
  loadingStream: boolean;
  meta: {
    loadingFields: boolean;
    searchMode: string;
    sqlMode: boolean;
    scope: string;
    groupBy: string;
  };
  data: {
    editorValue: string;
    datetime: { startTime: number; endTime: number };
    stream: {
      streamLists: { label: string; value: string }[];
      selectedStream: { label: string; value: string };
      selectedStreamFields: PanelField[];
      selectedFields: string[];
      filterField: string;
      addToFilter: string;
      removeFilterField: string;
      userDefinedSchema: string[];
      hasParentColumn: boolean;
      sqlFieldFilter: { field: string; values: string[]; exclude: boolean } | null;
      sqlFieldConditions: Record<string, { text: string; values: string[]; exclude: boolean }>;
    };
  };
}

interface Harness {
  wrapper: VueWrapper;
  source: TracesFieldSource;
  searchObj: SearchObj;
  onStreamChangeRequest: ReturnType<typeof vi.fn>;
  onColumnsChange: ReturnType<typeof vi.fn>;
  onGroupByChange: ReturnType<typeof vi.fn>;
}

const makeSearchObj = (): SearchObj =>
  reactive({
    loadingStream: false,
    meta: { loadingFields: false, searchMode: "traces", sqlMode: false, scope: "all", groupBy: "" },
    data: {
      editorValue: "",
      datetime: { startTime: 100, endTime: 200 },
      stream: {
        streamLists: [
          { label: "default", value: "default" },
          { label: "other", value: "other" },
        ],
        selectedStream: { label: "default", value: "default" },
        selectedStreamFields: buildTracesFieldList(SCHEMA, FTS_KEYS, "_timestamp"),
        selectedFields: ["service_name", "operation_name", "duration", "spans", "status"],
        filterField: "",
        addToFilter: "",
        removeFilterField: "",
        userDefinedSchema: [],
        hasParentColumn: false,
        sqlFieldFilter: null,
        sqlFieldConditions: {},
      },
    },
  });

function mountSource(): Harness {
  const searchObj = makeSearchObj();
  traces.searchObj = searchObj;
  const onStreamChangeRequest = vi.fn();
  const onColumnsChange = vi.fn();
  const onGroupByChange = vi.fn();
  let source!: TracesFieldSource;
  const Host = defineComponent({
    setup() {
      source = useTracesFieldSource({ onStreamChangeRequest, onColumnsChange, onGroupByChange });
      return () => h("div");
    },
  });
  const wrapper = mount(Host, { global: { plugins: [store] } });
  return { wrapper, source, searchObj, onStreamChangeRequest, onColumnsChange, onGroupByChange };
}

const fieldByName = (source: TracesFieldSource, name: string) =>
  source.fields.value.find((row) => !row.isGroup && row.name === name) as PanelField;

const lastRequest = () => valuesMock.fetchFieldValues.mock.calls.at(-1)?.[0];
const lastSql = () => b64DecodeUnicode(lastRequest().sql);
const flush = async () => {
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await nextTick();
};

describe("buildTracesFieldList", () => {
  const list = buildTracesFieldList(SCHEMA, FTS_KEYS, "_timestamp");
  const names = list.map((field) => field.name);

  it("puts the important fields first in their fixed order, then the schema in its order", () => {
    expect(names).toEqual([
      "duration",
      "service_name",
      "span_status",
      "operation_name",
      "span_kind",
      "trace_id",
      "span_id",
      "reference_parent_span_id",
      "reference_parent_trace_id",
      "start_time",
      "zebra",
      "end_time",
      "body",
      "k8s_pod",
      "k8s_ns",
    ]);
  });

  it("drops the timestamp column and the internal nanosecond columns", () => {
    expect(names).not.toContain("_timestamp");
    expect(names).not.toContain("_start_time_ns");
    expect(names).not.toContain("_end_time_ns");
  });

  it("hides values for identifiers and raw times only", () => {
    const noValues = list.filter((field) => !field.showValues).map((field) => field.name);
    expect(noValues).toEqual([
      "trace_id",
      "span_id",
      "reference_parent_span_id",
      "reference_parent_trace_id",
      "start_time",
      "end_time",
    ]);
  });

  it("marks full-text keys and copies the schema type", () => {
    expect(list.find((field) => field.name === "body")).toMatchObject({
      ftsKey: true,
      dataType: "Utf8",
      type: "Utf8",
      isSchemaField: true,
    });
    expect(list.find((field) => field.name === "duration")?.ftsKey).toBe(false);
  });
});

describe("useTracesFieldSource", () => {
  let harness: Harness;

  beforeEach(() => {
    vi.clearAllMocks();
    parser.instance = new Parser();
    store.state.zoConfig.show_fts_field_values = false;
    store.state.selectedOrganization.identifier = "org";
    correlation.keyFieldsByOrg = {
      org: Promise.resolve({ traces: { fields: ["service_name"], groups: [] } }),
      org2: Promise.resolve({ traces: { fields: ["zebra"], groups: [] } }),
    };
  });

  afterEach(() => {
    harness?.wrapper.unmount();
  });

  describe("fields", () => {
    it("groups the stream's fields with the traces key fields pinned first", async () => {
      harness = mountSource();
      await flush();
      const rows = harness.source.fields.value;
      expect(rows[0]).toMatchObject({ isGroup: true, group: "pinned" });
      expect(rows[1].name).toBe("service_name");
      expect(fieldByName(harness.source, "k8s_pod").group).toBe("k8s");
    });

    it("regroups with the new org's configuration after an org switch", async () => {
      harness = mountSource();
      await flush();
      expect(fieldByName(harness.source, "service_name").group).toBe("pinned");
      store.state.selectedOrganization.identifier = "org2";
      await flush();
      expect(fieldByName(harness.source, "zebra").group).toBe("pinned");
      expect(fieldByName(harness.source, "service_name").group).not.toBe("pinned");
    });

    it("ignores the old org's grouping answer when it lands after the switch", async () => {
      let resolveOld!: (value: Record<string, unknown>) => void;
      correlation.keyFieldsByOrg.org = new Promise((resolve) => {
        resolveOld = resolve;
      });
      harness = mountSource();
      await flush();
      expect(harness.source.fields.value.some((row) => row.isGroup)).toBe(false);
      store.state.selectedOrganization.identifier = "org2";
      await flush();
      resolveOld({ traces: { fields: ["service_name"], groups: [] } });
      await flush();
      expect(fieldByName(harness.source, "zebra").group).toBe("pinned");
      expect(fieldByName(harness.source, "service_name").group).not.toBe("pinned");
    });

    it("locks the default trace columns, with status mapped to span_status", async () => {
      harness = mountSource();
      await flush();
      expect([...TRACES_LOCKED_FIELD_NAMES]).toEqual([
        "service_name",
        "operation_name",
        "duration",
        "spans",
        "span_status",
        "service_latency",
      ]);
      expect(fieldByName(harness.source, "service_name").columnLocked).toBe(true);
      expect(fieldByName(harness.source, "span_status").columnLocked).toBe(true);
      expect(fieldByName(harness.source, "zebra").columnLocked).toBe(false);
    });

    it("hands the panel the stream's defined schema, and none while it has none", () => {
      harness = mountSource();
      expect(harness.source.definedSchemaFields?.value).toBeNull();
      harness.searchObj.data.stream.userDefinedSchema = ["k8s_pod"];
      expect(harness.source.definedSchemaFields?.value?.[0]).toBe("k8s_pod");
    });

    it("keeps the trace key fields on the defined-schema tab when the schema leaves them out", () => {
      harness = mountSource();
      harness.searchObj.data.stream.userDefinedSchema = ["k8s_pod", "trace_id"];
      const defined = harness.source.definedSchemaFields?.value ?? [];
      expect(defined).toEqual(
        expect.arrayContaining([
          "k8s_pod",
          "trace_id",
          "span_id",
          "service_name",
          "operation_name",
          "duration",
        ]),
      );
      expect(defined.filter((name) => name === "trace_id")).toHaveLength(1);
    });

    it("binds the search text and the table columns to the page store", () => {
      harness = mountSource();
      harness.source.setSearch("svc");
      expect(harness.searchObj.data.stream.filterField).toBe("svc");
      expect(harness.source.search.value).toBe("svc");
      expect(harness.source.tableColumns?.value).toEqual(
        harness.searchObj.data.stream.selectedFields,
      );
    });

    it("reports loading while the stream or its fields load", async () => {
      harness = mountSource();
      await flush();
      expect(harness.source.loading.value).toBe(false);
      harness.searchObj.loadingStream = true;
      expect(harness.source.loading.value).toBe(true);
      harness.searchObj.loadingStream = false;
      harness.searchObj.meta.loadingFields = true;
      expect(harness.source.loading.value).toBe(false);
      harness.searchObj.data.stream.selectedStreamFields = [];
      expect(harness.source.loading.value).toBe(true);
    });

    it("reports loading until the grouping config lands, then shows the grouped list", async () => {
      let resolveKeys!: (value: Record<string, unknown>) => void;
      correlation.keyFieldsByOrg.org = new Promise((resolve) => {
        resolveKeys = resolve;
      });
      harness = mountSource();
      await flush();
      expect(harness.source.loading.value).toBe(true);
      resolveKeys({ traces: { fields: ["service_name"], groups: [] } });
      await flush();
      expect(harness.source.loading.value).toBe(false);
      expect(harness.source.fields.value.some((row) => row.isGroup)).toBe(true);
    });

    it("stops loading and keeps the flat list when the grouping config fails", async () => {
      correlation.keyFieldsByOrg.org = Promise.reject(new Error("down"));
      harness = mountSource();
      await flush();
      expect(harness.source.loading.value).toBe(false);
      expect(harness.source.fields.value.some((row) => row.isGroup)).toBe(false);
      expect(fieldByName(harness.source, "zebra")).toBeDefined();
      expect(toastMock).toHaveBeenCalledWith({
        variant: "warning",
        message: "Failed to load semantic groups: down",
      });
    });

    it("does not warn about the old org's grouping failure after a switch", async () => {
      let rejectOld!: (error: Error) => void;
      correlation.keyFieldsByOrg.org = new Promise((_, reject) => {
        rejectOld = reject;
      });
      harness = mountSource();
      await flush();
      store.state.selectedOrganization.identifier = "org2";
      await flush();
      rejectOld(new Error("down"));
      await flush();
      expect(toastMock).not.toHaveBeenCalled();
    });

    it("keeps the collapse state per stream", () => {
      harness = mountSource();
      harness.source.toggleGroup("k8s");
      expect(harness.source.collapsedGroups.value.has("k8s")).toBe(true);
      harness.searchObj.data.stream.selectedStream = { label: "other", value: "other" };
      expect(harness.source.collapsedGroups.value.has("k8s")).toBe(false);
      harness.searchObj.data.stream.selectedStream = { label: "default", value: "default" };
      expect(harness.source.collapsedGroups.value.has("k8s")).toBe(true);
    });
  });

  describe("stream picker", () => {
    it("offers the page's stream list and the selected stream", () => {
      harness = mountSource();
      expect(harness.source.streams.value.map((s) => s.value)).toEqual(["default", "other"]);
      expect(harness.source.selectedStreams.value).toEqual(["default"]);
      expect(harness.source.streamType.value).toBe("traces");
    });

    it("routes a stream change through the page's confirm path", () => {
      harness = mountSource();
      harness.source.selectStreams(["other"]);
      expect(harness.onStreamChangeRequest).toHaveBeenCalledWith("other");
    });

    it("ignores picking the stream that is already selected", () => {
      harness = mountSource();
      harness.source.selectStreams(["default"]);
      harness.source.selectStreams([]);
      expect(harness.onStreamChangeRequest).not.toHaveBeenCalled();
    });
  });

  describe("table columns", () => {
    it("adds and removes a column, persists it per stream and rebuilds the table", () => {
      harness = mountSource();
      harness.source.toggleColumn?.(fieldByName(harness.source, "zebra"));
      expect(harness.searchObj.data.stream.selectedFields).toContain("zebra");
      expect(traces.updatedLocalLogFilterField).toHaveBeenCalledWith("traces");
      expect(harness.onColumnsChange).toHaveBeenCalledTimes(1);
      harness.source.toggleColumn?.(fieldByName(harness.source, "zebra"));
      expect(harness.searchObj.data.stream.selectedFields).not.toContain("zebra");
    });

    it("persists under the spans mode when that view is active", () => {
      harness = mountSource();
      harness.searchObj.meta.searchMode = "spans";
      harness.source.toggleColumn?.(fieldByName(harness.source, "zebra"));
      expect(traces.updatedLocalLogFilterField).toHaveBeenCalledWith("spans");
    });

    it("puts back the view's default columns from the footer reset", () => {
      harness = mountSource();
      harness.searchObj.data.stream.selectedFields = ["zebra"];
      harness.source.resetColumns?.();
      expect(harness.searchObj.data.stream.selectedFields).toEqual([
        "service_name",
        "operation_name",
        "duration",
        "spans",
        "status",
        "service_latency",
      ]);
      expect(harness.onColumnsChange).toHaveBeenCalledTimes(1);
    });

    it("resets to the spans defaults in the spans view", () => {
      harness = mountSource();
      harness.searchObj.meta.searchMode = "spans";
      harness.source.resetColumns?.();
      expect(harness.searchObj.data.stream.selectedFields).toEqual([
        "service_name",
        "operation_name",
        "duration",
        "span_status",
      ]);
      expect(traces.updatedLocalLogFilterField).toHaveBeenCalledWith("spans");
    });
  });

  describe("values requests", () => {
    it("queries the stream with the editor filter minus the field's own condition", () => {
      harness = mountSource();
      harness.searchObj.data.editorValue = "service_name = 'x and y' AND span_status = 'ERROR'";
      harness.source.openField(fieldByName(harness.source, "span_status"));
      expect(lastRequest()).toMatchObject({
        fields: ["span_status"],
        from: 0,
        size: 10,
        start_time: 100,
        end_time: 200,
        stream_name: "default",
        stream_type: "traces",
      });
      expect(lastSql()).toBe(`SELECT * FROM "default" WHERE service_name = 'x and y'`);
      expect(harness.source.expandedFields.value).toEqual(["span_status"]);
    });

    it("does not rewrite a quoted value when removing the other field", () => {
      harness = mountSource();
      harness.searchObj.data.editorValue = "service_name = 'x and y' AND span_status = '1'";
      harness.source.openField(fieldByName(harness.source, "service_name"));
      expect(lastSql()).toBe(`SELECT * FROM "default" WHERE span_status = '1'`);
    });

    it("refuses to open a full-text field until the config allows its values", () => {
      harness = mountSource();
      const body = fieldByName(harness.source, "body");
      harness.source.openField(body);
      expect(harness.source.expandedFields.value).toEqual([]);
      expect(valuesMock.fetchFieldValues).not.toHaveBeenCalled();
      store.state.zoConfig.show_fts_field_values = true;
      harness.source.openField(body);
      expect(harness.source.expandedFields.value).toEqual(["body"]);
      expect(valuesMock.fetchFieldValues).toHaveBeenCalledTimes(1);
    });

    it("never opens a field without values", () => {
      harness = mountSource();
      harness.source.openField(fieldByName(harness.source, "trace_id"));
      expect(harness.source.expandedFields.value).toEqual([]);
    });

    it("pages with from and a cumulative size so load more only shows once a page is full", () => {
      harness = mountSource();
      harness.source.openField(fieldByName(harness.source, "zebra"));
      harness.source.loadMoreValues("zebra");
      expect(lastRequest()).toMatchObject({ from: 10, size: 20 });
      harness.source.loadMoreValues("zebra");
      expect(lastRequest()).toMatchObject({ from: 20, size: 30 });
    });

    it("restarts from the first page with the keyword when the values are searched", () => {
      harness = mountSource();
      harness.source.openField(fieldByName(harness.source, "zebra"));
      harness.source.loadMoreValues("zebra");
      harness.source.searchValues("zebra", "api");
      expect(lastRequest()).toMatchObject({ from: 0, size: 10, keyword: "api" });
      harness.source.loadMoreValues("zebra");
      expect(lastRequest()).toMatchObject({ from: 10, size: 20, keyword: "api" });
    });

    it("pins the time range of an open field until it is refreshed", () => {
      harness = mountSource();
      harness.source.openField(fieldByName(harness.source, "zebra"));
      harness.searchObj.data.datetime = { startTime: 300, endTime: 400 };
      harness.source.loadMoreValues("zebra");
      expect(lastRequest()).toMatchObject({ start_time: 100, end_time: 200 });
    });

    it("pins the filter of an open field so load more and value search page through the query it opened with", () => {
      harness = mountSource();
      harness.searchObj.data.editorValue = "service_name = 'api'";
      harness.source.openField(fieldByName(harness.source, "zebra"));
      harness.searchObj.data.editorValue = "service_name = 'web' AND span_st";
      harness.source.loadMoreValues("zebra");
      expect(lastSql()).toBe(`SELECT * FROM "default" WHERE service_name = 'api'`);
      harness.source.searchValues("zebra", "a");
      expect(lastSql()).toBe(`SELECT * FROM "default" WHERE service_name = 'api'`);
      expect(harness.source.valuesRequest(fieldByName(harness.source, "zebra"))).toMatchObject({
        whereClause: "service_name = 'api'",
      });
    });

    it("re-pins the filter when the field is opened again", () => {
      harness = mountSource();
      harness.searchObj.data.editorValue = "service_name = 'api'";
      harness.source.openField(fieldByName(harness.source, "zebra"));
      harness.source.closeField("zebra");
      harness.searchObj.data.editorValue = "service_name = 'web'";
      harness.source.openField(fieldByName(harness.source, "zebra"));
      expect(lastSql()).toBe(`SELECT * FROM "default" WHERE service_name = 'web'`);
    });

    it("cancels and clears a field when it closes", () => {
      harness = mountSource();
      harness.source.openField(fieldByName(harness.source, "zebra"));
      harness.source.closeField("zebra");
      expect(valuesMock.cancelFieldStream).toHaveBeenLastCalledWith("zebra");
      expect(harness.source.expandedFields.value).toEqual([]);
    });
  });

  describe("span_kind", () => {
    it("shows span kinds as labels", () => {
      harness = mountSource();
      const mapped = harness.source.valueMapper?.(fieldByName(harness.source, "span_kind"), [
        { key: "2", count: 3 },
        { key: "", count: 1 },
        { key: "9", count: 1 },
      ]);
      expect(mapped?.map((value) => value.key)).toEqual(["Server", "Unspecified", "9"]);
    });

    it("leaves other fields' values alone", () => {
      harness = mountSource();
      const values = [{ key: "2", count: 3 }];
      expect(harness.source.valueMapper?.(fieldByName(harness.source, "zebra"), values)).toBe(
        values,
      );
    });

    it("maps a label filter back to its key before the values request", () => {
      harness = mountSource();
      harness.searchObj.data.editorValue = "span_kind = 'Server'";
      harness.source.openField(fieldByName(harness.source, "zebra"));
      expect(lastSql()).toContain("'2'");
      expect(lastSql()).not.toContain("Server");
    });

    it("pre-checks the label the editor holds", () => {
      harness = mountSource();
      harness.searchObj.data.editorValue = "span_kind = 'Server'";
      expect(harness.source.activeIncludeValues.value).toEqual({ span_kind: ["Server"] });
    });
  });

  describe("duration", () => {
    it("renders the percentile body instead of a values list", () => {
      harness = mountSource();
      expect(harness.source.expansionOverride?.(fieldByName(harness.source, "duration"))).toBe(
        DurationPercentilesBody,
      );
      expect(harness.source.expansionOverride?.(fieldByName(harness.source, "zebra"))).toBeNull();
    });

    it("sends no values request for duration but describes the percentile query", () => {
      harness = mountSource();
      harness.searchObj.data.editorValue = "duration >= '1.5ms' AND service_name = 'api'";
      const duration = fieldByName(harness.source, "duration");
      harness.source.openField(duration);
      expect(valuesMock.fetchFieldValues).not.toHaveBeenCalled();
      expect(harness.source.expandedFields.value).toEqual(["duration"]);
      expect(harness.source.valuesRequest(duration)).toEqual({
        streamName: "default",
        streamType: "traces",
        startTime: 100,
        endTime: 200,
        whereClause: "service_name = 'api'",
      });
    });

    it("keeps the percentile query pinned while the editor text changes", () => {
      harness = mountSource();
      harness.searchObj.data.editorValue = "service_name = 'api'";
      const duration = fieldByName(harness.source, "duration");
      harness.source.openField(duration);
      harness.searchObj.data.editorValue = "service_name = 'api' AND span_st";
      expect(harness.source.valuesRequest(duration).whereClause).toBe("service_name = 'api'");
      harness.searchObj.data.editorValue = "span_status = 'ERROR'";
      harness.source.closeField("duration");
      harness.source.openField(duration);
      expect(harness.source.valuesRequest(duration).whereClause).toBe("span_status = 'ERROR'");
    });

    it("accepts a unit string and a raw microsecond value in the filter", () => {
      harness = mountSource();
      harness.searchObj.data.editorValue = "duration >= '1.5ms' AND duration <= 9000";
      harness.source.openField(fieldByName(harness.source, "zebra"));
      expect(lastSql()).toContain("duration >= 1500");
      expect(lastSql()).toContain("duration <= 9000");
    });
  });

  describe("pre-checked values", () => {
    it("ignores the + placeholder f='' and keeps a real null (M3)", () => {
      harness = mountSource();
      harness.searchObj.data.editorValue = "zebra='' and k8s_ns IS NULL";
      expect(harness.source.activeIncludeValues.value).toEqual({ k8s_ns: [MISSING_VALUE_KEY] });
      expect(harness.source.activeExcludeValues.value).toEqual({});
      expect(applyFilterTerm(buildTracesValueFilter("zebra", ["a"], []), "zebra=''")).toBe(
        "zebra='a'",
      );
    });

    it("reads a null-safe exclusion back as an exclusion (Additions 2)", () => {
      harness = mountSource();
      harness.searchObj.data.editorValue =
        "((zebra='a' or zebra is null) and (zebra!='c' or zebra is null))";
      expect(harness.source.activeIncludeValues.value).toEqual({ zebra: ["a", MISSING_VALUE_KEY] });
      expect(harness.source.activeExcludeValues.value).toEqual({ zebra: ["c"] });
    });

    it("reads =, !=, <>, IS NULL and IS NOT NULL through the editor AST", () => {
      harness = mountSource();
      harness.searchObj.data.editorValue =
        "(service_name = 'a' OR service_name = 'b') AND zebra != 'z' AND k8s_pod <> 'p' AND k8s_ns IS NULL AND body IS NOT NULL";
      expect(harness.source.activeIncludeValues.value).toEqual({
        service_name: ["a", "b"],
        k8s_ns: [MISSING_VALUE_KEY],
      });
      expect(harness.source.activeExcludeValues.value).toEqual({
        zebra: ["z"],
        k8s_pod: ["p"],
        body: [MISSING_VALUE_KEY],
      });
    });

    it("has nothing checked for an empty or half-typed filter", () => {
      harness = mountSource();
      expect(harness.source.activeIncludeValues.value).toEqual({});
      harness.searchObj.data.editorValue = "service_name = ";
      expect(harness.source.activeIncludeValues.value).toEqual({});
    });
  });

  describe("refresh after a stream switch", () => {
    const switchStream = (harness: Harness, fields = ["zebra", "duration", "service_name"]) => {
      harness.searchObj.data.stream.selectedStream = { label: "other", value: "other" };
      harness.searchObj.data.stream.selectedStreamFields = buildTracesFieldList(
        fields.map((name) => ({ name, type: "Utf8" })),
        new Set(),
        "_timestamp",
      );
      harness.source.refreshOpenFieldValues();
    };

    it("fetches an open field's values again from the new stream and range", () => {
      harness = mountSource();
      harness.source.openField(fieldByName(harness.source, "zebra"));
      harness.source.loadMoreValues("zebra");
      vi.clearAllMocks();
      harness.searchObj.data.datetime = { startTime: 300, endTime: 400 };
      switchStream(harness);
      expect(valuesMock.cancelFieldStream).toHaveBeenCalledWith("zebra");
      expect(valuesMock.resetFieldValues).toHaveBeenCalledWith("zebra", true);
      expect(valuesMock.fetchFieldValues).toHaveBeenCalledTimes(1);
      expect(lastRequest()).toMatchObject({
        fields: ["zebra"],
        stream_name: "other",
        from: 0,
        start_time: 300,
        end_time: 400,
      });
      expect(harness.source.expandedFields.value).toEqual(["zebra"]);
    });

    it("re-pins an open field's filter from the editor on refresh", () => {
      harness = mountSource();
      harness.searchObj.data.editorValue = "service_name = 'api'";
      harness.source.openField(fieldByName(harness.source, "zebra"));
      harness.searchObj.data.editorValue = "service_name = 'web'";
      switchStream(harness);
      expect(lastSql()).toBe(`SELECT * FROM "other" WHERE service_name = 'web'`);
      harness.source.loadMoreValues("zebra");
      expect(lastSql()).toBe(`SELECT * FROM "other" WHERE service_name = 'web'`);
    });

    it("closes an open field the new stream does not have", () => {
      harness = mountSource();
      harness.source.openField(fieldByName(harness.source, "k8s_pod"));
      vi.clearAllMocks();
      switchStream(harness);
      expect(valuesMock.fetchFieldValues).not.toHaveBeenCalled();
      expect(harness.source.expandedFields.value).toEqual([]);
    });

    it("re-pins the range for duration without a values request", () => {
      harness = mountSource();
      const duration = fieldByName(harness.source, "duration");
      harness.source.openField(duration);
      vi.clearAllMocks();
      harness.searchObj.data.datetime = { startTime: 300, endTime: 400 };
      harness.searchObj.data.editorValue = "service_name = 'api'";
      switchStream(harness);
      expect(valuesMock.fetchFieldValues).not.toHaveBeenCalled();
      expect(harness.source.valuesRequest(duration)).toMatchObject({
        streamName: "other",
        startTime: 300,
        endTime: 400,
        whereClause: "service_name = 'api'",
      });
    });

    it("fetches nothing for closed fields or without a stream", () => {
      harness = mountSource();
      harness.source.openField(fieldByName(harness.source, "zebra"));
      harness.source.closeField("zebra");
      vi.clearAllMocks();
      switchStream(harness);
      harness.searchObj.data.stream.selectedStream = { label: "", value: "" };
      harness.source.refreshOpenFieldValues();
      expect(valuesMock.fetchFieldValues).not.toHaveBeenCalled();
    });
  });

  describe("intents", () => {
    it("writes a filter expression to the page", () => {
      harness = mountSource();
      harness.source.addFilter("zebra=''");
      expect(harness.searchObj.data.stream.addToFilter).toBe("zebra=''");
    });

    it("joins included values with or and excluded values with and", () => {
      harness = mountSource();
      harness.source.addValueFilters("zebra", ["a", "o'neil"], []);
      expect(harness.searchObj.data.stream.addToFilter).toBe("(zebra='a' or zebra='o''neil')");
      harness.source.addValueFilters("zebra", [], ["a", "b"]);
      expect(harness.searchObj.data.stream.addToFilter).toBe("(zebra!='a' and zebra!='b')");
      harness.source.addValueFilters("zebra", ["a"], []);
      expect(harness.searchObj.data.stream.addToFilter).toBe("zebra='a'");
      harness.source.addValueFilters("zebra", ["a"], ["b"]);
      expect(harness.searchObj.data.stream.addToFilter).toBe("(zebra='a' and zebra!='b')");
    });

    it("asks the page to drop a field's conditions when every value is unchecked", () => {
      harness = mountSource();
      harness.source.removeFieldFilter("zebra");
      expect(harness.searchObj.data.stream.removeFilterField).toBe("zebra");
    });
  });

  describe("SQL mode", () => {
    const sqlSource = (sql: string) => {
      harness = mountSource();
      harness.searchObj.meta.sqlMode = true;
      harness.searchObj.data.editorValue = sql;
      return harness;
    };

    it("keeps the typed FROM alias so the typed WHERE resolves", () => {
      sqlSource(`SELECT * FROM "default" d WHERE d.k8s_ns = '1' ORDER BY d.start_time`);
      harness.source.openField(fieldByName(harness.source, "service_name"));
      expect(lastSql()).toBe(`SELECT * FROM "default" d WHERE d.k8s_ns = '1'`);
    });

    it("drops the opened field's own condition when it is written with the alias", () => {
      sqlSource(
        `SELECT * FROM "default" d WHERE d.k8s_ns = '1' AND "d"."service_name" = 'a' AND (d.k8s_ns = '2' OR d.k8s_ns = '3')`,
      );
      harness.source.openField(fieldByName(harness.source, "k8s_ns"));
      expect(lastSql()).toBe(`SELECT * FROM "default" d WHERE "d"."service_name" = 'a'`);
      harness.source.openField(fieldByName(harness.source, "service_name"));
      expect(lastSql()).toBe(
        `SELECT * FROM "default" d WHERE d.k8s_ns = '1' AND (d.k8s_ns = '2' OR d.k8s_ns = '3')`,
      );
    });

    it("drops the IN list a value tick wrote for the opened field, so its other values still show", () => {
      sqlSource(
        `SELECT * FROM "default" WHERE a = 1 AND service_name IN ('x','y') AND service_name IS NOT NULL`,
      );
      harness.source.openField(fieldByName(harness.source, "service_name"));
      expect(lastSql()).toBe(`SELECT * FROM "default" WHERE a = 1`);
    });

    it("reads the stream alone for a CTE or a JOIN, and for the duration percentiles of a CTE", () => {
      sqlSource(
        `WITH slow AS (SELECT * FROM "default" WHERE duration > 5) SELECT * FROM slow WHERE k8s_ns = '1' ORDER BY start_time`,
      );
      harness.source.openField(fieldByName(harness.source, "service_name"));
      expect(lastSql()).toBe(`SELECT * FROM "default"`);
      const duration = fieldByName(harness.source, "duration");
      harness.source.openField(duration);
      expect(harness.source.valuesRequest(duration).whereClause).toBe("");
      harness.wrapper.unmount();
      sqlSource(
        `SELECT a.trace_id FROM "default" a JOIN "default" b ON a.trace_id = b.trace_id WHERE k8s_ns = '1'`,
      );
      harness.source.openField(fieldByName(harness.source, "service_name"));
      expect(lastSql()).toBe(`SELECT * FROM "default"`);
    });

    it("hands the ticked values to the search bar, which owns the condition it writes", () => {
      sqlSource(`SELECT * FROM "default"`);
      harness.source.addValueFilters("service_name", ["api", "o'k"], []);
      expect(harness.searchObj.data.stream.sqlFieldFilter).toEqual({
        field: "service_name",
        values: ["api", "o'k"],
        exclude: false,
      });
      harness.source.addValueFilters("service_name", [], ["a"]);
      expect(harness.searchObj.data.stream.sqlFieldFilter).toEqual({
        field: "service_name",
        values: ["a"],
        exclude: true,
      });
      expect(harness.searchObj.data.stream.addToFilter).toBe("");
    });

    it("ticks values only from the conditions the panel wrote into the SQL", () => {
      sqlSource(
        `SELECT * FROM "default" WHERE service_name = 'typed' AND zebra IN ('a','b') AND k8s_ns IS NOT NULL`,
      );
      harness.searchObj.data.stream.sqlFieldConditions = {
        zebra: { text: "zebra IN ('a','b')", values: ["a", "b"], exclude: false },
        k8s_ns: { text: "k8s_ns IS NOT NULL", values: ["null"], exclude: true },
        gone: { text: "gone = 'x'", values: ["x"], exclude: false },
      };
      expect(harness.source.activeIncludeValues.value).toEqual({ zebra: ["a", "b"] });
      expect(harness.source.activeExcludeValues.value).toEqual({ k8s_ns: ["null"] });
    });

    it("blocks the add-filter actions only while the query is typed SQL", () => {
      harness = mountSource();
      expect(harness.source.filterBlockedReason?.value).toBeNull();
      harness.searchObj.meta.sqlMode = true;
      expect(harness.source.filterBlockedReason?.value).toBe(
        "In SQL mode, put the condition in your WHERE clause",
      );
    });
  });

  describe("fields stored in _all", () => {
    it("pre-checks a value filtered through json_get_*(_all, 'field') under the field's name", () => {
      harness = mountSource();
      harness.searchObj.data.editorValue =
        "json_get_str(_all, 'http_route') = '/a' AND json_get_int(other, 'x') = '1'";
      expect(harness.source.activeIncludeValues.value).toEqual({ http_route: ["/a"] });
    });
  });

  describe("Spans view scope", () => {
    const ENTRY =
      "(CAST(span_kind AS VARCHAR) IN ('2','5') OR (reference_parent_span_id IS NULL OR reference_parent_span_id = ''))";

    const scoped = (filter: string) => {
      harness = mountSource();
      harness.searchObj.meta.searchMode = "spans";
      harness.searchObj.meta.scope = "entrypoint";
      harness.searchObj.data.stream.hasParentColumn = true;
      harness.searchObj.data.editorValue = filter;
    };

    it("adds the scope after the span_kind rewrite and the opened field's removal", () => {
      scoped("span_kind = 'Server' AND service_name = 'a'");
      harness.source.openField(fieldByName(harness.source, "service_name"));
      expect(lastSql()).toBe(`SELECT * FROM "default" WHERE (span_kind = '2') AND ${ENTRY}`);
      harness.source.openField(fieldByName(harness.source, "span_kind"));
      expect(lastSql()).toBe(`SELECT * FROM "default" WHERE (service_name = 'a') AND ${ENTRY}`);
    });

    it("is the scope alone for an empty filter, and reaches the duration percentiles", () => {
      scoped("");
      harness.source.openField(fieldByName(harness.source, "service_name"));
      expect(lastSql()).toBe(`SELECT * FROM "default" WHERE ${ENTRY}`);
      const duration = fieldByName(harness.source, "duration");
      harness.source.openField(duration);
      expect(harness.source.valuesRequest(duration).whereClause).toBe(ENTRY);
    });

    it("adds no scope in the Traces view or in SQL mode", () => {
      scoped("span_kind = 'Server' AND service_name = 'a'");
      harness.searchObj.meta.searchMode = "traces";
      harness.source.openField(fieldByName(harness.source, "service_name"));
      expect(lastSql()).toBe(`SELECT * FROM "default" WHERE span_kind = '2'`);
      harness.searchObj.meta.searchMode = "spans";
      harness.searchObj.meta.sqlMode = true;
      harness.searchObj.data.editorValue = `SELECT * FROM "default" WHERE a = 1`;
      harness.source.openField(fieldByName(harness.source, "service_name"));
      expect(lastSql()).toBe(`SELECT * FROM "default" WHERE a = 1`);
    });
  });

  describe("Group by", () => {
    it("is offered on schema fields in the Spans view, not on headers, the timestamp, SQL mode or the Traces view", () => {
      harness = mountSource();
      const offered = (field: Partial<PanelField>) =>
        harness.source.groupByOffered?.({ ...fieldByName(harness.source, "zebra"), ...field });
      expect(offered({})).toBe(false);
      harness.searchObj.meta.searchMode = "spans";
      expect(offered({})).toBe(true);
      expect(offered({ isGroup: true })).toBe(false);
      expect(offered({ name: "_timestamp" })).toBe(false);
      harness.searchObj.meta.sqlMode = true;
      expect(offered({})).toBe(false);
    });

    it("asks the page to group by a field, but not by the one already grouped", () => {
      harness = mountSource();
      harness.searchObj.meta.groupBy = "service_name";
      expect(harness.source.groupedField?.value).toBe("service_name");
      harness.source.groupBy?.("service_name");
      expect(harness.onGroupByChange).not.toHaveBeenCalled();
      harness.source.groupBy?.("zebra");
      expect(harness.onGroupByChange).toHaveBeenCalledWith("zebra");
    });
  });

  describe("in the panel", () => {
    const CAPABILITIES: FieldPanelCapabilities = {
      streamPicker: "single",
      values: true,
      drag: false,
      actions: ["add-filter", "toggle-column"],
      footerToggles: [],
      highlightColumns: true,
    };

    it("offers value checkboxes on the grouped fields and writes the clicked value as a filter", async () => {
      harness = mountSource();
      await flush();
      expect(fieldByName(harness.source, "zebra").streams).toEqual([]);
      harness.source.openField(fieldByName(harness.source, "zebra"));
      harness.source.fieldValues.value.zebra = {
        values: [{ key: "a", count: 2 }],
        isLoading: false,
        hasMore: false,
        errMsg: "",
      };
      const panel = mount(StreamFieldPanel, {
        props: { capabilities: CAPABILITIES, source: harness.source },
        global: { plugins: [store] },
      });
      await flush();
      const checkboxes = panel.findAll(
        '[data-test="o-field-list-expansion-zebra"] [role="checkbox"]',
      );
      expect(checkboxes).toHaveLength(1);
      await checkboxes[0].trigger("click");
      expect(harness.searchObj.data.stream.addToFilter).toBe("zebra='a'");
      panel.unmount();
    });
  });
});

describe("buildTracesValueFilter", () => {
  it("returns an empty string for no values", () => {
    expect(buildTracesValueFilter("f", [], [])).toBe("");
  });

  it("matches the missing-value row against null and, on a string field, the empty string too", () => {
    expect(buildTracesValueFilter("f", [MISSING_VALUE_KEY], [], "Utf8")).toBe(
      "(f is null or f = '')",
    );
    expect(buildTracesValueFilter("f", [], [MISSING_VALUE_KEY], "Utf8")).toBe(
      "(f is not null and f != '')",
    );
    expect(buildTracesValueFilter("f", [MISSING_VALUE_KEY], [], "Int64")).toBe("f is null");
    expect(buildTracesValueFilter("f", [], [MISSING_VALUE_KEY], "Int64")).toBe("f is not null");
    expect(buildTracesValueFilter("f", [], [""])).toBe("f!=''");
  });

  it("ANDs the excluded values onto the included ones", () => {
    expect(buildTracesValueFilter("f", ["a", "b"], ["c"])).toBe("((f='a' or f='b') and f!='c')");
  });

  it("lets null rows through each exclusion only when null is included (Additions 2)", () => {
    expect(buildTracesValueFilter("f", ["a", MISSING_VALUE_KEY], ["c"], "Int64")).toBe(
      "((f='a' or f is null) and (f!='c' or f is null))",
    );
    expect(buildTracesValueFilter("f", [MISSING_VALUE_KEY], ["c"], "Int64")).toBe(
      "(f is null and (f!='c' or f is null))",
    );
    expect(buildTracesValueFilter("f", [MISSING_VALUE_KEY], [], "Int64")).toBe("f is null");
    expect(buildTracesValueFilter("f", [], ["c"])).toBe("f!='c'");
  });
  it("filters the text null as an ordinary value, not as a missing one", () => {
    expect(applyFilterTerm(buildTracesValueFilter("f", ["null"], []), "")).toBe("f='null'");
    expect(applyFilterTerm(buildTracesValueFilter("f", [], ["null"]), "")).toBe("f!='null'");
  });
});

describe("mapSpanKindValues", () => {
  it("maps every known kind and keeps the count", () => {
    expect(mapSpanKindValues([{ key: "0", count: 1 }])).toEqual([{ key: "Unspecified", count: 1 }]);
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

describe("load more after a failed page, through the real values stream (F2)", () => {
  let harness: Harness;

  beforeEach(() => {
    realStream.on = true;
    realStream.sent.length = 0;
    realStream.inFlight.length = 0;
  });

  afterEach(() => {
    harness?.wrapper.unmount();
    realStream.on = false;
  });

  it("asks for the same offset again after a failure, then moves on one page", () => {
    harness = mountSource();
    harness.source.openField(fieldByName(harness.source, "zebra"));
    expect(sentPage()).toEqual({ from: 0, size: 10 });
    settleStream(10);
    harness.source.loadMoreValues("zebra");
    expect(sentPage()).toEqual({ from: 10, size: 20 });
    settleStream("fail");
    harness.source.loadMoreValues("zebra");
    expect(sentPage()).toEqual({ from: 10, size: 20 });
    settleStream(20);
    harness.source.loadMoreValues("zebra");
    expect(sentPage()).toEqual({ from: 20, size: 30 });
  });
});

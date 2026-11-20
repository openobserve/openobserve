// Copyright 2026 OpenObserve Inc.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { computed, defineComponent, h, nextTick, ref, type Ref } from "vue";
import { createStore } from "vuex";
import { Parser } from "@openobserve/node-sql-parser/build/datafusionsql";
import { b64DecodeUnicode } from "@/utils/zincutils";

const awsConfig = vi.hoisted(() => ({ isEnterprise: "false", isCloud: "false" }));
vi.mock("@/aws-exports", () => ({ default: awsConfig }));

const correlation = vi.hoisted(() => ({
  semanticGroups: [] as { id: string; group: string; fields: string[] }[],
  keyFields: { logs: { fields: ["service"], groups: [] as string[] } } as Record<string, unknown>,
}));
vi.mock("@/composables/useServiceCorrelation", () => ({
  useServiceCorrelation: () => ({
    loadSemanticGroups: vi.fn(async () => correlation.semanticGroups),
    loadKeyFields: vi.fn(async () => correlation.keyFields),
    loadFieldGrouping: vi.fn(async () => ({})),
  }),
}));

const valuesMock = vi.hoisted(() => ({
  fetchFieldValues: vi.fn(),
  cancelFieldStream: vi.fn(),
  cancelAllFieldStreams: vi.fn(),
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
          fieldValues.value[name] = { values: [], isLoading, hasMore: false, errMsg: "" };
        },
      };
    },
  };
});

vi.mock("@/composables/useLogs/logsUtils", () => {
  const parser = new Parser();
  return {
    logsUtils: () => ({
      fnParsedSQL: (query: string) => {
        try {
          return parser.astify(query);
        } catch {
          return { where: null };
        }
      },
      fnUnparsedSQL: (ast: unknown) => parser.sqlify(ast as never),
    }),
  };
});

import useLocalFieldSource, {
  buildValueExpression,
  buildValueFilter,
  type LocalFieldSourceOptions,
} from "./useLocalFieldSource";
import StreamFieldPanel from "./StreamFieldPanel.vue";
import { applyFilterTerm } from "@/utils/traces/filterUtils";
import type { FieldPanelCapabilities, FieldPanelSource } from "./fieldPanel.types";

const RAW_FIELDS = [
  { name: "service", type: "Utf8" },
  { name: "k8s_pod", type: "Utf8" },
  { name: "k8s_ns", type: "Utf8" },
  { name: "msg", type: "Utf8" },
  { name: "count", type: "Int64" },
  { name: "body", type: "Utf8", ftsKey: true },
  { name: "_timestamp", type: "Int64", showValues: false },
];

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

interface Harness {
  wrapper: VueWrapper;
  source: FieldPanelSource;
  query: Ref<string>;
  sql: Ref<string>;
  baseFilter: Ref<string>;
  streamName: Ref<string>;
  range: Ref<{ startTime: number; endTime: number }>;
  onAddFilter: ReturnType<typeof vi.fn>;
  onRemoveFieldFilter: ReturnType<typeof vi.fn>;
}

function mountSource(overrides: Partial<LocalFieldSourceOptions> & { useSql?: boolean } = {}) {
  const query = ref("");
  const sql = ref("");
  const baseFilter = ref("");
  const streamName = ref("s1");
  const range = ref({ startTime: 100, endTime: 200 });
  const onAddFilter = vi.fn();
  const onRemoveFieldFilter = vi.fn();
  let source!: FieldPanelSource;
  const { useSql, ...rest } = overrides;
  const Host = defineComponent({
    setup() {
      source = useLocalFieldSource({
        fields: ref(RAW_FIELDS),
        streamName,
        streamType: ref("logs"),
        timeRange: () => range.value,
        ...(useSql ? { sql } : { query }),
        baseFilter,
        onAddFilter,
        onRemoveFieldFilter,
        ...rest,
      });
      return () => h("div");
    },
  });
  const wrapper = mount(Host, { global: { plugins: [store] } });
  return {
    wrapper,
    source,
    query,
    sql,
    baseFilter,
    streamName,
    range,
    onAddFilter,
    onRemoveFieldFilter,
  };
}

const lastRequest = () => valuesMock.fetchFieldValues.mock.calls.at(-1)?.[0];
const lastSql = () => b64DecodeUnicode(lastRequest().sql);
const flush = async () => {
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await nextTick();
};

describe("useLocalFieldSource", () => {
  let harness: Harness;

  beforeEach(() => {
    vi.clearAllMocks();
    awsConfig.isEnterprise = "false";
    correlation.semanticGroups = [];
  });

  afterEach(() => {
    harness?.wrapper.unmount();
  });

  describe("grouping", () => {
    it("falls back to key fields, prefix and type groups without semantic aliases", async () => {
      harness = mountSource();
      await flush();
      const groups = harness.source.fields.value
        .filter((row) => row.isGroup)
        .map((row) => row.group);
      expect(groups).toEqual(["pinned", "k8s", "type_string", "type_number"]);
      const rows = harness.source.fields.value.filter((row) => !row.isGroup);
      expect(rows.find((row) => row.name === "service")?.group).toBe("pinned");
      expect(rows.find((row) => row.name === "k8s_pod")?.group).toBe("k8s");
      expect(rows.find((row) => row.name === "count")?.group).toBe("type_number");
    });

    it("uses the org's semantic groups when they exist", async () => {
      awsConfig.isEnterprise = "true";
      correlation.semanticGroups = [{ id: "app", group: "app", fields: ["msg", "count"] }];
      harness = mountSource();
      await flush();
      const rows = harness.source.fields.value.filter((row) => !row.isGroup);
      expect(rows.find((row) => row.name === "msg")?.group).toBe("app");
      expect(rows.find((row) => row.name === "count")?.group).toBe("app");
    });

    it("normalises every row to the panel field shape", async () => {
      harness = mountSource();
      await flush();
      const body = harness.source.fields.value.find((row) => row.name === "body");
      expect(body).toMatchObject({
        ftsKey: true,
        isSchemaField: true,
        showValues: true,
        dataType: "Utf8",
      });
      const ts = harness.source.fields.value.find((row) => row.name === "_timestamp");
      expect(ts?.showValues).toBe(false);
    });

    it("keeps the collapse state per stream", async () => {
      harness = mountSource();
      harness.source.collapsedGroups.value = new Set(["k8s"]);
      expect(harness.source.collapsedGroups.value.has("k8s")).toBe(true);
      harness.streamName.value = "s2";
      await nextTick();
      expect(harness.source.collapsedGroups.value.size).toBe(0);
      harness.streamName.value = "s1";
      await nextTick();
      expect(harness.source.collapsedGroups.value.has("k8s")).toBe(true);
    });
  });

  describe("values requests", () => {
    it("strips the field's own condition and keeps the rest of the filter", async () => {
      harness = mountSource();
      harness.query.value = "env='prod' AND level='error'";
      await nextTick();
      harness.source.openField(harness.source.fields.value.find((row) => row.name === "service")!);
      expect(lastSql()).toBe(`SELECT * FROM "s1" WHERE env='prod' AND level='error'`);
      harness.query.value = "service='api' AND level='error'";
      await flush();
      expect(lastSql()).toBe(`SELECT * FROM "s1" WHERE level='error'`);
    });

    it("puts the base filter first and parenthesises the user filter", async () => {
      harness = mountSource();
      harness.baseFilter.value = "type='error'";
      harness.query.value = "a='1' OR b='2'";
      await nextTick();
      harness.source.openField({
        name: "msg",
        dataType: "",
        ftsKey: false,
        isSchemaField: true,
        showValues: true,
      });
      expect(lastSql()).toBe(`SELECT * FROM "s1" WHERE type='error' AND (a='1' OR b='2')`);
      expect(lastRequest()).toMatchObject({
        fields: ["msg"],
        size: 10,
        stream_name: "s1",
        stream_type: "logs",
        start_time: 100,
        end_time: 200,
      });
    });

    it("takes the WHERE clause of a full SQL statement through the parser", async () => {
      harness = mountSource({ useSql: true });
      harness.sql.value = `SELECT count(*) FROM "s1" WHERE host='h' AND level='error' GROUP BY host`;
      await nextTick();
      harness.source.openField({
        name: "msg",
        dataType: "",
        ftsKey: false,
        isSchemaField: true,
        showValues: true,
      });
      expect(lastSql()).toBe(`SELECT * FROM "s1" WHERE host = 'h' AND level = 'error'`);
      expect(harness.source.activeIncludeValues.value).toEqual({ host: ["h"], level: ["error"] });
    });

    it("refuses to open a full-text field while the config hides its values", () => {
      harness = mountSource();
      harness.source.openField({
        name: "body",
        dataType: "",
        ftsKey: true,
        isSchemaField: true,
        showValues: true,
      });
      expect(valuesMock.fetchFieldValues).not.toHaveBeenCalled();
      expect(harness.source.expandedFields.value).toEqual([]);
    });

    it("refetches every open field when the query or the time range changes", async () => {
      harness = mountSource();
      harness.source.openField({
        name: "msg",
        dataType: "",
        ftsKey: false,
        isSchemaField: true,
        showValues: true,
      });
      expect(valuesMock.fetchFieldValues).toHaveBeenCalledTimes(1);
      harness.query.value = "level='error'";
      await flush();
      expect(valuesMock.fetchFieldValues).toHaveBeenCalledTimes(2);
      expect(lastSql()).toBe(`SELECT * FROM "s1" WHERE level='error'`);
      harness.range.value = { startTime: 300, endTime: 400 };
      await flush();
      expect(valuesMock.fetchFieldValues).toHaveBeenCalledTimes(3);
      expect(lastRequest()).toMatchObject({ start_time: 300, end_time: 400 });
    });

    it("pins the time range of an open field for search and load more", async () => {
      harness = mountSource();
      harness.source.openField({
        name: "msg",
        dataType: "",
        ftsKey: false,
        isSchemaField: true,
        showValues: true,
      });
      harness.source.searchValues("msg", "err");
      expect(lastRequest()).toMatchObject({ keyword: "err", size: 10, start_time: 100 });
      harness.source.loadMoreValues("msg");
      expect(lastRequest()).toMatchObject({ keyword: "err", size: 20, start_time: 100 });
    });

    it("closes every open field when the stream changes", async () => {
      harness = mountSource();
      harness.source.openField({
        name: "msg",
        dataType: "",
        ftsKey: false,
        isSchemaField: true,
        showValues: true,
      });
      expect(harness.source.expandedFields.value).toEqual(["msg"]);
      harness.streamName.value = "s2";
      await flush();
      expect(harness.source.expandedFields.value).toEqual([]);
      expect(valuesMock.cancelAllFieldStreams).toHaveBeenCalled();
    });

    it("sends no values request for a row with an expansion override, but keeps its range fresh", async () => {
      const Override = { template: "<div />" };
      harness = mountSource({
        expansionOverride: (field) => (field.name === "msg" ? Override : null),
      });
      const msg = {
        name: "msg",
        dataType: "",
        ftsKey: false,
        isSchemaField: true,
        showValues: true,
      };
      harness.source.openField(msg);
      expect(harness.source.expandedFields.value).toEqual(["msg"]);
      expect(valuesMock.fetchFieldValues).not.toHaveBeenCalled();
      harness.range.value = { startTime: 300, endTime: 400 };
      await flush();
      expect(valuesMock.fetchFieldValues).not.toHaveBeenCalled();
      expect(harness.source.valuesRequest(msg)).toMatchObject({ startTime: 300, endTime: 400 });
    });

    it("describes the request an expansion override needs", async () => {
      harness = mountSource();
      harness.query.value = "service='api' AND level='error'";
      await nextTick();
      expect(
        harness.source.valuesRequest({
          name: "service",
          dataType: "",
          ftsKey: false,
          isSchemaField: true,
          showValues: true,
        }),
      ).toEqual({
        streamName: "s1",
        streamType: "logs",
        startTime: 100,
        endTime: 200,
        whereClause: "level='error'",
      });
    });
  });

  describe("pre-checked values", () => {
    it.each([
      ["a='x'", { include: { a: ["x"] }, exclude: {} }],
      ["b!='y'", { include: {}, exclude: { b: ["y"] } }],
      ["c<>'z'", { include: {}, exclude: { c: ["z"] } }],
      ["d IS NULL", { include: { d: ["null"] }, exclude: {} }],
      ["e IS NOT NULL", { include: {}, exclude: { e: ["null"] } }],
      ["(f='1' or f='2')", { include: { f: ["1", "2"] }, exclude: {} }],
      ["(g!='1' and g!='2') AND h='3'", { include: { h: ["3"] }, exclude: { g: ["1", "2"] } }],
      ["brand = 'it''s'", { include: { brand: ["it's"] }, exclude: {} }],
      ["f=''", { include: {}, exclude: {} }],
      ["f='' and g IS NULL", { include: { g: ["null"] }, exclude: {} }],
      [
        "(f IS NULL and (f!='c' or f IS NULL))",
        { include: { f: ["null"] }, exclude: { f: ["c"] } },
      ],
    ])("parses %s", async (query, expected) => {
      harness = mountSource();
      harness.query.value = query;
      await nextTick();
      expect(harness.source.activeIncludeValues.value).toEqual(expected.include);
      expect(harness.source.activeExcludeValues.value).toEqual(expected.exclude);
    });

    it("replaces the + placeholder f='' when values are picked for the field (M3)", () => {
      harness = mountSource();
      const base = "code=1 and f=''";
      expect(applyFilterTerm(buildValueFilter("f", ["a"], []), base)).toBe("code=1 and f='a'");
      expect(applyFilterTerm(buildValueFilter("f", ["a", "b"], ["c"]), base)).toBe(
        "code=1 and ((f='a' or f='b') and f!='c')",
      );
    });

    it("never shows the base filter as a checked value", async () => {
      harness = mountSource();
      harness.baseFilter.value = "session_id IS NOT NULL";
      await nextTick();
      expect(harness.source.activeExcludeValues.value).toEqual({});
    });
  });

  describe("intents", () => {
    it("hands a filter expression to the page", () => {
      harness = mountSource();
      harness.source.addFilter("service=''");
      expect(harness.onAddFilter).toHaveBeenCalledWith("service=''");
    });

    it("joins included values with or and excluded values with and", () => {
      harness = mountSource();
      harness.source.addValueFilters("f", ["a", "b"], []);
      expect(harness.onAddFilter).toHaveBeenLastCalledWith("(f='a' or f='b')");
      harness.source.addValueFilters("f", [], ["a", "b"]);
      expect(harness.onAddFilter).toHaveBeenLastCalledWith("(f!='a' and f!='b')");
      harness.source.addValueFilters("f", ["null"], []);
      expect(harness.onAddFilter).toHaveBeenLastCalledWith("f IS NULL");
      harness.source.addValueFilters("f", ["a"], ["b"]);
      expect(harness.onAddFilter).toHaveBeenLastCalledWith("(f='a' and f!='b')");
    });

    it("asks the page to drop a field's conditions", () => {
      harness = mountSource();
      harness.source.removeFieldFilter("f");
      expect(harness.onRemoveFieldFilter).toHaveBeenCalledWith("f");
    });

    it("forwards picker intents to the page", () => {
      const onSelectStream = vi.fn();
      const onChangeStreamType = vi.fn();
      harness = mountSource({ onSelectStream, onChangeStreamType });
      harness.source.selectStreams(["s2"]);
      harness.source.changeStreamType("traces");
      expect(onSelectStream).toHaveBeenCalledWith("s2");
      expect(onChangeStreamType).toHaveBeenCalledWith("traces");
    });

    it("exposes loading and the selected stream from the page", () => {
      const loading = ref(true);
      harness = mountSource({ loading });
      expect(harness.source.loading.value).toBe(true);
      expect(harness.source.selectedStreams.value).toEqual(["s1"]);
    });
  });

  describe("in the panel", () => {
    const CAPABILITIES: FieldPanelCapabilities = {
      streamPicker: "none",
      values: true,
      drag: false,
      actions: ["add-filter"],
      footerToggles: [],
      highlightColumns: false,
    };

    it("offers value checkboxes on the grouped fields and writes the clicked value as a filter", async () => {
      harness = mountSource();
      await flush();
      const msg = harness.source.fields.value.find((row) => row.name === "msg");
      expect(msg?.streams).toEqual([]);
      harness.source.openField(msg!);
      harness.source.fieldValues.value.msg = {
        values: [{ key: "boom", count: 2 }],
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
        '[data-test="o-field-list-expansion-msg"] [role="checkbox"]',
      );
      expect(checkboxes).toHaveLength(1);
      await checkboxes[0].trigger("click");
      expect(harness.onAddFilter).toHaveBeenLastCalledWith("msg='boom'");
      panel.unmount();
    });
  });
});

describe("buildValueExpression", () => {
  it("doubles an embedded quote", () => {
    expect(buildValueExpression("op", "it's", "include")).toBe("op='it''s'");
    expect(buildValueExpression("op", "it's", "exclude")).toBe("op!='it''s'");
  });

  it("maps the null row to IS NULL and IS NOT NULL, and keeps an empty value a literal", () => {
    expect(buildValueExpression("brand", "null", "include")).toBe("brand IS NULL");
    expect(buildValueExpression("brand", "null", "exclude")).toBe("brand IS NOT NULL");
    expect(buildValueExpression("brand", "", "exclude")).toBe("brand!=''");
  });

  it("returns a single expression without parentheses", () => {
    expect(buildValueFilter("f", ["a"], [])).toBe("f='a'");
    expect(buildValueFilter("f", [], [])).toBe("");
  });

  it("ANDs the excluded values onto the included ones, each with its own operator", () => {
    expect(buildValueFilter("f", ["a", "b"], ["c", "d"])).toBe(
      "((f='a' or f='b') and f!='c' and f!='d')",
    );
    expect(buildValueFilter("f", ["a"], ["c"])).toBe("(f='a' and f!='c')");
  });

  it("lets null rows through each exclusion only when null is included (Additions 2)", () => {
    expect(buildValueFilter("f", ["null"], ["c"])).toBe("(f IS NULL and (f!='c' or f IS NULL))");
    expect(buildValueFilter("f", ["a", "null"], ["c", "d"])).toBe(
      "((f='a' or f IS NULL) and (f!='c' or f IS NULL) and (f!='d' or f IS NULL))",
    );
    expect(buildValueFilter("f", ["a"], ["c"])).toBe("(f='a' and f!='c')");
    expect(buildValueFilter("f", [], ["c", "d"])).toBe("(f!='c' and f!='d')");
  });
});

describe("useLocalFieldSource options", () => {
  it("defaults the stream list when the page has no picker", () => {
    const opts: LocalFieldSourceOptions = {
      fields: ref([]),
      streamName: ref("s"),
      streamType: ref("logs"),
      timeRange: () => ({ startTime: 0, endTime: 1 }),
      onAddFilter: vi.fn(),
      onRemoveFieldFilter: vi.fn(),
    };
    let source!: FieldPanelSource;
    const wrapper = mount(
      defineComponent({
        setup() {
          source = useLocalFieldSource(opts);
          return () => h("div");
        },
      }),
      { global: { plugins: [store] } },
    );
    expect(source.streams.value).toEqual([]);
    expect(computed(() => source.loading.value).value).toBe(false);
    wrapper.unmount();
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
  let harness: ReturnType<typeof mountSource>;

  beforeEach(() => {
    realStream.on = true;
    realStream.sent.length = 0;
    realStream.inFlight.length = 0;
  });

  afterEach(() => {
    harness?.wrapper.unmount();
    realStream.on = false;
  });

  it("asks for the same page again after a failure, then moves on one page", () => {
    harness = mountSource();
    harness.source.openField(harness.source.fields.value.find((row) => row.name === "service")!);
    const first = sentPage().size;
    settleStream(first);
    harness.source.loadMoreValues("service");
    expect(sentPage().size).toBe(first * 2);
    settleStream("fail");
    expect(harness.source.fieldValues.value.service).toMatchObject({ hasMore: true });
    harness.source.loadMoreValues("service");
    expect(sentPage().size).toBe(first * 2);
    settleStream(first * 2);
    harness.source.loadMoreValues("service");
    expect(sentPage().size).toBe(first * 3);
  });
});

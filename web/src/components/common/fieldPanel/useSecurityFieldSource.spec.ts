// Copyright 2026 OpenObserve Inc.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref, type Ref } from "vue";
import { createStore } from "vuex";
import type { FieldFilter, SeverityValue } from "@/utils/security/eventQuery";
import { ALL_SOURCES } from "@/utils/security/huntLink";

const runSqlMock = vi.hoisted(() => vi.fn());
vi.mock("@/composables/security/useSecurityStreamPlans", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/security/useSecurityStreamPlans")>()),
  runSql: runSqlMock,
}));

const toastMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/feedback/Toast/useToast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/feedback/Toast/useToast")>()),
  toast: toastMock,
}));

import useSecurityFieldSource, {
  SECURITY_FIELD_PANEL_CAPABILITIES,
  type SecurityFieldSource,
  type SecuritySchemaField,
} from "./useSecurityFieldSource";
import StreamFieldPanel from "./StreamFieldPanel.vue";
import { NULL_VALUE_KEY as NULL } from "./security/securityValueFilters";
import type { PanelField } from "./fieldPanel.types";

const SCHEMA: SecuritySchemaField[] = [
  { name: "zeek_uid", ftype: "Utf8" },
  { name: "_timestamp", ftype: "Int64" },
  { name: "actor_user_name", ftype: "Utf8" },
  { name: "severity_id", ftype: "Int64" },
  { name: "src_endpoint_ip", ftype: "Utf8" },
];

const SEVERITY_SQL = "CASE WHEN level = 'error' THEN 4 ELSE 1 END";

const store = createStore({
  state: {
    selectedOrganization: { identifier: "org" },
    zoConfig: { timestamp_column: "_timestamp", query_values_default_num: 10 },
  },
});

interface Harness {
  wrapper: VueWrapper;
  source: SecurityFieldSource;
  stream: Ref<string | null>;
  fieldFilters: Ref<FieldFilter[]>;
  severity: Ref<SeverityValue[]>;
  sqlMode: Ref<boolean>;
  sqlQuery: Ref<string>;
  tableColumns: Ref<string[]>;
  lockedColumns: Ref<string[]>;
  onToggleColumn: ReturnType<typeof vi.fn>;
  onFiltersChange: ReturnType<typeof vi.fn>;
  panelShown: Ref<boolean>;
  definedSchemaFields: Ref<string[] | null>;
}

function mountSource({ withPanel = false } = {}): Harness {
  const stream = ref<string | null>("s1");
  const fieldFilters = ref<FieldFilter[]>([]);
  const severity = ref<SeverityValue[]>([]);
  const sqlMode = ref(false);
  const sqlQuery = ref("");
  const tableColumns = ref<string[]>([]);
  const lockedColumns = ref<string[]>([]);
  const onToggleColumn = vi.fn();
  const onFiltersChange = vi.fn();
  const panelShown = ref(true);
  const definedSchemaFields = ref<string[] | null>(null);
  let source!: SecurityFieldSource;
  const Host = defineComponent({
    setup() {
      source = useSecurityFieldSource({
        schemaFields: ref(SCHEMA),
        definedSchemaFields,
        stream,
        loading: ref(false),
        timeRange: () => ({ start: 100, end: 200 }),
        severitySql: ref(SEVERITY_SQL),
        severity,
        fieldFilters,
        sqlMode,
        sqlQuery,
        tableColumns,
        isColumnLocked: (name: string) => lockedColumns.value.includes(name),
        onToggleColumn,
        onFiltersChange,
      });
      return () =>
        withPanel && panelShown.value
          ? h(StreamFieldPanel, { capabilities: SECURITY_FIELD_PANEL_CAPABILITIES, source })
          : h("div");
    },
  });
  const wrapper = mount(Host, { global: { plugins: [store] }, attachTo: document.body });
  return {
    wrapper,
    source,
    stream,
    fieldFilters,
    severity,
    sqlMode,
    sqlQuery,
    tableColumns,
    lockedColumns,
    onToggleColumn,
    onFiltersChange,
    panelShown,
    definedSchemaFields,
  };
}

const lastSql = () => runSqlMock.mock.calls.at(-1)?.[1];
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const fieldRow = (h: Harness, name: string) =>
  h.source.fields.value.find((row) => row.name === name) as PanelField;

describe("useSecurityFieldSource", () => {
  let harness: Harness;

  beforeEach(() => {
    vi.clearAllMocks();
    runSqlMock.mockResolvedValue({ hits: [] });
  });

  afterEach(() => {
    harness?.wrapper.unmount();
  });

  describe("fields", () => {
    it("groups the schema by OCSF object in custom mode, _timestamp under Event (S18)", () => {
      harness = mountSource();
      expect(harness.source.groupingMode).toBe("custom");
      const groups = harness.source.groupFn!(harness.source.fields.value);
      expect(groups.map((group) => [group.key, group.fields.map((f) => f.name)])).toEqual([
        ["event", ["_timestamp", "severity_id"]],
        ["actor", ["actor_user_name"]],
        ["src", ["src_endpoint_ip"]],
        ["other", ["zeek_uid"]],
      ]);
      expect(groups[0].label).toBe("Event");
    });

    it("draws collapsible group headers with counts in the panel", async () => {
      harness = mountSource({ withPanel: true });
      await nextTick();
      const header = harness.wrapper.find('[data-test="o-field-list-group-Event"]');
      expect(header.text()).toContain("(2)");
      await header.find("div").trigger("click");
      expect(harness.source.collapsedGroups.value.has("event")).toBe(true);
    });

    it("lists no fields while hunting every source, with the hunt text (hunt mode)", () => {
      harness = mountSource();
      harness.stream.value = ALL_SOURCES;
      expect(harness.source.fields.value).toEqual([]);
      expect(harness.source.selectedStreams.value).toEqual([]);
      expect(harness.source.emptyState?.value.noStream).toBe(
        "Fields differ per source. Pick one source to browse its fields.",
      );
    });

    it("hands the panel the picked stream's defined schema, and none while hunting", () => {
      harness = mountSource();
      expect(harness.source.definedSchemaFields?.value).toBeNull();
      harness.definedSchemaFields.value = ["actor_user_name"];
      expect(harness.source.definedSchemaFields?.value).toEqual(["actor_user_name"]);
      harness.stream.value = ALL_SOURCES;
      expect(harness.source.definedSchemaFields?.value).toBeNull();
    });

    it("lists only the defined fields and the timestamp on the panel's defined-schema tab", async () => {
      store.state.zoConfig.user_defined_schemas_enabled = true;
      harness = mountSource({ withPanel: true });
      harness.definedSchemaFields.value = ["actor_user_name"];
      await nextTick();
      const range = () =>
        harness.wrapper.find('[data-test="logs-page-fields-list-pagination-range"]').text();
      expect(range()).toBe("2 fields");
      const headers = () => harness.wrapper.findAll('[data-test^="o-field-list-group-"]');
      expect(headers()).toHaveLength(2);
      await harness.wrapper.find('[data-test="logs-page-all-fields-btn"]').trigger("click");
      expect(range()).toBe("5 fields");
      expect(headers()).toHaveLength(4);
      store.state.zoConfig.user_defined_schemas_enabled = false;
    });

    it("asks for a stream when none is picked, and names a search that matches nothing", () => {
      harness = mountSource();
      harness.stream.value = null;
      expect(harness.source.emptyState?.value).toEqual({
        noStream: "Select a stream to see its fields",
        noMatch: "No fields match",
      });
    });
  });

  describe("values request", () => {
    it("counts values on _search_stream over the builder filters and severity minus the field's own condition (S2)", () => {
      harness = mountSource();
      harness.severity.value = [4];
      harness.fieldFilters.value = [
        { field: "actor_user_name", op: "=", value: "root" },
        { field: "src_endpoint_ip", op: "!=", value: "10.0.0.1" },
      ];
      harness.source.openField(fieldRow(harness, "actor_user_name"));
      const [org, sql, start, end, size, opts] = runSqlMock.mock.calls.at(-1)!;
      expect([org, start, end, size]).toEqual(["org", 100, 200, 11]);
      expect(opts.signal).toBeInstanceOf(AbortSignal);
      expect(sql).toBe(
        `SELECT "actor_user_name" AS zo_value, COUNT(*) AS zo_n FROM "s1" WHERE (${SEVERITY_SQL}) = 4 AND ("src_endpoint_ip" != '10.0.0.1' OR "src_endpoint_ip" IS NULL) GROUP BY zo_value ORDER BY zo_n DESC LIMIT 11`,
      );
    });

    it("keeps a typed contains filter on the opened field in its values query", () => {
      harness = mountSource();
      harness.fieldFilters.value = [
        { field: "actor_user_name", op: "=", value: "root" },
        { field: "actor_user_name", op: "contains", value: "ad" },
      ];
      harness.source.openField(fieldRow(harness, "actor_user_name"));
      expect(lastSql()).toContain(`WHERE CAST("actor_user_name" AS VARCHAR) LIKE '%ad%'`);
      expect(lastSql()).not.toContain("'root'");
    });

    it("searches values case-insensitively and asks for one page more on load more", async () => {
      harness = mountSource();
      harness.source.openField(fieldRow(harness, "actor_user_name"));
      harness.source.searchValues("actor_user_name", "ro_o%t");
      expect(lastSql()).toBe(
        `SELECT "actor_user_name" AS zo_value, COUNT(*) AS zo_n FROM "s1" WHERE CAST("actor_user_name" AS VARCHAR) ILIKE '%ro\\_o\\%t%' GROUP BY zo_value ORDER BY zo_n DESC LIMIT 11`,
      );
      await flush();
      harness.source.loadMoreValues("actor_user_name");
      expect(lastSql()).toContain("LIMIT 21");
    });

    it("lists NULL, empty and a literal null as separate values, each filtering exactly its rows (S5, F1)", async () => {
      runSqlMock.mockResolvedValue({
        hits: [
          { zo_value: null, zo_n: 5 },
          { zo_value: "null", zo_n: 4 },
          { zo_value: "root", zo_n: 3 },
          { zo_value: "", zo_n: 2 },
          ...Array.from({ length: 7 }, (_, i) => ({ zo_value: `u${i}`, zo_n: 1 })),
        ],
      });
      harness = mountSource();
      harness.source.openField(fieldRow(harness, "actor_user_name"));
      await flush();
      const state = harness.source.fieldValues.value.actor_user_name;
      expect(state.values.slice(0, 4)).toEqual([
        { key: NULL, label: "null", count: 5 },
        { key: "null", count: 4 },
        { key: "root", count: 3 },
        { key: "", label: '""', count: 2 },
      ]);
      expect(state.values).toHaveLength(10);
      expect(state.hasMore).toBe(true);
      harness.sqlMode.value = true;
      harness.sqlQuery.value = `SELECT * FROM "s1"`;
      const picked = (key: string) => {
        harness.sqlQuery.value = `SELECT * FROM "s1"`;
        harness.source.addValueFilters("actor_user_name", [key], []);
        return harness.sqlQuery.value.replace(`SELECT * FROM "s1" WHERE `, "");
      };
      expect(picked(NULL)).toBe(`"actor_user_name" IS NULL`);
      expect(picked("null")).toBe(`"actor_user_name" = 'null'`);
      expect(picked("")).toBe(`"actor_user_name" = ''`);
    });

    it("keeps a stored string shaped like the null key apart from SQL NULL, in both modes (F1)", async () => {
      runSqlMock.mockResolvedValue({
        hits: [
          { zo_value: null, zo_n: 5 },
          { zo_value: NULL, zo_n: 3 },
        ],
      });
      harness = mountSource();
      harness.source.openField(fieldRow(harness, "actor_user_name"));
      await flush();
      const [missing, shaped] = harness.source.fieldValues.value.actor_user_name.values;
      expect(missing).toEqual({ key: NULL, label: "null", count: 5 });
      expect(shaped).toEqual({ key: `\u0000${NULL}`, label: NULL, count: 3 });
      harness.source.addValueFilters("actor_user_name", [shaped.key], [missing.key]);
      expect(harness.fieldFilters.value).toEqual([
        { field: "actor_user_name", op: "=", value: NULL },
        { field: "actor_user_name", op: "is_not_null", value: "null" },
      ]);
      expect(harness.source.activeIncludeValues.value).toEqual({ actor_user_name: [shaped.key] });
      expect(harness.source.activeExcludeValues.value).toEqual({ actor_user_name: [missing.key] });
      harness.sqlMode.value = true;
      harness.sqlQuery.value = `SELECT * FROM "s1"`;
      harness.source.addValueFilters("actor_user_name", [shaped.key], []);
      expect(harness.sqlQuery.value).toBe(`SELECT * FROM "s1" WHERE "actor_user_name" = '${NULL}'`);
    });

    it("never runs more than four values queries at once, and skips one closed while it waited (F2)", async () => {
      const pending: (() => void)[] = [];
      runSqlMock.mockImplementation(
        () => new Promise((resolve) => pending.push(() => resolve({ hits: [] }))),
      );
      harness = mountSource();
      const names = SCHEMA.map((field) => field.name);
      for (const name of names) harness.source.openField(fieldRow(harness, name));
      await flush();
      expect(runSqlMock).toHaveBeenCalledTimes(4);
      harness.source.closeField(names[4]);
      pending.shift()!();
      await flush();
      expect(runSqlMock).toHaveBeenCalledTimes(4);
      const sent = runSqlMock.mock.calls.map((call) => call[1] as string);
      expect(sent.some((sql) => sql.includes(`"${names[4]}" AS zo_value`))).toBe(false);
      for (const release of pending.splice(0)) release();
      await flush();
      expect(runSqlMock).toHaveBeenCalledTimes(4);
    });

    it("shows a failed values query as the panel's error (S3)", async () => {
      runSqlMock.mockRejectedValue(new Error("unknown field 'severity'"));
      harness = mountSource();
      harness.source.openField(fieldRow(harness, "actor_user_name"));
      await flush();
      expect(harness.source.fieldValues.value.actor_user_name).toMatchObject({
        isLoading: false,
        errMsg: "unknown field 'severity'",
      });
    });

    it("counts over the whole stream in SQL mode, and says so in the caption", () => {
      harness = mountSource();
      const row = fieldRow(harness, "actor_user_name");
      expect(harness.source.valuesCaption?.(row)).toBeNull();
      harness.sqlMode.value = true;
      harness.sqlQuery.value = `SELECT * FROM "s1" WHERE x = 1`;
      harness.fieldFilters.value = [{ field: "src_endpoint_ip", op: "=", value: "a" }];
      harness.source.openField(row);
      expect(lastSql()).toBe(
        `SELECT "actor_user_name" AS zo_value, COUNT(*) AS zo_n FROM "s1" GROUP BY zo_value ORDER BY zo_n DESC LIMIT 11`,
      );
      expect(harness.source.valuesCaption?.(row)).toEqual({
        text: "SQL mode: values are counted over the whole stream, not your query.",
        testId: "security-events-values-whole-stream",
      });
    });

    it("fetches open fields again after a search and cancels them on a stream switch (S4, S20)", async () => {
      harness = mountSource();
      harness.source.openField(fieldRow(harness, "actor_user_name"));
      harness.fieldFilters.value = [{ field: "zeek_uid", op: "=", value: "u1" }];
      harness.source.refreshOpenFieldValues();
      expect(runSqlMock).toHaveBeenCalledTimes(2);
      expect(runSqlMock.mock.calls[0][5].signal.aborted).toBe(true);
      expect(lastSql()).toContain(`WHERE "zeek_uid" = 'u1'`);
      const pending = runSqlMock.mock.calls[1][5].signal as AbortSignal;
      harness.stream.value = "s2";
      await nextTick();
      expect(pending.aborted).toBe(true);
      expect(harness.source.expandedFields.value).toEqual([]);
      expect(harness.source.fieldValues.value).toEqual({});
    });
  });

  describe("value filters in the builder", () => {
    it("ORs included values of one field and writes the page's filter chips (S16)", () => {
      harness = mountSource();
      harness.sqlMode.value = true;
      harness.source.addValueFilters("actor_user_name", ["root", "admin"], ["guest"]);
      expect(harness.fieldFilters.value).toEqual([
        { field: "actor_user_name", op: "=", value: "root" },
        { field: "actor_user_name", op: "=", value: "admin" },
        { field: "actor_user_name", op: "!=", value: "guest" },
      ]);
      expect(harness.sqlMode.value).toBe(false);
      expect(harness.onFiltersChange).toHaveBeenCalledTimes(1);
      expect(harness.source.activeIncludeValues.value).toEqual({
        actor_user_name: ["root", "admin"],
      });
      expect(harness.source.activeExcludeValues.value).toEqual({ actor_user_name: ["guest"] });
    });

    it("flips a value's operator in place and keeps other filters on the field", () => {
      harness = mountSource();
      harness.fieldFilters.value = [
        { field: "actor_user_name", op: "=", value: "root" },
        { field: "actor_user_name", op: "contains", value: "adm" },
        { field: "zeek_uid", op: "=", value: "u1" },
        { field: "actor_user_name", op: "=", value: "bob" },
      ];
      harness.source.addValueFilters("actor_user_name", ["bob"], ["root"]);
      expect(harness.fieldFilters.value).toEqual([
        { field: "actor_user_name", op: "!=", value: "root" },
        { field: "actor_user_name", op: "contains", value: "adm" },
        { field: "zeek_uid", op: "=", value: "u1" },
        { field: "actor_user_name", op: "=", value: "bob" },
      ]);
      harness.source.removeFieldFilter("actor_user_name");
      expect(harness.fieldFilters.value).toEqual([
        { field: "actor_user_name", op: "contains", value: "adm" },
        { field: "zeek_uid", op: "=", value: "u1" },
      ]);
    });

    it("keeps null values: an included null is IS NULL, an excluded one IS NOT NULL (S5)", () => {
      harness = mountSource();
      harness.source.addValueFilters("actor_user_name", [NULL, "root"], []);
      expect(harness.fieldFilters.value).toEqual([
        { field: "actor_user_name", op: "is_null", value: "null" },
        { field: "actor_user_name", op: "=", value: "root" },
      ]);
      expect(harness.source.activeIncludeValues.value).toEqual({
        actor_user_name: [NULL, "root"],
      });
      harness.source.addValueFilters("actor_user_name", [], [NULL]);
      expect(harness.fieldFilters.value).toEqual([
        { field: "actor_user_name", op: "is_not_null", value: "null" },
      ]);
      expect(harness.source.activeExcludeValues.value).toEqual({ actor_user_name: [NULL] });
    });
  });

  describe("value filters in SQL mode", () => {
    const QUERY = `SELECT * FROM "s1" WHERE level = 'error' ORDER BY _timestamp DESC`;

    beforeEach(() => {
      harness = mountSource();
      harness.sqlMode.value = true;
      harness.sqlQuery.value = QUERY;
    });

    it("narrows the hand-written query, one OR group per field, and shows the ticks", () => {
      harness.source.addValueFilters("actor_user_name", ["root", NULL], []);
      expect(harness.sqlQuery.value).toBe(
        `SELECT * FROM "s1" WHERE (level = 'error') AND ("actor_user_name" = 'root' OR "actor_user_name" IS NULL) ORDER BY _timestamp DESC`,
      );
      harness.source.addValueFilters("zeek_uid", [], ["u1"]);
      expect(harness.sqlQuery.value).toBe(
        `SELECT * FROM "s1" WHERE ((level = 'error') AND ("actor_user_name" = 'root' OR "actor_user_name" IS NULL)) AND ("zeek_uid" != 'u1' OR "zeek_uid" IS NULL) ORDER BY _timestamp DESC`,
      );
      expect(harness.fieldFilters.value).toEqual([]);
      expect(harness.onFiltersChange).toHaveBeenCalledTimes(2);
      expect(harness.source.activeIncludeValues.value).toEqual({
        actor_user_name: ["root", NULL],
        zeek_uid: [],
      });
      expect(harness.source.activeExcludeValues.value).toEqual({
        actor_user_name: [],
        zeek_uid: ["u1"],
      });
    });

    it("rewrites its own condition when the picks change, and restores the query when cleared", () => {
      harness.source.addValueFilters("actor_user_name", ["root"], []);
      harness.source.addValueFilters("actor_user_name", ["root", "admin"], []);
      expect(harness.sqlQuery.value).toBe(
        `SELECT * FROM "s1" WHERE (level = 'error') AND ("actor_user_name" = 'root' OR "actor_user_name" = 'admin') ORDER BY _timestamp DESC`,
      );
      harness.source.removeFieldFilter("actor_user_name");
      expect(harness.sqlQuery.value).toBe(QUERY);
    });

    it("treats an edited query as the new base and shows no ticks for it", () => {
      harness.source.addValueFilters("actor_user_name", ["root"], []);
      const edited = `${harness.sqlQuery.value} LIMIT 5`;
      harness.sqlQuery.value = edited;
      expect(harness.source.activeIncludeValues.value).toEqual({});
      harness.source.addValueFilters("zeek_uid", ["u1"], []);
      expect(harness.sqlQuery.value).toBe(
        `SELECT * FROM "s1" WHERE ((level = 'error') AND "actor_user_name" = 'root') AND "zeek_uid" = 'u1' ORDER BY _timestamp DESC LIMIT 5`,
      );
      expect(harness.source.activeIncludeValues.value).toEqual({ zeek_uid: ["u1"] });
    });

    it("leaves a query it cannot edit alone and warns, dropping the refused tick", () => {
      const join = `SELECT * FROM "s1" a JOIN "s2" b ON a.id = b.id`;
      harness.sqlQuery.value = join;
      const before = harness.source.activeIncludeValues.value;
      harness.source.addValueFilters("actor_user_name", ["root"], []);
      expect(harness.sqlQuery.value).toBe(join);
      expect(harness.onFiltersChange).not.toHaveBeenCalled();
      expect(toastMock).toHaveBeenCalledWith({
        variant: "warning",
        message:
          "This SQL query is not a simple SELECT … WHERE, so the filter could not be added to it. Edit the query by hand, or switch to Builder.",
      });
      expect(harness.source.activeIncludeValues.value).not.toBe(before);
      expect(harness.source.activeIncludeValues.value).toEqual({});
    });
  });

  describe("column toggle", () => {
    it("hands a field's eye click to the page", () => {
      harness = mountSource();
      harness.source.toggleColumn!(fieldRow(harness, "zeek_uid"));
      expect(harness.onToggleColumn).toHaveBeenCalledWith("zeek_uid");
    });

    it("offers no eye on a column the page locks, and follows the lock as it moves", () => {
      harness = mountSource();
      harness.lockedColumns.value = ["actor_user_name"];
      expect(fieldRow(harness, "actor_user_name").columnLocked).toBe(true);
      expect(fieldRow(harness, "zeek_uid").columnLocked).toBe(false);
      harness.lockedColumns.value = [];
      expect(fieldRow(harness, "actor_user_name").columnLocked).toBe(false);
    });

    it("lights up the columns the table shows", () => {
      harness = mountSource();
      harness.tableColumns.value = ["zeek_uid"];
      expect(harness.source.tableColumns?.value).toEqual(["zeek_uid"]);
    });
  });

  it("keeps the search text and collapsed groups when the sidebar unmounts the panel (S15)", async () => {
    harness = mountSource({ withPanel: true });
    await nextTick();
    await harness.wrapper.find('[data-test="o-field-list-search"] input').setValue("actor");
    harness.source.toggleGroup("other");
    harness.panelShown.value = false;
    await nextTick();
    expect(harness.wrapper.find('[data-test="stream-field-panel"]').exists()).toBe(false);
    harness.panelShown.value = true;
    await nextTick();
    const input = harness.wrapper.find('[data-test="o-field-list-search"] input');
    expect((input.element as HTMLInputElement).value).toBe("actor");
    expect(harness.source.collapsedGroups.value.has("other")).toBe(true);
  });
});

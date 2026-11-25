// Copyright 2026 OpenObserve Inc.

import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import useTraces, { DEFAULT_TRACE_COLUMNS } from "@/composables/useTraces";
import useFieldValuesStream, { stripFieldCondition } from "@/composables/useFieldValuesStream";
import useFieldGrouping from "@/composables/useFieldGrouping";
import { toast } from "@/lib/feedback/Toast/useToast";
import { logsUtils } from "@/composables/useLogs/logsUtils";
import { resolveTracesFilter } from "@/utils/traces/resolveTracesFilter";
import { SPAN_KIND_MAP } from "@/utils/traces/constants";
import { buildFieldValuesRequest } from "./fieldValuesRequest";
import { escapeSingleQuotes } from "@/utils/queryUtils";
import { removeConditions } from "@/utils/query/sqlFilterBuilder";
import { analyzeTracesSql, hasOwnCondition } from "@/utils/traces/tracesSql";
import { activeScopePredicate, withScope } from "@/utils/traces/tracesScope";
import type { FieldObj } from "@/utils/fieldCategories";
import type { FieldValueEntry } from "@/composables/useFieldValuesStream";
import DurationPercentilesBody from "./DurationPercentilesBody.vue";
import {
  collectActiveValues,
  columnName,
  type ActiveFilterValues,
  type FieldOfOperand,
} from "./activeFilterValues";
import { emptyValueConditions } from "@/utils/logs/breakdownFilter";
import { isNullValue, joinValueConditions } from "./valueFilterExpression";
import type { FieldPanelSource, PanelField, StreamOption, ValuesRequest } from "./fieldPanel.types";

const STREAM_TYPE = "traces";

const DURATION_FIELD = "duration";

const SPAN_KIND_FIELD = "span_kind";

const UNSPECIFIED_SPAN_KIND = SPAN_KIND_MAP["0"];

/** Fixed head of the traces field list; the rest follows the schema order. */
const IMPORTANT_FIELDS = [
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
];

/** Identifiers and raw timestamps have no useful top values. */
const NO_VALUES_FIELDS = new Set([
  "trace_id",
  "span_id",
  "reference_parent_span_id",
  "reference_parent_trace_id",
  "start_time",
  "end_time",
]);

const INTERNAL_TIME_FIELDS = ["_start_time_ns", "_end_time_ns"];

const EMPTY_SET: Set<string> = new Set();

const EMPTY_FILTERS: ActiveFilterValues = { include: {}, exclude: {} };

const JSON_GET_FUNCTIONS = new Set([
  "json_get_str",
  "json_get_int",
  "json_get_float",
  "json_get_bool",
]);

// Column id "status" is the only one that differs from its stream field, span_status.
export const TRACES_LOCKED_FIELD_NAMES: Set<string> = new Set(
  DEFAULT_TRACE_COLUMNS.traces.map((id) => (id === "status" ? "span_status" : id)),
);

export interface TracesFieldSourceOptions {
  /** Routes a picker change through the page's confirm dialog before the stream is swapped. */
  onStreamChangeRequest: (name: string) => void;
  /** Rebuilds the result columns after the table column set changed. */
  onColumnsChange: () => void;
  /** Groups the Spans view by the field; the page runs the grouped search. */
  onGroupByChange: (field: string) => void;
}

export interface TracesFieldSource extends FieldPanelSource {
  /** Fetches every open field again once the page has the new stream's fields and query. */
  refreshOpenFieldValues: () => void;
}

export interface TracesSchemaRow {
  name: string;
  type?: string;
}

interface TimeRange {
  startTime: number;
  endTime: number;
}

/** Flat traces field list: important fields first, then the schema minus timestamp columns. */
export const buildTracesFieldList = (
  schema: TracesSchemaRow[],
  ftsKeys: Set<string>,
  timestampColumn: string,
): PanelField[] => {
  const ignored = new Set([timestampColumn, ...INTERNAL_TIME_FIELDS]);
  const types = new Map(schema.map((row) => [row.name, row.type ?? ""]));
  const toField = (name: string): PanelField => {
    const type = types.get(name) ?? "";
    return {
      name,
      type,
      dataType: type,
      ftsKey: ftsKeys.has(name),
      showValues: !NO_VALUES_FIELDS.has(name),
      isSchemaField: true,
    };
  };
  const seen = new Set(IMPORTANT_FIELDS);
  const rest: PanelField[] = [];
  for (const row of schema) {
    if (seen.has(row.name) || ignored.has(row.name)) continue;
    seen.add(row.name);
    rest.push(toField(row.name));
  }
  return [...IMPORTANT_FIELDS.map(toField), ...rest];
};

/** Includes OR together, excludes AND together; a single value needs no parentheses. */
export const buildTracesValueFilter = (
  fieldName: string,
  include: string[],
  exclude: string[],
  fieldType?: string,
): string => {
  const condition = (op: string) => (value: string) =>
    `${fieldName}${op}'${escapeSingleQuotes(value)}'`;
  // The values stream keys "" and missing alike as the missing-value key, so that row matches both.
  const missing = (mode: "include" | "exclude") => {
    const conditions = emptyValueConditions(fieldName, mode, (f) => f, fieldType);
    const joined = conditions.join(mode === "include" ? " or " : " and ");
    return conditions.length > 1 ? `(${joined})` : joined;
  };
  const included = include.map((value) =>
    isNullValue(value) ? missing("include") : condition("=")(value),
  );
  const excluded = exclude.map((value) =>
    isNullValue(value) ? missing("exclude") : condition("!=")(value),
  );
  return joinValueConditions(
    included,
    excluded,
    "lower",
    include.some(isNullValue) ? `${fieldName} is null` : undefined,
  );
};

export const mapSpanKindValues = (values: FieldValueEntry[]): FieldValueEntry[] =>
  values.map((value) => ({
    ...value,
    key:
      value.key === null || value.key === undefined || value.key === ""
        ? UNSPECIFIED_SPAN_KIND
        : (SPAN_KIND_MAP[value.key] ?? value.key),
  }));

/** Click-to-filter writes a field stored in _all as json_get_*(_all, 'field'), so it is read back by that name. */
export const tracesFilterField =
  (allColumn: string): FieldOfOperand =>
  (operand) => {
    if (operand.type === "column_ref") return columnName(operand.column);
    if (operand.type !== "function") return null;
    const call = operand as {
      name?: { name?: { value?: unknown }[] };
      args?: { value?: { type?: string; column?: unknown; value?: unknown }[] };
    };
    const fn = String(call.name?.name?.[0]?.value ?? "").toLowerCase();
    const [column, key] = call.args?.value ?? [];
    if (!JSON_GET_FUNCTIONS.has(fn) || column?.type !== "column_ref") return null;
    if (columnName(column.column) !== allColumn) return null;
    return typeof key?.value === "string" ? key.value : null;
  };

/** Typed SQL without the field's own condition; it may qualify the column with its FROM alias and test it with IN or IS. */
export const stripTypedFieldCondition = (where: string, fieldName: string): string => {
  if (!where.trim()) return "";
  const escaped = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `^(?:(?:"[^"]+"|\\w+)\\.)?"?${escaped}"?\\s*(?:[=!<>]|(?:not\\s+)?in\\b|is\\b)`,
    "i",
  );
  return removeConditions(where, (condition) => pattern.test(condition)).trim();
};

export default function useTracesFieldSource(options: TracesFieldSourceOptions): TracesFieldSource {
  const store = useStore();
  const { t } = useI18nTyped();
  const { searchObj, tracesParser, updatedLocalLogFilterField } = useTraces();
  const { fnParsedSQL } = logsUtils();

  const defaultValuesCount = computed<number>(
    () => store.state.zoConfig?.query_values_default_num || 10,
  );
  const showFtsFieldValues = computed<boolean>(
    () => store.state.zoConfig?.show_fts_field_values ?? false,
  );

  const streamName = computed<string>(() => searchObj.data.stream.selectedStream?.value ?? "");
  const streams = computed<StreamOption[]>(() =>
    (searchObj.data.stream.streamLists as { label: string; value: string }[]).map((stream) => ({
      label: raw(stream.label),
      value: stream.value,
    })),
  );
  const selectedStreams = computed(() => (streamName.value ? [streamName.value] : []));
  const streamType = ref(STREAM_TYPE);

  const selectStreams = (names: string[]) => {
    const next = names[0] ?? "";
    if (!next || next === streamName.value) return;
    options.onStreamChangeRequest(next);
  };

  const flatFields = computed<PanelField[]>(() =>
    (searchObj.data.stream.selectedStreamFields as Record<string, unknown>[])
      .filter((field) => !field.label)
      .map((field) => {
        const name = String(field.name);
        const type = String(field.dataType ?? field.type ?? "");
        return {
          ...field,
          name,
          type,
          dataType: type,
          ftsKey: field.ftsKey === true,
          isSchemaField: field.isSchemaField !== false,
          showValues: field.showValues !== false,
          columnLocked: TRACES_LOCKED_FIELD_NAMES.has(name),
        } as PanelField;
      }),
  );

  // Created in setup because it needs the injection context; the page is kept alive across an org switch.
  const {
    contextLoaded,
    loadGroupingContext,
    reset: resetGrouping,
    groupFields,
  } = useFieldGrouping({ fallbackGroups: true });
  const groupingPending = ref(false);
  let groupingLoadId = 0;
  // Grouping is best effort: a failed load leaves the list flat and only warns.
  const loadGrouping = () => {
    const id = ++groupingLoadId;
    groupingPending.value = true;
    loadGroupingContext(STREAM_TYPE)
      .catch((error: unknown) => {
        if (id !== groupingLoadId) return;
        toast({
          variant: "warning",
          message: t("traces.semanticGroupsLoadFailed", {
            error: error instanceof Error ? error.message : String(error),
          }),
        });
      })
      .finally(() => {
        if (id === groupingLoadId) groupingPending.value = false;
      });
  };
  loadGrouping();
  watch(
    () => store.state.selectedOrganization?.identifier,
    () => {
      resetGrouping();
      loadGrouping();
    },
  );

  const fields = computed<PanelField[]>(() => {
    if (!contextLoaded.value) return flatFields.value;
    const fieldObjs: FieldObj[] = flatFields.value.map((field) => ({
      ...field,
      isInterestingField: false,
      group: "",
      streams: [],
    }));
    try {
      return groupFields(fieldObjs).map(
        (row) =>
          ({
            ...row,
            isGroup: !!row.label,
            groupName: row.label ? row.name : undefined,
          }) as PanelField,
      );
    } catch {
      return flatFields.value;
    }
  });

  // Waits for the grouping config so the list does not render flat and then regroup.
  const loading = computed(
    () =>
      searchObj.loadingStream ||
      groupingPending.value ||
      (searchObj.meta.loadingFields && flatFields.value.length === 0),
  );

  const search = computed<string>({
    get: () => searchObj.data.stream.filterField,
    set: (value) => {
      searchObj.data.stream.filterField = value;
    },
  });
  const setSearch = (value: string) => {
    search.value = value;
  };

  // Collapse state is keyed by stream so a remount or the mobile drawer keeps it.
  const collapsedByStream = ref<Record<string, Set<string>>>({});
  const collapsedGroups = computed<Set<string>>({
    get: () => collapsedByStream.value[streamName.value] ?? EMPTY_SET,
    set: (groups) => {
      collapsedByStream.value[streamName.value] = groups;
    },
  });
  const toggleGroup = (group: string) => {
    const next = new Set(collapsedGroups.value);
    if (next.has(group)) next.delete(group);
    else next.add(group);
    collapsedGroups.value = next;
  };

  const tableColumns = computed<string[]>(() => searchObj.data.stream.selectedFields);

  // The trace key fields stay listed on the defined-schema tab even when the schema leaves them out.
  const definedSchemaFields = computed<string[] | null>(() => {
    const defined: string[] = searchObj.data.stream.userDefinedSchema ?? [];
    if (!defined.length) return null;
    return [...new Set([...defined, ...IMPORTANT_FIELDS])];
  });

  const persistColumns = () => {
    updatedLocalLogFilterField(searchObj.meta.searchMode === "spans" ? "spans" : "traces");
    options.onColumnsChange();
  };

  const toggleColumn = (field: PanelField) => {
    const columns = searchObj.data.stream.selectedFields;
    const index = columns.indexOf(field.name);
    if (index === -1) columns.push(field.name);
    else columns.splice(index, 1);
    persistColumns();
  };

  const resetColumns = () => {
    searchObj.data.stream.selectedFields = [
      ...DEFAULT_TRACE_COLUMNS[searchObj.meta.searchMode === "spans" ? "spans" : "traces"],
    ];
    persistColumns();
  };

  // Typed SQL may alias its stream; a JOIN's names may belong to either side, and the values API drops a WITH query's WHERE, so both read the stream.
  const typedSql = computed(() => {
    if (!searchObj.meta.sqlMode) return null;
    const analyzed = analyzeTracesSql(searchObj.data.editorValue ?? "", tracesParser.value);
    return analyzed.join || analyzed.withClause ? { where: "", fromClause: "" } : analyzed;
  });

  // The editor holds a bare WHERE; durations and span kinds are rewritten to what the stream stores.
  const whereClause = computed<string>(() =>
    typedSql.value
      ? typedSql.value.where
      : resolveTracesFilter(searchObj.data.editorValue, tracesParser.value, streamName.value),
  );

  // The scope goes on last, so neither the field's removal nor the span_kind rewrite touches it.
  const whereFor = (fieldName: string) =>
    withScope(
      typedSql.value
        ? stripTypedFieldCondition(whereClause.value, fieldName)
        : stripFieldCondition(whereClause.value, fieldName),
      activeScopePredicate(searchObj),
    );

  const fromFor = () => typedSql.value?.fromClause || undefined;

  // In SQL mode a tick shows only the conditions the panel wrote; typed ones are the user's.
  const ownSqlFilters = (): ActiveFilterValues => {
    const sql = String(searchObj.data.editorValue ?? "");
    const result: ActiveFilterValues = { include: {}, exclude: {} };
    for (const [field, own] of Object.entries(searchObj.data.stream.sqlFieldConditions ?? {})) {
      if (hasOwnCondition(sql, own.text)) {
        result[own.exclude ? "exclude" : "include"][field] = [...own.values];
      }
    }
    return result;
  };

  // Parsed from the raw editor text so span_kind labels match the labels the values list shows.
  const activeFilters = computed<ActiveFilterValues>(() => {
    if (searchObj.meta.sqlMode) return ownSqlFilters();
    const where = searchObj.data.editorValue?.trim();
    if (!where) return EMPTY_FILTERS;
    try {
      const sql = `SELECT * FROM "${streamName.value || "stream"}" WHERE ${where}`;
      const allColumn = store.state.zoConfig?.all_fields_name || "_all";
      return collectActiveValues(fnParsedSQL(sql)?.where, tracesFilterField(allColumn));
    } catch {
      return EMPTY_FILTERS;
    }
  });
  const activeIncludeValues = computed(() => activeFilters.value.include);
  const activeExcludeValues = computed(() => activeFilters.value.exclude);

  const {
    fieldValues,
    fieldValuesFinalizedValues,
    fetchFieldValues,
    fetchMoreFieldValues,
    isFetchSettled,
    rememberUnfiltered,
    restoreUnfiltered,
    forgetUnfiltered,
    cancelFieldStream,
    resetFieldValues,
  } = useFieldValuesStream(t);

  const expandedFields = ref<string[]>([]);
  const fromPerField = ref<Record<string, number>>({});
  const keywordPerField = ref<Record<string, string>>({});
  const pinnedRange = ref<Record<string, TimeRange>>({});
  // Pinned like the range, so load more, value search and the override page through the query the list opened with.
  const pinnedWhere = ref<Record<string, string>>({});
  const pinnedFrom = ref<Record<string, string | undefined>>({});

  const pinQuery = (name: string) => {
    pinnedRange.value[name] = currentRange();
    pinnedWhere.value[name] = whereFor(name);
    pinnedFrom.value[name] = fromFor();
  };

  const currentRange = (): TimeRange => ({
    startTime: searchObj.data.datetime.startTime,
    endTime: searchObj.data.datetime.endTime,
  });
  const rangeFor = (fieldName: string) => pinnedRange.value[fieldName] ?? currentRange();

  const isExpandable = (field: PanelField) =>
    field.isSchemaField && field.showValues && !(field.ftsKey && !showFtsFieldValues.value);

  // Duration renders percentiles through its own component, so no values request is sent for it.
  const hasOverride = (name: string) => name === DURATION_FIELD;

  const requestFieldValues = (
    fieldName: string,
    from: number,
    keyword: string,
    fetch: typeof fetchFieldValues = fetchFieldValues,
  ) => {
    const stream = streamName.value;
    const where = pinnedWhere.value[fieldName] ?? whereFor(fieldName);
    const range = rangeFor(fieldName);
    fetch(
      buildFieldValuesRequest({
        field: fieldName,
        stream,
        streamType: STREAM_TYPE,
        startTime: range.startTime,
        endTime: range.endTime,
        size: from + defaultValuesCount.value,
        from,
        where,
        fromClause: pinnedFrom.value[fieldName] ?? fromFor(),
        keyword,
      }),
    );
  };

  const startFieldValues = (fieldName: string, keyword: string, keepValues = false) => {
    fromPerField.value[fieldName] = 0;
    keywordPerField.value[fieldName] = keyword;
    delete fieldValuesFinalizedValues.value[fieldName];
    cancelFieldStream(fieldName);
    resetFieldValues(fieldName, true, keepValues);
    requestFieldValues(fieldName, 0, keyword);
  };

  const openField = (field: PanelField) => {
    if (!isExpandable(field)) return;
    const name = field.name;
    pinQuery(name);
    if (!expandedFields.value.includes(name))
      expandedFields.value = [...expandedFields.value, name];
    forgetUnfiltered(name);
    if (hasOverride(name)) return;
    startFieldValues(name, "");
  };

  const closeField = (name: string) => {
    cancelFieldStream(name);
    forgetUnfiltered(name);
    delete fromPerField.value[name];
    delete keywordPerField.value[name];
    delete pinnedRange.value[name];
    delete pinnedWhere.value[name];
    delete pinnedFrom.value[name];
    resetFieldValues(name);
    expandedFields.value = expandedFields.value.filter((id) => id !== name);
  };

  // Clearing the search puts back the list it started from, so no request is sent.
  const searchValues = (name: string, term: string) => {
    if (!term) {
      const from = restoreUnfiltered(name);
      if (from !== null) {
        fromPerField.value[name] = from;
        keywordPerField.value[name] = "";
        return;
      }
    } else {
      rememberUnfiltered(name, fromPerField.value[name] ?? 0);
    }
    startFieldValues(name, term);
  };

  const loadMoreValues = (name: string) => {
    if (!isFetchSettled(name)) return;
    const previous = fromPerField.value[name] ?? 0;
    const from = previous + defaultValuesCount.value;
    fromPerField.value[name] = from;
    requestFieldValues(name, from, keywordPerField.value[name] ?? "", (request, key) =>
      fetchMoreFieldValues(request, key, () => {
        fromPerField.value[name] = previous;
      }),
    );
  };

  // Open rows are keyed by field name, so they survive a stream switch; the override reloads from its request.
  const refreshOpenFieldValues = () => {
    if (!streamName.value) return;
    const names = new Set(flatFields.value.map((field) => field.name));
    for (const name of [...expandedFields.value]) {
      if (!names.has(name)) {
        closeField(name);
        continue;
      }
      pinQuery(name);
      if (hasOverride(name)) continue;
      startFieldValues(name, keywordPerField.value[name] ?? "", true);
    }
  };

  const valuesRequest = (field: PanelField): ValuesRequest => {
    const range = rangeFor(field.name);
    return {
      streamName: streamName.value,
      streamType: STREAM_TYPE,
      startTime: range.startTime,
      endTime: range.endTime,
      whereClause: pinnedWhere.value[field.name] ?? whereFor(field.name),
    };
  };

  const expansionOverride = (field: PanelField) =>
    hasOverride(field.name) ? DurationPercentilesBody : null;

  const valueMapper = (field: PanelField, values: FieldValueEntry[]) =>
    field.name === SPAN_KIND_FIELD ? mapSpanKindValues(values) : values;

  const valuesCaption = () => ({
    text: t("traces.results.fieldValueCountsCaption"),
    testId: "traces-field-values-count-caption",
  });

  const addFilter = (expression: string) => {
    searchObj.data.stream.addToFilter = expression;
  };

  const addValueFilters = (name: string, include: string[], exclude: string[]) => {
    // The search bar rewrites only the one SQL condition the panel wrote for the field.
    if (searchObj.meta.sqlMode) {
      const excluded = include.length === 0 && exclude.length > 0;
      searchObj.data.stream.sqlFieldFilter = {
        field: name,
        values: [...(excluded ? exclude : include)],
        exclude: excluded,
      };
      return;
    }
    const fieldType = flatFields.value.find((field) => field.name === name)?.dataType;
    const filter = buildTracesValueFilter(name, include, exclude, fieldType);
    if (filter) addFilter(filter);
  };

  const removeFieldFilter = (name: string) => {
    searchObj.data.stream.removeFilterField = name;
  };

  const filterBlockedReason = computed(() =>
    searchObj.meta.sqlMode ? t("traces.sqlMode.putConditionInWhere") : null,
  );

  const groupedField = computed<string>(() => searchObj.meta.groupBy ?? "");

  // Group by runs on the filter's span list only, and a header row or the timestamp names no group.
  const groupByOffered = (field: PanelField) =>
    searchObj.meta.searchMode === "spans" &&
    !searchObj.meta.sqlMode &&
    !field.isGroup &&
    field.isSchemaField &&
    field.name !== store.state.zoConfig?.timestamp_column;

  // Re-picking the grouped field would re-run the same query for the same groups.
  const groupBy = (name: string) => {
    if (name !== groupedField.value) options.onGroupByChange(name);
  };

  return {
    streams,
    selectedStreams,
    streamType,
    fields,
    loading,
    groupingMode: "semantic",
    search,
    collapsedGroups,
    expandedFields,
    fieldValues,
    activeIncludeValues,
    activeExcludeValues,
    tableColumns,
    definedSchemaFields,
    expansionOverride,
    valueMapper,
    valuesCaption,
    valuesRequest,
    selectStreams,
    changeStreamType: () => {},
    setSearch,
    toggleGroup,
    openField,
    closeField,
    searchValues,
    loadMoreValues,
    addFilter,
    addValueFilters,
    removeFieldFilter,
    filterBlockedReason,
    groupedField,
    groupByOffered,
    groupBy,
    toggleColumn,
    resetColumns,
    refreshOpenFieldValues,
  };
}

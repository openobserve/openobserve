// Copyright 2026 OpenObserve Inc.

import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import useTraces, { DEFAULT_TRACE_COLUMNS } from "@/composables/useTraces";
import useFieldValuesStream, { stripFieldCondition } from "@/composables/useFieldValuesStream";
import useFieldGrouping from "@/composables/useFieldGrouping";
import { logsUtils } from "@/composables/useLogs/logsUtils";
import { resolveTracesFilter } from "@/utils/traces/resolveTracesFilter";
import { SPAN_KIND_MAP } from "@/utils/traces/constants";
import { b64EncodeUnicode } from "@/utils/zincutils";
import { escapeSingleQuotes } from "@/utils/queryUtils";
import type { FieldObj } from "@/utils/fieldCategories";
import type { FieldValueEntry } from "@/composables/useFieldValuesStream";
import DurationPercentilesBody from "./DurationPercentilesBody.vue";
import { collectActiveValues, type ActiveFilterValues } from "./activeFilterValues";
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

// Column id "status" is the only one that differs from its stream field, span_status.
export const TRACES_LOCKED_FIELD_NAMES: Set<string> = new Set(
  DEFAULT_TRACE_COLUMNS.traces.map((id) => (id === "status" ? "span_status" : id)),
);

export interface TracesFieldSourceOptions {
  /** Routes a picker change through the page's confirm dialog before the stream is swapped. */
  onStreamChangeRequest: (name: string) => void;
  /** Rebuilds the result columns after the table column set changed. */
  onColumnsChange: () => void;
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
): string => {
  const condition = (op: string) => (value: string) =>
    `${fieldName}${op}'${escapeSingleQuotes(value)}'`;
  const nullCondition = `${fieldName} is null`;
  // A null row never equals the text 'null', so an included null is matched with `is null`.
  const included = include.map((value) =>
    isNullValue(value) ? nullCondition : condition("=")(value),
  );
  const excluded = exclude.map((value) =>
    isNullValue(value) ? `${fieldName} is not null` : condition("!=")(value),
  );
  return joinValueConditions(
    included,
    excluded,
    "lower",
    include.some(isNullValue) ? nullCondition : undefined,
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
  // Grouping is best effort: until the context lands the list stays flat.
  loadGroupingContext(STREAM_TYPE).catch(() => {});
  watch(
    () => store.state.selectedOrganization?.identifier,
    () => {
      resetGrouping();
      loadGroupingContext(STREAM_TYPE).catch(() => {});
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
    return groupFields(fieldObjs).map(
      (row) =>
        ({
          ...row,
          isGroup: !!row.label,
          groupName: row.label ? row.name : undefined,
        }) as PanelField,
    );
  });

  const loading = computed(
    () =>
      searchObj.loadingStream || (searchObj.meta.loadingFields && flatFields.value.length === 0),
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
    searchObj.data.stream.selectedFields = [];
    persistColumns();
  };

  // The editor holds a bare WHERE; durations and span kinds are rewritten to what the stream stores.
  const whereClause = computed<string>(() =>
    resolveTracesFilter(searchObj.data.editorValue, tracesParser.value, streamName.value),
  );

  const whereFor = (fieldName: string) => stripFieldCondition(whereClause.value, fieldName);

  // Parsed from the raw editor text so span_kind labels match the labels the values list shows.
  const activeFilters = computed<ActiveFilterValues>(() => {
    const where = searchObj.data.editorValue?.trim();
    if (!where) return EMPTY_FILTERS;
    try {
      const sql = `SELECT * FROM "${streamName.value || "stream"}" WHERE ${where}`;
      return collectActiveValues(fnParsedSQL(sql)?.where);
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
    const where = whereFor(fieldName);
    const range = rangeFor(fieldName);
    fetch({
      fields: [fieldName],
      size: from + defaultValuesCount.value,
      from,
      no_count: false,
      start_time: range.startTime,
      end_time: range.endTime,
      stream_name: stream,
      stream_type: STREAM_TYPE,
      sql: b64EncodeUnicode(`SELECT * FROM "${stream}"${where ? ` WHERE ${where}` : ""}`) || "",
      keyword: keyword || undefined,
      timeout: 30000,
      use_cache: (globalThis as { use_cache?: boolean }).use_cache ?? true,
    });
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
    pinnedRange.value[name] = currentRange();
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
      pinnedRange.value[name] = currentRange();
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
      whereClause: whereFor(field.name),
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
    const filter = buildTracesValueFilter(name, include, exclude);
    if (filter) addFilter(filter);
  };

  const removeFieldFilter = (name: string) => {
    searchObj.data.stream.removeFilterField = name;
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
    toggleColumn,
    resetColumns,
    refreshOpenFieldValues,
  };
}

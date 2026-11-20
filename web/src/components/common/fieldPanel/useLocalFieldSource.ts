// Copyright 2026 OpenObserve Inc.

import { computed, ref, watch, type Ref } from "vue";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import useFieldValuesStream, { stripFieldCondition } from "@/composables/useFieldValuesStream";
import useFieldGrouping from "@/composables/useFieldGrouping";
import { logsUtils } from "@/composables/useLogs/logsUtils";
import { filterForParsing } from "@/composables/useLogs/freeTextSearch";
import { b64EncodeUnicode } from "@/utils/zincutils";
import { escapeSingleQuotes } from "@/utils/queryUtils";
import type { FieldObj } from "@/utils/fieldCategories";
import { collectActiveValues, type ActiveFilterValues } from "./activeFilterValues";
import { MISSING_VALUE_KEY, isNullValue, joinValueConditions } from "./valueFilterExpression";
import type {
  FieldPanelSource,
  PanelField,
  StreamOption,
  ValueFilterMode,
  ValuesRequest,
} from "./fieldPanel.types";

export interface LocalFieldSourceOptions {
  /** Schema rows as the page loads them; `type`, `ftsKey`, `showValues` and `stream_name` are read when present. */
  fields: Ref<Record<string, unknown>[]>;
  streamName: Ref<string>;
  streamType: Ref<string>;
  /** Read at request time so a values query always uses the current range. */
  timeRange: () => { startTime: number; endTime: number };
  loading?: Ref<boolean>;
  /** User filter as a bare WHERE fragment. */
  query?: Ref<string>;
  /** User filter as a full SQL statement; its WHERE clause is taken through the parser. */
  sql?: Ref<string>;
  /** Page-owned WHERE fragment ANDed into every values query and never shown as a checked value. */
  baseFilter?: Ref<string>;
  streams?: Ref<StreamOption[]>;
  streamsLoading?: Ref<boolean>;
  onSelectStream?: (name: string) => void;
  onChangeStreamType?: (type: string) => void;
  onOpenStreams?: () => void;
  expansionOverride?: FieldPanelSource["expansionOverride"];
  /** The stream's `settings.defined_schema_fields`; null when the page has none. */
  definedSchemaFields?: Ref<string[] | null>;
  onAddFilter: (expression: string) => void;
  onRemoveFieldFilter: (name: string) => void;
}

const EMPTY_SET: Set<string> = new Set();

/** One SQL condition for a picked value; null-like values become IS NULL / IS NOT NULL. */
export const buildValueExpression = (
  fieldName: string,
  value: string,
  mode: ValueFilterMode,
): string => {
  if (isNullValue(value)) {
    return mode === "include" ? `${fieldName} IS NULL` : `${fieldName} IS NOT NULL`;
  }
  const literal = escapeSingleQuotes(value);
  return mode === "include" ? `${fieldName}='${literal}'` : `${fieldName}!='${literal}'`;
};

/** Joins the picked values of one field: includes OR together, excludes AND together and onto the includes. */
export const buildValueFilter = (fieldName: string, include: string[], exclude: string[]): string =>
  joinValueConditions(
    include.map((value) => buildValueExpression(fieldName, value, "include")),
    exclude.map((value) => buildValueExpression(fieldName, value, "exclude")),
    "lower",
    include.some(isNullValue)
      ? buildValueExpression(fieldName, MISSING_VALUE_KEY, "include")
      : undefined,
  );

export default function useLocalFieldSource(options: LocalFieldSourceOptions): FieldPanelSource {
  const store = useStore();
  const { t } = useI18nTyped();
  const { fnParsedSQL, fnUnparsedSQL } = logsUtils();

  const defaultValuesCount = computed<number>(
    () => store.state.zoConfig?.query_values_default_num || 10,
  );
  const showFtsFieldValues = computed<boolean>(
    () => store.state.zoConfig?.show_fts_field_values ?? false,
  );

  const flatFields = computed<PanelField[]>(() =>
    options.fields.value.map((field) => {
      const type = (field.dataType ?? field.type ?? "") as string;
      return {
        ...field,
        name: String(field.name),
        type,
        dataType: type,
        ftsKey: field.ftsKey === true,
        isSchemaField: field.isSchemaField !== false,
        showValues: field.showValues !== false,
        stream_name: typeof field.stream_name === "string" ? field.stream_name : undefined,
      } as PanelField;
    }),
  );

  const { contextLoaded, loadGroupingContext, groupFields } = useFieldGrouping({
    fallbackGroups: true,
  });

  watch(
    options.streamType,
    (type) => {
      // Grouping is best effort: until the context lands the list stays flat.
      loadGroupingContext(type || "logs").catch(() => {});
    },
    { immediate: true },
  );

  const fields = computed<PanelField[]>(() => {
    if (!contextLoaded.value) return flatFields.value;
    const fieldObjs: FieldObj[] = flatFields.value.map((field) => ({
      ...field,
      isInterestingField: false,
      group: "",
      streams: field.streams ?? [],
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

  const search = ref("");
  const setSearch = (value: string) => {
    search.value = value;
  };

  // Collapse state is keyed by stream so a remount or the mobile drawer keeps it.
  const collapsedByStream = ref<Record<string, Set<string>>>({});
  const streamKey = computed(() => `${options.streamType.value}:${options.streamName.value}`);
  const collapsedGroups = computed<Set<string>>({
    get: () => collapsedByStream.value[streamKey.value] ?? EMPTY_SET,
    set: (groups) => {
      collapsedByStream.value[streamKey.value] = groups;
    },
  });
  const toggleGroup = (group: string) => {
    const next = new Set(collapsedGroups.value);
    if (next.has(group)) next.delete(group);
    else next.add(group);
    collapsedGroups.value = next;
  };

  const whereClause = computed<string>(() => {
    if (options.query) return options.query.value?.trim() ?? "";
    const sql = options.sql?.value?.trim();
    if (!sql) return "";
    const parsed = fnParsedSQL(sql);
    if (!parsed?.where) return "";
    const rendered = fnUnparsedSQL({
      type: "select",
      columns: [{ expr: { type: "column_ref", table: null, column: "*" }, as: null }],
      from: [{ db: null, table: "x", as: null }],
      where: parsed.where,
    });
    const match = rendered.match(/\bWHERE\b\s+([\s\S]+)$/i);
    return match ? match[1].replace(/`/g, '"').trim() : "";
  });

  const baseFilter = computed(() => options.baseFilter?.value?.trim() ?? "");

  const activeFilters = computed<ActiveFilterValues>(() => {
    const where = whereClause.value;
    if (!where) return { include: {}, exclude: {} };
    const names = new Set(flatFields.value.map((field) => field.name));
    try {
      return collectActiveValues(
        fnParsedSQL(`select * from stream where ${filterForParsing(where, names)}`)?.where,
      );
    } catch {
      // A half-typed filter has no checked values.
      return { include: {}, exclude: {} };
    }
  });

  const activeIncludeValues = computed(() => activeFilters.value.include);
  const activeExcludeValues = computed(() => activeFilters.value.exclude);

  // Base filter first, user query parenthesised: a top-level OR must not swallow the base filter.
  const whereFor = (fieldName: string): string => {
    const user = stripFieldCondition(whereClause.value, fieldName);
    if (baseFilter.value && user) return `${baseFilter.value} AND (${user})`;
    return baseFilter.value || user;
  };

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
    cancelAllFieldStreams,
    resetFieldValues,
  } = useFieldValuesStream(t);

  const expandedFields = ref<string[]>([]);
  const sizePerField = ref<Record<string, number>>({});
  const keywordPerField = ref<Record<string, string>>({});
  const pinnedRange = ref<Record<string, { startTime: number; endTime: number }>>({});

  const rangeFor = (fieldName: string) => pinnedRange.value[fieldName] ?? options.timeRange();

  const streamFor = (fieldName: string) => {
    const row = flatFields.value.find((field) => field.name === fieldName);
    return row?.stream_name || options.streamName.value;
  };

  const requestFieldValues = (
    fieldName: string,
    size: number,
    keyword?: string,
    fetch: typeof fetchFieldValues = fetchFieldValues,
  ) => {
    const stream = streamFor(fieldName);
    const where = whereFor(fieldName);
    const range = rangeFor(fieldName);
    fetch({
      fields: [fieldName],
      size,
      no_count: false,
      start_time: range.startTime,
      end_time: range.endTime,
      stream_name: stream,
      stream_type: options.streamType.value,
      sql: b64EncodeUnicode(`SELECT * FROM "${stream}"${where ? ` WHERE ${where}` : ""}`) || "",
      keyword: keyword || undefined,
      timeout: 30000,
      use_cache: (globalThis as { use_cache?: boolean }).use_cache ?? true,
    });
  };

  const isExpandable = (field: PanelField) =>
    field.isSchemaField && field.showValues && !(field.ftsKey && !showFtsFieldValues.value);

  // An override component (traces duration) runs its own query, so no values request is sent for it.
  const hasOverride = (name: string) => {
    const field = flatFields.value.find((row) => row.name === name);
    return !!field && !!options.expansionOverride?.(field);
  };

  const openField = (field: PanelField) => {
    if (!isExpandable(field)) return;
    const name = field.name;
    cancelFieldStream(name);
    forgetUnfiltered(name);
    sizePerField.value[name] = defaultValuesCount.value;
    keywordPerField.value[name] = "";
    pinnedRange.value[name] = options.timeRange();
    if (!expandedFields.value.includes(name))
      expandedFields.value = [...expandedFields.value, name];
    if (hasOverride(name)) return;
    resetFieldValues(name, true);
    requestFieldValues(name, defaultValuesCount.value);
  };

  const closeField = (name: string) => {
    cancelFieldStream(name);
    forgetUnfiltered(name);
    delete sizePerField.value[name];
    delete keywordPerField.value[name];
    delete pinnedRange.value[name];
    resetFieldValues(name);
    expandedFields.value = expandedFields.value.filter((id) => id !== name);
  };

  // Clearing the search puts back the list it started from, so no request is sent.
  const searchValues = (name: string, term: string) => {
    keywordPerField.value[name] = term;
    if (!term) {
      const size = restoreUnfiltered(name);
      if (size !== null) {
        sizePerField.value[name] = size;
        return;
      }
    } else {
      rememberUnfiltered(name, sizePerField.value[name] ?? defaultValuesCount.value);
    }
    sizePerField.value[name] = defaultValuesCount.value;
    delete fieldValuesFinalizedValues.value[name];
    cancelFieldStream(name);
    resetFieldValues(name, true);
    requestFieldValues(name, defaultValuesCount.value, term);
  };

  const loadMoreValues = (name: string) => {
    if (!isFetchSettled(name)) return;
    const previous = sizePerField.value[name] ?? defaultValuesCount.value;
    const size = previous + defaultValuesCount.value;
    sizePerField.value[name] = size;
    requestFieldValues(name, size, keywordPerField.value[name], (request, key) =>
      fetchMoreFieldValues(request, key, () => {
        sizePerField.value[name] = previous;
      }),
    );
  };

  // Some pages pass live editor text as the query, so only the base filter and range refetch open lists.
  const refetchOpenFields = () => {
    for (const name of expandedFields.value) {
      pinnedRange.value[name] = options.timeRange();
      if (hasOverride(name)) continue;
      cancelFieldStream(name);
      delete fieldValuesFinalizedValues.value[name];
      resetFieldValues(name, true, true);
      requestFieldValues(
        name,
        sizePerField.value[name] ?? defaultValuesCount.value,
        keywordPerField.value[name],
      );
    }
  };

  watch([baseFilter, () => options.timeRange()], refetchOpenFields);

  const resetValues = () => {
    cancelAllFieldStreams();
    expandedFields.value = [];
    sizePerField.value = {};
    keywordPerField.value = {};
    pinnedRange.value = {};
    fieldValues.value = {};
  };

  watch([options.streamName, options.streamType], resetValues);

  const valuesRequest = (field: PanelField): ValuesRequest => {
    const range = rangeFor(field.name);
    return {
      streamName: streamFor(field.name),
      streamType: options.streamType.value,
      startTime: range.startTime,
      endTime: range.endTime,
      whereClause: whereFor(field.name),
    };
  };

  const addFilter = (expression: string) => options.onAddFilter(expression);

  const addValueFilters = (name: string, include: string[], exclude: string[]) => {
    const filter = buildValueFilter(name, include, exclude);
    if (filter) options.onAddFilter(filter);
  };

  const removeFieldFilter = (name: string) => options.onRemoveFieldFilter(name);

  return {
    streams: options.streams ?? ref([]),
    streamsLoading: options.streamsLoading,
    selectedStreams: computed(() => (options.streamName.value ? [options.streamName.value] : [])),
    streamType: options.streamType,
    fields,
    loading: options.loading ?? ref(false),
    groupingMode: "semantic",
    search,
    collapsedGroups,
    expandedFields,
    fieldValues,
    activeIncludeValues,
    activeExcludeValues,
    expansionOverride: options.expansionOverride,
    definedSchemaFields: options.definedSchemaFields,
    valuesRequest,
    selectStreams: (names) => options.onSelectStream?.(names[0] ?? ""),
    changeStreamType: (type) => options.onChangeStreamType?.(type),
    setSearch,
    toggleGroup,
    refreshStreams: options.onOpenStreams,
    openField,
    closeField,
    searchValues,
    loadMoreValues,
    addFilter,
    addValueFilters,
    removeFieldFilter,
  };
}

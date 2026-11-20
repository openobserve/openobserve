// Copyright 2026 OpenObserve Inc.

import { computed, ref, watch, type ComputedRef } from "vue";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import useFieldValuesStream from "@/composables/useFieldValuesStream";
import { b64EncodeUnicode } from "@/utils/zincutils";
import type { PanelField, ValuesRequest } from "../fieldPanel.types";
import type { DashboardFieldRow } from "./dashboardFieldRows";
import type { DashboardPanelState } from "./dashboardPanelState";
import {
  builderWhereFor,
  collectValueFilters,
  removeValueFilter,
  writeValueFilter,
} from "./dashboardValueFilters";

interface TimeRange {
  start_time: number;
  end_time: number;
}

export interface DashboardValuesOptions {
  panel: DashboardPanelState;
  rows: ComputedRef<DashboardFieldRow[]>;
  /** The query is built from fields, so its filter scopes the values and a picked value lands in it. */
  builderMode: ComputedRef<boolean>;
  /** The panel's range in microseconds, or null before the page's date picker has reported one. */
  timeRange: () => TimeRange | null;
}

export function useDashboardValuesSource(options: DashboardValuesOptions) {
  const { panel } = options;
  const store = useStore();
  const { t } = useI18nTyped();
  const pageSize = () => store.state.zoConfig?.query_values_default_num || 10;

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

  const currentQuery = () => panel.data.queries[panel.layout.currentQueryIndex];
  const rowByKey = (key: string) => options.rows.value.find((row) => row._uid === key);

  const expandedFields = ref<string[]>([]);
  const sizePerField = ref<Record<string, number>>({});
  const keywordPerField = ref<Record<string, string>>({});
  const pinnedRange = ref<Record<string, TimeRange>>({});
  // What each open field's values were fetched for, so a change to any of it fetches them again.
  const fetchedContext: Record<string, string> = {};

  // The builder filter speaks in join aliases once the query joins, which a single-stream values query cannot resolve.
  const whereFor = (row: DashboardFieldRow): string => {
    if (!options.builderMode.value || currentQuery()?.joins?.length) return "";
    return builderWhereFor(panel, row.name);
  };

  const requestFieldValues = (
    row: DashboardFieldRow,
    size: number,
    keyword?: string,
    fetch: typeof fetchFieldValues = fetchFieldValues,
  ) => {
    const range = pinnedRange.value[row._uid];
    const stream = row.stream ?? "";
    // Without a range the request would be refused, so the list settles empty instead.
    if (!range || !stream) {
      resetFieldValues(row._uid);
      return;
    }
    const where = whereFor(row);
    fetch(
      {
        fields: [row.name],
        size,
        no_count: false,
        start_time: range.start_time,
        end_time: range.end_time,
        stream_name: stream,
        stream_type: currentQuery()?.fields?.stream_type ?? "logs",
        sql: b64EncodeUnicode(`SELECT * FROM "${stream}"${where ? ` WHERE ${where}` : ""}`) || "",
        keyword: keyword || undefined,
        timeout: 30000,
        use_cache: (globalThis as { use_cache?: boolean }).use_cache ?? true,
      },
      row._uid,
    );
  };

  const contextOf = (row: DashboardFieldRow) => {
    const range = options.timeRange();
    const streamType = currentQuery()?.fields?.stream_type ?? "";
    return [row.stream, streamType, whereFor(row), range?.start_time, range?.end_time].join("|");
  };

  const startFieldValues = (row: DashboardFieldRow, keyword: string, keepValues = false) => {
    const key = row._uid;
    fetchedContext[key] = contextOf(row);
    keywordPerField.value[key] = keyword;
    sizePerField.value[key] = pageSize();
    delete fieldValuesFinalizedValues.value[key];
    cancelFieldStream(key);
    resetFieldValues(key, true, keepValues);
    requestFieldValues(row, pageSize(), keyword);
  };

  const openField = (field: PanelField) => {
    const row = field as DashboardFieldRow;
    const key = row._uid;
    const range = options.timeRange();
    if (range) pinnedRange.value[key] = range;
    if (!expandedFields.value.includes(key)) expandedFields.value = [...expandedFields.value, key];
    forgetUnfiltered(key);
    startFieldValues(row, "");
  };

  const closeField = (key: string) => {
    cancelFieldStream(key);
    forgetUnfiltered(key);
    delete sizePerField.value[key];
    delete keywordPerField.value[key];
    delete pinnedRange.value[key];
    delete fetchedContext[key];
    resetFieldValues(key);
    expandedFields.value = expandedFields.value.filter((id) => id !== key);
  };

  // Clearing the search puts back the list it started from, so no request is sent.
  const searchValues = (key: string, term: string) => {
    const row = rowByKey(key);
    if (!row) return;
    if (!term) {
      const size = restoreUnfiltered(key);
      if (size !== null) {
        sizePerField.value[key] = size;
        keywordPerField.value[key] = "";
        return;
      }
    } else {
      rememberUnfiltered(key, sizePerField.value[key] ?? pageSize());
    }
    startFieldValues(row, term);
  };

  const loadMoreValues = (key: string) => {
    const row = rowByKey(key);
    if (!row || !isFetchSettled(key)) return;
    const previous = sizePerField.value[key] ?? pageSize();
    const size = previous + pageSize();
    sizePerField.value[key] = size;
    requestFieldValues(row, size, keywordPerField.value[key], (request, stateKey) =>
      fetchMoreFieldValues(request, stateKey, () => {
        sizePerField.value[key] = previous;
      }),
    );
  };

  // A row that left the list closes; one whose stream, type, filter, joins or range moved is fetched again.
  const refreshOpenFields = () => {
    for (const key of expandedFields.value) {
      const row = rowByKey(key);
      if (!row) {
        closeField(key);
        continue;
      }
      if (contextOf(row) === fetchedContext[key]) continue;
      const range = options.timeRange();
      if (range) pinnedRange.value[key] = range;
      else delete pinnedRange.value[key];
      startFieldValues(row, keywordPerField.value[key] ?? "", true);
    }
  };

  watch(
    () =>
      expandedFields.value
        .map((key) => {
          const row = rowByKey(key);
          return row ? `${key}=${contextOf(row)}` : key;
        })
        .join("\n"),
    refreshOpenFields,
  );

  const valuesRequest = (field: PanelField): ValuesRequest => {
    const row = field as DashboardFieldRow;
    const range = pinnedRange.value[row._uid] ?? options.timeRange();
    return {
      streamName: row.stream ?? "",
      streamType: currentQuery()?.fields?.stream_type ?? "logs",
      startTime: range?.start_time ?? 0,
      endTime: range?.end_time ?? 0,
      whereClause: whereFor(row),
    };
  };

  const columnOf = (row: DashboardFieldRow) => ({ field: row.name, streamAlias: row.streamAlias });

  const activeFilters = computed(() =>
    collectValueFilters(
      currentQuery()?.fields?.filter,
      options.rows.value
        .filter((row) => !row.isGroup && row.isSchemaField)
        .map((row) => ({ key: row._uid, column: columnOf(row) })),
    ),
  );

  const addValueFilters = (key: string, include: string[], exclude: string[]) => {
    const row = rowByKey(key);
    const query = currentQuery();
    if (!row || !query || (!include.length && !exclude.length)) return;
    writeValueFilter(query, columnOf(row), include, exclude);
  };

  const removeFieldFilter = (key: string) => {
    const row = rowByKey(key);
    const query = currentQuery();
    if (row && query) removeValueFilter(query, columnOf(row));
  };

  return {
    expandedFields,
    fieldValues,
    activeIncludeValues: computed(() => activeFilters.value.include),
    activeExcludeValues: computed(() => activeFilters.value.exclude),
    valuesRequest,
    openField,
    closeField,
    searchValues,
    loadMoreValues,
    addValueFilters,
    removeFieldFilter,
  };
}

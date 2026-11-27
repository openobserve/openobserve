// Copyright 2026 OpenObserve Inc.

import { computed, ref, watch, type Ref } from "vue";
import { useStore } from "vuex";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { toast } from "@/lib/feedback/Toast/useToast";
import { createLimiter, runSql } from "@/composables/security/useSecurityStreamPlans";
import {
  textMatchClause,
  topValuesSql,
  whereParts,
  type FieldFilter,
  type SeverityValue,
} from "@/utils/security/eventQuery";
import { groupFields } from "@/utils/security/fieldGroups";
import { ALL_SOURCES } from "@/utils/security/huntLink";
import {
  activeSqlValueFilters,
  activeValueFilters,
  applyValueFilters,
  isValueFilter,
  valueEntry,
  writeSqlValueFilters,
} from "./security/securityValueFilters";
import useFetchedFieldValues, { type FieldValuesFetcher } from "./useFetchedFieldValues";
import type {
  FieldGroup,
  FieldPanelCapabilities,
  FieldPanelEmptyTexts,
  FieldPanelSource,
  PanelField,
  ValuesRequest,
} from "./fieldPanel.types";
import type { ActiveFilterValues } from "./activeFilterValues";

export const SECURITY_FIELD_PANEL_CAPABILITIES: FieldPanelCapabilities = {
  streamPicker: "none",
  values: true,
  drag: false,
  actions: ["toggle-column"],
  footerToggles: [],
  highlightColumns: true,
};

const STREAM_TYPE = "logs";

const EMPTY_SET: Set<string> = new Set();

export interface SecuritySchemaField {
  name: string;
  ftype: string;
}

export interface SecurityFieldSourceOptions {
  schemaFields: Ref<SecuritySchemaField[]>;
  /** The picked stream's `settings.defined_schema_fields`; null when it has none. */
  definedSchemaFields?: Ref<string[] | null>;
  /** The picked stream; `ALL_SOURCES` while hunting across every source. */
  stream: Ref<string | null>;
  loading: Ref<boolean>;
  /** Read at request time, in microseconds. */
  timeRange: () => { start: number; end: number };
  severitySql: Ref<string | null>;
  severity: Ref<SeverityValue[]>;
  fieldFilters: Ref<FieldFilter[]>;
  sqlMode: Ref<boolean>;
  sqlQuery: Ref<string>;
  /** Raw fields the table shows as columns right now. */
  tableColumns: Ref<string[]>;
  /** A field whose column the panel may not add or drop in the current view. */
  isColumnLocked: (name: string) => boolean;
  /** Why a locked field is always shown, for the disabled eye; undefined offers no eye. */
  columnLockedReason?: (name: string) => I18nText | undefined;
  onToggleColumn: (name: string) => void;
  /** Runs the search after the panel changed the filters or the query. */
  onFiltersChange: () => void;
}

export interface SecurityFieldSource extends FieldPanelSource {
  /** Fetches every open field again; the page calls it after each full search. */
  refreshOpenFieldValues: () => void;
}

export default function useSecurityFieldSource(
  options: SecurityFieldSourceOptions,
): SecurityFieldSource {
  const store = useStore();
  const { t } = useI18nTyped();

  const defaultValuesCount = computed<number>(
    () => store.state.zoConfig?.query_values_default_num || 10,
  );

  const isHunt = computed(() => options.stream.value === ALL_SOURCES);
  const streamName = computed(() => (isHunt.value ? "" : (options.stream.value ?? "")));

  // Fields differ per source, so a hunt across all of them lists none.
  const fields = computed<PanelField[]>(() => {
    if (!streamName.value) return [];
    return options.schemaFields.value.map((field) => ({
      name: field.name,
      type: field.ftype,
      dataType: field.ftype,
      ftsKey: false,
      isSchemaField: true,
      showValues: true,
      columnLocked: options.isColumnLocked(field.name),
      columnLockedReason: options.columnLockedReason?.(field.name),
    }));
  });

  const definedSchemaFields = computed<string[] | null>(() =>
    streamName.value ? (options.definedSchemaFields?.value ?? null) : null,
  );

  const groupFn = (rows: PanelField[]): FieldGroup[] =>
    groupFields(rows).map(({ group, fields: grouped }) => ({
      key: group,
      label: t(`siem.fieldGroup.${group}`),
      fields: grouped,
    }));

  // Owned here, not by the panel, so collapsing the sidebar to nothing keeps them.
  const search = ref("");
  const setSearch = (value: string) => {
    search.value = value;
  };

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

  const emptyState = computed<FieldPanelEmptyTexts>(() => ({
    noStream: isHunt.value ? t("siem.events.hunt.noFields") : t("siem.events.selectStreamFirst"),
    noMatch: t("siem.events.noFields"),
  }));

  // Bumped on a refused pick so the panel reads its ticks again, dropping the refused one.
  const refusedPicks = ref(0);

  const writesSql = () => options.sqlMode.value && !!options.sqlQuery.value.trim();

  const activeFilters = computed<ActiveFilterValues>(() => {
    if (!writesSql()) return activeValueFilters(options.fieldFilters.value);
    void refusedPicks.value;
    return activeSqlValueFilters(options.sqlQuery.value);
  });
  const activeIncludeValues = computed(() => activeFilters.value.include);
  const activeExcludeValues = computed(() => activeFilters.value.exclude);

  const addValueFilters = (name: string, include: string[], exclude: string[]) => {
    if (writesSql()) {
      const next = writeSqlValueFilters(options.sqlQuery.value, name, include, exclude);
      if (next === null) {
        refusedPicks.value += 1;
        // Never silently drop a hand-written query for builder filters.
        toast({ variant: "warning", message: t("siem.events.pivotSqlUnsupported") });
        return;
      }
      options.sqlQuery.value = next;
    } else {
      options.fieldFilters.value = applyValueFilters(
        options.fieldFilters.value,
        name,
        include,
        exclude,
      );
      options.sqlMode.value = false;
    }
    options.onFiltersChange();
  };

  const removeFieldFilter = (name: string) => addValueFilters(name, [], []);

  // Several open fields share the search service's cap on queries in flight.
  const limit = createLimiter();
  const pinnedRange = ref<Record<string, { start: number; end: number }>>({});
  const rangeFor = (name: string) => pinnedRange.value[name] ?? options.timeRange();

  // A hand-written query cannot be narrowed safely, so its values cover the whole stream.
  const currentWhereParts = (name: string): string[] => {
    if (options.sqlMode.value) return [];
    return whereParts({
      severitySql: options.severitySql.value,
      severity: options.severity.value,
      filters: options.fieldFilters.value.filter(
        (filter) => filter.field !== name || !isValueFilter(filter),
      ),
    });
  };

  // Load more and value search reuse the list's WHERE, so every page describes the query of the first.
  const pinnedWhere = ref<Record<string, string[]>>({});
  const wherePartsFor = (name: string): string[] => [
    ...(pinnedWhere.value[name] ?? currentWhereParts(name)),
  ];
  const pin = (name: string) => {
    pinnedRange.value[name] = options.timeRange();
    pinnedWhere.value[name] = currentWhereParts(name);
  };

  // `_values_stream` ignores the Security read scope, so values go through `_search_stream` like the rows.
  const fetchValues: FieldValuesFetcher = ({ field, size, keyword, signal }) =>
    limit(async () => {
      // A request closed while it waited for a slot is never sent.
      if (signal.aborted) throw new DOMException("The search was aborted", "AbortError");
      const parts = wherePartsFor(field);
      if (keyword) parts.push(textMatchClause(field, keyword));
      const range = rangeFor(field);
      const { hits } = await runSql(
        store.state.selectedOrganization.identifier,
        topValuesSql(streamName.value, parts, field, size + 1),
        range.start,
        range.end,
        size + 1,
        { signal },
      );
      return {
        values: hits.slice(0, size).map((hit) => valueEntry(hit.zo_value, Number(hit.zo_n ?? 0))),
        hasMore: hits.length > size,
      };
    });

  const values = useFetchedFieldValues(fetchValues, () => defaultValuesCount.value, t);
  const expandedFields = ref<string[]>([]);

  const openField = (field: PanelField) => {
    if (!streamName.value) return;
    const name = field.name;
    pin(name);
    if (!expandedFields.value.includes(name)) {
      expandedFields.value = [...expandedFields.value, name];
    }
    values.open(name);
  };

  const closeField = (name: string) => {
    values.close(name);
    delete pinnedRange.value[name];
    delete pinnedWhere.value[name];
    expandedFields.value = expandedFields.value.filter((id) => id !== name);
  };

  const refreshOpenFieldValues = () => {
    if (!streamName.value) return;
    const names = new Set(fields.value.map((field) => field.name));
    for (const name of [...expandedFields.value]) {
      if (!names.has(name)) {
        closeField(name);
        continue;
      }
      pin(name);
      values.refresh(name);
    }
  };

  // Open lists, their requests and their filter bookkeeping belong to the stream they came from.
  watch(options.stream, () => {
    values.reset();
    expandedFields.value = [];
    pinnedRange.value = {};
    pinnedWhere.value = {};
  });

  const valuesRequest = (field: PanelField): ValuesRequest => {
    const range = rangeFor(field.name);
    return {
      streamName: streamName.value,
      streamType: STREAM_TYPE,
      startTime: range.start,
      endTime: range.end,
      whereClause: wherePartsFor(field.name).join(" AND "),
    };
  };

  const valuesCaption = () =>
    options.sqlMode.value
      ? {
          text: t("siem.events.topValuesWholeStream"),
          testId: "security-events-values-whole-stream",
        }
      : null;

  const toggleColumn = (field: PanelField) => options.onToggleColumn(field.name);

  return {
    streams: ref([]),
    selectedStreams: computed(() => (streamName.value ? [streamName.value] : [])),
    streamType: ref(STREAM_TYPE),
    fields,
    loading: options.loading,
    groupingMode: "custom",
    groupFn,
    search,
    collapsedGroups,
    expandedFields,
    fieldValues: values.fieldValues,
    activeIncludeValues,
    activeExcludeValues,
    tableColumns: options.tableColumns,
    definedSchemaFields,
    emptyState,
    valuesCaption,
    valuesRequest,
    selectStreams: () => {},
    changeStreamType: () => {},
    setSearch,
    toggleGroup,
    openField,
    closeField,
    searchValues: values.search,
    loadMoreValues: values.loadMore,
    addFilter: () => {},
    addValueFilters,
    removeFieldFilter,
    toggleColumn,
    refreshOpenFieldValues,
  };
}

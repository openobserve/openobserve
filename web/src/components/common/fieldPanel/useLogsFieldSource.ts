// Copyright 2026 OpenObserve Inc.

import { computed, ref, watch, type ComputedRef } from "vue";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import useLogs from "@/composables/useLogs";
import { logsUtils } from "@/composables/useLogs/logsUtils";
import { useSearchBar } from "@/composables/useLogs/useSearchBar";
import { useSearchStream } from "@/composables/useLogs/useSearchStream";
import { searchState } from "@/composables/useLogs/searchState";
import { useStreamFields } from "@/composables/useLogs/useStreamFields";
import { filterForParsing } from "@/composables/useLogs/freeTextSearch";
import { quoteSqlIdentifierIfNeeded } from "@/utils/query/sqlIdentifiers";
import { emptyValueConditions, emptyValueFieldType } from "@/utils/logs/breakdownFilter";
import { toast } from "@/lib/feedback/Toast/useToast";
import { collectActiveValues, type ActiveFilterValues } from "./activeFilterValues";
import { isNullValue, joinValueConditions } from "./valueFilterExpression";
import type {
  FieldPanelCapabilities,
  FieldPanelSource,
  PanelField,
  ValueFilterMode,
} from "./fieldPanel.types";
import { useLogsPickerSource, type QuickPickGroup } from "./logs/useLogsPickerSource";
import { createValuesPlanner } from "./logs/logsValuesPlan";
import { useLogsValuesSource } from "./logs/useLogsValuesSource";
import { useLogsInterestingFields } from "./logs/useLogsInterestingFields";
import { useLogsFooterTabs, LOGS_FIELD_PANEL_CAPABILITIES } from "./logs/useLogsFooterTabs";

export { LOGS_FIELD_PANEL_CAPABILITIES };
export { QUICK_PICK_LIMIT } from "./logs/useLogsPickerSource";
export { quoteSchemaFieldsInWhere } from "./logs/logsValuesPlan";

const EMPTY_SET: Set<string> = new Set();

const EMPTY_FILTERS: ActiveFilterValues = { include: {}, exclude: {} };

export interface LogsFieldSourceOptions {
  /** Rewrites the SQL SELECT list after a field joined or left the interesting set. */
  onInterestingFieldChange: (field: PanelField, isFieldExistInSQL: boolean) => void;
}

export interface LogsFieldSource extends FieldPanelSource {
  capabilities: ComputedRef<FieldPanelCapabilities>;
  showBackToLogs: ComputedRef<boolean>;
  backToLogs: () => void;
  quickPickGroups: ComputedRef<QuickPickGroup[]>;
  quickPickMoreCount: ComputedRef<number>;
  quickSelectStream: (name: string) => void;
  onPickerHeaderAction: (option: { value?: unknown }) => void;
}

const toPanelField = (row: Record<string, unknown>): PanelField => {
  const type = String(row.dataType ?? row.type ?? "");
  return {
    ...row,
    name: String(row.name),
    type,
    dataType: type,
    ftsKey: row.ftsKey === true,
    isSchemaField: row.isSchemaField !== false,
    showValues: row.showValues !== false,
    isGroup: row.label === true,
    groupName: row.label === true ? String(row.name) : undefined,
  } as PanelField;
};

export default function useLogsFieldSource(options: LogsFieldSourceOptions): LogsFieldSource {
  const store = useStore();
  const { t } = useI18nTyped();
  const { reorderSelectedFields, getFilterExpressionByFieldType, extractValueQuery } = useLogs(t);
  const { filterHitsColumns, extractFields, getStreamList } = useStreamFields();
  const { searchObj, streamSchemaFieldsIndexMapping } = searchState();
  const { onStreamChange } = useSearchBar(t);
  const { validateFilterForMultiStream } = useSearchStream(t);
  const { fnParsedSQL, fnUnparsedSQL, updatedLocalLogFilterField } = logsUtils();

  const timestampColumn = () => store.state.zoConfig?.timestamp_column || "_timestamp";

  const picker = useLogsPickerSource({ searchObj, onStreamChange, getStreamList });
  const { selectedStreams, streamType } = picker;
  const streamsKey = () => `${streamType.value}:${selectedStreams.value.join(",")}`;

  const footer = useLogsFooterTabs({
    searchObj,
    userDefinedSchemasEnabled: () => store.state.zoConfig.user_defined_schemas_enabled === true,
    defaultFieldList: () => store.state.zoConfig.log_page_default_field_list,
    streamSchemaFieldsIndexMapping,
    extractFields: () => extractFields(),
  });

  const fields = computed<PanelField[]>(() => {
    const source = footer.showOnlyInterestingFields.value
      ? searchObj.data.stream.selectedInterestingStreamFields
      : searchObj.data.stream.selectedStreamFields;
    return (source ?? []).map(toPanelField);
  });

  const fieldsStreamsKey = ref("");
  // A stream switch first assigns the raw schema, then the grouped list; only the settled list belongs to the streams.
  watch(
    () =>
      [
        searchObj.data.stream.selectedStreamFields,
        searchObj.loadingStream || searchObj.loadingFieldGroups,
      ] as const,
    ([rows, busy]) => {
      if (rows?.length && !busy) fieldsStreamsKey.value = streamsKey();
    },
    { immediate: true },
  );
  // A re-run refetches the schema of the same streams, so their fields stay up instead of flashing to the skeleton.
  const loading = computed(
    () =>
      (searchObj.loadingStream || searchObj.loadingFieldGroups) &&
      (!searchObj.data.stream.selectedStreamFields?.length ||
        fieldsStreamsKey.value !== streamsKey()),
  );

  const search = computed<string>({
    get: () => searchObj.data.stream.filterField,
    set: (value) => {
      searchObj.data.stream.filterField = value;
    },
  });

  // Collapse state is keyed by the stream set so a remount or the mobile drawer keeps it.
  const collapsedByStreams = ref<Record<string, Set<string>>>({});
  const collapsedGroups = computed<Set<string>>({
    get: () => collapsedByStreams.value[streamsKey()] ?? EMPTY_SET,
    set: (groups) => {
      collapsedByStreams.value[streamsKey()] = groups;
    },
  });
  const toggleGroup = (group: string) => {
    const next = new Set(collapsedGroups.value);
    if (next.has(group)) next.delete(group);
    else next.add(group);
    collapsedGroups.value = next;
  };

  const tableColumns = computed<string[]>(() => searchObj.data.stream.selectedFields);

  const toggleColumn = (field: PanelField) => {
    // An explicit pick clears the system-pick marker so the selection persists.
    searchObj.meta.isFtsDefaultColumn = false;
    let selected: string[] = reorderSelectedFields();
    if (selected.includes(field.name)) selected = selected.filter((v) => v !== field.name);
    else selected.push(field.name);
    searchObj.data.stream.selectedFields = selected.filter((v) => v !== timestampColumn());
    searchObj.organizationIdentifier = store.state.selectedOrganization.identifier;
    updatedLocalLogFilterField();
    filterHitsColumns();
  };

  const resetColumns = () => {
    searchObj.meta.isFtsDefaultColumn = false;
    searchObj.data.stream.selectedFields = [];
    updatedLocalLogFilterField();
  };

  const { toggleInteresting } = useLogsInterestingFields({
    searchObj,
    streamSchemaFieldsIndexMapping,
    timestampColumn,
    defaultInterestingFields: () =>
      new Set<string>(store.state?.zoConfig?.default_quick_mode_fields || []),
    showOnlyInterestingFields: footer.showOnlyInterestingFields,
    onChange: options.onInterestingFieldChange,
  });

  const sidebarFieldNames = computed(
    () =>
      new Set<string>([
        ...selectedStreams.value,
        ...searchObj.data.stream.selectedStreamFields.map((field: { name: string }) => field.name),
      ]),
  );

  const activeFilters = computed<ActiveFilterValues>(() => {
    const query = searchObj.data.query;
    if (!query) return EMPTY_FILTERS;
    try {
      const sql = searchObj.meta.sqlMode
        ? query
        : `select * from stream where ${filterForParsing(query, sidebarFieldNames.value)}`;
      return collectActiveValues(fnParsedSQL(sql)?.where);
    } catch {
      // A half-typed filter has no checked values.
      return EMPTY_FILTERS;
    }
  });

  const { buildValuesPlan } = createValuesPlanner({
    searchObj,
    zoConfig: () => store.state.zoConfig,
    t,
    fnParsedSQL,
    fnUnparsedSQL,
    extractValueQuery,
    validateFilterForMultiStream,
  });

  const values = useLogsValuesSource({
    searchObj,
    t,
    pageSize: () => store.state.zoConfig?.query_values_default_num || 10,
    showFtsFieldValues: () => store.state.zoConfig?.show_fts_field_values ?? false,
    buildValuesPlan,
    streamsKey,
  });

  const addFilter = (expression: string) => {
    if (searchObj.meta.sqlMode === true) {
      const fieldAndOperator = expression.match(/^([^=!<>\s()"]+)(\s*(?:!=|=)\s*.*)$/);
      if (fieldAndOperator) {
        searchObj.data.stream.addToFilter = `${quoteSqlIdentifierIfNeeded(fieldAndOperator[1])}${fieldAndOperator[2]}`;
        return;
      }
    }
    searchObj.data.stream.addToFilter = expression;
  };

  const addValueFilters = (name: string, include: string[], exclude: string[]) => {
    if (!include.length && !exclude.length) return;
    const quote = (field: string) =>
      searchObj.meta.sqlMode === true ? quoteSqlIdentifierIfNeeded(field) : field;
    const fieldType = () =>
      emptyValueFieldType(
        name,
        searchObj.data.stream.selectedStreamFields.find(
          (f: { name: string; dataType?: string }) => f.name === name,
        )?.dataType,
        searchObj.data.streamResults?.list ?? [],
        searchObj.data.stream.selectedStream,
      );
    // The values stream keys "" and missing alike as the missing-value key, so that row matches both.
    const conditionsFor = (value: string, mode: ValueFilterMode): string[] =>
      isNullValue(value)
        ? emptyValueConditions(name, mode, quote, fieldType())
        : [getFilterExpressionByFieldType(name, value, mode)];
    const expressionsFor = (values: string[], mode: ValueFilterMode): string[] =>
      values.flatMap((value) => conditionsFor(value, mode)).filter(Boolean);
    const included = expressionsFor(include, "include");
    const excluded = expressionsFor(exclude, "exclude");
    if (!included.length && !excluded.length) {
      toast({ variant: "error", message: t("logs.indexList.failedToGenerateFilterExpressions") });
      return;
    }
    const nullCondition = include.some(isNullValue) ? `${quote(name)} is null` : undefined;
    searchObj.data.stream.addToFilter = joinValueConditions(
      included,
      excluded,
      "upper",
      nullCondition || undefined,
    );
  };

  const removeFieldFilter = (name: string) => {
    searchObj.data.stream.removeFilterField = name;
  };

  return {
    streams: picker.streams,
    selectedStreams,
    streamType,
    fields,
    loading,
    // Several streams group by stream; one stream keeps the semantic layout.
    get groupingMode() {
      return selectedStreams.value.length > 1 ? "common-per-stream" : "semantic";
    },
    search,
    collapsedGroups,
    expandedFields: values.expandedFields,
    fieldValues: values.fieldValues,
    activeIncludeValues: computed(() => activeFilters.value.include),
    activeExcludeValues: computed(() => activeFilters.value.exclude),
    tableColumns,
    picker: picker.picker,
    footerSchemaTab: footer.footerSchemaTab,
    footerInterestingOnly: footer.showOnlyInterestingFields,
    valuesRequest: values.valuesRequest,
    selectStreams: picker.selectStreams,
    changeStreamType: picker.changeStreamType,
    refreshStreams: picker.refreshStreams,
    setSearch: (value: string) => {
      search.value = value;
    },
    toggleGroup,
    openField: values.openField,
    closeField: values.closeField,
    searchValues: values.searchValues,
    loadMoreValues: values.loadMoreValues,
    addFilter,
    addValueFilters,
    removeFieldFilter,
    toggleColumn,
    toggleInteresting,
    footerToggle: footer.footerToggle,
    resetColumns,
    capabilities: footer.capabilities,
    showBackToLogs: picker.showBackToLogs,
    backToLogs: picker.backToLogs,
    quickPickGroups: picker.quickPickGroups,
    quickPickMoreCount: picker.quickPickMoreCount,
    quickSelectStream: picker.quickSelectStream,
    onPickerHeaderAction: picker.onPickerHeaderAction,
  };
}

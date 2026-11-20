// Copyright 2026 OpenObserve Inc.

import { computed, ref, watch, type ComputedRef } from "vue";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import useDashboardPanelData from "@/composables/dashboard/useDashboardPanel";
import type {
  FieldPanelCapabilities,
  FieldPanelSource,
  PanelField,
  StreamTypeMode,
} from "./fieldPanel.types";
import { buildDashboardFieldRows, type DashboardFieldRow } from "./dashboard/dashboardFieldRows";
import {
  buildDashboardChips,
  chipsAvailable,
  hasChips,
  SLOT_TARGETS,
  type ChipContext,
  type ChipTarget,
} from "./dashboard/dashboardFieldChips";
import { useDashboardStreamPicker } from "./dashboard/useDashboardStreamPicker";
import { useDashboardValuesSource } from "./dashboard/useDashboardValuesSource";
import type { DashboardPanelState } from "./dashboard/dashboardPanelState";

const EMPTY_SET: Set<string> = new Set();

// Outlives the panel so a collapsed sidebar, a remount or the mobile drawer keeps the folded groups.
const collapsedByStream = ref<Record<string, Set<string>>>({});

const STREAM_TYPE_MODE: Record<string, StreamTypeMode> = { metrics: "hidden", logs: "disabled" };

export interface DashboardFieldSourceOptions {
  pageKey: string;
  /** A saved panel's data lands after mount, so the stream list waits for its stream. */
  editMode: boolean;
}

export interface DashboardFieldSource extends FieldPanelSource {
  capabilities: ComputedRef<FieldPanelCapabilities>;
}

export default function useDashboardFieldSource(
  options: DashboardFieldSourceOptions,
): DashboardFieldSource {
  const { pageKey } = options;
  const store = useStore();
  const { t } = useI18nTyped();
  const dashboardPanel = useDashboardPanelData(pageKey, t);
  const panel = dashboardPanel.dashboardPanelData as DashboardPanelState;
  const { promqlMode } = dashboardPanel;

  const currentQuery = () => panel.data.queries?.[panel.layout.currentQueryIndex];

  const picker = useDashboardStreamPicker({
    panel,
    pageKey,
    editMode: options.editMode,
    promqlMode,
    fetchPromQLLabels: dashboardPanel.fetchPromQLLabels,
  });

  const groupedFieldsInFlight = ref(0);
  watch(
    () => ({
      stream: currentQuery()?.fields?.stream,
      streamType: currentQuery()?.fields?.stream_type,
      joins: currentQuery()?.joins,
    }),
    async () => {
      groupedFieldsInFlight.value++;
      try {
        await dashboardPanel.updateGroupedFields();
      } finally {
        groupedFieldsInFlight.value--;
      }
    },
    { deep: true, immediate: true },
  );

  const rows = computed<DashboardFieldRow[]>(() =>
    buildDashboardFieldRows({
      queryFields: panel.meta.stream.customQueryFields ?? [],
      functionFields: panel.meta.stream.vrlFunctionFieldList ?? [],
      streamGroups: panel.meta.streamFields.groupedFields ?? [],
      timestampColumn: store.state.zoConfig?.timestamp_column ?? "_timestamp",
      allFieldsName: store.state.zoConfig?.all_fields_name ?? "",
      userDefinedSchemasEnabled: store.state.zoConfig?.user_defined_schemas_enabled === true,
      labels: {
        queryFields: t("dashboard.dashboards.queryFields"),
        functionFields: t("dashboard.dashboards.functionFields"),
      },
    }),
  );

  const loading = computed(() => picker.streamsLoading.value || groupedFieldsInFlight.value > 0);

  const search = computed<string>(() => panel.meta.stream.filterField ?? "");
  const setSearch = (value: string) => {
    panel.meta.stream.filterField = value;
  };

  const streamKey = () =>
    `${pageKey}:${picker.streamType.value}:${picker.selectedStreams.value[0] ?? ""}`;
  const collapsedGroups = computed(() => collapsedByStream.value[streamKey()] ?? EMPTY_SET);
  const toggleGroup = (group: string) => {
    const next = new Set(collapsedGroups.value);
    if (next.has(group)) next.delete(group);
    else next.add(group);
    collapsedByStream.value[streamKey()] = next;
  };

  const builderMode = computed(() => !promqlMode.value && currentQuery()?.customQuery !== true);

  const chipContext = computed<ChipContext>(() => {
    const slots: Record<string, unknown> = currentQuery()?.fields ?? {};
    return {
      chartType: panel.data.type,
      pageKey,
      promql: promqlMode.value,
      customQuery: currentQuery()?.customQuery === true,
      filledSlots: new Set(SLOT_TARGETS.filter((slot) => (slots[slot] ?? null) !== null)),
      notAllowed: {
        x: dashboardPanel.isAddXAxisNotAllowed.value,
        y: dashboardPanel.isAddYAxisNotAllowed.value,
        z: dashboardPanel.isAddZAxisNotAllowed.value,
        breakdown: dashboardPanel.isAddBreakdownNotAllowed.value,
      },
      unsupported: dashboardPanel.unsupportedAxes.value,
    };
  });

  const chipActions: Record<ChipTarget, (row: DashboardFieldRow) => unknown> = {
    x: dashboardPanel.addXAxisItem,
    y: dashboardPanel.addYAxisItem,
    z: dashboardPanel.addZAxisItem,
    breakdown: dashboardPanel.addBreakDownAxisItem,
    filter: (row) => dashboardPanel.addFilteredItem(row as DashboardFieldRow & { stream: string }),
    latitude: dashboardPanel.addLatitude,
    longitude: dashboardPanel.addLongitude,
    weight: dashboardPanel.addWeight,
    name: dashboardPanel.addMapName,
    value_for_maps: dashboardPanel.addMapValue,
    source: dashboardPanel.addSource,
    target: dashboardPanel.addTarget,
    value: dashboardPanel.addValue,
  };

  const chips = (field: PanelField) => buildDashboardChips(chipContext.value, field, t);
  const chip = (field: PanelField, target: string) => {
    chipActions[target as ChipTarget]?.(field as DashboardFieldRow);
  };

  const dragEnabled = (field: PanelField) => hasChips(chipContext.value, field);
  const dragStart = (field: PanelField) => {
    const dragAndDrop = panel.meta.dragAndDrop;
    dragAndDrop.dragging = true;
    dragAndDrop.dragElement = field;
    dragAndDrop.dragSource = "fieldList";
    dragAndDrop.dragSourceIndex = null;
  };
  const dragEnd = () => dashboardPanel.cleanupDraggingFields();

  const values = useDashboardValuesSource({
    panel,
    rows,
    builderMode,
    timeRange: () => dashboardPanel.getFilterValuesTimeRange(),
  });

  const capabilities = computed<FieldPanelCapabilities>(() => ({
    streamPicker: "single",
    streamType: STREAM_TYPE_MODE[pageKey] ?? "select",
    values: true,
    // The logs Visualize tab and SQL / PromQL queries have no builder filter for a picked value to land in.
    valueFilters: builderMode.value && pageKey !== "logs",
    drag: chipsAvailable(chipContext.value),
    actions: ["chips"],
    footerToggles: [],
    highlightColumns: false,
  }));

  return {
    capabilities,
    streams: picker.streams,
    streamsLoading: picker.streamsLoading,
    selectedStreams: picker.selectedStreams,
    streamType: picker.streamType,
    picker: {
      streamTypes: picker.streamTypes,
      locked: computed(() => pageKey === "logs"),
      optionTooltip: true,
    },
    fields: rows,
    loading,
    groupingMode: "per-source",
    rowKey: "_uid",
    search,
    collapsedGroups,
    expandedFields: values.expandedFields,
    fieldValues: values.fieldValues,
    activeIncludeValues: values.activeIncludeValues,
    activeExcludeValues: values.activeExcludeValues,
    chips,
    valuesRequest: values.valuesRequest,
    selectStreams: picker.selectStreams,
    changeStreamType: picker.changeStreamType,
    setSearch,
    toggleGroup,
    openField: values.openField,
    closeField: values.closeField,
    searchValues: values.searchValues,
    loadMoreValues: values.loadMoreValues,
    addFilter: () => {},
    addValueFilters: values.addValueFilters,
    removeFieldFilter: values.removeFieldFilter,
    chip,
    dragEnabled,
    dragStart,
    dragEnd,
  };
}

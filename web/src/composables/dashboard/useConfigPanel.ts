import { computed, ref, watch, Ref, ComputedRef } from "vue";
import { useI18n } from "vue-i18n";
import {
  shouldShowLegendsToggle,
  shouldShowLegendPosition,
  shouldShowLegendType,
  shouldShowLegendWidth,
  shouldShowLegendHeight,
  shouldApplyChartAlign,
  shouldShowTopResultsConfig,
  shouldShowAreaLineStyleConfig,
  shouldShowNoValueReplacement,
  shouldShowAxisConfig,
  shouldShowCartesianAxisConfig,
  shouldShowGridlines,
  shouldShowAxisLabelConfig,
  shouldShowLineThickness,
  shouldShowDrilldown,
  shouldShowTimeShift,
} from "@/utils/dashboard/configUtils";
import {
  SectionId,
  ORDERED_SECTION_IDS,
  DEFAULT_EXPANDED_SECTIONS,
} from "@/utils/dashboard/searchLabelsConfig";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConfigOption {
  label: string | string[];
  visible?: boolean;
}

export interface ConfigOptions {
  [sectionId: string]: {
    [optionId: string]: ConfigOption;
  };
}

// ---------------------------------------------------------------------------
// Pure filter helpers (exported so they can be unit-tested independently)
// ---------------------------------------------------------------------------

export function filterOption(
  option: ConfigOption | undefined,
  normalizedQuery: string,
): boolean {
  if (!option || option.visible === false) return false;
  if (!normalizedQuery) return true;
  const labels = Array.isArray(option.label) ? option.label : [option.label];
  return labels.some((l) => l.toLowerCase().includes(normalizedQuery));
}

export function filterSection(
  sectionOptions: Record<string, ConfigOption> | undefined,
  normalizedQuery: string,
): boolean {
  if (!sectionOptions) return false;
  return Object.values(sectionOptions).some((opt) =>
    filterOption(opt, normalizedQuery),
  );
}

// ---------------------------------------------------------------------------
// Main composable
// ---------------------------------------------------------------------------

/**
 * Single composable for the config panel.
 *
 * To add a new config section:
 *   1. Add one entry in searchLabelsConfig.ts  (SECTION_DEFS)
 *   2. Add its options in the configOptions computed below
 *   3. Add its UI in ConfigPanel.vue
 */
export function useConfigPanel(
  dashboardPanelData: any,
  promqlMode: Ref<boolean>,
  dashboardPanelDataPageKey: unknown,
  showTrellisConfig: ComputedRef<boolean>,
  showColorPalette: ComputedRef<boolean>,
  isPivotMode: ComputedRef<boolean>,
) {
  const { t } = useI18n();

  // ── Config options ────────────────────────────────────────────────────────

  const configOptions = computed<ConfigOptions>(() => ({
    general: {
      description: { label: t("dashboard.description") },
      step: {
        label: t("dashboard.stepValue"),
        visible: !!promqlMode.value,
      },
      "panel-default-time": { label: t("dashboard.panelTimeEnabled") },
      "promql-chart-config": {
        label: t("dashboard.promqlChartConfig"),
        visible:
          !!promqlMode.value &&
          dashboardPanelData.data.type !== "geomap" &&
          dashboardPanelData.data.type !== "maps" &&
          dashboardPanelData.data.type !== "table",
      },
    },
    promqlTable: {
      "promql-table-mode": {
        label: t("dashboard.promqlTableMode"),
        visible: !!promqlMode.value && dashboardPanelData.data.type === "table",
      },
      "table-aggregations": {
        label: t("dashboard.tableAggregations"),
        visible:
          !!promqlMode.value &&
          dashboardPanelData.data.type === "table" &&
          dashboardPanelData.data.config?.promql_table_mode === "all",
      },
      "visible-columns": {
        label: t("dashboard.visibleColumns"),
        visible:
          !!promqlMode.value &&
          dashboardPanelData.data.type === "table" &&
          (dashboardPanelData.data.config?.promql_table_mode === "all" ||
            dashboardPanelData.data.config?.promql_table_mode ===
              "expanded_timeseries"),
      },
      "hidden-columns": {
        label: t("dashboard.hiddenColumns"),
        visible:
          !!promqlMode.value &&
          dashboardPanelData.data.type === "table" &&
          (dashboardPanelData.data.config?.promql_table_mode === "all" ||
            dashboardPanelData.data.config?.promql_table_mode ===
              "expanded_timeseries"),
      },
      "sticky-first-column": {
        label: t("dashboard.stickyFirstColumn"),
        visible:
          !!promqlMode.value &&
          dashboardPanelData.data.type === "table" &&
          (dashboardPanelData.data.config?.promql_table_mode === "all" ||
            dashboardPanelData.data.config?.promql_table_mode ===
              "expanded_timeseries"),
      },
      "sticky-columns": {
        label: t("dashboard.stickyColumns"),
        visible:
          !!promqlMode.value &&
          dashboardPanelData.data.type === "table" &&
          (dashboardPanelData.data.config?.promql_table_mode === "all" ||
            dashboardPanelData.data.config?.promql_table_mode ===
              "expanded_timeseries"),
      },
      "configure-column-order": {
        label: t("dashboard.configureColumnOrder"),
        visible:
          !!promqlMode.value &&
          dashboardPanelData.data.type === "table" &&
          (dashboardPanelData.data.config?.promql_table_mode === "all" ||
            dashboardPanelData.data.config?.promql_table_mode ===
              "expanded_timeseries"),
      },
    },
    geographic: {
      "geographic-config": {
        label: t("dashboard.configSectionGeographic"),
        visible:
          !!promqlMode.value &&
          (dashboardPanelData.data.type === "geomap" ||
            dashboardPanelData.data.type === "maps"),
      },
    },
    legend: {
      "show-legends": {
        label: t("dashboard.showLegendsLabel"),
        visible: shouldShowLegendsToggle(dashboardPanelData),
      },
      "legend-position": {
        label: t("dashboard.legendsPositionLabel"),
        visible: shouldShowLegendPosition(dashboardPanelData),
      },
      "legend-type": {
        label: t("dashboard.legendsType"),
        visible: shouldShowLegendType(dashboardPanelData),
      },
      "legend-size": {
        label: [t("common.legendWidth"), t("dashboard.legendHeight")],
        visible:
          shouldShowLegendWidth(dashboardPanelData) ||
          shouldShowLegendHeight(dashboardPanelData),
      },
      "chart-align": {
        label: t("dashboard.chartAlign"),
        visible: shouldApplyChartAlign(dashboardPanelData),
      },
    },
    data: {
      unit: { label: t("dashboard.unitLabel") },
      "custom-unit": {
        label: t("dashboard.customunitLabel"),
        visible: dashboardPanelData.data.config.unit === "custom",
      },
      decimals: { label: t("dashboard.decimals") },
      limit: {
        label: t("dashboard.queryLimit"),
        visible:
          !promqlMode.value &&
          !dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ]?.customQuery,
      },
      "top-results": {
        label: t("dashboard.showTopNValues"),
        visible: shouldShowTopResultsConfig(dashboardPanelData, promqlMode.value),
      },
      "top-results-others": {
        label: t("dashboard.addOthersSeries"),
        visible: shouldShowTopResultsConfig(dashboardPanelData, promqlMode.value),
      },
      "connect-nulls": {
        label: t("dashboard.connectNullValues"),
        visible: shouldShowAreaLineStyleConfig(dashboardPanelData),
      },
      "no-value-replacement": {
        label: t("dashboard.noValueReplacement"),
        visible: shouldShowNoValueReplacement(dashboardPanelData, promqlMode.value),
      },
      "query-label": {
        label: t("dashboard.multiSqlQueryLabel"),
        visible:
          !promqlMode.value &&
          dashboardPanelData.data.queries.length > 1 &&
          dashboardPanelData.data.type !== "geomap" &&
          dashboardPanelData.data.type !== "maps",
      },
      "promql-legend": {
        label: t("dashboard.query"),
        visible:
          !!promqlMode.value &&
          dashboardPanelData.data.type !== "geomap" &&
          dashboardPanelData.data.type !== "maps",
      },
      "promql-legend-label": {
        label: [t("dashboard.legendLabel"), t("common.legend")],
        visible:
          !!promqlMode.value &&
          dashboardPanelData.data.type !== "geomap" &&
          dashboardPanelData.data.type !== "maps",
      },
    },
    axis: {
      "axis-width": {
        label: t("common.axisWidth"),
        visible: shouldShowAxisConfig(dashboardPanelData),
      },
      "axis-border": {
        label: t("dashboard.showBorder"),
        visible: shouldShowAxisConfig(dashboardPanelData),
      },
      "y-axis": {
        label: [t("common.yAxisMin"), t("common.yAxisMax")],
        visible: shouldShowCartesianAxisConfig(dashboardPanelData),
      },
      gridlines: {
        label: t("dashboard.showGridlines"),
        visible: shouldShowGridlines(dashboardPanelData),
      },
    },
    labels: {
      "label-position": {
        label: t("dashboard.labelPosition"),
        visible: shouldShowCartesianAxisConfig(dashboardPanelData),
      },
      "label-rotate": {
        label: [t("dashboard.labelRotate")],
        visible: shouldShowCartesianAxisConfig(dashboardPanelData),
      },
      "axis-label": {
        label: [t("dashboard.axisLabelRotate"), t("dashboard.axisLabelTruncate")],
        visible: shouldShowAxisLabelConfig(dashboardPanelData),
      },
    },
    lineStyle: {
      symbol: {
        label: t("dashboard.showSymbol"),
        visible: shouldShowAreaLineStyleConfig(dashboardPanelData),
      },
      interpolation: {
        label: t("dashboard.lineInterpolation"),
        visible: shouldShowAreaLineStyleConfig(dashboardPanelData),
      },
      "line-thickness": {
        label: t("dashboard.lineThickness"),
        visible: shouldShowLineThickness(dashboardPanelData, promqlMode.value),
      },
    },
    table: {
      wrap: {
        label: t("dashboard.wraptext"),
        visible: dashboardPanelData.data.type === "table",
      },
      transpose: {
        label: t("dashboard.tableTranspose"),
        visible: !promqlMode.value && dashboardPanelData.data.type === "table",
      },
      "dynamic-columns": {
        label: t("dashboard.tableDynamicColumns"),
        visible: !promqlMode.value && dashboardPanelData.data.type === "table",
      },
      pagination: {
        label: t("dashboard.pagination"),
        visible: dashboardPanelData.data.type === "table",
      },
      "rows-per-page": {
        label: t("dashboard.rowsPerPage"),
        visible:
          !!dashboardPanelData.data.config.table_pagination &&
          dashboardPanelData.data.type === "table",
      },
    },
    pivotTable: {
      "pivot-show-row-totals": {
        label: t("dashboard.pivotShowRowTotals"),
        visible:
          !promqlMode.value &&
          dashboardPanelData.data.type === "table" &&
          isPivotMode.value,
      },
      "pivot-show-col-totals": {
        label: t("dashboard.pivotShowColTotals"),
        visible:
          !promqlMode.value &&
          dashboardPanelData.data.type === "table" &&
          isPivotMode.value,
      },
      "pivot-sticky-row-totals": {
        label: t("dashboard.pivotStickyRowTotals"),
        visible:
          !promqlMode.value &&
          dashboardPanelData.data.type === "table" &&
          isPivotMode.value &&
          !!dashboardPanelData.data.config.table_pivot_show_col_totals,
      },
      "pivot-sticky-col-totals": {
        label: t("dashboard.pivotStickyColTotals"),
        visible:
          !promqlMode.value &&
          dashboardPanelData.data.type === "table" &&
          isPivotMode.value &&
          !!dashboardPanelData.data.config.table_pivot_show_row_totals,
      },
    },
    valueTransformations: {
      "value-transformations": { label: t("dashboard.configSectionValueTransformations") },
    },
    fieldOverrides: {
      "field-overrides": { label: t("dashboard.configSectionFieldOverrides") },
    },
    map: {
      "map-config": {
        label: t("dashboard.configSectionMap"),
        visible:
          dashboardPanelData.data.type === "geomap" ||
          dashboardPanelData.data.type === "maps",
      },
    },
    gauge: {
      "gauge-min": {
        label: t("dashboard.gaugeMinValue"),
        visible: dashboardPanelData.data.type === "gauge",
      },
      "gauge-max": {
        label: t("dashboard.gaugeMaxValue"),
        visible: dashboardPanelData.data.type === "gauge",
      },
    },
    layout: {
      "trellis-layout": {
        label: t("dashboard.trellisLayout"),
        visible: showTrellisConfig.value,
      },
      "trellis-columns": {
        label: t("dashboard.numOfColumns"),
        visible:
          showTrellisConfig.value &&
          dashboardPanelData.data.config.trellis?.layout === "custom",
      },
      "trellis-group-by": {
        label: t("dashboard.groupMultiYAxisTrellis"),
        visible:
          showTrellisConfig.value &&
          dashboardPanelData.data.config.trellis?.layout != null,
      },
    },
    colors: {
      colors: {
        label: [t("dashboard.colorPalette"), t("dashboard.colorBySeriesTitle")],
        visible: showColorPalette.value,
      },
    },
    drilldown: {
      drilldown: {
        label: t("dashboard.drilldown"),
        visible: shouldShowDrilldown(
          dashboardPanelData,
          dashboardPanelDataPageKey as string,
        ),
      },
    },
    comparison: {
      comparison: {
        label: t("dashboard.comparisonAgainst"),
        visible: shouldShowTimeShift(
          dashboardPanelData,
          promqlMode.value,
          dashboardPanelDataPageKey as string,
        ),
      },
    },
    markLines: {
      "mark-lines": {
        label: t("dashboard.markLines"),
        visible: shouldShowCartesianAxisConfig(dashboardPanelData),
      },
    },
    background: {
      background: {
        label: t("dashboard.colorMode"),
        visible: dashboardPanelData.data.type === "metric",
      },
    },
  }));

  // ── Search state ──────────────────────────────────────────────────────────

  const searchQuery = ref("");
  const expandedSections = ref<Record<string, boolean>>({
    ...DEFAULT_EXPANDED_SECTIONS,
  });
  const beforeSearchExpandedSections = ref<Record<string, boolean> | null>(
    null,
  );

  const normalizedSearchQuery = computed(() =>
    (searchQuery.value ?? "").trim().toLowerCase(),
  );

  const saveExpansionState = () => {
    beforeSearchExpandedSections.value = { ...expandedSections.value };
    Object.keys(expandedSections.value).forEach((key) => {
      expandedSections.value[key] = true;
    });
  };

  const restoreExpansionState = () => {
    if (beforeSearchExpandedSections.value) {
      expandedSections.value = { ...beforeSearchExpandedSections.value };
      beforeSearchExpandedSections.value = null;
    }
  };

  watch(searchQuery, (newQ, oldQ) => {
    if (newQ && !oldQ) saveExpansionState();
    else if (!newQ && oldQ) restoreExpansionState();
  });

  // ── Bound filter helpers ──────────────────────────────────────────────────

  const isConfigOptionVisible = (sectionId: SectionId, optionId: string): boolean =>
    filterOption(
      configOptions.value[sectionId]?.[optionId],
      normalizedSearchQuery.value,
    );

  const isSectionVisible = (sectionId: SectionId): boolean =>
    filterSection(
      configOptions.value[sectionId],
      normalizedSearchQuery.value,
    );

  // ── Expand / collapse ─────────────────────────────────────────────────────

  const isExpanded = (key: string): boolean =>
    expandedSections.value[key] ?? true;

  const toggleSection = (sectionId: SectionId) => {
    expandedSections.value[sectionId] = !isExpanded(sectionId);
  };

  const resetSearch = () => {
    searchQuery.value = "";
    restoreExpansionState();
  };

  const allSectionsExpanded = computed(() =>
    Object.values(expandedSections.value).every((v) => v === true),
  );

  const toggleAllSections = () => {
    const expand = !allSectionsExpanded.value;
    Object.keys(expandedSections.value).forEach((key) => {
      expandedSections.value[key] = expand;
    });
  };

  const anySectionVisible = computed(() =>
    ORDERED_SECTION_IDS.some((id) => isSectionVisible(id)),
  );

  return {
    searchQuery,
    expandedSections,
    isConfigOptionVisible,
    isSectionVisible,
    isExpanded,
    toggleSection,
    resetSearch,
    allSectionsExpanded,
    toggleAllSections,
    anySectionVisible,
  };
}

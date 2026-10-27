import { computed, ref, watch, Ref, ComputedRef } from "vue";
import { useI18nTyped } from "@/types/i18n";
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
  shouldShowAxisBorderConfig,
  shouldShowCartesianAxisConfig,
  shouldShowGridlines,
  shouldShowAxisLabelConfig,
  shouldShowLineThickness,
  shouldShowDrilldown,
  shouldShowTimeShift,
  shouldShowStackMode,
  shouldShowSortOrder,
  shouldShowBarRadius,
  shouldShowScatterEncoding,
  shouldShowConnectNullsThreshold,
  shouldShowCartesianSeriesConfig,
} from "@/utils/dashboard/configUtils";
import {
  SectionId,
  ORDERED_SECTION_IDS,
  DEFAULT_EXPANDED_SECTIONS,
} from "@/utils/dashboard/searchLabelsConfig";
import { isExemplarEligible } from "@/utils/dashboard/exemplars/exemplarEligibility";
import { PROMETHEUS_HISTOGRAM_MODE } from "@/utils/dashboard/promql/convertPromQLHeatmapChart";
import { isNumericYField } from "@/utils/dashboard/heatmapYAxis";
import { isStatChangeOn } from "@/utils/dashboard/metricOptions";
import { isHtmlPanel, isRowTimeline } from "@/utils/dashboard/chartTypeGroups";

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

export const THRESHOLD_CHART_TYPES: readonly string[] = [
  "line",
  "area",
  "area-stacked",
  "bar",
  "h-bar",
  "scatter",
  "gauge",
  "metric",
  "state-timeline",
  "status-history",
  "bar-gauge",
];

const hasBarGaugeColumn = (panel: any): boolean =>
  (Array.isArray(panel?.config?.override_config) ? panel.config.override_config : []).some(
    (entry: any) =>
      (entry?.config ?? []).some(
        (item: any) => item?.type === "field_type" && item?.value === "bar_gauge",
      ),
  );

/** Thresholds apply to the threshold chart types, and colour the bar gauge cells of a SQL table. */
export const shouldShowThresholds = (dashboardPanelData: any): boolean =>
  THRESHOLD_CHART_TYPES.includes(dashboardPanelData?.data?.type) ||
  (dashboardPanelData?.data?.type === "table" &&
    dashboardPanelData?.data?.queryType !== "promql" &&
    hasBarGaugeColumn(dashboardPanelData?.data));

// Charts whose series have names an override can match; tables keep Column Formatting.
export const SERIES_OVERRIDE_CHART_TYPES: readonly string[] = [
  "line",
  "area",
  "area-stacked",
  "bar",
  "h-bar",
  "stacked",
  "h-stacked",
  "scatter",
  "pie",
  "donut",
  "gauge",
  "bar-gauge",
  "metric",
  "state-timeline",
  "status-history",
];

export const shouldShowSeriesOverrides = (dashboardPanelData: any): boolean =>
  SERIES_OVERRIDE_CHART_TYPES.includes(dashboardPanelData?.data?.type);

// Histogram mode always orders rows by le, so the sort control would do nothing there.
export const shouldShowHeatmapYSort = (dashboardPanelData: any, promqlMode: boolean): boolean =>
  dashboardPanelData?.data?.type === "heatmap" &&
  !(promqlMode && dashboardPanelData?.data?.config?.heatmap_mode === PROMETHEUS_HISTOGRAM_MODE);

// Bucketing is generated in the builder's SQL, so custom SQL and PromQL keep the y values they return.
export const shouldShowHeatmapYBucket = (dashboardPanelData: any, promqlMode: boolean): boolean => {
  const query = dashboardPanelData?.data?.queries?.[dashboardPanelData?.layout?.currentQueryIndex];
  return (
    !promqlMode &&
    dashboardPanelData?.data?.type === "heatmap" &&
    !query?.customQuery &&
    isNumericYField(query?.fields?.y?.[0], dashboardPanelData)
  );
};

/** The only sections an HTML panel shows; every other section configures an ECharts option it never builds. */
export const HTML_PANEL_SECTIONS: Record<string, readonly SectionId[]> = {
  logs: ["general", "logs"],
  "alert-list": ["general", "alertList"],
  "flame-graph": ["general", "data", "flameGraph"],
};

export const isSectionAllowedForType = (sectionId: SectionId, type: unknown): boolean =>
  !isHtmlPanel(type) || (HTML_PANEL_SECTIONS[type as string] ?? []).includes(sectionId);

// ---------------------------------------------------------------------------
// Pure filter helpers (exported so they can be unit-tested independently)
// ---------------------------------------------------------------------------

export function filterOption(option: ConfigOption | undefined, normalizedQuery: string): boolean {
  if (!option || option.visible === false) return false;
  if (!normalizedQuery) return true;
  const labels = Array.isArray(option.label) ? option.label : [option.label];
  return labels.some((l) => matchesLabel(l.toLowerCase(), normalizedQuery));
}

// A plural query ("limits") also finds the singular, but only as a whole word end, so "axis" never widens to "axi".
function matchesLabel(label: string, query: string): boolean {
  if (label.includes(query)) return true;
  if (query.length < 4 || !query.endsWith("s")) return false;
  const singular = query.slice(0, -1);
  let at = label.indexOf(singular);
  while (at !== -1) {
    if (!/\p{L}/u.test(label.charAt(at + singular.length))) return true;
    at = label.indexOf(singular, at + 1);
  }
  return false;
}

export function filterSection(
  sectionOptions: Record<string, ConfigOption> | undefined,
  normalizedQuery: string,
): boolean {
  if (!sectionOptions) return false;
  return Object.values(sectionOptions).some((opt) => filterOption(opt, normalizedQuery));
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
  const { t, tm } = useI18nTyped();

  const isStateTimeline = computed(() => dashboardPanelData.data.type === "state-timeline");
  const isStatusHistory = computed(() => dashboardPanelData.data.type === "status-history");
  const isRowChart = computed(() => isRowTimeline(dashboardPanelData.data.type));
  const isGaugeFamily = computed(
    () => dashboardPanelData.data.type === "gauge" || dashboardPanelData.data.type === "bar-gauge",
  );
  const isBarGauge = computed(() => dashboardPanelData.data.type === "bar-gauge");
  const isPieOrDonut = computed(
    () => dashboardPanelData.data.type === "pie" || dashboardPanelData.data.type === "donut",
  );

  // ── Config options ────────────────────────────────────────────────────────

  const configOptions = computed<ConfigOptions>(() => ({
    general: {
      description: { label: t("dashboard.description") },
      step: {
        label: t("dashboard.stepValue"),
        visible: !!promqlMode.value,
      },
      "show-exemplars": {
        label: t("dashboard.showExemplarsLabel"),
        visible: !!promqlMode.value && isExemplarEligible(dashboardPanelData.data),
      },
      "panel-default-time": {
        label: t("dashboard.panelTimeEnabled"),
        visible: dashboardPanelData.data.type !== "alert-list",
      },
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
            dashboardPanelData.data.config?.promql_table_mode === "expanded_timeseries"),
      },
      "hidden-columns": {
        label: t("dashboard.hiddenColumns"),
        visible:
          !!promqlMode.value &&
          dashboardPanelData.data.type === "table" &&
          (dashboardPanelData.data.config?.promql_table_mode === "all" ||
            dashboardPanelData.data.config?.promql_table_mode === "expanded_timeseries"),
      },
      "sticky-first-column": {
        label: t("dashboard.stickyFirstColumn"),
        visible:
          !!promqlMode.value &&
          dashboardPanelData.data.type === "table" &&
          (dashboardPanelData.data.config?.promql_table_mode === "all" ||
            dashboardPanelData.data.config?.promql_table_mode === "expanded_timeseries"),
      },
      "sticky-columns": {
        label: t("dashboard.stickyColumns"),
        visible:
          !!promqlMode.value &&
          dashboardPanelData.data.type === "table" &&
          (dashboardPanelData.data.config?.promql_table_mode === "all" ||
            dashboardPanelData.data.config?.promql_table_mode === "expanded_timeseries"),
      },
      "configure-column-order": {
        label: t("dashboard.configureColumnOrder"),
        visible:
          !!promqlMode.value &&
          dashboardPanelData.data.type === "table" &&
          (dashboardPanelData.data.config?.promql_table_mode === "all" ||
            dashboardPanelData.data.config?.promql_table_mode === "expanded_timeseries"),
      },
    },
    geographic: {
      "geographic-config": {
        label: t("dashboard.configSectionGeographic"),
        visible:
          !!promqlMode.value &&
          (dashboardPanelData.data.type === "geomap" || dashboardPanelData.data.type === "maps"),
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
          shouldShowLegendWidth(dashboardPanelData) || shouldShowLegendHeight(dashboardPanelData),
      },
      "chart-align": {
        label: t("dashboard.chartAlign"),
        visible: shouldApplyChartAlign(dashboardPanelData),
      },
      "chart-tooltip-mode": {
        label: t("dashboard.chartTooltipMode"),
        visible: shouldShowCartesianSeriesConfig(dashboardPanelData),
      },
      "tooltip-sort": {
        label: t("dashboard.tooltipSort"),
        visible: shouldShowCartesianSeriesConfig(dashboardPanelData),
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
    data: {
      unit: { label: t("dashboard.unitLabel"), visible: !isStateTimeline.value },
      "custom-unit": {
        label: t("dashboard.customunitLabel"),
        visible: !isStateTimeline.value && dashboardPanelData.data.config.unit === "custom",
      },
      decimals: { label: t("dashboard.decimals"), visible: !isStateTimeline.value },
      "heatmap-color-range": {
        label: [t("dashboard.heatmapColorMin"), t("dashboard.heatmapColorMax")],
        visible: dashboardPanelData.data.type === "heatmap",
      },
      "heatmap-palette": {
        label: t("dashboard.heatmapPalette"),
        visible: dashboardPanelData.data.type === "heatmap",
      },
      "heatmap-palette-reverse": {
        label: t("dashboard.heatmapPaletteReverse"),
        visible: dashboardPanelData.data.type === "heatmap",
      },
      "heatmap-color-scale": {
        label: t("dashboard.heatmapColorScale"),
        visible: dashboardPanelData.data.type === "heatmap",
      },
      "heatmap-cells": {
        label: [t("dashboard.heatmapCellGap"), t("dashboard.heatmapHideBelow")],
        visible: dashboardPanelData.data.type === "heatmap",
      },
      "distribution-buckets": {
        label: [
          t("dashboard.distributionBucketCount"),
          t("dashboard.distributionBucketSize"),
          t("dashboard.distributionBucketOffset"),
        ],
        visible: dashboardPanelData.data.type === "distribution",
      },
      "treemap-breadcrumb": {
        label: t("dashboard.treemapShowBreadcrumb"),
        visible: dashboardPanelData.data.type === "treemap",
      },
      "sunburst-labels": {
        label: t("dashboard.sunburstShowLabels"),
        visible: dashboardPanelData.data.type === "sunburst",
      },
      "funnel-sort": {
        label: t("dashboard.funnelSort"),
        visible: dashboardPanelData.data.type === "funnel",
      },
      "funnel-orient": {
        label: t("dashboard.barGaugeOrientation"),
        visible: dashboardPanelData.data.type === "funnel",
      },
      "funnel-show-percent": {
        label: t("dashboard.funnelShowPercent"),
        visible: dashboardPanelData.data.type === "funnel",
      },
      "boxplot-whisker": {
        label: t("dashboard.boxplotWhisker"),
        visible: dashboardPanelData.data.type === "boxplot",
      },
      "node-graph-layout": {
        label: t("dashboard.nodeGraphLayout"),
        visible: dashboardPanelData.data.type === "node-graph",
      },
      "node-graph-edge-labels": {
        label: t("dashboard.nodeGraphShowEdgeLabels"),
        visible: dashboardPanelData.data.type === "node-graph",
      },
      "heatmap-histogram-mode": {
        label: t("dashboard.heatmapHistogramMode"),
        visible: !!promqlMode.value && dashboardPanelData.data.type === "heatmap",
      },
      "bucket-unit": {
        label: t("dashboard.bucketUnit"),
        visible:
          !!promqlMode.value &&
          dashboardPanelData.data.type === "heatmap" &&
          dashboardPanelData.data.config?.heatmap_mode === PROMETHEUS_HISTOGRAM_MODE,
      },
      "bucket-unit-custom": {
        label: t("dashboard.bucketUnitCustom"),
        visible:
          !!promqlMode.value &&
          dashboardPanelData.data.type === "heatmap" &&
          dashboardPanelData.data.config?.heatmap_mode === PROMETHEUS_HISTOGRAM_MODE &&
          dashboardPanelData.data.config?.bucket_unit === "custom",
      },
      limit: {
        label: t("dashboard.queryLimit"),
        visible:
          !promqlMode.value &&
          !dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
            ?.customQuery,
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
      "connect-nulls-threshold": {
        label: t("dashboard.connectNullsThreshold"),
        visible: shouldShowConnectNullsThreshold(dashboardPanelData),
      },
      "scatter-encoding": {
        label: [
          t("dashboard.scatterSizeField"),
          t("dashboard.scatterColorField"),
          t("dashboard.scatterSizeMin"),
          t("dashboard.scatterSizeMax"),
        ],
        visible: shouldShowScatterEncoding(dashboardPanelData, !!promqlMode.value),
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
    },
    stateTimeline: {
      "merge-gaps": {
        label: t("dashboard.stateTimelineMergeGaps"),
        visible: isStateTimeline.value,
      },
      "row-size": {
        label: [t("dashboard.stateTimelineRowHeight"), t("dashboard.stateTimelineRowGap")],
        visible: isRowChart.value,
      },
      "show-state-text": {
        label: t("dashboard.stateTimelineShowStateText"),
        visible: isStateTimeline.value,
      },
      "status-history-show-values": {
        label: t("dashboard.statusHistoryShowValues"),
        visible: isStatusHistory.value,
      },
      "row-sort": {
        label: t("dashboard.stateTimelineRowSort"),
        visible: isRowChart.value,
      },
      "tooltip-mode": {
        label: t("dashboard.stateTimelineTooltipMode"),
        visible: isRowChart.value,
      },
      "state-value-align": {
        label: t("dashboard.stateValueAlign"),
        visible: isRowChart.value,
      },
    },
    axis: {
      "axis-width": {
        label: t("common.axisWidth"),
        visible: shouldShowAxisConfig(dashboardPanelData),
      },
      "heatmap-y-sort": {
        label: t("dashboard.heatmapYSort"),
        visible: shouldShowHeatmapYSort(dashboardPanelData, !!promqlMode.value),
      },
      "heatmap-y-bucket": {
        label: [
          t("dashboard.heatmapYBucket"),
          t("dashboard.heatmapYBucketSize"),
          t("dashboard.heatmapYBucketBase"),
        ],
        visible: shouldShowHeatmapYBucket(dashboardPanelData, !!promqlMode.value),
      },
      "heatmap-y-range": {
        label: [t("dashboard.heatmapYMin"), t("dashboard.heatmapYMax")],
        visible:
          shouldShowHeatmapYBucket(dashboardPanelData, !!promqlMode.value) &&
          !!dashboardPanelData.data.config?.heatmap_y_bucket?.mode,
      },
      "axis-border": {
        label: t("dashboard.showBorder"),
        visible: shouldShowAxisBorderConfig(dashboardPanelData),
      },
      "y-axis": {
        label: [t("common.yAxisMin"), t("common.yAxisMax")],
        visible: shouldShowCartesianAxisConfig(dashboardPanelData),
      },
      "y-axis-soft-range": {
        label: [t("dashboard.yAxisSoftMin"), t("dashboard.yAxisSoftMax")],
        visible: shouldShowCartesianSeriesConfig(dashboardPanelData),
      },
      "y-axis-scale": {
        label: [t("dashboard.yAxisScale"), t("dashboard.yAxisLogBase")],
        visible: shouldShowCartesianSeriesConfig(dashboardPanelData),
      },
      "y-axis-label": {
        label: t("dashboard.yAxisLabel"),
        visible: shouldShowCartesianSeriesConfig(dashboardPanelData),
      },
      "stack-mode": {
        label: t("dashboard.stackMode"),
        visible: shouldShowStackMode(dashboardPanelData),
      },
      "sort-order": {
        label: t("dashboard.barSortOrder"),
        visible: shouldShowSortOrder(dashboardPanelData),
      },
      "axis-label-mode": {
        label: t("dashboard.axisLabelMode"),
        visible: !promqlMode.value && shouldShowCartesianAxisConfig(dashboardPanelData),
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
      "line-style": {
        label: t("dashboard.lineStyle"),
        visible: shouldShowAreaLineStyleConfig(dashboardPanelData),
      },
      "bar-radius": {
        label: t("dashboard.barRadius"),
        visible: shouldShowBarRadius(dashboardPanelData),
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
      filtering: {
        label: t("dashboard.tableFiltering"),
        visible: dashboardPanelData.data.type === "table",
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
      "table-density": {
        label: t("dashboard.tableDensity"),
        visible: dashboardPanelData.data.type === "table",
      },
      "table-footer-calcs": {
        label: t("dashboard.tableFooterCalcs"),
        visible:
          !promqlMode.value && dashboardPanelData.data.type === "table" && !isPivotMode.value,
      },
    },
    pivotTable: {
      "pivot-show-row-totals": {
        label: t("dashboard.pivotShowRowTotals"),
        visible: !promqlMode.value && dashboardPanelData.data.type === "table" && isPivotMode.value,
      },
      "pivot-show-col-totals": {
        label: t("dashboard.pivotShowColTotals"),
        visible: !promqlMode.value && dashboardPanelData.data.type === "table" && isPivotMode.value,
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
      "field-overrides": {
        label: [
          t("dashboard.configSectionFieldOverrides"),
          ...(typeof tm === "function" &&
          Array.isArray(tm("dashboard.configSectionFieldOverridesAliases"))
            ? (tm("dashboard.configSectionFieldOverridesAliases") as string[])
            : []),
        ],
      },
    },
    seriesOverrides: {
      "series-overrides": {
        label: [
          t("dashboard.configSectionSeriesOverrides"),
          t("dashboard.addSeriesOverride"),
          t("dashboard.seriesFormattingTitle"),
          ...(typeof tm === "function" &&
          Array.isArray(tm("dashboard.configSectionSeriesOverridesAliases"))
            ? (tm("dashboard.configSectionSeriesOverridesAliases") as string[])
            : []),
        ],
        visible: shouldShowSeriesOverrides(dashboardPanelData),
      },
    },
    map: {
      "map-config": {
        label: t("dashboard.configSectionMap"),
        visible:
          dashboardPanelData.data.type === "geomap" || dashboardPanelData.data.type === "maps",
      },
      "map-cluster": {
        label: [t("dashboard.mapCluster"), t("dashboard.mapClusterRadius")],
        visible: dashboardPanelData.data.type === "geomap",
      },
    },
    gauge: {
      "gauge-min": {
        label: t("dashboard.gaugeMinValue"),
        visible: isGaugeFamily.value,
      },
      "gauge-max": {
        label: t("dashboard.gaugeMaxValue"),
        visible: isGaugeFamily.value,
      },
      "bar-gauge-mode": {
        label: t("dashboard.barGaugeMode"),
        visible: isBarGauge.value,
      },
      "bar-gauge-orientation": {
        label: t("dashboard.barGaugeOrientation"),
        visible: isBarGauge.value,
      },
      "bar-gauge-show-unfilled": {
        label: t("dashboard.barGaugeShowUnfilled"),
        visible: isBarGauge.value,
      },
      "gauge-style": {
        label: t("dashboard.gaugeStyle"),
        visible: dashboardPanelData.data.type === "gauge",
      },
      "gauge-segments": {
        label: t("dashboard.gaugeSegments"),
        visible: dashboardPanelData.data.type === "gauge",
      },
      "gauge-neutral": {
        label: t("dashboard.gaugeNeutral"),
        visible: dashboardPanelData.data.type === "gauge",
      },
      "gauge-round-cap": {
        label: t("dashboard.gaugeRoundCap"),
        visible: dashboardPanelData.data.type === "gauge",
      },
    },
    pie: {
      "pie-label-content": {
        label: t("dashboard.pieLabelContent"),
        visible: isPieOrDonut.value,
      },
      "pie-sort-order": {
        label: t("dashboard.pieSortOrder"),
        visible: isPieOrDonut.value,
      },
      "pie-other-threshold": {
        label: t("dashboard.pieOtherThreshold"),
        visible: isPieOrDonut.value,
      },
      "donut-inner-radius": {
        label: t("dashboard.donutInnerRadius"),
        visible: dashboardPanelData.data.type === "donut",
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
          showTrellisConfig.value && dashboardPanelData.data.config.trellis?.layout === "custom",
      },
      "trellis-group-by": {
        label: t("dashboard.groupMultiYAxisTrellis"),
        visible: showTrellisConfig.value && dashboardPanelData.data.config.trellis?.layout != null,
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
        visible: shouldShowDrilldown(dashboardPanelData, dashboardPanelDataPageKey as string),
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
      "mark-areas": {
        label: t("dashboard.markAreas"),
        visible: shouldShowCartesianSeriesConfig(dashboardPanelData),
      },
    },
    thresholds: {
      thresholds: {
        label: [
          t("dashboard.thresholds"),
          t("dashboard.thresholdShowAsLine"),
          t("dashboard.thresholdAddStep"),
        ],
        visible: shouldShowThresholds(dashboardPanelData),
      },
    },
    metric: {
      "stat-change": {
        label: t("dashboard.statChange"),
        visible: dashboardPanelData.data.type === "metric",
      },
      "stat-change-color": {
        label: t("dashboard.statChangeColor"),
        visible: isStatChangeOn(dashboardPanelData.data),
      },
      "stat-text-mode": {
        label: t("dashboard.statTextMode"),
        visible: dashboardPanelData.data.type === "metric",
      },
      "value-font-size": {
        label: t("dashboard.valueFontSize"),
        visible: dashboardPanelData.data.type === "metric",
      },
    },
    background: {
      background: {
        label: t("dashboard.colorMode"),
        visible: dashboardPanelData.data.type === "metric",
      },
    },
    sparkline: {
      sparkline: {
        label: t("dashboard.configSectionSparkline"),
        visible: dashboardPanelData.data.type === "metric",
      },
    },
    logs: {
      "logs-fields": {
        label: [
          t("dashboard.logsMessageField"),
          t("dashboard.logsLevelField"),
          t("dashboard.logsTimeField"),
        ],
        visible: dashboardPanelData.data.type === "logs",
      },
      "logs-order": {
        label: t("dashboard.logsOrder"),
        visible: dashboardPanelData.data.type === "logs",
      },
      "logs-show-time": {
        label: t("dashboard.logsShowTime"),
        visible: dashboardPanelData.data.type === "logs",
      },
      "logs-wrap": {
        label: t("dashboard.logsWrap"),
        visible: dashboardPanelData.data.type === "logs",
      },
      "logs-prettify-json": {
        label: t("dashboard.logsPrettifyJson"),
        visible: dashboardPanelData.data.type === "logs",
      },
    },
    alertList: {
      "alert-list-folder": {
        label: t("dashboard.alertListFolder"),
        visible: dashboardPanelData.data.type === "alert-list",
      },
      "alert-list-state": {
        label: t("dashboard.alertListState"),
        visible: dashboardPanelData.data.type === "alert-list",
      },
      "alert-list-sort": {
        label: t("dashboard.alertListSort"),
        visible: dashboardPanelData.data.type === "alert-list",
      },
      "alert-list-max": {
        label: t("dashboard.alertListMax"),
        visible: dashboardPanelData.data.type === "alert-list",
      },
    },
    flameGraph: {
      "flame-graph-fields": {
        label: [t("dashboard.flameGraphStackField"), t("dashboard.flameGraphValueField")],
        visible: dashboardPanelData.data.type === "flame-graph",
      },
    },
  }));

  // ── Search state ──────────────────────────────────────────────────────────

  const searchQuery = ref("");
  const expandedSections = ref<Record<string, boolean>>({
    ...DEFAULT_EXPANDED_SECTIONS,
  });
  const beforeSearchExpandedSections = ref<Record<string, boolean> | null>(null);

  const normalizedSearchQuery = computed(() => (searchQuery.value ?? "").trim().toLowerCase());

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
    filterOption(configOptions.value[sectionId]?.[optionId], normalizedSearchQuery.value);

  const isSectionVisible = (sectionId: SectionId): boolean =>
    isSectionAllowedForType(sectionId, dashboardPanelData.data.type) &&
    filterSection(configOptions.value[sectionId], normalizedSearchQuery.value);

  // ── Expand / collapse ─────────────────────────────────────────────────────

  const isExpanded = (key: string): boolean => expandedSections.value[key] ?? false;

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

  const anySectionVisible = computed(() => ORDERED_SECTION_IDS.some((id) => isSectionVisible(id)));

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

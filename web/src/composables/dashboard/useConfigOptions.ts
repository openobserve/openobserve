import { computed, Ref, ComputedRef } from "vue";
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

export function useConfigOptions(
  dashboardPanelData: any,
  promqlMode: Ref<boolean>,
  dashboardPanelDataPageKey: unknown,
  showTrellisConfig: ComputedRef<boolean>,
  showColorPalette: ComputedRef<boolean>,
  isPivotMode: ComputedRef<boolean>
) {
  const { t } = useI18n();

  const configOptions = computed(() => ({
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
          dashboardPanelData.data.type !== "maps",
      },
    },
    geographic: {
      "geographic-config": {
        label: t("dashboard.geographicConfig"),
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
      unit: {
        label: t("dashboard.unitLabel"),
      },
      "custom-unit": {
        label: t("dashboard.customunitLabel"),
        visible: dashboardPanelData.data.config.unit === "custom",
      },
      decimals: {
        label: t("dashboard.decimals"),
      },
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
        visible: shouldShowTopResultsConfig(
          dashboardPanelData,
          promqlMode.value,
        ),
      },
      "top-results-others": {
        label: t("dashboard.addOthersSeries"),
        visible: shouldShowTopResultsConfig(
          dashboardPanelData,
          promqlMode.value,
        ),
      },
      "connect-nulls": {
        label: t("dashboard.connectNullValues"),
        visible: shouldShowAreaLineStyleConfig(dashboardPanelData),
      },
      "no-value-replacement": {
        label: t("dashboard.noValueReplacement"),
        visible: shouldShowNoValueReplacement(
          dashboardPanelData,
          promqlMode.value,
        ),
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
        label: t("dashboard.labelRotate"),
        visible: shouldShowCartesianAxisConfig(dashboardPanelData),
      },
      "axis-label": {
        label: [t("dashboard.labelRotate"), t("dashboard.labelTruncate")],
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
        visible: shouldShowLineThickness(
          dashboardPanelData,
          promqlMode.value,
        ),
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
      "value-transformations": {
        label: t("dashboard.valueTransformations"),
      },
    },
    fieldOverrides: {
      "field-overrides": {
        label: t("dashboard.fieldOverrides"),
      },
    },
    map: {
      "map-config": {
        label: t("dashboard.map"),
        visible:
          dashboardPanelData.data.type === "geomap" ||
          dashboardPanelData.data.type === "maps",
      },
    },
    gauge: {
      "gauge-min": {
        label: t("dashboard.gaugeMinimum"),
        visible: dashboardPanelData.data.type === "gauge",
      },
      "gauge-max": {
        label: t("dashboard.gaugeMaximum"),
        visible: dashboardPanelData.data.type === "gauge",
      },
    },
    layout: {
      "trellis-layout": {
        label: t("dashboard.trellisLayout"),
        visible: showTrellisConfig.value,
      },
      "trellis-columns": {
        label: t("dashboard.trellisColumns"),
        visible:
          showTrellisConfig.value &&
          dashboardPanelData.data.config.trellis?.layout === "custom",
      },
      "trellis-group-by": {
        label: t("dashboard.trellisGroupBy"),
        visible:
          showTrellisConfig.value &&
          dashboardPanelData.data.config.trellis?.layout != null,
      },
    },
    colors: {
      colors: {
        label: t("dashboard.colors"),
        visible: showColorPalette.value,
      },
    },
    drilldown: {
      drilldown: {
        label: t("dashboard.drilldown"),
        visible: shouldShowDrilldown(
          dashboardPanelData,
          dashboardPanelDataPageKey,
        ),
      },
    },
    comparison: {
      comparison: {
        label: t("dashboard.comparisonAgainst"),
        visible: shouldShowTimeShift(
          dashboardPanelData,
          promqlMode.value,
          dashboardPanelDataPageKey,
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
        label: t("dashboard.background"),
        visible: dashboardPanelData.data.type === "metric",
      },
    },
  }));

  return {
    configOptions,
  };
}

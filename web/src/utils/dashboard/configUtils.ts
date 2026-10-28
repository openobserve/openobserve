/**
 * Utility functions for dashboard panel configuration conditions
 */

interface PanelQueriesState {
  data: { queries?: Array<{ config?: { query_type?: string } } | null> };
  layout?: { hiddenQueries?: number[] };
}

interface PanelLegendState {
  data: { type?: string; config: { show_legends?: boolean } };
}

/**
 * Check that chart align option should be applied
 * @param dashboardPanelData - The dashboard panel data
 * @returns boolean indicating if chart align option should be applied
 */
export const shouldApplyChartAlign = (dashboardPanelData: any): boolean => {
  return (
    (dashboardPanelData.data.type === "pie" || dashboardPanelData.data.type === "donut") &&
    dashboardPanelData.data.config.show_legends &&
    dashboardPanelData.data.config.legends_position === "right" &&
    (dashboardPanelData.data.config.legends_type === "plain" ||
      dashboardPanelData.data.config.legends_type === "scroll" ||
      dashboardPanelData.data.config.legends_type === null) &&
    dashboardPanelData.data.config.trellis?.layout === null
  );
};

/** True when every visible query of the panel is a PromQL instant query, which has one sample per series. */
export const allVisibleQueriesInstant = (dashboardPanelData: PanelQueriesState): boolean => {
  const hidden = dashboardPanelData.layout?.hiddenQueries ?? [];
  const visible = (dashboardPanelData.data.queries ?? []).filter(
    (_, index) => !hidden.includes(index),
  );
  // With every query hidden the panel may still be range, so its reducer must stay reachable.
  return visible.length > 0 && visible.every((query) => query?.config?.query_type === "instant");
};

/** Pie and donut legends can append each slice's value and percent. */
export const shouldShowLegendValues = (dashboardPanelData: PanelLegendState): boolean =>
  (dashboardPanelData.data.type === "pie" || dashboardPanelData.data.type === "donut") &&
  !!dashboardPanelData.data.config.show_legends;

/**
 * Check that show Gridlines option should be applied
 * @param dashboardPanelData - The dashboard panel data
 * @returns boolean indicating if show Gridlines option should be applied
 */
export const shouldShowGridlines = (dashboardPanelData: any): boolean => {
  return (
    dashboardPanelData.data.type != "table" &&
    dashboardPanelData.data.type != "heatmap" &&
    dashboardPanelData.data.type != "metric" &&
    dashboardPanelData.data.type != "gauge" &&
    dashboardPanelData.data.type != "geomap" &&
    dashboardPanelData.data.type != "pie" &&
    dashboardPanelData.data.type != "donut" &&
    dashboardPanelData.data.type != "sankey" &&
    dashboardPanelData.data.type != "maps" &&
    dashboardPanelData.data.type != "hostmap"
  );
};

/**
 * Check if show legends toggle should be displayed
 * @param dashboardPanelData - The dashboard panel data
 * @returns boolean indicating if show legends should be displayed
 */
export const shouldShowLegendsToggle = (dashboardPanelData: any): boolean => {
  return (
    dashboardPanelData.data.type !== "table" &&
    dashboardPanelData.data.type !== "heatmap" &&
    dashboardPanelData.data.type !== "metric" &&
    dashboardPanelData.data.type !== "gauge" &&
    dashboardPanelData.data.type !== "geomap" &&
    dashboardPanelData.data.type !== "sankey" &&
    dashboardPanelData.data.type !== "maps" &&
    dashboardPanelData.data.config.trellis?.layout === null
  );
};

/**
 * Check if legend position selector should be displayed
 * @param dashboardPanelData - The dashboard panel data
 * @returns boolean indicating if legend position should be displayed
 */
export const shouldShowLegendPosition = (dashboardPanelData: any): boolean => {
  return (
    dashboardPanelData.data.type !== "table" &&
    dashboardPanelData.data.type !== "heatmap" &&
    dashboardPanelData.data.type !== "metric" &&
    dashboardPanelData.data.type !== "gauge" &&
    dashboardPanelData.data.type !== "geomap" &&
    dashboardPanelData.data.config.show_legends &&
    dashboardPanelData.data.type !== "sankey" &&
    dashboardPanelData.data.type !== "maps" &&
    dashboardPanelData.data.type !== "state-timeline" &&
    dashboardPanelData.data.type !== "hostmap" &&
    dashboardPanelData.data.config.trellis?.layout === null
  );
};

/**
 * Check if legend type selector should be displayed
 * @param dashboardPanelData - The dashboard panel data
 * @returns boolean indicating if legend type should be displayed
 */
export const shouldShowLegendType = (dashboardPanelData: any): boolean => {
  return (
    dashboardPanelData.data.type !== "table" &&
    dashboardPanelData.data.type !== "heatmap" &&
    dashboardPanelData.data.type !== "metric" &&
    dashboardPanelData.data.type !== "gauge" &&
    dashboardPanelData.data.type !== "geomap" &&
    dashboardPanelData.data.config.show_legends &&
    dashboardPanelData.data.type !== "sankey" &&
    dashboardPanelData.data.type !== "maps" &&
    dashboardPanelData.data.type !== "state-timeline" &&
    dashboardPanelData.data.type !== "hostmap" &&
    dashboardPanelData.data.config.trellis?.layout === null
  );
};
/**
 * Check if legend width configuration should be displayed
 * @param dashboardPanelData - The dashboard panel data
 * @returns boolean indicating if legend width should be displayed
 */
export const shouldShowLegendWidth = (dashboardPanelData: any): boolean => {
  return (
    dashboardPanelData.data.type !== "table" &&
    dashboardPanelData.data.type !== "heatmap" &&
    dashboardPanelData.data.type !== "metric" &&
    dashboardPanelData.data.type !== "gauge" &&
    dashboardPanelData.data.type !== "geomap" &&
    dashboardPanelData.data.config.show_legends &&
    dashboardPanelData.data.config.legends_position === "right" &&
    dashboardPanelData.data.config.legends_type === "plain" &&
    dashboardPanelData.data.type !== "sankey" &&
    dashboardPanelData.data.type !== "maps" &&
    dashboardPanelData.data.type !== "state-timeline" &&
    dashboardPanelData.data.type !== "hostmap" &&
    dashboardPanelData.data.config.trellis?.layout === null
  );
};

/**
 * Check if legend height configuration should be displayed
 * @param dashboardPanelData - The dashboard panel data
 * @returns boolean indicating if legend height should be displayed
 */
export const shouldShowLegendHeight = (dashboardPanelData: any): boolean => {
  return (
    dashboardPanelData.data.type !== "table" &&
    dashboardPanelData.data.type !== "heatmap" &&
    dashboardPanelData.data.type !== "metric" &&
    dashboardPanelData.data.type !== "gauge" &&
    dashboardPanelData.data.type !== "geomap" &&
    dashboardPanelData.data.config.show_legends &&
    (dashboardPanelData.data.config.legends_position === null ||
      dashboardPanelData.data.config.legends_position === "bottom") &&
    dashboardPanelData.data.config.legends_type === "plain" &&
    dashboardPanelData.data.type !== "sankey" &&
    dashboardPanelData.data.type !== "maps" &&
    dashboardPanelData.data.type !== "state-timeline" &&
    dashboardPanelData.data.type !== "hostmap" &&
    dashboardPanelData.data.config.trellis?.layout === null
  );
};

/**
 * Check if legend width unit container should be displayed
 * @param dashboardPanelData - The dashboard panel data
 * @returns boolean indicating if legend width unit container should be displayed
 */
export const shouldShowLegendWidthUnitContainer = (dashboardPanelData: any): boolean => {
  return shouldShowLegendWidth(dashboardPanelData);
};

/**
 * Check if legend height unit container should be displayed
 * @param dashboardPanelData - The dashboard panel data
 * @returns boolean indicating if legend height unit container should be displayed
 */
export const shouldShowLegendHeightUnitContainer = (dashboardPanelData: any): boolean => {
  return shouldShowLegendHeight(dashboardPanelData);
};

/**
 * Check if no value replacement input should be displayed
 * @param dashboardPanelData - The dashboard panel data
 * @param promqlMode - Whether promql mode is active
 * @returns boolean indicating if no value replacement input should be displayed
 */
export const shouldShowNoValueReplacement = (
  dashboardPanelData: any,
  promqlMode: boolean,
): boolean => {
  // A host map cell with no data shows this text in both query modes.
  if (dashboardPanelData.data.type === "hostmap") return true;
  return (
    ["area", "line", "area-stacked", "bar", "stacked"].includes(dashboardPanelData.data.type) &&
    !promqlMode
  );
};

/** True for panels that draw a "No Data" state the user can reword; HTML and Markdown panels show none. */
export const shouldShowNoDataText = (dashboardPanelData: any): boolean =>
  !["html", "markdown"].includes(dashboardPanelData?.data?.type);

/** A typed minimum interval as stored: a positive number, or null for automatic. */
export const toMinInterval = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

/**
 * Check if connect nulls toggle, show symbol select, and line interpolation select should be displayed
 * Used by: connect_nulls toggle, show_symbol select, line_interpolation select
 * @param dashboardPanelData - The dashboard panel data
 * @returns boolean indicating if area/line style config controls should be displayed
 */
export const shouldShowAreaLineStyleConfig = (dashboardPanelData: any): boolean => {
  return ["area", "line", "area-stacked"].includes(dashboardPanelData.data.type);
};

/**
 * Check if top results config (input and others toggle) should be displayed
 * Used by: top_results input, top_results_others toggle
 * @param dashboardPanelData - The dashboard panel data
 * @param promqlMode - Whether promql mode is active
 * @returns boolean indicating if top results config should be displayed
 */
export const shouldShowTopResultsConfig = (
  dashboardPanelData: any,
  promqlMode: boolean,
): boolean => {
  return (
    ["area", "bar", "line", "h-bar", "h-stacked", "scatter", "area-stacked", "stacked"].includes(
      dashboardPanelData.data.type,
    ) && !promqlMode
  );
};

/**
 * Check if axis width input and axis border toggle should be displayed
 * Used by: axis_width input, axis_border_show toggle
 * @param dashboardPanelData - The dashboard panel data
 * @returns boolean indicating if axis config controls should be displayed
 */
export const shouldShowAxisConfig = (dashboardPanelData: any): boolean => {
  return (
    dashboardPanelData.data.type != "gauge" &&
    dashboardPanelData.data.type != "metric" &&
    dashboardPanelData.data.type != "geomap" &&
    dashboardPanelData.data.type != "table" &&
    dashboardPanelData.data.type != "pie" &&
    dashboardPanelData.data.type != "donut" &&
    dashboardPanelData.data.type != "sankey" &&
    dashboardPanelData.data.type != "maps" &&
    dashboardPanelData.data.type != "state-timeline" &&
    dashboardPanelData.data.type != "hostmap"
  );
};

// The editor stores axis_border_show false by default, so honouring it on heatmaps would strip the axis lines of every saved one.
export const shouldShowAxisBorderConfig = (dashboardPanelData: any): boolean =>
  shouldShowAxisConfig(dashboardPanelData) && dashboardPanelData.data.type !== "heatmap";

/**
 * Check if cartesian chart axis/label/markline config should be displayed
 * Used by: y_axis_min/max div, label_option position select, label_option rotate input, MarkLineConfig
 * @param dashboardPanelData - The dashboard panel data
 * @returns boolean indicating if cartesian axis config should be displayed
 */
export const shouldShowCartesianAxisConfig = (dashboardPanelData: any): boolean => {
  return [
    "area",
    "area-stacked",
    "bar",
    "h-bar",
    "line",
    "scatter",
    "stacked",
    "h-stacked",
  ].includes(dashboardPanelData.data.type);
};

/**
 * Check if axis label rotate and truncate inputs should be displayed
 * Used by: axis_label_rotate input, axis_label_truncate_width input (wrapper div)
 * @param dashboardPanelData - The dashboard panel data
 * @returns boolean indicating if axis label config should be displayed
 */
export const shouldShowAxisLabelConfig = (dashboardPanelData: any): boolean => {
  return ["area", "area-stacked", "bar", "line", "scatter", "stacked"].includes(
    dashboardPanelData.data.type,
  );
};

/** Fill opacity and gradient apply to the unstacked area chart only. */
export const shouldShowAreaFillConfig = (dashboardPanelData: any): boolean => {
  return dashboardPanelData.data.type === "area";
};

/**
 * Check if the scatter point size and opacity inputs should be displayed
 * Used by: symbol_size input, symbol_opacity input
 * @param dashboardPanelData - The dashboard panel data
 * @returns boolean indicating if the point inputs should be displayed
 */
export const shouldShowScatterPointConfig = (dashboardPanelData: {
  data: { type?: string };
}): boolean => {
  return dashboardPanelData.data.type === "scatter";
};

/**
 * Check if the bar track switch should be displayed
 * Used by: show_bar_track switch
 * @param dashboardPanelData - The dashboard panel data
 * @returns boolean indicating if the bar track switch should be displayed
 */
export const shouldShowBarStyleConfig = (dashboardPanelData: any): boolean =>
  dashboardPanelData.data.type === "h-bar";

/**
 * Check if the bar width input should be displayed: wherever a converter reads bar_width
 * Used by: bar_width input
 * @param dashboardPanelData - The dashboard panel data
 * @param promqlMode - Whether promql mode is active
 * @returns boolean indicating if the bar width input should be displayed
 */
export const shouldShowBarWidthConfig = (dashboardPanelData: any, promqlMode: boolean): boolean =>
  dashboardPanelData.data.type === "h-bar" ||
  (promqlMode && ["bar", "stacked", "h-stacked"].includes(dashboardPanelData.data.type));

/**
 * Check if Drilldown component should be displayed
 * Used by: Drilldown component
 * @param dashboardPanelData - The dashboard panel data
 * @param dashboardPanelDataPageKey - The page key context
 * @returns boolean indicating if Drilldown should be displayed
 */
export const shouldShowDrilldown = (
  dashboardPanelData: any,
  dashboardPanelDataPageKey: string,
): boolean => {
  return (
    !["html", "markdown", "geomap", "maps"].includes(dashboardPanelData.data.type) &&
    dashboardPanelDataPageKey !== "logs"
  );
};

/**
 * Check if time shift comparison section should be displayed
 * Used by: time shift wrapper div (comparisonAgainst section)
 * @param dashboardPanelData - The dashboard panel data
 * @param promqlMode - Whether promql mode is active
 * @param dashboardPanelDataPageKey - The page key context
 * @returns boolean indicating if time shift section should be displayed
 */
export const shouldShowTimeShift = (
  dashboardPanelData: any,
  promqlMode: boolean,
  dashboardPanelDataPageKey: string,
): boolean => {
  return (
    ["area", "bar", "line", "h-bar", "h-stacked", "scatter", "area-stacked", "stacked"].includes(
      dashboardPanelData.data.type,
    ) &&
    // A time shift needs a time range to shift; an instant query has none.
    !(
      promqlMode &&
      (dashboardPanelData.data.queries ?? []).some(
        (query: any) => query?.config?.query_type === "instant",
      )
    ) &&
    dashboardPanelDataPageKey !== "logs"
  );
};

/** Whether the PromQL range/instant selector applies; a state timeline always runs a range query. */
export const shouldShowPromQLQueryType = (dashboardPanelData: any): boolean => {
  return dashboardPanelData.data.type !== "state-timeline";
};

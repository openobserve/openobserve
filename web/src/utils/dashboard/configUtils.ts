/**
 * Utility functions for dashboard panel configuration conditions
 */

/**
 * Check that chart align option should be applied
 * @param dashboardPanelData - The dashboard panel data
 * @returns boolean indicating if chart align option should be applied
 */
export const shouldApplyChartAlign = (dashboardPanelData: any): boolean => {
  return (
    (dashboardPanelData.data.type === "pie" ||
      dashboardPanelData.data.type === "donut") &&
    dashboardPanelData.data.config.show_legends &&
    dashboardPanelData.data.config.legends_position === "right" &&
    (dashboardPanelData.data.config.legends_type === "plain" ||
      dashboardPanelData.data.config.legends_type === "scroll" ||
      dashboardPanelData.data.config.legends_type === null) &&
    dashboardPanelData.data.config.trellis?.layout === null
  );
};

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
    dashboardPanelData.data.type != "maps"
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
    dashboardPanelData.data.config.trellis?.layout === null
  );
};

/**
 * Check if legend width unit container should be displayed
 * @param dashboardPanelData - The dashboard panel data
 * @returns boolean indicating if legend width unit container should be displayed
 */
export const shouldShowLegendWidthUnitContainer = (
  dashboardPanelData: any,
): boolean => {
  return shouldShowLegendWidth(dashboardPanelData);
};

/**
 * Check if legend height unit container should be displayed
 * @param dashboardPanelData - The dashboard panel data
 * @returns boolean indicating if legend height unit container should be displayed
 */
export const shouldShowLegendHeightUnitContainer = (
  dashboardPanelData: any,
): boolean => {
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
  return (
    ["area", "line", "area-stacked", "bar", "stacked", "table"].includes(
      dashboardPanelData.data.type,
    ) && !promqlMode
  );
};

/**
 * Check if connect nulls toggle, show symbol select, and line interpolation select should be displayed
 * Used by: connect_nulls toggle, show_symbol select, line_interpolation select
 * @param dashboardPanelData - The dashboard panel data
 * @returns boolean indicating if area/line style config controls should be displayed
 */
export const shouldShowAreaLineStyleConfig = (
  dashboardPanelData: any,
): boolean => {
  return ["area", "line", "area-stacked"].includes(
    dashboardPanelData.data.type,
  );
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
    [
      "area",
      "bar",
      "line",
      "h-bar",
      "h-stacked",
      "scatter",
      "area-stacked",
      "stacked",
    ].includes(dashboardPanelData.data.type) && !promqlMode
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
    dashboardPanelData.data.type != "maps"
  );
};

/**
 * Check if cartesian chart axis/label/markline config should be displayed
 * Used by: y_axis_min/max div, label_option position select, label_option rotate input, MarkLineConfig
 * @param dashboardPanelData - The dashboard panel data
 * @returns boolean indicating if cartesian axis config should be displayed
 */
export const shouldShowCartesianAxisConfig = (
  dashboardPanelData: any,
): boolean => {
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

/**
 * Check if line thickness input should be displayed
 * Used by: line_thickness input
 * @param dashboardPanelData - The dashboard panel data
 * @param promqlMode - Whether promql mode is active
 * @returns boolean indicating if line thickness input should be displayed
 */
export const shouldShowLineThickness = (
  dashboardPanelData: any,
  promqlMode: boolean,
): boolean => {
  return (
    !promqlMode &&
    !dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].customQuery &&
    ["area", "area-stacked", "line"].includes(dashboardPanelData.data.type)
  );
};

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
    !["html", "markdown", "geomap", "maps"].includes(
      dashboardPanelData.data.type,
    ) && dashboardPanelDataPageKey !== "logs"
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
    [
      "area",
      "bar",
      "line",
      "h-bar",
      "h-stacked",
      "scatter",
      "area-stacked",
      "stacked",
    ].includes(dashboardPanelData.data.type) &&
    !promqlMode &&
    dashboardPanelDataPageKey !== "logs"
  );
};

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

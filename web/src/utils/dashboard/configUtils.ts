/**
 * Utility functions for dashboard panel configuration conditions
 */

interface DashboardPanelData {
  data: {
    type: string;
    config: {
      show_legends?: boolean;
      legends_position?: string | null;
      legends_type?: string | null;
    };
  };
}

/**
 * Check if show legends toggle should be displayed
 * @param dashboardPanelData - The dashboard panel data object
 * @param isTrellisEnabled - Whether trellis is enabled
 * @returns boolean indicating if show legends should be displayed
 */
export function shouldShowLegendsToggle(
  dashboardPanelData: DashboardPanelData,
  isTrellisEnabled: boolean,
): boolean {
  return (
    dashboardPanelData.data.type !== "table" &&
    dashboardPanelData.data.type !== "heatmap" &&
    dashboardPanelData.data.type !== "metric" &&
    dashboardPanelData.data.type !== "gauge" &&
    dashboardPanelData.data.type !== "geomap" &&
    dashboardPanelData.data.type !== "sankey" &&
    dashboardPanelData.data.type !== "maps" &&
    !isTrellisEnabled
  );
}

/**
 * Check if legend position selector should be displayed
 * @param dashboardPanelData - The dashboard panel data object
 * @param isTrellisEnabled - Whether trellis is enabled
 * @returns boolean indicating if legend position should be displayed
 */
export function shouldShowLegendPosition(
  dashboardPanelData: DashboardPanelData,
  isTrellisEnabled: boolean,
): boolean {
  return (
    dashboardPanelData.data.type !== "table" &&
    dashboardPanelData.data.type !== "heatmap" &&
    dashboardPanelData.data.type !== "metric" &&
    dashboardPanelData.data.type !== "gauge" &&
    dashboardPanelData.data.type !== "geomap" &&
    dashboardPanelData.data.config.show_legends &&
    dashboardPanelData.data.type !== "sankey" &&
    dashboardPanelData.data.type !== "maps" &&
    !isTrellisEnabled
  );
}

/**
 * Check if legend type selector should be displayed
 * @param dashboardPanelData - The dashboard panel data object
 * @param isTrellisEnabled - Whether trellis is enabled
 * @returns boolean indicating if legend type should be displayed
 */
export function shouldShowLegendType(
  dashboardPanelData: DashboardPanelData,
  isTrellisEnabled: boolean,
): boolean {
  return (
    dashboardPanelData.data.type !== "table" &&
    dashboardPanelData.data.type !== "heatmap" &&
    dashboardPanelData.data.type !== "metric" &&
    dashboardPanelData.data.type !== "gauge" &&
    dashboardPanelData.data.type !== "geomap" &&
    dashboardPanelData.data.config.show_legends &&
    dashboardPanelData.data.type !== "sankey" &&
    dashboardPanelData.data.type !== "maps" &&
    !isTrellisEnabled
  );
}

/**
 * Check if legend width configuration should be displayed
 * @param dashboardPanelData - The dashboard panel data object
 * @param isTrellisEnabled - Whether trellis is enabled
 * @returns boolean indicating if legend width should be displayed
 */
export function shouldShowLegendWidth(
  dashboardPanelData: DashboardPanelData,
  isTrellisEnabled: boolean,
): boolean {
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
    !isTrellisEnabled
  );
}

/**
 * Check if legend height configuration should be displayed
 * @param dashboardPanelData - The dashboard panel data object
 * @param isTrellisEnabled - Whether trellis is enabled
 * @returns boolean indicating if legend height should be displayed
 */
export function shouldShowLegendHeight(
  dashboardPanelData: DashboardPanelData,
  isTrellisEnabled: boolean,
): boolean {
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
    !isTrellisEnabled
  );
}

/**
 * Check if legend width unit container should be displayed
 * @param dashboardPanelData - The dashboard panel data object
 * @param isTrellisEnabled - Whether trellis is enabled
 * @returns boolean indicating if legend width unit container should be displayed
 */
export function shouldShowLegendWidthUnitContainer(
  dashboardPanelData: DashboardPanelData,
  isTrellisEnabled: boolean,
): boolean {
  return shouldShowLegendWidth(dashboardPanelData, isTrellisEnabled);
}

/**
 * Check if legend height unit container should be displayed
 * @param dashboardPanelData - The dashboard panel data object
 * @param isTrellisEnabled - Whether trellis is enabled
 * @returns boolean indicating if legend height unit container should be displayed
 */
export function shouldShowLegendHeightUnitContainer(
  dashboardPanelData: DashboardPanelData,
  isTrellisEnabled: boolean,
): boolean {
  return shouldShowLegendHeight(dashboardPanelData, isTrellisEnabled);
}

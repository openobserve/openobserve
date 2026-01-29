/**
 * Composable for managing field list collapse/expand functionality
 * Used across visualization components (AddPanel, VisualizeLogsQuery, BuildQueryTab)
 */

export function useFieldListCollapse(dashboardPanelData: any) {
  /**
   * Toggle field list visibility
   * When collapsed: splitter = 0, showFieldList = false
   * When expanded: splitter = 20, showFieldList = true
   * Dispatches resize event to trigger chart re-render
   */
  const collapseFieldList = () => {
    if (dashboardPanelData.layout.showFieldList) {
      dashboardPanelData.layout.showFieldList = false;
      dashboardPanelData.layout.splitter = 0;
    } else {
      dashboardPanelData.layout.showFieldList = true;
      dashboardPanelData.layout.splitter = 20;
    }
    // Trigger chart resize to adjust to new layout
    window.dispatchEvent(new Event("resize"));
  };

  /**
   * Handle splitter value update
   * Updates showFieldList based on splitter position
   * @param value - New splitter value (0-100)
   */
  const layoutSplitterUpdated = (value: number) => {
    dashboardPanelData.layout.showFieldList = value > 0;
    // Trigger chart resize
    window.dispatchEvent(new Event("resize"));
  };

  return {
    collapseFieldList,
    layoutSplitterUpdated,
  };
}

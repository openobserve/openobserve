import { ref } from "vue";
import { getUUID } from "@/utils/zincutils";

/**
 * Composable to manage dashboard run IDs
 * Run ID changes only on whole dashboard refresh, not individual panel refresh
 */
export const useDashboardRunId = () => {
  // Global run ID that changes only on whole dashboard refresh
  const globalRunId = ref(getUUID().replace(/-/g, ""));

  /**
   * Generate a new run ID for the entire dashboard
   * This should be called only when the whole dashboard is refreshed
   */
  const generateNewDashboardRunId = () => {
    globalRunId.value = getUUID().replace(/-/g, "");
    return globalRunId.value;
  };

  /**
   * Get the current global run ID
   * @returns The current global run ID
   */
  const getCurrentRunId = () => globalRunId.value;

  /**
   * Get both panel ID and run ID for API calls
   * @param panelId - The panel ID
   * @returns Object containing panel ID and common run ID
   */
  const getPanelAndRunId = (panelId: string) => ({
    panelId,
    runId: globalRunId.value, // All panels use the same global run ID
  });

  return {
    globalRunId,
    generateNewDashboardRunId,
    getCurrentRunId,
    getPanelAndRunId,
  };
};

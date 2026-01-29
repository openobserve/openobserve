/**
 * Composable for managing chart warnings and error messages
 * Handles three types of warnings:
 * 1. Error messages (API errors, validation errors)
 * 2. Max query range warnings (time range too large)
 * 3. Series limit warnings (too many series to display)
 */

import { ref } from "vue";
import { processQueryMetadataErrors } from "@/utils/zincutils";
import { useStore } from "vuex";

export function useChartWarnings() {
  const store = useStore();

  // Error message state (red warning icon)
  const errorMessage = ref("");

  // Max query range warning (yellow warning icon)
  const maxQueryRangeWarning = ref("");

  // Series limit warning (blue info icon)
  const limitNumberOfSeriesWarningMessage = ref("");

  /**
   * Handle chart API errors
   * Accepts string or error object with message property
   * @param errorMsg - Error string or object
   */
  const handleChartApiError = (errorMsg: any) => {
    if (typeof errorMsg === "string") {
      errorMessage.value = errorMsg;
    } else if (errorMsg?.message) {
      errorMessage.value = errorMsg.message ?? "";
    } else {
      errorMessage.value = "";
    }
  };

  /**
   * Handle series limit warning message
   * @param message - Warning message to display
   */
  const handleLimitNumberOfSeriesWarningMessage = (message: string) => {
    limitNumberOfSeriesWarningMessage.value = message;
  };

  /**
   * Process result metadata and extract query range warnings
   * @param resultMetaData - Metadata from query result
   */
  const onResultMetadataUpdate = (resultMetaData: any) => {
    maxQueryRangeWarning.value = processQueryMetadataErrors(
      resultMetaData,
      store.state.timezone
    );
  };

  /**
   * Clear all warning messages
   */
  const clearAllWarnings = () => {
    errorMessage.value = "";
    maxQueryRangeWarning.value = "";
    limitNumberOfSeriesWarningMessage.value = "";
  };

  return {
    // State refs
    errorMessage,
    maxQueryRangeWarning,
    limitNumberOfSeriesWarningMessage,
    // Handlers
    handleChartApiError,
    handleLimitNumberOfSeriesWarningMessage,
    onResultMetadataUpdate,
    clearAllWarnings,
  };
}

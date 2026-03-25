/**
 * Traces Context Provider - Extracts context from the traces page
 *
 * This provider extracts context from the traces page including:
 * - Selected trace stream
 * - Time range selection
 * - Current search query and filters
 * - Search mode (traces vs spans)
 * - Selected trace details (if viewing a specific trace)
 *
 * Example Usage:
 * ```typescript
 * import { createTracesContextProvider } from '@/composables/contextProviders/tracesContextProvider';
 * import { contextRegistry } from '@/composables/contextProviders';
 *
 * const provider = createTracesContextProvider(searchObj, store);
 * contextRegistry.register('traces', provider);
 * contextRegistry.setActive('traces');
 *
 * const context = await contextRegistry.getActiveContext();
 * // Returns: { currentPage: 'traces', selectedStreams: ['sre_agent_traces'], streamType: 'traces', ... }
 * ```
 */

import type { ContextProvider, PageContext } from "./types";
import { getConsumableRelativeTime } from "@/utils/date";

/**
 * Builds time range context with actual microsecond timestamps for AI agent search queries.
 */
const buildTimeRangeContext = (datetimeObj: any) => {
  if (!datetimeObj) {
    return { type: "unknown" };
  }

  const baseContext = {
    type: datetimeObj.type || "relative",
  };

  if (datetimeObj.type === "relative") {
    const relativeTimePeriod =
      datetimeObj.relativeTimePeriod || datetimeObj.relative_period;
    const calculatedTime = getConsumableRelativeTime(relativeTimePeriod);

    return {
      ...baseContext,
      relativeTimePeriod,
      startTime: calculatedTime?.startTime || datetimeObj.startTime,
      endTime: calculatedTime?.endTime || datetimeObj.endTime,
    };
  } else if (datetimeObj.type === "absolute") {
    return {
      ...baseContext,
      startTime: datetimeObj.startTime,
      endTime: datetimeObj.endTime,
    };
  }

  return { ...baseContext, ...datetimeObj };
};

/**
 * Creates a traces context provider that extracts context from the current traces page state
 *
 * @param searchObj - The traces search object from useTraces composable
 * @param store - The Vuex store instance
 */
export const createTracesContextProvider = (
  searchObj: any,
  store: any
): ContextProvider => {
  return {
    async getContext(): Promise<PageContext> {
      try {
        const selectedStream =
          searchObj.data?.stream?.selectedStream?.value || "";

        // Build selected trace context if user is viewing a specific trace
        const traceDetails = searchObj.data?.traceDetails;
        const selectedTrace =
          traceDetails?.selectedTrace?.trace_id
            ? {
                traceId: traceDetails.selectedTrace.trace_id,
                traceStartTime: traceDetails.selectedTrace.trace_start_time,
                traceEndTime: traceDetails.selectedTrace.trace_end_time,
              }
            : undefined;

        return {
          currentPage: "traces",

          // Stream information
          selectedStreams: selectedStream ? [selectedStream] : [],
          streamType: "traces",

          // Search query
          currentQuery: searchObj.data?.editorValue || "",

          // Search mode: traces (full traces) vs spans (individual spans)
          searchMode: searchObj.meta?.searchMode || "traces",

          // Time range with microsecond timestamps
          timeRange: buildTimeRangeContext(searchObj.data?.datetime),

          // Currently selected trace (if any)
          ...(selectedTrace && { selectedTrace }),

          // Organization
          organization_identifier:
            store?.state?.selectedOrganization?.identifier || "",

          // Current timestamp (microseconds)
          request_timestamp: Date.now() * 1000,
        };
      } catch (error) {
        console.error("Error generating traces context:", error);
        return {
          currentPage: "traces",
          selectedStreams: [],
          streamType: "traces",
          organization_identifier:
            store?.state?.selectedOrganization?.identifier || "",
          request_timestamp: Date.now() * 1000,
          error: "Failed to extract full context",
        };
      }
    },
  };
};

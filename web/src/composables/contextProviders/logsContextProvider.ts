/**
 * Logs Context Provider - Extracts context from the logs page
 * 
 * This provider extracts context from the logs page including:
 * - Current search query and filters
 * - Time range selection
 * - Selected streams
 * - Search results and metadata
 * 
 * Example Usage:
 * ```typescript
 * import { logsContextProvider } from '@/composables/contextProviders/logsContextProvider';
 * import { contextRegistry } from '@/composables/contextProviders';
 * 
 * // Register the provider
 * contextRegistry.register('logs', logsContextProvider);
 * contextRegistry.setActive('logs');
 * 
 * // Get context
 * const context = await contextRegistry.getActiveContext();
 * // Returns: { currentPage: 'logs', currentSQLQuery: '...', selectedStreams: [...], ... }
 * ```
 */

import type { ContextProvider, PageContext } from './types';
import { getConsumableRelativeTime } from '@/utils/date';


/**
 * Extracts interesting fields organized by stream name from the actual selectedInterestingStreamFields structure
 * 
 * @param selectedInterestingStreamFields - Array of field objects with stream metadata
 * @returns Object with stream names as keys and their interesting fields as values
 * 
 * Example:
 * ```typescript
 * // Input: [{ name: "_timestamp", streams: ["default", "default11"], isInterestingField: true }, ...]
 * // Returns: { 
 * //   "default": ["_timestamp", "log", "level"], 
 * //   "default11": ["_timestamp", "log", "dfefjob"] 
 * // }
 * ```
 */
const extractInterestingFieldsByStream = (
  selectedInterestingStreamFields: any[]
): Record<string, string[]> => {
  if (!selectedInterestingStreamFields || selectedInterestingStreamFields.length === 0) {
    return {};
  }

  const organizedFields: Record<string, string[]> = {};

  // Filter only interesting fields (not labels or non-interesting fields)
  const interestingFields = selectedInterestingStreamFields.filter(
    (field: any) => field.isInterestingField && field.isSchemaField && !field.label
  );

  // Organize fields by stream
  interestingFields.forEach((field: any) => {
    const fieldName = field.name;
    const fieldStreams = field.streams || [];

    // Add this field to each stream it belongs to
    fieldStreams.forEach((streamName: string) => {
      if (!organizedFields[streamName]) {
        organizedFields[streamName] = [];
      }
      
      // Only add if not already present
      if (!organizedFields[streamName].includes(fieldName)) {
        organizedFields[streamName].push(fieldName);
      }
    });
  });

  return organizedFields;
};

/**
 * Builds time range context with actual microsecond timestamps for AI agent search queries.
 *
 * IMPORTANT: The AI agent needs actual microsecond timestamps (not relative strings like "3d")
 * to perform search queries. This function ensures startTime and endTime are always calculated
 * and included in the context, regardless of whether the user selected relative or absolute time.
 *
 * @param datetimeObj - The datetime object from searchObj
 * @returns Time range structure with startTime and endTime in microseconds
 *
 * Example:
 * ```typescript
 * // For relative time (e.g., "last 3 days"):
 * // Returns: { type: 'relative', relativeTimePeriod: '3d', startTime: 1768406781751488, endTime: 1768496804185872 }
 *
 * // For absolute time:
 * // Returns: { type: 'absolute', startTime: 1768406781751488, endTime: 1768496804185872, ... }
 * ```
 */
const buildTimeRangeContext = (datetimeObj: any) => {
  if (!datetimeObj) {
    return { type: 'unknown' };
  }

  const baseContext = {
    type: datetimeObj.type || 'relative'
  };

  if (datetimeObj.type === 'relative') {
    const relativeTimePeriod = datetimeObj.relativeTimePeriod || datetimeObj.relative_period;

    // Calculate actual timestamps from relative period for AI agent
    // The agent needs real microsecond timestamps to execute search queries
    const calculatedTime = getConsumableRelativeTime(relativeTimePeriod);

    return {
      ...baseContext,
      relativeTimePeriod,
      // Always include calculated timestamps so AI agent can search without needing to guess
      startTime: calculatedTime?.startTime || datetimeObj.startTime,
      endTime: calculatedTime?.endTime || datetimeObj.endTime
    };
  } else if (datetimeObj.type === 'absolute') {
    return {
      ...baseContext,
      startTime: datetimeObj.startTime,
      endTime: datetimeObj.endTime,
      ...(datetimeObj.selectedDate && { selectedDate: datetimeObj.selectedDate }),
      ...(datetimeObj.selectedTime && { selectedTime: datetimeObj.selectedTime }),
      ...(datetimeObj.queryRangeRestrictionMsg && { queryRangeRestrictionMsg: datetimeObj.queryRangeRestrictionMsg }),
      ...(datetimeObj.queryRangeRestrictionInHour !== undefined && { queryRangeRestrictionInHour: datetimeObj.queryRangeRestrictionInHour })
    };
  }

  // Fallback: include all available fields
  return { ...baseContext, ...datetimeObj };
};

/**
 * Creates a logs context provider that extracts context from the current logs page state
 * 
 * @param searchObj - The search object containing query, filters, and other search state
 * @param store - The Vuex store instance (passed from component)
 * @param dashboardPanelData - Dashboard panel data for visualize mode (optional)
 * 
 * Example:
 * ```typescript
 * const provider = createLogsContextProvider(searchObj, store, dashboardPanelData);
 * ```
 */
export const createLogsContextProvider = (
  searchObj: any,
  store: any,
  dashboardPanelData?: any
): ContextProvider => {
  return {
    async getContext(): Promise<PageContext> {
      try {
        // Extract streams and stream type based on current mode
        const streams = searchObj.meta.logsVisualizeToggle === "logs"
          ? searchObj.data.stream.selectedStream
          : dashboardPanelData ? [
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].fields.stream,
            ] : [];

        const streamType = searchObj.meta.logsVisualizeToggle === "logs"
          ? searchObj.data.stream.streamType
          : dashboardPanelData ? 
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].fields.stream_type : null;


        return {
          currentPage: 'logs',
          // Query and search information
          currentSQLQuery: searchObj?.data?.query || '',
          sqlMode: searchObj?.meta?.sqlMode || false,
          currentVRLQuery: searchObj?.data?.tempFunctionContent || '',

          // Stream information
          selectedStreams: streams || [],
          streamType: streamType,
          
          // Interesting fields organized by stream name (using actual structure)
          interestingFields: extractInterestingFieldsByStream(
            searchObj?.data?.stream?.selectedInterestingStreamFields || []
          ),
          
          // Time range (conditional based on type)
          timeRange: buildTimeRangeContext(searchObj.data.datetime),
          
          // Current organization
          organization_identifier: store?.state?.selectedOrganization?.identifier || '',
          quickMode: searchObj?.meta?.quickMode || false,
          
        };
      } catch (error) {
        console.error('Error generating logs context:', error);
        // Return basic context on error
        return {
          currentPage: 'logs',
          currentSQLQuery: searchObj?.data?.query || '',
          selectedStreams: searchObj?.data?.stream?.selectedStream || [],
          organization_identifier: store?.state?.selectedOrganization?.identifier || '',
          timestamp: new Date().toISOString(),
          error: 'Failed to extract full context'
        };
      }
    }
  };
};
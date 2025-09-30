/**
 * Logs Context Provider - Extracts context from the logs page
 * 
 * This provider extracts comprehensive context from the logs page including:
 * - Current search query and filters
 * - Time range selection
 * - Selected streams
 * - Search results and schema information
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
 * // Returns: { pageType: 'logs', data: { query: '...', streams: [...], ... } }
 * ```
 */

import type { ContextProvider, PageContext } from './types';

/**
 * Extracts field names from schema data for AI context
 * 
 * @param schemaData - The cached schema response data
 * @returns Array of field names and their types
 * 
 * Example:
 * ```typescript
 * const fields = extractFieldNames(schemaCache.response.data);
 * // Returns: [{ name: 'timestamp', type: 'datetime' }, { name: 'level', type: 'Utf8' }]
 * ```
 */
const extractFieldNames = (schemaData: any): Array<{name: string, type: string}> => {
  if (!schemaData || !Array.isArray(schemaData)) {
    return [];
  }
  
  return schemaData.map((field: any) => ({
    name: field.name || '',
    type: field.type || 'unknown'
  })).filter((field: any) => field.name); // Filter out empty names
};

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
 * Builds conditional time range context based on whether it's relative or absolute
 * 
 * @param datetimeObj - The datetime object from searchObj
 * @returns Conditional time range structure
 * 
 * Example:
 * ```typescript
 * // For relative time:
 * // Returns: { type: 'relative', relativeTimePeriod: '3d' }
 * 
 * // For absolute time:
 * // Returns: { type: 'absolute', startTime: 123456, endTime: 789012, selectedDate: {...}, selectedTime: {...} }
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
    return {
      ...baseContext,
      relativeTimePeriod: datetimeObj.relativeTimePeriod || datetimeObj.relative_period
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
 * @param getStreamFn - Function to get stream schema (passed from component)
 * @param dashboardPanelData - Dashboard panel data for visualize mode (optional)
 * 
 * Example:
 * ```typescript
 * const provider = createLogsContextProvider(searchObj, store, getStream, dashboardPanelData);
 * ```
 */
export const createLogsContextProvider = (
  searchObj: any,
  store: any,
  getStreamFn: any,
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

        // Extract comprehensive schema information for each stream
        const streamSchemas: any = {};
        
        if (streamType && streams?.length && getStreamFn) {
          for (let i = 0; i < streams.length; i++) {
            try {
              const schema = await getStreamFn(streams[i], streamType, true);
              let schemaData = JSON.parse(JSON.stringify(schema.uds_schema || schema.schema || [])); // Deep copy
              let isUdsEnabled = schema.uds_schema?.length > 0;
              
              // Add timestamp and all fields columns if UDS is enabled
              if (isUdsEnabled) {
                const timestampColumn = store.state.zoConfig?.timestamp_column;
                const allFieldsName = store.state.zoConfig?.all_fields_name;
                
                if (timestampColumn) {
                  schemaData.push({
                    name: timestampColumn,
                    type: "Int64",
                  });
                }
                
                if (allFieldsName) {
                  schemaData.push({
                    name: allFieldsName,
                    type: "Utf8",
                  });
                }
              }
              
              streamSchemas[`stream_name_${i + 1}`] = streams[i];
              streamSchemas[`schema_${i + 1}`] = schemaData;
            } catch (error) {
              console.error(`Error getting schema for stream ${streams[i]}:`, error);
            }
          }
        }

        return {
          pageType: 'logs',
          data: {
            // Query and search information
            currentQuery: searchObj?.data?.query || '',
            sqlMode: searchObj?.meta?.sqlMode || false,
            
            // Stream information
            selectedStreams: streams || [],
            streamType: streamType,
            
            // Comprehensive schema information (following legacy pattern)
            streamSchemas,
            
            // Interesting fields organized by stream name (using actual structure)
            interestingFields: extractInterestingFieldsByStream(
              searchObj?.data?.stream?.selectedInterestingStreamFields || []
            ),
            
            // Time range (conditional based on type)
            timeRange: buildTimeRangeContext(searchObj.data.datetime),
            
            // Current organization
            organization: store?.state?.selectedOrganization?.identifier || '',
            
            showHistogram: searchObj?.meta?.showHistogram,
            showFields: searchObj?.meta?.showFields,
            visualizeToggle: searchObj?.meta?.logsVisualizeToggle,
            quickMode: searchObj?.meta?.quickMode || false,
            
            // Search metadata (lightweight, no actual results)
            searchResultData: {
              totalResultsLength: searchObj?.data?.queryResults?.hits?.length || 0,
              totalTimeTook: searchObj?.data?.queryResults?.took || 0,
              resultCacheRatio: searchObj?.data?.queryResults?.result_cache_ratio || 0,
              partitionsTotal: searchObj?.data?.queryResults?.partitionDetail?.partitions?.length || 0,
            },
            
            // Additional metadata
            timestamp: new Date().toISOString()
          }
        };
      } catch (error) {
        console.error('Error generating logs context:', error);
        // Return basic context on error
        return {
          pageType: 'logs',
          data: {
            currentQuery: searchObj?.data?.query || '',
            selectedStreams: searchObj?.data?.stream?.selectedStream || [],
            organization: store?.state?.selectedOrganization?.identifier || '',
            timestamp: new Date().toISOString(),
            error: 'Failed to extract full context'
          }
        };
      }
    }
  };
};
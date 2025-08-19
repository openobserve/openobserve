/**
 * useLogsStreamManagement.ts
 * 
 * Manages stream-related operations, field management, and stream selection for the logs module.
 * Handles stream listing, field extraction, stream changes, and field configuration management.
 */

import { ref, computed, readonly, type Ref, type ComputedRef } from 'vue';
import { useRouter } from 'vue-router';
import { useStore } from 'vuex';
import { useLocalInterestingFields } from '@/utils/zincutils';
import useStreams from '@/composables/useStreams';
import useSqlSuggestions from '@/composables/useSuggestions';
import streamService from '@/services/stream';
import type { 
  UseLogsStreamManagement,
  SearchObject
} from './INTERFACES_AND_TYPES';

/**
 * Stream Management Composable
 * 
 * Provides comprehensive stream management functionality including:
 * - Stream listing and selection
 * - Field extraction and management
 * - Stream schema handling
 * - Interest field management
 * - Stream change handling
 */
export default function useLogsStreamManagement(
  searchObj: Ref<SearchObject>
): UseLogsStreamManagement {
  const router = useRouter();
  const store = useStore();
  const { getStreams, getStream, isStreamExists, isStreamFetched } = useStreams();
  const { updateFieldKeywords } = useSqlSuggestions();

  // ========================================
  // REACTIVE STATE
  // ========================================

  // FTS (Full Text Search) fields for the selected streams
  const ftsFields = ref<string[]>([]);

  // Field values for autocomplete and suggestions
  const fieldValues = ref<any>({});

  // Stream schema fields index mapping for quick lookup
  const streamSchemaFieldsIndexMapping = ref<{ [key: string]: number }>({});

  // ========================================
  // COMPUTED PROPERTIES
  // ========================================

  const streamLists: ComputedRef<any[]> = computed(() => 
    searchObj.value.data.stream.streamLists
  );

  const selectedStreams: ComputedRef<string[]> = computed(() => 
    searchObj.value.data.stream.selectedStream
  );

  const streamFields: ComputedRef<any[]> = computed(() => 
    searchObj.value.data.stream.selectedStreamFields
  );

  const interestingFields: ComputedRef<string[]> = computed(() => 
    searchObj.value.data.stream.interestingFieldList
  );

  const streamType: ComputedRef<string> = computed(() => 
    searchObj.value.data.stream.streamType
  );

  // ========================================
  // STREAM LISTING FUNCTIONS
  // ========================================

  /**
   * Loads and processes stream lists from stream results
   * Handles stream selection logic based on query params and last updated time
   * 
   * @param selectStream Whether to automatically select a stream
   */
  async function loadStreamLists(selectStream: boolean = true): Promise<void> {
    try {
      // First, fetch streams from API (this was missing!)
      const streamType = searchObj.value.data.stream.streamType || "logs";
      const streamData: any = await getStreams(streamType, false);
      
      // Populate streamResults with the fetched data
      searchObj.value.data.streamResults = {
        ...streamData,
      };

      // Now process the stream data into dropdown format
      if (searchObj.value.data.streamResults.list.length > 0) {
        let lastUpdatedStreamTime = 0;
        let selectedStream: any[] = [];

        searchObj.value.data.stream.streamLists = [];

        for (const item of searchObj.value.data.streamResults.list) {
          const itemObj = {
            label: item.name,
            value: item.name,
          };

          searchObj.value.data.stream.streamLists.push(itemObj);

          // Select stream from query params if specified
          if (router.currentRoute.value?.query?.stream === item.name) {
            selectedStream.push(itemObj.value);
          }
          
          // Auto-select most recently updated stream if no query param
          if (
            !router.currentRoute.value?.query?.stream &&
            item.stats.doc_time_max >= lastUpdatedStreamTime
          ) {
            selectedStream = [];
            lastUpdatedStreamTime = item.stats.doc_time_max;
            selectedStream.push(itemObj.value);
          }
        }

        // Apply stream selection based on configuration
        if (
          (store.state.zoConfig.query_on_stream_selection === false ||
          router.currentRoute.value.query?.type === "stream_explorer") && 
          selectStream
        ) {
          searchObj.value.data.stream.selectedStream = selectedStream;
        }
      } else {
        searchObj.value.data.errorMsg = "No stream found in selected organization!";
      }
    } catch (e: any) {
      console.error("Error while loading stream list:", e);
      searchObj.value.data.errorMsg = "Error loading streams. Please try again.";
    }
  }

  /**
   * Loads fields for a specific stream
   * 
   * @param streamName Name of the stream to load fields for
   * @returns Promise resolving to stream data
   */
  async function loadStreamFields(streamName: string): Promise<any> {
    try {
      if (streamName !== "") {
        searchObj.value.loadingStream = true;
        return await getStream(
          streamName,
          searchObj.value.data.stream.streamType || "logs",
          true,
        ).then((res) => {
          searchObj.value.loadingStream = false;
          return res;
        });
      } else {
        searchObj.value.data.errorMsg = "No stream found in selected organization!";
      }
    } catch (e: any) {
      searchObj.value.loadingStream = false;
      console.log("Error while loading stream fields");
    }
  }

  /**
   * Gets the complete list of streams for the current stream type
   * 
   * @param selectStream Whether to automatically select a stream after loading
   * @returns Promise resolving to success status
   */
  const getStreamList = async (selectStream: boolean = true): Promise<boolean> => {
    try {
      const streamType = searchObj.value.data.stream.streamType || "logs";
      const streamData: any = await getStreams(streamType, false);
      
      searchObj.value.data.streamResults = {
        ...streamData,
      };
      
      await loadStreamLists(selectStream);
      return true;
    } catch (e: any) {
      console.error("Error while getting stream list", e);
      return false;
    }
  };

  /**
   * Updates streams data by refetching from the API
   */
  const updateStreams = async (): Promise<void> => {
    if (searchObj.value.data.streamResults?.list?.length) {
      const streamType = searchObj.value.data.stream.streamType || "logs";
      const streams: any = await getStreams(streamType, false);
      searchObj.value.data.streamResults["list"] = streams.list;

      // Update stream lists while preserving selection
      const currentSelection = [...searchObj.value.data.stream.selectedStream];
      await loadStreamLists(false);
      
      // Restore previous selection if streams still exist
      const availableStreams = searchObj.value.data.stream.streamLists.map(s => s.value);
      const validSelection = currentSelection.filter(stream => 
        availableStreams.includes(stream)
      );
      
      if (validSelection.length > 0) {
        searchObj.value.data.stream.selectedStream = validSelection;
      }
    }
  };

  // ========================================
  // FIELD EXTRACTION AND MANAGEMENT
  // ========================================

  /**
   * Checks if a stream has interesting fields stored locally
   * 
   * @param streamName Name of the stream to check
   * @returns True if local interesting fields exist
   */
  const hasInterestingFieldsInLocal = (streamName: string): boolean => {
    const localInterestingFields: any = useLocalInterestingFields();
    return localInterestingFields.value != null &&
      localInterestingFields.value[
        searchObj.value.organizationIdentifier + "_" + streamName
      ] !== undefined &&
      localInterestingFields.value[
        searchObj.value.organizationIdentifier + "_" + streamName
      ].length > 0;
  };

  /**
   * Updates local storage with interesting fields for streams
   */
  const updateInterestingFieldsInLocal = (): void => {
    const localInterestingFields: any = useLocalInterestingFields();
    
    for (const streamName of searchObj.value.data.stream.selectedStream) {
      const key = searchObj.value.organizationIdentifier + "_" + streamName;
      if (localInterestingFields.value && localInterestingFields.value[key]) {
        // Update local interesting fields with current selection
        localInterestingFields.value[key] = [...searchObj.value.data.stream.interestingFieldList];
      }
    }
  };

  /**
   * Loads schema data for a specific stream
   * 
   * @param streamName Name of the stream
   * @param streamType Type of stream (logs, metrics, etc.)
   * @returns Promise resolving to stream schema data
   */
  const loadStreamSchema = async (streamName: string, streamType: string = "logs"): Promise<any> => {
    try {
      // Use the stream service to get stream schema data
      const streamData = await streamService.getSchemaFields(
        {
          org_identifier: store.state.selectedOrganization.identifier,
          stream_name: streamName,
          stream_type: streamType,
        }
      );

      return streamData.data;
    } catch (error) {
      console.error(`Error loading schema for stream ${streamName}:`, error);
      return { schema: [] };
    }
  };

  /**
   * Extracts and processes fields from selected streams
   * Handles field mapping, interesting fields, and schema processing
   */
  async function extractFields(): Promise<void> {
    try {
      searchObj.value.data.errorMsg = "";
      searchObj.value.data.errorDetail = "";
      searchObj.value.data.countErrorMsg = "";
      searchObj.value.data.stream.selectedStreamFields = [];
      searchObj.value.data.stream.interestingFieldList = [];

      const localInterestingFields: any = useLocalInterestingFields();

      // Process each selected stream
      for (const stream of searchObj.value.data.streamResults.list.filter(
        (item: any) => searchObj.value.data.stream.selectedStream.includes(item.name)
      )) {
        let schemaInterestingFields: any[] = [];
        let streamInterestingFields: any[] = [];
        let streamInterestingFieldsLocal: any[] = [];

        // Determine if multi-stream mode should use user-defined schemas
        const useUserDefinedSchemas = 
          searchObj.value.meta.useUserDefinedSchemas === "user_defined_schema" &&
          searchObj.value.meta.hasUserDefinedSchemas &&
          searchObj.value.data.stream.selectedStream.length > 1;

        // Handle timestamp field for interesting fields
        if (hasInterestingFieldsInLocal(stream.name)) {
          const hasTimestampField = localInterestingFields.value[
            searchObj.value.organizationIdentifier + "_" + stream.name
          ].some((field: any) => field === store.state.zoConfig?.timestamp_column);

          // Remove timestamp field from local interesting fields as it's default
          if (hasTimestampField) {
            localInterestingFields.value[
              searchObj.value.organizationIdentifier + "_" + stream.name
            ] = localInterestingFields.value[
              searchObj.value.organizationIdentifier + "_" + stream.name
            ].filter((field: any) => field !== store.state.zoConfig?.timestamp_column);
          }
        }

        // Get environment interesting fields
        const environmentInterestingFields = new Set(
          searchObj.value.data.stream.selectedInterestingStreamFields.filter(
            (field: any) => field.streams.includes(stream.name)
          ).map((field: any) => field.name)
        );

        // Get deselected fields from expanded group rows
        const expandedGroupRowsFieldCount = 
          searchObj.value.data.stream.interestingExpandedGroupRowsFieldCount[stream.name] || {};
        const filteredDeselectedFields = new Set(
          Object.entries(expandedGroupRowsFieldCount)
            .filter(([, count]) => (count as number) === 0)
            .map(([field]) => field)
        );

        // Get local interesting fields
        const localFields = localInterestingFields.value?.[
          searchObj.value.organizationIdentifier + "_" + stream.name
        ] || [];

        const filteredEnvironmentInterestingFields = Array.from(environmentInterestingFields)
          .filter((field: any) => !filteredDeselectedFields.has(field));

        streamInterestingFieldsLocal = hasInterestingFieldsInLocal(stream.name)
          ? [...localFields, ...filteredEnvironmentInterestingFields]
          : [...filteredEnvironmentInterestingFields];

        // Process stream schema
        let streamFieldsProcessed = 0;
        
        for (let schemaFieldsIndex = 0; schemaFieldsIndex < stream.schema.length; schemaFieldsIndex++) {
          const field = stream.schema[schemaFieldsIndex];
          let fieldObj: any = {};

          // Determine if field should be included in interesting fields
          const shouldIncludeField = 
            streamInterestingFieldsLocal.includes(field.name) ||
            field.name === store.state.zoConfig.timestamp_column;

          if (shouldIncludeField && !searchObj.value.data.stream.interestingFieldList.includes(field.name)) {
            searchObj.value.data.stream.interestingFieldList.push(field.name);
          }

          // Create field object
          fieldObj = {
            name: field.name,
            type: field.type,
            streams: [stream.name],
            ftsKey: field.ftsKey || false,
            isInterestingField: shouldIncludeField,
          };

          // Check if field already exists in selected fields
          const existingFieldIndex = searchObj.value.data.stream.selectedStreamFields
            .findIndex((existingField: any) => existingField.name === field.name);

          if (existingFieldIndex >= 0) {
            // Field exists, add stream to its streams array
            if (!searchObj.value.data.stream.selectedStreamFields[existingFieldIndex].streams.includes(stream.name)) {
              searchObj.value.data.stream.selectedStreamFields[existingFieldIndex].streams.push(stream.name);
            }
          } else {
            // New field, add to selected stream fields
            searchObj.value.data.stream.selectedStreamFields.push(fieldObj);
          }

          streamFieldsProcessed++;
        }

        console.log(`Processed ${streamFieldsProcessed} fields for stream ${stream.name}`);
      }

      // Create field index mapping for quick lookup
      createFieldIndexMapping();

      // Update SQL suggestions with new field keywords
      if (searchObj.value.data.stream.selectedStreamFields.length > 0) {
        updateFieldKeywords(searchObj.value.data.stream.selectedStreamFields);
      }

    } catch (e: any) {
      searchObj.value.loadingStream = false;
      console.log("Error while extracting fields.", e);
    }
  }

  /**
   * Creates an index mapping for stream fields for quick lookup
   */
  const createFieldIndexMapping = (): void => {
    streamSchemaFieldsIndexMapping.value = {};
    
    searchObj.value.data.stream.selectedStreamFields.forEach((field: any, index: number) => {
      streamSchemaFieldsIndexMapping.value[field.name] = index;
    });
  };

  /**
   * Extracts Full Text Search (FTS) fields from selected stream fields
   */
  const extractFTSFields = (): void => {
    if (
      searchObj.value.data.stream.selectedStreamFields !== undefined &&
      searchObj.value.data.stream.selectedStreamFields.length > 0
    ) {
      ftsFields.value = searchObj.value.data.stream.selectedStreamFields
        .filter((item: any) => item.ftsKey === true)
        .map((item: any) => item.name);
    }

    // If no FTS fields are set by user, use default FTS fields
    if (ftsFields.value.length === 0) {
      ftsFields.value = ["log", "message", "content", "data", "events"];
    }
  };

  /**
   * Gets fields mapped with their associated stream names
   * 
   * @returns Object mapping field names to arrays of stream names
   */
  function getFieldsWithStreamNames(): { [key: string]: string[] } {
    const fieldMap: { [key: string]: string[] } = {};

    searchObj.value.data.streamResults.list
      .filter((stream: any) =>
        searchObj.value.data.stream.selectedStream.includes(stream.name)
      )
      .forEach((stream: any) => {
        stream.schema.forEach((field: any) => {
          const fieldKey = field.name;
          const fieldValue = stream.name;

          if (!fieldMap[fieldKey]) {
            fieldMap[fieldKey] = [];
          }
          fieldMap[fieldKey].push(fieldValue);
        });
      });

    return fieldMap;
  }

  /**
   * Reorders selected fields based on column order preferences
   * 
   * @returns Reordered array of selected fields
   */
  const reorderSelectedFields = (): string[] => {
    const selectedFields = [...searchObj.value.data.stream.selectedFields];

    let colOrder = 
      searchObj.value.data.resultGrid.colOrder[searchObj.value.data.stream.selectedStream.join(",")];

    // Remove timestamp column from order if not in selected fields
    if (!selectedFields.includes(store.state.zoConfig.timestamp_column)) {
      colOrder = colOrder.filter(
        (v: any) => v !== store.state.zoConfig.timestamp_column
      );
    }

    // Reorder if different from current order
    if (JSON.stringify(selectedFields) !== JSON.stringify(colOrder)) {
      // Implementation of reorderArrayByReference would go here
      // This is a utility function that reorders the first array based on the second
      reorderArrayByReference(selectedFields, colOrder);
    }

    return selectedFields;
  };

  /**
   * Utility function to reorder an array based on a reference array
   */
  const reorderArrayByReference = (targetArray: any[], referenceArray: any[]): void => {
    const ordered: any[] = [];
    const remaining: any[] = [...targetArray];

    // Add items in reference order
    referenceArray.forEach(item => {
      const index = remaining.indexOf(item);
      if (index !== -1) {
        ordered.push(remaining.splice(index, 1)[0]);
      }
    });

    // Add any remaining items
    ordered.push(...remaining);

    // Clear and repopulate target array
    targetArray.length = 0;
    targetArray.push(...ordered);
  };

  // ========================================
  // STREAM CHANGE HANDLING
  // ========================================

  /**
   * Handles stream selection changes
   * Processes query updates and field extraction
   * 
   * @param queryStr Optional query string to process
   */
  const onStreamChange = async (queryStr?: string): Promise<void> => {
    try {
      searchObj.value.loadingStream = true;

      // Reset query results and histogram
      searchObj.value.data.queryResults = { hits: [] };
      searchObj.value.data.sortedQueryResults = [];
      searchObj.value.data.histogram = {
        xData: [],
        yData: [],
        chartParams: {
          title: "",
          unparsed_x_data: [],
          timezone: "",
        },
        errorCode: 0,
        errorMsg: "",
        errorDetail: "",
      };

      // Get selected streams
      const streams = searchObj.value.data.stream.selectedStream;
      if (streams.length === 0) {
        return;
      }

      // Fetch all stream schema data in parallel (this is the missing piece!)
      const streamDataPromises = streams.map((stream: string) =>
        loadStreamSchema(stream, searchObj.value.data.stream.streamType || "logs")
      );

      const streamDataResults = await Promise.all(streamDataPromises);

      // Collect all schema fields and update selectedStreamFields
      const allStreamFields = streamDataResults
        .filter((data) => data?.schema)
        .flatMap((data) => data.schema);

      // Update selectedStreamFields directly (this was missing in our composable)
      searchObj.value.data.stream.selectedStreamFields = allStreamFields;

      // If no fields found, return early
      if (allStreamFields.length === 0) {
        return;
      }

      // Update selected fields if needed
      const streamFieldNames = new Set(allStreamFields.map((item: any) => item.name));
      if (searchObj.value.data.stream.selectedFields.length > 0) {
        searchObj.value.data.stream.selectedFields =
          searchObj.value.data.stream.selectedFields.filter((fieldName: string) =>
            streamFieldNames.has(fieldName)
          );
      }

      // Now extract fields for interesting fields processing
      await extractFields();
      
    } catch (e: any) {
      console.error("Error while handling stream change:", e);
    } finally {
      searchObj.value.loadingStream = false;
    }
  };

  /**
   * Sets selected streams from a SQL query string
   * Parses the query to extract stream names from FROM clauses
   * 
   * @param value SQL query string
   */
  const setSelectedStreams = (value: string): void => {
    try {
      // This would need the SQL parser from the query processing composable
      // For now, we'll implement a basic version
      
      const streamMatches = value.match(/FROM\s+"?([^"\s]+)"?/gi);
      if (streamMatches && streamMatches.length > 0) {
        const newSelectedStreams = streamMatches.map(match => 
          match.replace(/FROM\s+"?([^"\s]+)"?/i, '$1')
        );

        // Check if streams exist and update if different
        const currentStreams = searchObj.value.data.stream.selectedStream;
        const streamsChanged = !arraysMatch(currentStreams, newSelectedStreams);

        if (streamsChanged && 
            isStreamFetched(searchObj.value.data.stream.streamType) &&
            newSelectedStreams.every(stream => 
              isStreamExists(stream, searchObj.value.data.stream.streamType)
            )) {
          searchObj.value.data.stream.selectedStream = newSelectedStreams;
          onStreamChange(value);
        }
      }
    } catch (error) {
      console.error("Error in setSelectedStreams:", {
        error,
        query: value,
        currentStreams: searchObj.value.data.stream.selectedStream,
      });
      throw error;
    }
  };

  /**
   * Utility function to check if two arrays are equal
   */
  const arraysMatch = (arr1: any[], arr2: any[]): boolean => {
    if (arr1.length !== arr2.length) return false;
    return arr1.every((item, index) => item === arr2[index]);
  };

  // ========================================
  // FIELD VALUES MANAGEMENT
  // ========================================

  /**
   * Updates field values for autocomplete and suggestions
   */
  const updateFieldValues = (): void => {
    // Implementation would extract unique field values from query results
    // for autocomplete functionality
    fieldValues.value = {};
    
    if (searchObj.value.data.queryResults.hits) {
      searchObj.value.data.queryResults.hits.forEach((hit: any) => {
        Object.keys(hit).forEach(key => {
          if (!fieldValues.value[key]) {
            fieldValues.value[key] = new Set();
          }
          if (hit[key] !== null && hit[key] !== undefined) {
            fieldValues.value[key].add(String(hit[key]));
          }
        });
      });

      // Convert sets to arrays for easier usage
      Object.keys(fieldValues.value).forEach(key => {
        fieldValues.value[key] = Array.from(fieldValues.value[key]).slice(0, 100); // Limit for performance
      });
    }
  };

  /**
   * Resets field values
   */
  const resetFieldValues = (): void => {
    fieldValues.value = {};
  };

  // ========================================
  // RETURN INTERFACE
  // ========================================

  return {
    // Computed State
    streamLists,
    selectedStreams,
    streamFields,
    interestingFields,
    streamType,
    
    // Functions
    loadStreamLists,
    loadStreamFields,
    getStreamList,
    updateStreams,
    onStreamChange,
    setSelectedStreams,
    extractFields,
    extractFTSFields,
    reorderSelectedFields,
    hasInterestingFieldsInLocal,
    updateInterestingFieldsInLocal,
    getFieldsWithStreamNames,

    // Field Values
    updateFieldValues,
    resetFieldValues,

    // Direct access to reactive refs for integration
    ftsFields: readonly(ftsFields),
    fieldValues: readonly(fieldValues),
  };
}
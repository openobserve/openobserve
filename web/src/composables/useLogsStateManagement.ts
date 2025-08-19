/**
 * useLogsStateManagement.ts
 * 
 * Manages core application state, initialization, and cleanup for the logs module.
 * This is the foundational composable that provides the base state management
 * functionality used by all other logs composables.
 */

import { reactive, ref, nextTick, type Ref } from 'vue';
import { useStore } from 'vuex';
import { useRouter } from 'vue-router';
import {
  useLocalWrapContent,
  useLocalLogFilterField,
} from '@/utils/zincutils';
import useFunctions from '@/composables/useFunctions';
import useActions from '@/composables/useActions';
import useNotifications from '@/composables/useNotifications';
import type { 
  UseLogsStateManagement,
  SearchObject,
  ComposableConfig 
} from './INTERFACES_AND_TYPES';

/**
 * Default state object structure
 */
const createDefaultObject = () => ({
  organizationIdentifier: "",
  runQuery: false,
  loading: false,
  loadingHistogram: false,
  loadingCounter: false,
  loadingStream: false,
  loadingSavedView: false,
  shouldIgnoreWatcher: false,
  communicationMethod: "http",
  config: {
    splitterModel: 20,
    lastSplitterPosition: 0,
    splitterLimit: [0, 40],
    fnSplitterModel: 60,
    fnLastSplitterPosition: 0,
    fnSplitterLimit: [40, 100],
    refreshTimes: [
      [
        { label: "5 sec", value: 5 },
        { label: "1 min", value: 60 },
        { label: "1 hr", value: 3600 },
      ],
      [
        { label: "10 sec", value: 10 },
        { label: "5 min", value: 300 },
        { label: "2 hr", value: 7200 },
      ],
      [
        { label: "15 sec", value: 15 },
        { label: "15 min", value: 900 },
        { label: "1 day", value: 86400 },
      ],
      [
        { label: "30 sec", value: 30 },
        { label: "30 min", value: 1800 },
      ],
    ],
  },
  meta: {
    logsVisualizeToggle: "logs",
    refreshInterval: 0,
    refreshIntervalLabel: "Off",
    refreshHistogram: false,
    showFields: true,
    showQuery: true,
    showHistogram: true,
    showDetailTab: false,
    showTransformEditor: true,
    searchApplied: false,
    toggleSourceWrap: useLocalWrapContent()
      ? JSON.parse(useLocalWrapContent())
      : false,
    histogramDirtyFlag: false,
    logsVisualizeDirtyFlag: false,
    sqlMode: false,
    sqlModeManualTrigger: false,
    quickMode: false,
    queryEditorPlaceholderFlag: true,
    functionEditorPlaceholderFlag: true,
    resultGrid: {
      rowsPerPage: 50,
      wrapCells: false,
      manualRemoveFields: false,
      chartInterval: "1 second",
      chartKeyFormat: "HH:mm:ss",
      navigation: {
        currentRowIndex: 0,
      },
      showPagination: true,
    },
    jobId: "",
    jobRecords: "100",
    scrollInfo: {},
    pageType: "logs", // 'logs' or 'stream
    regions: [],
    clusters: [],
    useUserDefinedSchemas: "user_defined_schema",
    hasUserDefinedSchemas: false,
    selectedTraceStream: "",
    showSearchScheduler: false,
    toggleFunction: false, // DEPRECATED use showTransformEditor instead
    isActionsEnabled: false,
    resetPlotChart: false,
  },
  data: {
    query: "",
    histogramQuery: "",
    parsedQuery: {},
    countErrorMsg: "",
    errorMsg: "",
    errorDetail: "",
    errorCode: 0,
    filterErrMsg: "",
    missingStreamMessage: "",
    additionalErrorMsg: "",
    savedViewFilterFields: "",
    hasSearchDataTimestampField: false,
    originalDataCache: {},
    stream: {
      loading: false,
      streamLists: [],
      selectedStream: [],
      selectedStreamFields: [],
      selectedFields: [],
      filterField: "",
      addToFilter: "",
      functions: [],
      streamType: "logs",
      interestingFieldList: [],
      userDefinedSchema: [],
      expandGroupRows: {},
      expandGroupRowsFieldCount: {},
      filteredField: [],
      missingStreamMultiStreamFilter: [],
      pipelineQueryStream: [],
      selectedInterestingStreamFields: [],
      interestingExpandedGroupRows: {},
      interestingExpandedGroupRowsFieldCount: {},
    },
    resultGrid: {
      currentDateTime: new Date(),
      currentPage: 1,
      columns: [],
      colOrder: {},
      colSizes: {},
    },
    histogramInterval: 0,
    transforms: [],
    transformType: "function",
    actions: [],
    selectedTransform: null,
    queryResults: [],
    sortedQueryResults: [],
    streamResults: [],
    histogram: {
      xData: [],
      yData: [],
      chartParams: {
        title: "",
        unparsed_x_data: [],
        timezone: "",
      },
      errorMsg: "",
      errorCode: 0,
      errorDetail: "",
    },
    editorValue: "",
    datetime: {
      startTime: (new Date().getTime() - 900000) * 1000,
      endTime: new Date().getTime(),
      relativeTimePeriod: "15m",
      type: "relative",
      selectedDate: {},
      selectedTime: {},
      queryRangeRestrictionMsg: "",
      queryRangeRestrictionInHour: 100000,
    },
    searchAround: {
      indexTimestamp: 0,
      size: 10,
      histogramHide: false,
    },
    tempFunctionName: "",
    tempFunctionContent: "",
    tempFunctionLoading: false,
    savedViews: [],
    customDownloadQueryObj: {},
    functionError: "",
    searchRequestTraceIds: [],
    searchWebSocketTraceIds: [],
    isOperationCancelled: false,
    searchRetriesCount: {},
    actionId: null,
  },
});

/**
 * Debug object for performance monitoring
 */
const createDebugObject = () => ({
  queryDataStartTime: 0,
  queryDataEndTime: 0,
  buildSearchStartTime: 0,
  buildSearchEndTime: 0,
  partitionStartTime: 0,
  partitionEndTime: 0,
  paginatedDatawithAPIStartTime: 0,
  paginatedDatawithAPIEndTime: 0,
  pagecountStartTime: 0,
  pagecountEndTime: 0,
  paginatedDataReceivedStartTime: 0,
  paginatedDataReceivedEndTime: 0,
  histogramStartTime: 0,
  histogramEndTime: 0,
});

/**
 * Aggregation data object
 */
const createAggDataObject = () => ({
  total: 0,
  hasAggregation: false,
  aggregationObj: null,
});

/**
 * State Management Composable
 * 
 * Provides centralized state management for the logs module including:
 * - Core search state (searchObj)
 * - Debug/performance tracking
 * - Initialization and cleanup
 * - State reset operations
 */
export default function useLogsStateManagement(config?: ComposableConfig): UseLogsStateManagement {
  const store = useStore();
  const router = useRouter();
  const { getAllFunctions } = useFunctions();
  const { getAllActions } = useActions();
  const { showErrorNotification } = useNotifications();

  // ========================================
  // REACTIVE STATE
  // ========================================

  // Core search state - this is the main state object used across all composables
  const searchObj: Ref<SearchObject> = reactive(Object.assign({}, createDefaultObject()));
  
  // Debug state for performance monitoring
  const searchObjDebug = reactive(createDebugObject());
  
  // Aggregation data state
  const searchAggData = reactive(createAggDataObject());
  
  // Initial query payload for relative time handling
  const initialQueryPayload: Ref<any> = ref(null);
  
  // Initialization flag
  const isInitialized = ref(false);
  
  // Refresh interval state
  const refreshInterval = ref(0);

  // ========================================
  // CORE STATE MANAGEMENT FUNCTIONS
  // ========================================

  /**
   * Clears the entire search object and resets all loading states
   * Used when navigating away from logs or starting fresh
   */
  const clearSearchObj = (): void => {
    // Reset the existing searchObj instead of creating a new one
    // This maintains the same reference so watchers continue to work
    resetSearchObj();
    searchObj.meta.refreshInterval = 0;
    clearInterval(store.state.refreshIntervalID);
    searchObj.loading = false;
    searchObj.loadingHistogram = false;
    searchObj.loadingCounter = false;
    searchObj.loadingStream = false;
    searchObj.loadingSavedView = false;
    searchObj.runQuery = false;

    searchObj.meta.histogramDirtyFlag = false;
    searchObj.meta.logsVisualizeDirtyFlag = false;

    searchObj.meta.jobId = "";
    searchObj.meta.hasUserDefinedSchemas = false;
    searchObj.meta.selectedTraceStream = "";
    searchObj.meta.showSearchScheduler = false;
    searchObj.meta.resetPlotChart = false;
  };

  /**
   * Resets the search object to default values while maintaining reactivity
   * Used when clearing search results but keeping the component active
   */
  const resetSearchObj = (): void => {
    // Don't replace the entire object to maintain reactivity
    searchObj.data.errorMsg = "";
    searchObj.data.stream.streamLists = [];
    searchObj.data.stream.selectedStream = [];
    searchObj.data.stream.selectedStreamFields = [];
    searchObj.data.queryResults = {};
    searchObj.data.sortedQueryResults = [];
    searchObj.data.histogram = {
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
    searchObj.data.tempFunctionContent = "";
    searchObj.data.query = "";
    searchObj.data.editorValue = "";
    searchObj.meta.sqlMode = false;
    searchObj.runQuery = false;
    searchObj.data.savedViews = [];
  };

  /**
   * Initializes the logs state from the store cache
   * This function restores a previously cached state when returning to logs
   * 
   * @returns Promise that resolves when initialization is complete
   */
  const initialLogsState = async (): Promise<void> => {
    // Don't do any other effects than initializing the logs state in this function
    if (store.state.logs?.isInitialized) {
      try {
        const state = store.getters["logs/getLogs"];
        searchObj.organizationIdentifier = state.organizationIdentifier;
        searchObj.config = JSON.parse(JSON.stringify(state.config));
        searchObj.communicationMethod = state.communicationMethod;
        
        await nextTick();
        
        searchObj.meta = JSON.parse(JSON.stringify({
          ...state.meta,
          refreshInterval: 0, // Always reset refresh interval on load
        }));
        
        searchObj.data = JSON.parse(JSON.stringify({
          ...JSON.parse(JSON.stringify(state.data)),
          queryResults: {},
          sortedQueryResults: [],
          histogram: {
            xData: [],
            yData: [],
            chartParams: {
              title: "",
              unparsed_x_data: [],
              timezone: "",
            },
            errorMsg: "",
            errorCode: 0,
            errorDetail: "",
          },
        }));
        
        await nextTick();
        
        // Note: getStreamList will be called from stream management composable
        // This is just restoring the cached query results and histogram
        searchObj.data.queryResults = JSON.parse(JSON.stringify(state.data.queryResults));
        searchObj.data.sortedQueryResults = JSON.parse(JSON.stringify(state.data.sortedQueryResults));
        searchObj.data.histogram = JSON.parse(JSON.stringify(state.data.histogram));
        
        // Note: updateGridColumns will be called from grid management composable
        await nextTick();
        
        isInitialized.value = true;
        
      } catch (e: any) {
        console.error("Error while initializing logs state", e?.message);
        searchObj.organizationIdentifier = store.state?.selectedOrganization?.identifier;
        resetSearchObj();
      }
    }
  };

  // ========================================
  // RESET FUNCTIONS
  // ========================================

  /**
   * Resets functions data in the store and search object
   */
  const resetFunctions = (): void => {
    store.dispatch("setFunctions", []);
    searchObj.data.transforms = [];
    searchObj.data.stream.functions = [];
  };

  /**
   * Resets stream-related data
   */
  const resetStreamData = (): void => {
    store.dispatch("resetStreams", {});
    searchObj.data.stream.selectedStream = [];
    searchObj.data.stream.selectedStreamFields = [];
    searchObj.data.stream.selectedFields = [];
    searchObj.data.stream.filterField = "";
    searchObj.data.stream.addToFilter = "";
    searchObj.data.stream.functions = [];
    searchObj.data.stream.streamType = 
      (router.currentRoute.value.query.stream_type as string) || "logs";
    searchObj.data.stream.streamLists = [];
    resetQueryData();
    resetSearchAroundData();
  };

  /**
   * Resets query-related data while preserving other state
   */
  const resetQueryData = (): void => {
    searchObj.data.sortedQueryResults = [];
    searchObj.data.resultGrid.currentPage = 1;
    searchObj.runQuery = false;
    searchObj.data.errorMsg = "";
    searchObj.data.errorDetail = "";
    searchObj.data.countErrorMsg = "";
  };

  /**
   * Resets search around functionality data
   */
  const resetSearchAroundData = (): void => {
    searchObj.data.searchAround.indexTimestamp = -1;
    searchObj.data.searchAround.size = 0;
  };

  // ========================================
  // UTILITY FUNCTIONS
  // ========================================

  /**
   * Updates local storage with current log filter field selection
   * Used to persist user's field selection preferences
   */
  const updatedLocalLogFilterField = (): void => {
    const identifier: string = searchObj.organizationIdentifier || "default";
    const selectedFields: any = useLocalLogFilterField()?.value != null
      ? useLocalLogFilterField()?.value
      : {};
    const stream = searchObj.data.stream.selectedStream.sort().join("_");
    selectedFields[`${identifier}_${stream}`] = searchObj.data.stream.selectedFields;
    useLocalLogFilterField(selectedFields);
  };

  /**
   * Enables refresh interval for auto-refresh functionality
   * 
   * @param interval Refresh interval in seconds
   */
  const enableRefreshInterval = (interval: number): void => {
    refreshInterval.value = interval;
    searchObj.meta.refreshInterval = interval;
    
    // Clear any existing interval
    clearInterval(store.state.refreshIntervalID);
    
    if (interval > 0) {
      const refreshIntervalID = setInterval(() => {
        // This will be handled by the main orchestrator
        // Emit event or call callback for refresh
      }, interval * 1000);
      
      store.dispatch("setRefreshIntervalID", refreshIntervalID);
    }
  };

  // ========================================
  // ASYNC INITIALIZATION FUNCTIONS
  // ========================================

  /**
   * Fetches and initializes available functions from the API
   * These functions can be used in query transformations
   */
  const getFunctions = async (): Promise<void> => {
    try {
      if (store.state.organizationData.functions.length === 0) {
        await getAllFunctions();
      }

      store.state.organizationData.functions.map((data: any) => {
        const args: any = [];
        for (let i = 0; i < parseInt(data.num_args); i++) {
          args.push("'${1:value}'");
        }

        const itemObj: {
          name: any;
          args: string;
        } = {
          name: data.name,
          args: "(" + args.join(",") + ")",
        };
        
        searchObj.data.transforms.push({
          name: data.name,
          function: data.function,
        });
        
        if (!data.stream_name) {
          searchObj.data.stream.functions.push(itemObj);
        }
      });
    } catch (e) {
      showErrorNotification("Error while fetching functions");
    }
  };

  /**
   * Fetches and initializes available actions from the API
   * These actions can be used for data processing workflows
   */
  const getActions = async (): Promise<void> => {
    try {
      searchObj.data.actions = [];

      if (store.state.organizationData.actions.length === 0) {
        await getAllActions();
      }
      
      store.state.organizationData.actions.forEach((data: any) => {
        if (data.execution_details_type === "service") {
          searchObj.data.actions.push({
            name: data.name,
            id: data.id,
          });
        }
      });
    } catch (e) {
      showErrorNotification("Error while fetching actions");
    }
  };

  // ========================================
  // RETURN INTERFACE
  // ========================================

  return {
    // Core state
    searchObj,
    searchObjDebug,
    searchAggData,
    initialQueryPayload,
    
    // State flags
    isInitialized,
    refreshInterval,
    
    // Functions
    clearSearchObj,
    resetSearchObj,
    initialLogsState,
    resetFunctions,
    resetStreamData,
    resetQueryData,
    resetSearchAroundData,
    updatedLocalLogFilterField,
    enableRefreshInterval,
    getFunctions,
    getActions,
  };
}
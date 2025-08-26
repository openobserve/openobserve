// Copyright 2023 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { reactive, ref, computed, nextTick, type Ref } from "vue";
import { useStore } from "vuex";
import config from "@/aws-exports";
import type { SearchRequestPayload } from "@/ts/interfaces";
import {
  DEFAULT_LOGS_CONFIG,
  DEFAULT_SEARCH_DEBUG_DATA,
  DEFAULT_SEARCH_AGG_DATA,
} from "@/utils/logs/constants";

/**
 * Reactive state management for logs functionality
 * Contains all reactive state variables used across logs components
 */
export const useLogsState = () => {
  const store = useStore();

  // Main search object containing all search state
  const searchObj: any = reactive(Object.assign({}, DEFAULT_LOGS_CONFIG));

  // Debug data for search operations
  const searchObjDebug = reactive(Object.assign({}, DEFAULT_SEARCH_DEBUG_DATA));

  // Aggregation data for search results
  const searchAggData = reactive(Object.assign({}, DEFAULT_SEARCH_AGG_DATA));

  // Initial query payload reference
  const initialQueryPayload: Ref<SearchRequestPayload | null> = ref(null);

  // Field schema index mapping
  const streamSchemaFieldsIndexMapping = ref<{ [key: string]: number }>({});

  // Field values reference
  const fieldValues = ref();

  // Notification message reference
  const notificationMsg = ref("");

  // FTS (Full Text Search) fields
  const ftsFields: any = ref([]);

  // Computed property to check if actions are enabled
  const isActionsEnabled = computed(() => {
    return (config.isEnterprise == "true" || config.isCloud == "true") && 
           store.state.zoConfig.actions_enabled;
  });

  // Reset search object to initial state
  const resetSearchObj = () => {
    const defaultObject = JSON.parse(JSON.stringify(DEFAULT_LOGS_CONFIG));
    
    // Recursive function to deeply reset properties
    const deepReset = (target: any, source: any) => {
      Object.keys(target).forEach(key => {
        if (source[key] === undefined) {
          delete target[key];
        } else if (typeof target[key] === 'object' && target[key] !== null && typeof source[key] === 'object' && source[key] !== null) {
          deepReset(target[key], source[key]);
        } else {
          target[key] = source[key];
        }
      });
      
      // Add any new properties from source that don't exist in target
      Object.keys(source).forEach(key => {
        if (target[key] === undefined) {
          target[key] = source[key];
        }
      });
    };
    
    deepReset(searchObj, defaultObject);
  };

  // Reset stream data
  const resetStreamData = () => {
    searchObj.data.stream.streamLists = [];
    searchObj.data.stream.selectedStream = [];
    searchObj.data.stream.streamType = "";
  };

  const clearSearchObj = () => {
    Object.assign(searchObj, JSON.parse(JSON.stringify(DEFAULT_LOGS_CONFIG)));
  };

  const initialLogsState = async () => {
    const store = useStore();
    if (store.state.logs?.isInitialized) {
      try {
        const state = store.getters["logs/getLogs"];
        searchObj.organizationIdentifier = state.organizationIdentifier;
        searchObj.config = JSON.parse(JSON.stringify(state.config));
        searchObj.communicationMethod = state.communicationMethod;
        
        await nextTick();
        
        searchObj.meta = JSON.parse(JSON.stringify({
          ...state.meta,
          refreshInterval: 0,
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
            },
          },
        }));
        
        return true;
      } catch (error: any) {
        console.error("Error initializing logs state:", error);
        return false;
      }
    }
    return false;
  };

  const setSelectedStreams = (streams: string[] | string) => {
    if (typeof streams === 'string') {
      // Handle single stream string
      searchObj.data.stream.selectedStream = [{ name: streams, value: streams }];
    } else if (Array.isArray(streams)) {
      // Handle array of streams
      searchObj.data.stream.selectedStream = streams.map(stream => ({
        name: typeof stream === 'string' ? stream : stream.name || stream.value,
        value: typeof stream === 'string' ? stream : stream.value || stream.name
      }));
    }
  };

  return {
    // Reactive state
    searchObj,
    searchObjDebug,
    searchAggData,
    initialQueryPayload,
    streamSchemaFieldsIndexMapping,
    fieldValues,
    notificationMsg,
    ftsFields,
    
    // Computed properties
    isActionsEnabled,
    
    // State management functions
    resetSearchObj,
    resetStreamData,
    clearSearchObj,
    initialLogsState,
    setSelectedStreams,
  };
};

export default useLogsState;
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

import { reactive, ref, type Ref, nextTick } from "vue";
import { useStore } from "vuex";
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
export const searchState = () => {
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

  /**
   * This function is used to initialize the logs state from the store which was cached in the store
   * Dont do any other effects than initializing the logs state in this function, such as loading data, etc.
   * @returns Promise<boolean>,
   */
  const initialLogsState = async () => {
    // Dont do any other effects than initializing the logs state in this function, such as loading data, etc.
    if (store.state.logs.isInitialized) {
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
              unparsed_x_data: [],
              timezone: "",
            },
            errorMsg: "",
            errorCode: 0,
            errorDetail: "",
          },
        }));
        await nextTick();
        searchObj.data.queryResults = JSON.parse(JSON.stringify(state.data.queryResults));
        searchObj.data.sortedQueryResults = JSON.parse(JSON.stringify(state.data.sortedQueryResults));
        searchObj.data.histogram = JSON.parse(JSON.stringify(state.data.histogram));
        await nextTick();
        // Dont do any other effects than initializing the logs state in this function, such as loading data, etc.
      } catch (e: any) {
        console.error("Error while initializing logs state", e?.message);
        searchObj.organizationIdentifier = store.state?.selectedOrganization?.identifier;
        resetSearchObj();
      } finally {
        return Promise.resolve(true);
      }
    }
  }

  const resetSearchObj = () => {
  
      searchObj.data.errorMsg = "No stream found in selected organization!";
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
    resetSearchObj,
    initialLogsState,
  };
};

export default searchState;

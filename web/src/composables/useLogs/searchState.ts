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

import { reactive, ref, type Ref } from "vue";
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
  };
};

export default searchState;

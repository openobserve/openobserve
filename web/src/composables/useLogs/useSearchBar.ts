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

import { nextTick, ref } from "vue";
import { byString } from "@/utils/json";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";

import { searchState } from "@/composables/useLogs/searchState";
import useStreams from "@/composables/useStreams";
import useSqlSuggestions from "@/composables/useSuggestions";

import {
  useLocalLogFilterField,
  b64EncodeUnicode,
  b64DecodeUnicode,
  formatSizeFromMB,
  timestampToTimezoneDate,
  histogramDateTimezone,
  useLocalWrapContent,
  useLocalTimezone,
  useLocalInterestingFields,
  useLocalSavedView,
  convertToCamelCase,
  getFunctionErrorMessage,
  getUUID,
  getWebSocketUrl,
  generateTraceContext,
  arraysMatch,
  isWebSocketEnabled,
  isStreamingEnabled,
  addSpacesToOperators,
  deepCopy,
} from "@/utils/zincutils";

import { logsUtils } from "@/composables/useLogs/logsUtils";

import useActions from "@/composables/useActions";
import useFunctions from "@/composables/useFunctions";
import useNotifications from "@/composables/useNotifications";

let {
  searchObj,
  searchObjDebug,
  fieldValues,
  notificationMsg,
  streamSchemaFieldsIndexMapping,
  histogramMappedData,
  histogramResults,
} = searchState();

export const useSearchBar = () => {
  const { getStreams, getStream } = useStreams();
  const { updateFieldKeywords } = useSqlSuggestions();

  const store = useStore();
  const router = useRouter();
  const { t } = useI18n();

  const {
    fnParsedSQL,
    fnUnparsedSQL,
    extractTimestamps,
    hasAggregation,
    isLimitQuery,
    isDistinctQuery,
    isWithQuery,
    addTraceId,
    removeTraceId,
    addTransformToQuery,
    isActionsEnabled,
    getColumnWidth,
  } = logsUtils();

  const { getAllFunctions } = useFunctions();
  const { getAllActions } = useActions();
  const { showErrorNotification } = useNotifications();

  const getFunctions = async () => {
    try {
      if (store.state.organizationData.functions.length == 0) {
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
      return;
    } catch (e) {
      showErrorNotification("Error while fetching functions");
    }
  };

  const getActions = async () => {
    try {
      searchObj.data.actions = [];

      if (store.state.organizationData.actions.length == 0) {
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
      return;
    } catch (e) {
      showErrorNotification("Error while fetching actions");
    }
  };

  return {
    getFunctions,
    getActions,
  };
};

export default useSearchBar;

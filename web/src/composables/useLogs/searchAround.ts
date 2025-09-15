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

import { searchState } from "@/composables/useLogs/searchState";
import { logsUtils } from "@/composables/useLogs/logsUtils";
import { b64EncodeUnicode, generateTraceContext } from "@/utils/zincutils";
import { logsErrorMessage } from "@/utils/common";
import useLogs from "@/composables/useLogs";
import searchService from "@/services/search";
import useNotifications from "@/composables/useNotifications";
import useHistogram from "@/composables/useLogs/useHistogram";
import useStreamFields from "@/composables/useLogs/useStreamFields";
import {
  SearchAroundParams,
  StreamField,
  SearchAroundResponse,
  SearchAroundError,
  TraceContext,
} from "@/ts/interfaces";

export const useSearchAround = () => {
  const { searchObj, notificationMsg } = searchState();
  const { showErrorNotification } = useNotifications();

  const { extractFields, updateGridColumns, filterHitsColumns } = useStreamFields();
  const { generateHistogramData, generateHistogramSkeleton } = useHistogram();
  const {
    fnParsedSQL,
    fnUnparsedSQL,
    addTraceId,
    removeTraceId,
    shouldAddFunctionToSearch,
  } = logsUtils();

  /**
   * Performs a search around operation to fetch logs data around a specific timestamp or log entry.
   *
   * This function constructs and executes a search query based on the current search context,
   * handles both SQL and non-SQL modes, processes multiple streams, and updates the search results.
   * It includes comprehensive error handling, tracing, and result processing.
   *
   * @param params - The search around parameters
   * @param params.key - The key/identifier for the search around operation
   * @param params.size - Number of results to fetch
   * @param params.body - Additional body parameters for the search
   *
   * @example
   * ```typescript
   * searchAroundData({
   *   key: "timestamp_key",
   *   size: 50,
   *   body: { /* search body *\/ }
   * });
   * ```
   */
  const searchAroundData = (params: SearchAroundParams): void => {
    try {
      searchObj.loading = true;
      searchObj.data.errorCode = 0;
      searchObj.data.functionError = "";
      const sqlContext: string[] = [];
      let queryContext = "";
      const query: string = searchObj.data.query;

      if (searchObj.meta.sqlMode === true) {
        const parsedSQL = fnParsedSQL(query);
        parsedSQL.where = null;
        sqlContext.push(
          b64EncodeUnicode(fnUnparsedSQL(parsedSQL).replace(/`/g, '"')),
        );
      } else {
        const parseQuery = [query];
        let queryFunctions = "";
        if (parseQuery.length > 1) {
          queryFunctions = "," + parseQuery[0].trim();
        }
        queryContext = `SELECT [FIELD_LIST]${queryFunctions} FROM "[INDEX_NAME]" `;

        if (!searchObj.meta.quickMode) {
          queryContext = queryContext.replace("[FIELD_LIST]", "*");
        }

        const streamsData: string[] =
          searchObj.data.stream.selectedStream.filter(
            (streamName: string) =>
              !searchObj.data.stream.missingStreamMultiStreamFilter.includes(
                streamName,
              ),
          );

        let finalQuery = "";
        streamsData.forEach((streamName: string) => {
          finalQuery = queryContext.replace("[INDEX_NAME]", streamName);

          const listOfFields: string[] = [];
          let streamField: StreamField;
          for (const field of searchObj.data.stream.interestingFieldList) {
            for (streamField of searchObj.data.stream.selectedStreamFields) {
              if (
                streamField?.name === field &&
                streamField?.streams.indexOf(streamName) > -1
              ) {
                listOfFields.push(field);
              }
            }
          }

          let queryFieldList = "";
          if (listOfFields.length > 0) {
            queryFieldList = "," + listOfFields.join(",");
          }

          finalQuery = finalQuery.replace(
            "[FIELD_LIST]",
            `'${streamName}' as _stream_name` + queryFieldList,
          );
          sqlContext.push(b64EncodeUnicode(finalQuery));
        });
      }

      let queryFunction = "";
      if (shouldAddFunctionToSearch()) {
        queryFunction = b64EncodeUnicode(searchObj.data.tempFunctionContent);
      }

      let actionId = "";
      if (
        searchObj.data.transformType === "action" &&
        searchObj.data.selectedTransform?.id
      ) {
        actionId = searchObj.data.selectedTransform.id;
      }

      let streamName = "";
      if (searchObj.data.stream.selectedStream.length > 1) {
        streamName =
          b64EncodeUnicode(searchObj.data.stream.selectedStream.join(",")) ||
          "";
      } else {
        streamName = searchObj.data.stream.selectedStream[0];
      }

      const { traceparent, traceId }: TraceContext = generateTraceContext();
      addTraceId(traceId);

      searchService
        .search_around({
          org_identifier: searchObj.organizationIdentifier,
          index: streamName,
          key: params.key,
          size: String(params.size),
          body: params.body,
          query_context: sqlContext,
          query_fn: queryFunction,
          stream_type: searchObj.data.stream.streamType,
          regions: Object.prototype.hasOwnProperty.call(
            searchObj.meta,
            "regions",
          )
            ? searchObj.meta.regions.join(",")
            : "",
          clusters: Object.prototype.hasOwnProperty.call(
            searchObj.meta,
            "clusters",
          )
            ? searchObj.meta.clusters.join(",")
            : "",
          action_id: actionId,
          is_multistream: searchObj.data.stream.selectedStream.length > 1,
          traceparent,
        })
        .then((res: { data: SearchAroundResponse }) => {
          searchObj.loading = false;
          searchObj.data.histogram.chartParams.title = "";
          if (res.data.from > 0) {
            searchObj.data.queryResults.from = res.data.from;
            searchObj.data.queryResults.scan_size += res.data.scan_size;
            searchObj.data.queryResults.took += res.data.took;
            searchObj.data.queryResults.hits.push(...res.data.hits);
          } else {
            searchObj.data.queryResults = res.data;
          }
          //extract fields from query response
          extractFields();
          generateHistogramSkeleton();
          generateHistogramData();
          //update grid columns
          updateGridColumns();
          filterHitsColumns();

          if (searchObj.meta.showHistogram) {
            searchObj.meta.showHistogram = false;
            searchObj.data.searchAround.histogramHide = true;
          }

          searchObj.data.histogram.chartParams.title = "";
        })
        .catch((error: SearchAroundError) => {
          let traceId = "";
          searchObj.data.errorMsg = "Error while processing search request.";

          if (error.response !== undefined) {
            searchObj.data.errorMsg = error.response.data.error;
            searchObj.data.errorDetail = error.response.data.error_detail;
            if (
              Object.prototype.hasOwnProperty.call(
                error.response.data,
                "trace_id",
              )
            ) {
              traceId = error.response.data?.trace_id || "";
            }
          } else {
            searchObj.data.errorMsg = error.message;
            if (Object.prototype.hasOwnProperty.call(error, "trace_id")) {
              traceId = error?.trace_id || "";
            }
          }

          const customMessage = logsErrorMessage(
            error.response?.data?.code || 0,
          );
          searchObj.data.errorCode = error.response?.data?.code || 0;
          if (customMessage !== "") {
            searchObj.data.errorMsg = customMessage;
          }

          const status = error?.request?.status;
          if (status && (status >= 429 || status === 400)) {
            const message = error?.response?.data?.message || "";
            notificationMsg.value = message;
            searchObj.data.errorMsg = message;
          }

          if (traceId) {
            searchObj.data.errorMsg +=
              " <br><span class='text-subtitle1'>TraceID:" +
              traceId +
              "</span>";
          }
        })
        .finally(() => {
          removeTraceId(traceId);
          searchObj.loading = false;
        });
    } catch (error: unknown) {
      searchObj.loading = false;
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      showErrorNotification(`Error while fetching data: ${errorMessage}`);
    }
  };

  return {
    searchAroundData,
  };
};

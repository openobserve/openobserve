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
import { patternsState } from "@/composables/useLogs/usePatterns";
import { logsUtils } from "@/composables/useLogs/logsUtils";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { cloneDeep } from "lodash-es";
import { SearchRequestPayload } from "@/ts/interfaces/query";
import {
  convertDateToTimestamp,
  getConsumableRelativeTime,
} from "@/utils/date";
import config from "@/aws-exports";
import { b64EncodeUnicode, addSpacesToOperators } from "@/utils/zincutils";

export const useSearchQuery = () => {
  const store = useStore();
  const router = useRouter();
  const {
    fnParsedSQL,
    hasAggregation,
    isDistinctQuery,
    isWithQuery,
    isLimitQuery,
    extractTimestamps,
    addTransformToQuery,
    updateUrlQueryParams,
    fnUnparsedSQL,
    checkTimestampAlias,
  } = logsUtils();

  const { searchObj, notificationMsg, initialQueryPayload, searchAggData } = searchState();

  const getQueryReq = (isPagination: boolean): SearchRequestPayload | null => {
    searchObj.data.highlightQuery = "";

    if (!isPagination) {
      searchObj.data.queryResults = {};
    }

    searchObj.meta.showDetailTab = false;
    searchObj.meta.searchApplied = true;
    searchObj.data.functionError = "";

    searchAggData.total = 0;
    searchAggData.hasAggregation = false;

    if (
      !searchObj.data.stream.streamLists?.length ||
      searchObj.data.stream.selectedStream.length == 0
    ) {
      searchObj.loading = false;
      return null;
    }

    if (Number.isNaN(searchObj.data.datetime.endTime))   searchObj.data.datetime.endTime = "Invalid Date"
    if (Number.isNaN(searchObj.data.datetime.startTime)) searchObj.data.datetime.startTime = "Invalid Date"

    const queryReq: SearchRequestPayload = buildSearch();

    // Update highlight query on run-query
    if (searchObj.meta.sqlMode) {
      searchObj.data.highlightQuery =
        searchObj.data.query.toLowerCase().split("where")?.[1] || "";
    } else {
      searchObj.data.highlightQuery = searchObj.data.query.toLowerCase();
    }

    if (queryReq === null) {
      searchObj.loading = false;
      if (!notificationMsg.value) {
        notificationMsg.value = "Search query is empty or invalid.";
      } else {
        searchObj.data.errorMsg = notificationMsg.value;
      }
      return null;
    }

    if (!queryReq) {
      searchObj.loading = false;
      throw new Error(
        notificationMsg.value ||
          "Something went wrong while creating Search Request.",
      );
    }

    // get function definition
    addTransformToQuery(queryReq);

    // Add action ID if it exists
    if (searchObj.data.actionId && searchObj.data.transformType === "action") {
      queryReq.query["action_id"] = searchObj.data.actionId;
    }

    if (searchObj.data.datetime.type === "relative") {
      if (!isPagination) initialQueryPayload.value = cloneDeep(queryReq);
      else {
        if (
          searchObj.meta.refreshInterval == 0 &&
          router.currentRoute.value.name == "logs" &&
          searchObj.data.queryResults.hasOwnProperty("hits")
        ) {
          const start_time: number =
            initialQueryPayload.value?.query?.start_time || 0;
          const end_time: number =
            initialQueryPayload.value?.query?.end_time || 0;
          queryReq.query.start_time = start_time;
          queryReq.query.end_time = end_time;
        }
      }
    }

    // copy query request for histogram query and same for customDownload
    searchObj.data.histogramQuery = JSON.parse(JSON.stringify(queryReq));

    // reset errorCode
    searchObj.data.errorCode = 0;

    //here we need to send the actual sql query for histogram
    searchObj.data.histogramQuery.query.sql = queryReq.query.sql;
    searchObj.data.histogramQuery.query.size = -1;
    delete searchObj.data.histogramQuery.query.quick_mode;
    delete searchObj.data.histogramQuery.query.from;
    delete searchObj.data.histogramQuery.aggs;
    delete queryReq.aggs;
    if (searchObj.data.histogramQuery.query.action_id)
      delete searchObj.data.histogramQuery.query.action_id;

    searchObj.data.customDownloadQueryObj = JSON.parse(
      JSON.stringify(queryReq),
    );

    queryReq.query.from =
      (searchObj.data.resultGrid.currentPage - 1) *
      searchObj.meta.resultGrid.rowsPerPage;


    // Use configurable scan size when patterns mode is enabled to get data for pattern extraction
    queryReq.query.size =
      searchObj.meta.logsVisualizeToggle === "patterns"
      ? patternsState.value.scanSize
      : searchObj.meta.resultGrid.rowsPerPage;
  
    const parsedSQL: any = fnParsedSQL();

    searchObj.meta.resultGrid.showPagination = true;

    if (searchObj.meta.sqlMode == true) {
      // if query has aggregation or groupby then we need to set size to -1 to get all records
      // issue #5432
      // BUT: Don't override size when patterns mode is enabled - we need the configured scan size for pattern extraction
      if (
        (hasAggregation(parsedSQL?.columns) || parsedSQL.groupby != null) &&
        searchObj.meta.logsVisualizeToggle !== "patterns"
      ) {
        queryReq.query.size = -1;
      }

      // Don't apply LIMIT from SQL when patterns mode is enabled - we need the configured scan size for pattern extraction
      if (
        isLimitQuery(parsedSQL) &&
        searchObj.meta.logsVisualizeToggle !== "patterns"
      ) {
        queryReq.query.size = parsedSQL.limit.value[0].value;
        searchObj.meta.resultGrid.showPagination = false;

        if (parsedSQL.limit.separator == "offset") {
          queryReq.query.from = parsedSQL.limit.value[1].value || 0;
        }
        delete queryReq.query.track_total_hits;
      }

      if (
        isDistinctQuery(parsedSQL) ||
        isWithQuery(parsedSQL) ||
        !searchObj.data.queryResults.is_histogram_eligible
      ) {
        delete queryReq.query.track_total_hits;
      }
    }

    return queryReq;
  };

  const buildSearch = (): SearchRequestPayload => {
    try {
      let query = searchObj.data.query.trim();
      searchObj.data.filterErrMsg = "";
      searchObj.data.missingStreamMessage = "";
      searchObj.data.stream.missingStreamMultiStreamFilter = [];
      const req: any = {
        query: {
          sql: searchObj.meta.sqlMode
            ? query
            : 'select [FIELD_LIST][QUERY_FUNCTIONS] from "[INDEX_NAME]" [WHERE_CLAUSE]',
          start_time: (new Date().getTime() - 900000) * 1000,
          end_time: new Date().getTime() * 1000,
          from:
            searchObj.meta.resultGrid.rowsPerPage *
              (searchObj.data.resultGrid.currentPage - 1) || 0,
          size: searchObj.meta.resultGrid.rowsPerPage,
          quick_mode: searchObj.meta.quickMode,
        },
      };

      if (
        config.isEnterprise == "true" &&
        store.state.zoConfig.super_cluster_enabled
      ) {
        req["regions"] = searchObj.meta.regions;
        req["clusters"] = searchObj.meta.clusters;
      }

      const streamFieldNames: any =
        searchObj.data.stream.selectedStreamFields.map(
          (item: any) => item.name,
        );

      for (
        let i = searchObj.data.stream.interestingFieldList.length - 1;
        i >= 0;
        i--
      ) {
        const fieldName = searchObj.data.stream.interestingFieldList[i];
        if (!streamFieldNames.includes(fieldName)) {
          searchObj.data.stream.interestingFieldList.splice(i, 1);
        }
      }

      if (
        searchObj.data.stream.interestingFieldList.length > 0 &&
        searchObj.meta.quickMode
      ) {
        if (searchObj.data.stream.selectedStream.length == 1) {
          req.query.sql = req.query.sql.replace(
            "[FIELD_LIST]",
            searchObj.data.stream.interestingFieldList.join(","),
          );
        }
      } else {
        req.query.sql = req.query.sql.replace("[FIELD_LIST]", "*");
      }

      const timestamps: any =
        searchObj.data.datetime.type === "relative"
          ? getConsumableRelativeTime(
              searchObj.data.datetime.relativeTimePeriod,
            )
          : cloneDeep(searchObj.data.datetime);

      if (searchObj.data.datetime.type === "relative") {
        searchObj.data.datetime.startTime = timestamps.startTime;
        searchObj.data.datetime.endTime = timestamps.endTime;
      }

      if (
        timestamps.startTime != "Invalid Date" &&
        timestamps.endTime != "Invalid Date"
      ) {
        if (timestamps.startTime > timestamps.endTime) {
          notificationMsg.value = "Start time cannot be greater than end time";
          return null;
        }
        searchObj.meta.resultGrid.chartKeyFormat = "HH:mm:ss";

        req.query.start_time = timestamps.startTime;
        req.query.end_time = timestamps.endTime;

        setChartInterval(req);
      } else {
        if(timestamps.startTime == "Invalid Date") {
          notificationMsg.value = "The selected start time is  invalid. Please choose a valid time."
        }
        else if(timestamps.endTime == "Invalid Date") {
          notificationMsg.value = "The selected end time is  invalid. Please choose a valid time."
        }
        else {
          notificationMsg.value = "Invalid date format."
        }
        return null;
      }

      if (searchObj.meta.sqlMode == true) {
        return handleSqlMode(query, req);
      } else {
        return handleNonSqlMode(query, req);
      }
    } catch (e: any) {
      notificationMsg.value =
        "An error occurred while constructing the search query.";
      return null;
    }
  };

  const setChartInterval = (req: any) => {
    const timeDiff = req.query.end_time - req.query.start_time;

    searchObj.meta.resultGrid.chartInterval = "10 second";
    searchObj.meta.resultGrid.chartKeyFormat = "HH:mm:ss";

    if (timeDiff >= 1000000 * 60 * 30) {
      searchObj.meta.resultGrid.chartInterval = "15 second";
    }
    if (timeDiff >= 1000000 * 60 * 60) {
      searchObj.meta.resultGrid.chartInterval = "30 second";
    }
    if (timeDiff >= 1000000 * 3600 * 2) {
      searchObj.meta.resultGrid.chartInterval = "1 minute";
      searchObj.meta.resultGrid.chartKeyFormat = "MM-DD HH:mm";
    }
    if (timeDiff >= 1000000 * 3600 * 6) {
      searchObj.meta.resultGrid.chartInterval = "5 minute";
    }
    if (timeDiff >= 1000000 * 3600 * 24) {
      searchObj.meta.resultGrid.chartInterval = "30 minute";
    }
    if (timeDiff >= 1000000 * 86400 * 7) {
      searchObj.meta.resultGrid.chartInterval = "1 hour";
    }
    if (timeDiff >= 1000000 * 86400 * 30) {
      searchObj.meta.resultGrid.chartInterval = "1 day";
      searchObj.meta.resultGrid.chartKeyFormat = "YYYY-MM-DD";
    }
  };

  const handleSqlMode = (query: string, req: any): SearchRequestPayload => {
    searchObj.data.query = query;
    const parsedSQL: any = fnParsedSQL();

    if (parsedSQL != undefined) {

     if (!checkTimestampAlias(searchObj.data.query)) {
            const errorMsg = `Alias '${store.state.zoConfig.timestamp_column || "_timestamp"}' is not allowed.`;
            notificationMsg.value = errorMsg;
            return null;
          }

      if (Array.isArray(parsedSQL) && parsedSQL.length == 0) {
        notificationMsg.value =
          "SQL query is missing or invalid.";
        return null;
      }

      if (!parsedSQL?.columns?.length && !searchObj.meta.sqlMode) {
        notificationMsg.value = "No column found in selected stream.";
        return null;
      }

      if (parsedSQL.limit != null && parsedSQL.limit.value.length != 0) {
        req.query.size = parsedSQL.limit.value[0].value;

        if (parsedSQL.limit.separator == "offset") {
          req.query.from = parsedSQL.limit.value[1].value || 0;
        }

        query = fnUnparsedSQL(parsedSQL);
        query = query.replace(/`/g, '"');
        searchObj.data.queryResults.hits = [];
      }
    }

    req.query.sql = query
      .split("\n")
      .filter((line: string) => !line.trim().startsWith("--"))
      .join("\n");
    req.query["sql_mode"] = "full";

    return finalizeRequest(req);
  };

  const handleNonSqlMode = (query: string, req: any): SearchRequestPayload => {
    const parseQuery = [query];
    let queryFunctions = "";
    let whereClause = "";

    if (parseQuery.length > 1) {
      queryFunctions = "," + parseQuery[0].trim();
      whereClause = parseQuery[1].trim();
    } else {
      whereClause = parseQuery[0].trim();
    }

    whereClause = whereClause
      .split("\n")
      .filter((line: string) => !line.trim().startsWith("--"))
      .join("\n");

    if (whereClause.trim() != "") {
      whereClause = addSpacesToOperators(whereClause);
      const parsedSQL = whereClause.split(" ");

      let field: any;
      let node: any;
      let index: any;
      for (field of searchObj.data.stream.selectedStreamFields) {
        for ([node, index] of parsedSQL) {
          if (node === field.name) {
            parsedSQL[index] = '"' + node.replaceAll('"', "") + '"';
          }
        }
      }

      whereClause = parsedSQL.join(" ");
      req.query.sql = req.query.sql
        .split("[WHERE_CLAUSE]")
        .join(" WHERE " + whereClause);
    } else {
      req.query.sql = req.query.sql.replace("[WHERE_CLAUSE]", "");
    }

    req.query.sql = req.query.sql.replace(
      "[QUERY_FUNCTIONS]",
      queryFunctions.trim(),
    );

    if (searchObj.data.stream.selectedStream.length > 1) {
      return handleMultiStream(req, whereClause);
    } else {
      req.query.sql = req.query.sql.replace(
        "[INDEX_NAME]",
        searchObj.data.stream.selectedStream[0],
      );
    }

    return finalizeRequest(req);
  };

  const handleMultiStream = (
    req: any,
    whereClause: string,
  ): SearchRequestPayload => {
    let streams: any = searchObj.data.stream.selectedStream;

    if (whereClause.trim() != "") {
      const validationFlag = validateFilterForMultiStream();
      if (!validationFlag) {
        return null;
      }

      if (searchObj.data.stream.missingStreamMultiStreamFilter.length > 0) {
        streams = searchObj.data.stream.selectedStream.filter(
          (streams: any) =>
            !searchObj.data.stream.missingStreamMultiStreamFilter.includes(
              streams,
            ),
        );
      }
    }

    const preSQLQuery = req.query.sql;
    req.query.sql = [];

    streams
      .join(",")
      .split(",")
      .forEach((item: any) => {
        let finalQuery: string = preSQLQuery.replace("[INDEX_NAME]", item);

        const listOfFields: any = [];
        let streamField: any = {};

        for (const field of searchObj.data.stream.interestingFieldList) {
          for (streamField of searchObj.data.stream.selectedStreamFields) {
            if (
              streamField?.name == field &&
              streamField?.streams.indexOf(item) > -1 &&
              listOfFields.indexOf(field) == -1
            ) {
              listOfFields.push(field);
            }
          }
        }

        let queryFieldList: string = "";
        if (listOfFields.length > 0) {
          queryFieldList = "," + listOfFields.join(",");
        }

        finalQuery = finalQuery.replace(
          "[FIELD_LIST]",
          `'${item}' as _stream_name` + queryFieldList,
        );

        req.query.sql.push(finalQuery);
      });

    return req;
  };

  const finalizeRequest = (req: any): SearchRequestPayload => {
    if (
      searchObj.data.resultGrid.currentPage > 1 ||
      searchObj.meta.showHistogram === false
    ) {
      if (searchObj.meta.showHistogram === false) {
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
        searchObj.meta.histogramDirtyFlag = true;
      } else {
        searchObj.meta.histogramDirtyFlag = false;
      }
    }

    if (store.state.zoConfig.sql_base64_enabled) {
      req["encoding"] = "base64";
      req.query.sql = b64EncodeUnicode(req.query.sql);
    }

    updateUrlQueryParams();
    return req;
  };

  const validateFilterForMultiStream = (): boolean => {
    const filterCondition = searchObj.data.query;
    const parsedSQL: any = fnParsedSQL(
      "select * from stream where " + filterCondition,
    );
    searchObj.data.stream.filteredField = extractFilterColumns(
      parsedSQL?.where,
    );

    searchObj.data.filterErrMsg = "";
    searchObj.data.missingStreamMessage = "";
    searchObj.data.stream.missingStreamMultiStreamFilter = [];

    for (const fieldObj of searchObj.data.stream.filteredField) {
      const fieldName = fieldObj.expr.value;
      const filteredFields: any =
        searchObj.data.stream.selectedStreamFields.filter(
          (field: any) => field.name === fieldName,
        );

      if (filteredFields.length > 0) {
        const streamsCount = filteredFields[0].streams.length;
        const allStreamsEqual = filteredFields.every(
          (field: any) => field.streams.length === streamsCount,
        );
        if (!allStreamsEqual) {
          searchObj.data.filterErrMsg += `Field '${fieldName}' exists in different number of streams.\n`;
        }
      } else {
        searchObj.data.filterErrMsg += `Field '${fieldName}' does not exist in the one or more stream.\n`;
      }

      const fieldStreams: any = searchObj.data.stream.selectedStreamFields
        .filter((field: any) => field.name === fieldName)
        .map((field: any) => field.streams)
        .flat();

      searchObj.data.stream.missingStreamMultiStreamFilter =
        searchObj.data.stream.selectedStream.filter(
          (stream: any) => !fieldStreams.includes(stream),
        );

      if (searchObj.data.stream.missingStreamMultiStreamFilter.length > 0) {
        searchObj.data.missingStreamMessage = `One or more filter fields do not exist in "${searchObj.data.stream.missingStreamMultiStreamFilter.join(
          ", ",
        )}", hence no search is performed in the mentioned stream.\n`;
      }
    }

    return searchObj.data.filterErrMsg === "" ? true : false;
  };

  const extractFilterColumns = (expression: any): any[] => {
    const columns: any[] = [];

    function traverse(node: {
      type: string;
      column: any;
      left: any;
      right: any;
      args: { type: string; value: any[] };
    }) {
      if (node.type === "column_ref") {
        columns.push(node.column);
      } else if (node.type === "binary_expr") {
        traverse(node.left);
        traverse(node.right);
      } else if (node.type === "function") {
        if (node.args && node.args.type === "expr_list") {
          node.args.value.forEach((arg: any) => traverse(arg));
        }
      }
    }

    traverse(expression);
    return columns;
  };

  return {
    getQueryReq,
    buildSearch,
    validateFilterForMultiStream,
    extractFilterColumns,
  };
};

export default useSearchQuery;

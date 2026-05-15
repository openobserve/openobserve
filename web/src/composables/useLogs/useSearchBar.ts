// Copyright 2026 OpenObserve Inc.
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

import { useQuasar } from "quasar";
import { useStore } from "vuex";
import { useRouter } from "vue-router";

import { searchState } from "@/composables/useLogs/searchState";
import useStreams from "@/composables/useStreams";
import savedviewsService from "@/services/saved_views";
import searchService from "@/services/search";

import { arraysMatch } from "@/utils/zincutils";

import { logsUtils } from "@/composables/useLogs/logsUtils";

import useActions from "@/composables/useActions";
import useFunctions from "@/composables/useFunctions";
import useNotifications from "@/composables/useNotifications";
import useSearchWebSocket from "@/composables/useSearchWebSocket";
import useSearchStream from "@/composables/useLogs/useSearchStream";
import useStreamFields from "@/composables/useLogs/useStreamFields";
import { quoteSqlIdentifierIfNeeded } from "@/utils/query/sqlIdentifiers";
import config from "@/aws-exports";

export const useSearchBar = () => {
  const { getStream, isStreamExists, isStreamFetched } = useStreams();

  let { searchObj, searchObjDebug, notificationMsg } = searchState();

  const store = useStore();
  const router = useRouter();
  const $q = useQuasar();

  const { fnParsedSQL, extractTimestamps } = logsUtils();

  const { getDataThroughStream, buildSearch } = useSearchStream();

  const { getAllFunctions } = useFunctions();
  const { getAllActions } = useActions();
  const { showErrorNotification } = useNotifications();

  const { cancelSearchQueryBasedOnRequestId } = useSearchWebSocket();

  const { extractFields } = useStreamFields();

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

  const getSavedViews = async () => {
    try {
      searchObj.loadingSavedView = true;
      const favoriteViews: any = [];
      savedviewsService
        .get(store.state.selectedOrganization.identifier)
        .then((res) => {
          searchObj.loadingSavedView = false;
          searchObj.data.savedViews = res.data.views;
        })
        .catch((err) => {
          searchObj.loadingSavedView = false;
          console.log(err);
        });
    } catch (e: any) {
      searchObj.loadingSavedView = false;
      console.log("Error while getting saved views", e);
    }
  };

  const getRegionInfo = () => {
    searchService.get_regions().then((res) => {
      const clusterData = [];
      let regionObj: any = {};
      const apiData = res.data;
      for (const region in apiData) {
        regionObj = {
          label: region,
          children: [],
        };
        for (const cluster of apiData[region]) {
          regionObj.children.push({ label: cluster });
        }
        clusterData.push(regionObj);
      }

      store.dispatch("setRegionInfo", clusterData);
    });
  };

  const setSelectedStreams = (value: string) => {
    try {
      const parsedSQL = fnParsedSQL();

      if (
        !Object.hasOwn(parsedSQL, "from") ||
        parsedSQL?.from == null ||
        parsedSQL?.from?.length == 0
      ) {
        console.info("Failed to parse SQL query:", value);
        return;
      }

      const newSelectedStreams: string[] = [];

      // handled WITH query
      if (parsedSQL?.with) {
        let withObj = parsedSQL.with;
        withObj.forEach((obj: any) => {
          // Recursively extract table names from the WITH statement with depth protection
          const MAX_RECURSION_DEPTH = 50; // Prevent stack overflow
          const visitedNodes = new WeakSet(); // Prevent circular references - more efficient for objects

          const extractTablesFromNode = (node: any, depth: number = 0) => {
            if (!node || depth > MAX_RECURSION_DEPTH) {
              if (depth > MAX_RECURSION_DEPTH) {
                console.warn(
                  "Maximum recursion depth reached while parsing SQL query",
                );
              }
              return;
            }

            // Use WeakSet for efficient circular reference detection
            if (typeof node === "object" && node !== null) {
              if (visitedNodes.has(node)) {
                return; // Skip already visited nodes
              }
              visitedNodes.add(node);
            }

            // Check if current node has a from clause
            if (node.from && Array.isArray(node.from)) {
              node.from.forEach((stream: any) => {
                if (stream.table) {
                  newSelectedStreams.push(stream.table);
                }
                // Handle subquery in FROM clause
                if (stream.expr && stream.expr.ast) {
                  extractTablesFromNode(stream.expr.ast, depth + 1);
                }
              });
            }

            // Check for nested subqueries in WHERE clause
            if (node.where && node.where.right && node.where.right.ast) {
              extractTablesFromNode(node.where.right.ast, depth + 1);
            }

            // Check for nested subqueries in SELECT expressions
            if (node.columns && Array.isArray(node.columns)) {
              node.columns.forEach((col: any) => {
                if (col.expr && col.expr.ast) {
                  extractTablesFromNode(col.expr.ast, depth + 1);
                }
              });
            }
          };

          // Start extraction from the WITH statement
          extractTablesFromNode(obj?.stmt);
        });
      }
      // additionally, if union is there then it will have _next object which will have the table name it should check recursuvely as user can write multiple union
      else if (parsedSQL?._next) {
        //get the first table if it is next
        //this is to handle the union queries when user selects the multi stream selection the first table will be there in from array
        newSelectedStreams.push(
          ...parsedSQL.from.map((stream: any) => {
            return stream.table;
          }),
        );
        let nextTable = parsedSQL._next;
        //this will handle the union queries
        while (nextTable) {
          // Map through each "from" array in the _next object, as it can contain multiple tables
          if (nextTable.from) {
            nextTable.from.forEach((stream: { table: string }) =>
              newSelectedStreams.push(stream.table),
            );
          }
          nextTable = nextTable._next;
        }
      }
      //for simple query get the table name from the parsedSQL object
      // this will handle joins as well
      else if (parsedSQL?.from) {
        parsedSQL.from.map((stream: any) => {
          // Check if 'expr' and 'ast' exist, then access 'from' to get the table
          if (stream.expr?.ast?.from) {
            stream.expr.ast.from.forEach((subStream: any) => {
              if (subStream.table != undefined) {
                newSelectedStreams.push(subStream.table);
              }
            });
          }
          // Otherwise, return the table name directly
          if (stream.table != undefined) {
            newSelectedStreams.push(stream.table);
          }
        });
      }

      if (
        !arraysMatch(
          searchObj.data.stream.selectedStream,
          newSelectedStreams,
        ) &&
        isStreamFetched(searchObj.data.stream.streamType) &&
        isStreamExists(
          newSelectedStreams[newSelectedStreams.length - 1],
          searchObj.data.stream.streamType,
        )
      ) {
        searchObj.data.stream.selectedStream = newSelectedStreams;
        onStreamChange(value);
      }
    } catch (error) {
      console.error("Error in setSelectedStreams:", {
        error,
        query: value,
        currentStreams: searchObj.data.stream.selectedStream,
      });
      throw error;
    }
  };

  const onStreamChange = async (queryStr: string) => {
    try {
      searchObj.loadingStream = true;
      searchObj.loading = true;

      await cancelQuery();

      // Reset query results
      searchObj.data.queryResults = { hits: [] };

      // Build UNION query once
      const streams = searchObj.data.stream.selectedStream;
      const unionquery = streams
        .map((stream: string) => `SELECT [FIELD_LIST] FROM "${stream}"`)
        .join(" UNION ALL BY NAME ");

      const query = searchObj.meta.sqlMode ? queryStr || unionquery : "";

      // Fetch all stream data in parallel
      const streamDataPromises = streams.map((stream: string) =>
        getStream(stream, searchObj.data.stream.streamType || "logs", true),
      );

      const streamDataResults = await Promise.all(streamDataPromises);

      // TODO : We can optimize filter + flatMap using a single reducer function
      // Collect all schema fields
      const allStreamFields = streamDataResults
        .filter((data) => data?.schema)
        .flatMap((data) => data.schema);

      // Update selectedStreamFields once
      searchObj.data.stream.selectedStreamFields = allStreamFields;
      //check if allStreamFields is empty or not
      //if empty then we are displaying no events found... message on the UI instead of throwing in an error format
      if (!allStreamFields.length) {
        // searchObj.data.errorMsg = t("search.noFieldFound");
        searchObj.loading = false;
        return;
      }

      // Update selected fields if needed
      const streamFieldNames = new Set(
        allStreamFields.map((item) => item.name),
      );
      if (searchObj.data.stream.selectedFields.length > 0) {
        searchObj.data.stream.selectedFields =
          searchObj.data.stream.selectedFields.filter((fieldName: string) =>
            streamFieldNames.has(fieldName),
          );
      }

      // Update interesting fields list
      searchObj.data.stream.interestingFieldList =
        searchObj.data.stream.interestingFieldList.filter((fieldName: string) =>
          streamFieldNames.has(fieldName),
        );

      // Replace field list in query
      const fieldList =
        searchObj.meta.quickMode &&
        searchObj.data.stream.interestingFieldList.length > 0
          ? searchObj.data.stream.interestingFieldList
              .map((field: string) => quoteSqlIdentifierIfNeeded(field))
              .join(",")
          : "*";

      const finalQuery = query.replace(/\[FIELD_LIST\]/g, fieldList);

      // Update query related states
      searchObj.data.editorValue = finalQuery;
      searchObj.data.query = finalQuery;
      searchObj.data.tempFunctionContent = "";
      searchObj.meta.searchApplied = false;

      // Update histogram visibility
      if (streams.length > 1 && searchObj.meta.sqlMode == true) {
        searchObj.meta.showHistogram = false;
      }

      if (!store.state.zoConfig.query_on_stream_selection) {
        searchObj.meta.refreshHistogram = true;
        await handleQueryData();
      } else {
        // Reset states when query on selection is disabled
        searchObj.data.sortedQueryResults = [];
        searchObj.data.histogram = {
          xData: [],
          yData: [],
          breakdownField: null,
          breakdownSeries: null,
          chartParams: {
            title: "",
            unparsed_x_data: [],
            timezone: "",
          },
          errorCode: 0,
          errorMsg: "",
          errorDetail: "",
        };
        await extractFields();
        // In live mode, auto-run the query after fields are loaded
        if (
          store.state.zoConfig.auto_query_enabled &&
          searchObj.meta.liveMode
        ) {
          searchObj.meta.refreshHistogram = true;
          await handleQueryData();
        } else {
          searchObj.loading = false;
        }
      }
    } catch (e: any) {
      console.info("Error while getting stream data:", e);
    } finally {
      searchObj.loadingStream = false;
    }
  };

  const handleQueryData = async () => {
    try {
      searchObj.data.tempFunctionLoading = false;
      searchObj.data.tempFunctionName = "";
      searchObj.data.tempFunctionContent = "";
      searchObj.loading = true;
      await getQueryData();
    } catch (e: any) {
      console.log("Error while loading logs data");
    }
  };

  const getQueryData = async (isPagination = false) => {
    try {
      //remove any data that has been cached
      if (Object.keys(searchObj.data.originalDataCache).length > 0) {
        searchObj.data.originalDataCache = {};
      }
      // Reset cancel query on new search request initation
      searchObj.data.isOperationCancelled = false;

      // window will have more priority
      // if window has use_web_socket property then use that
      // else use organization settings
      searchObj.meta.jobId = "";
      searchObjDebug["queryDataStartTime"] = performance.now();
      searchObj.meta.showDetailTab = false;
      searchObj.meta.searchApplied = true;
      searchObj.data.functionError = "";
      if (
        !searchObj.data.stream.streamLists?.length ||
        searchObj.data.stream.selectedStream.length == 0
      ) {
        searchObj.loading = false;
        return;
      }

      // if (
      //   isNaN(searchObj.data.datetime.endTime) ||
      //   isNaN(searchObj.data.datetime.startTime)
      // ) {
      //   setDateTime(
      //     (router.currentRoute.value?.query?.period as string) || "15m",
      //   );
      // }

      // Fire result_schema with cross_linking=true in parallel (for cross-linking feature)
      // Use buildSearch(true) to get the actual query (works for both sqlMode and non-sqlMode)
      if (store.state.zoConfig?.enable_cross_linking) {
        const searchPayload = buildSearch(true);
        const crossLinkQuery = searchPayload?.query?.sql;
        // Store the built query so resolveCrossLinkUrl can use it (searchObj.data.query is empty in non-SQL mode)
        searchObj.data.crossLinkQuery = crossLinkQuery || "";
        if (crossLinkQuery) {
          const orgId = store.state.selectedOrganization.identifier;
          const pageType = searchObj.data.stream.streamType || "logs";
          const sqlQueries: string[] = Array.isArray(crossLinkQuery)
            ? crossLinkQuery
            : [crossLinkQuery];

          Promise.all(
            sqlQueries.map((sql: string) =>
              searchService
                .result_schema(
                  {
                    org_identifier: orgId,
                    query: {
                      query: {
                        sql,
                        start_time: (Date.now() - 3600000) * 1000,
                        end_time: Date.now() * 1000,
                        query_fn: null,
                        size: -1,
                        streaming_output: false,
                        streaming_id: null,
                      },
                    },
                    page_type: pageType,
                    is_streaming: false,
                    cross_linking: true,
                  },
                  "ui",
                )
                .catch(() => null),
            ),
          )
            .then((responses: any[]) => {
              const mergedLinks: any = {
                stream_links: [],
                org_links: [],
              };
              for (const res of responses) {
                if (!res?.data?.cross_links) continue;
                mergedLinks.stream_links.push(
                  ...res.data.cross_links.stream_links,
                );
                // org_links are common across all streams, take from first response
                if (mergedLinks.org_links.length === 0) {
                  mergedLinks.org_links = res.data.cross_links.org_links;
                }
              }
              searchObj.data.crossLinks = mergedLinks;
            })
            .catch(() => {
              searchObj.data.crossLinks = {
                stream_links: [],
                org_links: [],
              };
            });
        }
      }

      // Use the appropriate method to fetch data
      getDataThroughStream(isPagination);

    } catch (e: any) {
      searchObj.loading = false;
      showErrorNotification(
        notificationMsg.value || "Error occurred during the search operation.",
      );
      notificationMsg.value = "";
    }
  };

  const cancelQuery = async (): Promise<boolean> => {
    return new Promise((resolve, reject) => {
      try {
        // only call cancel query api if it is enterprise
        // otherwise resolve and return immediately
        if (config.isEnterprise !== "true") {
          resolve(true);
          return;
        }

        const tracesIds = [...searchObj.data.searchRequestTraceIds];

        if (!searchObj.data.searchRequestTraceIds.length) {
          searchObj.data.isOperationCancelled = false;
          resolve(true);
          return;
        }

        searchObj.data.isOperationCancelled = true;

        searchService
          .delete_running_queries(
            store.state.selectedOrganization.identifier,
            searchObj.data.searchRequestTraceIds,
          )
          .then((res) => {
            const isCancelled = res.data.some((item: any) => item.is_success);
            if (isCancelled) {
              searchObj.data.isOperationCancelled = false;
              $q.notify({
                message: "Running query cancelled successfully",
                color: "positive",
                position: "bottom",
                timeout: 4000,
              });
            }
          })
          .catch((error: any) => {
            $q.notify({
              message:
                error.response?.data?.message ||
                "Failed to cancel running query",
              color: "negative",
              position: "bottom",
              timeout: 1500,
            });
          })
          .finally(() => {
            searchObj.data.searchRequestTraceIds =
              searchObj.data.searchRequestTraceIds.filter(
                (id: string) => !tracesIds.includes(id),
              );
            resolve(true);
          });
      } catch (error) {
        $q.notify({
          message: "Failed to cancel running query",
          color: "negative",
          position: "bottom",
          timeout: 1500,
        });
        resolve(true);
      }
    });
  };

  const sendCancelSearchMessage = (searchRequests: any[]) => {
    try {
      if (!searchRequests.length) {
        searchObj.data.isOperationCancelled = false;
        return;
      }

      searchObj.data.isOperationCancelled = true;

      // loop on all requestIds
      searchRequests.forEach((traceId) => {
        cancelSearchQueryBasedOnRequestId({
          trace_id: traceId,
          org_id: store?.state?.selectedOrganization?.identifier,
        });
      });
    } catch (error: any) {
      console.error("Failed to cancel WebSocket searches:", error);
      showErrorNotification("Failed to cancel search operations");
    }
  };


  const setDateTime = (period: string = "15m") => {
    const extractedDate: any = extractTimestamps(period);
    searchObj.data.datetime.startTime = extractedDate.from;
    searchObj.data.datetime.endTime = extractedDate.to;
  };

  return {
    getFunctions,
    getActions,
    getSavedViews,
    getRegionInfo,
    setSelectedStreams,
    onStreamChange,
    getQueryData,
    sendCancelSearchMessage,
    cancelQuery,
    handleQueryData,
    setDateTime,
  };
};

export default useSearchBar;

<!-- Copyright 2023 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <div class="column logs-index-menu full-height">
    <div>
      <!-- <select v-model="selectedStream">
        <option
          v-for="stream in streamOptions"
          :key="stream.value"
          :value="stream.value"
        >
          <q-icon size="sm" name="search" />
          {{ stream.label }}
        </option>
      </select> -->
      <q-select
        data-test="log-search-index-list-select-stream"
        v-model="selectedStream"
        :options="streamOptions"
        data-cy="index-dropdown"
        input-debounce="0"
        behavior="menu"
        emit-value
        filled
        borderless
        dense
        multiple
        map-options
      >
      </q-select>
    </div>
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  type Ref,
  watch,
  computed,
  onBeforeMount,
} from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import { useRouter } from "vue-router";
import useLogs from "../../composables/useLogs";
import {
  b64EncodeUnicode,
  getImageURL,
  convertTimeFromMicroToMilli,
  formatLargeNumber,
  useLocalInterestingFields,
  generateTraceContext,
  isWebSocketEnabled,
  isStreamingEnabled,
  b64EncodeStandard,
} from "../../utils/zincutils";
import streamService from "../../services/stream";
import {
  outlinedAdd,
  outlinedVisibility,
  outlinedVisibilityOff,
} from "@quasar/extras/material-icons-outlined";
import EqualIcon from "@/components/icons/EqualIcon.vue";
import NotEqualIcon from "@/components/icons/NotEqualIcon.vue";
import { getConsumableRelativeTime } from "@/utils/date";
import { cloneDeep } from "lodash-es";
import useSearchWebSocket from "@/composables/useSearchWebSocket";
import searchService from "@/services/search";
import useHttpStreaming from "@/composables/useStreamingSearch";

interface Filter {
  fieldName: string;
  selectedValues: string[];
  selectedOperator: string;
}
export default defineComponent({
  name: "ComponentSearchIndexSelect",
  components: { EqualIcon, NotEqualIcon },
  emits: ["setInterestingFieldInSQLQuery"],
  methods: {
    handleMultiStreamSelection() {
      this.onStreamChange("");
    },
    handleSingleStreamSelect(opt: any) {
      if (this.searchObj.data.stream.selectedStream.indexOf(opt.value) == -1) {
        this.searchObj.data.stream.selectedFields = [];
      }
      this.searchObj.data.stream.selectedStream = [opt.value];
      this.onStreamChange("");
    },
  },
  setup(props, { emit }) {
    const store = useStore();
    const router = useRouter();
    const { t } = useI18n();
    const $q = useQuasar();
    const {
      searchObj,
      updatedLocalLogFilterField,
      handleQueryData,
      onStreamChange,
      filterHitsColumns,
      extractFields,
      validateFilterForMultiStream,
      reorderSelectedFields,
      getFilterExpressionByFieldType,
      extractValueQuery,
    } = useLogs();

    const {
      fetchQueryDataWithWebSocket,
      sendSearchMessageBasedOnRequestId,
      cancelSearchQueryBasedOnRequestId,
    } = useSearchWebSocket();

    const { fetchQueryDataWithHttpStream } = useHttpStreaming();

    const traceIdMapper = ref<{ [key: string]: string[] }>({});
    const openedFilterFields = ref<string[]>([]);

    const userDefinedSchemaBtnGroupOption = [
      {
        label: "",
        value: "user_defined_schema",
        slot: "user_defined_slot",
      },
      {
        label: "",
        value: "all_fields",
        slot: "all_fields_slot",
      },
    ];
    const streamOptions: any = ref([
      {
        label: "All Streams",
        value: "all_streams",
      },
      {
        label: "Default",
        value: "default",
      },
    ]);
    const fieldValues: Ref<{
      [key: string | number]: {
        isLoading: boolean;
        values: { key: string; count: number }[];
        errMsg?: string;
      };
    }> = ref({});

    // New state to store field values with stream context
    const streamFieldValues: Ref<{
      [key: string]: {
        [stream: string]: {
          values: { key: string; count: number }[];
        };
      };
    }> = ref({});

    let parser: any;

    const streamTypes = [
      { label: t("search.logs"), value: "logs" },
      { label: t("search.enrichmentTables"), value: "enrichment_tables" },
    ];

    const filterStreamFn = (val: string, update: any) => {
      update(() => {
        streamOptions.value = searchObj.data.stream.streamLists;
        const needle = val.toLowerCase();
        streamOptions.value = streamOptions.value.filter(
          (v: any) => v.label.toLowerCase().indexOf(needle) > -1,
        );
      });
    };

    onBeforeMount(async () => {
      await importSqlParser();
    });

    const importSqlParser = async () => {
      const useSqlParser: any = await import("@/composables/useParser");
      const { sqlParser }: any = useSqlParser.default();
      parser = await sqlParser();
    };

    const selectedStream = ref("");

    //removed this watcher as search stream not working
    // watch(
    //   () => {
    //     searchObj.data.stream.streamLists.length;
    //     store.state.organizationData.streams;
    //   },
    //   () => {

    //     streamOptions.value =
    //       searchObj.data.stream.streamLists ||
    //       store.state.organizationData.streams;
    //   }
    // );

    const filterFieldFn = (rows: any, terms: any) => {
      var filtered = [];
      var includedFields: any = [];
      if (terms != "") {
        terms = terms.toLowerCase();
        for (var i = 0; i < rows.length; i++) {
          if (
            rows[i]["name"].toLowerCase().includes(terms) &&
            includedFields.indexOf(rows[i]["name"]) == -1
          ) {
            filtered.push(rows[i]);
            includedFields.push(rows[i]["name"]);
          }
        }
      }
      return filtered;
    };

    const addToFilter = (field: any) => {
      searchObj.data.stream.addToFilter = field;
    };

    function clickFieldFn(row: { name: never }, pageIndex: number) {
      let selectedFields = reorderSelectedFields();

      if (selectedFields.includes(row.name)) {
        selectedFields = selectedFields.filter((v: any) => v !== row.name);
      } else {
        selectedFields.push(row.name);
      }

      searchObj.data.stream.selectedFields = selectedFields;

      searchObj.organizationIdentifier =
        store.state.selectedOrganization.identifier;
      updatedLocalLogFilterField();
      filterHitsColumns();
    }

    /**
     * Single Stream
     * - Consider filter in sql and non sql mode, create sql query and fetch values
     *
     * Multiple Stream
     * - Dont consider filter in both mode, create sql query for each stream and fetch values
     *
     * @param event
     * @param param1
     */

    const openFilterCreator = async (
      event: any,
      { name, ftsKey, isSchemaField, streams }: any,
    ) => {
      if (ftsKey) {
        event.stopPropagation();
        event.preventDefault();
        return;
      }
      try {
        //maintaing  the opened fields
        openedFilterFields.value.push(name);
        let timestamps: any =
          searchObj.data.datetime.type === "relative"
            ? getConsumableRelativeTime(
                searchObj.data.datetime.relativeTimePeriod,
              )
            : cloneDeep(searchObj.data.datetime);

        if (searchObj.data.stream.streamType === "enrichment_tables") {
          const stream = searchObj.data.streamResults.list.find((stream: any) =>
            searchObj.data.stream.selectedStream.includes(stream.name),
          );
          if (stream.stats) {
            timestamps = {
              startTime:
                new Date(
                  convertTimeFromMicroToMilli(
                    stream.stats.doc_time_min - 300000000,
                  ),
                ).getTime() * 1000,
              endTime:
                new Date(
                  convertTimeFromMicroToMilli(
                    stream.stats.doc_time_max + 300000000,
                  ),
                ).getTime() * 1000,
            };
          }
        }

        const startISOTimestamp: number = timestamps?.startTime || 0;
        const endISOTimestamp: number = timestamps?.endTime || 0;

        fieldValues.value[name] = {
          isLoading: true,
          values: [],
          errMsg: "",
        };
        let query_context = "";
        let query = searchObj.data.query;
        let whereClause = "";
        let queries: any = {};
        searchObj.data.filterErrMsg = "";
        searchObj.data.missingStreamMessage = "";
        searchObj.data.stream.missingStreamMultiStreamFilter = [];
        if (searchObj.meta.sqlMode == true && query.trim().length) {
          const parsedSQL: any = parser.astify(query);
          //hack add time stamp column to parsedSQL if not already added
          query_context = parser.sqlify(parsedSQL).replace(/`/g, '"') || "";

          if (searchObj.data.stream.selectedStream.length > 1) {
            queries = extractValueQuery();
          }
        } else {
          let parseQuery = query.split("|");
          let queryFunctions = "";
          let whereClause = "";
          if (parseQuery.length > 1) {
            queryFunctions = "," + parseQuery[0].trim();
            whereClause = parseQuery[1].trim();
          } else {
            whereClause = parseQuery[0].trim();
          }

          query_context = `SELECT *${queryFunctions} FROM "[INDEX_NAME]" [WHERE_CLAUSE]`;

          if (whereClause.trim() != "") {
            whereClause = whereClause
              .replace(/=(?=(?:[^"']*"[^"']*"')*[^"']*$)/g, " =")
              .replace(/>(?=(?:[^"']*"[^"']*"')*[^"']*$)/g, " >")
              .replace(/<(?=(?:[^"']*"[^"']*"')*[^"']*$)/g, " <");

            whereClause = whereClause
              .replace(/!=(?=(?:[^"']*"[^"']*"')*[^"']*$)/g, " !=")
              .replace(/! =(?=(?:[^"']*"[^"']*"')*[^"']*$)/g, " !=")
              .replace(/< =(?=(?:[^"']*"[^"']*"')*[^"']*$)/g, " <=")
              .replace(/> =(?=(?:[^"']*"[^"']*"')*[^"']*$)/g, " >=");

            const parsedSQL = whereClause.split(" ");
            searchObj.data.stream.selectedStreamFields.forEach((field: any) => {
              parsedSQL.forEach((node: any, index: any) => {
                if (node == field.name) {
                  node = node.replaceAll('"', "");
                  parsedSQL[index] = '"' + node + '"';
                }
              });
            });

            whereClause = parsedSQL.join(" ");

            query_context = query_context.replace(
              "[WHERE_CLAUSE]",
              " WHERE " + whereClause,
            );
          } else {
            query_context = query_context.replace("[WHERE_CLAUSE]", "");
          }
          // query_context = b64EncodeUnicode(query_context) || "";
        }

        let query_fn = "";
        if (
          searchObj.data.tempFunctionContent != "" &&
          searchObj.data.transformType === "function"
        ) {
          query_fn = b64EncodeUnicode(searchObj.data.tempFunctionContent) || "";
        }

        let action_id = "";
        if (
          searchObj.data.transformType === "action" &&
          searchObj.data.selectedTransform?.id
        ) {
          action_id = searchObj.data.selectedTransform.id;
        }

        fieldValues.value[name] = {
          isLoading: true,
          values: [],
          errMsg: "",
        };
        if (whereClause.trim() != "") {
          // validateFilterForMultiStream function called to get missingStreamMultiStreamFilter
          const validationFlag = validateFilterForMultiStream();
          if (!validationFlag) {
            fieldValues.value[name]["isLoading"] = false;
            fieldValues.value[name]["errMsg"] =
              "Filter is not valid for selected streams.";
            return;
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

        let countTotal = streams.length;
        for (const selectedStream of streams) {
          if (streams.length > 1) {
            query_context = "select * from [INDEX_NAME]";
          }
          if (
            searchObj.data.stream.selectedStream.length > 1 &&
            searchObj.meta.sqlMode &&
            queries[selectedStream]
          ) {
            query_context = queries[selectedStream];
          }

          if (query_context !== "") {
            query_context = query_context == undefined ? "" : query_context;

            // Implement websocket based field values, check getQueryData in useLogs for websocket enabled
            if (isWebSocketEnabled() || isStreamingEnabled()) {
              fetchValuesWithWebsocket({
                fields: [name],
                size: 10,
                no_count: false,
                regions: searchObj.meta.regions,
                clusters: searchObj.meta.clusters,
                vrl_fn: query_fn,
                start_time: startISOTimestamp,
                end_time: endISOTimestamp,
                timeout: 30000,
                stream_name: selectedStream,
                stream_type: searchObj.data.stream.streamType,
                use_cache: (window as any).use_cache ?? true,
                sql:
                  b64EncodeUnicode(
                    query_context.replace("[INDEX_NAME]", selectedStream),
                  ) || "",
              });
              continue;
            }

            //TODO : add comments for this in future
            //for future reference
            //values api using partition based api
            let queryToBeSent = query_context.replace(
              "[INDEX_NAME]",
              selectedStream,
            );

            const response = await getValuesPartition(
              startISOTimestamp,
              endISOTimestamp,
              name,
              queryToBeSent,
            );
            const partitions: any = response?.data.partitions || [];

            for (const partition of partitions) {
              try {
                //check if the field is opened because sometimes
                // user might close the field before all the subsequent requests are completed
                if (!openedFilterFields.value.includes(name)) {
                  return;
                }

                const res: any = await streamService.fieldValues({
                  org_identifier: store.state.selectedOrganization.identifier,
                  stream_name: selectedStream,
                  start_time: partition[0],
                  end_time: partition[1],
                  fields: [name],
                  size: 10,
                  query_context: b64EncodeUnicode(queryToBeSent) || "",
                  query_fn: query_fn,
                  action_id,
                  type: searchObj.data.stream.streamType,
                  clusters:
                    Object.hasOwn(searchObj.meta, "clusters") &&
                    searchObj.meta.clusters.length > 0
                      ? searchObj.meta.clusters.join(",")
                      : "",
                });

                if (res.data.hits.length) {
                  res.data.hits.forEach((item: any) => {
                    item.values.forEach((subItem: any) => {
                      const index = fieldValues.value[name]["values"].findIndex(
                        (value: any) => value.key === subItem.zo_sql_key,
                      );
                      if (index !== -1) {
                        fieldValues.value[name]["values"][index].count +=
                          parseInt(subItem.zo_sql_num);
                      } else {
                        fieldValues.value[name]["values"].push({
                          key: subItem.zo_sql_key,
                          count: parseInt(subItem.zo_sql_num),
                        });
                      }
                    });
                  });

                  if (fieldValues.value[name]["values"].length > 10) {
                    fieldValues.value[name]["values"].sort(
                      (a, b) => b.count - a.count,
                    );
                    fieldValues.value[name]["values"] = fieldValues.value[name][
                      "values"
                    ].slice(0, 10);
                  }
                }
              } catch (err) {
                console.error("Failed to fetch field values:", err);
                fieldValues.value[name].errMsg = "Failed to fetch field values";
              } finally {
                countTotal--;
                if (countTotal <= 0) {
                  fieldValues.value[name].isLoading = false;
                }
              }
            }
          }
        }

        openedFilterFields.value = openedFilterFields.value.filter(
          (field: string) => field !== name,
        );
      } catch (err) {
        fieldValues.value[name]["isLoading"] = false;
        openedFilterFields.value = openedFilterFields.value.filter(
          (field: string) => field !== name,
        );
        console.log(err);
        $q.notify({
          type: "negative",
          message: "Error while fetching field values",
        });
      }
    };

    const addSearchTerm = (
      field: string,
      field_value: string | number | boolean,
      action: string,
    ) => {
      const expression = getFilterExpressionByFieldType(
        field,
        field_value,
        action,
      );

      if (expression) {
        searchObj.data.stream.addToFilter = expression;
      } else {
        $q.notify({
          type: "negative",
          message: "Failed to generate filter expression",
        });
      }
    };
    //   const query = searchObj.meta.sqlMode
    //     ? `SELECT * FROM "${searchObj.data.stream.selectedStream.value}"`
    //     : "";

    //   searchObj.data.editorValue = query;
    //   searchObj.data.query = query;

    //   handleQueryData();
    // };

    let selectedFieldsName: any = [];
    let fieldIndex: any = -1;
    const addToInterestingFieldList = (
      field: any,
      isInterestingField: boolean,
    ) => {
      if (selectedFieldsName.length == 0) {
        selectedFieldsName = searchObj.data.stream.selectedStreamFields.map(
          (item: any) => item.name,
        );
      }
      if (isInterestingField) {
        const index = searchObj.data.stream.interestingFieldList.indexOf(
          field.name,
        );
        if (index > -1) {
          // only splice array when item is found
          searchObj.data.stream.interestingFieldList.splice(index, 1); // 2nd parameter means remove one item only

          field.isInterestingField = !isInterestingField;
          fieldIndex = selectedFieldsName.indexOf(field.name);
          if (fieldIndex > -1) {
            searchObj.data.stream.selectedStreamFields[
              fieldIndex
            ].isInterestingField = !isInterestingField;
            fieldIndex = -1;
          }
          // searchObj.data.stream.selectedStreamFields[3].isInterestingField = !isInterestingField;
          const localInterestingFields: any = useLocalInterestingFields();
          let localStreamFields: any = {};
          if (localInterestingFields.value != null) {
            localStreamFields = localInterestingFields.value;
          }
          if (field.streams.length > 0) {
            let localFieldIndex = -1;
            for (const selectedStream of field.streams) {
              localFieldIndex = localStreamFields[
                searchObj.organizationIdentifier + "_" + selectedStream
              ].indexOf(field.name);
              if (localFieldIndex > -1) {
                localStreamFields[
                  searchObj.organizationIdentifier + "_" + selectedStream
                ].splice(localFieldIndex, 1);
              }
            }
          }
          useLocalInterestingFields(localStreamFields);
        }
      } else {
        const index = searchObj.data.stream.interestingFieldList.indexOf(
          field.name,
        );
        if (index == -1 && field.name != "*") {
          searchObj.data.stream.interestingFieldList.push(field.name);
          const localInterestingFields: any = useLocalInterestingFields();
          field.isInterestingField = !isInterestingField;
          fieldIndex = selectedFieldsName.indexOf(field.name);
          if (fieldIndex > -1) {
            searchObj.data.stream.selectedStreamFields[
              fieldIndex
            ].isInterestingField = !isInterestingField;
            fieldIndex = -1;
          }

          let localStreamFields: any = {};
          if (localInterestingFields.value != null) {
            localStreamFields = localInterestingFields.value;
          }
          if (field.streams.length > 0) {
            for (const selectedStream of field.streams) {
              if (selectedStream != undefined) {
                if (
                  localStreamFields[
                    searchObj.organizationIdentifier + "_" + selectedStream
                  ] == undefined
                ) {
                  localStreamFields[
                    searchObj.organizationIdentifier + "_" + selectedStream
                  ] = [];
                }

                if (
                  localStreamFields[
                    searchObj.organizationIdentifier + "_" + selectedStream
                  ].indexOf(field.name) == -1
                ) {
                  localStreamFields[
                    searchObj.organizationIdentifier + "_" + selectedStream
                  ].push(field.name);
                }
              }
            }
          }
          useLocalInterestingFields(localStreamFields);
        }
      }

      emit("setInterestingFieldInSQLQuery", field, isInterestingField);
    };

    const pagination = ref({
      page: 1,
      rowsPerPage: 25,
    });

    const toggleSchema = async () => {
      searchObj.loadingStream = true;
      selectedFieldsName = [];
      setTimeout(async () => {
        await extractFields();
        searchObj.loadingStream = false;
      }, 0);
    };

    const sortedStreamFields = () => {
      return searchObj.data.stream.selectedStreamFields.sort(
        (a: any, b: any) => a.group - b.group,
      );
    };

    const placeHolderText = computed(() => {
      return searchObj.data.stream?.selectedStream?.length === 0
        ? "Select Stream"
        : "";
    });

    // ----- WebSocket Implementation -----

    const fetchValuesWithWebsocket = (payload: any) => {
      const wsPayload = {
        queryReq: payload,
        type: "values",
        isPagination: false,
        traceId: generateTraceContext().traceId,
        org_id: searchObj.organizationIdentifier,
        meta: payload,
      };
      initializeWebSocketConnection(wsPayload);

      addTraceId(payload.fields[0], wsPayload.traceId);
    };

    const initializeWebSocketConnection = (payload: any) => {
      if (isWebSocketEnabled()) {
        fetchQueryDataWithWebSocket(payload, {
          open: sendSearchMessage,
          close: handleSearchClose,
          error: handleSearchError,
          message: handleSearchResponse,
          reset: handleSearchReset,
        }) as string;
        return;
      }

      if (isStreamingEnabled()) {
        fetchQueryDataWithHttpStream(payload, {
          data: handleSearchResponse,
          error: handleSearchError,
          complete: handleSearchClose,
          reset: handleSearchReset,
        });
        return;
      }
    };

    const sendSearchMessage = (queryReq: any) => {
      const payload = {
        type: "values",
        content: {
          trace_id: queryReq.traceId,
          payload: queryReq.queryReq,
          stream_type: searchObj.data.stream.streamType,
          search_type: "ui",
          use_cache: (window as any).use_cache ?? true,
          org_id: searchObj.organizationIdentifier,
        },
      };

      if (
        Object.hasOwn(queryReq.queryReq, "regions") &&
        Object.hasOwn(queryReq.queryReq, "clusters")
      ) {
        payload.content.payload["regions"] = queryReq.queryReq.regions;
        payload.content.payload["clusters"] = queryReq.queryReq.clusters;
      }

      sendSearchMessageBasedOnRequestId(payload);
    };

    const handleSearchClose = (payload: any, response: any) => {
      // Disable the loading indicator
      if (fieldValues.value[payload.queryReq.fields[0]]) {
        fieldValues.value[payload.queryReq.fields[0]].isLoading = false;
      }

      //TODO Omkar: Remove the duplicate error codes, are present same in useSearchWebSocket.ts
      const errorCodes = [1001, 1006, 1010, 1011, 1012, 1013];

      if (errorCodes.includes(response.code)) {
        handleSearchError(payload, {
          content: {
            message:
              "WebSocket connection terminated unexpectedly. Please check your network and try again",
            trace_id: payload.traceId,
            code: response.code,
            error_detail: "",
          },
          type: "error",
        });
      }

      removeTraceId(payload.queryReq.fields[0], payload.traceId);
    };

    const handleSearchError = (request: any, err: any) => {
      if (fieldValues.value[request.queryReq?.fields[0]]) {
        fieldValues.value[request.queryReq.fields[0]].isLoading = false;
        fieldValues.value[request.queryReq.fields[0]].errMsg =
          "Failed to fetch field values";
      }

      removeTraceId(request.queryReq.fields[0], request.traceId);
    };

    const handleSearchResponse = (payload: any, response: any) => {
      const fieldName = payload?.queryReq?.fields[0];
      const streamName = payload?.queryReq?.stream_name;

      try {
        // We don't need to handle search_response_metadata
        if (response.type === "cancel_response") {
          removeTraceId(payload.queryReq.fields[0], response.content.trace_id);
          return;
        }

        if (response.type !== "search_response_hits") {
          return;
        }

        // Initialize if not exists
        if (!fieldValues.value[fieldName]) {
          fieldValues.value[fieldName] = {
            values: [],
            isLoading: false,
            errMsg: "",
          };
        }

        // Initialize stream-specific values if not exists
        if (!streamFieldValues.value[fieldName]) {
          streamFieldValues.value[fieldName] = {};
        }

        streamFieldValues.value[fieldName][streamName] = {
          values: [],
        };

        // Process the results
        if (response.content.results.hits.length) {
          // Store stream-specific values
          const streamValues: { key: string; count: number }[] = [];

          response.content.results.hits.forEach((item: any) => {
            item.values.forEach((subItem: any) => {
              streamValues.push({
                key: subItem.zo_sql_key,
                count: parseInt(subItem.zo_sql_num),
              });
            });
          });

          // Update stream-specific values
          streamFieldValues.value[fieldName][streamName].values = streamValues;

          // Aggregate values across all streams
          const aggregatedValues: { [key: string]: number } = {};

          // Collect all values from all streams
          Object.keys(streamFieldValues.value[fieldName]).forEach((stream) => {
            streamFieldValues.value[fieldName][stream].values.forEach(
              (value) => {
                if (aggregatedValues[value.key]) {
                  aggregatedValues[value.key] += value.count;
                } else {
                  aggregatedValues[value.key] = value.count;
                }
              },
            );
          });

          // Convert aggregated values to array and sort
          const aggregatedArray = Object.keys(aggregatedValues).map((key) => ({
            key,
            count: aggregatedValues[key],
          }));

          // Sort by count in descending order
          aggregatedArray.sort((a, b) => b.count - a.count);

          // Take top 10
          fieldValues.value[fieldName].values = aggregatedArray.slice(0, 10);
        }

        // Mark as not loading
        fieldValues.value[fieldName].isLoading = false;
      } catch (error) {
        console.error("Failed to fetch field values:", error);
        fieldValues.value[fieldName].errMsg = "Failed to fetch field values";
        fieldValues.value[fieldName].isLoading = false;
      }
    };

    const handleSearchReset = (data: any) => {
      const fieldName = data.payload.queryReq.fields[0];

      // Reset the main fieldValues state
      fieldValues.value[fieldName] = {
        values: [],
        isLoading: true,
        errMsg: "",
      };

      // Reset the streamFieldValues state for this field
      if (streamFieldValues.value[fieldName]) {
        streamFieldValues.value[fieldName] = {};
      }

      fetchValuesWithWebsocket(data.payload.queryReq);
    };

    const addTraceId = (field: string, traceId: string) => {
      if (!traceIdMapper.value[field]) {
        traceIdMapper.value[field] = [];
      }

      traceIdMapper.value[field].push(traceId);
    };

    const removeTraceId = (field: string, traceId: string) => {
      if (traceIdMapper.value[field]) {
        traceIdMapper.value[field] = traceIdMapper.value[field].filter(
          (id) => id !== traceId,
        );
      }
    };

    const cancelFilterCreator = (row: any) => {
      //if it is websocker based then cancel the trace id
      //else cancel the further value api calls using the openedFilterFields
      if (isWebSocketEnabled()) {
        cancelTraceId(row.name);
      } else {
        cancelValueApi(row.name);
      }
    };

    const cancelTraceId = (field: string) => {
      const traceIds = traceIdMapper.value[field];
      if (traceIds) {
        traceIds.forEach((traceId) => {
          cancelSearchQueryBasedOnRequestId({
            trace_id: traceId,
            org_id: store?.state?.selectedOrganization?.identifier,
          });
        });
      }
    };
    const cancelValueApi = (value: string) => {
      //remove the field from the openedFilterFields
      openedFilterFields.value = openedFilterFields.value.filter(
        (field: string) => field !== value,
      );
    };
    const getValuesPartition = async (
      start: number,
      end: number,
      name: string,
      queryToBeSent: string,
    ) => {
      try {
        const queryReq = {
          sql: queryToBeSent,
          start_time: start,
          end_time: end,
          sql_mode: "context",
          // streaming_output: true,
        };
        const res = await searchService.partition({
          org_identifier: store.state.selectedOrganization.identifier,
          query: queryReq,
          page_type: searchObj.data.stream.streamType,
          traceparent: generateTraceContext().traceId,
        });

        return res;
      } catch (err) {
        console.error("Failed to fetch field values:", err);
        fieldValues.value[name].errMsg = "Failed to fetch field values";
      }
    };

    return {
      t,
      store,
      router,
      searchObj,
      streamOptions,
      filterFieldFn,
      addToFilter,
      clickFieldFn,
      getImageURL,
      filterStreamFn,
      openFilterCreator,
      addSearchTerm,
      fieldValues,
      streamTypes,
      outlinedAdd,
      outlinedVisibilityOff,
      outlinedVisibility,
      handleQueryData,
      onStreamChange,
      addToInterestingFieldList,
      extractFields,
      userDefinedSchemaBtnGroupOption,
      pagination,
      toggleSchema,
      streamFieldsRows: computed(() => {
        let expandKeys = Object.keys(
          searchObj.data.stream.expandGroupRows,
        ).reverse();

        let startIndex = 0;
        // Iterate over the keys in reverse order
        let selectedStreamFields = cloneDeep(
          searchObj.data.stream.selectedStreamFields,
        );
        let count = 0;
        // console.log(searchObj.data.stream.selectedStreamFields)
        // console.log(searchObj.data.stream.expandGroupRows)
        // console.log(searchObj.data.stream.expandGroupRowsFieldCount)
        for (let key of expandKeys) {
          if (
            searchObj.data.stream.expandGroupRows[key] == false &&
            selectedStreamFields != undefined &&
            selectedStreamFields?.length > 0
          ) {
            startIndex =
              selectedStreamFields.length -
              searchObj.data.stream.expandGroupRowsFieldCount[key];
            if (startIndex > 0) {
              // console.log("startIndex", startIndex)
              // console.log("count", count)
              // console.log("selectedStreamFields", selectedStreamFields.length)
              // console.log(searchObj.data.stream.expandGroupRowsFieldCount[key])
              // console.log("========")
              selectedStreamFields.splice(
                startIndex - count,
                searchObj.data.stream.expandGroupRowsFieldCount[key],
              );
            }
          } else {
            count += searchObj.data.stream.expandGroupRowsFieldCount[key];
          }
          count++;
        }
        // console.log(JSON.parse(JSON.stringify(selectedStreamFields)))
        return selectedStreamFields;
      }),
      formatLargeNumber,
      sortedStreamFields,
      placeHolderText,
      cancelTraceId,
      cancelFilterCreator,
      selectedStream,
    };
  },
});
</script>

<style lang="scss">
$streamSelectorHeight: 44px;

.logs-index-menu {
  width: 100%;

  .q-menu {
    box-shadow: 0px 3px 15px rgba(0, 0, 0, 0.1);
    transform: translateY(0.5rem);
    border-radius: 0px;

    .q-virtual-scroll__content {
      padding: 0.5rem;
    }
  }

  .q-field {
    &__control {
      height: 35px;
      padding: 0px 5px;
      min-height: auto !important;

      &-container {
        padding-top: 0px !important;
      }
    }
  }

  .index-table {
    width: 100%;
    height: calc(100% - $streamSelectorHeight);
    // border: 1px solid rgba(0, 0, 0, 0.02);

    .q-table {
      display: table;
      table-layout: fixed !important;
    }

    tr {
      margin-bottom: 1px;
    }

    tbody,
    tr,
    td {
      width: 100%;
      display: block;
      height: fit-content;
      overflow: hidden;
    }

    .q-table__control,
    label.q-field {
      width: 100%;
    }

    .q-table thead tr,
    .q-table tbody td {
      height: auto;
    }

    .q-table__top {
      padding: 0 !important;
      border-bottom: unset;
    }
  }

  .field-table {
    width: 100%;

    > .q-table__bottom {
      padding: 0px !important;
    }
  }

  .field_list {
    padding: 0px;
    margin-bottom: 0.125rem;
    position: relative;
    overflow: visible;
    cursor: default;

    .field_label {
      pointer-events: none;
      font-size: 0.825rem;
      position: relative;
      display: inline;
      z-index: 2;
      left: 0;
      height: 20px;
      // text-transform: capitalize;
    }

    .field-container {
      height: 25px;
    }

    .field_overlay {
      position: absolute;
      height: 100%;
      right: 0;
      top: 0;
      z-index: 5;
      padding: 0 6px;
      visibility: hidden;
      display: flex;
      align-items: center;

      .q-icon {
        cursor: pointer;
        opacity: 0;
        margin: 0 1px;
      }
    }

    &.selected {
      .field_overlay {
        background-color: rgba(89, 96, 178, 0.3);

        .field_icons {
          opacity: 0;
        }
      }
    }

    &:hover {
      .field-container {
        // background-color: #ffffff;
      }
    }
  }

  &.theme-dark {
    .field_list {
      &:hover {
        box-shadow: 0px 4px 15px rgb(255, 255, 255, 0.1);

        .field_overlay {
          background-color: #3f4143;
          opacity: 1;
        }
      }
    }
  }

  &.theme-light {
    .field_list {
      &:hover {
        box-shadow: 0px 4px 15px rgba(0, 0, 0, 0.17);

        .field_overlay {
          background-color: #e8e8e8;
          opacity: 1;
        }
      }
    }
  }

  .q-item {
    min-height: 1.3rem;
    padding: 5px 10px;

    &__label {
      font-size: 0.75rem;
    }

    &.q-manual-focusable--focused > .q-focus-helper {
      background: currentColor !important;
      opacity: 0.3 !important;
    }
  }

  .q-field--dense .q-field__before,
  .q-field--dense .q-field__prepend {
    padding: 0px 0px 0px 0px;
    height: auto;
    line-height: auto;
  }

  .q-field__native,
  .q-field__input {
    padding: 0px 0px 0px 0px;
  }

  .q-field--dense .q-field__label {
    top: 5px;
  }

  .q-field--dense .q-field__control,
  .q-field--dense .q-field__marginal {
    height: 34px;
  }
}
</style>

<style scoped lang="scss">
// .q-field--auto-height.q-field--dense .q-field__control,
// .q-field--auto-height.q-field--dense .q-field__native,
// .q-field--auto-height.q-field--dense .q-field__native span {
//   text-overflow: ellipsis !important;
//   overflow: hidden !important;
//   white-space: nowrap !important;
//   max-height: 40px !important;
// }
</style>

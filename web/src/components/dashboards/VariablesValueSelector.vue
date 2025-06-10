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
  <div
    v-if="variablesData.values?.length > 0"
    :key="variablesData.isVariablesLoading"
    class="flex q-mt-xs q-ml-xs"
  >
    <div
      v-for="(item, index) in variablesData.values"
      :key="item.name + index"
      :data-test="`dashboard-variable-${item}-selector`"
    >
      <div v-if="item.type == 'query_values'">
        <VariableQueryValueSelector
          class="q-mr-lg q-mt-xs"
          v-show="!item.hideOnDashboard"
          v-model="item.value"
          :variableItem="item"
          @update:model-value="onVariablesValueUpdated(index)"
          :loadOptions="loadVariableOptions"
        />
      </div>
      <div v-else-if="item.type == 'constant'">
        <q-input
          v-show="!item.hideOnDashboard"
          class="q-mr-lg q-mt-xs"
          style="max-width: 150px !important"
          v-model="item.value"
          :label="item.label || item.name"
          dense
          outlined
          readonly
          data-test="dashboard-variable-constant-selector"
          @update:model-value="onVariablesValueUpdated(index)"
        ></q-input>
      </div>
      <div v-else-if="item.type == 'textbox'">
        <q-input
          v-show="!item.hideOnDashboard"
          class="q-mr-lg q-mt-xs"
          style="max-width: 150px !important"
          debounce="1000"
          v-model="item.value"
          :label="item.label || item.name"
          dense
          outlined
          data-test="dashboard-variable-textbox-selector"
          @update:model-value="onVariablesValueUpdated(index)"
        ></q-input>
      </div>
      <div v-else-if="item.type == 'custom'">
        <VariableCustomValueSelector
          v-show="!item.hideOnDashboard"
          class="q-mr-lg q-mt-xs"
          v-model="item.value"
          :variableItem="item"
          @update:model-value="onVariablesValueUpdated(index)"
        />
      </div>
      <div v-else-if="item.type == 'dynamic_filters'">
        <VariableAdHocValueSelector
          class="q-mr-lg q-mt-xs"
          v-model="item.value"
          :variableItem="item"
        />
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { getCurrentInstance, onMounted, ref, watch } from "vue";
import { defineComponent, reactive } from "vue";
import streamService from "../../services/stream";
import { useStore } from "vuex";
import VariableQueryValueSelector from "./settings/VariableQueryValueSelector.vue";
import VariableCustomValueSelector from "./settings/VariableCustomValueSelector.vue";
import VariableAdHocValueSelector from "./settings/VariableAdHocValueSelector.vue";
import { isInvalidDate } from "@/utils/date";
import { addLabelsToSQlQuery } from "@/utils/query/sqlUtils";
import {
  b64EncodeUnicode,
  escapeSingleQuotes,
  generateTraceContext,
  isStreamingEnabled,
  isWebSocketEnabled,
} from "@/utils/zincutils";
import { buildVariablesDependencyGraph } from "@/utils/dashboard/variables/variablesDependencyUtils";
import useSearchWebSocket from "@/composables/useSearchWebSocket";
import useHttpStreaming from "@/composables/useStreamingSearch";
import { SELECT_ALL_VALUE } from "@/utils/dashboard/constants";

export default defineComponent({
  name: "VariablesValueSelector",
  props: [
    "selectedTimeDate",
    "variablesConfig",
    "initialVariableValues",
    "showDynamicFilters",
  ],
  emits: ["variablesData"],
  components: {
    VariableQueryValueSelector,
    VariableAdHocValueSelector,
    VariableCustomValueSelector,
  },
  setup(props: any, { emit }) {
    const instance = getCurrentInstance();
    const store = useStore();

    // variables data derived from the variables config list
    const variablesData: any = reactive({
      isVariablesLoading: false,
      values: [],
    });

    // variables dependency graph
    let variablesDependencyGraph: any = {};

    // track old variables data
    const oldVariablesData: any = {};

    // currently executing promise
    const currentlyExecutingPromises: any = {};

    // Flag to track initial load
    const isInitialLoad = ref(true);

    const { fetchQueryDataWithHttpStream } = useHttpStreaming();

    const traceIdMapper = ref<{ [key: string]: string[] }>({});
    const variableFirstResponseProcessed = ref<{ [key: string]: boolean }>({});

    // ------------- Start WebSocket Implementation -------------
    const {
      fetchQueryDataWithWebSocket,
      sendSearchMessageBasedOnRequestId,
      cancelSearchQueryBasedOnRequestId,
    } = useSearchWebSocket();

    // Utility functions
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

    const cancelTraceId = (field: string) => {
      const traceIds = traceIdMapper.value[field];
      if (traceIds && traceIds.length > 0) {
        traceIds.forEach((traceId) => {
          cancelSearchQueryBasedOnRequestId({
            trace_id: traceId,
            org_id: store?.state?.selectedOrganization?.identifier,
          });
        });
        // Clear the trace IDs after cancellation
        traceIdMapper.value[field] = [];
      }
    };

    const sendSearchMessage = (queryReq: any) => {
      const payload = {
        type: "values",
        content: {
          trace_id: queryReq.traceId,
          payload: queryReq.queryReq,
          stream_type: queryReq.queryReq.stream_type || "logs",
          search_type: "ui",
          use_cache: (window as any).use_cache ?? true,
          org_id: store.state.selectedOrganization.identifier,
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

    const handleSearchClose = (
      payload: any,
      response: any,
      variableObject: any,
    ) => {
      variableObject.isLoading = false;
      variableObject.isVariableLoadingPending = false;

      const errorCodes = [1001, 1006, 1010, 1011, 1012, 1013];
      if (errorCodes.includes(response.code)) {
        handleSearchError(
          payload,
          {
            content: {
              message: "WebSocket connection terminated unexpectedly",
              trace_id: payload.traceId,
              code: response.code,
              error_details: response.error_details,
            },
            type: "error",
          },
          variableObject,
        );
      }

      removeTraceId(variableObject.name, payload.traceId);
    };

    const handleSearchError = (request: any, err: any, variableObject: any) => {
      variableObject.isLoading = false;
      variableObject.isVariableLoadingPending = false;
      resetVariableState(variableObject);
      removeTraceId(variableObject.name, request.traceId);
    };

    const handleSearchReset = (data: any) => {
      console.log("[WebSocket] Received reset:", data);

      const variableObject = variablesData.values.find(
        (v: any) => v.query_data?.field === data.queryReq?.fields[0],
      );

      if (variableObject) {
        variableObject.isLoading = true;
        variableFirstResponseProcessed.value[variableObject.name] = false;

        fetchFieldValuesWithWebsocket(
          variableObject,
          data.queryReq.query_context,
        );
      }
    };

    const handleSearchResponse = (
      payload: any,
      response: any,
      variableObject: any,
    ) => {
      console.log(`[Http Streaming] Received response:`, {
        payload,
        response,
      });

      if (!variableObject) {
        console.error("Variable object is undefined");
        return;
      }

      console.log(`[WebSocket] Received response for ${variableObject.name}:`, {
        responseType: response.type,
        hasResults: !!response.content?.results?.hits?.length,
        currentValue: variableObject.value,
        isLoading: variableObject.isLoading,
        isVariableLoadingPending: variableObject.isVariableLoadingPending,
      });

      if (response.type === "cancel_response") {
        removeTraceId(variableObject.name, response.content.trace_id);
        return;
      }

      // Handle completion
      if (
        (response.type === "event_progress" &&
          response.content.percent === 100) ||
        response.type === "end"
      ) {
        variableObject.isLoading = false;
        variableObject.isVariableLoadingPending = false;
        emitVariablesData();
        return;
      }
      try {
        if (
          response.content?.results?.hits?.length &&
          (response.type === "search_response" ||
            response.type === "search_response_hits")
        ) {
          const hits = response.content.results.hits;
          console.log(
            `[Http Streaming] Hits for ${variableObject.name}:`,
            hits,
          );

          const fieldHit = hits.find(
            (field: any) => field.field === variableObject.query_data.field,
          );

          if (fieldHit) {
            const originalValue = JSON.parse(
              JSON.stringify(variableObject.value),
            );
            // Check if this is the first response for this variable
            const isFirstResponse =
              !variableFirstResponseProcessed.value[variableObject.name];

            if (isFirstResponse) {
              // Initialize options array if it doesn't exist
              if (!Array.isArray(variableObject.options)) {
                variableObject.options = [];
              }

              // Process the first response
              const newOptions = fieldHit.values
                .filter((value: any) => value.zo_sql_key !== undefined)
                .map((value: any) => ({
                  label:
                    value.zo_sql_key !== ""
                      ? value.zo_sql_key.toString()
                      : "<blank>",
                  value: value.zo_sql_key.toString(),
                }));

              variableObject.options = newOptions;
              variableObject.options.sort((a: any, b: any) =>
                a.label.localeCompare(b.label),
              );

              // Update options and handle first response
              if (oldVariablesData[variableObject.name] !== undefined) {
                const oldValues = Array.isArray(
                  oldVariablesData[variableObject.name],
                )
                  ? oldVariablesData[variableObject.name]
                  : [oldVariablesData[variableObject.name]];

                if (variableObject.type === "custom") {
                  handleCustomVariablesLogic(variableObject, oldValues);
                } else {
                  handleQueryValuesLogic(variableObject, oldValues);
                }
              } else {
                variableObject.value = variableObject.options.length
                  ? variableObject.options[0].value
                  : null;
              }

              variableFirstResponseProcessed.value[variableObject.name] = true;
              variableObject.isVariableLoadingPending = false;

              // Check if value actually changed before loading child variables
              const hasValueChanged =
                Array.isArray(originalValue) &&
                Array.isArray(variableObject.value)
                  ? JSON.stringify(originalValue) !==
                    JSON.stringify(variableObject.value)
                  : originalValue !== variableObject.value;

              console.log(
                `[WebSocket] First response value change check for ${variableObject.name}:`,
                {
                  originalValue,
                  newValue: variableObject.value,
                  hasValueChanged,
                },
              );

              // Only load child variables if value actually changed
              if (hasValueChanged) {
                const childVariables =
                  variablesDependencyGraph[variableObject.name]
                    ?.childVariables || [];
                if (childVariables.length > 0) {
                  console.log(
                    `[WebSocket] Loading child variables for ${variableObject.name} due to value change`,
                  );
                  const childVariableObjects = variablesData.values.filter(
                    (variable: any) => childVariables.includes(variable.name),
                  );
                  childVariableObjects.forEach((childVariable: any) => {
                    loadSingleVariableDataByName(childVariable);
                  });
                }
              } else {
                console.log(
                  `[WebSocket] Skipping child variable load for ${variableObject.name} - value unchanged`,
                );
              }
            } else {
              // For subsequent responses, we'll accumulate values but not trigger UI updates
              const existingValuesSet = new Set(
                variableObject.options.map((opt: any) => opt.value),
              );

              // Accumulate new values that don't exist yet
              const newOptions = fieldHit.values
                .filter((value: any) => value.zo_sql_key !== undefined)
                .map((value: any) => ({
                  label:
                    value.zo_sql_key !== ""
                      ? value.zo_sql_key.toString()
                      : "<blank>",
                  value: value.zo_sql_key.toString(),
                }))
                .filter((opt: any) => !existingValuesSet.has(opt.value));

              // Add new options to the existing array
              variableObject.options.push(...newOptions);
              variableObject.options.sort((a: any, b: any) =>
                a.label.localeCompare(b.label),
              );

              // Check if the variable's selected value has changed significantly
              const hasValueChanged =
                Array.isArray(originalValue) &&
                Array.isArray(variableObject.value)
                  ? JSON.stringify(originalValue) !==
                    JSON.stringify(variableObject.value)
                  : originalValue !== variableObject.value;

              console.log(
                `[WebSocket] Subsequent response value change check for ${variableObject.name}:`,
                {
                  originalValue,
                  newValue: variableObject.value,
                  hasValueChanged,
                },
              );

              // Only load child variables if value actually changed
              if (hasValueChanged) {
                const childVariables =
                  variablesDependencyGraph[variableObject.name]
                    ?.childVariables || [];
                if (childVariables.length > 0) {
                  console.log(
                    `[WebSocket] Loading child variables for ${variableObject.name} due to value change`,
                  );
                  const childVariableObjects = variablesData.values.filter(
                    (variable: any) => childVariables.includes(variable.name),
                  );
                  childVariableObjects.forEach((childVariable: any) => {
                    loadSingleVariableDataByName(childVariable);
                  });
                }
              } else {
                console.log(
                  `[WebSocket] Skipping child variable load for ${variableObject.name} - value unchanged`,
                );
              }
            }
          }
        }
      } catch (error) {
        console.error(
          `[WebSocket] Error processing response for ${variableObject.name}:`,
          error,
        );
        resetVariableState(variableObject);
        variableObject.isLoading = false;
        variableObject.isVariableLoadingPending = false;
      }

      // Only emit data updates, don't modify loading states here
      emitVariablesData();
    };

    const initializeWebSocketConnection = (
      payload: any,
      variableObject: any,
    ): any => {
      if (isStreamingEnabled(store.state)) {
        console.log(
          `[HTTP Streaming] Starting fetch for ${variableObject.name}:`,
          {
            isLoading: variableObject.isLoading,
            isVariableLoadingPending: variableObject.isVariableLoadingPending,
            currentValue: variableObject.value,
            options: variableObject.options,
          },
        );

        fetchQueryDataWithHttpStream(payload, {
          data: (p: any, r: any) => handleSearchResponse(p, r, variableObject),
          error: (p: any, r: any) => handleSearchError(p, r, variableObject),
          complete: (p: any, r: any) => handleSearchClose(p, r, variableObject),
          reset: handleSearchReset,
        });
        return;
      }

      if (isWebSocketEnabled(store.state)) {
        fetchQueryDataWithWebSocket(payload, {
          open: sendSearchMessage,
          close: (p: any, r: any) => handleSearchClose(p, r, variableObject),
          error: (p: any, r: any) => handleSearchError(p, r, variableObject),
          message: (p: any, r: any) =>
            handleSearchResponse(p, r, variableObject),
          reset: handleSearchReset,
        }) as string;
        return;
      }
    };
    const fetchFieldValuesWithWebsocket = (
      variableObject: any,
      queryContext: string,
    ) => {
      if (!variableObject?.query_data?.field) {
        console.error("Invalid variable object or missing field");
        return;
      }

      const startTime = props.selectedTimeDate?.start_time?.getTime();
      const endTime = props.selectedTimeDate?.end_time?.getTime();

      if (!startTime || !endTime) {
        console.error("Invalid time range");
        return;
      }
      // Set loading state before initiating WebSocket
      variableObject.isLoading = true;
      variableObject.isVariableLoadingPending = true;
      console.log(`[WebSocket] Starting fetch for ${variableObject.name}:`, {
        isLoading: variableObject.isLoading,
        isVariableLoadingPending: variableObject.isVariableLoadingPending,
        currentValue: variableObject.value,
        options: variableObject.options,
      });

      // Reset first response flag when starting a new fetch
      variableFirstResponseProcessed.value[variableObject.name] = false;

      const payload = {
        fields: [variableObject.query_data.field],
        size: variableObject.query_data.max_record_size || 10,
        no_count: true,
        start_time: startTime,
        end_time: endTime,
        stream_name: variableObject.query_data.stream,
        stream_type: variableObject.query_data.stream_type || "logs",
        use_cache: (window as any).use_cache ?? true,
        sql: queryContext || "",
      };

      const wsPayload = {
        queryReq: payload,
        type: "values",
        isPagination: false,
        traceId: generateTraceContext().traceId,
        org_id: store.state.selectedOrganization.identifier,
        meta: payload,
      };
      console.log("wsPayload", wsPayload);
      try {
        // Start new connection
        initializeWebSocketConnection(wsPayload, variableObject);
        addTraceId(variableObject.name, wsPayload.traceId);
      } catch (error) {
        console.error("WebSocket connection failed:", error);
        variableObject.isLoading = false;
        variableObject.isVariableLoadingPending = false;
        console.log(
          `[WebSocket] Failed to connect for ${variableObject.name}:`,
          {
            isLoading: variableObject.isLoading,
            isVariableLoadingPending: variableObject.isVariableLoadingPending,
          },
        );
      }
    };

    // ------------- End WebSocket Implementation -------------

    // reset variables data
    // it will executed once on mount
    const resetVariablesData = () => {
      variablesData.isVariablesLoading = false;
      variablesData.values = [];
    };

    const initializeVariablesData = () => {
      // reset the values
      resetVariablesData();

      // check if variables config list is not empty
      if (!props?.variablesConfig) {
        return;
      }

      // make list of variables using variables config list
      // set initial variables values from props
      props?.variablesConfig?.list?.forEach((item: any) => {
        let initialValue =
          item.type == "dynamic_filters"
            ? (JSON.parse(
                decodeURIComponent(
                  // if initial value is not exist, use the default value : %5B%5D(which is [] in base64)
                  props.initialVariableValues?.value[item.name] ?? "%5B%5D",
                ),
              ) ?? [])
            : (props.initialVariableValues?.value[item.name] ?? null);

        // Handle multiSelect initialization
        if (item.multiSelect) {
          // If initialValue is not an array, convert it to array
          initialValue =
            initialValue !== null && initialValue !== undefined
              ? Array.isArray(initialValue)
                ? initialValue
                : [initialValue]
              : [];
        }

        const variableData = {
          ...item,
          // isLoading is used to check that currently, if the variable is loading(it is used to show the loading icon)
          isLoading: false,
          // isVariableLoadingPending is used to check that variable loading is pending
          // if parent variable is not loaded or it's value is changed, isVariableLoadingPending will be true
          isVariableLoadingPending: true,
        };

        // Set custom values immediately if they exist and no URL value is present
        if (
          item.type === "query_values" &&
          item.selectAllValueForMultiSelect === "custom" &&
          item.customMultiSelectValue?.length > 0 &&
          !initialValue // Only set custom value if no URL value exists
        ) {
          console.log(
            `Setting custom multi-select value for--------------- ${item.name}:`,
            {
              customValue: item.customMultiSelectValue,
            },
          );

          variableData.value = item.multiSelect
            ? item.customMultiSelectValue
            : item.customMultiSelectValue[0];
        } else if (item.type != "constant") {
          // for textbox type variable, if initial value is not exist, use the default value
          if (item.type == "textbox") {
            variableData.value = initialValue ?? variableData.value;
          } else {
            // use the initial value
            variableData.value = initialValue;
          }
        }

        // push the variable to the list
        variablesData.values.push(variableData);

        // set old variables data
        oldVariablesData[item.name] = initialValue;
      });

      // if showDynamicFilters is true, add the Dynamic filters variable
      if (props.showDynamicFilters) {
        // get the initial value
        // need to decode the initial value from base64
        const initialValue =
          JSON.parse(
            decodeURIComponent(
              // if initial value is not exist, use the default value : %5B%5D(which is [] in base64)
              props.initialVariableValues?.value["Dynamic filters"] ?? "%5B%5D",
            ),
          ) ?? [];

        // push the variable to the list
        variablesData.values.push({
          name: "Dynamic filters",
          type: "dynamic_filters",
          label: "Dynamic filters",
          value: initialValue,
          isLoading: false,
          isVariableLoadingPending: true,
          options: [],
        });

        // set old variables data
        oldVariablesData["Dynamic filters"] = initialValue;
      }

      // need to build variables dependency graph on variables config list change
      variablesDependencyGraph = buildVariablesDependencyGraph(
        variablesData.values,
      );
    };

    const rejectAllPromises = () => {
      Object.keys(currentlyExecutingPromises).forEach((key) => {
        if (currentlyExecutingPromises[key])
          currentlyExecutingPromises[key](false);
      });
    };

    onMounted(() => {
      // make list of variables using variables config list
      initializeVariablesData();

      // reject all promises
      rejectAllPromises();

      // load all variables
      loadAllVariablesData(true);

      // Set initial load flag to false after first load
      isInitialLoad.value = false;
    });

    watch(
      () => props.variablesConfig,
      async () => {
        // Reset initial load flag when config changes
        isInitialLoad.value = true;

        // make list of variables using variables config list
        initializeVariablesData();

        // reject all promises
        rejectAllPromises();
        skipAPILoad.value = false;
        // load all variables
        loadAllVariablesData(true);

        // Set initial load flag to false after load
        isInitialLoad.value = false;
      },
    );

    // you may need to query the data if the variable configs or the data/time changes
    watch(
      () => props.selectedTimeDate,
      () => {
        // reject all promises
        rejectAllPromises();

        loadAllVariablesData(false);
        skipAPILoad.value = true;
      },
    );
    watch(
      () =>
        JSON.stringify({
          values: variablesData.values.map((v: any) => ({
            name: v.name,
            value: v.value,
            type: v.type,
            isLoading: v.isLoading,
            isVariableLoadingPending: v.isVariableLoadingPending,
          })),
        }),
      () => {
        emitVariablesData();
      },
    );

    const emitVariablesData = () => {
      emit("variablesData", {
        isVariablesLoading: variablesData.isVariablesLoading,
        values: variablesData.values.map((v: any) => ({
          ...v,
          options: undefined, // Don't emit options to prevent unnecessary updates
        })),
      });
    };

    // it is used to change/update initial variables values from outside the component
    // NOTE: right now, it is not used after variables in variables feature
    const changeInitialVariableValues = async (
      newInitialVariableValues: any,
    ) => {
      // reject all promises
      rejectAllPromises();

      // NOTE: need to re-initialize variables data
      resetVariablesData();

      // set initial variables values
      props.initialVariableValues.value = newInitialVariableValues;

      // make list of variables using variables config list
      initializeVariablesData();

      // load all variables
      await loadAllVariablesData(true);
    };

    /**
     * Handle query values logic
     * @param {object} currentVariable - current variable
     * @param {array} oldVariableSelectedValues - old selected values of the variable
     * @returns {void}
     */
    const handleQueryValuesLogic = (
      currentVariable: any,
      oldVariableSelectedValues: any[],
    ) => {
      console.log("oldVariableSelectedValues", oldVariableSelectedValues);
      console.log("currentVariable", currentVariable);

      // For multiSelect, preserve existing values even if they're not in current options
      if (currentVariable.multiSelect) {
        // If we have existing values and they're not empty, keep them
        if (
          Array.isArray(currentVariable.value) &&
          currentVariable.value.length > 0
        ) {
          // Don't add missing values to options, just keep the existing values
          return;
        }
        const optionsValues =
          currentVariable.options.map((option: any) => option.value) ?? [];
        // If we have no values, handle default selection
        switch (currentVariable?.selectAllValueForMultiSelect) {
          case "custom":
            if (currentVariable?.customMultiSelectValue?.length > 0) {
              currentVariable.value = currentVariable.customMultiSelectValue;
            } else {
              currentVariable.value = [];
            }
            break;
          case "all":
            currentVariable.value = SELECT_ALL_VALUE;
            break;
          default:
            // Default to first option if nothing else is set
            currentVariable.value =
              optionsValues.length > 0 ? [optionsValues[0]] : [];
        }
        return;
      } else {
        // For single select, we need to ensure the value is valid
        if (
          currentVariable.value !== null &&
          currentVariable.value !== undefined
        ) {
          console.log(
            "[Debug] SingleSelect variable already has a valid value, skipping recalculation",
            currentVariable.value,
          );
          return;
        }
      }

      // Check if this is a child variable
      const isChildVariable =
        variablesDependencyGraph[currentVariable.name]?.parentVariables
          ?.length > 0;

      // Check for URL values first
      const urlValue = props.initialVariableValues?.value[currentVariable.name];
      if (urlValue) {
        // If URL value exists, use it
        if (currentVariable.multiSelect) {
          currentVariable.value = Array.isArray(urlValue)
            ? urlValue
            : [urlValue];
        } else {
          // For single select, if coming from multiSelect, take first value
          currentVariable.value = Array.isArray(urlValue)
            ? urlValue[0]
            : urlValue;
        }
        currentVariable.isVariableLoadingPending = true;
        return;
      }

      // Only apply custom values if no URL value exists
      if (
        !isChildVariable &&
        currentVariable?.selectAllValueForMultiSelect === "custom" &&
        currentVariable?.customMultiSelectValue?.length > 0
      ) {
        console.log(
          "[Debug] Using custom values for variable--------------",
          currentVariable,
        );

        currentVariable.value = currentVariable.multiSelect
          ? currentVariable.customMultiSelectValue
          : currentVariable.customMultiSelectValue[0];
        currentVariable.isVariableLoadingPending = true;
        return;
      }

      // Pre-calculate the options values array
      const optionsValues =
        currentVariable.options.map((option: any) => option.value) ?? [];

      // For single select, handle old value selection
      if (!currentVariable.multiSelect) {
        // old selected value
        const oldValue = currentVariable.options.find(
          (option: any) => option.value === oldVariableSelectedValues[0],
        )?.value;

        // if old value exist, select the old value
        if (oldValue) {
          currentVariable.value = oldValue;
        } else if (currentVariable.options.length > 0) {
          // here, multi select is false and old value not exist
          if (currentVariable.selectAllValueForMultiSelect === "custom") {
            console.log(
              "[Debug] Using custom value for single select variable--------------",
              currentVariable,
            );

            const customValue = currentVariable.options.find(
              (variableOption: any) =>
                variableOption.value ===
                currentVariable.customMultiSelectValue?.[0],
            );

            // customValue can be undefined or default value
            currentVariable.value =
              customValue?.value ?? currentVariable.options[0].value;
          } else {
            currentVariable.value = currentVariable.options[0].value;
          }
        } else {
          currentVariable.value = null;
        }
      }
    };

    /**
     * Handle custom variables logic
     * @param {object} currentVariable - current variable
     * @param {array} oldVariableSelectedValues - old selected values of the variable
     * @returns {void}
     */
    const handleCustomVariablesLogic = (
      currentVariable: any,
      oldVariableSelectedValues: any[],
    ) => {
      // Pre-calculate the selected options values array
      const selectedOptionsValues =
        currentVariable.options
          .filter((option: any) => option.selected)
          .map((option: any) => option.value) ?? [];

      // if multi select
      if (currentVariable.multiSelect) {
        // Keep old selected values even if not in current options
        const selectedValues = oldVariableSelectedValues.filter((value) => {
          return value !== undefined && value !== null;
        });

        // if old selected values exist, select the values
        if (selectedValues.length > 0) {
          currentVariable.value = selectedValues;
        } else {
          // here, multiselect and old values will be not exist
          switch (currentVariable?.selectAllValueForMultiSelect) {
            case "custom":
              // Use custom values if available
              if (currentVariable?.customMultiSelectValue?.length > 0) {
                currentVariable.value = currentVariable.customMultiSelectValue;
              } else {
                currentVariable.value =
                  currentVariable.options.length > 0
                    ? [currentVariable.options[0].value]
                    : [];
              }
              break;
            case "all":
              // Select all available options
              currentVariable.value = currentVariable.options.map(
                (option: any) => option.value,
              );
              break;
            default:
              // Default to first option
              currentVariable.value =
                currentVariable.options.length > 0
                  ? [currentVariable.options[0].value]
                  : [];
          }
        }
      } else {
        // here, multi select is false
        // Keep old value if it exists, regardless of whether it's in current options
        if (
          oldVariableSelectedValues[0] !== undefined &&
          oldVariableSelectedValues[0] !== null
        ) {
          currentVariable.value = oldVariableSelectedValues[0];
        } else if (currentVariable.options.length > 0) {
          // here, multi select is false and old value not exist
          currentVariable.value =
            selectedOptionsValues.length > 0
              ? selectedOptionsValues[0]
              : currentVariable.options[0].value;
        } else {
          currentVariable.value = null;
        }
      }
    };

    /**
     * Check if any of the dependent variables are loading
     * @param {object} variableObject - the variable object
     * @returns {boolean} - true if any of the dependent variables are loading, false otherwise
     */
    const isDependentVariableLoading = (variableObject: any) => {
      const parentVariables =
        variablesDependencyGraph[variableObject.name]?.parentVariables || [];

      // If no parent variables, dependencies can't be loading
      if (parentVariables.length === 0) return false;

      // Check if any of the parent variables are loading or pending
      return parentVariables.some((parentName: string) => {
        const parentVariable = variablesData.values.find(
          (v: any) => v.name === parentName,
        );
        return (
          parentVariable?.isLoading || parentVariable?.isVariableLoadingPending
        );
      });
    };

    /**
     * Resets the state of the given variable.
     * @param {object} variableObject - The variable object to reset.
     */
    const resetVariableState = (variableObject: any) => {
      // Reset the value of the variable to either an empty array if multiSelect is true, or null if not.
      variableObject.value = variableObject.multiSelect ? [] : null;
      // Reset the options of the variable to an empty array.
      variableObject.options = [];
    };

    /**
     * Processes a custom variable by updating its options and handling logic based on its type.
     * @param {object} variableObject - The variable object to process.
     */
    const handleCustomVariable = (variableObject: any) => {
      // Ensure options is an array, default to an empty array if undefined
      variableObject.options = variableObject?.options || [];

      // Retrieve previously stored values for the variable, making sure they are in array form
      const oldValues = oldVariablesData[variableObject.name]
        ? Array.isArray(oldVariablesData[variableObject.name])
          ? oldVariablesData[variableObject.name]
          : [oldVariablesData[variableObject.name]]
        : [];

      // Execute logic specific to the type of variable
      if (variableObject.type === "custom") {
        // Handle logic for custom type variables
        handleCustomVariablesLogic(variableObject, oldValues);
      } else {
        // Handle logic for query value type variables
        handleQueryValuesLogic(variableObject, oldValues);
      }
    };

    /**
     * Loads the data for a single variable by name.
     * If the variable has dependencies, it will only load if all dependencies are loaded.
     * If the variable is already being loaded, it will cancel the previous promise and return the new one.
     * @param {object} variableObject - The variable object to load
     * @returns {Promise<boolean>} - true if the variable was loaded successfully, false if it was not
     */
    const loadSingleVariableDataByName = async (variableObject: any) => {
      console.log(
        `[WebSocket] Loading variable data for ${variableObject.name}:`,
        variableObject,
      );
      console.log(
        `[WebSocket] Currently executing promises:`,
        currentlyExecutingPromises,
      );

      return new Promise(async (resolve, reject) => {
        const { name } = variableObject;

        if (!name || !variableObject) {
          console.error("Invalid variable object", variableObject);
          resolve(false);
          return;
        }

        // If the variable is already being processed, cancel the previous request
        if (currentlyExecutingPromises[name]) {
          currentlyExecutingPromises[name](false);
        }
        currentlyExecutingPromises[name] = reject;

        // Check if this variable has any dependencies
        const hasParentVariables =
          variablesDependencyGraph[name]?.parentVariables?.length > 0; // Check dates for all query_values type
        if (variableObject.type === "query_values") {
          if (
            isInvalidDate(props.selectedTimeDate?.start_time) ||
            isInvalidDate(props.selectedTimeDate?.end_time)
          ) {
            console.error("Invalid date range");
            variableObject.isLoading = false;
            variableObject.isVariableLoadingPending = false;
            resolve(false);
            return;
          }
        }

        // For variables with dependencies, check if they are ready
        if (hasParentVariables) {
          const parentVariables =
            variablesDependencyGraph[name].parentVariables;
          const areParentsReady = parentVariables.every(
            (parentName: string) => {
              const parentVariable = variablesData.values.find(
                (v: any) => v.name === parentName,
              );
              const isReady =
                parentVariable &&
                !parentVariable.isLoading &&
                !parentVariable.isVariableLoadingPending &&
                parentVariable.value !== null &&
                parentVariable.value !== undefined &&
                (!Array.isArray(parentVariable.value) ||
                  parentVariable.value.length > 0);

              if (!isReady && parentVariable) {
                // Reset this variable since parent is not ready
                resetVariableState(variableObject);
                variableObject.isVariableLoadingPending = true;
                variableObject.isLoading = false;
              }
              return isReady;
            },
          );

          if (!areParentsReady) {
            console.log(`Parents not ready for ${name}, marking as pending`);
            // Just update loading states but don't reset value if already set
            variableObject.isLoading = false;
            variableObject.isVariableLoadingPending = true;
            resolve(false);
            return;
          }
        }

        // Set loading state
        variableObject.isLoading = true;
        emitVariablesData();

        try {
          const success = await handleVariableType(variableObject);
          await finalizeVariableLoading(variableObject, success);
          resolve(success);
        } catch (error) {
          console.error(`Error loading variable ${name}:`, error);
          await finalizeVariableLoading(variableObject, false);
          resolve(false);
        }
      });
    };

    /**
     * Handles the logic for a single variable based on its type.
     * @param {object} variableObject - The variable object to handle
     * @returns {Promise<boolean>} - true if the variable was handled successfully, false if it was not
     */
    const handleVariableType = async (variableObject: any) => {
      console.log(
        `[WebSocket] handleVariableType: starting handle for ${variableObject.name}`,
      );
      switch (variableObject.type) {
        case "query_values": {
          console.log(
            `[WebSocket] handleVariableType: building query context for ${variableObject.name}`,
          );

          // Check if this is a child variable
          const isChildVariable =
            variablesDependencyGraph[variableObject.name]?.parentVariables
              ?.length > 0;

          // Only apply custom values during initial load and if variable is not pending and no URL value exists
          if (
            variableObject?.selectAllValueForMultiSelect === "custom" &&
            variableObject?.customMultiSelectValue?.length > 0 &&
            !oldVariablesData[variableObject.name] && // Only set during initial load
            !props.initialVariableValues?.value[variableObject.name] // Don't set if URL value exists
          ) {
            // Set the custom values before making the API call
            variableObject.value = variableObject.multiSelect
              ? variableObject.customMultiSelectValue
              : variableObject.customMultiSelectValue[0];
            console.log(
              `[WebSocket] handleVariableType: set custom values for -------------- ${variableObject.name}`,
            );
            // Emit the updated values immediately
            emitVariablesData();
            return true;
          }

          try {
            const queryContext: any = await buildQueryContext(variableObject);
            console.log(
              `[WebSocket] handleVariableType: built query context for ${variableObject.name}`,
            );

            if (
              isWebSocketEnabled(store.state) ||
              isStreamingEnabled(store.state)
            ) {
              // For WebSocket, we don't need to wait for the response here
              // as it will be handled by the WebSocket handlers
              fetchFieldValuesWithWebsocket(variableObject, queryContext);
              return true;
            } else {
              // For REST API, we handle the response directly
              const response = await fetchFieldValuesREST(
                variableObject,
                queryContext,
              );
              console.log(
                `[WebSocket] handleVariableType: fetched field values for ${variableObject.name}`,
                response,
              );
              if (response?.data?.hits) {
                updateVariableOptions(variableObject, response.data.hits);
                console.log(
                  `[WebSocket] handleVariableType: finished handling ${variableObject.name}`,
                );
                return true;
              }
            }
            return false;
          } catch (error) {
            console.log(
              `[WebSocket] handleVariableType: error fetching field values for ${variableObject.name}`,
              error,
            );
            resetVariableState(variableObject);
            return false;
          }
        }
        case "custom": {
          console.log(
            `[WebSocket] handleVariableType: handling custom variable ${variableObject.name}`,
          );
          handleCustomVariable(variableObject);
          console.log(
            `[WebSocket] handleVariableType: finished handling custom variable ${variableObject.name}`,
          );
          return true;
        }
        case "constant":
        case "textbox":
        case "dynamic_filters": {
          console.log(
            `[WebSocket] handleVariableType: finished handling ${variableObject.name}`,
          );
          return true;
        }
        default: {
          console.log(
            `[WebSocket] handleVariableType: finished handling ${variableObject.name}`,
          );
          return false;
        }
      }
    };

    /**
     * Builds the query context for the given variable object.
     * @param variableObject The variable object containing the query data.
     * @returns The query context as a string.
     */
    const buildQueryContext = async (variableObject: any) => {
      const timestamp_column =
        store.state.zoConfig.timestamp_column || "_timestamp";
      let dummyQuery = `SELECT ${timestamp_column} FROM '${variableObject.query_data.stream}'`;

      // Construct the filter from the query data
      const constructedFilter = (variableObject.query_data.filter || []).map(
        (condition: any) => ({
          name: condition.name,
          operator: condition.operator,
          value: condition.value,
        }),
      );

      // Add labels to the dummy query
      let queryContext = await addLabelsToSQlQuery(
        dummyQuery,
        constructedFilter,
      );

      // Replace variable placeholders with actual values
      for (const variable of variablesData.values) {
        if (!variable.isLoading && !variable.isVariableLoadingPending) {
          // Replace array values
          if (Array.isArray(variable.value)) {
            const arrayValues = variable.value
              .map((value: any) => `'${escapeSingleQuotes(value)}'`)
              .join(", ");
            queryContext = queryContext.replace(
              `'$${variable.name}'`,
              arrayValues,
            );
          } else if (variable.value !== null && variable.value !== undefined) {
            // Replace single values
            queryContext = queryContext.replace(
              `$${variable.name}`,
              escapeSingleQuotes(variable.value),
            );
          }
        }
      }

      // Base64 encode the query context
      return b64EncodeUnicode(queryContext);
    };

    /**
     * Extract REST API implementation to separate function.
     * @param variableObject - The variable object containing query data.
     * @param queryContext - The context for the query as a string.
     * @returns The response from the stream service containing field values.
     */
    const fetchFieldValuesREST = async (
      variableObject: any,
      queryContext: string,
    ) => {
      const payload = {
        org_identifier: store.state.selectedOrganization.identifier, // Organization identifier
        stream_name: variableObject.query_data.stream, // Name of the stream
        start_time: new Date(
          props.selectedTimeDate?.start_time?.toISOString(),
        ).getTime(), // Start time in milliseconds
        end_time: new Date(
          props.selectedTimeDate?.end_time?.toISOString(),
        ).getTime(), // End time in milliseconds
        fields: [variableObject.query_data.field], // Fields to fetch
        size: variableObject.query_data.max_record_size || 10, // Maximum number of records
        type: variableObject.query_data.stream_type, // Type of the stream
        query_context: queryContext, // Encoded query context
        no_count: true, // Flag to omit count
      };

      // Fetch field values from the stream service
      return await streamService.fieldValues(payload);
    };

    /**
     * Updates the options for a variable based on the result of a query to fetch field values.
     * @param variableObject - The variable object containing query data.
     * @param hits - The result from the stream service containing field values.
     */
    const updateVariableOptions = (variableObject: any, hits: any[]) => {
      console.log("hits", hits);

      const fieldHit = hits.find(
        (field: any) => field.field === variableObject.query_data.field,
      );

      if (fieldHit) {
        // Extract the values for the specified field from the result
        const newOptions = fieldHit.values
          .filter((value: any) => value.zo_sql_key || value.zo_sql_key === "")
          .map((value: any) => ({
            // Use the zo_sql_key as the label if it is not empty, otherwise use "<blank>"
            label:
              value.zo_sql_key !== "" ? value.zo_sql_key.toString() : "<blank>",
            // Use the zo_sql_key as the value
            value: value.zo_sql_key.toString(),
          }));

        // Update options with new values
        variableObject.options = newOptions;

        // Set default value
        if (oldVariablesData[variableObject.name] !== undefined) {
          const oldValues = Array.isArray(oldVariablesData[variableObject.name])
            ? oldVariablesData[variableObject.name]
            : [oldVariablesData[variableObject.name]];

          // Check if this is a child variable
          const isChildVariable =
            variablesDependencyGraph[variableObject.name]?.parentVariables
              ?.length > 0;

          if (isChildVariable) {
            // For child variables, only keep old values that exist in new options
            const validOldValues = oldValues.filter((value: string) =>
              newOptions.some((opt: { value: string }) => opt.value === value),
            );

            if (validOldValues.length > 0) {
              // If we have valid old values, use them
              variableObject.value = variableObject.multiSelect
                ? validOldValues
                : validOldValues[0];
            } else {
              // If no valid old values, use first option
              variableObject.value = variableObject.multiSelect
                ? newOptions.length > 0
                  ? [newOptions[0].value]
                  : []
                : newOptions.length > 0
                  ? newOptions[0].value
                  : null;
            }
          } else {
            // For non-child variables, preserve old values as before
            if (variableObject.type === "custom") {
              handleCustomVariablesLogic(variableObject, oldValues);
            } else {
              handleQueryValuesLogic(variableObject, oldValues);
            }
          }
        } else {
          // Set default value to the first option if no old values are available
          variableObject.value = variableObject.multiSelect
            ? newOptions.length > 0
              ? [newOptions[0].value]
              : []
            : newOptions.length > 0
              ? newOptions[0].value
              : null;
        }
      } else {
        // Reset variable state if no field values are available
        resetVariableState(variableObject);
      }
      console.log(
        `[WebSocket] isLoading=false (updateVariableOptions) for`,
        variableObject.name,
      );
    };

    /**
     * Finalizes the variable loading process for a single variable.
     * @param {object} variableObject - The variable object containing query data.
     * @param {boolean} success - Whether the variable load was successful or not.
     */
    const finalizeVariableLoading = async (
      variableObject: any,
      success: boolean,
    ) => {
      const { name } = variableObject;

      console.log(
        `[WebSocket] Finalizing load for ${name} with success=${success}`,
      );

      // Clear the currently executing promise
      currentlyExecutingPromises[name] = null;

      // If load failed, reset the variable and mark it as pending
      if (!success) {
        resetVariableState(variableObject);
        variableObject.isLoading = false;
        variableObject.isVariableLoadingPending = true;
        emitVariablesData();
        return;
      }

      // Update old variables data
      const oldValue = oldVariablesData[name];
      oldVariablesData[name] = variableObject.value;

      console.log(
        `[WebSocket] Updated old variables data for ${name}`,
        oldVariablesData,
      );

      // Update loading states
      variableObject.isLoading = false;
      variableObject.isVariableLoadingPending = false;

      console.log(
        `[WebSocket] Updated loading states for ${name}`,
        variableObject,
      );

      // Update global loading state
      variablesData.isVariablesLoading = variablesData.values.some(
        (val: { isLoading: any; isVariableLoadingPending: any }) =>
          val.isLoading || val.isVariableLoadingPending,
      );

      console.log(
        `[WebSocket] Updated global loading state to ${variablesData.isVariablesLoading}`,
      );

      // Handle child variables
      const childVariables =
        variablesDependencyGraph[name]?.childVariables || [];
      if (childVariables.length > 0) {
        const childVariableObjects = variablesData.values.filter(
          (variable: any) => childVariables.includes(variable.name),
        );

        console.log(
          `[WebSocket] Found child variables for ${name}`,
          childVariableObjects,
        );

        // Check if value actually changed or we have no value set
        const valueChanged = oldValue !== variableObject.value;
        const hasValidValue =
          variableObject.value !== null &&
          variableObject.value !== undefined &&
          (!Array.isArray(variableObject.value) ||
            variableObject.value.length > 0);

        if (valueChanged || !hasValidValue) {
          console.log(
            `[WebSocket] Loading child variables for ${name} - value changed or no valid value`,
          );

          // Reset all child variables first
          childVariableObjects.forEach(
            (childVariable: {
              isVariableLoadingPending: boolean;
              isLoading: boolean;
              name: string;
            }) => {
              resetVariableState(childVariable);
              childVariable.isVariableLoadingPending = true;
              childVariable.isLoading = false;
            },
          );

          // Only attempt to load children if parent has a valid value
          if (hasValidValue) {
            await Promise.all(
              childVariableObjects.map((childVariable: any) =>
                loadSingleVariableDataByName(childVariable),
              ),
            );
          }
        }

        // Emit updated data
        emitVariablesData();
      } else {
        variableObject.isLoading = false;
        variableObject.isVariableLoadingPending = false;
      }
    };

    /**
     * Loads options for a variable when its dropdown is opened.
     * @param {object} variableObject - The variable object containing query data.
     * @returns {Promise<void>} - A promise that resolves when the options have been loaded.
     */
    const loadVariableOptions = async (variableObject: any) => {
      console.log(
        `[WebSocket] Loading options for ${variableObject.name} on dropdown open`,
      );

      // When a dropdown is opened, only load the variable data
      await loadSingleVariableDataByName(variableObject);
    };

    let isLoading = false;
    const skipAPILoad = ref(false);

    /**
     * Loads all variables data.
     * This function is called when the selected time or date changes.
     * It loads all variables data in the correct order, taking into account the dependencies between variables.
     * @async
     * @returns {Promise<void>} - A promise that resolves when all variables data has been loaded.
     */
    const loadAllVariablesData = async (isInitialLoad = false) => {
      if (isLoading) {
        return;
      }

      if (!isInitialLoad && skipAPILoad.value) {
        return;
      }

      isLoading = true;

      if (
        isInvalidDate(props.selectedTimeDate?.start_time) ||
        isInvalidDate(props.selectedTimeDate?.end_time)
      ) {
        isLoading = false;
        return;
      }

      // Set loading state for all variables
      variablesData.values.forEach((variable: any) => {
        variable.isVariableLoadingPending = true;
      });

      // Find all independent variables (variables with no dependencies)
      const independentVariables = variablesData.values.filter(
        (variable: any) =>
          !variablesDependencyGraph[variable.name]?.parentVariables?.length,
      );

      // Find all dependent variables (variables with dependencies)
      const dependentVariables = variablesData.values.filter(
        (variable: any) =>
          variablesDependencyGraph[variable.name]?.parentVariables?.length > 0,
      );

      try {
        // Load all independent variables
        await Promise.all(
          independentVariables.map((variable: any) =>
            loadSingleVariableDataByName(variable),
          ),
        );
      } catch (error) {
        await Promise.all(
          independentVariables.map((variable: any) =>
            finalizeVariableLoading(variable, false),
          ),
        );
      }

      const loadDependentVariables = async () => {
        for (const variable of dependentVariables) {
          // Find all parent variables of the current variable
          const parentVariables =
            variablesDependencyGraph[variable.name].parentVariables;
          // Check if all parent variables are loaded
          const areParentsLoaded = parentVariables.every(
            (parentName: string) => {
              const parentVariable = variablesData.values.find(
                (v: any) => v.name === parentName,
              );
              return (
                parentVariable &&
                !parentVariable.isLoading &&
                !parentVariable.isVariableLoadingPending &&
                parentVariable.value !== null
              );
            },
          );

          // If all parent variables are loaded, load the current variable
          if (areParentsLoaded) {
            await loadSingleVariableDataByName(variable);
          }
        }
      };

      // Attempt to load dependent variables up to 3 times
      for (let attempt = 0; attempt < 3; attempt++) {
        await loadDependentVariables();

        // Check if all variables are loaded
        const allLoaded = variablesData.values.every(
          (variable: any) =>
            !variable.isLoading && !variable.isVariableLoadingPending,
        );

        // If all variables are loaded, break the loop
        if (allLoaded) break;
      }

      isLoading = false;
    };

    /**
     * Sets the loading state for a variable and all its child nodes recursively.
     * @param {string} currentVariable - The name of the current variable.
     */
    const setLoadingStateToAllChildNode = (currentVariable: string) => {
      // Retrieve the child variables of the current variable
      const childVariables =
        variablesDependencyGraph[currentVariable]?.childVariables || [];

      // Iterate over each child variable
      for (const variableName of childVariables) {
        // Find the variable object in the variablesData
        const variableObj = variablesData.values.find(
          (it: any) => it.name === variableName,
        );

        // Set the loading state for the variable
        if (variableObj) {
          variableObj.isVariableLoadingPending = true;

          // Recursively set loading state for all child nodes
          setLoadingStateToAllChildNode(variableObj.name);
        }
      }
    };

    /**
     * Handles updating of variables data when a variable value changes.
     * Updates the value of the variable in the old variables data and loads
     * data for all its immediate child variables.
     * @param {number} variableIndex - The index of the variable in the variablesData array.
     * @returns {Promise<void>} - A promise that resolves when all dependent variables have been updated.
     */
    const onVariablesValueUpdated = async (variableIndex: number) => {
      if (variableIndex < 0) return;

      const currentVariable = variablesData.values[variableIndex];
      // if currentVariable is undefined, return
      if (!currentVariable) {
        return;
      }

      // For multiSelect, filter out values not present in options only if options are fully loaded
      if (
        currentVariable.multiSelect &&
        Array.isArray(currentVariable.value) &&
        !currentVariable.isLoading &&
        !currentVariable.isVariableLoadingPending
      ) {
        console.log(
          `[Debug] Filtering multiSelect values for ${currentVariable.name}`,
        );

        // If custom values are set and current value matches custom values, don't filter
        if (
          currentVariable?.selectAllValueForMultiSelect === "custom" &&
          currentVariable?.customMultiSelectValue?.length > 0 &&
          JSON.stringify(currentVariable.value) ===
            JSON.stringify(currentVariable.customMultiSelectValue)
        ) {
          console.log(
            `[Debug] Keeping custom values for-------- ${currentVariable.name}`,
            currentVariable.value,
          );
          return;
        }

        const filtered = currentVariable.value.filter((val: any) =>
          currentVariable.options.some((opt: any) => opt.value === val),
        );
        console.log(
          `[Debug] Filtered multiSelect values for ${currentVariable.name}:`,
          filtered,
        );

        if (filtered.length !== currentVariable.value.length) {
          console.log(
            `[Debug] Updating multiSelect value for ${currentVariable.name} to filtered values`,
          );

          currentVariable.value = filtered;
          console.log(
            `[Debug] Updated multiSelect value for ${currentVariable.name}:`,
            currentVariable.value,
          );
        }
      }

      // Check if the value actually changed
      if (oldVariablesData[currentVariable.name] === currentVariable.value) {
        return;
      }

      // Update the old variables data
      oldVariablesData[currentVariable.name] = currentVariable.value;

      // Get all affected variables recursively
      const getAllAffectedVariables = (
        varName: string,
        visited = new Set<string>(),
      ): string[] => {
        if (visited.has(varName)) return []; // Prevent circular dependencies
        visited.add(varName);

        const immediateChildren =
          variablesDependencyGraph[varName]?.childVariables || [];
        const allChildren: string[] = [...immediateChildren];

        for (const childName of immediateChildren) {
          const grandChildren = getAllAffectedVariables(childName, visited);
          allChildren.push(...grandChildren);
        }

        return Array.from(new Set(allChildren));
      };

      // Get all affected variables in dependency order
      const affectedVariables = getAllAffectedVariables(currentVariable.name);

      // Reset and mark all affected variables for update
      const variablesToUpdate = variablesData.values.filter((v: any) =>
        affectedVariables.includes(v.name),
      );

      // Reset all affected variables
      variablesToUpdate.forEach((variable: any) => {
        variable.isVariableLoadingPending = true;
        variable.isLoading = true;
        // Reset value based on multiSelect property
        variable.value = variable.multiSelect ? [] : null;
        // Reset options array
        variable.options = [];
        // Emit the updated values immediately
        emitVariablesData();
      });

      // Load variables in dependency order, even if parent value is empty
      for (const varName of affectedVariables) {
        const variable = variablesData.values.find(
          (v: any) => v.name === varName,
        );
        if (variable) {
          await loadSingleVariableDataByName(variable);
        }
      }
    };

    return {
      props,
      variablesData,
      changeInitialVariableValues,
      onVariablesValueUpdated,
      loadVariableOptions,
    };
  },
});
</script>

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
  <div v-if="variablesData.values?.length > 0">
    <div :key="variablesData.isVariablesLoading" class="flex q-mt-xs q-ml-xs">
      <div
        v-for="(item, index) in variablesData.values"
        :key="item.name + index"
        :data-test="`dashboard-variable-${item}-selector`"
      >
        <div
          v-if="item.type == 'query_values' && item._isCurrentLevel !== false"
        >
          <VariableQueryValueSelector
            class="q-mr-lg q-mt-xs"
            v-show="!item.hideOnDashboard"
            v-model="item.value"
            :variableItem="item"
            @update:model-value="onVariablesValueUpdated(index)"
            :loadOptions="loadVariableOptions"
            @search="onVariableSearch(index, $event)"
          />
        </div>
        <div
          v-else-if="item.type == 'constant' && item._isCurrentLevel !== false"
        >
          <q-input
            v-show="!item.hideOnDashboard"
            class="q-mr-lg q-mt-xs"
            style="max-width: 150px !important"
            v-model="item.value"
            :label="item.label || item.name"
            dense
            readonly
            data-test="dashboard-variable-constant-selector"
            @update:model-value="onVariablesValueUpdated(index)"
            borderless
            hide-bottom-space
          ></q-input>
        </div>
        <div
          v-else-if="item.type == 'textbox' && item._isCurrentLevel !== false"
        >
          <q-input
            v-show="!item.hideOnDashboard"
            class="q-mr-lg q-mt-xs"
            style="max-width: 150px !important"
            debounce="1000"
            v-model="item.value"
            :label="item.label || item.name"
            dense
            data-test="dashboard-variable-textbox-selector"
            @update:model-value="onVariablesValueUpdated(index)"
            borderless
            hide-bottom-space
          ></q-input>
        </div>
        <div
          v-else-if="item.type == 'custom' && item._isCurrentLevel !== false"
        >
          <VariableCustomValueSelector
            v-show="!item.hideOnDashboard"
            class="q-mr-lg q-mt-xs"
            v-model="item.value"
            :variableItem="item"
            @update:model-value="onVariablesValueUpdated(index)"
          />
        </div>
        <div
          v-else-if="
            item.type == 'dynamic_filters' && item._isCurrentLevel !== false
          "
        >
          <VariableAdHocValueSelector
            class="q-mr-lg q-mt-xs"
            v-model="item.value"
            :variableItem="item"
          />
        </div>
      </div>
    </div>

    <!-- Add Variable Button -->
    <div v-if="showAddVariableButton" class="q-ml-xs q-mt-sm">
      <q-btn
        outline
        no-caps
        icon="add"
        label="Add Variable"
        color="primary"
        size="md"
        class="el-border"
        @click="openAddVariable"
        data-test="dashboard-add-variable-btn"
      />
    </div>
  </div>
</template>

<script lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import { defineComponent, reactive } from "vue";
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
} from "@/utils/zincutils";
import { buildVariablesDependencyGraph } from "@/utils/dashboard/variables/variablesDependencyUtils";
import useHttpStreaming from "@/composables/useStreamingSearch";
import { SELECT_ALL_VALUE } from "@/utils/dashboard/constants";

export default defineComponent({
  name: "VariablesValueSelector",
  props: [
    "selectedTimeDate",
    "variablesConfig",
    "initialVariableValues",
    "showDynamicFilters",
    "lazyLoad", // If true, don't auto-load on mount, wait for explicit trigger
    "showAddVariableButton", // If true, show the "Add Variable" button
  ],
  emits: ["variablesData", "openAddVariable"],
  components: {
    VariableQueryValueSelector,
    VariableAdHocValueSelector,
    VariableCustomValueSelector,
  },
  setup(props: any, { emit }) {
    const store = useStore();

    // variables data derived from the variables config list
    const variablesData: any = reactive({
      isVariablesLoading: false,
      values: [],
    });

    // ================== FOR DEBUGGING PURPOSES ONLY ==================
    // watch for changes in variablesData.values
    let previousValues: any[] = [];
    watch(
      () => variablesData.values,
      (newValues) => {
        return;
        // Track all changes to log them together
        const changes: any[] = [];

        // Compare each variable's properties
        newValues.forEach((newVar: any, index: number) => {
          const oldVar = previousValues[index];
          if (!oldVar) {
            changes.push({
              variable: newVar.name,
              type: "new_variable",
            });
            return;
          }

          // List of properties to watch
          const propertiesToWatch = [
            "value",
            "isLoading",
            "isVariablePartialLoaded",
            "isVariableLoadingPending",
            "options",
          ];

          // Check each property for changes
          const variableChanges: any = {
            name: newVar.name,
            changes: [],
          };

          propertiesToWatch.forEach((prop) => {
            // Get deep copies of values to avoid proxy objects
            const newValue = JSON.parse(JSON.stringify(newVar[prop]));
            const oldValue = JSON.parse(JSON.stringify(oldVar[prop]));

            // For arrays (like options) or objects, compare stringified versions
            const hasChanged =
              Array.isArray(newValue) || typeof newValue === "object"
                ? JSON.stringify(newValue) !== JSON.stringify(oldValue)
                : newValue !== oldValue;

            if (hasChanged) {
              variableChanges.changes.push({
                property: prop,
                from: oldValue,
                to: newValue,
              });
            }
          });

          if (variableChanges.changes.length > 0) {
            changes.push(variableChanges);
          }
        });

        // Log all changes together if there are any
        if (changes.length > 0) {
          console.group(`Variables changed at ${new Date().toISOString()}`);

          changes.forEach((change) => {
            if (change.type === "new_variable") {
              console.log(`🆕 New variable added: ${change.variable}`);
            } else {
              console.groupCollapsed(`Variable: ${change.name}`);
              change.changes.forEach((propertyChange: any) => {
                console.log(
                  `Property "${propertyChange.property}":`,
                  "\nFrom:",
                  typeof propertyChange.from === "object"
                    ? JSON.stringify(propertyChange.from, null, 2)
                    : propertyChange.from,
                  "\nTo:",
                  typeof propertyChange.to === "object"
                    ? JSON.stringify(propertyChange.to, null, 2)
                    : propertyChange.to,
                );
              });
              console.groupEnd();
            }
          });

          console.groupEnd();
        }

        // Store deep copy of current values for next comparison
        previousValues = JSON.parse(JSON.stringify(newValues));
      },
      { deep: true },
    );

    const variableLog = (name: string, message: string) => {
      // console.log(`[Variable: ${name}] ${message}`);
    };

    // ================== [END] FOR DEBUGGING PURPOSES ONLY ==================

    // variables dependency graph
    let variablesDependencyGraph: any = {};

    // track old variables data
    const oldVariablesData: any = {};

    // currently executing promise
    const currentlyExecutingPromises: any = {};

    const traceIdMapper = ref<{ [key: string]: string[] }>({});
    const variableFirstResponseProcessed = ref<{ [key: string]: boolean }>({});

    // Flag to prevent cascade loops when processing parent variable changes
    const isProcessingParentChange = ref(false);

    // ------------- Start HTTP2/Streaming Implementation -------------
    const { fetchQueryDataWithHttpStream, cancelStreamQueryBasedOnRequestId } =
      useHttpStreaming();

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
          cancelStreamQueryBasedOnRequestId({
            trace_id: traceId,
            org_id: store?.state?.selectedOrganization?.identifier,
          });
        });

        // Clear the trace IDs after cancellation
        traceIdMapper.value[field] = [];
      }
    };

    // onUnmounted - cancel all active streaming API calls
    onUnmounted(() => {
      // Cancel all active trace IDs for all variables
      Object.keys(traceIdMapper.value).forEach((field) => {
        cancelTraceId(field);
      });

      // Clean up any in-flight promises to prevent memory leaks
      rejectAllPromises();
      Object.keys(currentlyExecutingPromises).forEach((key) => {
        currentlyExecutingPromises[key] = null;
      });
    });

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
              message: "Streaming connection terminated unexpectedly",
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

    const handleSearchResponse = (
      payload: any,
      response: any,
      variableObject: any,
    ) => {
      variableLog(variableObject.name, `Received response...`);

      if (!variableObject) {
        return;
      }

      // Check if this operation was cancelled before processing
      if (currentlyExecutingPromises[variableObject.name] === null) {
        removeTraceId(variableObject.name, payload.traceId);
        return;
      }

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
        finalizeVariableLoading(variableObject, true);
        emitVariablesData();
        return;
      }
      try {
        if (
          response.content?.results?.hits?.length &&
          (response.type === "search_response" ||
            response.type === "search_response_hits")
        ) {
          // variableObject.isVariablePartialLoaded = true;

          const hits = response.content.results.hits;

          const fieldHit = hits.find(
            (field: any) => field.field === variableObject.query_data.field,
          );

          variableLog(
            variableObject.name,
            `Processing response... ${JSON.stringify(fieldHit?.values?.length)}`,
          );
          if (fieldHit) {
            // Initialize options array if it doesn't exist
            if (!Array.isArray(variableObject.options)) {
              variableObject.options = [];
            }

            const isFirstResponse =
              fieldHit.values.length > 0 &&
              variableObject.isVariablePartialLoaded === false;

            variableLog(
              variableObject.name,
              `Is first response: ${JSON.stringify(isFirstResponse)}`,
            );

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
            // For first response or subsequent responses, merge with existing options and keep selected values
            if (isFirstResponse) {
              // Add missing selected values to newOptions
              if (
                variableObject.multiSelect &&
                Array.isArray(variableObject.value)
              ) {
                variableObject.value.forEach((val: string) => {
                  if (
                    !newOptions.some((opt: any) => opt.value === val) &&
                    val !== SELECT_ALL_VALUE
                  ) {
                    newOptions.push({
                      label: val,
                      value: val,
                    });
                  }
                });
              } else if (
                !variableObject.multiSelect &&
                variableObject.value !== null
              ) {
                if (
                  !newOptions.some(
                    (opt: any) => opt.value === variableObject.value,
                  ) &&
                  variableObject.value !== SELECT_ALL_VALUE
                ) {
                  newOptions.push({
                    label: variableObject.value,
                    value: variableObject.value,
                  });
                }
              }
              variableObject.options = newOptions;
            } else {
              // For subsequent responses, merge with existing options
              variableObject.options = [
                ...newOptions,
                ...variableObject.options,
              ];
            }
            // Remove duplicates
            variableObject.options = variableObject.options.filter(
              (option: any, index: number, self: any[]) =>
                index === self.findIndex((o) => o.value === option.value),
            );
            // Sort options
            variableObject.options.sort((a: any, b: any) =>
              a.label.localeCompare(b.label),
            );

            variableLog(
              variableObject.name,
              `Received options being set: ${JSON.stringify(variableObject.options)}`,
            );

            const originalValue = JSON.parse(
              JSON.stringify(variableObject.value),
            );

            if (isFirstResponse) {
              // Update options and handle first response
              if (oldVariablesData[variableObject.name] !== undefined) {
                variableLog(
                  variableObject.name,
                  `Old values before processing: ${JSON.stringify(oldVariablesData[variableObject.name])}`,
                );

                const oldValues = Array.isArray(
                  oldVariablesData[variableObject.name],
                )
                  ? oldVariablesData[variableObject.name]
                  : [oldVariablesData[variableObject.name]];

                handleQueryValuesLogic(variableObject, oldValues);
              } else {
                variableLog(
                  variableObject.name,
                  `Old values not found, setting default value`,
                );

                variableObject.value = variableObject.options.length
                  ? variableObject.options[0].value
                  : null;
              }

              const hasValueChanged =
                Array.isArray(originalValue) &&
                Array.isArray(variableObject.value)
                  ? JSON.stringify(originalValue) !==
                    JSON.stringify(variableObject.value)
                  : originalValue !== variableObject.value;

              if (hasValueChanged) {
                finalizePartialVariableLoading(variableObject, true);
              } else {
                // just set the partially loaded state
                variableObject.isVariablePartialLoaded = true;
              }
            }
          }
        }
      } catch (error) {
        resetVariableState(variableObject);
        variableObject.isLoading = false;
        variableObject.isVariablePartialLoaded = true;
        variableObject.isVariableLoadingPending = false;
      }

      // Only emit data updates, don't modify loading states here
      emitVariablesData();
    };

    const fetchFieldValuesWithStreaming = (
      variableObject: any,
      queryContext: string,
    ) => {
      if (!variableObject?.query_data?.field) {
        return;
      }

      const startTime = props.selectedTimeDate?.start_time?.getTime();
      const endTime = props.selectedTimeDate?.end_time?.getTime();

      if (!startTime || !endTime) {
        return;
      }

      // Check if this operation was cancelled before proceeding
      if (currentlyExecutingPromises[variableObject.name] === null) {
        return;
      }

      // Set loading state before initiating streaming
      variableObject.isLoading = true;
      variableObject.isVariableLoadingPending = true;

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
      try {
        // Start new streaming connection
        fetchQueryDataWithHttpStream(wsPayload, {
          data: (p: any, r: any) => handleSearchResponse(p, r, variableObject),
          error: (p: any, r: any) => handleSearchError(p, r, variableObject),
          complete: (p: any, r: any) => handleSearchClose(p, r, variableObject),
          reset: handleSearchReset,
        });
        addTraceId(variableObject.name, wsPayload.traceId);
      } catch (error) {
        variableObject.isLoading = false;
        variableObject.isVariableLoadingPending = false;
      }
    };

    const handleSearchReset = (data: any) => {
      const variableObject = variablesData.values.find(
        (v: any) => v.query_data?.field === data.queryReq?.fields[0],
      );

      if (variableObject) {
        variableObject.isLoading = true;
        variableFirstResponseProcessed.value[variableObject.name] = false;

        fetchFieldValuesWithStreaming(
          variableObject,
          data.queryReq.query_context,
        );
      }
    };

    // ------------- End HTTP2/Streaming Implementation -------------

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

      variableLog(
        "init",
        `Initializing variables: total=${props.variablesConfig.list.length}, variables=${JSON.stringify(props.variablesConfig.list.map((v: any) => ({ name: v.name, _isCurrentLevel: v._isCurrentLevel })))}`,
      );

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
          isVariableLoadingPending: false,
          isVariablePartialLoaded: true,
          // Initialize options array for all variables
          options: item.options || [],
        };

        variableLog(
          variableData.name,
          `Initializing with initial value: ${JSON.stringify(initialValue)} and object ${JSON.stringify(variableData)}`,
        );

        // Set custom values immediately if they exist and no URL value is present
        if (
          item.type === "query_values" &&
          item.selectAllValueForMultiSelect === "custom" &&
          item.customMultiSelectValue?.length > 0 &&
          ((Array.isArray(initialValue) && initialValue.length === 0) ||
            !initialValue) // Only set custom value if no URL value exists
        ) {
          variableData.value = item.multiSelect
            ? item.customMultiSelectValue
            : item.customMultiSelectValue[0];
        } else if (
          item.type === "query_values" &&
          item.selectAllValueForMultiSelect === "all" &&
          ((Array.isArray(initialValue) && initialValue.length === 0) ||
            !initialValue)
        ) {
          variableData.value = item.multiSelect
            ? [SELECT_ALL_VALUE]
            : SELECT_ALL_VALUE;
        } else if (item.type != "constant") {
          // for textbox type variable, if initial value is not exist, use the default value
          if (item.type == "textbox") {
            variableData.value = initialValue ?? variableData.value;
          } else {
            // use the initial value
            variableData.value = initialValue;
          }
        }

        variableLog(
          variableData.name,
          `Final value after initialization: ${JSON.stringify(variableData)}`,
        );

        // push the variable to the list
        variablesData.values.push(variableData);

        // set old variables data
        oldVariablesData[item.name] = initialValue;

        variableLog(
          variableData.name,
          `Old Values after initialization: ${JSON.stringify(oldVariablesData)}`,
        );
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
          isVariableLoadingPending: false,
          isVariablePartialLoaded: true,
          options: [],
        });

        // set old variables data
        oldVariablesData["Dynamic filters"] = initialValue;
      }

      // need to build variables dependency graph on variables config list change
      variablesDependencyGraph = buildVariablesDependencyGraph(
        variablesData.values,
      );

      variableLog(
        "init",
        `Variables initialized: total=${variablesData.values.length}, currentLevel=${variablesData.values.filter((v: any) => v._isCurrentLevel !== false).length}, parentOnly=${variablesData.values.filter((v: any) => v._isCurrentLevel === false).length}, dependencyGraph=${JSON.stringify(variablesDependencyGraph)}`,
      );
    };

    const rejectAllPromises = () => {
      Object.keys(currentlyExecutingPromises).forEach((key) => {
        if (currentlyExecutingPromises[key]) {
          variableLog(
            key,
            `Rejecting currently executing promise: ${currentlyExecutingPromises[key]}`,
          );
          currentlyExecutingPromises[key](false);
        }
      });
    };

    // Track if initial load has been done
    const hasInitialLoadCompleted = ref(false);

    onMounted(() => {
      // make list of variables using variables config list
      initializeVariablesData();

      // reject all promises
      rejectAllPromises();

      // load all variables only if not lazy loading
      if (!props.lazyLoad) {
        loadAllVariablesData(true);
        hasInitialLoadCompleted.value = true;
      }
    });

    onUnmounted(() => {
      // Clean up any in-flight promises to prevent memory leaks
      rejectAllPromises();
      Object.keys(currentlyExecutingPromises).forEach((key) => {
        currentlyExecutingPromises[key] = null;
      });
    });

    watch(
      () => props.variablesConfig,
      async (newConfig, oldConfig) => {
        // Skip if this is the first watch trigger after mount (initial load already done)
        if (!hasInitialLoadCompleted.value && !props.lazyLoad) {
          return;
        }

        // Compare configs to see if they actually changed
        const newConfigStr = JSON.stringify(
          newConfig?.list?.map((v: any) => v.name) || [],
        );
        const oldConfigStr = JSON.stringify(
          oldConfig?.list?.map((v: any) => v.name) || [],
        );

        if (newConfigStr === oldConfigStr) {
          // Config hasn't really changed, skip reload
          return;
        }

        // make list of variables using variables config list
        initializeVariablesData();

        // reject all promises
        rejectAllPromises();
        skipAPILoad.value = false;
        // load all variables only if not lazy loading
        if (!props.lazyLoad) {
          loadAllVariablesData(true);
        }
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

    // Watch for changes in initialVariableValues (from parent) and reload dependent variables
    watch(
      () => JSON.stringify(props.initialVariableValues?.value || {}),
      async (newVal, oldVal) => {
        if (!oldVal || oldVal === "{}") {
          return; // Skip initial load
        }
        if (newVal === oldVal) return; // No changes

        // Prevent re-entry while we're already processing a parent change
        if (isProcessingParentChange.value) {
          return;
        }

        // Compare old and new values to find what changed
        const oldValues = oldVal ? JSON.parse(oldVal) : {};
        const newValues = newVal ? JSON.parse(newVal) : {};
        const changedVars: string[] = [];

        Object.keys(newValues).forEach((varName) => {
          if (
            JSON.stringify(oldValues[varName]) !==
            JSON.stringify(newValues[varName])
          ) {
            changedVars.push(varName);
          }
        });

        if (changedVars.length === 0) {
          return;
        }

        // Get list of local variable names (only current-level variables)
        const localVarNames = variablesData.values
          .filter((v: any) => v._isCurrentLevel === true)
          .map((v: any) => v.name);

        // Filter out changes that came from our own variables (to prevent self-triggering)
        const externalChangedVars = changedVars.filter(
          (varName) => !localVarNames.includes(varName),
        );

        if (externalChangedVars.length === 0) {
          return;
        }

        // IMPORTANT: Update variablesData.values with new parent values BEFORE reloading
        // This ensures child variables use the NEW parent values when they build queries
        variablesData.values.forEach((v: any) => {
          if (newValues[v.name] !== undefined) {
            v.value = newValues[v.name];
          }
        });

        // Also update oldVariablesData for change detection
        Object.keys(newValues).forEach((varName) => {
          oldVariablesData[varName] = newValues[varName];
        });

        // Check which variables depend on changed EXTERNAL parent variables
        const affectedVariables = variablesData.values.filter((v: any) => {
          // Only check current-level variables
          if (v._isCurrentLevel !== true) return false;

          const deps = variablesDependencyGraph[v.name]?.parentVariables || [];
          return deps.some((dep: string) => externalChangedVars.includes(dep));
        });

        if (affectedVariables.length === 0) {
          return;
        }

        // Set flag to prevent re-entry
        isProcessingParentChange.value = true;

        try {
          // Sort variables by dependency order (independent first)
          const sortedVariables = affectedVariables.sort((a: any, b: any) => {
            const aDeps =
              variablesDependencyGraph[a.name]?.parentVariables || [];
            const bDeps =
              variablesDependencyGraph[b.name]?.parentVariables || [];
            // Variables with fewer dependencies load first
            return aDeps.length - bDeps.length;
          });

          // Reload affected variables SEQUENTIALLY to prevent multiple simultaneous API calls
          for (const variable of sortedVariables) {
            variable.isVariableLoadingPending = true;
            variable.isVariablePartialLoaded = false;
            variable.isLoading = true;
            variable.value = variable.multiSelect ? [] : null;
            variable.options = [];

            // Wait for this variable to complete before starting next
            await loadSingleVariableDataByName(variable, false);
          }
        } finally {
          // Always clear the flag when done
          isProcessingParentChange.value = false;
        }
      },
    );

    const emitVariablesData = () => {
      const dataToEmit = {
        isVariablesLoading: variablesData.isVariablesLoading,
        values: variablesData.values.map((v: any) => ({
          ...v,
          options: undefined, // Don't emit options to prevent unnecessary updates
        })),
      };

      emit("variablesData", dataToEmit);
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
            currentVariable.value = [SELECT_ALL_VALUE];
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
          return;
        }
      }

      // Check if this is a child variable
      const isChildVariable =
        variablesDependencyGraph[currentVariable.name]?.parentVariables
          ?.length > 0;

      // Only apply custom values if no URL value exists
      if (
        !isChildVariable &&
        currentVariable?.selectAllValueForMultiSelect === "custom" &&
        currentVariable?.customMultiSelectValue?.length > 0
      ) {
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
              currentVariable.value = [SELECT_ALL_VALUE];
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
    const loadSingleVariableDataByName = async (
      variableObject: any,
      isInitialLoad: boolean = false,
      searchText?: string,
    ) => {
      return new Promise(async (resolve, reject) => {
        const { name } = variableObject;

        if (!name || !variableObject) {
          resolve(false);
          return;
        }

        // For search operations, use comprehensive cancellation
        if (searchText) {
          cancelAllVariableOperations(name);
        } else {
          // If the variable is already being processed, cancel the previous request
          if (currentlyExecutingPromises[name]) {
            variableLog(name, "Canceling previous request");
            currentlyExecutingPromises[name](false);
          }
        }

        currentlyExecutingPromises[name] = reject;

        // Check if this variable has any dependencies
        const hasParentVariables =
          variablesDependencyGraph[name]?.parentVariables;
        const areDatesValid =
          !isInvalidDate(props.selectedTimeDate?.start_time) &&
          !isInvalidDate(props.selectedTimeDate?.end_time); // Check dates for all query_values type
        if (variableObject.type === "query_values") {
          if (!areDatesValid) {
            variableObject.isLoading = false;
            variableObject.isVariableLoadingPending = false;
            variableLog(
              variableObject.name,
              `Invalid date range for variable ${name}, skipping load`,
            );
            resolve(false);
            return;
          }
        }

        // For variables with dependencies, check if they are ready
        if (hasParentVariables) {
          variableLog(
            variableObject.name,
            `Checking parent variables readiness`,
          );

          const parentVariables =
            variablesDependencyGraph[name].parentVariables;

          // Check if any parent has no data (empty options)
          const hasParentWithNoData = parentVariables.some(
            (parentName: string) => {
              const parentVariable = variablesData.values.find(
                (v: any) => v.name === parentName,
              );

              return (
                parentVariable &&
                (parentVariable.value === null ||
                  parentVariable.value === undefined ||
                  (Array.isArray(parentVariable.value) &&
                    parentVariable.value.length === 0))
              );
            },
          );

          // If any parent has no data, skip API and set child value to null
          if (hasParentWithNoData) {
            variableLog(
              variableObject.name,
              `Parent variable has no data, skipping API call and resetting child value`,
            );

            // Reset the child variable value
            resetVariableState(variableObject);
            const nullValue = variableObject.multiSelect ? [] : null;
            variableObject.value = nullValue;
            variableObject.options = [];
            variableObject.isLoading = false;
            variableObject.isVariablePartialLoaded = true;
            variableObject.isVariableLoadingPending = false;

            // Update old variables data to reflect the reset
            oldVariablesData[variableObject.name] = variableObject.value;

            emitVariablesData();
            resolve(true);
            return;
          }

          const areParentsReady = parentVariables.every(
            (parentName: string) => {
              const parentVariable = variablesData.values.find(
                (v: any) => v.name === parentName,
              );

              variableLog(
                variableObject.name,
                `Parent variable readiness with parent ${JSON.stringify(parentVariable)}`,
              );

              const isReady =
                parentVariable &&
                parentVariable.isVariablePartialLoaded &&
                parentVariable.value !== null &&
                parentVariable.value !== undefined &&
                (!Array.isArray(parentVariable.value) ||
                  parentVariable.value.length > 0);

              if (!isReady && parentVariable) {
                // Reset this variable since parent is not ready
                resetVariableState(variableObject);
                variableObject.isVariableLoadingPending = true;
                variableObject.isVariablePartialLoaded = true;
                variableObject.isLoading = false;
              }
              return isReady;
            },
          );

          variableLog(
            variableObject.name,
            `Parent variables readiness: ${areParentsReady}`,
          );

          if (!areParentsReady) {
            variableLog(
              variableObject.name,
              `Parent variables are not ready, skipping variable load`,
            );
            // Just update loading states but don't reset value if already set
            variableObject.isLoading = false;
            variableObject.isVariablePartialLoaded = false;
            variableObject.isVariableLoadingPending = true;
            resolve(false);
            return;
          }
        }

        // Set loading state
        variableObject.isLoading = true;
        variableObject.isVariablePartialLoaded = false;
        emitVariablesData();

        try {
          const success = await handleVariableType(
            variableObject,
            isInitialLoad,
            searchText,
          );
          // await finalizeVariableLoading(variableObject, success);
          resolve(success);
        } catch (error) {
          // console.error(`Error loading variable ${name}:`, error);
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
    const handleVariableType = async (
      variableObject: any,
      isInitialLoad: boolean = false,
      searchText?: string,
    ) => {
      variableLog(
        variableObject.name,
        `Handling variable type: ${variableObject.type},  ${isInitialLoad}`,
      );
      switch (variableObject.type) {
        case "query_values": {
          // for initial loading check if the value is already available,
          // if yes, just mark as loaded and trigger child loads but don't fetch again
          if (isInitialLoad && !searchText) {
            variableLog(
              variableObject.name,
              `Initial load check for variable: ${variableObject.name}, value: ${JSON.stringify(variableObject)}`,
            );
            // check for value not null or in case of array it should not be empty array
            // if the value is already set, we don't need to load it again
            if (
              variableObject.value !== null &&
              variableObject.value !== undefined &&
              (!Array.isArray(variableObject.value) ||
                variableObject.value.length > 0)
            ) {
              // IMPORTANT: Set partial loaded first to allow child variables to load
              variableObject.isVariablePartialLoaded = true;
              variableObject.isLoading = false;
              variableObject.isVariableLoadingPending = false;

              // Emit the data immediately so panels can receive the values
              emitVariablesData();

              // Then trigger child variable loading
              await finalizePartialVariableLoading(
                variableObject,
                true,
                isInitialLoad,
              );

              return true;
            }
          }

          try {
            const queryContext: any = await buildQueryContext(
              variableObject,
              searchText,
            );

            // Use HTTP2/streaming for all dashboard variable values
            // We don't need to wait for the response here as it will be handled by the streaming handlers
            fetchFieldValuesWithStreaming(variableObject, queryContext);
            return true;
          } catch (error) {
            resetVariableState(variableObject);
            return false;
          }
        }
        case "custom": {
          handleCustomVariable(variableObject);
          finalizePartialVariableLoading(variableObject, true);
          finalizeVariableLoading(variableObject, true);
          return true;
        }
        case "constant":
        case "textbox":
        case "dynamic_filters": {
          finalizePartialVariableLoading(variableObject, true);
          finalizeVariableLoading(variableObject, true);
          return true;
        }
        default: {
          return false;
        }
      }
    };

    /**
     * Builds the query context for the given variable object.
     * @param variableObject The variable object containing the query data.
     * @returns The query context as a string.
     */
    const buildQueryContext = async (
      variableObject: any,
      searchText?: string,
    ) => {
      variableLog(
        variableObject.name,
        `Building query context for variable: ${variableObject.name}${searchText ? ` with search: ${searchText}` : ""}`,
      );

      const timestamp_column =
        store.state.zoConfig.timestamp_column || "_timestamp";

      let dummyQuery: string;

      if (searchText) {
        dummyQuery = `SELECT ${timestamp_column} FROM '${variableObject.query_data.stream}' WHERE str_match(${variableObject.query_data.field}, '${escapeSingleQuotes(searchText.trim())}')`;
      } else {
        dummyQuery = `SELECT ${timestamp_column} FROM '${variableObject.query_data.stream}'`;
      }

      // Construct the filter from the query data
      const constructedFilter = (variableObject.query_data?.filter || []).map(
        (condition: any) => ({
          name: condition.name,
          operator: condition.operator,
          value: condition.value,
        }),
      );

      // Add labels to the dummy query
      let queryContext = constructedFilter.length
        ? await addLabelsToSQlQuery(dummyQuery, constructedFilter)
        : dummyQuery;

      // Replace variable placeholders with actual values
      for (const variable of variablesData.values) {
        if (variable.isVariablePartialLoaded) {
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
     * Finalizes the variable loading process for a single variable.
     * @param {object} variableObject - The variable object containing query data.
     * @param {boolean} success - Whether the variable load was successful or not.
     */
    const finalizeVariableLoading = async (
      variableObject: any,
      success: boolean,
    ) => {
      const { name } = variableObject;

      // Clear the currently executing promise
      currentlyExecutingPromises[name] = null;

      if (success) {
        // Update loading states
        variableObject.isLoading = false;
        variableObject.isVariablePartialLoaded = true;
        variableObject.isVariableLoadingPending = false;

        // Update global loading state
        variablesData.isVariablesLoading = variablesData.values.some(
          (val: { isLoading: any; isVariableLoadingPending: any }) =>
            val.isLoading || val.isVariableLoadingPending,
        );

        // Emit updated data
        emitVariablesData();
      } else {
        variableObject.isLoading = false;
        variableObject.isVariableLoadingPending = false;
      }
    };

    /**
     * Finalizes the partial loading process for a variable.
     * Updates the loading state and conditionally loads child variables if they exist.
     *
     * @param {object} variableObject - The variable object to be updated.
     * @param {boolean} success - Indicates whether the variable was partially loaded successfully.
     */
    const finalizePartialVariableLoading = async (
      variableObject: any,
      success: boolean,
      isInitialLoad: boolean = false, // this important for the the children load while initial loading
    ) => {
      try {
        variableLog(
          variableObject.name,
          `finalizePartialVariableLoading: ${success}, ${JSON.stringify(variableObject)}`,
        );

        const { name } = variableObject;

        variableObject.isVariablePartialLoaded = success;

        // Don't load child variables on dropdown open events
        // Load child variables if any
        const childVariables =
          variablesDependencyGraph[name]?.childVariables || [];

        variableLog(
          variableObject.name,
          `finalizePartialVariableLoading: child variables: ${JSON.stringify(childVariables)}`,
        );

        if (childVariables.length > 0) {
          const childVariableObjects = variablesData.values.filter(
            (variable: any) => childVariables.includes(variable.name),
          );

          variableLog(
            variableObject.name,
            `Loading ${childVariableObjects.length} child variables: ${childVariableObjects.map((v: any) => v.name).join(", ")}`,
          );
          variableLog(
            variableObject.name,
            `Old Variables Data: ${JSON.stringify(oldVariablesData)}`,
          );

          // Load child variables that are at the current level (_isCurrentLevel === true)
          for (const childVariable of childVariableObjects) {
            // Only load if child is at current level or level not specified
            if (childVariable._isCurrentLevel !== false) {
              variableLog(
                variableObject.name,
                `Loading child variable: ${childVariable.name}`,
              );
              await loadSingleVariableDataByName(childVariable, isInitialLoad);
            }
          }
        }
      } catch (error) {
        // Error handling: silently catch errors during partial loading finalization
      }
    };

    /**
     * Loads options for a variable when its dropdown is opened.
     * @param {object} variableObject - The variable object containing query data.
     * @returns {Promise<void>} - A promise that resolves when the options have been loaded.
     */
    const loadVariableOptions = async (variableObject: any) => {
      // Check if there's already a loading request in progress
      if (variableObject.isLoading) {
        return;
      }
      try {
        // When a dropdown is opened, only load the variable data
        await loadSingleVariableDataByName(variableObject);
      } catch (error) {
        variableLog(
          variableObject.name,
          `Error loading variable options for ${variableObject.name}: ${error.message}`,
        );
      }
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

      // Set loading state for current-level variables
      // Variables with _isCurrentLevel === true or undefined should be loaded
      variablesData.values.forEach((variable: any) => {
        if (
          variable._isCurrentLevel === true ||
          variable._isCurrentLevel === undefined
        ) {
          variable.isVariableLoadingPending = true;
        }
      });

      // Find independent variables to load (current-level with no dependencies)
      const independentVariables = variablesData.values.filter(
        (variable: any) => {
          const shouldLoad =
            variable._isCurrentLevel === true ||
            variable._isCurrentLevel === undefined;
          const hasNoDeps =
            !variablesDependencyGraph[variable.name]?.parentVariables?.length;
          return shouldLoad && hasNoDeps;
        },
      );

      // Find all dependent variables at CURRENT level (variables with dependencies)
      const dependentVariables = variablesData.values.filter(
        (variable: any) => {
          const shouldLoad =
            variable._isCurrentLevel === true ||
            variable._isCurrentLevel === undefined;
          const hasDeps =
            variablesDependencyGraph[variable.name]?.parentVariables?.length >
            0;
          return shouldLoad && hasDeps;
        },
      );

      variableLog(
        "loadAll",
        `loadAllVariablesData: isInitialLoad=${isInitialLoad}, totalVariables=${variablesData.values.length}, independent=${JSON.stringify(independentVariables.map((v: any) => v.name))}, dependent=${JSON.stringify(dependentVariables.map((v: any) => ({ name: v.name, parents: variablesDependencyGraph[v.name]?.parentVariables || [] })))}, allVariables=${JSON.stringify(variablesData.values.map((v: any) => ({ name: v.name, _isCurrentLevel: v._isCurrentLevel })))}`,
      );

      try {
        // Load all independent variables
        variableLog(
          "loadAll",
          `Loading independent variables: ${JSON.stringify(independentVariables.map((v: any) => v.name))}`,
        );
        await Promise.all(
          independentVariables.map((variable: any) =>
            loadSingleVariableDataByName(variable, isInitialLoad),
          ),
        );
        variableLog(
          "loadAll",
          "Independent variables loaded, child variables should load automatically",
        );
      } catch (error) {
        variableLog("loadAll", `Error loading independent variables: ${error}`);
        await Promise.all(
          independentVariables.map((variable: any) =>
            finalizeVariableLoading(variable, false),
          ),
        );
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

      variableLog(
        currentVariable.name,
        `onVariablesValueUpdated: ${JSON.stringify(currentVariable)}`,
      );

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
        // If custom values are set and current value matches custom values, don't filter
        if (
          currentVariable?.selectAllValueForMultiSelect === "custom" &&
          currentVariable?.customMultiSelectValue?.length > 0 &&
          JSON.stringify(currentVariable.value) ===
            JSON.stringify(currentVariable.customMultiSelectValue)
        ) {
          return;
        }

        const optionValues = currentVariable.options.map(
          (opt: any) => opt.value,
        );

        const customTypedValues = currentVariable.value.filter(
          (val: any) => !optionValues.includes(val) && val !== SELECT_ALL_VALUE,
        );

        const filtered = currentVariable.value.filter(
          (val: any) => optionValues.includes(val) || val === SELECT_ALL_VALUE,
        );

        const merged = [
          ...filtered,
          ...customTypedValues.filter((v) => !filtered.includes(v)),
        ];

        if (merged.length !== currentVariable.value.length) {
          currentVariable.value = merged;
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
        variable.isVariablePartialLoaded = false;
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

    /**
     * Comprehensive cancellation function that cancels all ongoing operations for a variable
     * @param {string} variableName - The name of the variable to cancel operations for
     */
    const cancelAllVariableOperations = (variableName: string) => {
      // 1. Cancel any ongoing promise-based operations
      if (currentlyExecutingPromises[variableName]) {
        variableLog(variableName, "Canceling currently executing promise");
        currentlyExecutingPromises[variableName](false);
        currentlyExecutingPromises[variableName] = null;
      }

      // 2. Cancel any ongoing streaming operations
      cancelTraceId(variableName);

      // 3. Reset loading states for the variable only if not in search mode
      const variableObject = variablesData.values.find(
        (v: any) => v.name === variableName,
      );

      if (variableObject) {
        variableObject.isLoading = false;
        variableObject.isVariableLoadingPending = false;
      }
    };

    const onVariableSearch = async (
      index: number,
      { variableItem, filterText }: any,
    ) => {
      if (
        typeof index !== "number" ||
        !variableItem ||
        variableItem.type !== "query_values"
      )
        return;

      const variableName = variableItem.name;

      // Cancel any previous API calls for this variable immediately
      cancelAllVariableOperations(variableName);

      await loadSingleVariableDataByName(variableItem, false, filterText);
    };

    /**
     * Opens the Add Variable panel by emitting an event to the parent
     */
    const openAddVariable = () => {
      emit("openAddVariable");
    };

    return {
      props,
      variablesData,
      changeInitialVariableValues,
      onVariablesValueUpdated,
      loadVariableOptions,
      onVariableSearch,
      cancelAllVariableOperations,
      loadAllVariablesData, // Expose for manual triggering when lazy loading
      openAddVariable,
    };
  },
});
</script>

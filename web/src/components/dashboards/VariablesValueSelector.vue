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
      :data-test="`dashboard-variable-${item.name}-container`"
    >
      <div v-if="item.type == 'query_values'">
        <VariableQueryValueSelector
          class="q-mr-lg q-mt-xs"
          v-show="!item.hideOnDashboard"
          v-model="item.value"
          :variableItem="item"
          @update:model-value="onVariablesValueUpdated(index)"
          :loadOptions="loadVariableOptions"
          @search="onVariableSearch(index, $event)"
          :data-test="`variable-selector-${item.name}`"
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
          readonly
          :data-test="`variable-selector-${item.name}`"
          @update:model-value="onVariablesValueUpdated(index)"
          borderless
          hide-bottom-space
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
          :data-test="`variable-selector-${item.name}`"
          @update:model-value="onVariablesValueUpdated(index)"
          borderless
          hide-bottom-space
        ></q-input>
      </div>
      <div v-else-if="item.type == 'custom'">
        <VariableCustomValueSelector
          v-show="!item.hideOnDashboard"
          class="q-mr-lg q-mt-xs"
          v-model="item.value"
          :variableItem="item"
          @update:model-value="onVariablesValueUpdated(index)"
          :data-test="`variable-selector-${item.name}`"
        />
      </div>
      <div v-else-if="item.type == 'dynamic_filters'">
        <VariableAdHocValueSelector
          class="q-mr-lg q-mt-xs"
          v-model="item.value"
          :variableItem="item"
          @update:model-value="onVariablesValueUpdated(index)"
          :data-test="`variable-selector-${item.name}`"
        />
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
import {
  getCurrentInstance,
  onMounted,
  onUnmounted,
  ref,
  watch,
  PropType,
  inject,
  computed,
  nextTick,
} from "vue";
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
} from "@/utils/zincutils";
import { buildVariablesDependencyGraph } from "@/utils/dashboard/variables/variablesDependencyUtils";
import useHttpStreaming from "@/composables/useStreamingSearch";
import { SELECT_ALL_VALUE } from "@/utils/dashboard/constants";
import { getVariableKey } from "@/composables/dashboard/useVariablesManager";

export default defineComponent({
  name: "VariablesValueSelector",
  props: {
    selectedTimeDate: {
      type: Object as PropType<any>,
      required: false,
    },
    variablesConfig: {
      type: Object as PropType<any>,
      required: false,
    },
    initialVariableValues: {
      type: Object as PropType<any>,
      required: false,
    },
    showDynamicFilters: {
      type: Boolean,
      default: false,
    },
    // New props for scoped variables
    scope: {
      type: String as PropType<"global" | "tabs" | "panels">,
      default: "global",
    },
    tabId: {
      type: String,
      default: undefined,
    },
    panelId: {
      type: String,
      default: undefined,
    },
    variablesManager: {
      type: Object as PropType<any>,
      default: undefined,
    },
    // When true, shows all visible variables (global + tab + panel) for the given context
    showAllVisible: {
      type: Boolean,
      default: false,
    },
    showAddVariableButton: {
      type: Boolean,
      default: false,
    },
  },
  emits: ["variablesData", "openAddVariable"],
  components: {
    VariableQueryValueSelector,
    VariableAdHocValueSelector,
    VariableCustomValueSelector,
  },
  setup(props: any, { emit }) {
    const store = useStore();
    // Try to inject variablesManager from parent (for backward compatibility)

    // Try to inject variablesManager from parent (for backward compatibility)
    const injectedManager = inject<any>("variablesManager", undefined);
    const manager = props.variablesManager || injectedManager;

    // Determine if we're using the new manager-based approach
    const useManager = !!manager;

    // Computed property to get filtered variables from manager
    const managerVariables = computed(() => {
      if (!useManager) return [];

      let variables: any[] = [];

      // If showAllVisible is true, return all visible variables for this context
      // This includes global + tab + panel variables
      if (props.showAllVisible) {
        variables =
          manager.getAllVisibleVariables(props.tabId, props.panelId) || [];
      } else {
        // Otherwise, return only variables from the specified scope
        const scopeKey = props.scope;

        if (scopeKey === "global") {
          variables = manager.variablesData.global || [];
        } else if (scopeKey === "tabs" && props.tabId) {
          variables = manager.variablesData.tabs[props.tabId] || [];
        } else if (scopeKey === "panels" && props.panelId) {
          variables = manager.variablesData.panels[props.panelId] || [];
        }
      }

      // Sort: dynamic filters should always appear at the end
      const dynamicFilters = variables.filter(
        (v) => v.type === "dynamic_filters",
      );
      const otherVariables = variables.filter(
        (v) => v.type !== "dynamic_filters",
      );

      return [...otherVariables, ...dynamicFilters];
    });

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

    // Flag to track initial load
    // const isInitialLoad = ref(true);

    const traceIdMapper = ref<{ [key: string]: string[] }>({});
    const variableFirstResponseProcessed = ref<{ [key: string]: boolean }>({});

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

    // onUnmounted want to cancel the values api call for all http2, and streaming
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
        // Mark as partially loaded
        variableObject.isVariablePartialLoaded = true;

        // Only notify manager and trigger children if the value actually changed
        // Check if value changed by comparing with oldVariablesData
        const previousValue = oldVariablesData[variableObject.name];
        const currentValue = variableObject.value;
        const valueChanged =
          Array.isArray(previousValue) && Array.isArray(currentValue)
            ? JSON.stringify(previousValue) !== JSON.stringify(currentValue)
            : previousValue !== currentValue;

        if (valueChanged) {
          // Update oldVariablesData
          oldVariablesData[variableObject.name] = currentValue;

          // Notify manager if using manager mode - this ensures children get updated even with no data
          if (useManager && manager) {
            const variableKey = getVariableKey(
              variableObject.name,
              variableObject.scope || "global",
              variableObject.tabId,
              variableObject.panelId,
            );
            manager.onVariablePartiallyLoaded(variableKey);
          }
        }

        finalizeVariableLoading(variableObject, true);
        emitVariablesData();
        return;
      }
      try {
        if (
          response.content?.results?.hits &&
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

            const isFirstResponse = variableObject.isVariablePartialLoaded === false;

            variableLog(
              variableObject.name,
              `Is first response: ${JSON.stringify(isFirstResponse)}`,
            );

            // Process the first response
            // Filter out only undefined values (keep null and empty strings)
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
                // Don't auto-set value to first option if dropdown was just opened
                // Only set default value during initial load or when explicitly needed
                variableLog(
                  variableObject.name,
                  `Old values not found - keeping existing value if set`,
                );

                // Only set to first option if current value is null/undefined/empty
                if (
                  variableObject.value === null ||
                  variableObject.value === undefined ||
                  (Array.isArray(variableObject.value) &&
                    variableObject.value.length === 0)
                ) {
                  // Don't auto-select a blank option as default. Find the first non-blank option.
                  if (variableObject.options.length) {
                    // Find the first non-blank option
                    const firstNonBlankOption = variableObject.options.find(
                      (opt: any) => opt.value !== "" && opt.label !== "<blank>",
                    );

                    if (firstNonBlankOption) {
                      // For multi-select, wrap in array; for single-select, use the value directly
                      variableObject.value = variableObject.multiSelect
                        ? [firstNonBlankOption.value]
                        : firstNonBlankOption.value;
                    } else {
                      // All options are blank - keep value unset
                      variableObject.value = variableObject.multiSelect ? [] : null;
                    }
                  } else {
                    variableObject.value = variableObject.multiSelect ? [] : null;
                  }
                }
              }

              const hasValueChanged =
                Array.isArray(originalValue) &&
                Array.isArray(variableObject.value)
                  ? JSON.stringify(originalValue) !==
                    JSON.stringify(variableObject.value)
                  : originalValue !== variableObject.value;

              // Check if variable now has a valid value (not null/undefined/empty)
              const hasValidValue =
                variableObject.value !== null &&
                variableObject.value !== undefined &&
                (!Array.isArray(variableObject.value) ||
                  variableObject.value.length > 0);

              // Mark as partially loaded
              variableObject.isVariablePartialLoaded = true;

              // Notify manager and trigger children if value changed
              // This includes both valid values AND null values (no data found)
              // Children need to be notified even when parent gets null so they can be set to null too
              if (hasValueChanged) {
                // Update oldVariablesData ONLY when value changes
                // This prevents duplicate child loads when value hasn't actually changed
                oldVariablesData[variableObject.name] = variableObject.value;

                // Notify manager if using manager mode
                if (useManager && manager) {
                  const variableKey = getVariableKey(
                    variableObject.name,
                    variableObject.scope || "global",
                    variableObject.tabId,
                    variableObject.panelId,
                  );
                  manager.onVariablePartiallyLoaded(variableKey);
                } else {
                  // Only use legacy child loading if not using manager
                  finalizePartialVariableLoading(variableObject, true);
                }
              }
            }
          } else {
            // No field hit found. If this is the first response, reset the variable.
            if (variableObject.isVariablePartialLoaded === false) {
              resetVariableState(variableObject);
              variableObject.isVariablePartialLoaded = true;
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

    const initializeStreamingConnection = (
      payload: any,
      variableObject: any,
    ): any => {
      // Use HTTP2/streaming for all dashboard variable values

      fetchQueryDataWithHttpStream(payload, {
        data: (p: any, r: any) => handleSearchResponse(p, r, variableObject),
        error: (p: any, r: any) => handleSearchError(p, r, variableObject),
        complete: (p: any, r: any) => handleSearchClose(p, r, variableObject),
        reset: handleSearchReset,
      });
    };
    const fetchFieldValuesWithWebsocket = (
      variableObject: any,
      queryContext: string,
    ) => {
      if (!variableObject?.query_data?.field) {
        return;
      }

      const startTime = props.selectedTimeDate?.start_time?.getTime();
      const endTime = props.selectedTimeDate?.end_time?.getTime();

      if (!startTime || !endTime) {
        // console.error("Invalid time range");
        return;
      }

      // Check if this operation was cancelled before proceeding
      if (currentlyExecutingPromises[variableObject.name] === null) {
        return;
      }

      // Set loading state before initiating WebSocket
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
        // Log the payload and trace id for debugging

        // Start new streaming connection
        initializeStreamingConnection(wsPayload, variableObject);
        addTraceId(variableObject.name, wsPayload.traceId);
      } catch (error) {
        variableObject.isLoading = false;
        variableObject.isVariableLoadingPending = false;
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
        } else if (item.type === "custom") {
          // For custom type variables, set first option as default if no initial value
          if (initialValue !== null && initialValue !== undefined &&
              (Array.isArray(initialValue) ? initialValue.length > 0 : true)) {
            // Use initial value if it exists
            variableData.value = initialValue;
          } else if (variableData.options && variableData.options.length > 0) {
            // Set first option as default value
            variableData.value = item.multiSelect
              ? [variableData.options[0].value]
              : variableData.options[0].value;
          } else {
            // No options available, set to null/empty array
            variableData.value = item.multiSelect ? [] : null;
          }
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

        // set old variables data - use the actual value that was set (which might be custom value, not just initialValue)
        oldVariablesData[item.name] = variableData.value !== undefined ? variableData.value : initialValue;

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

    // Sync manager variables to local state when using manager
    const syncManagerVariablesToLocal = () => {
      if (!useManager) return;

      const managedVars = managerVariables.value;
      if (!managedVars || managedVars.length === 0) {
        variablesData.values = [];
        return;
      }

      variablesData.values = managedVars;

      // REBUILD dependency graph from updated variables
      // This is needed for the logic below (isChildVariable) and other component functions
      variablesDependencyGraph = buildVariablesDependencyGraph(
        variablesData.values,
      );

      // Synchronize oldVariablesData with current manager state
      // This is critical for child variables that get reset by the manager
      // When a parent changes, manager resets children to [] or null
      // We must update oldVariablesData so handleQueryValuesLogic doesn't restore old values
      managedVars.forEach((v: any) => {
        const oldValue = oldVariablesData[v.name];
        const currentValue = v.value;

        // CRITICAL FIX: If manager has reset a variable's value to null/empty array,
        // we MUST clear oldVariablesData immediately, otherwise the old value will be
        // restored when API response arrives
        const managerHasResetValue =
          (currentValue === null || (Array.isArray(currentValue) && currentValue.length === 0)) &&
          oldValue !== undefined &&
          oldValue !== null &&
          (!Array.isArray(oldValue) || oldValue.length > 0);

        if (managerHasResetValue) {
          // Manager reset this variable - clear oldVariablesData so it gets fresh value from API
          oldVariablesData[v.name] = undefined;
          return; // Skip further processing for this variable
        }

        // Check if variable is in reset state (null or empty array)
        const isCurrentlyReset =
          currentValue === null ||
          (Array.isArray(currentValue) && currentValue.length === 0);

        // Check if variable has a valid value (was set from URL or user selection)
        const hasValidValue =
          currentValue !== null &&
          currentValue !== undefined &&
          (!Array.isArray(currentValue) || currentValue.length > 0);

        // Check if this is a child variable
        const isChildVariable =
          variablesDependencyGraph[v.name]?.parentVariables?.length > 0;

        // Check if variable has custom or "all" default selection configured
        const hasCustomOrAllDefault =
          v.selectAllValueForMultiSelect === "custom" ||
          v.selectAllValueForMultiSelect === "all";

        // If currently reset AND variable is marked as pending (about to load)
        // OR if options are empty (was reset), then clear oldVariablesData
        // so it selects first option when data arrives
        // UNLESS the variable has a valid value (from URL or user), in which case preserve it
        // IMPORTANT: For child variables, ALWAYS clear oldVariablesData when reset, even if custom/all is configured
        // This ensures child variables update based on parent changes, not initial custom/all values
        if (
          isCurrentlyReset &&
          (v.isVariableLoadingPending || v.options.length === 0)
        ) {
          // For child variables, always clear oldVariablesData on reset regardless of custom/all config
          // For parent variables, only clear if not custom/all default
          if (isChildVariable || !hasCustomOrAllDefault) {
            // Set to undefined so the selector properly handles first-time selection
            oldVariablesData[v.name] = undefined;
          }
        } else if (hasValidValue && oldVariablesData[v.name] === undefined) {
          // If variable has a valid value (e.g., from URL) and oldVariablesData is undefined,
          // sync it so the value is preserved when API response arrives
          oldVariablesData[v.name] = currentValue;
        } else if (hasCustomOrAllDefault && oldVariablesData[v.name] === undefined && !isChildVariable) {
          // If variable has custom or "all" default configured but oldVariablesData is undefined,
          // set it to the configured default value so it gets applied when API response arrives
          // BUT only for parent variables (non-child), not for child variables
          if (v.selectAllValueForMultiSelect === "custom" && v.customMultiSelectValue?.length > 0) {
            oldVariablesData[v.name] = v.multiSelect
              ? v.customMultiSelectValue
              : v.customMultiSelectValue[0];
          } else if (v.selectAllValueForMultiSelect === "all") {
            oldVariablesData[v.name] = v.multiSelect
              ? [SELECT_ALL_VALUE]
              : SELECT_ALL_VALUE;
          }
        }
      });
    };

    onMounted(() => {
      // Skip initialization if using manager - manager handles everything
      if (useManager) {
        // For manager mode, sync immediately on mount
        syncManagerVariablesToLocal();
        return;
      }

      // Legacy behavior: make list of variables using variables config list
      initializeVariablesData();

      // reject all promises
      rejectAllPromises();

      // load all variables
      loadAllVariablesData(true);

      // Set initial load flag to false after first load
      // isInitialLoad.value = false;
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
      async () => {
        // Skip if using manager - manager handles config changes
        if (useManager) {
          return;
        }

        // Legacy behavior: Reset initial load flag when config changes
        // isInitialLoad.value = true;

        // make list of variables using variables config list
        initializeVariablesData();

        // reject all promises
        rejectAllPromises();
        skipAPILoad.value = false;
        // load all variables
        loadAllVariablesData(true);

        // Set initial load flag to false after load
        // isInitialLoad.value = false;
      },
    );

    // Declare functions that will be defined later (after loadSingleVariableDataByName)
    // This allows watchers to reference them
    let loadDependentVariable: (index: number) => Promise<void>;
    let checkAndLoadPendingVariables: () => void;

    // Watch manager variables for changes and sync to local state
    // We need to watch with deep: true to detect when manager mutates individual variables
    watch(
      () => {
        if (!useManager || !manager) return [];
        // Watch the managerVariables computed property directly
        // This handles both single-scope and showAllVisible modes
        return managerVariables.value;
      },
      () => {
        if (!useManager) return;

        syncManagerVariablesToLocal();
        
        // Check for pending variables that need to be loaded
        // Use nextTick to ensure DOM and state are updated
        nextTick(() => {
          if (checkAndLoadPendingVariables) {
            checkAndLoadPendingVariables();
          }
        });
      },
      { deep: true, immediate: true },
    );

    // Note: We don't need to watch for completion and trigger children here
    // The manager's finalizeVariableLoading already handles triggering dependent children
    // when a variable finishes loading. Adding a watcher here would be redundant
    // and could cause issues since variablesData.values is a direct reference to manager's arrays.

    // you may need to query the data if the variable configs or the data/time changes
    // watch(
    //   () => props.selectedTimeDate,
    //   () => {
    //     // reject all promises
    //     rejectAllPromises();

    //     // loadAllVariablesData(false);
    //     skipAPILoad.value = true;
    //   },
    // );
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
      // Check if this is a child variable (declare at the beginning to avoid scoping issues)
      const isChildVariable =
        variablesDependencyGraph[currentVariable.name]?.parentVariables
          ?.length > 0;

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

        // Check if old values should be preserved based on selectAllValueForMultiSelect setting
        // Filter out undefined values - when oldVariablesData is cleared, it becomes [undefined]
        const validOldValues = Array.isArray(oldVariableSelectedValues)
          ? oldVariableSelectedValues.filter(v => v !== undefined && v !== null)
          : [];
        const hasOldValues = validOldValues.length > 0;

        if (hasOldValues) {
          // Only preserve custom/all values for non-child variables
          // Child variables should always update based on parent changes
          if (!isChildVariable) {
            // Check if we should preserve custom values
            if (
              currentVariable?.selectAllValueForMultiSelect === "custom" &&
              currentVariable?.customMultiSelectValue?.length > 0 &&
              JSON.stringify(validOldValues.sort()) === JSON.stringify(currentVariable.customMultiSelectValue.sort())
            ) {
              // Preserve custom values even if not in options
              currentVariable.value = currentVariable.customMultiSelectValue;
              return;
            }

            // Check if we should preserve "all" value
            if (
              currentVariable?.selectAllValueForMultiSelect === "all" &&
              validOldValues.includes(SELECT_ALL_VALUE)
            ) {
              // Preserve "all" selection
              currentVariable.value = [SELECT_ALL_VALUE];
              return;
            }
          }
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

      // Check for URL values first
      // const urlValue = props.initialVariableValues?.value[currentVariable.name];
      // if (urlValue) {
      //   // If URL value exists, use it
      //   if (currentVariable.multiSelect) {
      //     currentVariable.value = Array.isArray(urlValue)
      //       ? urlValue
      //       : [urlValue];
      //   } else {
      //     // For single select, if coming from multiSelect, take first value
      //     currentVariable.value = Array.isArray(urlValue)
      //       ? urlValue[0]
      //       : urlValue;
      //   }
      //   currentVariable.isVariableLoadingPending = true;
      //   return;
      // }

      // Only apply custom values if:
      // 1. Not a child variable (child variables should update based on parent)
      // 2. oldVariablesData is undefined (initial load, not parent-triggered reload)
      if (
        !isChildVariable &&
        oldVariablesData[currentVariable.name] === undefined &&
        currentVariable?.selectAllValueForMultiSelect === "custom" &&
        currentVariable?.customMultiSelectValue?.length > 0
      ) {
        currentVariable.value = currentVariable.multiSelect
          ? currentVariable.customMultiSelectValue
          : currentVariable.customMultiSelectValue[0];
        currentVariable.isVariableLoadingPending = true;
        return;
      }

      // Apply "all" value if configured (for both multiSelect and single-select)
      // Only for parent variables on initial load
      if (
        !isChildVariable &&
        oldVariablesData[currentVariable.name] === undefined &&
        currentVariable?.selectAllValueForMultiSelect === "all"
      ) {
        currentVariable.value = currentVariable.multiSelect
          ? [SELECT_ALL_VALUE]
          : SELECT_ALL_VALUE;
        currentVariable.isVariableLoadingPending = true;
        return;
      }

      // Pre-calculate the options values array
      const optionsValues =
        currentVariable.options.map((option: any) => option.value) ?? [];

      // For single select, handle old value selection
      if (!currentVariable.multiSelect) {
        // Check if custom value should be preserved (even if not in options)
        if (
          currentVariable.selectAllValueForMultiSelect === "custom" &&
          currentVariable.customMultiSelectValue?.length > 0 &&
          oldVariableSelectedValues[0] === currentVariable.customMultiSelectValue[0]
        ) {
          // Preserve the custom value even if it's not in the API options
          currentVariable.value = currentVariable.customMultiSelectValue[0];
          return;
        }

        // Check if "all" value should be preserved for single-select
        if (
          currentVariable.selectAllValueForMultiSelect === "all" &&
          oldVariableSelectedValues[0] === SELECT_ALL_VALUE
        ) {
          // Preserve the "all" value
          currentVariable.value = SELECT_ALL_VALUE;
          return;
        }

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
              customValue?.value ?? currentVariable.customMultiSelectValue?.[0] ?? currentVariable.options[0].value;
          } else if (currentVariable.selectAllValueForMultiSelect === "all") {
            // Use SELECT_ALL_VALUE for single-select "all"
            currentVariable.value = SELECT_ALL_VALUE;
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
    const loadSingleVariableDataByName = async (
      variableObject: any,
      isInitialLoad: boolean = false,
      searchText?: string,
    ) => {
      return new Promise(async (resolve, reject) => {
        const { name } = variableObject;

        if (!name || !variableObject) {
          // console.error("Invalid variable object", variableObject);
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
        // SKIP dependency check if using manager - manager already handled this
        if (hasParentVariables && !useManager) {
          variableLog(
            variableObject.name,
            `Checking parent variables readiness (legacy mode)`,
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

        // Update oldVariablesData to reflect the current (possibly reset) value
        // This ensures handleQueryValuesLogic uses the correct baseline
        // IMPORTANT: Don't overwrite if it's undefined (signals first-time load)
        // syncManagerVariablesToLocal sets it to undefined to indicate variables should auto-select first option
        // ALSO: Don't overwrite to null/empty - keep it undefined so first option gets selected
        if (oldVariablesData[name] !== undefined) {
          // Only update if the value is not null/empty (i.e., was explicitly set by user)
          const hasValue =
            variableObject.value !== null &&
            variableObject.value !== undefined &&
            (!Array.isArray(variableObject.value) ||
              variableObject.value.length > 0);
          if (hasValue) {
            oldVariablesData[name] = variableObject.value;
          }
        }

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
          // Check if variable has custom or "all" default selection
          // If so, skip API call during initial load as the value is already set from settings
          const hasCustomOrAllDefault =
            variableObject.selectAllValueForMultiSelect === "custom" ||
            variableObject.selectAllValueForMultiSelect === "all";

          // for initial loading check if the value is already available,
          // do not load the values
          if (isInitialLoad && !searchText) {
            variableLog(
              variableObject.name,
              `Initial load check for variable: ${variableObject.name}, hasCustomOrAllDefault: ${hasCustomOrAllDefault}, value: ${JSON.stringify(variableObject.value)}`,
            );

            if (hasCustomOrAllDefault) {
              variableLog(
                variableObject.name,
                `Variable has custom or "all" default - skipping API call on initial load`,
              );

              // Ensure value is set according to the configuration
              if (variableObject.selectAllValueForMultiSelect === "custom" &&
                  variableObject.customMultiSelectValue?.length > 0) {
                variableObject.value = variableObject.multiSelect
                  ? variableObject.customMultiSelectValue
                  : variableObject.customMultiSelectValue[0];
              } else if (variableObject.selectAllValueForMultiSelect === "all") {
                // Set "all" value for both multiSelect and single-select
                variableObject.value = variableObject.multiSelect
                  ? [SELECT_ALL_VALUE]
                  : SELECT_ALL_VALUE;
              }

              // Update oldVariablesData to track the initial value
              oldVariablesData[variableObject.name] = variableObject.value;

              // Mark as loaded without making API call
              finalizePartialVariableLoading(
                variableObject,
                true,
                isInitialLoad,
              );
              finalizeVariableLoading(variableObject, true);
              emitVariablesData();
              return true;
            }

            // check for value not null or in case of array it should not be empty array
            // if the value is already set AND has options loaded, we don't need to load it again
            // BUT if it has a value from URL but no options yet, we need to load options
            const hasValue =
              variableObject.value !== null &&
              variableObject.value !== undefined &&
              (!Array.isArray(variableObject.value) ||
                variableObject.value.length > 0);

            const hasOptions =
              variableObject.options &&
              Array.isArray(variableObject.options) &&
              variableObject.options.length > 0;

            if (hasValue && hasOptions) {
              // Has both value and options - no need to reload
              finalizePartialVariableLoading(
                variableObject,
                true,
                isInitialLoad,
              );
              finalizeVariableLoading(variableObject, true);
              emitVariablesData();
              return true;
            }
            // If has value but no options (e.g., from URL), continue to load options below
          }

          try {
            const queryContext: any = await buildQueryContext(
              variableObject,
              searchText,
            );

            // Use HTTP2/streaming for all dashboard variable values
            // We don't need to wait for the response here as it will be handled by the streaming handlers
            fetchFieldValuesWithWebsocket(variableObject, queryContext);
            return true;
          } catch (error) {
            resetVariableState(variableObject);
            variableObject.isLoading = false;
            variableObject.isVariableLoadingPending = false;
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

    // ========== MANAGER-MODE FUNCTIONS ==========
    // These functions are used when the component is in manager mode
    // They must be defined after loadSingleVariableDataByName since they depend on it

    // Load a specific dependent variable (called by manager when dependencies are ready)
    loadDependentVariable = async (index: number) => {
      const variable = variablesData.values[index];
      if (!variable) return;

      // Mark as loading
      variable.isLoading = true;
      variable.isVariableLoadingPending = false;

      try {
        // Use the legacy function that actually makes the API call
        // Don't use loadVariableOptions as it delegates back to manager (circular)
        await loadSingleVariableDataByName(variable, false);
      } catch (error) {
        variable.isLoading = false;
      }
    };

    // Load variables that are marked as pending by the manager
    checkAndLoadPendingVariables = () => {
      if (!useManager) return;

      variablesData.values.forEach((variable: any, index: number) => {
        // Only load query_values type that are marked as pending and not currently loading
        if (
          variable.type === "query_values" &&
          variable.isVariableLoadingPending === true &&
          variable.isLoading !== true
        ) {
          // Fire the API call for this variable
          loadDependentVariable(index);
        }
      });
    };

    // Note: triggerDependentChildren is not needed - the manager handles this
    // The manager's finalizeVariableLoading function automatically triggers children
    // when a variable completes loading (see useVariablesManager.ts line 647-671)

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
      // When using manager, get all visible variables (global + tab + panel)
      // Otherwise, use local variablesData.values (legacy mode)
      let variablesToResolve = variablesData.values;
      if (useManager && manager) {
        // Get all visible variables for this scope
        // This includes global, tab-scoped (if in a tab), and panel-scoped (if in a panel)
        variablesToResolve =
          manager.getAllVisibleVariables(props.tabId, props.panelId) ||
          variablesData.values;
      }

      for (const variable of variablesToResolve) {
        // Skip dynamic_filters as they don't participate in standard variable replacement
        // and their value structure (array of objects) causes issues with escapeSingleQuotes
        if (variable.type === "dynamic_filters") continue;

        if (variable.isVariablePartialLoaded) {
          // Escape special regex characters in variable name
          const escapedVarName = variable.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

          // Replace array values
          if (Array.isArray(variable.value)) {
            const arrayValues = variable.value
              .map((value: any) => `'${escapeSingleQuotes(value)}'`)
              .join(", ");

            // Create regex patterns to replace all occurrences
            // Pattern 1: Unquoted placeholder like IN($variable) -> IN('val1', 'val2')
            const unquotedPattern = new RegExp(`\\$${escapedVarName}(?!')`, 'g');
            // Pattern 2: Quoted placeholder like '$variable' -> 'val1', 'val2'
            const quotedPattern = new RegExp(`'\\$${escapedVarName}'`, 'g');

            // First replace unquoted patterns (for IN clauses)
            queryContext = queryContext.replace(
              unquotedPattern,
              arrayValues,
            );
            // Then replace quoted patterns
            queryContext = queryContext.replace(
              quotedPattern,
              arrayValues,
            );
          } else if (variable.value !== null && variable.value !== undefined) {
            // Replace single values with regex to replace all occurrences
            const replacedValue = escapeSingleQuotes(variable.value);
            const pattern = new RegExp(`\\$${escapedVarName}`, 'g');
            queryContext = queryContext.replace(
              pattern,
              replacedValue,
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
      const fieldHit = hits.find(
        (field: any) => field.field === variableObject.query_data.field,
      );

      if (fieldHit) {
        // Extract the values for the specified field from the result
        // Filter out undefined, null, and empty strings
        const newOptions = fieldHit.values
          .filter(
            (value: any) =>
              value.zo_sql_key !== undefined &&
              value.zo_sql_key !== null &&
              value.zo_sql_key !== "",
          )
          .map((value: any) => ({
            label: value.zo_sql_key.toString(),
            value: value.zo_sql_key.toString(),
          }));

        // Efficiently add the selected value to options if not present
        if (variableObject.multiSelect && Array.isArray(variableObject.value)) {
          const val = variableObject.value[0];
          if (
            val !== undefined &&
            val !== null &&
            !newOptions.some((opt) => opt.value === val) &&
            val !== SELECT_ALL_VALUE
          ) {
            newOptions.push({ label: val, value: val });
          }
        } else if (
          !variableObject.multiSelect &&
          variableObject.value !== null &&
          variableObject.value !== undefined &&
          !newOptions.some((opt) => opt.value === variableObject.value) &&
          variableObject.value !== SELECT_ALL_VALUE
        ) {
          newOptions.push({
            label: variableObject.value,
            value: variableObject.value,
          });
        }

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
              // If no valid old values, use first non-blank option
              const firstNonBlank = newOptions.find(
                (opt: any) => opt.value !== "" && opt.label !== "<blank>",
              );
              variableObject.value = variableObject.multiSelect
                ? firstNonBlank
                  ? [firstNonBlank.value]
                  : []
                : firstNonBlank
                  ? firstNonBlank.value
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
          // Set default value to the first non-blank option if no old values are available
          const firstNonBlank = newOptions.find(
            (opt: any) => opt.value !== "" && opt.label !== "<blank>",
          );
          variableObject.value = variableObject.multiSelect
            ? firstNonBlank
              ? [firstNonBlank.value]
              : []
            : firstNonBlank
              ? firstNonBlank.value
              : null;
        }
      } else {
        // Reset variable state if no field values are available
        resetVariableState(variableObject);
      }
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

        // Don't load child variables on dropdown open events
        // Load child variables if any
        // const childVariables =
        //   variablesDependencyGraph[name]?.childVariables || [];
        // if (childVariables.length > 0) {
        //   const childVariableObjects = variablesData.values.filter(
        //     (variable: any) => childVariables.includes(variable.name),
        //   );

        //   // Only load children if the parent value actually changed
        //   if (oldVariablesData[name] !== variableObject.value) {
        //     await Promise.all(
        //       childVariableObjects.map((childVariable: any) =>
        //         loadSingleVariableDataByName(childVariable),
        //       ),
        //     );
        //   }
        // }

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

        // Update old variables data and determine whether to load children
        const childVariables =
          variablesDependencyGraph[name]?.childVariables || [];

        variableLog(
          variableObject.name,
          `finalizePartialVariableLoading: child variables: ${JSON.stringify(childVariables)}`,
        );

        // Only load child variables if this is the initial load, or the variable value actually changed
        const previousValue = oldVariablesData[name];
        const currentValue = variableObject.value;
        const valueChanged =
          Array.isArray(previousValue) && Array.isArray(currentValue)
            ? JSON.stringify(previousValue) !== JSON.stringify(currentValue)
            : previousValue !== currentValue;

        variableLog(
          variableObject.name,
          `finalizePartialVariableLoading: prev=${JSON.stringify(previousValue)} curr=${JSON.stringify(currentValue)} changed=${valueChanged}`,
        );

        if (childVariables.length > 0 && (isInitialLoad || valueChanged)) {
          const childVariableObjects = variablesData.values.filter(
            (variable: any) => childVariables.includes(variable.name),
          );

          for (const childVariable of childVariableObjects) {
            await loadSingleVariableDataByName(childVariable, false);
          }
        } else {
          variableLog(
            variableObject.name,
            "Skipping child load: no change and not initial load",
          );
        }

        // Finally, update the old variable value snapshot
        oldVariablesData[name] = variableObject.value;
      } catch (error) {
        // console.error(`Error finalizing partial variable loading for ${variableObject.name}:`, error);
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

      // Set loading state for all variables
      // Skip setting isVariableLoadingPending for custom/"all" variables during initial load
      variablesData.values.forEach((variable: any) => {
        // Check if variable has custom or "all" default selection
        const hasCustomOrAllDefault =
          variable.type === "query_values" &&
          (variable.selectAllValueForMultiSelect === "custom" ||
            variable.selectAllValueForMultiSelect === "all");

        // Only set pending state if not initial load OR not custom/all variable
        if (!isInitialLoad || !hasCustomOrAllDefault) {
          variable.isVariableLoadingPending = true;
        }
      });

      // Find all independent variables (variables with no dependencies)
      const independentVariables = variablesData.values.filter(
        (variable: any) =>
          !variablesDependencyGraph[variable.name]?.parentVariables?.length,
      );

      // console.groupCollapsed("Loading independent variables:");
      // console.log(JSON.stringify(independentVariables, null, 2));
      // console.groupEnd();

      // Find all dependent variables (variables with dependencies)
      const dependentVariables = variablesData.values.filter(
        (variable: any) =>
          variablesDependencyGraph[variable.name]?.parentVariables?.length > 0,
      );

      try {
        // Load all independent variables
        await Promise.all(
          independentVariables.map((variable: any) =>
            loadSingleVariableDataByName(variable, isInitialLoad),
          ),
        );
      } catch (error) {
        await Promise.all(
          independentVariables.map((variable: any) =>
            finalizeVariableLoading(variable, false),
          ),
        );
      }

      // const loadDependentVariables = async () => {
      //   for (const variable of dependentVariables) {
      //     // Find all parent variables of the current variable
      //     const parentVariables =
      //       variablesDependencyGraph[variable.name].parentVariables;
      //     // Check if all parent variables are loaded
      //     const areParentsLoaded = parentVariables.every(
      //       (parentName: string) => {
      //         const parentVariable = variablesData.values.find(
      //           (v: any) => v.name === parentName,
      //         );
      //         return (
      //           parentVariable &&
      //           !parentVariable.isLoading &&
      //           !parentVariable.isVariableLoadingPending &&
      //           parentVariable.value !== null
      //         );
      //       },
      //     );

      //     // If all parent variables are loaded, load the current variable
      //     if (areParentsLoaded) {
      //       await loadSingleVariableDataByName(variable);
      //     }
      //   }
      // };

      // // Attempt to load dependent variables up to 3 times
      // for (let attempt = 0; attempt < 3; attempt++) {
      //   await loadDependentVariables();

      //   // Check if all variables are loaded
      //   const allLoaded = variablesData.values.every(
      //     (variable: any) =>
      //       !variable.isLoading && !variable.isVariableLoadingPending,
      //   );

      //   // If all variables are loaded, break the loop
      //   if (allLoaded) break;
      // }

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

      // If using manager, delegate to manager's updateVariableValue
      if (useManager && manager) {
        try {
          await manager.updateVariableValue(
            currentVariable.name,
            currentVariable.scope || "global",
            currentVariable.tabId,
            currentVariable.panelId,
            currentVariable.value,
          );
          return; // Manager handles all downstream updates
        } catch (error) {
          // Fall through to legacy behavior on error
        }
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
        // CRITICAL: Clear oldVariablesData for child variables when parent changes
        // This ensures they don't preserve custom/all values from initial load
        oldVariablesData[variable.name] = undefined;
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

      // 2. Cancel any ongoing WebSocket/Streaming operations
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

      // If variables are still loading (either manager-level or local), defer search until loading finishes
      const managerLoading =
        useManager &&
        manager &&
        (manager as any).isLoading &&
        (manager as any).isLoading.value;
      const localLoading = variablesData.values.some(
        (v: any) => v.isLoading === true || v.isVariablePartialLoaded === false,
      );

      if (managerLoading || localLoading) {
        const stop = watch(
          () =>
            useManager && manager && (manager as any).isLoading
              ? (manager as any).isLoading.value
              : variablesData.values.some(
                  (v: any) =>
                    v.isLoading === true || v.isVariablePartialLoaded === false,
                ),
          (val) => {
            if (!val) {
              stop();
              // Re-run the search once loading has completed
              cancelAllVariableOperations(variableName);
              loadSingleVariableDataByName(
                variableItem,
                false,
                filterText,
              ).catch(() => {});
            }
          },
        );
        return;
      }

      // If there's no filter text (user did not type), treat this as an open event.
      // In that case, only load options if they are not already present/loaded.
      if (
        !filterText ||
        (typeof filterText === "string" && filterText.trim() === "")
      ) {
        // Delegate to loadVariableOptions which contains the logic to avoid unnecessary fetches
        cancelAllVariableOperations(variableName);
        await loadVariableOptions(variableItem);
        return;
      }

      // Cancel any previous API calls for this variable immediately
      cancelAllVariableOperations(variableName);
      await loadSingleVariableDataByName(variableItem, false, filterText);
    };

    return {
      props,
      variablesData,
      changeInitialVariableValues,
      onVariablesValueUpdated,
      loadVariableOptions,
      onVariableSearch,
      cancelAllVariableOperations,
      openAddVariable: () => emit("openAddVariable"),
    };
  },
});
</script>

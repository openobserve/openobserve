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
  <!-- {{ filteredVariablesData.values }} -->
  <div
    v-if="filteredVariablesData.values?.length > 0"
    :key="filteredVariablesData.isVariablesLoading"
    class="flex q-mt-xs q-ml-xs"
  >
    <div
      v-for="(item, index) in filteredVariablesData.values"
      :key="
        item.name +
        item.value +
        item.type +
        item.options?.length +
        item.isLoading +
        item.isVariableLoadingPending +
        index
      "
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
import {
  getCurrentInstance,
  onMounted,
  ref,
  watch,
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
import { b64EncodeUnicode, escapeSingleQuotes } from "@/utils/zincutils";
import { buildVariablesDependencyGraph } from "@/utils/dashboard/variables/variablesDependencyUtils";
import { b } from "vitest/dist/chunks/suite.BJU7kdY9";

export default defineComponent({
  name: "VariablesValueSelector",
  props: {
    selectedTimeDate: Object,
    variablesConfig: Object,
    initialVariableValues: Object,
    showDynamicFilters: Boolean,
    scope: {
      type: String,
      default: "global",
      validator: (value: any) => ["global", "tabs", "panels"].includes(value),
    },
    currentTabId: {
      type: String,
      default: null,
    },
    currentPanelId: {
      type: String,
      default: null,
    },
  },
  emits: ["variablesData", "variable-dependency-update"],
  components: {
    VariableQueryValueSelector,
    VariableAdHocValueSelector,
    VariableCustomValueSelector,
  },
  setup(props: any, { emit }) {
    console.log("props.variablesConfig", props.variablesConfig);

    const instance = getCurrentInstance();
    const store = useStore();

    // Create a computed property to filter variables based on scope
    const filteredVariablesConfig = computed(() => {
      if (!props.variablesConfig?.list) return { list: [] };

      let filteredList = [];

      switch (props.scope) {
        case "global":
          filteredList = props.variablesConfig.list.filter(
            (variable: any) => !variable.scope || variable.scope === "global",
          );
          break;

        case "tabs":
          filteredList = props.variablesConfig.list.filter(
            (variable: any) =>
              variable.scope === "tabs" &&
              variable.tabs?.includes(props.currentTabId),
          );
          break;

        case "panels":
          filteredList = props.variablesConfig.list.filter(
            (variable: any) =>
              variable.scope === "panels" &&
              variable.tabs?.includes(props.currentTabId) &&
              variable.panels?.includes(props.currentPanelId),
          );
          break;
      }

      return {
        ...props.variablesConfig,
        list: filteredList,
      };
    });

    // variables data derived from the complete variables config list
    const completeVariablesData: any = reactive({
      isVariablesLoading: false,
      values: [],
    });

    // The filtered version of variablesData that will be used in the template
    const filteredVariablesData: any = reactive({
      isVariablesLoading: false,
      values: [],
    });
    // variables dependency graph - built from complete variables list
    let variablesDependencyGraph: any = {};
    // track old variables data
    const oldVariablesData: any = reactive({});
    // currently executing promise
    // obj will have variable name as key
    // and reject object of promise as value
    const currentlyExecutingPromises: any = {};

    // Initialize variables data from props
    const initializeVariablesData = () => {
      // Reset both complete and filtered data
      completeVariablesData.isVariablesLoading = false;
      completeVariablesData.values = [];
      filteredVariablesData.isVariablesLoading = false;
      filteredVariablesData.values = [];

      if (!props?.variablesConfig) {
        return;
      }

      // make list of variables using variables config list
      // set initial variables values from props
      // Initialize complete variables data first
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

        if (item.multiSelect) {
          initialValue = Array.isArray(initialValue)
            ? initialValue
            : [initialValue];
        }
        const variableData = {
          ...item,
          // isLoading is used to check that currently, if the variable is loading(it is used to show the loading icon)
          isLoading: false,
          // isVariableLoadingPending is used to check that variable loading is pending
          // if parent variable is not loaded or it's value is changed, isVariableLoadingPending will be true
          isVariableLoadingPending: true,
        };
        // need to use initial value
        // also, constant type variable should not be updated
        if (item.type != "constant") {
          // for textbox type variable, if initial value is not exist, use the default value
          if (item.type == "textbox") {
            variableData.value = initialValue ?? variableData.value;
          } else {
            // use the initial value
            variableData.value = initialValue;
          }
        }

        // Add to complete variables data
        completeVariablesData.values.push(variableData);
        // set old variables data
        oldVariablesData[item.name] = JSON.parse(JSON.stringify(initialValue));
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
        completeVariablesData.values.push({
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
      // Build dependency graph from complete variables list
      variablesDependencyGraph = buildVariablesDependencyGraph(
        completeVariablesData.values,
      );

      // Filter variables for UI based on scope
      updateFilteredVariables();
    };

    // Function to update filtered variables based on scope
    // Replace updateFilteredVariables with:
    const updateFilteredVariables = () => {
      const newFilteredValues = completeVariablesData.values.filter(
        (variable: any) => {
          switch (props.scope) {
            case "global":
              return !variable.scope || variable.scope === "global";
            case "tabs":
              return (
                variable.scope === "tabs" &&
                variable.tabs?.includes(props.currentTabId)
              );
            case "panels":
              return (
                variable.scope === "panels" &&
                variable.tabs?.includes(props.currentTabId) &&
                variable.panels?.includes(props.currentPanelId)
              );
            default:
              return true;
          }
        },
      );

      // Clear and replace the array to ensure Vue detects the change
      filteredVariablesData.values.length = 0;
      newFilteredValues.forEach((v: any) => {
        // Create a fresh copy to ensure reactivity
        filteredVariablesData.values.push({ ...v });
      });
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
    });

    // Watch for changes in filtered variables config
    watch(
      () => filteredVariablesConfig.value,
      async () => {
        // make list of variables using variables config list
        initializeVariablesData();

        // reject all promises
        rejectAllPromises();
        skipAPILoad.value = false;
        loadAllVariablesData(true);
      },
      { deep: true },
    );

    // Also watch for changes in scope, currentTabId, and currentPanelId
    watch(
      [() => props.scope, () => props.currentTabId, () => props.currentPanelId],
      async () => {
        initializeVariablesData();

        rejectAllPromises();
        skipAPILoad.value = false;
        loadAllVariablesData(true);
      },
    );

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
      () => filteredVariablesData,
      () => {
        emitVariablesData();
      },
      { deep: true },
    );
    // Emit updated variables data to parent
    const emitVariablesData = () => {
      emit("variablesData", JSON.parse(JSON.stringify(filteredVariablesData)));
    };

    // Emit dependency update to notify other components
    const emitDependencyUpdate = (sourceName: any, affectedVariables: any) => {
      emit("variable-dependency-update", {
        source: sourceName,
        affected: affectedVariables,
        updatedCompleteData: JSON.parse(JSON.stringify(completeVariablesData)),
        scope: props.scope,
      });
    };

    // it is used to change/update initial variables values from outside the component
    // NOTE: right now, it is not used after variables in variables feature
    const changeInitialVariableValues = async (
      newInitialVariableValues: any,
    ) => {
      rejectAllPromises();

      // NOTE: need to re-initialize variables data
      completeVariablesData.isVariablesLoading = false;
      completeVariablesData.values = [];
      filteredVariablesData.isVariablesLoading = false;
      filteredVariablesData.values = [];

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
      // Pre-calculate the options values array
      const optionsValues =
        currentVariable.options.map((option: any) => option.value) ?? [];

      // if multi select
      if (currentVariable.multiSelect) {
        // old selected values
        const selectedValues = currentVariable.options
          .filter((option: any) =>
            oldVariableSelectedValues.includes(option.value),
          )
          .map((option: any) => option.value);

        // if selected values exist, select the values
        if (selectedValues.length > 0) {
          currentVariable.value = selectedValues;
        } else {
          //here, multiselect and old values will be not exist

          switch (currentVariable?.selectAllValueForMultiSelect) {
            case "custom":
              currentVariable.value = optionsValues.filter((value: any) =>
                currentVariable?.customMultiSelectValue.includes(value),
              );
              break;
            case "all":
              currentVariable.value = optionsValues;
              break;
            default:
              currentVariable.value = [currentVariable.options[0].value];
          }
        }
      } else {
        // here, multi select is false

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
                currentVariable.customMultiSelectValue[0],
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
        // old selected values
        const selectedValues = currentVariable.options
          .filter((option: any) =>
            oldVariableSelectedValues.includes(option.value),
          )
          .map((option: any) => option.value);

        // if old selected values exist, select the values
        if (selectedValues.length > 0) {
          currentVariable.value = selectedValues;
        } else {
          // here, multiselect is true and old values will be not exist

          // if custom value is not defined, select the first option
          // NOTE: this is the same logic as before but with a simpler way to understand
          currentVariable.value =
            selectedOptionsValues.length > 0
              ? selectedOptionsValues
              : [currentVariable?.options?.[0]?.value];
        }
      } else {
        // here, multi select is false

        // old selected value
        const oldValue = currentVariable.options.find(
          (option: any) => option.value === oldVariableSelectedValues[0],
        )?.value;

        // if old value exist, select the old value
        if (oldValue) {
          currentVariable.value = oldValue;
        } else if (currentVariable.options.length > 0) {
          // here, multi select is false and old value not exist

          // if custom value is not defined, select the first option
          // NOTE: this is the same logic as before but with a simpler way to understand
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
        const parentVariable = completeVariablesData.values.find(
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

    const refreshVariableInArrays = (variableName: any, updates: any) => {
      // Update in complete data
      const completeIndex = completeVariablesData.values.findIndex(
        (v: any) => v.name === variableName,
      );
      if (completeIndex >= 0) {
        completeVariablesData.values[completeIndex] = {
          ...completeVariablesData.values[completeIndex],
          ...updates,
        };
      }

      // Update filtered array completely to trigger reactivity
      updateFilteredVariables();

      // Force Vue to recognize changes
      instance?.proxy?.$forceUpdate();
    };

    /**
     * Loads the data for a single variable by name.
     * If the variable has dependencies, it will only load if all dependencies are loaded.
     * If the variable is already being loaded, it will cancel the previous promise and return the new one.
     * @param {object} variableObject - The variable object to load
     * @returns {Promise<boolean>} - true if the variable was loaded successfully, false if it was not
     */
    const loadSingleVariableDataByName = async (variableObject: any) => {
      return new Promise(async (resolve, reject) => {
        const { name } = variableObject;

        if (!name || !variableObject) {
          return resolve(false);
        }

        // If the variable is already being processed
        if (currentlyExecutingPromises[name]) {
          currentlyExecutingPromises[name](false);
        }
        currentlyExecutingPromises[name] = reject;

        // Check if this variable has any dependencies
        const hasParentVariables =
          variablesDependencyGraph[name]?.parentVariables?.length > 0;

        // Check dates for all query_values type
        if (variableObject.type === "query_values") {
          if (
            isInvalidDate(props.selectedTimeDate?.start_time) ||
            isInvalidDate(props.selectedTimeDate?.end_time)
          ) {
            return resolve(false);
          }
        }

        // Check dependencies in complete variables data
        if (hasParentVariables) {
          const isParentLoading = variablesDependencyGraph[
            name
          ].parentVariables.some((parentName: string) => {
            const parentVariable = completeVariablesData.values.find(
              (v: any) => v.name === parentName,
            );
            return (
              parentVariable?.isLoading ||
              parentVariable?.isVariableLoadingPending ||
              parentVariable?.value === null ||
              parentVariable?.value === undefined
            );
          });

          if (isParentLoading) {
            return resolve(false);
          }
        }
        try {
          const success = await handleVariableType(variableObject);
          await finalizeVariableLoading(variableObject, success);
          resolve(success);
        } catch (error) {
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
      switch (variableObject.type) {
        case "query_values": {
          try {
            const queryContext: any = await buildQueryContext(variableObject);
            const response = await fetchFieldValues(
              variableObject,
              queryContext,
            );
            updateVariableOptions(variableObject, response.data.hits);
            return true;
          } catch (error) {
            resetVariableState(variableObject);
            return false;
          }
        }
        case "custom": {
          handleCustomVariable(variableObject);
          return true;
        }
        case "constant":
        case "textbox":
        case "dynamic_filters": {
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
      for (const variable of completeVariablesData.values) {
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
     * Fetches field values based on the provided variable object and query context.
     * @param variableObject - The variable object containing query data.
     * @param queryContext - The context for the query as a string.
     * @returns The response from the stream service containing field values.
     */
    const fetchFieldValues = async (
      variableObject: any,
      queryContext: string,
    ) => {
      // Prepare the request payload for fetching field values
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
        // Create a new array for options to trigger reactivity
        const newOptions = fieldHit.values
          .filter((value: any) => value.zo_sql_key || value.zo_sql_key === "")
          .map((value: any) => ({
            // Use the zo_sql_key as the label if it is not empty, otherwise use "<blank>"
            label:
              value.zo_sql_key !== "" ? value.zo_sql_key.toString() : "<blank>",
            // Use the zo_sql_key as the value
            value: value.zo_sql_key.toString(),
          }));

        // Replace the entire array
        variableObject.options = [...newOptions];

        if (oldVariablesData[variableObject.name] !== undefined) {
          const oldValues = Array.isArray(oldVariablesData[variableObject.name])
            ? oldVariablesData[variableObject.name]
            : [oldVariablesData[variableObject.name]];

          if (variableObject.type === "custom") {
            // Handle custom variable logic
            handleCustomVariablesLogic(variableObject, oldValues);
          } else {
            // Handle query values logic
            handleQueryValuesLogic(variableObject, oldValues);
          }
        } else {
          // Set default value to the first option if no old values are available
          variableObject.value = variableObject.options.length
            ? variableObject.options[0].value
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
        // Update old variables data
        refreshVariableInArrays(name, {
          value: variableObject.value,
          isLoading: false,
          isVariableLoadingPending: false,
          options: variableObject.options, // Include options too
        });

        oldVariablesData[name] = JSON.parse(
          JSON.stringify(variableObject.value),
        );

        completeVariablesData.isVariablesLoading =
          completeVariablesData.values.some(
            (val: any) => val.isLoading || val.isVariableLoadingPending,
          );

        filteredVariablesData.isVariablesLoading =
          completeVariablesData.isVariablesLoading;

        // Load child variables
        const childVariables =
          variablesDependencyGraph[name]?.childVariables || [];
        if (
          childVariables.length > 0 &&
          JSON.stringify(oldVariablesData[name]) !==
            JSON.stringify(variableObject.value)
        ) {
          const childVariableObjects = completeVariablesData.values.filter(
            (variable: any) => childVariables.includes(variable.name),
          );

          await Promise.all(
            childVariableObjects.map((childVariable: any) =>
              loadSingleVariableDataByName(childVariable),
            ),
          );
        }

        // Force update filtered variables after every variable update
        updateFilteredVariables();
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
      // When a dropdown is opened, only load that specific variable
      await loadSingleVariableDataByName(variableObject);
    };

    let isLoading = false;
    const skipAPILoad = ref(false);

    // Force component update to ensure Vue reactivity
    const forceComponentUpdate = () => {
      // Create new arrays to force Vue reactivity
      completeVariablesData.values = [...completeVariablesData.values];
      filteredVariablesData.values = [...filteredVariablesData.values];

      // Update loading states
      completeVariablesData.isVariablesLoading =
        completeVariablesData.values.some(
          (val: any) => val.isLoading || val.isVariableLoadingPending,
        );
      filteredVariablesData.isVariablesLoading =
        completeVariablesData.isVariablesLoading;

      // Force Vue component update
      if (instance?.proxy) {
        instance.proxy.$forceUpdate();
      }

      // Ensure template updates
      nextTick(() => {
        // Create new references again to ensure reactivity
        filteredVariablesData.values = [...filteredVariablesData.values];
        completeVariablesData.values = [...completeVariablesData.values];
      });
    };

    const onVariablesValueUpdated = async (variableIndex: number) => {
      if (variableIndex < 0) return;

      const currentVariable = filteredVariablesData.values[variableIndex];
      if (!currentVariable) return;

      console.log(
        `VariablesValueSelector: Updating variable ${currentVariable.name}`,
      );

      // Find the variable in complete data
      const completeVariable = completeVariablesData.values.find(
        (v: any) => v.name === currentVariable.name,
      );
      if (!completeVariable) {
        console.log(
          `VariablesValueSelector: Could not find variable ${currentVariable.name}`,
        );
        return;
      }

      // Check if value actually changed
      const oldValue = oldVariablesData[currentVariable.name];
      const newValue = currentVariable.value;
      if (JSON.stringify(oldValue) === JSON.stringify(newValue)) {
        console.log(
          `VariablesValueSelector: Variable ${currentVariable.name} value did not change`,
        );
        return;
      }

      console.log(
        `VariablesValueSelector: Updating variable ${currentVariable.name} from ${JSON.stringify(
          oldValue,
        )} to ${JSON.stringify(newValue)}`,
      );

      // Update both filtered and complete variables
      completeVariable.value = newValue;
      oldVariablesData[currentVariable.name] = newValue;

      // Get all affected variables in dependency order
      const affectedVariables = getAllAffectedVariables(currentVariable.name);

      console.log(
        `VariablesValueSelector: Resetting ${affectedVariables.length} affected variables`,
      );

      // Reset affected variables
      affectedVariables.forEach((varName) => {
        const variable = completeVariablesData.values.find(
          (v: any) => v.name === varName,
        );
        if (variable) {
          variable.isVariableLoadingPending = true;
          variable.value = variable.multiSelect ? [] : null;
          variable.options = [];
        }
      });

      // Force UI update for reset state
      forceComponentUpdate();

      // Load affected variables in scope order
      await loadAffectedVariablesInOrder(affectedVariables);

      console.log(
        `VariablesValueSelector: Loaded ${affectedVariables.length} affected variables`,
      );

      // Update filtered variables and force UI refresh
      updateFilteredVariables();
      forceComponentUpdate();

      // Emit dependency update to notify other components
      emitDependencyUpdate(currentVariable.name, affectedVariables);

      // Emit updated data
      nextTick(() => {
        emitVariablesData();
      });
    };

    // Helper function to get all affected variables in dependency order
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
        const childrenOfChild = getAllAffectedVariables(childName, visited);
        allChildren.push(...childrenOfChild);
      }

      return Array.from(new Set(allChildren));
    };

    // Load variables in correct scope order
    const loadAffectedVariablesInOrder = async (variableNames: string[]) => {
      // Group variables by scope
      const scopedVariables: any = {
        global: [] as any[],
        tabs: [] as any[],
        panels: [] as any[],
      };

      // First, categorize variables by scope
      variableNames.forEach((name) => {
        const variable = completeVariablesData.values.find(
          (v: any) => v.name === name,
        );
        if (variable) {
          const scope = variable.scope || "global";
          scopedVariables[scope].push(variable);
        }
      });

      // Load in order: global -> tabs -> panels
      const loadVariablesInScope = async (variables: any[]) => {
        for (const variable of variables) {
          const parentVariables =
            variablesDependencyGraph[variable.name]?.parentVariables || [];
          const parentsLoaded = parentVariables.every((parentName: any) => {
            const parent = completeVariablesData.values.find(
              (v: any) => v.name === parentName,
            );
            return (
              parent &&
              !parent.isLoading &&
              !parent.isVariableLoadingPending &&
              parent.value !== null
            );
          });

          if (parentsLoaded) {
            await loadSingleVariableDataByName(variable);
            forceComponentUpdate(); // Force UI update after each variable loads
          }
        }
      };

      // Process variables in order: global -> tabs -> panels
      await loadVariablesInScope(scopedVariables.global);
      await loadVariablesInScope(scopedVariables.tabs);
      await loadVariablesInScope(scopedVariables.panels);
    };
    const loadAllVariablesData = async (isInitialLoad = false) => {
      if (isLoading || (!isInitialLoad && skipAPILoad.value)) {
        return;
      }

      isLoading = true;

      try {
        if (
          isInvalidDate(props.selectedTimeDate?.start_time) ||
          isInvalidDate(props.selectedTimeDate?.end_time)
        ) {
          return;
        }

        // Reset loading states
        completeVariablesData.values.forEach((variable: any) => {
          variable.isVariableLoadingPending = true;
        });
        // Load variables in dependency order

        const loadVariablesInOrder = async (variables: any) => {
          for (const variable of variables) {
            try {
              const parentVariables =
                variablesDependencyGraph[variable.name]?.parentVariables || [];
              const parentsLoaded = parentVariables.every((parentName: any) => {
                const parent = completeVariablesData.values.find(
                  (v: any) => v.name === parentName,
                );
                return (
                  parent &&
                  !parent.isLoading &&
                  !parent.isVariableLoadingPending &&
                  parent.value !== null
                );
              });

              if (parentsLoaded) {
                await loadSingleVariableDataByName(variable);
                // Force UI update after each variable load
                forceComponentUpdate();
              }
            } catch (error) {
              console.warn(`Failed to load variable ${variable.name}:`, error);
            }
          }
        };

        // First load all global variables
        const globalVariables = completeVariablesData.values.filter(
          (v: any) => !v.scope || v.scope === "global",
        );

        // Sort global variables by dependency
        const independentGlobals = globalVariables.filter(
          (v: any) =>
            !variablesDependencyGraph[v.name]?.parentVariables?.length,
        );
        const dependentGlobals = globalVariables.filter(
          (v: any) =>
            variablesDependencyGraph[v.name]?.parentVariables?.length > 0,
        );

        // Load globals
        await loadVariablesInOrder(independentGlobals);
        await loadVariablesInOrder(dependentGlobals);

        // Only load tab variables if we have a currentTabId
        if (props.currentTabId) {
          const tabVariables = completeVariablesData.values.filter(
            (v: any) =>
              v.scope === "tabs" && v.tabs?.includes(props.currentTabId),
          );
          await loadVariablesInOrder(tabVariables);

          // Only load panel variables if we have both currentTabId and currentPanelId
          if (props.currentPanelId) {
            const panelVariables = completeVariablesData.values.filter(
              (v: any) =>
                v.scope === "panels" &&
                v.tabs?.includes(props.currentTabId) &&
                v.panels?.includes(props.currentPanelId),
            );

            // Special handling for panel variables
            for (const panelVariable of panelVariables) {
              try {
                const parentVariables =
                  variablesDependencyGraph[panelVariable.name]
                    ?.parentVariables || [];
                const parentsLoaded = parentVariables.every(
                  (parentName: any) => {
                    const parent = completeVariablesData.values.find(
                      (v: any) => v.name === parentName,
                    );
                    return (
                      parent &&
                      !parent.isLoading &&
                      !parent.isVariableLoadingPending &&
                      parent.value !== null
                    );
                  },
                );

                if (parentsLoaded) {
                  await loadSingleVariableDataByName(panelVariable);
                  forceComponentUpdate();
                }
              } catch (error) {
                console.warn(
                  `Failed to load panel variable ${panelVariable.name}:`,
                  error,
                );
                // Set default state for failed panel variables
                panelVariable.isLoading = false;
                panelVariable.isVariableLoadingPending = false;
                panelVariable.value = panelVariable.multiSelect ? [] : null;
                panelVariable.options = [];
              }
            }
          }
        }

        // Update filtered variables
        updateFilteredVariables();

        // Force final UI update
        forceComponentUpdate();

        // Emit updated data
        emitVariablesData();
      } catch (error) {
        console.error("Error loading variables:", error);
        // Reset loading states on error
        completeVariablesData.values.forEach((variable: any) => {
          variable.isLoading = false;
          variable.isVariableLoadingPending = false;
        });
        filteredVariablesData.isVariablesLoading = false;
      } finally {
        isLoading = false;
      }
    };

    // Add to the setup function in VariablesValueSelector component
    const refreshFromDependencyUpdate = (updatedCompleteData: any) => {
      // Make a deep copy of the updated data to avoid reference issues
      const updatedDataCopy = JSON.parse(JSON.stringify(updatedCompleteData));

      // Update relevant variables from the complete data
      completeVariablesData.values.forEach((variable: any, index: any) => {
        const updatedVar = updatedDataCopy.values.find(
          (v: any) => v.name === variable.name,
        );

        if (updatedVar) {
          completeVariablesData.values[index] = {
            ...completeVariablesData.values[index],
            value: updatedVar.value,
            options: updatedVar.options || [],
            isLoading: updatedVar.isLoading,
            isVariableLoadingPending: updatedVar.isVariableLoadingPending,
          };

          // Update oldVariablesData as well
          oldVariablesData[variable.name] = JSON.parse(
            JSON.stringify(updatedVar.value),
          );
        }
      });

      // Update filtered view
      updateFilteredVariables();

      // Force component update
      forceComponentUpdate();

      // Emit updated data
      emitVariablesData();
    };

    // Modify the watchers to prevent double firing
    watch(
      [() => props.currentTabId, () => props.currentPanelId],
      ([newTabId, newPanelId], [oldTabId, oldPanelId]) => {
        // Only trigger if there's an actual change
        if (newTabId !== oldTabId || newPanelId !== oldPanelId) {
          console.debug("Tab or Panel ID changed:", { newTabId, newPanelId });
          loadAllVariablesData();
        }
      },
      { deep: true },
    );

    return {
      filteredVariablesData,
      changeInitialVariableValues,
      onVariablesValueUpdated,
      loadVariableOptions,
      loadAllVariablesData,
      refreshFromDependencyUpdate,
    };
  },
});
</script>

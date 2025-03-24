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
import { getCurrentInstance, onMounted, ref, watch } from "vue";
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
    // obj will have variable name as key
    // and reject object of promise as value
    const currentlyExecutingPromises: any = {};

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

    const rejectAllPromises = (source: string) => {
      console.log("Rejecting all promises", source);
      Object.keys(currentlyExecutingPromises).forEach((key) => {
        if (currentlyExecutingPromises[key])
          currentlyExecutingPromises[key]("from reject all promises");
      });
    };

    onMounted(() => {
      // make list of variables using variables config list
      initializeVariablesData();

      // reject all promises
      rejectAllPromises("mounted");

      // load all variables
      loadAllVariablesData(true);
    });

    watch(
      () => props.variablesConfig,
      async () => {
        // make list of variables using variables config list
        initializeVariablesData();

        // reject all promises
        rejectAllPromises(" variable config watcher");
        skipAPILoad.value = false;
        // load all variables
        loadAllVariablesData(true);
      },
    );

    // you may need to query the data if the variable configs or the data/time changes
    watch(
      () => props.selectedTimeDate,
      () => {
        // reject all promises
        rejectAllPromises("selected date time");

        loadAllVariablesData(false);
        skipAPILoad.value = true;
      },
    );

    watch(
      () => variablesData,
      () => {
        emitVariablesData();
      },
      { deep: true },
    );

    const emitVariablesData = () => {
      instance?.proxy?.$forceUpdate();
      emit("variablesData", JSON.parse(JSON.stringify(variablesData)));
    };

    // it is used to change/update initial variables values from outside the component
    // NOTE: right now, it is not used after variables in variables feature
    const changeInitialVariableValues = async (
      newInitialVariableValues: any,
    ) => {
      console.log("Starting changeInitialVariableValues");

      // reject all promises
      console.log("Rejecting all promises");
      rejectAllPromises("change intitial variable values");

      // NOTE: need to re-initialize variables data
      console.log("Resetting variables data");
      resetVariablesData();

      // set initial variables values
      console.log("Setting new initial variable values", newInitialVariableValues);
      props.initialVariableValues.value = newInitialVariableValues;

      // make list of variables using variables config list
      console.log("Initializing variables data");
      initializeVariablesData();

      // load all variables
      console.log("Loading all variables");
      await loadAllVariablesData(true);

      console.log("Completed changeInitialVariableValues");
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
      console.log(`${variableObject.name} - loadSingleVariableDataByName started`);
      return new Promise(async (resolve, reject) => {
        const { name } = variableObject;

        if (!name || !variableObject) {
          console.log(`${variableObject.name} - loadSingleVariableDataByName cancelled, variableObject is null or name is null`);
          reject("variableObject is null or name is null");
        }
        console.log(`${variableObject.name} - Variable object and name are valid`);

        if (currentlyExecutingPromises[name]) {
          console.log(`${variableObject.name} - loadSingleVariableDataByName cancelled, already being processed`);
          currentlyExecutingPromises[name]("loadSingleVariableDataByName cancelled, already being processed");
        }
        currentlyExecutingPromises[name] = reject;
        console.log(`${variableObject.name} - Set currently executing promise`);

        const hasParentVariables = variablesDependencyGraph[name]?.parentVariables?.length > 0;
        console.log(`${variableObject.name} - Checking for parent variables: ${hasParentVariables}`);

        if (variableObject.type === "query_values") {
          if (isInvalidDate(props.selectedTimeDate?.start_time) || isInvalidDate(props.selectedTimeDate?.end_time)) {
            console.log(`${variableObject.name} - loadSingleVariableDataByName cancelled, invalid date`);
            reject("invalid date");
          }
          console.log(`${variableObject.name} - Dates are valid`);
        }

        if (hasParentVariables && isDependentVariableLoading(variableObject)) {
          console.log(`${variableObject.name} - loadSingleVariableDataByName cancelled, dependencies are not loaded`);
          reject("dependencies are not loaded");
        }
        console.log(`${variableObject.name} - Dependencies are loaded or not required`);

        try {
          const success = await handleVariableType(variableObject);
          console.log(`${variableObject.name} - loadSingleVariableDataByName success: ${success}`);
          await finalizeVariableLoading(variableObject, success);
          resolve("success" + success);
        } catch (error) {
          console.log(`${variableObject.name} - loadSingleVariableDataByName error: ${error.message}`);
          await finalizeVariableLoading(variableObject, false);
          reject("error from single variable" + error);
        }
      });
    };

    /**
     * Handles the logic for a single variable based on its type.
     * @param {object} variableObject - The variable object to handle
     * @returns {Promise<boolean>} - true if the variable was handled successfully, false if it was not
     */
    const handleVariableType = async (variableObject: any) => {
      console.log(`${variableObject.name} - Handling variable type: ${variableObject.type}`);
      switch (variableObject.type) {
        case "query_values": {
          console.log(`${variableObject.name} - Handling query values`);
          try {
            const queryContext: any = await buildQueryContext(variableObject);
            console.log(`${variableObject.name} - Query context: ${queryContext}`);
            let response = fetchFieldValues(
              variableObject,
              queryContext,
            );

            response = await response.then((response: any) => {
              console.log(`${variableObject.name} - Response: ${JSON.stringify(response)}`);
              return response
            }).catch((error: any) => {
              console.log(`${variableObject.name} - Error: ${error.message}`);
            })
            console.log(`${variableObject.name} - Updating variable options`);
            updateVariableOptions(variableObject, response.data.hits);
            console.log(`${variableObject.name} - Returning true`);
            return true;
          } catch (error) {
            console.log(`${variableObject.name} - Error handling query values: ${error.message}`);
            resetVariableState(variableObject);
            console.log(`${variableObject.name} - Returning false`);
            return " handleVariable - false";
          }
        }
        case "custom": {
          console.log(`${variableObject.name} - Handling custom variable`);
          handleCustomVariable(variableObject);
          console.log(`${variableObject.name} - Returning true`);
          return true;
        }
        case "constant":
        case "textbox":
        case "dynamic_filters": {
          console.log(`${variableObject.name} - Returning true`);
          return true;
        }
        default: {
          console.log(`${variableObject.name} - Returning false`);
          return "handleVariable - false";
        }
      }
    };

    /**
     * Builds the query context for the given variable object.
     * @param variableObject The variable object containing the query data.
     * @returns The query context as a string.
     */
    const buildQueryContext = async (variableObject: any) => {
      console.log(`Building query context for variable: ${variableObject.name}`);
      const timestamp_column = store.state.zoConfig.timestamp_column || "_timestamp";
      let dummyQuery = `SELECT ${timestamp_column} FROM '${variableObject.query_data.stream}'`;
      console.log(`Initial dummy query: ${dummyQuery}`);

      // Construct the filter from the query data
      const constructedFilter = (variableObject.query_data.filter || []).map(
        (condition: any) => ({
          name: condition.name,
          operator: condition.operator,
          value: condition.value,
        }),
      );
      console.log(`Constructed filter: ${JSON.stringify(constructedFilter)}`);

      // Add labels to the dummy query
      let queryContext = await addLabelsToSQlQuery(
        dummyQuery,
        constructedFilter,
      );
      console.log(`Query context after adding labels: ${queryContext}`);

      // Replace variable placeholders with actual values
      for (const variable of variablesData.values) {
        if (!variable.isLoading && !variable.isVariableLoadingPending) {
          if (Array.isArray(variable.value)) {
            const arrayValues = variable.value
              .map((value: any) => `'${escapeSingleQuotes(value)}'`)
              .join(", ");
            queryContext = queryContext.replace(
              `'$${variable.name}'`,
              arrayValues,
            );
            console.log(`Replaced array value for variable ${variable.name}: ${arrayValues}`);
          } else if (variable.value !== null && variable.value !== undefined) {
            queryContext = queryContext.replace(
              `$${variable.name}`,
              escapeSingleQuotes(variable.value),
            );
            console.log(`Replaced single value for variable ${variable.name}: ${variable.value}`);
          }
        }
      }

      // Base64 encode the query context
      const encodedQueryContext = b64EncodeUnicode(queryContext);
      console.log(`Encoded query context: ${encodedQueryContext}`);
      return encodedQueryContext;
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
      console.log(
        `Fetching field values for variable "${variableObject.name}" with query context: ${queryContext}`,
      );

      try {
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

        console.log(`Payload for fetching field values: ${JSON.stringify(payload)}`);

        // Fetch field values from the stream service
        const response = await streamService.fieldValues(payload);

        console.log(
          `Fetched field values for variable "${variableObject.name}" with response: ${JSON.stringify(response.data)}`,
        );

        return response;
      } catch (error) {
        console.error(
          `Failed to fetch field values for variable "${variableObject.name}" with error: ${error.message}`,
        );
        throw error;
      }
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
        variableObject.options = fieldHit.values
          .filter((value: any) => value.zo_sql_key || value.zo_sql_key === "")
          .map((value: any) => ({
            // Use the zo_sql_key as the label if it is not empty, otherwise use "<blank>"
            label:
              value.zo_sql_key !== "" ? value.zo_sql_key.toString() : "<blank>",
            // Use the zo_sql_key as the value
            value: value.zo_sql_key.toString(),
          }));

        // Set default value
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
        oldVariablesData[name] = variableObject.value;

        // Update loading states
        variableObject.isLoading = false;
        variableObject.isVariableLoadingPending = false;

        // Update global loading state
        variablesData.isVariablesLoading = variablesData.values.some(
          (val: { isLoading: any; isVariableLoadingPending: any }) =>
            val.isLoading || val.isVariableLoadingPending,
        );

        // Don't load child variables on dropdown open events
        // Load child variables if any
        const childVariables =
          variablesDependencyGraph[name]?.childVariables || [];
        if (childVariables.length > 0) {
          const childVariableObjects = variablesData.values.filter(
            (variable: any) => childVariables.includes(variable.name),
          );

          // Only load children if the parent value actually changed
          if (oldVariablesData[name] !== variableObject.value) {
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
      // When a dropdown is opened, only load that specific variable
      await loadSingleVariableDataByName(variableObject);
    };

    let isLoadingWeDontKnow = false;
    const skipAPILoad = ref(false);

    /**
     * Loads all variables data.
     * This function is called when the selected time or date changes.
     * It loads all variables data in the correct order, taking into account the dependencies between variables.
     * @async
     * @returns {Promise<void>} - A promise that resolves when all variables data has been loaded.
     */
    const loadAllVariablesData = async (isInitialLoad = false) => {
      if (isLoadingWeDontKnow) {
        console.log("skip loading all variables data as it's already loading");
        return;
      }

      if (!isInitialLoad && skipAPILoad.value) {
        console.log("skip loading all variables data as skipAPILoad is true");
        return;
      }

      isLoadingWeDontKnow = true;
      console.log("starting to load all variables data");

      if (
        isInvalidDate(props.selectedTimeDate?.start_time) ||
        isInvalidDate(props.selectedTimeDate?.end_time)
      ) {
        console.log("skip loading all variables data as selected time is invalid");
        isLoadingWeDontKnow = false;
        return;
      }

      // Set loading state for all variables
      variablesData.values.forEach((variable: any) => {
        variable.isVariableLoadingPending = true;
      });

      console.log("independent and dependent variables classification start");

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

      console.log(
        "independent variables",
        independentVariables.map((v) => v.name),
      );
      console.log(
        "dependent variables",
        dependentVariables.map((v) => v.name),
      );

      try {
        // Load all independent variables
        console.log("loading independent variables");
        for (const variable of independentVariables) {
          try {
            const res = await loadSingleVariableDataByName(variable);
            console.log("loaded independent variable", variable.name, res);
          } catch (error) {
            console.error(`Error loading variable ${variable.name}`, error);
            await finalizeVariableLoading(variable, false);
          }
        }
        console.log("independent variables loaded");
      } catch (error) {
        for (const variable of independentVariables) {
          await finalizeVariableLoading(variable, false);
        }
        console.error("Error loading independent variables", error);
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
            console.log("loading dependent variable", variable.name);
            await loadSingleVariableDataByName(variable);
          } else {
            console.log(
              `skipping loading of ${variable.name} as parents are not loaded`,
            );
          }
        }
      };

      // Attempt to load dependent variables up to 3 times
      for (let attempt = 0; attempt < 3; attempt++) {
        console.log(`attempt ${attempt + 1} to load dependent variables`);
        await loadDependentVariables();

        // Check if all variables are loaded
        const allLoaded = variablesData.values.every(
          (variable: any) =>
            !variable.isLoading && !variable.isVariableLoadingPending,
        );

        // If all variables are loaded, break the loop
        if (allLoaded) {
          console.log("all variables are loaded");
          break;
        }

        console.log(
          `not all variables loaded after attempt ${attempt + 1}, retrying`,
        );
      }

      isLoadingWeDontKnow = false;
      console.log("finished loading all variables data");
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
          const childrenOfChild = getAllAffectedVariables(childName, visited);
          allChildren.push(...childrenOfChild);
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
        if (variable.multiSelect) {
          variable.value = [];
        } else {
          variable.value = null;
        }
      });

      // Load variables in dependency order
      for (const varName of affectedVariables) {
        const variable = variablesData.values.find((v: any) => v.name === varName);
        if (variable) {
          await loadSingleVariableDataByName(variable);
        }
      }

      // Emit updated data
      emitVariablesData();
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

<!-- Copyright 2023 Zinc Labs Inc.

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
      v-for="item in variablesData.values"
      :key="
        item.name +
        item.value +
        item.type +
        item.options?.length +
        item.isLoading
      "
      class="q-mr-lg q-mt-xs"
      :data-test="`dashboard-variable-${item}-selector`"
    >
      <div v-if="item.type == 'query_values'">
        <VariableQueryValueSelector v-model="item.value" :variableItem="item" />
      </div>
      <div v-else-if="item.type == 'constant'">
        <q-input
          style="max-width: 150px !important"
          v-model="item.value"
          :label="item.label || item.name"
          dense
          outlined
          readonly
          data-test="dashboard-variable-constant-selector"
        ></q-input>
      </div>
      <div v-else-if="item.type == 'textbox'">
        <q-input
          style="max-width: 150px !important"
          debounce="1000"
          v-model="item.value"
          :label="item.label || item.name"
          dense
          outlined
          data-test="dashboard-variable-textbox-selector"
        ></q-input>
      </div>
      <div v-else-if="item.type == 'custom'">
        <q-select
          style="min-width: 150px"
          outlined
          dense
          v-model="item.value"
          :display-value="
            item.value
              ? item.value
              : !item.isLoading
              ? '(No Options Available)'
              : ''
          "
          :options="item.options"
          map-options
          stack-label
          filled
          borderless
          :label="item.label || item.name"
          option-value="value"
          option-label="label"
          emit-value
          data-test="dashboard-variable-custom-selector"
        >
          <template v-slot:no-option>
            <q-item>
              <q-item-section class="text-italic text-grey">
                No Options Available
              </q-item-section>
            </q-item>
          </template>
        </q-select>
      </div>
      <div v-else-if="item.type == 'dynamic_filters'">
        <VariableAdHocValueSelector v-model="item.value" :variableItem="item" />
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { getCurrentInstance, onMounted, watch, computed } from "vue";
import { defineComponent, reactive } from "vue";
import streamService from "../../services/stream";
import { useStore } from "vuex";
import VariableQueryValueSelector from "./settings/VariableQueryValueSelector.vue";
import VariableAdHocValueSelector from "./settings/VariableAdHocValueSelector.vue";
import { isInvalidDate } from "@/utils/date";
import { addLabelsToSQlQuery } from "@/utils/query/sqlUtils";
import { b64EncodeUnicode } from "@/utils/zincutils";

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
  },
  setup(props: any, { emit }) {
    const instance = getCurrentInstance();
    const store = useStore();
    // variables data derived from the variables config list
    const variablesData: any = reactive({
      isVariablesLoading: false,
      values: [],
    });

    // old variables data to compare with new variables data
    // used in watcher when variables values changes
    let oldVariablesData = JSON.parse(JSON.stringify(variablesData));

    // variables dependency graph
    let variablesDependencyGraph: any = {};

    onMounted(async () => {
      // build variables dependency graph
      if (props.variablesConfig?.list) {
        variablesDependencyGraph = buildVariablesDependencyGraph(
          props.variablesConfig.list
        );
      }

      // get independent variables data
      await getVariablesData();
    });

    // variables config list
    // which will have all variables and dynamic filters
    // it will executed once on mount, because currently props variablesConfig is not changed
    const variablesConfigList = computed(() => {
      const configList =
        JSON.parse(JSON.stringify(props.variablesConfig?.list ?? [])) || [];

      if (props.showDynamicFilters) {
        configList.push({
          name: "__dynamic_filters",
          label: "Dynamic Filters",
          type: "dynamic_filters",
          value: [],
        });
      }

      return configList;
    });

    // on variablesConfigList change, build variables dependency graph
    // currently, watcher will not be triggered because props variablesConfig is not changed. so, variablesConfigList will not change.
    watch(
      () => variablesConfigList.value,
      async () => {
        // build variables dependency graph
        if (props.variablesConfig?.list) {
          variablesDependencyGraph = buildVariablesDependencyGraph(
            variablesConfigList.value
          );
        }
      },
      {
        deep: true,
      }
    );

    // you may need to query the data if the variable configs or the data/time changes
    watch(
      () => [props.variablesConfig, props.selectedTimeDate],
      async () => {
        await getVariablesData();
      }
    );
    watch(
      () => variablesData,
      () => {
        emitVariablesData();
      },
      { deep: true }
    );

    // on variablesData change, find which variables have changed based on oldVariablesData
    // loop on all changed variables
    // and load it's dependent variables synchronously
    watch(
      () => variablesData,
      async () => {
        // Find which variables have changed
        // variables should not be of type dynamic_filters
        // NOTE: changedVariables should not be of type dynamic_filters and either value or isLoading should change
        // value will change if data will be there
        // if options is empty array at that time value will be null which is same in oldVariablesData as well. so for that check loading value is changed
        let changedVariables = variablesData.values.filter(
          (newVar: any, index: any) => {
            let oldVar = oldVariablesData.values[index];
            return (
              newVar.type != "dynamic_filters" &&
              (newVar.isLoading !== oldVar.isLoading ||
                newVar.value !== oldVar.value)
            );
          }
        );

        // loop on all variables
        for (let variable of Object.keys(variablesDependencyGraph)) {
          // if variable is dependent on changedVariables
          // load variable's data
          changedVariables.forEach(async (v: any) => {
            if (variablesDependencyGraph[variable].includes(v.name)) {
              const variableDataIndex = variablesData.values.findIndex(
                (item: any) => item.name == variable
              );

              // if variable data found
              if (variableDataIndex >= 0) {
                // variable loading is true
                // remove current value because it will call dependent variables with old value
                // and load new value
                variablesData.values[variableDataIndex].isLoading = true;
                variablesData.values[variableDataIndex].value = null;
                getSingleVariableData(variableDataIndex);
              }
            }
          });
        }

        // update oldVariablesData
        oldVariablesData = JSON.parse(JSON.stringify(variablesData));
      },
      { deep: true }
    );

    // build variables dependency graph
    const buildVariablesDependencyGraph = (variables: any) => {
      let graph: any = {};

      // Create a set of variable names
      let variablesNameList = new Set(
        variables.map((variable: any) => variable.name)
      );

      // Initialize the graph with empty arrays
      for (let item of variables) {
        graph[item.name] = [];
      }

      // Populate the graph
      for (let item of variables) {
        let name = item.name;
        if (item.type == "query_values") {
          for (let filter of item.query_data.filter ?? []) {
            let dependencies = extractVariableNames(
              filter.value,
              variablesNameList
            );
            if (graph[name]) {
              graph[name].push(...dependencies);
            } else {
              graph[name] = dependencies;
            }
          }
        } else {
          graph[name] = [];
        }
      }

      return graph;
    };

    const emitVariablesData = () => {
      instance?.proxy?.$forceUpdate();
      emit("variablesData", JSON.parse(JSON.stringify(variablesData)));
    };

    // A helper function to extract variable names from a string
    function extractVariableNames(str: any, variableNames: any) {
      let regex = /\$(\w+)/g;
      let match;
      let names = [];
      while ((match = regex.exec(str)) !== null) {
        // Only include the variable name if it exists in the list of variables
        if (variableNames.has(match[1])) {
          names.push(match[1]);
        }
      }
      // Remove duplicates by converting to a set and back to an array
      return [...new Set(names)];
    }

    // it is used to change/update initial variables values from outside the component
    const changeInitialVariableValues = async (
      newInitialVariableValues: any
    ) => {
      // reset the values
      variablesData.values = [];
      variablesData.isVariablesLoading = false;

      // set initial variables values
      props.initialVariableValues.value = newInitialVariableValues;
    };

    // for each variable, there will be intitial values which will come from parent component(query params)
    let oldVariableValue = JSON.parse(JSON.stringify(variablesData.values));

    // get single variable data based on index
    const getSingleVariableData = async (index: any) => {
      // if index is not valid, return
      if (index < 0) return;

      // variables data
      const it = variablesConfigList.value[index];

      // if it is not valid, return
      if (!it) {
        return;
      }

      // based on it.name find that variable from variablsData
      const currentVariableIndex = index;

      const obj = variablesData.values[currentVariableIndex];

      switch (it.type) {
        case "query_values": {
          try {
            console.log("it.type", it);
            obj.isLoading = true;
            console.log("query_data", it.query_data.filter);
            const filterConditions = it.query_data.filter || [];

            let dummyQuery = `SELECT * FROM '${it.query_data.stream}'`;
            const constructedFilter = filterConditions.map(
              (condition: any) => ({
                name: condition.name,
                operator: condition.operator,
                value: condition.value,
              })
            );
            let queryContext = addLabelsToSQlQuery(
              dummyQuery,
              constructedFilter
            );

            // replace variables placeholders
            // NOTE: must use for of loop because we have return statement in the loop
            for (let variable of variablesData?.values) {
              if (variable.value !== null) {
                queryContext = queryContext.replace(
                  `$${variable.name}`,
                  variable.value
                );
              } else if (queryContext.includes(`$${variable.name}`)) {
                // there is other variables which is not loaded
                // and current query is dependent on this variable
                obj.isLoading = false;
                return;
              }
            }

            // base64 encode the query
            queryContext = b64EncodeUnicode(queryContext) || "";

            const res = await streamService.fieldValues({
              org_identifier: store.state.selectedOrganization.identifier,
              stream_name: it.query_data.stream,
              start_time: new Date(
                props.selectedTimeDate?.start_time?.toISOString()
              ).getTime(),
              end_time: new Date(
                props.selectedTimeDate?.end_time?.toISOString()
              ).getTime(),
              fields: [it.query_data.field],
              size: it?.query_data?.max_record_size
                ? it?.query_data?.max_record_size
                : 10,
              type: it.query_data.stream_type,
              query_context: queryContext,
            });

            obj.isLoading = false;

            if (res.data.hits.length) {
              //set options value from the api response
              obj.options = res.data.hits
                .find((field: any) => field.field === it.query_data.field)
                .values.filter(
                  (value: any) => value.zo_sql_key || value.zo_sql_key === ""
                )
                .map((value: any) => ({
                  label:
                    value.zo_sql_key !== ""
                      ? value.zo_sql_key.toString()
                      : "<blank>",
                  value: value.zo_sql_key.toString(),
                }));

              // find old value is exists in the dropdown
              let oldVariableObjectSelectedValue = oldVariableValue.find(
                (it2: any) => it2.name === it.name
              );

              // if the old value exist in dropdown set the old value otherwise set first value of drop down otherwise set blank string value
              if (oldVariableObjectSelectedValue) {
                obj.value = obj.options.some(
                  (option: any) =>
                    option.value === oldVariableObjectSelectedValue.value
                )
                  ? oldVariableObjectSelectedValue.value
                  : obj.options.length
                  ? obj.options[0].value
                  : "";
              } else {
                obj.value = obj.options.length ? obj.options[0].value : "";
              }

              variablesData.isVariablesLoading = variablesData.values.some(
                (val: { isLoading: any }) => val.isLoading
              );

              // triggers rerendering in the current component
              variablesData.values[currentVariableIndex] = obj;

              emitVariablesData();
              // return obj;
              break;
            } else {
              obj.isLoading = false;
              variablesData.isVariablesLoading = variablesData.values.some(
                (val: { isLoading: any }) => val.isLoading
              );

              // triggers rerendering in the current component
              variablesData.values[currentVariableIndex] = obj;

              emitVariablesData();

              // return obj;
              break;
            }
          } catch (err: any) {
            console.log("error", err);
            obj.isLoading = false;

            variablesData.isVariablesLoading = variablesData.values.some(
              (val: { isLoading: any }) => val.isLoading
            );

            // triggers rerendering in the current component
            variablesData.values[currentVariableIndex] = obj;

            emitVariablesData();
            // return obj;
            break;
          }
        }
        case "constant": {
          obj.value = it.value;
          // return obj;
          break;
        }
        case "textbox": {
          let oldVariableObjectSelectedValue = oldVariableValue.find(
            (it2: any) => it2.name === it.name
          );
          if (oldVariableObjectSelectedValue) {
            obj.value = oldVariableObjectSelectedValue.value;
          } else {
            obj.value = it.value;
          }
          // return obj;
          break;
        }
        case "custom": {
          obj["options"] = it?.options;
          let oldVariableObjectSelectedValue = oldVariableValue.find(
            (it2: any) => it2.name === it.name
          );
          // if the old value exist in dropdown set the old value otherwise set first value of drop down otherwise set blank string value
          if (oldVariableObjectSelectedValue) {
            obj.value = oldVariableObjectSelectedValue.value;
          } else {
            obj.value = obj.options[0]?.value || "";
          }
          // return obj;
          break;
        }
        case "dynamic_filters": {
          obj.isLoading = false; // Set loading state
          let oldVariableObjectSelectedValue = oldVariableValue.find(
            (it2: any) => it2.name === it.name
          );
          if (oldVariableObjectSelectedValue) {
            obj.value = oldVariableObjectSelectedValue.value;
          } else {
            obj.value = it.value;
          }
          emitVariablesData();
          // return obj;
          break;
        }
        default:
          obj.value = it.value;
          // return obj;
          break;
      }

      variablesData.isVariablesLoading = variablesData.values.some(
        (val: { isLoading: any }) => val.isLoading
      );
      emitVariablesData();
    };

    const getVariablesData = async () => {
      if (
        isInvalidDate(props.selectedTimeDate?.start_time) ||
        isInvalidDate(props.selectedTimeDate?.end_time)
      ) {
        return;
      }

      // do we have variables & date?
      if (!props.variablesConfig?.list || !props.selectedTimeDate?.start_time) {
        variablesData.values = [];
        variablesData.isVariablesLoading = false;
        emitVariablesData();
        return;
      }

      // reset the values
      variablesData.values = [];
      variablesData.isVariablesLoading = false;

      // get old variable values
      oldVariableValue = JSON.parse(JSON.stringify(variablesData.values));
      if (!oldVariableValue.length) {
        const dynamicVariables =
          variablesConfigList.value
            ?.filter((it: any) => it.type == "dynamic_filters")
            ?.map((it: any) => it.name) || [];
        oldVariableValue = Object.keys(
          props?.initialVariableValues?.value ?? []
        ).map((key: any) => ({
          name: key,
          value: dynamicVariables.includes(key)
            ? JSON.parse(
                decodeURIComponent(props.initialVariableValues?.value[key])
              )
            : props.initialVariableValues?.value[key],
        }));
      }

      variablesConfigList.value.forEach((it: any) => {
        const obj: any = {
          name: it.name,
          label: it.label,
          type: it.type,
          value: it.type == "dynamic_filters" ? [] : null,
          isLoading: true,
        };
        variablesData.values.push(obj);
        variablesData.isVariablesLoading = true;
      });

      oldVariablesData = JSON.parse(JSON.stringify(variablesData));

      // load independent variables only.
      // if independent variables are not loaded, dependent variables will be automatically loaded due to watcher on variablesData.values change

      for (let index = 0; index < variablesConfigList.value.length; index++) {
        // if dependency is not there then load
        if (
          variablesDependencyGraph[variablesConfigList.value[index].name] &&
          variablesDependencyGraph[variablesConfigList.value[index].name]
            .length == 0
        ) {
          getSingleVariableData(index);
        }
      }
    };
    return {
      props,
      variablesData,
      changeInitialVariableValues,
    };
  },
});
</script>

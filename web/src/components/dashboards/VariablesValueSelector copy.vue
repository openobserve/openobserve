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

    // variables dependency graph
    let variablesDependencyGraph: any = {};

    // topological sort obj
    let topologicalSortedVariablesObj: any = {};

    onMounted(async () => {
      // build variables dependency graph
      if (props.variablesConfig?.list) {
        variablesDependencyGraph = buildVariablesDependencyGraph(
          props.variablesConfig.list
        );
        // Use variablesDependencyGraph to get an ordered list of variables.
        topologicalSortedVariablesObj = topologicalSort(
          variablesDependencyGraph
        );
      }

      // get independent variables data
      await getVariablesData();
    });

    watch(
      () => props.variablesConfig,
      () => {
        // build variables dependency graph
        if (props.variablesConfig?.list) {
          variablesDependencyGraph = buildVariablesDependencyGraph(
            props.variablesConfig.list
          );

          // Use variablesDependencyGraph to get an ordered list of variables.
          topologicalSortedVariablesObj = topologicalSort(
            variablesDependencyGraph
          );
        }
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

    watch(
      () => variablesData,
      async (newVal, oldVal) => {
        // Find which variables have changed
        let changedVariables = newVal.values.filter((newVar, index) => {
          let oldVar = oldVal.values[index];
          return newVar.value !== oldVar.value;
        });

        // loop on all variables
        for (let variable of Object.keys(variablesDependencyGraph)) {
          if (changedVariables.includes(variable)) {
            await getSingleVariableData(
              variablesData.values,
              variablesData.values.findIndex(
                (item: any) => item.name == variable
              )
            );
          }
        }

        // // For each changed variable, update the options of its dependents
        // for (let changedVariable of changedVariables) {
        //   let dependents = graph[changedVariable.name];
        //   for (let dependent of dependents) {
        //     updateVariableOptions(dependent);
        //   }
        // }

        // Emit the updated variablesData
        // emitVariablesData();
      },
      { deep: true }
    );

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

    const topologicalSort = (graph: any) => {
      let result: any = [];
      let visited: any = new Set();
      let recStack: any = new Set();

      function visit(node: any) {
        if (recStack.has(node)) {
          throw new Error(
            "There is a cycle in the graph. Cannot perform topological sort."
          );
        }

        if (!visited.has(node)) {
          recStack.add(node);
          for (let n of graph[node]) {
            visit(n);
          }
          recStack.delete(node);
          visited.add(node);
          result.push(node);
        }
      }

      // Visit nodes without dependencies first
      for (let node in graph) {
        if (graph[node].length === 0 && !visited.has(node)) {
          visit(node);
        }
      }

      // Then visit the rest of the nodes
      for (let node in graph) {
        if (!visited.has(node)) {
          visit(node);
        }
      }

      return result;
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

    // get old variable values
    const oldVariableValue = computed(() => {
      let oldData = JSON.parse(JSON.stringify(variablesData.values));
      if (!oldData.length) {
        const dynamicVariables =
          variablesData?.values
            ?.filter((it: any) => it.type == "dynamic_filters")
            ?.map((it: any) => it.name) || [];
        oldData = Object.keys(props?.initialVariableValues?.value ?? []).map(
          (key: any) => ({
            name: key,
            value: dynamicVariables.includes(key)
              ? JSON.parse(
                  decodeURIComponent(props.initialVariableValues?.value[key])
                )
              : props.initialVariableValues?.value[key],
          })
        );
      }
      return oldData;
    });

    const getSingleVariableData = async (
      variablesConfigList: any,
      index: any
    ) => {
      console.log("called");
      if (index < 0) return;
      const it = variablesConfigList[index];
      if (!it) {
        return;
      }


      // const it = variablesConfigList[index];

      // based on it.name find that variable from variablsData
      const currentVariableIndex = variablesData.values.findIndex(
        (obj: any) => obj.name === it.name
      );

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
            variablesData?.values.forEach((variable: any) => {
              if (variable.value) {
                queryContext = queryContext.replace(
                  `$${variable.name}`,
                  variable.value
                );
              }
            });

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
              let oldVariableObjectSelectedValue = oldVariableValue.value.find(
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
          let oldVariableObjectSelectedValue = oldVariableValue.value.find(
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
          let oldVariableObjectSelectedValue = oldVariableValue.value.find(
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
          // commented this because we don't want this to call stream api call

          // obj.isLoading = true; // Set loading state

          // return getStreams("", false)
          //   .then((res) => {
          //     obj.isLoading = false; // Reset loading state

          //     const fieldsObj: any = {};

          // res.data.list.forEach((item: any) => {
          //   const name = item.name;
          //   const stream_type = item.stream_type;

          // (item.schema || []).forEach((schemaItem: any) => {
          //   const fieldName = schemaItem.name;

          //           if (!fieldsObj[fieldName]) {
          //             fieldsObj[fieldName] = [];
          //           }

          //           const existingEntry = fieldsObj[fieldName].find(
          //             (entry: any) =>
          //               entry.name === name && entry.stream_type === stream_type
          //           );

          //           if (!existingEntry) {
          //             fieldsObj[fieldName].push({
          //               name: name,
          //               stream_type: stream_type,
          //             });
          //           }
          //         });
          //       });
          //       const fieldsArray = Object.entries(fieldsObj).map(
          //         ([schemaName, entries]) => ({
          //           name: schemaName,
          //           streams: entries,
          //         })
          //       );
          //       obj.options = fieldsArray;

          //       let old = oldVariableValue.find(
          //         (it2: any) => it2.name === it.name
          //       );
          //       if (old) {
          //         obj.value = old.value.map((it2: any) => ({
          //           ...it2,
          //           streams: fieldsArray.find(
          //             (it3: any) => it3.name === it2.name
          //           )?.streams,
          //         }));
          //       } else {
          //         obj.value = [];
          //       }

          //       variablesData.isVariablesLoading = variablesData.values.some(
          //         (val: { isLoading: any }) => val.isLoading
          //       );

          //       // triggers rerendering in the current component
          //       variablesData.values[index] = obj;
          //       emitVariablesData();
          //       return obj;
          //     })
          //     .catch((error) => {
          //       obj.isLoading = false; // Reset loading state
          //       // Handle error
          //       variablesData.isVariablesLoading = variablesData.values.some(
          //         (val: { isLoading: any }) => val.isLoading
          //       );

          //       // triggers rerendering in the current component
          //       variablesData.values[index] = obj;

          //       emitVariablesData();
          //       return obj;
          //     });
          obj.isLoading = false; // Set loading state
          let oldVariableObjectSelectedValue = oldVariableValue.value.find(
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

      let variablesConfigList =
        JSON.parse(JSON.stringify(props.variablesConfig?.list)) || [];

      if (props.showDynamicFilters) {
        variablesConfigList.push({
          name: "__dynamic_filters",
          label: "Dynamic Filters",
          type: "dynamic_filters",
          value: [],
        });
      }
      

      // // get old variable values
      // let oldVariableValue = JSON.parse(JSON.stringify(variablesData.values));
      // if (!oldVariableValue.length) {
      //   const dynamicVariables =
      //     variablesConfigList
      //       ?.filter((it: any) => it.type == "dynamic_filters")
      //       ?.map((it: any) => it.name) || [];
      //   oldVariableValue = Object.keys(
      //     props?.initialVariableValues?.value ?? []
      //   ).map((key: any) => ({
      //     name: key,
      //     value: dynamicVariables.includes(key)
      //       ? JSON.parse(
      //           decodeURIComponent(props.initialVariableValues?.value[key])
      //         )
      //       : props.initialVariableValues?.value[key],
      //   }));
      // }

      // // now, need to check whether filter has cycle or not
      // let graph: any = {};

      // // Create a set of variable names
      // let variablesNameList = new Set(
      //   variablesConfigList.map((variable: any) => variable.name)
      // );

      // // Initialize the graph with empty arrays
      // for (let item of variablesConfigList) {
      //   graph[item.name] = [];
      // }

      // // Populate the graph
      // for (let item of variablesConfigList) {
      //   let name = item.name;
      //   if (item.type == "query_values") {
      //     for (let filter of item.query_data.filter ?? []) {
      //       let dependencies = extractVariableNames(
      //         filter.value,
      //         variablesNameList
      //       );
      //       if (graph[name]) {
      //         graph[name].push(...dependencies);
      //       } else {
      //         graph[name] = dependencies;
      //       }
      //     }
      //   } else {
      //     graph[name] = [];
      //   }
      // }

      // // Use variablesDependencyGraph to get an ordered list of variables.
      // const orderedVariables = topologicalSort(variablesDependencyGraph);

      // Create a map for faster lookup
      let orderIndex = topologicalSortedVariablesObj.reduce(
        (acc: any, item: any, index: any) => {
          acc[item] = index;
          return acc;
        },
        {}
      );
      // reset the values
      variablesData.values = [];
      variablesData.isVariablesLoading = false;

      variablesConfigList.forEach((it: any) => {
        const obj: any = {
          name: it.name,
          label: it.label,
          type: it.type,
          value: it.type == "dynamic_filters" ? [] : null,
          isLoading: ["query_values", "dynamic_filters"].includes(it.type)
            ? true
            : false,
        };
        variablesData.values.push(obj);
        variablesData.isVariablesLoading = true;
      });

      // Sort the data array based on the order array
      variablesConfigList.sort((a: any, b: any) => {
        return orderIndex[a.name] - orderIndex[b.name];
      });

      // load independent variables only.
      // if independent variables are not loaded, dependent variables will be automatically loaded due to watcher on variablesData.values change

      for (let index = 0; index < variablesConfigList.length; index++) {
        // if dependency is not there then load
        if (!variablesDependencyGraph[variablesConfigList[index].name]) {
          getSingleVariableData(variablesConfigList, index);
        }
      }

      // for (let index = 0; index < variablesConfigList.length; index++) {
      //   const it = variablesConfigList[index];

      //   // based on it.name find that variable from variablsData
      //   const currentVariableIndex = variablesData.values.findIndex(
      //     (obj: any) => obj.name === it.name
      //   );

      //   const obj = variablesData.values[currentVariableIndex];

      //   switch (it.type) {
      //     case "query_values": {
      //       try {
      //         console.log("it.type", it);
      //         obj.isLoading = true;
      //         console.log("query_data", it.query_data.filter);
      //         const filterConditions = it.query_data.filter || [];

      //         let dummyQuery = `SELECT * FROM '${it.query_data.stream}'`;
      //         const constructedFilter = filterConditions.map(
      //           (condition: any) => ({
      //             name: condition.name,
      //             operator: condition.operator,
      //             value: condition.value,
      //           })
      //         );
      //         let queryContext = addLabelsToSQlQuery(
      //           dummyQuery,
      //           constructedFilter
      //         );

      //         // replace variables placeholders
      //         variablesData?.values.forEach((variable: any) => {
      //           if (variable.value) {
      //             queryContext = queryContext.replace(
      //               `$${variable.name}`,
      //               variable.value
      //             );
      //           }
      //         });

      //         // base64 encode the query
      //         queryContext = b64EncodeUnicode(queryContext) || "";

      //         const res = await streamService.fieldValues({
      //           org_identifier: store.state.selectedOrganization.identifier,
      //           stream_name: it.query_data.stream,
      //           start_time: new Date(
      //             props.selectedTimeDate?.start_time?.toISOString()
      //           ).getTime(),
      //           end_time: new Date(
      //             props.selectedTimeDate?.end_time?.toISOString()
      //           ).getTime(),
      //           fields: [it.query_data.field],
      //           size: it?.query_data?.max_record_size
      //             ? it?.query_data?.max_record_size
      //             : 10,
      //           type: it.query_data.stream_type,
      //           query_context: queryContext,
      //         });

      //         obj.isLoading = false;
      //         if (res.data.hits.length) {
      //           //set options value from the api response
      //           obj.options = res.data.hits
      //             .find((field: any) => field.field === it.query_data.field)
      //             .values.filter(
      //               (value: any) => value.zo_sql_key || value.zo_sql_key === ""
      //             )
      //             .map((value: any) => ({
      //               label:
      //                 value.zo_sql_key !== ""
      //                   ? value.zo_sql_key.toString()
      //                   : "<blank>",
      //               value: value.zo_sql_key.toString(),
      //             }));

      //           // find old value is exists in the dropdown
      //           let oldVariableObjectSelectedValue = oldVariableValue.find(
      //             (it2: any) => it2.name === it.name
      //           );

      //           // if the old value exist in dropdown set the old value otherwise set first value of drop down otherwise set blank string value
      //           if (oldVariableObjectSelectedValue) {
      //             obj.value = obj.options.some(
      //               (option: any) =>
      //                 option.value === oldVariableObjectSelectedValue.value
      //             )
      //               ? oldVariableObjectSelectedValue.value
      //               : obj.options.length
      //               ? obj.options[0].value
      //               : "";
      //           } else {
      //             obj.value = obj.options.length ? obj.options[0].value : "";
      //           }

      //           variablesData.isVariablesLoading = variablesData.values.some(
      //             (val: { isLoading: any }) => val.isLoading
      //           );

      //           // triggers rerendering in the current component
      //           variablesData.values[currentVariableIndex] = obj;

      //           emitVariablesData();
      //           // return obj;
      //           break;
      //         } else {
      //           variablesData.isVariablesLoading = variablesData.values.some(
      //             (val: { isLoading: any }) => val.isLoading
      //           );

      //           // triggers rerendering in the current component
      //           variablesData.values[currentVariableIndex] = obj;

      //           emitVariablesData();

      //           // return obj;
      //           break;
      //         }
      //       } catch (err: any) {
      //         console.log("error", err);
      //         obj.isLoading = false;

      //         variablesData.isVariablesLoading = variablesData.values.some(
      //           (val: { isLoading: any }) => val.isLoading
      //         );

      //         // triggers rerendering in the current component
      //         variablesData.values[currentVariableIndex] = obj;

      //         emitVariablesData();
      //         // return obj;
      //         break;
      //       }
      //     }
      //     case "constant": {
      //       obj.value = it.value;
      //       // return obj;
      //       break;
      //     }
      //     case "textbox": {
      //       let oldVariableObjectSelectedValue = oldVariableValue.find(
      //         (it2: any) => it2.name === it.name
      //       );
      //       if (oldVariableObjectSelectedValue) {
      //         obj.value = oldVariableObjectSelectedValue.value;
      //       } else {
      //         obj.value = it.value;
      //       }
      //       // return obj;
      //       break;
      //     }
      //     case "custom": {
      //       obj["options"] = it?.options;
      //       let oldVariableObjectSelectedValue = oldVariableValue.find(
      //         (it2: any) => it2.name === it.name
      //       );
      //       // if the old value exist in dropdown set the old value otherwise set first value of drop down otherwise set blank string value
      //       if (oldVariableObjectSelectedValue) {
      //         obj.value = oldVariableObjectSelectedValue.value;
      //       } else {
      //         obj.value = obj.options[0]?.value || "";
      //       }
      //       // return obj;
      //       break;
      //     }
      //     case "dynamic_filters": {
      //       // commented this because we don't want this to call stream api call

      //       // obj.isLoading = true; // Set loading state

      //       // return getStreams("", false)
      //       //   .then((res) => {
      //       //     obj.isLoading = false; // Reset loading state

      //       //     const fieldsObj: any = {};

      //       // res.data.list.forEach((item: any) => {
      //       //   const name = item.name;
      //       //   const stream_type = item.stream_type;

      //       // (item.schema || []).forEach((schemaItem: any) => {
      //       //   const fieldName = schemaItem.name;

      //       //           if (!fieldsObj[fieldName]) {
      //       //             fieldsObj[fieldName] = [];
      //       //           }

      //       //           const existingEntry = fieldsObj[fieldName].find(
      //       //             (entry: any) =>
      //       //               entry.name === name && entry.stream_type === stream_type
      //       //           );

      //       //           if (!existingEntry) {
      //       //             fieldsObj[fieldName].push({
      //       //               name: name,
      //       //               stream_type: stream_type,
      //       //             });
      //       //           }
      //       //         });
      //       //       });
      //       //       const fieldsArray = Object.entries(fieldsObj).map(
      //       //         ([schemaName, entries]) => ({
      //       //           name: schemaName,
      //       //           streams: entries,
      //       //         })
      //       //       );
      //       //       obj.options = fieldsArray;

      //       //       let old = oldVariableValue.find(
      //       //         (it2: any) => it2.name === it.name
      //       //       );
      //       //       if (old) {
      //       //         obj.value = old.value.map((it2: any) => ({
      //       //           ...it2,
      //       //           streams: fieldsArray.find(
      //       //             (it3: any) => it3.name === it2.name
      //       //           )?.streams,
      //       //         }));
      //       //       } else {
      //       //         obj.value = [];
      //       //       }

      //       //       variablesData.isVariablesLoading = variablesData.values.some(
      //       //         (val: { isLoading: any }) => val.isLoading
      //       //       );

      //       //       // triggers rerendering in the current component
      //       //       variablesData.values[index] = obj;
      //       //       emitVariablesData();
      //       //       return obj;
      //       //     })
      //       //     .catch((error) => {
      //       //       obj.isLoading = false; // Reset loading state
      //       //       // Handle error
      //       //       variablesData.isVariablesLoading = variablesData.values.some(
      //       //         (val: { isLoading: any }) => val.isLoading
      //       //       );

      //       //       // triggers rerendering in the current component
      //       //       variablesData.values[index] = obj;

      //       //       emitVariablesData();
      //       //       return obj;
      //       //     });
      //       obj.isLoading = false; // Set loading state
      //       let oldVariableObjectSelectedValue = oldVariableValue.find(
      //         (it2: any) => it2.name === it.name
      //       );
      //       if (oldVariableObjectSelectedValue) {
      //         obj.value = oldVariableObjectSelectedValue.value;
      //       } else {
      //         obj.value = it.value;
      //       }
      //       emitVariablesData();
      //       // return obj;
      //       break;
      //     }
      //     default:
      //       obj.value = it.value;
      //       // return obj;
      //       break;
      //   }
      // }

      // variablesData.isVariablesLoading = variablesData.values.some(
      //   (val: { isLoading: any }) => val.isLoading
      // );
      // emitVariablesData();

      // promise.forEach(async (p: any) => {
      //   await p;
      // });

      // Promise.all(promise)
      //   .then(() => {
      //     variablesData.isVariablesLoading = false;
      //   })
      //   .catch(() => {
      //     variablesData.isVariablesLoading = false;
      //     emitVariablesData();
      //   });
    };
    return {
      props,
      variablesData,
      changeInitialVariableValues,
    };
  },
});
</script>

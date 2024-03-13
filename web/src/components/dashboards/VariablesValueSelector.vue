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
import { getCurrentInstance, onMounted, watch } from "vue";
import { defineComponent, reactive } from "vue";
import streamService from "../../services/stream";
import { useStore } from "vuex";
import VariableQueryValueSelector from "./settings/VariableQueryValueSelector.vue";
import VariableAdHocValueSelector from "./settings/VariableAdHocValueSelector.vue";
import { isInvalidDate } from "@/utils/date";
import useStreams from "@/composables/useStreams";

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
    const { getStreams } = useStreams();
    onMounted(async () => {
      await getVariablesData();
    });
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

    const emitVariablesData = () => {
      instance?.proxy?.$forceUpdate();
      emit("variablesData", JSON.parse(JSON.stringify(variablesData)));
    };

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

      const variablesConfigList =
        JSON.parse(JSON.stringify(props.variablesConfig?.list)) || [];

      if (props.showDynamicFilters) {
        variablesConfigList.push({
          name: "__dynamic_filters",
          label: "Dynamic Filters",
          type: "dynamic_filters",
          value: [],
        });
      }

      // get old variable values
      let oldVariableValue = JSON.parse(JSON.stringify(variablesData.values));
      if (!oldVariableValue.length) {
        const dynamicVariables =
          variablesConfigList
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

      // continue as we have variables

      // reset the values
      variablesData.values = [];
      variablesData.isVariablesLoading = false;

      const promise = variablesConfigList?.map((it: any, index: any) => {
        const obj: any = {
          name: it.name,
          label: it.label,
          type: it.type,
          value: it.type == "dynamic_filters" ? [] : "",
          isLoading: ["query_values", "dynamic_filters"].includes(it.type)
            ? true
            : false,
        };
        variablesData.values.push(obj);
        variablesData.isVariablesLoading = true;

        switch (it.type) {
          case "query_values": {
            obj.isLoading = true;
            return streamService
              .fieldValues({
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
              })
              .then((res: any) => {
                obj.isLoading = false;
                if (res.data.hits.length) {
                  //set options value from the api response
                  obj.options = res.data.hits
                    .find((field: any) => field.field === it.query_data.field)
                    .values.map((value: any) =>
                      value.zo_sql_key ? value.zo_sql_key.toString() : "null"
                    );
                  // find old value is exists in the dropdown
                  let oldVariableObjectSelectedValue = oldVariableValue.find(
                    (it2: any) => it2.name === it.name
                  );

                  // if the old value exist in dropdown set the old value otherwise set first value of drop down otherwise set blank string value
                  if (oldVariableObjectSelectedValue) {
                    obj.value = obj.options.includes(
                      oldVariableObjectSelectedValue.value
                    )
                      ? oldVariableObjectSelectedValue.value
                      : obj.options.length
                      ? obj.options[0]
                      : "";
                  } else {
                    obj.value = obj.options[0] || "";
                  }
                  variablesData.isVariablesLoading = variablesData.values.some(
                    (val: { isLoading: any }) => val.isLoading
                  );

                  // triggers rerendering in the current component
                  variablesData.values[index] = obj;

                  emitVariablesData();
                  return obj;
                } else {
                  variablesData.isVariablesLoading = variablesData.values.some(
                    (val: { isLoading: any }) => val.isLoading
                  );

                  // triggers rerendering in the current component
                  variablesData.values[index] = obj;

                  emitVariablesData();
                  return obj;
                }
              })
              .catch((err: any) => {
                obj.isLoading = false;

                variablesData.isVariablesLoading = variablesData.values.some(
                  (val: { isLoading: any }) => val.isLoading
                );

                // triggers rerendering in the current component
                variablesData.values[index] = obj;
                emitVariablesData();
                return obj;
              });
          }
          case "constant": {
            obj.value = it.value;
            return obj;
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
            return obj;
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
            return obj;
            // break;
          }
          case "dynamic_filters": {
            // commented this because we don't want this to call stream api call

            // obj.isLoading = true; // Set loading state

            // return getStreams("", false)
            //   .then((res) => {
            //     obj.isLoading = false; // Reset loading state

            //     const fieldsObj: any = {};

            //     res.list.forEach((item: any) => {
            //       const name = item.name;
            //       const stream_type = item.stream_type;

            //       (item.schema || []).forEach((schemaItem: any) => {
            //         const fieldName = schemaItem.name;

            //         if (!fieldsObj[fieldName]) {
            //           fieldsObj[fieldName] = [];
            //         }

            //         const existingEntry = fieldsObj[fieldName].find(
            //           (entry: any) =>
            //             entry.name === name && entry.stream_type === stream_type
            //         );

            //         if (!existingEntry) {
            //           fieldsObj[fieldName].push({
            //             name: name,
            //             stream_type: stream_type,
            //           });
            //         }
            //       });
            //     });
            //     const fieldsArray = Object.entries(fieldsObj).map(
            //       ([schemaName, entries]) => ({
            //         name: schemaName,
            //         streams: entries,
            //       })
            //     );
            //     obj.options = fieldsArray;

            //     let old = oldVariableValue.find(
            //       (it2: any) => it2.name === it.name
            //     );
            //     if (old) {
            //       obj.value = old.value.map((it2: any) => ({
            //         ...it2,
            //         streams: fieldsArray.find(
            //           (it3: any) => it3.name === it2.name
            //         )?.streams,
            //       }));
            //     } else {
            //       obj.value = [];
            //     }

            //     variablesData.isVariablesLoading = variablesData.values.some(
            //       (val: { isLoading: any }) => val.isLoading
            //     );

            //     // triggers rerendering in the current component
            //     variablesData.values[index] = obj;
            //     emitVariablesData();
            //     return obj;
            //   })
            //   .catch((error) => {
            //     obj.isLoading = false; // Reset loading state
            //     // Handle error
            //     variablesData.isVariablesLoading = variablesData.values.some(
            //       (val: { isLoading: any }) => val.isLoading
            //     );

            //     // triggers rerendering in the current component
            //     variablesData.values[index] = obj;

            //     emitVariablesData();
            //     return obj;
            //   });
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
            return obj;
          }
          default:
            obj.value = it.value;
            return obj;
        }
      });

      variablesData.isVariablesLoading = variablesData.values.some(
        (val: { isLoading: any }) => val.isLoading
      );
      emitVariablesData();

      Promise.all(promise)
        .then(() => {
          variablesData.isVariablesLoading = false;
        })
        .catch(() => {
          variablesData.isVariablesLoading = false;
          emitVariablesData();
        });
    };
    return {
      props,
      variablesData,
      changeInitialVariableValues,
    };
  },
});
</script>

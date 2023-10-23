<!-- Copyright 2023 Zinc Labs Inc.
 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at
     http:www.apache.org/licenses/LICENSE-2.0
 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License. 
-->
<template>
  <div v-if="variablesData.values?.length > 0" :key="variablesData.isVariablesLoading" class="flex q-mt-sm q-ml-sm">
    <div v-for="item in variablesData.values" :key="item.name + item.value + item.type + item.options?.length + item.isLoading" class="q-mr-lg q-mt-sm">
      <div v-if="item.type == 'query_values'">
          <VariableQueryValueSelector v-model="item.value" :variableItem="item" />
      </div>
      <div v-else-if="item.type == 'constant'">
        <q-input style="max-width: 150px !important" v-model="item.value" :label="item.label || item.name" dense outlined
          readonly></q-input>
      </div>
      <div v-else-if="item.type == 'textbox'">
        <q-input style="max-width: 150px !important" debounce="500" v-model="item.value" :label="item.label || item.name" dense
          outlined></q-input>
      </div>
      <div v-else-if="item.type == 'custom'">
        <q-select style="min-width: 150px;" outlined dense v-model="item.value" :display-value="item.value ? item.value : !item.isLoading ? '(No Options Available)' : ''" :options="item.options" map-options stack-label filled borderless
          :label="item.label || item.name" option-value="value" option-label="label" emit-value>
          <template v-slot:no-option>
              <q-item>
                <q-item-section class="text-italic text-grey">
                  No Options Available
                </q-item-section>
              </q-item>
            </template>
        </q-select>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { onMounted, watch } from 'vue';
import { defineComponent, reactive } from 'vue';
import streamService from "../../services/stream";
import { useStore } from 'vuex';
import VariableQueryValueSelector from './settings/VariableQueryValueSelector.vue';

export default defineComponent({
    name: "VariablesValueSelector",
    props: ["selectedTimeDate", "variablesConfig", "initialVariableValues"],
    emits: ["variablesData"],
    components: {
      VariableQueryValueSelector
    },
    setup(props: any, { emit }) {
        const store = useStore();
        // variables data derived from the variables config list 
        const variablesData: any = reactive({
            isVariablesLoading: false,
            values: []
        });
        console.log("variablesData from the setup", JSON.stringify(variablesData.values));
        onMounted(() => {
            getVariablesData();
        });
        // you may need to query the data if the variable configs or the data/time changes
        watch(() => [props.variablesConfig, props.selectedTimeDate], () => {
            getVariablesData();
        });
        watch(() => variablesData, () => {
            emitVariablesData();
        }, { deep: true });

        const emitVariablesData = () => {
            emit("variablesData", JSON.parse(JSON.stringify(variablesData)));
            console.log("variablesData", JSON.parse(JSON.stringify(variablesData.values)));
            
        };

        const getVariablesData = async () => {
            // do we have variables & date?
            if (!props.variablesConfig?.list || !props.selectedTimeDate?.start_time) {
                console.log('broken return');
                
                variablesData.values = [];
                variablesData.isVariablesLoading = false;
                emitVariablesData();
                return;
            }
            
            // get old variable values
            let oldVariableValue = JSON.parse(JSON.stringify(variablesData.values));
            if(!oldVariableValue.length) {
                oldVariableValue = Object.keys(props.initialVariableValues).map((key: any) => ({
                    name: key,
                    value: props.initialVariableValues[key],
                }))
            }
            console.log('old values' , JSON.stringify(oldVariableValue));
            
            // continue as we have variables
            
            // reset the values
            variablesData.values = []
            variablesData.isVariablesLoading = false;

            const promise = props.variablesConfig?.list?.map((it: any, index: any) => {
                
                const obj: any = { name: it.name, label: it.label, type: it.type, value: "", isLoading: it.type == "query_values" ? true : false };
                variablesData.values.push(obj);
                variablesData.isVariablesLoading = true;

                switch (it.type) {
                    case "query_values": {
                        obj.isLoading = true;
                        return streamService
                            .fieldValues({
                            org_identifier: store.state.selectedOrganization.identifier,
                            stream_name: it.query_data.stream,
                            start_time: new Date(props.selectedTimeDate?.start_time?.toISOString()).getTime(),
                            end_time: new Date(props.selectedTimeDate?.end_time?.toISOString()).getTime(),
                            fields: [it.query_data.field],
                            size: it?.query_data?.max_record_size ? it?.query_data?.max_record_size : 10,
                            type: it.query_data.stream_type,
                        })
                            .then((res: any) => {
                            obj.isLoading = false;
                            if (res.data.hits.length) {
                                //set options value from the api response
                                obj.options = res.data.hits
                                    .find((field: any) => field.field === it.query_data.field)
                                    .values.map((value: any) => value.zo_sql_key ? value.zo_sql_key.toString() : "null");
                                // find old value is exists in the dropdown
                                let oldVariableObjectSelectedValue = oldVariableValue.find((it2: any) => it2.name === it.name);
                                console.log("oldVariableObjectSelectedValue", oldVariableObjectSelectedValue);
                                
                                // if the old value exist in dropdown set the old value otherwise set first value of drop down otherwise set blank string value
                                if (oldVariableObjectSelectedValue) {
                                    obj.value = obj.options.includes(oldVariableObjectSelectedValue.value) ? oldVariableObjectSelectedValue.value : obj.options.length ? obj.options[0] : "";
                                }
                                else {
                                    obj.value = obj.options[0] || "";
                                }
                                variablesData.isVariablesLoading = variablesData.values.some((val: { isLoading: any; }) => val.isLoading);
                                
                                // triggers rerendering in the current component
                                variablesData.values[index] = JSON.parse(JSON.stringify(obj))
                                
                                emitVariablesData();
                                return obj;
                            }
                            else {
                                variablesData.isVariablesLoading = variablesData.values.some((val: { isLoading: any; }) => val.isLoading);

                                // triggers rerendering in the current component
                                variablesData.values[index] = JSON.parse(JSON.stringify(obj))

                                emitVariablesData();
                                return obj;
                            }
                        })
                        .catch((err: any) => {
                            obj.isLoading = false;

                            variablesData.isVariablesLoading = variablesData.values.some((val: { isLoading: any; }) => val.isLoading);

                            // triggers rerendering in the current component
                            variablesData.values[index] = JSON.parse(JSON.stringify(obj))

                            emitVariablesData();
                            return obj;
                        });
                    }
                    case "constant": {
                        obj.value = it.value;
                        return obj;
                    }
                    case "textbox": {
                        obj.value = it.value;
                        return obj;
                    }
                    case "custom": {
                        obj["options"] = it?.options;
                        let oldVariableObjectSelectedValue = oldVariableValue.find((it2: any) => it2.name === it.name);
                        // if the old value exist in dropdown set the old value otherwise set first value of drop down otherwise set blank string value
                        if (oldVariableObjectSelectedValue) {
                            obj.value = oldVariableObjectSelectedValue.value;
                        }
                        else {
                            obj.value = obj.options[0]?.value || "";
                        }
                        return obj;
                        // break;
                    }
                    default:
                        obj.value = it.value;
                        return obj;
                }
            });

            variablesData.isVariablesLoading = false;
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
            variablesData
        };
    },
});
</script>
 
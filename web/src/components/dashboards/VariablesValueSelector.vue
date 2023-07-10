<template>
  <div v-if="variablesData.values?.length > 0 && !variablesData.isVariablesLoading" class="flex q-mt-sm q-ml-sm">
    <div v-for="item in variablesData.values" class="q-mr-lg">
      <div v-if="item.type == 'query'">
        <q-select outlined dense v-model="item.value" :options="item.options" :label="item.label || item.name"></q-select>
      </div>
      <div v-else-if="item.type == 'constant'">
        <q-input v-model="item.name" :label="item.label || item.name" dense outlined readonly></q-input>
      </div>
      <div v-else-if="item.type == 'textbox'">
        <q-input v-model="item.name" :label="item.label || item.name" dense outlined></q-input>
      </div>
      <div v-else-if="item.type == 'custom_fields'">
        <q-select outlined dense v-model="item.value" :options="item.options" :label="item.label || item.name"></q-select>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { onMounted, watch } from 'vue';
import { defineComponent, reactive } from 'vue';
import streamService from "../../services/stream";
import { useStore } from 'vuex';

export default defineComponent({
  name: "VariablesValueSelector",
  props: ["selectedTimeDate", "variablesConfig"],
  emits: ["variablesData"],
  setup(props: any, { emit }) {
    const store = useStore()

    // variables data derived from the variables config list 
    const variablesData: any = reactive({
      isVariablesLoading: false,
      values: []
    })

    // TODO: update values on time change (if required)

    onMounted(() => {
      getVariablesData()
    })

    // you may need to query the data if the variable configs or the data/time changes
    watch(() => [props.variablesConfig, props.selectedTimeDate], () => {
      getVariablesData()
    })

    watch(() => variablesData, () => {
      emit('variablesData', variablesData)
    })

    const getVariablesData = async () => {
      // do we have variables & date?
      if (!props.variablesConfig?.list || !props.selectedTimeDate?.start_time) {
        variablesData.values = []
        variablesData.isVariablesLoading = false
        emit('variablesData', variablesData)
        return
      }

      // continue as we have variables
      const promise = props.variablesConfig?.list?.map((it: any) => {
        const obj: any = { name: it.name, label: it.label, type: it.type, value: "", isLoading: false }
        switch (it.type) {

          case "query": {
            obj.isLoading = true
            return streamService
              .fieldValues({
                org_identifier: store.state.selectedOrganization.identifier,
                stream_name: it.query_data.stream,
                start_time: new Date(props.selectedTimeDate?.start_time?.toISOString()).getTime() * 1000,
                end_time: new Date(props.selectedTimeDate?.end_time?.toISOString()).getTime() * 1000,
                fields: [it.query_data.field],
                size: 10,
                type: it.query_data.stream_type,
              })
              .then((res: any) => {
                obj.isLoading = false
                if (res.data.hits.length) {
                  obj.options = res.data.hits
                    .find((field: any) => field.field === it.query_data.field)
                    .values.map((value: any) => value.zo_sql_key ? value.zo_sql_key : "null")
                  obj.value = obj.options[0] || ""

                  return obj
                } else {
                  return obj
                }
              })
              .catch((err: any) => {
                return obj
              })
            // break;
          }
          case "constant": {
            obj.value = it.value
            return obj
            // break;
          }
          case "textbox": {
            obj.value = it.value
            return obj
            // break;
          }
          case "custom_fields": {
            obj["options"] = it.options
            obj.value = obj.options[0] || ""
            return obj
            // break;
          }
          default:
            obj.value = it.value
            return obj
        }
      })
      variablesData.values = await Promise.all(promise || [])
      variablesData.isVariablesLoading = false
      emit('variablesData', variablesData)
    }

    return {
      props,
      variablesData
    };
  },
});
</script>
 
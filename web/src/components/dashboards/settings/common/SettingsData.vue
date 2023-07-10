<template>
    <div v-if="variablesData.values?.length > 0 && !variablesData.isVariablesLoading"
          class="flex q-mt-sm q-ml-sm">
          <div v-for="item in variablesData.values" class="q-mr-lg">
            <div v-if="item.type == 'query'">
              <q-select
                outlined
                dense
                v-model="item.value"
                :options="item.options"
                :label="item.label"
              ></q-select>
              <!-- <q-input v-model="item.name" :label="item.label" dense></q-input> -->
            </div>
            <div v-else-if="item.type == 'constant'">
              <q-input v-model="item.name" :label="item.label" dense outlined readonly></q-input>
            </div>
            <div v-else-if="item.type == 'textbox'">
              <q-input v-model="item.name" :label="item.label" dense outlined></q-input>
            </div>
             <!-- v-model="item.value" -->
            <div v-if="item.type == 'custom_fields'">
              <q-select
                  outlined
                  dense
                  v-model="item.value"
                  :options="item.options"
                  :label="item.label"
                ></q-select>
            </div>
          </div>
        </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';

export default defineComponent({
    name: "SettingsData",
    props: ["selectedTimeDate","variablesData"],

    setup(props:any) {
        //get props data
        const getSettingsData = () => {
            return props.data;
        }

        return {
            props,
            getSettingsData,
        };
    },
});
</script>
 
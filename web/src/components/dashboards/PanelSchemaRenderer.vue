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
  <div ref="chartPanelRef"  style="height: 100%; position: relative;">
    <div v-show="!errorDetail" class="plotlycontainer" style="height: 100%; width: 100%;">
      <ChartRenderer v-if="panelSchema.type != 'table'" :data="panelData" />
      <TableRenderer v-else-if="panelSchema.type == 'table'" :data="panelData" />
    </div>
    <div v-if="!errorDetail" class="noData">{{ noData }}</div>
    <div v-if="errorDetail" class="errorMessage">
      <q-icon size="md" name="warning" />
      <div style="height: 80%; width: 100%;">{{ errorDetail }}</div>
    </div>
    <div v-if="loading" class="row" style="position: absolute; top:0px; width:100%;">
      <q-spinner-dots color="primary" size="40px" style="margin: 0 auto;" />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, watch, ref, onMounted, watchEffect, toRef, toRefs, onUnmounted, nextTick, computed } from "vue";
import { useStore } from "vuex";
import { usePanelDataLoader } from "@/composables/dashboard/usePanelDataLoader";
import { convertPanelData } from "@/utils/dashboard/convertPanelData";
import ChartRenderer from "@/components/dashboards/panels/ChartRenderer.vue";
import TableRenderer from "@/components/dashboards/panels/TableRenderer.vue";
export default defineComponent({
  name: "PanelSchemaRenderer",
  components: { ChartRenderer, TableRenderer },
  props: {
    selectedTimeObj: {
      required: true,
      type: Object,
    },
    panelSchema: {
      required: true,
      type: Object,
    },
    variablesData: {
      required: true,
      type: Object,
    },
  },
  setup(props, { emit }) {
    const store = useStore();

    // stores the converted data which can be directly used for rendering different types of panels
    const panelData: any = ref({});
    const chartPanelRef = ref(null);
    const {panelSchema, selectedTimeObj, variablesData } = toRefs(props)
    
    // calls the apis to get the data based on the panel config
    let { data, loading, errorDetail } = usePanelDataLoader(panelSchema, selectedTimeObj, variablesData,chartPanelRef);

    // when we get the new data from the apis, convert the data to render the panel
    watch(data, async () => {
      console.log("PanelSchemaRenderer: new data received from the api, let's convert the data");
      console.log("PanelSchemaRenderer: data: ", data.value);
      panelData.value = convertPanelData(panelSchema, data.value, store);
    });

    const noData = computed(() => {
      // console.log("inside no Data computed");
      if ( panelSchema.value?.queryType == "promql") {
        // console.log("inside no Data if");
        // console.log("PanelSchemaRenderer: noData:" , data.value[0].result?.length);
        return data.value.length && data.value.every((item) => item.result?.length) ? "" : "No Data"
      } else {
        // console.log("inside no Data else");
        return !data.value.length ? "No Data" : ""
      }
    })

    // when the error changes, emit the error
    watch(errorDetail, () => {
      emit("error", errorDetail);
    })
    
    return {
      chartPanelRef,
      data,
      loading,
      errorDetail,
      panelData,
      noData,
    };
  },
});
</script>
  
<style lang="scss" scoped>
.errorMessage {
  position: absolute;
  top: 20%;
  width: 100%;
  height: 80%;
  overflow: hidden;
  text-align: center;
  color: rgba(255, 0, 0, 0.8);
  text-overflow: ellipsis;
}

.noData{
    position: absolute; 
    top:20%;
    width:100%;
    text-align:center;
}
</style>
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
  <div ref="chartPanelRef" style="height: 100%; position: relative">
    <div
      v-show="!errorDetail"
      style="height: 100%; width: 100%"
    >
    <GeoMapRenderer v-if="panelSchema.type == 'geomap'" :data="panelData.chartType == 'geomap'? panelData: {options: {}}" />
    <TableRenderer
    v-else-if="panelSchema.type == 'table'"
    :data="panelData.chartType == 'table'? panelData: {options: {}}"
    />
    <ChartRenderer v-else :data="panelSchema.queryType === 'promql' || (data.length && data[0]?.length  && panelData.chartType != 'geomap' && panelData.chartType != 'table') ? panelData : {options:{}}" />
    </div>
    <div v-if="!errorDetail" class="noData">{{ noData }}</div>
    <div v-if="errorDetail && !panelSchema?.error_config?.custom_error_handeling" class="errorMessage">
      <q-icon size="md" name="warning" />
      <div style="height: 80%; width: 100%">{{ errorDetail }}</div>
    </div>
    <div v-if="errorDetail 
        && panelSchema?.error_config?.custom_error_handeling 
        && !panelSchema?.error_config?.default_data_on_error 
        && panelSchema?.error_config?.custom_error_message" 
      class="customErrorMessage"
    >
      {{ panelSchema?.error_config?.custom_error_message }}
    </div>
    <div
      v-if="loading"
      class="row"
      style="position: absolute; top: 0px; width: 100%; z-index: 999;"
    >
      <q-spinner-dots color="primary" size="40px" style="margin: 0 auto; z-index: 999;" />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, watch, ref, toRefs, computed } from "vue";
import { useStore } from "vuex";
import { usePanelDataLoader } from "@/composables/dashboard/usePanelDataLoader";
import { convertPanelData } from "@/utils/dashboard/convertPanelData";
import ChartRenderer from "@/components/dashboards/panels/ChartRenderer.vue";
import TableRenderer from "@/components/dashboards/panels/TableRenderer.vue";
import GeoMapRenderer from "@/components/dashboards/panels/GeoMapRenderer.vue";
export default defineComponent({
  name: "PanelSchemaRenderer",
  components: { ChartRenderer, TableRenderer, GeoMapRenderer },
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
    const panelData: any = ref({}); // holds the data to render the panel after getting data from the api based on panel config
    const chartPanelRef = ref(null); // holds the ref to the whole div
    // get refs from props
    const { panelSchema, selectedTimeObj, variablesData } = toRefs(props);

    // calls the apis to get the data based on the panel config
    let { data, loading, errorDetail } = usePanelDataLoader(
      panelSchema,
      selectedTimeObj,
      variablesData,
      chartPanelRef
    );

    // when we get the new data from the apis, convert the data to render the panel
    watch([data, store?.state], async () => {
      // panelData.value = convertPanelData(panelSchema.value, data.value, store);
      if (!errorDetail.value) {

        try {
          panelData.value = convertPanelData(panelSchema.value, data.value, store);
          errorDetail.value = "";
        } catch (error: any) {
          errorDetail.value = error.message;
        }
      } else {
        // if no data is available, then show the default data
        // if there is an error config in the panel schema, then show the default data on error
        // if no default data on error is set, then show the custom error message
        if(panelSchema.value?.error_config?.custom_error_handeling && panelSchema.value?.error_config?.default_data_on_error){
          data.value = JSON.parse(panelSchema.value?.error_config?.default_data_on_error)
          errorDetail.value = ""
        }
      }
    },{ deep: true });
    
    const handleNoData = (panelType: any) => {
      const xAlias = panelSchema.value.queries[0].fields.x.map((it: any) => it.alias)
      const yAlias = panelSchema.value.queries[0].fields.y.map((it: any) => it.alias)
      const zAlias = panelSchema.value.queries[0].fields.z.map((it: any) => it.alias)      
      
      switch (panelType) {
        case "area":
        case "area-stacked":
        case "bar":
        case "h-bar":
        case "stacked":
        case "h-stacked":
        case "line":
        case "scatter":
        case "table":
          {
            // return data.value[0].some((it: any) => {return (xAlias.every((x: any) => it[x]) && yAlias.every((y: any) => it[y]))});
            return data.value[0]?.length > 1 || xAlias.every((x: any) => data.value[0][0][x]) && yAlias.every((y: any) => data.value[0][0][y]);
          }
        case "metric":
          {
            return data.value[0]?.length > 1 || yAlias.every((y: any) => data.value[0][0][y] != null || data.value[0][0][y] === 0);
          }
        case "heatmap":
          {
            return data.value[0]?.length > 1 || xAlias.every((x: any) => data.value[0][0][x]) && yAlias.every((y: any) => data.value[0][0][y]) && zAlias.every((z: any) => data.value[0][0][z]);
          }
        default:
          break;
      }
    } 
    
    // Compute the value of the 'noData' variable
    const noData = computed(() => {
      // Check if the queryType is 'promql'
      if (panelSchema.value?.queryType == "promql") {
        // Check if the 'data' array has elements and every item has a non-empty 'result' array
        return data.value.length &&
          data.value.every((item: any) => item?.result?.length)
          ? "" // Return an empty string if there is data
          : "No Data"; // Return "No Data" if there is no data
      } else {
        // The queryType is not 'promql'        
        return data.value.length && data.value[0]?.length && handleNoData(panelSchema.value.type) ? "" : "No Data"; // Return "No Data" if the 'data' array is empty, otherwise return an empty string
      }
    });

    // when the error changes, emit the error
    watch(errorDetail, () => {
      //check if there is an error message or not
      if (!errorDetail.value) return;
      emit("error", errorDetail);
    });

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

.customErrorMessage {
  position: absolute;
  top: 20%;
  width: 100%;
  height: 80%;
  overflow: hidden;
  text-align: center;
  text-overflow: ellipsis;
}

.noData {
  position: absolute;
  top: 20%;
  width: 100%;
  text-align: center;
}
</style>

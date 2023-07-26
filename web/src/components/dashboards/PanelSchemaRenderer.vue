<template>
  <div style="height: 100%; position: relative;">
    <div v-show="!errorDetail" class="plotlycontainer" style="height: 100%">
      <ChartRenderer :data="panelData" />
    </div>
    <!-- <div v-if="!errorDetail" class="noData">{{ noData }}</div> -->
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
import { defineComponent, watch, ref, onMounted, watchEffect, toRef } from "vue";
import { useStore } from "vuex";
import { usePanelDataLoader } from "@/composables/dashboard/usePanelDataLoader";
import { convertPanelData } from "@/utils/dashboard/convertPanelData";
import ChartRenderer from "@/components/dashboards/panels/ChartRenderer.vue";

export default defineComponent({
  name: "PanelSchemaRenderer",
  components: { ChartRenderer },
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

    const tempPanelSchema = ref(props.panelSchema)
    const tempSelectedTimeObj = ref(props.selectedTimeObj)
    const tempVariablesData = ref(props.variablesData)

    // calls the apis to get the data based on the panel config
    const { data, loading, errorDetail } = usePanelDataLoader(
      tempPanelSchema,
      tempSelectedTimeObj,
      tempVariablesData
    );

    // when we get the new data from the apis, convert the data to render the panel
    watch(data, async () => {
      console.log("PanelSchemaRenderer: new data received from the api, let's convert the data");
      console.log("PanelSchemaRenderer: data: ", data.value);
      panelData.value = convertPanelData(props.panelSchema, data.value, store);
    });

    // when the error changes, emit the error
    watch(errorDetail, () => {
      emit("error", errorDetail);
    })

    watch(() => [props.panelSchema, props.selectedTimeObj, props.variablesData], async () => {
      console.log("props updated");
      tempPanelSchema.value = props.panelSchema
      tempSelectedTimeObj.value = props.selectedTimeObj
      tempVariablesData.value = props.variablesData
    })

    // -----------------------------------------------------------------------------
    return {
      data,
      loading,
      errorDetail,
      panelData,
    };
  },
});
</script>
  
<style lang="scss" scoped>
.errorMessage{
    position: absolute; 
    top:20%;width:100%; 
    height: 80%; 
    overflow: hidden;
    text-align:center;
    color: rgba(255, 0, 0, 0.8); 
    text-overflow: ellipsis;
}
</style>
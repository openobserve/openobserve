<template>
  <div  style="height: 100%; position: relative;">
    <div v-show="!errorDetail" class="plotlycontainer" style="height: 100%">
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

    const { panelSchema, selectedTimeObj, variablesData } = toRefs(props)

    // calls the apis to get the data based on the panel config
    let { data, loading, errorDetail } = usePanelDataLoader(panelSchema, selectedTimeObj, variablesData);

    // when we get the new data from the apis, convert the data to render the panel
    watch(data, async () => {
      console.log("PanelSchemaRenderer: new data received from the api, let's convert the data");
      console.log("PanelSchemaRenderer: data: ", data.value);
      panelData.value = convertPanelData(props.panelSchema, data.value, store);
    });

    const noData = computed(() => {
      console.log("inside no Data computed");
      if (props.panelSchema?.fields?.stream_type == "metrics" && props.panelSchema?.customQuery && props.panelSchema?.queryType == "promql") {
        console.log("inside no Data if");
        // console.log("PanelSchemaRenderer: noData:" , data.value[0].result?.length);
        return data.value[0].result?.length ? "" : "No Data"
      } else {
        console.log("inside no Data else");
        return !data.value.length ? "No Data" : ""
      }
    })

    // when the error changes, emit the error
    watch(errorDetail, () => {
      emit("error", errorDetail);
    })

    const chartPanelRef = ref(null)
    let observer: any = null;
    const isDirty: any = ref(true);
    const isVisible: any = ref(false);

    watch(() => isVisible.value, async () => {
        if (isVisible.value && isDirty.value) {
          const newData = usePanelDataLoader(panelSchema, selectedTimeObj, variablesData);
          data = newData.data;
          loading = newData.loading;
          errorDetail = newData.errorDetail;
        }
    })

    // remove intersection observer
    onUnmounted(() => {
        if (observer) {
            observer.disconnect();
        }
      });

      // [START] variables management
      let currentDependentVariablesData = props.variablesData?.values ? JSON.parse(JSON.stringify(props.variablesData?.values)) : []

      // check when the variables data changes
      // 1. get the dependent variables
      // 2. compare the dependent variables data with the old dependent variables Data
      // 3. if the value of any current variable is changed, call the api
      watch(() => props.variablesData?.values, () => {
        // ensure the query is there
        if(!data?.query) {
            return;
        }

        // 1. get the dependent variables list
        const newDependentVariablesData = props?.variablesData?.values?.filter((it: any) =>
            data?.query.includes(`$${it.name}`)
        );

        // if no variables, no need to rerun the query
        if(!newDependentVariablesData?.length) {
            return;
        }

        // 2. compare with the previously saved variable values, the variables data is an array of objects with name and value
        const isAllValuesSame = newDependentVariablesData.every((it: any) => {
            const oldValue = currentDependentVariablesData.find((it2: any) => it2.name == it.name);
            return it.value == oldValue?.value;
        });

        if(!isAllValuesSame) {
            currentDependentVariablesData = JSON.parse(JSON.stringify(newDependentVariablesData));
            isDirty.value = true;
            if(isVisible.value) {
              const newData = usePanelDataLoader(panelSchema, selectedTimeObj, variablesData);
              data = newData.data;
              loading = newData.loading;
              errorDetail = newData.errorDetail;   
           }
        }
    }, { deep: true });

    const handleIntersection = (entries:any) => {
        isVisible.value = entries[0].isIntersecting;
      }

    onMounted(async () => {
          observer = new IntersectionObserver(handleIntersection, {
            root: null,
            rootMargin: '0px',
            threshold: 0.1 // Adjust as needed
          });

          observer.observe(chartPanelRef.value);

    });

    watch(
          () => [data, props.selectedTimeDate],
          async () => {
              isDirty.value = true
              
              if (data.query) {
                  // load the data if visible
                  if(isVisible.value){
                    const newData = usePanelDataLoader(panelSchema, selectedTimeObj, variablesData);
                    data = newData.data;
                    loading = newData.loading;
                    errorDetail = newData.errorDetail;
                  }
              } 
          },
          { deep: true }
      );

    return {
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
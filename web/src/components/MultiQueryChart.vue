<template>
  <div>
    <MultiChart :data="chartData" />
  </div>
</template>

<script lang="ts">
import { defineComponent, watch, ref, onMounted, watchEffect } from "vue";
import { useSearchApi } from "@/composables/useSearchApi";
// import { useDataTransform } from "@/composables/useDataTransform";
import { convertData } from "@/utils/Dashboard/convertData";
import MultiChart from "@/components/dashboards/addPanel/MultiChart.vue";
import { useStore } from "vuex";
import Plotly from "plotly.js";

export default defineComponent({
  name: "MultiQueryChart",
  components: { MultiChart },
  props: {
    selectedTimeObj: {
      required: true,
      type: Object,
    },
    data: {
      required: true,
      type: Object,
    },
  },
  setup(props, context) {
    const chartData = ref();
    const error = ref("");
    console.log("props.selectedTimeObj", props.selectedTimeObj);
    console.log("props.data", props.data);
    const store = useStore();
    const fetchChartData = async () => {
      chartData.value = await convertData(
        props.data,
        props.selectedTimeObj,
        store
      );
    };
    // const plotRef: any = ref(null);
    const { loadData, data } = useSearchApi(
      props.data,
      props.selectedTimeObj,
      props,
      context.emit
    );

    onMounted(() => {
      loadData();
       fetchChartData();
    });
     watch(data,
      async () => {
        console.log("data changed");
        fetchChartData();
      }
    );

    return {
      loadData,
      data,
      chartData,
      error,
    };
  },
});
</script>

<style lang="scss" scoped></style>

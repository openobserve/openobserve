<template>
  <div>
    <MultiChart :data="chartData" />
  </div>
</template>

<script lang="ts">
import { defineComponent, watch, ref, onMounted, watchEffect } from "vue";
import { useSearchApi } from "@/composables/useSearchApi";
// import { useDataTransform } from "@/composables/useDataTransform";
import { convertSQLData } from "@/utils/Dashboard/convertSQLData";
import MultiChart from "@/components/dashboards/addPanel/MultiChart.vue";
import { useStore } from "vuex";
import Plotly from "plotly.js";
import { convertPromQLData } from "@/utils/Dashboard/convertPromQLData";

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
      chartData.value = await convertSQLData(
        props,
        data,
        store
      );
    };

    const fetchPromQLChartData =async() =>{
      chartData.value = await convertPromQLData(
        props,
        data,
        store
      )
    }
    // const plotRef: any = ref(null);
    const { loadData, data } = useSearchApi(
      props.data,
      props.selectedTimeObj,
      props,
      context.emit
    );

    const renderChart = async () => {
      if (props.data?.fields?.stream_type == "metrics" && props.data?.customQuery && props.data?.queryType == "promql") {
        fetchPromQLChartData()
      } else {
        fetchChartData()
      }
    }
    watch(data, async () => {
      console.log("data changed, converting");
      await renderChart();
    });

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
@/utils/Dashboard/convertSQLData
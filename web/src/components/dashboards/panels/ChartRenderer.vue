<template>
  <div ref="chartRef" class="plotlycontainer" id="chart1" style="height: 100%"></div>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, watch } from "vue";
import * as echarts from "echarts";

export default defineComponent({
  name: "ChartRenderer",
  props: {
    data: {
      required: true,
      type: Object,
      default: () => ({ option: {}})
    },
  },
  setup(props: any) {
    const chartRef: any = ref(null);
    let chart:any;

    onMounted(() => {
      console.log("ChartRenderer: mounted");
      console.log("props at chartrenderer",{props});
        chart = echarts.init(chartRef.value)
        chart.setOption(props?.data?.option || {},true);
    });

    watch(() => props.data.option,
      () => {
        console.log("ChartRenderer: props.data updated", props.data);
        chart.setOption(props?.data?.option || {},true);
      },{deep:true})
    return { chartRef };
  },
})
</script>
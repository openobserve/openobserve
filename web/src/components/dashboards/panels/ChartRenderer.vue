<template>
  <div ref="plotRef" class="plotlycontainer" id="chart1" style="height: 100%"></div>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, watch } from "vue";
import Plotly from "plotly.js-dist-min";

export default defineComponent({
  name: "ChartRenderer",
  props: {
    data: {
      required: true,
      type: Object,
      default: () => ({ traces: [], layout: {} })
    },
  },
  setup(props: any) {
    const plotRef: any = ref(null);

    onMounted(() => {
      console.log("ChartRenderer: mounted");
      Plotly.newPlot(plotRef.value, props.data?.traces || [], props.data?.layout, {
        responsive: true,
        showLink: false,
      });
    });

    watch(() => props.data,
      // [props.traces, props.layout],
      async () => {
        console.log("ChartRenderer: props.data updated", props.data);
        console.log("ChartRenderer: props.data updated: plotRef.value", plotRef.value);

        Plotly.newPlot(plotRef.value, props.data.traces, props.data.layout, {
          responsive: true,
          displaylogo: false,
          displayModeBar: false,
        });
      })

    return { plotRef }
  },
})
</script>

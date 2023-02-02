<template>
  <div ref="plotref" :id="chartID" class="plotlycontainer" />
</template>

<script lang="ts">
import Plotly from "plotly.js";

import { defineComponent, onMounted, ref, onUpdated } from "vue";

export default defineComponent({
  name: "ReactiveLineChart",
  emits: ["updated:chart"],
  props: ["data"],
  setup(props) {
    const plotref: any = ref(props.data ? props.data.id : 1);
    const zoomFlag: any = ref(false);
    const trace: any = {
      x: [],
      y: [],
      unparsed_x: [],
      mode: "lines",
      name: "Markers",
    };
    const chartID = ref("");

    const layout: any = {
      title: {
        text: "",
        font: {
          size: 14,
        },
      },
      font: { size: 12 },
      autosize: true,
      legend: {
        bgcolor: "red",
      },
    };

    onMounted(async () => {
      await Plotly.newPlot(plotref.value, [trace], layout, {
        responsive: true,
        displayModeBar: false,
      });
    });

    onUpdated(async () => {
      if (props.data) {
        chartID.value = "chart_" + props.data.id;
        reDraw(props.data.x, props.data.y, props.data.chartParams);
      }
    });

    const reDraw: any = (
      x: any,
      y: any,
      params: { title: any; unparsed_x_data: any }
    ) => {
      trace.x = x;
      trace.y = y;
      // layout.title.text = params.title;
      trace.unparsed_x = params.unparsed_x_data;
      Plotly.redraw(chartID.value);
      forceReLayout();
    };

    // created force relayout function to avoid infinite loop
    const forceReLayout = (flag = true) => {
      zoomFlag.value = flag;

      const update: any = {
        "xaxis.autorange": true,
        "yaxis.autorange": true,
      };
      Plotly.relayout(plotref.value, update);
    };

    // const onPlotZoom = () => {
    //   if (
    //     plotref.value.layout.xaxis.range.length == 2 &&
    //     zoomFlag.value == false
    //   ) {
    //     const start = Math.round(plotref.value.layout.xaxis.range[0]);
    //     const end = Math.round(plotref.value.layout.xaxis.range[1]);

    //     if (
    //       start >= 0 &&
    //       end >= 0 &&
    //       trace.unparsed_x[start] != undefined &&
    //       trace.unparsed_x[end] != undefined
    //     ) {
    //       zoomFlag.value = true;
    //       let start_d = new Date(Date.parse(trace.unparsed_x[start] + " UTC"));
    //       let end_d = new Date(Date.parse(trace.unparsed_x[end] + " UTC"));

    //       emit("updated:chart", {
    //         start: start_d.toLocaleString("sv-SE"),
    //         end: end_d.toLocaleString("sv-SE"),
    //       });
    //     }
    //   } else {
    //     zoomFlag.value = false;
    //   }
    // };

    return {
      plotref,
      reDraw,
      // onPlotZoom,
      forceReLayout,
      chartID,
    };
  },
});
</script>

<style lang="scss" scoped>
.plotlycontainer {
  height: 100%;
}
</style>

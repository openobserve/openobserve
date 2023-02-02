<template>
  <div ref="plotref" id="plotly_chart" />
</template>

<script lang="ts">
import Plotly from "plotly.js";

import { defineComponent, onMounted, ref } from "vue";

export default defineComponent({
  name: "logBarChart",
  emits: ["updated:chart"],
  setup(props, { emit }) {
    const plotref: any = ref(null);
    const zoomFlag: any = ref(false);
    const trace: any = {
      x: [],
      y: [],
      unparsed_x: [],
      name: "barchart",
      type: "bar",
      marker: {
        color: "#5960b2",
        opacity: 0.8,
      },
    };

    const layout: any = {
      title: {
        text: "",
        font: {
          size: 12,
        },
      },
      font: { size: 12 },
      height: 150,
      legend: {
        bgcolor: "red",
      },
      margin: {
        l: 32,
        r: 16,
        t: 38,
        b: 32,
      },
      xaxis: {
        ticklen: 5,
        nticks: 15,
      },
    };
    onMounted(async () => {
      await Plotly.newPlot(plotref.value, [trace], layout, {
        responsive: true,
        displayModeBar: false,
      });

      plotref.value.on("plotly_relayout", onPlotZoom);
    });

    const reDraw: any = (
      x: any,
      y: any,
      params: { title: any; unparsed_x_data: any }
    ) => {
      trace.x = x;
      trace.y = y;
      layout.title.text = params.title;
      trace.unparsed_x = params.unparsed_x_data;
      Plotly.redraw("plotly_chart");
    };

    // created force relayout function to avoid infinite loop
    const forceReLayout = (yaxis: any, flag = true) => {
      zoomFlag.value = flag;

      const update: any = {
        "xaxis.autorange": true,
        "yaxis.autorange": true,
      };
      Plotly.relayout(plotref.value, update);
    };

    const onPlotZoom = () => {
      if (
        plotref.value.layout.xaxis.range.length == 2 &&
        zoomFlag.value == false
      ) {
        const start = Math.round(plotref.value.layout.xaxis.range[0]);
        const end = Math.round(plotref.value.layout.xaxis.range[1]);

        if (
          start >= 0 &&
          end >= 0 &&
          trace.unparsed_x[start] != undefined &&
          trace.unparsed_x[end] != undefined
        ) {
          zoomFlag.value = true;
          let start_d = new Date(Date.parse(trace.unparsed_x[start] + " UTC"));
          let end_d = new Date(Date.parse(trace.unparsed_x[end] + " UTC"));

          emit("updated:chart", {
            start: start_d.toLocaleString("sv-SE"),
            end: end_d.toLocaleString("sv-SE"),
          });
        }
      } else {
        zoomFlag.value = false;
      }
    };

    return {
      plotref,
      reDraw,
      onPlotZoom,
      forceReLayout,
    };
  },
});
</script>
<template>
  <div ref="plotref" id="plotly_chart" />
</template>

<script lang="ts">
import Plotly from "plotly.js";

import { defineComponent, onMounted, ref } from "vue";

export default defineComponent({
  name: "BarChart",
  emits: ["updated:chart"],
  props: {
    trace: {
      type: Object,
      default: {
        name: "barchart",
        type: "bar",
        x: [],
        y: [],
        unparsed_x: [],
        marker: {
          color: "#5960b2",
          opacity: 0.8,
        },
      },
    },
  },
  setup(props, { emit }) {
    const plotref: any = ref(null);
    const zoomFlag: any = ref(false);
    const trace: any = props.trace;

    const layout: any = {
      title: {
        text: "",
        font: {
          size: 14,
        },
      },
      font: { size: 12 },
      height: 220,
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
      autorangeChart()

      plotref.value.on("plotly_relayout", onPlotZoom);
    });

    const autorangeChart = () => {
        Plotly.relayout(plotref.value, {
            'xaxis.autorange': true,
            'yaxis.autorange': true
        });
    }
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
      autorangeChart()
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
<!-- Copyright 2022 Zinc Labs Inc. and Contributors

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
  <div ref="plotref" id="metrics_plotly_chart" />
</template>

<script lang="ts">
import Plotly from "plotly.js";
import { cloneDeep } from "lodash-es";
import { useStore } from "vuex";
import { defineComponent, onMounted, onUpdated, ref, watch } from "vue";

export default defineComponent({
  name: "MetricLineChart",
  emits: ["updated:chart"],
  props: {
    height: {
      type: Number,
      default: 300,
    },
    width: {
      type: Number,
      default: 600,
    },
    data: {
      type: Array,
      default: () => null,
    },
    title: {
      type: String,
      default: "",
    },
  },
  setup(props, { emit }) {
    const store = useStore();
    const plotref: any = ref(null);
    const zoomFlag: any = ref(false);
    let traces: any = [
      {
        x: [],
        y: [],
        unparsed_x: [],
        name: "Min",
        type: "line",
        marker: {
          color: "#5960b2",
          opacity: 0.8,
        },
      },
      {
        x: [],
        y: [],
        unparsed_x: [],
        name: "Max",
        type: "line",
        marker: {
          color: "#5960b2",
          opacity: 0.8,
        },
      },
      {
        x: [],
        y: [],
        unparsed_x: [],
        name: "Avg",
        type: "line",
        marker: {
          color: "#5960b2",
          opacity: 0.8,
        },
      },
    ];

    const getThemeLayoutOptions = () => ({
      paper_bgcolor: store.state.theme === 'dark' ? '#333' : '#fff',
      plot_bgcolor: store.state.theme === 'dark' ? '#333' : '#fff',
      font: {
        color: store.state.theme === 'dark' ? '#fff' : '#333'
      }
    })
    watch(() => store.state.theme, () => {
      Plotly.update(plotref.value, {}, getThemeLayoutOptions())
    })

    let layout: any = {
      title: {
        text: "",
        font: {
          size: 12,
        },
      },
      font: { size: 12 },
      autosize: true,
      height: 400,
      legend: {
        bgcolor: "white",
      },
      margin: {
        l: 32,
        r: 16,
        t: 32,
        b: 32,
      },
      xaxis: {
        ticklen: 5,
        nticks: 12,
        type: "date",
        tickformat: "",
        hoverformat: "%Y-%m-%d %H:%M:%S",
        tickformatstops: [
          {
            dtickrange: [null, 1000],
            value: "%H:%M:%S.%L",
          },
          {
            dtickrange: [1000, 60000],
            value: "%H:%M:%S",
          },
          {
            dtickrange: [60000, 43200000], // 12 hours
            value: "%H:%M",
          },
          {
            dtickrange: [43200000, 86400000],
            value: "%m-%d %H:%M",
          },
          {
            dtickrange: [86400000, 604800000],
            value: "%m-%d",
          },
          {
            dtickrange: [604800000, "M1"],
            value: "%m-%d",
          },
          {
            dtickrange: ["M1", "M12"],
            value: "%Y-%m",
          },
          {
            dtickrange: ["M12", null],
            value: "%Y",
          },
        ],
      },
      yaxis: {
        fixedrange: true,
      },
        ...getThemeLayoutOptions(),
    };
    onMounted(async () => {
      if (props.title) layout.title.text = props.title;
      traces = [...props.data];
      await Plotly.newPlot(plotref.value, traces, layout, {
        responsive: true,
        displayModeBar: false,
      });

      plotref.value.on("plotly_relayout", onPlotZoom);
    });

    onUpdated(async () => {
      const update: any = {
        "xaxis.autorange": true,
        "yaxis.autorange": true,
      };
      if (document.getElementById("metrics_plotly_chart") != null) {
        Plotly.relayout(plotref.value, update);
      }
    });

    const reDraw = (chart: any) => {
      traces = [...chart.data];
      layout.title.text = chart.layout.title;
      if (document.getElementById("metrics_plotly_chart") != null) {
        Plotly.react("metrics_plotly_chart", traces, layout);
      }
    };

    // created force relayout function to avoid infinite loop
    const forceReLayout = (yaxis: any, flag = true) => {
      zoomFlag.value = flag;
      const update: any = {
        "xaxis.autorange": true,
        "yaxis.autorange": true,
      };
      if (document.getElementById("metrics_plotly_chart") != null) {
        Plotly.relayout(plotref.value, update);
      }
    };

    const onPlotZoom = (e: any) => {
      if (
        e &&
        e["xaxis.range[0]"] &&
        e["xaxis.range[1]"] &&
        zoomFlag.value == false
      ) {
        const start = plotref.value.layout.xaxis.range[0];
        const end = plotref.value.layout.xaxis.range[1];
        if (start != "" && end != "") {
          zoomFlag.value = true;
          let start_d = new Date(start);
          let end_d = new Date(end);
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

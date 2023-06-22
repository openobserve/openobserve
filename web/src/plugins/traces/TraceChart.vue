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
  <div ref="plotref" :id="id" style="width: 100%" />
</template>

<script lang="ts">
import Plotly from "plotly.js";
import { cloneDeep } from "lodash-es";
import { useStore } from "vuex";
import { defineComponent, onMounted, onUpdated, ref, watch } from "vue";

export default defineComponent({
  name: "TraceChart",
  emits: ["updated:chart", "click"],
  props: {
    height: {
      type: Number,
      default: 300,
    },
    width: {
      type: Number,
      default: 600,
    },
    chart: {
      type: Object,
      default: () => {},
    },
    id: {
      type: String,
      default: "",
    },
  },
  setup(props, { emit }) {
    const store = useStore();
    const plotref: any = ref(null);
    const zoomFlag: any = ref(false);
    let traces: any = [{}];

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
      width: "100%",
      scrollZoom: true,
      title: {
        text: "Trace",
        font: {
          size: 12,
        },
      },
      font: { size: 12 },
      autosize: true,
      height: 200,
      margin: {
        l: 32,
        r: 16,
        t: 32,
        b: 32,
      },
      xaxis: {
        ticklen: 5,
        nticks: 10,
        type: "-",
        ticksuffix: "ms",
        showgrid: true,
        zeroline: true,
        rangeslider: {
          visible: true,
        },
      },
      yaxis: {
        showgrid: false,
        zeroline: true,
        autorange: true,
        showticklabels: false,
      },
      shapes: [
        {
          x0: "5",
          x1: "10",
          y0: 0,
          y1: 0.4,
          line: {
            width: 0,
          },
          type: "rect",
          xref: "x",
          yref: "y",
          opacity: 1,
          fillcolor: "rgb(0, 0, 0)",
        },
        {
          x0: "2",
          x1: "19",
          y0: 0.4,
          y1: 0.8,
          line: {
            width: 0,
          },
          type: "rect",
          xref: "x",
          yref: "y",
          opacity: 1,
          fillcolor: "rgb(139, 0, 0)",
        },
        {
          x0: "0",
          x1: "20",
          y0: 0.8,
          y1: 1.2,
          line: {
            width: 0,
          },
          type: "rect",
          xref: "x",
          yref: "y",
          opacity: 1,
          fillcolor: "rgb(0, 0, 0)",
        },
      ],
      hovermode: "closest",
      showlegend: true,
      ...getThemeLayoutOptions(),
    };

    onMounted(async () => {
      layout = props.chart.layout || {};
      traces = props.chart.data || [{}];
      await Plotly.newPlot(props.id, traces, layout, {
        responsive: true,
        displayModeBar: false,
      });

      plotref.value.on("plotly_click", (data: any) => {
        // data contains all the info about the clicked marker
        emit("click", data);
      });

      plotref.value.on("plotly_hover", (data: any) => {
        // Apply the cursor pointer style on hover
        data.event.target.style.cursor = "pointer";
      });

      plotref.value.on("plotly_relayout", onPlotZoom);
    });

    onUpdated(async () => {
      const update: any = {
        "xaxis.autorange": true,
        "yaxis.autorange": true,
      };
      if (document.getElementById(props.id) != null) {
        Plotly.relayout(plotref.value, update);
      }
    });

    const reDraw = () => {
      traces = props.chart.data;
      layout = props.chart.layout;
      if (document.getElementById(props.id) != null) {
        Plotly.react(props.id, traces, layout);
      }
    };

    // created force relayout function to avoid infinite loop
    const forceReLayout = (yaxis: any, flag = true) => {
      zoomFlag.value = flag;
      const update: any = {
        "xaxis.autorange": true,
        "yaxis.autorange": true,
      };
      if (document.getElementById(props.id) != null) {
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
            data: e,
            start: start_d.toLocaleString("sv-SE"),
            end: end_d.toLocaleString("sv-SE"),
          });
        }
      } else if (e["xaxis.range"]) {
        emit("updated:chart", {
          data: e,
        });
      } else {
        emit("updated:chart", {
          data: e,
        });
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

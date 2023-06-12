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
  <!-- {{data}}  -->
  <div ref="plotref" :id="chartID" class="plotlycontainer" />
</template>

<script lang="ts">
import Plotly from "plotly.js";

import { defineComponent, onMounted, ref, onUpdated, onBeforeMount } from "vue";

export default defineComponent({
  name: "DoubleLineChart",
  emits: ["updated:chart"],
  props: ["data"],
  setup(props) {
    const plotref: any = ref(props.data ? props.data.id : 1);
    const zoomFlag: any = ref(false);
    const trace1: any = {
      x: [],
      y: [],
      unparsed_x: [],
      mode: "lines+markers",
      name: "Bulk",
    };
    const trace2: any = {
      x: [],
      y: [],
      unparsed_x: [],
      mode: "lines+markers",
      name: "Search",
    };
    const trace3: any = {
      x: [],
      y: [],
      unparsed_x: [],
      mode: "lines+markers",
      name: "Multi",
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
        // bgcolor: "red",
      },
      margin: {
        l: 32,
        r: 16,
        t: 0,
        b: 32,
      },
    };

    onMounted(async () => {
      await Plotly.newPlot(plotref.value, [trace1, trace2, trace3], layout, {
        responsive: true,
        displayModeBar: false,
      });
    });

    onBeforeMount(async () => {
      if (props.data) {
        chartID.value = "chart_" + props.data.id;
      }
    });

    onUpdated(async () => {
      if (props.data) {
        reDraw(props.data, props.data.chartParams);
      }
    });

    const reDraw: any = (
      chart: any,
      params: { title: any; unparsed_x_data: any }
    ) => {
      trace1.x = chart.data[0].x;
      trace1.y = chart.data[0].y;
      trace1.unparsed_x = params.unparsed_x_data;

      trace2.x = chart.data[1].x;
      trace2.y = chart.data[1].y;
      trace2.unparsed_x = params.unparsed_x_data;

      trace3.x = chart.data[2].x;
      trace3.y = chart.data[2].y;
      trace3.unparsed_x = params.unparsed_x_data;

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

    return {
      plotref,
      reDraw,
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

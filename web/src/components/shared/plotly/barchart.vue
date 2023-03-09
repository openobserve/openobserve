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
  <div ref="plotref" :id="chartID" class="plotlycontainer"></div>
</template>

<script lang="ts">
import Plotly from "plotly.js";

import { defineComponent, onMounted, ref, onUpdated, nextTick } from "vue";

export default defineComponent({
  name: "ReactiveChart",
  emits: ["updated:chart"],
  props: ["data"],
  setup(props, { emit }) {
    const plotref: any = ref(props.data ? props.data.id : 1);
    const zoomFlag: any = ref(false);
    const trace: any = {
      x: [],
      y: [],
      unparsed_x: [],
      name: "barchart",
      // showlegend: true,
      type: "bar",
      marker: {
        color: "#5960b2",
        opacity: 0.8,
      },
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
        bgcolor: "#f7f7f7",
      },
      xaxis: {
        tickangle: -20,
        automargin: true
      },
      yaxis:{
        automargin: true,
      }
    };

    onMounted(async () => { 
      await nextTick()   
      await Plotly.newPlot(plotref.value, [trace], layout, {
        responsive: true,
        displaylogo: false,
        displayModeBar: true
      });
    });

    onUpdated(async () => {
      if (props.data){
        chartID.value = "chart_" + props.data.id;
        reDraw(props.data.x, props.data.y, props.data.chartParams);
      }
    });

    // wrap the text for long x axis names
    const addBreaksAtLength = 12
    const textwrapper = function(traces) {
      traces = traces.map(text => {
        let rxp = new RegExp(".{1," + addBreaksAtLength + "}", "g");
        return text.match(rxp).join("<br>");
      });
	    return traces;
    };

    onUpdated(async () => {
      if (props.data){
        chartID.value = "chart_" + props.data.id;
        reDraw(props.data.x, props.data.y, props.data.chartParams);
      }
    });
    const reDraw: any = (
      x: any,
      y: any,
      params: { title: any; unparsed_x_data: any }
    ) => {
      trace.x = textwrapper(x);
      trace.y = y;
      // layout.title.text = params.title;
      trace.unparsed_x = params.unparsed_x_data;
      Plotly.redraw(chartID.value);
      forceReLayout();
    };
    // created force relayout function to avoid infinite loop
    const forceReLayout = async (flag = true) => {
      zoomFlag.value = flag;
      const update: any = {
        "xaxis.autorange": true,
        "yaxis.autorange": true,
      };
      await nextTick()
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

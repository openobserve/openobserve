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
  <div v-if="tableId" ref="plotref" :id="chartID" class="plotlycontainer" />
  <div v-else class="q-pa-md">
    <q-markup-table>
      <thead>
        <tr>
          <th class="text-left" style="width: 150px">
            <q-skeleton animation="none" type="text" />
          </th>
          <th class="text-right">
            <q-skeleton animation="none" type="text" />
          </th>
        </tr>
      </thead>

      <tbody>
        <tr v-for="n in 5" :key="n">
          <td class="text-left">
            <q-skeleton animation="none" type="text" width="85px" />
          </td>
          <td class="text-right">
            <q-skeleton animation="none" type="text" width="50px" />
          </td>
        </tr>
      </tbody>
    </q-markup-table>
  </div>
</template>

<script lang="ts">
import Plotly from "plotly.js";

import { defineComponent, onMounted, ref, onUpdated } from "vue";

export default defineComponent({
  name: "ReactiveTableChart",
  emits: ["updated:chart"],
  props: ["data"],
  setup(props, { emit }) {
    const plotref: any = ref(props.data ? props.data.id : 1);
    const zoomFlag: any = ref(false);
    const chartID = ref("");
    const tableId = ref(props?.data?.id);
    const trace: any = [
      {
        type: "table",
        header: {},
        cells: {},
      },
    ];
    const layout: any = {
      title: {
        text: "",
        font: {
          size: 14,
        },
      },
      innerHeight: 50,
      outerHeight: 50,
      font: { size: 12 },
      autosize: true,
      legend: {
        bgcolor: "red",
      },
      margin: {
        l: 8,
        r: 8,
        t: 8,
        b: 0,
      },
      xaxis: {
        ticklen: 5,
        nticks: 15,
      },
    };

    onMounted(async () => {
      // await Plotly.newPlot(plotref.value, trace, {}, {
      //   responsive: true,
      //   displaylogo: false,
      //   displayModeBar: false,
      // });
    });

    onUpdated(async () => {
      if (props.data) {
        tableId.value = props.data.id;
        trace[0].header = props.data.header;
        trace[0].cells = props.data.cells;
        chartID.value = "chart_" + props.data.id;

        await Plotly.newPlot(plotref.value, trace, layout, {
          responsive: true,
          displaylogo: false,
          displayModeBar: false,
        });
        // chartID.value = "chart_" + props.data.id;
        // reDraw(props.data.header, props.data.cells);
      }
    });
    const reDraw: any = (header: any, cell: any) => {
      trace[0].header = props.data.header;
      trace[0].cells = props.data.cells;

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
      chartID,
      forceReLayout,
      tableId,
    };
  },
});
</script>

<style lang="scss" scoped>
.plotlycontainer {
  height: 100%;
}
</style>

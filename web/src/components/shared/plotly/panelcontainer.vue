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
  <div class="plotlycontainer">
    <div
      class="q-pa-sm q-gutter-sm innerPlotlycontainer"
      v-if="getVizualizationSelector() === 'BarChart'"
    >
      <!-- inside barchart-- {{ plotData }}-- -->
      <PanelHeader
        :panelDataElement="getPanelDataElement()"
        :dashboardId="getDashboardId()"
        @clicked="onClickChild"
      />
      <ReactiveBarChart :data="plotData"></ReactiveBarChart>
    </div>
    <div
      class="q-pa-sm q-gutter-sm innerPlotlycontainer"
      v-else-if="getVizualizationSelector() === 'TimeSeries'"
    >
      <PanelHeader
        :panelDataElement="getPanelDataElement()"
        :dashboardId="getDashboardId()"
        @clicked="onClickChild"
      />
      <ReactiveLineChart :data="plotData"></ReactiveLineChart>
    </div>
    <div
      class="q-pa-sm col-4 q-gutter-sm innerPlotlycontainer"
      :id="panelDataElement.id"
      v-else-if="getVizualizationSelector() === 'Table'"
    >
      <PanelHeader
        :panelDataElement="getPanelDataElement()"
        :dashboardId="getDashboardId()"
        @clicked="onClickChild"
      />
      <ReactiveTableChart ref="plotChart" :data="plotData"></ReactiveTableChart>
    </div>
    <div
      class="q-pa-sm q-gutter-sm innerPlotlycontainer"
      v-else-if="getVizualizationSelector() === 'Stat'"
    >
      <PanelHeader
        :panelDataElement="getPanelDataElement()"
        :dashboardId="getDashboardId()"
        @clicked="onClickChild"
      />
      <ReactiveTableChart ref="plotChart" :data="plotData" />
    </div>
    <div v-else>
      <h2>{{ getVizualizationSelector() }}</h2>
    </div>
  </div>

  <!-- <div>
    <child @clicked="onClickChild"></child>
  </div> -->
</template>

<script lang="ts">
import ReactiveLineChart from "../plotly/linechart.vue";
import ReactiveBarChart from "../plotly/barchart.vue";
import ReactiveTableChart from "../plotly/tablechart.vue";
import queryService from "../../../services/nativequery";
import PanelHeader from "../plotly/panelheader.vue";
import * as Plotly from "plotly.js";
import { computed, defineComponent, onMounted, onUpdated, ref } from "vue";
import { toRaw, unref, watch } from "vue";
import { useStore } from "vuex";
import { modifySQLQuery } from "../../../utils/commons";

export default defineComponent({
  name: "PanelContainer",
  emits: ["updated:chart"],
  props: ["panelDataElement", "dashboardId", "selectedTimeDate"],
  panelData: [],

  setup(props, { emit }) {
    const store = useStore();
    const plotChart: any = ref(null);
    const zoomFlag: any = ref(false);
    const dashboardId = props.dashboardId;
    const panelDataElement = toRaw(props.panelDataElement);
    const plotData: any = ref(null);
    plotData.value = { id: props.panelDataElement.id };

    onMounted(async () => {
      await renderPanel(props.panelDataElement, true);
    });

    let selectedTimeObj = computed(function () {
      return props.selectedTimeDate;
    });

    watch(selectedTimeObj, () => {
      if (toRaw(unref(selectedTimeObj))) {
        renderPanel(props.panelDataElement, false);
      }
    });

    const renderPanel = async (panelDataElement: any, onMounted: boolean) => {
      const chartParams = {
        title: "Found " + "2" + " hits in " + "10" + " ms",
      };
      const sqlQueryModified = modifySQLQuery(
        toRaw(unref(selectedTimeObj)),
        panelDataElement.query[0]
      );
      const query = {
        query: { sql: sqlQueryModified, sql_mode: "full" },
      };

      const panelData = toRaw(store.state.currentPanelsData);
      const existingPanel = panelData.find(
        (panel: any) => panel.id == panelDataElement.id
      );

      if (existingPanel && onMounted) {
        plotData.value = existingPanel;
      } else {
        await queryService
          .runquery(query, store.state.selectedOrganization.identifier)
          .then((res) => {
            let allPanelsData = toRaw(store.state.currentPanelsData);

            if (getVizualizationSelector() === "Table") {
              const header_vals = Object.keys(res.data.hits[0]);
              let data_vals: any[] = [];
              let obj: any = {};
              let key = "";
              for (obj in res.data.hits) {
                let partobject = [];
                for (key in header_vals) {
                  partobject.push(res.data.hits[obj][header_vals[key]]);
                }
                data_vals.push(partobject);
                partobject = [];
              }

              let output = data_vals[0].map((_: any, colIndex: any) =>
                data_vals.map((row) => row[colIndex])
              );

              const styledHeader = header_vals.map(
                (header) => "<b>" + header + "</b>"
              );
              const columnColor = output[0].map((col: any, index: any) => {
                if (index % 2 == 0) {
                  return "#FFF";
                } else {
                  return "#C9CCE6";
                }
              });

              plotData.value = {
                id: panelDataElement.id,
                type: "table",
                header: {
                  values: styledHeader,
                  align: "center",
                  height: 30,
                  line: { width: 1, color: "black" },
                  fill: { color: "#7A80C2" },
                  font: { family: "Arial", size: 14, color: "white" },
                },
                cells: {
                  values: output,
                  align: "center",
                  height: 25,
                  line: { color: "black", width: 1 },
                  fill: { color: [columnColor] },
                  font: { family: "Arial", size: 11, color: ["black"] },
                },
              };

              if (allPanelsData.length > 0) {
                allPanelsData = [...allPanelsData, toRaw(plotData.value)];
              } else {
                allPanelsData = [toRaw(plotData.value)];
              }
              store.dispatch("setCurrentPanelsData", allPanelsData);
            } else {
              let x_data: any[] = [];
              let y_data: any[] = [];
              res.data.hits.map((data: any) => {
                x_data.push(data.x_axis);
                y_data.push(data.y_axis);
              });

              plotData.value = {
                id: panelDataElement.id,
                x: x_data,
                y: y_data,
                chartParams: chartParams,
              };

              if (allPanelsData.length > 0) {
                allPanelsData = [...allPanelsData, toRaw(plotData.value)];
              } else {
                allPanelsData = [toRaw(plotData.value)];
              }
              store.dispatch("setCurrentPanelsData", allPanelsData);
            }
          });
      }
    };

    // created force relayout function to avoid infinite loop
    const forceReLayout = (yaxis: any, flag = true) => {
      zoomFlag.value = flag;
    };
    const getVizualizationSelector = () => {
      return props.panelDataElement.type;
    };

    const getPanelDataElement = () => {
      return props.panelDataElement;
    };
    return {
      getVizualizationSelector,
      forceReLayout,
      plotChart,
      renderPanel,
      PanelHeader,
      plotData,
      getPanelDataElement,
      panelDataElement,
      selectedTimeObj,
    };
  },
  components: {
    ReactiveLineChart,
    ReactiveBarChart,
    ReactiveTableChart,
    PanelHeader,
  },
  methods: {
    getDashboardId() {
      return this.$route.query.dashboard;
    },
    onClickChild(panelDataElementValue: any) {
      this.$emit("updated:chart", panelDataElementValue);
    },
  },
});
</script>

<style lang="scss" scoped>
.plotlycontainer {
  height: 100%;
}
.innerPlotlycontainer {
  height: 90%;
}
</style>
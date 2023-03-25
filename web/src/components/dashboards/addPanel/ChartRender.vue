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
  <div style="height: 40px; z-index: 10;">
    <q-spinner-dots
      v-if="searchQueryData.loading"
      color="primary"
      size="40px"
      style="margin: 0 auto; display: block"
    />
  </div>
  <div style="margin-top: -40px; height: calc(100% - 40px);">
    <div v-if="props.data.type == 'table'" class="q-pa-md">
      <q-table
        class="my-sticky-virtscroll-table"
        virtual-scroll
        v-model:pagination="pagination"
        :rows-per-page-options="[0]"
        :virtual-scroll-sticky-size-start="48"
        dense
        :rows="searchQueryData?.data || []"
        :columns="tableColumn"
        row-key="id"
      >
      </q-table>
    </div>
    <div v-else style="height: 100%;">
      <div ref="plotRef" :id="chartID" class="plotlycontainer" style="height: 100%"></div>
    </div>
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  onMounted,
  onUpdated,
  ref,
  reactive,
  nextTick,
  watch,
  computed,
  onActivated,
} from "vue";
import { useStore } from "vuex";
import { useQuasar, date } from "quasar";
import queryService from "../../../services/nativequery";
import Plotly from "plotly.js";
import moment from "moment";
   

export default defineComponent({
  name: "ChartRender",
  props: ["data", "selectedTimeDate"],

  setup(props) {
    const $q = useQuasar();
    const store = useStore();
    const searchQueryData = reactive({
      data: [],
      loading: false
    });

    //render the plotly chart if the chart type is not table
    onUpdated(() => {
      if (props.data.type != "table") {
        renderChart();
      }
    });

    const plotRef: any = ref(null);
    const chartID = ref("chart1");

    //change the timeObject if the date is change
    let selectedTimeObj = computed(function () {
      return props.selectedTimeDate;
    });

    const tableColumn : any = ref([]);

    // set column value for type chart if the axis value is undefined
    const updateTableColumns = () => {
      const x = props.data?.fields?.x || []
      const y = props.data?.fields?.y || []
      const columnData = [...x, ...y]
      
      const column = columnData.map((it:any)=>{
        let obj : any= {}
        obj["name"] = it.label
        obj["field"] = it.alias
        obj["label"] = it.label
        obj["sortable"] = true
        return obj
      })
      tableColumn.value = column
    }

    // If query changes, we need to get the data again and rerender the chart
    watch(
      () => [props.data, props.selectedTimeDate],
      async () => {
        if (props.data.query) {
          fetchQueryData();
          updateTableColumns();
        } else {
          await nextTick();
          Plotly.react(
            plotRef.value,
            [],
            {},
            {
              responsive: true,
              displaylogo: false,
              displayModeBar: false,
            }
          );
        }
      },
      { deep: true }
    );

    // just wait till the component is mounted and then create a plotly instance
    onMounted(async () => {
      await nextTick();
      if (props.data.type != "table") {
        await Plotly.newPlot(
          plotRef.value,
          [{}],
          {},
          {
            responsive: true,
            displaylogo: false,
            displayModeBar: false,
          }
        );
      }

      if (props.data.query) {
        fetchQueryData();
      }
    });

    // wrap the text for long x axis names
    const addBreaksAtLength = 12;
    const textwrapper = function (traces: any) {
      traces = traces.map((text: any) => {
        let rxp = new RegExp(".{1," + addBreaksAtLength + "}", "g");
        if (text) {
          return text?.match(rxp)?.join("<br>");
        } else {
          return " ";
        }
      });
      return traces;
    };

    // Chart Related Functions
    const fetchQueryData = async () => {
      const queryData = props.data.query;
      const chartParams = {
        title: "Found " + "2" + " hits in " + "10" + " ms",
      };

      const sqlQueryModified = queryData;

      // get query object
      const timestamps = selectedTimeObj.value;

      let startISOTimestamp: any;
      let endISOTimestamp: any;
      if (
        timestamps.start_time != "Invalid Date" &&
        timestamps.end_time != "Invalid Date"
      ) {
        startISOTimestamp =
          new Date(timestamps.start_time.toISOString()).getTime() * 1000;
        endISOTimestamp =
          new Date(timestamps.end_time.toISOString()).getTime() * 1000;
      }
      const query = {
        query: {
          sql: queryData,
          sql_mode: "full",
          start_time: startISOTimestamp,
          end_time: endISOTimestamp,
        },
      };

      searchQueryData.loading = true
      await queryService
        .runquery(query, store.state.selectedOrganization.identifier)
        .then((res) => {
          const sortFn = (it1:any, it2: any) => {
            const a = it1[props.data.fields?.x[0].alias] || ""
            const b = it2[props.data.fields?.x[0].alias] || ""
            if(typeof a == 'number' && typeof b == 'number') {
                return a - b
            } else {
                return a.toString().localeCompare(b.toString())
            }
          }

          searchQueryData.data = props.data.fields?.x && props.data.fields?.x.length > 0 ? res.data.hits.sort(sortFn) : res.data.hits;
          searchQueryData.loading = false
          // $q.notify({
          //   type: "positive",
          //   message: "Query applied successfully.",
          //   timeout: 5000,
          // });
        })
        .catch((error) => {
          $q.notify({
            type: "negative",
            message: "Something went wrong!",
            timeout: 5000,
          });
        });
    };

    // If data or chart type is updated, rerender the chart
    watch(
      () => [searchQueryData.data, props.data.type],
      () => {
        // console.log("Query: new data received");
        if (props.data.type != "table") {
          renderChart();
        }
      },
      { deep: true }
    );

    const renderChart = async () => {
      // console.log("Query: rendering chart");
      // console.log("Query: chart type", props.data.type);
      // Step 1: Get the Y-Axis Count
      const xAxisKey = getXAxisKey();
      const yAxisKeys = getYAxisKeys();

      // console.log("xaxis=", textwrapper(getAxisDataFromKey(xAxisKey)));

      let traces;

      //generate the traces value f chart
      traces = yAxisKeys?.map((key: any) => {
        const trace = {
          name: props.data.fields?.y.find((it: any) => it.alias == key).label,
          ...getTraceValuesByChartType(xAxisKey, key),
          showlegend: props.data.config?.show_legends,
          marker: {
            color:
              props.data.fields?.y.find((it: any) => it.alias == key).color ||
              "#5960b2",
            opacity: 0.8,
          },
        };
        return trace;
      });

      // console.log("Query: populating traces: ", traces);

      //generate the layout value of chart
      const layout: any = {
        title: false,
        showlegend: props.data.config?.show_legends,
        font: { size: 12 },
        autosize: true,
        legend: {
          bgcolor: "#f7f7f7",
        },
        margin: {
          l: props.data.type == 'pie' ? 60 : 32,
          r: props.data.type == 'pie' ? 60 : 16,
          t: 38,
          b: 32,
        },
        ...getPropsByChartTypeForLayout(),
      };

      Plotly.react(plotRef.value, traces, layout, {
        responsive: true,
        displaylogo: false,
        displayModeBar: false,
      });
    };

    // change the axis value based on chart type
    const getTraceValuesByChartType = (xAxisKey: string, yAxisKey: string) => {
      const trace: any = {
        ...getPropsByChartTypeForTraces(),
      };
      if (props.data.type == "pie") {
        trace["labels"] = textwrapper(getAxisDataFromKey(xAxisKey));
        trace["values"] = getAxisDataFromKey(yAxisKey);
        // add hover template for showing Y axis name and count
        trace["hovertemplate"]= "%{label}: %{value} (%{percent})<extra></extra>"
      } else if (props.data.type == "h-bar") {
        trace["y"] = textwrapper(getAxisDataFromKey(xAxisKey));
        trace["x"] = getAxisDataFromKey(yAxisKey);
        // add hover template for showing Y axis name and count
        trace["hovertemplate"]= "%{fullData.name}: %{x}<extra></extra>"
      } else {
        trace["x"] = textwrapper(getAxisDataFromKey(xAxisKey));
        trace["y"] = getAxisDataFromKey(yAxisKey);
        // add hover template for showing Y axis name and count
        trace["hovertemplate"]= "%{fullData.name}: %{y}<extra></extra>"
      }
      return trace;
    };

    // get the x axis key
    const getXAxisKey = () => {
      return props.data.fields?.x?.length ? props.data.fields?.x.map((it: any) => it.alias)[0] : "";
    };

    // get the y axis key
    const getYAxisKeys = () => {
      return props.data.fields?.y?.length ? props.data.fields?.y.map((it: any) => it.alias) : [];
    };

    // get the axis data using key
    const getAxisDataFromKey = (key: string) => {
      let result : string[]= searchQueryData.data.map((item) => item[key]);
      // check for the histogram _timestamp field
       // If histogram _timestamp field is found, format the date labels
        const field = props.data.fields?.x.find((it: any) => it.aggregationFunction == 'histogram' && it.column == '_timestamp')
        if(field && field.alias == key) {
          // get the format
          const timestamps = selectedTimeObj.value
          let keyFormat = "HH:mm:ss";
          if (timestamps.end_time - timestamps.start_time >= 1000 * 60 * 5) {
            keyFormat = "HH:mm:ss";
          }
          if (timestamps.end_time - timestamps.start_time >= 1000 * 60 * 10) {
            keyFormat = "HH:mm:ss";
          }
          if (timestamps.end_time - timestamps.start_time >= 1000 * 60 * 20) {
            keyFormat = "HH:mm:ss";
          }
          if (timestamps.end_time - timestamps.start_time >= 1000 * 60 * 30) {
            keyFormat = "HH:mm:ss";
          }
          if (timestamps.end_time - timestamps.start_time >= 1000 * 60 * 60) {
            keyFormat = "HH:mm:ss";
          }
          if (timestamps.end_time - timestamps.start_time >= 1000 * 3600 * 2) {
            keyFormat = "MM-DD HH:mm";
          }
          if (timestamps.end_time - timestamps.start_time >= 1000 * 3600 * 6) {
            keyFormat = "MM-DD HH:mm";
          }
          if (timestamps.end_time - timestamps.start_time >= 1000 * 3600 * 24) {
            keyFormat = "MM-DD HH:mm";
          }
          if (timestamps.end_time - timestamps.start_time >= 1000 * 86400 * 7) {
            keyFormat = "MM-DD HH:mm";
          }
          if (
            timestamps.end_time - timestamps.start_time >= 1000 * 86400 * 30) {
            keyFormat = "YYYY-MM-DD";
          }

          // now we have the format, convert that format
          result = result.map((it: any) => moment(it + "Z").format(keyFormat))
        }
        
        return result
    };

    // return chart type based on selected chart
    const getPropsByChartTypeForTraces = () => {
      switch (props.data.type) {
        case "bar":
          return {
            type: "bar",
          };
        case "line":
          return {
            mode: "lines",
          };
        case "scatter":
          return {
            mode: "markers",
          };
        case "pie":
          return {
            type: "pie",
          };
        case "h-bar":
          return {
            type: "bar",
            orientation: "h",
          };
        case "area":
          return {
            fill: "tozeroy", //TODO: hoe to change the color of plot chart
            type: "scatter",
          };
        default:
          return {
            type: "bar",
          };
      }
    };

    // layout changes based on selected chart type
    const getPropsByChartTypeForLayout = () => {
      switch (props.data.type) {
        case "bar":
          return {
            barmode: "group",
            xaxis: {
              title: props.data.fields?.x[0].label,
              tickangle: -20,
              automargin: true,
            },
            yaxis: {
              title: props.data.fields?.y?.length == 1 ? props.data.fields.y[0].label : "",
              automargin: true,
            },
          };
        case "line":
          return {
            xaxis: {
              title: props.data.fields?.x[0].label,
              tickangle: -20,
              automargin: true,
            },
            yaxis: {
              title: props.data.fields?.y?.length == 1 ? props.data.fields.y[0].label : "",
              automargin: true,
            },
          };
        case "scatter":
          return {
            scattermode: "group",
            xaxis: {
              title: props.data.fields?.x[0].label,
              tickangle: -20,
              automargin: true,
            },
            yaxis: {
              title: props.data.fields?.y?.length == 1 ? props.data.fields.y[0].label : "",
              automargin: true,
            },
          };
        case "pie":
          return {
            xaxis: {
              title: props.data.fields?.x[0].label,
              tickangle: -20,
              automargin: true,
            },
            yaxis: {
              title: props.data.fields?.y?.length == 1 ? props.data.fields.y[0].label : "",
              automargin: true,
            },
          };
        case "h-bar":
          return {
            barmode: "group",
            xaxis: {
              title: props.data.fields?.y[0].label,
              tickangle: -20,
              automargin: true,
            },
            yaxis: {
              title: props.data.fields?.x?.length == 1 ? props.data.fields.x[0].label : "",
              automargin: true,
            },
          };
        case "area":
          return {
            xaxis: {
              title: props.data.fields?.x[0].label,
              tickangle: -20,
              automargin: true,
            },
            yaxis: {
              title: props.data.fields?.y?.length == 1 ? props.data.fields.y[0].label : "",
              automargin: true,
            },
          };
        default:
          return {
            xaxis: {
                title: props.data.fields?.x[0].label,
                tickangle: -20,
                automargin: true,
              },
              yaxis: {
                title: props.data.fields?.y?.length == 1 ? props.data.fields.y[0].label : "",
                automargin: true,
              },
          };
      }
    };

    return {
      plotRef,
      props,
      searchQueryData,
      pagination: ref({
        rowsPerPage: 0,
      }),
      chartID,
      tableColumn
    };
  },
});
</script>

<style lang="scss" scoped>
.my-sticky-virtscroll-table {
  /* height or max-height is important */
  height: 410px;

  .q-table__top,
  .q-table__bottom,
  thead tr:first-child th {
    /* bg color is important for th; just specify one */
    background-color: #fff;
  }
  thead tr th {
    position: sticky;
    z-index: 1;
  }
  /* this will be the loading indicator */
  thead tr:last-child th {
    /* height of all previous header rows */
    top: 48px;
  }
  thead tr:first-child th {
    top: 0;
  }
}
</style>

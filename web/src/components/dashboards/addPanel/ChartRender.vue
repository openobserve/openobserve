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
  <!-- <div style="height: 40px; z-index: 10;">
      <q-spinner-dots v-if="searchQueryData.loading" color="primary" size="40px" style="margin: 0 auto; display: block;" />
  </div> -->
  <div style="margin-top: 0px; height: calc(100% - 40px);">
      <div v-if="props.data.type == 'table'" class="q-pa-sm" style="height: 100%">
          <div class="column" style="height: 100%; position: relative;">
            <q-table class="my-sticky-virtscroll-table" virtual-scroll v-model:pagination="pagination"
                :rows-per-page-options="[0]" :virtual-scroll-sticky-size-start="48" dense
                :rows="searchQueryData?.data || []" :columns="tableColumn" row-key="id">
            </q-table>
            <div v-if="searchQueryData.loading" class="row" style="position: absolute; top:0px; width:100%; z-index: 1;">
                <q-spinner-dots color="primary" style="margin: 0 auto; height: 10px; width: 40px;" />
            </div>
          </div>
      </div>
      <div v-else style="height: 100%; position: relative;">
          <div ref="plotRef" :id="chartID" class="plotlycontainer" style="height: 100%"></div>
          <div style="position: absolute; top:20%;width:100%;text-align:center;">{{ noData }}</div>
          <div v-if="searchQueryData.loading" class="row" style="position: absolute; top:0px; width:100%;">
            <q-spinner-dots color="primary" size="40px" style="margin: 0 auto;" />
          </div>
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
import queryService from "../../../services/search";
import Plotly from "plotly.js";
import moment from "moment";
import { logsErrorMessage } from "@/utils/common";
import { useI18n } from "vue-i18n";


export default defineComponent({
  name: "ChartRender",
  props: {
      data: {
          type: Object,
          default: () => null
      }, 
      selectedTimeDate: {
          type: Object,
          default: () => null
      }, 
      height: {
          type: Number,
          default: 6,
      },
      width: {
          type: Number,
          default: 12,
      }
  },

  setup(props) {
      const $q = useQuasar();
      const { t } = useI18n();
      const store = useStore();
      const searchQueryData = reactive({
          data: [] as (any | Array<any>),
          loading: false
      });
      // const noData = ref('')

      //render the plotly chart if the chart type is not table
      onUpdated(() => {
          if (props.data.type != "table") {
              renderChart()
          }
      });

      const plotRef: any = ref(null);
      const chartID = ref("chart1");

      //change the timeObject if the date is change
      let selectedTimeObj = computed(function () {
          return props.selectedTimeDate;
      });

      const tableColumn: any = ref([]);

      // check if the values are numbers or not (used for table column alignment)
      const isSampleValuesNumbers = (arr: any, key: string, sampleSize: number) => {
            if (!Array.isArray(arr)) {
                return false;
            }
            const sample = arr.slice(0, Math.min(sampleSize, arr.length));
            return sample.every(obj => {
                const value = obj[key];
                return value === undefined || value === null || value === '' || typeof value === 'number';
            });
        };

      // set column value for type chart if the axis value is undefined
      const updateTableColumns = () => {
          const x = props.data?.fields?.x || []
          const y = props.data?.fields?.y || []
          const columnData = [...x, ...y]

          const column = columnData.map((it: any) => {
              let obj: any = {}
              obj["name"] = it.label
              obj["field"] = it.alias
              obj["label"] = it.label
              obj["align"] = !isSampleValuesNumbers(searchQueryData.data, it.alias, 20) ? 'left' : 'right';
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

              // Set custom legend click behavior
              // 1. If are visible currently, and clicking on anyone legend, 
              //    all others become hidden and only the clicked one should be visible.
              // 2. If clicked on any hidden legend, that should become selected and all others should be hidden. 
              // 3. If clicked on the currently visible item, and all other are currently hidden, all should be visible again
              plotRef.value.on('plotly_legendclick', function(eventData: any) {

                if(['table', 'pie', 'donut'].includes(props.data.type)) {
                    return
                } else {
                    // get the clicked legend
                    const clickedTraceIndex = eventData.curveNumber;

                    const data = eventData.data

                    // set the traces to visible if they are not currently
                    for (let i = 0; i < data.length; i++) {
                        if (!data[i].hasOwnProperty('visible')) {
                            data[i].visible = true;
                        }
                    }

                    // Case 1: check if all are currently visible
                    const allVisible = data.every((it: any) => it.visible == true);
                    if (allVisible) {
                        // set all hidden
                        data.forEach((it: any) => it.visible = 'legendonly');
                        // set the clicked one visible
                        data[clickedTraceIndex].visible = true;
                        Plotly.redraw(plotRef.value);
                    }
                    // Case 2: if the current trace is not visible then set the clicked one visible
                    else if (data[clickedTraceIndex].visible == 'legendonly') {
                        // set all hidden
                        data.forEach((it: any) => it.visible = 'legendonly');
                        // set the clicked one visible
                        data[clickedTraceIndex].visible = true;
                        Plotly.redraw(plotRef.value);
                    }
                    // Case 3: if the current trace is visible and others are not visible then show all
                    else if (!allVisible && data[clickedTraceIndex].visible == true) {
                        // set all visible
                        data.forEach((it: any) => it.visible = true);
                        Plotly.redraw(plotRef.value);
                    } else {
                        return
                    }
                }

              });

              // plotRef.value.on('plotly_afterplot', function () {
              //     !searchQueryData.data.length ? noData.value = "No Data" : noData.value = ""
              // })
          } else {
              updateTableColumns()
          }

          if (props.data.query) {
              fetchQueryData();
          }
      });

      // this is used to clear the data after next tick 
      // majorly for the add panel page
      // on other pages, it will keep the data
      // and charts will render the same data
      onActivated(async () => {
          await nextTick(); // to wait for the add panel page to remove the panel data
          if(!props.data.query) {
              searchQueryData.data = []
          }
      })
      const noData = computed(()=> {
        if (props.data?.fields?.stream_type == "metrics" && props.data?.customQuery && props.data?.queryType == "promql") {
            return searchQueryData.data?.result?.length ? "" : "No Data"
        } else {
            return !searchQueryData.data.length ? "No Data" : ""
        }
      })

      // wrap the text for long x axis names for pie charts
      const addBreaksAtLength = 12;
      const textwrapper = function (traces: any) {
          traces = traces.map((text: any) => {
              let rxp = new RegExp(".{1," + addBreaksAtLength + "}", "g");
              if (text) {
                  return text?.toString()?.match(rxp)?.join("<br>");
              } else {
                  return " ";
              }
          });
          return traces;
      };

      //It is used for showing long label truncate with "..."
      const textformat = function (layout: any) {
          let data = layout.map((text: any) => {
              if (text && text.toString().length > 15) {
                  return text.toString().substring(0, 15) + "...";
              } else {
                  return text;
              }
          })
          return data
      }

      const getTickLimits = (layout: string[]) => {
          // do the splitting
          const n = getTickLength();

          // get the range of difference
          const range = layout.length / n

          // find the indexes at intervals
          const array = [...Array(n).keys()]
          const resultIndex = [...array.map((it: number, i: number) => it * range), layout.length - 1]

          // get the actual values from the indexes
          const tickVals = resultIndex.map((it: number) => layout[Math.floor(it)])
          return tickVals
      }

      // returns tick length
      // if width is 12, tick length is 10
      const getTickLength = () => props.width - 2

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
                  size: 0
              },
          };

          searchQueryData.loading = true
            if (props.data.fields.stream_type == "metrics" && props.data.customQuery && props.data.queryType == "promql") {
                await queryService
                    .metrics_query_range({
                        org_identifier: store.state.selectedOrganization.identifier,
                        query: queryData,
                        start_time: startISOTimestamp,
                        end_time: endISOTimestamp
                    })
                    .then((res) => {
                        searchQueryData.data = res.data.data;
                    })
                    .catch((error) => {
                       let errStr = ""
                        if (error.response != undefined) {
                            errStr = error.response.data.error;
                        } else {
                            errStr = error.message;
                        }
                        const customMessage = logsErrorMessage(error.response.data.code);
                        searchQueryData.data.errorCode = error.response.data.code;
                        if (customMessage != "") {
                            errStr = t(customMessage);
                        }
                        $q.notify({
                            type: "negative",
                            message: errStr,
                            timeout: 5000,
                        });
                    })
                    .finally(() => {
                        searchQueryData.loading = false
                    });
            }
            else{
                await queryService
                    .search({
                        org_identifier: store.state.selectedOrganization.identifier,
                        query: query,
                        page_type: props.data.fields.stream_type,
                    })
                    .then((res) => {
                        searchQueryData.data = res.data.hits;
                    })
                    .catch((error) => {
                        let errStr = ""
                        if (error.response != undefined) {
                            errStr = error.response.data.error;
                        } else {
                            errStr = error.message;
                        }
                        const customMessage = logsErrorMessage(error.response.data.code);
                        searchQueryData.data.errorCode = error.response.data.code;
                        if (customMessage != "") {
                            errStr = t(customMessage);
                        }
                        $q.notify({
                            type: "negative",
                            message: errStr,
                            timeout: 5000,
                        });
                    })
                    .finally(() => {
                        searchQueryData.loading = false
                    });     
        }
      };

      // If data or chart type is updated, rerender the chart
      watch(
          () => [searchQueryData.data, props.data.type],
          () => {
              if (props.data.type != "table") {
                renderChart()
              } else {
                updateTableColumns()
              }
          },
          { deep: true }
      );

      const renderChart = async () => {
        if (props.data?.fields?.stream_type == "metrics" && props.data?.customQuery && props.data?.queryType == "promql") {
            renderPromQlBasedChart()
        } else {
            renderSqlBasedChart()
        }
      }

      // multiple x axis and multiple y axis
      const renderSqlBasedChart = async () => {
          // console.log("Query: rendering chart");
          // console.log("Query: chart type", props.data.type);
          // Step 1: Get the X-Axis key
          const xAxisKeys = getXAxisKeys();

          // Step 2: Get the Y-Axis key
          const yAxisKeys = getYAxisKeys();

          let traces: any;

          switch (props.data.type) {
              case "bar":
              case "line":
              case "scatter":
              case "area": {
                  // x axis values
                  // if x axis length is 1, then use the normal labels,
                  // more more than one, we need to create array of array for each key
                  const xData = !xAxisKeys.length ?
                              [] :
                              xAxisKeys.length == 1 ?  
                              getAxisDataFromKey(xAxisKeys[0]) :
                              xAxisKeys?.map((key: any) => {
                                  return getAxisDataFromKey(key);
                              });
          
                  //generate trace based on the y axis keys
                  traces = yAxisKeys?.map((key: any) => {
                      
                      const trace = {
                          name: props.data.fields?.y.find((it: any) => it.alias == key).label,
                          ...getPropsByChartTypeForTraces(),
                          showlegend: props.data.config?.show_legends,
                          marker: {
                              color:
                                  props.data.fields?.y.find((it: any) => it.alias == key).color ||
                                  "#5960b2",
                              opacity: 0.8,
                          },
                          x: xData,
                          y: getAxisDataFromKey(key),
                          customdata: getAxisDataFromKey(xAxisKeys[0]), //TODO: need to check for the data value, check for multiple x
                          hovertemplate: "%{fullData.name}: %{y}<br>%{customdata}<extra></extra>" //TODO: need to check for the data value

                      };
                      return trace
                  })
                  break;
              }
              case "h-bar": {
                  // x axis values
                  // if x axis length is 1, then use the normal labels,
                  // more more than one, we need to create array of array for each key
                  const xData = !xAxisKeys.length ?
                              [] :
                              xAxisKeys.length == 1 ?  
                              getAxisDataFromKey(xAxisKeys[0]) :
                              xAxisKeys?.map((key: any) => {
                                  return getAxisDataFromKey(key);
                              });

                  //generate trace based on the y axis keys
                  traces = yAxisKeys?.map((key: any) => {
                      const trace = {
                          name: props.data.fields?.y.find((it: any) => it.alias == key).label,
                          ...getPropsByChartTypeForTraces(),
                          showlegend: props.data.config?.show_legends,
                          marker: {
                              color:
                                  props.data.fields?.y.find((it: any) => it.alias == key).color ||
                                  "#5960b2",
                              opacity: 0.8,
                          },
                          x: getAxisDataFromKey(key),
                          y: xData,
                          customdata: getAxisDataFromKey(xAxisKeys[0]), //TODO: need to check for the data value, check for multiple x
                          hovertemplate: "%{fullData.name}: %{x}<br>%{customdata}<extra></extra>" //TODO: need to check for the data value

                      };
                      return trace
                  })
                  break;
              }
              case "pie": {
                  // x axis values
                  // if x axis length is 1, then use the normal labels,
                  // more more than one, we need to create array of array for each key
                  const xData = !xAxisKeys.length ?
                              [] :
                              xAxisKeys.length == 1 ?  
                              getAxisDataFromKey(xAxisKeys[0]) :
                              xAxisKeys?.map((key: any) => {
                                  return getAxisDataFromKey(key);
                              });

                  //generate trace based on the y axis keys
                  traces = yAxisKeys?.map((key: any) => {
                      const trace = {
                          name: props.data.fields?.y.find((it: any) => it.alias == key).label,
                          ...getPropsByChartTypeForTraces(),
                          showlegend: props.data.config?.show_legends,
                          marker: {
                              color:
                                  props.data.fields?.y.find((it: any) => it.alias == key).color ||
                                  "#5960b2",
                              opacity: 0.8,
                          },
                          labels: textwrapper(xData),
                          values: getAxisDataFromKey(key),
                          hovertemplate : "%{label}: %{value} (%{percent})<extra></extra>"

                      };
                      return trace
                  })
                //   console.log("multiple:- traces", traces);
                  break;
              }
              case "donut": {
                  // x axis values
                  // if x axis length is 1, then use the normal labels,
                  // more more than one, we need to create array of array for each key
                  const xData = !xAxisKeys.length ?
                              [] :
                              xAxisKeys.length == 1 ?  
                              getAxisDataFromKey(xAxisKeys[0]) :
                              xAxisKeys?.map((key: any) => {
                                  return getAxisDataFromKey(key);
                              });

                  //generate trace based on the y axis keys
                  traces = yAxisKeys?.map((key: any) => {
                      const trace = {
                          name: props.data.fields?.y.find((it: any) => it.alias == key).label,
                          ...getPropsByChartTypeForTraces(),
                          showlegend: props.data.config?.show_legends,
                          marker: {
                              color:
                                  props.data.fields?.y.find((it: any) => it.alias == key).color ||
                                  "#5960b2",
                              opacity: 0.8,
                          },
                          labels: textwrapper(xData),
                          values: getAxisDataFromKey(key),
                          domain: {column: 0},
                          hole: .4,
                          hovertemplate : "%{label}: %{value} (%{percent})<extra></extra>"

                      };
                      return trace
                  })
                //   console.log("multiple:- traces", traces);
                  break;
              }
              case "stacked": {
                  // stacked with xAxis's second value
                  // allow 2 xAxis and 1 yAxis value for stack chart
                  // get second x axis key
                  const key1 = xAxisKeys[1]
                  // get the unique value of the second xAxis's key
                  const stackedXAxisUniqueValue =  [...new Set( searchQueryData.data.map((obj: any) => obj[key1])) ].filter((it)=> it);
                //   console.log("stacked x axis unique value", stackedXAxisUniqueValue);
                  
                  // create a trace based on second xAxis's unique values
                  traces = stackedXAxisUniqueValue?.map((key: any) => {
                    //   console.log("--inside trace--",props.data.fields?.x.find((it: any) => it.alias == key));
                      
                      const trace = {
                          name: key,
                          ...getPropsByChartTypeForTraces(),
                          showlegend: props.data.config?.show_legends,
                          x: searchQueryData.data.filter((item: any) => (item[key1] === key)).map((it: any) => it[xAxisKeys[0]]),
                          y: searchQueryData.data.filter((item: any) => (item[key1] === key)).map((it: any) => it[yAxisKeys[0]]),
                          customdata: searchQueryData.data.filter((item: any) => (item[key1] === key)).map((it: any) => it[xAxisKeys[0]]), //TODO: need to check for the data value
                          hovertemplate: "%{fullData.name}: %{y}<br>%{customdata}<extra></extra>" //TODO: need to check for the data value

                      };
                      return trace
                  })
                //   console.log("multiple:- traces", traces);
                  break;
              }
              case "h-stacked": {
                  // stacked with xAxis second value
                  // allow 2 xAxis and 1 yAxis value for stack chart
                  // get second x axis key
                  const key1 = xAxisKeys[1]
                  // get the unique value of the second xAxis's key
                  const stackedXAxisUniqueValue =  [...new Set( searchQueryData.data.map((obj: any) => obj[key1])) ].filter((it)=> it);
                //   console.log("stacked x axis unique value", stackedXAxisUniqueValue);
                  
                  // create a trace based on second xAxis's unique values
                  traces = stackedXAxisUniqueValue?.map((key: any) => {
                    //   console.log("--inside trace--",props.data.fields?.x.find((it: any) => it.alias == key));
                      
                      const trace = {
                          name: key,
                          ...getPropsByChartTypeForTraces(),
                          showlegend: props.data.config?.show_legends,
                          x: searchQueryData.data.filter((item: any) => (item[key1] === key)).map((it: any) => it[yAxisKeys[0]]),
                          y: searchQueryData.data.filter((item: any) => (item[key1] === key)).map((it: any) => it[xAxisKeys[0]]),
                          customdata: getAxisDataFromKey(key), //TODO: need to check for the data value
                          hovertemplate: "%{fullData.name}: %{y}<br>%{customdata}<extra></extra>" //TODO: need to check for the data value

                      };
                      return trace
                  })
                //   console.log("multiple:- traces", traces);
                  break;
              }
              case "metric": {
                  const key1 = yAxisKeys[0]
                  const yAxisValue= getAxisDataFromKey(key1)
                //   console.log('metric changed',);
                  traces= []
                  const trace =  {
                    ...getPropsByChartTypeForTraces(),
                    value: yAxisValue.length > 0 ? yAxisValue[0] : 0 ,
                  }
                  traces.push(trace)
                  break;
              }
              default: {
                  break;
              }
          }

        //   console.log("Query: props by layout: ", getPropsByChartTypeForLayout());

          //generate the layout value of chart
          const layout: any = {
              title: false,
              showlegend: props.data.config?.show_legends,
              font: { size: 12 },
              autosize: true,
              legend: {
                  bgcolor: "#f7f7f7",
                  itemclick: ['pie', 'donut'].includes(props.data.type) ? 'toggle' : false,
              },
              margin: {
                  l: props.data.type == 'pie' ? 60 : 32,
                  r: props.data.type == 'pie' ? 60 : 16,
                  t: 38,
                  b: 32,
              },
              ...getPropsByChartTypeForLayout(),
          };

        //   console.log('layout', layout);

          Plotly.react(plotRef.value, traces, layout, {
              responsive: true,
              displaylogo: false,
              displayModeBar: false,
          });
      };

      const renderPromQlBasedChart = () => {

        switch(searchQueryData.data.resultType) { 
            case 'matrix': {
                const traces = searchQueryData.data?.result?.map((metric: any) => {
                    const values = metric.values.sort((a: any,b: any) => a[0] - b[0])
                    return  {
                        name: JSON.stringify(metric.metric),
                        x: values.map((value: any) => (new Date(value[0] * 1000)).toISOString()),
                        y: values.map((value: any) => value[1]),
                        hovertemplate: "%{x}: %{y:.2f}<br>%{fullData.name}<extra></extra>"
                    }
                })

                const layout: any = {
                    title: false,
                    showlegend: props.data.config?.show_legends,
                    font: { size: 12 },
                    autosize: true,
                    legend: {
                        bgcolor: "#f7f7f7",
                        orientation: "h",
                        itemclick: false,
                    },
                    margin: {
                        autoexpand: true,
                        l:50,
                        r:50,
                        t:50,
                        b:50
                    }
                };

                Plotly.react(plotRef.value, traces, layout, {
                    responsive: true,
                    displaylogo: false,
                    displayModeBar: false,
                });

                break;
            }
            case 'vector': {
                const traces = searchQueryData.data?.result?.map((metric: any) => {
                    const values = [metric.value]
                    // console.log('vector',values);
                    
                    return  {
                        name: JSON.stringify(metric.metric),
                        x: values.map((value: any) => (new Date(value[0] * 1000)).toISOString()),
                        y: values.map((value: any) => value[1]),
                    }
                })

                const layout: any = {
                    title: false,
                    showlegend: props.data.config?.show_legends,
                    font: { size: 12 },
                    autosize: true,
                    legend: {
                        bgcolor: "#f7f7f7",
                        orientation: "h",
                        itemclick: false
                    },
                    margin: {
                        l: props.data.type == 'pie' ? 60 : 32,
                        r: props.data.type == 'pie' ? 60 : 16,
                        t: 38,
                        b: 32,
                    }
                };

                Plotly.react(plotRef.value, traces, layout, {
                    responsive: true,
                    displaylogo: false,
                    displayModeBar: false,
                });

                break;
            }
        }

        
        // const trace = {
        //                   name: props.data.fields?.y.find((it: any) => it.alias == key).label,
        //                   ...getPropsByChartTypeForTraces(),
        //                   showlegend: props.data.config?.show_legends,
        //                   marker: {
        //                       color:
        //                           props.data.fields?.y.find((it: any) => it.alias == key).color ||
        //                           "#5960b2",
        //                       opacity: 0.8,
        //                   },
        //                   x: xData,
        //                   y: getAxisDataFromKey(key),
        //                   customdata: getAxisDataFromKey(xAxisKeys[0]), //TODO: need to check for the data value, check for multiple x
        //                   hovertemplate: "%{fullData.name}: %{y}<br>%{customdata}<extra></extra>" //TODO: need to check for the data value

        //               };
      }

      // get the x axis key
      const getXAxisKeys = () => {
          return props.data.fields?.x?.length ? props.data.fields?.x.map((it: any) => it.alias) : [];
      };

      // get the y axis key
      const getYAxisKeys = () => {
          return props.data.fields?.y?.length ? props.data.fields?.y.map((it: any) => it.alias) : [];
      };

      // get the axis data using key
      const getAxisDataFromKey = (key: string) => {
          // when the key is not available in the data that is not show the default value
          let result: string[] = searchQueryData?.data?.map((item: any) => item[key]);
          // when the key is not available in the data make default value null using below line
          // let result: string[] = searchQueryData.data.map((item) => item[key] || 'null');

          // check for the histogram _timestamp field
          // If histogram _timestamp field is found, format the date labels
          const field = props.data.fields?.x.find((it: any) => it.aggregationFunction == 'histogram' && it.column == '_timestamp')
          if (field && field.alias == key) {
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

              // result = result.map((it: any) => it.replace("T", " "))
              // console.log("with timestamps: " + result);
              
          }
          // console.log("without timestamps: " + result);
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
              case "donut":
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
              case "stacked":
                  return {
                      type: 'bar',
                  };
              case "metric":
                  return {
                      type: "indicator",
                      mode: "number",
                  };
              case "h-stacked":
                  return {
                      type: 'bar',
                      orientation: "h",
                  };
              default:
                  return {
                      type: "bar",
                  };
          }
      };

      // layout changes based on selected chart type
      const getPropsByChartTypeForLayout = () => {
          const xAxisKey = getXAxisKeys().length ? getXAxisKeys()[0] : '';
          const xAxisData = getAxisDataFromKey(xAxisKey)
          const xAxisDataWithTicks = getTickLimits(xAxisData)

          switch (props.data.type) {
              case "bar": {
                  const xaxis: any = {
                      title: props.data.fields?.x[0].label,
                      tickangle: (props.data?.fields?.x[0]?.aggregationFunction == 'histogram') ? 0 : -20,
                      automargin: true,
                  }

                  const yaxis: any = {
                      title: props.data.fields?.y?.length == 1 ? props.data.fields.y[0].label : "",
                      automargin: true,
                      fixedrange: true
                  }

                  if(props.data.fields?.x.length == 1){
                      xaxis["tickmode"] = "array",
                      xaxis["tickvals"] = xAxisDataWithTicks,
                      xaxis["ticktext"] = textformat(xAxisDataWithTicks)
                  }

                  const trace = {
                      barmode: "group",
                      xaxis: xaxis,
                      yaxis: yaxis
                  }
                  return trace

              }
              case "line":{
                  const xaxis: any = {
                      title: props.data.fields?.x[0].label,
                      tickangle: (props.data?.fields?.x[0]?.aggregationFunction == 'histogram') ? 0 : -20,
                      automargin: true,
                      // rangeslider: { range: xAxisDataWithTicks },
                  }

                  const yaxis: any = {
                      title: props.data.fields?.y?.length == 1 ? props.data.fields.y[0].label : "",
                      automargin: true,
                      fixedrange: true,
                  }

                  if(props.data.fields?.x.length == 1){
                      xaxis["tickmode"] = "array",
                      xaxis["tickvals"] = xAxisDataWithTicks,
                      xaxis["ticktext"] = textformat(xAxisDataWithTicks)
                  }

                  const trace = {
                      xaxis: xaxis,
                      yaxis: yaxis
                  }
                  return trace
              }
              case "scatter": {
                  const xaxis: any = {
                      title: props.data.fields?.x[0].label,
                      tickangle: (props.data?.fields?.x[0]?.aggregationFunction == 'histogram') ? 0 : -20,
                      automargin: true,
                  }

                  const yaxis: any = {
                      title: props.data.fields?.y?.length == 1 ? props.data.fields.y[0].label : "",
                      automargin: true,
                      fixedrange: true
                  }

                  if(props.data.fields?.x.length == 1){
                      xaxis["tickmode"] = "array",
                      xaxis["tickvals"] = xAxisDataWithTicks,
                      xaxis["ticktext"] = textformat(xAxisDataWithTicks)
                  }

                  const trace = {
                      scattermode: "group",
                      xaxis: xaxis,
                      yaxis: yaxis
                  }
                  return trace
              }
              case "pie":
                  return {
                      xaxis: {
                          title: props.data.fields?.x[0].label,
                          tickangle: -20,
                          automargin: true,
                      },
                      yaxis: {
                          tickmode: "array",
                          tickvals: xAxisDataWithTicks,
                          ticktext: textformat(xAxisDataWithTicks),
                          title: props.data.fields?.y?.length == 1 ? props.data.fields.y[0].label : "",
                          automargin: true,
                      },
                  };
              case "donut":
                  return {
                      xaxis: {
                          title: props.data.fields?.x[0].label,
                          tickangle: -20,
                          automargin: true,
                      },
                      yaxis: {
                          tickmode: "array",
                          tickvals: xAxisDataWithTicks,
                          ticktext: textformat(xAxisDataWithTicks),
                          title: props.data.fields?.y?.length == 1 ? props.data.fields.y[0].label : "",
                          automargin: true,
                      },
                  };
              case "h-bar": {
                  const xaxis: any = {
                      title: props.data.fields?.y[0].label,
                      tickangle: -20,
                      automargin: true,
                      fixedrange: true
                  }

                  const yaxis: any = {
                      title: props.data.fields?.x?.length == 1 ? props.data.fields.x[0].label : "",
                      automargin: true,
                  }

                  if(props.data.fields?.x.length == 1){
                      yaxis["tickmode"] = "array",
                      yaxis["tickvals"] = xAxisDataWithTicks,
                      yaxis["ticktext"] = textformat(xAxisDataWithTicks)
                  }

                  const trace = {
                      barmode: "group",
                      xaxis: xaxis,
                      yaxis: yaxis
                  }

                  return trace
              }
              case "area": {
                  const xaxis: any = {
                      title: props.data.fields?.x[0].label,
                      tickangle: (props.data?.fields?.x[0]?.aggregationFunction == 'histogram') ? 0 : -20,
                      automargin: true,
                  }

                  const yaxis: any = {
                      title: props.data.fields?.y?.length == 1 ? props.data.fields.y[0].label : "",
                      automargin: true,
                      fixedrange: true
                  }

                  if(props.data.fields?.x.length == 1){
                      xaxis["tickmode"] = "array",
                      xaxis["tickvals"] = xAxisDataWithTicks,
                      xaxis["ticktext"] = textformat(xAxisDataWithTicks)
                  }

                  const trace = {
                      xaxis: xaxis,
                      yaxis: yaxis
                  }

                  return trace
              }
              case "stacked":
                  return {
                      barmode: "stack",
                      xaxis: {
                          tickmode: "array",
                          tickvals: xAxisDataWithTicks,
                          ticktext: textformat(xAxisDataWithTicks),
                          title: props.data.fields?.x[0].label,
                          tickangle: (props.data?.fields?.x[0]?.aggregationFunction == 'histogram') ? 0 : -20,
                          automargin: true,
                      },
                      yaxis: {
                          title: props.data.fields?.y?.length == 1 ? props.data.fields.y[0].label : "",
                          automargin: true,
                          fixedrange: true
                      },
                  };
              case "h-stacked":
                  return {
                      barmode: "stack",
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
              case "metric":
                  return {
                      paper_bgcolor: "white",
                      // width: 600,
                      // height: 200,
                  }
              default:
                  return {
                      xaxis: {
                          tickmode: "array",
                          tickvals: xAxisDataWithTicks,
                          ticktext: textformat(xAxisDataWithTicks),
                          title: props.data.fields?.x[0].label,
                          tickangle: (props.data?.fields?.x[0]?.aggregationFunction == 'histogram') ? 0 : -20,
                          automargin: true,
                      },
                      yaxis: {
                          title: props.data.fields?.y?.length == 1 ? props.data.fields.y[0].label : "",
                          automargin: true,
                          fixedrange: true
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
          tableColumn,
          noData
      };
  },
});
</script>

<style lang="scss" scoped>
.my-sticky-virtscroll-table {
  /* height or max-height is important */
  height: calc(100% - 1px);
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  overflow: auto;

  :deep(.q-table__top),
  :deep(.q-table__bottom),
  :deep(thead tr:first-child th) {
      /* bg color is important for th; just specify one */
      background-color: #fff;
  }

  :deep(thead tr th) {
      will-change: auto !important;
      position: sticky;
      z-index: 1;
  }

  /* this will be the loading indicator */
  :deep(thead tr:last-child th) {
      /* height of all previous header rows */
      top: 48px;
  }

  :deep(thead tr:first-child th) {
      top: 0;
  }

  :deep(.q-virtual-scroll) {
      will-change: auto !important;
  }
}
</style>

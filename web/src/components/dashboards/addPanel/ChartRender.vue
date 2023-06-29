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
  <div ref="chartPanelRef" style="margin-top: 0px; height: calc(100% - 40px);">
      <div v-if="props.data.type == 'table'" class="q-pa-sm" style="height: 100%">
          <div class="column" style="height: 100%; position: relative;">
            <q-table v-show="!errorDetail" class="my-sticky-virtscroll-table" virtual-scroll v-model:pagination="pagination"
                :rows-per-page-options="[0]" :virtual-scroll-sticky-size-start="48" dense
                :rows="searchQueryData?.data || []" :columns="tableColumn" row-key="id">
            </q-table>
              <div v-if="errorDetail" class="errorMessage">
                <q-icon size="md" name="warning" />
                <div style="height: 80%; width: 100%;">{{ errorDetail }}</div>
              </div>
            <div v-if="searchQueryData.loading" class="row" style="position: absolute; top:0px; width:100%; z-index: 1;">
                <q-spinner-dots color="primary" style="margin: 0 auto; height: 10px; width: 40px;" />
            </div>
          </div>
      </div>
      <div v-else style="height: 100%; position: relative;">
          <div v-show="!errorDetail" ref="plotRef" :id="chartID" class="plotlycontainer" style="height: 100%"></div>
          <div v-if="!errorDetail" class="noData">{{ noData }}</div>
          <div v-if="errorDetail" class="errorMessage">
            <q-icon size="md" name="warning" />
            <div style="height: 80%; width: 100%;">{{ errorDetail }}</div>
          </div>
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
  onUnmounted,
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
  emits:["error"],
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
      },
      variablesData: {
        type: Object,
        default: () => null
      }
  },

  setup(props, { emit }) {
      const $q = useQuasar();
      const { t } = useI18n();
      const store = useStore();
      const searchQueryData = reactive({
          data: [] as (any | Array<any>),
          loading: false
      });
      const errorDetail = ref("");

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

      const chartPanelRef = ref(null)
      let observer: any = null;
      const isDirty: any = ref(true);
      const isVisible: any = ref(false);

      const handleIntersection = (entries:any) => {
        isVisible.value = entries[0].isIntersecting;
      }

      watch(()=> isVisible.value, async()=> {
          if(isDirty.value && props.data.query){
              fetchQueryData()
          }
      })

      // remove intersection observer
      onUnmounted(() => {
        if (observer) {
            observer.disconnect();
        }
      });

      watch(() => props.variablesData, () => {
        if(props.data.query && isQueryDependentOnTheVariables()) {
            fetchQueryData()
        }
      }, { deep: true });

      const isQueryDependentOnTheVariables = () => {
        const dependentVariables = props.variablesData.values.filter((it: any) =>
            props.data.query.includes(`$${it.name}`)
        );
        return dependentVariables.length > 0;
      }

      // If query changes, we need to get the data again and rerender the chart
      watch(
          () => [props.data, props.selectedTimeDate],
          async () => {
              isDirty.value = true
              
              if (props.data.query) {
                  // load the data if visible
                  if(isVisible.value){
                    fetchQueryData();
                    updateTableColumns();
                  }
              } else {
                  await nextTick();
                  Plotly.react(
                      plotRef.value,
                      [],
                      {...getThemeLayoutOptions()},
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
                  {...getThemeLayoutOptions()},
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

        //   if (props.data.query) {
        //       fetchQueryData();
        //   }

        observer = new IntersectionObserver(handleIntersection, {
            root: null,
            rootMargin: '0px',
            threshold: 0.1 // Adjust as needed
        });

        observer.observe(chartPanelRef.value);
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

      const canRunQueryBasedOnVariables = () => {
        // console.log('variablesData:', props.variablesData);
        // console.log('data query:', props.data.query);
        console.log(`${props.data.config.title}: checking variables dependency`);
        
        const dependentVariables = props.variablesData.values.filter((it: any) =>
            props.data.query.includes(`$${it.name}`)
        );
        console.log(`${props.data.config.title}: dependentVariables` + JSON.stringify(dependentVariables));

        if (dependentVariables.length > 0) {
            const dependentAvailableVariables = dependentVariables.filter(
            (it: any) => !it.isLoading
            );
            console.log(
            `${props.data.config.title}: dependentAvailableVariables-`,
            JSON.stringify(dependentAvailableVariables)
            );
            if (dependentAvailableVariables.length == dependentVariables.length) {
            console.log(`${props.data.config.title}: canRunQueryBasedOnVariables: true`);
            return true;
            } else {
            console.log(`${props.data.config.title}: canRunQueryBasedOnVariables: false`);
            return false;
            }
        } else {
            console.log(`${props.data.config.title}: canRunQueryBasedOnVariables: true`);
            return true;
        }
      };

    const replaceQueryValue = (query: any) => {
    if (props.variablesData.values.length) {
        const dependentVariables = props.variablesData.values.filter((it: any) =>
            query.includes(`$${it.name}`)
        );
        console.log(`dependentVariables-: ${dependentVariables}`);
        

            if(dependentVariables.length){

                props.variablesData.values.forEach((variable:any, index:number) => {
                const variableName = `$${variable.name}`;
                const variableValue = variable.value;
                console.log(`Replacing ${variableName} with ${variableValue}`);
                query = query.replace(variableName, variableValue);
                });
                console.log(`Updated query: ${query}`);
                return query;
            }else{
                return query
            }
    } else {
        console.log("No variables data found, returning original query");
        return query;
    }
    }

      // returns tick length
      // if width is 12, tick length is 10
      const getTickLength = () => props.width - 2

      // Chart Related Functions
      const fetchQueryData = async () => {
        console.log("can run query", canRunQueryBasedOnVariables());
          // If the current query is dependent and the the data is not available for the variables, then don't run the query
          if(isQueryDependentOnTheVariables() && !canRunQueryBasedOnVariables()) {
            return;
          }

          // continue if it is not dependent on the variables or dependent variables' values are available
          console.log("after can run query based on variables");
          
       
          let queryData = props.data.query;
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
          console.log("before querydata", queryData);
          //replace query value
         
          console.log("props.data.query",props.data.query);
          

          const query = {
              query: {
                  sql: replaceQueryValue(queryData),
                  sql_mode: "full",
                  start_time: startISOTimestamp,
                  end_time: endISOTimestamp,
                  size: 0
              },
          };

         searchQueryData.loading = true;

            // Check if stream_type is "metrics", customQuery exists, and queryType is "promql"
            if (props.data.fields.stream_type == "metrics" && props.data.customQuery && props.data.queryType == "promql") {
                console.log("inside if");
                
                await queryService
                    .metrics_query({
                        org_identifier: store.state.selectedOrganization.identifier,
                        query: queryData,
                        start_time: startISOTimestamp,
                        end_time: endISOTimestamp
                    })
                    .then((res) => {
                        // Set searchQueryData.data to the API response data
                        searchQueryData.data = res.data.data;
                        // Clear errorDetail
                        errorDetail.value = "";
                    })
                    .catch((error) => {
                        // Process API error for "promql"
                        processApiError(error, "promql");
                    })
                    .finally(() => {
                        searchQueryData.loading = false;
                    });
            } else {
                // Call search API
                await queryService
                    .search({
                        org_identifier: store.state.selectedOrganization.identifier,
                        query: query,
                        page_type: props.data.fields.stream_type,
                    })
                    .then((res) => {
                        // Set searchQueryData.data to the API response hits
                        searchQueryData.data = res.data.hits;
                        // Clear errorDetail
                        errorDetail.value = "";
                    })
                    .catch((error) => {
                        // Process API error for "sql"
                        processApiError(error, "sql");
                    })
                    .finally(() => {
                        searchQueryData.loading = false;
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

      const processApiError = async (error:any, type: string) => {
        switch (type) {
            case "promql": {
                // Get the error detail value from the response data or error message
                const errorDetailValue = error.response?.data?.error || error.message;
                // Trim the error message if it exceeds 300 characters
                const trimmedErrorMessage = errorDetailValue.length > 300 ? errorDetailValue.slice(0, 300) + " ..." : errorDetailValue;
                // Set the trimmed error message to the errorDetail value
                errorDetail.value = trimmedErrorMessage;
                // Emit an 'error' event with the trimmed error message
                emit('error', trimmedErrorMessage);
                break;
            }
            case "sql": {
                // Get the error detail value from the response data or error message
                const errorDetailValue = error.response?.data.error_detail ?? error.message;
                // Trim the error message if it exceeds 300 characters
                const trimmedErrorMessage = errorDetailValue.length > 300 ? errorDetailValue.slice(0, 300) + " ..." : errorDetailValue;
                // Set the trimmed error message to the errorDetail value
                errorDetail.value = trimmedErrorMessage;
                // Emit an 'error' event with the trimmed error message
                emit('error', trimmedErrorMessage);
                break;
            }
            default:
                break;
        }
      }
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
                          name: props.data.fields?.y.find((it: any) => it.alias == key)?.label,
                          ...getPropsByChartTypeForTraces(),
                          showlegend: props.data.config?.show_legends,
                          marker: {
                              color:
                                  props.data.fields?.y.find((it: any) => it.alias == key)?.color ||
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
                          name: props.data.fields?.y.find((it: any) => it.alias == key)?.label,
                          ...getPropsByChartTypeForTraces(),
                          showlegend: props.data.config?.show_legends,
                          marker: {
                              color:
                                  props.data.fields?.y.find((it: any) => it.alias == key)?.color ||
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
                          name: props.data.fields?.y.find((it: any) => it.alias == key)?.label,
                          ...getPropsByChartTypeForTraces(),
                          showlegend: props.data.config?.show_legends,
                          marker: {
                              color:
                                  props.data.fields?.y.find((it: any) => it.alias == key)?.color ||
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
                          name: props.data.fields?.y.find((it: any) => it.alias == key)?.label,
                          ...getPropsByChartTypeForTraces(),
                          showlegend: props.data.config?.show_legends,
                          marker: {
                              color:
                                  props.data.fields?.y.find((it: any) => it.alias == key)?.color ||
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
              case "area-stacked": {
                  // stacked with xAxis's second value
                  // allow 2 xAxis and 1 yAxis value for stack chart
                  // get second x axis key
                  const key1 = xAxisKeys[1]
                  // get the unique value of the second xAxis's key
                  const stackedXAxisUniqueValue =  [...new Set( searchQueryData.data.map((obj: any) => obj[key1])) ].filter((it)=> it);
                //   console.log("stacked x axis unique value", stackedXAxisUniqueValue);
                  
                  // create a trace based on second xAxis's unique values
                  traces = stackedXAxisUniqueValue?.map((key: any) => {
                      const trace = {
                          name: key,
                          ...getPropsByChartTypeForTraces(),
                          showlegend: props.data.config?.show_legends,
                          x: Array.from(new Set(searchQueryData.data.map((it: any) => it[xAxisKeys[0]]))),
                          y: Array.from(new Set(searchQueryData.data.map((it: any) => it[xAxisKeys[0]]))).map((it: any) => (searchQueryData.data.find((it2:any)=>it2[xAxisKeys[0]] == it && it2[key1] == key))?.[yAxisKeys[0]] || 0),
                          customdata: Array.from(new Set(searchQueryData.data.map((it: any) => it[xAxisKeys[0]]))), //TODO: need to check for the data value
                          hovertemplate: "%{fullData.name}: %{y}<br>%{customdata}<extra></extra>", //TODO: need to check for the data value
                          stackgroup: 'one'

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
                          x: Array.from(new Set(searchQueryData.data.map((it: any) => it[xAxisKeys[0]]))),
                          y: Array.from(new Set(searchQueryData.data.map((it: any) => it[xAxisKeys[0]]))).map((it: any) => (searchQueryData.data.find((it2:any)=>it2[xAxisKeys[0]] == it && it2[key1] == key))?.[yAxisKeys[0]] || 0),
                          customdata: Array.from(new Set(searchQueryData.data.map((it: any) => it[xAxisKeys[0]]))), //TODO: need to check for the data value
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
              autosize: true,
              legend: {
                  bgcolor: "#0000000b",
                  orientation: getLegendPosition('sql'),
                  itemclick: ['pie', 'donut'].includes(props.data.type) ? 'toggle' : false,
              },
              margin: {
                  l: props.data.type == 'pie' ? 60 : 32,
                  r: props.data.type == 'pie' ? 60 : 16,
                  t: 38,
                  b: 32,
              },
              ...getPropsByChartTypeForLayout(),
              ...getThemeLayoutOptions()
          };

        //   console.log('layout', layout);
        //   console.log('traces', traces);


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
                        name: getPromqlLegendName(metric.metric, props.data.config.promql_legend),
                        x: values.map((value: any) => (new Date(value[0] * 1000)).toISOString()),
                        y: values.map((value: any) => value[1]),
                        hovertemplate: "%{x}: %{y:.2f}<br>%{fullData.name}<extra></extra>"
                    }
                })

                const layout: any = {
                    title: false,
                    showlegend: props.data.config?.show_legends,
                    autosize: true,
                    legend: {
                        // bgcolor: "#f7f7f7",
                        orientation: getLegendPosition('promql'),
                        itemclick: false,
                    },
                    margin: {
                        autoexpand: true,
                        l:50,
                        r:50,
                        t:50,
                        b:50
                    },
                    ...getThemeLayoutOptions()
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
                    autosize: true,
                    legend: {
                        // bgcolor: "#f7f7f7",
                        orientation: getLegendPosition('promql'),
                        itemclick: false
                    },
                    margin: {
                        l: props.data.type == 'pie' ? 60 : 32,
                        r: props.data.type == 'pie' ? 60 : 16,
                        t: 38,
                        b: 32,
                    },
                    ...getThemeLayoutOptions()
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

      const getPromqlLegendName = (metric: any, label: string) => {
        if(label) {
            let template = label || "";
            const placeholders = template.match(/\{([^}]+)\}/g);

            // Step 2: Iterate through each placeholder
            placeholders?.forEach(function(placeholder: any) {
                // Step 3: Extract the key from the placeholder
                const key = placeholder.replace("{", "").replace("}", "");
                
                // Step 4: Retrieve the corresponding value from the JSON object
                const value = metric[key];
                
                // Step 5: Replace the placeholder with the value in the template
                if(value) {
                    template = template.replace(placeholder, value);
                }
            });
            return template
        } else {
            return JSON.stringify(metric)
        }

      }

      const getLegendPosition = (type: string) => {
        const legendPosition = props.data.config?.legends_position
        
        switch (legendPosition) {
            case 'bottom':
                return 'h';
            case 'right':
                return 'v';
            default:
                return type == 'promql' ? 'h' : 'v';
        }
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
              case "area-stacked":
                  return {
                        mode: 'lines',  
                        // fill: 'none'
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

        //   console.log("data with tick",xAxisDataWithTicks);
          

          switch (props.data.type) {
              case "bar": {
                  const xaxis: any = {
                      title: props.data.fields?.x[0]?.label,
                      tickangle: (props.data?.fields?.x[0]?.aggregationFunction == 'histogram') ? 0 : -20,
                      automargin: true,
                  }

                  const yaxis: any = {
                      title: props.data.fields?.y?.length == 1 ? props.data.fields.y[0]?.label : "",
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
                      title: props.data.fields?.x[0]?.label,
                      tickangle: (props.data?.fields?.x[0]?.aggregationFunction == 'histogram') ? 0 : -20,
                      automargin: true,
                      // rangeslider: { range: xAxisDataWithTicks },
                  }

                  const yaxis: any = {
                      title: props.data.fields?.y?.length == 1 ? props.data.fields.y[0]?.label : "",
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
                      title: props.data.fields?.x[0]?.label,
                      tickangle: (props.data?.fields?.x[0]?.aggregationFunction == 'histogram') ? 0 : -20,
                      automargin: true,
                  }

                  const yaxis: any = {
                      title: props.data.fields?.y?.length == 1 ? props.data.fields.y[0]?.label : "",
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
                          title: props.data.fields?.x[0]?.label,
                          tickangle: -20,
                          automargin: true,
                      },
                      yaxis: {
                          tickmode: "array",
                          tickvals: xAxisDataWithTicks,
                          ticktext: textformat(xAxisDataWithTicks),
                          title: props.data.fields?.y?.length == 1 ? props.data.fields.y[0]?.label : "",
                          automargin: true,
                      },
                  };
              case "donut":
                  return {
                      xaxis: {
                          title: props.data.fields?.x[0]?.label,
                          tickangle: -20,
                          automargin: true,
                      },
                      yaxis: {
                          tickmode: "array",
                          tickvals: xAxisDataWithTicks,
                          ticktext: textformat(xAxisDataWithTicks),
                          title: props.data.fields?.y?.length == 1 ? props.data.fields.y[0]?.label : "",
                          automargin: true,
                      },
                  };
              case "h-bar": {
                  const xaxis: any = {
                      title: props.data.fields?.y[0]?.label,
                      tickangle: -20,
                      automargin: true,
                      fixedrange: true
                  }

                  const yaxis: any = {
                      title: props.data.fields?.x?.length == 1 ? props.data.fields.x[0]?.label : "",
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
                      title: props.data.fields?.x[0]?.label,
                      tickangle: (props.data?.fields?.x[0]?.aggregationFunction == 'histogram') ? 0 : -20,
                      automargin: true,
                  }

                  const yaxis: any = {
                      title: props.data.fields?.y?.length == 1 ? props.data.fields.y[0]?.label : "",
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
              case "area-stacked":{

                const xaxis: any = {
                    title: props.data.fields?.x[0]?.label,
                    tickangle: (props.data?.fields?.x[0]?.aggregationFunction == 'histogram') ? 0 : -20,
                    automargin: true
                  }

                const yaxis: any = {
                    title: props.data.fields?.y?.length == 1 ? props.data.fields.y[0]?.label : "",
                    automargin: true,
                    fixedrange: true
                }
                
                //show tickvals and ticktext value when the stacked chart hasn't timestamp
                // if the first field is timestamp we dont want to show the tickvals
                // format value only for without timestamp
                // stacked chart is alwayes stacked with first field value
                if(props.data.fields?.x.length && props.data.fields?.x[0].aggregationFunction != 'histogram' && !props.data.fields?.x[0].column != store.state.zoConfig.timestamp_column){
                    xaxis["tickmode"] = "array",
                    xaxis["tickvals"] = xAxisDataWithTicks,
                    xaxis["ticktext"] = textformat(xAxisDataWithTicks)
                }

                const layout = {
                    barmode: "stack",
                    xaxis: xaxis,
                    yaxis: yaxis
                }
                
                return layout
                }
              case "stacked":{

                const xaxis: any = {
                    title: props.data.fields?.x[0]?.label,
                    tickangle: (props.data?.fields?.x[0]?.aggregationFunction == 'histogram') ? 0 : -20,
                    automargin: true
                  }

                const yaxis: any = {
                    title: props.data.fields?.y?.length == 1 ? props.data.fields.y[0]?.label : "",
                    automargin: true,
                    fixedrange: true
                }

                //show tickvals and ticktext value when the stacked chart hasn't timestamp
                // if the first field is timestamp we dont want to show the tickvals
                // format value only for without timestamp
                // stacked chart is alwayes stacked with first field value
                if(props.data.fields?.x.length && props.data.fields?.x[0].aggregationFunction != 'histogram' && !props.data.fields?.x[0].column != store.state.zoConfig.timestamp_column){
                    xaxis["tickmode"] = "array",
                    xaxis["tickvals"] = xAxisDataWithTicks,
                    xaxis["ticktext"] = textformat(xAxisDataWithTicks)
                }

                const layout = {
                    barmode: "stack",
                    xaxis: xaxis,
                    yaxis: yaxis
                }
                
                return layout
              
                }
              case "h-stacked":
                  return {
                      barmode: "stack",
                      xaxis: {
                          title: props.data.fields?.y[0]?.label,
                          tickangle: -20,
                          automargin: true,
                      },
                      yaxis: {
                          title: props.data.fields?.x?.length == 1 ? props.data.fields.x[0]?.label : "",
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
                          title: props.data.fields?.x[0]?.label,
                          tickangle: (props.data?.fields?.x[0]?.aggregationFunction == 'histogram') ? 0 : -20,
                          automargin: true,
                      },
                      yaxis: {
                          title: props.data.fields?.y?.length == 1 ? props.data.fields.y[0]?.label : "",
                          automargin: true,
                          fixedrange: true
                      },
                  };
          }
      };

    const getThemeLayoutOptions = () => ({
        paper_bgcolor: store.state.theme === 'dark' ? '#181a1b' : '#fff',
        plot_bgcolor: store.state.theme === 'dark' ? '#181a1b' : '#fff',
        font: {
                size: 12 ,
                color: store.state.theme === 'dark' ? '#fff' : '#181a1b'
            }
    })

    watch(() => store.state.theme, () => {
        Plotly.update(plotRef.value, {}, getThemeLayoutOptions())
    })

      return {
          chartPanelRef,
          plotRef,
          props,
          searchQueryData,
          pagination: ref({
              rowsPerPage: 0,
          }),
          chartID,
          tableColumn,
          noData,
          errorDetail,
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
.my-sticky-virtscroll-table.q-dark {
  :deep(.q-table__top),
  :deep(.q-table__bottom),
  :deep(thead tr:first-child th) {
      /* bg color is important for th; just specify one */
    //   background-color: #fff;
      background-color: $dark-page !important;
  }
}

.errorMessage{
    position: absolute; 
    top:20%;width:100%; 
    height: 80%; 
    overflow: hidden;
    text-align:center;
    color: rgba(255, 0, 0, 0.8); 
    text-overflow: ellipsis;
}
.noData{
    position: absolute; 
    top:20%;
    width:100%;
    text-align:center;
}
</style>

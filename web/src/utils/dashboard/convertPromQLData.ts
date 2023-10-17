// Copyright 2023 Zinc Labs Inc.

//  Licensed under the Apache License, Version 2.0 (the "License");
//  you may not use this file except in compliance with the License.
//  You may obtain a copy of the License at

//      http:www.apache.org/licenses/LICENSE-2.0

//  Unless required by applicable law or agreed to in writing, software
//  distributed under the License is distributed on an "AS IS" BASIS,
//  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//  See the License for the specific language governing permissions and
//  limitations under the License.

import moment from "moment";
import { formatDate, formatUnitValue, getUnitValue } from "./convertDataIntoUnitValue";

/**
 * Converts PromQL data into a format suitable for rendering a chart.
 *
 * @param {any} panelSchema - the panel schema object
 * @param {any} searchQueryData - the search query data
 * @param {any} store - the store object
 * @return {Object} - the option object for rendering the chart
 */
export const convertPromQLData = (
  panelSchema: any,
  searchQueryData: any,
  store: any
) => {
  
  // if no data than return it
  if (
    !Array.isArray(searchQueryData) ||
    searchQueryData.length === 0 ||
    !searchQueryData[0] ||
    !panelSchema
  ) {
    return { options: null };
  }

  // It is used to keep track of the current series name in tooltip to bold the series name
  let currentSeriesName = "";

  // set the current series name (will be set at chartrenderer on mouseover)
  const setCurrentSeriesValue = (newValue: any) => {
    currentSeriesName = newValue ?? "";
  };

  const legendPosition = getLegendPosition(
    panelSchema?.config?.legends_position
  );

  const legendConfig: any = {
    show: panelSchema.config?.show_legends,
    type: "scroll",
    orient: legendPosition,
    padding: [10, 20, 10, 10],
    tooltip: {
      show: true,
      padding: 10,
      textStyle: {
        fontSize: 12,
      },
      backgroundColor: "rgba(255,255,255,0.8)",
    },
    textStyle: {
      width: 150,
      overflow: "truncate",
      rich: {
        a: {
            fontWeight: 'bold'
        },
        b: {
            fontStyle: 'normal'
        }
      }
    },
    formatter: (name: any) => {
      return name == currentSeriesName ? '{a|' + name + '}': '{b|' + name + '}'
    }
  };

  // Additional logic to adjust the legend position
  if (legendPosition === "vertical") {
    legendConfig.left = null; // Remove left positioning
    legendConfig.right = 0; // Apply right positioning
    legendConfig.top = "center"; // Apply bottom positioning
  } else {
    legendConfig.left = "0"; // Apply left positioning
    legendConfig.top = "bottom"; // Apply bottom positioning
  }

  const options: any = {
    backgroundColor: "transparent",
    legend: legendConfig,
    grid: {
      containLabel: true,
      left: "30",
      right:
        legendConfig.orient === "vertical" && panelSchema.config?.show_legends
          ? 220
          : "40",
      top: "15",
      bottom: "30",
    },
    tooltip: {
      show: true,
      trigger: "axis",
      textStyle: {
        fontSize: 12,
      },
      enterable: true,
      extraCssText: "max-height: 200px; overflow: auto;",
      formatter: function (name: any) {
        if (name.length == 0) return "";

        const date = new Date(name[0].data[0]);

        // get the current series index from name
        const currentSeriesIndex = name.findIndex(
          (it: any) => it.seriesName == currentSeriesName
        )
        
        // swap current hovered series index to top in tooltip
        const temp = name[0];
        name[0] = name[currentSeriesIndex != -1 ? currentSeriesIndex : 0];
        name[currentSeriesIndex != -1 ? currentSeriesIndex : 0] = temp;

        let hoverText = name.map((it: any) => { 
          
          // check if the series is the current series being hovered
          // if have than bold it
          if(it?.seriesName == currentSeriesName)
            return `<strong>${it.marker} ${it.seriesName} : ${formatUnitValue(
              getUnitValue(
                it.data[1],
                panelSchema.config?.unit,
                panelSchema.config?.unit_custom
              )
            )} </strong>`;
            // else normal text
            else
              return `${it.marker} ${it.seriesName} : ${formatUnitValue(
                getUnitValue(
                  it.data[1],
                  panelSchema.config?.unit,
                  panelSchema.config?.unit_custom
                )
              )}`;
        });

        return `${formatDate(date)} <br/> ${hoverText.join("<br/>")}`;
      },
      axisPointer: {
        show: true,
        type: "cross",
        label: {
          fontSize: 12,
          show: true,
          formatter: function (name: any) {
            if (name.axisDimension == "y")
              return formatUnitValue(
                getUnitValue(
                  name.value,
                  panelSchema.config?.unit,
                  panelSchema.config?.unit_custom
                )
              );
            const date = new Date(name.value);
            return `${formatDate(date)}`;
          },
        },
      },
    },
    xAxis: {
      type: "time",
    },
    yAxis: {
      type: "value",
      axisLabel: {
        formatter: function (name: any) {
          return formatUnitValue(
            getUnitValue(
              name,
              panelSchema.config?.unit,
              panelSchema.config?.unit_custom
            )
          );
        },
      },
      axisLine: {
        show: true,
      },
    },
    toolbox: {
      orient: "vertical",
      show: !["pie", "donut", "metric"].includes(panelSchema.type),
      feature: {
        dataZoom: {
          filterMode: 'none',
          yAxisIndex: "none",
        },
      },
    },
    series: [],
  };


  options.series = searchQueryData.map((it: any, index: number) => {

    switch (panelSchema.type) {
      case "bar":
      case "line":
      case "area":
      case "scatter":
      case "area-stacked": {
        switch (it.resultType) {
          case "matrix": {
            const seriesObj = it?.result?.map((metric: any) => {
              const values = metric.values.sort(
                (a: any, b: any) => a[0] - b[0]
              );
              return {
                name: getPromqlLegendName(
                  metric.metric,
                  panelSchema.queries[index].config.promql_legend
                ),
                data: values.map((value: any) => [value[0] * 1000, value[1]]),
                ...getPropsByChartTypeForSeries(panelSchema.type),
              };
            });

            return seriesObj;
          }
          case "vector": {
            const traces = it?.result?.map((metric: any) => {
              const values = [metric.value];
              return {
                name: JSON.stringify(metric.metric),
                x: values.map((value: any) =>
                  moment(value[0] * 1000).toISOString(true)
                ),
                y: values.map((value: any) => value[1]),
              };
            });
            return traces;
          }
        }
      }
      case "metric": {
        switch (it.resultType) {
          case "matrix": {
            const traces = it?.result?.map((metric: any) => {
              const values = metric.values.sort(
                (a: any, b: any) => a[0] - b[0]
              );
              const unitValue = getUnitValue(
                values[values.length - 1][1],
                panelSchema.config?.unit,
                panelSchema.config?.unit_custom
              );
              return {
                ...getPropsByChartTypeForSeries(panelSchema.type),
                renderItem: function (params: any) {
                  return {
                    type: "text",
                    style: {
                      text:
                        parseFloat(unitValue.value).toFixed(2) + unitValue.unit,
                      fontSize: Math.min(params.coordSys.cx / 2, 90), //coordSys is relative. so that we can use it to calculate the dynamic size
                      fontWeight: 500,
                      align: "center",
                      verticalAlign: "middle",
                      x: params.coordSys.cx,
                      y: params.coordSys.cy,
                      fill: store.state.theme == "dark" ? "#fff" : "#000",
                    },
                  };
                },
              };
            });
            options.dataset = { source: [[]] };
            options.tooltip = {
              show: false,
            };
            options.angleAxis = {
              show: false,
            };
            options.radiusAxis = {
              show: false,
            };
            options.polar = {};
            options.xAxis = [];
            options.yAxis = [];
            return traces;
          }
          case "vector": {
            const traces = it?.result?.map((metric: any) => {
              const values = [metric.value];
              return {
                name: JSON.stringify(metric.metric),
                value: metric?.value?.length > 1 ? metric.value[1] : "",
                ...getPropsByChartTypeForSeries(panelSchema.type),
              };
            });
            return traces;
          }
        }
        break;
      }
      default: {
        return [];
      }
    }
  });

  options.series = options.series.flat();

  // extras will be used to return other data to chart renderer
  // e.g. setCurrentSeriesValue to set the current series index which is hovered
  return { options, extras: { setCurrentSeriesValue }};
};

/**
 * Retrieves the legend name for a given metric and label.
 *
 * @param {any} metric - The metric object containing the values for the legend name placeholders.
 * @param {string} label - The label template for the legend name. If null or empty, the metric object will be converted to a JSON string and returned.
 * @return {string} The legend name with the placeholders replaced by the corresponding values from the metric object.
 */
const getPromqlLegendName = (metric: any, label: string) => {
  if (label) {
    let template = label || "";
    const placeholders = template.match(/\{([^}]+)\}/g);

    // Step 2: Iterate through each placeholder
    placeholders?.forEach(function (placeholder: any) {
      // Step 3: Extract the key from the placeholder
      const key = placeholder.replace("{", "").replace("}", "");

      // Step 4: Retrieve the corresponding value from the JSON object
      const value = metric[key];

      // Step 5: Replace the placeholder with the value in the template
      if (value) {
        template = template.replace(placeholder, value);
      }
    });
    return template;
  } else {
    return JSON.stringify(metric);
  }
};

/**
 * Determines the position of the legend based on the provided legendPosition.
 *
 * @param {string} legendPosition - The desired position of the legend. Possible values are "bottom" or "right".
 * @return {string} The position of the legend. Possible values are "horizontal" or "vertical".
 */
const getLegendPosition = (legendPosition: string) => {
  switch (legendPosition) {
    case "bottom":
      return "horizontal";
    case "right":
      return "vertical";
    default:
      return "horizontal";
  }
};


/**
 * Returns the props object based on the given chart type.
 *
 * @param {string} type - The chart type.
 * @return {object} The props object for the given chart type.
 */
const getPropsByChartTypeForSeries = (type: string) => {
  switch (type) {
    case "bar":
      return {
        type: "bar",
        emphasis: { focus: "series" },
      };
    case "line":
      return {
        type: "line",
        emphasis: { focus: "series" },
        smooth: true,
        showSymbol: false,
      };
    case "scatter":
      return {
        type: "scatter",
        emphasis: { focus: "series" },
        symbolSize: 5,
      };
    case "pie":
      return {
        type: "pie",
        emphasis: { focus: "series" },
      };
    case "donut":
      return {
        type: "pie",
        emphasis: { focus: "series" },
      };
    case "h-bar":
      return {
        type: "bar",
        orientation: "h",
        emphasis: { focus: "series" },
      };
    case "area":
      return {
        type: "line",
        emphasis: { focus: "series" },
        smooth: true,
        areaStyle: {},
        showSymbol: false,
      };
    case "stacked":
      return {
        type: "bar",
        emphasis: { focus: "series" },
      };
    case "area-stacked":
      return {
        type: "line",
        smooth: true,
        stack: "Total",
        areaStyle: {},
        showSymbol: false,
        emphasis: {
          focus: "series",
        },
      };
    case "metric":
      return {
        type: "custom",
        coordinateSystem: "polar",
      };
    case "h-stacked":
      return {
        type: "bar",
        emphasis: { focus: "series" },
        orientation: "h",
      };
    default:
      return {
        type: "bar",
      };
  }
};

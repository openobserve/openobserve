// Copyright 2023 Zinc Labs Inc.

import { formatDate, formatUnitValue, getUnitValue } from "./convertDataIntoUnitValue";

//  Licensed under the Apache License, Version 2.0 (the "License");
//  you may not use this file except in compliance with the License.
//  You may obtain a copy of the License at

//      http:www.apache.org/licenses/LICENSE-2.0

//  Unless required by applicable law or agreed to in writing, software
//  distributed under the License is distributed on an "AS IS" BASIS,
//  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//  See the License for the specific language governing permissions and
//  limitations under the License.

/**
 * Converts SQL data into a format suitable for rendering a chart.
 *
 * @param {any} panelSchema - the panel schema object
 * @param {any} searchQueryData - the search query data
 * @param {any} store - the store object
 * @return {Object} - the options object for rendering the chart
 */
export const convertSQLData = (
  panelSchema: any,
  searchQueryData: any,
  store: any
) => {
  // get the x axis key
  const getXAxisKeys = () => {
    return panelSchema?.queries[0]?.fields?.x?.length
      ? panelSchema?.queries[0]?.fields?.x.map((it: any) => it.alias)
      : [];
  };

  // get the y axis key
  const getYAxisKeys = () => {
    return panelSchema?.queries[0]?.fields?.y?.length
      ? panelSchema?.queries[0]?.fields?.y.map((it: any) => it.alias)
      : [];
  };

  // get the z axis key
  const getZAxisKeys = () => {
    return panelSchema?.queries[0]?.fields?.z?.length
      ? panelSchema?.queries[0]?.fields?.z.map((it: any) => it.alias)
      : [];
  };

  // get the axis data using key
  const getAxisDataFromKey = (key: string) => {
    const data = searchQueryData.filter((item: any) => {
      return (
        xAxisKeys.every((key: any) => item[key] != null) &&
        yAxisKeys.every((key: any) => item[key] != null)
      );
    });

    const keys = Object.keys(data[0]); // Assuming there's at least one object
    const keyArrays: any = {};

    for (const key of keys) {
      keyArrays[key] = data.map((obj: any) => obj[key]);
    }

    let result = keyArrays[key] || [];

    // when the key is not available in the data that is not show the default value
    const field = panelSchema.queries[0].fields?.x.find(
      (it: any) =>
        it.aggregationFunction == "histogram" &&
        it.column == store.state.zoConfig.timestamp_column
    );
    if (field && field.alias == key) {
      // now we have the format, convert that format
      result = result.map(
        (it: any) =>
          new Date(it).getTime() - new Date("1970-01-01T00:00:00").getTime()
      );
    }
    return result;
  };

  // Step 1: Get the X-Axis key
  const xAxisKeys = getXAxisKeys();

  // Step 2: Get the Y-Axis key
  const yAxisKeys = getYAxisKeys();

  const zAxisKeys = getZAxisKeys();

  const legendPosition = getLegendPosition(
    panelSchema.config?.legends_position
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
      width: 100,
      overflow: "truncate",
    },
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
          ? 200
          : "20",
      top: "15",
      bottom: "30",
    },
    tooltip: {
      trigger: "axis",
      textStyle: {
        fontSize: 12,
      },
      axisPointer: {
        type: "cross",
        label: {
          show: true,
          fontsize: 12,
          formatter: function (params: any) {
            let lineBreaks = "";
            if (
              panelSchema.type === "h-bar" ||
              panelSchema.type === "h-stacked"
            ) {
              if (params.axisDimension == "x")
                return formatUnitValue(
                  getUnitValue(
                    params.value,
                    panelSchema.config?.unit,
                    panelSchema.config?.unit_custom
                  )
                );

              //we does not required any linebreaks for h-stacked because we only use one x axis
              if (panelSchema.type === "h-stacked")
                return params.value.toString();
              for (
                let i = 0;
                i < xAxisKeys.length - params.axisIndex - 1;
                i++
              ) {
                lineBreaks += " \n \n";
              }
              params.value = params.value.toString();
              return `${lineBreaks}  ${params.value}`;
            }
            if (params.axisDimension == "y")
              return formatUnitValue(
                getUnitValue(
                  params.value,
                  panelSchema.config?.unit,
                  panelSchema.config?.unit_custom
                )
              );
            for (let i = 0; i < xAxisKeys.length - params.axisIndex - 1; i++) {
              lineBreaks += " \n \n";
            }
            params.value = params.value.toString();
            return `${lineBreaks}  ${params.value}`;
          },
        },
      },
      formatter: function (name: any) {
        if (name.length == 0) return "";

        let hoverText = name.map((it: any) => {
          return `${it.marker} ${it.seriesName} : ${formatUnitValue(
            getUnitValue(
              it.value,
              panelSchema.config?.unit,
              panelSchema.config?.unit_custom
            )
          )}`;
        });
        return `${name[0].name} <br/> ${hoverText.join("<br/>")}`;
      },
    },
    xAxis: xAxisKeys
      ?.map((key: any, index: number) => {
        const data = getAxisDataFromKey(key);

        //unique value index array
        const arr: any = [];
        for (let i = 0; i < data.length; i++) {
          if (i == 0 || data[i] != data[i - 1]) arr.push(i);
        }

        return {
          type: "category",
          position: panelSchema.type == "h-bar" ? "left" : "bottom",
          name:
            index == 0 ? panelSchema.queries[0]?.fields?.x[index]?.label : "",
          nameLocation: "middle",
          nameGap: 13 * (xAxisKeys.length - index + 1),
          nameTextStyle: {
            fontWeight: "bold",
            fontSize: 14,
          },
          axisLabel: {
            interval:
              index == xAxisKeys.length - 1
                ? "auto"
                : function (i: any) {
                    return arr.includes(i);
                  },
            overflow: index == xAxisKeys.length - 1 ? "none" : "truncate",
            width: 100,
            margin: 18 * (xAxisKeys.length - index - 1) + 5,
          },
          splitLine: {
            show: false,
          },
          axisTick: {
            show: xAxisKeys.length == 1 ? false : true,
            align: "left",
            alignWithLabel: false,
            length: 20 * (xAxisKeys.length - index),
            interval: function (i: any) {
              return arr.includes(i);
            },
          },
          data: data,
        };
      })
      .flat(),
    yAxis: {
      type: "value",
      name:
        panelSchema.queries[0]?.fields?.y?.length == 1
          ? panelSchema.queries[0]?.fields?.y[0]?.label
          : "",
      nameLocation: "middle",
      nameGap:
        calculateWidthText(
          panelSchema.type == "h-bar" || panelSchema.type == "h-stacked"
            ? largestLabel(getAxisDataFromKey(yAxisKeys[0]))
            : formatUnitValue(
                getUnitValue(
                  largestLabel(getAxisDataFromKey(yAxisKeys[0])),
                  panelSchema.config?.unit,
                  panelSchema.config?.unit_custom
                )
              )
        ) + 8,
      nameTextStyle: {
        fontWeight: "bold",
        fontSize: 14,
      },
      axisLabel: {
        formatter: function (value: any) {
          return formatUnitValue(
            getUnitValue(
              value,
              panelSchema.config?.unit,
              panelSchema.config?.unit_custom
            )
          );
        },
      },
      splitLine: {
        show: false,
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
          yAxisIndex: "none",
        },
      },
    },
    series: [],
  };

  // Now set the series values as per the chart data
  // Override any configs if required as per the chart type
  switch (panelSchema.type) {
    case "bar":
    case "line":
    case "area": {
      options.series = yAxisKeys?.map((key: any) => {
        const seriesObj = {
          name: panelSchema?.queries[0]?.fields?.y.find(
            (it: any) => it.alias == key
          )?.label,
          color:
            panelSchema.queries[0]?.fields?.y.find((it: any) => it.alias == key)
              ?.color || "#5960b2",
          opacity: 0.8,
          ...getPropsByChartTypeForSeries(panelSchema.type),
          data: getAxisDataFromKey(key),
        };
        return seriesObj;
      });
      break;
    }
    case "scatter": {
      options.tooltip.formatter = function (name: any) {
        //reduce to each name
        const hoverText = name.reduce((text: any, it: any) => {
          return (text += `<br/> ${it.marker} ${
            it.seriesName
          } : ${formatUnitValue(
            getUnitValue(
              it.value[1],
              panelSchema.config?.unit,
              panelSchema.config?.unit_custom
            )
          )}`);
        }, "");
        //x axis name + hovertext
        return `${name[0].name} ${hoverText}`;
      };
      options.series = yAxisKeys?.map((key: any) => {
        const seriesObj = {
          name: panelSchema?.queries[0]?.fields?.y.find(
            (it: any) => it.alias == key
          )?.label,
          color:
            panelSchema.queries[0]?.fields?.y.find((it: any) => it.alias == key)
              ?.color || "#5960b2",
          opacity: 0.8,
          ...getPropsByChartTypeForSeries(panelSchema.type),
          data: getAxisDataFromKey(key).map((it: any, i: number) => {
            return [options.xAxis[0].data[i], it];
          }),
        };
        return seriesObj;
      });
      break;
    }
    case "h-bar": {
      //generate trace based on the y axis keys
      options.series = yAxisKeys?.map((key: any) => {
        const seriesObj = {
          name: panelSchema?.queries[0]?.fields?.y.find(
            (it: any) => it.alias == key
          )?.label,
          color:
            panelSchema.queries[0]?.fields?.y.find((it: any) => it.alias == key)
              ?.color || "#5960b2",
          opacity: 0.8,
          ...getPropsByChartTypeForSeries(panelSchema.type),
          data: getAxisDataFromKey(key),
        };
        return seriesObj;
      });
      //swap x and y axis
      const temp = options.xAxis;
      options.xAxis = options.yAxis;
      options.yAxis = temp;

      options.yAxis.map((it: any) => {
        it.nameGap = calculateWidthText(largestLabel(it.data)) + 14;
      });
      (options.xAxis.name =
        panelSchema.queries[0]?.fields?.y?.length >= 1
          ? panelSchema.queries[0]?.fields?.y[0]?.label
          : ""),
        (options.xAxis.nameGap = 20);
      break;
    }
    case "pie": {
      options.tooltip = {
        trigger: "item",
        textStyle: {
          fontSize: 12,
        },
        formatter: function (name: any) {
          return `${name.marker} ${name.name} : <b>${formatUnitValue(
            getUnitValue(
              name.value,
              panelSchema.config?.unit,
              panelSchema.config?.unit_custom
            )
          )}</b>`;
        },
      };
      //generate trace based on the y axis keys
      options.series = yAxisKeys?.map((key: any) => {
        const seriesObj = {
          ...getPropsByChartTypeForSeries(panelSchema.type),
          data: getAxisDataFromKey(key).map((it: any, i: number) => {
            return { value: it, name: options.xAxis[0].data[i] };
          }),
          label: {
            show: true,
            formatter: "{d}%", // {b} represents name, {c} represents value {d} represents percent
            position: "inside", // You can adjust the position of the labels
            fontSize: 10,
          },
        };
        return seriesObj;
      });
      options.xAxis = [];
      options.yAxis = [];
      break;
    }
    case "donut": {
      options.tooltip = {
        trigger: "item",
        textStyle: {
          fontSize: 12,
        },
        formatter: function (name: any) {
          return `${name.marker} ${name.name} : <b>${formatUnitValue(
            getUnitValue(
              name.value,
              panelSchema.config?.unit,
              panelSchema.config?.unit_custom
            )
          )}<b/>`;
        },
      };
      //generate trace based on the y axis keys
      options.series = yAxisKeys?.map((key: any) => {
        const seriesObj = {
          ...getPropsByChartTypeForSeries(panelSchema.type),
          data: getAxisDataFromKey(key).map((it: any, i: number) => {
            return { value: it, name: options.xAxis[0].data[i] };
          }),
          label: {
            show: true,
            formatter: "{d}%", // {b} represents name, {c} represents value {d} represents percent
            position: "inside", // You can adjust the position of the labels
            fontSize: 10,
          },
        };
        return seriesObj;
      });
      options.xAxis = [];
      options.yAxis = [];
      break;
    }
    case "area-stacked": {
      options.xAxis[0].data = Array.from(
        new Set(getAxisDataFromKey(xAxisKeys[0]))
      );
      options.xAxis = options.xAxis.slice(0, 1);
      options.tooltip.axisPointer.label = {
        show: true,
        label: {
          fontsize: 12,
        },
        formatter: function (params: any) {
          if (params.axisDimension == "y")
            return formatUnitValue(
              getUnitValue(
                params.value,
                panelSchema.config?.unit,
                panelSchema.config?.unit_custom
              )
            );
          return params.value.toString();
        },
      };
      options.xAxis[0].axisLabel = {};
      options.xAxis[0].axisTick = {};
      options.xAxis[0].nameGap = 20;
      // stacked with xAxis's second value
      // allow 2 xAxis and 1 yAxis value for stack chart
      // get second x axis key
      const key1 = xAxisKeys[1];
      // get the unique value of the second xAxis's key
      const stackedXAxisUniqueValue = [
        ...new Set(searchQueryData.map((obj: any) => obj[key1])),
      ].filter((it) => it);

      // create a trace based on second xAxis's unique values
      options.series = stackedXAxisUniqueValue?.map((key: any) => {
        const seriesObj = {
          name: key,
          ...getPropsByChartTypeForSeries(panelSchema.type),
          data: Array.from(
            new Set(searchQueryData.map((it: any) => it[xAxisKeys[0]]))
          ).map(
            (it: any) =>
              searchQueryData.find(
                (it2: any) => it2[xAxisKeys[0]] == it && it2[key1] == key
              )?.[yAxisKeys[0]] || 0
          ),
        };
        return seriesObj;
      });
      break;
    }
    case "stacked": {
      options.xAxis[0].data = Array.from(
        new Set(getAxisDataFromKey(xAxisKeys[0]))
      );
      options.xAxis = options.xAxis.slice(0, 1);
      options.tooltip.axisPointer.label = {
        show: true,
        label: {
          fontsize: 12,
        },
        formatter: function (params: any) {
          if (params.axisDimension == "y")
            return formatUnitValue(
              getUnitValue(
                params.value,
                panelSchema.config?.unit,
                panelSchema.config?.unit_custom
              )
            );
          return params.value.toString();
        },
      };
      options.xAxis[0].axisLabel.margin = 5;
      options.xAxis[0].axisLabel = {};
      options.xAxis[0].axisTick = {};
      options.xAxis[0].nameGap = 20;

      // stacked with xAxis's second value
      // allow 2 xAxis and 1 yAxis value for stack chart
      // get second x axis key
      const key1 = xAxisKeys[1];
      // get the unique value of the second xAxis's key
      const stackedXAxisUniqueValue = [
        ...new Set(searchQueryData.map((obj: any) => obj[key1])),
      ].filter((it) => it);

      options.series = stackedXAxisUniqueValue?.map((key: any) => {
        const seriesObj = {
          name: key,
          ...getPropsByChartTypeForSeries(panelSchema.type),
          data: Array.from(
            new Set(searchQueryData.map((it: any) => it[xAxisKeys[0]]))
          ).map(
            (it: any) =>
              searchQueryData.find(
                (it2: any) => it2[xAxisKeys[0]] == it && it2[key1] == key
              )?.[yAxisKeys[0]] || 0
          ),
        };
        return seriesObj;
      });
      break;
    }
    case "heatmap": {
      // get first x axis key
      const key0 = xAxisKeys[0];
      // get the unique value of the first xAxis's key
      const xAxisZerothPositionUniqueValue = [
        ...new Set(searchQueryData.map((obj: any) => obj[key0])),
      ].filter((it) => it);

      // get second x axis key
      const key1 = yAxisKeys[0];
      // get the unique value of the second xAxis's key
      const xAxisFirstPositionUniqueValue = [
        ...new Set(searchQueryData.map((obj: any) => obj[key1])),
      ].filter((it) => it);

      const yAxisKey0 = zAxisKeys[0];
      const Zvalues: any = xAxisFirstPositionUniqueValue.map((first: any) => {
        return xAxisZerothPositionUniqueValue.map((zero: any) => {
          return (
            searchQueryData.find(
              (it: any) => it[key0] == zero && it[key1] == first
            )?.[yAxisKey0] || "-"
          );
        });
      });
    
      (options.visualMap = {
        min: 0,
        max: Zvalues.reduce(
          (a: any, b: any) =>
            Math.max(
              a,
              b.reduce((c: any, d: any) => Math.max(c, +d || 0), 0)
            ),
          0
        ),
        calculable: true,
        orient: "horizontal",
        left: "center",
      }),
        (options.series = [
          {
            ...getPropsByChartTypeForSeries(panelSchema.type),
            name: panelSchema?.queries[0]?.fields?.y[0].label,
            data: Zvalues.map((it: any, index: any) => {
              return xAxisZerothPositionUniqueValue.map((i: any, j: number) => {
                return [j, index, it[j]];
              });
            }).flat(),
            label: {
              show: true,
              fontSize: 12,
              formatter: (params: any) => {
                return (
                  formatUnitValue(
                    getUnitValue(
                      params.value[2],
                      panelSchema.config?.unit,
                      panelSchema.config?.unit_custom
                    )
                  ) || params.value[2]
                );
              },
            },
          },
        ]);
      // option.yAxis.data=xAxisFirstPositionUniqueValue;
      (options.tooltip = {
        position: "top",
        textStyle: {
          fontSize: 12,
        },
      }),
        (options.tooltip.axisPointer = {
          type: "cross",
          label: {
            fontsize: 12,
          },
        });
      options.grid.bottom = 60;
      (options.xAxis = {
        type: "category",
        data: xAxisZerothPositionUniqueValue,
        splitArea: {
          show: true,
        },
      }),
        (options.yAxis = {
          type: "category",
          data: xAxisFirstPositionUniqueValue,
          splitArea: {
            show: true,
          },
        });
      options.legend.show = false;
      break;
    }
    case "h-stacked": {
      options.xAxis[0].data = Array.from(
        new Set(getAxisDataFromKey(xAxisKeys[0]))
      );
      options.xAxis = options.xAxis.slice(0, 1);

      // stacked with xAxis's second value
      // allow 2 xAxis and 1 yAxis value for stack chart
      // get second x axis key
      const key1 = xAxisKeys[1];
      // get the unique value of the second xAxis's key
      const stackedXAxisUniqueValue = [
        ...new Set(searchQueryData.map((obj: any) => obj[key1])),
      ].filter((it) => it);

      options.series = stackedXAxisUniqueValue?.map((key: any) => {
        const seriesObj = {
          name: key,
          ...getPropsByChartTypeForSeries(panelSchema.type),
          data: Array.from(
            new Set(searchQueryData.map((it: any) => it[xAxisKeys[0]]))
          ).map(
            (it: any) =>
              searchQueryData.find(
                (it2: any) => it2[xAxisKeys[0]] == it && it2[key1] == key
              )?.[yAxisKeys[0]] || 0
          ),
        };
        return seriesObj;
      });

      const temp = options.xAxis;
      options.xAxis = options.yAxis;
      options.yAxis = temp;
      options.yAxis.map((it: any) => {
        it.nameGap = calculateWidthText(largestLabel(it.data)) + 8;
      });
      options.xAxis.nameGap = 20;
      break;
    }
    case "metric": {
      const key1 = yAxisKeys[0];
      const yAxisValue = getAxisDataFromKey(key1);
      const unitValue = getUnitValue(
        yAxisValue.length > 0 ? yAxisValue[0] : 0,
        panelSchema.config?.unit,
        panelSchema.config?.unit_custom
      );
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
      options.series = [
        {
          ...getPropsByChartTypeForSeries(panelSchema.type),
          renderItem: function (params: any) {
            return {
              type: "text",
              style: {
                text: parseFloat(unitValue.value).toFixed(2) + unitValue.unit,
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
        },
      ];
      break;
    }
    default: {
      break;
    }
  }

  // auto SQL: if x axis has time series
  const field = panelSchema.queries[0].fields?.x.find(
    (it: any) =>
      it.aggregationFunction == "histogram" &&
      it.column == store.state.zoConfig.timestamp_column
  );
  if (field) {
    options.series.map((seriesObj: any) => {
      seriesObj.data = seriesObj.data.map((it: any, index: any) => [
        options.xAxis[0].data[index],
        it,
      ]);
    });
    options.xAxis[0].type = "time";
    options.xAxis[0].data = [];
    options.tooltip.formatter = function (name: any) {
      if (name.length == 0) return "";

      const date = new Date(name[0].data[0]);

      let hoverText = name.map((it: any) => {
        return `${it.marker} ${it.seriesName} : ${formatUnitValue(
          getUnitValue(
            it.data[1],
            panelSchema.config?.unit,
            panelSchema.config?.unit_custom
          )
        )}`;
      });
      return `${formatDate(date)} <br/> ${hoverText.join("<br/>")}`;
    };
    options.tooltip.axisPointer = {
      type: "cross",
      label: {
        fontsize: 12,
      },
      formatter: function (params: any) {
        const date = new Date(params[0].value[0]);
        return formatDate(date).toString();
      },
    };
  }

  //custom SQL: check if it is timeseries or not
  if (
    panelSchema.type != "h-bar" &&
    options.xAxis.length > 0 &&
    options.xAxis[0].data.length > 0
  ) {
    const sample = options.xAxis[0].data.slice(
      0,
      Math.min(20, options.xAxis[0].data.length)
    );

    const iso8601Pattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
    const isTimeSeries = sample.every((value: any) => {
      return iso8601Pattern.test(value);
    });
    if (isTimeSeries) {
      options.series.map((seriesObj: any) => {
        seriesObj.data = seriesObj.data.map((it: any, index: any) => [
          new Date(options.xAxis.data[index]).getTime() -
            new Date("1970-01-01T00:00:00").getTime(),
          it,
        ]);
      });
      options.xAxis[0].type = "time";
      options.xAxis[0].data = [];
      options.tooltip.axisPointer = {
        type: "cross",
        label: {
          fontsize: 12,
        },
        formatter: function (params: any) {
          const date = new Date(params[0].value[0]);
          return formatDate(date).toString();
        },
      };
    }
  }

  return {
    options,
  };
};

/**
 * Returns the position format for the legend.
 *
 * @param {string} legendPosition - The desired position of the legend. Possible values are "bottom" and "right".
 * @return {string} The format of the legend position. Possible values are "horizontal" and "vertical".
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
 * Calculates the width of a given text.
 * Useful to calculate nameGap for the left axis
 *
 * @param {string} text - The text to calculate the width of.
 * @return {number} The width of the text in pixels.
 */
const calculateWidthText = (text: string): number => {
  if (!text) return 0;

  const span = document.createElement("span");
  document.body.appendChild(span);

  span.style.font = "sans-serif";
  span.style.fontSize = "12px";
  span.style.height = "auto";
  span.style.width = "auto";
  span.style.top = "0px";
  span.style.position = "absolute";
  span.style.whiteSpace = "no-wrap";
  span.innerHTML = text;

  const width = Math.ceil(span.clientWidth);
  span.remove();
  return width;
};

/**
 * Finds the largest label in the given data array.
 *
 * @param {any[]} data - An array of data.
 * @return {any} The largest label in the data array.
 */
const largestLabel = (data: any) =>
  data.reduce((largest: any, label: any) => {
    return label?.toString().length > largest?.toString().length
      ? label
      : largest;
  }, "");

  
/**
 * Retrieves the properties for a given chart type and returns them as an object.
 *
 * @param {string} type - The type of chart.
 * @return {Object} - The properties for the given chart type.
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
        areaStyle: null,
      };
    case "scatter":
      return {
        type: "scatter",
        emphasis: { focus: "series" },
        symbolSize: 10,
      };
    case "pie":
      return {
        type: "pie",
        avoidLabelOverlap: false,
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowOffsetX: 0,
            shadowColor: "rgba(0, 0, 0, 0.5)",
          },
          label: {
            show: true,
          },
        },
        label: {
          show: true,
        },
        radius: "80%",
      };
    case "donut":
      return {
        type: "pie",
        radius: ["50%", "80%"],
        avoidLabelOverlap: false,
        label: {
          show: true,
          // position: 'center'
        },
        emphasis: {
          label: {
            show: true,
            fontSize: 12,
            fontWeight: "bold",
          },
        },
        labelLine: {
          show: false,
        },
      };
    case "h-bar":
      return {
        type: "bar",
        emphasis: { focus: "series" },
      };
    case "area":
      return {
        type: "line",
        smooth: true,
        emphasis: { focus: "series" },
        areaStyle: {},
      };
    case "stacked":
      return {
        type: "bar",
        stack: "total",
        emphasis: {
          focus: "series",
        },
      };
    case "heatmap":
      return {
        type: "heatmap",
        label: {
          show: true,
        },
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowColor: "rgba(0, 0, 0, 0.5)",
          },
        },
      };
    case "area-stacked":
      return {
        type: "line",
        smooth: true,
        stack: "Total",
        areaStyle: {},
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
        stack: "total",
        emphasis: {
          focus: "series",
        },
      };
    default:
      return {
        type: "bar",
      };
  }
};

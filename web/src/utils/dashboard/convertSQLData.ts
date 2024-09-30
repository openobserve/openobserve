// Copyright 2023 Zinc Labs Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

/**
 * Converts SQL data into a format suitable for rendering a chart.
 *
 * @param {any} panelSchema - the panel schema object
 * @param {any} searchQueryData - the search query data
 * @param {any} store - the store object
 * @return {Object} - the options object for rendering the chart
 */
import { toZonedTime } from "date-fns-tz";
import { dateBin } from "@/utils/dashboard/datetimeStartPoint";
import { format } from "date-fns";
import {
  convertSecondsToOffset,
  formatDate,
  formatUnitValue,
  getUnitValue,
  isTimeSeries,
  isTimeStamp,
} from "./convertDataIntoUnitValue";
import { calculateGridPositions } from "./calculateGridForSubPlot";
import { isGivenFieldInOrderBy } from "../query/sqlUtils";

export const convertMultiSQLData = async (
  panelSchema: any,
  searchQueryData: any,
  store: any,
  chartPanelRef: any,
  hoveredSeriesState: any,
  resultMetaData: any,
  metadata: any,
) => {
  if (!Array.isArray(searchQueryData) || searchQueryData.length === 0) {
    return { options: null };
  }

  // loop on all search query data
  const options: any = [];
  for (let i = 0; i < searchQueryData.length; i++) {
    options.push(
      await convertSQLData(
        panelSchema,
        [searchQueryData[i]],
        store,
        chartPanelRef,
        hoveredSeriesState,
        [resultMetaData.value[i]],
        { queries: [metadata.queries[i]] },
      ),
    );
  }

  // loop on all options
  if (options && options[0] && options[0].options) {
    for (let i = 1; i < options.length; i++) {
      if (options[i] && options[i].options && options[i].options.series) {
        options[0].options.series = [
          ...options[0].options.series,
          ...options[i].options.series.map((it: any) => {
            return {
              ...it,
              name: metadata?.queries[i]?.timeRangeGap
                ? `${it.name} (${convertSecondsToOffset(metadata?.queries[i]?.timeRangeGap)} ago) `
                : it.name,
            };
          }),
        ];
      }
    }
  }

  return options[0];
};

export const convertSQLData = async (
  panelSchema: any,
  searchQueryData: any,
  store: any,
  chartPanelRef: any,
  hoveredSeriesState: any,
  resultMetaData: any,
  metadata: any,
) => {
  // if no data than return it
  if (
    !Array.isArray(searchQueryData) ||
    searchQueryData.length === 0 ||
    !searchQueryData[0] ||
    !panelSchema.queries[0].fields.x ||
    !panelSchema.queries[0].fields.y
  ) {
    // console.timeEnd("convertSQLData");
    return { options: null };
  }

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

  // get the breakdown key
  const getBreakDownKeys = () => {
    return panelSchema?.queries[0]?.fields?.breakdown?.length
      ? panelSchema?.queries[0]?.fields?.breakdown.map((it: any) => it.alias)
      : [];
  };

  // Step 1: Get the X-Axis key
  const xAxisKeys = getXAxisKeys();

  // Step 2: Get the Y-Axis key
  const yAxisKeys = getYAxisKeys();

  const zAxisKeys = getZAxisKeys();

  const breakDownKeys = getBreakDownKeys();

  /**
   * Process the SQL data and convert it into a format suitable for the echarts
   * library.
   *
   * This function takes in the raw data returned from the SQL query and the
   * panel schema, and returns a processed data array that can be fed into the
   * echarts library.
   *
   * Here's a step-by-step breakdown of what this function does:
   *
   * 1. It checks if the data is empty or if the first item in the array is not
   * an object. If either condition is true, it returns an empty array.
   *
   * 2. It extracts the top_results and top_results_others values from the
   * panel schema config.
   *
   * 3. If top_results is not enabled, it simply returns the inner data array
   * without any modifications.
   *
   * 4. It extracts the breakdown key, y-axis key, and x-axis key from the
   * panel schema.
   *
   * 5. It aggregates the y-axis values by breakdown, ignoring items without a
   * breakdown key. This is done using the reduce() method.
   *
   * 6. It sorts the breakdown object by value in descending order and extracts
   * the top keys based on the configured number of top results. This is done
   * using the Object.entries() and sort() methods.
   *
   * 7. It initializes an empty result array and an empty others object.
   *
   * 8. It loops through the inner data array and checks if the breakdown value
   * is in the top keys. If it is, it adds the item to the result array. If it's
   * not, and top_results_others is enabled, it adds the item to the others
   * object.
   *
   * 9. If top_results_others is enabled, it loops through the others object and
   * adds the aggregated values to the result array.
   *
   * 10. Finally, it returns the result array.
   *
   * @param {any[]} data - The data returned from the SQL query.
   * @param {any} panelSchema - The schema of the panel.
   * @returns {any[]} - The processed data array.
   */
  const processData = (data: any[], panelSchema: any): any[] => {
    if (!data.length || !Array.isArray(data[0])) {
      return [];
    }

    const { top_results, top_results_others } = panelSchema.config;
    const innerDataArray = data[0];
    if (!top_results || !breakDownKeys.length) {
      return innerDataArray;
    }

    const breakdownKey = breakDownKeys[0];
    const yAxisKey = yAxisKeys[0];
    const xAxisKey = xAxisKeys[0];

    // Step 1: Aggregate y_axis values by breakdown, ignoring items without a breakdown key
    const breakdown = innerDataArray.reduce((acc, item) => {
      const breakdownValue = item[breakdownKey];
      const yAxisValue = item[yAxisKey];
      if (breakdownValue) {
        acc[breakdownValue] = (acc[breakdownValue] || 0) + (+yAxisValue || 0);
      }
      return acc;
    }, {});

    // Step 2: Sort and extract the top keys based on the configured number of top results
    const topKeys = Object.entries(breakdown)
      .sort(([, a]: any, [, b]: any) => b - a)
      .slice(0, top_results)
      .map(([key]) => key);

    // Step 3: Initialize result array and others object for aggregation
    const resultArray: any[] = [];
    const othersObj: any = {};

    innerDataArray.forEach((item) => {
      const breakdownValue = item[breakdownKey];
      if (topKeys.includes(breakdownValue)) {
        resultArray.push(item);
      } else if (top_results_others) {
        const xAxisValue = String(item[xAxisKey]);
        othersObj[xAxisValue] =
          (othersObj[xAxisValue] || 0) + (+item[yAxisKey] || 0);
      }
    });

    // Step 4: Add 'others' aggregation to the result array if enabled
    if (top_results_others) {
      Object.entries(othersObj).forEach(([xAxisValue, yAxisValue]) => {
        resultArray.push({
          [breakdownKey]: "others",
          [xAxisKey]: xAxisValue,
          [yAxisKey]: yAxisValue,
        });
      });
    }

    return resultArray;
  };

  const getMarkLineData = (panelSchema: any) => {
    return (
      panelSchema?.config?.mark_line?.map((markLine: any) => {
        return {
          name: markLine.name,
          type: markLine.type,
          xAxis: markLine.type == "xAxis" ? markLine.value : null,
          yAxis: markLine.type == "yAxis" ? markLine.value : null,
          label: {
            formatter: markLine.name ? "{b}:{c}" : "{c}",
            position: "insideEndTop",
          },
        };
      }) ?? []
    );
  };

  const noValueConfigOption = panelSchema?.config?.no_value_replacement ?? "";

  const processedData = processData(searchQueryData, panelSchema);

  const missingValue = () => {
    // Get the interval in minutes
    const interval = resultMetaData?.map((it: any) => it.histogram_interval)[0];

    if (
      !interval ||
      !metadata.queries ||
      !["area-stacked", "line", "area", "bar", "stacked"].includes(
        panelSchema.type,
      )
    ) {
      return JSON.parse(JSON.stringify(processedData));
    }

    // Extract and process metaDataStartTime
    const metaDataStartTime = metadata?.queries[0]?.startTime?.toString() ?? 0;
    const startTime = new Date(parseInt(metaDataStartTime) / 1000);

    // Calculate the binnedDate
    const origin = new Date(Date.UTC(2001, 0, 1, 0, 0, 0, 0));
    const binnedDate = dateBin(interval, startTime, origin);

    // Convert interval to milliseconds
    const intervalMillis = interval * 1000;

    // Identify the time-based key
    const searchQueryDataFirstEntry = processedData[0];

    const keys = [
      ...getXAxisKeys(),
      ...getYAxisKeys(),
      ...getZAxisKeys(),
      ...getBreakDownKeys(),
    ];
    const timeBasedKey = keys?.find((key) =>
      isTimeSeries([searchQueryDataFirstEntry?.[key]]),
    );

    if (!timeBasedKey) {
      return JSON.parse(JSON.stringify(processedData));
    }

    // Extract and process metaDataEndTime
    const metaDataEndTime = metadata?.queries[0]?.endTime?.toString() ?? 0;
    const endTime = new Date(parseInt(metaDataEndTime) / 1000);

    const xAxisKeysWithoutTimeStamp = getXAxisKeys().filter(
      (key: any) => key !== timeBasedKey,
    );
    const breakdownAxisKeysWithoutTimeStamp = getBreakDownKeys().filter(
      (key: any) => key !== timeBasedKey,
    );

    const timeKey = timeBasedKey;
    const uniqueKey =
      xAxisKeysWithoutTimeStamp[0] !== undefined
        ? xAxisKeysWithoutTimeStamp[0]
        : breakdownAxisKeysWithoutTimeStamp[0];

    // Create a set of unique xAxis values
    const uniqueXAxisValues = new Set(
      processedData.map((d: any) => d[uniqueKey]),
    );

    const filledData: any = [];
    let currentTime = binnedDate;
    // Create a map of existing data
    const searchDataMap = new Map();
    processedData?.forEach((d: any) => {
      const key =
        xAxisKeysWithoutTimeStamp.length > 0 ||
        breakdownAxisKeysWithoutTimeStamp.length > 0
          ? `${d[timeKey]}-${d[uniqueKey]}`
          : `${d[timeKey]}`;

      searchDataMap.set(key, d);
    });

    while (currentTime <= endTime) {
      const currentFormattedTime = format(
        toZonedTime(currentTime, "UTC"),
        "yyyy-MM-dd'T'HH:mm:ss",
      );

      if (
        xAxisKeysWithoutTimeStamp.length === 0 &&
        breakdownAxisKeysWithoutTimeStamp.length === 0
      ) {
        const key = `${currentFormattedTime}`;
        const currentData = searchDataMap.get(key);
        const nullEntry = {
          [timeKey]: currentFormattedTime,
          ...currentData,
        };
        if (!currentData) {
          keys.forEach((key) => {
            if (key !== timeKey) nullEntry[key] = noValueConfigOption;
          });
        }

        filledData.push(nullEntry);
      } else {
        uniqueXAxisValues.forEach((uniqueValue: any) => {
          const key = `${currentFormattedTime}-${uniqueValue}`;
          const currentData = searchDataMap.get(key);
          if (currentData) {
            filledData.push(currentData);
          } else {
            const nullEntry = {
              [timeKey]: currentFormattedTime,
              [uniqueKey]: uniqueValue,
            };

            keys.forEach((key) => {
              if (key !== timeKey && key !== uniqueKey) {
                nullEntry[key] = noValueConfigOption;
              }
            });

            filledData.push(nullEntry);
          }
        });
      }

      currentTime = new Date(currentTime.getTime() + intervalMillis);
    }

    return filledData;
  };

  const missingValueData = missingValue();
  // flag to check if the data is time series
  let isTimeSeriesFlag = false;

  // get the axis data using key
  const getAxisDataFromKey = (key: string) => {
    const data =
      missingValueData?.filter((item: any) => {
        return (
          xAxisKeys.every((key: any) => item[key] != null) &&
          yAxisKeys.every((key: any) => item[key] != null) &&
          breakDownKeys.every((key: any) => item[key] != null)
        );
      }) || [];

    // if data is not there use {} as a default value
    const keys = Object.keys((data.length && data[0]) || {}); // Assuming there's at least one object

    const keyArrays: any = {};

    for (const key of keys) {
      keyArrays[key] = data.map((obj: any) => obj[key]);
    }

    const result = keyArrays[key] || [];

    return result;
  };

  const legendPosition = getLegendPosition(
    panelSchema.config?.legends_position,
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
      formatter: (params: any) => {
        hoveredSeriesState?.value?.setHoveredSeriesName(params?.name);
        return params?.name;
      },
    },
    textStyle: {
      width: 100,
      overflow: "truncate",
      rich: {
        a: {
          fontWeight: "bold",
        },
        b: {
          fontStyle: "normal",
        },
      },
    },
    formatter: (name: any) => {
      return name == hoveredSeriesState?.value?.hoveredSeriesName
        ? "{a|" + name + "}"
        : "{b|" + name + "}";
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
      containLabel: panelSchema.config?.axis_width == null ? true : false,
      left: panelSchema.config?.axis_width ?? 30,
      right: 20,
      top: "15",
      bottom:
        legendConfig.orient === "horizontal" && panelSchema.config?.show_legends
          ? panelSchema.config?.axis_width == null
            ? 50
            : 60
          : panelSchema.config?.axis_width == null
            ? 35
            : "40",
    },
    tooltip: {
      trigger: "axis",
      textStyle: {
        color: store.state.theme === "dark" ? "#fff" : "#000",
        fontSize: 12,
      },
      enterable: true,
      backgroundColor:
        store.state.theme === "dark" ? "rgba(0,0,0,1)" : "rgba(255,255,255,1)",
      extraCssText: "max-height: 200px; overflow: auto; max-width: 400px",
      axisPointer: {
        type: "cross",
        label: {
          show: true,
          fontsize: 12,
          precision: panelSchema.config?.decimals,
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
                    panelSchema.config?.unit_custom,
                    panelSchema.config?.decimals,
                  ),
                );

              //we does not required any linebreaks for h-stacked because we only use one x axis
              if (panelSchema.type === "h-stacked")
                return params.value.toString();
              for (
                let i = 0;
                i <
                xAxisKeys.length + breakDownKeys.length - params.axisIndex - 1;
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
                  panelSchema.config?.unit_custom,
                  panelSchema.config?.decimals,
                ),
              );
            for (
              let i = 0;
              i <
              xAxisKeys.length + breakDownKeys.length - params.axisIndex - 1;
              i++
            ) {
              lineBreaks += " \n \n";
            }
            params.value = params.value.toString();
            return `${lineBreaks}  ${params.value}`;
          },
        },
      },
      formatter: function (name: any) {
        // show tooltip for hovered panel only for other we only need axis so just return empty string
        if (
          hoveredSeriesState?.value &&
          panelSchema.id &&
          hoveredSeriesState?.value?.panelId != panelSchema.id
        )
          return "";
        if (name.length == 0) return "";

        // sort tooltip array based on value
        name.sort((a: any, b: any) => {
          return (b.value ?? 0) - (a.value ?? 0);
        });

        // if hovered series name is not null then move it to first position
        if (hoveredSeriesState?.value?.hoveredSeriesName) {
          // get the current series index from name
          const currentSeriesIndex = name.findIndex(
            (it: any) =>
              it.seriesName == hoveredSeriesState?.value?.hoveredSeriesName,
          );

          // if hovered series index is not -1 then take it to very first position
          if (currentSeriesIndex != -1) {
            // shift all series to next position and place current series at first position
            const temp = name[currentSeriesIndex];
            for (let i = currentSeriesIndex; i > 0; i--) {
              name[i] = name[i - 1];
            }
            name[0] = temp;
          }
        }

        const hoverText: string[] = [];
        name.forEach((it: any) => {
          // if value is not null, show in tooltip
          if (it.value != null) {
            // check if the series is the current series being hovered
            // if have than bold it
            if (it?.seriesName == hoveredSeriesState?.value?.hoveredSeriesName)
              hoverText.push(
                `<strong>${it.marker} ${it.seriesName} : ${formatUnitValue(
                  getUnitValue(
                    it.value,
                    panelSchema.config?.unit,
                    panelSchema.config?.unit_custom,
                    panelSchema.config?.decimals,
                  ),
                )} </strong>`,
              );
            // else normal text
            else
              hoverText.push(
                `${it.marker} ${it.seriesName} : ${formatUnitValue(
                  getUnitValue(
                    it.value,
                    panelSchema.config?.unit,
                    panelSchema.config?.unit_custom,
                    panelSchema.config?.decimals,
                  ),
                )}`,
              );
          }
        });

        return `${name[0].name} <br/> ${hoverText.join("<br/>")}`;
      },
    },
    xAxis: [...xAxisKeys, ...breakDownKeys]?.map((key: any, index: number) => {
      const data = getAxisDataFromKey(key);

      //unique value index array
      const arr: any = [];
      for (let i = 0; i < data.length; i++) {
        if (i == 0 || data[i] != data[i - 1]) arr.push(i);
      }

      return {
        type: "category",
        position: panelSchema.type == "h-bar" ? "left" : "bottom",
        // inverse data for h-stacked and h-bar
        inverse: ["h-stacked", "h-bar"].includes(panelSchema.type),
        name: index == 0 ? panelSchema.queries[0]?.fields?.x[index]?.label : "",
        nameLocation: "middle",
        nameGap: 9 * (xAxisKeys.length + breakDownKeys.length - index + 1),
        nameTextStyle: {
          fontWeight: "bold",
          fontSize: 14,
        },
        axisLabel: {
          interval:
            panelSchema.type == "h-stacked"
              ? "auto"
              : index == xAxisKeys.length + breakDownKeys.length - 1
                ? "auto"
                : function (i: any) {
                    return arr.includes(i);
                  },
          overflow:
            index == xAxisKeys.length + breakDownKeys.length - 1
              ? "none"
              : "truncate",
          // hide axis label if overlaps
          hideOverlap: true,
          width: 100,
          margin:
            18 * (xAxisKeys.length + breakDownKeys.length - index - 1) + 5,
        },
        splitLine: {
          show: true,
        },
        axisLine: {
          show: panelSchema.config?.axis_border_show || false,
        },
        axisTick: {
          show: xAxisKeys.length + breakDownKeys.length == 1 ? false : true,
          align: "left",
          alignWithLabel: false,
          length: 20 * (xAxisKeys.length + breakDownKeys.length - index),
          interval:
            panelSchema.type == "h-stacked"
              ? "auto"
              : function (i: any) {
                  return arr.includes(i);
                },
        },
        data: data,
      };
    }),
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
                  panelSchema.config?.unit_custom,
                  panelSchema.config?.decimals,
                ),
              ),
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
              panelSchema.config?.unit_custom,
              panelSchema.config?.decimals,
            ),
          );
        },
      },
      splitLine: {
        show: true,
      },
      axisLine: {
        show: panelSchema.config?.axis_border_show || false,
      },
    },
    toolbox: {
      orient: "vertical",
      show: !["pie", "donut", "metric", "gauge"].includes(panelSchema.type),
      showTitle: false,
      tooltip: {
        show: false,
      },
      itemSize: 0,
      itemGap: 0,
      // it is used to hide toolbox buttons
      bottom: "100%",
      feature: {
        dataZoom: {
          yAxisIndex: "none",
        },
      },
    },
    series: [],
  };
  const defaultSeriesProps = getPropsByChartTypeForSeries(panelSchema.type);

  // Now set the series values as per the chart data
  // Override any configs if required as per the chart type
  switch (panelSchema.type) {
    case "area-stacked":
    case "line":
    case "area":
    case "scatter": {
      //if area stacked then continue
      //or if area or line or scatter, then check x axis length
      if (
        panelSchema.type == "area-stacked" ||
        ((panelSchema.type == "line" ||
          panelSchema.type == "area" ||
          panelSchema.type == "scatter") &&
          panelSchema.queries[0].fields.breakdown?.length)
      ) {
        options.xAxis = options.xAxis.slice(0, 1);
        options.tooltip.axisPointer.label = {
          show: true,
          label: {
            fontsize: 12,
            precision: panelSchema.config?.decimals,
          },
          formatter: function (params: any) {
            if (params.axisDimension == "y")
              return formatUnitValue(
                getUnitValue(
                  params.value,
                  panelSchema.config?.unit,
                  panelSchema.config?.unit_custom,
                  panelSchema.config?.decimals,
                ),
              );
            return params.value.toString();
          },
        };
        options.xAxis[0].axisLabel = {};
        options.xAxis[0].axisTick = {};
        options.xAxis[0].nameGap = 20;

        // get the unique value of the first xAxis's key
        options.xAxis[0].data = Array.from(
          new Set(getAxisDataFromKey(xAxisKeys[0])),
        );
        // options.xAxis[0].data = Array.from(new Set(options.xAxis[0].data));

        // stacked with xAxis's second value
        // allow 2 xAxis and 1 yAxis value for stack chart
        // get second x axis key
        const key1 = breakDownKeys[0];
        // get the unique value of the second xAxis's key
        const stackedXAxisUniqueValue = [
          ...new Set(missingValueData.map((obj: any) => obj[key1])),
        ].filter((it) => it);

        options.series = yAxisKeys
          .map((yAxis: any) => {
            const yAxisName = panelSchema?.queries[0]?.fields?.y.find(
              (it: any) => it.alias == yAxis,
            ).label;
            return stackedXAxisUniqueValue?.map((key: any) => {
              // queryData who has the xaxis[1] key as well from xAxisUniqueValue.
              const data = missingValueData.filter(
                (it: any) => it[key1] == key,
              );
              const seriesObj = {
                //only append if yaxiskeys length is more than 1
                name:
                  yAxisKeys.length == 1 ? key : key + " (" + yAxisName + ")",
                ...defaultSeriesProps,
                // markLine if exist
                markLine: {
                  silent: true,
                  animation: false,
                  data: getMarkLineData(panelSchema),
                },
                // config to connect null values
                connectNulls: panelSchema.config?.connect_nulls ?? false,
                data: options.xAxis[0].data.map(
                  (it: any) =>
                    data.find((it2: any) => it2[xAxisKeys[0]] == it)?.[yAxis] ??
                    null,
                ),
                large: true,
              };
              return seriesObj;
            });
          })
          .flat();
      } else if (panelSchema.type == "line" || panelSchema.type == "area") {
        //if x and y length is not 2 and 1 respectively then do following
        options.series = yAxisKeys?.map((key: any) => {
          const seriesObj = {
            name: panelSchema?.queries[0]?.fields?.y.find(
              (it: any) => it.alias == key,
            )?.label,
            // color:
            //   panelSchema.queries[0]?.fields?.y.find(
            //     (it: any) => it.alias == key,
            //   )?.color || "#5960b2",
            opacity: 0.8,
            ...defaultSeriesProps,
            // markLine if exist
            markLine: {
              silent: true,
              animation: false,
              data: getMarkLineData(panelSchema),
            },
            // config to connect null values
            connectNulls: panelSchema.config?.connect_nulls ?? false,
            data: getAxisDataFromKey(key),
          };
          return seriesObj;
        });
        // scatter chart with single x and y axis(single or multiple)
      } else {
        options.tooltip.formatter = function (name: any) {
          // show tooltip for hovered panel only for other we only need axis so just return empty string
          if (
            hoveredSeriesState?.value &&
            panelSchema.id &&
            hoveredSeriesState?.value?.panelId != panelSchema.id
          )
            return "";
          if (name.length == 0) return "";

          // sort tooltip array based on value
          name.sort((a: any, b: any) => {
            return (b.value ?? 0) - (a.value ?? 0);
          });

          // if hovered series name is not null then move it to first position
          if (hoveredSeriesState?.value?.hoveredSeriesName) {
            // get the current series index from name
            const currentSeriesIndex = name.findIndex(
              (it: any) =>
                it.seriesName == hoveredSeriesState?.value?.hoveredSeriesName,
            );

            // if hovered series index is not -1 then take it to very first position
            if (currentSeriesIndex != -1) {
              // shift all series to next position and place current series at first position
              const temp = name[currentSeriesIndex];
              for (let i = currentSeriesIndex; i > 0; i--) {
                name[i] = name[i - 1];
              }
              name[0] = temp;
            }
          }

          const hoverText: string[] = [];
          name.forEach((it: any) => {
            if (it.data != null) {
              // check if the series is the current series being hovered
              // if have than bold it
              if (
                it?.seriesName == hoveredSeriesState?.value?.hoveredSeriesName
              )
                hoverText.push(
                  `<strong>${it.marker} ${it.seriesName} : ${formatUnitValue(
                    getUnitValue(
                      it.data,
                      panelSchema.config?.unit,
                      panelSchema.config?.unit_custom,
                      panelSchema.config?.decimals,
                    ),
                  )} </strong>`,
                );
              // else normal text
              else
                hoverText.push(
                  `${it.marker} ${it.seriesName} : ${formatUnitValue(
                    getUnitValue(
                      it.data,
                      panelSchema.config?.unit,
                      panelSchema.config?.unit_custom,
                      panelSchema.config?.decimals,
                    ),
                  )}`,
                );
            }
          });
          return `${name[0].name} <br/> ${hoverText.join("<br/>")}`;
        };
        options.series = yAxisKeys?.map((key: any) => {
          const seriesObj = {
            name: panelSchema?.queries[0]?.fields?.y.find(
              (it: any) => it.alias == key,
            )?.label,
            // color:
            //   panelSchema.queries[0]?.fields?.y.find(
            //     (it: any) => it.alias == key,
            //   )?.color || "#5960b2",
            opacity: 0.8,
            ...defaultSeriesProps,
            // markLine if exist
            markLine: {
              silent: true,
              animation: false,
              data: getMarkLineData(panelSchema),
            },
            // config to connect null values
            connectNulls: panelSchema.config?.connect_nulls ?? false,
            data: getAxisDataFromKey(key),
          };
          return seriesObj;
        });
      }
      break;
    }
    case "bar": {
      options.series = yAxisKeys?.map((key: any) => {
        const seriesObj = {
          name: panelSchema?.queries[0]?.fields?.y.find(
            (it: any) => it.alias == key,
          )?.label,
          // color:
          //   panelSchema.queries[0]?.fields?.y.find((it: any) => it.alias == key)
          //     ?.color || "#5960b2",
          opacity: 0.8,
          ...defaultSeriesProps,
          // markLine if exist
          markLine: {
            silent: true,
            animation: false,
            data: getMarkLineData(panelSchema),
          },
          data: getAxisDataFromKey(key),
          barMinHeight: 1,
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
            (it: any) => it.alias == key,
          )?.label,
          // color:
          //   panelSchema.queries[0]?.fields?.y.find((it: any) => it.alias == key)
          //     ?.color || "#5960b2",
          opacity: 0.8,
          ...defaultSeriesProps,
          // markLine if exist
          markLine: {
            silent: true,
            animation: false,
            data: getMarkLineData(panelSchema),
          },
          data: getAxisDataFromKey(key),
          barMinHeight: 1,
        };
        return seriesObj;
      });
      //swap x and y axis
      const temp = options.xAxis;
      options.xAxis = options.yAxis;
      options.yAxis = temp;

      options.yAxis.forEach((it: any) => {
        it.nameGap = calculateWidthText(
          xAxisKeys.reduce(
            (str: any, it: any) => str + largestLabel(getAxisDataFromKey(it)),
            "",
          ),
        );
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
          color: store.state.theme === "dark" ? "#fff" : "#000",
          fontSize: 12,
        },
        backgroundColor:
          store.state.theme === "dark"
            ? "rgba(0,0,0,1)"
            : "rgba(255,255,255,1)",
        formatter: function (name: any) {
          // show tooltip for hovered panel only for other we only need axis so just return empty string
          if (
            hoveredSeriesState?.value &&
            panelSchema.id &&
            hoveredSeriesState?.value?.panelId != panelSchema.id
          )
            return "";
          return `${name.marker} ${name.name} : <b>${formatUnitValue(
            getUnitValue(
              name.value,
              panelSchema.config?.unit,
              panelSchema.config?.unit_custom,
              panelSchema.config?.decimals,
            ),
          )}</b>`;
        },
      };
      //generate trace based on the y axis keys
      options.series = yAxisKeys?.map((key: any) => {
        const seriesObj = {
          ...defaultSeriesProps,
          data: getAxisDataFromKey(key).map((it: any, i: number) => {
            return { value: it, name: options?.xAxis[0]?.data[i] };
          }),
          label: {
            show: true,
            formatter: "{d}%", // {b} represents name, {c} represents value {d} represents percent
            position: "inside", // You can adjust the position of the labels
            fontSize: 10,
          },
          percentPrecision: panelSchema.config?.decimals ?? 2,
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
          color: store.state.theme === "dark" ? "#fff" : "#000",
          fontSize: 12,
        },
        backgroundColor:
          store.state.theme === "dark"
            ? "rgba(0,0,0,1)"
            : "rgba(255,255,255,1)",
        formatter: function (name: any) {
          // show tooltip for hovered panel only for other we only need axis so just return empty string
          if (
            hoveredSeriesState?.value &&
            panelSchema.id &&
            hoveredSeriesState?.value?.panelId != panelSchema.id
          )
            return "";
          return `${name.marker} ${name.name} : <b>${formatUnitValue(
            getUnitValue(
              name.value,
              panelSchema.config?.unit,
              panelSchema.config?.unit_custom,
              panelSchema.config?.decimals,
            ),
          )}<b/>`;
        },
      };
      //generate trace based on the y axis keys
      options.series = yAxisKeys?.map((key: any) => {
        const seriesObj = {
          ...defaultSeriesProps,
          data: getAxisDataFromKey(key).map((it: any, i: number) => {
            return { value: it, name: options?.xAxis[0]?.data[i] };
          }),
          label: {
            show: true,
            formatter: "{d}%", // {b} represents name, {c} represents value {d} represents percent
            position: "inside", // You can adjust the position of the labels
            fontSize: 10,
          },
          percentPrecision: panelSchema.config?.decimals ?? 2,
        };
        return seriesObj;
      });

      options.xAxis = [];
      options.yAxis = [];
      break;
    }
    case "stacked": {
      options.xAxis[0].data = Array.from(
        new Set(getAxisDataFromKey(xAxisKeys[0])),
      );
      options.xAxis = options.xAxis.slice(0, 1);
      options.tooltip.axisPointer.label = {
        show: true,
        label: {
          fontsize: 12,
          precision: panelSchema.config?.decimals,
        },
        formatter: function (params: any) {
          if (params.axisDimension == "y")
            return formatUnitValue(
              getUnitValue(
                params.value,
                panelSchema.config?.unit,
                panelSchema.config?.unit_custom,
                panelSchema.config?.decimals,
              ),
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
      const key1 = breakDownKeys[0];
      // get the unique value of the second xAxis's key
      const stackedXAxisUniqueValue = [
        ...new Set(missingValueData.map((obj: any) => obj[key1])),
      ].filter((it) => it);

      options.series = stackedXAxisUniqueValue?.map((key: any) => {
        // queryData who has the xaxis[1] key as well from xAxisUniqueValue.
        const data = missingValueData.filter((it: any) => it[key1] == key);
        const seriesObj = {
          name: key,
          ...defaultSeriesProps,
          // markLine if exist
          markLine: {
            silent: true,
            animation: false,
            data: getMarkLineData(panelSchema),
          },
          data: options.xAxis[0].data.map(
            (it: any) =>
              data.find((it2: any) => it2[xAxisKeys[0]] == it)?.[
                yAxisKeys[0]
              ] ?? null,
          ),
          barMinHeight: 1,
        };
        return seriesObj;
      });
      break;
    }
    case "heatmap": {
      // get first x axis key
      const key0 = xAxisKeys[0];
      // get the unique value of the first xAxis's key
      let xAxisZerothPositionUniqueValue = [
        ...new Set(searchQueryData[0].map((obj: any) => obj[key0])),
      ].filter((it) => it);

      // get second x axis key
      const key1 = yAxisKeys[0];
      // get the unique value of the second xAxis's key
      const xAxisFirstPositionUniqueValue = [
        ...new Set(searchQueryData[0].map((obj: any) => obj[key1])),
      ].filter((it) => it);

      const yAxisKey0 = zAxisKeys[0];
      const zValues: any = xAxisFirstPositionUniqueValue.map((first: any) => {
        // queryData who has the xaxis[1] key as well from xAxisUniqueValue.
        const data = searchQueryData[0].filter((it: any) => it[key1] == first);

        return xAxisZerothPositionUniqueValue.map((zero: any) => {
          return data.find((it: any) => it[key0] == zero)?.[yAxisKey0] || "-";
        });
      });

      (options.visualMap = {
        min: 0,
        max: zValues.reduce(
          (a: any, b: any) =>
            Math.max(
              a,
              b.reduce((c: any, d: any) => Math.max(c, +d || 0), 0),
            ),
          0,
        ),
        calculable: true,
        orient: "horizontal",
        left: "center",
      }),
        (options.series = [
          {
            ...defaultSeriesProps,
            name: panelSchema?.queries[0]?.fields?.y[0].label,
            data: zValues
              .map((it: any, index: any) => {
                return xAxisZerothPositionUniqueValue.map(
                  (i: any, j: number) => {
                    return [j, index, it[j]];
                  },
                );
              })
              .flat(),
            label: {
              show: true,
              fontSize: 12,
              formatter: (params: any) => {
                return (
                  formatUnitValue(
                    getUnitValue(
                      params.value[2],
                      panelSchema.config?.unit,
                      panelSchema.config?.unit_custom,
                      panelSchema.config?.decimals,
                    ),
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
          color: store.state.theme === "dark" ? "#fff" : "#000",
          fontSize: 12,
        },
        backgroundColor:
          store.state.theme === "dark"
            ? "rgba(0,0,0,1)"
            : "rgba(255,255,255,1)",
        formatter: (params: any) => {
          // show tooltip for hovered panel only for other we only need axis so just return empty string
          if (
            hoveredSeriesState?.value &&
            panelSchema.id &&
            hoveredSeriesState?.value?.panelId != panelSchema.id
          )
            return "";
          // we have value[1] which return yaxis index
          // it is used to get y axis data
          return `${
            options?.yAxis?.data[params?.value[1]] || params?.seriesName
          } <br/> ${params?.marker} ${params?.name} : ${
            formatUnitValue(
              getUnitValue(
                params?.value[2],
                panelSchema?.config?.unit,
                panelSchema?.config?.unit_custom,
                panelSchema?.config?.decimals,
              ),
            ) || params.value[2]
          }`;
        },
      }),
        (options.tooltip.axisPointer = {
          type: "cross",
          label: {
            fontsize: 12,
            precision: panelSchema.config?.decimals,
          },
        });
      // if auto sql
      if (panelSchema?.queries[0]?.customQuery == false) {
        // check if x axis has histogram or not
        // for heatmap we only have one field in x axis event we have used find fn

        const field = panelSchema.queries[0].fields?.x.find(
          (it: any) =>
            it.aggregationFunction == "histogram" &&
            it.column == store.state.zoConfig.timestamp_column,
        );
        // if histogram
        if (field) {
          // convert time string to selected timezone
          xAxisZerothPositionUniqueValue = xAxisZerothPositionUniqueValue.map(
            (it: any) => {
              return formatDate(toZonedTime(it + "Z", store.state.timezone));
            },
          );
        }
        // else custom sql
      } else {
        // sampling data to know whether data is timeseries or not
        const sample = xAxisZerothPositionUniqueValue.slice(
          0,
          Math.min(20, xAxisZerothPositionUniqueValue.length),
        );
        // if timeseries
        if (isTimeSeries(sample)) {
          // convert time string to selected timezone
          xAxisZerothPositionUniqueValue = xAxisZerothPositionUniqueValue.map(
            (it: any) => {
              return formatDate(toZonedTime(it + "Z", store.state.timezone));
            },
          );
        }
      }

      options.grid.bottom = 60;
      (options.xAxis = [
        {
          type: "category",
          data: xAxisZerothPositionUniqueValue,
          splitArea: {
            show: true,
          },
        },
      ]),
        [
          (options.yAxis = {
            type: "category",
            data: xAxisFirstPositionUniqueValue,
            splitArea: {
              show: true,
            },
          }),
        ];
      options.legend.show = false;
      break;
    }
    case "h-stacked": {
      options.xAxis[0].data = Array.from(
        new Set(getAxisDataFromKey(xAxisKeys[0])),
      );
      options.xAxis = options.xAxis.slice(0, 1);

      // stacked with xAxis's second value
      // allow 2 xAxis and 1 yAxis value for stack chart
      // get second x axis key
      const key1 = breakDownKeys[0];
      // get the unique value of the second xAxis's key
      const stackedXAxisUniqueValue = [
        ...new Set(processedData.map((obj: any) => obj[key1])),
      ].filter((it) => it);

      options.series = stackedXAxisUniqueValue?.map((key: any) => {
        // queryData who has the xaxis[1] key as well from xAxisUniqueValue.
        const data = processedData.filter((it: any) => it[key1] == key);
        const seriesObj = {
          name: key,
          ...defaultSeriesProps,
          // markLine if exist
          markLine: {
            silent: true,
            animation: false,
            data: getMarkLineData(panelSchema),
          },
          data: options.xAxis[0].data.map(
            (it: any) =>
              data.find((it2: any) => it2[xAxisKeys[0]] == it)?.[
                yAxisKeys[0]
              ] ?? null,
          ),
          barMinHeight: 1,
        };
        return seriesObj;
      });

      const temp = options.xAxis;
      options.xAxis = options.yAxis;
      options.yAxis = temp;
      options.yAxis.map((it: any) => {
        it.nameGap = calculateWidthText(largestLabel(it.data)) + 20;
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
        panelSchema.config?.unit_custom,
        panelSchema.config?.decimals,
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
          ...defaultSeriesProps,
          renderItem: function (params: any) {
            return {
              type: "text",
              style: {
                text: formatUnitValue(unitValue),
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
    case "gauge": {
      const key1 = yAxisKeys[0];
      const yAxisValue = getAxisDataFromKey(key1);
      // used for gague name
      const xAxisValue = getAxisDataFromKey(xAxisKeys[0]);

      // create grid array based on chart panel width, height and total no. of gauge
      const gridDataForGauge = calculateGridPositions(
        chartPanelRef.value.offsetWidth,
        chartPanelRef.value.offsetHeight,
        yAxisValue.length,
      );

      options.dataset = { source: [[]] };
      options.tooltip = {
        show: true,
        trigger: "item",
        textStyle: {
          color: store.state.theme === "dark" ? "#fff" : "#000",
          fontSize: 12,
        },
        valueFormatter: (value: any) => {
          // unit conversion
          return formatUnitValue(
            getUnitValue(
              value,
              panelSchema.config?.unit,
              panelSchema.config?.unit_custom,
              panelSchema.config?.decimals,
            ),
          );
        },
        enterable: true,
        backgroundColor:
          store.state.theme === "dark"
            ? "rgba(0,0,0,1)"
            : "rgba(255,255,255,1)",
        extraCssText: "max-height: 200px; overflow: auto; max-width: 500px",
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
      // for each gague we have separate grid
      options.grid = gridDataForGauge.gridArray;

      options.series = yAxisValue.map((it: any, index: any) => {
        return {
          ...defaultSeriesProps,
          min: panelSchema?.queries[0]?.config?.min || 0,
          max: panelSchema?.queries[0]?.config?.max || 100,

          //which grid will be used
          gridIndex: index,
          // radius, progress and axisline width will be calculated based on grid width and height
          radius: `${
            Math.min(gridDataForGauge.gridWidth, gridDataForGauge.gridHeight) /
              2 -
            5
          }px`,
          progress: {
            show: true,
            width: `${
              Math.min(
                gridDataForGauge.gridWidth,
                gridDataForGauge.gridHeight,
              ) / 6
            }`,
          },
          axisLine: {
            lineStyle: {
              width: `${
                Math.min(
                  gridDataForGauge.gridWidth,
                  gridDataForGauge.gridHeight,
                ) / 6
              }`,
            },
          },
          title: {
            fontSize: 10,
            offsetCenter: [0, "70%"],
            // width: upto chart width
            width: `${gridDataForGauge.gridWidth}`,
            overflow: "truncate",
          },

          // center of gauge
          // x: left + width / 2,
          // y: top + height / 2,
          center: [
            `${
              parseFloat(options.grid[index].left) +
              parseFloat(options.grid[index].width) / 2
            }%`,
            `${
              parseFloat(options.grid[index].top) +
              parseFloat(options.grid[index].height) / 2
            }%`,
          ],

          data: [
            {
              // gauge name may have or may not have
              name: xAxisValue[index] ?? "",
              value: it,
              detail: {
                formatter: function (value: any) {
                  const unitValue = getUnitValue(
                    value,
                    panelSchema.config?.unit,
                    panelSchema.config?.unit_custom,
                    panelSchema.config?.decimals,
                  );
                  return unitValue.value + unitValue.unit;
                },
              },
            },
          ],
          detail: {
            valueAnimation: true,
            offsetCenter: [0, 0],
            fontSize: 12,
          },
        };
      });
      break;
    }
    default: {
      break;
    }
  }

  // auto SQL: if x axis has time series
  if (
    panelSchema.type != "h-bar" &&
    panelSchema.type != "h-stacked" &&
    panelSchema.type != "heatmap" &&
    panelSchema.type != "metric" &&
    panelSchema.type != "pie" &&
    panelSchema.type != "donut" &&
    panelSchema?.queries[0]?.customQuery == false &&
    Array.isArray(options.xAxis) &&
    options.xAxis.length > 0 &&
    options.xAxis[0].data.length > 0
  ) {
    // auto SQL: if x axis has time series(aggregation function is histogram)
    const field = panelSchema.queries[0].fields?.x.find(
      (it: any) =>
        it.aggregationFunction == "histogram" &&
        it.column == store.state.zoConfig.timestamp_column,
    );

    const timestampField = panelSchema.queries[0].fields?.x.find(
      (it: any) =>
        !it.aggregationFunction &&
        it.column == store.state.zoConfig.timestamp_column,
    );

    //if x axis has time series
    if (field || timestampField) {
      // set timeseries flag as a true
      isTimeSeriesFlag = true;

      // if timezone is UTC then simply return x axis value which will be in UTC (note that need to remove Z from timezone string)
      // else check if xaxis value is integer(ie time will be in milliseconds)
      // if yes then return to convert into other timezone
      // if no then create new datetime object and get in milliseconds using getTime method
      const timeStringCache: any = {};
      options?.series?.forEach((seriesObj: any) => {
        // if value field is not present in the data than use null
        if (field) {
          seriesObj.data = seriesObj?.data?.map((it: any, index: any) => {
            const xKey = options.xAxis[0].data[index] + "Z";
            let x;
            if (timeStringCache[xKey]) {
              x = timeStringCache[xKey];
            } else {
              // need to consider time range gap
              x = toZonedTime(
                new Date(options.xAxis[0].data[index] + "Z").getTime() +
                  metadata?.queries[0]?.timeRangeGap ?? 0,
                store.state.timezone,
              );
              timeStringCache[xKey] = x;
            }
            return [x, it ?? null];
          });
        } else if (timestampField) {
          seriesObj.data = seriesObj?.data?.map((it: any, index: any) => {
            const xKey = options.xAxis[0].data[index].toString();
            let x;
            if (timeStringCache[xKey]) {
              x = timeStringCache[xKey];
            } else {
              // need to consider time range gap
              x = toZonedTime(
                (new Date(options.xAxis[0].data[index]).getTime() +
                  metadata?.queries[0]?.timeRangeGap ?? 0) / 1000,
                store.state.timezone,
              );
              timeStringCache[xKey] = x;
            }
            return [x, it ?? null];
          });
        }
      });

      options.xAxis[0].type = "time";
      options.xAxis[0].data = [];

      options.tooltip.formatter = function (name: any) {
        // show tooltip for hovered panel only for other we only need axis so just return empty string
        if (
          hoveredSeriesState?.value &&
          panelSchema.id &&
          hoveredSeriesState?.value?.panelId != panelSchema.id
        )
          return "";
        if (name.length == 0) return "";

        const date = new Date(name[0].data[0]);

        // sort tooltip array based on value
        name.sort((a: any, b: any) => {
          return (b.value[1] || 0) - (a.value[1] || 0);
        });

        // if hovered series name is not null then move it to first position
        if (hoveredSeriesState?.value?.hoveredSeriesName) {
          // get the current series index from name
          const currentSeriesIndex = name.findIndex(
            (it: any) =>
              it.seriesName == hoveredSeriesState?.value?.hoveredSeriesName,
          );

          // if hovered series index is not -1 then take it to very first position
          if (currentSeriesIndex != -1) {
            // shift all series to next position and place current series at first position
            const temp = name[currentSeriesIndex];
            for (let i = currentSeriesIndex; i > 0; i--) {
              name[i] = name[i - 1];
            }
            name[0] = temp;
          }
        }

        const hoverText: string[] = [];
        name.forEach((it: any) => {
          if (it.data[1] != null) {
            // check if the series is the current series being hovered
            // if have than bold it
            if (it?.seriesName == hoveredSeriesState?.value?.hoveredSeriesName)
              hoverText.push(
                `<strong>${it.marker} ${it.seriesName} : ${formatUnitValue(
                  getUnitValue(
                    it.data[1],
                    panelSchema.config?.unit,
                    panelSchema.config?.unit_custom,
                    panelSchema.config?.decimals,
                  ),
                )} </strong>`,
              );
            // else normal text
            else
              hoverText.push(
                `${it.marker} ${it.seriesName} : ${formatUnitValue(
                  getUnitValue(
                    it.data[1],
                    panelSchema.config?.unit,
                    panelSchema.config?.unit_custom,
                    panelSchema.config?.decimals,
                  ),
                )}`,
              );
          }
        });

        return `${formatDate(date)} <br/> ${hoverText.join("<br/>")}`;
      };

      options.tooltip.axisPointer = {
        type: "cross",
        label: {
          fontsize: 12,
          precision: panelSchema.config?.decimals,
          formatter: function (params: any) {
            if (params.axisDimension == "y")
              return formatUnitValue(
                getUnitValue(
                  params.value,
                  panelSchema.config?.unit,
                  panelSchema.config?.unit_custom,
                  panelSchema.config?.decimals,
                ),
              );
            return Number.isInteger(params.value)
              ? formatDate(new Date(params.value))
              : params.value;
          },
        },
        formatter: function (params: any) {
          const date = new Date(params[0].value[0]);
          return formatDate(date).toString();
        },
      };
    }
  }

  //custom SQL: check if it is timeseries or not
  if (
    panelSchema.type != "h-bar" &&
    panelSchema.type != "h-stacked" &&
    panelSchema.type != "heatmap" &&
    panelSchema.type != "metric" &&
    panelSchema.type != "pie" &&
    panelSchema.type != "donut" &&
    panelSchema?.queries[0]?.customQuery == true &&
    Array.isArray(options.xAxis) &&
    options.xAxis.length > 0 &&
    options.xAxis[0].data.length > 0
  ) {
    const sample = options.xAxis[0].data.slice(
      0,
      Math.min(20, options.xAxis[0].data.length),
    );

    const isTimeSeriesData = isTimeSeries(sample);
    const isTimeStampData = isTimeStamp(sample);

    if (isTimeSeriesData || isTimeStampData) {
      // set timeseries flag as a true
      isTimeSeriesFlag = true;

      options?.series?.forEach((seriesObj: any) => {
        // if value field is not present in the data than use null
        if (isTimeSeriesData) {
          seriesObj.data = seriesObj?.data?.map((it: any, index: any) => [
            // need to consider time range gap
            toZonedTime(
              new Date(options.xAxis[0].data[index] + "Z").getTime() +
                metadata?.queries[0]?.timeRangeGap ?? 0,
              store.state.timezone,
            ),
            it ?? null,
          ]);
        } else if (isTimeStampData) {
          seriesObj.data = seriesObj?.data?.map((it: any, index: any) => [
            // need to consider time range gap
            toZonedTime(
              (new Date(options.xAxis[0].data[index]).getTime() +
                metadata?.queries[0]?.timeRangeGap ?? 0) / 1000,
              store.state.timezone,
            ),
            it ?? null,
          ]);
        }
      });
      options.xAxis[0].type = "time";
      options.xAxis[0].data = [];
      options.tooltip.formatter = function (name: any) {
        // show tooltip for hovered panel only for other we only need axis so just return empty string
        if (
          hoveredSeriesState?.value &&
          panelSchema.id &&
          hoveredSeriesState?.value?.panelId != panelSchema.id
        )
          return "";
        if (name.length == 0) return "";

        const date = new Date(name[0].data[0]);

        // sort tooltip array based on value
        name.sort((a: any, b: any) => {
          return (b.value[1] || 0) - (a.value[1] || 0);
        });

        // if hovered series name is not null then move it to first position
        if (hoveredSeriesState?.value?.hoveredSeriesName) {
          // get the current series index from name
          const currentSeriesIndex = name.findIndex(
            (it: any) =>
              it.seriesName == hoveredSeriesState?.value?.hoveredSeriesName,
          );

          // if hovered series index is not -1 then take it to very first position
          if (currentSeriesIndex != -1) {
            // shift all series to next position and place current series at first position
            const temp = name[currentSeriesIndex];
            for (let i = currentSeriesIndex; i > 0; i--) {
              name[i] = name[i - 1];
            }
            name[0] = temp;
          }
        }

        const hoverText: string[] = [];
        name.forEach((it: any) => {
          if (it.data[1] != null) {
            // check if the series is the current series being hovered
            // if have than bold it
            if (it?.seriesName == hoveredSeriesState?.value?.hoveredSeriesName)
              hoverText.push(
                `<strong>${it.marker} ${it.seriesName} : ${formatUnitValue(
                  getUnitValue(
                    it.data[1],
                    panelSchema.config?.unit,
                    panelSchema.config?.unit_custom,
                    panelSchema.config?.decimals,
                  ),
                )} </strong>`,
              );
            // else normal text
            else
              hoverText.push(
                `${it.marker} ${it.seriesName} : ${formatUnitValue(
                  getUnitValue(
                    it.data[1],
                    panelSchema.config?.unit,
                    panelSchema.config?.unit_custom,
                    panelSchema.config?.decimals,
                  ),
                )}`,
              );
          }
        });

        return `${formatDate(date)} <br/> ${hoverText.join("<br/>")}`;
      };
      options.tooltip.axisPointer = {
        type: "cross",
        label: {
          fontsize: 12,
          precision: panelSchema.config?.decimals,
          formatter: function (params: any) {
            if (params.axisDimension == "y")
              return formatUnitValue(
                getUnitValue(
                  params.value,
                  panelSchema.config?.unit,
                  panelSchema.config?.unit_custom,
                  panelSchema.config?.decimals,
                ),
              );
            return formatDate(new Date(params?.value)).toString();
          },
        },
        formatter: function (params: any) {
          const date = new Date(params[0].value[0]);
          return formatDate(date).toString();
        },
      };
    }
  }

  // stacked chart sort by y axis
  // ignore if time series chart
  if (
    ["stacked", "h-stacked", "area-stacked"].includes(panelSchema?.type) &&
    isTimeSeriesFlag == false
  ) {
    // get x axis object
    // for h-stacked, categorical axis is y axis
    // for stacked and area-stacked, categorical axis is x axis
    const xAxisObj =
      panelSchema.type == "h-stacked" ? options.yAxis : options.xAxis;

    // check if order by uses y axis field
    // will return null if not exist
    // will return ASC or DESC if exist
    const isYAxisExistInOrderBy = await isGivenFieldInOrderBy(
      panelSchema?.queries[0]?.query ?? "",
      yAxisKeys[0],
    );
    if (isYAxisExistInOrderBy) {
      // Calculate the total for each series and combine it with the corresponding x-axis label
      const totals = new Map();
      for (let i = 0; i < xAxisObj[0]?.data?.length; i++) {
        const total = options?.series?.reduce(
          (sum: number, currentSeries: any) =>
            sum + currentSeries?.data[i] ?? 0,
          0,
        );
        totals.set(i, { label: xAxisObj[0]?.data[i], total });
      }

      // Sort the indices by total in the specified order
      // ASC for ascending, DESC for descending
      const sortedIndices = Array.from(totals.keys()).sort((a, b) => {
        const diff = totals.get(a).total - totals.get(b).total;
        return isYAxisExistInOrderBy == "ASC" ? diff : -diff;
      });

      // Create new sorted arrays for the x-axis labels and series
      xAxisObj[0].data = sortedIndices.map((i) => totals.get(i).label);
      options.series = options?.series?.map((currentSeries: any) => {
        currentSeries.data = sortedIndices?.map((i) => currentSeries?.data[i]);
        return currentSeries;
      });
    }
  }

  //from this maxValue want to set the width of the chart based on max value is greater than 30% than give default legend width other wise based on max value get legend width
  //only check for vertical side only
  if (
    legendConfig.orient == "vertical" &&
    panelSchema.config?.show_legends &&
    panelSchema.type != "gauge" &&
    panelSchema.type != "metric"
  ) {
    let legendWidth;

    if (
      panelSchema.config.legend_width &&
      !isNaN(parseFloat(panelSchema.config.legend_width.value))
      // ["px", "%"].includes(panelSchema.config.legend_width.unit)
    ) {
      if (panelSchema.config.legend_width.unit === "%") {
        // If in percentage, calculate percentage of the chartPanelRef width
        const percentage = panelSchema.config.legend_width.value / 100;
        legendWidth = chartPanelRef.value?.offsetWidth * percentage;
      } else {
        // If in pixels, use the provided value
        legendWidth = panelSchema.config.legend_width.value;
      }
    } else {
      let maxValue: string;
      if (panelSchema.type === "pie" || panelSchema.type === "donut") {
        maxValue = options.series[0].data.reduce((max: any, it: any) => {
          return max.length < it?.name?.length ? it?.name : max;
        }, "");
      } else {
        maxValue = options.series.reduce((max: any, it: any) => {
          return max.length < it?.name?.length ? it?.name : max;
        }, "");
      }

      // If legend_width is not provided or has invalid format, calculate it based on other criteria
      legendWidth =
        Math.min(
          chartPanelRef.value?.offsetWidth / 3,
          calculateWidthText(maxValue) + 60,
        ) ?? 20;
    }

    options.grid.right = legendWidth;
    options.legend.textStyle.width = legendWidth - 55;
  }

  //check if is there any data else filter out axis or series data
  // for metric, gauge we does not have data field
  if (!["metric", "gauge"].includes(panelSchema.type)) {
    options.series = options.series.filter((it: any) => it.data?.length);
    if (panelSchema.type == "h-bar" || panelSchema.type == "h-stacked") {
      options.xAxis = options.series.length ? options.xAxis : {};
    } else if (!["pie", "donut"].includes(panelSchema.type)) {
      options.yAxis = options.series.length ? options.yAxis : {};
    }
  }

  // allowed to zoom, only if timeseries
  options.toolbox.show = options.toolbox.show && isTimeSeriesFlag;

  return {
    options,
    extras: { panelId: panelSchema?.id, isTimeSeries: isTimeSeriesFlag },
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
        lineStyle: { width: 1.5 },
      };
    case "line":
      return {
        type: "line",
        emphasis: { focus: "series" },
        smooth: true,
        showSymbol: false,
        areaStyle: null,
        lineStyle: { width: 1.5 },
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
        lineStyle: { width: 1.5 },
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
        lineStyle: { width: 1.5 },
      };
    case "h-bar":
      return {
        type: "bar",
        emphasis: { focus: "series" },
        lineStyle: { width: 1.5 },
      };
    case "area":
      return {
        type: "line",
        smooth: true,
        emphasis: { focus: "series" },
        areaStyle: {},
        showSymbol: false,
        lineStyle: { width: 1.5 },
      };
    case "stacked":
      return {
        type: "bar",
        stack: "total",
        emphasis: {
          focus: "series",
        },
        lineStyle: { width: 1.5 },
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
        lineStyle: { width: 1.5 },
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
        showSymbol: false,
        lineStyle: { width: 1.5 },
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
        lineStyle: { width: 1.5 },
      };
    case "gauge":
      return {
        type: "gauge",
        startAngle: 205,
        endAngle: -25,
        progress: {
          show: true,
          width: 10,
        },
        pointer: {
          show: false,
        },
        axisLine: {
          lineStyle: {
            width: 10,
          },
        },
        axisTick: {
          show: false,
        },
        splitLine: {
          show: false,
        },
        axisLabel: {
          show: false,
        },
      };
    default:
      return {
        type: "bar",
      };
  }
};

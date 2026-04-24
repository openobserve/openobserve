// Copyright 2026 OpenObserve Inc.
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

import { toZonedTime } from "date-fns-tz";
import { formatUnitValue, getUnitValue } from "./convertDataIntoUnitValue";
import { calculateDynamicNameGap } from "./chartDimensionUtils";
import { formatDate, isTimeSeries, isTimeStamp } from "./dateTimeUtils";

/**
 * Handles auto SQL time series conversion.
 * Detects histogram / timestamp x-axis fields and converts series data and
 * chart options (xAxis, tooltip, axisPointer) to time-series format.
 *
 * @param options            - The mutable ECharts options object.
 * @param panelSchema        - The panel schema object.
 * @param store              - The Vuex store object.
 * @param metadata           - Query metadata (startTime, endTime, queries, timeRangeGap ΓÇª).
 * @param hoveredSeriesState - Ref tracking the currently-hovered series.
 * @returns {boolean}        - true if time-series mode was activated, false otherwise.
 */
export const applyAutoSQLTimeSeries = (
  options: any,
  panelSchema: any,
  store: any,
  metadata: any,
  hoveredSeriesState: any,
): boolean => {
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
        it.functionName == "histogram" &&
        it?.args?.[0]?.value?.field == store.state?.zoConfig?.timestamp_column,
    );

    const timestampField = panelSchema.queries[0].fields?.x.find(
      (it: any) =>
        !it.functionName &&
        it?.args?.[0]?.value?.field == store.state?.zoConfig?.timestamp_column,
    );

    //if x axis has time series
    if (field || timestampField) {
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
                  (metadata?.queries[0]?.timeRangeGap.seconds ?? 0),
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
                  (metadata?.queries[0]?.timeRangeGap.seconds ?? 0)) /
                  1000,
                store.state.timezone,
              );
              timeStringCache[xKey] = x;
            }
            return [x, it ?? null];
          });
        }
      });

      // Trellis has multiple x axis
      if (panelSchema.config.trellis?.layout) {
        options.xAxis.forEach((axis: any) => {
          axis.type = "time";
          // For time-based x-axis, reset axis label rotation and truncation
          if (axis.axisLabel) {
            axis.axisLabel.rotate = 0;
            axis.axisLabel.overflow = "none";
            axis.axisLabel.width = undefined;
          }
          // Recalculate nameGap with 0 rotation for time-based axis
          if (axis.name) {
            axis.nameGap = calculateDynamicNameGap(0, 120, 12, 25, 10);
          }
        });
      } else {
        options.xAxis[0].type = "time";
        // For time-based x-axis, reset axis label rotation and truncation
        if (options.xAxis[0].axisLabel) {
          options.xAxis[0].axisLabel.rotate = 0;
          options.xAxis[0].axisLabel.overflow = "none";
          options.xAxis[0].axisLabel.width = undefined;
        }
        // Recalculate nameGap with 0 rotation for time-based axis
        if (options.xAxis[0].name) {
          options.xAxis[0].nameGap = calculateDynamicNameGap(
            0,
            120,
            12,
            25,
            10,
          );
        }
      }

      options.xAxis[0].data = [];

      // Pin x-axis range to the user's full query range so anchors are unnecessary.
      const queryStartMs = parseInt(metadata?.queries[0]?.startTime?.toString() ?? "0") / 1000;
      const queryEndMs = parseInt(metadata?.queries[0]?.endTime?.toString() ?? "0") / 1000;
      const timeGap = metadata?.queries[0]?.timeRangeGap?.seconds ?? 0;
      if (queryStartMs > 0 && queryEndMs > 0) {
        options.xAxis[0].min = toZonedTime(queryStartMs + timeGap * 1000, store.state.timezone);
        options.xAxis[0].max = toZonedTime(queryEndMs + timeGap * 1000, store.state.timezone);
      }

      options.tooltip.formatter = function (name: any) {
        // show tooltip for hovered panel only for other we only need axis so just return empty string

        // if (
        //   showTrellisConfig(panelSchema.type) &&
        //   panelSchema.config.trellis?.layout &&
        //   breakDownKeys.length
        // )
        //   name = [name[0]];

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
          backgroundColor: store.state.theme === "dark" ? "#333" : "",
          formatter: function (params: any) {
            try {
              if (params?.axisDimension == "y")
                return formatUnitValue(
                  getUnitValue(
                    params?.value,
                    panelSchema.config?.unit,
                    panelSchema.config?.unit_custom,
                    panelSchema.config?.decimals,
                  ),
                );
              return Number.isInteger(params?.value)
                ? formatDate(new Date(params?.value))
                : params?.value;
            } catch (error) {
              return params?.value ?? "";
            }
          },
        },
        formatter: function (params: any) {
          try {
            const date = new Date(params?.[0]?.value?.[0]);
            return formatDate(date)?.toString() ?? "";
          } catch (error) {
            return "";
          }
        },
      };

      // set timeseries flag as a true
      return true;
    }
  }

  return false;
};

/**
 * Handles custom SQL time series conversion.
 * Detects whether the x-axis data is time-series or timestamp-based and
 * converts series data and chart options (xAxis, tooltip, axisPointer) to
 * time-series format.
 *
 * @param options            - The mutable ECharts options object.
 * @param panelSchema        - The panel schema object.
 * @param store              - The Vuex store object.
 * @param metadata           - Query metadata (startTime, endTime, queries, timeRangeGap ΓÇª).
 * @param hoveredSeriesState - Ref tracking the currently-hovered series.
 * @returns {boolean}        - true if time-series mode was activated, false otherwise.
 */
export const applyCustomSQLTimeSeries = (
  options: any,
  panelSchema: any,
  store: any,
  metadata: any,
  hoveredSeriesState: any,
): boolean => {
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

    const isTimeStampData = isTimeStamp(sample, null);

    if (isTimeSeriesData || isTimeStampData) {
      options?.series?.forEach((seriesObj: any) => {
        // if value field is not present in the data than use null
        if (isTimeSeriesData) {
          seriesObj.data = seriesObj?.data?.map((it: any, index: any) => [
            // need to consider time range gap
            toZonedTime(
              new Date(options.xAxis[0].data[index] + "Z").getTime() +
                (metadata?.queries[0]?.timeRangeGap.seconds ?? 0),
              store.state.timezone,
            ),
            it ?? null,
          ]);
        } else if (isTimeStampData) {
          seriesObj.data = seriesObj?.data?.map((it: any, index: any) => [
            // need to consider time range gap
            toZonedTime(
              (new Date(options.xAxis[0].data[index]).getTime() +
                (metadata?.queries[0]?.timeRangeGap.seconds ?? 0)) /
                1000,
              store.state.timezone,
            ),
            it ?? null,
          ]);
        }
      });

      // Trellis has multiple x axis
      if (panelSchema.config.trellis?.layout) {
        options.xAxis.forEach((axis: any) => {
          axis.type = "time";
          // For time-based x-axis, reset axis label rotation and truncation
          if (axis.axisLabel) {
            axis.axisLabel.rotate = 0;
            axis.axisLabel.overflow = "none";
            axis.axisLabel.width = undefined;
          }
          // Recalculate nameGap with 0 rotation for time-based axis
          if (axis.name) {
            axis.nameGap = calculateDynamicNameGap(0, 120, 12, 25, 10);
          }
        });
      } else {
        options.xAxis[0].type = "time";
        // For time-based x-axis, reset axis label rotation and truncation
        if (options.xAxis[0].axisLabel) {
          options.xAxis[0].axisLabel.rotate = 0;
          options.xAxis[0].axisLabel.overflow = "none";
          options.xAxis[0].axisLabel.width = undefined;
        }
        // Recalculate nameGap with 0 rotation for time-based axis
        if (options.xAxis[0].name) {
          options.xAxis[0].nameGap = calculateDynamicNameGap(
            0,
            120,
            12,
            25,
            10,
          );
        }
      }

      options.xAxis[0].data = [];

      // Pin x-axis range to the user's full query range so anchors are unnecessary.
      const queryStartMs = parseInt(metadata?.queries[0]?.startTime?.toString() ?? "0") / 1000;
      const queryEndMs = parseInt(metadata?.queries[0]?.endTime?.toString() ?? "0") / 1000;
      const timeGap = metadata?.queries[0]?.timeRangeGap?.seconds ?? 0;
      if (queryStartMs > 0 && queryEndMs > 0) {
        options.xAxis[0].min = toZonedTime(queryStartMs + timeGap * 1000, store.state.timezone);
        options.xAxis[0].max = toZonedTime(queryEndMs + timeGap * 1000, store.state.timezone);
      }

      options.tooltip.formatter = function (name: any) {
        try {
          // if (
          //   showTrellisConfig(panelSchema.type) &&
          //   panelSchema.config.trellis?.layout &&
          //   breakDownKeys.length
          // )
          //   name = [name[0]];

          // show tooltip for hovered panel only for other we only need axis so just return empty string
          if (
            hoveredSeriesState?.value &&
            panelSchema.id &&
            hoveredSeriesState?.value?.panelId != panelSchema.id
          )
            return "";
          if (name?.length == 0) return "";

          const date = new Date(name?.[0]?.data?.[0]);

          // sort tooltip array based on value
          name?.sort((a: any, b: any) => {
            return (b?.value?.[1] || 0) - (a?.value?.[1] || 0);
          });

          // if hovered series name is not null then move it to first position
          if (hoveredSeriesState?.value?.hoveredSeriesName) {
            // get the current series index from name
            const currentSeriesIndex = name?.findIndex(
              (it: any) =>
                it.seriesName == hoveredSeriesState?.value?.hoveredSeriesName,
            );

            // if hovered series index is not -1 then take it to very first position
            if (currentSeriesIndex != -1) {
              // shift all series to next position and place current series at first position
              const temp = name?.[currentSeriesIndex];
              for (let i = currentSeriesIndex; i > 0; i--) {
                name[i] = name?.[i - 1];
              }
              name[0] = temp;
            }
          }

          const hoverText: string[] = [];
          name?.forEach((it: any) => {
            if (it?.data?.[1] != null) {
              // check if the series is the current series being hovered
              // if have than bold it
              if (
                it?.seriesName == hoveredSeriesState?.value?.hoveredSeriesName
              )
                hoverText.push(
                  `<strong>${it?.marker} ${it?.seriesName} : ${formatUnitValue(
                    getUnitValue(
                      it?.data?.[1],
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
                      it?.data?.[1],
                      panelSchema.config?.unit,
                      panelSchema.config?.unit_custom,
                      panelSchema.config?.decimals,
                    ),
                  )}`,
                );
            }
          });

          return `${formatDate(date)} <br/> ${hoverText.join("<br/>")}`;
        } catch (error) {
          return "";
        }
      };
      options.tooltip.axisPointer = {
        type: "cross",
        label: {
          fontsize: 12,
          precision: panelSchema.config?.decimals,
          backgroundColor: store.state.theme === "dark" ? "#333" : "",
          formatter: function (params: any) {
            try {
              if (params?.axisDimension == "y")
                return formatUnitValue(
                  getUnitValue(
                    params?.value,
                    panelSchema.config?.unit,
                    panelSchema.config?.unit_custom,
                    panelSchema.config?.decimals,
                  ),
                );
              return formatDate(new Date(params?.value))?.toString() ?? "";
            } catch (error) {
              return params?.value ?? "";
            }
          },
        },
        formatter: function (params: any) {
          try {
            const date = new Date(params?.[0]?.value?.[0]);
            return formatDate(date)?.toString() ?? "";
          } catch (error) {
            return "";
          }
        },
      };

      // set timeseries flag as a true
      return true;
    }
  }

  return false;
};

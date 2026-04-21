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

import { getDataValue } from "../../aliasUtils";
import { getSeriesColor } from "../../colorPalette";
import { getAnnotationsData } from "@/utils/dashboard/getAnnotationsData";
import { type SeriesObject } from "@/ts/interfaces/dashboard";

export interface SeriesDeps {
  options: any;
  panelSchema: any;
  store: any;
  missingValueData: any[];
  xAxisKeys: string[];
  yAxisKeys: string[];
  breakDownKeys: string[];
  defaultSeriesProps: any;
  chartMin: any;
  chartMax: any;
  dataLookupMap: Map<string, any>;
  annotations: any;
  getMarkLineData: (arg0: any) => any[];
  getAxisDataFromKey: (arg0: string) => any[];
}

/**
 * Builds a lookup map ONCE for O(1) access during series generation.
 * Key: "breakdownValue||xAxisValue", Value: data row.
 * This prevents nested O(n┬▓) loops in getSeriesData.
 */
export function buildDataLookupMap(
  missingValueData: any[],
  breakDownKeys: string[],
  xAxisKeys: string[],
): Map<string, any> {
  const dataMap = new Map<string, any>();

  if (!breakDownKeys.length || !xAxisKeys.length) {
    return dataMap;
  }

  const breakdownKey = breakDownKeys[0];
  const xAxisKey = xAxisKeys[0];

  for (const item of missingValueData) {
    const breakdownValue = getDataValue(item, breakdownKey);
    const xValue = getDataValue(item, xAxisKey);
    const key = `${breakdownValue}||${xValue}`;

    // Only set if NOT already present (keeps FIRST occurrence, matching original .find() behavior)
    if (!dataMap.has(key)) {
      dataMap.set(key, item);
    }
  }

  return dataMap;
}

/**
 * Creates all series-building helper functions.
 * All functions close over `deps` so they behave identically to the original
 * closures defined inside `convertSQLData`.
 */
export function createSeriesBuilders(deps: SeriesDeps) {
  const {
    options,
    panelSchema,
    store,
    missingValueData,
    yAxisKeys,
    breakDownKeys,
    defaultSeriesProps,
    chartMin,
    chartMax,
    dataLookupMap,
    annotations,
    getMarkLineData,
    getAxisDataFromKey,
  } = deps;

  const { markLines, markAreas } = getAnnotationsData(
    annotations,
    store.state.timezone,
  );

  const getSeriesLabel = () => {
    return {
      show: panelSchema.config?.label_option?.position != null,
      position: panelSchema.config?.label_option?.position || "None",
      rotate: panelSchema.config?.label_option?.rotate || 0,
    };
  };

  const getSeriesMarkLine = () => {
    return {
      silent: true,
      animation: false,
      data: getMarkLineData(panelSchema),
      lineStyle: {
        color: "#8B5A2B",
        type: [6, 2],
        shadowColor: store.state.theme === "dark"
          ? "rgba(0, 0, 0, 0.8)"
          : "rgba(255, 255, 255, 0.8)",
        shadowBlur: 2,
        zlevel: 1,
      },
    };
  };

  const getAnnotationMarkLine = () => {
    return {
      itemStyle: {
        color: "rgba(108, 122, 125, 1)",
      },
      silent: false,
      animation: false,
      data: markLines,
      z: 10,
      zlevel: 1,
    };
    
  };

  const getSeriesMarkArea = () => {
    return {
      itemStyle: {
        color: "rgba(0, 191, 255, 0.15)",
      },
      data: markAreas,
    };
  };

  /**
   * Retrieves unique values for the second x-axis key in a stacked chart.
   * Assumes the first value in breakDownKeys corresponds to the second x-axis key.
   */
  function getUniqueStackedXAxisValues(breakDownKey: string): any[] {
    // Check if there's a second x-axis key in breakDownKeys
    if (!breakDownKey) return [];

    // Extract unique values for the second x-axis key
    // NOTE: while filter, we can't compare type as well because set will have string values
    const uniqueValues = [
      ...Array.from(
        new Set(
          missingValueData.map((obj: any) => getDataValue(obj, breakDownKey)),
        ),
      ),
    ].filter((value: any) => value != null || value != undefined);

    return uniqueValues;
  }

  const getSeriesData = (
    breakdownKey: string,
    yAxisKey: string,
    xAxisKey: string,
  ) => {
    if (!(breakdownKey !== null && yAxisKey !== null && xAxisKey !== null))
      return [];

    // Use the pre-built lookup map for O(1) access instead of O(n) filter + find
    // xAxisKey parameter is the breakdown value passed from getSeries()
    const seriesData = options.xAxis[0].data.map((xValue: any) => {
      const lookupKey = `${xAxisKey}||${xValue}`;
      const dataRow = dataLookupMap.get(lookupKey);
      return dataRow ? (getDataValue(dataRow, yAxisKey) ?? null) : null;
    });

    return seriesData;
  };

  const getSeriesObj = (
    yAxisName: string,
    seriesData: Array<number> = [],
    seriesConfig: Record<string, any>,
    seriesName: string,
  ): SeriesObject => {
    return {
      //only append if yaxiskeys length is more than 1
      name: yAxisName?.toString(),
      ...defaultSeriesProps,
      label: getSeriesLabel(),
      originalSeriesName: seriesName,
      // markLine if exist
      markLine: getSeriesMarkLine(),
      // markArea: getSeriesMarkArea(),
      // config to connect null values
      connectNulls: panelSchema.config?.connect_nulls ?? false,
      large: true,
      color:
        getSeriesColor(
          panelSchema.config.color,
          yAxisName,
          seriesData,
          chartMin,
          chartMax,
          store.state.theme,
          panelSchema?.config?.color?.colorBySeries,
        ) ?? null,
      data: seriesData,
      ...seriesConfig,
    };
  };

  const getYAxisLabel = (yAxisKey: string, xAXisKey: string = "") => {
    const label = panelSchema?.queries[0]?.fields?.y.find(
      (it: any) => it.alias == yAxisKey,
    )?.label;

    if (
      panelSchema.type == "area-stacked" ||
      ((panelSchema.type == "line" ||
        panelSchema.type == "area" ||
        panelSchema.type == "scatter" ||
        panelSchema.type == "bar" ||
        panelSchema.type == "h-bar" ||
        panelSchema.type == "stacked" ||
        panelSchema.type == "h-stacked") &&
        panelSchema.queries[0].fields.breakdown?.length)
    ) {
      // Display "(empty)" for empty breakdown values instead of falling
      // through to the y-axis label, which produces misleading legends
      const displayKey = xAXisKey === "" ? "(empty)" : xAXisKey;
      return yAxisKeys.length === 1
        ? displayKey
        : `${displayKey} (${label})`;
    }

    return label;
  };

  const getSeries = (seriesConfig: Record<string, any> = {}) => {
    let stackedXAxisUniqueValue: any[] = [];
    let breakdownKey = "";

    // Area-stacked, stacked, h-stacked and trellis needs breakdown field
    if (breakDownKeys?.length) {
      breakdownKey = breakDownKeys[0];
      // get the unique value of the second xAxis's key
      stackedXAxisUniqueValue = getUniqueStackedXAxisValues(breakdownKey);
    }

    return (
      yAxisKeys
        .map((yAxis: any, index: number) => {
          let yAxisName = getYAxisLabel(yAxis);

          if (breakDownKeys.length) {
            return stackedXAxisUniqueValue?.map((key: any) => {
              // queryData who has the xaxis[1] key as well from xAxisUniqueValue.
              yAxisName = getYAxisLabel(yAxis, key);

              const seriesData = getSeriesData(breakdownKey, yAxis, key);
              // Add stack property for stacked charts
              const updatedSeriesConfig = {
                ...seriesConfig,
                // Only add stack property for stacked or h-stacked chart types
                ...(["stacked", "h-stacked"].includes(panelSchema.type) && {
                  stack: `stack-${index}`,
                }),
                yAxisGroup: index,
              };
              // Can create different method to get series
              return getSeriesObj(
                yAxisName,
                seriesData,
                updatedSeriesConfig,
                key,
              );
            });
          } else {
            const seriesData = getAxisDataFromKey(yAxis);
            const updatedSeriesConfig = {
              ...seriesConfig,
              yAxisGroup: index,
            };
            return getSeriesObj(yAxisName, seriesData, updatedSeriesConfig, "");
          }
        })
        .flat() || []
    );
  };

  return {
    getSeries,
    getSeriesData,
    getSeriesObj,
    getYAxisLabel,
    getSeriesLabel,
    getSeriesMarkLine,
    getAnnotationMarkLine,
    getSeriesMarkArea,
    getUniqueStackedXAxisValues,
  };
}

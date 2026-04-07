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
import { formatUnitValue, getUnitValue } from "../../convertDataIntoUnitValue";
import { formatDate, isTimeSeries } from "../../dateTimeUtils";
import { getDataValue } from "../../aliasUtils";
import { type SQLContext } from "../shared/types";

/**
 * Applies chart-specific options for: heatmap
 *
 * Mutates `ctx.options` in place, exactly as the original switch case did.
 */
export function applyHeatmapChart(ctx: SQLContext): void {
  const {
    options,
    panelSchema,
    store,
    searchQueryData,
    xAxisKeys,
    yAxisKeys,
    zAxisKeys,
    hoveredSeriesState,
    defaultSeriesProps,
  } = ctx;

  // get first x axis key
  const key0 = xAxisKeys[0];
  // get the unique value of the first xAxis's key
  let xAxisZerothPositionUniqueValue = [
    ...new Set(searchQueryData[0].map((obj: any) => getDataValue(obj, key0))),
  ].filter((it) => it);

  // get second x axis key
  const key1 = yAxisKeys[0];
  // get the unique value of the second xAxis's key
  const xAxisFirstPositionUniqueValue = [
    ...new Set(searchQueryData[0].map((obj: any) => getDataValue(obj, key1))),
  ].filter((it) => it);

  const yAxisKey0 = zAxisKeys[0];
  // Build lookup map ONE TIME - O(n) instead of nested O(n┬▓)
  const heatmapLookupMap = new Map<string, any>();

  searchQueryData[0].forEach((row: any) => {
    const yAxisValue = getDataValue(row, key1);
    const xAxisValue = getDataValue(row, key0);
    const compositeKey = `${yAxisValue}||${xAxisValue}`;

    // Only set if NOT already present (keeps FIRST occurrence, matching original nested .find() behavior)
    if (!heatmapLookupMap.has(compositeKey)) {
      heatmapLookupMap.set(compositeKey, row);
    }
  });

  // Use map for instant O(1) lookups
  const zValues: any = xAxisFirstPositionUniqueValue.map((yAxisValue: any) => {
    return xAxisZerothPositionUniqueValue.map((xAxisValue: any) => {
      const compositeKey = `${yAxisValue}||${xAxisValue}`;
      const dataRow = heatmapLookupMap.get(compositeKey);
      return dataRow ? getDataValue(dataRow, yAxisKey0) || "-" : "-";
    });
  });

  ((options.visualMap = {
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
            return xAxisZerothPositionUniqueValue.map((i: any, j: number) => {
              return [j, index, it[j]];
            });
          })
          .flat(),
        label: {
          show: true,
          fontSize: 12,
          formatter: (params: any) => {
            try {
              return (
                formatUnitValue(
                  getUnitValue(
                    params?.value?.[2],
                    panelSchema.config?.unit,
                    panelSchema.config?.unit_custom,
                    panelSchema.config?.decimals,
                  ),
                ) || params?.value?.[2]
              );
            } catch (error) {
              return params?.value?.[2]?.toString() ?? "";
            }
          },
        },
      },
    ]));
  // option.yAxis.data=xAxisFirstPositionUniqueValue;
  ((options.tooltip = {
    position: "top",
    textStyle: {
      color: store.state.theme === "dark" ? "#fff" : "#000",
      fontSize: 12,
    },
    backgroundColor:
      store.state.theme === "dark" ? "rgba(0,0,0,1)" : "rgba(255,255,255,1)",
    formatter: (params: any) => {
      try {
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
              params?.value?.[2],
              panelSchema?.config?.unit,
              panelSchema?.config?.unit_custom,
              panelSchema?.config?.decimals,
            ),
          ) || params?.value?.[2]
        }`;
      } catch (error) {
        return "";
      }
    },
  }),
    (options.tooltip.axisPointer = {
      type: "cross",
      label: {
        fontsize: 12,
        precision: panelSchema.config?.decimals,
        backgroundColor: store.state.theme === "dark" ? "#333" : "",
      },
    }));
  // if auto sql
  if (panelSchema?.queries[0]?.customQuery == false) {
    // check if x axis has histogram or not
    // for heatmap we only have one field in x axis event we have used find fn

    const field = panelSchema.queries[0].fields?.x.find(
      (it: any) =>
        it.functionName == "histogram" &&
        it?.args?.[0]?.value?.field == store.state?.zoConfig?.timestamp_column,
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
  ((options.xAxis = [
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
    ]);
  options.legend.show = false;
}

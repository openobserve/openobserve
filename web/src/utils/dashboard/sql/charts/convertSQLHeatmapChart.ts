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
import {
  HEATMAP_SPLIT_AREA,
  HEATMAP_VISUAL_MAP_COLORS,
  heatmapCellItemStyle,
  heatmapLargeGridDefaults,
  heatmapValueLabel,
} from "@/utils/dashboard/heatmapDefaults";

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

  // Flattened ONCE: the series needs it as `data`, and the label/render guards
  // need its length. Rebuilding it for the count would double the work on
  // exactly the grids that are already too big.
  const heatmapCells: any[] = zValues
    .map((it: any, index: any) =>
      xAxisZerothPositionUniqueValue.map((_i: any, j: number) => [
        j,
        index,
        it[j],
      ]),
    )
    .flat();

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
    // Shared heatmap defaults (heatmapDefaults.ts): the same Spectral ramp every
    // other heatmap in the app uses, instead of ECharts' stock colours.
    inRange: {
      color: HEATMAP_VISUAL_MAP_COLORS,
    },
  }),
    (options.series = [
      {
        ...defaultSeriesProps,
        name: panelSchema?.queries[0]?.fields?.z[0].label,
        // Without a cell border a dense heatmap collapses into solid bands.
        itemStyle: heatmapCellItemStyle(store),

        data: heatmapCells,
        // Per-cell labels only while the grid is small enough to read them, and
        // chunked rendering when it is not — a text element plus a unit
        // formatter per cell is what hangs the tab on a big grid. See
        // heatmapDefaults.
        ...heatmapLargeGridDefaults(heatmapCells.length),
        label: heatmapValueLabel(heatmapCells.length, (params: any) => {
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
        }),
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
      splitArea: HEATMAP_SPLIT_AREA,
    },
  ]),
    [
      (options.yAxis = {
        type: "category",
        data: xAxisFirstPositionUniqueValue,
        splitArea: HEATMAP_SPLIT_AREA,
      }),
    ]);
  options.legend.show = false;
}

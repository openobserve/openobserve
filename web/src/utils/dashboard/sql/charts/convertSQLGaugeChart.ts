// Copyright 2023 OpenObserve Inc.
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

import { formatUnitValue, getUnitValue } from "../../convertDataIntoUnitValue";
import { calculateGridPositions } from "../../calculateGridForSubPlot";
import { getSeriesColor } from "../../colorPalette";
import { type SQLContext } from "../shared/types";

/**
 * Applies chart-specific options for: gauge
 *
 * Mutates `ctx.options` in place, exactly as the original switch case did.
 */
export function applyGaugeChart(ctx: SQLContext): void {
  const {
    options,
    panelSchema,
    store,
    xAxisKeys,
    yAxisKeys,
    chartMin,
    chartMax,
    chartPanelRef,
    defaultSeriesProps,
    getAxisDataFromKey,
  } = ctx;

  const key1 = yAxisKeys[0];
  const yAxisValue = getAxisDataFromKey(key1);
  // used for gauge name
  const xAxisValue = getAxisDataFromKey(xAxisKeys[0]);

  // create grid array based on chart panel width, height and total no. of gauge
  const gridDataForGauge = calculateGridPositions(
    chartPanelRef.value.offsetWidth,
    chartPanelRef.value.offsetHeight,
    yAxisValue.length || 1,
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
      try {
        // unit conversion
        return formatUnitValue(
          getUnitValue(
            value,
            panelSchema.config?.unit,
            panelSchema.config?.unit_custom,
            panelSchema.config?.decimals,
          ),
        );
      } catch (error) {
        return value ?? "";
      }
    },
    enterable: true,
    backgroundColor:
      store.state.theme === "dark" ? "rgba(0,0,0,1)" : "rgba(255,255,255,1)",
    extraCssText:
      "max-height: 200px; overflow: auto; max-width: 500px; user-select: text; scrollbar-width: thin; scrollbar-color: rgba(128,128,128,0.5) transparent;",
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
  // for each gauge we have separate grid
  options.grid = gridDataForGauge.gridArray;

  const gaugeData = yAxisValue.length > 0 ? yAxisValue : [0];
  const gaugeNames = xAxisValue.length > 0 ? xAxisValue : [""];

  options.series = gaugeData.map((it: any, index: any) => {
    return {
      ...defaultSeriesProps,
      min: panelSchema?.queries[0]?.config?.min || 0,
      max: panelSchema?.queries[0]?.config?.max || 100,

      //which grid will be used
      gridIndex: index,
      // radius, progress and axisline width will be calculated based on grid width and height
      radius: `${
        Math.min(gridDataForGauge.gridWidth, gridDataForGauge.gridHeight) / 2 -
        5
      }px`,
      progress: {
        show: true,
        width: `${
          Math.min(gridDataForGauge.gridWidth, gridDataForGauge.gridHeight) / 6
        }`,
      },
      axisLine: {
        lineStyle: {
          width: `${
            Math.min(gridDataForGauge.gridWidth, gridDataForGauge.gridHeight) /
            6
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
          name: gaugeNames[index] ?? "",
          value: it,
          detail: {
            formatter: function (value: any) {
              try {
                const unitValue = getUnitValue(
                  value,
                  panelSchema.config?.unit,
                  panelSchema.config?.unit_custom,
                  panelSchema.config?.decimals,
                );
                return unitValue.value + unitValue.unit;
              } catch (error) {
                return value ?? "";
              }
            },
          },
          itemStyle: {
            color:
              getSeriesColor(
                panelSchema?.config?.color,
                gaugeNames[index] ?? "",
                [it],
                chartMin,
                chartMax,
                store.state.theme,
                panelSchema?.config?.color?.colorBySeries,
              ) ?? null,
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
}

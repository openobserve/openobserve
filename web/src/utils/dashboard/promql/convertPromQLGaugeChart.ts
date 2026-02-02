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

import {
  PromQLChartConverter,
  ProcessedPromQLData,
  TOOLTIP_SCROLL_STYLE,
} from "./shared/types";
import { applyAggregation } from "./shared/dataProcessor";
import { getUnitValue, formatUnitValue } from "../convertDataIntoUnitValue";
import { getSeriesColor } from "../colorPalette";

/**
 * Converter for gauge charts
 * Displays metrics as circular gauges with min/max ranges
 */
export class GaugeConverter implements PromQLChartConverter {
  supportedTypes = ["gauge"];

  convert(
    processedData: ProcessedPromQLData[],
    panelSchema: any,
    store: any,
    extras: any,
    chartPanelRef?: any,
  ) {
    const config = panelSchema.config || {};
    const series: any[] = [];
    const aggregation = config.aggregation || "last";

    // Calculate grid layout for multiple gauges
    const totalGauges = processedData.reduce(
      (sum, qd) => sum + qd.series.length,
      0,
    );
    const gridLayout = this.calculateGridLayout(totalGauges, panelSchema);

    let gaugeIndex = 0;

    processedData.forEach((queryData, queryIdx) => {
      const queryConfig = panelSchema.queries[queryIdx]?.config || {};

      queryData.series.forEach((seriesData) => {
        const value = applyAggregation(seriesData.values, aggregation);

        const grid = gridLayout.grids[gaugeIndex];

        series.push({
          type: "gauge",
          min: queryConfig.min || 0,
          max: queryConfig.max || 100,

          // Grid positioning
          gridIndex: gaugeIndex,
          center: grid.center,
          radius: grid.radius,

          // Progress bar styling
          progress: {
            show: true,
            width: grid.progressWidth,
          },

          // Axis line styling
          axisLine: {
            lineStyle: {
              width: grid.progressWidth,
            },
          },

          // Title configuration
          title: {
            fontSize: 10,
            offsetCenter: [0, "70%"],
            width: grid.width,
            overflow: "truncate",
          },

          // Data
          data: [
            {
              name: seriesData.name,
              value,
              detail: {
                formatter: (val: any) => {
                  const unitValue = getUnitValue(
                    val,
                    config?.unit,
                    config?.unit_custom,
                    config?.decimals,
                  );
                  return unitValue.value + unitValue.unit;
                },
              },
              itemStyle: {
                color: this.getGaugeColor(
                  value,
                  seriesData.name,
                  panelSchema,
                  store,
                ),
              },
            },
          ],

          // Detail (center value) configuration
          detail: {
            valueAnimation: true,
            offsetCenter: [0, 0],
            fontSize: 12,
          },
        });

        extras.legends.push(seriesData.name);
        gaugeIndex++;
      });
    });

    return {
      series,
      grid: gridLayout.grids.map((g: any) => ({
        left: g.left,
        top: g.top,
        width: g.width,
        height: g.height,
      })),
      dataset: { source: [[]] },
      tooltip: {
        show: true,
        trigger: "item",
        textStyle: {
          color: store.state.theme === "dark" ? "#fff" : "#000",
          fontSize: 12,
        },
        extraCssText: TOOLTIP_SCROLL_STYLE,
        valueFormatter: (value: any) => {
          return formatUnitValue(
            getUnitValue(
              value,
              config?.unit,
              config?.unit_custom,
              config?.decimals,
            ),
          );
        },
      },
    };
  }

  /**
   * Calculate grid layout for multiple gauges
   */
  private calculateGridLayout(totalGauges: number, panelSchema: any) {
    const config = panelSchema.config || {};
    const gaugesPerRow =
      config.gauges_per_row || Math.ceil(Math.sqrt(totalGauges));
    const rows = Math.ceil(totalGauges / gaugesPerRow);

    const gridWidth = 100 / gaugesPerRow;
    const gridHeight = 100 / rows;

    const grids: any[] = [];

    for (let i = 0; i < totalGauges; i++) {
      const row = Math.floor(i / gaugesPerRow);
      const col = i % gaugesPerRow;

      const left = col * gridWidth;
      const top = row * gridHeight;

      const centerX = left + gridWidth / 2;
      const centerY = top + gridHeight / 2;

      const minDimension = Math.min(gridWidth, gridHeight);
      const radius = minDimension / 2 - 5;
      const progressWidth = radius / 6;

      grids.push({
        left: `${left}%`,
        top: `${top}%`,
        width: `${gridWidth}%`,
        height: `${gridHeight}%`,
        center: [`${centerX}%`, `${centerY}%`],
        radius: `${radius}%`,
        progressWidth,
      });
    }

    return { grids, gaugesPerRow, rows, gridWidth, gridHeight };
  }

  /**
   * Get color for gauge based on value and configuration
   */
  private getGaugeColor(
    value: number,
    seriesName: string,
    panelSchema: any,
    store: any,
  ) {
    const config = panelSchema.config || {};

    try {
      return getSeriesColor(
        config?.color,
        seriesName,
        value,
        config?.min || 0,
        config?.max || 100,
        store.state.theme,
        config?.color?.colorBySeries,
      );
    } catch (error) {
      console.warn("Failed to get gauge color:", error);
      return undefined;
    }
  }
}

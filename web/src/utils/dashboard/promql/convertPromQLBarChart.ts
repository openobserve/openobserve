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

import { PromQLChartConverter, ProcessedPromQLData } from "./shared/types";
import { applyAggregation } from "./shared/dataProcessor";
import {
  buildCategoryXAxis,
  buildCategoryYAxis,
  buildValueAxis,
  buildTooltip,
} from "./shared/axisBuilder";
import { getSeriesColor } from "../colorPalette";
import { getUnitValue, formatUnitValue } from "../convertDataIntoUnitValue";
import { createSeriesOverrideLookup } from "../seriesOverrides";
import { calculateWidthText } from "../chartDimensionUtils";
import { buildSeriesMarkLine } from "./shared/markLines";

/**
 * Converter for bar chart variants (h-bar, stacked, h-stacked)
 */
export class BarConverter implements PromQLChartConverter {
  supportedTypes = ["h-bar", "stacked", "h-stacked"];

  convert(processedData: ProcessedPromQLData[], panelSchema: any, store: any, extras: any) {
    const chartType = panelSchema.type;
    const config = panelSchema.config || {};
    const isHorizontal = chartType.startsWith("h-");
    const isStacked = chartType.includes("stacked");
    const markLine = isStacked ? buildSeriesMarkLine(panelSchema) : null;
    const seriesOverrides = createSeriesOverrideLookup(config);

    const series: any[] = [];
    const categories: string[] = [];

    // Get aggregation function
    const aggregation = config.aggregation || "last";

    // Calculate min/max for color scaling
    let chartMin = Infinity;
    let chartMax = -Infinity;

    if (isStacked) {
      // For stacked charts, each series becomes a stack component
      // Categories are timestamps (formatted for display)

      // First pass: calculate min/max
      processedData.forEach((queryData) => {
        queryData.series.forEach((seriesData) => {
          const numericValues = seriesData.values.map(([, val]) => parseFloat(val));
          numericValues.forEach((val) => {
            if (val < chartMin) chartMin = val;
            if (val > chartMax) chartMax = val;
          });
        });
      });

      // Second pass: build series with colors
      processedData.forEach((queryData) => {
        // Build categories from timestamps (only once)
        if (categories.length === 0) {
          categoryLabels(queryData.timestamps).forEach((label) => categories.push(label));
        }

        queryData.series.forEach((seriesData) => {
          const data = queryData.timestamps.map(([ts]) => {
            const dataValue = seriesData.data[ts];
            // Return '-' for missing values instead of 0 to show blank in stacked charts
            return dataValue != null ? parseFloat(dataValue) : "-";
          });

          // Get numeric values for color calculation
          const numericValues = seriesData.values.map(([, val]) => parseFloat(val));

          const color = getSeriesColor(
            config.color || null,
            seriesData.name,
            numericValues,
            chartMin,
            chartMax,
            store.state.theme,
            config.color?.colorBySeries,
          );

          series.push({
            name: seriesData.name,
            _panelQueryIndex: queryData.queryIndex,
            _seriesRole: queryData.seriesRole,
            type: "bar",
            // A past period stacks on its own, or it would add to the current totals.
            stack: queryData.nameSuffix ? `total (${queryData.nameSuffix})` : "total",
            data,
            ...(color && { color }),
            // Label configuration (same as SQL charts)
            label: {
              show: config?.label_option?.position != null,
              position: config?.label_option?.position || "top",
              rotate: config?.label_option?.rotate || 0,
              // Add unit formatting to labels
              formatter: (params: any) => {
                return formatUnitValue(
                  getUnitValue(params.value, config?.unit, config?.unit_custom, config?.decimals),
                );
              },
            },
            emphasis: {
              focus: "series",
            },
            ...(config.bar_width && { barWidth: config.bar_width }),
            ...(markLine && { markLine }),
          });

          extras.legends.push(seriesData.name);
        });
      });
    } else {
      // For non-stacked h-bar: use instant/aggregated values
      // Categories are series names
      const dataItems: Array<{ value: number; itemStyle?: { color: string } }> = [];

      // First pass: calculate min/max and collect data
      const seriesDataCollection: Array<{
        name: string;
        value: number;
        rawValues: Array<[number, string]>;
      }> = [];

      processedData.forEach((queryData) => {
        queryData.series.forEach((seriesData) => {
          const value = applyAggregation(seriesData.values, aggregation);

          if (value < chartMin) chartMin = value;
          if (value > chartMax) chartMax = value;

          seriesDataCollection.push({
            name: seriesData.name,
            value,
            rawValues: seriesData.values,
          });

          categories.push(seriesData.name);
        });
      });

      // Second pass: apply colors
      seriesDataCollection.forEach((seriesData) => {
        const numericValues = seriesData.rawValues.map(([, val]) => parseFloat(val));

        const color =
          seriesOverrides.get(seriesData.name)?.color ??
          getSeriesColor(
            config.color || null,
            seriesData.name,
            numericValues,
            chartMin,
            chartMax,
            store.state.theme,
            config.color?.colorBySeries,
          );

        dataItems.push(
          color ? { value: seriesData.value, itemStyle: { color } } : { value: seriesData.value },
        );
      });

      series.push({
        type: "bar",
        data: dataItems,
        // Label configuration (same as SQL charts)
        label: {
          show: config?.label_option?.position != null,
          position: config?.label_option?.position || "top",
          rotate: config?.label_option?.rotate || 0,
          // Add unit formatting to labels
          formatter: (params: any) => {
            const unit = seriesOverrides.unitArgs(params.name);
            return formatUnitValue(
              getUnitValue(params.value, unit.unit, unit.unitCustom, unit.decimals),
            );
          },
        },
        emphasis: {
          focus: "series",
        },
        ...(config.bar_width && { barWidth: config.bar_width }),
      });
    }

    // Configure axes based on orientation
    const axisConfig = isHorizontal
      ? {
          xAxis: buildValueAxis(panelSchema, store),
          yAxis: buildCategoryYAxis(categories, panelSchema, store),
        }
      : {
          xAxis: buildCategoryXAxis(categories, panelSchema, store),
          yAxis: buildValueAxis(panelSchema, store),
        };

    if (isHorizontal) {
      axisConfig.yAxis.axisLabel = {
        ...axisConfig.yAxis.axisLabel,
        overflow: "truncate",
        width: config.axis_width || 150,
      };
    }
    // Plain h-bar categories are the series names, so they take the display names.
    if (!isStacked && categories.some((name) => seriesOverrides.get(name)?.displayName)) {
      axisConfig.yAxis.axisLabel = {
        ...axisConfig.yAxis.axisLabel,
        formatter: (name: string) => String(seriesOverrides.displayName(name)),
      };
    }

    // containLabel reserves the label area; fixed px insets avoid the waste
    // of percentage margins on wide panels and starvation on short ones.
    const legendAtBottom = config.show_legends && config.legends_position !== "right";
    // the last category label centers under the final tick and spills half
    // its width past the plot edge — reserve that much on the right
    const lastCategory = String(categories[categories.length - 1] ?? "");
    /* eslint-disable local/no-hardcoded-px -- must match the fixed numeric fontSize ECharts paints category labels at; ECharts numeric sizes are literal CSS px and never scale with the root, so rem here would over-reserve the inset */
    const rightInset = isHorizontal
      ? "4%"
      : Math.max(20, Math.ceil(calculateWidthText(lastCategory, "12px") / 2) + 6);
    /* eslint-enable local/no-hardcoded-px */
    return {
      series,
      ...axisConfig,
      grid: {
        left: 16,
        right: rightInset,
        top: 16,
        bottom: legendAtBottom ? 40 : 12,
        containLabel: true,
        ...(config.axis_width && { left: config.axis_width }),
      },
      tooltip: buildTooltip(
        panelSchema,
        "axis",
        store,
        extras?.hoveredSeriesState,
        isStacked ? "seriesName" : "name",
        series,
      ),
      // Legend config will be applied by applyLegendConfiguration in convertPromQLChartData
      // This ensures consistent behavior with SQL charts (applies to stacked and non-stacked)
    };
  }
}

interface CategoryParts {
  date: string;
  time: string;
}

/** A step's YYYY-MM-DD date (empty when a string label carries none) and HH:MM:SS time; null without a time. */
function categoryParts(formatted: Date | string): CategoryParts | null {
  if (formatted instanceof Date) {
    const pad = (value: number) => String(value).padStart(2, "0");
    return {
      date: `${formatted.getFullYear()}-${pad(formatted.getMonth() + 1)}-${pad(formatted.getDate())}`,
      time: `${pad(formatted.getHours())}:${pad(formatted.getMinutes())}:${pad(formatted.getSeconds())}`,
    };
  }
  const match = formatted.toString().match(/(\d{4}-\d{2}-\d{2})?[T ]?(\d{2}:\d{2}:\d{2})/);
  return match ? { date: match[1] ?? "", time: match[2] } : null;
}

/** Stacked category labels: HH:MM:SS, or MM-DD HH:MM[:SS] once the steps fall on more than one date. */
function categoryLabels(stamps: Array<[number, Date | string]>): string[] {
  const parts = stamps.map(([, formatted]) => categoryParts(formatted));
  // Steps on different calendar days repeat HH:MM:SS, however short the span.
  const withDate = new Set(parts.map((part) => part?.date).filter(Boolean)).size > 1;
  // MM-DD and no zero seconds keep a dated label inside a narrow axis.
  const withSeconds = !withDate || parts.some((part) => part && !part.time.endsWith(":00"));
  return parts.map((part, index) => {
    if (!part) return stamps[index][1].toString();
    const time = withSeconds ? part.time : part.time.slice(0, 5);
    return withDate && part.date ? `${part.date.slice(5)} ${time}` : time;
  });
}

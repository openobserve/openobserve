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
import { TOOLTIP_SCROLL_STYLE } from "./types";

/**
 * Build tooltip configuration with unit formatting and decimals
 *
 * @param panelSchema - Panel configuration schema
 * @param triggerType - Tooltip trigger type (axis or item)
 * @returns Tooltip configuration object for ECharts
 */
export function buildTooltip(
  panelSchema: any,
  triggerType: "axis" | "item" = "axis",
): any {
  const config = panelSchema.config || {};
  const decimals = config.decimals ?? 2;
  const unit = config.unit;
  const unitCustom = config.unit_custom;

  return {
    trigger: triggerType,
    textStyle: {
      fontSize: 12,
    },
    enterable: true,
    extraCssText: TOOLTIP_SCROLL_STYLE,
    axisPointer: {
      type: "cross",
    },
    formatter: (params: any) => {
      if (!params || (Array.isArray(params) && params.length === 0)) {
        return "";
      }

      // Handle single item (for pie/donut charts)
      if (!Array.isArray(params)) {
        params = [params];
      }

      const tooltipItems: string[] = [];

      // Add axis label (timestamp for time-series)
      if (params[0]?.axisValue) {
        tooltipItems.push(params[0].axisValue);
      }

      // Add series data with unit formatting
      params.forEach((param: any) => {
        if (param.seriesName) {
          const marker = param.marker || "";
          const value = param.value?.[1] ?? param.value;

          // Apply unit formatting
          const formattedValue = formatUnitValue(
            getUnitValue(value, unit, unitCustom, decimals),
          );

          tooltipItems.push(
            `${marker} ${param.seriesName}: <strong>${formattedValue}</strong>`,
          );
        }
      });

      return tooltipItems.join("<br/>");
    },
  };
}

/**
 * Build X-axis configuration for time-series charts
 *
 * @param panelSchema - Panel configuration schema
 * @param store - Vuex store instance
 * @param hasData - Whether the chart has any data to display
 * @returns X-axis configuration object for ECharts
 */
export function buildXAxis(
  panelSchema: any,
  store: any,
  hasData: boolean = true,
): any {
  const config = panelSchema.config || {};
  const showGridlines = config.show_grid !== false; // Default to true

  return {
    type: "time",
    axisLine: {
      show: !hasData,
      onZero: false,
    },
    axisLabel: {
      show: config.axis_label !== false,
      hideOverlap: true,
    },
    splitLine: {
      show: showGridlines,
    },
    ...(config.axis_border_show !== undefined && {
      axisLine: {
        show: config.axis_border_show,
      },
    }),
  };
}

/**
 * Build Y-axis configuration for time-series charts
 *
 * @param panelSchema - Panel configuration schema
 * @param queryIndex - Index of the query (for multi-query support)
 * @returns Y-axis configuration object for ECharts
 */
export function buildYAxis(panelSchema: any, queryIndex: number = 0): any {
  const config = panelSchema.config || {};
  const showGridlines = config.show_grid !== false; // Default to true

  // Get Y-axis label from query configuration (same as SQL)
  const query = panelSchema.queries?.[queryIndex];
  const yAxisLabel = query?.fields?.y?.[0]?.label || "";

  // Build Y-axis configuration
  const yAxis: any = {
    type: "value",
    axisLabel: {
      show: config.axis_label !== false,
      // Add unit formatting to Y-axis labels
      formatter: (value: any) => {
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
    splitLine: {
      show: showGridlines,
    },
    ...(config.axis_border_show !== undefined && {
      axisLine: {
        show: config.axis_border_show,
      },
    }),
    ...(config.axis_width && {
      axisLabel: {
        show: config.axis_label !== false,
        width: config.axis_width,
        // Preserve unit formatter when axis_width is set
        formatter: (value: any) => {
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
    }),
  };

  // Add Y-axis min/max if configured (same as SQL)
  if (config.y_axis_min !== undefined) {
    yAxis.min = config.y_axis_min;
  }
  if (config.y_axis_max !== undefined) {
    yAxis.max = config.y_axis_max;
  }

  // Add axis name if label exists (same as SQL)
  if (yAxisLabel) {
    yAxis.name = yAxisLabel;
    yAxis.nameLocation = "middle";
    yAxis.nameGap = 50; // Default gap, can be made dynamic later
    yAxis.nameTextStyle = {
      fontWeight: "bold",
      fontSize: 14,
    };
  }

  return yAxis;
}

/**
 * Build category X-axis configuration for bar/h-bar charts
 *
 * @param categories - Array of category labels
 * @param panelSchema - Panel configuration schema
 * @returns Category X-axis configuration object for ECharts
 */
export function buildCategoryXAxis(
  categories: string[],
  panelSchema: any,
): any {
  const config = panelSchema.config || {};
  const showGridlines = config.show_grid !== false;

  return {
    type: "category",
    data: categories,
    axisLabel: {
      show: config.axis_label !== false,
      rotate: config.axis_label_rotate || 0,
    },
    splitLine: {
      show: showGridlines,
    },
    ...(config.axis_border_show !== undefined && {
      axisLine: {
        show: config.axis_border_show,
      },
    }),
  };
}

/**
 * Build category Y-axis configuration for horizontal bar charts
 *
 * @param categories - Array of category labels
 * @param panelSchema - Panel configuration schema
 * @returns Category Y-axis configuration object for ECharts
 */
export function buildCategoryYAxis(
  categories: string[],
  panelSchema: any,
): any {
  const config = panelSchema.config || {};
  const showGridlines = config.show_grid !== false;

  return {
    type: "category",
    data: categories,
    axisLabel: {
      show: config.axis_label !== false,
    },
    splitLine: {
      show: showGridlines,
    },
    ...(config.axis_border_show !== undefined && {
      axisLine: {
        show: config.axis_border_show,
      },
    }),
  };
}

/**
 * Build value axis configuration (for horizontal bar charts' X-axis)
 *
 * @param panelSchema - Panel configuration schema
 * @returns Value axis configuration object for ECharts
 */
export function buildValueAxis(panelSchema: any): any {
  const config = panelSchema.config || {};
  const showGridlines = config.show_grid !== false;

  const valueAxis: any = {
    type: "value",
    axisLabel: {
      show: config.axis_label !== false,
      // Add unit formatting to value axis labels
      formatter: (value: any) => {
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
    splitLine: {
      show: showGridlines,
    },
    ...(config.axis_border_show !== undefined && {
      axisLine: {
        show: config.axis_border_show,
      },
    }),
  };

  // Add Y-axis min/max if configured (applies to X-axis for h-bar)
  if (config.y_axis_min !== undefined) {
    valueAxis.min = config.y_axis_min;
  }
  if (config.y_axis_max !== undefined) {
    valueAxis.max = config.y_axis_max;
  }

  return valueAxis;
}

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
 * Build X-axis configuration for time-series charts
 *
 * @param panelSchema - Panel configuration schema
 * @param store - Vuex store instance
 * @param hasData - Whether the chart has any data to display
 * @returns X-axis configuration object for ECharts
 */
export function buildXAxis(panelSchema: any, store: any, hasData: boolean = true): any {
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
 * @returns Y-axis configuration object for ECharts
 */
export function buildYAxis(panelSchema: any): any {
  const config = panelSchema.config || {};
  const showGridlines = config.show_grid !== false; // Default to true

  return {
    type: "value",
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
    ...(config.axis_width && {
      axisLabel: {
        show: config.axis_label !== false,
        width: config.axis_width,
      },
    }),
  };
}

/**
 * Build category X-axis configuration for bar/h-bar charts
 *
 * @param categories - Array of category labels
 * @param panelSchema - Panel configuration schema
 * @returns Category X-axis configuration object for ECharts
 */
export function buildCategoryXAxis(categories: string[], panelSchema: any): any {
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
export function buildCategoryYAxis(categories: string[], panelSchema: any): any {
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

  return {
    type: "value",
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

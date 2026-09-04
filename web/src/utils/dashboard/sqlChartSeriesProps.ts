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

/**
 * Retrieves the ECharts series properties for a given SQL chart type.
 *
 * @param {any} panelSchema - The panel schema object containing chart type and config.
 * @return {Object} - The series properties for the given chart type.
 */
export const getPropsByChartTypeForSeries = (panelSchema: any) => {
  switch (panelSchema.type) {
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
        smooth:
          panelSchema.config?.line_interpolation === "smooth" ||
          panelSchema.config?.line_interpolation == null,
        step: ["step-start", "step-end", "step-middle"].includes(
          panelSchema.config?.line_interpolation,
        )
          ? // TODO: replace this with type integrations
            panelSchema.config.line_interpolation.replace("step-", "")
          : false,
        showSymbol: panelSchema.config?.show_symbol ?? false,
        areaStyle: null,
        lineStyle: { width: panelSchema.config?.line_thickness ?? 1.5 },
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
        radius: "50%",
        lineStyle: { width: 1.5 },
      };
    case "donut":
      return {
        type: "pie",
        radius: ["25%", "50%"],
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
        smooth:
          panelSchema.config?.line_interpolation === "smooth" ||
          panelSchema.config?.line_interpolation == null,
        step: ["step-start", "step-end", "step-middle"].includes(
          panelSchema.config?.line_interpolation,
        )
          ? panelSchema.config.line_interpolation.replace("step-", "")
          : false,
        emphasis: { focus: "series" },
        areaStyle: {},
        showSymbol: panelSchema.config?.show_symbol ?? false,
        lineStyle: { width: panelSchema.config?.line_thickness ?? 1.5 },
      };
    case "stacked":
      return {
        type: "bar",
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
        smooth:
          panelSchema.config?.line_interpolation === "smooth" ||
          panelSchema.config?.line_interpolation == null,
        step: ["step-start", "step-end", "step-middle"].includes(
          panelSchema.config?.line_interpolation,
        )
          ? panelSchema.config.line_interpolation.replace("step-", "")
          : false,
        stack: "Total",
        areaStyle: {},
        emphasis: {
          focus: "series",
        },
        showSymbol: panelSchema.config?.show_symbol ?? false,
        lineStyle: { width: panelSchema.config?.line_thickness ?? 1.5 },
      };
    case "metric":
      return {
        type: "custom",
        coordinateSystem: "polar",
      };
    case "h-stacked":
      return {
        type: "bar",
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

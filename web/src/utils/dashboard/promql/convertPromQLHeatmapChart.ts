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
import { getUnitValue, formatUnitValue } from "../convertDataIntoUnitValue";

/**
 * Converter for heatmap charts
 * Displays time-series data as a 2D heatmap with color intensity
 */
export class HeatmapConverter implements PromQLChartConverter {
  supportedTypes = ["heatmap"];

  convert(
    processedData: ProcessedPromQLData[],
    panelSchema: any,
    store: any,
    extras: any,
    chartPanelRef?: any,
  ) {
    const config = panelSchema.config || {};

    // Heatmap requires 3D data: [x, y, value]
    // X-axis: timestamps
    // Y-axis: series names
    // Value: metric values

    const seriesNames: string[] = [];
    const data: any[] = [];
    let maxValue = -Infinity;
    let minValue = Infinity;

    processedData.forEach((queryData) => {
      queryData.series.forEach((seriesData, seriesIndex) => {
        seriesNames.push(seriesData.name);
        extras.legends.push(seriesData.name);

        queryData.timestamps.forEach(([ts, formattedTs], timeIndex) => {
          const value = parseFloat(seriesData.data[ts] ?? "0");
          data.push([timeIndex, seriesIndex, value]);

          if (value > maxValue) maxValue = value;
          if (value < minValue) minValue = value;
        });
      });
    });

    // Format timestamps to extract time portion (consistent with bar charts)
    const xAxisData =
      processedData[0]?.timestamps.map(([, formatted]) => {
        // formatted can be Date object or ISO string
        let timeString: string;
        if (formatted instanceof Date) {
          // Format as HH:MM:SS
          const hours = String(formatted.getHours()).padStart(2, "0");
          const minutes = String(formatted.getMinutes()).padStart(2, "0");
          const seconds = String(formatted.getSeconds()).padStart(2, "0");
          timeString = `${hours}:${minutes}:${seconds}`;
        } else {
          // ISO string - extract time portion
          const dateStr = formatted.toString();
          // Try to extract time (HH:MM:SS) from datetime string
          const timeMatch = dateStr.match(/(\d{2}:\d{2}:\d{2})/);
          timeString = timeMatch ? timeMatch[1] : dateStr;
        }
        return timeString;
      }) || [];

    return {
      series: [
        {
          type: "heatmap",
          data,
          label: {
            show: true,
            fontSize: 12,
            formatter: (params: any) => {
              try {
                return (
                  formatUnitValue(
                    getUnitValue(
                      params?.value?.[2],
                      config?.unit,
                      config?.unit_custom,
                      config?.decimals,
                    ),
                  ) || params?.value?.[2]
                );
              } catch (error) {
                return params?.value?.[2]?.toString() ?? "";
              }
            },
          },
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowColor: "rgba(0, 0, 0, 0.5)",
            },
          },
        },
      ],
      xAxis: [
        {
          type: "category",
          data: xAxisData,
          splitArea: {
            show: true,
          },
        },
      ],
      yAxis: {
        type: "category",
        data: seriesNames,
        splitArea: {
          show: true,
        },
        axisLabel: {
          overflow: "truncate",
          width: config.axis_width || 150,
        },
      },
      visualMap: {
        min: 0,
        max: maxValue,
        calculable: true,
        orient: "horizontal",
        left: "center",
      },
      tooltip: {
        position: "top",
        textStyle: {
          color: store.state.theme === "dark" ? "#fff" : "#000",
          fontSize: 12,
        },
        enterable: true,
        backgroundColor:
          store.state.theme === "dark"
            ? "rgba(0,0,0,1)"
            : "rgba(255,255,255,1)",
        extraCssText: TOOLTIP_SCROLL_STYLE,
        formatter: (params: any) => {
          try {
            const seriesName =
              seriesNames[params?.value[1]] || params?.seriesName;
            const value =
              formatUnitValue(
                getUnitValue(
                  params?.value?.[2],
                  config?.unit,
                  config?.unit_custom,
                  config?.decimals,
                ),
              ) || params?.value?.[2];
            return `${seriesName} <br/> ${params?.marker} ${params?.name} : ${value}`;
          } catch (error) {
            return "";
          }
        },
      },
      grid: {
        left: "3%",
        right: "4%",
        bottom: 60,
        containLabel: true,
      },
    };
  }
}

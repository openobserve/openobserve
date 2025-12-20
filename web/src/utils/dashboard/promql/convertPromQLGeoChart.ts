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

import { PromQLChartConverter, ProcessedPromQLData, GeoMapConfig } from "./shared/types";
import { applyAggregation } from "./shared/dataProcessor";

/**
 * Converter for geographic map charts
 * Requires metrics with latitude and longitude labels
 */
export class GeoConverter implements PromQLChartConverter {
  supportedTypes = ["geomap"];

  convert(
    processedData: ProcessedPromQLData[],
    panelSchema: any,
    store: any,
    extras: any,
    chartPanelRef?: any
  ) {
    const config: GeoMapConfig & Record<string, any> = panelSchema.config || {};
    const aggregation = config.aggregation || "last";

    // Get label names for geo coordinates
    const latLabel = config.lat_label || "latitude" || "lat";
    const lonLabel = config.lon_label || "longitude" || "lon";
    const nameLabel = config.name_label || "name";

    const geoData: any[] = [];
    const errors: string[] = [];

    processedData.forEach((queryData) => {
      queryData.series.forEach((seriesData) => {
        const lat = seriesData.metric[latLabel];
        const lon = seriesData.metric[lonLabel];
        const name = seriesData.metric[nameLabel] || seriesData.name;

        if (!lat || !lon) {
          errors.push(
            `Series "${seriesData.name}" missing geo coordinates. ` +
              `Expected labels: "${latLabel}", "${lonLabel}"`
          );
          return;
        }

        const value = applyAggregation(seriesData.values, aggregation);

        geoData.push({
          name,
          value: [parseFloat(lon), parseFloat(lat), value],
          itemStyle: {
            color: this.getColorByValue(value, config),
          },
        });

        extras.legends.push(name);
      });
    });

    if (errors.length > 0) {
      console.warn("GeoMap conversion warnings:", errors);
    }

    if (geoData.length === 0) {
      return {
        error: true,
        message: `No valid geo data found. Ensure metrics have "${latLabel}" and "${lonLabel}" labels.`,
        series: [],
      };
    }

    return {
      series: [
        {
          type: "scatter",
          coordinateSystem: "geo",
          data: geoData,
          symbolSize: config.symbol_size || 10,
          emphasis: {
            label: {
              show: true,
              formatter: "{b}",
              position: "top",
            },
          },
        },
      ],
      geo: {
        map: config.map_type || "world",
        roam: config.enable_roam !== false,
        itemStyle: {
          areaColor: config.area_color || "#e0e0e0",
          borderColor: config.border_color || "#404040",
        },
        emphasis: {
          itemStyle: {
            areaColor: config.emphasis_area_color || "#c0c0c0",
          },
        },
      },
      tooltip: {
        trigger: "item",
        formatter: (params: any) => {
          const [lon, lat, value] = params.value;
          return `${params.name}<br/>Lat: ${lat}<br/>Lon: ${lon}<br/>Value: ${value}`;
        },
      },
      visualMap: {
        min: config.min_value || 0,
        max: config.max_value || 100,
        calculable: true,
        inRange: {
          color: config.color_range || ["#50a3ba", "#eac736", "#d94e5d"],
        },
        text: ["High", "Low"],
        left: "left",
        bottom: "bottom",
      },
    };
  }

  /**
   * Get color based on value and configuration
   */
  private getColorByValue(value: number, config: any): string | undefined {
    if (!config.color_thresholds) return undefined;

    for (const threshold of config.color_thresholds) {
      if (value <= threshold.value) {
        return threshold.color;
      }
    }

    return undefined;
  }
}

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
  MapsConfig,
  TOOLTIP_SCROLL_STYLE,
} from "./shared/types";
import { applyAggregation } from "./shared/dataProcessor";
import { getCountryName } from "../countryMappings";

/**
 * Converter for maps charts (location-based visualization)
 * Requires metrics with location name and value
 * Different from GeoMap which uses lat/lon coordinates
 */
export class MapsConverter implements PromQLChartConverter {
  supportedTypes = ["maps"];

  convert(
    processedData: ProcessedPromQLData[],
    panelSchema: any,
    store: any,
    extras: any,
    chartPanelRef?: any,
  ) {
    const config: MapsConfig & Record<string, any> = panelSchema.config || {};
    const aggregation = config.aggregation || "last";

    // Get label names for location name
    const nameLabel =
      config.name_label || "name" || "location" || "country" || "region";

    const locationValueMap = new Map<string, number[]>();
    const errors: string[] = [];
    processedData.forEach((queryData, qIndex) => {
      queryData.series.forEach((seriesData, sIndex) => {
        const rawLocationName = seriesData.metric[nameLabel] || seriesData.name;

        if (!rawLocationName) {
          errors.push(
            `Series "${seriesData.name}" missing location name. ` +
              `Expected label: "${nameLabel}"`,
          );
          return;
        }

        // Map country codes to full names (e.g., "US" -> "United States")
        const locationName = getCountryName(rawLocationName);

        const value = applyAggregation(seriesData.values, aggregation);

        // Aggregate values by location
        if (!locationValueMap.has(locationName)) {
          locationValueMap.set(locationName, []);
        }
        locationValueMap.get(locationName)!.push(value);
      });
    });

    // Convert aggregated data to map data array
    const mapData: any[] = [];
    locationValueMap.forEach((values, locationName) => {
      // Sum all values for the same location (since we already applied aggregation per series)
      const aggregatedValue = values.reduce((sum, val) => sum + val, 0);

      mapData.push({
        name: locationName,
        value: aggregatedValue,
      });

      extras.legends.push(locationName);
    });

    if (errors.length > 0) {
      console.warn("Maps conversion warnings:", errors);
    }

    if (mapData.length === 0) {
      return {
        error: true,
        message: `No valid map data found. Ensure metrics have a "${nameLabel}" label with location names.`,
        series: [],
      };
    }

    // Calculate min/max values from data (matching SQL implementation)
    const numericValues = mapData
      .map((item: any) => item.value)
      .filter(
        (value: any): value is number =>
          typeof value === "number" && !Number.isNaN(value),
      );

    const minValue =
      numericValues.length === 1 ? 0 : Math.min(...numericValues);
    const maxValue = Math.max(...numericValues);

    // Return map chart configuration
    // Uses ECharts map type with location names
    return {
      series: [
        {
          type: "map",
          map: config.map_type?.type || "world", // Map type: world, USA, China, etc.
          roam: config.enable_roam !== false,
          data: mapData,
          emphasis: {
            label: {
              show: true,
            },
          },
        },
      ],
      tooltip: {
        trigger: "item",
        showDelay: 0,
        transitionDuration: 0.2,
        backgroundColor: "rgba(255,255,255,0.8)",
        extraCssText: TOOLTIP_SCROLL_STYLE,
        formatter: (params: any) => {
          let formattedValue = params.value;
          if (formattedValue === "-" || Number.isNaN(formattedValue)) {
            formattedValue = "-";
          }
          return `${params.name}: ${formattedValue}`;
        },
      },
      toolbox: {
        show: true,
        left: "left",
        top: "top",
      },
      xAxis: [],
      yAxis: [],
      visualMap: {
        left: "right",
        min: minValue,
        max: maxValue,
        inRange: {
          color: [
            "#313695",
            "#4575b4",
            "#74add1",
            "#abd9e9",
            "#e0f3f8",
            "#ffffbf",
            "#fee090",
            "#fdae61",
            "#f46d43",
            "#d73027",
            "#a50026",
          ],
        },
        text: ["High", "Low"],
        calculable: true,
      },
    };
  }
}

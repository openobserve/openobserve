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

import { gt } from "@/types/i18n";

import {
  PromQLChartConverter,
  ProcessedPromQLData,
  GeoMapConfig,
  TOOLTIP_SCROLL_STYLE,
} from "./shared/types";
import { applyAggregation } from "./shared/dataProcessor";
import { geoMapTooltipFormatter, normalizeGeoWeight } from "../convertGeoMapData";

/**
 * Converter for geographic map charts (geomap)
 * Requires metrics with latitude and longitude labels
 * Uses Leaflet for map rendering (matching SQL implementation)
 */
export class GeoConverter implements PromQLChartConverter {
  supportedTypes = ["geomap"];

  convert(processedData: ProcessedPromQLData[], panelSchema: any) {
    const config: GeoMapConfig & Record<string, any> = panelSchema.config || {};
    const aggregation = config.aggregation || "last";

    // Get label names for geo coordinates
    const latLabel = config.lat_label || "latitude";
    const lonLabel = config.lon_label || "longitude";
    const weightLabel = config.weight_label || "weight";

    const geoLabels = new Set([latLabel, lonLabel, weightLabel]);
    const layers = new Map<number, { queryConfig: any; data: any[] }>();
    const errors: string[] = [];
    processedData.forEach((queryData) => {
      const queryIndex = queryData.queryIndex ?? 0;
      const queryConfig = queryData.queryConfig ?? {};
      if (!layers.has(queryIndex)) {
        layers.set(queryIndex, { queryConfig, data: [] });
      }
      const layer = layers.get(queryIndex)!;
      queryData.series.forEach((seriesData) => {
        const lat = seriesData.metric[latLabel];
        const lon = seriesData.metric[lonLabel];

        if (!lat || !lon) {
          errors.push(
            `Series "${seriesData.name}" missing geo coordinates. ` +
              `Expected labels: "${latLabel}", "${lonLabel}"`,
          );
          return;
        }

        // Weight is optional - use from metric label, aggregate from values, or use fixed value
        let weight;
        if (seriesData.metric[weightLabel]) {
          weight = parseFloat(seriesData.metric[weightLabel]);
        } else if (seriesData.values && seriesData.values.length > 0) {
          weight = applyAggregation(seriesData.values, aggregation);
        } else {
          weight = queryConfig.weight_fixed ?? 1;
        }

        const fields = Object.fromEntries(
          Object.entries(seriesData.metric).filter(([key]) => !geoLabels.has(key)),
        );
        const value = [parseFloat(lon), parseFloat(lat), weight];
        layer.data.push(Object.keys(fields).length ? { value, fields } : value);
      });
    });
    const geoData = [...layers.values()].flatMap((layer) => layer.data);

    if (errors.length > 0) {
      console.warn("GeoMap conversion warnings:", errors);
    }

    if (geoData.length === 0) {
      return {
        error: true,
        message: gt("dashboard.utils.promqlNoGeoData", { latLabel, lonLabel }),
        series: [],
      };
    }

    // Calculate min/max values for visualMap and symbolSize
    const values = geoData.map((item: any) => (Array.isArray(item) ? item : item.value)[2]);
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);

    // Return geomap configuration matching SQL implementation
    return {
      lmap: {
        center: [config.map_view?.lng || 0, config.map_view?.lat || 0],
        zoom: config.map_view?.zoom || 2,
        roam: true,
        resizeEnable: true,
        renderOnMoving: true,
        echartsLayerInteractive: true,
        largeMode: false,
      },
      tooltip: {
        trigger: "item",
        showDelay: 0,
        transitionDuration: 0.2,
        textStyle: {
          fontSize: 10,
        },
        padding: 6,
        backgroundColor: "rgba(255,255,255,0.8)",
        extraCssText: TOOLTIP_SCROLL_STYLE,
        formatter: geoMapTooltipFormatter(panelSchema),
      },
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
        text: [gt("dashboard.utils.visualMapHigh"), gt("dashboard.utils.visualMapLow")],
        calculable: true,
      },
      toolbox: {
        show: true,
        left: "left",
        top: "top",
      },
      legend: {
        show: true,
        type: "scroll",
        orient: "vertical",
        left: "left",
        top: "bottom",
        padding: [10, 20, 10, 10],
        tooltip: {
          show: true,
          padding: 10,
          textStyle: {
            fontSize: 12,
          },
          backgroundColor: "rgba(255,255,255,0.8)",
        },
        textStyle: {
          width: 100,
          overflow: "truncate",
        },
      },
      series: [...layers.entries()].map(([queryIndex, layer]) => ({
        name: gt("dashboard.utils.mapLayerNameIndexed", { index: queryIndex + 1 }),
        type: layer.queryConfig.layer_type || "scatter",
        coordinateSystem: "lmap",
        data: layer.data,
        symbolSize: function (val: any) {
          const normalizedSize = normalizeGeoWeight(val[2], minValue, maxValue);
          const minSymbolSize = config.map_symbol_style?.size_by_value?.min ?? 1;
          const maxSymbolSize = config.map_symbol_style?.size_by_value?.max ?? 100;
          const mapSymbolStyleSelected = config.map_symbol_style?.size ?? "by Value";

          if (mapSymbolStyleSelected === "by Value") {
            return minSymbolSize + normalizedSize * (maxSymbolSize - minSymbolSize);
          } else if (mapSymbolStyleSelected === "fixed") {
            return config.map_symbol_style?.size_fixed ?? 2;
          }
        },
        itemStyle: {
          color: "#b02a02",
        },
        encode: {
          value: 2,
        },
        emphasis: {
          label: {
            show: true,
          },
        },
      })),
    };
  }
}

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
  MapsConfig,
  TOOLTIP_SCROLL_STYLE,
} from "./shared/types";
import { applyAggregation } from "./shared/dataProcessor";
import { resolveCountryName } from "../countryMappings";
import { buildMapsTooltip, buildMapsVisualMap, regionJoinInfoOf } from "../convertMapsData";

/**
 * Converter for maps charts (location-based visualization)
 * Requires metrics with location name and value
 * Different from GeoMap which uses lat/lon coordinates
 */
export class MapsConverter implements PromQLChartConverter {
  supportedTypes = ["maps"];

  convert(processedData: ProcessedPromQLData[], panelSchema: any, store: any, extras: any) {
    const config: MapsConfig & Record<string, any> = panelSchema.config || {};
    const aggregation = config.aggregation || "last";
    const nameLabel = config.name_label || "name";

    const regionTotals = new Map<string, number>();
    const unmatched = new Set<string>();
    let missingLabelCount = 0;
    processedData.forEach((queryData) => {
      queryData.series.forEach((seriesData) => {
        const labelValue = seriesData.metric[nameLabel];
        // The legend name only stands in when it names a country itself, e.g. a legend template of the label.
        const region = resolveCountryName(labelValue ?? seriesData.name);
        if (!region) {
          if (labelValue === undefined || labelValue === "") missingLabelCount++;
          else unmatched.add(String(labelValue));
          return;
        }
        const value = applyAggregation(seriesData.values, aggregation);
        if (!Number.isFinite(value)) return;
        regionTotals.set(region, (regionTotals.get(region) ?? 0) + value);
      });
    });

    extras.regionJoin = regionJoinInfoOf(unmatched, {
      label: nameLabel,
      count: missingLabelCount,
    });

    const mapData = [...regionTotals].map(([name, value]) => ({ name, value }));
    mapData.forEach((item) => extras.legends.push(item.name));

    if (mapData.length === 0) {
      return {
        error: true,
        message: gt("dashboard.utils.promqlNoMapData", { nameLabel }),
        series: [],
      };
    }

    return {
      series: [
        {
          type: "map",
          map: config.map_type?.type || "world",
          roam: config.enable_roam !== false,
          data: mapData,
          emphasis: {
            label: {
              show: true,
            },
          },
        },
      ],
      tooltip: { ...buildMapsTooltip(config), extraCssText: TOOLTIP_SCROLL_STYLE },
      toolbox: {
        show: true,
        left: "left",
        top: "top",
      },
      xAxis: [],
      yAxis: [],
      visualMap: buildMapsVisualMap([...regionTotals.values()], config),
    };
  }
}

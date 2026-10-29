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

import { getDataValue } from "./aliasUtils";
import { formatUnitValue, getUnitValue } from "./convertDataIntoUnitValue";
import { escapeHtml } from "@/utils/html";
import { TOOLTIP_SCROLL_STYLE } from "./promql/shared/types";

interface GeoUnitConfig {
  config?: { unit?: string; unit_custom?: string; decimals?: number };
}

interface GeoTooltipParams {
  seriesName?: string;
  value?: unknown[];
  data?: { fields?: Record<string, unknown> };
}

// Equal weights (one point, or no weight field) would divide by zero and hide every marker.
export function normalizeGeoWeight(value: number, minValue: number, maxValue: number) {
  if (maxValue === minValue) return 0.5;
  return (value - minValue) / (maxValue - minValue);
}

/** Formats a geomap weight with the panel's unit and decimals. */
export const formatGeoWeight = (value: unknown, panelSchema: GeoUnitConfig) =>
  formatUnitValue(
    getUnitValue(
      value,
      panelSchema.config?.unit as string,
      panelSchema.config?.unit_custom as string,
      panelSchema.config?.decimals,
    ),
  );

const formatTooltipValue = (value: unknown) =>
  escapeHtml(value !== null && typeof value === "object" ? JSON.stringify(value) : String(value));

/** Tooltip formatter shared by the SQL and PromQL geomap converters. */
export const geoMapTooltipFormatter =
  (panelSchema: GeoUnitConfig) => (params: GeoTooltipParams) => {
    const [lon, lat, weight] = params.value ?? [];
    const rows: [string, unknown][] = [
      [gt("panel.latitude"), lat],
      [gt("panel.longitude"), lon],
      [gt("panel.weight"), formatGeoWeight(weight, panelSchema)],
      ...Object.entries(params.data?.fields ?? {}),
    ];
    return [
      `<b>${escapeHtml(params.seriesName ?? "")}</b>`,
      ...rows.map(([key, value]) => `${escapeHtml(key)}: ${formatTooltipValue(value)}`),
    ].join("<br/>");
  };

/**
 * Converts Map data into a format suitable for rendering a chart.
 *
 * @param {any} panelSchema - the panel schema object
 * @param {any} mapData - the map data
 * @return {Object} - the option object for rendering the map chart
 */
export const convertGeoMapData = (panelSchema: any, mapData: any) => {
  //if no latitude and longitude than return it
  if (
    !panelSchema.queries[0]?.fields?.latitude ||
    !panelSchema.queries[0]?.fields?.longitude ||
    !mapData
  ) {
    return { options: null };
  }

  const filteredMapData = panelSchema.queries.map((query: any, index: any) => {
    return mapData?.[index]?.filter((item: any) => {
      const lat = getDataValue(item, query.fields.latitude.alias);
      const lng = getDataValue(item, query.fields.longitude.alias);
      if (lat == null || lng == null) return false;
      // A non-numeric value stays in so the check below can report it; an off-globe one is dropped.
      if (isNaN(lat) || isNaN(lng)) return true;
      return Math.abs(Number(lat)) <= 90 && Math.abs(Number(lng)) <= 180;
    });
  });

  // validate if response is not at number
  panelSchema.queries.forEach((query: any, index: any) => {
    const queryResult = filteredMapData[index];

    const queryField = queryResult?.forEach((item: any) => {
      if (isNaN(getDataValue(item, query.fields.latitude.alias))) {
        throw new Error(gt("dashboard.utils.latitudeMustBeNumeric"));
      }
      if (isNaN(getDataValue(item, query.fields.longitude.alias))) {
        throw new Error(gt("dashboard.utils.longitudeMustBeNumeric"));
      }
      if (query.fields.weight && isNaN(getDataValue(item, query.fields.weight.alias))) {
        throw new Error(gt("dashboard.utils.weightMustBeNumeric"));
      }
    });
    return queryField;
  });

  // Panels saved with `map_view: null` must still open on the default view.
  const mapView = panelSchema.config?.map_view ?? {};
  const options: any = {
    lmap: {
      // See https://leafletjs.com/reference.html#map-option for details
      // NOTE: note that this order is reversed from Leaflet's [lat, lng]!
      center: [Number(mapView.lng) || 0, Number(mapView.lat) || 0], // [lng, lat]
      zoom: Number.isFinite(Number(mapView.zoom ?? NaN)) ? Number(mapView.zoom) : 1,
      roam: true,
      resizeEnable: true, // automatically handles browser window resize.
      // whether echarts layer should be rendered when the map is moving. Default is true.
      // if false, it will only be re-rendered after the map `moveend`.
      // It's better to set this option to false if data is large.
      renderOnMoving: true,
      echartsLayerInteractive: true, // Default: true
      largeMode: false, // Default: false
      // Note: Please DO NOT use the initial option `layers` to add Satellite/RoadNet/Other layers now.
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
      // Without it the tooltip hides when the pointer leaves the marker, so it can never be scrolled.
      enterable: true,
      extraCssText: TOOLTIP_SCROLL_STYLE,
      formatter: geoMapTooltipFormatter(panelSchema),
    },
    visualMap: {
      left: "right",
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
      formatter: (value: any) => formatGeoWeight(value, panelSchema),
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
    series: [],
  };

  options.series = panelSchema.queries.map((query: any, index: any) => {
    const aliases = [query.fields.longitude, query.fields.latitude, query.fields.weight]
      .map((field: any) => field?.alias)
      .filter((alias: any) => alias !== null && alias !== undefined);
    return {
      name: gt("dashboard.utils.mapLayerNameIndexed", { index: index + 1 }),
      type: query.config.layer_type,
      coordinateSystem: "lmap",
      emphasis: {
        label: {
          show: true,
        },
      },
      data: filteredMapData[index]?.map((item: any) => {
        if (query.customQuery) {
          const weight = getDataValue(item, query.fields.weight?.alias);
          const hasWeight = weight !== null && weight !== undefined;
          const value = [
            getDataValue(item, query.fields.longitude.alias),
            getDataValue(item, query.fields.latitude.alias),
            hasWeight ? weight : (query.config.weight_fixed ?? 1),
          ];
          const fields = Object.fromEntries(
            Object.entries(item).filter(
              ([key]) =>
                !aliases.some((alias: any) => key === alias || key === String(alias).toLowerCase()),
            ),
          );
          return Object.keys(fields).length ? { value, fields } : value;
        }
        return [
          item.longitude,
          item.latitude,
          item.weight !== null && item.weight !== undefined
            ? item.weight
            : (query.config.weight_fixed ?? 1),
        ];
      }),
      symbolSize: function (val: any) {
        const normalizedSize = normalizeGeoWeight(val[2], minValue, maxValue);
        const minSymbolSize = panelSchema.config?.map_symbol_style?.size_by_value?.min ?? 1;
        const maxSymbolSize = panelSchema.config?.map_symbol_style?.size_by_value?.max ?? 100;
        const mapSymbolStyleSelected = panelSchema.config?.map_symbol_style?.size ?? "by Value";

        if (mapSymbolStyleSelected === "by Value") {
          return minSymbolSize + normalizedSize * (maxSymbolSize - minSymbolSize);
        } else if (mapSymbolStyleSelected === "fixed") {
          return panelSchema.config?.map_symbol_style?.size_fixed ?? 2;
        }
      },
      itemStyle: {
        color: "#b02a02",
      },
      encode: {
        value: 2,
      },
    };
  });

  if (!options.series.map((item: any) => item.data).every(Array.isArray)) {
    return;
  }
  const values = options.series.flatMap((series: any) =>
    series.data.map((item: any) => (Array.isArray(item) ? item : item.value)[2]),
  );
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);

  if (values.length > 0) {
    options.visualMap.min = minValue;
    options.visualMap.max = maxValue;
  } else {
    options.visualMap = [];
    options.series = [];
  }

  return { options };
};

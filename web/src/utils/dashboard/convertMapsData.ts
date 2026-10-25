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
import { escapeHtml } from "@/utils/html";

import { getDataValue } from "./aliasUtils";
import { formatUnitValue, getUnitValue } from "./convertDataIntoUnitValue";
import { resolveCountryName } from "./countryMappings";

/** Names that joined no map region, and PromQL series that lacked the location label. */
export interface RegionJoinInfo {
  unmatched: string[];
  unmatchedTotal: number;
  missingLabel?: { label: string; count: number };
}

const MAX_LISTED_UNMATCHED = 20;

const MAP_COLOR_RAMP = [
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
];

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

/** Sums one query's rows per map region; a name that joins no region is collected, not drawn. */
const joinQueryRows = (
  rows: any[],
  query: any,
  totals: Map<string, number>,
  unmatched: Set<string>,
) => {
  const perRegion = new Map<string, number>();
  for (const item of rows) {
    const rawName = getDataValue(item, query.fields.name.alias);
    const region = resolveCountryName(rawName);
    if (!region) {
      if (rawName !== null && rawName !== undefined && String(rawName).trim() !== "") {
        unmatched.add(String(rawName));
      }
      continue;
    }
    const value = toFiniteNumber(getDataValue(item, query.fields.value_for_maps.alias));
    if (value === null) continue;
    perRegion.set(region, (perRegion.get(region) ?? 0) + value);
  }
  // ECharts sums a region across map series, so the colour scale must too.
  perRegion.forEach((value, region) => totals.set(region, (totals.get(region) ?? 0) + value));
  return [...perRegion].map(([name, value]) => ({ name, value }));
};

const formatMapValue = (value: unknown, config: any): string => {
  if (value === "-" || value === null || value === undefined || Number.isNaN(value)) return "-";
  return formatUnitValue(getUnitValue(value, config?.unit, config?.unit_custom, config?.decimals));
};

export const buildMapsTooltip = (config: any) => ({
  trigger: "item",
  showDelay: 0,
  transitionDuration: 0.2,
  formatter: (params: any) =>
    `${escapeHtml(params.name)}: ${escapeHtml(formatMapValue(params.value, config))}`,
});

/** Continuous colour legend over the per-region totals; a lone region scales from 0. */
export const buildMapsVisualMap = (regionTotals: number[], config: any) => {
  let min = Infinity;
  let max = -Infinity;
  for (const value of regionTotals) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const hasUnit = !!config?.unit && config.unit !== "default";
  return {
    left: "right",
    min: regionTotals.length === 1 ? 0 : min,
    max,
    inRange: { color: MAP_COLOR_RAMP },
    text: [gt("dashboard.utils.visualMapHigh"), gt("dashboard.utils.visualMapLow")],
    calculable: true,
    // Without a unit the legend keeps ECharts' own number format.
    ...(hasUnit && { formatter: (value: number) => formatMapValue(value, config) }),
  };
};

export const regionJoinInfoOf = (
  unmatched: Set<string>,
  missingLabel?: RegionJoinInfo["missingLabel"],
): RegionJoinInfo | null => {
  if (!unmatched.size && !missingLabel?.count) return null;
  return {
    unmatched: [...unmatched].slice(0, MAX_LISTED_UNMATCHED),
    unmatchedTotal: unmatched.size,
    ...(missingLabel?.count ? { missingLabel } : {}),
  };
};

export const convertMapsData = (panelSchema: any, mapData: any) => {
  const hasValidQuery = panelSchema.queries?.some(
    (query: any) => query.fields?.name && query.fields?.value_for_maps,
  );
  if (!hasValidQuery || !mapData) {
    return { options: null };
  }

  const config = panelSchema.config ?? {};
  const options: any = {
    backgroundColor: "transparent",
    tooltip: buildMapsTooltip(config),
    toolbox: { show: true, left: "left", top: "top" },
    xAxis: [],
    yAxis: [],
  };

  const regionTotals = new Map<string, number>();
  const unmatched = new Set<string>();
  options.series = panelSchema.queries.map((query: any, index: any) => {
    if (!query.fields?.name || !query.fields?.value_for_maps) {
      return { type: "map", data: [] };
    }
    const rows = mapData[index];
    return {
      type: "map",
      map: config.map_type?.type || "world",
      roam: config.enable_roam === true,
      emphasis: {
        label: {
          show: true,
        },
      },
      data: Array.isArray(rows) ? joinQueryRows(rows, query, regionTotals, unmatched) : rows,
      itemStyle: {
        color: "#b02a02",
      },
    };
  });
  if (!options.series.map((item: any) => item.data).every(Array.isArray)) {
    return;
  }

  const extras = { regionJoin: regionJoinInfoOf(unmatched) };
  if (regionTotals.size > 0) {
    options.visualMap = buildMapsVisualMap([...regionTotals.values()], config);
  } else {
    options.visualMap = [];
    options.series = [];
  }

  return { options, extras };
};

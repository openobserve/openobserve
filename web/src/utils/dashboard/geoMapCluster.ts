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

export const DEFAULT_MAP_CLUSTER_RADIUS = 40;

const TILE_SIZE = 256;
const MAX_LATITUDE = 85.0511;
const CLUSTER_LAYER_TYPES = ["scatter", "effectScatter"];

/** A point as the geomap series holds it: [lng, lat, weight]; a cluster appends its point count. */
export type GeoPoint = [number, number, number, number?];

const project = (lng: number, lat: number, zoom: number): [number, number] => {
  const scale = TILE_SIZE * Math.pow(2, zoom);
  const clamped = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, lat));
  const sin = Math.sin((clamped * Math.PI) / 180);
  const x = ((lng + 180) / 360) * scale;
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;
  return [x, y];
};

/** The cluster radius a panel uses, or null when clustering is off. */
export const mapClusterRadius = (config: any): number | null => {
  if (config?.map_cluster !== true) return null;
  const radius = Number(config?.map_cluster_radius);
  return config?.map_cluster_radius != null && Number.isFinite(radius) && radius > 0
    ? radius
    : DEFAULT_MAP_CLUSTER_RADIUS;
};

/** Groups points that fall in the same screen-space grid cell at a zoom level; each cluster sits at its points' mean position and carries their mean weight and count. */
export const clusterGeoPoints = (points: any[], radiusPx: number, zoom: number): GeoPoint[] => {
  if (!Array.isArray(points) || !(radiusPx > 0)) return points ?? [];
  const level = Number.isFinite(Number(zoom)) ? Number(zoom) : 1;
  const cells = new Map<string, { lng: number; lat: number; weight: number; count: number }>();
  for (const point of points) {
    const lng = Number(point?.[0]);
    const lat = Number(point?.[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    const [x, y] = project(lng, lat, level);
    const key = `${Math.floor(x / radiusPx)}:${Math.floor(y / radiusPx)}`;
    const cell = cells.get(key) ?? { lng: 0, lat: 0, weight: 0, count: 0 };
    cell.lng += lng;
    cell.lat += lat;
    cell.weight += Number(point?.[2]) || 0;
    cell.count += 1;
    cells.set(key, cell);
  }
  return [...cells.values()].map((cell) => [
    cell.lng / cell.count,
    cell.lat / cell.count,
    cell.weight / cell.count,
    cell.count,
  ]);
};

const clusterSize = (count: number) => Math.min(60, 14 + 8 * Math.log2(count));

const wrapClusterTooltip = (tooltip: any) => {
  const formatter = tooltip?.formatter;
  if (typeof formatter !== "function") return;
  tooltip.formatter = (params: any, ...rest: any[]) => {
    const text = formatter(params, ...rest);
    const count = Number(params?.value?.[3]) || 1;
    if (count <= 1) return text;
    return `${text} ${escapeHtml(gt("dashboard.utils.mapClusterPoints", { count }))}`;
  };
};

/** Replaces each point layer's data with clusters at the given zoom; the raw points stay on the series so a zoom can recluster them. */
export const applyGeoMapClusters = (options: any, radiusPx: number, zoom: number): void => {
  if (!options || !Array.isArray(options.series)) return;
  if (options.series.some((series: any) => CLUSTER_LAYER_TYPES.includes(series?.type))) {
    wrapClusterTooltip(options.tooltip);
  }
  for (const series of Array.isArray(options?.series) ? options.series : []) {
    if (!CLUSTER_LAYER_TYPES.includes(series?.type) || !Array.isArray(series.data)) continue;
    const pointSize = series.symbolSize;
    series._clusterSource = series.data;
    series._clusterRadius = radiusPx;
    series.data = clusterGeoPoints(series.data, radiusPx, zoom);
    series.symbolSize = (value: any) => {
      const count = Number(value?.[3]) || 1;
      if (count > 1) return clusterSize(count);
      return typeof pointSize === "function" ? pointSize(value) : pointSize;
    };
    series.label = {
      show: true,
      position: "inside",
      fontSize: 10,
      formatter: (params: any) => {
        const count = Number(params?.value?.[3]) || 1;
        return count > 1 ? String(count) : "";
      },
    };
  }
};

/** Series updates that recluster every clustered layer for a new zoom, aligned with the option's series list. */
export const reclusterSeries = (series: any[], zoom: number): any[] =>
  (Array.isArray(series) ? series : []).map((item: any) =>
    Array.isArray(item?._clusterSource)
      ? { data: clusterGeoPoints(item._clusterSource, item._clusterRadius, zoom) }
      : {},
  );

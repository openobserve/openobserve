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

import { describe, expect, it, vi } from "vitest";
import { convertPanelData } from "./convertPanelData";
import { convertGeoMapData } from "./convertGeoMapData";
import {
  DEFAULT_MAP_CLUSTER_RADIUS,
  clusterGeoPoints,
  mapClusterRadius,
  reclusterSeries,
} from "./geoMapCluster";

vi.mock("./convertCustomChartData", () => ({
  runJavaScriptCode: vi.fn(),
  validateUserCode: vi.fn(() => null),
}));

const serialize = (value: unknown) =>
  JSON.stringify(value, (_key, v) =>
    typeof v === "function" ? "[Function]" : v === undefined ? "[undefined]" : v,
  );

const geoPanel = (config: Record<string, any> = {}) => ({
  id: "g",
  type: "geomap",
  queryType: "sql",
  queries: [
    {
      query: "SELECT 1",
      customQuery: false,
      fields: {
        latitude: { alias: "latitude" },
        longitude: { alias: "longitude" },
        weight: { alias: "weight" },
      },
      config: { layer_type: "scatter", weight_fixed: 1 },
    },
  ],
  config: {
    map_view: { lat: 0, lng: 0, zoom: 2 },
    map_symbol_style: { size: "by Value", size_by_value: { min: 1, max: 100 } },
    ...config,
  },
});

const rows = () => [
  { latitude: 51.5, longitude: -0.12, weight: 10 },
  { latitude: 51.51, longitude: -0.13, weight: 30 },
  { latitude: 40.7, longitude: -74, weight: 5 },
];

const viaPanel = async (panel: any, data: any[]) =>
  (await convertPanelData(panel, data, {}, null, null, null, null, null, null)) as any;

describe("geomap clustering", () => {
  it("renders exactly as today while clustering is off", async () => {
    const { chartType, ...converted } = await viaPanel(geoPanel(), [rows()]);
    expect(chartType).toBe("geomap");
    expect(serialize(converted)).toBe(serialize(convertGeoMapData(geoPanel(), [rows()])));
    expect(converted.options.series[0].data).toHaveLength(3);
  });

  it("reads the radius only while clustering is on", () => {
    expect(mapClusterRadius({})).toBeNull();
    expect(mapClusterRadius({ map_cluster: true })).toBe(DEFAULT_MAP_CLUSTER_RADIUS);
    expect(mapClusterRadius({ map_cluster: true, map_cluster_radius: 80 })).toBe(80);
    expect(mapClusterRadius({ map_cluster: false, map_cluster_radius: 80 })).toBeNull();
  });

  it("merges nearby points with their mean position, weight and count", () => {
    const clusters = clusterGeoPoints(
      [
        [-0.12, 51.5, 10],
        [-0.13, 51.51, 30],
        [-74, 40.7, 5],
      ],
      40,
      2,
    );
    expect(clusters).toHaveLength(2);
    const london = clusters.find((cluster) => cluster[3] === 2)!;
    expect(london[0]).toBeCloseTo(-0.125);
    expect(london[2]).toBe(20);
    expect(clusters.find((cluster) => cluster[3] === 1)).toEqual([-74, 40.7, 5, 1]);
  });

  it("splits clusters again at a closer zoom", () => {
    const points = [
      [-0.12, 51.5, 10],
      [-0.13, 51.51, 30],
    ];
    expect(clusterGeoPoints(points, 40, 2)).toHaveLength(1);
    expect(clusterGeoPoints(points, 40, 16)).toHaveLength(2);
  });

  it("clusters the converted layer and labels the bubbles with their count", async () => {
    const { options } = await viaPanel(geoPanel({ map_cluster: true }), [rows()]);
    const [series] = options.series;
    expect(series.data).toHaveLength(2);
    expect(series._clusterSource).toHaveLength(3);
    expect(series.label.formatter({ value: [0, 0, 1, 2] })).toBe("2");
    expect(series.label.formatter({ value: [0, 0, 1, 1] })).toBe("");
    expect(series.symbolSize([0, 0, 1, 4])).toBe(30);
    expect(options.tooltip.formatter({ seriesName: "Layer 1", value: [0, 0, 20, 2] })).toContain(
      "(average of 2 points)",
    );
  });

  it("reclusters only clustered layers for a new zoom", () => {
    const series = [
      {
        _clusterSource: [
          [-0.12, 51.5, 10],
          [-0.13, 51.51, 30],
        ],
        _clusterRadius: 40,
      },
      { data: [] },
    ];
    expect(reclusterSeries(series, 16)).toEqual([
      {
        data: [
          [-0.12, 51.5, 10, 1],
          [-0.13, 51.51, 30, 1],
        ],
      },
      {},
    ]);
  });

  it("leaves heatmap layers alone", async () => {
    const panel = geoPanel({ map_cluster: true });
    panel.queries[0].config.layer_type = "heatmap";
    const { options } = await viaPanel(panel, [rows()]);
    expect(options.series[0].data).toHaveLength(3);
    expect(options.series[0]._clusterSource).toBeUndefined();
  });
});

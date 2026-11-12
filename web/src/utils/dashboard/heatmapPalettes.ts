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

/** Heatmap colour ramps, each listed low to high, and the sampler that turns one into `visualMap` stops. */

// ColorBrewer ramps (Apache 2.0, colorbrewer2.org); diverging ones listed cool-first so hot reads as "more".
const SPECTRAL = [
  "#5e4fa2",
  "#3288bd",
  "#66c2a5",
  "#abdda4",
  "#e6f598",
  "#ffffbf",
  "#fee08b",
  "#fdae61",
  "#f46d43",
  "#d53e4f",
  "#9e0142",
];

const RD_YL_BU = [
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

const BLUES = [
  "#f7fbff",
  "#deebf7",
  "#c6dbef",
  "#9ecae1",
  "#6baed6",
  "#4292c6",
  "#2171b5",
  "#08519c",
  "#08306b",
];

const GREENS = [
  "#f7fcf5",
  "#e5f5e0",
  "#c7e9c0",
  "#a1d99b",
  "#74c476",
  "#41ab5d",
  "#238b45",
  "#006d2c",
  "#00441b",
];

const REDS = [
  "#fff5f0",
  "#fee0d2",
  "#fcbba1",
  "#fc9272",
  "#fb6a4a",
  "#ef3b2c",
  "#cb181d",
  "#a50f15",
  "#67000d",
];

// Matplotlib perceptually uniform maps (CC0), sampled at tenths.
const VIRIDIS = [
  "#440154",
  "#482475",
  "#414487",
  "#355f8d",
  "#2a788e",
  "#21918c",
  "#22a884",
  "#44bf70",
  "#7ad151",
  "#bddf26",
  "#fde725",
];

const MAGMA = [
  "#000004",
  "#140e36",
  "#3b0f70",
  "#641a80",
  "#8c2981",
  "#b73779",
  "#de4968",
  "#f7705c",
  "#fe9f6d",
  "#fecf92",
  "#fcfdbf",
];

const INFERNO = [
  "#000004",
  "#160b39",
  "#420a68",
  "#6a176e",
  "#932667",
  "#bc3754",
  "#dd513a",
  "#f37819",
  "#fca50a",
  "#f6d746",
  "#fcffa4",
];

export const HEATMAP_PALETTES: Readonly<Record<string, readonly string[]>> = {
  spectral: SPECTRAL,
  viridis: VIRIDIS,
  magma: MAGMA,
  inferno: INFERNO,
  blues: BLUES,
  greens: GREENS,
  reds: REDS,
  "rd-yl-bu": RD_YL_BU,
};

export const DEFAULT_HEATMAP_PALETTE = "spectral";

/** Enough stops for a smooth gradient without more than a colour bar can distinguish. */
export const HEATMAP_STOP_COUNT = 41;

/** The colour at position `t` (clamped to [0, 1]) along `stops`, interpolated in RGB. */
export function samplePalette(stops: readonly string[], t: number): string {
  if (!Number.isFinite(t)) return stops[0];

  const scaled = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const lowerIndex = Math.floor(scaled);
  const upperIndex = Math.min(lowerIndex + 1, stops.length - 1);
  const fraction = scaled - lowerIndex;

  const lower = hexToRgb(stops[lowerIndex]);
  const upper = hexToRgb(stops[upperIndex]);
  return rgbToHex([
    lower[0] + (upper[0] - lower[0]) * fraction,
    lower[1] + (upper[1] - lower[1]) * fraction,
    lower[2] + (upper[2] - lower[2]) * fraction,
  ]);
}

/** `count` stops for a `visualMap`, stop k sampled from `stops` at `warp(k / (count - 1))`; ECharts spreads stops linearly, so a colour scale lives in `warp`. */
export function buildColorStops(
  stops: readonly string[],
  count: number,
  warp: (t: number) => number,
): string[] {
  const steps = Math.max(2, Math.floor(count));
  return Array.from({ length: steps }, (_unused, k) => samplePalette(stops, warp(k / (steps - 1))));
}

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

function rgbToHex(rgb: [number, number, number]): string {
  return (
    "#" +
    rgb
      .map((channel) =>
        Math.max(0, Math.min(255, Math.round(channel)))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

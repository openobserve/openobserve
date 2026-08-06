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

/**
 * Spectral colour ramp helpers.
 *
 * Pure, dependency-free. Used by the Prometheus histogram heatmap mode to
 * build the `visualMap.inRange.color` stop list.
 */

/**
 * Canonical 11-class Spectral diverging ramp (ColorBrewer), COOL-to-WARM.
 *
 * These eleven values are ColorBrewer's, by Cynthia Brewer, Mark Harrower and
 * The Pennsylvania State University, and are used under the Apache License 2.0
 * (https://colorbrewer2.org). They are reproduced here rather than pulled from
 * d3-scale-chromatic so this module stays dependency-free.
 *
 * Position 0 is the "low" end, position 1 is the "high" end. ColorBrewer
 * publishes Spectral warm-first (dark red -> purple); this ramp is listed
 * cool-first because a heatmap reads hot as "more" — otherwise a histogram's
 * near-empty high-`le` rows would dominate as a dark-red slab while the busy
 * low buckets sink into blue.
 */
export const SPECTRAL_STOPS: string[] = [
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

/**
 * Convert a `#rrggbb` string to an [r, g, b] triple.
 */
function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

/**
 * Convert an [r, g, b] triple back to a lowercase `#rrggbb` string.
 */
function rgbToHex(rgb: [number, number, number]): string {
  return (
    "#" +
    rgb
      .map((channel) => {
        const clamped = Math.max(0, Math.min(255, Math.round(channel)));
        return clamped.toString(16).padStart(2, "0");
      })
      .join("")
  );
}

/**
 * Sample the Spectral ramp at position `t` (clamped to [0, 1]) using linear
 * interpolation in RGB space between the neighbouring ColorBrewer stops.
 */
export function sampleSpectral(t: number): string {
  const stops = SPECTRAL_STOPS;

  if (!Number.isFinite(t)) return stops[0];

  const clamped = Math.max(0, Math.min(1, t));
  const scaled = clamped * (stops.length - 1);
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

/**
 * Build a discrete list of colour stops sampled from the Spectral ramp.
 *
 * ECharts' continuous `visualMap` spreads `inRange.color` **linearly** across
 * [min, max]; it has no notion of a colour-scale exponent. To emulate an
 * exponent we pre-warp the sample positions: stop `k` (which ECharts will
 * place at value fraction `t = k / (steps - 1)`) is sampled from the ramp at
 * `t ** exponent`. An exponent below 1 therefore stretches the low end of the
 * value range over more of the ramp, so small cell values remain
 * distinguishable — the same visual effect a sqrt colour scale gives.
 *
 * Both knobs are required: there is no defensible default for either without
 * knowing what is being charted, and the one caller states its choices below.
 *
 * @param steps - number of colour stops to emit
 * @param exponent - colour-scale exponent to bake into the stop positions
 */
export function buildSpectralColorStops(steps: number, exponent: number): string[] {
  const count = Math.max(2, Math.floor(steps));
  const colors: string[] = [];

  for (let k = 0; k < count; k++) {
    const t = k / (count - 1);
    colors.push(sampleSpectral(Math.pow(t, exponent)));
  }

  return colors;
}

/**
 * Sub-samples per class boundary. The ramp above has 11 canonical classes, so
 * this many samples between each adjacent pair renders the gradient smoothly
 * without emitting more stops than a colour bar can distinguish.
 */
const SAMPLES_PER_CLASS = 4;

/** (11 classes - 1) boundaries x 4 samples, plus the closing stop. */
export const SPECTRAL_HEATMAP_STOP_COUNT = (SPECTRAL_STOPS.length - 1) * SAMPLES_PER_CLASS + 1;

/**
 * Compresses the low end of the scale, so that the difference between a cell
 * holding 1 observation and one holding 10 is visible at all.
 *
 * A histogram heatmap is count data, and counts are Poisson: their variance
 * grows with the mean, so a linear colour scale spends almost its whole range
 * on the few busiest cells and renders everything else as one flat floor colour.
 * The square root is the variance-stabilizing transform for a Poisson variable,
 * which makes a fixed colour step mean roughly the same amount of evidence
 * everywhere along the ramp.
 */
const HEATMAP_SCALE_EXPONENT = 0.5;

/** Default ramp used by the Prometheus histogram heatmap: cool-to-warm. */
export const SPECTRAL_HEATMAP_STOPS: string[] = buildSpectralColorStops(
  SPECTRAL_HEATMAP_STOP_COUNT,
  HEATMAP_SCALE_EXPONENT,
);

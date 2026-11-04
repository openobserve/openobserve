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

import { chartColor } from "@/utils/chartTheme";

export const BAR_WIDTH_MAX = 200;

export interface BarStyleConfig {
  bar_width?: unknown;
  show_bar_track?: boolean;
}

export interface BarTrackAxis {
  max?: unknown;
  axisLabel?: Record<string, unknown>;
}

type AxisOption = BarTrackAxis | BarTrackAxis[] | undefined;

/** True when the bar width is unset or a whole number of pixels in 1..BAR_WIDTH_MAX. */
export const isBarWidthValid = (width: unknown): boolean =>
  width == null ||
  width === "" ||
  (typeof width === "number" && Number.isInteger(width) && width >= 1 && width <= BAR_WIDTH_MAX);

/** Series props for bar width and track; an invalid width is left to the auto sizing. */
export const barStyleSeriesProps = (
  config: BarStyleConfig,
  { withTrack }: { withTrack: boolean },
): Record<string, unknown> => ({
  ...(typeof config.bar_width === "number" &&
    isBarWidthValid(config.bar_width) && { barWidth: config.bar_width }),
  ...(withTrack &&
    config.show_bar_track && {
      showBackground: true,
      backgroundStyle: { color: chartColor("--color-progress-bar-track") },
    }),
});

/** Value-axis max for a bar track: the set max, else the largest bar, so the largest bar fills its track. */
export const barTrackMax = (configMax: unknown, dataMax: number): number | undefined => {
  const set =
    typeof configMax === "string" && configMax.trim() !== "" ? Number(configMax) : configMax;
  if (typeof set === "number" && Number.isFinite(set)) return set;
  return Number.isFinite(dataMax) && dataMax > 0 ? dataMax : undefined;
};

/** Largest numeric bar value across the built series, so the data is scanned once. */
export const seriesDataMax = (series: Array<{ data?: unknown }> | undefined): number => {
  let max = -Infinity;
  for (const s of series ?? []) {
    if (!Array.isArray(s?.data)) continue;
    for (const item of s.data) {
      const v =
        item !== null && typeof item === "object" ? (item as { value?: unknown }).value : item;
      if (typeof v === "number" && v > max) max = v;
    }
  }
  return max;
};

/** Pins every value axis to the track max. */
export const pinBarTrackAxis = (axisOption: AxisOption, max: number): void => {
  [axisOption].flat().forEach((axis) => {
    if (!axis) return;
    axis.max = max;
    // The raw max lands as an extra tick that can collide with the last nice tick.
    axis.axisLabel = { ...axis.axisLabel, hideOverlap: true };
  });
};

/** Gives the merged multi-query chart the largest per-query track max, so no query's bars overrun the track. */
export const mergeBarTrackMax = (
  target: { xAxis?: AxisOption } | undefined,
  perQueryOptions: Array<{ options?: { xAxis?: AxisOption } } | null | undefined>,
): void => {
  const maxes = perQueryOptions
    .flatMap((it) => [it?.options?.xAxis].flat())
    .map((axis) => axis?.max)
    .filter((max): max is number => typeof max === "number" && Number.isFinite(max));
  if (!maxes.length) return;
  pinBarTrackAxis(target?.xAxis, Math.max(...maxes));
};

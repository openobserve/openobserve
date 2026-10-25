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

/** Value-axis max for a bar track: the set max, else the largest bar, so the largest bar fills its track. */
export const barTrackMax = (configMax: unknown, dataMax: number): number | undefined => {
  const set = typeof configMax === "string" && configMax.trim() !== "" ? Number(configMax) : configMax;
  if (typeof set === "number" && Number.isFinite(set)) return set;
  return Number.isFinite(dataMax) && dataMax > 0 ? dataMax : undefined;
};

/** Gives the merged multi-query chart the largest per-query track max, so no query's bars overrun the track. */
export const mergeBarTrackMax = (target: any, perQueryOptions: any[]): void => {
  const maxes = perQueryOptions
    .flatMap((it: any) => [it?.options?.xAxis].flat())
    .map((axis: any) => axis?.max)
    .filter((max: unknown): max is number => typeof max === "number" && Number.isFinite(max));
  if (!maxes.length) return;
  const max = Math.max(...maxes);
  [target?.xAxis].flat().forEach((axis: any) => axis && (axis.max = max));
};

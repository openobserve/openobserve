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

const NO_ENTRANCE = { animationDuration: 0, animationDurationUpdate: 0 };

/** Zeroes the entrance and update durations at the root and on every series, leaving hover state animation alone. */
export const withoutEntrance = (options: Record<string, unknown>): Record<string, unknown> => {
  const { series } = options;
  // A series' own duration overrides the root one, so each series is zeroed too.
  const still = (entry: unknown) =>
    entry && typeof entry === "object" ? { ...entry, ...NO_ENTRANCE } : entry;
  return {
    ...options,
    ...NO_ENTRANCE,
    ...(series === undefined
      ? {}
      : { series: Array.isArray(series) ? series.map(still) : still(series) }),
  };
};

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

const UNITS = {
  m: { unit: "minute", minutes: 1 },
  h: { unit: "hour", minutes: 60 },
  d: { unit: "day", minutes: 1440 },
  w: { unit: "week", minutes: 10080 },
  M: { unit: "month", minutes: 43200 },
} as const;

export interface ComparisonWindow {
  /** How far back the window sits, in minutes. */
  minutes: number;
  count: number;
  unit: (typeof UNITS)[keyof typeof UNITS]["unit"];
}

/** The past windows a compare alert reads, from its `multi_time_range` offsets ("1w", "3d"). */
export function comparisonWindows(
  ranges: { offSet?: string }[] | null | undefined,
): ComparisonWindow[] {
  return (ranges ?? []).flatMap((range) => {
    const match = /^(\d+)([mhdwM])$/.exec(String(range?.offSet ?? "").trim());
    const count = match ? Number(match[1]) : 0;
    if (!match || count <= 0) return [];
    const { unit, minutes } = UNITS[match[2] as keyof typeof UNITS];
    return [{ minutes: count * minutes, count, unit }];
  });
}

/** "1 week", or "1 week and 1 day", in the reader's locale. */
export function comparisonOffsetText(windows: ComparisonWindow[], locale: string): string {
  const parts = windows.map((window) =>
    new Intl.NumberFormat(locale, { style: "unit", unit: window.unit, unitDisplay: "long" }).format(
      window.count,
    ),
  );
  return new Intl.ListFormat(locale, { type: "conjunction" }).format(parts);
}

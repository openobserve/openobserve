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

import { civilOfWall, MAX_YEAR, MIN_YEAR, US_PER_S } from "./civil";
import type { TimeRangeReading } from "./types";
import { isZone, offsetAtInstant, offsetLabel } from "./zone";

export type FormattableRange = Pick<
  TimeRangeReading,
  "kind" | "startUs" | "endUs" | "rolling" | "calendarToken"
>;

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

function readableOffset(sec: number): boolean {
  const minutes = Math.abs(sec % 3600);
  return sec >= -12 * 3600 && sec <= 14 * 3600 && [0, 1800, 2700].includes(minutes);
}

function isoAt(us: number, zone: string): string | null {
  if (!Number.isSafeInteger(us)) return null;
  const sec = offsetAtInstant(zone, us);
  // The parser reads only offsets -12:00..+14:00 with minutes 00, 30 or 45; others are written in UTC.
  const offset = readableOffset(sec) ? sec : 0;
  const c = civilOfWall(us, offset * US_PER_S);
  if (c.y < MIN_YEAR || c.y > MAX_YEAR) return null;
  const fraction = c.us > 0 ? `.${pad(c.us, 6)}` : "";
  return `${c.y}-${pad(c.mo)}-${pad(c.d)}T${pad(c.h)}:${pad(c.mi)}:${pad(c.s)}${fraction}${offsetLabel(offset)}`;
}

/** Text the parser reads back as the same range in every pack: `now-15m`, a calendar token, or ISO. */
export function formatTimeRangeInput(
  range: FormattableRange,
  opts: { zone: string },
): string | null {
  if (range.kind === "rolling" && range.rolling) {
    return `now-${range.rolling.value}${range.rolling.unit}`;
  }
  if (range.kind === "calendar" && range.calendarToken) return range.calendarToken;
  if (!isZone(opts.zone)) return null;
  const start = isoAt(range.startUs, opts.zone);
  const end = isoAt(range.endUs, opts.zone);
  return start && end ? `${start} - ${end}` : null;
}

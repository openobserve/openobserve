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

import { civilOfWall, wallUs, US_PER_DAY, US_PER_S, type Civil } from "./civil";

export type Resolved =
  | { kind: "exact"; us: number }
  | { kind: "gap"; us: number; readAs: Civil }
  | { kind: "fold"; earlier: number; later: number };

const CACHE_CAP = 64;
// Keyed by ASCII case, as Intl matches zone names; failures are kept too, and the cap bounds both.
const formatters = new Map<string, Intl.DateTimeFormat | null>();

// Formatter instances only: an offset cache keyed by hour breaks half-hour zones (Lord Howe).
function formatterFor(zone: string): Intl.DateTimeFormat | null {
  let key = "";
  for (const ch of zone) key += ch >= "A" && ch <= "Z" ? ch.toLowerCase() : ch;
  const hit = formatters.get(key);
  if (hit !== undefined) return hit;
  let made: Intl.DateTimeFormat | null = null;
  try {
    made = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      calendar: "gregory",
      numberingSystem: "latn",
      hourCycle: "h23",
      era: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    made = null;
  }
  if (formatters.size >= CACHE_CAP) formatters.clear();
  formatters.set(key, made);
  return made;
}

export function isZone(zone: string): boolean {
  return formatterFor(zone) !== null;
}

/** Seconds east of UTC in `zone` at the instant `us`. */
export function offsetAtInstant(zone: string, us: number): number {
  const ms = Math.floor(us / 1000);
  const formatter = formatterFor(zone);
  if (!formatter) throw new RangeError(zone);
  const parts = formatter.formatToParts(ms);
  const field = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(
    field("year"),
    field("month") - 1,
    field("day"),
    field("hour"),
    field("minute"),
    field("second"),
  );
  return (wall - Math.floor(ms / 1000) * 1000) / 1000;
}

export function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function offsetLabel(seconds: number): string {
  const sign = seconds < 0 ? "-" : "+";
  const abs = Math.abs(seconds);
  const base = `${sign}${pad(Math.floor(abs / 3600))}:${pad(Math.floor((abs % 3600) / 60))}`;
  return abs % 60 === 0 ? base : `${base}:${pad(abs % 60)}`;
}

export function wallAt(zone: string, us: number): Civil {
  return civilOfWall(us, offsetAtInstant(zone, us) * US_PER_S);
}

/** The single wall-clock to instant conversion; gaps shift forward by the offset before them. */
export function resolveCivil(c: Civil, zone: string): Resolved | null {
  const w = wallUs(c);
  if (Number.isNaN(w)) return null;
  const before = offsetAtInstant(zone, w - US_PER_DAY);
  const offsets = new Set([
    before,
    offsetAtInstant(zone, w),
    offsetAtInstant(zone, w + US_PER_DAY),
  ]);
  const hits: number[] = [];
  for (const offset of offsets) {
    const us = w - offset * US_PER_S;
    if (offsetAtInstant(zone, us) === offset && !hits.includes(us)) hits.push(us);
  }
  hits.sort((a, b) => a - b);
  if (hits.length === 1) return { kind: "exact", us: hits[0] };
  if (hits.length >= 2) return { kind: "fold", earlier: hits[0], later: hits[hits.length - 1] };
  const us = w - before * US_PER_S;
  return { kind: "gap", us, readAs: wallAt(zone, us) };
}

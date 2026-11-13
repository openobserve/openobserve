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

import { formatInTimeZone } from "date-fns-tz";

// Words people type for a zone that its IANA name does not contain; ICU may list either name of a renamed zone.
const ZONE_ALIASES: Record<string, readonly string[]> = {
  ist: ["Asia/Kolkata", "Asia/Calcutta"],
  india: ["Asia/Kolkata", "Asia/Calcutta"],
  kolkata: ["Asia/Kolkata", "Asia/Calcutta"],
  calcutta: ["Asia/Kolkata", "Asia/Calcutta"],
  mumbai: ["Asia/Kolkata", "Asia/Calcutta"],
  delhi: ["Asia/Kolkata", "Asia/Calcutta"],
  "new delhi": ["Asia/Kolkata", "Asia/Calcutta"],
  bangalore: ["Asia/Kolkata", "Asia/Calcutta"],
  bengaluru: ["Asia/Kolkata", "Asia/Calcutta"],
  chennai: ["Asia/Kolkata", "Asia/Calcutta"],
  hyderabad: ["Asia/Kolkata", "Asia/Calcutta"],
  pune: ["Asia/Kolkata", "Asia/Calcutta"],
  pst: ["America/Los_Angeles"],
  pdt: ["America/Los_Angeles"],
  pt: ["America/Los_Angeles"],
  pacific: ["America/Los_Angeles"],
  "san francisco": ["America/Los_Angeles"],
  seattle: ["America/Los_Angeles"],
  mst: ["America/Denver", "America/Phoenix"],
  mdt: ["America/Denver"],
  mountain: ["America/Denver"],
  cst: ["America/Chicago"],
  cdt: ["America/Chicago"],
  central: ["America/Chicago"],
  est: ["America/New_York"],
  edt: ["America/New_York"],
  et: ["America/New_York"],
  eastern: ["America/New_York"],
  "new york": ["America/New_York"],
  nyc: ["America/New_York"],
  boston: ["America/New_York"],
  washington: ["America/New_York"],
  akst: ["America/Anchorage"],
  hst: ["Pacific/Honolulu"],
  hawaii: ["Pacific/Honolulu"],
  gmt: ["Etc/GMT", "GMT", "Europe/London", "UTC"],
  utc: ["UTC", "Etc/UTC"],
  z: ["UTC", "Etc/UTC"],
  zulu: ["UTC", "Etc/UTC"],
  bst: ["Europe/London"],
  uk: ["Europe/London"],
  cet: ["Europe/Paris", "Europe/Berlin"],
  cest: ["Europe/Paris", "Europe/Berlin"],
  germany: ["Europe/Berlin"],
  france: ["Europe/Paris"],
  eet: ["Europe/Athens", "Europe/Helsinki"],
  msk: ["Europe/Moscow"],
  gst: ["Asia/Dubai"],
  uae: ["Asia/Dubai"],
  pkt: ["Asia/Karachi"],
  pakistan: ["Asia/Karachi"],
  npt: ["Asia/Kathmandu", "Asia/Katmandu"],
  nepal: ["Asia/Kathmandu", "Asia/Katmandu"],
  sgt: ["Asia/Singapore"],
  hkt: ["Asia/Hong_Kong"],
  china: ["Asia/Shanghai"],
  beijing: ["Asia/Shanghai"],
  jst: ["Asia/Tokyo"],
  japan: ["Asia/Tokyo"],
  kst: ["Asia/Seoul"],
  korea: ["Asia/Seoul"],
  aest: ["Australia/Sydney"],
  aedt: ["Australia/Sydney"],
  nzst: ["Pacific/Auckland"],
  nzdt: ["Pacific/Auckland"],
  brt: ["America/Sao_Paulo"],
  brazil: ["America/Sao_Paulo"],
};

// `+5`, `-8`, `5:30`, `+05:30`, `UTC+5`, `GMT-3:30`: a sign is optional, minutes narrow the hour.
const OFFSET_QUERY_RE = /^(?:utc|gmt)?\s*([+-])?\s*(\d{1,2})(?::?(\d{2}))?$/;

const offsetCache = new Map<string, string>();

/** The zone's offset at an instant as `+05:30`. */
const zoneOffset = (zone: string, atMs: number): string => {
  const key = `${zone}@${Math.floor(atMs / 3_600_000)}`;
  let offset = offsetCache.get(key);
  if (offset === undefined) {
    try {
      offset = formatInTimeZone(atMs, zone, "xxx");
    } catch {
      offset = "";
    }
    offsetCache.set(key, offset);
  }
  return offset;
};

const offsetMatches = (query: string, offset: string): boolean => {
  const match = query.replace(/\s+/g, "").match(OFFSET_QUERY_RE);
  if (!match || !offset) return false;
  const [, sign, hours, minutes] = match;
  const [zoneSign, zoneHours, zoneMinutes] = [offset[0], offset.slice(1, 3), offset.slice(4, 6)];
  if (sign && sign !== zoneSign) return false;
  if (Number(hours) !== Number(zoneHours)) return false;
  return minutes === undefined || minutes === zoneMinutes;
};

/** How well a zone matches typed text: 0 alias, 1 name word start, 2 name substring, 3 offset; null for none. */
export const zoneSearchRank = (zone: string, query: string, atMs = Date.now()): number | null => {
  const term = query.trim().toLowerCase().replace(/\s+/g, " ");
  if (!term) return 0;
  if (ZONE_ALIASES[term]?.includes(zone)) return 0;
  // An offset is read only as one: `Etc/GMT+5` is UTC-05:00, so its name must not match `+5`.
  if (OFFSET_QUERY_RE.test(term.replace(/\s+/g, ""))) {
    return offsetMatches(term, zoneOffset(zone, atMs)) ? 3 : null;
  }
  const name = zone.toLowerCase().replace(/_/g, " ");
  if (name.split(/[/\s-]/).some((word) => word.startsWith(term)) || name.startsWith(term)) {
    return 1;
  }
  return name.includes(term) ? 2 : null;
};

/** The options matching typed text, aliases and names before offsets; `zoneOf` maps an option to its IANA zone. */
export const searchTimeZones = <T>(
  options: readonly T[],
  query: string,
  zoneOf: (option: T) => string = (option) => String(option),
  atMs = Date.now(),
): T[] => {
  if (!query.trim()) return [...options];
  return options
    .map((option, index) => ({ option, index, rank: zoneSearchRank(zoneOf(option), query, atMs) }))
    .filter((entry): entry is { option: T; index: number; rank: number } => entry.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.option);
};

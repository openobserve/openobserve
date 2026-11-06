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

import { canonicalTimezone, timezoneAliasesOf } from "@/utils/timezoneAliases";

export interface TimezoneKeywords {
  /** The zone's names, normalized: lowercase, no spaces or underscores. */
  names: string[];
  /** Lowercase abbreviations such as `ist`, `pst`, `pdt`, `cet`. */
  abbreviations: string[];
  /** Spellings of the zone's UTC offsets, such as `utc+5:30`, `+0530`. */
  offsetTexts: string[];
  /** The zone's UTC offsets in minutes, winter and summer. */
  offsets: number[];
  /** The zone's UTC offset in minutes today, the one its option shows. */
  currentOffset: number | null;
}

const OFFSET_QUERY = /^(?:utc|gmt)?([+-])(\d{1,2}):?(\d{2})?$/;
const keywordCache = new Map<string, TimezoneKeywords>();

/** Lowercase with spaces and underscores dropped, so `new york` and `UTC + 5:30` compare as typed. */
export const normalizeTimezoneQuery = (query: string): string =>
  query.toLowerCase().replace(/[\s_]+/g, "");

/** Minutes east of UTC that `query` names (`UTC+5:30`, `+0530`, `GMT-8`, `UTC`), else `null`. */
export const parseOffsetQuery = (query: string): number | null => {
  const q = normalizeTimezoneQuery(query);
  if (q === "utc" || q === "gmt") return 0;
  const match = OFFSET_QUERY.exec(q);
  if (!match) return null;
  const hours = Number(match[2]);
  const minutes = match[3] ? Number(match[3]) : 0;
  if (hours > 14 || minutes > 59) return null;
  const total = hours * 60 + minutes;
  return match[1] === "-" ? -total : total;
};

// January and July cover standard and daylight time in both hemispheres.
const sampleDates = (): Date[] => {
  const year = new Date().getFullYear();
  return [new Date(Date.UTC(year, 0, 15, 12)), new Date(Date.UTC(year, 6, 15, 12))];
};

const zoneNames = (
  zone: string,
  style: "short" | "long" | "longOffset",
  dates: Date[] = sampleDates(),
): string[] => {
  try {
    const format = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: style });
    return dates.map(
      (date) =>
        format.formatToParts(date).find((part) => part.type === "timeZoneName")?.value ?? "",
    );
  } catch {
    return [];
  }
};

const offsetMinutes = (longOffset: string): number | null => {
  if (longOffset === "GMT" || longOffset === "UTC") return 0;
  const match = /^(?:GMT|UTC)([+-])(\d{2}):(\d{2})$/.exec(longOffset);
  if (!match) return null;
  const total = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === "-" ? -total : total;
};

const offsetSpellings = (minutes: number): string[] => {
  const sign = minutes < 0 ? "-" : "+";
  const hours = Math.floor(Math.abs(minutes) / 60);
  const mins = String(Math.abs(minutes) % 60).padStart(2, "0");
  const padded = String(hours).padStart(2, "0");
  const bare = [`${sign}${hours}:${mins}`, `${sign}${padded}:${mins}`, `${sign}${padded}${mins}`];
  if (mins === "00") bare.push(`${sign}${hours}`, `${sign}${padded}`);
  return bare.flatMap((text) => [text, `utc${text}`, `gmt${text}`]);
};

// "India Standard Time" gives IST; without "Standard" it also gives CET from "Central European Standard Time".
const initialsOf = (longName: string): string[] => {
  if (!longName || /\d/.test(longName)) return [];
  const words = longName.split(/[\s-]+/).filter(Boolean);
  const initials = (list: string[]) => list.map((word) => word[0]).join("");
  return [initials(words), initials(words.filter((word) => word !== "Standard"))];
};

const buildKeywords = (zone: string): TimezoneKeywords => {
  const canonical = canonicalTimezone(zone);
  const names = [zone, canonical, ...timezoneAliasesOf(canonical)].map(normalizeTimezoneQuery);
  const shortAbbreviations = zoneNames(zone, "short").filter((name) =>
    /^[A-Za-z]{2,5}$/.test(name),
  );
  const abbreviations = [...shortAbbreviations, ...zoneNames(zone, "long").flatMap(initialsOf)].map(
    (name) => name.toLowerCase(),
  );
  const offsets = zoneNames(zone, "longOffset")
    .map(offsetMinutes)
    .filter((minutes): minutes is number => minutes !== null);
  const [today] = zoneNames(zone, "longOffset", [new Date()]);
  return {
    currentOffset: today === undefined ? null : offsetMinutes(today),
    names: [...new Set(names)],
    abbreviations: [...new Set(abbreviations)],
    offsetTexts: [...new Set(offsets.flatMap(offsetSpellings))],
    offsets: [...new Set(offsets)],
  };
};

/** The search keywords of `zone`, computed once per zone. */
export const timezoneKeywords = (zone: string): TimezoneKeywords => {
  let keywords = keywordCache.get(zone);
  if (!keywords) {
    keywords = buildKeywords(zone);
    keywordCache.set(zone, keywords);
  }
  return keywords;
};

/** Whether `query` names `zone` by name, abbreviation (`IST`, `PST`) or UTC offset (`UTC+5:30`, `GMT-8`). */
export const timezoneMatchesQuery = (zone: string, query: string): boolean => {
  const q = normalizeTimezoneQuery(query);
  if (!q) return true;
  const keywords = timezoneKeywords(zone);
  const offset = parseOffsetQuery(q);
  // A typed offset means the offset the list shows, so a zone that only reaches it in the other season stays out.
  if (offset !== null) return keywords.currentOffset === offset;
  return (
    keywords.names.some((name) => name.includes(q)) ||
    keywords.abbreviations.some((abbreviation) => abbreviation.startsWith(q)) ||
    keywords.offsetTexts.some((text) => text.includes(q))
  );
};

/** A select option's search predicate for `zone`, also matching the option's visible `label`. */
export const timezoneSearchMatcher =
  (zone: string, label: string) =>
  (term: string): boolean => {
    const q = normalizeTimezoneQuery(term);
    if (parseOffsetQuery(q) === null && normalizeTimezoneQuery(label).includes(q)) return true;
    return timezoneMatchesQuery(zone, q);
  };

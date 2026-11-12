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

import {
  isRelativeHistoryEntry,
  sameHistoryEntry,
  type TimeRangeHistoryEntry,
} from "@/composables/useTimeRangeHistory";

const MICROS_PER_DAY = 86_400_000_000;
const MICROS_PER_HOUR = 3_600_000_000;

/** The rolling periods offered as chips, in the order shown. */
export const TIME_RANGE_CHIPS = ["15m", "1h", "4h", "24h", "7d", "30d"] as const;

/** Which chip set and calendar row order a page gets; dashboards lead with long ranges. */
export type TimeRangePreset = "ops" | "dashboard";

/** A chip applies `value` (a stored rolling period) and shows `label`. */
export interface TimeRangeChip {
  value: string;
  label: string;
}

export const TIME_RANGE_CHIP_SETS: Readonly<Record<TimeRangePreset, readonly TimeRangeChip[]>> = {
  ops: TIME_RANGE_CHIPS.map((value) => ({ value, label: value })),
  dashboard: [
    { value: "24h", label: "24h" },
    { value: "7d", label: "7d" },
    { value: "30d", label: "30d" },
    { value: "90d", label: "90d" },
    { value: "6M", label: "6mo" },
    { value: "12M", label: "1y" },
  ],
};

// Dashboards are read by the period, so the longest calendar units come first.
const CALENDAR_UNIT_ORDER: Readonly<Record<TimeRangePreset, readonly string[]>> = {
  ops: ["day", "week", "month", "quarter", "year"],
  dashboard: ["quarter", "month", "year", "week", "day"],
};

/** Calendar rows in the preset's unit order; rows of one unit keep their own order. */
export const orderCalendarItems = <T extends { token: string }>(
  items: readonly T[],
  preset: TimeRangePreset,
): T[] => {
  const order = CALENDAR_UNIT_ORDER[preset];
  const rank = (item: T) => {
    const index = order.indexOf(item.token.split(":")[1] ?? "");
    return index === -1 ? order.length : index;
  };
  return [...items].sort((a, b) => rank(a) - rank(b));
};

export type TimeRangeListKind =
  "pinned" | "recent" | "calendar" | "suggestion" | "anchor" | "to-now" | "reading" | "example";

/** What the typed text can look like, shown while nothing in the list matches it. */
export const TIME_INPUT_EXAMPLES = [
  { text: "2h", description: "dateTime.exampleRolling" },
  { text: "yesterday 9-17", description: "dateTime.examplePartOfDay" },
  { text: "Nov 4 – 6", description: "dateTime.exampleWholeDays" },
  { text: "21:13:49 ± 30s", description: "dateTime.exampleAroundTime" },
  { text: "Q3 2025", description: "dateTime.examplePeriod" },
] as const;

/** A page limit in its largest whole unit, as chips write ranges: 168 hours is `7d`. */
export const formatLimitShorthand = (hours: number): string =>
  hours >= 24 && hours % 24 === 0 ? `${hours / 24}d` : `${hours}h`;

export type ScrollCue = "top" | "bottom" | "both" | null;

/** Which edges of a scroll box hide rows, so a shadow can say the list goes on. */
export const scrollCue = (box: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}): ScrollCue => {
  const above = box.scrollTop > 1;
  const below = box.scrollTop + box.clientHeight < box.scrollHeight - 1;
  if (above && below) return "both";
  if (above) return "top";
  return below ? "bottom" : null;
};

/** A matched stretch of a row's label, as [start, end) character offsets. */
export type LabelMatch = [number, number];

/** One row of the picker's single list, already formatted for display. */
export interface TimeRangeListRow {
  id: string;
  kind: TimeRangeListKind;
  label: string;
  /** Muted text at the row end: the resolved range, a duration, or why the row is unavailable. */
  meta: string;
  /** The meta is a limit reason, so it reads as one (lock icon) instead of a range. */
  reason?: boolean;
  /** Shorthand shown beside a suggestion (`3m`, `15mo`). */
  hint?: string;
  tooltip?: string;
  disabled: boolean;
  testId: string;
  /** Rows in another group than the one above get a divider. */
  group?: number;
  /** The rolling period or calendar token the row applies, for rows that hold one. */
  period?: string;
  match?: LabelMatch[];
}

export interface RangeLimits {
  /** First instant (µs) inside retention; null while retention is unknown or unlimited. */
  retentionFloorUs: number | null;
  /** The page's query-range limit in hours; 0 means none. */
  maxHours: number;
}

export interface RangeLimitText {
  retention: string;
  restriction: string;
}

/** The first instant inside a retention of whole days; null when there is none to apply. */
export const retentionFloorMicros = (
  retentionDays: number | null | undefined,
  nowMs: number,
): number | null =>
  retentionDays && retentionDays > 0 ? nowMs * 1000 - retentionDays * MICROS_PER_DAY : null;

/** Why a range cannot be picked, or null; a range only partly inside retention stays pickable. */
export const rangeLimitReason = (
  startUs: number,
  endUs: number,
  limits: RangeLimits,
  text: RangeLimitText,
): string | null => {
  if (limits.retentionFloorUs !== null && endUs <= limits.retentionFloorUs) return text.retention;
  if (limits.maxHours > 0 && (endUs - startUs) / MICROS_PER_HOUR > limits.maxHours) {
    return text.restriction;
  }
  return null;
};

/** What the list offers outside Recent: pinned ranges, chips and calendar rows. */
export interface OfferedElsewhere {
  pinned: TimeRangeHistoryEntry[];
  chips: readonly string[];
  calendarTokens: readonly string[];
}

/** Whether a pin, chip or calendar row already offers the entry, so Recent never shows it. */
export const isOfferedElsewhere = (
  entry: TimeRangeHistoryEntry,
  offered: OfferedElsewhere,
): boolean => {
  if (offered.pinned.some((pin) => sameHistoryEntry(pin, entry))) return true;
  if (!isRelativeHistoryEntry(entry)) return false;
  return offered.chips.includes(entry.relative) || offered.calendarTokens.includes(entry.relative);
};

/** Recent entries worth a row: not the applied range and not offered elsewhere in the list. */
export const visibleRecentEntries = (
  recent: TimeRangeHistoryEntry[],
  options: OfferedElsewhere & { applied: TimeRangeHistoryEntry | null },
): TimeRangeHistoryEntry[] =>
  recent.filter(
    (entry) =>
      !(options.applied && sameHistoryEntry(entry, options.applied)) &&
      !isOfferedElsewhere(entry, options),
  );

/** Joins the non-empty groups into one list, numbering groups so the view can draw dividers. */
export const composeTimeRangeList = (groups: TimeRangeListRow[][]): TimeRangeListRow[] =>
  groups
    .filter((rows) => rows.length > 0)
    .flatMap((rows, group) => rows.map((row) => ({ ...row, group })));

const wordStarts = (label: string): { word: string; start: number }[] =>
  [...label.matchAll(/[\p{L}\p{N}]+/gu)].map((match) => ({
    word: match[0].toLowerCase(),
    start: match.index ?? 0,
  }));

/** Where every typed word of letters starts a word of the label, in order; null when one does not. */
export const matchWordPrefixes = (label: string, text: string): LabelMatch[] | null => {
  // Numbers and units glued to them (`15M`, `9am`) are read by the bar, so only words of letters filter rows.
  const typed = (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((word) =>
    /^\p{L}+$/u.test(word),
  );
  if (typed.length === 0) return null;
  const words = wordStarts(label);
  const matches: LabelMatch[] = [];
  let from = 0;
  for (const part of typed) {
    const index = words.findIndex((word, i) => i >= from && word.word.startsWith(part));
    if (index === -1) return null;
    matches.push([words[index].start, words[index].start + part.length]);
    from = index + 1;
  }
  return matches;
};

/** The rows whose label every typed word prefixes, plus rows applying the period the text reads as. */
export const filterTimeRangeList = (
  rows: TimeRangeListRow[],
  text: string,
  readPeriod: string | null = null,
): TimeRangeListRow[] =>
  rows.flatMap((row) => {
    const match = matchWordPrefixes(row.label, text);
    if (match) return [{ ...row, match }];
    return readPeriod !== null && row.period === readPeriod ? [{ ...row, match: [] }] : [];
  });

/** A label split into plain and matched pieces, for bolding the match. */
export const splitLabelMatches = (
  label: string,
  match: LabelMatch[] | undefined,
): { text: string; matched: boolean }[] => {
  if (!match?.length) return [{ text: label, matched: false }];
  const pieces: { text: string; matched: boolean }[] = [];
  let at = 0;
  for (const [start, end] of match) {
    if (start > at) pieces.push({ text: label.slice(at, start), matched: false });
    pieces.push({ text: label.slice(start, end), matched: true });
    at = end;
  }
  if (at < label.length) pieces.push({ text: label.slice(at), matched: false });
  return pieces;
};

/** The next enabled row index from `from` in a direction, wrapping; -1 when none is enabled. */
export const stepListCursor = (
  rows: { disabled: boolean }[],
  from: number,
  direction: 1 | -1,
): number => {
  const count = rows.length;
  for (let step = 1; step <= count; step++) {
    const index = (((from + direction * step) % count) + count) % count;
    if (!rows[index].disabled) return index;
  }
  return -1;
};

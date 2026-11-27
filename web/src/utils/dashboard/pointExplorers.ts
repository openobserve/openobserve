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

import { fieldPredicate, type FieldFilter } from "@/utils/dashboard/chartPointExplore";
import { resolveBrowserTimezone } from "@/utils/timezone";
import { gt } from "@/types/i18n";

const ONE_MINUTE_US = 60_000_000;

/** A trace's detail window: its own start and end, one minute wider on each side, in µs. */
export const traceDetailWindow = (trace: {
  trace_start_time: number;
  trace_end_time: number;
}): { startTime: number; endTime: number } => ({
  startTime: Math.floor(trace.trace_start_time) - ONE_MINUTE_US,
  endTime: Math.ceil(trace.trace_end_time) + ONE_MINUTE_US,
});

const ONE_SECOND_US = 1_000_000;

/** The whole second holding an event (µs): the Logs page's picker keeps whole seconds, so this is
 * the narrowest range that survives its round trip. */
export const eventSecondWindow = (ts: number): { startTime: number; endTime: number } => {
  const startTime = Math.floor(ts / ONE_SECOND_US) * ONE_SECOND_US;
  return { startTime, endTime: startTime + ONE_SECOND_US };
};

/** The next page exists while the last one came back full; the traces list has no total. */
export const hasFullPage = (rows: number, pageSize: number): boolean =>
  rows > 0 && rows >= pageSize;

/** The clicked labels the metric carries; any other would match no sample, so it is left out. */
export const labelsOnMetric = (filters: FieldFilter[], labels: string[]): FieldFilter[] => {
  const known = new Set(labels);
  return filters.filter((f) => known.has(f.field));
};

/** Chips or "write your own", shared by the three explorers so a choice in one is how the others
 * open; separate from the Logs and Traces pages' own keys. */
export const EXPLORER_FILTER_MODE_KEY = "o2.dashboard.explorer.queryInput";

/** The explorers' list query: every column of the stream under a WHERE condition, newest first. */
export const explorerSql = (stream: string, where: string): string => {
  const condition = where.trim();
  return `SELECT * FROM "${stream}"${condition ? ` WHERE ${condition}` : ""} ORDER BY _timestamp DESC`;
};

const EXPLORER_SQL =
  /^SELECT\s+\*\s+FROM\s+"([^"]+)"(?:\s+WHERE\s+([\s\S]+?))?\s+ORDER\s+BY\s+_timestamp\s+DESC\s*;?$/i;

/** The WHERE condition of an SQL still in the list query's plain shape on this stream, else null. */
export const whereOfExplorerSql = (stream: string, sql: string): string | null => {
  const match = sql.trim().match(EXPLORER_SQL);
  if (!match || match[1] !== stream) return null;
  return (match[2] ?? "").trim();
};

// The label filters as a WHERE condition.
const labelsWhere = (filters: FieldFilter[]): string => filters.map(fieldPredicate).join(" AND ");

/** The raw-sample SQL of a metric under its label filters, newest first. */
export const metricsSql = (stream: string, filters: FieldFilter[]): string =>
  explorerSql(stream, labelsWhere(filters));

// A sample's own columns: its time, its value and the engine's bookkeeping, not labels.
const isSampleColumn = (key: string): boolean => key === "value" || key.startsWith("_");

/** The label set that names a sample's series: every column but its time, value and internals. */
export const sampleLabels = (row: Record<string, unknown>): FieldFilter[] =>
  Object.entries(row)
    .filter(([key]) => !isSampleColumn(key))
    .map(([field, value]) => ({
      field,
      value: value === null || value === undefined || value === "" ? null : String(value),
    }));

/** The backend's message without its Error# prefix, ParserError("…") wrapper or traces "invalid
 * filter" lead; the HTTP message only when the backend sent none. */
export const explorerErrorText = (e: unknown): string => {
  const err = e as { message?: unknown; response?: { data?: Record<string, unknown> } } | null;
  const body = err?.response?.data ?? {};
  const backend = [body.error, body.message, body.error_detail].find(
    (v) => typeof v === "string" && v.trim(),
  ) as string | undefined;
  const raw = backend ?? (typeof err?.message === "string" ? err.message : "") ?? "";
  const text = raw
    .trim()
    .replace(/^Error#\s*/i, "")
    .replace(/\b[A-Z]\w*Error\("([\s\S]*)"\)/, (_m, inner: string) => inner.replace(/\\"/g, '"'))
    // The traces endpoint repeats its own lead: "invalid filter: invalid filter expression: sql …".
    .replace(/^(?:invalid filter(?: expression)?:\s*)+/i, "")
    .replace(/^sql\b/i, "SQL")
    .trim();
  return text || String(gt("panel.logExplorer.searchFailed"));
};

const EXPLORER_DATE: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
};
const EXPLORER_CLOCK: Intl.DateTimeFormatOptions = {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
};

const formatIn = (ts: unknown, timezone: string, options: Intl.DateTimeFormatOptions): string => {
  if (!ts) return "—";
  const value = Number(ts);
  const date = new Date(value > 1e13 ? value / 1000 : value);
  const zone = resolveBrowserTimezone(timezone);
  try {
    return date.toLocaleString(undefined, { ...options, timeZone: zone || undefined });
  } catch {
    // An unknown zone name falls back to the browser's, rather than showing nothing.
    return date.toLocaleString(undefined, options);
  }
};

/** An event's time (µs or ms) in the app's timezone, as the explorers list and title it. */
export const explorerTime = (ts: unknown, timezone: string): string =>
  formatIn(ts, timezone, EXPLORER_DATE);

/** The clock time alone, for the explorers' histogram axis and surrounding events. */
export const explorerClock = (ts: unknown, timezone: string): string =>
  formatIn(ts, timezone, EXPLORER_CLOCK);

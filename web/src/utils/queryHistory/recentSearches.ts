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

import { DateTime } from "luxon";
import type {
  HistoryContext,
  HistorySource,
  HistoryStatus,
  HistoryTime,
  QueryHistoryEntry,
} from "@/services/query_history";

/** Rows in the focus dropdown and the clock-button popover. */
export const POPOVER_ROWS = 8;
/** Clock rows offered in autocomplete while typing. */
export const AUTOCOMPLETE_ROWS = 5;
const MAX_CONTEXT_BYTES = 64 * 1024;
// Keyed by the list itself: autocomplete asks on every keystroke, the list changes only when a run lands.
const flatQueryCache = new WeakMap<readonly string[], string[]>();
const MAX_MESSAGE_CHARS = 1000;
const CANCELLED_CODE = 20009;
const TIMEOUT_CODE = 20010;
const QUERY_ERROR_CODES = new Set([20001, 20002, 20003, 20004, 20005, 20007, 20008, 20011]);
const DAY_MS = 86_400_000;

export interface KeyParts {
  streams: string[];
  streamType: string;
  mode: string;
  query: string;
  vrl?: string;
}

/** The pages with recent searches; "All pages" lists, counts and clears exactly these, never dbm or profiles. */
export const HISTORY_SOURCES: readonly HistorySource[] = ["logs", "traces", "metrics"];

/** A failed run as the page saw it: the search error code, the HTTP status, the message. */
export interface RunError {
  code?: number;
  httpStatus?: number;
  message?: string;
}

export interface RunResult {
  status: HistoryStatus;
  error?: string;
  warning?: string;
}

export interface RecentRow {
  entry: QueryHistoryEntry;
  starred: boolean;
}

export interface RecentsView {
  pinnedFailure: RecentRow | null;
  rows: RecentRow[];
}

export type RestoreTime = "now" | "original";

export type RestoreWindow =
  { type: "relative"; period: string } | { type: "absolute"; startUs: number; endUs: number };

/** What an editor needs from its open recent-searches dropdown to hand it keys. */
export interface RecentsKeyTarget {
  focusFirst: () => boolean;
  pickActive: (event: KeyboardEvent) => boolean;
  scrollDetails?: (step: 1 | -1) => boolean;
}

export interface DayGroup {
  /** Local midnight of the day, in milliseconds. */
  dayMs: number;
  /** 0 for today, 1 for yesterday, and so on. */
  daysAgo: number;
  entries: QueryHistoryEntry[];
}

/** Runs with the same streams, mode, query and VRL merge into one row, however far apart they ran. */
export const buildQueryKey = (parts: KeyParts): string =>
  JSON.stringify([
    [...parts.streams].sort(),
    parts.streamType,
    parts.mode,
    parts.query,
    parts.vrl ?? "",
  ]);

/** Message text without HTML markup, capped so the context stays small. */
export const plainMessage = (message: unknown): string =>
  String(message ?? "")
    // Only HTML tags: PromQL errors quote tokens such as `<EOF>`.
    .replace(/<\/?(br|span|b|i|em|strong|p|div|code)\b[^>]*>/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_MESSAGE_CHARS);

/** A search error from any transport; a streamed error event carries the HTTP status in `code`. */
export const toRunError = (error: {
  code?: unknown;
  status?: unknown;
  message?: unknown;
}): RunError => {
  const code = Number(error.code);
  const status = Number(error.status);
  const httpStatus = status >= 100 && status < 600 ? status : undefined;
  return {
    ...(code >= 20000 ? { code } : {}),
    ...(code >= 100 && code < 600 && httpStatus === undefined ? { httpStatus: code } : {}),
    ...(httpStatus !== undefined ? { httpStatus } : {}),
    message: String(error.message ?? ""),
  };
};

/** Null for a cancelled run, which is never recorded; only query errors count as failures. */
export const runResultFromError = (err: RunError): RunResult | null => {
  if (err.code === CANCELLED_CODE) return null;
  const message = plainMessage(err.message);
  const timedOut = err.code === TIMEOUT_CODE || err.httpStatus === 408 || err.httpStatus === 504;
  if (timedOut) return { status: "ok", warning: message };
  const clientError =
    err.httpStatus !== undefined &&
    err.httpStatus >= 400 &&
    err.httpStatus < 500 &&
    err.httpStatus !== 429;
  if ((err.code !== undefined && QUERY_ERROR_CODES.has(err.code)) || clientError) {
    return { status: "error", error: message };
  }
  return { status: "ok", warning: message };
};

export const resultContext = (result: RunResult): Pick<HistoryContext, "error" | "warning"> => ({
  ...(result.error !== undefined ? { error: result.error } : {}),
  ...(result.warning !== undefined ? { warning: result.warning } : {}),
});

const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

/** The backend refuses a context over 64 KB; columns go first, the query, VRL and time never. */
export const fitContext = (context: HistoryContext): HistoryContext => {
  if (jsonBytes(context) <= MAX_CONTEXT_BYTES || !context.page?.columns) return context;
  const page = { ...context.page };
  delete page.columns;
  return { ...context, page };
};

/** The 8-row list: newest first, one row per entry, the latest failure pinned on top. */
export const buildRecents = (entries: QueryHistoryEntry[], limit = POPOVER_ROWS): RecentsView => {
  const sorted = [...entries].sort((a, b) => b.updated_at - a.updated_at);
  const toRow = (entry: QueryHistoryEntry): RecentRow => ({ entry, starred: entry.starred });
  const pinned = sorted[0]?.status === "error" ? sorted[0] : null;
  const rows = sorted
    .filter((e) => e.status !== "error")
    .slice(0, pinned ? limit - 1 : limit)
    .map(toRow);
  return { pinnedFailure: pinned ? toRow(pinned) : null, rows };
};

/** Recent successful queries, newest first, each text once: autocomplete only replaces the editor text. */
export const recentQueryList = (entries: QueryHistoryEntry[]): string[] => [
  ...new Set(buildRecents(entries, entries.length).rows.map(({ entry }) => entry.query.trim())),
];

const flatQuery = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

const flatQueries = (queries: readonly string[]): string[] => {
  let flat = flatQueryCache.get(queries);
  if (!flat) {
    flat = queries.map(flatQuery);
    flatQueryCache.set(queries, flat);
  }
  return flat;
};

/** Recent queries that contain the typed text, prefix matches first. */
export const matchRecentQueries = (
  queries: string[],
  typed: string,
  limit = AUTOCOMPLETE_ROWS,
): string[] => {
  const needle = flatQuery(typed);
  if (needle.length < 2) return [];
  const flat = flatQueries(queries);
  return queries
    .map((query, i) => ({ query, at: flat[i].indexOf(needle), same: flat[i] === needle }))
    .filter(({ at, same }) => at >= 0 && !same)
    .sort((a, b) => Number(b.at === 0) - Number(a.at === 0))
    .slice(0, limit)
    .map(({ query }) => query);
};

const zoned = (zone?: string) => (zone ? { zone } : {});

const dayStart = (ms: number, zone?: string) =>
  DateTime.fromMillis(ms, zoned(zone)).startOf("day").toMillis();

/** Re-run over a window ending now when the row last ran today; otherwise at its own window. */
export const defaultRestoreTime = (
  entry: QueryHistoryEntry,
  now = Date.now(),
  zone?: string,
): RestoreTime =>
  dayStart(entry.updated_at / 1000, zone) === dayStart(now, zone) ? "now" : "original";

/** The window a restore applies, or null when the row carries no time. */
export const restoreWindow = (
  time: HistoryTime | undefined,
  when: RestoreTime,
  nowUs = Date.now() * 1000,
): RestoreWindow | null => {
  if (!time) return null;
  if (when === "original") {
    return { type: "absolute", startUs: time.start_time, endUs: time.end_time };
  }
  if (time.type === "relative" && time.period) return { type: "relative", period: time.period };
  const span = Math.max(0, time.end_time - time.start_time);
  return { type: "absolute", startUs: nowUs - span, endUs: nowUs };
};

/** Rows grouped by the day they last ran in `zone` (the browser's when unset), newest day first. */
export const groupByDay = (
  entries: QueryHistoryEntry[],
  now = Date.now(),
  zone?: string,
): DayGroup[] => {
  const today = dayStart(now, zone);
  const groups = new Map<number, DayGroup>();
  for (const entry of entries) {
    const dayMs = dayStart(entry.updated_at / 1000, zone);
    let group = groups.get(dayMs);
    if (!group) {
      group = { dayMs, daysAgo: Math.round((today - dayMs) / DAY_MS), entries: [] };
      groups.set(dayMs, group);
    }
    group.entries.push(entry);
  }
  return [...groups.values()].sort((a, b) => b.dayMs - a.dayMs);
};

/** Bounds of a `YYYY-MM-DD` day in `zone`, in microseconds, for the "Ran on" filter. */
export const dayBoundsUs = (
  date: string,
  zone?: string,
): { ran_from: number; ran_to: number } | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const start = DateTime.fromISO(date, zoned(zone)).startOf("day");
  if (!start.isValid) return null;
  return {
    ran_from: start.toMillis() * 1000,
    ran_to: start.plus({ days: 1 }).toMillis() * 1000 - 1,
  };
};

/** Absolute URL of a page route with its query string. */
export const absoluteLink = (href: string, origin = window.location.origin): string =>
  new URL(href, origin).href;

/** After an edit the focus dropdown shows only on an empty editor, and reopens only when the edit empties it. */
export const recentsOpenAfterEdit = (open: boolean, wasEmpty: boolean, isEmpty: boolean): boolean =>
  isEmpty && (open || !wasEmpty);

/** True inside the Monaco query editor itself, not the AI prompt or buttons that share its box. */
export const isQueryEditorInput = (target: EventTarget | null): boolean => {
  const el = target instanceof Node && !(target instanceof Element) ? target.parentElement : target;
  return el instanceof Element && !!el.closest(".monaco-editor");
};

/** Routes an editor key to its open recent-searches dropdown; bind in the capture phase. */
export const routeEditorKeyToRecents = (
  event: KeyboardEvent,
  dropdown: RecentsKeyTarget | null,
  close: () => void,
  /** False while the editor holds text, such as the Logs SQL template, so ArrowDown stays a cursor move. */
  arrowsToList = true,
) => {
  if (!isQueryEditorInput(event.target)) return;
  if (event.key === "Escape") {
    close();
    return;
  }
  // The editor's own suggestion list keeps its arrows and Enter.
  const box = event.currentTarget instanceof Element ? event.currentTarget : null;
  if (box?.querySelector(".suggest-widget.visible")) return;
  const page = event.key === "PageDown" ? 1 : event.key === "PageUp" ? -1 : 0;
  if (page && dropdown?.scrollDetails?.(page)) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (event.key === "ArrowDown" && arrowsToList && dropdown?.focusFirst()) {
    event.preventDefault();
    return;
  }
  const plainEnter = event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey;
  // Enter picks only a row the user pointed at; otherwise it stays the editor's newline.
  if (plainEnter && dropdown?.pickActive(event)) {
    event.preventDefault();
    event.stopPropagation();
  }
};

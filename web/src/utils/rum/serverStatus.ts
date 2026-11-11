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

import { sqlIn } from "@/utils/query/sqlFilterBuilder";
import { normalizeTraceId } from "@/utils/rum/fields";
import { TRACE_RANGE_PADDING_US } from "@/utils/rum/traceWindow";

// The pure part of the server status lookup for failed requests in the session player. A failed
// request the browser saw as status 0 may have been answered by the backend; the lookup asks the trace's server span.

/** The server span's status columns, newer semconv first, and the column for its service. */
export const SERVER_STATUS_COLUMNS = ["http_response_status_code", "http_status_code"];
export const SERVER_SERVICE_COLUMN = "service_name";

const SECOND_US = 1_000_000;
const MINUTE_MS = 60_000;

/** Each side of a failed request's own time window. */
export const SERVER_WINDOW_MARGIN_US = 5 * 60 * SECOND_US;
/** A device clock further than this from the server's arrival time is not trusted at all. */
export const SERVER_MAX_SKEW_US = 60 * 60 * SECOND_US;
/** The window before the arrival time when the device clock is not trusted. */
export const SERVER_UNTRUSTED_LOOKBACK_US = 30 * 60 * SECOND_US;
/** A span can land after the request, so "no server span found" waits until the row is this old. */
export const SERVER_MIN_AGE_MS = 2 * MINUTE_MS;
/** Gaps between asks about one trace (after the 1st, 2nd and 3rd ask). */
export const SERVER_RETRY_BACKOFF_MS = [30_000, 2 * MINUTE_MS, 10 * MINUTE_MS];
/** Asks about one trace, answered or failed; the last one ends it. */
export const SERVER_MAX_ATTEMPTS = 4;

export type ServerLookup = "found" | "no_server_span" | "unknown" | "no_trace";

/** What is known about one trace; an id without an entry has not been asked yet. */
export interface ServerStatusEntry {
  found: boolean;
  status?: string;
  service?: string;
  /** A verified "no server span found"; it is still re-asked, see serverAskDue. */
  negative?: boolean;
  /** The viewer's clock at the last ask, answered or failed. */
  checkedAt: number;
  attempts: number;
}

export interface ServerLookupView {
  lookup: ServerLookup;
  status?: string;
  service?: string;
}

/** One failed request: the device's own clock (`date`) and the server's arrival time, both µs, 0 when missing. */
export interface FailedRequestTimes {
  dateUs: number;
  arrivalUs: number;
}

export interface UsWindow {
  start: number;
  end: number;
}

/** What an entry shows: a status wins, then a verified miss; a blank status and anything unproven are unknown. */
export const entryLookup = (entry?: ServerStatusEntry): ServerLookupView => {
  if (!entry) return { lookup: "unknown" };
  if (entry.found && entry.status) {
    return { lookup: "found", status: entry.status, service: entry.service || undefined };
  }
  if (!entry.found && entry.negative) return { lookup: "no_server_span" };
  return { lookup: "unknown" };
};

/** What a row shows, as one string: bookkeeping that changes nothing visible never counts as a change. */
const shownKey = (entry?: ServerStatusEntry): string => {
  const { lookup, status, service } = entryLookup(entry);
  return `${lookup}|${status ?? ""}|${service ?? ""}`;
};

/** When the server received the request, in ms; the device's date only when there is no arrival time. */
export const arrivalMs = (times: FailedRequestTimes): number =>
  times.arrivalUs > 0 ? times.arrivalUs / 1000 : times.dateUs > 0 ? times.dateUs / 1000 : 0;

/** The newest arrival of a trace's failed requests, in ms (0 when none has a time). */
export const newestArrivalMs = (rows: FailedRequestTimes[]): number =>
  rows.reduce((newest, row) => Math.max(newest, arrivalMs(row)), 0);

/**
 * How old a trace is, on the viewer's clock. The server's arrival time can be read against a staff clock that runs
 * fast, so the time this viewer first saw the trace id caps the age too: nothing is older than the viewer has known
 * it. A trace with neither time is never old.
 */
export const traceAgeMs = (arrival: number, nowMs: number, firstSeenMs?: number): number => {
  const ages: number[] = [];
  if (arrival > 0) ages.push(nowMs - arrival);
  if (firstSeenMs !== undefined) ages.push(nowMs - firstSeenMs);
  return ages.length ? Math.min(...ages) : 0;
};

/**
 * Whether a trace is to be asked now. A trace is asked again while it has no final answer, with backoff, until
 * the attempts run out; `dueAt` says when a later ask comes due.
 */
export const serverAskDue = (
  entry: ServerStatusEntry | undefined,
  nowMs: number,
): { ask: boolean; dueAt?: number } => {
  if (!entry) return { ask: true };
  if (entry.found && entry.status) return { ask: false };
  if (entry.attempts >= SERVER_MAX_ATTEMPTS) return { ask: false };
  const gap = SERVER_RETRY_BACKOFF_MS[Math.min(entry.attempts, SERVER_RETRY_BACKOFF_MS.length) - 1];
  const dueAt = entry.checkedAt + gap;
  return nowMs >= dueAt ? { ask: true } : { ask: false, dueAt };
};

/** The earliest server span with a status wins (and names the service); a trace with only blank statuses is found without one. */
export const spanStatus = (row: any): string => {
  for (const column of SERVER_STATUS_COLUMNS) {
    const value = String(row?.[column] ?? "").trim();
    if (value) return value;
  }
  return "";
};

/** What else `recordSpans` weighs before it calls a trace a miss. */
export interface RecordSpansOptions {
  /** When this viewer first saw each trace id, in ms (see traceAgeMs). */
  firstSeen?: Map<string, number>;
  /** Traces whose device clock is further from the arrival time than SERVER_MAX_SKEW_US: their request time is uncertain. */
  skewed?: Set<string>;
}

/**
 * Records the answer of a span search for `traceIds`, and returns whether what a row shows changed. "No server
 * span found" is recorded only for a complete answer about a trace old enough (by its newest arrival, capped by
 * when this viewer first saw it), so a partial page, a young row or a skewed device clock stays unknown.
 * It mutates `entries`: that map is the store, and the caller owns it.
 */
export const recordSpans = (
  entries: Map<string, ServerStatusEntry>,
  traceIds: string[],
  rows: any[],
  complete: boolean,
  newestArrivals: Map<string, number>,
  nowMs: number,
  options: RecordSpansOptions = {},
): boolean => {
  const earliest = new Map<string, { start: number; status: string; service: string }>();
  const seen = new Set<string>();
  for (const row of rows) {
    const traceId = normalizeTraceId(row?.trace_id);
    if (!traceId) continue;
    seen.add(traceId);
    const status = spanStatus(row);
    const start = Number(row.start_time) || 0;
    const current = earliest.get(traceId);
    if (status && (!current || start < current.start)) {
      earliest.set(traceId, {
        start,
        status,
        service: String(row?.[SERVER_SERVICE_COLUMN] ?? "").trim(),
      });
    }
  }
  let changed = false;
  for (const traceId of traceIds) {
    const previous = entries.get(traceId);
    const base = { checkedAt: nowMs, attempts: (previous?.attempts ?? 0) + 1 };
    let next: ServerStatusEntry;
    if (seen.has(traceId)) {
      const span = earliest.get(traceId);
      next = { ...base, found: true, status: span?.status, service: span?.service };
    } else if (previous?.found) {
      next = { ...previous, ...base };
    } else if (
      complete &&
      // A device clock far from the arrival time leaves the real request time uncertain, so a miss stays Unknown.
      !options.skewed?.has(traceId) &&
      traceAgeMs(newestArrivals.get(traceId) ?? 0, nowMs, options.firstSeen?.get(traceId)) >
        SERVER_MIN_AGE_MS
    ) {
      next = { ...base, found: false, negative: true };
    } else {
      next = { ...base, found: false, negative: previous?.negative };
    }
    changed = shownKey(previous) !== shownKey(next) || changed;
    entries.set(traceId, next);
  }
  return changed;
};

/**
 * Records an ask that could not be answered (an error, or no stream to ask). It counts as an attempt, and the
 * attempt cap ends it: the trace stays as it was shown, Unknown unless an earlier ask proved more.
 * It mutates `entries`: that map is the store, and the caller owns it.
 */
export const recordFailure = (
  entries: Map<string, ServerStatusEntry>,
  traceIds: string[],
  nowMs: number,
): boolean => {
  let changed = false;
  for (const traceId of traceIds) {
    const previous = entries.get(traceId);
    const next: ServerStatusEntry = {
      ...(previous ?? { found: false }),
      checkedAt: nowMs,
      attempts: (previous?.attempts ?? 0) + 1,
    };
    changed = shownKey(previous) !== shownKey(next) || changed;
    entries.set(traceId, next);
  }
  return changed;
};

/** Whether a search response is the whole answer: no partial result, no function error (a list of messages). */
export const isCompleteResponse = (data: any): boolean =>
  !data?.is_partial && !data?.function_error?.length;

const errorText = (error: any): string =>
  [error?.response?.data?.message, error?.response?.data?.error, error?.message]
    .filter((part) => typeof part === "string")
    .join(" ");

/** Only a missing column or field may narrow the select; any other error is not about the columns. */
export const isMissingColumnError = (error: any): boolean => {
  const text = errorText(error);
  return /no such (column|field)|no field named|(column|field)\b[^.]{0,60}\b(not found|does not exist|not exist|missing|unknown)|\b(unknown|missing|invalid)\b[^.]{0,30}\b(column|field)/i.test(
    text,
  );
};

/** The name of the column or field a missing-column error is about, as the column is written in the query; null when the text has none. */
export const missingColumnName = (error: any): string | null => {
  const text = errorText(error);
  // DataFusion: `Schema error: No field named <name>. Valid fields are ...`; the name may be quoted or qualified.
  // A parsed name that is not one of our columns ends the retries (nextServerColumns returns null): the safe direction.
  const patterns = [
    /no field named\s+((?:[`"']?[\w$-]+[`"']?\.)*[`"']?[\w$-]+[`"']?)/i,
    /(?:column|field)\s+[`"']([\w$.-]+)[`"']\s+(?:does not exist|not found|is missing|not exist)/i,
    /(?:no such|unknown|missing) (?:column|field)[:\s]+[`"']?([\w$.-]+)/i,
  ];
  for (const pattern of patterns) {
    const found = pattern.exec(text)?.[1];
    if (!found) continue;
    const name = found.replace(/[`"']/g, "").split(".").pop();
    if (name) return name;
  }
  return null;
};

/** The columns tried when the schema is unknown and the missing one cannot be named: both statuses and the service, then each status alone, then none. */
export const SERVER_COLUMN_LADDER: string[][] = [
  [...SERVER_STATUS_COLUMNS, SERVER_SERVICE_COLUMN],
  ...SERVER_STATUS_COLUMNS.map((column) => [column]),
  [],
];

/** A column set as one string, for the `tried` set of nextServerColumns. */
export const serverColumnsKey = (columns: string[]): string => columns.join(",");

/**
 * The column sets to try for one stream, in order. A known schema gives one set (the columns it has). Without one
 * the ladder is tried (see SERVER_COLUMN_LADDER): a span with no status is still a span.
 */
export const serverColumnSets = (schemaNames: string[] | null): string[][] => {
  if (schemaNames?.length) {
    const names = new Set(schemaNames);
    return [SERVER_COLUMN_LADDER[0].filter((column) => names.has(column))];
  }
  return SERVER_COLUMN_LADDER.map((columns) => [...columns]);
};

/**
 * The columns to retry with after `error` on `current`, or null when the error is not about a missing column or
 * retrying would not help. A named missing column is dropped (so each column is dropped at most once, and the
 * service column stays unless it is the missing one); an error that names none moves down the ladder to a set not
 * tried yet. `tried` holds the keys of the sets already tried (see serverColumnsKey) and is added to by the caller.
 */
export const nextServerColumns = (
  current: string[],
  tried: Set<string>,
  error: any,
): string[] | null => {
  if (!isMissingColumnError(error)) return null;
  const missing = missingColumnName(error);
  if (missing) {
    if (!current.includes(missing)) return null;
    const next = current.filter((column) => column !== missing);
    return tried.has(serverColumnsKey(next)) ? null : next;
  }
  return SERVER_COLUMN_LADDER.find((columns) => !tried.has(serverColumnsKey(columns))) ?? null;
};

export const serverSpansSql = (stream: string, columns: string[], traceIds: string[]): string =>
  `select ${["trace_id", "start_time", ...columns].join(", ")} from "${stream.replace(/"/g, '""')}" where span_kind = '2' and ${sqlIn("trace_id", traceIds)} order by start_time asc`;

/** Whether a request's device clock is too far from the server's arrival time to say when it really ran. */
export const isSkewed = ({ dateUs, arrivalUs }: FailedRequestTimes): boolean =>
  arrivalUs > 0 && dateUs > 0 && Math.abs(dateUs - arrivalUs) > SERVER_MAX_SKEW_US;

/**
 * The window (µs) to look for one failed request's spans in, or null when it has no time at all. Spans are
 * stamped by the server, so the arrival time leads: the window covers the device's date and the arrival time with
 * a margin, and a device clock further than an hour off is ignored.
 */
export const failedRequestWindowUs = ({
  dateUs,
  arrivalUs,
}: FailedRequestTimes): UsWindow | null => {
  if (arrivalUs > 0 && dateUs > 0 && Math.abs(dateUs - arrivalUs) <= SERVER_MAX_SKEW_US) {
    return {
      start: Math.min(dateUs, arrivalUs) - SERVER_WINDOW_MARGIN_US,
      end: Math.max(dateUs, arrivalUs) + SERVER_WINDOW_MARGIN_US,
    };
  }
  if (arrivalUs > 0) {
    // A distrusted device clock (or none): look back from the arrival.
    return dateUs > 0
      ? {
          start: arrivalUs - SERVER_UNTRUSTED_LOOKBACK_US,
          end: arrivalUs + SERVER_WINDOW_MARGIN_US,
        }
      : { start: arrivalUs - SERVER_WINDOW_MARGIN_US, end: arrivalUs + SERVER_WINDOW_MARGIN_US };
  }
  if (dateUs > 0) {
    return { start: dateUs - SERVER_WINDOW_MARGIN_US, end: dateUs + SERVER_WINDOW_MARGIN_US };
  }
  return null;
};

/** The window of one batch: every failed request's own window, joined. Null when none has a time. */
export const batchWindowUs = (rows: FailedRequestTimes[]): UsWindow | null => {
  let window: UsWindow | null = null;
  for (const row of rows) {
    const own = failedRequestWindowUs(row);
    if (!own) continue;
    window = window
      ? { start: Math.min(window.start, own.start), end: Math.max(window.end, own.end) }
      : own;
  }
  return window;
};

/** Widens a window with the traces' indexed ranges (server-derived, padded as the trace views pad them). */
export const widenWindowUs = (
  window: UsWindow,
  ranges: ({ start_time: number; end_time: number } | undefined)[],
): UsWindow => {
  let { start, end } = window;
  for (const range of ranges) {
    if (!range) continue;
    start = Math.min(start, range.start_time - TRACE_RANGE_PADDING_US);
    end = Math.max(end, range.end_time + TRACE_RANGE_PADDING_US);
  }
  return { start, end };
};

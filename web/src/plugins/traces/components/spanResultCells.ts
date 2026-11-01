// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { normalizeSpanEvents, truncateEventName } from "@/composables/traces/useSpanEvents";
import { spanErrorText, type SpanErrorText } from "@/plugins/traces/utils/traceErrorSummary";

/** Most events listed in the Events cell's hover; the rest are counted as "+N more". */
export const EVENTS_HOVER_LIMIT = 10;

/** Virtual Spans-view columns: computed per row, never stream fields. */
export const SPAN_ERROR_COLUMN_ID = "_span_error";
export const SPAN_EVENTS_COLUMN_ID = "_span_events";

const NS_PER_US = 1000;

export type SpanErrorCell = SpanErrorText;

export type SpanEventKind = "exception" | "log";

export interface SpanEventItem {
  key: string;
  kind: SpanEventKind;
  offsetUs: number;
  text: string;
}

export interface SpanEventsCell {
  total: number;
  exceptions: number;
  logs: number;
  hasException: boolean;
  /** Time-ordered, capped at EVENTS_HOVER_LIMIT. */
  items: SpanEventItem[];
  moreCount: number;
}

export interface SpanResultCells {
  error: SpanErrorCell | null;
  events: SpanEventsCell;
}

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

// start_time is nanoseconds; the row timestamp column is already microseconds.
const spanStartUs = (row: Record<string, unknown>, timestampField: string): number | null => {
  const startNs = Number(row.start_time);
  if (Number.isFinite(startNs) && startNs > 0) return startNs / NS_PER_US;
  const ts = Number(row[timestampField]);
  return Number.isFinite(ts) && ts > 0 ? ts : null;
};

/** Derives the Spans-view Error and Events cells from one raw span row. */
export const buildSpanResultCells = (
  row: Record<string, unknown>,
  timestampField: string = "_timestamp",
): SpanResultCells => {
  const normalized = normalizeSpanEvents(row.events).sort((a, b) => a.tsUs - b.tsUs);

  let error: SpanErrorCell | null = null;
  if (row.span_status === "ERROR") {
    const picked = spanErrorText(row);
    if (picked.message || picked.code) error = picked;
  }

  const startUs = spanStartUs(row, timestampField);
  const exceptions = normalized.filter((event) => event.isException).length;
  const items = normalized.slice(0, EVENTS_HOVER_LIMIT).map((event) => ({
    key: `${event.index}-${event.tsUs}`,
    kind: (event.isException ? "exception" : "log") as SpanEventKind,
    offsetUs: startUs === null ? 0 : Math.max(0, Math.round(event.tsUs - startUs)),
    text: truncateEventName(text(event.exceptionMessage) || event.name),
  }));

  return {
    error,
    events: {
      total: normalized.length,
      exceptions,
      logs: normalized.length - exceptions,
      hasException: exceptions > 0,
      items,
      moreCount: Math.max(0, normalized.length - EVENTS_HOVER_LIMIT),
    },
  };
};

const cellsByRow = new WeakMap<object, SpanResultCells>();

/** Memoized per row object so a re-rendered cell does not re-parse the events JSON. */
export const spanResultCellsFor = (
  row: Record<string, unknown>,
  timestampField: string = "_timestamp",
): SpanResultCells => {
  let cells = cellsByRow.get(row);
  if (!cells) {
    cells = buildSpanResultCells(row, timestampField);
    cellsByRow.set(row, cells);
  }
  return cells;
};

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

import { computed, type ComputedRef } from "vue";

/**
 * Span-event semantics shared by the trace waterfall and the span sidebar.
 *
 * Both surfaces answer the same three questions about a span's events — is the
 * payload parseable, when did the event happen, is it an exception — but plot
 * them against different windows: the waterfall against the whole trace, the
 * sidebar against the single span. This module owns the semantics; callers own
 * their window.
 *
 * UNITS: a span event's `_timestamp` is raw OTLP `time_unix_nano`
 * (nanoseconds) — see `Event` in src/common/src/meta/traces.rs and the
 * ingestion site in src/core/src/traces/mod.rs. Span timing on the frontend is
 * in microseconds. `_timestamp` therefore means different units on a span than
 * on its events, which is why the conversion lives here and nowhere else.
 */

const NS_PER_US = 1000;

/** OTel semconv: the exception event name and its attribute namespace. */
const EXCEPTION_EVENT_NAME = "exception";
const EXCEPTION_ATTR_PREFIX = "exception.";
const EXCEPTION_TYPE_ATTR = "exception.type";

/** Serialized field name of `Event._timestamp`; used when no column is configured. */
const DEFAULT_TIMESTAMP_FIELD = "_timestamp";

export interface NormalizedSpanEvent {
  /** Position in the span's original events array — the sidebar table's row id. */
  index: number;
  name: string;
  /** Event time in microseconds, converted from the stored nanoseconds. */
  tsUs: number;
  isException: boolean;
  /** `exception.type` when present, else the event name. */
  exceptionType: string;
}

export interface SpanEventMarker extends NormalizedSpanEvent {
  key: string;
  /** Offset within the caller's window, as a percentage in [0, 100]. */
  left: number;
}

export interface SpanEventWindow {
  startUs: number;
  durationUs: number;
}

const isExceptionEvent = (event: Record<string, unknown>): boolean =>
  event.name === EXCEPTION_EVENT_NAME ||
  Object.keys(event).some((key) => key.startsWith(EXCEPTION_ATTR_PREFIX));

/**
 * Reads the event timestamp, preferring the configured timestamp column and
 * falling back to the serialized field name. The backend always writes
 * `_timestamp` for events, but the sidebar's events table reads the configured
 * column, so both names are accepted to keep the two views in agreement.
 */
const readTimestampNs = (event: Record<string, unknown>, timestampField: string): number | null => {
  const raw = event[timestampField] ?? event[DEFAULT_TIMESTAMP_FIELD];
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
};

/**
 * Parses a span's `events` payload into normalized events.
 *
 * Accepts an array or a JSON string (how the backend stores it) and never
 * throws: malformed JSON, non-array payloads, and events without a usable
 * timestamp yield no entry rather than breaking the trace view.
 */
export const normalizeSpanEvents = (
  rawEvents: unknown,
  timestampField: string = DEFAULT_TIMESTAMP_FIELD,
): NormalizedSpanEvent[] => {
  let parsed: unknown = rawEvents;

  if (typeof rawEvents === "string") {
    if (!rawEvents.trim()) return [];
    try {
      parsed = JSON.parse(rawEvents);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(parsed)) return [];

  return parsed.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const event = entry as Record<string, unknown>;

    const timestampNs = readTimestampNs(event, timestampField);
    if (timestampNs === null) return [];

    const name = String(event.name ?? "");
    const isException = isExceptionEvent(event);

    return [
      {
        index,
        name,
        tsUs: timestampNs / NS_PER_US,
        isException,
        exceptionType: String(event[EXCEPTION_TYPE_ATTR] ?? name),
      },
    ];
  });
};

/**
 * Positions normalized events within a window, dropping any that fall outside
 * it. An event carrying no meaningful time (e.g. `_timestamp: 0`) lands far
 * before the window and is dropped rather than pinned to an invented position.
 */
export const toSpanEventMarkers = (
  events: NormalizedSpanEvent[],
  window: SpanEventWindow,
): SpanEventMarker[] => {
  const startUs = Number(window?.startUs);
  const durationUs = Number(window?.durationUs);

  if (!Number.isFinite(startUs) || !Number.isFinite(durationUs) || durationUs <= 0) {
    return [];
  }

  return events.flatMap((event) => {
    const left = ((event.tsUs - startUs) / durationUs) * 100;
    if (left < 0 || left > 100) return [];

    return [{ ...event, key: `${event.index}-${event.tsUs}`, left }];
  });
};

/**
 * Reactive wrapper over the two functions above, for components that render
 * markers from a span's events against a window.
 */
export const useSpanEventMarkers = (
  getRawEvents: () => unknown,
  getWindow: () => SpanEventWindow,
  getTimestampField: () => string = () => DEFAULT_TIMESTAMP_FIELD,
): ComputedRef<SpanEventMarker[]> =>
  computed(() =>
    toSpanEventMarkers(normalizeSpanEvents(getRawEvents(), getTimestampField()), getWindow()),
  );

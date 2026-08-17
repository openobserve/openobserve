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

/**
 * Slack, in microseconds, allowed at each end of a window before an event is
 * treated as foreign.
 *
 * A span's `duration` is stored as integer microseconds, so a window's computed
 * end is up to 1us short of the true end and an event firing at the real end
 * lands just past 100%. One microsecond is wide enough to absorb that truncation
 * and far too narrow to admit an event from a neighbouring span.
 */
const WINDOW_TOLERANCE_US = 1;

/** OTel semconv: the exception event name and its attribute namespace. */
const EXCEPTION_EVENT_NAME = "exception";
const EXCEPTION_ATTR_PREFIX = "exception.";
const EXCEPTION_TYPE_ATTR = "exception.type";

/**
 * Severity-bearing fields, in the order they are consulted.
 *
 * `level` is not OTel semconv — it comes from OpenObserve's own Rust `tracing`
 * instrumentation and is present on 100% of events in the `default` stream but
 * absent from OTLP SDK data. `severity_text` is the OTel logs field some SDKs
 * mirror onto events. Neither covers both producers, so both are read.
 */
const SEVERITY_FIELDS = ["level", "severity_text"] as const;

const ERROR_LEVELS = new Set(["ERROR", "FATAL", "CRITICAL"]);
const WARNING_LEVELS = new Set(["WARN", "WARNING"]);

export type SpanEventSeverity = "error" | "warning" | "info";

/**
 * Marker fill per severity tier, as design-token utility classes.
 *
 * Shared by every surface so the waterfall, the sidebar mini-timeline and the
 * flame graph read as one vocabulary. Colour is never the only channel carrying
 * severity — see the row event-count badge in TraceTree.
 *
 * Info is achromatic on purpose. The waterfall bar is filled with an arbitrary
 * per-service colour, so a hue-based info tick can land invisibly on a same-hue
 * bar; a 50%-alpha modifier holds contrast against any fill. Error and warning
 * keep their hues, where the colour is semantic.
 *
 * The halo (`ring-1 ring-surface-base`) is therefore carried per tier, not by
 * every marker. A ring is 1px on all four sides of a 2px-wide tick, so it is
 * half the mark's width and ~62% of its area — and `ring-surface-base` is
 * opaque while the achromatic info fill is not. On an info tick the ring would
 * out-contrast the mark it is supposed to outline. Error and warning need it
 * because a saturated fill can land on a same-hue bar with nothing separating
 * them; info does not, because luminance already does that job.
 */
export const SEVERITY_MARKER_CLASS: Record<SpanEventSeverity, string> = {
  error: "bg-badge-error-solid-bg ring-1 ring-surface-base",
  warning: "bg-badge-warning-solid-bg ring-1 ring-surface-base",
  info: "bg-trace-event-info",
};

/**
 * The same tiers as CSS custom-property names.
 *
 * The flame graph renders into a canvas and cannot take utility classes, so it
 * resolves these at draw time. Keeping the two lists adjacent is what stops the
 * surfaces drifting apart.
 */
export const SEVERITY_MARKER_TOKEN: Record<SpanEventSeverity, string> = {
  error: "--color-badge-error-solid-bg",
  warning: "--color-badge-warning-solid-bg",
  info: "--color-trace-event-info",
};

/** Serialized field name of `Event._timestamp`; used when no column is configured. */
const DEFAULT_TIMESTAMP_FIELD = "_timestamp";

export interface NormalizedSpanEvent {
  /** Position in the span's original events array — the sidebar table's row id. */
  index: number;
  name: string;
  /** Event time in microseconds, converted from the stored nanoseconds. */
  tsUs: number;
  severity: SpanEventSeverity;
  /** `exception.type` when present, else the event name. */
  exceptionType: string;
}

export interface SpanEventMarker extends NormalizedSpanEvent {
  key: string;
  /** Offset within the caller's window, as a percentage in [0, 100]. */
  left: number;
}

/**
 * Display budget for an event name, in characters.
 *
 * Event names are not labels — in the `default` stream they are whole log lines
 * (median 119 characters, longest observed 5561). Both the tooltip and the
 * accessible name are truncated to this budget; the full text lives in the
 * events table.
 */
export const EVENT_NAME_MAX_CHARS = 80;

/** Collapses whitespace and truncates an event name to the display budget. */
export const truncateEventName = (name: string): string => {
  const flat = name.replace(/\s+/g, " ").trim();
  return flat.length <= EVENT_NAME_MAX_CHARS ? flat : `${flat.slice(0, EVENT_NAME_MAX_CHARS)}…`;
};

export interface SpanEventWindow {
  startUs: number;
  durationUs: number;
}

const isExceptionEvent = (event: Record<string, unknown>): boolean =>
  event.name === EXCEPTION_EVENT_NAME ||
  Object.keys(event).some((key) => key.startsWith(EXCEPTION_ATTR_PREFIX));

/**
 * Resolves an event's severity tier.
 *
 * Precedence is exception-first: an event carrying exception semantics is an
 * error regardless of what its `level` says, because the exception attributes
 * are the stronger claim.
 */
const resolveSeverity = (event: Record<string, unknown>): SpanEventSeverity => {
  if (isExceptionEvent(event)) return "error";

  for (const field of SEVERITY_FIELDS) {
    const raw = event[field];
    if (typeof raw !== "string") continue;
    const level = raw.toUpperCase();
    if (ERROR_LEVELS.has(level)) return "error";
    if (WARNING_LEVELS.has(level)) return "warning";
  }

  return "info";
};

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

    return [
      {
        index,
        name,
        tsUs: timestampNs / NS_PER_US,
        severity: resolveSeverity(event),
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

  const tolerancePercent = (WINDOW_TOLERANCE_US / durationUs) * 100;

  return events.flatMap((event) => {
    const left = ((event.tsUs - startUs) / durationUs) * 100;
    if (left < -tolerancePercent || left > 100 + tolerancePercent) return [];

    return [
      {
        ...event,
        key: `${event.index}-${event.tsUs}`,
        left: Math.min(100, Math.max(0, left)),
      },
    ];
  });
};

/**
 * Counts a span's events and how many are error-severity.
 *
 * This is the honest fallback: markers can only show events that position
 * inside a window, and 10.3% of spans in the `default` stream are narrower
 * than one pixel. A count is always true.
 */
export const summarizeSpanEvents = (
  rawEvents: unknown,
  timestampField: string = DEFAULT_TIMESTAMP_FIELD,
): { total: number; errors: number } => {
  const events = normalizeSpanEvents(rawEvents, timestampField);
  return {
    total: events.length,
    errors: events.filter((event) => event.severity === "error").length,
  };
};

/**
 * Minimum on-screen distance, in CSS pixels, between two marker centres before
 * they are treated as one cluster.
 *
 * Derived from the marker's own width plus a gutter. Jaeger buckets at a fixed
 * 0.2% of the timeline; at the measured 882px waterfall width that is 1.76px —
 * narrower than the marker, so a fixed percentage would still overlap. Working
 * in pixels also keeps the rule correct when the sidebar opens and the timeline
 * resizes.
 */
export const MARKER_MIN_SPACING_PX = 6;

export interface SpanEventCluster {
  key: string;
  /** The cluster's position within the window, as a percentage in [0, 100]. */
  left: number;
  /** The highest severity present in the cluster. */
  severity: SpanEventSeverity;
  /** Every event in the cluster, ordered by time. */
  events: SpanEventMarker[];
}

const SEVERITY_RANK: Record<SpanEventSeverity, number> = { info: 0, warning: 1, error: 2 };

/**
 * Groups markers that would render on top of one another into single clusters.
 *
 * Nothing is dropped: every event remains reachable through the cluster it
 * belongs to. A cluster reports the highest severity it contains, so one
 * exception among nine INFO events still reads as an error.
 */
export const clusterSpanEventMarkers = (
  markers: SpanEventMarker[],
  containerWidthPx: number,
): SpanEventCluster[] => {
  if (!markers.length) return [];

  const width = Number(containerWidthPx);
  // Before the container has been measured, a percentage threshold cannot be
  // derived; render every marker rather than guessing a bucket width.
  const minSpacingPercent =
    Number.isFinite(width) && width > 0 ? (MARKER_MIN_SPACING_PX / width) * 100 : 0;

  const ordered = [...markers].sort((a, b) => a.tsUs - b.tsUs);
  const clusters: SpanEventCluster[] = [];

  for (const marker of ordered) {
    const current = clusters[clusters.length - 1];

    if (current && marker.left - current.left < minSpacingPercent) {
      current.events.push(marker);
      if (SEVERITY_RANK[marker.severity] > SEVERITY_RANK[current.severity]) {
        current.severity = marker.severity;
      }
      continue;
    }

    clusters.push({
      key: marker.key,
      left: marker.left,
      severity: marker.severity,
      events: [marker],
    });
  }

  return clusters;
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

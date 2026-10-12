/**
 * Trace Type Definitions
 * Types for distributed traces and trace metadata
 */

import { type Span, type SpanStatus } from "./span.types";

/**
 * Search mode for the traces explorer
 */
export type TraceSearchMode = "traces" | "spans" | "service-graph" | "services-catalog";

export const TRACE_SEARCH_MODES: readonly TraceSearchMode[] = [
  "traces",
  "spans",
  "service-graph",
  "services-catalog",
];

export const DEFAULT_TRACE_SEARCH_MODE: TraceSearchMode = "spans";

/** A RED-chart selection, keyed by panel id in `searchObj.meta.metricsRangeFilters`. */
export type MetricsRangeFilter = {
  panelTitle: string;
  // Duration µs; null for Rate and Errors, whose selection is time only.
  start: number | null;
  end: number | null;
  timeStart?: number | null;
  timeEnd?: number | null;
  // Every selection: what it applied, to tell when a later search no longer reflects it.
  appliedStart: number;
  appliedEnd: number;
  baselineFilter: string;
  stream: string;
  searchMode: TraceSearchMode;
};

export const isTraceSearchMode = (value: unknown): value is TraceSearchMode =>
  typeof value === "string" && TRACE_SEARCH_MODES.some((mode) => mode === value);

export const resolveTraceSearchMode = (
  value: unknown,
  serviceGraphEnabled: boolean,
): TraceSearchMode => {
  if (!isTraceSearchMode(value)) return DEFAULT_TRACE_SEARCH_MODE;
  if (value === "service-graph" && !serviceGraphEnabled) return DEFAULT_TRACE_SEARCH_MODE;
  return value;
};

/**
 * Trace - Collection of spans representing a single request
 */
export interface Trace {
  trace_id: string;
  spans: Span[];
  startTime: number; // Earliest span start time
  endTime: number; // Latest span end time
  duration: number; // Total trace duration in microseconds
  spanCount: number; // Total number of spans
  serviceCount: number; // Number of unique services
  errorCount: number; // Number of error spans
}

/**
 * Trace View State - UI state for trace details view
 */
export interface TraceViewState {
  // Selected items
  selected_span_id: string | null;
  expanded_span_ids: Set<string>;

  // Filters
  active_filters: {
    services: Set<string>;
    statuses: Set<SpanStatus>;
    kinds: Set<string>;
    duration_range: [number, number] | null;
    search_text: string;
    attribute_filters: Map<string, any>;
    error_only: boolean;
  };

  // Timeline
  timeline: {
    zoom_level: number; // 1 = fit all, >1 = zoomed in
    pan_offset: number; // Horizontal offset in px
    viewport_width: number; // Width of timeline area
  };

  // Panel visibility
  panels: {
    filters_visible: boolean;
    analytics_visible: boolean;
    details_visible: boolean;
  };

  // Sorting
  sort_field: string;
  sort_ascending: boolean;

  // View mode
  view_mode: "tree" | "list" | "timeline";
}

/**
 * Trace Data Response - API response format
 */
export interface TraceDataResponse {
  trace_id: string;
  spans: Span[];
  total_spans: number;
  start_time: number;
  end_time: number;
}

/**
 * Trace Error - Error information from a span
 */
export interface TraceError {
  span_id: string;
  service_name: string;
  operation_name: string;
  error_message: string;
  error_type?: string;
  stack_trace?: string;
  timestamp: number;
}

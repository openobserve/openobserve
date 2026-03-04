/**
 * Trace Type Definitions
 * Types for distributed traces and trace metadata
 */

import { type Span, type EnrichedSpan, type SpanStatus } from './span.types';

/**
 * Trace - Collection of spans representing a single request
 */
export interface Trace {
  trace_id: string;
  spans: Span[];
  startTime: number;     // Earliest span start time
  endTime: number;       // Latest span end time
  duration: number;      // Total trace duration in microseconds
  spanCount: number;     // Total number of spans
  serviceCount: number;  // Number of unique services
  errorCount: number;    // Number of error spans
}

/**
 * Trace Tree - Hierarchical representation of spans
 */
export interface TraceTree {
  trace_id: string;
  rootSpan: EnrichedSpan;
  flatSpans: EnrichedSpan[];    // All spans in flat array
  spanMap: Map<string, EnrichedSpan>; // Quick lookup by span_id
  criticalPath: string[];        // Span IDs on critical path
  metadata: TraceMetadata;
}

/**
 * Trace Metadata - Aggregated information about the trace
 */
export interface TraceMetadata {
  // Identifiers
  trace_id: string;
  root_service: string;
  root_operation: string;

  // Timing
  start_time: number;
  end_time: number;
  duration_ms: number;

  // Counts
  total_spans: number;
  error_spans: number;
  service_count: number;

  // Services involved
  services: string[];
  service_spans: Map<string, number>; // service -> span count
  service_durations: Map<string, number>; // service -> total duration

  // Span kind breakdown
  span_kinds: Map<string, number>; // kind -> count

  // Status breakdown
  status_counts: {
    ok: number;
    error: number;
    unset: number;
  };

  // Performance
  critical_path_duration: number; // Duration of longest path
  critical_path_percent: number;  // % of total duration
  slowest_spans: EnrichedSpan[];  // Top 5 slowest spans

  // Error information
  has_errors: boolean;
  error_services: string[];       // Services with errors
  error_messages: string[];       // Unique error messages
}

/**
 * Trace Statistics - For analytics panel
 */
export interface TraceStatistics {
  // Overview
  total_duration_ms: number;
  total_spans: number;
  services_count: number;
  error_rate: number; // Percentage

  // Service breakdown
  service_breakdown: ServiceBreakdown[];

  // Span kind distribution
  span_kind_distribution: {
    kind: string;
    count: number;
    percentage: number;
  }[];

  // Performance metrics
  avg_span_duration: number;
  median_span_duration: number;
  p95_span_duration: number;
  p99_span_duration: number;

  // Database & external calls
  database_calls: number;
  external_api_calls: number;
  internal_calls: number;
}

/**
 * Service Breakdown - Time spent per service
 */
export interface ServiceBreakdown {
  service_name: string;
  span_count: number;
  total_duration_ms: number;
  percentage: number;
  color: string; // From color palette
  has_errors: boolean;
  error_count: number;
}

/**
 * Critical Path - Longest chain of dependent spans
 */
export interface CriticalPath {
  span_ids: string[];
  spans: EnrichedSpan[];
  total_duration: number;
  percentage_of_trace: number;
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
    zoom_level: number;      // 1 = fit all, >1 = zoomed in
    pan_offset: number;      // Horizontal offset in px
    viewport_width: number;  // Width of timeline area
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
  view_mode: 'tree' | 'list' | 'timeline';
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

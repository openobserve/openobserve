/**
 * Trace Span Type Definitions
 * OpenTelemetry compliant span types for OpenObserve
 */

/**
 * Span Kind - OpenTelemetry standard span kinds
 */
export enum SpanKind {
  UNSPECIFIED = "UNSPECIFIED",
  INTERNAL = "INTERNAL",
  SERVER = "SERVER",
  CLIENT = "CLIENT",
  PRODUCER = "PRODUCER",
  CONSUMER = "CONSUMER",
}

/**
 * Span Status - Execution status of the span
 */
export enum SpanStatus {
  UNSET = "UNSET",
  OK = "OK",
  ERROR = "ERROR",
}

/**
 * Span Event - Timestamped log within a span
 */
export interface SpanEvent {
  name: string;
  timestamp: number;
  attributes?: Record<string, any>;
}

/**
 * Span Link - Reference to another span
 */
export interface SpanLink {
  traceId: string;
  spanId: string;
  traceState?: string;
  attributes?: Record<string, any>;
}

/**
 * Base Span Interface - Raw span data from backend
 */
export interface Span {
  // Core identifiers
  span_id: string;
  trace_id: string;
  parent_span_id?: string;

  // Timing
  start_time: number; // Unix timestamp in nanoseconds
  end_time: number; // Unix timestamp in nanoseconds
  duration: number; // Duration in microseconds

  // Metadata
  service_name: string;
  operation_name: string;
  span_kind?: SpanKind;
  span_status?: SpanStatus;

  // Attributes and tags
  attributes?: Record<string, any>;
  resource?: Record<string, any>;
  events?: SpanEvent[];
  links?: SpanLink[];

  // OpenObserve specific
  _timestamp: number;
  [key: string]: any; // Allow additional fields
}

/**
 * Enriched Span - Span with computed properties for UI
 */
export interface EnrichedSpan extends Span {
  // Hierarchy
  depth: number; // Tree depth (0 = root)
  children: EnrichedSpan[]; // Child spans
  hasChildren: boolean; // Quick check for children

  // UI state
  isExpanded: boolean; // Tree expansion state
  isSelected: boolean; // Selected in UI
  isOnCriticalPath: boolean; // Part of critical path

  // Computed values
  color: string; // Service color from palette
  durationMs: number; // Duration in milliseconds
  durationPercent: number; // % of total trace duration
  startOffsetMs: number; // Offset from trace start (ms)
  startOffsetPercent: number; // % offset from trace start

  // Display helpers
  serviceName: string; // Normalized service name
  operationName: string; // Normalized operation name
  statusIcon: string; // Icon name for status
  kindIcon: string; // Icon name for span kind
  hasError: boolean; // Quick error check
}

/**
 * Span Tree Node - For tree visualization
 */
export interface SpanTreeNode {
  span: EnrichedSpan;
  parent?: SpanTreeNode;
  children: SpanTreeNode[];
  index: number; // Visual index in flat list
}

/**
 * Span Filter Criteria
 */
export interface SpanFilter {
  services?: string[]; // Filter by service names
  statuses?: SpanStatus[]; // Filter by status
  kinds?: SpanKind[]; // Filter by span kind
  minDuration?: number; // Min duration in ms
  maxDuration?: number; // Max duration in ms
  searchText?: string; // Full-text search
  attributeFilters?: Record<string, any>; // Attribute key-value filters
  errorOnly?: boolean; // Show only error spans
}

/**
 * Span Sort Options
 */
export enum SpanSortField {
  TIMESTAMP = "timestamp",
  DURATION = "duration",
  SERVICE = "service",
  OPERATION = "operation",
}

export interface SpanSort {
  field: SpanSortField;
  ascending: boolean;
}

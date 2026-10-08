/**
 * Trace Processing Composable
 * Reactive utilities for processing and organizing trace data
 */

import { computed, type Ref } from "vue";
import {
  type Span,
  type EnrichedSpan,
  type SpanFilter,
  SpanKind,
  SpanStatus,
} from "@/ts/interfaces/traces/span.types";
import type { ServiceDetectionConfig } from "@/ts/interfaces/traces/serviceDetection.types";
import { useSpanServiceDetection } from "@/utils/traces/useSpanServiceDetection";
import { getOrSetServiceColor } from "@/utils/traces/serviceColorRegistry";
import { timestampToTimezoneDate } from "@/utils/timezone";

/**
 * Composable for trace data processing
 * @param spans - Either flat Span[] or nested tree with spans
 * @param spanMap - Map of spans for service detection
 * @param serviceDetectionConfig - Configuration for span service detection
 */
export function useTraceProcessing(
  spans: Ref<Span[] | any[]>,
  spanMap: Ref<{ [key: string]: Span }>,
  serviceDetectionConfig: Ref<ServiceDetectionConfig | null>,
) {
  const { resolveSpanIdentity } = useSpanServiceDetection(serviceDetectionConfig);
  /**
   * Convert old tree format to EnrichedSpan format and flatten
   * Handles tree nodes with 'spans' property (children) and 'depth' or calculates depth
   */
  const flattenOldTreeFormat = (treeNodes: any[], currentDepth = 0): EnrichedSpan[] => {
    const result: EnrichedSpan[] = [];

    // Get trace start time from the root node (old format stores it as lowestStartTime)
    const traceStartTimeUs =
      treeNodes.length > 0 && treeNodes[0].lowestStartTime ? treeNodes[0].lowestStartTime : 0;

    const convert = (node: any, depth: number) => {
      // Calculate startOffsetMs as offset from trace start
      const startOffsetMs = traceStartTimeUs
        ? (node.startTimeUs - traceStartTimeUs) / 1000
        : node.startTimeMs || 0;

      const resolvedIdentity = resolveSpanIdentity(spanMap.value[node.spanId] as Span);

      // Convert old format to EnrichedSpan
      const enrichedSpan: EnrichedSpan = {
        span_id: node.spanId || node.span_id,
        trace_id: node.traceId || node.trace_id || "",
        parent_span_id: node.parentId || node.parent_span_id || "",
        start_time: node.startTimeUs ? node.startTimeUs * 1000 : 0,
        end_time: node.endTimeUs ? node.endTimeUs * 1000 : 0,
        duration: node.durationUs || 0,
        service_name: node.serviceName || "unknown",
        operation_name: node.operationName || "unknown",
        span_kind: node.spanKind,
        span_status: node.spanStatus,
        attributes: node.attributes || {},
        _timestamp: node._timestamp || 0,
        depth: node.depth !== undefined ? node.depth : depth,
        children: [],
        hasChildren: !!(node.spans && node.spans.length > 0),
        isExpanded: true,
        isSelected: false,
        resolvedIdentity,
        color: getOrSetServiceColor(resolvedIdentity),
        durationMs: node.durationMs || 0,
        durationPercent: 0,
        startOffsetMs,
        startOffsetPercent: 0,
        serviceName: node.serviceName || "unknown",
        operationName: node.operationName || "unknown",
        statusIcon: getStatusIcon(node.spanStatus),
        kindIcon: getKindIcon(node.spanKind),
        hasError: node.spanStatus === SpanStatus.ERROR || node.spanStatus === "ERROR",
      };

      result.push(enrichedSpan);
    };

    // Pre-order over the old format's 'spans' children; an explicit stack, so trace depth never bounds the call stack.
    const stack: [any, number][] = [];
    for (let i = treeNodes.length - 1; i >= 0; i--) stack.push([treeNodes[i], currentDepth]);
    while (stack.length) {
      const [node, depth] = stack.pop()!;
      convert(node, depth);
      const children = node.spans && Array.isArray(node.spans) ? node.spans : [];
      for (let i = children.length - 1; i >= 0; i--) stack.push([children[i], depth + 1]);
    }
    return result;
  };

  /**
   * Check if input is old tree format (has 'spans' property for children)
   */
  const isOldTreeFormat = (data: any[]): boolean => {
    return (
      data.length > 0 && ("spanId" in data[0] || "spans" in data[0]) && !("children" in data[0])
    );
  };

  /**
   * Build hierarchical tree structure from flat span list
   */
  const buildSpanTree = (spanList: Span[]): EnrichedSpan[] => {
    if (!spanList || spanList.length === 0) return [];

    const spanMap = new Map<string, EnrichedSpan>();
    const rootSpans: EnrichedSpan[] = [];

    // A loop, not Math.min(...spans): spreading a large trace overflows the argument limit.
    let traceStartTime = Infinity;
    for (const span of spanList) {
      if (span.start_time < traceStartTime) traceStartTime = span.start_time;
    }

    // First pass: convert to enriched spans
    spanList.forEach((span) => {
      const resolvedIdentity = resolveSpanIdentity(span);
      const enriched: EnrichedSpan = {
        ...span,
        depth: 0,
        children: [],
        hasChildren: false,
        isExpanded: true,
        isSelected: false,
        resolvedIdentity,
        color: getOrSetServiceColor(resolvedIdentity),
        durationMs: span.duration / 1000, // Convert from microseconds to milliseconds
        durationPercent: 0,
        startOffsetMs: (span.start_time - traceStartTime) / 1000000, // Convert from nanoseconds to milliseconds
        startOffsetPercent: 0,
        serviceName: span.service_name || "unknown",
        operationName: span.operation_name || "unknown",
        statusIcon: getStatusIcon(span.span_status),
        kindIcon: getKindIcon(span.span_kind),
        hasError: span.span_status === SpanStatus.ERROR,
      };
      spanMap.set(span.span_id, enriched);
    });

    // Second pass: build hierarchy
    spanMap.forEach((span) => {
      if (span.parent_span_id && spanMap.has(span.parent_span_id)) {
        const parent = spanMap.get(span.parent_span_id)!;
        parent.children.push(span);
        parent.hasChildren = true;
      } else {
        rootSpans.push(span);
      }
    });

    // Depths and start-time child order in one walk; an explicit stack, so trace depth never bounds the call stack.
    const stack: [EnrichedSpan, number][] = rootSpans.map((span) => [span, 0]);
    while (stack.length) {
      const [span, depth] = stack.pop()!;
      span.depth = depth;
      span.children.sort((a, b) => a.start_time - b.start_time);
      for (const child of span.children) stack.push([child, depth + 1]);
    }

    return rootSpans;
  };

  /**
   * Flatten tree structure to linear array
   */
  const flattenSpanTree = (roots: EnrichedSpan[]): EnrichedSpan[] => {
    const result: EnrichedSpan[] = [];

    // Pre-order; an explicit stack, so trace depth never bounds the call stack.
    const stack = [...roots].reverse();
    while (stack.length) {
      const span = stack.pop()!;
      result.push(span);
      if (span.isExpanded) {
        for (let i = span.children.length - 1; i >= 0; i--) stack.push(span.children[i]);
      }
    }
    return result;
  };

  /**
   * Filter spans based on criteria
   */
  const filterSpans = (spanList: EnrichedSpan[], filter: SpanFilter): EnrichedSpan[] => {
    return spanList.filter((span) => {
      if (filter.services && filter.services.length > 0) {
        if (!filter.services.includes(span.service_name)) return false;
      }

      if (filter.statuses && filter.statuses.length > 0) {
        if (!filter.statuses.includes(span.span_status || SpanStatus.UNSET)) return false;
      }

      if (filter.kinds && filter.kinds.length > 0) {
        if (!filter.kinds.includes(span.span_kind || SpanKind.UNSPECIFIED)) return false;
      }

      if (filter.minDuration !== undefined && span.durationMs < filter.minDuration) {
        return false;
      }

      if (filter.maxDuration !== undefined && span.durationMs > filter.maxDuration) {
        return false;
      }

      if (filter.errorOnly && span.span_status !== SpanStatus.ERROR) {
        return false;
      }

      if (filter.searchText && filter.searchText.trim() !== "") {
        const searchLower = filter.searchText.toLowerCase();
        const matchesSearch =
          span.service_name.toLowerCase().includes(searchLower) ||
          span.operation_name.toLowerCase().includes(searchLower) ||
          span.span_id.toLowerCase().includes(searchLower) ||
          JSON.stringify(span.attributes || {})
            .toLowerCase()
            .includes(searchLower);

        if (!matchesSearch) return false;
      }

      if (filter.attributeFilters && Object.keys(filter.attributeFilters).length > 0) {
        for (const [key, value] of Object.entries(filter.attributeFilters)) {
          if (span.attributes?.[key] !== value) return false;
        }
      }

      return true;
    });
  };

  // Computed properties
  const spanTree = computed(() => {
    if (!spans.value || spans.value.length === 0) return [];

    // Check if it's the old tree format (from TraceDetails.vue)
    if (isOldTreeFormat(spans.value)) {
      // Don't need to return tree for old format, will flatten directly
      return [];
    }

    // Build tree from flat spans
    return buildSpanTree(spans.value as Span[]);
  });

  const flatSpans = computed(() => {
    if (!spans.value || spans.value.length === 0) return [];

    // Check if it's the old tree format (from TraceDetails.vue)
    if (isOldTreeFormat(spans.value)) {
      return flattenOldTreeFormat(spans.value);
    }

    // Flatten the built span tree
    return flattenSpanTree(spanTree.value);
  });

  return {
    // Methods
    buildSpanTree,
    flattenSpanTree,
    filterSpans,

    // Computed
    spanTree,
    flatSpans,
  };
}

/**
 * Helper functions
 */
function getStatusIcon(status?: SpanStatus): string {
  switch (status) {
    case SpanStatus.OK:
      return "check-circle";
    case SpanStatus.ERROR:
      return "error";
    default:
      return "radio-button-unchecked";
  }
}

export function getKindIcon(kind?: SpanKind): string {
  switch (kind) {
    case SpanKind.CLIENT:
      return "call-made";
    case SpanKind.SERVER:
      return "call-received";
    case SpanKind.PRODUCER:
      return "send";
    case SpanKind.CONSUMER:
      return "inbox";
    case SpanKind.INTERNAL:
      return "settings";
    default:
      return "help-outline";
  }
}

/**
 * Format duration for display
 */
export function formatDuration(durationMs: number): string {
  if (durationMs < 1) {
    return `${(durationMs * 1000).toFixed(0)}µs`;
  } else if (durationMs < 1000) {
    return `${durationMs.toFixed(2)}ms`;
  } else if (durationMs < 60000) {
    return `${(durationMs / 1000).toFixed(2)}s`;
  } else {
    const minutes = Math.floor(durationMs / 60000);
    const seconds = ((durationMs % 60000) / 1000).toFixed(0);
    return `${minutes}m ${seconds}s`;
  }
}

/**
 * Format timestamp for display
 * Example: "16 Feb 11:40:40.049 (10m ago)"
 *
 * The absolute date is rendered in the user-selected timezone (same as the
 * Logs page). Falls back to the browser timezone when none is provided.
 */
export function formatTimestamp(
  timestamp: number,
  timezone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  // Convert from nanoseconds to milliseconds
  const timestampMs = timestamp / 1000000;

  // Format: "16 Feb 11:40:40.049" in the selected timezone
  const formattedDate = timestampToTimezoneDate(timestampMs, timezone, "dd MMM HH:mm:ss.SSS");

  // Calculate relative time
  const now = Date.now();
  const diffMs = now - timestampMs;
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  let relativeTime: string;
  if (diffMs < 60000) {
    // Less than a minute
    const seconds = Math.floor(diffMs / 1000);
    relativeTime = `${seconds}s ago`;
  } else if (diffMinutes < 60) {
    // Less than an hour
    relativeTime = `${diffMinutes}m ago`;
  } else if (diffHours < 24) {
    // Less than a day
    relativeTime = `${diffHours}h ago`;
  } else {
    // Days
    relativeTime = `${diffDays}d ago`;
  }

  return `${formattedDate} (${relativeTime})`;
}

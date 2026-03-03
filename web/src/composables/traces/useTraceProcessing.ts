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
} from "@/types/traces/span.types";
import {
  type TraceMetadata,
  type ServiceBreakdown,
} from "@/types/traces/trace.types";
import { getServiceColor } from "@/utils/traces/traceColors";

/**
 * Composable for trace data processing
 * @param spans - Either flat Span[] or nested tree with spans
 */
export function useTraceProcessing(spans: Ref<Span[] | any[]>) {
  /**
   * Convert old tree format to EnrichedSpan format and flatten
   * Handles tree nodes with 'spans' property (children) and 'depth' or calculates depth
   */
  const flattenOldTreeFormat = (
    treeNodes: any[],
    currentDepth = 0,
  ): EnrichedSpan[] => {
    const result: EnrichedSpan[] = [];

    // Get trace start time from the root node (old format stores it as lowestStartTime)
    const traceStartTimeUs =
      treeNodes.length > 0 && treeNodes[0].lowestStartTime
        ? treeNodes[0].lowestStartTime
        : 0;

    const traverse = (node: any, depth: number) => {
      // Calculate startOffsetMs as offset from trace start
      const startOffsetMs = traceStartTimeUs
        ? (node.startTimeUs - traceStartTimeUs) / 1000
        : node.startTimeMs || 0;

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
        isOnCriticalPath: false,
        color: node.style?.color || "#9CA3AF",
        durationMs: node.durationMs || 0,
        durationPercent: 0,
        startOffsetMs,
        startOffsetPercent: 0,
        serviceName: node.serviceName || "unknown",
        operationName: node.operationName || "unknown",
        statusIcon: getStatusIcon(node.spanStatus),
        kindIcon: getKindIcon(node.spanKind),
        hasError:
          node.spanStatus === SpanStatus.ERROR || node.spanStatus === "ERROR",
      };

      result.push(enrichedSpan);

      // Process children (old format uses 'spans' property)
      if (node.spans && Array.isArray(node.spans)) {
        node.spans.forEach((child: any) => traverse(child, depth + 1));
      }
    };

    treeNodes.forEach((node) => traverse(node, currentDepth));
    return result;
  };

  /**
   * Check if input is old tree format (has 'spans' property for children)
   */
  const isOldTreeFormat = (data: any[]): boolean => {
    return (
      data.length > 0 &&
      ("spanId" in data[0] || "spans" in data[0]) &&
      !("children" in data[0])
    );
  };

  /**
   * Build hierarchical tree structure from flat span list
   */
  const buildSpanTree = (spanList: Span[]): EnrichedSpan[] => {
    if (!spanList || spanList.length === 0) return [];

    const spanMap = new Map<string, EnrichedSpan>();
    const rootSpans: EnrichedSpan[] = [];

    // Calculate trace start time (minimum start_time across all spans)
    const traceStartTime = Math.min(...spanList.map((s) => s.start_time));

    // First pass: convert to enriched spans
    spanList.forEach((span) => {
      const enriched: EnrichedSpan = {
        ...span,
        depth: 0,
        children: [],
        hasChildren: false,
        isExpanded: true,
        isSelected: false,
        isOnCriticalPath: false,
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

    // Calculate depths
    const calculateDepth = (span: EnrichedSpan, depth: number) => {
      span.depth = depth;
      span.children.forEach((child) => calculateDepth(child, depth + 1));
    };

    rootSpans.forEach((span) => calculateDepth(span, 0));

    // Sort children by start time
    const sortChildren = (span: EnrichedSpan) => {
      span.children.sort((a, b) => a.start_time - b.start_time);
      span.children.forEach(sortChildren);
    };

    rootSpans.forEach(sortChildren);

    return rootSpans;
  };

  /**
   * Flatten tree structure to linear array
   */
  const flattenSpanTree = (roots: EnrichedSpan[]): EnrichedSpan[] => {
    const result: EnrichedSpan[] = [];

    const traverse = (span: EnrichedSpan) => {
      result.push(span);
      if (span.isExpanded && span.children.length > 0) {
        span.children.forEach(traverse);
      }
    };

    roots.forEach(traverse);
    return result;
  };

  /**
   * Find critical path
   */
  const findCriticalPath = (rootSpans: EnrichedSpan[]): string[] => {
    let longestPath: string[] = [];
    let longestDuration = 0;

    const traverse = (span: EnrichedSpan, path: string[], duration: number) => {
      const newPath = [...path, span.span_id];
      const newDuration = duration + span.durationMs;

      if (span.children.length === 0) {
        if (newDuration > longestDuration) {
          longestDuration = newDuration;
          longestPath = newPath;
        }
      } else {
        span.children.forEach((child) => traverse(child, newPath, newDuration));
      }
    };

    rootSpans.forEach((span) => traverse(span, [], 0));
    return longestPath;
  };

  /**
   * Calculate trace metadata
   */
  const calculateMetadata = (
    traceId: string,
    spanTree: EnrichedSpan[],
  ): TraceMetadata => {
    const allSpans = flattenSpanTree(spanTree);

    if (allSpans.length === 0) {
      throw new Error("Cannot calculate metadata for empty trace");
    }

    const services = new Set<string>();
    const serviceSpans = new Map<string, number>();
    const serviceDurations = new Map<string, number>();
    const spanKinds = new Map<string, number>();
    const errorServices = new Set<string>();
    const errorMessages = new Set<string>();

    let errorCount = 0;
    let okCount = 0;
    let unsetCount = 0;
    let minTime = Infinity;
    let maxTime = 0;

    allSpans.forEach((span) => {
      services.add(span.service_name);
      serviceSpans.set(
        span.service_name,
        (serviceSpans.get(span.service_name) || 0) + 1,
      );
      serviceDurations.set(
        span.service_name,
        (serviceDurations.get(span.service_name) || 0) + span.durationMs,
      );

      const kind = span.span_kind || SpanKind.UNSPECIFIED;
      spanKinds.set(kind, (spanKinds.get(kind) || 0) + 1);

      if (span.span_status === SpanStatus.ERROR) {
        errorCount++;
        errorServices.add(span.service_name);
        if (span.attributes?.["error.message"]) {
          errorMessages.add(span.attributes["error.message"]);
        }
      } else if (span.span_status === SpanStatus.OK) {
        okCount++;
      } else {
        unsetCount++;
      }

      minTime = Math.min(minTime, span.start_time);
      maxTime = Math.max(maxTime, span.end_time);
    });

    const sorted = [...allSpans].sort((a, b) => b.durationMs - a.durationMs);
    const slowestSpans = sorted.slice(0, 5);

    const criticalPathIds = findCriticalPath(spanTree);
    const criticalPathDuration = criticalPathIds.reduce((sum, id) => {
      const span = allSpans.find((s) => s.span_id === id);
      return sum + (span?.durationMs || 0);
    }, 0);

    const totalDuration = (maxTime - minTime) / 1000000;

    return {
      trace_id: traceId,
      root_service: spanTree[0]?.service_name || "unknown",
      root_operation: spanTree[0]?.operation_name || "unknown",
      start_time: minTime,
      end_time: maxTime,
      duration_ms: totalDuration,
      total_spans: allSpans.length,
      error_spans: errorCount,
      service_count: services.size,
      services: Array.from(services),
      service_spans: serviceSpans,
      service_durations: serviceDurations,
      span_kinds: spanKinds,
      status_counts: { ok: okCount, error: errorCount, unset: unsetCount },
      critical_path_duration: criticalPathDuration,
      critical_path_percent: (criticalPathDuration / totalDuration) * 100,
      slowest_spans: slowestSpans,
      has_errors: errorCount > 0,
      error_services: Array.from(errorServices),
      error_messages: Array.from(errorMessages),
    };
  };

  /**
   * Calculate service breakdown
   */
  const calculateServiceBreakdown = (
    metadata: TraceMetadata,
  ): ServiceBreakdown[] => {
    const breakdown: ServiceBreakdown[] = [];

    metadata.services.forEach((serviceName) => {
      const spanCount = metadata.service_spans.get(serviceName) || 0;
      const totalDuration = metadata.service_durations.get(serviceName) || 0;
      const percentage = (totalDuration / metadata.duration_ms) * 100;
      const hasErrors = metadata.error_services.includes(serviceName);

      breakdown.push({
        service_name: serviceName,
        span_count: spanCount,
        total_duration_ms: totalDuration,
        percentage,
        color: getServiceColor(serviceName),
        has_errors: hasErrors,
        error_count: hasErrors ? metadata.error_spans : 0,
      });
    });

    breakdown.sort((a, b) => b.total_duration_ms - a.total_duration_ms);
    return breakdown;
  };

  /**
   * Filter spans based on criteria
   */
  const filterSpans = (
    spanList: EnrichedSpan[],
    filter: SpanFilter,
  ): EnrichedSpan[] => {
    return spanList.filter((span) => {
      if (filter.services && filter.services.length > 0) {
        if (!filter.services.includes(span.service_name)) return false;
      }

      if (filter.statuses && filter.statuses.length > 0) {
        if (!filter.statuses.includes(span.span_status || SpanStatus.UNSET))
          return false;
      }

      if (filter.kinds && filter.kinds.length > 0) {
        if (!filter.kinds.includes(span.span_kind || SpanKind.UNSPECIFIED))
          return false;
      }

      if (
        filter.minDuration !== undefined &&
        span.durationMs < filter.minDuration
      ) {
        return false;
      }

      if (
        filter.maxDuration !== undefined &&
        span.durationMs > filter.maxDuration
      ) {
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

      if (
        filter.attributeFilters &&
        Object.keys(filter.attributeFilters).length > 0
      ) {
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
    findCriticalPath,
    calculateMetadata,
    calculateServiceBreakdown,
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
      return "check_circle";
    case SpanStatus.ERROR:
      return "error";
    default:
      return "radio_button_unchecked";
  }
}

function getKindIcon(kind?: SpanKind): string {
  switch (kind) {
    case SpanKind.CLIENT:
      return "call_made";
    case SpanKind.SERVER:
      return "call_received";
    case SpanKind.PRODUCER:
      return "send";
    case SpanKind.CONSUMER:
      return "inbox";
    case SpanKind.INTERNAL:
      return "settings";
    default:
      return "help_outline";
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
 * Example: "16 Feb 11:40:40:049 (10m ago)"
 */
export function formatTimestamp(timestamp: number): string {
  // Convert from nanoseconds to milliseconds
  const timestampMs = timestamp / 1000000;
  const date = new Date(timestampMs);

  // Format: "16 Feb 11:40:40:049"
  const day = date.getDate();
  const month = date.toLocaleString("en-US", { month: "short" });
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const seconds = date.getSeconds().toString().padStart(2, "0");
  const milliseconds = date.getMilliseconds().toString().padStart(3, "0");

  const formattedDate = `${day} ${month} ${hours}:${minutes}:${seconds}:${milliseconds}`;

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

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

/**
 * Span instance for pattern detection
 */
export interface SpanInstance {
  spanId: string;
  duration: number;
  isError: boolean;
  timestamp: number;
  attributes: Record<string, any>;
  serviceName: string;
  operationName: string;
}

/**
 * Call pattern aggregated metrics
 */
export interface CallPattern {
  pathSignature: string; // "cache-service→database-service"
  instances: SpanInstance[];
  metrics: {
    count: number;
    avg: number;
    min: number;
    max: number;
    p75: number;
    p95: number;
    p99: number;
    totalDuration: number;
    errorRate: number;
    errorCount: number;
    traceTimePercent: number; // % of total trace duration
  };
  spanIds: string[]; // for drill-down capability
}

/**
 * Call path extracted from trace
 */
interface CallPath {
  services: string[];
  leafSpan: any; // The leaf span for this path
  duration: number;
  isError: boolean;
}

/**
 * Build consolidated call patterns from trace tree
 * Groups spans with identical service sequences and calculates aggregated metrics
 */
export function buildPatternConsolidatedTree(traceTree: any[]): Map<string, CallPattern> {
  if (!traceTree || traceTree.length === 0) {
    return new Map();
  }

  const patterns = new Map<string, CallPattern>();
  const allDurations: number[] = [];

  // Calculate total trace duration for percentage calculations
  let totalTraceDuration = 0;
  traceTree.forEach((rootSpan) => {
    totalTraceDuration = Math.max(totalTraceDuration, rootSpan.durationMs || 0);
  });

  /**
   * Extract services and their relationships from trace tree.
   * Single-pass: mutates collectors passed by reference rather than creating
   * intermediate per-level collections that get merged upward with spread.
   */
  const extractServicesAndRelationships = (
    spans: any[],
    parentService: string = "",
    relationships: CallPath[] = [],
    services: Map<string, { spans: any[]; totalDuration: number; errorCount: number }> = new Map(),
  ): void => {
    spans.forEach((span) => {
      const serviceName = span.resolvedIdentity || span.serviceName || "unknown";
      const duration = span.durationMs || 0;
      const isError = isSpanError(span);

      // Track all services (including standalone ones)
      if (!services.has(serviceName)) {
        services.set(serviceName, { spans: [], totalDuration: 0, errorCount: 0 });
      }
      const serviceInfo = services.get(serviceName)!;
      serviceInfo.spans.push(span);
      serviceInfo.totalDuration += duration;
      if (isError) serviceInfo.errorCount += 1;

      allDurations.push(duration);

      // If this span has a parent service and is a different service, record the relationship
      if (parentService && parentService !== serviceName) {
        relationships.push({
          services: [parentService, serviceName],
          leafSpan: span,
          duration,
          isError,
        });
      }

      // Recursively process child spans — mutates the same collectors in place
      if (span.spans && span.spans.length > 0) {
        extractServicesAndRelationships(span.spans, serviceName, relationships, services);
      }
    });
  };

  // Extract services and relationships from all root spans (single pass)
  const allPaths: CallPath[] = [];
  const allServices = new Map<
    string,
    { spans: any[]; totalDuration: number; errorCount: number }
  >();
  extractServicesAndRelationships(traceTree, "", allPaths, allServices);

  // Group paths by signature and aggregate metrics
  allPaths.forEach((path) => {
    const signature = path.services.join("→");

    if (!patterns.has(signature)) {
      patterns.set(signature, {
        pathSignature: signature,
        instances: [],
        metrics: {
          count: 0,
          avg: 0,
          min: Infinity,
          max: 0,
          p75: 0,
          p95: 0,
          p99: 0,
          totalDuration: 0,
          errorRate: 0,
          errorCount: 0,
          traceTimePercent: 0,
        },
        spanIds: [],
      });
    }

    const pattern = patterns.get(signature)!;

    // Add span instance
    pattern.instances.push({
      spanId: path.leafSpan.span_id || path.leafSpan.spanId || "",
      duration: path.duration,
      isError: path.isError,
      timestamp: path.leafSpan.start_time || 0,
      attributes: path.leafSpan.attributes || {},
      serviceName: path.leafSpan.serviceName || "",
      operationName: path.leafSpan.operationName || path.leafSpan.operation_name || "",
    });

    pattern.spanIds.push(path.leafSpan.span_id || path.leafSpan.spanId || "");
  });

  // Calculate aggregated metrics for each pattern
  patterns.forEach((pattern) => {
    const durations = pattern.instances.map((instance) => instance.duration);
    const errorCount = pattern.instances.filter((instance) => instance.isError).length;

    pattern.metrics = {
      count: pattern.instances.length,
      avg: calculateAverage(durations),
      min: Math.min(...durations),
      max: Math.max(...durations),
      p75: calculatePercentile(durations, 75),
      p95: calculatePercentile(durations, 95),
      p99: calculatePercentile(durations, 99),
      totalDuration: durations.reduce((sum, d) => sum + d, 0),
      errorRate: pattern.instances.length > 0 ? (errorCount / pattern.instances.length) * 100 : 0,
      errorCount,
      traceTimePercent:
        totalTraceDuration > 0 && durations.length > 0
          ? (calculateAverage(durations) / totalTraceDuration) * 100
          : 0,
    };
  });

  // Create self-patterns for each service using its own span durations.
  // Relationship patterns (A→B) use the child span's duration, so root services
  // would incorrectly show child durations. Self-patterns fix this by capturing
  // each service's own span metrics directly from allServices.
  allServices.forEach((serviceInfo, serviceName) => {
    const durations = serviceInfo.spans.map((s: any) => s.durationMs || 0);
    const errorCount = serviceInfo.errorCount;

    patterns.set(serviceName, {
      pathSignature: serviceName,
      instances: serviceInfo.spans.map((span: any) => ({
        spanId: span.span_id || span.spanId || "",
        duration: span.durationMs || 0,
        isError: isSpanError(span),
        timestamp: span.start_time || 0,
        attributes: span.attributes || {},
        serviceName,
        operationName: span.operationName || span.operation_name || "",
      })),
      metrics: {
        count: serviceInfo.spans.length,
        avg: calculateAverage(durations),
        min: durations.length > 0 ? Math.min(...durations) : 0,
        max: durations.length > 0 ? Math.max(...durations) : 0,
        p75: calculatePercentile(durations, 75),
        p95: calculatePercentile(durations, 95),
        p99: calculatePercentile(durations, 99),
        totalDuration: durations.reduce((sum, d) => sum + d, 0),
        errorRate: serviceInfo.spans.length > 0 ? (errorCount / serviceInfo.spans.length) * 100 : 0,
        errorCount,
        traceTimePercent:
          totalTraceDuration > 0 && durations.length > 0
            ? (calculateAverage(durations) / totalTraceDuration) * 100
            : 0,
      },
      spanIds: serviceInfo.spans.map((span: any) => span.span_id || span.spanId || ""),
    });
  });

  return patterns;
}

/**
 * Check if a span represents an error
 */
function isSpanError(span: any): boolean {
  // Check span status (supports both snake_case from API and camelCase from formatted spans)
  if (span.status_code === 2 || span.span_status === "ERROR" || span.spanStatus === "ERROR") {
    return true;
  }

  // Check for error in tags/attributes
  const tags = span.tags || span.attributes || {};
  if (tags.error === true || tags.error === "true") {
    return true;
  }

  // Check HTTP status codes in attributes
  if (tags["http.status_code"] && tags["http.status_code"] >= 400) {
    return true;
  }

  return false;
}

/**
 * Calculate average of an array of numbers
 */
function calculateAverage(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, val) => sum + val, 0) / values.length;
}

/**
 * Calculate percentile of an array of numbers
 */
function calculatePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const index = (percentile / 100) * (sorted.length - 1);

  if (Math.floor(index) === index) {
    return sorted[index];
  } else {
    const lower = sorted[Math.floor(index)];
    const upper = sorted[Math.ceil(index)];
    const weight = index - Math.floor(index);
    return lower * (1 - weight) + upper * weight;
  }
}

/**
 * Filter patterns by criteria (for advanced filtering features)
 */
export function filterPatterns(
  patterns: Map<string, CallPattern>,
  filters: {
    minDuration?: number;
    maxDuration?: number;
    minErrorRate?: number;
    maxErrorRate?: number;
    minCalls?: number;
    onlyErrors?: boolean;
  },
): Map<string, CallPattern> {
  const filtered = new Map<string, CallPattern>();

  patterns.forEach((pattern, signature) => {
    let include = true;

    // Apply filters
    if (filters.minDuration !== undefined && pattern.metrics.avg < filters.minDuration) {
      include = false;
    }
    if (filters.maxDuration !== undefined && pattern.metrics.avg > filters.maxDuration) {
      include = false;
    }
    if (filters.minErrorRate !== undefined && pattern.metrics.errorRate < filters.minErrorRate) {
      include = false;
    }
    if (filters.maxErrorRate !== undefined && pattern.metrics.errorRate > filters.maxErrorRate) {
      include = false;
    }
    if (filters.minCalls !== undefined && pattern.metrics.count < filters.minCalls) {
      include = false;
    }
    if (filters.onlyErrors && pattern.metrics.errorRate === 0) {
      include = false;
    }

    if (include) {
      filtered.set(signature, pattern);
    }
  });

  return filtered;
}

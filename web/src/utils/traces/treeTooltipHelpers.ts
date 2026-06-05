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
 * Helper functions for tree view custom tooltips
 */

/**
 * Format large numbers with K/M notation
 */
export const formatNumber = (n: number): string => {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
};

/**
 * Format latency from nanoseconds to human-readable string
 */
export const formatLatency = (ns: number): string => {
  if (!ns) return 'N/A';
  const ms = ns / 1e6;
  return ms >= 1000 ? (ms / 1000).toFixed(2) + 's' : ms.toFixed(2) + 'ms';
};

/**
 * Calculate point-to-cubic-bezier distance using 20-sample approximation
 */
export const pointToBezierDistance = (
  px: number,
  py: number,
  shape: {
    x1: number;
    y1: number;
    cpx1: number;
    cpy1: number;
    cpx2: number;
    cpy2: number;
    x2: number;
    y2: number;
  }
): number => {
  let min = Infinity;
  const { x1, y1, cpx1, cpy1, cpx2, cpy2, x2, y2 } = shape;

  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    const u = 1 - t;
    const bx = u*u*u*x1 + 3*u*u*t*cpx1 + 3*u*t*t*cpx2 + t*t*t*x2;
    const by = u*u*u*y1 + 3*u*u*t*cpy1 + 3*u*t*t*cpy2 + t*t*t*y2;
    const d = Math.hypot(px - bx, py - by);
    if (d < min) min = d;
  }
  return min;
};

/**
 * Generate node tooltip HTML content with direction-aware metrics
 */
export const generateNodeTooltipContent = (
  nodeName: string,
  requests: number,
  errors: number,
  errorRate: number
): string => {
  return `
    <strong>${nodeName}</strong><br/>
    Requests: ${formatNumber(requests)}<br/>
    Errors: ${formatNumber(errors)}<br/>
    Error Rate: ${errorRate.toFixed(2)}%
  `;
};

/**
 * Generate edge tooltip HTML content
 */
export const generateEdgeTooltipContent = (
  total: number,
  failed: number,
  errorRate: number,
  p50Ns: number,
  p95Ns: number,
  p99Ns: number
): string => {
  return `
    <strong>Requests:</strong> ${formatNumber(total)}<br/>
    <strong>Errors:</strong> ${failed} (${errorRate.toFixed(2)}%)<br/>
    <strong>P50:</strong> ${formatLatency(p50Ns)}<br/>
    <strong>P95:</strong> ${formatLatency(p95Ns)}<br/>
    <strong>P99:</strong> ${formatLatency(p99Ns)}
  `;
};

/**
 * Find incoming edge data for a node in tree view
 */
export const findIncomingEdgeForNode = (
  nodeName: string,
  parentName: string | undefined,
  edges: any[]
): any | null => {
  // Handle entry-point nodes (no parent or empty parent name)
  if (!parentName || parentName === '') {
    const edge = edges.find((e: any) => e.from === null && e.to === nodeName);
    if (edge) return edge;
    // Fallback to any edge to this node
    return edges.find((e: any) => e.to === nodeName) || null;
  }

  // Try exact match first
  const edge = edges.find((e: any) =>
    e.from === parentName && e.to === nodeName
  );

  if (edge) return edge;

  // Fallback: find any edge to this node
  return edges.find((e: any) => e.to === nodeName) || null;
};

/**
 * Calculate total metrics from outgoing edges (for root nodes)
 */
export const calculateRootNodeMetrics = (
  nodeName: string,
  edges: any[]
): { requests: number; errors: number; errorRate: number } => {
  const outgoing = edges.filter((e: any) => e.from === nodeName);

  if (outgoing.length === 0) {
    return { requests: 0, errors: 0, errorRate: 0 };
  }

  const total = outgoing.reduce((s: number, e: any) => s + (e.total_requests || 0), 0);
  const failed = outgoing.reduce((s: number, e: any) => s + (e.failed_requests || 0), 0);
  const errorRate = total > 0 ? (failed / total) * 100 : 0;

  return { requests: total, errors: failed, errorRate };
};

/**
 * Generate service node tooltip content (for ServiceGraph)
 */
export const generateServiceNodeTooltipContent = (metadata: any): string => {
  if (!metadata) return '';

  const requests = metadata.requests || 0;
  const errors = metadata.errors || 0;
  const errorRate = metadata.errorRate || 0;

  // Check for exclusive time metrics (if service has aggregated time data)
  const avgDuration = metadata.avgDuration || 0;
  const avgExclusive = metadata.avgExclusive || 0;
  const selfTimeRatio = metadata.selfTimeRatio || 0;

  const hasTimeMetrics = avgDuration > 0 || avgExclusive > 0;
  const timeSection = hasTimeMetrics ? `
    <div class="tooltip-section">
      <div>Avg Duration: ${avgDuration.toFixed(1)}ms</div>
      <div>Avg Self Time: ${avgExclusive.toFixed(1)}ms</div>
      <div>Work Ratio: ${(selfTimeRatio * 100).toFixed(1)}%</div>
    </div>
  ` : '';

  return `
    <div class="tree-tooltip">
      <div class="tooltip-header">${metadata.serviceName || 'Unknown Service'}</div>
      <div class="tooltip-metrics">
        <div>Requests: ${formatNumber(requests)}</div>
        <div>Errors: ${formatNumber(errors)}</div>
        <div>Error Rate: ${errorRate.toFixed(1)}%</div>
      </div>
      ${timeSection}
    </div>
  `;
};

/**
 * Generate pattern node tooltip content (for TraceDetails patterns)
 */
export const generatePatternNodeTooltipContent = (metadata: any): string => {
  if (!metadata) return '';

  const {
    pathSignature = 'Unknown Pattern',
    count = 1,
    avg = 0,
    min = 0,
    max = 0,
    p75 = 0,
    p95 = 0,
    p99 = 0,
    errorRate = 0,
    traceTimePercent = 0,
    // Exclusive time metrics (new)
    avgExclusive = 0,
    minExclusive = 0,
    maxExclusive = 0,
    exclusiveP75 = 0,
    exclusiveP95 = 0,
    exclusiveTimePercent = 0,
    selfTimeRatio = 0
  } = metadata;

  // Build exclusive time section if available
  const hasExclusiveData = avgExclusive > 0 || exclusiveTimePercent > 0;
  const exclusiveSection = hasExclusiveData ? `
    <div class="tooltip-section">
      <div class="section-title">Self Time (Exclusive)</div>
      <div>Average: ${avgExclusive.toFixed(1)}ms (${exclusiveTimePercent.toFixed(1)}% of trace)</div>
      <div>Min: ${minExclusive.toFixed(1)}ms | Max: ${maxExclusive.toFixed(1)}ms</div>
      <div>P75: ${exclusiveP75.toFixed(1)}ms | P95: ${exclusiveP95.toFixed(1)}ms</div>
      <div>Work Ratio: ${(selfTimeRatio * 100).toFixed(1)}% (exclusive/inclusive)</div>
    </div>
  ` : '';

  return `
    <div class="tree-tooltip">
      <div class="tooltip-header">${pathSignature}</div>
      <div class="tooltip-metrics">
        <div>Calls: ${count}</div>
        <div>Total Time: ${avg.toFixed(1)}ms (${traceTimePercent.toFixed(1)}% of trace)</div>
        <div>Range: ${min.toFixed(1)}ms - ${max.toFixed(1)}ms</div>
        <div>Percentiles: P75: ${p75.toFixed(1)}ms | P95: ${p95.toFixed(1)}ms | P99: ${p99.toFixed(1)}ms</div>
        <div>Error Rate: ${errorRate.toFixed(1)}%</div>
      </div>
      ${exclusiveSection}
      <div class="tooltip-footer">Click to view individual spans</div>
    </div>
  `;
};

/**
 * Generate tooltip HTML content for trace pattern metrics
 * Shows comprehensive duration metrics in single column format
 */
export const generateTracePatternTooltipContent = (metadata: any): string => {
  if (!metadata) {
    return `
      <div class="tree-tooltip">
        <div class="tooltip-header">Unknown Pattern</div>
        <div class="tooltip-metrics">
          <div>Calls: 1</div>
          <div>Average: 0.0ms</div>
          <div>Minimum: 0.0ms</div>
          <div>Maximum: 0.0ms</div>
          <div>P75: 0.0ms</div>
          <div>P95: 0.0ms</div>
          <div>P99: 0.0ms</div>
          <div>Error Rate: 0.0%</div>
        </div>
      </div>
    `;
  }

  const {
    pathSignature = 'Unknown Pattern',
    count = 1,
    avg = 0,
    min = 0,
    max = 0,
    p75 = 0,
    p95 = 0,
    p99 = 0,
    errorRate = 0,
  } = metadata;

  return `
    <div class="tree-tooltip">
      <div class="tooltip-header">${pathSignature}</div>
      <div class="tooltip-metrics">
        <div>Calls: ${count}</div>
        <div>Average: ${avg.toFixed(1)}ms</div>
        <div>Minimum: ${min.toFixed(1)}ms</div>
        <div>Maximum: ${max.toFixed(1)}ms</div>
        <div>P75: ${p75.toFixed(1)}ms</div>
        <div>P95: ${p95.toFixed(1)}ms</div>
        <div>P99: ${p99.toFixed(1)}ms</div>
        <div>Error Rate: ${errorRate.toFixed(1)}%</div>
      </div>
    </div>
  `;
};

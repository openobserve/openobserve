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

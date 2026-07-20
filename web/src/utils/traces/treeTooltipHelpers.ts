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

import { escapeHtml } from '@/utils/html'

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
    <strong>${escapeHtml(nodeName)}</strong><br/>
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

  return `
    <div class="tree-tooltip">
      <div class="tooltip-header">${escapeHtml(metadata.serviceName || 'Unknown Service')}</div>
      <div class="tooltip-metrics">
        <div>Requests: ${formatNumber(requests)}</div>
        <div>Errors: ${formatNumber(errors)}</div>
        <div>Error Rate: ${errorRate.toFixed(1)}%</div>
      </div>
    </div>
  `;
};

/**
 * Generate pattern node tooltip content (for TraceDetails patterns)
 */
export const generatePatternNodeTooltipContent = (metadata: any): string => {
  if (!metadata) return '';
  const {
    serviceName,
    pathSignature = 'Unknown Pattern',
    count = 1,
    avg = 0,
    traceTimePercent = 0
  } = metadata;

  return `
    <div class="flex flex-col gap-0.5">
      <div class="font-semibold pb-1 text-left">${escapeHtml(serviceName || pathSignature)}</div>
      <div class="flex justify-between gap-3">
        <span class="w-12 text-left">Spans:</span>
        <span class="font-mono text-left flex-1">${count}</span>
      </div>
      <div class="flex justify-between gap-3">
        <span class="w-12 text-left">Average:</span>
        <span class="font-mono text-left flex-1">${avg.toFixed(2)}ms (${traceTimePercent.toFixed(1)}% of trace)</span>
      </div>
      <div class="flex justify-between gap-3">
        <span class="w-12 text-left">Errors:</span>
        <span class="font-mono text-left flex-1">${metadata.errorCount || 0}</span>
      </div>
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
      <div style="
        font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
        font-size: 12px;
        line-height: 1.4;
        max-width: 280px;
        color: rgba(255, 255, 255, 0.88);
      ">
        <div style="
          font-weight: 600;
          font-size: 13px;
          margin-bottom: 8px;
          color: rgba(255, 255, 255, 0.95);
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          padding-bottom: 4px;
        ">Unknown Pattern</div>
        <div>
          <div style="margin-bottom: 2px;">Calls: <span style="font-family: monospace;">1</span></div>
          <div style="margin-bottom: 2px;">Average: <span style="font-family: monospace;">0.0ms</span></div>
          <div style="margin-bottom: 2px;">Minimum: <span style="font-family: monospace;">0.0ms</span></div>
          <div style="margin-bottom: 2px;">Maximum: <span style="font-family: monospace;">0.0ms</span></div>
          <div style="margin-bottom: 2px;">P75: <span style="font-family: monospace;">0.0ms</span></div>
          <div style="margin-bottom: 2px;">P95: <span style="font-family: monospace;">0.0ms</span></div>
          <div style="margin-bottom: 2px;">P99: <span style="font-family: monospace;">0.0ms</span></div>
          <div style="margin-bottom: 2px;">Error Rate: <span style="font-family: monospace; color: #10b981;">0.0%</span></div>
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
    <div style="
      font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
      font-size: 12px;
      line-height: 1.4;
      max-width: 280px;
      color: rgba(255, 255, 255, 0.88);
    ">
      <div style="
        font-weight: 600;
        font-size: 13px;
        margin-bottom: 8px;
        color: rgba(255, 255, 255, 0.95);
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        padding-bottom: 4px;
      ">${escapeHtml(pathSignature)}</div>

      <div>
        <div style="margin-bottom: 2px;">Calls: <span style="font-family: monospace;">${count}</span></div>
        <div style="margin-bottom: 2px;">Average: <span style="font-family: monospace;">${avg.toFixed(1)}ms</span></div>
        <div style="margin-bottom: 2px;">Minimum: <span style="font-family: monospace;">${min.toFixed(1)}ms</span></div>
        <div style="margin-bottom: 2px;">Maximum: <span style="font-family: monospace;">${max.toFixed(1)}ms</span></div>
        <div style="margin-bottom: 2px;">P75: <span style="font-family: monospace;">${p75.toFixed(1)}ms</span></div>
        <div style="margin-bottom: 2px;">P95: <span style="font-family: monospace;">${p95.toFixed(1)}ms</span></div>
        <div style="margin-bottom: 2px;">P99: <span style="font-family: monospace;">${p99.toFixed(1)}ms</span></div>
        <div>Error Rate: <span style="font-family: monospace; color: ${errorRate > 0 ? '#ef4444' : '#10b981'};">${errorRate.toFixed(1)}%</span></div>
      </div>
    </div>
  `;
};

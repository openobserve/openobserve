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

import { describe, it, expect } from 'vitest';
import {
  formatNumber,
  formatLatency,
  pointToBezierDistance,
  generateNodeTooltipContent,
  generateEdgeTooltipContent,
  findIncomingEdgeForNode,
  calculateRootNodeMetrics,
} from './treeTooltipHelpers';

describe('treeTooltipHelpers', () => {
  describe('formatNumber', () => {
    it('should format millions with M suffix', () => {
      expect(formatNumber(5500000)).toBe('5.5M');
      expect(formatNumber(1234567)).toBe('1.2M');
    });

    it('should format thousands with K suffix', () => {
      expect(formatNumber(5500)).toBe('5.5K');
      expect(formatNumber(1234)).toBe('1.2K');
    });

    it('should return string for numbers < 1000', () => {
      expect(formatNumber(999)).toBe('999');
      expect(formatNumber(42)).toBe('42');
      expect(formatNumber(0)).toBe('0');
    });
  });

  describe('formatLatency', () => {
    it('should return N/A for zero or undefined', () => {
      expect(formatLatency(0)).toBe('N/A');
      expect(formatLatency(null as any)).toBe('N/A');
      expect(formatLatency(undefined as any)).toBe('N/A');
    });

    it('should format nanoseconds to milliseconds', () => {
      expect(formatLatency(4200000)).toBe('4.20ms');
      expect(formatLatency(180000000)).toBe('180.00ms');
    });

    it('should format to seconds for large values', () => {
      expect(formatLatency(3050000000)).toBe('3.05s');
      expect(formatLatency(10000000000)).toBe('10.00s');
    });
  });

  describe('pointToBezierDistance', () => {
    it('should calculate distance to straight line (degenerate bezier)', () => {
      const shape = {
        x1: 0, y1: 0,
        cpx1: 50, cpy1: 0,
        cpx2: 50, cpy2: 0,
        x2: 100, y2: 0,
      };

      // Point on the line
      expect(pointToBezierDistance(50, 0, shape)).toBeLessThan(1);

      // Point above the line
      const dist = pointToBezierDistance(50, 10, shape);
      expect(dist).toBeCloseTo(10, 0);
    });

    it('should calculate distance to curved bezier', () => {
      const shape = {
        x1: 0, y1: 0,
        cpx1: 50, cpy1: 0,
        cpx2: 50, cpy2: 100,
        x2: 100, y2: 100,
      };

      // Point far from curve
      expect(pointToBezierDistance(200, 200, shape)).toBeGreaterThan(100);

      // Point near curve midpoint
      const midDist = pointToBezierDistance(50, 50, shape);
      expect(midDist).toBeLessThan(30);
    });

    it('should handle zero-length bezier', () => {
      const shape = {
        x1: 50, y1: 50,
        cpx1: 50, cpy1: 50,
        cpx2: 50, cpy2: 50,
        x2: 50, y2: 50,
      };

      const dist = pointToBezierDistance(60, 60, shape);
      expect(dist).toBeCloseTo(Math.hypot(10, 10), 1);
    });
  });

  describe('generateNodeTooltipContent', () => {
    it('should generate correct HTML for node tooltip', () => {
      const html = generateNodeTooltipContent('user-service', 5500000, 387200, 7.07);

      expect(html).toContain('<strong>user-service</strong>');
      expect(html).toContain('Requests: 5.5M');
      expect(html).toContain('Errors: 387.2K');
      expect(html).toContain('Error Rate: 7.07%');
    });

    it('should handle zero errors', () => {
      const html = generateNodeTooltipContent('db-service', 1000000, 0, 0);

      expect(html).toContain('Errors: 0');
      expect(html).toContain('Error Rate: 0.00%');
    });

    it('should handle small numbers', () => {
      const html = generateNodeTooltipContent('test', 42, 3, 7.14);

      expect(html).toContain('Requests: 42');
      expect(html).toContain('Errors: 3');
    });
  });

  describe('generateEdgeTooltipContent', () => {
    it('should generate correct HTML for edge tooltip with latencies', () => {
      const html = generateEdgeTooltipContent(
        3100000,
        12000,
        0.39,
        4200000,
        18000000,
        45000000
      );

      expect(html).toContain('<strong>Requests:</strong> 3.1M');
      expect(html).toContain('<strong>Errors:</strong> 12000 (0.39%)');
      expect(html).toContain('<strong>P50:</strong> 4.20ms');
      expect(html).toContain('<strong>P95:</strong> 18.00ms');
      expect(html).toContain('<strong>P99:</strong> 45.00ms');
    });

    it('should handle N/A latencies', () => {
      const html = generateEdgeTooltipContent(1000, 10, 1.0, 0, 0, 0);

      expect(html).toContain('<strong>P50:</strong> N/A');
      expect(html).toContain('<strong>P95:</strong> N/A');
      expect(html).toContain('<strong>P99:</strong> N/A');
    });

    it('should format latencies in seconds for large values', () => {
      const html = generateEdgeTooltipContent(
        1000,
        0,
        0,
        3050000000,
        5000000000,
        10000000000
      );

      expect(html).toContain('<strong>P50:</strong> 3.05s');
      expect(html).toContain('<strong>P95:</strong> 5.00s');
      expect(html).toContain('<strong>P99:</strong> 10.00s');
    });
  });

  describe('findIncomingEdgeForNode', () => {
    const edges = [
      { from: 'api-gateway', to: 'user-service', total_requests: 5500000 },
      { from: 'user-service', to: 'database', total_requests: 2700000 },
      { from: null, to: 'api-gateway', total_requests: 8800000 },
    ];

    it('should find edge by exact parent and child match', () => {
      const edge = findIncomingEdgeForNode('user-service', 'api-gateway', edges);

      expect(edge).toBeTruthy();
      expect(edge.total_requests).toBe(5500000);
    });

    it('should find edge for entry-point service with null parent', () => {
      const edge = findIncomingEdgeForNode('api-gateway', '', edges);

      expect(edge).toBeTruthy();
      expect(edge.total_requests).toBe(8800000);
    });

    it('should return fallback edge when no parent provided', () => {
      const edge = findIncomingEdgeForNode('user-service', undefined, edges);

      // Falls back to any edge to the node
      expect(edge).toBeTruthy();
      expect(edge.to).toBe('user-service');
    });

    it('should fallback to any edge to node if exact match fails', () => {
      const edge = findIncomingEdgeForNode('database', 'different-parent', edges);

      // Should find the edge from user-service as fallback
      expect(edge).toBeTruthy();
      expect(edge.from).toBe('user-service');
    });

    it('should return null when node has no incoming edges', () => {
      const edge = findIncomingEdgeForNode('non-existent', 'any-parent', edges);

      expect(edge).toBeNull();
    });
  });

  describe('calculateRootNodeMetrics', () => {
    const edges = [
      { from: 'api-gateway', to: 'user-service', total_requests: 5500000, failed_requests: 387200 },
      { from: 'api-gateway', to: 'order-service', total_requests: 3100000, failed_requests: 12000 },
      { from: 'user-service', to: 'database', total_requests: 2700000, failed_requests: 61000 },
    ];

    it('should sum outgoing edges for root node', () => {
      const metrics = calculateRootNodeMetrics('api-gateway', edges);

      expect(metrics.requests).toBe(8600000); // 5.5M + 3.1M
      expect(metrics.errors).toBe(399200); // 387.2K + 12K
      expect(metrics.errorRate).toBeCloseTo(4.64, 1);
    });

    it('should return zero metrics for node with no outgoing edges', () => {
      const metrics = calculateRootNodeMetrics('database', edges);

      expect(metrics.requests).toBe(0);
      expect(metrics.errors).toBe(0);
      expect(metrics.errorRate).toBe(0);
    });

    it('should handle single outgoing edge', () => {
      const metrics = calculateRootNodeMetrics('user-service', edges);

      expect(metrics.requests).toBe(2700000);
      expect(metrics.errors).toBe(61000);
      expect(metrics.errorRate).toBeCloseTo(2.26, 1);
    });

    it('should handle edges with missing metrics', () => {
      const sparseEdges = [
        { from: 'root', to: 'child1', total_requests: 1000 },
        { from: 'root', to: 'child2' }, // missing metrics
      ];

      const metrics = calculateRootNodeMetrics('root', sparseEdges);

      expect(metrics.requests).toBe(1000);
      expect(metrics.errors).toBe(0);
    });

    it('should calculate correct error rate when total is zero', () => {
      const edges = [{ from: 'node', to: 'child', total_requests: 0, failed_requests: 0 }];
      const metrics = calculateRootNodeMetrics('node', edges);

      expect(metrics.errorRate).toBe(0);
    });
  });

  describe('Edge cases', () => {
    it('should handle formatNumber with decimal values', () => {
      expect(formatNumber(1234.56)).toBe('1.2K');
      expect(formatNumber(1234567.89)).toBe('1.2M');
    });

    it('should handle formatLatency with very small values', () => {
      expect(formatLatency(100)).toBe('0.00ms');
      expect(formatLatency(1000)).toBe('0.00ms');
    });

    it('should handle formatLatency with exact second boundaries', () => {
      expect(formatLatency(1000000000)).toBe('1.00s');
      expect(formatLatency(999999999)).toBe('1000.00ms');
    });

    it('should find edges with null from field', () => {
      const edges = [
        { from: null, to: 'entry', total_requests: 1000 },
      ];
      const edge = findIncomingEdgeForNode('entry', '', edges);
      expect(edge).toBeTruthy();
      expect(edge.from).toBeNull();
    });

    it('should generate tooltip content with high error rates', () => {
      const html = generateNodeTooltipContent('failing-service', 1000, 950, 95.0);
      expect(html).toContain('Error Rate: 95.00%');
    });

    it('should generate edge tooltip with zero error rate', () => {
      const html = generateEdgeTooltipContent(5000, 0, 0, 1000000, 2000000, 3000000);
      expect(html).toContain('(0.00%)');
    });

    it('should handle formatNumber with exactly 1000', () => {
      expect(formatNumber(1000)).toBe('1.0K');
    });

    it('should handle formatNumber with exactly 1000000', () => {
      expect(formatNumber(1000000)).toBe('1.0M');
    });

    it('should calculate zero distance when point is on bezier endpoint', () => {
      const shape = {
        x1: 0, y1: 0,
        cpx1: 25, cpy1: 0,
        cpx2: 75, cpy2: 100,
        x2: 100, y2: 100,
      };
      // Point exactly at endpoint
      expect(pointToBezierDistance(100, 100, shape)).toBeLessThan(0.1);
    });

    it('should find correct edge when multiple edges exist to same node', () => {
      const edges = [
        { from: 'service-a', to: 'database', total_requests: 1000 },
        { from: 'service-b', to: 'database', total_requests: 2000 },
      ];
      const edge = findIncomingEdgeForNode('database', 'service-b', edges);
      expect(edge.total_requests).toBe(2000);
    });
  });
});

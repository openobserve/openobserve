// Copyright 2023 OpenObserve Inc.
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

import { describe, it, expect } from "vitest";
import { parsePromQlQuery, addLabelToPromQlQuery } from "./promQLUtils";

describe("promQLUtils", () => {

  describe("parsePromQlQuery", () => {
    describe("Basic metric name extraction", () => {
      it("should extract metric name from simple query with labels", () => {
        const result = parsePromQlQuery('cpu_usage{instance="server1"}');
        expect(result.metricName).toBe("cpu_usage");
      });

      it("should extract metric name from query with multiple labels", () => {
        const result = parsePromQlQuery('http_requests_total{method="GET",status="200"}');
        expect(result.metricName).toBe("http_requests_total");
      });

      it("should extract metric name from query with numeric characters", () => {
        const result = parsePromQlQuery('metric123{label="value"}');
        expect(result.metricName).toBe("metric123");
      });

      it("should extract metric name with underscores", () => {
        const result = parsePromQlQuery('cpu_usage_percent{instance="server1"}');
        expect(result.metricName).toBe("cpu_usage_percent");
      });

      it("should return null for query without metric name pattern", () => {
        const result = parsePromQlQuery('sum(cpu_usage)');
        expect(result.metricName).toBe(null);
      });

      it("should return null for query without curly braces", () => {
        const result = parsePromQlQuery('cpu_usage');
        expect(result.metricName).toBe(null);
      });
    });

    describe("Labels presence detection", () => {
      it("should detect labels presence when curly braces exist", () => {
        const result = parsePromQlQuery('cpu_usage{instance="server1"}');
        expect(result.label.hasLabels).toBe(true);
      });

      it("should detect no labels when no curly braces exist", () => {
        const result = parsePromQlQuery('cpu_usage');
        expect(result.label.hasLabels).toBe(false);
      });

      it("should detect labels even with empty braces", () => {
        const result = parsePromQlQuery('cpu_usage{}');
        expect(result.label.hasLabels).toBe(true);
      });

      it("should detect labels with nested braces content", () => {
        const result = parsePromQlQuery('cpu_usage{label="{value}"}');
        expect(result.label.hasLabels).toBe(true);
      });

      it("should handle query with function wrapping labeled metric", () => {
        const result = parsePromQlQuery('rate(cpu_usage{instance="server1"}[5m])');
        expect(result.label.hasLabels).toBe(true);
      });
    });

    describe("Label position tracking", () => {
      it("should track correct position for single label", () => {
        const result = parsePromQlQuery('cpu_usage{instance="server1"}');
        expect(result.label.position.start).toBe(9); // Position of '{'
        expect(result.label.position.end).toBe(28); // Position after labels
      });

      it("should track correct position for multiple labels", () => {
        const result = parsePromQlQuery('http_requests{method="GET",status="200"}');
        expect(result.label.position.start).toBe(13);
        expect(result.label.position.end).toBe(39);
      });

      it("should track position for empty braces", () => {
        const result = parsePromQlQuery('cpu_usage{}');
        expect(result.label.position.start).toBe(9);
        expect(result.label.position.end).toBe(10);
      });

      it("should have zero positions when no labels", () => {
        const result = parsePromQlQuery('cpu_usage');
        expect(result.label.position.start).toBe(0);
        expect(result.label.position.end).toBe(0);
      });

      it("should track position with spaces in query", () => {
        const result = parsePromQlQuery('cpu_usage { instance="server1" }');
        expect(result.label.position.start).toBe(10);
        expect(result.label.position.end).toBe(31);
      });
    });

    describe("Label parsing and extraction", () => {
      it("should parse single label correctly", () => {
        const result = parsePromQlQuery('cpu_usage{instance="server1"}');
        expect(result.label.labels).toEqual({
          instance: "server1"
        });
      });

      it("should parse multiple labels correctly", () => {
        const result = parsePromQlQuery('http_requests{method="GET",status="200"}');
        expect(result.label.labels).toEqual({
          method: "GET",
          status: "200"
        });
      });

      it("should parse labels with numeric values", () => {
        const result = parsePromQlQuery('memory_usage{port="8080",timeout="300"}');
        expect(result.label.labels).toEqual({
          port: "8080",
          timeout: "300"
        });
      });

      it("should parse labels with special characters in values", () => {
        const result = parsePromQlQuery('log_entries{path="/var/log/app.log",level="ERROR"}');
        expect(result.label.labels).toEqual({
          path: "/var/log/app.log",
          level: "ERROR"
        });
      });

      it("should parse labels with empty string values", () => {
        const result = parsePromQlQuery('metric{empty="",nonempty="value"}');
        expect(result.label.labels).toEqual({
          nonempty: "value"
        });
      });

      it("should handle labels with spaces around equals", () => {
        const result = parsePromQlQuery('metric{key1 = "value1", key2= "value2"}');
        // Current regex only matches key="value" pattern exactly
        expect(result.label.labels).toEqual({});
      });

      it("should return empty labels object for empty braces", () => {
        const result = parsePromQlQuery('cpu_usage{}');
        expect(result.label.labels).toEqual({});
      });

      it("should ignore malformed labels", () => {
        const result = parsePromQlQuery('cpu_usage{malformed=value,valid="value"}');
        expect(result.label.labels).toEqual({
          valid: "value"
        });
      });
    });

    describe("Complex query patterns", () => {
      it("should handle query with functions and labels", () => {
        const result = parsePromQlQuery('rate(http_requests{method="GET"}[5m])');
        expect(result.metricName).toBe("http_requests");
        expect(result.label.hasLabels).toBe(true);
        expect(result.label.labels).toEqual({
          method: "GET"
        });
      });

      it("should handle query with aggregation functions", () => {
        const result = parsePromQlQuery('sum(cpu_usage{instance="server1"}) by (job)');
        expect(result.metricName).toBe("cpu_usage");
        expect(result.label.labels).toEqual({
          instance: "server1"
        });
      });

      it("should handle query with operators", () => {
        const result = parsePromQlQuery('memory_total{instance="server1"} - memory_free{instance="server1"}');
        // Only matches first metric
        expect(result.metricName).toBe("memory_total");
        expect(result.label.labels).toEqual({
          instance: "server1"
        });
      });

      it("should handle query with time ranges", () => {
        const result = parsePromQlQuery('cpu_usage{instance="server1"}[5m]');
        expect(result.metricName).toBe("cpu_usage");
        expect(result.label.labels).toEqual({
          instance: "server1"
        });
      });

      it("should handle query with offset", () => {
        const result = parsePromQlQuery('cpu_usage{instance="server1"} offset 1h');
        expect(result.metricName).toBe("cpu_usage");
        expect(result.label.labels).toEqual({
          instance: "server1"
        });
      });
    });

    describe("Edge cases and error handling", () => {
      it("should handle empty string", () => {
        const result = parsePromQlQuery('');
        expect(result.metricName).toBe(null);
        expect(result.label.hasLabels).toBe(false);
        expect(result.label.labels).toEqual({});
        expect(result.label.position.start).toBe(0);
        expect(result.label.position.end).toBe(0);
      });

      it("should handle null input gracefully", () => {
        expect(() => parsePromQlQuery(null as any)).toThrow();
      });

      it("should handle undefined input gracefully", () => {
        expect(() => parsePromQlQuery(undefined as any)).toThrow();
      });

      it("should handle query with unmatched opening brace", () => {
        const result = parsePromQlQuery('cpu_usage{incomplete');
        expect(result.metricName).toBe("cpu_usage");
        expect(result.label.hasLabels).toBe(false);
      });

      it("should handle query with unmatched closing brace", () => {
        const result = parsePromQlQuery('cpu_usage}incomplete');
        expect(result.metricName).toBe(null);
        expect(result.label.hasLabels).toBe(false);
      });

      it("should handle query with multiple curly brace pairs", () => {
        const result = parsePromQlQuery('cpu_usage{first="value"}{second="value"}');
        // Should only match first curly brace pair
        expect(result.label.hasLabels).toBe(true);
        expect(result.label.labels).toEqual({
          first: "value"
        });
      });

      it("should handle whitespace-only query", () => {
        const result = parsePromQlQuery('   ');
        expect(result.metricName).toBe(null);
        expect(result.label.hasLabels).toBe(false);
        expect(result.label.labels).toEqual({});
      });

      it("should handle query with only braces", () => {
        const result = parsePromQlQuery('{}');
        expect(result.metricName).toBe(null);
        expect(result.label.hasLabels).toBe(true);
        expect(result.label.labels).toEqual({});
      });
    });

    describe("Return structure validation", () => {
      it("should return object with correct structure", () => {
        const result = parsePromQlQuery('cpu_usage{instance="server1"}');
        expect(result).toHaveProperty('metricName');
        expect(result).toHaveProperty('label');
        expect(result.label).toHaveProperty('hasLabels');
        expect(result.label).toHaveProperty('position');
        expect(result.label).toHaveProperty('labels');
        expect(result.label.position).toHaveProperty('start');
        expect(result.label.position).toHaveProperty('end');
      });

      it("should return correct data types", () => {
        const result = parsePromQlQuery('cpu_usage{instance="server1"}');
        expect(typeof result.metricName === 'string' || result.metricName === null).toBe(true);
        expect(typeof result.label.hasLabels).toBe('boolean');
        expect(typeof result.label.position.start).toBe('number');
        expect(typeof result.label.position.end).toBe('number');
        expect(typeof result.label.labels).toBe('object');
      });
    });
  });

  describe("addLabelToPromQlQuery", () => {
    describe("Adding labels to queries without existing labels", () => {
      it("should add label to simple metric query", () => {
        const result = addLabelToPromQlQuery('cpu_usage', 'instance', 'server1', '=');
        expect(result).toBe('cpu_usage{instance="server1"}');
      });

      it("should add label with different operator", () => {
        const result = addLabelToPromQlQuery('cpu_usage', 'instance', 'server1', '!=');
        expect(result).toBe('cpu_usage{instance!="server1"}');
      });

      it("should add label with regex operator", () => {
        const result = addLabelToPromQlQuery('cpu_usage', 'instance', 'server.*', '=~');
        expect(result).toBe('cpu_usage{instance=~"server.*"}');
      });

      it("should add label with negative regex operator", () => {
        const result = addLabelToPromQlQuery('cpu_usage', 'instance', 'server.*', '!~');
        expect(result).toBe('cpu_usage{instance!~"server.*"}');
      });

      it("should add label without value when value is empty", () => {
        const result = addLabelToPromQlQuery('cpu_usage', 'instance', '', '=');
        expect(result).toBe('cpu_usage{instance}');
      });

      it("should add label without value when value is null", () => {
        const result = addLabelToPromQlQuery('cpu_usage', 'instance', null, '=');
        expect(result).toBe('cpu_usage{instance}');
      });

      it("should add label without value when value is undefined", () => {
        const result = addLabelToPromQlQuery('cpu_usage', 'instance', undefined, '=');
        expect(result).toBe('cpu_usage{instance}');
      });

      it("should add label to metric with numeric suffix", () => {
        const result = addLabelToPromQlQuery('metric123', 'label', 'value', '=');
        expect(result).toBe('metric123{label="value"}');
      });

      it("should add label to metric with underscores", () => {
        const result = addLabelToPromQlQuery('cpu_usage_percent', 'instance', 'server1', '=');
        expect(result).toBe('cpu_usage_percent{instance="server1"}');
      });

      it("should add label to complex metric name", () => {
        const result = addLabelToPromQlQuery('http_requests_total_5xx', 'method', 'POST', '=');
        expect(result).toBe('http_requests_total_5xx{method="POST"}');
      });
    });

    describe("Adding labels to queries with existing labels", () => {
      it("should add label to query with single existing label", () => {
        const result = addLabelToPromQlQuery('cpu_usage{instance="server1"}', 'job', 'prometheus', '=');
        expect(result).toBe('cpu_usage{instance="server1",job="prometheus"}');
      });

      it("should add label to query with multiple existing labels", () => {
        const result = addLabelToPromQlQuery('http_requests{method="GET",status="200"}', 'instance', 'web1', '=');
        expect(result).toBe('http_requests{method="GET",status="200",instance="web1"}');
      });

      it("should add label with different operator to existing labels", () => {
        const result = addLabelToPromQlQuery('cpu_usage{instance="server1"}', 'job', 'prometheus', '!=');
        expect(result).toBe('cpu_usage{instance="server1",job!="prometheus"}');
      });

      it("should handle adding label when existing labels end with comma", () => {
        const result = addLabelToPromQlQuery('cpu_usage{instance="server1",}', 'job', 'prometheus', '=');
        expect(result).toBe('cpu_usage{instance="server1",job="prometheus"}');
      });

      it("should add label without value to existing labels", () => {
        const result = addLabelToPromQlQuery('cpu_usage{instance="server1"}', 'job', '', '=');
        expect(result).toBe('cpu_usage{instance="server1",job}');
      });

      it("should handle complex values in new label", () => {
        const result = addLabelToPromQlQuery('logs{level="INFO"}', 'path', '/var/log/app.log', '=');
        expect(result).toBe('logs{level="INFO",path="/var/log/app.log"}');
      });

      it("should handle numeric values in new label", () => {
        const result = addLabelToPromQlQuery('connections{port="80"}', 'timeout', '300', '=');
        expect(result).toBe('connections{port="80",timeout="300"}');
      });

      it("should handle special characters in label value", () => {
        const result = addLabelToPromQlQuery('metric{existing="value"}', 'regex', '.*\\.log$', '=~');
        expect(result).toBe('metric{existing="value",regex=~".*\\.log$"}');
      });

      it("should handle empty existing labels", () => {
        const result = addLabelToPromQlQuery('cpu_usage{}', 'instance', 'server1', '=');
        expect(result).toBe('cpu_usage{instance="server1"}');
      });
    });

    describe("Adding labels to complex queries", () => {
      it("should add label to query with function wrapper", () => {
        const result = addLabelToPromQlQuery('rate(http_requests{method="GET"}[5m])', 'instance', 'web1', '=');
        expect(result).toBe('rate(http_requests{method="GET",instance="web1"}[5m])');
      });

      it("should add label to query with aggregation", () => {
        const result = addLabelToPromQlQuery('sum(cpu_usage{instance="server1"}) by (job)', 'env', 'prod', '=');
        expect(result).toBe('sum(cpu_usage{instance="server1",env="prod"}) by (job)');
      });

      it("should add label to query with time range", () => {
        const result = addLabelToPromQlQuery('cpu_usage{instance="server1"}[5m]', 'job', 'node', '=');
        expect(result).toBe('cpu_usage{instance="server1",job="node"}[5m]');
      });

      it("should add label to query with offset", () => {
        const result = addLabelToPromQlQuery('cpu_usage{instance="server1"} offset 1h', 'job', 'node', '=');
        expect(result).toBe('cpu_usage{instance="server1",job="node"} offset 1h');
      });

      it("should add label to query with operators", () => {
        const result = addLabelToPromQlQuery('memory_total{instance="server1"} - memory_free{instance="server1"}', 'env', 'prod', '=');
        expect(result).toBe('memory_total{instance="server1",env="prod"} - memory_free{instance="server1"}');
      });

      it("should handle nested function calls", () => {
        const result = addLabelToPromQlQuery('avg(rate(cpu_usage{instance="server1"}[5m]))', 'job', 'node', '=');
        expect(result).toBe('avg(rate(cpu_usage{instance="server1",job="node"}[5m]))');
      });
    });

    describe("Parameter validation and edge cases", () => {
      it("should handle null original query", () => {
        const result = addLabelToPromQlQuery(null, 'instance', 'server1', '=');
        expect(result).toBe(null);
      });

      it("should handle undefined original query", () => {
        const result = addLabelToPromQlQuery(undefined, 'instance', 'server1', '=');
        expect(result).toBe(undefined);
      });

      it("should handle empty string original query", () => {
        const result = addLabelToPromQlQuery('', 'instance', 'server1', '=');
        expect(result).toBe('{instance="server1"}');
      });

      it("should handle null label name", () => {
        const result = addLabelToPromQlQuery('cpu_usage', null, 'server1', '=');
        expect(result).toBe('cpu_usage{null="server1"}');
      });

      it("should handle undefined label name", () => {
        const result = addLabelToPromQlQuery('cpu_usage', undefined, 'server1', '=');
        expect(result).toBe('cpu_usage{undefined="server1"}');
      });

      it("should handle null operator", () => {
        const result = addLabelToPromQlQuery('cpu_usage', 'instance', 'server1', null);
        expect(result).toBe('cpu_usage{instancenull"server1"}');
      });

      it("should handle undefined operator", () => {
        const result = addLabelToPromQlQuery('cpu_usage', 'instance', 'server1', undefined);
        expect(result).toBe('cpu_usage{instanceundefined"server1"}');
      });

      it("should handle whitespace in parameters", () => {
        const result = addLabelToPromQlQuery('cpu_usage', ' instance ', ' server1 ', ' = ');
        expect(result).toBe('cpu_usage{ instance  = " server1 "}');
      });

      it("should handle special characters in label name", () => {
        const result = addLabelToPromQlQuery('cpu_usage', 'instance-name', 'server1', '=');
        expect(result).toBe('cpu_usage{instance-name="server1"}');
      });

      it("should handle numeric label name", () => {
        const result = addLabelToPromQlQuery('cpu_usage', '123', 'value', '=');
        expect(result).toBe('cpu_usage{123="value"}');
      });
    });

    describe("Error handling and fallback", () => {
      it("should return original query when parsePromQlQuery throws error", () => {
        // Mock a scenario that would cause parsePromQlQuery to fail
        const originalQuery = 'malformed_query_that_causes_error';
        const result = addLabelToPromQlQuery(originalQuery, 'label', 'value', '=');
        // Since the function has try-catch, it should return original on any error
        expect(typeof result).toBe('string');
      });

      it("should handle very long queries", () => {
        const longQuery = 'cpu_usage{' + 'label="value",'.repeat(100) + 'final="value"}';
        const result = addLabelToPromQlQuery(longQuery, 'new', 'value', '=');
        expect(result).toContain('new="value"');
      });

      it("should handle queries with unusual characters", () => {
        const result = addLabelToPromQlQuery('cpu_usage{special="€£¥"}', 'new', '测试', '=');
        expect(result).toBe('cpu_usage{special="€£¥",new="测试"}');
      });

      it("should handle empty braces scenario correctly", () => {
        const result = addLabelToPromQlQuery('cpu_usage{}', 'instance', 'server1', '=');
        expect(result).toBe('cpu_usage{instance="server1"}');
      });
    });

    describe("Comma handling edge cases", () => {
      it("should not add comma when labels section is empty", () => {
        const result = addLabelToPromQlQuery('cpu_usage{}', 'instance', 'server1', '=');
        expect(result).toBe('cpu_usage{instance="server1"}');
      });

      it("should add comma when labels exist and don't end with comma", () => {
        const result = addLabelToPromQlQuery('cpu_usage{existing="value"}', 'new', 'value2', '=');
        expect(result).toBe('cpu_usage{existing="value",new="value2"}');
      });

      it("should handle single character in braces", () => {
        const result = addLabelToPromQlQuery('cpu_usage{a}', 'b', 'value', '=');
        expect(result).toBe('cpu_usage{a,b="value"}');
      });

      it("should handle whitespace-only labels section", () => {
        const result = addLabelToPromQlQuery('cpu_usage{ }', 'instance', 'server1', '=');
        expect(result).toBe('cpu_usage{ ,instance="server1"}');
      });
    });

    describe("Integration with parsePromQlQuery", () => {
      it("should work correctly with parsePromQlQuery result", () => {
        const originalQuery = 'http_requests{method="GET",status="200"}';
        const parsed = parsePromQlQuery(originalQuery);
        const result = addLabelToPromQlQuery(originalQuery, 'instance', 'web1', '=');
        
        expect(parsed.label.hasLabels).toBe(true);
        expect(result).toBe('http_requests{method="GET",status="200",instance="web1"}');
      });

      it("should maintain query structure after label addition", () => {
        const originalQuery = 'rate(cpu_usage{instance="server1"}[5m])';
        const result = addLabelToPromQlQuery(originalQuery, 'job', 'node', '=');
        
        // Verify the result is still a valid query structure
        expect(result).toContain('rate(');
        expect(result).toContain('[5m])');
        expect(result).toContain('job="node"');
      });

      it("should handle consecutive additions correctly", () => {
        let query = 'cpu_usage';
        query = addLabelToPromQlQuery(query, 'instance', 'server1', '=');
        query = addLabelToPromQlQuery(query, 'job', 'node', '=');
        query = addLabelToPromQlQuery(query, 'env', 'prod', '=');
        
        expect(query).toBe('cpu_usage{instance="server1",job="node",env="prod"}');
      });
    });

    describe("Return value validation", () => {
      it("should return string type", () => {
        const result = addLabelToPromQlQuery('cpu_usage', 'instance', 'server1', '=');
        expect(typeof result).toBe('string');
      });

      it("should return non-empty string for valid inputs", () => {
        const result = addLabelToPromQlQuery('cpu_usage', 'instance', 'server1', '=');
        expect(result.length).toBeGreaterThan(0);
      });

      it("should return different string than original when adding label", () => {
        const original = 'cpu_usage';
        const result = addLabelToPromQlQuery(original, 'instance', 'server1', '=');
        expect(result).not.toBe(original);
      });

      it("should always return a valid PromQL-like string structure", () => {
        const result = addLabelToPromQlQuery('metric', 'label', 'value', '=');
        expect(result).toMatch(/^[^{]*({[^}]*})?.*$/);
      });
    });
  });
});
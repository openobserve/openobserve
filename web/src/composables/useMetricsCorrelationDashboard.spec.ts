import { describe, it, expect, beforeEach } from "vitest";
import { useMetricsCorrelationDashboard, type MetricsCorrelationConfig } from "./useMetricsCorrelationDashboard";
import type { StreamInfo } from "@/services/service_streams";

describe("useMetricsCorrelationDashboard", () => {
  let composable: ReturnType<typeof useMetricsCorrelationDashboard>;

  beforeEach(() => {
    composable = useMetricsCorrelationDashboard();
  });

  describe("generateDashboard", () => {
    it("should generate dashboard with metrics panels", () => {
      const metricStreams: StreamInfo[] = [
        {
          stream_name: "cpu_usage",
          filters: { service: "api", environment: "prod" },
        },
        {
          stream_name: "memory_usage",
          filters: { service: "api", environment: "prod" },
        },
      ];

      const config: MetricsCorrelationConfig = {
        serviceName: "api-server",
        matchedDimensions: { service: "api", environment: "prod" },
        metricStreams: [],
        orgIdentifier: "test-org",
        timeRange: {
          startTime: 1000000000000000,
          endTime: 1000000900000000,
        },
      };

      const dashboard = composable.generateDashboard(metricStreams, config);

      expect(dashboard).toBeDefined();
      expect(dashboard.title).toBe("Correlated Streams - api-server");
      expect(dashboard.tabs).toHaveLength(1);
      expect(dashboard.tabs[0].panels).toHaveLength(2);
      expect(dashboard.tabs[0].panels[0].title).toBe("cpu_usage");
      expect(dashboard.tabs[0].panels[1].title).toBe("memory_usage");
    });

    it("should create panels with correct query structure", () => {
      const metricStreams: StreamInfo[] = [
        {
          stream_name: "cpu_usage",
          filters: { service: "api", "k8s-cluster": "prod" },
        },
      ];

      const config: MetricsCorrelationConfig = {
        serviceName: "api-server",
        matchedDimensions: { service: "api" },
        metricStreams: [],
        orgIdentifier: "test-org",
        timeRange: {
          startTime: 1000000000000000,
          endTime: 1000000900000000,
        },
      };

      const dashboard = composable.generateDashboard(metricStreams, config);
      const panel = dashboard.tabs[0].panels[0];

      expect(panel.queryType).toBe("sql");
      expect(panel.queries).toHaveLength(1);
      expect(panel.queries[0].query).toContain('FROM "cpu_usage"');
      expect(panel.queries[0].query).toContain("service = 'api'");
      expect(panel.queries[0].query).toContain('"k8s-cluster" = \'prod\'');
    });

    it("should handle special characters in filter values", () => {
      const metricStreams: StreamInfo[] = [
        {
          stream_name: "test_metric",
          filters: { description: "it's a test" },
        },
      ];

      const config: MetricsCorrelationConfig = {
        serviceName: "test",
        matchedDimensions: {},
        metricStreams: [],
        orgIdentifier: "test-org",
        timeRange: {
          startTime: 1000000000000000,
          endTime: 1000000900000000,
        },
      };

      const dashboard = composable.generateDashboard(metricStreams, config);
      const query = dashboard.tabs[0].panels[0].queries[0].query;

      // Single quotes should be escaped
      expect(query).toContain("description = 'it''s a test'");
    });

    it("should position panels in 3-column grid", () => {
      const metricStreams: StreamInfo[] = Array.from({ length: 6 }, (_, i) => ({
        stream_name: `metric_${i}`,
        filters: {},
      }));

      const config: MetricsCorrelationConfig = {
        serviceName: "test",
        matchedDimensions: {},
        metricStreams: [],
        orgIdentifier: "test-org",
        timeRange: {
          startTime: 1000000000000000,
          endTime: 1000000900000000,
        },
      };

      const dashboard = composable.generateDashboard(metricStreams, config);
      const panels = dashboard.tabs[0].panels;

      // First row
      expect(panels[0].layout.x).toBe(0);
      expect(panels[1].layout.x).toBe(64);
      expect(panels[2].layout.x).toBe(128);

      // Second row
      expect(panels[3].layout.x).toBe(0);
      expect(panels[3].layout.y).toBe(16);
    });
  });

  describe("generateLogsDashboard", () => {
    it("should generate logs dashboard with table panel", () => {
      const logStreams: StreamInfo[] = [
        {
          stream_name: "app_logs",
          filters: { service: "api", level: "error" },
        },
      ];

      const config: MetricsCorrelationConfig = {
        serviceName: "api-server",
        matchedDimensions: { service: "api" },
        metricStreams: [],
        orgIdentifier: "test-org",
        timeRange: {
          startTime: 1000000000000000,
          endTime: 1000000900000000,
        },
      };

      const dashboard = composable.generateLogsDashboard(logStreams, config);

      expect(dashboard).toBeDefined();
      expect(dashboard!.title).toBe("Correlated Streams - api-server");
      expect(dashboard!.tabs[0].panels).toHaveLength(1);
      expect(dashboard!.tabs[0].panels[0].type).toBe("table");
    });

    it("should use source stream when coming from logs page", () => {
      const config: MetricsCorrelationConfig = {
        serviceName: "api-server",
        matchedDimensions: { service: "api", environment: "prod" },
        metricStreams: [],
        orgIdentifier: "test-org",
        timeRange: {
          startTime: 1000000000000000,
          endTime: 1000000900000000,
        },
        sourceStream: "default",
        sourceType: "logs",
        availableDimensions: {
          service_name: "api",
          env: "prod",
          host: "server01",
        },
      };

      const dashboard = composable.generateLogsDashboard([], config);

      expect(dashboard).toBeDefined();
      expect(dashboard!.tabs[0].panels[0].queries[0].fields.stream).toBe("default");

      // Should only use matched dimension values, not all available fields
      const query = dashboard!.tabs[0].panels[0].queries[0].query;
      expect(query).toContain('FROM "default"');
      expect(query).toContain("service_name = 'api'");
      expect(query).toContain("env = 'prod'");
      expect(query).not.toContain("host = 'server01'"); // Not a matched dimension
    });

    it("should use correlated log streams from API", () => {
      const logStreams: StreamInfo[] = [
        {
          stream_name: "correlated_logs",
          filters: { "k8s-pod": "api-xyz", service: "api" },
        },
      ];

      const config: MetricsCorrelationConfig = {
        serviceName: "api-server",
        matchedDimensions: { service: "api" },
        metricStreams: [],
        orgIdentifier: "test-org",
        timeRange: {
          startTime: 1000000000000000,
          endTime: 1000000900000000,
        },
      };

      const dashboard = composable.generateLogsDashboard(logStreams, config);

      expect(dashboard).toBeDefined();
      const query = dashboard!.tabs[0].panels[0].queries[0].query;
      expect(query).toContain('FROM "correlated_logs"');
      expect(query).toContain('"k8s-pod" = \'api-xyz\'');
    });

    it("should return null when no log streams available", () => {
      const config: MetricsCorrelationConfig = {
        serviceName: "api-server",
        matchedDimensions: { service: "api" },
        metricStreams: [],
        orgIdentifier: "test-org",
        timeRange: {
          startTime: 1000000000000000,
          endTime: 1000000900000000,
        },
      };

      const dashboard = composable.generateLogsDashboard([], config);

      expect(dashboard).toBeNull();
    });

    it("should filter out non-string values from filters", () => {
      const config: MetricsCorrelationConfig = {
        serviceName: "api-server",
        matchedDimensions: { service: "api" },
        metricStreams: [],
        orgIdentifier: "test-org",
        timeRange: {
          startTime: 1000000000000000,
          endTime: 1000000900000000,
        },
        sourceStream: "default",
        sourceType: "logs",
        availableDimensions: {
          service_name: "api",
          port: 8080 as any, // Non-string value
          enabled: true as any, // Non-string value
          _timestamp: 123456 as any, // Internal field
        },
      };

      const dashboard = composable.generateLogsDashboard([], config);

      const query = dashboard!.tabs[0].panels[0].queries[0].query;
      // Should only include service_name (string, non-internal) in WHERE clause
      expect(query).toContain("service_name = 'api'");
      expect(query).not.toContain("port");
      expect(query).not.toContain("enabled");
      // _timestamp appears in ORDER BY, not in WHERE clause (which is correct)
      expect(query).toContain("ORDER BY _timestamp");
    });

    it("should quote field names with special characters", () => {
      const logStreams: StreamInfo[] = [
        {
          stream_name: "app_logs",
          filters: {
            "k8s-cluster": "prod",
            "k8s-namespace": "default",
            service: "api",
          },
        },
      ];

      const config: MetricsCorrelationConfig = {
        serviceName: "api-server",
        matchedDimensions: {},
        metricStreams: [],
        orgIdentifier: "test-org",
        timeRange: {
          startTime: 1000000000000000,
          endTime: 1000000900000000,
        },
      };

      const dashboard = composable.generateLogsDashboard(logStreams, config);
      const query = dashboard!.tabs[0].panels[0].queries[0].query;

      // Fields with hyphens should be quoted
      expect(query).toContain('"k8s-cluster" = \'prod\'');
      expect(query).toContain('"k8s-namespace" = \'default\'');
      // Regular field names should not be quoted
      expect(query).toContain("service = 'api'");
    });

    it("should set table_dynamic_columns for logs panel", () => {
      const logStreams: StreamInfo[] = [
        { stream_name: "app_logs", filters: {} },
      ];

      const config: MetricsCorrelationConfig = {
        serviceName: "api-server",
        matchedDimensions: {},
        metricStreams: [],
        orgIdentifier: "test-org",
        timeRange: {
          startTime: 1000000000000000,
          endTime: 1000000900000000,
        },
      };

      const dashboard = composable.generateLogsDashboard(logStreams, config);

      expect(dashboard!.tabs[0].panels[0].config.table_dynamic_columns).toBe(true);
      expect(dashboard!.tabs[0].panels[0].type).toBe("table");
    });
  });

  describe("edge cases", () => {
    it("should handle empty matched dimensions", () => {
      const config: MetricsCorrelationConfig = {
        serviceName: "test",
        matchedDimensions: {},
        metricStreams: [],
        orgIdentifier: "test-org",
        timeRange: {
          startTime: 1000000000000000,
          endTime: 1000000900000000,
        },
        sourceStream: "default",
        sourceType: "logs",
        availableDimensions: {},
      };

      const dashboard = composable.generateLogsDashboard([], config);

      expect(dashboard).toBeDefined();
      const query = dashboard!.tabs[0].panels[0].queries[0].query;
      // Should have no WHERE clause but should have LIMIT 100
      expect(query).toBe('SELECT * FROM "default"  ORDER BY _timestamp DESC LIMIT 100');
    });

    it("should handle streams with empty filters", () => {
      const logStreams: StreamInfo[] = [
        { stream_name: "app_logs", filters: {} },
      ];

      const config: MetricsCorrelationConfig = {
        serviceName: "test",
        matchedDimensions: {},
        metricStreams: [],
        orgIdentifier: "test-org",
        timeRange: {
          startTime: 1000000000000000,
          endTime: 1000000900000000,
        },
      };

      const dashboard = composable.generateLogsDashboard(logStreams, config);

      const query = dashboard!.tabs[0].panels[0].queries[0].query;
      expect(query).toContain('FROM "app_logs"');
      expect(query).not.toContain("WHERE");
    });

    it("should use time range from config", () => {
      const metricStreams: StreamInfo[] = [
        { stream_name: "cpu", filters: {} },
      ];

      const config: MetricsCorrelationConfig = {
        serviceName: "test",
        matchedDimensions: {},
        metricStreams: [],
        orgIdentifier: "test-org",
        timeRange: {
          startTime: 1234567890000000,
          endTime: 1234567990000000,
        },
      };

      const dashboard = composable.generateDashboard(metricStreams, config);

      expect(dashboard.defaultDatetimeDuration.startTime).toBe(1234567890000000);
      expect(dashboard.defaultDatetimeDuration.endTime).toBe(1234567990000000);
    });
  });
});

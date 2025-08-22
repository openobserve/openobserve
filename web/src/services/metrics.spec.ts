import { describe, it, expect, vi, beforeEach } from "vitest";
import metrics from "./metrics";

// Mock http service
vi.mock("./http", () => ({
  default: vi.fn(() => ({
    get: vi.fn(),
  })),
}));

import http from "./http";

describe("Metrics Service", () => {
  let mockHttp: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockHttp = {
      get: vi.fn().mockResolvedValue({ data: {} }),
    };
    (http as any).mockReturnValue(mockHttp);
  });

  describe("formatPromqlQuery", () => {
    it("should format PromQL query with correct URL and parameters", async () => {
      const queryParams = {
        org_identifier: "test-org",
        query: "up",
      };

      await metrics.formatPromqlQuery(queryParams);

      expect(mockHttp.get).toHaveBeenCalledWith(
        "/api/test-org/prometheus/api/v1/format_query?query=up"
      );
    });

    it("should handle different organization identifiers", async () => {
      const organizations = [
        "simple-org",
        "org-with-dashes",
        "org_with_underscores",
        "production.env",
        "12345",
        "ORG-UPPERCASE",
      ];

      for (const org of organizations) {
        await metrics.formatPromqlQuery({
          org_identifier: org,
          query: "cpu_usage",
        });
        expect(mockHttp.get).toHaveBeenCalledWith(
          `/api/${org}/prometheus/api/v1/format_query?query=cpu_usage`
        );
      }
    });

    it("should handle different PromQL queries", async () => {
      const queries = [
        "up",
        "cpu_usage_percent",
        "rate(http_requests_total[5m])",
        "sum by (instance) (up)",
        "histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))",
        "node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes * 100",
      ];

      for (const query of queries) {
        await metrics.formatPromqlQuery({
          org_identifier: "test-org",
          query: query,
        });
        expect(mockHttp.get).toHaveBeenCalledWith(
          `/api/test-org/prometheus/api/v1/format_query?query=${query}`
        );
      }
    });

    it("should handle queries with special characters", async () => {
      const specialQueries = [
        "sum(rate(http_requests_total{status=~\"5..\"}[5m]))",
        "up{job=\"prometheus\",instance=\"localhost:9090\"}",
        "rate(http_requests_total{method=\"GET\",status=\"200\"}[5m])",
        "cpu_usage{host=\"server-1\",environment=\"production\"}",
      ];

      for (const query of specialQueries) {
        await metrics.formatPromqlQuery({
          org_identifier: "test-org",
          query: query,
        });
        expect(mockHttp.get).toHaveBeenCalledWith(
          `/api/test-org/prometheus/api/v1/format_query?query=${query}`
        );
      }
    });

    it("should handle empty query", async () => {
      await metrics.formatPromqlQuery({
        org_identifier: "test-org",
        query: "",
      });

      expect(mockHttp.get).toHaveBeenCalledWith(
        "/api/test-org/prometheus/api/v1/format_query?query="
      );
    });

    it("should handle empty organization identifier", async () => {
      await metrics.formatPromqlQuery({
        org_identifier: "",
        query: "up",
      });

      expect(mockHttp.get).toHaveBeenCalledWith(
        "/api//prometheus/api/v1/format_query?query=up"
      );
    });

    it("should handle default parameters when not provided", async () => {
      await metrics.formatPromqlQuery({});

      expect(mockHttp.get).toHaveBeenCalledWith(
        "/api//prometheus/api/v1/format_query?query="
      );
    });

    it("should handle long and complex queries", async () => {
      const complexQuery = `
        sum by (instance) (
          rate(http_requests_total{job="api-server"}[5m])
        ) /
        sum by (instance) (
          rate(http_requests_total{job="api-server"}[5m])
        )
      `.trim();

      await metrics.formatPromqlQuery({
        org_identifier: "production",
        query: complexQuery,
      });

      expect(mockHttp.get).toHaveBeenCalledWith(
        `/api/production/prometheus/api/v1/format_query?query=${complexQuery}`
      );
    });

    it("should preserve query parameters exactly as provided", async () => {
      const queryWithSpaces = "sum by (job) (up)";
      const queryWithTabs = "rate(cpu_usage\t[5m])";
      const queryWithNewlines = "up\n{job=\"test\"}";

      await metrics.formatPromqlQuery({
        org_identifier: "test",
        query: queryWithSpaces,
      });
      expect(mockHttp.get).toHaveBeenCalledWith(
        `/api/test/prometheus/api/v1/format_query?query=${queryWithSpaces}`
      );

      await metrics.formatPromqlQuery({
        org_identifier: "test",
        query: queryWithTabs,
      });
      expect(mockHttp.get).toHaveBeenCalledWith(
        `/api/test/prometheus/api/v1/format_query?query=${queryWithTabs}`
      );

      await metrics.formatPromqlQuery({
        org_identifier: "test",
        query: queryWithNewlines,
      });
      expect(mockHttp.get).toHaveBeenCalledWith(
        `/api/test/prometheus/api/v1/format_query?query=${queryWithNewlines}`
      );
    });
  });

  describe("get_promql_series", () => {
    it("should get PromQL series with correct URL and parameters", async () => {
      const params = {
        org_identifier: "test-org",
        labels: "up",
        start_time: 1640995200,
        end_time: 1641081600,
      };

      await metrics.get_promql_series(params);

      expect(mockHttp.get).toHaveBeenCalledWith(
        "/api/test-org/prometheus/api/v1/series?match[]=up&start=1640995200&end=1641081600"
      );
    });

    it("should handle different organization identifiers", async () => {
      const organizations = [
        "simple-org",
        "org-with-dashes",
        "org_with_underscores",
        "production.environment",
        "12345",
        "ORG-UPPERCASE",
      ];

      const baseParams = {
        labels: "cpu_usage",
        start_time: 1640995200,
        end_time: 1641081600,
      };

      for (const org of organizations) {
        await metrics.get_promql_series({
          org_identifier: org,
          ...baseParams,
        });
        expect(mockHttp.get).toHaveBeenCalledWith(
          `/api/${org}/prometheus/api/v1/series?match[]=cpu_usage&start=1640995200&end=1641081600`
        );
      }
    });

    it("should handle different label patterns", async () => {
      const labelPatterns = [
        "up",
        "cpu_usage_percent",
        "{job=\"prometheus\"}",
        "{__name__=\"up\"}",
        "{job=\"api\",instance=\"localhost:8080\"}",
        "{status=~\"5..\"}",
        "{environment=\"production\",service=~\"api.*\"}",
      ];

      const baseParams = {
        org_identifier: "test-org",
        start_time: 1640995200,
        end_time: 1641081600,
      };

      for (const labels of labelPatterns) {
        await metrics.get_promql_series({
          ...baseParams,
          labels: labels,
        });
        expect(mockHttp.get).toHaveBeenCalledWith(
          `/api/test-org/prometheus/api/v1/series?match[]=${labels}&start=1640995200&end=1641081600`
        );
      }
    });

    it("should handle different time ranges", async () => {
      const timeRanges = [
        { start_time: 0, end_time: 1000 },
        { start_time: 1640995200, end_time: 1641081600 }, // 1 day range
        { start_time: 1640995200, end_time: 1643673600 }, // 1 month range
        { start_time: 1609459200, end_time: 1641081600 }, // 1 year range
        { start_time: 1577836800, end_time: 1735689600 }, // Multi-year range
      ];

      const baseParams = {
        org_identifier: "test-org",
        labels: "up",
      };

      for (const timeRange of timeRanges) {
        await metrics.get_promql_series({
          ...baseParams,
          ...timeRange,
        });
        expect(mockHttp.get).toHaveBeenCalledWith(
          `/api/test-org/prometheus/api/v1/series?match[]=up&start=${timeRange.start_time}&end=${timeRange.end_time}`
        );
      }
    });

    it("should handle edge case time values", async () => {
      const edgeCases = [
        { start_time: 0, end_time: 0 },
        { start_time: -1, end_time: 1 },
        { start_time: 1640995200, end_time: 1640995200 }, // Same start and end
        { start_time: Number.MAX_SAFE_INTEGER, end_time: Number.MAX_SAFE_INTEGER },
      ];

      const baseParams = {
        org_identifier: "test-org",
        labels: "up",
      };

      for (const timeRange of edgeCases) {
        await metrics.get_promql_series({
          ...baseParams,
          ...timeRange,
        });
        expect(mockHttp.get).toHaveBeenCalledWith(
          `/api/test-org/prometheus/api/v1/series?match[]=up&start=${timeRange.start_time}&end=${timeRange.end_time}`
        );
      }
    });

    it("should handle complex label selectors", async () => {
      const complexLabels = [
        "{job=\"prometheus\",instance=\"localhost:9090\"}",
        "{__name__=~\"http_.*\",method=\"GET\"}",
        "{service=\"api\",status=~\"[45]..\",environment!=\"test\"}",
        "{instance=~\"web.*\",job!=\"blackbox\"}",
        "node_cpu_seconds_total{cpu=\"0\",mode!=\"idle\"}",
      ];

      const baseParams = {
        org_identifier: "production",
        start_time: 1640995200,
        end_time: 1641081600,
      };

      for (const labels of complexLabels) {
        await metrics.get_promql_series({
          ...baseParams,
          labels: labels,
        });
        expect(mockHttp.get).toHaveBeenCalledWith(
          `/api/production/prometheus/api/v1/series?match[]=${labels}&start=1640995200&end=1641081600`
        );
      }
    });

    it("should handle empty label selector", async () => {
      await metrics.get_promql_series({
        org_identifier: "test-org",
        labels: "",
        start_time: 1640995200,
        end_time: 1641081600,
      });

      expect(mockHttp.get).toHaveBeenCalledWith(
        "/api/test-org/prometheus/api/v1/series?match[]=&start=1640995200&end=1641081600"
      );
    });

    it("should handle labels with special URL characters", async () => {
      const specialLabels = [
        "{job=\"test job with spaces\"}",
        "{message=\"error: something failed\"}",
        "{query=\"value with & ampersand\"}",
        "{path=\"/api/v1?param=value\"}",
        "{description=\"100% CPU usage\"}",
      ];

      const baseParams = {
        org_identifier: "test-org",
        start_time: 1640995200,
        end_time: 1641081600,
      };

      for (const labels of specialLabels) {
        await metrics.get_promql_series({
          ...baseParams,
          labels: labels,
        });
        expect(mockHttp.get).toHaveBeenCalledWith(
          `/api/test-org/prometheus/api/v1/series?match[]=${labels}&start=1640995200&end=1641081600`
        );
      }
    });
  });

  describe("Integration tests", () => {
    it("should handle both functions with same organization", async () => {
      const org = "integration-org";
      
      await metrics.formatPromqlQuery({
        org_identifier: org,
        query: "up",
      });

      await metrics.get_promql_series({
        org_identifier: org,
        labels: "up",
        start_time: 1640995200,
        end_time: 1641081600,
      });

      expect(mockHttp.get).toHaveBeenCalledWith(
        "/api/integration-org/prometheus/api/v1/format_query?query=up"
      );
      expect(mockHttp.get).toHaveBeenCalledWith(
        "/api/integration-org/prometheus/api/v1/series?match[]=up&start=1640995200&end=1641081600"
      );
    });

    it("should maintain URL consistency for Prometheus API", async () => {
      await metrics.formatPromqlQuery({
        org_identifier: "consistent-org",
        query: "test_metric",
      });

      await metrics.get_promql_series({
        org_identifier: "consistent-org",
        labels: "test_metric",
        start_time: 1000,
        end_time: 2000,
      });

      // Both should use the same base path structure
      expect(mockHttp.get).toHaveBeenCalledWith(
        "/api/consistent-org/prometheus/api/v1/format_query?query=test_metric"
      );
      expect(mockHttp.get).toHaveBeenCalledWith(
        "/api/consistent-org/prometheus/api/v1/series?match[]=test_metric&start=1000&end=2000"
      );
    });

    it("should handle workflow of formatting then querying series", async () => {
      const workflow = {
        org_identifier: "workflow-org",
        query: "rate(http_requests_total[5m])",
        labels: "rate(http_requests_total[5m])",
        start_time: 1640995200,
        end_time: 1641081600,
      };

      // First format the query
      await metrics.formatPromqlQuery({
        org_identifier: workflow.org_identifier,
        query: workflow.query,
      });

      // Then get series data for the same metric
      await metrics.get_promql_series({
        org_identifier: workflow.org_identifier,
        labels: workflow.labels,
        start_time: workflow.start_time,
        end_time: workflow.end_time,
      });

      expect(mockHttp.get).toHaveBeenCalledTimes(2);
      expect(mockHttp.get).toHaveBeenNthCalledWith(1,
        "/api/workflow-org/prometheus/api/v1/format_query?query=rate(http_requests_total[5m])"
      );
      expect(mockHttp.get).toHaveBeenNthCalledWith(2,
        "/api/workflow-org/prometheus/api/v1/series?match[]=rate(http_requests_total[5m])&start=1640995200&end=1641081600"
      );
    });
  });
});
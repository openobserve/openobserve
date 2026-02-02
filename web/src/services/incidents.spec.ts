// Copyright 2025 OpenObserve Inc.
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

import { describe, expect, it, vi, beforeEach } from "vitest";
import incidents from "./incidents";
import http from "./http";
import serviceStreamsApi from "./service_streams";

// Mock the http module
vi.mock("./http");
vi.mock("./service_streams");

describe("incidents service", () => {
  const mockHttp = {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (http as any).mockReturnValue(mockHttp);
  });

  describe("list", () => {
    it("should call http.get with correct URL for basic list", () => {
      mockHttp.get.mockResolvedValue({ data: { incidents: [], total: 0 } });

      incidents.list("test-org");

      expect(http).toHaveBeenCalled();
      expect(mockHttp.get).toHaveBeenCalledWith(
        "/api/v2/test-org/alerts/incidents?limit=50&offset=0"
      );
    });

    it("should include status parameter when provided", () => {
      mockHttp.get.mockResolvedValue({ data: { incidents: [], total: 0 } });

      incidents.list("test-org", "open");

      expect(mockHttp.get).toHaveBeenCalledWith(
        "/api/v2/test-org/alerts/incidents?limit=50&offset=0&status=open"
      );
    });

    it("should use custom limit and offset", () => {
      mockHttp.get.mockResolvedValue({ data: { incidents: [], total: 0 } });

      incidents.list("test-org", undefined, 20, 10);

      expect(mockHttp.get).toHaveBeenCalledWith(
        "/api/v2/test-org/alerts/incidents?limit=20&offset=10"
      );
    });

    it("should include status with custom pagination", () => {
      mockHttp.get.mockResolvedValue({ data: { incidents: [], total: 0 } });

      incidents.list("test-org", "resolved", 100, 50);

      expect(mockHttp.get).toHaveBeenCalledWith(
        "/api/v2/test-org/alerts/incidents?limit=100&offset=50&status=resolved"
      );
    });
  });

  describe("get", () => {
    it("should call http.get with correct URL", () => {
      mockHttp.get.mockResolvedValue({
        data: {
          id: "incident-123",
          alerts: [],
        },
      });

      incidents.get("test-org", "incident-123");

      expect(http).toHaveBeenCalled();
      expect(mockHttp.get).toHaveBeenCalledWith(
        "/api/v2/test-org/alerts/incidents/incident-123"
      );
    });
  });

  describe("updateStatus", () => {
    it("should call http.patch with correct URL and status", () => {
      mockHttp.patch.mockResolvedValue({ data: { id: "incident-123" } });

      incidents.updateStatus("test-org", "incident-123", "acknowledged");

      expect(http).toHaveBeenCalled();
      expect(mockHttp.patch).toHaveBeenCalledWith(
        "/api/v2/test-org/alerts/incidents/incident-123/status",
        { status: "acknowledged" }
      );
    });

    it("should handle open status", () => {
      mockHttp.patch.mockResolvedValue({ data: { id: "incident-123" } });

      incidents.updateStatus("test-org", "incident-123", "open");

      expect(mockHttp.patch).toHaveBeenCalledWith(
        "/api/v2/test-org/alerts/incidents/incident-123/status",
        { status: "open" }
      );
    });

    it("should handle resolved status", () => {
      mockHttp.patch.mockResolvedValue({ data: { id: "incident-123" } });

      incidents.updateStatus("test-org", "incident-123", "resolved");

      expect(mockHttp.patch).toHaveBeenCalledWith(
        "/api/v2/test-org/alerts/incidents/incident-123/status",
        { status: "resolved" }
      );
    });
  });

  describe("getStats", () => {
    it("should call http.get with correct URL", () => {
      mockHttp.get.mockResolvedValue({
        data: {
          total_incidents: 10,
          open_incidents: 3,
          acknowledged_incidents: 2,
          resolved_incidents: 5,
        },
      });

      incidents.getStats("test-org");

      expect(http).toHaveBeenCalled();
      expect(mockHttp.get).toHaveBeenCalledWith(
        "/api/v2/test-org/alerts/incidents/stats"
      );
    });
  });

  describe("triggerRca", () => {
    it("should call http.post with correct URL", () => {
      mockHttp.post.mockResolvedValue({
        data: { rca_content: "Analysis result" },
      });

      incidents.triggerRca("test-org", "incident-123");

      expect(http).toHaveBeenCalled();
      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/v2/test-org/alerts/incidents/incident-123/rca"
      );
    });
  });

  describe("getCorrelatedStreams", () => {
    it("should call correlate API with incident stable dimensions", async () => {
      const mockIncident = {
        id: "incident-123",
        stable_dimensions: {
          service: "api-gateway",
          namespace: "production",
        },
        first_alert_at: 1000000,
        last_alert_at: 2000000,
      } as any;

      const mockCorrelationResponse = {
        data: {
          service_name: "api-gateway",
          matched_dimensions: { service: "api-gateway" },
          additional_dimensions: { namespace: "production" },
          related_streams: {
            logs: [{ stream_name: "default", filters: {} }],
            metrics: [{ stream_name: "metrics", filters: {} }],
            traces: [{ stream_name: "traces", filters: {} }],
          },
        },
      };

      vi.mocked(serviceStreamsApi.correlate).mockResolvedValue(mockCorrelationResponse);

      const result = await incidents.getCorrelatedStreams("test-org", mockIncident);

      expect(serviceStreamsApi.correlate).toHaveBeenCalledWith("test-org", {
        source_stream: "api-gateway",
        source_type: "logs",
        available_dimensions: mockIncident.stable_dimensions,
      });

      expect(result.serviceName).toBe("api-gateway");
      expect(result.logStreams).toHaveLength(1);
      expect(result.metricStreams).toHaveLength(1);
      expect(result.traceStreams).toHaveLength(1);
    });

    it("should fallback to default when service dimension missing", async () => {
      const mockIncident = {
        id: "incident-123",
        stable_dimensions: {
          namespace: "production",
        },
      } as any;

      const mockCorrelationResponse = {
        data: {
          service_name: "unknown",
          matched_dimensions: {},
          additional_dimensions: {},
          related_streams: { logs: [], metrics: [], traces: [] },
        },
      };

      vi.mocked(serviceStreamsApi.correlate).mockResolvedValue(mockCorrelationResponse);

      await incidents.getCorrelatedStreams("test-org", mockIncident);

      expect(serviceStreamsApi.correlate).toHaveBeenCalledWith("test-org", {
        source_stream: "default",
        source_type: "logs",
        available_dimensions: mockIncident.stable_dimensions,
      });
    });

    it("should check multiple service dimension variations", async () => {
      const mockIncident = {
        id: "incident-123",
        stable_dimensions: {
          serviceName: "api-gateway",
        },
      } as any;

      const mockCorrelationResponse = {
        data: {
          service_name: "api-gateway",
          matched_dimensions: {},
          additional_dimensions: {},
          related_streams: { logs: [], metrics: [], traces: [] },
        },
      };

      vi.mocked(serviceStreamsApi.correlate).mockResolvedValue(mockCorrelationResponse);

      await incidents.getCorrelatedStreams("test-org", mockIncident);

      expect(serviceStreamsApi.correlate).toHaveBeenCalledWith("test-org", {
        source_stream: "api-gateway",
        source_type: "logs",
        available_dimensions: mockIncident.stable_dimensions,
      });
    });
  });

  describe("extractTraceId", () => {
    it("should extract trace_id from stable dimensions", () => {
      const incident = {
        stable_dimensions: {
          trace_id: "abc123",
        },
      } as any;

      const result = incidents.extractTraceId(incident);
      expect(result).toBe("abc123");
    });

    it("should handle traceId variation", () => {
      const incident = {
        stable_dimensions: {
          traceId: "xyz789",
        },
      } as any;

      const result = incidents.extractTraceId(incident);
      expect(result).toBe("xyz789");
    });

    it("should handle trace.id variation", () => {
      const incident = {
        stable_dimensions: {
          "trace.id": "def456",
        },
      } as any;

      const result = incidents.extractTraceId(incident);
      expect(result).toBe("def456");
    });

    it("should return undefined when no trace_id found", () => {
      const incident = {
        stable_dimensions: {
          service: "api-gateway",
        },
      } as any;

      const result = incidents.extractTraceId(incident);
      expect(result).toBeUndefined();
    });
  });

  describe("getServiceGraph", () => {
    it("should call http.get with correct URL", () => {
      mockHttp.get.mockResolvedValue({
        data: {
          incident_service: "api-gateway",
          nodes: [],
          edges: [],
        },
      });

      incidents.getServiceGraph("test-org", "incident-123");

      expect(http).toHaveBeenCalled();
      expect(mockHttp.get).toHaveBeenCalledWith(
        "/api/v2/test-org/alerts/incidents/incident-123/service_graph"
      );
    });
  });
});

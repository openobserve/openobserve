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

import { describe, expect, it, beforeEach, vi } from "vitest";
import serviceGraphService from "@/services/service_graph";
import http from "@/services/http";

vi.mock("@/services/http", () => ({
  default: vi.fn(() => ({
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  })),
}));

describe("service_graph service", () => {
  let mockHttpInstance: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockHttpInstance = {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };
    (http as any).mockReturnValue(mockHttpInstance);
  });

  describe("getCurrentTopology", () => {
    it("should make GET request with empty params when no options provided", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: { nodes: [], edges: [] } });

      await serviceGraphService.getCurrentTopology("test-org");

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/test-org/traces/service_graph/topology/current",
        { params: {} }
      );
    });

    it("should include stream_name param when streamName is provided and not 'all'", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: {} });

      await serviceGraphService.getCurrentTopology("test-org", {
        streamName: "my-stream",
      });

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/test-org/traces/service_graph/topology/current",
        { params: { stream_name: "my-stream" } }
      );
    });

    it("should NOT include stream_name param when streamName is 'all'", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: {} });

      await serviceGraphService.getCurrentTopology("test-org", {
        streamName: "all",
      });

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/test-org/traces/service_graph/topology/current",
        { params: {} }
      );
    });

    it("should include start_time param when startTime is provided", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: {} });

      await serviceGraphService.getCurrentTopology("test-org", {
        startTime: 1700000000,
      });

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/test-org/traces/service_graph/topology/current",
        { params: { start_time: 1700000000 } }
      );
    });

    it("should include end_time param when endTime is provided", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: {} });

      await serviceGraphService.getCurrentTopology("test-org", {
        endTime: 1700003600,
      });

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/test-org/traces/service_graph/topology/current",
        { params: { end_time: 1700003600 } }
      );
    });

    it("should include all params when all options are provided and streamName is not 'all'", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: {} });

      await serviceGraphService.getCurrentTopology("test-org", {
        streamName: "traces-default",
        startTime: 1700000000,
        endTime: 1700003600,
      });

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/test-org/traces/service_graph/topology/current",
        {
          params: {
            stream_name: "traces-default",
            start_time: 1700000000,
            end_time: 1700003600,
          },
        }
      );
    });

    it("should handle different org identifiers", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: {} });

      const orgs = ["prod-org", "staging-env", "dev_org"];
      for (const org of orgs) {
        await serviceGraphService.getCurrentTopology(org);
        expect(mockHttpInstance.get).toHaveBeenCalledWith(
          `/api/${org}/traces/service_graph/topology/current`,
          { params: {} }
        );
      }
    });

    it("should propagate errors", async () => {
      mockHttpInstance.get.mockRejectedValue(new Error("Service unavailable"));

      await expect(
        serviceGraphService.getCurrentTopology("test-org")
      ).rejects.toThrow("Service unavailable");
    });
  });

  describe("getEdgeHistory", () => {
    it("should make GET request with empty params when no options provided", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: { history: [] } });

      await serviceGraphService.getEdgeHistory("test-org", {});

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/test-org/traces/service_graph/edge/history",
        { params: {} }
      );
    });

    it("should include client_service param when provided", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: {} });

      await serviceGraphService.getEdgeHistory("test-org", {
        client_service: "frontend",
      });

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/test-org/traces/service_graph/edge/history",
        { params: { client_service: "frontend" } }
      );
    });

    it("should include server_service param when provided", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: {} });

      await serviceGraphService.getEdgeHistory("test-org", {
        server_service: "backend-api",
      });

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/test-org/traces/service_graph/edge/history",
        { params: { server_service: "backend-api" } }
      );
    });

    it("should include start_time param when provided", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: {} });

      await serviceGraphService.getEdgeHistory("test-org", {
        start_time: 1700000000,
      });

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/test-org/traces/service_graph/edge/history",
        { params: { start_time: 1700000000 } }
      );
    });

    it("should include end_time param when provided", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: {} });

      await serviceGraphService.getEdgeHistory("test-org", {
        end_time: 1700003600,
      });

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/test-org/traces/service_graph/edge/history",
        { params: { end_time: 1700003600 } }
      );
    });

    it("should include stream_name param when provided and not 'all'", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: {} });

      await serviceGraphService.getEdgeHistory("test-org", {
        stream_name: "traces-stream",
      });

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/test-org/traces/service_graph/edge/history",
        { params: { stream_name: "traces-stream" } }
      );
    });

    it("should NOT include stream_name when stream_name is 'all'", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: {} });

      await serviceGraphService.getEdgeHistory("test-org", {
        stream_name: "all",
      });

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/test-org/traces/service_graph/edge/history",
        { params: {} }
      );
    });

    it("should include all provided params together", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: {} });

      await serviceGraphService.getEdgeHistory("test-org", {
        client_service: "gateway",
        server_service: "auth-service",
        start_time: 1700000000,
        end_time: 1700003600,
        stream_name: "default-traces",
      });

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/test-org/traces/service_graph/edge/history",
        {
          params: {
            client_service: "gateway",
            server_service: "auth-service",
            start_time: 1700000000,
            end_time: 1700003600,
            stream_name: "default-traces",
          },
        }
      );
    });

    it("should propagate errors", async () => {
      mockHttpInstance.get.mockRejectedValue(new Error("Not found"));

      await expect(
        serviceGraphService.getEdgeHistory("test-org", {
          client_service: "svc-a",
          server_service: "svc-b",
        })
      ).rejects.toThrow("Not found");
    });
  });

  describe("integration tests", () => {
    it("should support querying topology then edge history in sequence", async () => {
      mockHttpInstance.get
        .mockResolvedValueOnce({
          data: {
            nodes: ["svc-a", "svc-b"],
            edges: [{ from: "svc-a", to: "svc-b" }],
          },
        })
        .mockResolvedValueOnce({ data: { history: [{ ts: 1700000100 }] } });

      const topology = await serviceGraphService.getCurrentTopology(
        "test-org",
        { startTime: 1700000000, endTime: 1700003600 }
      );
      const edgeHistory = await serviceGraphService.getEdgeHistory("test-org", {
        client_service: "svc-a",
        server_service: "svc-b",
        start_time: 1700000000,
        end_time: 1700003600,
      });

      expect(mockHttpInstance.get).toHaveBeenCalledTimes(2);
      expect(topology.data.nodes).toHaveLength(2);
      expect(edgeHistory.data.history).toHaveLength(1);
    });
  });
});

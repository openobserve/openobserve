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
import serviceGraphService, {
  servicesTrend,
  type ServicesTrendResponse,
} from "@/services/service_graph";
import { servicesTrendQuery, serviceTopologyQuery } from "@/services/service_graph.queries";
import { topologyKeys } from "@/services/service_graph.querykeys";
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
        { params: {} },
      );
    });

    it("should include stream_name param when streamName is provided and not 'all'", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: {} });

      await serviceGraphService.getCurrentTopology("test-org", {
        streamName: "my-stream",
      });

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/test-org/traces/service_graph/topology/current",
        { params: { stream_name: "my-stream" } },
      );
    });

    it("should NOT include stream_name param when streamName is 'all'", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: {} });

      await serviceGraphService.getCurrentTopology("test-org", {
        streamName: "all",
      });

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/test-org/traces/service_graph/topology/current",
        { params: {} },
      );
    });

    it("should include start_time param when startTime is provided", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: {} });

      await serviceGraphService.getCurrentTopology("test-org", {
        startTime: 1700000000,
      });

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/test-org/traces/service_graph/topology/current",
        { params: { start_time: 1700000000 } },
      );
    });

    it("should include end_time param when endTime is provided", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: {} });

      await serviceGraphService.getCurrentTopology("test-org", {
        endTime: 1700003600,
      });

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/test-org/traces/service_graph/topology/current",
        { params: { end_time: 1700003600 } },
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
        },
      );
    });

    it("should include agent_id param when agentId is provided", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: {} });

      await serviceGraphService.getCurrentTopology("test-org", {
        agentId: "agent-123",
      });

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/test-org/traces/service_graph/topology/current",
        { params: { agent_id: "agent-123" } },
      );
    });

    it("should include agent_name param when agentName is provided", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: {} });

      await serviceGraphService.getCurrentTopology("test-org", {
        agentName: "my-agent",
      });

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/test-org/traces/service_graph/topology/current",
        { params: { agent_name: "my-agent" } },
      );
    });

    it("should include agent_env param when agentEnv is provided", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: {} });

      await serviceGraphService.getCurrentTopology("test-org", {
        agentEnv: "production",
      });

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/test-org/traces/service_graph/topology/current",
        { params: { agent_env: "production" } },
      );
    });

    it("should include all agent params together (id, name, env)", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: {} });

      await serviceGraphService.getCurrentTopology("test-org", {
        agentId: "agent-123",
        agentName: "my-agent",
        agentEnv: "production",
      });

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/test-org/traces/service_graph/topology/current",
        {
          params: {
            agent_id: "agent-123",
            agent_name: "my-agent",
            agent_env: "production",
          },
        },
      );
    });

    it("should NOT include agent params when they are null", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: {} });

      await serviceGraphService.getCurrentTopology("test-org", {
        agentId: null,
        agentName: null,
        agentEnv: null,
      });

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/test-org/traces/service_graph/topology/current",
        { params: {} },
      );
    });

    it("should NEVER send agent_version to the backend (topology is version-agnostic)", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: {} });

      // Pass an agentVersion-like key; it must never surface as a param.
      await serviceGraphService.getCurrentTopology("test-org", {
        agentId: "agent-123",
        agentEnv: "production",
        // @ts-expect-error agentVersion is intentionally not part of ServiceGraphParams
        agentVersion: "v2.0.0",
      });

      const callArgs = mockHttpInstance.get.mock.calls[0][1];
      expect(callArgs.params.agent_version).toBeUndefined();
      expect(callArgs.params).not.toHaveProperty("agent_version");
    });

    it("should handle different org identifiers", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: {} });

      const orgs = ["prod-org", "staging-env", "dev_org"];
      for (const org of orgs) {
        await serviceGraphService.getCurrentTopology(org);
        expect(mockHttpInstance.get).toHaveBeenCalledWith(
          `/api/${org}/traces/service_graph/topology/current`,
          { params: {} },
        );
      }
    });

    it("should propagate errors", async () => {
      mockHttpInstance.get.mockRejectedValue(new Error("Service unavailable"));

      await expect(serviceGraphService.getCurrentTopology("test-org")).rejects.toThrow(
        "Service unavailable",
      );
    });
  });

  describe("getEdgeHistory", () => {
    it("should make GET request with empty params when no options provided", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: { history: [] } });

      await serviceGraphService.getEdgeHistory("test-org", {});

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/test-org/traces/service_graph/edge/history",
        { params: {} },
      );
    });

    it("should include client_service param when provided", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: {} });

      await serviceGraphService.getEdgeHistory("test-org", {
        client_service: "frontend",
      });

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/test-org/traces/service_graph/edge/history",
        { params: { client_service: "frontend" } },
      );
    });

    it("should include server_service param when provided", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: {} });

      await serviceGraphService.getEdgeHistory("test-org", {
        server_service: "backend-api",
      });

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/test-org/traces/service_graph/edge/history",
        { params: { server_service: "backend-api" } },
      );
    });

    it("should include start_time param when provided", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: {} });

      await serviceGraphService.getEdgeHistory("test-org", {
        start_time: 1700000000,
      });

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/test-org/traces/service_graph/edge/history",
        { params: { start_time: 1700000000 } },
      );
    });

    it("should include end_time param when provided", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: {} });

      await serviceGraphService.getEdgeHistory("test-org", {
        end_time: 1700003600,
      });

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/test-org/traces/service_graph/edge/history",
        { params: { end_time: 1700003600 } },
      );
    });

    it("should include stream_name param when provided and not 'all'", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: {} });

      await serviceGraphService.getEdgeHistory("test-org", {
        stream_name: "traces-stream",
      });

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/test-org/traces/service_graph/edge/history",
        { params: { stream_name: "traces-stream" } },
      );
    });

    it("should NOT include stream_name when stream_name is 'all'", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: {} });

      await serviceGraphService.getEdgeHistory("test-org", {
        stream_name: "all",
      });

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/test-org/traces/service_graph/edge/history",
        { params: {} },
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
        },
      );
    });

    it("should propagate errors", async () => {
      mockHttpInstance.get.mockRejectedValue(new Error("Not found"));

      await expect(
        serviceGraphService.getEdgeHistory("test-org", {
          client_service: "svc-a",
          server_service: "svc-b",
        }),
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

      const topology = await serviceGraphService.getCurrentTopology("test-org", {
        startTime: 1700000000,
        endTime: 1700003600,
      });
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

  describe("servicesTrend", () => {
    const URL = "/api/test-org/traces/service_graph/services/trend";
    const BODY: ServicesTrendResponse = {
      window: { start_time: 1, end_time: 2 },
      baseline_window: { start_time: 0, end_time: 1 },
      data_until: 2,
      source: "v4",
      step_micros: 300_000_000,
      partial: false,
      warnings: [],
      services: [
        {
          service: "checkout-api",
          current: { requests: 100, failed: 6, error_rate: 6, p99_latency_ns: null },
          baseline: {
            error_rate: 0.4,
            p99_latency_ns: 1_000,
            requests_per_min: 3,
            covered_hours: 24,
          },
          p99_ratio: null,
          error_rate_delta: 5.6,
          signal: "errors",
          included: false,
          series: [],
        },
      ],
      total_services: 4,
      degraded_total: 1,
    };
    const httpError = (status: number) =>
      Object.assign(new Error(`HTTP ${status}`), { response: { status } });

    it("sends every param with the server's names, include sorted and comma-joined", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: BODY });
      const result = await servicesTrend("test-org", {
        start: 1_700_000_000_000_000,
        end: 1_700_003_600_000_000,
        baselineHours: 24,
        stream: "default",
        limit: 12,
        include: ["payments", "checkout-api"],
      });
      expect(result).toEqual(BODY);
      expect(mockHttpInstance.get).toHaveBeenCalledWith(URL, {
        params: {
          start_time: 1_700_000_000_000_000,
          end_time: 1_700_003_600_000_000,
          baseline_hours: 24,
          stream_name: "default",
          limit: 12,
          include: "checkout-api,payments",
        },
        silentForbidden: true,
      });
    });

    it("omits unset params, an empty include and the 'all' stream", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: BODY });
      await servicesTrend("test-org", { stream: "all", include: [] });
      expect(mockHttpInstance.get).toHaveBeenCalledWith(URL, { params: {}, silentForbidden: true });
    });

    it.each([403, 404])("returns null on %s", async (status) => {
      mockHttpInstance.get.mockRejectedValue(httpError(status));
      await expect(servicesTrend("test-org")).resolves.toBeNull();
    });

    it.each([400, 500])("rethrows %s", async (status) => {
      const error = httpError(status);
      mockHttpInstance.get.mockRejectedValue(error);
      await expect(servicesTrend("test-org")).rejects.toBe(error);
    });

    it("rethrows an error without a response", async () => {
      const error = new Error("network");
      mockHttpInstance.get.mockRejectedValue(error);
      await expect(servicesTrend("test-org")).rejects.toBe(error);
    });

    it("keys include as a sorted set under the topology scope, with topology's stale time", () => {
      const a = servicesTrendQuery("o1", {
        start: 0,
        end: 60_000_000_000_000,
        include: ["b", "a"],
      });
      const b = servicesTrendQuery("o1", {
        start: 0,
        end: 60_000_000_000_000,
        include: ["a", "b"],
      });
      expect(a.queryKey).toEqual(b.queryKey);
      expect(a.queryKey.slice(0, 4)).toEqual(topologyKeys.all("o1"));
      expect(a.staleTime).toBe(
        serviceTopologyQuery("o1", { startTime: 0, endTime: 60_000_000_000_000 }).staleTime,
      );
      const other = servicesTrendQuery("o1", { start: 0, end: 60_000_000_000_000, include: ["a"] });
      expect(other.queryKey).not.toEqual(a.queryKey);
    });

    it("resolves the query to null on a 404 so the Overview falls back", async () => {
      mockHttpInstance.get.mockRejectedValue(httpError(404));
      const options = servicesTrendQuery("o1", { limit: 12 });
      await expect((options.queryFn as () => Promise<unknown>)()).resolves.toBeNull();
    });
  });
});

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
import workflows from "@/services/workflows";
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

describe("workflows service", () => {
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

  describe("listWorkflows", () => {
    it("makes a GET request to the org's workflows collection", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: { list: [] } });

      await workflows.listWorkflows("org123");

      expect(http).toHaveBeenCalledTimes(1);
      expect(mockHttpInstance.get).toHaveBeenCalledWith("/api/org123/workflows");
      expect(mockHttpInstance.get).toHaveBeenCalledTimes(1);
    });

    it("returns the http promise as-is", async () => {
      const response = { data: [{ id: "w1", name: "Alert To Slack" }] };
      mockHttpInstance.get.mockResolvedValue(response);

      await expect(workflows.listWorkflows("default")).resolves.toBe(response);
    });

    it("propagates a request failure", async () => {
      const error = new Error("Network Error");
      mockHttpInstance.get.mockRejectedValue(error);

      await expect(workflows.listWorkflows("default")).rejects.toThrow("Network Error");
    });

    it("interpolates an org identifier containing hyphens and underscores", async () => {
      mockHttpInstance.get.mockResolvedValue({});

      await workflows.listWorkflows("my-org_2");

      expect(mockHttpInstance.get).toHaveBeenCalledWith("/api/my-org_2/workflows");
    });

    it("does not encode the org identifier (raw interpolation)", async () => {
      mockHttpInstance.get.mockResolvedValue({});

      await workflows.listWorkflows("org with space");

      expect(mockHttpInstance.get).toHaveBeenCalledWith("/api/org with space/workflows");
    });

    it("handles an empty org identifier", async () => {
      mockHttpInstance.get.mockResolvedValue({});

      await workflows.listWorkflows("");

      expect(mockHttpInstance.get).toHaveBeenCalledWith("/api//workflows");
    });
  });

  describe("createWorkflow", () => {
    it("POSTs the payload to the org's workflows collection", async () => {
      const data = { name: "wf", nodes: [], edges: [] };
      mockHttpInstance.post.mockResolvedValue({ data: { id: "w1" } });

      await workflows.createWorkflow({ org_identifier: "org123", data });

      expect(mockHttpInstance.post).toHaveBeenCalledWith("/api/org123/workflows", data);
    });

    it("passes the body object through by reference (no transformation)", async () => {
      const data = { name: "wf", nodes: [{ id: "n1" }] };
      mockHttpInstance.post.mockResolvedValue({});

      await workflows.createWorkflow({ org_identifier: "o", data });

      expect(mockHttpInstance.post.mock.calls[0][1]).toBe(data);
    });

    it("supports an empty body", async () => {
      mockHttpInstance.post.mockResolvedValue({});

      await workflows.createWorkflow({ org_identifier: "o", data: {} });

      expect(mockHttpInstance.post).toHaveBeenCalledWith("/api/o/workflows", {});
    });

    it("propagates a 400 validation failure", async () => {
      const error = { response: { status: 400, data: { message: "invalid" } } };
      mockHttpInstance.post.mockRejectedValue(error);

      await expect(workflows.createWorkflow({ org_identifier: "o", data: {} })).rejects.toEqual(
        error,
      );
    });
  });

  describe("updateWorkflow", () => {
    it("PUTs the payload to the workflow's resource URL", async () => {
      const data = { name: "renamed" };
      mockHttpInstance.put.mockResolvedValue({ data: { id: "w1" } });

      await workflows.updateWorkflow({
        org_identifier: "org123",
        id: "w1",
        data,
      });

      expect(mockHttpInstance.put).toHaveBeenCalledWith("/api/org123/workflows/w1", data);
    });

    it("interpolates a uuid workflow id", async () => {
      const id = "3f2c1a7e-0b1d-4c2f-9a11-000000000001";
      mockHttpInstance.put.mockResolvedValue({});

      await workflows.updateWorkflow({ org_identifier: "o", id, data: {} });

      expect(mockHttpInstance.put).toHaveBeenCalledWith(`/api/o/workflows/${id}`, {});
    });

    it("does not encode a workflow id containing a slash (raw interpolation)", async () => {
      mockHttpInstance.put.mockResolvedValue({});

      await workflows.updateWorkflow({
        org_identifier: "o",
        id: "a/b",
        data: {},
      });

      expect(mockHttpInstance.put).toHaveBeenCalledWith("/api/o/workflows/a/b", {});
    });

    it("propagates an update failure", async () => {
      mockHttpInstance.put.mockRejectedValue(new Error("conflict"));

      await expect(
        workflows.updateWorkflow({ org_identifier: "o", id: "w1", data: {} }),
      ).rejects.toThrow("conflict");
    });
  });

  describe("deleteWorkflow", () => {
    it("DELETEs the workflow's resource URL with no body", async () => {
      mockHttpInstance.delete.mockResolvedValue({ data: { code: 200 } });

      await workflows.deleteWorkflow({ org_identifier: "org123", id: "w1" });

      expect(mockHttpInstance.delete).toHaveBeenCalledWith("/api/org123/workflows/w1");
      expect(mockHttpInstance.delete.mock.calls[0]).toHaveLength(1);
    });

    it("propagates a delete failure", async () => {
      mockHttpInstance.delete.mockRejectedValue(new Error("not found"));

      await expect(
        workflows.deleteWorkflow({ org_identifier: "o", id: "missing" }),
      ).rejects.toThrow("not found");
    });
  });

  describe("enableWorkflow", () => {
    it("PUTs to the enable endpoint with value=true and no body", async () => {
      mockHttpInstance.put.mockResolvedValue({ data: {} });

      await workflows.enableWorkflow({
        org_identifier: "org123",
        id: "w1",
        value: true,
      });

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        "/api/org123/workflows/w1/enable?value=true",
      );
      expect(mockHttpInstance.put.mock.calls[0]).toHaveLength(1);
    });

    it("serialises value=false for pausing", async () => {
      mockHttpInstance.put.mockResolvedValue({ data: {} });

      await workflows.enableWorkflow({
        org_identifier: "org123",
        id: "w1",
        value: false,
      });

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        "/api/org123/workflows/w1/enable?value=false",
      );
    });

    it("propagates an enable failure", async () => {
      mockHttpInstance.put.mockRejectedValue(new Error("forbidden"));

      await expect(
        workflows.enableWorkflow({ org_identifier: "o", id: "w1", value: true }),
      ).rejects.toThrow("forbidden");
    });
  });

  describe("testWorkflow", () => {
    it("POSTs inputs to the test endpoint", async () => {
      const inputs = [{ meta: { alert_name: "High Error Rate" }, data: [] }];
      mockHttpInstance.post.mockResolvedValue({ data: { errors: [] } });

      await workflows.testWorkflow({
        org_identifier: "org123",
        id: "w1",
        inputs,
      });

      expect(mockHttpInstance.post).toHaveBeenCalledWith("/api/org123/workflows/w1/test", {
        inputs,
        from_node: undefined,
      });
    });

    it("includes from_node when replaying from a specific node", async () => {
      const inputs = [{ a: 1 }];
      mockHttpInstance.post.mockResolvedValue({ data: {} });

      await workflows.testWorkflow({
        org_identifier: "o",
        id: "w1",
        inputs,
        from_node: "node-3",
      });

      expect(mockHttpInstance.post).toHaveBeenCalledWith("/api/o/workflows/w1/test", {
        inputs,
        from_node: "node-3",
      });
    });

    it("sends an empty inputs array through untouched", async () => {
      mockHttpInstance.post.mockResolvedValue({ data: {} });

      await workflows.testWorkflow({ org_identifier: "o", id: "w1", inputs: [] });

      expect(mockHttpInstance.post).toHaveBeenCalledWith("/api/o/workflows/w1/test", {
        inputs: [],
        from_node: undefined,
      });
    });

    it("always sends the from_node key (undefined when omitted)", async () => {
      mockHttpInstance.post.mockResolvedValue({ data: {} });

      await workflows.testWorkflow({ org_identifier: "o", id: "w1", inputs: [] });

      const body = mockHttpInstance.post.mock.calls[0][1];
      expect(Object.keys(body).sort()).toEqual(["from_node", "inputs"]);
    });

    it("propagates a test failure", async () => {
      mockHttpInstance.post.mockRejectedValue(new Error("test failed"));

      await expect(
        workflows.testWorkflow({ org_identifier: "o", id: "w1", inputs: [] }),
      ).rejects.toThrow("test failed");
    });
  });

  describe("getWorkflowHistory", () => {
    it("GETs the history endpoint with no query string when both bounds are omitted", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: [] });

      await workflows.getWorkflowHistory({ org_identifier: "org123", id: "w1" });

      expect(mockHttpInstance.get).toHaveBeenCalledWith("/api/org123/workflows/w1/history");
    });

    it("appends both bounds as microsecond query params", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: [] });

      await workflows.getWorkflowHistory({
        org_identifier: "org123",
        id: "w1",
        start_time: 1700000000000000,
        end_time: 1700000600000000,
      });

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/org123/workflows/w1/history?start_time=1700000000000000&end_time=1700000600000000",
      );
    });

    it("appends only start_time when end_time is omitted", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: [] });

      await workflows.getWorkflowHistory({
        org_identifier: "o",
        id: "w1",
        start_time: 123,
      });

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/o/workflows/w1/history?start_time=123",
      );
    });

    it("appends only end_time when start_time is omitted", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: [] });

      await workflows.getWorkflowHistory({
        org_identifier: "o",
        id: "w1",
        end_time: 456,
      });

      expect(mockHttpInstance.get).toHaveBeenCalledWith("/api/o/workflows/w1/history?end_time=456");
    });

    it("treats an explicit undefined bound as omitted", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: [] });

      await workflows.getWorkflowHistory({
        org_identifier: "o",
        id: "w1",
        start_time: undefined,
        end_time: undefined,
      });

      expect(mockHttpInstance.get).toHaveBeenCalledWith("/api/o/workflows/w1/history");
    });

    it("treats a null bound as omitted (loose != null check)", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: [] });

      await workflows.getWorkflowHistory({
        org_identifier: "o",
        id: "w1",
        start_time: null as any,
        end_time: null as any,
      });

      expect(mockHttpInstance.get).toHaveBeenCalledWith("/api/o/workflows/w1/history");
    });

    it("keeps a 0 bound (0 is a valid timestamp, not 'omitted')", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: [] });

      await workflows.getWorkflowHistory({
        org_identifier: "o",
        id: "w1",
        start_time: 0,
        end_time: 0,
      });

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/o/workflows/w1/history?start_time=0&end_time=0",
      );
    });

    it("preserves start_time before end_time in the query string", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: [] });

      await workflows.getWorkflowHistory({
        org_identifier: "o",
        id: "w1",
        end_time: 2,
        start_time: 1,
      });

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/o/workflows/w1/history?start_time=1&end_time=2",
      );
    });

    it("percent-encodes a negative bound's sign safely and stringifies numbers", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: [] });

      await workflows.getWorkflowHistory({
        org_identifier: "o",
        id: "w1",
        start_time: -1,
      });

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/o/workflows/w1/history?start_time=-1",
      );
    });

    it("propagates a history failure", async () => {
      mockHttpInstance.get.mockRejectedValue(new Error("boom"));

      await expect(workflows.getWorkflowHistory({ org_identifier: "o", id: "w1" })).rejects.toThrow(
        "boom",
      );
    });
  });

  describe("getWorkflowRun", () => {
    it("GETs the run's errors endpoint", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: { errors: [] } });

      await workflows.getWorkflowRun({
        org_identifier: "org123",
        id: "w1",
        run_id: "r1",
      });

      expect(mockHttpInstance.get).toHaveBeenCalledWith("/api/org123/workflows/w1/errors/r1");
    });

    it("interpolates a uuid run id", async () => {
      const run_id = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
      mockHttpInstance.get.mockResolvedValue({ data: {} });

      await workflows.getWorkflowRun({ org_identifier: "o", id: "w1", run_id });

      expect(mockHttpInstance.get).toHaveBeenCalledWith(`/api/o/workflows/w1/errors/${run_id}`);
    });

    it("propagates a run-detail failure", async () => {
      mockHttpInstance.get.mockRejectedValue(new Error("404"));

      await expect(
        workflows.getWorkflowRun({ org_identifier: "o", id: "w1", run_id: "r" }),
      ).rejects.toThrow("404");
    });
  });

  describe("retryWorkflow", () => {
    it("POSTs the run_id to the retry endpoint", async () => {
      mockHttpInstance.post.mockResolvedValue({ data: {} });

      await workflows.retryWorkflow({
        org_identifier: "org123",
        id: "w1",
        run_id: "r1",
      });

      expect(mockHttpInstance.post).toHaveBeenCalledWith("/api/org123/workflows/w1/retry", {
        run_id: "r1",
        from_node: undefined,
      });
    });

    it("includes from_node when retrying from a specific node", async () => {
      mockHttpInstance.post.mockResolvedValue({ data: {} });

      await workflows.retryWorkflow({
        org_identifier: "o",
        id: "w1",
        run_id: "r1",
        from_node: "node-2",
      });

      expect(mockHttpInstance.post).toHaveBeenCalledWith("/api/o/workflows/w1/retry", {
        run_id: "r1",
        from_node: "node-2",
      });
    });

    it("always sends the from_node key (undefined when omitted)", async () => {
      mockHttpInstance.post.mockResolvedValue({ data: {} });

      await workflows.retryWorkflow({
        org_identifier: "o",
        id: "w1",
        run_id: "r1",
      });

      const body = mockHttpInstance.post.mock.calls[0][1];
      expect(Object.keys(body).sort()).toEqual(["from_node", "run_id"]);
    });

    it("propagates a retry failure", async () => {
      mockHttpInstance.post.mockRejectedValue(new Error("retry failed"));

      await expect(
        workflows.retryWorkflow({ org_identifier: "o", id: "w1", run_id: "r1" }),
      ).rejects.toThrow("retry failed");
    });
  });

  describe("service surface", () => {
    it("exposes exactly the 9 workflow endpoints", () => {
      expect(Object.keys(workflows).sort()).toEqual([
        "createWorkflow",
        "deleteWorkflow",
        "enableWorkflow",
        "getWorkflowHistory",
        "getWorkflowRun",
        "listWorkflows",
        "retryWorkflow",
        "testWorkflow",
        "updateWorkflow",
      ]);
    });

    it("creates a new http client per call", async () => {
      mockHttpInstance.get.mockResolvedValue({});
      mockHttpInstance.post.mockResolvedValue({});

      await workflows.listWorkflows("o");
      await workflows.createWorkflow({ org_identifier: "o", data: {} });

      expect(http).toHaveBeenCalledTimes(2);
    });
  });
});

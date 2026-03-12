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

import { describe, expect, it, beforeEach, vi } from "vitest";
import pipelines from "@/services/pipelines";
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

describe("pipelines service", () => {
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

  describe("getPipelines", () => {
    it("should make GET request to list all pipelines for an org", async () => {
      const org_identifier = "org123";

      mockHttpInstance.get.mockResolvedValue({ data: { list: [] } });

      await pipelines.getPipelines(org_identifier);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${org_identifier}/pipelines`
      );
    });

    it("should use the org_identifier in the URL path", async () => {
      const org_identifier = "production-org";

      mockHttpInstance.get.mockResolvedValue({ data: { list: [{ id: "p1", name: "my-pipeline" }] } });

      await pipelines.getPipelines(org_identifier);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/production-org/pipelines`
      );
    });
  });

  describe("getPipeline", () => {
    it("should make GET request to fetch a specific pipeline by name", async () => {
      const params = {
        name: "my-pipeline",
        org_identifier: "org123",
      };

      mockHttpInstance.get.mockResolvedValue({ data: { id: "p1", name: "my-pipeline" } });

      await pipelines.getPipeline(params);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/pipelines/${params.name}`
      );
    });

    it("should use both name and org_identifier in the URL path", async () => {
      const params = {
        name: "logs-enrichment",
        org_identifier: "staging-org",
      };

      mockHttpInstance.get.mockResolvedValue({ data: {} });

      await pipelines.getPipeline(params);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/staging-org/pipelines/logs-enrichment`
      );
    });
  });

  describe("toggleState", () => {
    it("should make PUT request to enable a pipeline", async () => {
      const org_identifier = "org123";
      const pipeline_id = "pipeline-001";
      const enable = true;
      const from_now = false;

      mockHttpInstance.put.mockResolvedValue({ data: { success: true } });

      await pipelines.toggleState(org_identifier, pipeline_id, enable, from_now);

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        `/api/${org_identifier}/pipelines/${pipeline_id}/enable?value=${enable}&from_now=${from_now}`
      );
    });

    it("should make PUT request to disable a pipeline", async () => {
      const org_identifier = "org123";
      const pipeline_id = "pipeline-002";
      const enable = false;
      const from_now = true;

      mockHttpInstance.put.mockResolvedValue({ data: { success: true } });

      await pipelines.toggleState(org_identifier, pipeline_id, enable, from_now);

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        `/api/org123/pipelines/pipeline-002/enable?value=false&from_now=true`
      );
    });

    it("should include both enable and from_now as query parameters", async () => {
      const org_identifier = "prod-org";
      const pipeline_id = "pipe-xyz";
      const enable = true;
      const from_now = true;

      mockHttpInstance.put.mockResolvedValue({ data: {} });

      await pipelines.toggleState(org_identifier, pipeline_id, enable, from_now);

      const calledUrl = mockHttpInstance.put.mock.calls[0][0];
      expect(calledUrl).toContain(`value=${enable}`);
      expect(calledUrl).toContain(`from_now=${from_now}`);
    });
  });

  describe("bulkToggleState", () => {
    it("should make POST request to bulk enable pipelines", async () => {
      const org_identifier = "org123";
      const enable = true;
      const data = { pipeline_ids: ["p1", "p2", "p3"] };

      mockHttpInstance.post.mockResolvedValue({ data: { success: true } });

      await pipelines.bulkToggleState(org_identifier, enable, data);

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/${org_identifier}/pipelines/bulk/enable?value=${enable}`,
        data
      );
    });

    it("should make POST request to bulk disable pipelines", async () => {
      const org_identifier = "staging-org";
      const enable = false;
      const data = { pipeline_ids: ["p4", "p5"] };

      mockHttpInstance.post.mockResolvedValue({ data: { success: true } });

      await pipelines.bulkToggleState(org_identifier, enable, data);

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/staging-org/pipelines/bulk/enable?value=false`,
        data
      );
    });

    it("should pass the data object as the POST body", async () => {
      const org_identifier = "org123";
      const enable = true;
      const data = { pipeline_ids: ["pipeline-abc"] };

      mockHttpInstance.post.mockResolvedValue({ data: {} });

      await pipelines.bulkToggleState(org_identifier, enable, data);

      const callArgs = mockHttpInstance.post.mock.calls[0];
      expect(callArgs[1]).toEqual(data);
    });
  });

  describe("deletePipeline", () => {
    it("should make DELETE request to remove a pipeline by id", async () => {
      const params = {
        pipeline_id: "pipeline-001",
        org_id: "org123",
      };

      mockHttpInstance.delete.mockResolvedValue({ data: { success: true } });

      await pipelines.deletePipeline(params);

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        `/api/${params.org_id}/pipelines/${params.pipeline_id}`
      );
    });

    it("should use org_id (not org_identifier) in the URL path", async () => {
      const params = {
        pipeline_id: "pipe-xyz-999",
        org_id: "production-org",
      };

      mockHttpInstance.delete.mockResolvedValue({ data: { success: true } });

      await pipelines.deletePipeline(params);

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        `/api/production-org/pipelines/pipe-xyz-999`
      );
    });
  });

  describe("bulkDelete", () => {
    it("should make DELETE request to bulk delete pipelines", async () => {
      const org_identifier = "org123";
      const data = { pipeline_ids: ["p1", "p2", "p3"] };

      mockHttpInstance.delete.mockResolvedValue({ data: { success: true } });

      await pipelines.bulkDelete(org_identifier, data);

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        `/api/${org_identifier}/pipelines/bulk`,
        { data }
      );
    });

    it("should wrap the data in a data property for the DELETE config", async () => {
      const org_identifier = "staging-org";
      const data = { pipeline_ids: ["pipe-abc"] };

      mockHttpInstance.delete.mockResolvedValue({ data: {} });

      await pipelines.bulkDelete(org_identifier, data);

      const callArgs = mockHttpInstance.delete.mock.calls[0];
      expect(callArgs[1]).toEqual({ data });
    });
  });

  describe("createPipeline", () => {
    it("should make POST request to create a new pipeline", async () => {
      const params = {
        org_identifier: "org123",
        data: {
          name: "new-pipeline",
          source: { stream_type: "logs", stream_name: "default" },
          nodes: [],
          edges: [],
        },
      };

      mockHttpInstance.post.mockResolvedValue({ data: { id: "pipeline-new-1" } });

      await pipelines.createPipeline(params);

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/pipelines`,
        params.data
      );
    });

    it("should pass the data object as the POST body", async () => {
      const params = {
        org_identifier: "prod-org",
        data: { name: "my-pipeline", nodes: [{ id: "n1" }] },
      };

      mockHttpInstance.post.mockResolvedValue({ data: {} });

      await pipelines.createPipeline(params);

      const callArgs = mockHttpInstance.post.mock.calls[0];
      expect(callArgs[1]).toEqual(params.data);
    });
  });

  describe("updatePipeline", () => {
    it("should make PUT request to update an existing pipeline", async () => {
      const params = {
        org_identifier: "org123",
        data: {
          name: "updated-pipeline",
          nodes: [{ id: "node-1", type: "input" }],
          edges: [],
        },
      };

      mockHttpInstance.put.mockResolvedValue({ data: { success: true } });

      await pipelines.updatePipeline(params);

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/pipelines`,
        params.data
      );
    });

    it("should use the org_identifier in the URL path", async () => {
      const params = {
        org_identifier: "staging-org",
        data: { name: "pipeline-v2", nodes: [] },
      };

      mockHttpInstance.put.mockResolvedValue({ data: {} });

      await pipelines.updatePipeline(params);

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        `/api/staging-org/pipelines`,
        params.data
      );
    });

    it("should pass the data object as the PUT body", async () => {
      const params = {
        org_identifier: "org123",
        data: { name: "my-pipeline", nodes: [], edges: [], description: "updated" },
      };

      mockHttpInstance.put.mockResolvedValue({ data: {} });

      await pipelines.updatePipeline(params);

      const callArgs = mockHttpInstance.put.mock.calls[0];
      expect(callArgs[1]).toEqual(params.data);
    });
  });

  describe("getPipelineStreams", () => {
    it("should make GET request to list pipeline streams for an org", async () => {
      const org_identifier = "org123";

      mockHttpInstance.get.mockResolvedValue({ data: { streams: [] } });

      await pipelines.getPipelineStreams(org_identifier);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${org_identifier}/pipelines/streams`
      );
    });

    it("should use the org_identifier in the URL path", async () => {
      const org_identifier = "production-org";

      mockHttpInstance.get.mockResolvedValue({ data: { streams: [{ name: "logs" }] } });

      await pipelines.getPipelineStreams(org_identifier);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/production-org/pipelines/streams`
      );
    });
  });

  describe("error handling", () => {
    it("should propagate errors from getPipelines", async () => {
      const error = new Error("Network error");
      mockHttpInstance.get.mockRejectedValue(error);

      await expect(pipelines.getPipelines("org123")).rejects.toThrow("Network error");
    });

    it("should propagate errors from getPipeline", async () => {
      const error = new Error("Not found");
      mockHttpInstance.get.mockRejectedValue(error);

      await expect(
        pipelines.getPipeline({ name: "missing-pipeline", org_identifier: "org123" })
      ).rejects.toThrow("Not found");
    });

    it("should propagate errors from createPipeline", async () => {
      const error = new Error("Validation error");
      mockHttpInstance.post.mockRejectedValue(error);

      await expect(
        pipelines.createPipeline({ org_identifier: "org123", data: { name: "bad-pipeline" } })
      ).rejects.toThrow("Validation error");
    });

    it("should propagate errors from updatePipeline", async () => {
      const error = new Error("Conflict");
      mockHttpInstance.put.mockRejectedValue(error);

      await expect(
        pipelines.updatePipeline({ org_identifier: "org123", data: { name: "conflict-pipeline" } })
      ).rejects.toThrow("Conflict");
    });

    it("should propagate errors from deletePipeline", async () => {
      const error = new Error("Forbidden");
      mockHttpInstance.delete.mockRejectedValue(error);

      await expect(
        pipelines.deletePipeline({ pipeline_id: "p1", org_id: "org123" })
      ).rejects.toThrow("Forbidden");
    });

    it("should propagate errors from toggleState", async () => {
      const error = new Error("Unauthorized");
      mockHttpInstance.put.mockRejectedValue(error);

      await expect(
        pipelines.toggleState("org123", "pipeline-001", true, false)
      ).rejects.toThrow("Unauthorized");
    });

    it("should propagate errors from getPipelineStreams", async () => {
      const error = new Error("Server error");
      mockHttpInstance.get.mockRejectedValue(error);

      await expect(pipelines.getPipelineStreams("org123")).rejects.toThrow("Server error");
    });
  });
});

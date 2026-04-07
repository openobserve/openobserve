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
import savedViews from "@/services/saved_views";
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

describe("saved_views service", () => {
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

  describe("get", () => {
    it("should make GET request to list all saved views for an org", async () => {
      const org_identifier = "org123";

      mockHttpInstance.get.mockResolvedValue({ data: { views: [] } });

      await savedViews.get(org_identifier);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${org_identifier}/savedviews`
      );
    });

    it("should make GET request with a different org identifier", async () => {
      const org_identifier = "prod-org";

      mockHttpInstance.get.mockResolvedValue({
        data: {
          views: [
            { id: "view-1", name: "My Log View" },
            { id: "view-2", name: "Error Dashboard" },
          ],
        },
      });

      await savedViews.get(org_identifier);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${org_identifier}/savedviews`
      );
    });
  });

  describe("post", () => {
    it("should make POST request to create a saved view with spread data", async () => {
      const org_identifier = "org123";
      const data = {
        name: "My Log View",
        query: "level=error",
        stream: "default",
      };

      mockHttpInstance.post.mockResolvedValue({ data: { id: "view-new-1" } });

      await savedViews.post(org_identifier, data);

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/${org_identifier}/savedviews`,
        { ...data }
      );
    });

    it("should make POST request with minimal data payload", async () => {
      const org_identifier = "my-org";
      const data = { name: "Minimal View" };

      mockHttpInstance.post.mockResolvedValue({ data: { id: "view-minimal" } });

      await savedViews.post(org_identifier, data);

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/${org_identifier}/savedviews`,
        { name: "Minimal View" }
      );
    });

    it("should spread the data object into the request body", async () => {
      const org_identifier = "org123";
      const data = {
        name: "Traces View",
        type: "traces",
        filters: { service: "api-gateway" },
        time_range: { start: 1000000, end: 2000000 },
      };

      mockHttpInstance.post.mockResolvedValue({ data: { id: "traces-view-1" } });

      await savedViews.post(org_identifier, data);

      const callArgs = mockHttpInstance.post.mock.calls[0];
      expect(callArgs[1]).toEqual({ ...data });
    });
  });

  describe("put", () => {
    it("should make PUT request to update a saved view by id with spread data", async () => {
      const org_identifier = "org123";
      const id = "view-1";
      const data = {
        name: "Updated Log View",
        query: "level=warn",
        stream: "default",
      };

      mockHttpInstance.put.mockResolvedValue({ data: { success: true } });

      await savedViews.put(org_identifier, id, data);

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        `/api/${org_identifier}/savedviews/${id}`,
        { ...data }
      );
    });

    it("should make PUT request with different org, id, and data", async () => {
      const org_identifier = "prod-org";
      const id = "view-xyz-999";
      const data = { name: "Renamed View", pinned: true };

      mockHttpInstance.put.mockResolvedValue({ data: { success: true } });

      await savedViews.put(org_identifier, id, data);

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        `/api/${org_identifier}/savedviews/${id}`,
        { name: "Renamed View", pinned: true }
      );
    });

    it("should spread the data into request body for PUT", async () => {
      const org_identifier = "org123";
      const id = "view-2";
      const data = {
        name: "Metrics Overview",
        type: "metrics",
        dashboard_id: "dash-abc",
      };

      mockHttpInstance.put.mockResolvedValue({ data: { success: true } });

      await savedViews.put(org_identifier, id, data);

      const callArgs = mockHttpInstance.put.mock.calls[0];
      expect(callArgs[1]).toEqual({ ...data });
    });
  });

  describe("delete", () => {
    it("should make DELETE request to remove a saved view by id", async () => {
      const org_identifier = "org123";
      const id = "view-1";

      mockHttpInstance.delete.mockResolvedValue({ data: { success: true } });

      await savedViews.delete(org_identifier, id);

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        `/api/${org_identifier}/savedviews/${id}`
      );
    });

    it("should make DELETE request with different org and view id", async () => {
      const org_identifier = "staging-org";
      const id = "view-to-remove-abc";

      mockHttpInstance.delete.mockResolvedValue({ data: { success: true } });

      await savedViews.delete(org_identifier, id);

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        `/api/${org_identifier}/savedviews/${id}`
      );
    });
  });

  describe("getViewDetail", () => {
    it("should make GET request to fetch a specific saved view by id", async () => {
      const org_identifier = "org123";
      const id = "view-1";

      mockHttpInstance.get.mockResolvedValue({
        data: { id: "view-1", name: "My Log View", query: "level=error" },
      });

      await savedViews.getViewDetail(org_identifier, id);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${org_identifier}/savedviews/${id}`
      );
    });

    it("should make GET request with different org and view id", async () => {
      const org_identifier = "prod-org";
      const id = "view-detail-xyz";

      mockHttpInstance.get.mockResolvedValue({
        data: { id: "view-detail-xyz", name: "Production Overview" },
      });

      await savedViews.getViewDetail(org_identifier, id);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${org_identifier}/savedviews/${id}`
      );
    });

    it("should use the same URL pattern as put and delete for a given id", async () => {
      const org_identifier = "org123";
      const id = "shared-view-id";

      mockHttpInstance.get.mockResolvedValue({ data: { id: "shared-view-id" } });
      mockHttpInstance.put.mockResolvedValue({ data: { success: true } });
      mockHttpInstance.delete.mockResolvedValue({ data: { success: true } });

      await savedViews.getViewDetail(org_identifier, id);
      await savedViews.put(org_identifier, id, { name: "Updated" });
      await savedViews.delete(org_identifier, id);

      const expectedPath = `/api/${org_identifier}/savedviews/${id}`;
      expect(mockHttpInstance.get).toHaveBeenCalledWith(expectedPath);
      expect(mockHttpInstance.put).toHaveBeenCalledWith(expectedPath, { name: "Updated" });
      expect(mockHttpInstance.delete).toHaveBeenCalledWith(expectedPath);
    });
  });

  describe("error handling", () => {
    it("should propagate errors from get", async () => {
      const error = new Error("Unauthorized");
      mockHttpInstance.get.mockRejectedValue(error);

      await expect(savedViews.get("org123")).rejects.toThrow("Unauthorized");
    });

    it("should propagate errors from post", async () => {
      const error = new Error("Validation error");
      mockHttpInstance.post.mockRejectedValue(error);

      await expect(
        savedViews.post("org123", { name: "broken-view" })
      ).rejects.toThrow("Validation error");
    });

    it("should propagate errors from put", async () => {
      const error = new Error("Not found");
      mockHttpInstance.put.mockRejectedValue(error);

      await expect(
        savedViews.put("org123", "missing-id", { name: "updated" })
      ).rejects.toThrow("Not found");
    });

    it("should propagate errors from delete", async () => {
      const error = new Error("Forbidden");
      mockHttpInstance.delete.mockRejectedValue(error);

      await expect(
        savedViews.delete("org123", "locked-view-id")
      ).rejects.toThrow("Forbidden");
    });

    it("should propagate errors from getViewDetail", async () => {
      const error = new Error("Server error");
      mockHttpInstance.get.mockRejectedValue(error);

      await expect(
        savedViews.getViewDetail("org123", "some-view-id")
      ).rejects.toThrow("Server error");
    });
  });
});

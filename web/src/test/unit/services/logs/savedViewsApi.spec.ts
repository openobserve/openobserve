// Copyright 2023 OpenObserve Inc.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { savedViewsApi } from "@/services/logs/savedViewsApi";

// Mock dependencies
vi.mock("@/utils/zincutils", () => ({
  generateTraceContext: vi.fn(() => ({ traceparent: "test-trace-parent" }))
}));

vi.mock("@/services/http", () => {
  const httpMock = {
    get: vi.fn(() => Promise.resolve({ data: { views: [] } })),
    post: vi.fn(() => Promise.resolve({ data: { view_id: "view-123" } })),
    put: vi.fn(() => Promise.resolve({ data: { success: true } })),
    delete: vi.fn(() => Promise.resolve({ data: { success: true } }))
  };
  return {
    default: vi.fn(() => httpMock)
  };
});

describe("Saved Views API Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("get", () => {
    it("should get all saved views for an organization", async () => {
      const mockHttp = await import("@/services/http");

      await savedViewsApi.get("test-org");

      expect(mockHttp.default).toHaveBeenCalledWith({
        headers: { traceparent: "test-trace-parent" }
      });
      expect(mockHttp.default().get).toHaveBeenCalledWith("/api/test-org/saved_views");
    });
  });

  describe("create", () => {
    it("should create a new saved view", async () => {
      const mockHttp = await import("@/services/http");
      const params = {
        org_identifier: "test-org",
        name: "Test View",
        view_data: { query: "SELECT * FROM logs" }
      };

      await savedViewsApi.create(params);

      expect(mockHttp.default().post).toHaveBeenCalledWith(
        "/api/test-org/saved_views",
        {
          name: "Test View",
          view_data: { query: "SELECT * FROM logs" }
        }
      );
    });
  });

  describe("update", () => {
    it("should update an existing saved view", async () => {
      const mockHttp = await import("@/services/http");
      const params = {
        org_identifier: "test-org",
        view_id: "view-123",
        name: "Updated View",
        view_data: { query: "SELECT * FROM logs WHERE level='error'" }
      };

      await savedViewsApi.update(params);

      expect(mockHttp.default().put).toHaveBeenCalledWith(
        "/api/test-org/saved_views/view-123",
        {
          name: "Updated View",
          view_data: { query: "SELECT * FROM logs WHERE level='error'" }
        }
      );
    });

    it("should throw error when view_id is missing", async () => {
      const params = {
        org_identifier: "test-org",
        name: "Test View",
        view_data: { query: "SELECT * FROM logs" }
      };

      await expect(savedViewsApi.update(params)).rejects.toThrow(
        "view_id is required for updating a saved view"
      );
    });
  });

  describe("delete", () => {
    it("should delete a saved view", async () => {
      const mockHttp = await import("@/services/http");
      const params = {
        org_identifier: "test-org",
        view_id: "view-123"
      };

      await savedViewsApi.delete(params);

      expect(mockHttp.default().delete).toHaveBeenCalledWith(
        "/api/test-org/saved_views/view-123"
      );
    });

    it("should throw error when view_id is missing", async () => {
      const params = {
        org_identifier: "test-org"
      };

      await expect(savedViewsApi.delete(params)).rejects.toThrow(
        "view_id is required for deleting a saved view"
      );
    });
  });

  describe("getById", () => {
    it("should get a specific saved view by ID", async () => {
      const mockHttp = await import("@/services/http");
      const params = {
        org_identifier: "test-org",
        view_id: "view-123"
      };

      await savedViewsApi.getById(params);

      expect(mockHttp.default().get).toHaveBeenCalledWith(
        "/api/test-org/saved_views/view-123"
      );
    });

    it("should throw error when view_id is missing", async () => {
      const params = {
        org_identifier: "test-org"
      };

      await expect(savedViewsApi.getById(params)).rejects.toThrow(
        "view_id is required for getting a saved view"
      );
    });
  });
});
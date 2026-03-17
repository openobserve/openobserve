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
import { annotationService } from "@/services/dashboard_annotations";
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

// crypto.randomUUID is used inside create_timed_annotations — spy on it
// without replacing the whole crypto object so Vite internals still work.
const mockUUID = "550e8400-e29b-41d4-a716-446655440000";
vi.spyOn(crypto, "randomUUID").mockReturnValue(mockUUID as `${string}-${string}-${string}-${string}-${string}`);

describe("dashboard_annotations service", () => {
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

  describe("create_timed_annotations", () => {
    it("should make POST request with timed_annotations payload and Content-Type header", async () => {
      const org_id = "org123";
      const dashboard_id = "dash-abc";
      const annotations = [
        {
          start_time: 1700000000000,
          end_time: 1700003600000,
          title: "Deployment",
          text: "v1.2.3 deployed",
          tags: ["deploy"],
          panels: ["panel-1"],
        },
      ];

      mockHttpInstance.post.mockResolvedValue({ data: { success: true } });

      await annotationService.create_timed_annotations(org_id, dashboard_id, annotations);

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/${org_id}/dashboards/${dashboard_id}/annotations`,
        {
          timed_annotations: [
            {
              annotation_id: mockUUID,
              start_time: 1700000000000,
              end_time: 1700003600000,
              title: "Deployment",
              text: "v1.2.3 deployed",
              tags: ["deploy"],
              panels: ["panel-1"],
            },
          ],
        },
        {
          headers: {
            "Content-Type": "application/json; charset=UTF-8",
          },
        }
      );
    });

    it("should assign a randomUUID as annotation_id for each annotation", async () => {
      const org_id = "org123";
      const dashboard_id = "dash-xyz";
      const annotations = [
        { start_time: 1000, end_time: 2000, title: "Ann 1" },
        { start_time: 3000, end_time: 4000, title: "Ann 2" },
      ];

      mockHttpInstance.post.mockResolvedValue({ data: { success: true } });

      await annotationService.create_timed_annotations(org_id, dashboard_id, annotations);

      const callArgs = mockHttpInstance.post.mock.calls[0];
      const payload = callArgs[1];

      expect(payload.timed_annotations).toHaveLength(2);
      expect(payload.timed_annotations[0]).toHaveProperty("annotation_id", mockUUID);
      expect(payload.timed_annotations[1]).toHaveProperty("annotation_id", mockUUID);
    });

    it("should handle an empty annotations array", async () => {
      const org_id = "org123";
      const dashboard_id = "dash-abc";
      const annotations: any[] = [];

      mockHttpInstance.post.mockResolvedValue({ data: { success: true } });

      await annotationService.create_timed_annotations(org_id, dashboard_id, annotations);

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/${org_id}/dashboards/${dashboard_id}/annotations`,
        { timed_annotations: [] },
        {
          headers: {
            "Content-Type": "application/json; charset=UTF-8",
          },
        }
      );
    });

    it("should spread existing annotation fields onto the payload alongside annotation_id", async () => {
      const org_id = "my-org";
      const dashboard_id = "dash-999";
      const annotations = [
        {
          start_time: 9000000,
          title: "Incident",
          severity: "critical",
        },
      ];

      mockHttpInstance.post.mockResolvedValue({ data: { success: true } });

      await annotationService.create_timed_annotations(org_id, dashboard_id, annotations);

      const callArgs = mockHttpInstance.post.mock.calls[0];
      const timedAnn = callArgs[1].timed_annotations[0];

      expect(timedAnn.annotation_id).toBe(mockUUID);
      expect(timedAnn.start_time).toBe(9000000);
      expect(timedAnn.title).toBe("Incident");
      expect(timedAnn.severity).toBe("critical");
    });
  });

  describe("update_timed_annotations", () => {
    it("should make PUT request to update a specific timed annotation", async () => {
      const org_id = "org123";
      const dashboard_id = "dash-abc";
      const timed_annotation_id = "ann-id-001";
      const annotations = [
        {
          annotation_id: "ann-id-001",
          start_time: 1700000000000,
          end_time: 1700003600000,
          title: "Updated Deployment",
        },
      ];

      mockHttpInstance.put.mockResolvedValue({ data: { success: true } });

      await annotationService.update_timed_annotations(
        org_id,
        dashboard_id,
        timed_annotation_id,
        annotations
      );

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        `/api/${org_id}/dashboards/${dashboard_id}/annotations/${timed_annotation_id}`,
        annotations,
        {
          headers: {
            "Content-Type": "application/json; charset=UTF-8",
          },
        }
      );
    });

    it("should make PUT request with different org, dashboard, and annotation IDs", async () => {
      const org_id = "prod-org";
      const dashboard_id = "main-dashboard";
      const timed_annotation_id = "timed-ann-xyz";
      const annotations = [{ title: "Patched annotation", severity: "warning" }];

      mockHttpInstance.put.mockResolvedValue({ data: { success: true } });

      await annotationService.update_timed_annotations(
        org_id,
        dashboard_id,
        timed_annotation_id,
        annotations
      );

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        `/api/${org_id}/dashboards/${dashboard_id}/annotations/${timed_annotation_id}`,
        annotations,
        {
          headers: {
            "Content-Type": "application/json; charset=UTF-8",
          },
        }
      );
    });

    it("should make PUT request with an empty annotations array", async () => {
      const org_id = "org123";
      const dashboard_id = "dash-abc";
      const timed_annotation_id = "ann-id-002";
      const annotations: any[] = [];

      mockHttpInstance.put.mockResolvedValue({ data: { success: true } });

      await annotationService.update_timed_annotations(
        org_id,
        dashboard_id,
        timed_annotation_id,
        annotations
      );

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        `/api/${org_id}/dashboards/${dashboard_id}/annotations/${timed_annotation_id}`,
        [],
        {
          headers: {
            "Content-Type": "application/json; charset=UTF-8",
          },
        }
      );
    });
  });

  describe("delete_timed_annotations", () => {
    it("should make DELETE request with annotation_ids payload", async () => {
      const organization = "org123";
      const dashboardId = "dash-abc";
      const annotationIds = ["ann-id-001", "ann-id-002"];

      mockHttpInstance.delete.mockResolvedValue({ data: { success: true } });

      await annotationService.delete_timed_annotations(
        organization,
        dashboardId,
        annotationIds
      );

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        `/api/${organization}/dashboards/${dashboardId}/annotations`,
        {
          data: {
            annotation_ids: annotationIds,
          },
        }
      );
    });

    it("should make DELETE request with a single annotation id", async () => {
      const organization = "my-org";
      const dashboardId = "ops-dashboard";
      const annotationIds = ["single-ann-id"];

      mockHttpInstance.delete.mockResolvedValue({ data: { success: true } });

      await annotationService.delete_timed_annotations(
        organization,
        dashboardId,
        annotationIds
      );

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        `/api/${organization}/dashboards/${dashboardId}/annotations`,
        {
          data: {
            annotation_ids: ["single-ann-id"],
          },
        }
      );
    });

    it("should make DELETE request with an empty annotation ids array", async () => {
      const organization = "org123";
      const dashboardId = "dash-abc";
      const annotationIds: string[] = [];

      mockHttpInstance.delete.mockResolvedValue({ data: { success: true } });

      await annotationService.delete_timed_annotations(
        organization,
        dashboardId,
        annotationIds
      );

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        `/api/${organization}/dashboards/${dashboardId}/annotations`,
        {
          data: {
            annotation_ids: [],
          },
        }
      );
    });
  });

  describe("get_timed_annotations", () => {
    it("should make GET request with panels, start_time, and end_time params", async () => {
      const org_id = "org123";
      const dashboard_id = "dash-abc";
      const params = {
        panels: ["panel-1", "panel-2"],
        start_time: 1700000000000,
        end_time: 1700003600000,
      };

      mockHttpInstance.get.mockResolvedValue({ data: { annotations: [] } });

      await annotationService.get_timed_annotations(org_id, dashboard_id, params);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${org_id}/dashboards/${dashboard_id}/annotations`,
        {
          params: {
            panels: "panel-1,panel-2",
            start_time: params.start_time,
            end_time: params.end_time,
          },
        }
      );
    });

    it("should join multiple panels as a comma-separated string", async () => {
      const org_id = "org123";
      const dashboard_id = "dash-abc";
      const params = {
        panels: ["panel-a", "panel-b", "panel-c"],
        start_time: 100000,
        end_time: 200000,
      };

      mockHttpInstance.get.mockResolvedValue({ data: { annotations: [] } });

      await annotationService.get_timed_annotations(org_id, dashboard_id, params);

      const callArgs = mockHttpInstance.get.mock.calls[0];
      expect(callArgs[1].params.panels).toBe("panel-a,panel-b,panel-c");
    });

    it("should handle a single panel in the panels array", async () => {
      const org_id = "org123";
      const dashboard_id = "dash-abc";
      const params = {
        panels: ["only-panel"],
        start_time: 50000,
        end_time: 60000,
      };

      mockHttpInstance.get.mockResolvedValue({ data: { annotations: [] } });

      await annotationService.get_timed_annotations(org_id, dashboard_id, params);

      const callArgs = mockHttpInstance.get.mock.calls[0];
      expect(callArgs[1].params.panels).toBe("only-panel");
    });

    it("should include correct start_time and end_time in query params", async () => {
      const org_id = "prod-org";
      const dashboard_id = "operations-dash";
      const params = {
        panels: ["panel-1"],
        start_time: 1699999000000,
        end_time: 1700009000000,
      };

      mockHttpInstance.get.mockResolvedValue({ data: { annotations: [] } });

      await annotationService.get_timed_annotations(org_id, dashboard_id, params);

      const callArgs = mockHttpInstance.get.mock.calls[0];
      expect(callArgs[1].params.start_time).toBe(1699999000000);
      expect(callArgs[1].params.end_time).toBe(1700009000000);
    });

    it("should use the correct API path with org_id and dashboard_id", async () => {
      const org_id = "my-org";
      const dashboard_id = "my-dashboard";
      const params = {
        panels: ["p1"],
        start_time: 0,
        end_time: 1000,
      };

      mockHttpInstance.get.mockResolvedValue({ data: { annotations: [] } });

      await annotationService.get_timed_annotations(org_id, dashboard_id, params);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${org_id}/dashboards/${dashboard_id}/annotations`,
        expect.any(Object)
      );
    });
  });

  describe("error handling", () => {
    it("should propagate errors from create_timed_annotations", async () => {
      const error = new Error("Validation error");
      mockHttpInstance.post.mockRejectedValue(error);

      await expect(
        annotationService.create_timed_annotations("org123", "dash-abc", [
          { start_time: 1000, title: "Ann" },
        ])
      ).rejects.toThrow("Validation error");
    });

    it("should propagate errors from update_timed_annotations", async () => {
      const error = new Error("Not found");
      mockHttpInstance.put.mockRejectedValue(error);

      await expect(
        annotationService.update_timed_annotations("org123", "dash-abc", "ann-id", [])
      ).rejects.toThrow("Not found");
    });

    it("should propagate errors from delete_timed_annotations", async () => {
      const error = new Error("Forbidden");
      mockHttpInstance.delete.mockRejectedValue(error);

      await expect(
        annotationService.delete_timed_annotations("org123", "dash-abc", ["ann-1"])
      ).rejects.toThrow("Forbidden");
    });

    it("should propagate errors from get_timed_annotations", async () => {
      const error = new Error("Server error");
      mockHttpInstance.get.mockRejectedValue(error);

      await expect(
        annotationService.get_timed_annotations("org123", "dash-abc", {
          panels: ["p1"],
          start_time: 0,
          end_time: 1000,
        })
      ).rejects.toThrow("Server error");
    });
  });
});

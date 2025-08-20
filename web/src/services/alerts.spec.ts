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
import alerts from "@/services/alerts";
import http from "@/services/http";

// Mock the http service
vi.mock("@/services/http", () => ({
  default: vi.fn(() => ({
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  })),
}));

describe("alerts service", () => {
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

  describe("list", () => {
    it("should make GET request to list alerts with correct parameters", async () => {
      const params = {
        page_num: 1,
        page_size: 20,
        sort_by: "name",
        desc: false,
        name: "test",
        org_identifier: "org123",
      };

      mockHttpInstance.get.mockResolvedValue({ data: [] });

      await alerts.list(
        params.page_num,
        params.page_size,
        params.sort_by,
        params.desc,
        params.name,
        params.org_identifier
      );

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/alerts?page_num=${params.page_num}&page_size=${params.page_size}&sort_by=${params.sort_by}&desc=${params.desc}&name=${params.name}`
      );
    });
  });

  describe("listByFolderId", () => {
    it("should make GET request with folder_id when provided", async () => {
      const params = {
        page_num: 1,
        page_size: 20,
        sort_by: "name",
        desc: false,
        name: "test",
        org_identifier: "org123",
        folder_id: "folder456",
      };

      mockHttpInstance.get.mockResolvedValue({ data: [] });

      await alerts.listByFolderId(
        params.page_num,
        params.page_size,
        params.sort_by,
        params.desc,
        params.name,
        params.org_identifier,
        params.folder_id
      );

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/v2/${params.org_identifier}/alerts?sort_by=${params.sort_by}&desc=${params.desc}&name=${params.name}&folder=${params.folder_id}`
      );
    });

    it("should make GET request with query when provided", async () => {
      const params = {
        page_num: 1,
        page_size: 20,
        sort_by: "name",
        desc: false,
        name: "test",
        org_identifier: "org123",
        query: "search_term",
      };

      mockHttpInstance.get.mockResolvedValue({ data: [] });

      await alerts.listByFolderId(
        params.page_num,
        params.page_size,
        params.sort_by,
        params.desc,
        params.name,
        params.org_identifier,
        undefined,
        params.query
      );

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/v2/${params.org_identifier}/alerts?sort_by=${params.sort_by}&desc=${params.desc}&name=${params.name}&alert_name_substring=${params.query}`
      );
    });

    it("should make GET request with both folder_id and query when provided", async () => {
      const params = {
        page_num: 1,
        page_size: 20,
        sort_by: "name",
        desc: false,
        name: "test",
        org_identifier: "org123",
        folder_id: "folder456",
        query: "search_term",
      };

      mockHttpInstance.get.mockResolvedValue({ data: [] });

      await alerts.listByFolderId(
        params.page_num,
        params.page_size,
        params.sort_by,
        params.desc,
        params.name,
        params.org_identifier,
        params.folder_id,
        params.query
      );

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/v2/${params.org_identifier}/alerts?sort_by=${params.sort_by}&desc=${params.desc}&name=${params.name}&folder=${params.folder_id}&alert_name_substring=${params.query}`
      );
    });

    it("should make GET request without optional parameters when not provided", async () => {
      const params = {
        page_num: 1,
        page_size: 20,
        sort_by: "name",
        desc: false,
        name: "test",
        org_identifier: "org123",
      };

      mockHttpInstance.get.mockResolvedValue({ data: [] });

      await alerts.listByFolderId(
        params.page_num,
        params.page_size,
        params.sort_by,
        params.desc,
        params.name,
        params.org_identifier
      );

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/v2/${params.org_identifier}/alerts?sort_by=${params.sort_by}&desc=${params.desc}&name=${params.name}`
      );
    });
  });

  describe("create", () => {
    it("should make POST request to create alert", async () => {
      const params = {
        org_identifier: "org123",
        stream_name: "logs",
        stream_type: "logs",
        data: { name: "test-alert", enabled: true },
      };

      mockHttpInstance.post.mockResolvedValue({ data: { id: "alert123" } });

      await alerts.create(
        params.org_identifier,
        params.stream_name,
        params.stream_type,
        params.data
      );

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/${params.stream_name}/alerts?type=${params.stream_type}`,
        params.data
      );
    });
  });

  describe("update", () => {
    it("should make PUT request to update alert with encoded name", async () => {
      const params = {
        org_identifier: "org123",
        stream_name: "logs",
        stream_type: "logs",
        data: { name: "test alert with spaces", enabled: true },
      };

      mockHttpInstance.put.mockResolvedValue({ data: { success: true } });

      await alerts.update(
        params.org_identifier,
        params.stream_name,
        params.stream_type,
        params.data
      );

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/${params.stream_name}/alerts/test%20alert%20with%20spaces?type=${params.stream_type}`,
        params.data
      );
    });
  });

  describe("get_with_name", () => {
    it("should make GET request with encoded alert name", async () => {
      const params = {
        org_identifier: "org123",
        stream_name: "logs",
        alert_name: "test alert with spaces",
      };

      mockHttpInstance.get.mockResolvedValue({ data: { id: "alert123" } });

      await alerts.get_with_name(
        params.org_identifier,
        params.stream_name,
        params.alert_name
      );

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/${params.stream_name}/alerts/test%20alert%20with%20spaces`
      );
    });
  });

  describe("delete", () => {
    it("should make DELETE request with type parameter when provided", async () => {
      const params = {
        org_identifier: "org123",
        stream_name: "logs",
        alert_name: "test-alert",
        type: "logs",
      };

      mockHttpInstance.delete.mockResolvedValue({ data: { success: true } });

      await alerts.delete(
        params.org_identifier,
        params.stream_name,
        params.alert_name,
        params.type
      );

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/${params.stream_name}/alerts/test-alert?type=${params.type}`
      );
    });

    it("should make DELETE request without type parameter when type is empty", async () => {
      const params = {
        org_identifier: "org123",
        stream_name: "logs",
        alert_name: "test-alert",
        type: "",
      };

      mockHttpInstance.delete.mockResolvedValue({ data: { success: true } });

      await alerts.delete(
        params.org_identifier,
        params.stream_name,
        params.alert_name,
        params.type
      );

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/${params.stream_name}/alerts/test-alert`
      );
    });
  });

  describe("toggleState", () => {
    it("should make PUT request to toggle alert state", async () => {
      const params = {
        org_identifier: "org123",
        stream_name: "logs",
        alert_name: "test-alert",
        enable: true,
        stream_type: "logs",
      };

      mockHttpInstance.put.mockResolvedValue({ data: { enabled: true } });

      await alerts.toggleState(
        params.org_identifier,
        params.stream_name,
        params.alert_name,
        params.enable,
        params.stream_type
      );

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/${params.stream_name}/alerts/test-alert/enable?value=${params.enable}&type=${params.stream_type}`
      );
    });
  });

  describe("preview", () => {
    it("should make GET request to preview alert", async () => {
      const params = {
        org_identifier: "org123",
        stream_name: "logs",
        alert_name: "test-alert",
        stream_type: "logs",
      };

      mockHttpInstance.get.mockResolvedValue({ data: { preview: "data" } });

      await alerts.preview(
        params.org_identifier,
        params.stream_name,
        params.alert_name,
        params.stream_type
      );

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/${params.stream_name}/alerts/test-alert/preview?type=${params.stream_type}`
      );
    });
  });

  describe("create_by_alert_id", () => {
    it("should make POST request with folder_id when provided", async () => {
      const params = {
        org_identifier: "org123",
        data: { name: "test-alert", enabled: true },
        folder_id: "folder456",
      };

      mockHttpInstance.post.mockResolvedValue({ data: { id: "alert123" } });

      await alerts.create_by_alert_id(
        params.org_identifier,
        params.data,
        params.folder_id
      );

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/v2/${params.org_identifier}/alerts?folder=${params.folder_id}`,
        params.data
      );
    });

    it("should make POST request without folder_id when not provided", async () => {
      const params = {
        org_identifier: "org123",
        data: { name: "test-alert", enabled: true },
      };

      mockHttpInstance.post.mockResolvedValue({ data: { id: "alert123" } });

      await alerts.create_by_alert_id(params.org_identifier, params.data);

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/v2/${params.org_identifier}/alerts`,
        params.data
      );
    });
  });

  describe("update_by_alert_id", () => {
    it("should make PUT request with folder_id when provided", async () => {
      const params = {
        org_identifier: "org123",
        data: { id: "alert123", name: "test-alert", enabled: true },
        folder_id: "folder456",
      };

      mockHttpInstance.put.mockResolvedValue({ data: { success: true } });

      await alerts.update_by_alert_id(
        params.org_identifier,
        params.data,
        params.folder_id
      );

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        `/api/v2/${params.org_identifier}/alerts/${params.data.id}?folder=${params.folder_id}`,
        params.data
      );
    });

    it("should make PUT request without folder_id when not provided", async () => {
      const params = {
        org_identifier: "org123",
        data: { id: "alert123", name: "test-alert", enabled: true },
      };

      mockHttpInstance.put.mockResolvedValue({ data: { success: true } });

      await alerts.update_by_alert_id(params.org_identifier, params.data);

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        `/api/v2/${params.org_identifier}/alerts/${params.data.id}`,
        params.data
      );
    });
  });

  describe("delete_by_alert_id", () => {
    it("should make DELETE request with folder_id when provided", async () => {
      const params = {
        org_identifier: "org123",
        alert_id: "alert123",
        folder_id: "folder456",
      };

      mockHttpInstance.delete.mockResolvedValue({ data: { success: true } });

      await alerts.delete_by_alert_id(
        params.org_identifier,
        params.alert_id,
        params.folder_id
      );

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        `/api/v2/${params.org_identifier}/alerts/${params.alert_id}?folder=${params.folder_id}`
      );
    });

    it("should make DELETE request without folder_id when not provided", async () => {
      const params = {
        org_identifier: "org123",
        alert_id: "alert123",
      };

      mockHttpInstance.delete.mockResolvedValue({ data: { success: true } });

      await alerts.delete_by_alert_id(params.org_identifier, params.alert_id);

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        `/api/v2/${params.org_identifier}/alerts/${params.alert_id}`
      );
    });
  });

  describe("toggle_state_by_alert_id", () => {
    it("should make PATCH request with folder_id when provided", async () => {
      const params = {
        org_identifier: "org123",
        alert_id: "alert123",
        enable: true,
        folder_id: "folder456",
      };

      mockHttpInstance.patch.mockResolvedValue({ data: { enabled: true } });

      await alerts.toggle_state_by_alert_id(
        params.org_identifier,
        params.alert_id,
        params.enable,
        params.folder_id
      );

      expect(mockHttpInstance.patch).toHaveBeenCalledWith(
        `/api/v2/${params.org_identifier}/alerts/${params.alert_id}/enable?value=${params.enable}&folder=${params.folder_id}`
      );
    });

    it("should make PATCH request without folder_id when not provided", async () => {
      const params = {
        org_identifier: "org123",
        alert_id: "alert123",
        enable: false,
      };

      mockHttpInstance.patch.mockResolvedValue({ data: { enabled: false } });

      await alerts.toggle_state_by_alert_id(
        params.org_identifier,
        params.alert_id,
        params.enable
      );

      expect(mockHttpInstance.patch).toHaveBeenCalledWith(
        `/api/v2/${params.org_identifier}/alerts/${params.alert_id}/enable?value=${params.enable}`
      );
    });
  });

  describe("get_by_alert_id", () => {
    it("should make GET request with folder_id when provided", async () => {
      const params = {
        org_identifier: "org123",
        alert_id: "alert123",
        folder_id: "folder456",
      };

      mockHttpInstance.get.mockResolvedValue({ data: { id: "alert123" } });

      await alerts.get_by_alert_id(
        params.org_identifier,
        params.alert_id,
        params.folder_id
      );

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/v2/${params.org_identifier}/alerts/${params.alert_id}?folder=${params.folder_id}`
      );
    });

    it("should make GET request without folder_id when not provided", async () => {
      const params = {
        org_identifier: "org123",
        alert_id: "alert123",
      };

      mockHttpInstance.get.mockResolvedValue({ data: { id: "alert123" } });

      await alerts.get_by_alert_id(params.org_identifier, params.alert_id);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/v2/${params.org_identifier}/alerts/${params.alert_id}`
      );
    });
  });

  describe("move_to_another_folder", () => {
    it("should make PATCH request with folder_id when provided", async () => {
      const params = {
        org_identifier: "org123",
        data: { alert_ids: ["alert123"], target_folder: "folder789" },
        folder_id: "folder456",
      };

      mockHttpInstance.patch.mockResolvedValue({ data: { success: true } });

      await alerts.move_to_another_folder(
        params.org_identifier,
        params.data,
        params.folder_id
      );

      expect(mockHttpInstance.patch).toHaveBeenCalledWith(
        `/api/v2/${params.org_identifier}/alerts/move?folder=${params.folder_id}`,
        params.data
      );
    });

    it("should make PATCH request without folder_id when not provided", async () => {
      const params = {
        org_identifier: "org123",
        data: { alert_ids: ["alert123"], target_folder: "folder789" },
      };

      mockHttpInstance.patch.mockResolvedValue({ data: { success: true } });

      await alerts.move_to_another_folder(params.org_identifier, params.data);

      expect(mockHttpInstance.patch).toHaveBeenCalledWith(
        `/api/v2/${params.org_identifier}/alerts/move`,
        params.data
      );
    });
  });

  describe("error handling", () => {
    it("should handle API errors gracefully for list method", async () => {
      const error = new Error("Network error");
      mockHttpInstance.get.mockRejectedValue(error);

      await expect(
        alerts.list(1, 20, "name", false, "test", "org123")
      ).rejects.toThrow("Network error");
    });

    it("should handle API errors gracefully for create method", async () => {
      const error = new Error("Validation error");
      mockHttpInstance.post.mockRejectedValue(error);

      await expect(
        alerts.create("org123", "logs", "logs", { name: "test" })
      ).rejects.toThrow("Validation error");
    });

    it("should handle API errors gracefully for update method", async () => {
      const error = new Error("Not found");
      mockHttpInstance.put.mockRejectedValue(error);

      await expect(
        alerts.update("org123", "logs", "logs", { name: "test" })
      ).rejects.toThrow("Not found");
    });

    it("should handle API errors gracefully for delete method", async () => {
      const error = new Error("Forbidden");
      mockHttpInstance.delete.mockRejectedValue(error);

      await expect(
        alerts.delete("org123", "logs", "test", "logs")
      ).rejects.toThrow("Forbidden");
    });
  });
});
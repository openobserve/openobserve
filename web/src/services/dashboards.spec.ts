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

import { describe, it, expect, vi, beforeEach } from "vitest";
import dashboards from "./dashboards";

// Mock http service
vi.mock("./http", () => ({
  default: vi.fn(() => ({
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
  })),
}));

import http from "./http";

describe("Dashboards Service", () => {
  let mockHttp: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockHttp = {
      get: vi.fn().mockResolvedValue({ data: {} }),
      post: vi.fn().mockResolvedValue({ data: {} }),
      put: vi.fn().mockResolvedValue({ data: {} }),
      delete: vi.fn().mockResolvedValue({ data: {} }),
      patch: vi.fn().mockResolvedValue({ data: {} }),
    };
    (http as any).mockReturnValue(mockHttp);
  });

  describe("list", () => {
    it("should build correct URL and params for basic dashboard list", async () => {
      await dashboards.list(1, 10, "name", false, "test", "test-org", "folder-123", "");

      expect(mockHttp.get).toHaveBeenCalledWith(
        "/api/test-org/dashboards",
        {
          params: {
            page_num: 1,
            page_size: 10,
            sort_by: "name",
            desc: false,
            name: "test",
            folder: "folder-123",
          },
        }
      );
    });

    it("should include title parameter when provided", async () => {
      await dashboards.list(1, 10, "name", true, "test", "test-org", "folder-123", "Dashboard Title");

      expect(mockHttp.get).toHaveBeenCalledWith(
        "/api/test-org/dashboards",
        {
          params: {
            page_num: 1,
            page_size: 10,
            sort_by: "name",
            desc: true,
            name: "test",
            folder: "folder-123",
            title: "Dashboard Title",
          },
        }
      );
    });

    it("should omit title parameter when empty string", async () => {
      await dashboards.list(1, 10, "name", false, "test", "test-org", "folder-123", "");

      expect(mockHttp.get).toHaveBeenCalledWith(
        "/api/test-org/dashboards",
        {
          params: {
            page_num: 1,
            page_size: 10,
            sort_by: "name",
            desc: false,
            name: "test",
            folder: "folder-123",
          },
        }
      );
    });

    it("should omit folder parameter when not provided", async () => {
      await dashboards.list(1, 10, "created", true, "search", "test-org", "", "My Dashboard");

      expect(mockHttp.get).toHaveBeenCalledWith(
        "/api/test-org/dashboards",
        {
          params: {
            page_num: 1,
            page_size: 10,
            sort_by: "created",
            desc: true,
            name: "search",
            title: "My Dashboard",
          },
        }
      );
    });

    it("should handle different page sizes and sorting options", async () => {
      await dashboards.list(5, 50, "updated", false, "", "my-org", "default", "");

      expect(mockHttp.get).toHaveBeenCalledWith(
        "/api/my-org/dashboards",
        {
          params: {
            page_num: 5,
            page_size: 50,
            sort_by: "updated",
            desc: false,
            name: "",
            folder: "default",
          },
        }
      );
    });

    it("should handle zero page numbers and sizes", async () => {
      await dashboards.list(0, 0, "name", true, "filter", "org", "folder", "title");

      expect(mockHttp.get).toHaveBeenCalledWith(
        "/api/org/dashboards",
        {
          params: {
            page_num: 0,
            page_size: 0,
            sort_by: "name",
            desc: true,
            name: "filter",
            folder: "folder",
            title: "title",
          },
        }
      );
    });
  });

  describe("create", () => {
    it("should create dashboard with default folder", async () => {
      const dashboardData = {
        title: "New Dashboard",
        description: "Test dashboard",
        panels: [],
      };

      await dashboards.create("test-org", dashboardData);

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/test-org/dashboards?folder=default",
        dashboardData,
        { headers: { "Content-Type": "application/json; charset=UTF-8" } }
      );
    });

    it("should create dashboard with specified folder", async () => {
      const dashboardData = {
        title: "New Dashboard",
        description: "Test dashboard",
        panels: [],
      };

      await dashboards.create("test-org", dashboardData, "custom-folder");

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/test-org/dashboards?folder=custom-folder",
        dashboardData,
        { headers: { "Content-Type": "application/json; charset=UTF-8" } }
      );
    });

    it("should handle complex dashboard data", async () => {
      const complexDashboard = {
        title: "Complex Dashboard",
        description: "A complex dashboard with multiple panels",
        panels: [
          {
            id: "panel-1",
            title: "Panel 1",
            type: "line",
            queries: [
              { sql: "SELECT * FROM logs WHERE level = 'error'" },
            ],
          },
          {
            id: "panel-2",
            title: "Panel 2",
            type: "bar",
            queries: [
              { sql: "SELECT count(*) FROM metrics" },
            ],
          },
        ],
        variables: [
          { name: "time_range", type: "time" },
          { name: "environment", type: "query" },
        ],
      };

      await dashboards.create("production-org", complexDashboard, "monitoring");

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/production-org/dashboards?folder=monitoring",
        complexDashboard,
        { headers: { "Content-Type": "application/json; charset=UTF-8" } }
      );
    });

    it("should handle empty dashboard data", async () => {
      await dashboards.create("test-org", {});

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/test-org/dashboards?folder=default",
        {},
        { headers: { "Content-Type": "application/json; charset=UTF-8" } }
      );
    });
  });

  describe("delete", () => {
    it("should delete dashboard with default folder", async () => {
      await dashboards.delete("test-org", "dashboard-123");

      expect(mockHttp.delete).toHaveBeenCalledWith(
        "/api/test-org/dashboards/dashboard-123?folder=default"
      );
    });

    it("should delete dashboard with specified folder", async () => {
      await dashboards.delete("test-org", "dashboard-456", "custom-folder");

      expect(mockHttp.delete).toHaveBeenCalledWith(
        "/api/test-org/dashboards/dashboard-456?folder=custom-folder"
      );
    });

    it("should handle various dashboard ID formats", async () => {
      const dashboardIds = [
        "simple-id",
        "dashboard-with-uuid-12345-67890-abcdef",
        "UPPERCASE_ID",
        "id-with-special-chars_.$",
        "123456789",
      ];

      for (const id of dashboardIds) {
        await dashboards.delete("test-org", id, "test-folder");

        expect(mockHttp.delete).toHaveBeenCalledWith(
          `/api/test-org/dashboards/${id}?folder=test-folder`
        );
      }

      expect(mockHttp.delete).toHaveBeenCalledTimes(dashboardIds.length);
    });

    it("should handle different organization names", async () => {
      const organizations = ["org1", "my-organization", "test_org_123", "PROD"];

      for (const org of organizations) {
        await dashboards.delete(org, "dashboard-id", "folder");
        expect(mockHttp.delete).toHaveBeenCalledWith(
          `/api/${org}/dashboards/dashboard-id?folder=folder`
        );
      }
    });
  });

  describe("get_Dashboard", () => {
    it("should get dashboard with default folder", async () => {
      await dashboards.get_Dashboard("test-org", "dashboard-123");

      expect(mockHttp.get).toHaveBeenCalledWith(
        "/api/test-org/dashboards/dashboard-123?folder=default"
      );
    });

    it("should get dashboard with specified folder", async () => {
      await dashboards.get_Dashboard("test-org", "dashboard-456", "custom-folder");

      expect(mockHttp.get).toHaveBeenCalledWith(
        "/api/test-org/dashboards/dashboard-456?folder=custom-folder"
      );
    });

    it("should handle various organizations and dashboard IDs", async () => {
      const testCases = [
        { org: "org1", id: "dash1", folder: "folder1" },
        { org: "long-organization-name", id: "uuid-12345", folder: "analytics" },
        { org: "test", id: "simple", folder: "default" },
      ];

      for (const { org, id, folder } of testCases) {
        await dashboards.get_Dashboard(org, id, folder);
        expect(mockHttp.get).toHaveBeenCalledWith(
          `/api/${org}/dashboards/${id}?folder=${folder}`
        );
      }
    });
  });

  describe("save", () => {
    it("should save dashboard with all parameters", async () => {
      const dashboardData = {
        title: "Updated Dashboard",
        description: "Updated description",
        panels: [{ id: "panel-1", title: "Updated Panel" }],
      };

      await dashboards.save("test-org", "dashboard-123", dashboardData, "folder-1", "hash-456");

      expect(mockHttp.put).toHaveBeenCalledWith(
        "/api/test-org/dashboards/dashboard-123?folder=folder-1&hash=hash-456",
        dashboardData,
        { headers: { "Content-Type": "application/json; charset=UTF-8" } }
      );
    });

    it("should save dashboard with default folder when folderId not provided", async () => {
      const dashboardData = { title: "Test Dashboard" };

      await dashboards.save("test-org", "dashboard-123", dashboardData, undefined, "hash-123");

      expect(mockHttp.put).toHaveBeenCalledWith(
        "/api/test-org/dashboards/dashboard-123?folder=default&hash=hash-123",
        dashboardData,
        { headers: { "Content-Type": "application/json; charset=UTF-8" } }
      );
    });

    it("should handle undefined hash parameter", async () => {
      const dashboardData = { title: "Test Dashboard" };

      await dashboards.save("test-org", "dashboard-123", dashboardData, "folder-1");

      expect(mockHttp.put).toHaveBeenCalledWith(
        "/api/test-org/dashboards/dashboard-123?folder=folder-1&hash=undefined",
        dashboardData,
        { headers: { "Content-Type": "application/json; charset=UTF-8" } }
      );
    });

    it("should handle empty dashboard data", async () => {
      await dashboards.save("org", "id", {}, "folder", "hash");

      expect(mockHttp.put).toHaveBeenCalledWith(
        "/api/org/dashboards/id?folder=folder&hash=hash",
        {},
        { headers: { "Content-Type": "application/json; charset=UTF-8" } }
      );
    });

    it("should handle large dashboard data", async () => {
      const largeDashboard = {
        title: "Large Dashboard",
        panels: Array.from({ length: 100 }, (_, i) => ({
          id: `panel-${i}`,
          title: `Panel ${i}`,
          type: "chart",
          data: { series: Array.from({ length: 1000 }, (_, j) => ({ x: j, y: Math.random() })) },
        })),
        variables: Array.from({ length: 50 }, (_, i) => ({
          name: `var-${i}`,
          type: "query",
          query: `SELECT DISTINCT field_${i} FROM logs`,
        })),
      };

      await dashboards.save("test-org", "large-dash", largeDashboard, "analytics", "hash-large");

      expect(mockHttp.put).toHaveBeenCalledWith(
        "/api/test-org/dashboards/large-dash?folder=analytics&hash=hash-large",
        largeDashboard,
        { headers: { "Content-Type": "application/json; charset=UTF-8" } }
      );
    });
  });

  describe("list_Folders", () => {
    it("should list folders for organization", async () => {
      await dashboards.list_Folders("test-org");

      expect(mockHttp.get).toHaveBeenCalledWith("/api/v2/test-org/folders/dashboards");
    });

    it("should handle different organization names", async () => {
      const organizations = [
        "simple",
        "org-with-dashes",
        "org_with_underscores",
        "ORG123",
        "very-long-organization-name-with-multiple-words",
      ];

      for (const org of organizations) {
        await dashboards.list_Folders(org);
        expect(mockHttp.get).toHaveBeenCalledWith(`/api/v2/${org}/folders/dashboards`);
      }

      expect(mockHttp.get).toHaveBeenCalledTimes(organizations.length);
    });

    it("should handle special characters in organization names", async () => {
      const specialOrgs = ["org.with.dots", "org@domain.com", "org+test"];

      for (const org of specialOrgs) {
        await dashboards.list_Folders(org);
        expect(mockHttp.get).toHaveBeenCalledWith(`/api/v2/${org}/folders/dashboards`);
      }
    });
  });

  describe("new_Folder", () => {
    it("should create new folder with basic data", async () => {
      const folderData = {
        name: "New Folder",
        description: "Test folder",
      };

      await dashboards.new_Folder("test-org", folderData);

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/v2/test-org/folders/dashboards",
        folderData,
        { headers: { "Content-Type": "application/json; charset=UTF-8" } }
      );
    });

    it("should create folder with complex metadata", async () => {
      const complexFolderData = {
        name: "Analytics Folder",
        description: "Folder for analytics dashboards",
        tags: ["analytics", "production", "monitoring"],
        settings: {
          permissions: {
            read: ["user1", "user2"],
            write: ["admin1"],
          },
          color: "#FF5733",
          icon: "analytics",
        },
        metadata: {
          created_by: "admin@company.com",
          team: "data-team",
          project: "monitoring-suite",
        },
      };

      await dashboards.new_Folder("prod-org", complexFolderData);

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/v2/prod-org/folders/dashboards",
        complexFolderData,
        { headers: { "Content-Type": "application/json; charset=UTF-8" } }
      );
    });

    it("should handle empty folder data", async () => {
      await dashboards.new_Folder("test-org", {});

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/v2/test-org/folders/dashboards",
        {},
        { headers: { "Content-Type": "application/json; charset=UTF-8" } }
      );
    });

    it("should handle folder names with special characters", async () => {
      const specialFolders = [
        { name: "Folder with spaces" },
        { name: "Folder-with-dashes" },
        { name: "Folder_with_underscores" },
        { name: "Folder.with.dots" },
        { name: "Folder (with) parentheses" },
        { name: "Folder@symbol&more" },
      ];

      for (const folderData of specialFolders) {
        await dashboards.new_Folder("test-org", folderData);
        expect(mockHttp.post).toHaveBeenCalledWith(
          "/api/v2/test-org/folders/dashboards",
          folderData,
          { headers: { "Content-Type": "application/json; charset=UTF-8" } }
        );
      }
    });
  });

  describe("edit_Folder", () => {
    it("should edit folder with updated data", async () => {
      const updatedData = {
        name: "Updated Folder Name",
        description: "Updated description",
      };

      await dashboards.edit_Folder("test-org", "folder-123", updatedData);

      expect(mockHttp.put).toHaveBeenCalledWith(
        "/api/v2/test-org/folders/dashboards/folder-123",
        updatedData,
        { headers: { "Content-Type": "application/json; charset=UTF-8" } }
      );
    });

    it("should handle different folder ID formats", async () => {
      const folderIds = [
        "simple-id",
        "folder-uuid-12345-67890",
        "123456789",
        "UPPERCASE_FOLDER",
        "folder_with_underscores",
        "folder.with.dots",
      ];

      const updateData = { name: "Updated Name" };

      for (const folderId of folderIds) {
        await dashboards.edit_Folder("test-org", folderId, updateData);
        expect(mockHttp.put).toHaveBeenCalledWith(
          `/api/v2/test-org/folders/dashboards/${folderId}`,
          updateData,
          { headers: { "Content-Type": "application/json; charset=UTF-8" } }
        );
      }
    });

    it("should handle partial updates", async () => {
      const partialUpdates = [
        { name: "New Name Only" },
        { description: "New Description Only" },
        { color: "#FF0000" },
        { tags: ["new", "tags"] },
      ];

      for (const update of partialUpdates) {
        await dashboards.edit_Folder("test-org", "folder-id", update);
        expect(mockHttp.put).toHaveBeenCalledWith(
          "/api/v2/test-org/folders/dashboards/folder-id",
          update,
          { headers: { "Content-Type": "application/json; charset=UTF-8" } }
        );
      }
    });

    it("should handle numeric folder IDs", async () => {
      const numericIds = [1, 123, 999999];

      for (const id of numericIds) {
        await dashboards.edit_Folder("test-org", id, { name: "Test" });
        expect(mockHttp.put).toHaveBeenCalledWith(
          `/api/v2/test-org/folders/dashboards/${id}`,
          { name: "Test" },
          { headers: { "Content-Type": "application/json; charset=UTF-8" } }
        );
      }
    });
  });

  describe("delete_Folder", () => {
    it("should delete folder by ID", async () => {
      await dashboards.delete_Folder("test-org", "folder-123");

      expect(mockHttp.delete).toHaveBeenCalledWith("/api/v2/test-org/folders/dashboards/folder-123");
    });

    it("should handle different folder ID types", async () => {
      const folderIds = [
        "string-id",
        123,
        "uuid-abc-123",
        "folder_with_underscores",
        "UPPERCASE",
      ];

      for (const folderId of folderIds) {
        await dashboards.delete_Folder("org", folderId);
        expect(mockHttp.delete).toHaveBeenCalledWith(`/api/v2/org/folders/dashboards/${folderId}`);
      }
    });

    it("should handle different organizations", async () => {
      const testCases = [
        { org: "org1", folderId: "folder1" },
        { org: "production-environment", folderId: "analytics-folder" },
        { org: "dev", folderId: 999 },
      ];

      for (const { org, folderId } of testCases) {
        await dashboards.delete_Folder(org, folderId);
        expect(mockHttp.delete).toHaveBeenCalledWith(`/api/v2/${org}/folders/dashboards/${folderId}`);
      }
    });
  });

  describe("move_Dashboard", () => {
    it("should move single dashboard to another folder", async () => {
      await dashboards.move_Dashboard("test-org", ["dashboard-123"], "source-folder", "target-folder");

      expect(mockHttp.patch).toHaveBeenCalledWith(
        "/api/test-org/dashboards/move?folder=source-folder",
        {
          dashboard_ids: ["dashboard-123"],
          dst_folder_id: "target-folder",
        },
        { headers: { "Content-Type": "application/json; charset=UTF-8" } }
      );
    });

    it("should move multiple dashboards to another folder", async () => {
      const dashboardIds = ["dash-1", "dash-2", "dash-3", "dash-4"];

      await dashboards.move_Dashboard("test-org", dashboardIds, "old-folder", "new-folder");

      expect(mockHttp.patch).toHaveBeenCalledWith(
        "/api/test-org/dashboards/move?folder=old-folder",
        {
          dashboard_ids: dashboardIds,
          dst_folder_id: "new-folder",
        },
        { headers: { "Content-Type": "application/json; charset=UTF-8" } }
      );
    });

    it("should handle empty dashboard IDs array", async () => {
      await dashboards.move_Dashboard("test-org", [], "source", "target");

      expect(mockHttp.patch).toHaveBeenCalledWith(
        "/api/test-org/dashboards/move?folder=source",
        {
          dashboard_ids: [],
          dst_folder_id: "target",
        },
        { headers: { "Content-Type": "application/json; charset=UTF-8" } }
      );
    });

    it("should handle large number of dashboard IDs", async () => {
      const manyDashboards = Array.from({ length: 100 }, (_, i) => `dashboard-${i}`);

      await dashboards.move_Dashboard("prod-org", manyDashboards, "analytics", "archive");

      expect(mockHttp.patch).toHaveBeenCalledWith(
        "/api/prod-org/dashboards/move?folder=analytics",
        {
          dashboard_ids: manyDashboards,
          dst_folder_id: "archive",
        },
        { headers: { "Content-Type": "application/json; charset=UTF-8" } }
      );
    });

    it("should handle special folder names", async () => {
      const specialFolders = [
        { from: "folder with spaces", to: "folder-with-dashes" },
        { from: "folder_underscore", to: "folder.dots" },
        { from: "UPPERCASE", to: "lowercase" },
        { from: "default", to: "archived" },
      ];

      for (const { from, to } of specialFolders) {
        await dashboards.move_Dashboard("test-org", ["dash-1"], from, to);
        expect(mockHttp.patch).toHaveBeenCalledWith(
          `/api/test-org/dashboards/move?folder=${from}`,
          {
            dashboard_ids: ["dash-1"],
            dst_folder_id: to,
          },
          { headers: { "Content-Type": "application/json; charset=UTF-8" } }
        );
      }
    });

    it("should handle different dashboard ID formats", async () => {
      const idFormats = [
        ["simple"],
        ["uuid-123-456-789"],
        ["123", "456", "789"],
        ["UPPERCASE_ID"],
        ["id.with.dots"],
        ["id-with-special-chars_$%"],
      ];

      for (const ids of idFormats) {
        await dashboards.move_Dashboard("test-org", ids, "source", "dest");
        expect(mockHttp.patch).toHaveBeenCalledWith(
          "/api/test-org/dashboards/move?folder=source",
          {
            dashboard_ids: ids,
            dst_folder_id: "dest",
          },
          { headers: { "Content-Type": "application/json; charset=UTF-8" } }
        );
      }
    });
  });
});
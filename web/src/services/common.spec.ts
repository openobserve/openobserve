import { describe, it, expect, vi, beforeEach } from "vitest";
import common from "./common";

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

describe("Common Service", () => {
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

  describe("list_Folders", () => {
    it("should list folders with correct URL for basic folder types", async () => {
      await common.list_Folders("test-org", "alerts");

      expect(mockHttp.get).toHaveBeenCalledWith("/api/v2/test-org/folders/alerts");
    });

    it("should handle different folder types", async () => {
      const folderTypes = ["alerts", "dashboards", "reports", "templates", "notebooks"];

      for (const folderType of folderTypes) {
        await common.list_Folders("test-org", folderType);
        expect(mockHttp.get).toHaveBeenCalledWith(`/api/v2/test-org/folders/${folderType}`);
      }

      expect(mockHttp.get).toHaveBeenCalledTimes(folderTypes.length);
    });

    it("should handle different organization names", async () => {
      const organizations = ["org1", "my-organization", "test_org_123", "PROD-ORG"];

      for (const org of organizations) {
        await common.list_Folders(org, "alerts");
        expect(mockHttp.get).toHaveBeenCalledWith(`/api/v2/${org}/folders/alerts`);
      }
    });

    it("should handle special characters in organization and folder type names", async () => {
      const testCases = [
        { org: "org-with-dashes", folderType: "folder-type" },
        { org: "org_with_underscores", folderType: "folder_type" },
        { org: "org.with.dots", folderType: "folder.type" },
        { org: "org@domain.com", folderType: "custom-folders" },
      ];

      for (const { org, folderType } of testCases) {
        await common.list_Folders(org, folderType);
        expect(mockHttp.get).toHaveBeenCalledWith(`/api/v2/${org}/folders/${folderType}`);
      }
    });

    it("should handle empty strings", async () => {
      await common.list_Folders("", "");

      expect(mockHttp.get).toHaveBeenCalledWith("/api/v2//folders/");
    });

    it("should handle numeric organization names", async () => {
      await common.list_Folders("12345", "alerts");

      expect(mockHttp.get).toHaveBeenCalledWith("/api/v2/12345/folders/alerts");
    });
  });

  describe("new_Folder", () => {
    it("should create new folder with correct URL and data", async () => {
      const folderData = {
        name: "New Folder",
        description: "Test folder",
      };

      await common.new_Folder("test-org", "alerts", folderData);

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/v2/test-org/folders/alerts",
        folderData,
        { headers: { "Content-Type": "application/json; charset=UTF-8" } }
      );
    });

    it("should handle different folder types when creating", async () => {
      const folderData = { name: "Test Folder" };
      const folderTypes = ["dashboards", "reports", "notebooks", "custom"];

      for (const folderType of folderTypes) {
        await common.new_Folder("test-org", folderType, folderData);
        expect(mockHttp.post).toHaveBeenCalledWith(
          `/api/v2/test-org/folders/${folderType}`,
          folderData,
          { headers: { "Content-Type": "application/json; charset=UTF-8" } }
        );
      }
    });

    it("should handle complex folder data", async () => {
      const complexFolderData = {
        name: "Complex Folder",
        description: "A complex folder with metadata",
        tags: ["production", "monitoring"],
        settings: {
          permissions: {
            read: ["user1", "user2"],
            write: ["admin1"],
          },
          color: "#FF5733",
          icon: "folder",
        },
        metadata: {
          created_by: "admin@company.com",
          team: "ops-team",
          project: "monitoring",
        },
      };

      await common.new_Folder("prod-org", "dashboards", complexFolderData);

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/v2/prod-org/folders/dashboards",
        complexFolderData,
        { headers: { "Content-Type": "application/json; charset=UTF-8" } }
      );
    });

    it("should handle empty folder data", async () => {
      await common.new_Folder("test-org", "alerts", {});

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/v2/test-org/folders/alerts",
        {},
        { headers: { "Content-Type": "application/json; charset=UTF-8" } }
      );
    });

    it("should handle folder data with special characters", async () => {
      const specialData = {
        name: "Folder with spaces & special chars!",
        description: "Description with unicode: 🚀 emoji and symbols: @#$%",
        tags: ["tag-with-dash", "tag_with_underscore", "tag.with.dot"],
      };

      await common.new_Folder("test-org", "alerts", specialData);

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/v2/test-org/folders/alerts",
        specialData,
        { headers: { "Content-Type": "application/json; charset=UTF-8" } }
      );
    });
  });

  describe("edit_Folder", () => {
    it("should edit folder with correct URL and data", async () => {
      const updatedData = {
        name: "Updated Folder Name",
        description: "Updated description",
      };

      await common.edit_Folder("test-org", "alerts", "folder-123", updatedData);

      expect(mockHttp.put).toHaveBeenCalledWith(
        "/api/v2/test-org/folders/alerts/folder-123",
        updatedData,
        { headers: { "Content-Type": "application/json; charset=UTF-8" } }
      );
    });

    it("should handle different folder ID formats", async () => {
      const folderIds = [
        "simple-id",
        "folder-uuid-12345-67890",
        123456789,
        "UPPERCASE_FOLDER",
        "folder_with_underscores",
        "folder.with.dots",
      ];

      const updateData = { name: "Updated Name" };

      for (const folderId of folderIds) {
        await common.edit_Folder("test-org", "alerts", folderId, updateData);
        expect(mockHttp.put).toHaveBeenCalledWith(
          `/api/v2/test-org/folders/alerts/${folderId}`,
          updateData,
          { headers: { "Content-Type": "application/json; charset=UTF-8" } }
        );
      }
    });

    it("should handle different folder types when editing", async () => {
      const folderTypes = ["dashboards", "reports", "notebooks", "alerts"];
      const updateData = { name: "Updated Folder" };

      for (const folderType of folderTypes) {
        await common.edit_Folder("test-org", folderType, "folder-id", updateData);
        expect(mockHttp.put).toHaveBeenCalledWith(
          `/api/v2/test-org/folders/${folderType}/folder-id`,
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
        { settings: { newSetting: true } },
      ];

      for (const update of partialUpdates) {
        await common.edit_Folder("test-org", "alerts", "folder-id", update);
        expect(mockHttp.put).toHaveBeenCalledWith(
          "/api/v2/test-org/folders/alerts/folder-id",
          update,
          { headers: { "Content-Type": "application/json; charset=UTF-8" } }
        );
      }
    });

    it("should handle large update data", async () => {
      const largeUpdate = {
        name: "Large Folder Update",
        description: "A very long description that contains lots of details about this folder and what it's used for",
        tags: Array.from({ length: 50 }, (_, i) => `tag-${i}`),
        metadata: {
          history: Array.from({ length: 100 }, (_, i) => ({
            timestamp: Date.now() + i,
            action: `action-${i}`,
            user: `user-${i}`,
          })),
        },
        settings: {
          permissions: {
            read: Array.from({ length: 20 }, (_, i) => `read-user-${i}`),
            write: Array.from({ length: 10 }, (_, i) => `write-user-${i}`),
          },
        },
      };

      await common.edit_Folder("test-org", "dashboards", "large-folder", largeUpdate);

      expect(mockHttp.put).toHaveBeenCalledWith(
        "/api/v2/test-org/folders/dashboards/large-folder",
        largeUpdate,
        { headers: { "Content-Type": "application/json; charset=UTF-8" } }
      );
    });
  });

  describe("delete_Folder", () => {
    it("should delete folder with correct URL", async () => {
      await common.delete_Folder("test-org", "alerts", "folder-123");

      expect(mockHttp.delete).toHaveBeenCalledWith("/api/v2/test-org/folders/alerts/folder-123");
    });

    it("should handle different folder ID types", async () => {
      const folderIds = [
        "string-id",
        123,
        "uuid-abc-123",
        "folder_with_underscores",
        "UPPERCASE",
        "folder.with.dots",
      ];

      for (const folderId of folderIds) {
        await common.delete_Folder("org", "alerts", folderId);
        expect(mockHttp.delete).toHaveBeenCalledWith(`/api/v2/org/folders/alerts/${folderId}`);
      }
    });

    it("should handle different organizations and folder types", async () => {
      const testCases = [
        { org: "org1", folderType: "alerts", folderId: "folder1" },
        { org: "production-env", folderType: "dashboards", folderId: "analytics-folder" },
        { org: "dev", folderType: "reports", folderId: 999 },
        { org: "test_org", folderType: "notebooks", folderId: "notebook-folder" },
      ];

      for (const { org, folderType, folderId } of testCases) {
        await common.delete_Folder(org, folderType, folderId);
        expect(mockHttp.delete).toHaveBeenCalledWith(`/api/v2/${org}/folders/${folderType}/${folderId}`);
      }
    });

    it("should handle special characters in parameters", async () => {
      await common.delete_Folder("org@domain.com", "folder-type", "folder-id-with-special-chars_$%");

      expect(mockHttp.delete).toHaveBeenCalledWith("/api/v2/org@domain.com/folders/folder-type/folder-id-with-special-chars_$%");
    });
  });

  describe("get_Folder", () => {
    it("should get folder with correct URL", async () => {
      await common.get_Folder("test-org", "alerts", "folder-123");

      expect(mockHttp.get).toHaveBeenCalledWith("/api/v2/test-org/folders/alerts/folder-123");
    });

    it("should handle different folder types when getting", async () => {
      const folderTypes = ["alerts", "dashboards", "reports", "notebooks", "templates"];

      for (const folderType of folderTypes) {
        await common.get_Folder("test-org", folderType, "folder-id");
        expect(mockHttp.get).toHaveBeenCalledWith(`/api/v2/test-org/folders/${folderType}/folder-id`);
      }
    });

    it("should handle various folder IDs", async () => {
      const folderIds = [
        "simple-id",
        123,
        "folder-uuid-abc-123",
        "UPPERCASE_ID",
        "folder_with_underscores",
        "folder.with.dots",
        "folder-with-special-chars@#$",
      ];

      for (const folderId of folderIds) {
        await common.get_Folder("test-org", "alerts", folderId);
        expect(mockHttp.get).toHaveBeenCalledWith(`/api/v2/test-org/folders/alerts/${folderId}`);
      }
    });

    it("should handle different organizations", async () => {
      const organizations = [
        "simple-org",
        "org-with-dashes",
        "org_with_underscores", 
        "org.with.dots",
        "ORG123",
        "12345",
      ];

      for (const org of organizations) {
        await common.get_Folder(org, "alerts", "folder-id");
        expect(mockHttp.get).toHaveBeenCalledWith(`/api/v2/${org}/folders/alerts/folder-id`);
      }
    });
  });

  describe("move_across_folders", () => {
    it("should move items across folders with basic parameters", async () => {
      const moveData = {
        items: ["item1", "item2"],
        source_folder: "source",
        target_folder: "target",
      };

      await common.move_across_folders("test-org", "alerts", moveData);

      expect(mockHttp.patch).toHaveBeenCalledWith(
        "/api/v2/test-org/alerts/move",
        moveData
      );
    });

    it("should include folder_id parameter when provided", async () => {
      const moveData = {
        items: ["item1", "item2"],
        source_folder: "source",
        target_folder: "target",
      };

      await common.move_across_folders("test-org", "dashboards", moveData, "target-folder");

      expect(mockHttp.patch).toHaveBeenCalledWith(
        "/api/v2/test-org/dashboards/move?folder=target-folder",
        moveData
      );
    });

    it("should handle different resource types", async () => {
      const resourceTypes = ["alerts", "dashboards", "reports", "notebooks", "templates"];
      const moveData = { items: ["item1"], target: "folder" };

      for (const type of resourceTypes) {
        await common.move_across_folders("test-org", type, moveData);
        expect(mockHttp.patch).toHaveBeenCalledWith(
          `/api/v2/test-org/${type}/move`,
          moveData
        );
      }
    });

    it("should handle complex move data", async () => {
      const complexMoveData = {
        items: Array.from({ length: 50 }, (_, i) => `item-${i}`),
        source_folder: "analytics-folder",
        target_folder: "archive-folder", 
        preserve_permissions: true,
        move_metadata: true,
        options: {
          recursive: true,
          force: false,
          backup_before_move: true,
        },
        timestamp: Date.now(),
        user: "admin@company.com",
      };

      await common.move_across_folders("prod-org", "dashboards", complexMoveData, "archive");

      expect(mockHttp.patch).toHaveBeenCalledWith(
        "/api/v2/prod-org/dashboards/move?folder=archive",
        complexMoveData
      );
    });

    it("should handle empty move data", async () => {
      await common.move_across_folders("test-org", "alerts", {});

      expect(mockHttp.patch).toHaveBeenCalledWith(
        "/api/v2/test-org/alerts/move",
        {}
      );
    });

    it("should handle different folder_id formats", async () => {
      const folderIds = [
        "simple-folder",
        123,
        "folder-uuid-abc-123",
        "UPPERCASE_FOLDER",
        "folder_with_underscores",
        "folder.with.dots",
      ];

      const moveData = { items: ["item1"] };

      for (const folderId of folderIds) {
        await common.move_across_folders("test-org", "alerts", moveData, folderId);
        expect(mockHttp.patch).toHaveBeenCalledWith(
          `/api/v2/test-org/alerts/move?folder=${folderId}`,
          moveData
        );
      }
    });

    it("should handle special characters in parameters", async () => {
      const moveData = {
        items: ["item@special", "item#hash", "item$dollar"],
        source: "folder with spaces",
        target: "folder-with-dashes",
      };

      await common.move_across_folders("org@domain.com", "custom-type", moveData, "target@folder");

      expect(mockHttp.patch).toHaveBeenCalledWith(
        "/api/v2/org@domain.com/custom-type/move?folder=target@folder",
        moveData
      );
    });
  });

  describe("list_nodes", () => {
    it("should list nodes with correct URL", async () => {
      await common.list_nodes("test-org");

      expect(mockHttp.get).toHaveBeenCalledWith("/api/test-org/node/list");
    });

    it("should handle different organization names", async () => {
      const organizations = [
        "simple-org",
        "org-with-dashes",
        "org_with_underscores",
        "ORG123",
        "production.environment",
        "dev@domain.com",
        "12345",
      ];

      for (const org of organizations) {
        await common.list_nodes(org);
        expect(mockHttp.get).toHaveBeenCalledWith(`/api/${org}/node/list`);
      }

      expect(mockHttp.get).toHaveBeenCalledTimes(organizations.length);
    });

    it("should handle empty organization string", async () => {
      await common.list_nodes("");

      expect(mockHttp.get).toHaveBeenCalledWith("/api//node/list");
    });

    it("should handle numeric organization", async () => {
      await common.list_nodes("999999");

      expect(mockHttp.get).toHaveBeenCalledWith("/api/999999/node/list");
    });

    it("should handle organization names with special characters", async () => {
      const specialOrgs = [
        "org@special.com",
        "org#hash",
        "org$dollar",
        "org%percent",
        "org&ampersand",
      ];

      for (const org of specialOrgs) {
        await common.list_nodes(org);
        expect(mockHttp.get).toHaveBeenCalledWith(`/api/${org}/node/list`);
      }
    });
  });

  describe("Integration tests", () => {
    it("should handle full folder lifecycle (create, get, edit, delete)", async () => {
      const org = "test-org";
      const folderType = "alerts";
      const folderId = "lifecycle-folder";
      
      // Create
      const createData = { name: "Lifecycle Folder" };
      await common.new_Folder(org, folderType, createData);
      
      // Get
      await common.get_Folder(org, folderType, folderId);
      
      // Edit
      const updateData = { name: "Updated Lifecycle Folder" };
      await common.edit_Folder(org, folderType, folderId, updateData);
      
      // Delete
      await common.delete_Folder(org, folderType, folderId);

      expect(mockHttp.post).toHaveBeenCalledWith(
        `/api/v2/${org}/folders/${folderType}`,
        createData,
        { headers: { "Content-Type": "application/json; charset=UTF-8" } }
      );
      expect(mockHttp.get).toHaveBeenCalledWith(`/api/v2/${org}/folders/${folderType}/${folderId}`);
      expect(mockHttp.put).toHaveBeenCalledWith(
        `/api/v2/${org}/folders/${folderType}/${folderId}`,
        updateData,
        { headers: { "Content-Type": "application/json; charset=UTF-8" } }
      );
      expect(mockHttp.delete).toHaveBeenCalledWith(`/api/v2/${org}/folders/${folderType}/${folderId}`);
    });

    it("should use consistent URL patterns across all methods", async () => {
      const org = "consistency-org";
      const folderType = "consistency-type";
      const folderId = "consistency-folder";
      const data = { test: "data" };

      await common.list_Folders(org, folderType);
      await common.new_Folder(org, folderType, data);
      await common.get_Folder(org, folderType, folderId);
      await common.edit_Folder(org, folderType, folderId, data);
      await common.delete_Folder(org, folderType, folderId);

      // Verify all folder-related methods use v2 API
      expect(mockHttp.get).toHaveBeenCalledWith(`/api/v2/${org}/folders/${folderType}`);
      expect(mockHttp.get).toHaveBeenCalledWith(`/api/v2/${org}/folders/${folderType}/${folderId}`);
      expect(mockHttp.post).toHaveBeenCalledWith(
        `/api/v2/${org}/folders/${folderType}`,
        data,
        { headers: { "Content-Type": "application/json; charset=UTF-8" } }
      );
      expect(mockHttp.put).toHaveBeenCalledWith(
        `/api/v2/${org}/folders/${folderType}/${folderId}`,
        data,
        { headers: { "Content-Type": "application/json; charset=UTF-8" } }
      );
      expect(mockHttp.delete).toHaveBeenCalledWith(`/api/v2/${org}/folders/${folderType}/${folderId}`);
    });
  });
});
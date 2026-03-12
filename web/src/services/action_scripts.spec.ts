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
import actions from "@/services/action_scripts";
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

describe("action_scripts service", () => {
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

  describe("create", () => {
    it("should make POST request to upload action", async () => {
      const org_identifier = "org123";
      const data = { name: "my-action", script: "console.log('hello')" };

      mockHttpInstance.post.mockResolvedValue({ data: { id: "action-ksuid-1" } });

      await actions.create(org_identifier, "", data);

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/${org_identifier}/actions/upload`,
        data
      );
    });

    it("should make POST request ignoring the action_id parameter", async () => {
      const org_identifier = "test-org";
      const action_id = "ignored-id";
      const data = { name: "another-action", script: "return 42;" };

      mockHttpInstance.post.mockResolvedValue({ data: { id: "new-action-id" } });

      await actions.create(org_identifier, action_id, data);

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/${org_identifier}/actions/upload`,
        data
      );
    });

    it("should make POST request with default action_id when not provided", async () => {
      const org_identifier = "default-org";
      const data = { name: "default-action" };

      mockHttpInstance.post.mockResolvedValue({ data: { id: "default-action-id" } });

      await actions.create(org_identifier, undefined as any, data);

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/${org_identifier}/actions/upload`,
        data
      );
    });
  });

  describe("update", () => {
    it("should make PUT request to update action by id", async () => {
      const org_identifier = "org123";
      const action_id = "action-ksuid-1";
      const data = { name: "updated-action", script: "console.log('updated')" };

      mockHttpInstance.put.mockResolvedValue({ data: { success: true } });

      await actions.update(org_identifier, action_id, data);

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        `/api/${org_identifier}/actions/${action_id}`,
        data
      );
    });

    it("should make PUT request with different org and action id", async () => {
      const org_identifier = "prod-org";
      const action_id = "prod-action-xyz";
      const data = { enabled: false };

      mockHttpInstance.put.mockResolvedValue({ data: { success: true } });

      await actions.update(org_identifier, action_id, data);

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        `/api/${org_identifier}/actions/${action_id}`,
        data
      );
    });
  });

  describe("list", () => {
    it("should make GET request to list all actions for an org", async () => {
      const org_identifier = "org123";

      mockHttpInstance.get.mockResolvedValue({ data: { list: [] } });

      await actions.list(org_identifier);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${org_identifier}/actions`
      );
    });

    it("should make GET request with a different org identifier", async () => {
      const org_identifier = "another-org";

      mockHttpInstance.get.mockResolvedValue({
        data: { list: [{ id: "action-1", name: "script-one" }] },
      });

      await actions.list(org_identifier);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${org_identifier}/actions`
      );
    });
  });

  describe("get_by_id", () => {
    it("should make GET request with encoded ksuid", async () => {
      const org_identifier = "org123";
      const ksuid = "action-ksuid-1";

      mockHttpInstance.get.mockResolvedValue({ data: { id: ksuid } });

      await actions.get_by_id(org_identifier, ksuid);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${org_identifier}/actions/${encodeURIComponent(ksuid)}`
      );
    });

    it("should URL-encode ksuid with special characters", async () => {
      const org_identifier = "org123";
      const ksuid = "action/with/slashes";

      mockHttpInstance.get.mockResolvedValue({ data: { id: ksuid } });

      await actions.get_by_id(org_identifier, ksuid);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${org_identifier}/actions/${encodeURIComponent(ksuid)}`
      );
    });

    it("should URL-encode ksuid with spaces", async () => {
      const org_identifier = "org123";
      const ksuid = "action with spaces";

      mockHttpInstance.get.mockResolvedValue({ data: { id: ksuid } });

      await actions.get_by_id(org_identifier, ksuid);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${org_identifier}/actions/action%20with%20spaces`
      );
    });
  });

  describe("delete", () => {
    it("should make DELETE request with encoded action_id", async () => {
      const org_identifier = "org123";
      const action_id = "action-ksuid-1";

      mockHttpInstance.delete.mockResolvedValue({ data: { success: true } });

      await actions.delete(org_identifier, action_id);

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        `/api/${org_identifier}/actions/${encodeURIComponent(action_id)}`
      );
    });

    it("should URL-encode action_id with special characters", async () => {
      const org_identifier = "org123";
      const action_id = "action/special#chars";

      mockHttpInstance.delete.mockResolvedValue({ data: { success: true } });

      await actions.delete(org_identifier, action_id);

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        `/api/${org_identifier}/actions/${encodeURIComponent(action_id)}`
      );
    });
  });

  describe("bulkDelete", () => {
    it("should make DELETE request with data payload for bulk deletion", async () => {
      const org_identifier = "org123";
      const data = { ids: ["action-1", "action-2", "action-3"] };

      mockHttpInstance.delete.mockResolvedValue({ data: { deleted: 3 } });

      await actions.bulkDelete(org_identifier, data);

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        `/api/${org_identifier}/actions/bulk`,
        { data }
      );
    });

    it("should make DELETE request with single-item bulk payload", async () => {
      const org_identifier = "prod-org";
      const data = { ids: ["single-action-id"] };

      mockHttpInstance.delete.mockResolvedValue({ data: { deleted: 1 } });

      await actions.bulkDelete(org_identifier, data);

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        `/api/${org_identifier}/actions/bulk`,
        { data }
      );
    });

    it("should make DELETE request with empty ids array", async () => {
      const org_identifier = "org123";
      const data = { ids: [] };

      mockHttpInstance.delete.mockResolvedValue({ data: { deleted: 0 } });

      await actions.bulkDelete(org_identifier, data);

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        `/api/${org_identifier}/actions/bulk`,
        { data }
      );
    });
  });

  describe("error handling", () => {
    it("should propagate errors from create", async () => {
      const error = new Error("Upload failed");
      mockHttpInstance.post.mockRejectedValue(error);

      await expect(
        actions.create("org123", "", { name: "fail-action" })
      ).rejects.toThrow("Upload failed");
    });

    it("should propagate errors from update", async () => {
      const error = new Error("Not found");
      mockHttpInstance.put.mockRejectedValue(error);

      await expect(
        actions.update("org123", "missing-id", { name: "updated" })
      ).rejects.toThrow("Not found");
    });

    it("should propagate errors from list", async () => {
      const error = new Error("Unauthorized");
      mockHttpInstance.get.mockRejectedValue(error);

      await expect(actions.list("org123")).rejects.toThrow("Unauthorized");
    });

    it("should propagate errors from get_by_id", async () => {
      const error = new Error("Forbidden");
      mockHttpInstance.get.mockRejectedValue(error);

      await expect(
        actions.get_by_id("org123", "some-ksuid")
      ).rejects.toThrow("Forbidden");
    });

    it("should propagate errors from delete", async () => {
      const error = new Error("Server error");
      mockHttpInstance.delete.mockRejectedValue(error);

      await expect(
        actions.delete("org123", "action-id")
      ).rejects.toThrow("Server error");
    });

    it("should propagate errors from bulkDelete", async () => {
      const error = new Error("Bulk delete failed");
      mockHttpInstance.delete.mockRejectedValue(error);

      await expect(
        actions.bulkDelete("org123", { ids: ["a", "b"] })
      ).rejects.toThrow("Bulk delete failed");
    });
  });
});

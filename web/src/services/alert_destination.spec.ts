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
import destination from "@/services/alert_destination";
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

describe("alert_destination service", () => {
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
    it("should make POST request without module query param when module is not provided", async () => {
      const params = {
        org_identifier: "org123",
        destination_name: "slack-dest",
        data: { name: "slack-dest", type: "slack", url: "https://hooks.slack.com/xxx" },
      };

      mockHttpInstance.post.mockResolvedValue({ data: { id: "dest-1" } });

      await destination.create(params);

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/alerts/destinations`,
        params.data
      );
    });

    it("should make POST request with module query param when module is provided", async () => {
      const params = {
        org_identifier: "org123",
        destination_name: "email-dest",
        data: { name: "email-dest", type: "email" },
        module: "alerts",
      };

      mockHttpInstance.post.mockResolvedValue({ data: { id: "dest-2" } });

      await destination.create(params);

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/alerts/destinations?module=${params.module}`,
        params.data
      );
    });

    it("should not append module param when module is an empty string", async () => {
      const params = {
        org_identifier: "org123",
        destination_name: "webhook-dest",
        data: { name: "webhook-dest", type: "webhook" },
        module: "",
      };

      mockHttpInstance.post.mockResolvedValue({ data: { id: "dest-3" } });

      await destination.create(params);

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/alerts/destinations`,
        params.data
      );
    });
  });

  describe("update", () => {
    it("should make PUT request with encoded destination name and no module", async () => {
      const params = {
        org_identifier: "org123",
        destination_name: "slack-dest",
        data: { name: "slack-dest", url: "https://hooks.slack.com/new-url" },
      };

      mockHttpInstance.put.mockResolvedValue({ data: { success: true } });

      await destination.update(params);

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/alerts/destinations/${encodeURIComponent(params.destination_name)}`,
        params.data
      );
    });

    it("should make PUT request with module query param when module is provided", async () => {
      const params = {
        org_identifier: "org123",
        destination_name: "email-dest",
        data: { name: "email-dest", type: "email" },
        module: "alerts",
      };

      mockHttpInstance.put.mockResolvedValue({ data: { success: true } });

      await destination.update(params);

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/alerts/destinations/${encodeURIComponent(params.destination_name)}?module=${params.module}`,
        params.data
      );
    });

    it("should URL-encode destination name with special characters", async () => {
      const params = {
        org_identifier: "org123",
        destination_name: "dest with spaces & symbols",
        data: { name: "dest with spaces & symbols" },
      };

      mockHttpInstance.put.mockResolvedValue({ data: { success: true } });

      await destination.update(params);

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/alerts/destinations/${encodeURIComponent(params.destination_name)}`,
        params.data
      );
    });
  });

  describe("list", () => {
    it("should make GET request with all required params and no module", async () => {
      const params = {
        org_identifier: "org123",
        page_num: 1,
        page_size: 20,
        desc: false,
        sort_by: "name",
      };

      mockHttpInstance.get.mockResolvedValue({ data: { list: [], total: 0 } });

      await destination.list(params);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/alerts/destinations?page_num=${params.page_num}&page_size=${params.page_size}&sort_by=${params.sort_by}&desc=${params.desc}`
      );
    });

    it("should make GET request with module query param appended when module is provided", async () => {
      const params = {
        org_identifier: "org123",
        page_num: 2,
        page_size: 50,
        desc: true,
        sort_by: "created_at",
        module: "alerts",
      };

      mockHttpInstance.get.mockResolvedValue({ data: { list: [], total: 0 } });

      await destination.list(params);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/alerts/destinations?page_num=${params.page_num}&page_size=${params.page_size}&sort_by=${params.sort_by}&desc=${params.desc}&module=${params.module}`
      );
    });

    it("should not append module param when module is an empty string", async () => {
      const params = {
        org_identifier: "org123",
        page_num: 1,
        page_size: 10,
        desc: false,
        sort_by: "name",
        module: "",
      };

      mockHttpInstance.get.mockResolvedValue({ data: { list: [], total: 0 } });

      await destination.list(params);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/alerts/destinations?page_num=${params.page_num}&page_size=${params.page_size}&sort_by=${params.sort_by}&desc=${params.desc}`
      );
    });

    it("should handle desc=true in query string", async () => {
      const params = {
        org_identifier: "my-org",
        page_num: 3,
        page_size: 100,
        desc: true,
        sort_by: "name",
      };

      mockHttpInstance.get.mockResolvedValue({ data: { list: [], total: 0 } });

      await destination.list(params);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/alerts/destinations?page_num=3&page_size=100&sort_by=name&desc=true`
      );
    });
  });

  describe("get_by_name", () => {
    it("should make GET request with encoded destination name", async () => {
      const params = {
        org_identifier: "org123",
        destination_name: "slack-dest",
      };

      mockHttpInstance.get.mockResolvedValue({ data: { name: "slack-dest" } });

      await destination.get_by_name(params);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/alerts/destinations/${encodeURIComponent(params.destination_name)}`
      );
    });

    it("should URL-encode destination name with special characters", async () => {
      const params = {
        org_identifier: "org123",
        destination_name: "my dest/name",
      };

      mockHttpInstance.get.mockResolvedValue({ data: { name: "my dest/name" } });

      await destination.get_by_name(params);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/alerts/destinations/${encodeURIComponent(params.destination_name)}`
      );
    });
  });

  describe("delete", () => {
    it("should make DELETE request with encoded destination name", async () => {
      const params = {
        org_identifier: "org123",
        destination_name: "slack-dest",
      };

      mockHttpInstance.delete.mockResolvedValue({ data: { success: true } });

      await destination.delete(params);

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/alerts/destinations/${encodeURIComponent(params.destination_name)}`
      );
    });

    it("should URL-encode destination name with spaces", async () => {
      const params = {
        org_identifier: "org123",
        destination_name: "my slack destination",
      };

      mockHttpInstance.delete.mockResolvedValue({ data: { success: true } });

      await destination.delete(params);

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/alerts/destinations/my%20slack%20destination`
      );
    });
  });

  describe("bulkDelete", () => {
    it("should make DELETE request with data payload for bulk deletion", async () => {
      const org_identifier = "org123";
      const data = { names: ["dest-1", "dest-2", "dest-3"] };

      mockHttpInstance.delete.mockResolvedValue({ data: { deleted: 3 } });

      await destination.bulkDelete(org_identifier, data);

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        `/api/${org_identifier}/alerts/destinations/bulk`,
        { data }
      );
    });

    it("should make DELETE request with single-item bulk payload", async () => {
      const org_identifier = "prod-org";
      const data = { names: ["only-one-dest"] };

      mockHttpInstance.delete.mockResolvedValue({ data: { deleted: 1 } });

      await destination.bulkDelete(org_identifier, data);

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        `/api/${org_identifier}/alerts/destinations/bulk`,
        { data }
      );
    });
  });

  describe("test", () => {
    it("should make POST request to test destination", async () => {
      const params = {
        org_identifier: "org123",
        data: {
          name: "slack-dest",
          type: "slack",
          url: "https://hooks.slack.com/xxx",
        },
      };

      mockHttpInstance.post.mockResolvedValue({ data: { success: true } });

      await destination.test(params);

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/alerts/destinations/test`,
        params.data
      );
    });

    it("should make POST request to test email destination", async () => {
      const params = {
        org_identifier: "my-org",
        data: {
          name: "email-dest",
          type: "email",
          recipients: ["admin@example.com"],
        },
      };

      mockHttpInstance.post.mockResolvedValue({ data: { success: true } });

      await destination.test(params);

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/alerts/destinations/test`,
        params.data
      );
    });
  });

  describe("error handling", () => {
    it("should propagate errors from create", async () => {
      const error = new Error("Validation error");
      mockHttpInstance.post.mockRejectedValue(error);

      await expect(
        destination.create({ org_identifier: "org123", destination_name: "d1", data: {} })
      ).rejects.toThrow("Validation error");
    });

    it("should propagate errors from update", async () => {
      const error = new Error("Not found");
      mockHttpInstance.put.mockRejectedValue(error);

      await expect(
        destination.update({ org_identifier: "org123", destination_name: "d1", data: {} })
      ).rejects.toThrow("Not found");
    });

    it("should propagate errors from list", async () => {
      const error = new Error("Unauthorized");
      mockHttpInstance.get.mockRejectedValue(error);

      await expect(
        destination.list({ org_identifier: "org123", page_num: 1, page_size: 20, desc: false, sort_by: "name" })
      ).rejects.toThrow("Unauthorized");
    });

    it("should propagate errors from delete", async () => {
      const error = new Error("Forbidden");
      mockHttpInstance.delete.mockRejectedValue(error);

      await expect(
        destination.delete({ org_identifier: "org123", destination_name: "d1" })
      ).rejects.toThrow("Forbidden");
    });

    it("should propagate errors from test", async () => {
      const error = new Error("Connection refused");
      mockHttpInstance.post.mockRejectedValue(error);

      await expect(
        destination.test({ org_identifier: "org123", data: { type: "webhook" } })
      ).rejects.toThrow("Connection refused");
    });
  });
});

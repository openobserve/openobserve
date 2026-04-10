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
import template from "@/services/alert_templates";
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

describe("alert_templates service", () => {
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
    it("should make POST request to create a template", async () => {
      const params = {
        org_identifier: "org123",
        template_name: "slack-template",
        data: {
          name: "slack-template",
          body: "Alert: {alert_name} triggered",
          type: "slack",
        },
      };

      mockHttpInstance.post.mockResolvedValue({ data: { name: "slack-template" } });

      await template.create(params);

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/alerts/templates`,
        params.data
      );
    });

    it("should make POST request with minimal data payload", async () => {
      const params = {
        org_identifier: "my-org",
        template_name: "minimal-template",
        data: { name: "minimal-template" },
      };

      mockHttpInstance.post.mockResolvedValue({ data: { name: "minimal-template" } });

      await template.create(params);

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/alerts/templates`,
        params.data
      );
    });
  });

  describe("update", () => {
    it("should make PUT request with encoded template name", async () => {
      const params = {
        org_identifier: "org123",
        template_name: "slack-template",
        data: {
          name: "slack-template",
          body: "Updated body: {alert_name}",
        },
      };

      mockHttpInstance.put.mockResolvedValue({ data: { success: true } });

      await template.update(params);

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/alerts/templates/${encodeURIComponent(params.template_name)}`,
        params.data
      );
    });

    it("should URL-encode template name with special characters", async () => {
      const params = {
        org_identifier: "org123",
        template_name: "my template/v2",
        data: { name: "my template/v2", body: "body content" },
      };

      mockHttpInstance.put.mockResolvedValue({ data: { success: true } });

      await template.update(params);

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/alerts/templates/${encodeURIComponent(params.template_name)}`,
        params.data
      );
    });

    it("should URL-encode template name with spaces", async () => {
      const params = {
        org_identifier: "org123",
        template_name: "my slack template",
        data: { name: "my slack template" },
      };

      mockHttpInstance.put.mockResolvedValue({ data: { success: true } });

      await template.update(params);

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/alerts/templates/my%20slack%20template`,
        params.data
      );
    });
  });

  describe("list", () => {
    it("should make GET request to list all templates for an org", async () => {
      const params = { org_identifier: "org123" };

      mockHttpInstance.get.mockResolvedValue({ data: { list: [] } });

      await template.list(params);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/alerts/templates`
      );
    });

    it("should make GET request with a different org identifier", async () => {
      const params = { org_identifier: "prod-org" };

      mockHttpInstance.get.mockResolvedValue({
        data: {
          list: [
            { name: "slack-template", type: "slack" },
            { name: "email-template", type: "email" },
          ],
        },
      });

      await template.list(params);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/alerts/templates`
      );
    });
  });

  describe("get_by_name", () => {
    it("should make GET request with encoded template name", async () => {
      const params = {
        org_identifier: "org123",
        template_name: "slack-template",
      };

      mockHttpInstance.get.mockResolvedValue({ data: { name: "slack-template" } });

      await template.get_by_name(params);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/alerts/templates/${encodeURIComponent(params.template_name)}`
      );
    });

    it("should URL-encode template name with special characters", async () => {
      const params = {
        org_identifier: "org123",
        template_name: "template with spaces & special chars",
      };

      mockHttpInstance.get.mockResolvedValue({ data: { name: "template with spaces & special chars" } });

      await template.get_by_name(params);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/alerts/templates/${encodeURIComponent(params.template_name)}`
      );
    });
  });

  describe("delete", () => {
    it("should make DELETE request with encoded template name", async () => {
      const params = {
        org_identifier: "org123",
        template_name: "slack-template",
      };

      mockHttpInstance.delete.mockResolvedValue({ data: { success: true } });

      await template.delete(params);

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/alerts/templates/${encodeURIComponent(params.template_name)}`
      );
    });

    it("should URL-encode template name with spaces", async () => {
      const params = {
        org_identifier: "org123",
        template_name: "my email template",
      };

      mockHttpInstance.delete.mockResolvedValue({ data: { success: true } });

      await template.delete(params);

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/alerts/templates/my%20email%20template`
      );
    });
  });

  describe("bulkDelete", () => {
    it("should make DELETE request with data payload for bulk deletion", async () => {
      const org_identifier = "org123";
      const data = { names: ["template-1", "template-2"] };

      mockHttpInstance.delete.mockResolvedValue({ data: { deleted: 2 } });

      await template.bulkDelete(org_identifier, data);

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        `/api/${org_identifier}/alerts/templates/bulk`,
        { data }
      );
    });

    it("should make DELETE request with empty names array", async () => {
      const org_identifier = "org123";
      const data = { names: [] };

      mockHttpInstance.delete.mockResolvedValue({ data: { deleted: 0 } });

      await template.bulkDelete(org_identifier, data);

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        `/api/${org_identifier}/alerts/templates/bulk`,
        { data }
      );
    });

    it("should make DELETE request with single-item bulk payload", async () => {
      const org_identifier = "prod-org";
      const data = { names: ["only-one-template"] };

      mockHttpInstance.delete.mockResolvedValue({ data: { deleted: 1 } });

      await template.bulkDelete(org_identifier, data);

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        `/api/${org_identifier}/alerts/templates/bulk`,
        { data }
      );
    });
  });

  describe("get_system_templates", () => {
    it("should make GET request to fetch prebuilt system templates", async () => {
      const params = { org_identifier: "org123" };

      mockHttpInstance.get.mockResolvedValue({
        data: {
          list: [
            { name: "default-slack", type: "slack" },
            { name: "default-email", type: "email" },
          ],
        },
      });

      await template.get_system_templates(params);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/alerts/templates/system/prebuilt`
      );
    });

    it("should make GET request with different org identifier", async () => {
      const params = { org_identifier: "enterprise-org" };

      mockHttpInstance.get.mockResolvedValue({ data: { list: [] } });

      await template.get_system_templates(params);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/alerts/templates/system/prebuilt`
      );
    });
  });

  describe("error handling", () => {
    it("should propagate errors from create", async () => {
      const error = new Error("Validation error");
      mockHttpInstance.post.mockRejectedValue(error);

      await expect(
        template.create({ org_identifier: "org123", template_name: "t1", data: {} })
      ).rejects.toThrow("Validation error");
    });

    it("should propagate errors from update", async () => {
      const error = new Error("Not found");
      mockHttpInstance.put.mockRejectedValue(error);

      await expect(
        template.update({ org_identifier: "org123", template_name: "t1", data: {} })
      ).rejects.toThrow("Not found");
    });

    it("should propagate errors from list", async () => {
      const error = new Error("Unauthorized");
      mockHttpInstance.get.mockRejectedValue(error);

      await expect(
        template.list({ org_identifier: "org123" })
      ).rejects.toThrow("Unauthorized");
    });

    it("should propagate errors from delete", async () => {
      const error = new Error("Forbidden");
      mockHttpInstance.delete.mockRejectedValue(error);

      await expect(
        template.delete({ org_identifier: "org123", template_name: "t1" })
      ).rejects.toThrow("Forbidden");
    });

    it("should propagate errors from get_system_templates", async () => {
      const error = new Error("Server error");
      mockHttpInstance.get.mockRejectedValue(error);

      await expect(
        template.get_system_templates({ org_identifier: "org123" })
      ).rejects.toThrow("Server error");
    });
  });
});

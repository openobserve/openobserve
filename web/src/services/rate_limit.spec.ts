import { describe, expect, it, beforeEach, vi } from "vitest";
import rate_limit from "@/services/rate_limit";
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

describe("rate_limit service", () => {
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

  describe("getApiLimits", () => {
    it("should make GET request with org_id query param", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: {} });

      await rate_limit.getApiLimits("test-org");

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/_meta/ratelimit/module_list?org_id=test-org"
      );
    });

    it("should append interval param when provided", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: {} });

      await rate_limit.getApiLimits("test-org", "1h");

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/_meta/ratelimit/module_list?org_id=test-org&interval=1h"
      );
    });

    it("should use base URL without org_id when org_identifier is empty string", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: {} });

      await rate_limit.getApiLimits("");

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/_meta/ratelimit/module_list"
      );
    });

    it("should not append interval when interval is undefined", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: {} });

      await rate_limit.getApiLimits("my-org", undefined);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/_meta/ratelimit/module_list?org_id=my-org"
      );
    });

    it("should propagate errors", async () => {
      mockHttpInstance.get.mockRejectedValue(new Error("Server error"));

      await expect(rate_limit.getApiLimits("test-org")).rejects.toThrow(
        "Server error"
      );
    });
  });

  describe("getRoleLimits", () => {
    it("should make GET request with role_name and org_id params", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: {} });

      await rate_limit.getRoleLimits("test-org", "admin");

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/_meta/ratelimit/role_list?user_role=admin&org_id=test-org"
      );
    });

    it("should append interval param when provided", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: {} });

      await rate_limit.getRoleLimits("test-org", "viewer", "30m");

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/_meta/ratelimit/role_list?user_role=viewer&org_id=test-org&interval=30m"
      );
    });

    it("should not append interval when interval is undefined", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: {} });

      await rate_limit.getRoleLimits("prod-org", "editor", undefined);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/_meta/ratelimit/role_list?user_role=editor&org_id=prod-org"
      );
    });

    it("should handle different role names", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: {} });

      const roles = ["admin", "viewer", "editor", "super_admin"];
      for (const role of roles) {
        await rate_limit.getRoleLimits("test-org", role);
        expect(mockHttpInstance.get).toHaveBeenCalledWith(
          `/api/_meta/ratelimit/role_list?user_role=${role}&org_id=test-org`
        );
      }
    });

    it("should propagate errors", async () => {
      mockHttpInstance.get.mockRejectedValue(new Error("Unauthorized"));

      await expect(
        rate_limit.getRoleLimits("test-org", "admin")
      ).rejects.toThrow("Unauthorized");
    });
  });

  describe("update_batch", () => {
    it("should make PUT request with update_type when provided", async () => {
      const data = [{ module: "search", limit: 100 }];
      mockHttpInstance.put.mockResolvedValue({ data: {} });

      await rate_limit.update_batch("test-org", data, "module");

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        "/api/_meta/ratelimit/update?update_type=module&org_id=test-org",
        data
      );
    });

    it("should append user_role param when provided", async () => {
      const data = [{ limit: 50 }];
      mockHttpInstance.put.mockResolvedValue({ data: {} });

      await rate_limit.update_batch("test-org", data, "role", "admin");

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        "/api/_meta/ratelimit/update?update_type=role&user_role=admin&org_id=test-org",
        data
      );
    });

    it("should append interval param when provided", async () => {
      const data = [{ limit: 200 }];
      mockHttpInstance.put.mockResolvedValue({ data: {} });

      await rate_limit.update_batch("test-org", data, "role", "admin", "1h");

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        "/api/_meta/ratelimit/update?update_type=role&user_role=admin&org_id=test-org&interval=1h",
        data
      );
    });

    it("should use base URL with only org_id when no optional params provided", async () => {
      const data = [{ limit: 10 }];
      mockHttpInstance.put.mockResolvedValue({ data: {} });

      await rate_limit.update_batch("test-org", data);

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        "/api/_meta/ratelimit/update&org_id=test-org",
        data
      );
    });

    it("should not append org_id when org_identifier is empty string", async () => {
      const data = [{ limit: 10 }];
      mockHttpInstance.put.mockResolvedValue({ data: {} });

      await rate_limit.update_batch("", data, "module");

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        "/api/_meta/ratelimit/update?update_type=module",
        data
      );
    });

    it("should propagate errors", async () => {
      mockHttpInstance.put.mockRejectedValue(new Error("Forbidden"));

      await expect(
        rate_limit.update_batch("test-org", [], "module")
      ).rejects.toThrow("Forbidden");
    });
  });

  describe("download_template", () => {
    it("should make GET request with org_id param", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: {} });

      await rate_limit.download_template("test-org");

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/_meta/ratelimit/download_template?org_id=test-org"
      );
    });

    it("should use base URL without org_id when org_identifier is empty string", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: {} });

      await rate_limit.download_template("");

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/_meta/ratelimit/download_template"
      );
    });

    it("should handle different org identifiers", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: {} });

      const orgs = ["org1", "prod-org", "staging_env"];
      for (const org of orgs) {
        await rate_limit.download_template(org);
        expect(mockHttpInstance.get).toHaveBeenCalledWith(
          `/api/_meta/ratelimit/download_template?org_id=${org}`
        );
      }
    });

    it("should propagate errors", async () => {
      mockHttpInstance.get.mockRejectedValue(new Error("Not found"));

      await expect(rate_limit.download_template("test-org")).rejects.toThrow(
        "Not found"
      );
    });
  });

  describe("upload_template", () => {
    it("should make PUT request with FormData and correct headers", async () => {
      const fileData = [{ module: "search", limit: 100 }];
      mockHttpInstance.put.mockResolvedValue({ data: {} });

      await rate_limit.upload_template("test-org", fileData);

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        "/api/_meta/ratelimit/upload?org_id=test-org",
        expect.any(FormData),
        { headers: { "Content-Type": "multipart/form-data" } }
      );
    });

    it("should append the file as 'rules' field in FormData", async () => {
      const fileData = [{ module: "alerts", limit: 50 }];
      mockHttpInstance.put.mockResolvedValue({ data: {} });

      await rate_limit.upload_template("test-org", fileData);

      const callArgs = mockHttpInstance.put.mock.calls[0];
      const formData: FormData = callArgs[1];
      expect(formData.get("rules")).toBe(JSON.stringify(fileData));
    });

    it("should use base URL without org_id when org_identifier is empty string", async () => {
      const fileData = [{ limit: 10 }];
      mockHttpInstance.put.mockResolvedValue({ data: {} });

      await rate_limit.upload_template("", fileData);

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        "/api/_meta/ratelimit/upload",
        expect.any(FormData),
        { headers: { "Content-Type": "multipart/form-data" } }
      );
    });

    it("should propagate errors", async () => {
      mockHttpInstance.put.mockRejectedValue(new Error("Upload failed"));

      await expect(
        rate_limit.upload_template("test-org", [])
      ).rejects.toThrow("Upload failed");
    });
  });

  describe("getModules", () => {
    it("should make GET request with org_id param", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: {} });

      await rate_limit.getModules("test-org");

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/_meta/ratelimit/api_modules?org_id=test-org"
      );
    });

    it("should use base URL without org_id when org_identifier is empty string", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: {} });

      await rate_limit.getModules("");

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/_meta/ratelimit/api_modules"
      );
    });

    it("should handle different org identifiers", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: {} });

      const orgs = ["org-a", "org_b", "orgC"];
      for (const org of orgs) {
        await rate_limit.getModules(org);
        expect(mockHttpInstance.get).toHaveBeenCalledWith(
          `/api/_meta/ratelimit/api_modules?org_id=${org}`
        );
      }
    });

    it("should propagate errors", async () => {
      mockHttpInstance.get.mockRejectedValue(new Error("Service unavailable"));

      await expect(rate_limit.getModules("test-org")).rejects.toThrow(
        "Service unavailable"
      );
    });
  });
});

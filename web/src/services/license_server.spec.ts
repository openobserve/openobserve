// Copyright 2026 OpenObserve Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { describe, it, expect, vi, beforeEach } from "vitest";
import licenseServer from "./license_server";
import http from "./http";

vi.mock("./http", () => ({
  default: vi.fn(() => ({
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  })),
}));

describe("license_server service", () => {
  let mockHttpInstance: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockHttpInstance = {
      get: vi.fn().mockResolvedValue({ data: { license: "test-license" } }),
      post: vi.fn().mockResolvedValue({ data: { success: true } }),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };
    (http as any).mockReturnValue(mockHttpInstance);
  });

  describe("get_license", () => {
    it("should call GET /api/license", async () => {
      await licenseServer.get_license();

      expect(mockHttpInstance.get).toHaveBeenCalledWith("/api/license");
    });

    it("should call http() with no arguments", async () => {
      await licenseServer.get_license();

      expect(http).toHaveBeenCalledWith();
    });

    it("should return the response from the HTTP GET call", async () => {
      const mockResponse = { data: { license: "active-license-key-abc" } };
      mockHttpInstance.get.mockResolvedValue(mockResponse);

      const result = await licenseServer.get_license();

      expect(result).toEqual(mockResponse);
    });

    it("should call GET exactly once per invocation", async () => {
      await licenseServer.get_license();

      expect(mockHttpInstance.get).toHaveBeenCalledTimes(1);
    });

    it("should not call post, put, patch or delete", async () => {
      await licenseServer.get_license();

      expect(mockHttpInstance.post).not.toHaveBeenCalled();
      expect(mockHttpInstance.put).not.toHaveBeenCalled();
      expect(mockHttpInstance.patch).not.toHaveBeenCalled();
      expect(mockHttpInstance.delete).not.toHaveBeenCalled();
    });

    it("should propagate errors from the HTTP layer", async () => {
      mockHttpInstance.get.mockRejectedValue(new Error("Network error"));

      await expect(licenseServer.get_license()).rejects.toThrow("Network error");
    });

    it("should propagate 404 errors", async () => {
      const notFoundError = { response: { status: 404, data: { error: "Not Found" } } };
      mockHttpInstance.get.mockRejectedValue(notFoundError);

      await expect(licenseServer.get_license()).rejects.toEqual(notFoundError);
    });

    it("should propagate 500 errors", async () => {
      const serverError = { response: { status: 500, data: { error: "Internal Server Error" } } };
      mockHttpInstance.get.mockRejectedValue(serverError);

      await expect(licenseServer.get_license()).rejects.toEqual(serverError);
    });
  });

  describe("update_license", () => {
    it("should call POST /api/license with the license key wrapped in an object", async () => {
      const licenseKey = "new-license-key-12345";

      await licenseServer.update_license(licenseKey);

      expect(mockHttpInstance.post).toHaveBeenCalledWith("/api/license", { key: licenseKey });
    });

    it("should call http() with no arguments", async () => {
      await licenseServer.update_license("some-key");

      expect(http).toHaveBeenCalledWith();
    });

    it("should return the response from the HTTP POST call", async () => {
      const mockResponse = { data: { success: true } };
      mockHttpInstance.post.mockResolvedValue(mockResponse);

      const result = await licenseServer.update_license("test-key");

      expect(result).toEqual(mockResponse);
    });

    it("should call POST exactly once per invocation", async () => {
      await licenseServer.update_license("key-1");

      expect(mockHttpInstance.post).toHaveBeenCalledTimes(1);
    });

    it("should not call get, put, patch or delete", async () => {
      await licenseServer.update_license("test-key");

      expect(mockHttpInstance.get).not.toHaveBeenCalled();
      expect(mockHttpInstance.put).not.toHaveBeenCalled();
      expect(mockHttpInstance.patch).not.toHaveBeenCalled();
      expect(mockHttpInstance.delete).not.toHaveBeenCalled();
    });

    it("should send the key field, not the raw string", async () => {
      const licenseKey = "enterprise-license-xyz-9876";

      await licenseServer.update_license(licenseKey);

      const callArgs = mockHttpInstance.post.mock.calls[0];
      expect(callArgs[1]).toEqual({ key: licenseKey });
      expect(callArgs[1]).not.toBe(licenseKey);
    });

    it("should handle an empty string license key", async () => {
      await licenseServer.update_license("");

      expect(mockHttpInstance.post).toHaveBeenCalledWith("/api/license", { key: "" });
    });

    it("should handle a license key with special characters", async () => {
      const specialKey = "key-with-special-chars_@#$%^&*()!";

      await licenseServer.update_license(specialKey);

      expect(mockHttpInstance.post).toHaveBeenCalledWith("/api/license", { key: specialKey });
    });

    it("should handle a very long license key", async () => {
      const longKey = "a".repeat(1024);

      await licenseServer.update_license(longKey);

      expect(mockHttpInstance.post).toHaveBeenCalledWith("/api/license", { key: longKey });
    });

    it("should propagate errors from the HTTP layer", async () => {
      mockHttpInstance.post.mockRejectedValue(new Error("License update failed"));

      await expect(licenseServer.update_license("bad-key")).rejects.toThrow(
        "License update failed"
      );
    });

    it("should propagate 400 errors", async () => {
      const badRequestError = {
        response: { status: 400, data: { error: "Invalid license key" } },
      };
      mockHttpInstance.post.mockRejectedValue(badRequestError);

      await expect(licenseServer.update_license("invalid")).rejects.toEqual(badRequestError);
    });

    it("should propagate 401 errors", async () => {
      const unauthorizedError = {
        response: { status: 401, data: { error: "Unauthorized" } },
      };
      mockHttpInstance.post.mockRejectedValue(unauthorizedError);

      await expect(licenseServer.update_license("expired-key")).rejects.toEqual(
        unauthorizedError
      );
    });

    it("should always POST to /api/license regardless of key content", async () => {
      const keys = [
        "simple-key",
        "key-with-dashes",
        "key_with_underscores",
        "KEY_UPPERCASE",
        "key123numbers",
        "key with spaces",
      ];

      for (const key of keys) {
        vi.clearAllMocks();
        (http as any).mockReturnValue(mockHttpInstance);

        await licenseServer.update_license(key);

        expect(mockHttpInstance.post).toHaveBeenCalledWith("/api/license", { key });
      }
    });
  });

  describe("integration", () => {
    it("should support calling get_license and update_license independently", async () => {
      await licenseServer.get_license();
      await licenseServer.update_license("new-key");

      expect(mockHttpInstance.get).toHaveBeenCalledTimes(1);
      expect(mockHttpInstance.post).toHaveBeenCalledTimes(1);
      expect(mockHttpInstance.get).toHaveBeenCalledWith("/api/license");
      expect(mockHttpInstance.post).toHaveBeenCalledWith("/api/license", { key: "new-key" });
    });

    it("should create a fresh http instance for each call", async () => {
      await licenseServer.get_license();
      await licenseServer.update_license("another-key");

      expect(http).toHaveBeenCalledTimes(2);
    });
  });
});

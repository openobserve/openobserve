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
import shortURL from "@/services/short_url";
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

describe("short_url service", () => {
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
    it("should make POST request to create a short URL", async () => {
      const org_identifier = "org123";
      const url = "https://example.com/very/long/url?with=params";

      mockHttpInstance.post.mockResolvedValue({ data: { short_id: "abc123" } });

      await shortURL.create(org_identifier, url);

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/${org_identifier}/short`,
        { original_url: url }
      );
    });

    it("should send the url as original_url in the request body", async () => {
      const org_identifier = "my-org";
      const url = "https://openobserve.ai/dashboard?id=123&tab=overview";

      mockHttpInstance.post.mockResolvedValue({ data: { short_id: "xyz789" } });

      await shortURL.create(org_identifier, url);

      const callArgs = mockHttpInstance.post.mock.calls[0];
      expect(callArgs[0]).toBe(`/api/${org_identifier}/short`);
      expect(callArgs[1]).toEqual({ original_url: url });
    });

    it("should use the org_identifier in the URL path", async () => {
      const org_identifier = "production-org";
      const url = "https://example.com/path";

      mockHttpInstance.post.mockResolvedValue({ data: { short_id: "prod01" } });

      await shortURL.create(org_identifier, url);

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/production-org/short`,
        expect.any(Object)
      );
    });
  });

  describe("get", () => {
    it("should make GET request to retrieve a short URL by id", async () => {
      const org_identifier = "org123";
      const id = "abc123";

      mockHttpInstance.get.mockResolvedValue({
        data: { original_url: "https://example.com/very/long/url" },
      });

      await shortURL.get(org_identifier, id);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${org_identifier}/short/${id}?type=ui`
      );
    });

    it("should always append the type=ui query parameter", async () => {
      const org_identifier = "staging-org";
      const id = "xyz789";

      mockHttpInstance.get.mockResolvedValue({ data: { original_url: "https://example.com" } });

      await shortURL.get(org_identifier, id);

      const calledUrl = mockHttpInstance.get.mock.calls[0][0];
      expect(calledUrl).toContain("?type=ui");
    });

    it("should use the org_identifier and id in the URL path", async () => {
      const org_identifier = "prod-org";
      const id = "short-id-001";

      mockHttpInstance.get.mockResolvedValue({ data: {} });

      await shortURL.get(org_identifier, id);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/prod-org/short/short-id-001?type=ui`
      );
    });

    it("should make GET request with different org and id values", async () => {
      const org_identifier = "dev-org";
      const id = "uniqueId42";

      mockHttpInstance.get.mockResolvedValue({ data: { original_url: "https://dev.example.com" } });

      await shortURL.get(org_identifier, id);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/dev-org/short/uniqueId42?type=ui`
      );
    });
  });

  describe("error handling", () => {
    it("should propagate errors from create", async () => {
      const error = new Error("Network error");
      mockHttpInstance.post.mockRejectedValue(error);

      await expect(
        shortURL.create("org123", "https://example.com/url")
      ).rejects.toThrow("Network error");
    });

    it("should propagate errors from get", async () => {
      const error = new Error("Not found");
      mockHttpInstance.get.mockRejectedValue(error);

      await expect(shortURL.get("org123", "missing-id")).rejects.toThrow(
        "Not found"
      );
    });

    it("should propagate server errors from create", async () => {
      const error = new Error("Internal Server Error");
      mockHttpInstance.post.mockRejectedValue(error);

      await expect(
        shortURL.create("org123", "https://example.com")
      ).rejects.toThrow("Internal Server Error");
    });

    it("should propagate unauthorized errors from get", async () => {
      const error = new Error("Unauthorized");
      mockHttpInstance.get.mockRejectedValue(error);

      await expect(shortURL.get("org123", "abc123")).rejects.toThrow(
        "Unauthorized"
      );
    });
  });
});

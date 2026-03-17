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
import regexPatterns from "@/services/regex_pattern";
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

describe("regex_pattern service", () => {
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
    it("should make GET request to list all regex patterns for an org", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: { patterns: [] } });

      await regexPatterns.list("test-org");

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/test-org/re_patterns"
      );
    });

    it("should handle different org identifiers", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: { patterns: [] } });

      const orgs = ["org1", "prod-org", "staging_env", "my.org"];
      for (const org of orgs) {
        await regexPatterns.list(org);
        expect(mockHttpInstance.get).toHaveBeenCalledWith(
          `/api/${org}/re_patterns`
        );
      }
    });

    it("should propagate errors", async () => {
      mockHttpInstance.get.mockRejectedValue(new Error("Unauthorized"));

      await expect(regexPatterns.list("test-org")).rejects.toThrow(
        "Unauthorized"
      );
    });
  });

  describe("create", () => {
    it("should make POST request with pattern payload", async () => {
      const payload = {
        name: "email-pattern",
        pattern: "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}",
        description: "Matches email addresses",
      };
      mockHttpInstance.post.mockResolvedValue({ data: { id: "pat-1" } });

      await regexPatterns.create("test-org", payload);

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        "/api/test-org/re_patterns",
        payload
      );
    });

    it("should handle minimal payload", async () => {
      const payload = {
        name: "simple",
        pattern: ".*",
        description: "",
      };
      mockHttpInstance.post.mockResolvedValue({ data: { id: "pat-2" } });

      await regexPatterns.create("my-org", payload);

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        "/api/my-org/re_patterns",
        payload
      );
    });

    it("should propagate errors", async () => {
      mockHttpInstance.post.mockRejectedValue(new Error("Validation error"));

      await expect(
        regexPatterns.create("test-org", {
          name: "bad",
          pattern: "[invalid",
          description: "",
        })
      ).rejects.toThrow("Validation error");
    });
  });

  describe("update", () => {
    it("should make PUT request with pattern id and payload", async () => {
      const payload = {
        name: "updated-pattern",
        pattern: "\\d+",
        description: "Matches digits",
      };
      mockHttpInstance.put.mockResolvedValue({ data: { success: true } });

      await regexPatterns.update("test-org", "pat-123", payload);

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        "/api/test-org/re_patterns/pat-123",
        payload
      );
    });

    it("should handle different pattern ids", async () => {
      mockHttpInstance.put.mockResolvedValue({ data: { success: true } });

      const ids = ["uuid-1", "pat-abc-def", "123456"];
      for (const id of ids) {
        await regexPatterns.update("test-org", id, {
          name: "x",
          pattern: ".*",
          description: "",
        });
        expect(mockHttpInstance.put).toHaveBeenCalledWith(
          `/api/test-org/re_patterns/${id}`,
          expect.any(Object)
        );
      }
    });

    it("should propagate errors", async () => {
      mockHttpInstance.put.mockRejectedValue(new Error("Not found"));

      await expect(
        regexPatterns.update("test-org", "missing-id", {
          name: "x",
          pattern: ".*",
          description: "",
        })
      ).rejects.toThrow("Not found");
    });
  });

  describe("delete", () => {
    it("should make DELETE request with the correct pattern id", async () => {
      mockHttpInstance.delete.mockResolvedValue({ data: { success: true } });

      await regexPatterns.delete("test-org", "pat-456");

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        "/api/test-org/re_patterns/pat-456"
      );
    });

    it("should handle different org and id combinations", async () => {
      mockHttpInstance.delete.mockResolvedValue({ data: { success: true } });

      await regexPatterns.delete("prod-org", "pattern-xyz");

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        "/api/prod-org/re_patterns/pattern-xyz"
      );
    });

    it("should propagate errors", async () => {
      mockHttpInstance.delete.mockRejectedValue(new Error("Forbidden"));

      await expect(
        regexPatterns.delete("test-org", "locked-pattern")
      ).rejects.toThrow("Forbidden");
    });
  });

  describe("bulkDelete", () => {
    it("should make DELETE request with data payload for bulk deletion", async () => {
      const data = { ids: ["pat-1", "pat-2", "pat-3"] };
      mockHttpInstance.delete.mockResolvedValue({ data: { deleted: 3 } });

      await regexPatterns.bulkDelete("test-org", data);

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        "/api/test-org/re_patterns/bulk",
        { data }
      );
    });

    it("should handle empty data array", async () => {
      const data = { ids: [] };
      mockHttpInstance.delete.mockResolvedValue({ data: { deleted: 0 } });

      await regexPatterns.bulkDelete("test-org", data);

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        "/api/test-org/re_patterns/bulk",
        { data }
      );
    });

    it("should propagate errors", async () => {
      mockHttpInstance.delete.mockRejectedValue(new Error("Partial failure"));

      await expect(
        regexPatterns.bulkDelete("test-org", { ids: ["pat-1"] })
      ).rejects.toThrow("Partial failure");
    });
  });

  describe("test", () => {
    it("should make POST request with pattern and test_records", async () => {
      mockHttpInstance.post.mockResolvedValue({ data: { results: [] } });

      await regexPatterns.test("test-org", "\\d+", ["abc123", "xyz"]);

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        "/api/test-org/re_patterns/test",
        { pattern: "\\d+", test_records: ["abc123", "xyz"] }
      );
    });

    it("should include policy in payload when provided", async () => {
      mockHttpInstance.post.mockResolvedValue({ data: { results: [] } });

      await regexPatterns.test(
        "test-org",
        "[a-z]+",
        ["hello", "world"],
        "extract"
      );

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        "/api/test-org/re_patterns/test",
        { pattern: "[a-z]+", test_records: ["hello", "world"], policy: "extract" }
      );
    });

    it("should not include policy in payload when policy is undefined", async () => {
      mockHttpInstance.post.mockResolvedValue({ data: { results: [] } });

      await regexPatterns.test("test-org", ".*", ["record1"], undefined);

      const callArgs = mockHttpInstance.post.mock.calls[0];
      expect(callArgs[1]).toEqual({
        pattern: ".*",
        test_records: ["record1"],
      });
      expect(callArgs[1]).not.toHaveProperty("policy");
    });

    it("should handle empty test_records array", async () => {
      mockHttpInstance.post.mockResolvedValue({ data: { results: [] } });

      await regexPatterns.test("test-org", ".*", []);

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        "/api/test-org/re_patterns/test",
        { pattern: ".*", test_records: [] }
      );
    });

    it("should propagate errors", async () => {
      mockHttpInstance.post.mockRejectedValue(new Error("Invalid pattern"));

      await expect(
        regexPatterns.test("test-org", "[invalid", ["test"])
      ).rejects.toThrow("Invalid pattern");
    });
  });

  describe("getBuiltInPatterns", () => {
    it("should make GET request without query params when no params provided", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: { patterns: [] } });

      await regexPatterns.getBuiltInPatterns("test-org");

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/test-org/re_patterns/built-in"
      );
    });

    it("should append search query param when search is provided", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: { patterns: [] } });

      await regexPatterns.getBuiltInPatterns("test-org", { search: "email" });

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/test-org/re_patterns/built-in?search=email"
      );
    });

    it("should append multiple tags as separate query params", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: { patterns: [] } });

      await regexPatterns.getBuiltInPatterns("test-org", {
        tags: ["network", "security"],
      });

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/test-org/re_patterns/built-in?tags=network&tags=security"
      );
    });

    it("should combine search and tags params", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: { patterns: [] } });

      await regexPatterns.getBuiltInPatterns("test-org", {
        search: "ip",
        tags: ["network"],
      });

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/test-org/re_patterns/built-in?search=ip&tags=network"
      );
    });

    it("should handle empty params object", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: { patterns: [] } });

      await regexPatterns.getBuiltInPatterns("test-org", {});

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/test-org/re_patterns/built-in"
      );
    });

    it("should propagate errors", async () => {
      mockHttpInstance.get.mockRejectedValue(new Error("Server error"));

      await expect(
        regexPatterns.getBuiltInPatterns("test-org")
      ).rejects.toThrow("Server error");
    });
  });

  describe("error handling", () => {
    it("should propagate network errors from list", async () => {
      mockHttpInstance.get.mockRejectedValue(new Error("Network error"));

      await expect(regexPatterns.list("test-org")).rejects.toThrow(
        "Network error"
      );
    });

    it("should propagate HTTP 403 error from delete", async () => {
      const httpError = {
        response: { status: 403, data: { message: "Forbidden" } },
      };
      mockHttpInstance.delete.mockRejectedValue(httpError);

      await expect(
        regexPatterns.delete("test-org", "pat-1")
      ).rejects.toEqual(httpError);
    });
  });
});

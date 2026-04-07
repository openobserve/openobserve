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
import patterns from "@/services/patterns";
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

describe("patterns service", () => {
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

  describe("extractPatterns", () => {
    it("should make POST request to extract patterns with correct URL", async () => {
      const params = {
        org_identifier: "org123",
        stream_name: "my-logs",
        query: { query: { sql: "SELECT * FROM logs", start_time: 1000, end_time: 2000 } },
      };

      mockHttpInstance.post.mockResolvedValue({ data: { patterns: [] } });

      await patterns.extractPatterns(params);

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/streams/${params.stream_name}/patterns/extract`,
        params.query
      );
    });

    it("should use the correct URL pattern with org_identifier and stream_name", async () => {
      const params = {
        org_identifier: "production-org",
        stream_name: "application-logs",
        query: { sql: "SELECT * FROM application-logs" },
      };

      mockHttpInstance.post.mockResolvedValue({ data: { patterns: ["ERROR .*", "WARN .*"] } });

      await patterns.extractPatterns(params);

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/production-org/streams/application-logs/patterns/extract`,
        params.query
      );
    });

    it("should pass the query object as the POST body", async () => {
      const params = {
        org_identifier: "org123",
        stream_name: "nginx-access",
        query: {
          query: {
            sql: "SELECT * FROM nginx-access WHERE status=500",
            start_time: 1700000000000000,
            end_time: 1700003600000000,
            size: 100,
          },
        },
      };

      mockHttpInstance.post.mockResolvedValue({ data: {} });

      await patterns.extractPatterns(params);

      const callArgs = mockHttpInstance.post.mock.calls[0];
      expect(callArgs[1]).toEqual(params.query);
    });

    it("should work with different org and stream name combinations", async () => {
      const params = {
        org_identifier: "staging",
        stream_name: "k8s-events",
        query: { sql: "SELECT * FROM k8s-events" },
      };

      mockHttpInstance.post.mockResolvedValue({ data: { patterns: ["Pod .* started"] } });

      await patterns.extractPatterns(params);

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/staging/streams/k8s-events/patterns/extract`,
        params.query
      );
    });

    it("should pass an empty query object when query is empty", async () => {
      const params = {
        org_identifier: "org123",
        stream_name: "default",
        query: {},
      };

      mockHttpInstance.post.mockResolvedValue({ data: { patterns: [] } });

      await patterns.extractPatterns(params);

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/org123/streams/default/patterns/extract`,
        {}
      );
    });
  });

  describe("error handling", () => {
    it("should propagate errors from extractPatterns", async () => {
      const error = new Error("Network error");
      mockHttpInstance.post.mockRejectedValue(error);

      await expect(
        patterns.extractPatterns({
          org_identifier: "org123",
          stream_name: "my-logs",
          query: {},
        })
      ).rejects.toThrow("Network error");
    });

    it("should propagate validation errors from extractPatterns", async () => {
      const error = new Error("Validation error");
      mockHttpInstance.post.mockRejectedValue(error);

      await expect(
        patterns.extractPatterns({
          org_identifier: "org123",
          stream_name: "my-logs",
          query: { invalid: "query" },
        })
      ).rejects.toThrow("Validation error");
    });

    it("should propagate not found errors from extractPatterns", async () => {
      const error = new Error("Stream not found");
      mockHttpInstance.post.mockRejectedValue(error);

      await expect(
        patterns.extractPatterns({
          org_identifier: "org123",
          stream_name: "nonexistent-stream",
          query: {},
        })
      ).rejects.toThrow("Stream not found");
    });
  });
});

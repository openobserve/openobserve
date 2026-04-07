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
import nativeQueries from "@/services/nativequery";
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

describe("nativequery service", () => {
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

  describe("runquery", () => {
    it("should make POST request to run a native query", async () => {
      const organization = "org123";
      const data = {
        query: {
          sql: "SELECT * FROM logs",
          start_time: 1700000000000000,
          end_time: 1700003600000000,
          size: 100,
        },
      };

      mockHttpInstance.post.mockResolvedValue({ data: { hits: [], total: 0 } });

      await nativeQueries.runquery(data, organization);

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/${organization}/_search`,
        data
      );
    });

    it("should use the organization in the URL path", async () => {
      const organization = "production-org";
      const data = { query: { sql: "SELECT count(*) FROM metrics" } };

      mockHttpInstance.post.mockResolvedValue({ data: { hits: [] } });

      await nativeQueries.runquery(data, organization);

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/production-org/_search`,
        data
      );
    });

    it("should send the data object as the POST body", async () => {
      const organization = "staging-org";
      const data = {
        query: {
          sql: "SELECT * FROM traces WHERE duration > 1000",
          start_time: 1700000000000000,
          end_time: 1700003600000000,
          size: 50,
          from: 0,
        },
      };

      mockHttpInstance.post.mockResolvedValue({ data: {} });

      await nativeQueries.runquery(data, organization);

      const callArgs = mockHttpInstance.post.mock.calls[0];
      expect(callArgs[1]).toEqual(data);
    });

    it("should work with different data and organization combinations", async () => {
      const organization = "dev-org";
      const data = {
        query: { sql: "SELECT field1, field2 FROM stream_name" },
        aggs: { count: "SELECT histogram(1m) FROM stream_name" },
      };

      mockHttpInstance.post.mockResolvedValue({ data: { hits: [{ field1: "val1" }], total: 1 } });

      await nativeQueries.runquery(data, organization);

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/dev-org/_search`,
        data
      );
    });

    it("should work with an empty data object", async () => {
      const organization = "org123";
      const data = {};

      mockHttpInstance.post.mockResolvedValue({ data: { hits: [] } });

      await nativeQueries.runquery(data, organization);

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/org123/_search`,
        {}
      );
    });
  });

  describe("error handling", () => {
    it("should propagate errors from runquery", async () => {
      const error = new Error("Network error");
      mockHttpInstance.post.mockRejectedValue(error);

      await expect(
        nativeQueries.runquery({ query: { sql: "SELECT *" } }, "org123")
      ).rejects.toThrow("Network error");
    });

    it("should propagate invalid query errors from runquery", async () => {
      const error = new Error("Invalid SQL query");
      mockHttpInstance.post.mockRejectedValue(error);

      await expect(
        nativeQueries.runquery({ query: { sql: "INVALID QUERY" } }, "org123")
      ).rejects.toThrow("Invalid SQL query");
    });

    it("should propagate unauthorized errors from runquery", async () => {
      const error = new Error("Unauthorized");
      mockHttpInstance.post.mockRejectedValue(error);

      await expect(
        nativeQueries.runquery({}, "org123")
      ).rejects.toThrow("Unauthorized");
    });
  });
});

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
import indexService from "./index";
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

describe("index service", () => {
  let mockHttpInstance: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockHttpInstance = {
      get: vi.fn().mockResolvedValue({ data: {} }),
      post: vi.fn().mockResolvedValue({ data: {} }),
      put: vi.fn().mockResolvedValue({ data: {} }),
      patch: vi.fn(),
      delete: vi.fn(),
    };
    (http as any).mockReturnValue(mockHttpInstance);
  });

  describe("nameList", () => {
    it("should call GET /api/{org}/streams with no query params when type is empty and schema is false", async () => {
      await indexService.nameList("test-org", "", false);

      expect(mockHttpInstance.get).toHaveBeenCalledWith("/api/test-org/streams");
    });

    it("should append ?type= when type is non-empty", async () => {
      await indexService.nameList("test-org", "logs", false);

      expect(mockHttpInstance.get).toHaveBeenCalledWith("/api/test-org/streams?type=logs");
    });

    it("should append ?fetchSchema= when schema is true and type is empty", async () => {
      await indexService.nameList("test-org", "", true);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/test-org/streams?fetchSchema=true"
      );
    });

    it("should append both type and fetchSchema when both are provided", async () => {
      await indexService.nameList("test-org", "metrics", true);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/test-org/streams?type=metrics&fetchSchema=true"
      );
    });

    it("should use & separator for fetchSchema when type is already in the URL", async () => {
      await indexService.nameList("my-org", "traces", true);

      const url = mockHttpInstance.get.mock.calls[0][0];
      expect(url).toContain("?type=traces");
      expect(url).toContain("&fetchSchema=true");
      expect(url).not.toContain("?fetchSchema=true");
    });

    it("should use ? separator for fetchSchema when type is empty", async () => {
      await indexService.nameList("my-org", "", true);

      const url = mockHttpInstance.get.mock.calls[0][0];
      expect(url).toContain("?fetchSchema=true");
      expect(url).not.toContain("&fetchSchema=true");
    });

    it("should handle different stream types", async () => {
      const types = ["logs", "metrics", "traces", "enrichment_tables", "index"];

      for (const type of types) {
        vi.clearAllMocks();
        (http as any).mockReturnValue(mockHttpInstance);

        await indexService.nameList("test-org", type, false);

        expect(mockHttpInstance.get).toHaveBeenCalledWith(
          `/api/test-org/streams?type=${type}`
        );
      }
    });

    it("should handle different org identifiers", async () => {
      const orgs = [
        "simple-org",
        "org-with-dashes",
        "org_with_underscores",
        "production.env",
        "12345",
        "ORG-UPPERCASE",
      ];

      for (const org of orgs) {
        vi.clearAllMocks();
        (http as any).mockReturnValue(mockHttpInstance);

        await indexService.nameList(org, "logs", false);

        expect(mockHttpInstance.get).toHaveBeenCalledWith(
          `/api/${org}/streams?type=logs`
        );
      }
    });

    it("should not call post, put, patch, or delete", async () => {
      await indexService.nameList("test-org", "logs", false);

      expect(mockHttpInstance.post).not.toHaveBeenCalled();
      expect(mockHttpInstance.put).not.toHaveBeenCalled();
      expect(mockHttpInstance.patch).not.toHaveBeenCalled();
      expect(mockHttpInstance.delete).not.toHaveBeenCalled();
    });

    it("should return the HTTP response", async () => {
      const mockResponse = { data: { list: [{ name: "my-stream" }] } };
      mockHttpInstance.get.mockResolvedValue(mockResponse);

      const result = await indexService.nameList("test-org", "logs", false);

      expect(result).toEqual(mockResponse);
    });

    it("should propagate HTTP errors", async () => {
      mockHttpInstance.get.mockRejectedValue(new Error("Network error"));

      await expect(indexService.nameList("test-org", "logs", false)).rejects.toThrow(
        "Network error"
      );
    });
  });

  describe("schema", () => {
    it("should call GET /api/{org}/{stream}/schema with no query params when type is empty", async () => {
      await indexService.schema("test-org", "my-stream", "");

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/test-org/my-stream/schema"
      );
    });

    it("should append ?type= when type is non-empty", async () => {
      await indexService.schema("test-org", "my-stream", "logs");

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/test-org/my-stream/schema?type=logs"
      );
    });

    it("should handle different stream types", async () => {
      const types = ["logs", "metrics", "traces", "enrichment_tables"];

      for (const type of types) {
        vi.clearAllMocks();
        (http as any).mockReturnValue(mockHttpInstance);

        await indexService.schema("test-org", "my-stream", type);

        expect(mockHttpInstance.get).toHaveBeenCalledWith(
          `/api/test-org/my-stream/schema?type=${type}`
        );
      }
    });

    it("should handle different org and stream name combinations", async () => {
      const testCases = [
        { org: "prod-org", stream: "access-logs" },
        { org: "dev", stream: "errors_stream" },
        { org: "staging.env", stream: "trace_data" },
        { org: "12345", stream: "metrics_stream" },
      ];

      for (const { org, stream } of testCases) {
        vi.clearAllMocks();
        (http as any).mockReturnValue(mockHttpInstance);

        await indexService.schema(org, stream, "logs");

        expect(mockHttpInstance.get).toHaveBeenCalledWith(
          `/api/${org}/${stream}/schema?type=logs`
        );
      }
    });

    it("should not call post, put, patch, or delete", async () => {
      await indexService.schema("test-org", "my-stream", "logs");

      expect(mockHttpInstance.post).not.toHaveBeenCalled();
      expect(mockHttpInstance.put).not.toHaveBeenCalled();
      expect(mockHttpInstance.patch).not.toHaveBeenCalled();
      expect(mockHttpInstance.delete).not.toHaveBeenCalled();
    });

    it("should return the HTTP response", async () => {
      const mockResponse = { data: { fields: [{ name: "_timestamp", type: "Int64" }] } };
      mockHttpInstance.get.mockResolvedValue(mockResponse);

      const result = await indexService.schema("test-org", "my-stream", "logs");

      expect(result).toEqual(mockResponse);
    });

    it("should propagate HTTP errors", async () => {
      mockHttpInstance.get.mockRejectedValue(new Error("Stream not found"));

      await expect(indexService.schema("test-org", "missing-stream", "logs")).rejects.toThrow(
        "Stream not found"
      );
    });

    it("should propagate 404 errors", async () => {
      const notFoundError = { response: { status: 404, data: { error: "Stream not found" } } };
      mockHttpInstance.get.mockRejectedValue(notFoundError);

      await expect(
        indexService.schema("test-org", "missing-stream", "logs")
      ).rejects.toEqual(notFoundError);
    });
  });

  describe("updateSettings", () => {
    it("should call PUT /api/{org}/streams/{stream}/settings with no query params when type is empty", async () => {
      const data = { partitions: [{ field: "log_level" }] };

      await indexService.updateSettings("test-org", "my-stream", "", data);

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        "/api/test-org/streams/my-stream/settings",
        data
      );
    });

    it("should append ?type= when type is non-empty", async () => {
      const data = { partitions: [] };

      await indexService.updateSettings("test-org", "my-stream", "logs", data);

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        "/api/test-org/streams/my-stream/settings?type=logs",
        data
      );
    });

    it("should pass the data payload as the request body", async () => {
      const data = {
        partitions: [{ field: "service" }, { field: "region" }],
        bloom_filter_fields: ["trace_id", "span_id"],
        full_text_search_keys: ["message", "log_level"],
      };

      await indexService.updateSettings("test-org", "my-stream", "logs", data);

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        "/api/test-org/streams/my-stream/settings?type=logs",
        data
      );
    });

    it("should handle different stream types", async () => {
      const types = ["logs", "metrics", "traces", "enrichment_tables"];
      const data = { partitions: [] };

      for (const type of types) {
        vi.clearAllMocks();
        (http as any).mockReturnValue(mockHttpInstance);

        await indexService.updateSettings("test-org", "my-stream", type, data);

        expect(mockHttpInstance.put).toHaveBeenCalledWith(
          `/api/test-org/streams/my-stream/settings?type=${type}`,
          data
        );
      }
    });

    it("should handle different org and stream name combinations", async () => {
      const testCases = [
        { org: "prod-org", stream: "access-logs" },
        { org: "dev", stream: "errors_stream" },
        { org: "staging.env", stream: "trace_data" },
      ];
      const data = { full_text_search_keys: ["message"] };

      for (const { org, stream } of testCases) {
        vi.clearAllMocks();
        (http as any).mockReturnValue(mockHttpInstance);

        await indexService.updateSettings(org, stream, "logs", data);

        expect(mockHttpInstance.put).toHaveBeenCalledWith(
          `/api/${org}/streams/${stream}/settings?type=logs`,
          data
        );
      }
    });

    it("should not call get, post, patch, or delete", async () => {
      await indexService.updateSettings("test-org", "my-stream", "logs", {});

      expect(mockHttpInstance.get).not.toHaveBeenCalled();
      expect(mockHttpInstance.post).not.toHaveBeenCalled();
      expect(mockHttpInstance.patch).not.toHaveBeenCalled();
      expect(mockHttpInstance.delete).not.toHaveBeenCalled();
    });

    it("should return the HTTP response", async () => {
      const mockResponse = { data: { message: "Settings updated successfully" } };
      mockHttpInstance.put.mockResolvedValue(mockResponse);

      const result = await indexService.updateSettings("test-org", "my-stream", "logs", {});

      expect(result).toEqual(mockResponse);
    });

    it("should handle empty data object", async () => {
      await indexService.updateSettings("test-org", "my-stream", "logs", {});

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        "/api/test-org/streams/my-stream/settings?type=logs",
        {}
      );
    });

    it("should propagate HTTP errors", async () => {
      mockHttpInstance.put.mockRejectedValue(new Error("Settings update failed"));

      await expect(
        indexService.updateSettings("test-org", "my-stream", "logs", {})
      ).rejects.toThrow("Settings update failed");
    });

    it("should propagate 400 errors for invalid settings", async () => {
      const badRequestError = {
        response: { status: 400, data: { error: "Invalid partition field" } },
      };
      mockHttpInstance.put.mockRejectedValue(badRequestError);

      await expect(
        indexService.updateSettings("test-org", "my-stream", "logs", { partitions: [{ field: "" }] })
      ).rejects.toEqual(badRequestError);
    });
  });

  describe("integration", () => {
    it("should support a full stream management workflow", async () => {
      await indexService.nameList("prod-org", "logs", false);
      await indexService.schema("prod-org", "app-logs", "logs");
      await indexService.updateSettings("prod-org", "app-logs", "logs", {
        full_text_search_keys: ["message"],
      });

      expect(mockHttpInstance.get).toHaveBeenNthCalledWith(
        1,
        "/api/prod-org/streams?type=logs"
      );
      expect(mockHttpInstance.get).toHaveBeenNthCalledWith(
        2,
        "/api/prod-org/app-logs/schema?type=logs"
      );
      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        "/api/prod-org/streams/app-logs/settings?type=logs",
        { full_text_search_keys: ["message"] }
      );
    });

    it("should create a fresh http instance for each method call", async () => {
      await indexService.nameList("test-org", "logs", false);
      await indexService.schema("test-org", "stream", "logs");
      await indexService.updateSettings("test-org", "stream", "logs", {});

      expect(http).toHaveBeenCalledTimes(3);
    });
  });
});

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
import jstransform from "@/services/jstransform";
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

describe("jstransform service", () => {
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
    it("should make GET request to list functions with all query parameters", async () => {
      const params = {
        page_num: 1,
        page_size: 20,
        sort_by: "name",
        desc: false,
        name: "my-function",
        org_identifier: "org123",
      };

      mockHttpInstance.get.mockResolvedValue({ data: { list: [] } });

      await jstransform.list(
        params.page_num,
        params.page_size,
        params.sort_by,
        params.desc,
        params.name,
        params.org_identifier
      );

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/functions?page_num=${params.page_num}&page_size=${params.page_size}&sort_by=${params.sort_by}&desc=${params.desc}&name=${params.name}`
      );
    });

    it("should include all pagination and sorting parameters in the URL", async () => {
      const params = {
        page_num: 2,
        page_size: 50,
        sort_by: "created_at",
        desc: true,
        name: "",
        org_identifier: "production-org",
      };

      mockHttpInstance.get.mockResolvedValue({ data: { list: [] } });

      await jstransform.list(
        params.page_num,
        params.page_size,
        params.sort_by,
        params.desc,
        params.name,
        params.org_identifier
      );

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/production-org/functions?page_num=2&page_size=50&sort_by=created_at&desc=true&name=`
      );
    });
  });

  describe("create", () => {
    it("should make POST request to create a function", async () => {
      const org_identifier = "org123";
      const data = {
        name: "my-function",
        function: ".field = \"value\"",
        order: 1,
      };

      mockHttpInstance.post.mockResolvedValue({ data: { id: "fn-new-1" } });

      await jstransform.create(org_identifier, data);

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/${org_identifier}/functions`,
        data
      );
    });

    it("should pass the function data as the POST body", async () => {
      const org_identifier = "staging-org";
      const data = { name: "transform-fn", function: ".status = \"ok\"" };

      mockHttpInstance.post.mockResolvedValue({ data: {} });

      await jstransform.create(org_identifier, data);

      const callArgs = mockHttpInstance.post.mock.calls[0];
      expect(callArgs[1]).toEqual(data);
    });
  });

  describe("getAssociatedPipelines", () => {
    it("should make GET request to fetch pipelines associated with a function", async () => {
      const org_identifier = "org123";
      const name = "my-function";

      mockHttpInstance.get.mockResolvedValue({ data: { pipelines: [] } });

      await jstransform.getAssociatedPipelines(org_identifier, name);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${org_identifier}/functions/${name}`
      );
    });

    it("should use function name in the URL path", async () => {
      const org_identifier = "prod-org";
      const name = "log-enrichment-fn";

      mockHttpInstance.get.mockResolvedValue({ data: {} });

      await jstransform.getAssociatedPipelines(org_identifier, name);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/prod-org/functions/log-enrichment-fn`
      );
    });
  });

  describe("update", () => {
    it("should make PUT request to update a function using data.name in the URL", async () => {
      const org_identifier = "org123";
      const data = {
        name: "existing-function",
        function: ".new_field = \"new_value\"",
      };

      mockHttpInstance.put.mockResolvedValue({ data: { success: true } });

      await jstransform.update(org_identifier, data);

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        `/api/${org_identifier}/functions/${data.name}`,
        data
      );
    });

    it("should derive the URL path from data.name", async () => {
      const org_identifier = "staging-org";
      const data = { name: "transform-v2", function: ".updated = true" };

      mockHttpInstance.put.mockResolvedValue({ data: {} });

      await jstransform.update(org_identifier, data);

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        `/api/staging-org/functions/transform-v2`,
        data
      );
    });
  });

  describe("delete", () => {
    it("should make DELETE request without force parameter by default", async () => {
      const org_identifier = "org123";
      const transform_name = "my-function";

      mockHttpInstance.delete.mockResolvedValue({ data: { success: true } });

      await jstransform.delete(org_identifier, transform_name);

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        `/api/${org_identifier}/functions/${transform_name}`,
        {}
      );
    });

    it("should include force=true in params when force is true", async () => {
      const org_identifier = "org123";
      const transform_name = "my-function";
      const force = true;

      mockHttpInstance.delete.mockResolvedValue({ data: { success: true } });

      await jstransform.delete(org_identifier, transform_name, force);

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        `/api/${org_identifier}/functions/${transform_name}`,
        { params: { force: true } }
      );
    });

    it("should pass empty config when force is false", async () => {
      const org_identifier = "org123";
      const transform_name = "my-function";
      const force = false;

      mockHttpInstance.delete.mockResolvedValue({ data: {} });

      await jstransform.delete(org_identifier, transform_name, force);

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        `/api/${org_identifier}/functions/${transform_name}`,
        {}
      );
    });
  });

  describe("bulkDelete", () => {
    it("should make DELETE request to bulk delete functions", async () => {
      const org_identifier = "org123";
      const data = { function_names: ["fn1", "fn2", "fn3"] };

      mockHttpInstance.delete.mockResolvedValue({ data: { success: true } });

      await jstransform.bulkDelete(org_identifier, data);

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        `/api/${org_identifier}/functions/bulk`,
        { data }
      );
    });

    it("should wrap the data in a data property for the DELETE config", async () => {
      const org_identifier = "staging-org";
      const data = { function_names: ["fn-abc"] };

      mockHttpInstance.delete.mockResolvedValue({ data: {} });

      await jstransform.bulkDelete(org_identifier, data);

      const callArgs = mockHttpInstance.delete.mock.calls[0];
      expect(callArgs[1]).toEqual({ data });
    });
  });

  describe("create_with_index", () => {
    it("should make PUT request to associate a function with a stream", async () => {
      const org_identifier = "org123";
      const stream_name = "my-stream";
      const stream_type = "logs";
      const data = { name: "my-function", function: ".field = \"value\"" };

      mockHttpInstance.put.mockResolvedValue({ data: { success: true } });

      await jstransform.create_with_index(org_identifier, stream_name, stream_type, data);

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        `/api/${org_identifier}/${stream_name}/functions/${data.name}?type=${stream_type}`,
        data
      );
    });

    it("should include the stream_type as a query parameter", async () => {
      const org_identifier = "prod-org";
      const stream_name = "metrics-stream";
      const stream_type = "metrics";
      const data = { name: "metrics-transform", function: ".metric = \"value\"" };

      mockHttpInstance.put.mockResolvedValue({ data: {} });

      await jstransform.create_with_index(org_identifier, stream_name, stream_type, data);

      const calledUrl = mockHttpInstance.put.mock.calls[0][0];
      expect(calledUrl).toContain(`?type=${stream_type}`);
    });

    it("should use data.name in the URL path", async () => {
      const org_identifier = "org123";
      const stream_name = "trace-stream";
      const stream_type = "traces";
      const data = { name: "trace-enrichment", function: ".trace_id = \"value\"" };

      mockHttpInstance.put.mockResolvedValue({ data: {} });

      await jstransform.create_with_index(org_identifier, stream_name, stream_type, data);

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        `/api/org123/trace-stream/functions/trace-enrichment?type=traces`,
        data
      );
    });
  });

  describe("delete_stream_function", () => {
    it("should make DELETE request to remove a function from a stream", async () => {
      const org_identifier = "org123";
      const stream_name = "my-stream";
      const stream_type = "logs";
      const transform_name = "my-function";

      mockHttpInstance.delete.mockResolvedValue({ data: { success: true } });

      await jstransform.delete_stream_function(org_identifier, stream_name, stream_type, transform_name);

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        `/api/${org_identifier}/${stream_name}/functions/${transform_name}?type=${stream_type}`
      );
    });

    it("should include stream_type as a query parameter", async () => {
      const org_identifier = "staging-org";
      const stream_name = "events-stream";
      const stream_type = "metrics";
      const transform_name = "events-transform";

      mockHttpInstance.delete.mockResolvedValue({ data: {} });

      await jstransform.delete_stream_function(org_identifier, stream_name, stream_type, transform_name);

      const calledUrl = mockHttpInstance.delete.mock.calls[0][0];
      expect(calledUrl).toContain(`?type=${stream_type}`);
    });
  });

  describe("stream_function", () => {
    it("should make GET request to list functions for a stream", async () => {
      const org_identifier = "org123";
      const stream_name = "my-stream";
      const stream_type = "logs";

      mockHttpInstance.get.mockResolvedValue({ data: { functions: [] } });

      await jstransform.stream_function(org_identifier, stream_name, stream_type);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${org_identifier}/streams/${stream_name}/functions?type=${stream_type}`
      );
    });

    it("should use the correct URL structure with streams path", async () => {
      const org_identifier = "prod-org";
      const stream_name = "application-logs";
      const stream_type = "logs";

      mockHttpInstance.get.mockResolvedValue({ data: {} });

      await jstransform.stream_function(org_identifier, stream_name, stream_type);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/prod-org/streams/application-logs/functions?type=logs`
      );
    });
  });

  describe("apply_stream_function", () => {
    it("should make PUT request to apply a function to a stream", async () => {
      const org_identifier = "org123";
      const stream_name = "my-stream";
      const stream_type = "logs";
      const function_name = "my-function";
      const data = { order: 1, is_applicable: true };

      mockHttpInstance.put.mockResolvedValue({ data: { success: true } });

      await jstransform.apply_stream_function(org_identifier, stream_name, stream_type, function_name, data);

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        `/api/${org_identifier}/streams/${stream_name}/functions/${function_name}?type=${stream_type}`,
        data
      );
    });

    it("should include stream_type as a query parameter and function_name in path", async () => {
      const org_identifier = "staging-org";
      const stream_name = "traces-stream";
      const stream_type = "traces";
      const function_name = "trace-transform";
      const data = { order: 2 };

      mockHttpInstance.put.mockResolvedValue({ data: {} });

      await jstransform.apply_stream_function(org_identifier, stream_name, stream_type, function_name, data);

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        `/api/staging-org/streams/traces-stream/functions/trace-transform?type=traces`,
        data
      );
    });
  });

  describe("remove_stream_function", () => {
    it("should make DELETE request to remove a function from a stream via streams path", async () => {
      const org_identifier = "org123";
      const stream_name = "my-stream";
      const stream_type = "logs";
      const function_name = "my-function";

      mockHttpInstance.delete.mockResolvedValue({ data: { success: true } });

      await jstransform.remove_stream_function(org_identifier, stream_name, stream_type, function_name);

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        `/api/${org_identifier}/streams/${stream_name}/functions/${function_name}?type=${stream_type}`
      );
    });

    it("should use the streams path (not the stream_name directly in path)", async () => {
      const org_identifier = "prod-org";
      const stream_name = "k8s-logs";
      const stream_type = "logs";
      const function_name = "k8s-transform";

      mockHttpInstance.delete.mockResolvedValue({ data: {} });

      await jstransform.remove_stream_function(org_identifier, stream_name, stream_type, function_name);

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        `/api/prod-org/streams/k8s-logs/functions/k8s-transform?type=logs`
      );
    });
  });

  describe("create_enrichment_table", () => {
    it("should make POST request with multipart/form-data content type", async () => {
      const org_identifier = "org123";
      const table_name = "my-enrichment-table";
      const data = new FormData();
      const append = false;

      mockHttpInstance.post.mockResolvedValue({ data: { success: true } });

      await jstransform.create_enrichment_table(org_identifier, table_name, data, append);

      expect(http).toHaveBeenCalledWith({ headers: { "Content-Type": "multipart/form-data" } });
      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/${org_identifier}/enrichment_tables/${table_name}?append=${append}`,
        data
      );
    });

    it("should include append=true query parameter when append is true", async () => {
      const org_identifier = "staging-org";
      const table_name = "geo-data-table";
      const data = new FormData();
      const append = true;

      mockHttpInstance.post.mockResolvedValue({ data: {} });

      await jstransform.create_enrichment_table(org_identifier, table_name, data, append);

      const calledUrl = mockHttpInstance.post.mock.calls[0][0];
      expect(calledUrl).toContain(`?append=true`);
    });

    it("should use the table_name in the URL path", async () => {
      const org_identifier = "org123";
      const table_name = "ip-lookup-table";
      const data = new FormData();
      const append = false;

      mockHttpInstance.post.mockResolvedValue({ data: {} });

      await jstransform.create_enrichment_table(org_identifier, table_name, data, append);

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/org123/enrichment_tables/ip-lookup-table?append=false`,
        data
      );
    });
  });

  describe("create_enrichment_table_from_url", () => {
    it("should make POST request to create enrichment table from URL with default options", async () => {
      const org_identifier = "org123";
      const table_name = "my-table";
      const url = "https://example.com/data.csv";
      const append_data = false;

      mockHttpInstance.post.mockResolvedValue({ data: { success: true } });

      await jstransform.create_enrichment_table_from_url(org_identifier, table_name, url, append_data);

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/${org_identifier}/enrichment_tables/${table_name}/url?append=${append_data}&resume=false&retry=false`,
        { url, replace_failed: false }
      );
    });

    it("should include resume and retry parameters when provided", async () => {
      const org_identifier = "staging-org";
      const table_name = "geo-table";
      const url = "https://example.com/geo.csv";
      const append_data = true;
      const resume = true;
      const retry = true;

      mockHttpInstance.post.mockResolvedValue({ data: {} });

      await jstransform.create_enrichment_table_from_url(
        org_identifier,
        table_name,
        url,
        append_data,
        resume,
        retry
      );

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/staging-org/enrichment_tables/geo-table/url?append=true&resume=true&retry=true`,
        { url, replace_failed: false }
      );
    });

    it("should send replace_failed in the request body", async () => {
      const org_identifier = "org123";
      const table_name = "my-table";
      const url = "https://example.com/data.csv";
      const append_data = false;
      const resume = false;
      const retry = false;
      const replace_failed = true;

      mockHttpInstance.post.mockResolvedValue({ data: {} });

      await jstransform.create_enrichment_table_from_url(
        org_identifier,
        table_name,
        url,
        append_data,
        resume,
        retry,
        replace_failed
      );

      const callArgs = mockHttpInstance.post.mock.calls[0];
      expect(callArgs[1]).toEqual({ url, replace_failed: true });
    });

    it("should default resume, retry, and replace_failed to false", async () => {
      const org_identifier = "org123";
      const table_name = "default-table";
      const url = "https://example.com/defaults.csv";
      const append_data = false;

      mockHttpInstance.post.mockResolvedValue({ data: {} });

      await jstransform.create_enrichment_table_from_url(org_identifier, table_name, url, append_data);

      const callArgs = mockHttpInstance.post.mock.calls[0];
      expect(callArgs[0]).toContain("resume=false");
      expect(callArgs[0]).toContain("retry=false");
      expect(callArgs[1].replace_failed).toBe(false);
    });
  });

  describe("get_all_enrichment_table_statuses", () => {
    it("should make GET request to fetch all enrichment table statuses", async () => {
      const org_identifier = "org123";

      mockHttpInstance.get.mockResolvedValue({ data: { statuses: [] } });

      await jstransform.get_all_enrichment_table_statuses(org_identifier);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${org_identifier}/enrichment_tables/status`
      );
    });

    it("should use the org_identifier in the URL path", async () => {
      const org_identifier = "production-org";

      mockHttpInstance.get.mockResolvedValue({ data: {} });

      await jstransform.get_all_enrichment_table_statuses(org_identifier);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/production-org/enrichment_tables/status`
      );
    });
  });

  describe("test", () => {
    it("should make POST request to test a function", async () => {
      const org_identifier = "org123";
      const data = {
        function: ".field = \"test_value\"",
        events: [{ message: "test log", level: "info" }],
      };

      mockHttpInstance.post.mockResolvedValue({ data: { result: [] } });

      await jstransform.test(org_identifier, data);

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/${org_identifier}/functions/test`,
        data
      );
    });

    it("should pass the test payload as the POST body", async () => {
      const org_identifier = "staging-org";
      const data = {
        function: ".status = upcase(string!(.level))",
        events: [{ level: "error", message: "something failed" }],
      };

      mockHttpInstance.post.mockResolvedValue({ data: {} });

      await jstransform.test(org_identifier, data);

      const callArgs = mockHttpInstance.post.mock.calls[0];
      expect(callArgs[1]).toEqual(data);
    });
  });

  describe("error handling", () => {
    it("should propagate errors from list", async () => {
      const error = new Error("Network error");
      mockHttpInstance.get.mockRejectedValue(error);

      await expect(
        jstransform.list(1, 20, "name", false, "", "org123")
      ).rejects.toThrow("Network error");
    });

    it("should propagate errors from create", async () => {
      const error = new Error("Validation error");
      mockHttpInstance.post.mockRejectedValue(error);

      await expect(
        jstransform.create("org123", { name: "bad-fn" })
      ).rejects.toThrow("Validation error");
    });

    it("should propagate errors from update", async () => {
      const error = new Error("Not found");
      mockHttpInstance.put.mockRejectedValue(error);

      await expect(
        jstransform.update("org123", { name: "missing-fn" })
      ).rejects.toThrow("Not found");
    });

    it("should propagate errors from delete", async () => {
      const error = new Error("Forbidden");
      mockHttpInstance.delete.mockRejectedValue(error);

      await expect(
        jstransform.delete("org123", "locked-fn")
      ).rejects.toThrow("Forbidden");
    });

    it("should propagate errors from stream_function", async () => {
      const error = new Error("Unauthorized");
      mockHttpInstance.get.mockRejectedValue(error);

      await expect(
        jstransform.stream_function("org123", "my-stream", "logs")
      ).rejects.toThrow("Unauthorized");
    });

    it("should propagate errors from apply_stream_function", async () => {
      const error = new Error("Conflict");
      mockHttpInstance.put.mockRejectedValue(error);

      await expect(
        jstransform.apply_stream_function("org123", "my-stream", "logs", "my-fn", {})
      ).rejects.toThrow("Conflict");
    });

    it("should propagate errors from create_enrichment_table", async () => {
      const error = new Error("Payload too large");
      mockHttpInstance.post.mockRejectedValue(error);

      await expect(
        jstransform.create_enrichment_table("org123", "my-table", new FormData(), false)
      ).rejects.toThrow("Payload too large");
    });

    it("should propagate errors from test", async () => {
      const error = new Error("Function execution error");
      mockHttpInstance.post.mockRejectedValue(error);

      await expect(
        jstransform.test("org123", { function: ".bad = syntax(", events: [] })
      ).rejects.toThrow("Function execution error");
    });
  });
});

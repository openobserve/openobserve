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

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import stream from "@/services/stream";
import http from "@/services/http";

// Mock the http service
vi.mock("@/services/http", () => ({
  default: vi.fn(() => ({
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  })),
}));

describe("stream service", () => {
  let mockHttpInstance: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockHttpInstance = {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    };
    (http as any).mockReturnValue(mockHttpInstance);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("nameList", () => {
    it("should make GET request with basic parameters", async () => {
      const params = {
        org_identifier: "org123",
        type: "logs",
        schema: false,
      };

      mockHttpInstance.get.mockResolvedValue({ data: [] });

      await stream.nameList(params.org_identifier, params.type, params.schema);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/streams?type=${params.type}`,
      );
    });

    it("should make GET request with offset and limit parameters", async () => {
      const params = {
        org_identifier: "org123",
        type: "logs",
        schema: false,
        offset: 0,
        limit: 10,
      };

      mockHttpInstance.get.mockResolvedValue({ data: [] });

      await stream.nameList(
        params.org_identifier,
        params.type,
        params.schema,
        params.offset,
        params.limit,
      );

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/streams?type=${params.type}&offset=${params.offset}&limit=${params.limit}`,
      );
    });

    it("should make GET request with keyword parameter", async () => {
      const params = {
        org_identifier: "org123",
        type: "logs",
        schema: false,
        offset: -1,
        limit: -1,
        keyword: "test",
      };

      mockHttpInstance.get.mockResolvedValue({ data: [] });

      await stream.nameList(
        params.org_identifier,
        params.type,
        params.schema,
        params.offset,
        params.limit,
        params.keyword,
      );

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/streams?type=${params.type}&keyword=${params.keyword}`,
      );
    });

    it("should make GET request with sort parameters", async () => {
      const params = {
        org_identifier: "org123",
        type: "logs",
        schema: false,
        offset: -1,
        limit: -1,
        keyword: "",
        sort: "name",
        asc: true,
      };

      mockHttpInstance.get.mockResolvedValue({ data: [] });

      await stream.nameList(
        params.org_identifier,
        params.type,
        params.schema,
        params.offset,
        params.limit,
        params.keyword,
        params.sort,
        params.asc,
      );

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/streams?type=${params.type}&sort=${params.sort}&asc=${params.asc}`,
      );
    });

    it("should make GET request with schema parameter when schema is true", async () => {
      const params = {
        org_identifier: "org123",
        type: "logs",
        schema: true,
      };

      mockHttpInstance.get.mockResolvedValue({ data: [] });

      await stream.nameList(params.org_identifier, params.type, params.schema);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/streams?type=${params.type}&fetchSchema=${params.schema}`,
      );
    });

    it("should handle empty type parameter", async () => {
      const params = {
        org_identifier: "org123",
        type: "",
        schema: false,
      };

      mockHttpInstance.get.mockResolvedValue({ data: [] });

      await stream.nameList(params.org_identifier, params.type, params.schema);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/streams`,
      );
    });

    it("should make GET request with all parameters combined", async () => {
      const params = {
        org_identifier: "org123",
        type: "logs",
        schema: true,
        offset: 0,
        limit: 20,
        keyword: "test",
        sort: "name",
        asc: false,
      };

      mockHttpInstance.get.mockResolvedValue({ data: [] });

      await stream.nameList(
        params.org_identifier,
        params.type,
        params.schema,
        params.offset,
        params.limit,
        params.keyword,
        params.sort,
        params.asc,
      );

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/streams?type=${params.type}&offset=${params.offset}&limit=${params.limit}&keyword=${params.keyword}&sort=${params.sort}&asc=${params.asc}&fetchSchema=${params.schema}`,
      );
    });
  });

  describe("schema", () => {
    it("should make GET request for stream schema with type", async () => {
      const params = {
        org_identifier: "org123",
        stream_name: "test_stream",
        type: "logs",
      };

      mockHttpInstance.get.mockResolvedValue({ data: { fields: [] } });

      await stream.schema(
        params.org_identifier,
        params.stream_name,
        params.type,
      );

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/streams/${params.stream_name}/schema?type=${params.type}`,
      );
    });

    it("should make GET request for stream schema without type", async () => {
      const params = {
        org_identifier: "org123",
        stream_name: "test_stream",
        type: "",
      };

      mockHttpInstance.get.mockResolvedValue({ data: { fields: [] } });

      await stream.schema(
        params.org_identifier,
        params.stream_name,
        params.type,
      );

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/streams/${params.stream_name}/schema`,
      );
    });
  });

  describe("updateSettings", () => {
    it("should make PUT request to update stream settings with type", async () => {
      const params = {
        org_identifier: "org123",
        stream_name: "test_stream",
        type: "logs",
        data: { partition_keys: ["timestamp"] },
      };

      mockHttpInstance.put.mockResolvedValue({ data: { success: true } });

      await stream.updateSettings(
        params.org_identifier,
        params.stream_name,
        params.type,
        params.data,
      );

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/streams/${params.stream_name}/settings?type=${params.type}`,
        params.data,
      );
    });

    it("should make PUT request to update stream settings without type", async () => {
      const params = {
        org_identifier: "org123",
        stream_name: "test_stream",
        type: "",
        data: { partition_keys: ["timestamp"] },
      };

      mockHttpInstance.put.mockResolvedValue({ data: { success: true } });

      await stream.updateSettings(
        params.org_identifier,
        params.stream_name,
        params.type,
        params.data,
      );

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/streams/${params.stream_name}/settings`,
        params.data,
      );
    });
  });

  describe("createSettings", () => {
    it("should make POST request to create stream settings with type", async () => {
      const params = {
        org_identifier: "org123",
        stream_name: "test_stream",
        type: "logs",
        data: { partition_keys: ["timestamp"] },
      };

      mockHttpInstance.post.mockResolvedValue({ data: { success: true } });

      await stream.updateSettings(
        params.org_identifier,
        params.stream_name,
        params.type,
        params.data,
      );

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/streams/${params.stream_name}/settings?type=${params.type}`,
        params.data,
      );
    });

    it("should make POST request to create stream settings without type", async () => {
      const params = {
        org_identifier: "org123",
        stream_name: "test_stream",
        type: "",
        data: { partition_keys: ["timestamp"] },
      };

      mockHttpInstance.post.mockResolvedValue({ data: { success: true } });

      await stream.updateSettings(
        params.org_identifier,
        params.stream_name,
        params.type,
        params.data,
      );

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/streams/${params.stream_name}/settings`,
        params.data,
      );
    });
  });

  describe("fieldValues", () => {
    it("should make GET request with basic parameters", async () => {
      const params = {
        org_identifier: "org123",
        stream_name: "test_stream",
        fields: ["field1", "field2"],
        size: 100,
        start_time: 1640995200,
        end_time: 1641081600,
      };

      mockHttpInstance.get.mockResolvedValue({ data: [] });

      await stream.fieldValues(params);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/${params.stream_name}/_values?fields=field1,field2&size=${params.size}&start_time=${params.start_time}&end_time=${params.end_time}`,
      );
    });

    it("should make GET request with all parameters", async () => {
      const params = {
        org_identifier: "org123",
        stream_name: "test_stream",
        fields: ["field1"],
        size: 50,
        start_time: 1640995200,
        end_time: 1641081600,
        query_context: "SELECT * FROM table",
        query_fn: "test_fn",
        type: "logs",
        regions: "us-west-1",
        clusters: "cluster1",
        no_count: true,
        action_id: "action123",
      };

      mockHttpInstance.get.mockResolvedValue({ data: [] });

      await stream.fieldValues(params);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/${params.stream_name}/_values?fields=field1&size=${params.size}&start_time=${params.start_time}&end_time=${params.end_time}&sql=${params.query_context}&no_count=${params.no_count}&query_fn=${params.query_fn}&action_id=${params.action_id}&type=${params.type}&regions=${params.regions}&clusters=${params.clusters}`,
      );
    });

    it("should handle empty query_fn and action_id", async () => {
      const params = {
        org_identifier: "org123",
        stream_name: "test_stream",
        fields: ["field1"],
        size: 50,
        start_time: 1640995200,
        end_time: 1641081600,
        query_fn: "",
        action_id: "  ",
      };

      mockHttpInstance.get.mockResolvedValue({ data: [] });

      await stream.fieldValues(params);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/${params.stream_name}/_values?fields=field1&size=${params.size}&start_time=${params.start_time}&end_time=${params.end_time}`,
      );
    });
  });

  describe("tracesFieldValues", () => {
    it("should make GET request with basic parameters", async () => {
      const params = {
        org_identifier: "org123",
        stream_name: "traces",
        fields: ["service_name", "operation_name"],
        size: 100,
        start_time: 1640995200,
        end_time: 1641081600,
      };

      mockHttpInstance.get.mockResolvedValue({ data: [] });

      await stream.tracesFieldValues(params);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/${params.stream_name}/_values?fields=service_name,operation_name&size=${params.size}&start_time=${params.start_time}&end_time=${params.end_time}`,
      );
    });

    it("should make GET request with all parameters", async () => {
      const params = {
        org_identifier: "org123",
        stream_name: "traces",
        fields: ["service_name"],
        size: 50,
        start_time: 1640995200,
        end_time: 1641081600,
        filter: "status_code=200",
        type: "traces",
        keyword: "user",
      };

      mockHttpInstance.get.mockResolvedValue({ data: [] });

      await stream.tracesFieldValues(params);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/${params.stream_name}/_values?fields=service_name&size=${params.size}&start_time=${params.start_time}&end_time=${params.end_time}&filter=${params.filter}&type=${params.type}&keyword=${params.keyword}`,
      );
    });
  });

  describe("labelValues", () => {
    it("should make GET request for prometheus label values", async () => {
      const params = {
        org_identifier: "org123",
        stream_name: "metrics_stream",
        start_time: 1640995200,
        end_time: 1641081600,
        label: "job",
      };

      mockHttpInstance.get.mockResolvedValue({ data: [] });

      await stream.labelValues(params);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/prometheus/api/v1/label/${params.label}/values?&match[]=${params.stream_name}&start=${params.start_time}&end=${params.end_time}`,
      );
    });
  });

  describe("delete", () => {
    it("should make DELETE request with default deleteAssociatedAlertsPipelines", async () => {
      const params = {
        org_identifier: "org123",
        stream_name: "test_stream",
        stream_type: "logs",
      };

      mockHttpInstance.delete.mockResolvedValue({ data: { success: true } });

      await stream.delete(
        params.org_identifier,
        params.stream_name,
        params.stream_type,
      );

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/streams/${params.stream_name}?type=${params.stream_type}&delete_all=true`,
      );
    });

    it("should make DELETE request with deleteAssociatedAlertsPipelines set to false", async () => {
      const params = {
        org_identifier: "org123",
        stream_name: "test_stream",
        stream_type: "logs",
        deleteAssociatedAlertsPipelines: false,
      };

      mockHttpInstance.delete.mockResolvedValue({ data: { success: true } });

      await stream.delete(
        params.org_identifier,
        params.stream_name,
        params.stream_type,
        params.deleteAssociatedAlertsPipelines,
      );

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/streams/${params.stream_name}?type=${params.stream_type}&delete_all=false`,
      );
    });
  });

  describe("deleteFields", () => {
    it("should make PUT request to delete stream fields", async () => {
      const params = {
        org_identifier: "org123",
        stream_name: "test_stream",
        stream_type: "metrics",
        fields: ["field1", "field2"],
      };

      mockHttpInstance.put.mockResolvedValue({ data: { success: true } });

      await stream.deleteFields(
        params.org_identifier,
        params.stream_name,
        params.stream_type,
        params.fields as [],
      );

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/streams/${params.stream_name}/delete_fields?type=${params.stream_type}`,
        {
          fields: params.fields,
        },
      );
    });

    it("should make PUT request with empty fields array", async () => {
      const params = {
        org_identifier: "org123",
        stream_name: "test_stream",
        stream_type: "traces",
        fields: [],
      };

      mockHttpInstance.put.mockResolvedValue({ data: { success: true } });

      await stream.deleteFields(
        params.org_identifier,
        params.stream_name,
        params.stream_type,
        params.fields as [],
      );

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/streams/${params.stream_name}/delete_fields?type=${params.stream_type}`,
        {
          fields: [],
        },
      );
    });
  });

  describe("error handling", () => {
    it("should handle API errors gracefully for nameList method", async () => {
      const error = new Error("Network error");
      mockHttpInstance.get.mockRejectedValue(error);

      await expect(stream.nameList("org123", "logs", false)).rejects.toThrow(
        "Network error",
      );
    });

    it("should handle API errors gracefully for schema method", async () => {
      const error = new Error("Not found");
      mockHttpInstance.get.mockRejectedValue(error);

      await expect(
        stream.schema("org123", "test_stream", "logs"),
      ).rejects.toThrow("Not found");
    });

    it("should handle API errors gracefully for updateSettings method", async () => {
      const error = new Error("Forbidden");
      mockHttpInstance.put.mockRejectedValue(error);

      await expect(
        stream.updateSettings("org123", "test_stream", "logs", {}),
      ).rejects.toThrow("Forbidden");
    });

    it("should handle API errors gracefully for delete method", async () => {
      const error = new Error("Internal server error");
      mockHttpInstance.delete.mockRejectedValue(error);

      await expect(
        stream.delete("org123", "test_stream", "logs"),
      ).rejects.toThrow("Internal server error");
    });

    it("should handle API errors gracefully for fieldValues method", async () => {
      const error = new Error("Bad request");
      mockHttpInstance.get.mockRejectedValue(error);

      await expect(
        stream.fieldValues({
          org_identifier: "org123",
          stream_name: "test",
          fields: ["field1"],
          size: 100,
          start_time: 123,
          end_time: 456,
        }),
      ).rejects.toThrow("Bad request");
    });
  });
});

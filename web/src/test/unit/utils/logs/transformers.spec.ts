// Copyright 2023 OpenObserve Inc.

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  encodeVisualizationConfig,
  decodeVisualizationConfig,
  addTransformToQuery,
  buildWebSocketPayload,
  generateURLQuery,
  chunkedAppend,
  transformArrayData,
  transformObjectData,
  flattenObject,
  groupBy,
  type QueryTransformParams,
  type WebSocketPayloadParams,
  type URLQueryParams
} from "@/utils/logs/transformers";

// Mock zincutils functions
vi.mock("@/utils/zincutils", () => ({
  b64EncodeUnicode: vi.fn((str: string) => Buffer.from(str).toString('base64')),
  b64DecodeUnicode: vi.fn((str: string) => Buffer.from(str, 'base64').toString()),
  generateTraceContext: vi.fn(() => ({ traceId: "test-trace-id-123" }))
}));

describe("Transformers Utilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("encodeVisualizationConfig", () => {
    it("should encode configuration object to base64 string", () => {
      const config = { chart: "bar", data: [1, 2, 3] };
      
      const result = encodeVisualizationConfig(config);
      
      expect(result).toBe(Buffer.from(JSON.stringify(config)).toString('base64'));
    });

    it("should return null for invalid configuration", () => {
      const circularObj: any = {};
      circularObj.self = circularObj; // Create circular reference
      
      const result = encodeVisualizationConfig(circularObj);
      
      expect(result).toBeNull();
    });

    it("should handle null and undefined inputs", () => {
      expect(encodeVisualizationConfig(null)).toBe(Buffer.from("null").toString('base64'));
      expect(encodeVisualizationConfig(undefined)).toBe(Buffer.from("undefined").toString('base64'));
    });

    it("should handle complex nested objects", () => {
      const config = {
        chart: {
          type: "line",
          options: {
            responsive: true,
            scales: { x: { type: "time" } }
          }
        },
        data: {
          datasets: [{ label: "Series 1", data: [1, 2, 3] }]
        }
      };
      
      const result = encodeVisualizationConfig(config);
      
      expect(result).toBe(Buffer.from(JSON.stringify(config)).toString('base64'));
    });
  });

  describe("decodeVisualizationConfig", () => {
    it("should decode base64 string to configuration object", () => {
      const config = { chart: "bar", data: [1, 2, 3] };
      const encoded = Buffer.from(JSON.stringify(config)).toString('base64');
      
      const result = decodeVisualizationConfig(encoded);
      
      expect(result).toEqual(config);
    });

    it("should return null for invalid base64 string", () => {
      const result = decodeVisualizationConfig("invalid-base64!");
      
      expect(result).toBeNull();
    });

    it("should return empty object for empty encoded string", () => {
      const encoded = Buffer.from("{}").toString('base64');
      
      const result = decodeVisualizationConfig(encoded);
      
      expect(result).toEqual({});
    });

    it("should handle complex nested objects", () => {
      const config = {
        chart: {
          type: "line",
          options: {
            responsive: true,
            scales: { x: { type: "time" } }
          }
        }
      };
      const encoded = Buffer.from(JSON.stringify(config)).toString('base64');
      
      const result = decodeVisualizationConfig(encoded);
      
      expect(result).toEqual(config);
    });
  });

  describe("addTransformToQuery", () => {
    let queryReq: any;
    let params: QueryTransformParams;

    beforeEach(() => {
      queryReq = { query: {} };
      params = {
        shouldAddFunction: false,
        tempFunctionContent: "SELECT * FROM logs WHERE status = 'error'",
        transformType: "function" as const
      };
    });

    it("should add function query when shouldAddFunction is true", () => {
      params.shouldAddFunction = true;
      
      addTransformToQuery(queryReq, params);
      
      expect(queryReq.query.query_fn).toBe(Buffer.from(params.tempFunctionContent).toString('base64'));
    });

    it("should not add function query when shouldAddFunction is false", () => {
      params.shouldAddFunction = false;
      
      addTransformToQuery(queryReq, params);
      
      expect(queryReq.query.query_fn).toBeUndefined();
    });

    it("should add action_id when transformType is action and selectedTransform exists", () => {
      params.transformType = "action";
      params.selectedTransform = { id: "transform-123" };
      
      addTransformToQuery(queryReq, params);
      
      expect(queryReq.query.action_id).toBe("transform-123");
    });

    it("should not add action_id when transformType is function", () => {
      params.transformType = "function";
      params.selectedTransform = { id: "transform-123" };
      
      addTransformToQuery(queryReq, params);
      
      expect(queryReq.query.action_id).toBeUndefined();
    });

    it("should not add action_id when selectedTransform is missing", () => {
      params.transformType = "action";
      params.selectedTransform = undefined;
      
      addTransformToQuery(queryReq, params);
      
      expect(queryReq.query.action_id).toBeUndefined();
    });

    it("should add both query_fn and action_id when conditions are met", () => {
      params.shouldAddFunction = true;
      params.transformType = "action";
      params.selectedTransform = { id: "transform-456" };
      
      addTransformToQuery(queryReq, params);
      
      expect(queryReq.query.query_fn).toBe(Buffer.from(params.tempFunctionContent).toString('base64'));
      expect(queryReq.query.action_id).toBe("transform-456");
    });

    it("should handle empty function content", () => {
      params.shouldAddFunction = true;
      params.tempFunctionContent = "";
      
      addTransformToQuery(queryReq, params);
      
      expect(queryReq.query.query_fn).toBe("");
    });
  });

  describe("buildWebSocketPayload", () => {
    let params: WebSocketPayloadParams;

    beforeEach(() => {
      params = {
        queryReq: { query: { sql: "SELECT * FROM logs" } },
        isPagination: false,
        type: "search" as const,
        organizationIdentifier: "org-123"
      };
    });

    it("should build basic WebSocket payload", () => {
      const result = buildWebSocketPayload(params);
      
      expect(result.payload).toEqual({
        queryReq: params.queryReq,
        type: "search",
        isPagination: false,
        traceId: "test-trace-id-123",
        org_id: "org-123"
      });
      expect(result.traceId).toBe("test-trace-id-123");
    });

    it("should include meta when provided", () => {
      params.meta = { custom: "data", timeout: 30000 };
      
      const result = buildWebSocketPayload(params);
      
      expect(result.payload.meta).toEqual(params.meta);
    });

    it("should handle different payload types", () => {
      const types = ["search", "histogram", "pageCount", "values"] as const;
      
      types.forEach(type => {
        params.type = type;
        const result = buildWebSocketPayload(params);
        expect(result.payload.type).toBe(type);
      });
    });

    it("should handle pagination flag", () => {
      params.isPagination = true;
      
      const result = buildWebSocketPayload(params);
      
      expect(result.payload.isPagination).toBe(true);
    });

    it("should not include meta when not provided", () => {
      const result = buildWebSocketPayload(params);
      
      expect(result.payload.meta).toBeUndefined();
    });
  });

  describe("generateURLQuery", () => {
    let params: URLQueryParams;

    beforeEach(() => {
      params = {
        streamType: "logs",
        selectedStream: ["app1", "app2"],
        datetime: {
          startTime: "2023-01-01T00:00:00Z",
          endTime: "2023-01-02T00:00:00Z",
          type: "absolute" as const
        },
        query: "error",
        sqlMode: false
      };
    });

    it("should generate basic URL query parameters", () => {
      const result = generateURLQuery(params);
      
      expect(result).toEqual({
        stream_type: "logs",
        stream: "app1,app2",
        from: "2023-01-01T00:00:00Z",
        to: "2023-01-02T00:00:00Z",
        query: Buffer.from("error").toString('base64'),
        sql_mode: "false"
      });
    });

    it("should handle relative time period", () => {
      params.datetime = {
        startTime: "",
        endTime: "",
        type: "relative" as const,
        relativeTimePeriod: "15m"
      };
      
      const result = generateURLQuery(params);
      
      expect(result.period).toBe("15m");
      expect(result.from).toBeUndefined();
      expect(result.to).toBeUndefined();
    });

    it("should handle string selectedStream", () => {
      params.selectedStream = "single-stream" as any;
      
      const result = generateURLQuery(params);
      
      expect(result.stream).toBe("single-stream");
    });

    it("should handle empty selectedStream", () => {
      params.selectedStream = [];
      
      const result = generateURLQuery(params);
      
      expect(result.stream).toBeUndefined();
    });

    it("should include optional parameters when provided", () => {
      params.showTransformEditor = true;
      params.selectedFields = ["field1", "field2", "field3"];
      params.refreshInterval = 5000;
      
      const result = generateURLQuery(params);
      
      expect(result.fn_editor).toBe("true");
      expect(result.defined_schemas).toBe("field1,field2,field3");
      expect(result.refresh).toBe("5000");
    });

    it("should include result grid parameters when provided", () => {
      params.resultGrid = {
        showPagination: true,
        rowsPerPage: 50,
        currentPage: 2
      };
      
      const result = generateURLQuery(params);
      
      expect(result.show_pagination).toBe("true");
      expect(result.rows_per_page).toBe("50");
      expect(result.page_num).toBe("2");
    });

    it("should include meta parameters when provided", () => {
      params.meta = {
        showHistogram: true,
        showDetailTab: false,
        resultGrid: {
          chartInterval: "1h"
        }
      };
      
      const result = generateURLQuery(params);
      
      expect(result.show_histogram).toBe("true");
      expect(result.show_detailed).toBe("false");
      expect(result.chart_interval).toBe("1h");
    });

    it("should handle empty query", () => {
      params.query = "";
      
      const result = generateURLQuery(params);
      
      expect(result.query).toBeUndefined();
    });

    it("should handle SQL mode true", () => {
      params.sqlMode = true;
      
      const result = generateURLQuery(params);
      
      expect(result.sql_mode).toBe("true");
    });
  });

  describe("chunkedAppend", () => {
    it("should append all items from source to target", async () => {
      const target: number[] = [1, 2, 3];
      const source = [4, 5, 6, 7, 8];
      
      await chunkedAppend(target, source, 2);
      
      expect(target).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    });

    it("should handle empty source array", async () => {
      const target = [1, 2, 3];
      const source: number[] = [];
      
      await chunkedAppend(target, source);
      
      expect(target).toEqual([1, 2, 3]);
    });

    it("should handle empty target array", async () => {
      const target: number[] = [];
      const source = [1, 2, 3];
      
      await chunkedAppend(target, source);
      
      expect(target).toEqual([1, 2, 3]);
    });

    it("should use default chunk size when not specified", async () => {
      const target: number[] = [];
      const source = Array.from({ length: 10000 }, (_, i) => i);
      
      await chunkedAppend(target, source);
      
      expect(target.length).toBe(10000);
      expect(target[0]).toBe(0);
      expect(target[9999]).toBe(9999);
    });

    it("should respect custom chunk size", async () => {
      const target: number[] = [];
      const source = [1, 2, 3, 4, 5, 6];
      
      // Use setTimeout spy to verify chunking behavior
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
      
      await chunkedAppend(target, source, 2);
      
      expect(target).toEqual([1, 2, 3, 4, 5, 6]);
      expect(setTimeoutSpy).toHaveBeenCalledTimes(3); // 6 items / 2 chunk size = 3 chunks
      
      setTimeoutSpy.mockRestore();
    });
  });

  describe("transformArrayData", () => {
    it("should transform array using transformer function", () => {
      const data = [1, 2, 3, 4];
      const transformer = (x: number) => x * 2;
      
      const result = transformArrayData(data, transformer);
      
      expect(result).toEqual([2, 4, 6, 8]);
    });

    it("should provide index to transformer function", () => {
      const data = ["a", "b", "c"];
      const transformer = (item: string, index: number) => `${item}${index}`;
      
      const result = transformArrayData(data, transformer);
      
      expect(result).toEqual(["a0", "b1", "c2"]);
    });

    it("should handle empty array", () => {
      const data: number[] = [];
      const transformer = (x: number) => x * 2;
      
      const result = transformArrayData(data, transformer);
      
      expect(result).toEqual([]);
    });

    it("should handle complex transformations", () => {
      const data = [
        { id: 1, name: "John", age: 25 },
        { id: 2, name: "Jane", age: 30 },
        { id: 3, name: "Bob", age: 35 }
      ];
      const transformer = (user: typeof data[0]) => ({ ...user, isAdult: user.age >= 18 });
      
      const result = transformArrayData(data, transformer);
      
      expect(result).toEqual([
        { id: 1, name: "John", age: 25, isAdult: true },
        { id: 2, name: "Jane", age: 30, isAdult: true },
        { id: 3, name: "Bob", age: 35, isAdult: true }
      ]);
    });
  });

  describe("transformObjectData", () => {
    it("should transform object properties", () => {
      const obj = { a: 1, b: 2, c: 3 };
      const transformer = ([key, value]: [string, number]) => [key, value * 2] as [string, number];
      
      const result = transformObjectData(obj, transformer);
      
      expect(result).toEqual({ a: 2, b: 4, c: 6 });
    });

    it("should handle empty object", () => {
      const obj: Record<string, number> = {};
      const transformer = ([key, value]: [string, number]) => [key, value * 2] as [string, number];
      
      const result = transformObjectData(obj, transformer);
      
      expect(result).toEqual({});
    });

    it("should allow key transformation", () => {
      const obj = { firstName: "John", lastName: "Doe", age: 30 };
      const transformer = ([key, value]: [string, any]) => [key.toUpperCase(), value] as [string, any];
      
      const result = transformObjectData(obj, transformer);
      
      expect(result).toEqual({ FIRSTNAME: "John", LASTNAME: "Doe", AGE: 30 });
    });

    it("should handle complex transformations", () => {
      const obj = { user1: { active: true }, user2: { active: false }, user3: { active: true } };
      const transformer = ([key, value]: [string, any]) => [key, { ...value, status: value.active ? "online" : "offline" }];
      
      const result = transformObjectData(obj, transformer);
      
      expect(result).toEqual({
        user1: { active: true, status: "online" },
        user2: { active: false, status: "offline" },
        user3: { active: true, status: "online" }
      });
    });
  });

  describe("flattenObject", () => {
    it("should flatten nested object with dot notation", () => {
      const nested = {
        user: {
          profile: {
            name: "John",
            age: 30
          },
          settings: {
            theme: "dark"
          }
        },
        active: true
      };
      
      const result = flattenObject(nested);
      
      expect(result).toEqual({
        "user.profile.name": "John",
        "user.profile.age": 30,
        "user.settings.theme": "dark",
        "active": true
      });
    });

    it("should handle shallow object", () => {
      const obj = { a: 1, b: 2, c: 3 };
      
      const result = flattenObject(obj);
      
      expect(result).toEqual({ a: 1, b: 2, c: 3 });
    });

    it("should handle arrays as leaf values", () => {
      const obj = {
        user: {
          name: "John",
          hobbies: ["reading", "gaming"],
          scores: [85, 92, 78]
        }
      };
      
      const result = flattenObject(obj);
      
      expect(result).toEqual({
        "user.name": "John",
        "user.hobbies": ["reading", "gaming"],
        "user.scores": [85, 92, 78]
      });
    });

    it("should handle null and undefined values", () => {
      const obj = {
        user: {
          name: "John",
          email: null,
          phone: undefined
        }
      };
      
      const result = flattenObject(obj);
      
      expect(result).toEqual({
        "user.name": "John",
        "user.email": null,
        "user.phone": undefined
      });
    });

    it("should handle empty nested objects", () => {
      const obj = {
        user: {},
        settings: {
          theme: {},
          notifications: {
            email: true
          }
        }
      };
      
      const result = flattenObject(obj);
      
      expect(result).toEqual({
        "settings.notifications.email": true
      });
    });

    it("should use custom prefix", () => {
      const obj = { name: "John", age: 30 };
      
      const result = flattenObject(obj, "user");
      
      expect(result).toEqual({
        "user.name": "John",
        "user.age": 30
      });
    });
  });

  describe("groupBy", () => {
    it("should group array elements by key function", () => {
      const users = [
        { name: "John", department: "IT", age: 25 },
        { name: "Jane", department: "HR", age: 30 },
        { name: "Bob", department: "IT", age: 35 },
        { name: "Alice", department: "Marketing", age: 28 }
      ];
      
      const result = groupBy(users, user => user.department);
      
      expect(result).toEqual({
        IT: [
          { name: "John", department: "IT", age: 25 },
          { name: "Bob", department: "IT", age: 35 }
        ],
        HR: [
          { name: "Jane", department: "HR", age: 30 }
        ],
        Marketing: [
          { name: "Alice", department: "Marketing", age: 28 }
        ]
      });
    });

    it("should handle empty array", () => {
      const result = groupBy([], () => "key");
      
      expect(result).toEqual({});
    });

    it("should handle single group", () => {
      const items = [
        { id: 1, type: "A" },
        { id: 2, type: "A" },
        { id: 3, type: "A" }
      ];
      
      const result = groupBy(items, item => item.type);
      
      expect(result).toEqual({
        A: [
          { id: 1, type: "A" },
          { id: 2, type: "A" },
          { id: 3, type: "A" }
        ]
      });
    });

    it("should handle complex key functions", () => {
      const orders = [
        { id: 1, amount: 100, status: "pending" },
        { id: 2, amount: 250, status: "completed" },
        { id: 3, amount: 75, status: "pending" },
        { id: 4, amount: 500, status: "completed" }
      ];
      
      const result = groupBy(orders, order => `${order.status}-${order.amount > 200 ? "high" : "low"}`);
      
      expect(result).toEqual({
        "pending-low": [
          { id: 1, amount: 100, status: "pending" },
          { id: 3, amount: 75, status: "pending" }
        ],
        "completed-high": [
          { id: 2, amount: 250, status: "completed" },
          { id: 4, amount: 500, status: "completed" }
        ]
      });
    });

    it("should handle number and string keys", () => {
      const items = [
        { value: 1, parity: 1 % 2 },
        { value: 2, parity: 2 % 2 },
        { value: 3, parity: 3 % 2 },
        { value: 4, parity: 4 % 2 }
      ];
      
      const result = groupBy(items, item => item.parity.toString());
      
      expect(result).toEqual({
        "1": [
          { value: 1, parity: 1 },
          { value: 3, parity: 1 }
        ],
        "0": [
          { value: 2, parity: 0 },
          { value: 4, parity: 0 }
        ]
      });
    });
  });
});
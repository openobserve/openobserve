// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import store from "@/test/unit/helpers/store";

// ---------------------------------------------------------------------------
// Module mocks — must be hoisted before any imports of the modules under test
// ---------------------------------------------------------------------------

const mockFetchQueryDataWithHttpStream = vi.fn();
const mockCancelStreamQueryBasedOnRequestId = vi.fn();

vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: mockFetchQueryDataWithHttpStream,
    cancelStreamQueryBasedOnRequestId: mockCancelStreamQueryBasedOnRequestId,
  }),
}));

vi.mock("@/stores", () => ({
  default: store,
}));

// ---------------------------------------------------------------------------
// Imports (after mocks so they pick up the mocked modules)
// ---------------------------------------------------------------------------

import useDurationPercentiles, {
  parseDurationWhereClause,
} from "./useDurationPercentiles";
import { b64EncodeUnicode } from "@/utils/zincutils";

// ---------------------------------------------------------------------------
// Real SQL parser — used directly, not mocked
// ---------------------------------------------------------------------------

let parser: any;

async function getParser() {
  if (parser) return parser;
  const mod = await import(
    "@openobserve/node-sql-parser/build/datafusionsql"
  );
  parser = new mod.default.Parser();
  return parser;
}

// ---------------------------------------------------------------------------
// describe: parseDurationWhereClause
// ---------------------------------------------------------------------------

describe("parseDurationWhereClause", () => {
  let p: any;

  beforeEach(async () => {
    p = await getParser();
  });

  describe("guard conditions", () => {
    it("should return original string when parser is null", () => {
      const result = parseDurationWhereClause("duration >= '1ms'", null, "s");
      expect(result).toBe("duration >= '1ms'");
    });

    it("should return original string when parser is undefined", () => {
      const result = parseDurationWhereClause(
        "duration >= '1ms'",
        undefined,
        "s",
      );
      expect(result).toBe("duration >= '1ms'");
    });

    it("should return original string when whereClause is empty", () => {
      const result = parseDurationWhereClause("", p, "s");
      expect(result).toBe("");
    });

    it("should return original string when whereClause is only whitespace", () => {
      const result = parseDurationWhereClause("   ", p, "s");
      expect(result).toBe("   ");
    });
  });

  describe("microsecond unit (us)", () => {
    it("should convert duration >= '100us' to duration >= 100", () => {
      const result = parseDurationWhereClause("duration >= '100us'", p, "x");
      expect(result).toBe("duration >= 100");
    });

    it("should convert duration <= '500us' to duration <= 500 (less-than operator)", () => {
      const result = parseDurationWhereClause("duration <= '500us'", p, "x");
      expect(result).toBe("duration <= 500");
    });
  });

  describe("millisecond unit (ms and aliases)", () => {
    it("should convert duration >= '1.50ms' to duration >= 1500", () => {
      const result = parseDurationWhereClause("duration >= '1.50ms'", p, "x");
      expect(result).toBe("duration >= 1500");
    });

    it("should convert 'msec' alias correctly", () => {
      const result = parseDurationWhereClause(
        "duration >= '1.50msec'",
        p,
        "x",
      );
      expect(result).toBe("duration >= 1500");
    });

    it("should convert 'msecs' alias correctly", () => {
      const result = parseDurationWhereClause(
        "duration >= '1.50msecs'",
        p,
        "x",
      );
      expect(result).toBe("duration >= 1500");
    });

    it("should convert 'millisecond' alias correctly", () => {
      const result = parseDurationWhereClause(
        "duration >= '1.50millisecond'",
        p,
        "x",
      );
      expect(result).toBe("duration >= 1500");
    });

    it("should convert 'milliseconds' alias correctly", () => {
      const result = parseDurationWhereClause(
        "duration >= '1.50milliseconds'",
        p,
        "x",
      );
      expect(result).toBe("duration >= 1500");
    });
  });

  describe("second unit (s and aliases)", () => {
    it("should convert duration >= '2.50s' to duration >= 2500000", () => {
      const result = parseDurationWhereClause("duration >= '2.50s'", p, "x");
      expect(result).toBe("duration >= 2500000");
    });

    it("should convert 'sec' alias correctly", () => {
      const result = parseDurationWhereClause("duration >= '2.50sec'", p, "x");
      expect(result).toBe("duration >= 2500000");
    });

    it("should convert 'secs' alias correctly", () => {
      const result = parseDurationWhereClause(
        "duration >= '2.50secs'",
        p,
        "x",
      );
      expect(result).toBe("duration >= 2500000");
    });

    it("should convert 'second' alias correctly", () => {
      const result = parseDurationWhereClause(
        "duration >= '2.50second'",
        p,
        "x",
      );
      expect(result).toBe("duration >= 2500000");
    });

    it("should convert 'seconds' alias correctly", () => {
      const result = parseDurationWhereClause(
        "duration >= '2.50seconds'",
        p,
        "x",
      );
      expect(result).toBe("duration >= 2500000");
    });

    it("should convert duration >= '2 seconds' with space between number and unit", () => {
      const result = parseDurationWhereClause(
        "duration >= '2 seconds'",
        p,
        "x",
      );
      expect(result).toBe("duration >= 2000000");
    });
  });

  describe("minute unit (m)", () => {
    it("should convert duration >= '1.50m' to duration >= 90000000", () => {
      const result = parseDurationWhereClause("duration >= '1.50m'", p, "x");
      expect(result).toBe("duration >= 90000000");
    });
  });

  describe("unknown unit", () => {
    it("should return error object when unit is unrecognised", () => {
      const result = parseDurationWhereClause(
        "duration >= '5 lightyears'",
        p,
        "x",
      );
      expect(result).toEqual({ error: 'Unknown duration unit: "lightyears"' });
    });
  });

  describe("non-duration fields", () => {
    it("should pass through a non-duration field unchanged", () => {
      const result = parseDurationWhereClause(
        "service_name = 'foo'",
        p,
        "x",
      );
      expect(result).toBe("service_name = 'foo'");
    });
  });

  describe("combined clauses", () => {
    it("should preserve non-duration predicate and convert duration predicate", () => {
      const result = parseDurationWhereClause(
        "service_name='svc-a' AND duration >= '1.50ms'",
        p,
        "x",
      );
      // service_name is preserved; duration is converted to 1500 microseconds
      expect(result).toContain("service_name = 'svc-a'");
      expect(result).toContain("duration >= 1500");
    });
  });

  describe("malformed SQL fallback", () => {
    it("should return original string when SQL is malformed and parser throws", () => {
      const badClause = ")))INVALID SQL(((";
      const result = parseDurationWhereClause(badClause, p, "x");
      expect(result).toBe(badClause);
    });
  });
});

// ---------------------------------------------------------------------------
// describe: useDurationPercentiles (default export composable)
// ---------------------------------------------------------------------------

describe("useDurationPercentiles", () => {
  const BASE_PAYLOAD = {
    streamName: "default",
    startTime: 1_000_000,
    endTime: 2_000_000,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: fetchQueryDataWithHttpStream is a no-op unless overridden per test
    mockFetchQueryDataWithHttpStream.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("initial state", () => {
    it("should initialise percentiles as all-null", () => {
      const { percentiles } = useDurationPercentiles();
      expect(percentiles.value).toEqual({
        p25: null,
        p50: null,
        p75: null,
        p95: null,
        p99: null,
        max: null,
      });
    });

    it("should initialise isLoading as false", () => {
      const { isLoading } = useDurationPercentiles();
      expect(isLoading.value).toBe(false);
    });

    it("should initialise errMsg as empty string", () => {
      const { errMsg } = useDurationPercentiles();
      expect(errMsg.value).toBe("");
    });
  });

  describe("fetchPercentiles", () => {
    it("should set isLoading to true and call fetchQueryDataWithHttpStream", async () => {
      const { fetchPercentiles, isLoading } = useDurationPercentiles();

      fetchPercentiles(BASE_PAYLOAD);

      // isLoading is set synchronously before the async stream call
      expect(isLoading.value).toBe(true);
      expect(mockFetchQueryDataWithHttpStream).toHaveBeenCalledOnce();

      await flushPromises();
    });

    it("should pass the correct org_id from the store to the stream call", () => {
      const { fetchPercentiles } = useDurationPercentiles();
      fetchPercentiles(BASE_PAYLOAD);

      const callArg = mockFetchQueryDataWithHttpStream.mock.calls[0][0];
      expect(callArg.org_id).toBe("default");
    });

    it("should reset percentiles to null before each fetch", async () => {
      // Simulate a successful fetch that populates percentiles
      mockFetchQueryDataWithHttpStream.mockImplementationOnce(
        (_payload: any, handlers: any) => {
          handlers.data(_payload, {
            type: "search_response_hits",
            content: {
              results: {
                hits: [{ p25: 100, p50: 200, p75: 300, p95: 400, p99: 500 }],
              },
            },
          });
        },
      );

      const { fetchPercentiles, percentiles } = useDurationPercentiles();
      fetchPercentiles(BASE_PAYLOAD);
      await flushPromises();
      expect(percentiles.value.p50).toBe(200);

      // Second fetch — percentiles reset to null before new data arrives
      fetchPercentiles(BASE_PAYLOAD);
      expect(percentiles.value).toEqual({
        p25: null,
        p50: null,
        p75: null,
        p95: null,
        p99: null,
        max: null,
      });
    });

    it("should build a SQL query that includes a WHERE clause when whereClause is provided", () => {
      const { fetchPercentiles } = useDurationPercentiles();
      fetchPercentiles({ ...BASE_PAYLOAD, whereClause: "duration >= 1000" });

      const callArg = mockFetchQueryDataWithHttpStream.mock.calls[0][0];
      // The query is encoded with b64EncodeUnicode — compare against the same encoding
      const expectedSqlFragment =
        `SELECT approx_percentile_cont(duration, 0.25) as p25,` +
        ` approx_percentile_cont(duration, 0.50) as p50,` +
        ` approx_percentile_cont(duration, 0.75) as p75,` +
        ` approx_percentile_cont(duration, 0.95) as p95,` +
        ` approx_percentile_cont(duration, 0.99) as p99,` +
        ` max(duration) as max` +
        ` FROM "${BASE_PAYLOAD.streamName}" WHERE duration >= 1000`;
      expect(callArg.queryReq.query.sql).toBe(b64EncodeUnicode(expectedSqlFragment));
    });

    it("should not include a WHERE clause in the SQL when whereClause is absent", () => {
      const { fetchPercentiles } = useDurationPercentiles();
      fetchPercentiles(BASE_PAYLOAD);

      const callArg = mockFetchQueryDataWithHttpStream.mock.calls[0][0];
      const expectedSqlFragment =
        `SELECT approx_percentile_cont(duration, 0.25) as p25,` +
        ` approx_percentile_cont(duration, 0.50) as p50,` +
        ` approx_percentile_cont(duration, 0.75) as p75,` +
        ` approx_percentile_cont(duration, 0.95) as p95,` +
        ` approx_percentile_cont(duration, 0.99) as p99,` +
        ` max(duration) as max` +
        ` FROM "${BASE_PAYLOAD.streamName}"`;
      expect(callArg.queryReq.query.sql).toBe(b64EncodeUnicode(expectedSqlFragment));
    });
  });

  describe("on search_response_hits response", () => {
    it("should populate percentiles and set isLoading to false", async () => {
      const hits = [{ p25: 100, p50: 200, p75: 300, p95: 400, p99: 500 }];

      mockFetchQueryDataWithHttpStream.mockImplementationOnce(
        (_payload: any, handlers: any) => {
          handlers.data(_payload, {
            type: "search_response_hits",
            content: { results: { hits } },
          });
        },
      );

      const { fetchPercentiles, percentiles, isLoading } =
        useDurationPercentiles();
      fetchPercentiles(BASE_PAYLOAD);
      await flushPromises();

      expect(percentiles.value).toEqual({
        p25: 100,
        p50: 200,
        p75: 300,
        p95: 400,
        p99: 500,
        max: null,
      });
      expect(isLoading.value).toBe(false);
    });

    it("should keep percentiles null when hits array is empty", async () => {
      mockFetchQueryDataWithHttpStream.mockImplementationOnce(
        (_payload: any, handlers: any) => {
          handlers.data(_payload, {
            type: "search_response_hits",
            content: { results: { hits: [] } },
          });
        },
      );

      const { fetchPercentiles, percentiles, isLoading } =
        useDurationPercentiles();
      fetchPercentiles(BASE_PAYLOAD);
      await flushPromises();

      // Empty hits → percentiles stay null; isLoading stays true (stream still open)
      expect(percentiles.value).toEqual({
        p25: null,
        p50: null,
        p75: null,
        p95: null,
        p99: null,
        max: null,
      });
      expect(isLoading.value).toBe(true);
    });

    it("should treat missing percentile fields as null in the hits row", async () => {
      mockFetchQueryDataWithHttpStream.mockImplementationOnce(
        (_payload: any, handlers: any) => {
          handlers.data(_payload, {
            type: "search_response_hits",
            content: { results: { hits: [{ p25: 100 }] } },
          });
        },
      );

      const { fetchPercentiles, percentiles } = useDurationPercentiles();
      fetchPercentiles(BASE_PAYLOAD);
      await flushPromises();

      expect(percentiles.value.p25).toBe(100);
      expect(percentiles.value.p50).toBeNull();
      expect(percentiles.value.p75).toBeNull();
      expect(percentiles.value.p95).toBeNull();
      expect(percentiles.value.p99).toBeNull();
      expect(percentiles.value.max).toBeNull();
    });
  });

  describe("on error callback", () => {
    it("should set errMsg and isLoading to false", async () => {
      mockFetchQueryDataWithHttpStream.mockImplementationOnce(
        (_payload: any, handlers: any) => {
          handlers.error(_payload, { message: "Server error" });
        },
      );

      const { fetchPercentiles, errMsg, isLoading } = useDurationPercentiles();
      fetchPercentiles(BASE_PAYLOAD);
      await flushPromises();

      expect(errMsg.value).toBe("Failed to load percentiles");
      expect(isLoading.value).toBe(false);
    });
  });

  describe("on complete callback", () => {
    it("should set isLoading to false", async () => {
      mockFetchQueryDataWithHttpStream.mockImplementationOnce(
        (_payload: any, handlers: any) => {
          handlers.complete(_payload, {});
        },
      );

      const { fetchPercentiles, isLoading } = useDurationPercentiles();
      fetchPercentiles(BASE_PAYLOAD);
      await flushPromises();

      expect(isLoading.value).toBe(false);
    });
  });

  describe("cancelFetch", () => {
    it("should call cancelStreamQueryBasedOnRequestId and set isLoading to false", async () => {
      const { fetchPercentiles, cancelFetch, isLoading } =
        useDurationPercentiles();

      fetchPercentiles(BASE_PAYLOAD);
      expect(isLoading.value).toBe(true);

      cancelFetch();

      expect(mockCancelStreamQueryBasedOnRequestId).toHaveBeenCalledOnce();
      expect(isLoading.value).toBe(false);
    });

    it("should not call cancelStreamQueryBasedOnRequestId when no request is in-flight", () => {
      const { cancelFetch } = useDurationPercentiles();

      cancelFetch(); // no fetchPercentiles called first

      expect(mockCancelStreamQueryBasedOnRequestId).not.toHaveBeenCalled();
    });
  });

  describe("second fetchPercentiles call cancels in-flight request", () => {
    it("should cancel the first request before starting the second", () => {
      const { fetchPercentiles } = useDurationPercentiles();

      fetchPercentiles(BASE_PAYLOAD);
      // At this point currentTraceId is set; a second call should cancel it
      fetchPercentiles({ ...BASE_PAYLOAD, streamName: "other" });

      expect(mockCancelStreamQueryBasedOnRequestId).toHaveBeenCalledOnce();
      // Two fetch calls — one per invocation of fetchPercentiles
      expect(mockFetchQueryDataWithHttpStream).toHaveBeenCalledTimes(2);
    });
  });
});

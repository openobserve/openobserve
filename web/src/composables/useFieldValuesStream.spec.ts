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

// @vitest-environment jsdom

// ---------------------------------------------------------------------------
// vi.mock() calls MUST precede all imports.
// ---------------------------------------------------------------------------

const mockCancelStreamQuery = vi.fn();
const mockFetchQueryDataWithHttpStream = vi.fn();
const mockCaptureFromValuesApi = vi.hoisted(() => vi.fn());

vi.mock("@/composables/fieldValueStore", () => ({
  captureFromValuesApi: mockCaptureFromValuesApi,
}));

vi.mock("@/composables/useStreamingSearch", () => ({
  default: vi.fn(() => ({
    fetchQueryDataWithHttpStream: mockFetchQueryDataWithHttpStream,
    cancelStreamQueryBasedOnRequestId: mockCancelStreamQuery,
  })),
}));

vi.mock("@/stores", () => ({
  default: {
    state: {
      selectedOrganization: { identifier: "test-org" },
      zoConfig: { query_values_default_num: 10 },
    },
  },
}));

vi.mock("@/utils/zincutils", () => ({
  generateTraceContext: vi.fn(() => ({ traceId: "test-trace-123" })),
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from "vitest";
import { gt } from "@/types/i18n";
import { isRef } from "vue";
import useFieldValuesStream, {
  enrichmentValuesRange,
  stripFieldCondition,
} from "./useFieldValuesStream";
import { LOGS_FIELD_VALUES_PARITY } from "@/test/unit/mockData/logsFieldValuesParity";
import { MISSING_VALUE_KEY } from "@/components/common/fieldPanel/valueFilterExpression";
import { generateTraceContext } from "@/utils/zincutils";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useFieldValuesStream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Return value structure ───────────────────────────────────────────────

  describe("return value structure", () => {
    it("returns fieldValues, fetchFieldValues, cancelFieldStream, resetFieldValues", () => {
      const result = useFieldValuesStream(gt);
      expect(result).toHaveProperty("fieldValues");
      expect(result).toHaveProperty("fetchFieldValues");
      expect(result).toHaveProperty("cancelFieldStream");
      expect(result).toHaveProperty("resetFieldValues");
    });

    it("fieldValues is a Vue ref", () => {
      const { fieldValues } = useFieldValuesStream(gt);
      expect(isRef(fieldValues)).toBe(true);
    });

    it("fieldValues starts as an empty object", () => {
      const { fieldValues } = useFieldValuesStream(gt);
      expect(fieldValues.value).toEqual({});
    });

    it("fetchFieldValues, cancelFieldStream, resetFieldValues are functions", () => {
      const { fetchFieldValues, cancelFieldStream, resetFieldValues } = useFieldValuesStream(gt);
      expect(typeof fetchFieldValues).toBe("function");
      expect(typeof cancelFieldStream).toBe("function");
      expect(typeof resetFieldValues).toBe("function");
    });
  });

  // ─── resetFieldValues ────────────────────────────────────────────────────

  describe("resetFieldValues", () => {
    it("initialises field state with isLoading=false by default", () => {
      const { fieldValues, resetFieldValues } = useFieldValuesStream(gt);

      resetFieldValues("status");

      expect(fieldValues.value["status"]).toEqual({
        values: [],
        isLoading: false,
        hasMore: false,
        errMsg: "",
      });
    });

    it("initialises field state with isLoading=true when second arg is true", () => {
      const { fieldValues, resetFieldValues } = useFieldValuesStream(gt);

      resetFieldValues("level", true);

      expect(fieldValues.value["level"].isLoading).toBe(true);
    });

    it("resets existing field state to fresh empty state", () => {
      const { fieldValues, resetFieldValues } = useFieldValuesStream(gt);

      // Put some data in first
      resetFieldValues("host", true);
      fieldValues.value["host"].values = [{ key: "server1", count: 5 }];

      // Then reset again
      resetFieldValues("host");

      expect(fieldValues.value["host"].values).toEqual([]);
      expect(fieldValues.value["host"].isLoading).toBe(false);
    });

    it("can reset multiple different fields independently", () => {
      const { fieldValues, resetFieldValues } = useFieldValuesStream(gt);

      resetFieldValues("field-a", true);
      resetFieldValues("field-b", false);

      expect(fieldValues.value["field-a"].isLoading).toBe(true);
      expect(fieldValues.value["field-b"].isLoading).toBe(false);
    });
  });

  // ─── cancelFieldStream ───────────────────────────────────────────────────

  describe("cancelFieldStream", () => {
    it("is a no-op when field has no registered trace IDs", () => {
      const { cancelFieldStream } = useFieldValuesStream(gt);

      expect(() => cancelFieldStream("no-traces-field")).not.toThrow();
      expect(mockCancelStreamQuery).not.toHaveBeenCalled();
    });

    it("calls cancelStreamQueryBasedOnRequestId for each trace ID registered to the field", () => {
      const { fetchFieldValues, cancelFieldStream } = useFieldValuesStream(gt);

      // Each fetchFieldValues call registers a traceId for the field
      fetchFieldValues({ fields: ["environment"], stream_name: "logs" });
      fetchFieldValues({ fields: ["environment"], stream_name: "metrics" });

      cancelFieldStream("environment");

      // generateTraceContext always returns "test-trace-123", so both calls
      // share the same trace ID; cancelStreamQueryBasedOnRequestId is still
      // called once per registered trace.
      expect(mockCancelStreamQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          trace_id: "test-trace-123",
          org_id: "test-org",
        }),
      );
    });

    it("clears the traceId list after cancellation", () => {
      const { fetchFieldValues, cancelFieldStream } = useFieldValuesStream(gt);

      fetchFieldValues({ fields: ["service"], stream_name: "logs" });
      cancelFieldStream("service");

      // Cancelling a second time should be a no-op (list was cleared)
      vi.clearAllMocks();
      cancelFieldStream("service");
      expect(mockCancelStreamQuery).not.toHaveBeenCalled();
    });
  });

  // ─── fetchFieldValues ─────────────────────────────────────────────────────

  describe("fetchFieldValues", () => {
    it("calls generateTraceContext to obtain a trace ID", async () => {
      const { generateTraceContext } = await import("@/utils/zincutils");
      const { fetchFieldValues } = useFieldValuesStream(gt);

      fetchFieldValues({ fields: ["method"], stream_name: "logs" });

      expect(generateTraceContext).toHaveBeenCalled();
    });

    it("calls fetchQueryDataWithHttpStream with a payload containing traceId and org_id", () => {
      const { fetchFieldValues } = useFieldValuesStream(gt);

      fetchFieldValues({ fields: ["path"], stream_name: "traces" });

      expect(mockFetchQueryDataWithHttpStream).toHaveBeenCalledWith(
        expect.objectContaining({
          traceId: "test-trace-123",
          org_id: "test-org",
          type: "values",
        }),
        expect.objectContaining({
          data: expect.any(Function),
          error: expect.any(Function),
          complete: expect.any(Function),
          reset: expect.any(Function),
        }),
      );
    });

    it("passes the full payload as queryReq and meta in the ws payload", () => {
      const { fetchFieldValues } = useFieldValuesStream(gt);

      const payload = { fields: ["region"], stream_name: "infra", from: 0 };
      fetchFieldValues(payload);

      const [wsPayload] = mockFetchQueryDataWithHttpStream.mock.calls[0];
      expect(wsPayload.queryReq).toEqual(payload);
      expect(wsPayload.meta).toEqual(payload);
    });

    it("registers the returned traceId for the first field in the payload", () => {
      const { fetchFieldValues, cancelFieldStream } = useFieldValuesStream(gt);

      fetchFieldValues({ fields: ["datacenter"], stream_name: "logs" });

      // If a traceId was registered, cancelFieldStream will call cancel
      cancelFieldStream("datacenter");
      expect(mockCancelStreamQuery).toHaveBeenCalledWith(
        expect.objectContaining({ trace_id: "test-trace-123" }),
      );
    });
  });

  // ─── currentSize tracking ────────────────────────────────────────────────

  describe("fieldValuesCurrentSize", () => {
    it("records the cumulative size of every request so hasMore only shows for a full page", () => {
      const { fetchFieldValues, fieldValuesCurrentSize } = useFieldValuesStream(gt);
      fetchFieldValues({ fields: ["level"], size: 10, stream_name: "logs" });
      expect(fieldValuesCurrentSize.value.level).toBe(10);
      fetchFieldValues({ fields: ["level"], size: 20, stream_name: "logs" });
      expect(fieldValuesCurrentSize.value.level).toBe(20);
    });

    it("flags hasMore only when the page came back full", () => {
      const { fetchFieldValues, fieldValues } = useFieldValuesStream(gt);
      fetchFieldValues({ fields: ["level"], size: 20, stream_name: "logs" });
      const handlers = mockFetchQueryDataWithHttpStream.mock.calls.at(-1)?.[1];
      const payload = mockFetchQueryDataWithHttpStream.mock.calls.at(-1)?.[0];
      const hits = Array.from({ length: 12 }, (_, i) => ({ zo_sql_key: `v${i}`, zo_sql_num: 1 }));
      handlers.data(payload, {
        type: "search_response_hits",
        content: { results: { hits: [{ values: hits }] } },
      });
      expect(fieldValues.value.level.values).toHaveLength(12);
      expect(fieldValues.value.level.hasMore).toBe(false);
    });
  });
});

describe("logs request parity", () => {
  const hit = (key: string, count: number) => ({ zo_sql_key: key, zo_sql_num: count });
  const lastCall = () => {
    const call = mockFetchQueryDataWithHttpStream.mock.calls.at(-1)!;
    return { payload: call[0], handlers: call[1] };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends regions, clusters, vrl_fn and the keyword exactly as the logs sidebar built them", () => {
    const { fetchFieldValues } = useFieldValuesStream(gt);
    for (const request of [
      ...LOGS_FIELD_VALUES_PARITY.quickSingleVrl,
      ...LOGS_FIELD_VALUES_PARITY.keyword,
    ]) {
      fetchFieldValues({ ...request });
      expect(lastCall().payload.queryReq).toEqual(request);
    }
    expect(lastCall().payload.queryReq.keyword).toBe("err");
  });

  it("sends one request per stream and sums the counts across streams", () => {
    const { fetchFieldValues, fieldValues } = useFieldValuesStream(gt);
    const before = mockFetchQueryDataWithHttpStream.mock.calls.length;
    fetchFieldValues(LOGS_FIELD_VALUES_PARITY.sqlMulti.map((request) => ({ ...request })));
    const calls = mockFetchQueryDataWithHttpStream.mock.calls
      .slice(before)
      .map((call) => ({ payload: call[0], handlers: call[1] }));
    expect(calls.map((c) => c.payload.queryReq.stream_name)).toEqual(["s1", "s2"]);
    calls[0].handlers.data(calls[0].payload, {
      type: "search_response_hits",
      content: { results: { hits: [{ values: [hit("error", 3), hit("info", 1)] }] } },
    });
    calls[1].handlers.data(calls[1].payload, {
      type: "search_response_hits",
      content: { results: { hits: [{ values: [hit("error", 2), hit("warn", 5)] }] } },
    });
    expect(fieldValues.value.level.values).toEqual([
      { key: "error", count: 5 },
      { key: "warn", count: 5 },
      { key: "info", count: 1 },
    ]);
  });

  it("keys a missing value apart from the text null, labels it null and keeps it out of autocomplete", () => {
    const { fetchFieldValues, fieldValues } = useFieldValuesStream(gt);
    fetchFieldValues({ ...LOGS_FIELD_VALUES_PARITY.keyword[0] });
    const { payload, handlers } = lastCall();
    handlers.data(payload, {
      type: "search_response_hits",
      content: { results: { hits: [{ values: [hit("", 7), hit("null", 3), hit("a", 1)] }] } },
    });
    expect(fieldValues.value.level.values).toEqual([
      { key: MISSING_VALUE_KEY, label: "null", count: 7 },
      { key: "null", count: 3 },
      { key: "a", count: 1 },
    ]);
    expect(mockCaptureFromValuesApi).toHaveBeenCalledWith(expect.anything(), expect.any(String), [
      { key: "null", count: 3 },
      { key: "a", count: 1 },
    ]);
  });

  it("reads an enrichment table around the documents it holds, five minutes either side, in whole milliseconds", () => {
    expect(
      enrichmentValuesRange({ doc_time_min: 1700000000000000, doc_time_max: 1700003600000000 }),
    ).toEqual({
      startTime: LOGS_FIELD_VALUES_PARITY.enrichment[0].start_time,
      endTime: LOGS_FIELD_VALUES_PARITY.enrichment[0].end_time,
    });
    expect(
      enrichmentValuesRange({ doc_time_min: 1700000000000123, doc_time_max: 1700003600000999 }),
    ).toEqual({
      startTime: 1699999700000000,
      endTime: 1700003900000000,
    });
  });

  it("keeps the first page while a larger page with the pinned range streams in", () => {
    const { fetchFieldValues, fieldValues, fieldValuesFinalizedValues } = useFieldValuesStream(gt);
    const first = LOGS_FIELD_VALUES_PARITY.keyword[0];
    fetchFieldValues({ ...first });
    const page1 = lastCall();
    page1.handlers.data(page1.payload, {
      type: "search_response_hits",
      content: { results: { hits: [{ values: [hit("a", 9)] }] } },
    });
    fieldValuesFinalizedValues.value.level = [...fieldValues.value.level.values];
    const more = LOGS_FIELD_VALUES_PARITY.loadMoreAfterKeyword[0];
    fetchFieldValues({ ...more });
    const page2 = lastCall();
    expect(page2.payload.queryReq).toMatchObject({
      size: 20,
      keyword: "err",
      start_time: first.start_time,
      end_time: first.end_time,
    });
    page2.handlers.data(page2.payload, {
      type: "search_response_hits",
      content: { results: { hits: [{ values: [hit("a", 9), hit("b", 4)] }] } },
    });
    expect(fieldValues.value.level.values).toEqual([
      { key: "a", count: 9 },
      { key: "b", count: 4 },
    ]);
    expect(fieldValues.value.level.hasMore).toBe(false);
  });

  it("settles the field through the transport's completion call, which carries only the trace id", () => {
    const { fetchFieldValues, fieldValues, resetFieldValues } = useFieldValuesStream(gt);
    resetFieldValues("level", true);
    fetchFieldValues({ ...LOGS_FIELD_VALUES_PARITY.quickSingle[0] });
    const { payload, handlers } = lastCall();
    handlers.complete(payload, "test-trace-123");
    expect(fieldValues.value.level).toMatchObject({ isLoading: false, errMsg: "" });
  });

  it("settles a field with an error the caller found before any request", () => {
    const { setFieldError, fieldValues } = useFieldValuesStream(gt);
    setFieldError("level", "held");
    expect(fieldValues.value.level).toMatchObject({ isLoading: false, errMsg: "held", values: [] });
  });

  it("keeps a refetched list on screen, busy, until the new values replace it (X3)", () => {
    const { fetchFieldValues, fieldValues, resetFieldValues } = useFieldValuesStream(gt);
    const request = { ...LOGS_FIELD_VALUES_PARITY.quickSingle[0], size: 10 };
    fetchFieldValues({ ...request });
    const first = lastCall();
    first.handlers.data(first.payload, {
      type: "search_response_hits",
      content: { results: { hits: [{ values: [hit("error", 3), hit("warn", 1)] }] } },
    });
    first.handlers.complete(first.payload, "t1");
    resetFieldValues("level", true, true);
    fetchFieldValues({ ...request });
    const again = lastCall();
    expect(fieldValues.value.level).toMatchObject({ isLoading: true });
    expect(fieldValues.value.level.values.map((v) => v.key)).toEqual(["error", "warn"]);
    again.handlers.data(again.payload, {
      type: "search_response_hits",
      content: { results: { hits: [] } },
    });
    expect(fieldValues.value.level.isLoading).toBe(true);
    again.handlers.data(again.payload, {
      type: "search_response_hits",
      content: { results: { hits: [{ values: [hit("info", 9)] }] } },
    });
    expect(fieldValues.value.level).toMatchObject({
      isLoading: false,
      values: [{ key: "info", count: 9 }],
    });
  });

  it("empties a kept list when the refetch brings no values (X3)", () => {
    const { fetchFieldValues, fieldValues, resetFieldValues } = useFieldValuesStream(gt);
    const request = { ...LOGS_FIELD_VALUES_PARITY.quickSingle[0], size: 10 };
    fetchFieldValues({ ...request });
    const first = lastCall();
    first.handlers.data(first.payload, {
      type: "search_response_hits",
      content: { results: { hits: [{ values: [hit("error", 3)] }] } },
    });
    first.handlers.complete(first.payload, "t1");
    resetFieldValues("level", true, true);
    fetchFieldValues({ ...request });
    const again = lastCall();
    again.handlers.complete(again.payload, "t2");
    expect(fieldValues.value.level).toMatchObject({ isLoading: false, values: [] });
  });

  it("marks a terminal load-more page as settled even though it adds nothing", () => {
    const { fetchFieldValues, fieldValues } = useFieldValuesStream(gt);
    const request = { ...LOGS_FIELD_VALUES_PARITY.quickSingle[0], size: 2 };
    const page = [hit("error", 3), hit("warn", 1)];
    fetchFieldValues({ ...request });
    const first = lastCall();
    first.handlers.data(first.payload, {
      type: "search_response_hits",
      content: { results: { hits: [{ values: page }] } },
    });
    first.handlers.complete(first.payload, "t1");
    expect(fieldValues.value.level).toMatchObject({ hasMore: true, settled: 1 });
    fetchFieldValues({ ...request, size: 4 });
    const more = lastCall();
    more.handlers.data(more.payload, {
      type: "search_response_hits",
      content: { results: { hits: [{ values: page }] } },
    });
    more.handlers.complete(more.payload, "t2");
    expect(fieldValues.value.level).toMatchObject({ hasMore: false, settled: 2 });
    expect(fieldValues.value.level.values).toHaveLength(2);
  });

  it("marks a failed request as settled", () => {
    const { fetchFieldValues, fieldValues, resetFieldValues } = useFieldValuesStream(gt);
    resetFieldValues("level", true);
    fetchFieldValues({ ...LOGS_FIELD_VALUES_PARITY.quickSingle[0] });
    const { payload, handlers } = lastCall();
    handlers.error(payload, new Error("boom"));
    expect(fieldValues.value.level).toMatchObject({ isLoading: false, settled: 1 });
    expect(fieldValues.value.level.errMsg).not.toBe("");
  });

  const withTraceIds = (...ids: string[]) => {
    for (const traceId of ids)
      vi.mocked(generateTraceContext).mockReturnValueOnce({ traceId } as never);
  };
  const callsSince = (count: number) =>
    mockFetchQueryDataWithHttpStream.mock.calls
      .slice(count)
      .map((call) => ({ payload: call[0], handlers: call[1] }));
  const [s1, s2] = LOGS_FIELD_VALUES_PARITY.sqlMulti;

  it("keeps a two-stream load-more pending until its last stream ends", () => {
    const { fetchFieldValues, fieldValues, resetFieldValues } = useFieldValuesStream(gt);
    resetFieldValues("level", true);
    const before = mockFetchQueryDataWithHttpStream.mock.calls.length;
    withTraceIds("a", "b");
    fetchFieldValues([{ ...s1 }, { ...s2 }]);
    const [first, second] = callsSince(before);
    expect(fieldValues.value.level.generation).toBe(1);
    first.handlers.complete(first.payload, "a");
    expect(fieldValues.value.level.settled).toBeUndefined();
    second.handlers.complete(second.payload, "b");
    expect(fieldValues.value.level.settled).toBe(1);
  });

  it("ignores an earlier fetch that ends after a newer one started", () => {
    const { fetchFieldValues, fieldValues, resetFieldValues } = useFieldValuesStream(gt);
    resetFieldValues("level", true);
    const before = mockFetchQueryDataWithHttpStream.mock.calls.length;
    withTraceIds("old", "new");
    fetchFieldValues({ ...s1 });
    fetchFieldValues({ ...s1, size: 20 });
    const [stale, current] = callsSince(before);
    expect(fieldValues.value.level.generation).toBe(2);
    stale.handlers.complete(stale.payload, "old");
    expect(fieldValues.value.level.settled).toBeUndefined();
    current.handlers.complete(current.payload, "new");
    expect(fieldValues.value.level.settled).toBe(2);
  });

  it("ignores a late answer, error or close from an older fetch", () => {
    const { fetchFieldValues, fieldValues, resetFieldValues } = useFieldValuesStream(gt);
    const before = mockFetchQueryDataWithHttpStream.mock.calls.length;
    withTraceIds("old", "new");
    resetFieldValues("level", true);
    fetchFieldValues({ ...s1 });
    resetFieldValues("level", true);
    fetchFieldValues({ ...s1, size: 20 });
    const [stale, current] = callsSince(before);
    stale.handlers.data(stale.payload, {
      type: "search_response_hits",
      content: { results: { hits: [{ values: [hit("stale", 9)] }] } },
    });
    stale.handlers.error(stale.payload, new Error("late"));
    stale.handlers.complete(stale.payload, "old");
    expect(fieldValues.value.level).toMatchObject({ values: [], isLoading: true, errMsg: "" });
    current.handlers.data(current.payload, {
      type: "search_response_hits",
      content: { results: { hits: [{ values: [hit("fresh", 1)] }] } },
    });
    expect(fieldValues.value.level.values).toEqual([{ key: "fresh", count: 1 }]);
  });

  it("settles once a failed stream and a finished stream have both ended", () => {
    const { fetchFieldValues, fieldValues, resetFieldValues } = useFieldValuesStream(gt);
    resetFieldValues("level", true);
    const before = mockFetchQueryDataWithHttpStream.mock.calls.length;
    withTraceIds("a", "b");
    fetchFieldValues([{ ...s1 }, { ...s2 }]);
    const [failing, finishing] = callsSince(before);
    failing.handlers.error(failing.payload, new Error("boom"));
    expect(fieldValues.value.level.settled).toBeUndefined();
    finishing.handlers.complete(finishing.payload, "b");
    expect(fieldValues.value.level.settled).toBe(1);
  });

  it("ends paging when a load more adds no value the list did not already show (U4)", () => {
    const { fetchFieldValues, fetchMoreFieldValues, fieldValues, resetFieldValues } =
      useFieldValuesStream(gt);
    resetFieldValues("level", true);
    const page = (size: number) => [
      { ...s1, size },
      { ...s2, size },
    ];
    let before = mockFetchQueryDataWithHttpStream.mock.calls.length;
    withTraceIds("a", "b");
    fetchFieldValues(page(2));
    const answer = (calls: ReturnType<typeof callsSince>, ids: string[]) => {
      calls[0].handlers.data(calls[0].payload, {
        type: "search_response_hits",
        content: { results: { hits: [{ values: [hit("a", 9), hit("b", 8)] }] } },
      });
      calls[1].handlers.data(calls[1].payload, {
        type: "search_response_hits",
        content: { results: { hits: [{ values: [hit("c", 7), hit("d", 6)] }] } },
      });
      calls.forEach((call, i) => call.handlers.complete(call.payload, ids[i]));
    };
    answer(callsSince(before), ["a", "b"]);
    expect(fieldValues.value.level).toMatchObject({ hasMore: true, settled: 1 });
    before = mockFetchQueryDataWithHttpStream.mock.calls.length;
    withTraceIds("c", "d");
    fetchMoreFieldValues(page(4));
    const more = callsSince(before);
    answer(more, ["c", "d"]);
    expect(fieldValues.value.level.values).toHaveLength(4);
    expect(fieldValues.value.level).toMatchObject({ hasMore: false, settled: 2 });
  });

  it("keeps paging and reports the error when a load more fails, then retries cleanly (F2)", () => {
    const { fetchFieldValues, fetchMoreFieldValues, fieldValues, resetFieldValues } =
      useFieldValuesStream(gt);
    resetFieldValues("level", true);
    withTraceIds("first");
    fetchFieldValues({ ...s1, size: 2 });
    const first = lastCall();
    first.handlers.data(first.payload, {
      type: "search_response_hits",
      content: { results: { hits: [{ values: [hit("a", 9), hit("b", 8)] }] } },
    });
    first.handlers.complete(first.payload, "first");
    expect(fieldValues.value.level.hasMore).toBe(true);
    withTraceIds("more");
    fetchMoreFieldValues({ ...s1, size: 4 });
    fieldValues.value.level.hasMore = false;
    const more = lastCall();
    more.handlers.error(more.payload, new Error("boom"));
    expect(fieldValues.value.level).toMatchObject({ hasMore: true, settled: 2 });
    expect(fieldValues.value.level.errMsg).not.toBe("");
    expect(fieldValues.value.level.values).toHaveLength(2);
    withTraceIds("retry");
    fetchMoreFieldValues({ ...s1, size: 4 });
    expect(fieldValues.value.level.errMsg).toBe("");
    const retry = lastCall();
    retry.handlers.data(retry.payload, {
      type: "search_response_hits",
      content: { results: { hits: [{ values: [hit("a", 9), hit("b", 8), hit("c", 1)] }] } },
    });
    retry.handlers.complete(retry.payload, "retry");
    expect(fieldValues.value.level.values).toHaveLength(3);
  });

  it("reports a field settled only once every request of its latest fetch has ended", () => {
    const { fetchFieldValues, isFetchSettled, resetFieldValues } = useFieldValuesStream(gt);
    expect(isFetchSettled("level")).toBe(true);
    resetFieldValues("level", true);
    const before = mockFetchQueryDataWithHttpStream.mock.calls.length;
    withTraceIds("a", "b");
    fetchFieldValues([{ ...s1 }, { ...s2 }]);
    const [first, second] = callsSince(before);
    first.handlers.complete(first.payload, "a");
    expect(isFetchSettled("level")).toBe(false);
    second.handlers.complete(second.payload, "b");
    expect(isFetchSettled("level")).toBe(true);
  });

  describe("the list before a value search (U1)", () => {
    const loadUnfiltered = (hasMoreValues: boolean) => {
      const api = useFieldValuesStream(gt);
      api.resetFieldValues("level", true);
      withTraceIds("first");
      api.fetchFieldValues({ ...s1, size: 2 });
      const first = lastCall();
      first.handlers.data(first.payload, {
        type: "search_response_hits",
        content: {
          results: {
            hits: [{ values: hasMoreValues ? [hit("a", 9), hit("b", 8)] : [hit("a", 9)] }],
          },
        },
      });
      first.handlers.complete(first.payload, "first");
      return api;
    };

    it("puts the values, hasMore and paging cursor back as they were", () => {
      const api = loadUnfiltered(false);
      expect(api.fieldValues.value.level.hasMore).toBe(false);
      api.rememberUnfiltered("level", 30);
      api.resetFieldValues("level", true);
      withTraceIds("search");
      api.fetchFieldValues({ ...s1, size: 2, keyword: "a" });
      const search = lastCall();
      expect(api.restoreUnfiltered("level")).toBe(30);
      search.handlers.data(search.payload, {
        type: "search_response_hits",
        content: { results: { hits: [{ values: [hit("late", 1)] }] } },
      });
      expect(api.fieldValues.value.level).toMatchObject({
        values: [{ key: "a", count: 9 }],
        hasMore: false,
        isLoading: false,
      });
      expect(api.fieldValues.value.level.settled).toBe(api.fieldValues.value.level.generation);
      expect(api.restoreUnfiltered("level")).toBeNull();
    });

    it("keeps the first copy while the search term grows", () => {
      const api = loadUnfiltered(true);
      api.rememberUnfiltered("level", 2);
      api.resetFieldValues("level", true);
      withTraceIds("search");
      api.fetchFieldValues({ ...s1, size: 2, keyword: "a" });
      const search = lastCall();
      search.handlers.data(search.payload, {
        type: "search_response_hits",
        content: { results: { hits: [{ values: [hit("a", 9)] }] } },
      });
      search.handlers.complete(search.payload, "search");
      api.rememberUnfiltered("level", 2);
      api.restoreUnfiltered("level");
      expect(api.fieldValues.value.level.values).toHaveLength(2);
      expect(api.fieldValues.value.level.hasMore).toBe(true);
    });

    it("drops the copy once a fetch asks for another list", () => {
      const api = loadUnfiltered(true);
      api.rememberUnfiltered("level", 2);
      api.fetchFieldValues({ ...s1, size: 2, keyword: "a", start_time: 1 });
      expect(api.restoreUnfiltered("level")).toBeNull();
    });

    it("keeps no copy of a list still streaming, or after the field forgot it", () => {
      const api = useFieldValuesStream(gt);
      api.resetFieldValues("level", true);
      api.fetchFieldValues({ ...s1 });
      api.fieldValues.value.level.values = [{ key: "a", count: 1 }];
      api.rememberUnfiltered("level", 10);
      expect(api.restoreUnfiltered("level")).toBeNull();
      const settled = loadUnfiltered(true);
      settled.rememberUnfiltered("level", 2);
      settled.forgetUnfiltered("level");
      expect(settled.restoreUnfiltered("level")).toBeNull();
    });
  });

  it("keeps two same-named fields apart under the keys the caller gives them", () => {
    const { fetchFieldValues, fieldValues, cancelFieldStream } = useFieldValuesStream(gt);
    const request = LOGS_FIELD_VALUES_PARITY.quickSingle[0];
    fetchFieldValues({ ...request }, "main:level");
    const main = lastCall();
    fetchFieldValues({ ...request, stream_name: "joined" }, "join:level");
    const join = lastCall();
    expect(main.payload.queryReq).toEqual(request);
    main.handlers.data(main.payload, {
      type: "search_response_hits",
      content: { results: { hits: [{ values: [hit("error", 3)] }] } },
    });
    join.handlers.data(join.payload, {
      type: "search_response_hits",
      content: { results: { hits: [{ values: [hit("warn", 1)] }] } },
    });
    expect(fieldValues.value["main:level"].values).toEqual([{ key: "error", count: 3 }]);
    expect(fieldValues.value["join:level"].values).toEqual([{ key: "warn", count: 1 }]);
    expect(fieldValues.value.level).toBeUndefined();
    cancelFieldStream("join:level");
    expect(mockCancelStreamQuery).toHaveBeenCalledTimes(1);
  });
});

describe("stripFieldCondition", () => {
  it("drops the field's own condition and keeps the others", () => {
    expect(stripFieldCondition("a='1' AND b='2'", "a")).toBe("b='2'");
    expect(stripFieldCondition("(a='1' OR a='2') AND b='2'", "a")).toBe("b='2'");
    expect(stripFieldCondition("a IS NULL AND b='2'", "a")).toBe("b='2'");
  });

  it("returns an empty string when nothing is left", () => {
    expect(stripFieldCondition("a='1'", "a")).toBe("");
    expect(stripFieldCondition("", "a")).toBe("");
  });

  it("leaves a field whose name only ends with the stripped name alone", () => {
    expect(stripFieldCondition("db_a='1' AND a='2'", "a")).toBe("db_a='1'");
  });
});

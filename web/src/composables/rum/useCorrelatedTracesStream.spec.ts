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
import useCorrelatedTracesStream from "@/composables/rum/useCorrelatedTracesStream";
import i18nInstance from "@/locales";
const t = (i18nInstance.global as any).t;

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockFetchQueryDataWithHttpStream = vi.fn();
vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: (...args: any[]) => mockFetchQueryDataWithHttpStream(...args),
  }),
}));

const mockGetStreams = vi.fn();
vi.mock("@/composables/useStreams", () => ({
  default: () => ({ getStreams: mockGetStreams }),
}));

const mockGetTraceTimeRanges = vi.fn();
vi.mock("@/services/search", () => ({
  default: { get_trace_time_ranges: (...args: any[]) => mockGetTraceTimeRanges(...args) },
}));

vi.mock("@/utils/zincutils", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, generateTraceContext: () => ({ traceId: "mock-trace-context-id" }) };
});

// A store mock whose commit REALLY mutates state, mirroring the production
// setCorrelatedTracesStream mutation, so caching behavior is observable.
const mockStoreState = {
  selectedOrganization: { identifier: "test-org" },
  organizationData: {
    correlatedTracesStreams: {
      byTraceId: {} as Record<string, { stream: string; range?: any }>,
      knownStreams: [] as string[],
    },
  },
};
const mockCommit = vi.fn((type: string, payload: any) => {
  if (type !== "setCorrelatedTracesStream") return;
  const cache = mockStoreState.organizationData.correlatedTracesStreams;
  if (Object.keys(cache.byTraceId).length >= 1000) cache.byTraceId = {};
  cache.byTraceId[payload.traceId] = { stream: payload.stream, range: payload.range };
  if (!cache.knownStreams.includes(payload.stream)) cache.knownStreams.push(payload.stream);
});
vi.mock("vuex", () => ({
  useStore: () => ({ state: mockStoreState, commit: mockCommit }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const T1 = "01a034c1aabc72f78880daf6c9755cff";
const T2 = "0badc0ffee0ddf00dd15ea5eba5eba11";
const T3 = "01a038ddccc770b9bba3b2df20c12415";

function streamOfSql(sql: string): string {
  return sql.match(/from "([^"]+)"/)?.[1] ?? "";
}

function idsOfSql(sql: string): string[] {
  return [...sql.matchAll(/[0-9a-f]{32}/g)].map((m) => m[0]);
}

/**
 * Configure the batched client modeling the REAL wire shape (verified live):
 * each sub-query emits a `search_response_metadata` event whose results carry
 * `query_index`, followed by a separate `search_response_hits` event that has
 * ONLY `{hits}` — no query_index. Pairs are emitted in REVERSE sub-query order
 * to simulate nondeterministic arrival, and hits duplicate per span row (the
 * probe scans span rows, not distinct traces).
 */
function mockBatch(hitsByStream: Record<string, string[]>) {
  mockFetchQueryDataWithHttpStream.mockImplementation((args: any, handlers: any) => {
    const sqls: string[] = args.queryReq.query.sql;
    const pairs: any[][] = [];
    sqls.forEach((sql, queryIndex) => {
      const stream = streamOfSql(sql);
      const wanted = idsOfSql(sql);
      const present = (hitsByStream[stream] ?? []).filter((id) => wanted.includes(id));
      // every sub-query emits its metadata event, hits or not (as on the wire)
      pairs.push([
        {
          type: "search_response_metadata",
          content: { results: { hits: [], total: present.length, query_index: queryIndex } },
        },
        {
          type: "search_response_hits",
          content: {
            // duplicate rows: real traces have many spans per id
            results: { hits: present.flatMap((id) => [{ trace_id: id }, { trace_id: id }]) },
          },
        },
      ]);
    });
    for (const pair of pairs.reverse()) {
      for (const chunk of pair) handlers.data(null, chunk);
    }
    handlers.complete();
    return Promise.resolve();
  });
}

/** A `traces/time_range` response body, as the axios wrapper delivers it. */
function indexResponse(results: any[], partialCoverage = false) {
  return { data: { results, partial_coverage: partialCoverage } };
}

function indexedIds(callIndex = 0): string[] {
  return mockGetTraceTimeRanges.mock.calls[callIndex][0].trace_ids;
}

function batchCalls(): string[][] {
  return mockFetchQueryDataWithHttpStream.mock.calls.map(([args]: any[]) =>
    args.queryReq.query.sql.map(streamOfSql),
  );
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("useCorrelatedTracesStream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStoreState.organizationData.correlatedTracesStreams = { byTraceId: {}, knownStreams: [] };
    mockGetStreams.mockResolvedValue({
      list: [{ name: "payments_traces" }, { name: "default" }, { name: "checkout_traces" }],
    });
    // Default: the index has no coverage for these ids, so the probe answers.
    // Every probe-path expectation below therefore reads exactly as it did
    // before the index became the primary path.
    mockGetTraceTimeRanges.mockResolvedValue(indexResponse([], true));
  });

  it("① first-ever id: one batch over all streams, default ordered first, seeds knownStreams", async () => {
    mockBatch({ payments_traces: [T1] });
    const { resolveTraceLocation } = useCorrelatedTracesStream(t);

    expect((await resolveTraceLocation(T1, 1_000, 2_000)).stream).toBe("payments_traces");
    expect(batchCalls()).toEqual([["default", "payments_traces", "checkout_traces"]]);
    expect(mockStoreState.organizationData.correlatedTracesStreams.knownStreams).toEqual([
      "payments_traces",
    ]);
  });

  it("①b second new id probes ONLY knownStreams — no full batch", async () => {
    mockBatch({ payments_traces: [T1, T2] });
    const { resolveTraceLocation } = useCorrelatedTracesStream(t);
    await resolveTraceLocation(T1, 1_000, 2_000);
    mockFetchQueryDataWithHttpStream.mockClear();

    expect((await resolveTraceLocation(T2, 1_000, 2_000)).stream).toBe("payments_traces");
    expect(batchCalls()).toEqual([["payments_traces"]]);
  });

  it("② single-stream org: that stream is the answer, zero probes", async () => {
    mockGetStreams.mockResolvedValue({ list: [{ name: "only_traces" }] });
    const { resolveTraceLocation } = useCorrelatedTracesStream(t);

    expect((await resolveTraceLocation(T1, 1_000, 2_000)).stream).toBe("only_traces");
    expect(mockFetchQueryDataWithHttpStream).not.toHaveBeenCalled();
  });

  it("③ same id in two streams: first in stream order wins regardless of arrival order", async () => {
    // T1 exists in default AND checkout; chunks arrive reversed (checkout first)
    mockBatch({ default: [T1], checkout_traces: [T1] });
    const { resolveTraceLocation } = useCorrelatedTracesStream(t);

    expect((await resolveTraceLocation(T1, 1_000, 2_000)).stream).toBe("default");
  });

  it("④ second resolve of the same id reads the cache: zero queries", async () => {
    mockBatch({ payments_traces: [T1] });
    const { resolveTraceLocation } = useCorrelatedTracesStream(t);
    await resolveTraceLocation(T1, 1_000, 2_000);
    mockFetchQueryDataWithHttpStream.mockClear();
    mockGetStreams.mockClear();

    expect((await resolveTraceLocation(T1, 1_000, 2_000)).stream).toBe("payments_traces");
    expect(mockFetchQueryDataWithHttpStream).not.toHaveBeenCalled();
    expect(mockGetStreams).not.toHaveBeenCalled();
  });

  it("⑤ all-miss returns default and caches nothing", async () => {
    mockBatch({});
    const { resolveTraceLocation } = useCorrelatedTracesStream(t);

    expect((await resolveTraceLocation(T1, 1_000, 2_000)).stream).toBe("default");
    expect(mockStoreState.organizationData.correlatedTracesStreams.byTraceId).toEqual({});
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it("⑥ errors everywhere: returns default, never rejects", async () => {
    mockGetStreams.mockRejectedValue(new Error("boom"));
    mockFetchQueryDataWithHttpStream.mockImplementation(() => {
      throw new Error("boom");
    });
    const { resolveTraceLocation } = useCorrelatedTracesStream(t);

    await expect(resolveTraceLocation(T1, 1_000, 2_000)).resolves.toEqual({
      stream: "default",
    });
  });

  it("⑦ legacy 31-char input probes the padded canonical id", async () => {
    mockBatch({ default: [T1] });
    const { resolveTraceLocation } = useCorrelatedTracesStream(t);

    // T1 minus its leading zero, as SDK 0.4.x stored it
    expect((await resolveTraceLocation(T1.slice(1), 1_000, 2_000)).stream).toBe("default");
    const sql = mockFetchQueryDataWithHttpStream.mock.calls[0][0].queryReq.query.sql[0];
    expect(sql).toContain(`'${T1}'`);
    expect(sql).not.toContain(`'${T1.slice(1)}'`);
    // probes must count distinct traces, not span rows — a single trace's
    // spans would otherwise consume the whole limit (found live on pentest)
    expect(sql.toLowerCase()).toContain("select distinct trace_id");
  });

  it("⑧ two concurrent resolves of one id share a single probe pass", async () => {
    mockBatch({ payments_traces: [T1] });
    const { resolveTraceLocation } = useCorrelatedTracesStream(t);

    const [a, b] = await Promise.all([
      resolveTraceLocation(T1, 1_000, 2_000),
      resolveTraceLocation(T1, 1_000, 2_000),
    ]);

    expect(a.stream).toBe("payments_traces");
    expect(b.stream).toBe("payments_traces");
    expect(mockFetchQueryDataWithHttpStream).toHaveBeenCalledTimes(1);
  });

  describe("resolveTraceLocationsBulk", () => {
    it("resolves the whole id-set in one request and returns id→stream pairs", async () => {
      mockBatch({ payments_traces: [T1, T2], checkout_traces: [T3] });
      const { resolveTraceLocationsBulk } = useCorrelatedTracesStream(t);

      const result = await resolveTraceLocationsBulk([T1, T2, T3], 1_000, 2_000);

      expect(result).toEqual({
        [T1]: { stream: "payments_traces" },
        [T2]: { stream: "payments_traces" },
        [T3]: { stream: "checkout_traces" },
      });
      // cold: knownStreams empty → step 1 covers ALL streams → no second request
      expect(mockFetchQueryDataWithHttpStream).toHaveBeenCalledTimes(1);
    });

    it("escalates only unresolved ids to unprobed streams (step 2)", async () => {
      mockBatch({ payments_traces: [T1], checkout_traces: [T3] });
      const { resolveTraceLocation, resolveTraceLocationsBulk } = useCorrelatedTracesStream(t);
      // learn payments first so step 1 probes only knownStreams
      await resolveTraceLocation(T1, 1_000, 2_000);
      mockFetchQueryDataWithHttpStream.mockClear();

      const result = await resolveTraceLocationsBulk([T2, T3], 1_000, 2_000);

      // T3 found in checkout via escalation; T2 exists nowhere → absent
      expect(result).toEqual({ [T3]: { stream: "checkout_traces" } });
      const calls = batchCalls();
      expect(calls[0]).toEqual(["payments_traces"]); // step 1: knownStreams only
      expect(calls[1]).toEqual(["default", "checkout_traces"]); // step 2: the rest
      // step 2 asked only for the unresolved ids
      const step2Sql: string[] =
        mockFetchQueryDataWithHttpStream.mock.calls[1][0].queryReq.query.sql;
      for (const sql of step2Sql) {
        expect(idsOfSql(sql).sort()).toEqual([T3, T2].sort());
      }
      expect(mockStoreState.organizationData.correlatedTracesStreams.knownStreams).toContain(
        "checkout_traces",
      );
    });

    it("merges already-cached ids without probing them", async () => {
      mockBatch({ payments_traces: [T1, T2] });
      const { resolveTraceLocation, resolveTraceLocationsBulk } = useCorrelatedTracesStream(t);
      await resolveTraceLocation(T1, 1_000, 2_000);
      mockFetchQueryDataWithHttpStream.mockClear();

      const result = await resolveTraceLocationsBulk([T1, T2], 1_000, 2_000);

      expect(result[T1].stream).toBe("payments_traces");
      expect(result[T2].stream).toBe("payments_traces");
      const probedIds = mockFetchQueryDataWithHttpStream.mock.calls.flatMap(([args]: any[]) =>
        args.queryReq.query.sql.flatMap(idsOfSql),
      );
      expect(probedIds).not.toContain(T1);
    });
  });

  describe("traces/time_range lookup", () => {
    it("resolves from the index without probing, and seeds knownStreams", async () => {
      mockGetTraceTimeRanges.mockResolvedValue(
        indexResponse([
          {
            trace_id: T1,
            stream: "payments_traces",
            status: "found",
            range: { start_time: 5_000, end_time: 9_000 },
          },
        ]),
      );
      const { resolveTraceLocation } = useCorrelatedTracesStream(t);

      expect((await resolveTraceLocation(T1, 1_000, 2_000)).stream).toBe("payments_traces");
      expect(mockGetTraceTimeRanges).toHaveBeenCalledTimes(1);
      expect(mockFetchQueryDataWithHttpStream).not.toHaveBeenCalled();
      expect(mockStoreState.organizationData.correlatedTracesStreams.knownStreams).toEqual([
        "payments_traces",
      ]);
    });

    it("sends the org, the bounds and a locate hint", async () => {
      mockGetTraceTimeRanges.mockResolvedValue(
        indexResponse([{ trace_id: T1, stream: "default", status: "found" }]),
      );
      const { resolveTraceLocation } = useCorrelatedTracesStream(t);
      await resolveTraceLocation(T1, 1_000, 2_000);

      expect(mockGetTraceTimeRanges).toHaveBeenCalledWith({
        org_identifier: "test-org",
        trace_ids: [T1],
        start_time: 1_000,
        end_time: 2_000,
        hint_ts: 1_000,
        streams: undefined,
      });
    });

    it("an authoritative not_found returns default, probes nothing and caches nothing", async () => {
      mockGetTraceTimeRanges.mockResolvedValue(
        indexResponse([{ trace_id: T1, status: "not_found" }]),
      );
      const { resolveTraceLocation } = useCorrelatedTracesStream(t);

      expect((await resolveTraceLocation(T1, 1_000, 2_000)).stream).toBe("default");
      expect(mockFetchQueryDataWithHttpStream).not.toHaveBeenCalled();
      expect(mockStoreState.organizationData.correlatedTracesStreams.byTraceId).toEqual({});
    });

    it("partial coverage escalates only the ids the index could not answer", async () => {
      mockGetTraceTimeRanges.mockResolvedValue(
        indexResponse(
          [
            { trace_id: T1, stream: "payments_traces", status: "found" },
            { trace_id: T2, status: "not_found" },
          ],
          true,
        ),
      );
      mockBatch({ checkout_traces: [T2] });
      const { resolveTraceLocationsBulk } = useCorrelatedTracesStream(t);

      const result = await resolveTraceLocationsBulk([T1, T2], 1_000, 2_000);

      expect(result).toEqual({
        [T1]: { stream: "payments_traces" },
        [T2]: { stream: "checkout_traces" },
      });
      const probedIds = mockFetchQueryDataWithHttpStream.mock.calls.flatMap(([args]: any[]) =>
        args.queryReq.query.sql.flatMap(idsOfSql),
      );
      expect(probedIds).toContain(T2);
      expect(probedIds).not.toContain(T1);
    });

    it("a timed-out key is probed — a timeout is not absence", async () => {
      mockGetTraceTimeRanges.mockResolvedValue(
        indexResponse([
          { trace_id: T1, stream: "payments_traces", status: "found" },
          { trace_id: T2, status: "timeout" },
        ]),
      );
      mockBatch({ checkout_traces: [T2] });
      const { resolveTraceLocationsBulk } = useCorrelatedTracesStream(t);

      const result = await resolveTraceLocationsBulk([T1, T2], 1_000, 2_000);

      expect(result).toEqual({
        [T1]: { stream: "payments_traces" },
        [T2]: { stream: "checkout_traces" },
      });
      const probedIds = mockFetchQueryDataWithHttpStream.mock.calls.flatMap(([args]: any[]) =>
        args.queryReq.query.sql.flatMap(idsOfSql),
      );
      expect([...new Set(probedIds)]).toEqual([T2]);
    });

    it("a duplicate hit resolves to the first stream in client order", async () => {
      mockGetTraceTimeRanges.mockResolvedValue(
        indexResponse([
          { trace_id: T1, stream: "checkout_traces", status: "found" },
          { trace_id: T1, stream: "default", status: "found" },
        ]),
      );
      const { resolveTraceLocation } = useCorrelatedTracesStream(t);

      expect((await resolveTraceLocation(T1, 1_000, 2_000)).stream).toBe("default");
    });

    it("chunks past the server's 100-id cap and merges the answers", async () => {
      const ids = Array.from({ length: 250 }, (_, index) => index.toString(16).padStart(32, "0"));
      mockGetTraceTimeRanges.mockImplementation((options: any) =>
        Promise.resolve(
          indexResponse(
            options.trace_ids.map((id: string) => ({
              trace_id: id,
              stream: "payments_traces",
              status: "found",
            })),
          ),
        ),
      );
      const { resolveTraceLocationsBulk } = useCorrelatedTracesStream(t);

      const result = await resolveTraceLocationsBulk(ids, 1_000, 2_000);

      expect(mockGetTraceTimeRanges).toHaveBeenCalledTimes(3);
      expect(indexedIds(0)).toHaveLength(100);
      expect(indexedIds(2)).toHaveLength(50);
      expect(Object.keys(result)).toHaveLength(250);
      expect(mockFetchQueryDataWithHttpStream).not.toHaveBeenCalled();
    });

    it("a transient failure probes and does NOT latch the endpoint off", async () => {
      mockGetTraceTimeRanges.mockRejectedValue({ response: { status: 500 } });
      mockBatch({ payments_traces: [T1, T2] });
      const { resolveTraceLocation } = useCorrelatedTracesStream(t);

      expect((await resolveTraceLocation(T1, 1_000, 2_000)).stream).toBe("payments_traces");
      expect(mockGetTraceTimeRanges).toHaveBeenCalledTimes(1);

      expect((await resolveTraceLocation(T2, 1_000, 2_000)).stream).toBe("payments_traces");
      expect(mockGetTraceTimeRanges).toHaveBeenCalledTimes(2);
    });

    it("carries the indexed range into the resolved location and the cache", async () => {
      const range = { start_time: 5_000, end_time: 9_000 };
      mockGetTraceTimeRanges.mockResolvedValue(
        indexResponse([{ trace_id: T1, stream: "payments_traces", status: "found", range }]),
      );
      const { resolveTraceLocation } = useCorrelatedTracesStream(t);

      expect(await resolveTraceLocation(T1, 1_000, 2_000)).toEqual({
        stream: "payments_traces",
        range,
      });
      expect(mockStoreState.organizationData.correlatedTracesStreams.byTraceId[T1]).toEqual({
        stream: "payments_traces",
        range,
      });
    });

    it("a probe-path answer carries no range", async () => {
      mockBatch({ payments_traces: [T1] });
      const { resolveTraceLocation } = useCorrelatedTracesStream(t);

      expect(await resolveTraceLocation(T1, 1_000, 2_000)).toEqual({ stream: "payments_traces" });
    });

    it("a single-stream org looks the range up narrowed to that stream", async () => {
      mockGetStreams.mockResolvedValue({ list: [{ name: "only_traces" }] });
      const range = { start_time: 5_000, end_time: 9_000 };
      mockGetTraceTimeRanges.mockResolvedValue(
        indexResponse([{ trace_id: T1, stream: "only_traces", status: "found", range }]),
      );
      const { resolveTraceLocation } = useCorrelatedTracesStream(t);

      expect(await resolveTraceLocation(T1, 1_000, 2_000)).toEqual({
        stream: "only_traces",
        range,
      });
      expect(mockGetTraceTimeRanges.mock.calls[0][0].streams).toEqual(["only_traces"]);
      expect(mockFetchQueryDataWithHttpStream).not.toHaveBeenCalled();
    });

    it("a single-stream org still returns its stream when the index cannot answer", async () => {
      mockGetStreams.mockResolvedValue({ list: [{ name: "only_traces" }] });
      const { resolveTraceLocation } = useCorrelatedTracesStream(t);

      expect(await resolveTraceLocation(T1, 1_000, 2_000)).toEqual({
        stream: "only_traces",
        range: undefined,
      });
      expect(mockFetchQueryDataWithHttpStream).not.toHaveBeenCalled();
    });

    it("a 404 latches the endpoint off for the rest of the session", async () => {
      // A fresh module instance: the latch is module state by design, so this
      // test must not leave the endpoint disabled for the others.
      vi.resetModules();
      const freshComposable = (await import("@/composables/rum/useCorrelatedTracesStream")).default;
      mockGetTraceTimeRanges.mockRejectedValue({ response: { status: 404 } });
      mockBatch({ payments_traces: [T1, T2] });
      const { resolveTraceLocation } = freshComposable(t);

      expect((await resolveTraceLocation(T1, 1_000, 2_000)).stream).toBe("payments_traces");
      expect(mockGetTraceTimeRanges).toHaveBeenCalledTimes(1);

      mockGetTraceTimeRanges.mockClear();
      expect((await resolveTraceLocation(T2, 1_000, 2_000)).stream).toBe("payments_traces");
      expect(mockGetTraceTimeRanges).not.toHaveBeenCalled();
    });
  });
});

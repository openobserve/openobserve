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
      byTraceId: {} as Record<string, string>,
      knownStreams: [] as string[],
    },
  },
};
const mockCommit = vi.fn((type: string, payload: any) => {
  if (type !== "setCorrelatedTracesStream") return;
  const cache = mockStoreState.organizationData.correlatedTracesStreams;
  if (Object.keys(cache.byTraceId).length >= 1000) cache.byTraceId = {};
  cache.byTraceId[payload.traceId] = payload.stream;
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
 * Configure the batched client: for each sub-query, emit hit chunks (tagged
 * with query_index) for ids present in `hitsByStream`, then complete. Chunks
 * are emitted in REVERSE sub-query order to simulate nondeterministic arrival.
 */
function mockBatch(hitsByStream: Record<string, string[]>) {
  mockFetchQueryDataWithHttpStream.mockImplementation((args: any, handlers: any) => {
    const sqls: string[] = args.queryReq.query.sql;
    const chunks: any[] = [];
    sqls.forEach((sql, queryIndex) => {
      const stream = streamOfSql(sql);
      const wanted = idsOfSql(sql);
      const present = (hitsByStream[stream] ?? []).filter((id) => wanted.includes(id));
      if (present.length) {
        chunks.push({
          type: "search_response_hits",
          content: {
            results: { hits: present.map((id) => ({ trace_id: id })), query_index: queryIndex },
          },
        });
      }
    });
    // reversed: later sub-queries "arrive" first
    for (const chunk of chunks.reverse()) handlers.data(null, chunk);
    handlers.complete();
    return Promise.resolve();
  });
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
  });

  it("① first-ever id: one batch over all streams, default ordered first, seeds knownStreams", async () => {
    mockBatch({ payments_traces: [T1] });
    const { resolveTracesStream } = useCorrelatedTracesStream(t);

    expect(await resolveTracesStream(T1, 1_000, 2_000)).toBe("payments_traces");
    expect(batchCalls()).toEqual([["default", "payments_traces", "checkout_traces"]]);
    expect(mockStoreState.organizationData.correlatedTracesStreams.knownStreams).toEqual([
      "payments_traces",
    ]);
  });

  it("①b second new id probes ONLY knownStreams — no full batch", async () => {
    mockBatch({ payments_traces: [T1, T2] });
    const { resolveTracesStream } = useCorrelatedTracesStream(t);
    await resolveTracesStream(T1, 1_000, 2_000);
    mockFetchQueryDataWithHttpStream.mockClear();

    expect(await resolveTracesStream(T2, 1_000, 2_000)).toBe("payments_traces");
    expect(batchCalls()).toEqual([["payments_traces"]]);
  });

  it("② single-stream org: that stream is the answer, zero probes", async () => {
    mockGetStreams.mockResolvedValue({ list: [{ name: "only_traces" }] });
    const { resolveTracesStream } = useCorrelatedTracesStream(t);

    expect(await resolveTracesStream(T1, 1_000, 2_000)).toBe("only_traces");
    expect(mockFetchQueryDataWithHttpStream).not.toHaveBeenCalled();
  });

  it("③ same id in two streams: first in stream order wins regardless of arrival order", async () => {
    // T1 exists in default AND checkout; chunks arrive reversed (checkout first)
    mockBatch({ default: [T1], checkout_traces: [T1] });
    const { resolveTracesStream } = useCorrelatedTracesStream(t);

    expect(await resolveTracesStream(T1, 1_000, 2_000)).toBe("default");
  });

  it("④ second resolve of the same id reads the cache: zero queries", async () => {
    mockBatch({ payments_traces: [T1] });
    const { resolveTracesStream } = useCorrelatedTracesStream(t);
    await resolveTracesStream(T1, 1_000, 2_000);
    mockFetchQueryDataWithHttpStream.mockClear();
    mockGetStreams.mockClear();

    expect(await resolveTracesStream(T1, 1_000, 2_000)).toBe("payments_traces");
    expect(mockFetchQueryDataWithHttpStream).not.toHaveBeenCalled();
    expect(mockGetStreams).not.toHaveBeenCalled();
  });

  it("⑤ all-miss returns default and caches nothing", async () => {
    mockBatch({});
    const { resolveTracesStream } = useCorrelatedTracesStream(t);

    expect(await resolveTracesStream(T1, 1_000, 2_000)).toBe("default");
    expect(mockStoreState.organizationData.correlatedTracesStreams.byTraceId).toEqual({});
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it("⑥ errors everywhere: returns default, never rejects", async () => {
    mockGetStreams.mockRejectedValue(new Error("boom"));
    mockFetchQueryDataWithHttpStream.mockImplementation(() => {
      throw new Error("boom");
    });
    const { resolveTracesStream } = useCorrelatedTracesStream(t);

    await expect(resolveTracesStream(T1, 1_000, 2_000)).resolves.toBe("default");
  });

  it("⑦ legacy 31-char input probes the padded canonical id", async () => {
    mockBatch({ default: [T1] });
    const { resolveTracesStream } = useCorrelatedTracesStream(t);

    // T1 minus its leading zero, as SDK 0.4.x stored it
    expect(await resolveTracesStream(T1.slice(1), 1_000, 2_000)).toBe("default");
    const sql = mockFetchQueryDataWithHttpStream.mock.calls[0][0].queryReq.query.sql[0];
    expect(sql).toContain(`'${T1}'`);
    expect(sql).not.toContain(`'${T1.slice(1)}'`);
  });

  it("⑧ two concurrent resolves of one id share a single probe pass", async () => {
    mockBatch({ payments_traces: [T1] });
    const { resolveTracesStream } = useCorrelatedTracesStream(t);

    const [a, b] = await Promise.all([
      resolveTracesStream(T1, 1_000, 2_000),
      resolveTracesStream(T1, 1_000, 2_000),
    ]);

    expect(a).toBe("payments_traces");
    expect(b).toBe("payments_traces");
    expect(mockFetchQueryDataWithHttpStream).toHaveBeenCalledTimes(1);
  });

  describe("resolveTracesStreamsBulk", () => {
    it("resolves the whole id-set in one request and returns id→stream pairs", async () => {
      mockBatch({ payments_traces: [T1, T2], checkout_traces: [T3] });
      const { resolveTracesStreamsBulk } = useCorrelatedTracesStream(t);

      const result = await resolveTracesStreamsBulk([T1, T2, T3], 1_000, 2_000);

      expect(result).toEqual({
        [T1]: "payments_traces",
        [T2]: "payments_traces",
        [T3]: "checkout_traces",
      });
      // cold: knownStreams empty → step 1 covers ALL streams → no second request
      expect(mockFetchQueryDataWithHttpStream).toHaveBeenCalledTimes(1);
    });

    it("escalates only unresolved ids to unprobed streams (step 2)", async () => {
      mockBatch({ payments_traces: [T1], checkout_traces: [T3] });
      const { resolveTracesStream, resolveTracesStreamsBulk } = useCorrelatedTracesStream(t);
      // learn payments first so step 1 probes only knownStreams
      await resolveTracesStream(T1, 1_000, 2_000);
      mockFetchQueryDataWithHttpStream.mockClear();

      const result = await resolveTracesStreamsBulk([T2, T3], 1_000, 2_000);

      // T3 found in checkout via escalation; T2 exists nowhere → absent
      expect(result).toEqual({ [T3]: "checkout_traces" });
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
      const { resolveTracesStream, resolveTracesStreamsBulk } = useCorrelatedTracesStream(t);
      await resolveTracesStream(T1, 1_000, 2_000);
      mockFetchQueryDataWithHttpStream.mockClear();

      const result = await resolveTracesStreamsBulk([T1, T2], 1_000, 2_000);

      expect(result[T1]).toBe("payments_traces");
      expect(result[T2]).toBe("payments_traces");
      const probedIds = mockFetchQueryDataWithHttpStream.mock.calls.flatMap(([args]: any[]) =>
        args.queryReq.query.sql.flatMap(idsOfSql),
      );
      expect(probedIds).not.toContain(T1);
    });
  });
});

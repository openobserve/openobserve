import { beforeEach, describe, expect, it, vi } from "vitest";
import { overlayRange, overlayStep, readCompareOverlay } from "./service_versions.overlay";
import producer from "@/test/unit/fixtures/serviceVersions/producer.json";
import type { CompareResponse } from "./service_versions";
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  answer: vi.fn(),
  stream: vi.fn(),
  oneShot: vi.fn(),
}));
vi.mock("./stream", () => ({ default: { nameList: mocks.list } }));
vi.mock("./search", () => ({ default: { search: mocks.oneShot } }));
vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: mocks.stream,
    cancelStreamQueryBasedOnRequestId: vi.fn(),
  }),
}));
type Handlers = Record<"data" | "error" | "complete", (request: unknown, event: unknown) => void>;
// Plays `mocks.answer` back as `_search_stream` events, so each case states its SQL answer once.
async function streamed(payload: { queryReq: unknown }, handlers: Handlers) {
  try {
    const { data } = await mocks.answer({ query: payload.queryReq });
    const { hits, ...flags } = data;
    handlers.data(payload, { type: "search_response_metadata", content: { results: flags } });
    handlers.data(payload, {
      type: "search_response_hits",
      content: { results: { hits: hits ?? [] } },
    });
    handlers.complete(payload, null);
  } catch (error) {
    handlers.error(payload, error);
  }
}
const stream = (name: string) => ({
  name,
  schema: [
    "service_name",
    "o2_service_where",
    "o2_service_version",
    "span_kind",
    "_timestamp",
    "reference_parent_span_id",
  ].map((name) => ({ name })),
});
const comparison: CompareResponse = {
  service: "s'vc",
  where_key: "env:prod",
  env: "prod",
  mode: "concurrent",
  aliases_applied: [],
  notes: [],
  baseline_rule: "env_fallback",
  arms: {
    a: { version: "v2", start_time: 1000000, end_time: 2000000 },
    b: { version: "v1", where_key: "env:remote", start_time: 1000000, end_time: 2000000 },
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.stream.mockImplementation(streamed);
  mocks.answer.mockResolvedValue({ data: { hits: [{ ts: 1000000, value: 2 }] } });
});
describe("overlay source coverage", () => {
  it("reads every schema page and aggregates every readable source in one union", async () => {
    mocks.list
      .mockResolvedValueOnce({
        data: { list: Array.from({ length: 100 }, (_, i) => stream(`s${i}`)), total: 101 },
      })
      .mockResolvedValueOnce({ data: { list: [stream("last")], total: 101 } });
    const data = await readCompareOverlay("org", comparison, new AbortController().signal);
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(mocks.answer).toHaveBeenCalledTimes(2);
    expect(data.a).toEqual([{ x: 1000, y: 2 }]);
    const queries = mocks.answer.mock.calls.map(([request]) => request.query.query);
    expect(queries.some((query) => query.sql.includes('"last"'))).toBe(true);
    expect(queries.some((query) => query.sql.includes("o2_service_where='env:remote'"))).toBe(true);
    expect(
      queries.every((query) => query.start_time === 1000000 && query.end_time === 2000000),
    ).toBe(true);
    expect(queries[0].sql).toContain("s''vc");
  });
  it("does not query unstamped streams and returns empty without synthetic samples", async () => {
    mocks.list.mockResolvedValue({ data: { list: [{ name: "legacy", schema: [] }] } });
    expect(await readCompareOverlay("org", comparison, new AbortController().signal)).toEqual({
      a: [],
      b: [],
    });
    expect(mocks.answer).not.toHaveBeenCalled();
  });
  it("fails the overlay on any denied or failed stream instead of showing incomplete totals", async () => {
    mocks.list.mockResolvedValue({ data: { list: [stream("ok"), stream("denied")] } });
    mocks.answer.mockRejectedValueOnce(new Error("403"));
    await expect(
      readCompareOverlay("org", comparison, new AbortController().signal),
    ).rejects.toThrow("403");
  });
  it("rejects partial search responses", async () => {
    mocks.list.mockResolvedValue({ data: { list: [stream("ok")] } });
    mocks.answer.mockResolvedValue({ data: { is_partial: true, hits: [] } });
    await expect(
      readCompareOverlay("org", comparison, new AbortController().signal),
    ).rejects.toThrow("Incomplete");
  });
  it("ignores responses for an obsolete org through query cancellation", async () => {
    const controller = new AbortController();
    mocks.list.mockImplementation(async () => {
      controller.abort();
      return { data: { list: [stream("old-org")] } };
    });
    await expect(readCompareOverlay("org", comparison, controller.signal)).rejects.toThrow();
    expect(mocks.answer).not.toHaveBeenCalled();
  });
});

it("computes latency and error rate over the union rather than averaging per-stream percentiles", async () => {
  mocks.list.mockResolvedValue({ data: { list: [stream("one"), stream("two")] } });
  await readCompareOverlay("org", comparison, new AbortController().signal, "p95");
  expect(mocks.answer.mock.calls[0][0].query.query.sql).toContain(
    "approx_percentile_cont(duration, 0.95)",
  );
  expect(mocks.answer.mock.calls[0][0].query.query.sql).toContain("UNION ALL");
  mocks.answer.mockClear();
  await readCompareOverlay("org", comparison, new AbortController().signal, "error_rate");
  expect(mocks.answer.mock.calls[0][0].query.query.sql).toContain(
    "COUNT(*) FILTER (WHERE span_status = 'ERROR') / COUNT(*)",
  );
});
describe("overlay bucket time", () => {
  it("reads zone-less histogram buckets as UTC, not local time", async () => {
    mocks.list.mockResolvedValue({ data: { list: [stream("only")], total: 1 } });
    mocks.answer.mockResolvedValue({
      data: {
        hits: [
          { ts: "2026-10-26T13:05:00", value: 1 },
          { ts: "2026-10-26T13:10:00Z", value: 2 },
        ],
      },
    });
    const window = {
      start_time: Date.UTC(2026, 9, 26, 13) * 1000,
      end_time: Date.UTC(2026, 9, 26, 13, 20) * 1000,
    };
    const covering: CompareResponse = {
      ...comparison,
      arms: { a: { ...comparison.arms.a, ...window }, b: { ...comparison.arms.b, ...window } },
    };
    const data = await readCompareOverlay("org", covering, new AbortController().signal);
    expect(data.a).toEqual([
      { x: Date.UTC(2026, 9, 26, 13, 5), y: 1 },
      { x: Date.UTC(2026, 9, 26, 13, 10), y: 2 },
    ]);
  });
});

describe("sequential compare overlay on a real producer compare", () => {
  const sequential = structuredClone(producer.regressed.compare) as unknown as CompareResponse;
  const deployAt = producer.regressed.stored_verdict.deploy.at / 1000;
  // Answers like the histogram UDF: spans every 10 s across the arm, binned on epoch multiples of the asked width.
  function histogramSearch(request: {
    query: { query: { sql: string; start_time: number; end_time: number } };
  }) {
    const { sql, start_time, end_time } = request.query.query;
    const asked = /histogram\(_timestamp, '(\d+) (seconds|minutes)'\)/.exec(sql);
    const width = Number(asked?.[1]) * (asked?.[2] === "minutes" ? 60e6 : 1e6);
    const buckets = new Map<number, number>();
    for (let t = start_time; t < end_time; t += 10e6) {
      const bucket = Math.floor(t / width) * width;
      buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
    }
    return Promise.resolve({
      data: { hits: [...buckets].map(([ts, value]) => ({ ts, value })) },
    });
  }
  beforeEach(() => {
    mocks.list.mockResolvedValue({ data: { list: [stream("traces")], total: 1 } });
    mocks.answer.mockImplementation(histogramSearch);
  });
  it("draws the after series to the right of the deploy and keeps each series in its window", async () => {
    expect(sequential.mode).toBe("sequential");
    expect(sequential.arms.a.start_time / 1000).toBe(deployAt);
    const data = await readCompareOverlay("org", sequential, new AbortController().signal);
    expect(data.a.filter((point) => point.x > deployAt).length).toBeGreaterThan(10);
    expect(data.a.every((point) => point.x >= deployAt)).toBe(true);
    const { b } = sequential.arms;
    expect(data.b.length).toBeGreaterThan(10);
    expect(
      data.b.every((point) => point.x >= b.start_time / 1000 && point.x < b.end_time / 1000),
    ).toBe(true);
  });
  it("sizes buckets from the longer window and spans both windows on the axis", () => {
    expect(overlayStep(sequential)).toBe(15);
    expect(overlayRange(sequential)).toEqual({
      min: sequential.arms.b.start_time / 1000,
      max: sequential.arms.a.end_time / 1000,
    });
  });
});
describe("per-minute requests", () => {
  // Arms ending 20 s into a bucket: that bucket counts only a third of its span.
  const arm = { start_time: 600_000_000, end_time: 2_420_000_000 };
  const partial: CompareResponse = {
    ...comparison,
    arms: { a: { version: "v2", ...arm }, b: { version: "v1", ...arm } },
  };
  const step = overlayStep(partial) * 1e6;
  const last = Math.floor(arm.end_time / step) * step;
  beforeEach(() => {
    mocks.list.mockResolvedValue({ data: { list: [stream("traces")] } });
    mocks.answer.mockResolvedValue({
      data: {
        hits: [
          { ts: last - step, value: 60 },
          { ts: last, value: 20 },
        ],
      },
    });
  });
  it("drops the bucket the window ends inside, so the rate never reads as a drop", async () => {
    const data = await readCompareOverlay("org", partial, new AbortController().signal);
    expect(data.a).toEqual([{ x: (last - step) / 1000, y: 60 }]);
    expect(data.b).toEqual([{ x: (last - step) / 1000, y: 60 }]);
  });
  it("keeps the last bucket of other metrics and of a window that ends on a bucket edge", async () => {
    const rate = await readCompareOverlay(
      "org",
      partial,
      new AbortController().signal,
      "error_rate",
    );
    expect(rate.a).toHaveLength(2);
    const edge = { start_time: 600_000_000, end_time: last + step };
    const whole = await readCompareOverlay(
      "org",
      { ...partial, arms: { a: { version: "v2", ...edge }, b: { version: "v1", ...edge } } },
      new AbortController().signal,
    );
    expect(whole.a).toHaveLength(2);
  });
});
describe("overlay per build of one version text", () => {
  const imaged = (name: string) => ({
    ...stream(name),
    schema: [...stream(name).schema, { name: "o2_service_image" }],
  });
  const builds: CompareResponse = {
    ...comparison,
    arms: {
      a: { version: "2.4.0", image: "8ebf1f7", start_time: 1000000, end_time: 2000000 },
      b: { version: "2.4.0", image: "1f08369", start_time: 1000000, end_time: 2000000 },
    },
  };
  // Answers like a stream holding 30 spans of build 8ebf1f7 and 5 of build 1f08369 per bucket.
  function perImage(request: { query: { query: { sql: string } } }) {
    const { sql } = request.query.query;
    const a = sql.includes("8ebf1f7") ? 30 : 0;
    const b = sql.includes("1f08369") ? 5 : 0;
    const all = !sql.includes("o2_service_image") ? 35 : 0;
    return Promise.resolve({ data: { hits: [{ ts: 1000000, value: a + b + all }] } });
  }
  it("draws each build from its own spans, not the combined version text", async () => {
    mocks.list.mockResolvedValue({ data: { list: [imaged("traces")], total: 1 } });
    mocks.answer.mockImplementation(perImage);
    const data = await readCompareOverlay("org", builds, new AbortController().signal);
    expect(data.a).toEqual([{ x: 1000, y: 30 }]);
    expect(data.b).toEqual([{ x: 1000, y: 5 }]);
    const sqls = mocks.answer.mock.calls.map(([request]) => request.query.query.sql as string);
    expect(sqls[0]).toContain("NULLIF(o2_service_image, '') = '8ebf1f7'");
  });
  it("reads an imageless arm as the imageless spans only, and every span of a stream with no image field", async () => {
    mocks.list.mockResolvedValue({
      data: { list: [imaged("stamped"), stream("legacy")], total: 2 },
    });
    const plain: CompareResponse = {
      ...builds,
      arms: { ...builds.arms, a: { ...builds.arms.a, image: null } },
    };
    await readCompareOverlay("org", plain, new AbortController().signal);
    const sql = mocks.answer.mock.calls[0][0].query.query.sql as string;
    expect(sql).toContain('"stamped" WHERE');
    expect(sql).toContain("NULLIF(o2_service_image, '') IS NULL");
    expect(sql.split(" UNION ALL ")[1]).not.toContain("o2_service_image");
  });
  it("skips streams that cannot hold a build's image and draws nothing when none can", async () => {
    mocks.list.mockResolvedValue({ data: { list: [stream("legacy")], total: 1 } });
    const data = await readCompareOverlay("org", builds, new AbortController().signal);
    expect(data).toEqual({ a: [], b: [] });
    expect(mocks.answer).not.toHaveBeenCalled();
  });
});
describe("overlay transport", () => {
  it("reads every overlay series over the streaming search, never the one-shot search", async () => {
    mocks.list.mockResolvedValue({ data: { list: [stream("traces")], total: 1 } });
    await readCompareOverlay("org", comparison, new AbortController().signal);
    expect(mocks.stream).toHaveBeenCalledTimes(2);
    expect(mocks.stream.mock.calls[0][0]).toEqual(
      expect.objectContaining({ type: "search", pageType: "traces", org_id: "org" }),
    );
    expect(mocks.oneShot).not.toHaveBeenCalled();
  });
});

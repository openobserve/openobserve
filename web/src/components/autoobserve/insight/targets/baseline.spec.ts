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

import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ fetch: vi.fn(), cancel: vi.fn() }));
vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: (...a: unknown[]) => api.fetch(...a),
    cancelStreamQueryBasedOnRequestId: (...a: unknown[]) => api.cancel(...a),
  }),
}));

const { BASELINE_LOOKBACK_US, forgetBaselines, measureBaseline } = await import("./baseline");
const { b64DecodeUnicode } = await import("@/utils/zincutils");

const ERRORS = {
  kind: "errors" as const,
  stream: { type: "logs", name: "app_logs" },
  sql: 'SELECT count(*) AS errors FROM "app_logs"',
};
const LATENCY = {
  kind: "latency" as const,
  stream: { type: "traces", name: "app_traces" },
  sql: 'SELECT approx_percentile_cont("duration", 0.95) / 1000 AS p95_ms, count(*) AS requests FROM "app_traces"',
};

const answer = (...chunks: { hits: Record<string, unknown>[]; aggs?: boolean }[]) =>
  api.fetch.mockImplementation((_req: unknown, handlers: any) => {
    for (const chunk of chunks)
      handlers.data(null, {
        type: "search_response_hits",
        content: { streaming_aggs: chunk.aggs, results: { hits: chunk.hits } },
      });
    handlers.complete();
  });

beforeEach(() => {
  api.fetch.mockReset();
  api.cancel.mockReset();
  forgetBaselines();
});

describe("measureBaseline: one usual level per check (T2-N3)", () => {
  it("gives the Add alert dialog and the review list the same p95, measured once", async () => {
    answer({ hits: [{ p95_ms: 119, requests: 900 }] });
    expect(await measureBaseline("demo-org", LATENCY)).toBe(119);
    answer({ hits: [{ p95_ms: 115, requests: 900 }] });
    expect(await measureBaseline("demo-org", LATENCY)).toBe(119);
    expect(api.fetch).toHaveBeenCalledTimes(1);
  });

  it("measures again for another org, and after a failed read", async () => {
    answer({ hits: [{ p95_ms: 119, requests: 900 }] });
    await measureBaseline("demo-org", LATENCY);
    answer({ hits: [{ p95_ms: 80, requests: 900 }] });
    expect(await measureBaseline("other-org", LATENCY)).toBe(80);
    api.fetch.mockImplementation((_req: unknown, handlers: any) => handlers.error());
    expect(await measureBaseline("third-org", LATENCY)).toBeNull();
    answer({ hits: [{ p95_ms: 90, requests: 900 }] });
    expect(await measureBaseline("third-org", LATENCY)).toBe(90);
  });
});

describe("measureBaseline (F1)", () => {
  it("reads the usual hourly error count from one streaming query over the last 7 days", async () => {
    answer({ hits: [{ errors: 336 }] });
    expect(await measureBaseline("demo-org", ERRORS)).toBe(2);
    expect(api.fetch).toHaveBeenCalledTimes(1);
    const req = api.fetch.mock.calls[0][0] as any;
    expect(b64DecodeUnicode(req.queryReq.query.sql)).toBe(ERRORS.sql);
    expect(req.queryReq.query.end_time - req.queryReq.query.start_time).toBe(BASELINE_LOOKBACK_US);
    expect(req.org_id).toBe("demo-org");
    expect(req.pageType).toBe("logs");
  });

  it("spreads the errors over the hours the service has data for, not the whole week (T2-1)", async () => {
    const now = Date.now() * 1000;
    answer({ hits: [{ errors: 17, first_seen: now - 2.5 * 3_600_000_000 }] });
    expect(await measureBaseline("demo-org", ERRORS)).toBeCloseTo(6.8, 1);
  });

  it("counts a service younger than an hour as one hour of data (T2-1)", async () => {
    answer({ hits: [{ errors: 3, first_seen: Date.now() * 1000 - 60_000_000 }] });
    expect(await measureBaseline("demo-org", ERRORS)).toBeCloseTo(3, 1);
  });

  it("takes the earliest start across streamed partitions (T2-1)", async () => {
    const now = Date.now() * 1000;
    answer(
      { hits: [{ errors: 10, first_seen: now - 2 * 3_600_000_000 }] },
      { hits: [{ errors: 10, first_seen: now - 10 * 3_600_000_000 }] },
    );
    expect(await measureBaseline("demo-org", ERRORS)).toBeCloseTo(2, 1);
  });

  it("keeps the last running total when the server streams the aggregate", async () => {
    answer({ hits: [{ errors: 100 }], aggs: true }, { hits: [{ errors: 336 }], aggs: true });
    expect(await measureBaseline("demo-org", ERRORS)).toBe(2);
  });

  it("finds no usual level in a week without errors", async () => {
    answer({ hits: [{ errors: 0 }] });
    expect(await measureBaseline("demo-org", ERRORS)).toBeNull();
  });

  it("reads the usual p95 in milliseconds, only over enough requests", async () => {
    answer({ hits: [{ p95_ms: 250, requests: 900 }] });
    expect(await measureBaseline("demo-org", LATENCY)).toBe(250);
    forgetBaselines();
    answer({ hits: [{ p95_ms: 250, requests: 5 }] });
    expect(await measureBaseline("demo-org", LATENCY)).toBeNull();
  });

  it("answers null when the query fails", async () => {
    api.fetch.mockImplementation((_req: unknown, handlers: any) => handlers.error(null, {}));
    expect(await measureBaseline("demo-org", ERRORS)).toBeNull();
  });

  it("cancels its stream and answers null once the review stops it (F12)", async () => {
    api.fetch.mockImplementation(() => undefined);
    const stop = new AbortController();
    const level = measureBaseline("demo-org", ERRORS, stop.signal);
    stop.abort();
    expect(await level).toBeNull();
    const req = api.fetch.mock.calls[0][0] as any;
    expect(api.cancel).toHaveBeenCalledWith({ trace_id: req.traceId, org_id: "demo-org" });
  });

  it("starts no query once the review is already stopped (F12)", async () => {
    const stop = new AbortController();
    stop.abort();
    expect(await measureBaseline("demo-org", ERRORS, stop.signal)).toBeNull();
    expect(api.fetch).not.toHaveBeenCalled();
  });
});

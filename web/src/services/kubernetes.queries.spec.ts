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
import searchService from "./search";
import { k8sInstantQuery, k8sSqlQuery } from "./kubernetes.queries";
import { k8sKeys } from "./kubernetes.querykeys";
import { LIVE_STALE_TIME } from "@/composables/query/cachePolicy";
import { queryClient } from "@/composables/query/queryClient";

const stream = vi.hoisted(() => ({
  fetch: vi.fn(),
}));

vi.mock("./search", () => ({ default: { metrics_query: vi.fn() } }));
vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: stream.fetch,
  }),
}));

const metricsQuery = vi.mocked(searchService.metrics_query);

const hitsChunk = (hits: any[]) => ({
  type: "search_response_hits",
  content: { results: { hits } },
});

const streamOnce = (chunks: any[]) =>
  stream.fetch.mockImplementation(async (req: any, handlers: any) => {
    chunks.forEach((c) => handlers.data(req, c));
    handlers.complete(req, {});
  });

const ORG = "org1";
const END = 1_700_000_045_000_000;
const START = END - 3_600_000_000;

describe("kubernetes queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    metricsQuery.mockResolvedValue({
      data: { data: { result: [{ metric: { node: "n1" }, value: [1, "2"] }] } },
    } as any);
    streamOnce([hitsChunk([{ n: 1 }])]);
  });

  it("roots every key under the org's kubernetes scope", () => {
    const instant = k8sInstantQuery(ORG, "P1", "up", END, true);
    const sql = k8sSqlQuery(ORG, "E", "SELECT 1", START, END, true);
    expect(instant.queryKey.slice(0, 3)).toEqual(k8sKeys.all(ORG));
    expect(sql.queryKey.slice(0, 3)).toEqual(k8sKeys.all(ORG));
    expect(instant.staleTime).toBe(LIVE_STALE_TIME);
    expect(sql.staleTime).toBe(LIVE_STALE_TIME);
  });

  it("parses an instant vector and sends the encoded query at the exact END", async () => {
    const options = k8sInstantQuery(ORG, "N1", 'up{a="b c"}', END, true);
    const rows = await (options.queryFn as any)();
    expect(rows).toEqual([{ metric: { node: "n1" }, value: 2 }]);
    expect(metricsQuery).toHaveBeenCalledWith({
      org_identifier: ORG,
      query: encodeURIComponent('up{a="b c"}'),
      end_time: END,
    });
  });

  describe("SQL over the search stream", () => {
    const run = (size?: number) =>
      (k8sSqlQuery(ORG, "W", "SELECT 1", START, END, true, size).queryFn as any)();

    it("returns the hits and sends the exact window and size", async () => {
      expect(await run(20001)).toEqual([{ n: 1 }]);
      const [req] = stream.fetch.mock.calls[0];
      expect(req).toMatchObject({
        type: "search",
        pageType: "logs",
        org_id: ORG,
        searchType: "ui",
      });
      expect(req.traceId).toEqual(expect.any(String));
      expect(req.queryReq.query).toEqual({
        sql: "SELECT 1",
        start_time: START,
        end_time: END,
        from: 0,
        size: 20001,
      });
    });

    it("omits size when none is given", async () => {
      await run();
      expect(stream.fetch.mock.calls[0][0].queryReq.query).not.toHaveProperty("size");
    });

    it("appends the hits of successive non-aggregate chunks", async () => {
      streamOnce([hitsChunk([{ n: 1 }]), hitsChunk([{ n: 2 }, { n: 3 }])]);
      expect(await run()).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
    });

    it("ignores chunks that carry no hits", async () => {
      streamOnce([{ type: "search_response_metadata", content: {} }, hitsChunk([{ n: 1 }])]);
      expect(await run()).toEqual([{ n: 1 }]);
    });

    it("rejects with the status when the handler errors", async () => {
      stream.fetch.mockImplementation(async (req: any, handlers: any) =>
        handlers.error(req, { content: { message: "forbidden", status: 403 } }),
      );
      const err: any = await run().catch((e) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe("forbidden");
      expect(err.status).toBe(403);
    });

    it("falls back to a non-empty message when the error payload message is empty", async () => {
      stream.fetch.mockImplementation(async (req: any, handlers: any) =>
        handlers.error(req, { content: { message: "", status: 502 } }),
      );
      const err: any = await run().catch((e) => e);
      expect(err.message).toBe("search stream failed");
      expect(err.status).toBe(502);
    });

    it("reads the status from content.code when content.status is absent", async () => {
      stream.fetch.mockImplementation(async (req: any, handlers: any) =>
        handlers.error(req, { content: { message: "denied", code: 403 } }),
      );
      await expect(run()).rejects.toMatchObject({ message: "denied", status: 403 });
    });

    it("rejects with a null status when the error carries none", async () => {
      stream.fetch.mockImplementation(async (req: any, handlers: any) => handlers.error(req, {}));
      await expect(run()).rejects.toMatchObject({ status: null });
    });
  });

  describe("time in keys", () => {
    it("shares a key for two relative refreshes inside one bucket", () => {
      const a = k8sInstantQuery(ORG, "P1", "up", END, true);
      const b = k8sInstantQuery(ORG, "P1", "up", END + 10_000_000, true);
      expect(a.queryKey).toEqual(b.queryKey);
      const sa = k8sSqlQuery(ORG, "E", "q", START, END, true);
      const sb = k8sSqlQuery(ORG, "E", "q", START + 10_000_000, END + 10_000_000, true);
      expect(sa.queryKey).toEqual(sb.queryKey);
    });

    it("keys an absolute range by its exact µs, and each request uses its exact time", async () => {
      const a = k8sInstantQuery(ORG, "P1", "up", END, false);
      const b = k8sInstantQuery(ORG, "P1", "up", END + 20_000_000, false);
      expect(a.queryKey).not.toEqual(b.queryKey);
      expect(JSON.stringify(b.queryKey)).toContain(String(END + 20_000_000));
      await (b.queryFn as any)();
      expect(metricsQuery.mock.calls[0][0].end_time).toBe(END + 20_000_000);
      const sa = k8sSqlQuery(ORG, "E", "q", START, END, false);
      const sb = k8sSqlQuery(ORG, "E", "q", START, END + 20_000_000, false);
      expect(sa.queryKey).not.toEqual(sb.queryKey);
    });
  });

  it("serves a revisit inside the stale time from the cache", async () => {
    await queryClient.fetchQuery(k8sInstantQuery(ORG, "P1", "up", END, true));
    await queryClient.fetchQuery(k8sInstantQuery(ORG, "P1", "up", END + 5_000_000, true));
    expect(metricsQuery).toHaveBeenCalledTimes(1);
  });
});

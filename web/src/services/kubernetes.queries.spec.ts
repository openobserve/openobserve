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

vi.mock("./search", () => ({ default: { metrics_query: vi.fn(), search: vi.fn() } }));

const metricsQuery = vi.mocked(searchService.metrics_query);
const search = vi.mocked(searchService.search);

const ORG = "org1";
const END = 1_700_000_045_000_000;
const START = END - 3_600_000_000;

describe("kubernetes queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    metricsQuery.mockResolvedValue({
      data: { data: { result: [{ metric: { node: "n1" }, value: [1, "2"] }] } },
    } as any);
    search.mockResolvedValue({ data: { hits: [{ n: 1 }] } } as any);
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

  it("returns SQL hits and sends the exact window and size", async () => {
    const options = k8sSqlQuery(ORG, "W", "SELECT 1", START, END, true, 20001);
    expect(await (options.queryFn as any)()).toEqual([{ n: 1 }]);
    const [args, type] = search.mock.calls[0] as any[];
    expect(type).toBe("ui");
    expect(args.org_identifier).toBe(ORG);
    expect(args.page_type).toBe("logs");
    expect(args.query.query).toMatchObject({
      sql: "SELECT 1",
      start_time: START,
      end_time: END,
      from: 0,
      size: 20001,
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

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
import { QueryClient } from "@tanstack/vue-query";
import autoobserve, { type AutoObserveIncidentList } from "./autoobserve";
import http from "./http";
import {
  autoobserveGapSuggestionsQuery,
  autoobserveIncidentsPageQuery,
  autoobserveSuggestionsPageQuery,
} from "./autoobserve.queries";
import { orgKey } from "@/composables/query/keys";
import { RAIL_CAP } from "@/components/autoobserve/live/liveCopy";
import fixture from "@/components/autoobserve/live/__fixtures__/autoobserveIncidents.json";

vi.mock("./autoobserve", () => ({
  default: { coverage: vi.fn(), suggestions: vi.fn(), incidents: vi.fn() },
}));

vi.mock("./http", () => ({ default: vi.fn() }));

const suggestions = vi.mocked(autoobserve.suggestions);

describe("autoobserveSuggestionsPageQuery (OSS-11)", () => {
  beforeEach(() => {
    suggestions.mockReset();
    suggestions.mockResolvedValue({
      data: { suggestions: [], total: 3000, limit: RAIL_CAP, offset: 0 },
    } as never);
  });

  it("asks for one ranked page of proposed suggestions, however many there are", async () => {
    const client = new QueryClient();
    const page = await client.fetchQuery(autoobserveSuggestionsPageQuery("acme", RAIL_CAP, 0));
    expect(suggestions).toHaveBeenCalledTimes(1);
    expect(suggestions).toHaveBeenCalledWith("acme", {
      status: "proposed",
      sort: "priority",
      limit: RAIL_CAP,
      offset: 0,
    });
    expect(page.total).toBe(3000);
  });

  it("keys each page apart, so paging the drawer never reuses another page", () => {
    const first = autoobserveSuggestionsPageQuery("acme", 25, 0).queryKey;
    const second = autoobserveSuggestionsPageQuery("acme", 25, 25).queryKey;
    expect(first).not.toEqual(second);
    expect(autoobserveSuggestionsPageQuery("acme", RAIL_CAP, 0).queryKey).not.toEqual(first);
  });
});

describe("autoobserveGapSuggestionsQuery (F8)", () => {
  const gap = (i: number) => ({ id: `g-${i}`, kind: "coverage_gap" });
  const pages = (total: number, served = total) =>
    suggestions.mockImplementation(async (_org, params) => {
      const from = params.offset ?? 0;
      const to = Math.min(from + (params.limit ?? 0), served);
      const list = Array.from({ length: Math.max(0, to - from) }, (_, k) => gap(from + k));
      return { data: { suggestions: list, total, limit: params.limit, offset: from } } as never;
    });

  beforeEach(() => {
    suggestions.mockReset();
  });

  it("reads every page of proposed gaps, so the group's review holds each one it counts", async () => {
    pages(1201);
    const list = await new QueryClient().fetchQuery(autoobserveGapSuggestionsQuery("acme", 500));
    expect(suggestions.mock.calls).toHaveLength(3);
    expect(suggestions.mock.calls.map(([, p]) => p.offset)).toEqual([0, 500, 1000]);
    for (const [, params] of suggestions.mock.calls)
      expect(params).toMatchObject({ status: "proposed", kind: "coverage_gap", limit: 500 });
    expect(list.suggestions).toHaveLength(1201);
    expect(new Set(list.suggestions.map((s) => s.id)).size).toBe(1201);
    expect(list.total).toBe(1201);
  });

  it("stops at a short page and counts what it read when the total shrank meanwhile", async () => {
    pages(1201, 700);
    const list = await new QueryClient().fetchQuery(autoobserveGapSuggestionsQuery("acme", 500));
    expect(suggestions).toHaveBeenCalledTimes(2);
    expect(list.suggestions).toHaveLength(700);
    expect(list.total).toBe(700);
  });
});

describe("autoobserveIncidentsPageQuery (D9-web)", () => {
  type Interval = (query: { state: { data: unknown } }) => number | false;
  const incidents = vi.mocked(autoobserve.incidents);
  const running = fixture as unknown as AutoObserveIncidentList;
  const settled = { ...running, items: running.items.slice(1) };

  beforeEach(() => {
    incidents.mockReset();
    incidents.mockResolvedValue({ data: running } as never);
  });

  it("the query reads the route and polls only while a run is live", async () => {
    const get = vi.fn().mockResolvedValue({ data: running });
    vi.mocked(http).mockReturnValue({ get } as never);
    const real = await vi.importActual<typeof import("./autoobserve")>("./autoobserve");
    await real.default.incidents("demo-org", { limit: 3, offset: 0 });
    expect(get).toHaveBeenCalledWith("/api/v2/demo-org/autoobserve/incidents", {
      params: { limit: 3, offset: 0 },
    });

    const options = autoobserveIncidentsPageQuery("demo-org", 3, 0);
    expect(options.queryKey).toEqual(orgKey("demo-org", "autoobserve", "incidents", 3, 0));
    const page = await new QueryClient().fetchQuery(options);
    expect(incidents).toHaveBeenCalledWith("demo-org", { limit: 3, offset: 0 });
    expect(page.items).toHaveLength(6);

    const interval = options.refetchInterval as unknown as Interval;
    expect(interval({ state: { data: running } })).toBe(30_000);
    expect(interval({ state: { data: settled } })).toBe(false);
    expect(interval({ state: { data: undefined } })).toBe(false);
  });
});

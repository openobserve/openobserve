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

import { describe, expect, it, vi } from "vitest";
import overview from "./overview";
import { OVERVIEW_TOP, orgOverviewQuery } from "./overview.queries";
import { overviewKeys } from "./overview.querykeys";
import { LIVE_STALE_TIME } from "@/composables/query/cachePolicy";

vi.mock("./overview", () => ({ default: { getOrgOverview: vi.fn() } }));

const BODY = { streams: { status: "ok" }, generated_at: 1, cached: false };

describe("orgOverviewQuery", () => {
  it("keys per org and top, never by refresh", () => {
    const normal = orgOverviewQuery("acme");
    const forced = orgOverviewQuery("acme", { refresh: true });
    expect(normal.queryKey).toEqual(overviewKeys.data("acme", OVERVIEW_TOP));
    expect(forced.queryKey).toEqual(normal.queryKey);
    expect(orgOverviewQuery("acme", { top: 10 }).queryKey).not.toEqual(normal.queryKey);
    expect(orgOverviewQuery("other").queryKey).not.toEqual(normal.queryKey);
  });

  it("uses the live freshness tier", () => {
    expect(orgOverviewQuery("acme").staleTime).toBe(LIVE_STALE_TIME);
  });

  it("returns the response body unmapped and asks for top without refresh by default", async () => {
    vi.mocked(overview.getOrgOverview).mockResolvedValue({ data: BODY } as never);
    const result = await (orgOverviewQuery("acme").queryFn as () => Promise<unknown>)();
    expect(result).toBe(BODY);
    expect(overview.getOrgOverview).toHaveBeenCalledWith("acme", {
      top: OVERVIEW_TOP,
      refresh: undefined,
    });
  });

  it("passes refresh=true on a forced read", async () => {
    vi.mocked(overview.getOrgOverview).mockResolvedValue({ data: BODY } as never);
    await (orgOverviewQuery("acme", { refresh: true }).queryFn as () => Promise<unknown>)();
    expect(overview.getOrgOverview).toHaveBeenLastCalledWith("acme", {
      top: OVERVIEW_TOP,
      refresh: true,
    });
  });
});

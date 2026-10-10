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

import { describe, expect, it } from "vitest";
import {
  acceptsPageLoad,
  recordPageLoad,
  recordPageRequest,
  unbindForRetry,
  type PageCrossingGrid,
  type PageCrossingNavigation,
} from "@/utils/pageCrossing";

const fresh = (): { navigation: PageCrossingNavigation; grid: PageCrossingGrid } => ({
  navigation: { pendingPageSelection: null },
  grid: { pageRequest: null, pageLoad: null },
});

describe("page crossing ownership (4a §3.2.2)", () => {
  it("the first page request binds an unbound crossing", () => {
    const { navigation, grid } = fresh();
    navigation.pendingPageSelection = { page: 2, position: "first", requestId: null };
    recordPageRequest(navigation, grid, "t1");
    expect(grid.pageRequest).toEqual({ requestId: "t1" });
    expect(navigation.pendingPageSelection).toEqual({
      page: 2,
      position: "first",
      requestId: "t1",
    });
  });

  it("a later request supersedes a bound crossing", () => {
    const { navigation, grid } = fresh();
    navigation.pendingPageSelection = { page: 2, position: "first", requestId: "t1" };
    recordPageRequest(navigation, grid, "t2");
    expect(navigation.pendingPageSelection).toBeNull();
    expect(grid.pageRequest).toEqual({ requestId: "t2" });
  });

  it("records a request with no crossing pending without inventing one", () => {
    const { navigation, grid } = fresh();
    recordPageRequest(navigation, grid, "t1");
    expect(navigation.pendingPageSelection).toBeNull();
  });

  it("keeps only the first terminal event of a request", () => {
    const { grid } = fresh();
    recordPageLoad(grid, { requestId: "t1", ok: true, reason: "done" });
    recordPageLoad(grid, { requestId: "t1", ok: false, reason: "cancelled" });
    expect(grid.pageLoad).toEqual({ requestId: "t1", ok: true, reason: "done" });
    recordPageLoad(grid, { requestId: "t2", ok: false, reason: "error" });
    expect(grid.pageLoad).toEqual({ requestId: "t2", ok: false, reason: "error" });
  });

  it("accepts a page load only for the bound request", () => {
    const pending = { page: 2, position: "first" as const, requestId: "t1" };
    expect(acceptsPageLoad(pending, { requestId: "t1", ok: true, reason: "done" })).toBe(true);
    expect(acceptsPageLoad(pending, { requestId: "t0", ok: true, reason: "done" })).toBe(false);
    expect(
      acceptsPageLoad(
        { ...pending, requestId: null },
        { requestId: "t1", ok: true, reason: "done" },
      ),
    ).toBe(false);
    expect(acceptsPageLoad(null, { requestId: "t1", ok: true, reason: "done" })).toBe(false);
    expect(acceptsPageLoad(pending, null)).toBe(false);
  });

  it("a retry of the bound request takes the crossing over", () => {
    const { navigation, grid } = fresh();
    navigation.pendingPageSelection = { page: 3, position: "last", requestId: "t1" };
    unbindForRetry(navigation, "t0");
    expect(navigation.pendingPageSelection?.requestId).toBe("t1");
    unbindForRetry(navigation, "t1");
    recordPageRequest(navigation, grid, "t1-retry");
    expect(navigation.pendingPageSelection?.requestId).toBe("t1-retry");
  });
});

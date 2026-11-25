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
import { useExplorerTotal } from "./useExplorerTotal";

describe("useExplorerTotal", () => {
  it("a new query is pending, never the page size, until its count answers", () => {
    const t = useExplorerTotal();
    const run = t.begin();
    t.pageLoaded(run, 0, 100, 100);
    expect(t.total.value).toBeNull();
    expect(t.counting.value).toBe(true);
    t.counted(run, 203);
    expect(t.total.value).toBe(203);
    expect(t.counting.value).toBe(false);
  });

  it("a short first page is the exact total, and no rows is 0", () => {
    const t = useExplorerTotal();
    let run = t.begin();
    t.pageLoaded(run, 0, 12, 100);
    expect(t.total.value).toBe(12);
    // A count disagreeing with the rows shown never wins over them.
    t.counted(run, 100);
    expect(t.total.value).toBe(12);
    run = t.begin();
    t.pageLoaded(run, 0, 0, 100);
    expect(t.total.value).toBe(0);
  });

  it("a later short page makes the total exact", () => {
    const t = useExplorerTotal();
    const run = t.begin();
    t.pageLoaded(run, 0, 100, 100);
    t.pageLoaded(run, 200, 40, 100);
    expect(t.total.value).toBe(240);
  });

  it("a count or page of an older run is dropped, and a new run clears the old total", () => {
    const t = useExplorerTotal();
    const old = t.begin();
    t.counted(old, 500);
    expect(t.total.value).toBe(500);
    const run = t.begin();
    expect(t.total.value).toBeNull();
    t.counted(old, 999);
    t.pageLoaded(old, 0, 3, 100);
    expect(t.total.value).toBeNull();
    t.counted(run, null);
    expect(t.total.value).toBeNull();
    expect(t.counting.value).toBe(false);
  });

  it("a failed search is 0, and its late count does not bring a total back", () => {
    const t = useExplorerTotal();
    const run = t.begin();
    t.fail(run);
    t.counted(run, 80);
    expect(t.total.value).toBe(0);
  });
});

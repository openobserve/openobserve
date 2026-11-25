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

import { beforeEach, describe, expect, it } from "vitest";
import { useDbmColumnToggle } from "./useDbmColumnToggle";

describe("useDbmColumnToggle", () => {
  beforeEach(() => localStorage.clear());

  it("seeds the defaults when nothing is saved, as a copy", () => {
    const defaults = { p99: false };
    const { columnVisibility, tableRef } = useDbmColumnToggle("dbm-test-a", defaults);
    expect(columnVisibility.value).toEqual({ p99: false });
    expect(columnVisibility.value).not.toBe(defaults);
    expect(tableRef.value).toBeNull();
  });

  it("keeps a saved user choice over the defaults", () => {
    const first = useDbmColumnToggle("dbm-test-b", { p99: false });
    first.setColumnVisibility({ p99: true });
    const second = useDbmColumnToggle("dbm-test-b", { p99: false });
    expect(second.columnVisibility.value).toEqual({ p99: true });
  });
});

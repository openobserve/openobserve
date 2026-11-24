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
import { grantChangeCount, grantsFromRows, hasGrants, rowsFromGrants } from "./secretGrants";

describe("secret grants", () => {
  const g = {
    see: ["sre", "secops"],
    use: ["sre", "payments"],
    manage: ["secops"],
    manage_access: [],
  };

  it("round-trips grants through rows", () => {
    const rows = rowsFromGrants(g);
    expect(rows.map((r) => r.role)).toEqual(["payments", "secops", "sre"]);
    expect(rows.find((r) => r.role === "payments")).toMatchObject({ see: false, use: true });
    const back = grantsFromRows(rows);
    expect(grantChangeCount(g, back)).toBe(0);
  });

  it("counts every written and deleted tuple", () => {
    const after = {
      see: ["sre"],
      use: ["sre", "payments", "ops"],
      manage: [],
      manage_access: ["ops"],
    };
    // -see secops, +use ops, -manage secops, +manage_access ops
    expect(grantChangeCount(g, after)).toBe(4);
  });

  it("knows an empty unapplied set", () => {
    expect(hasGrants(undefined)).toBe(false);
    expect(hasGrants({ see: [], use: [], manage: [], manage_access: [] })).toBe(false);
    expect(hasGrants({ see: [], use: ["x"], manage: [], manage_access: [] })).toBe(true);
  });
});

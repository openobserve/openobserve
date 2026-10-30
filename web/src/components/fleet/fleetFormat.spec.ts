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

import { describe, it, expect } from "vitest";
import { compareVersions, formatCount } from "./fleetFormat";

describe("compareVersions", () => {
  it("ignores a leading v when ordering", () => {
    expect(compareVersions("v0.124.0", "0.124.0")).toBe(0);
    expect(compareVersions("v0.99.1", "0.124.0")).toBeLessThan(0);
    expect(compareVersions("0.125.0", "v0.124.0")).toBeGreaterThan(0);
  });

  it("orders mixed v-prefixed and plain versions numerically", () => {
    const sorted = ["v0.118.0", "0.124.0", "v0.99.1", "0.123.9", "v0.125.0-rc.1", "0.125.0"].sort(
      compareVersions,
    );
    expect(sorted).toEqual([
      "v0.99.1",
      "v0.118.0",
      "0.123.9",
      "0.124.0",
      "v0.125.0-rc.1",
      "0.125.0",
    ]);
  });
});

describe("formatCount", () => {
  it.each([
    [0, "0"],
    [0.03, "<0.1"],
    [0.049, "<0.1"],
    [0.05, "0.1"],
    [950, "950"],
    [15400, "15.4K"],
    [2.8e9, "2.8B"],
  ])("formats %d as %s", (n, text) => {
    expect(formatCount(n)).toBe(text);
  });
});

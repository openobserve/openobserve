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

import { isolateAuto, isolateLtr } from "./bidi";

const codepoints = (value: string) => [...value].map((c) => c.codePointAt(0)?.toString(16));

describe("bidi isolates", () => {
  it("wraps a left-to-right run in LRI … PDI", () => {
    expect(codepoints(isolateLtr("40000"))).toEqual(["2066", "34", "30", "30", "30", "30", "2069"]);
  });

  it("wraps a direction-agnostic run in FSI … PDI", () => {
    expect(codepoints(isolateAuto("x"))).toEqual(["2068", "78", "2069"]);
  });

  it("accepts numbers without stringifying at the call site", () => {
    expect(isolateLtr(42)).toBe(isolateLtr("42"));
  });

  // The marks are zero-width, so a caller that logs or compares the value has to
  // strip them deliberately — they must never leak into a stored setting.
  it("adds no visible characters", () => {
    expect(isolateAuto("abc").replace(/[⁦-⁩]/g, "")).toBe("abc");
  });
});

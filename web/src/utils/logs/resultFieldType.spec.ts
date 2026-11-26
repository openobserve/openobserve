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
import { inferResultFieldType } from "./resultFieldType";

describe("inferResultFieldType", () => {
  it("types a count as a whole number", () => {
    expect(inferResultFieldType([{ cnt: 3 }, { cnt: 40 }], "cnt")).toBe("Int64");
  });

  it("types a fractional number as a float, even when the first value is whole", () => {
    expect(inferResultFieldType([{ avg: 2 }, { avg: 2.5 }], "avg")).toBe("Float64");
  });

  it("types true and false as a boolean", () => {
    expect(inferResultFieldType([{ ok: true }], "ok")).toBe("Boolean");
  });

  it("reads past leading nulls to the first real value", () => {
    expect(inferResultFieldType([{ n: null }, {}, { n: 7 }], "n")).toBe("Int64");
  });

  it("keeps text, and a field with no value at all, as text", () => {
    expect(inferResultFieldType([{ msg: "hi" }], "msg")).toBe("Utf8");
    expect(inferResultFieldType([{ x: null }], "x")).toBe("Utf8");
    expect(inferResultFieldType([], "x")).toBe("Utf8");
  });
});

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

import { periodToMs, readHomeUrl } from "./homeUrl";

describe("readHomeUrl", () => {
  it("reads a relative period", () => {
    expect(readHomeUrl({ period: "1h" })).toEqual({
      range: { type: "relative", period: "1h" },
    });
  });

  it("reads an absolute range in microseconds", () => {
    expect(readHomeUrl({ from: "100", to: "200" }).range).toEqual({
      type: "absolute",
      from: 100,
      to: 200,
    });
  });

  it.each([
    [{ period: "soon" }, { range: null }],
    [{ period: "1h", from: "1", to: "2" }, { range: null }],
    [{ from: "200", to: "100" }, { range: null }],
    [{ from: "100" }, { range: null }],
    [{ from: "1e5", to: "2e5" }, { range: null }],
  ])("restores nothing from a malformed part %#", (query, expected) => {
    expect(readHomeUrl(query)).toEqual(expected);
  });
});

describe("periodToMs", () => {
  it("reads relative periods and falls back to 15 minutes", () => {
    expect(periodToMs("24h")).toBe(86_400_000);
    expect(periodToMs("15m")).toBe(900_000);
    expect(periodToMs("bogus")).toBe(900_000);
  });
});

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
  HOME_RETURN_QUERY_KEY,
  armHomeReturn,
  decodeHomeReturn,
  encodeHomeReturn,
  homeReturnFor,
  withHomeReturn,
  type HomeReturnState,
} from "./homeReturn";

describe("homeReturn", () => {
  it.each<HomeReturnState>([
    {},
    { row: "service:checkout-api" },
    { row: "incident:01J", period: "1h", focus: "ask" },
    { row: "alert:a/b c", from: 1_700_000_000_000_000, to: 1_700_000_360_000_000 },
    { focus: "ask" },
  ])("round-trips %j", (state) => {
    expect(decodeHomeReturn(encodeHomeReturn(state))).toEqual(state);
  });

  it.each([
    ["a non-string", 3],
    ["an array", ["row=service:a"]],
    ["null", null],
    ["an unknown row kind", "row=user:a"],
    ["a row without an id", "row=service:"],
    ["a bad period", "period=soon"],
    ["period with from/to", "period=1h&from=1&to=2"],
    ["from without to", "from=1"],
    ["a non-numeric to", "from=1&to=x"],
    ["a reversed range", "from=5&to=2"],
    ["another focus", "focus=chat"],
  ])("decodes %s to null", (_label, value) => {
    expect(decodeHomeReturn(value)).toBeNull();
  });

  it("adds home_return to a named location, keeps the existing query and org_identifier last", () => {
    const location = withHomeReturn(
      { name: "traces", query: { org_identifier: "o1", tab: "services-catalog" } },
      { row: "service:a", period: "1h" },
    );
    expect(location).toEqual({
      name: "traces",
      query: {
        tab: "services-catalog",
        [HOME_RETURN_QUERY_KEY]: "row=service%3Aa&period=1h",
        org_identifier: "o1",
      },
    });
    expect(Object.keys((location as { query: object }).query).at(-1)).toBe("org_identifier");
  });

  it("adds home_return to a location without a query", () => {
    expect(withHomeReturn({ path: "/logs" }, { focus: "ask" })).toEqual({
      path: "/logs",
      query: { [HOME_RETURN_QUERY_KEY]: "focus=ask" },
    });
  });

  it("adds home_return to a string location before its hash, org_identifier last", () => {
    const href = withHomeReturn("/web/alerts?org_identifier=o1&folder=f#top", { row: "alert:x" });
    expect(href).toBe("/web/alerts?folder=f&home_return=row%3Dalert%253Ax&org_identifier=o1#top");
    const query = new URLSearchParams((href as string).split("?")[1].split("#")[0]);
    expect(decodeHomeReturn(query.get(HOME_RETURN_QUERY_KEY))).toEqual({ row: "alert:x" });
  });

  it("arms per sid and reads back a copy", () => {
    armHomeReturn("sid-a", { row: "service:a", period: "1h" });
    armHomeReturn("sid-b", { row: "incident:b" });
    expect(homeReturnFor("sid-a")).toEqual({ row: "service:a", period: "1h" });
    expect(homeReturnFor("sid-b")).toEqual({ row: "incident:b" });
    expect(homeReturnFor("sid-c")).toBeNull();
    const copy = homeReturnFor("sid-a");
    if (copy) copy.row = "service:z";
    expect(homeReturnFor("sid-a")?.row).toBe("service:a");
  });
});

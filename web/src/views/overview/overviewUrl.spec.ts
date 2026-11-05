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
import { ref } from "vue";

import {
  overviewReturnState,
  overviewUrlQuery,
  readOverviewUrl,
  writeOverviewUrl,
} from "./overviewUrl";

describe("readOverviewUrl", () => {
  it("reads a row and a relative period", () => {
    expect(readOverviewUrl({ row: "service:checkout-api", period: "1h" })).toEqual({
      row: "service:checkout-api",
      range: { type: "relative", period: "1h" },
    });
  });

  it("reads an absolute range in microseconds", () => {
    expect(readOverviewUrl({ from: "100", to: "200" }).range).toEqual({
      type: "absolute",
      from: 100,
      to: 200,
    });
  });

  it.each([
    [{ row: "bogus" }, { row: null, range: null }],
    [{ period: "soon" }, { row: null, range: null }],
    [
      { period: "1h", from: "1", to: "2" },
      { row: null, range: null },
    ],
    [
      { from: "200", to: "100" },
      { row: null, range: null },
    ],
    [{ from: "100" }, { row: null, range: null }],
    [
      { from: "1e5", to: "2e5" },
      { row: null, range: null },
    ],
  ])("restores nothing from a malformed part %#", (query, expected) => {
    expect(readOverviewUrl(query)).toEqual(expected);
  });
});

describe("overviewUrlQuery", () => {
  it("replaces the Overview keys and keeps org_identifier last", () => {
    const query = overviewUrlQuery(
      { org_identifier: "o1", period: "15m", keep: "x" },
      { row: "incident:7", range: { type: "absolute", from: 1, to: 2 } },
    );
    expect(Object.keys(query)).toEqual(["keep", "row", "from", "to", "org_identifier"]);
    expect(query).toMatchObject({ row: "incident:7", from: "1", to: "2" });
  });

  it("drops the row when none is selected", () => {
    expect(
      overviewUrlQuery(
        { row: "incident:7" },
        { row: null, range: { type: "relative", period: "1h" } },
      ),
    ).toEqual({ period: "1h" });
  });
});

describe("overviewReturnState", () => {
  it("maps the state and the focus", () => {
    expect(
      overviewReturnState({ row: "alert:a", range: { type: "relative", period: "1h" } }, "ask"),
    ).toEqual({ row: "alert:a", period: "1h", focus: "ask" });
  });
});

describe("writeOverviewUrl", () => {
  const routerAt = (name: string, query: Record<string, string>) => ({
    replace: vi.fn(() => Promise.resolve()),
    currentRoute: ref({ name, query }) as never,
  });

  it("replaces, never pushes, on home", () => {
    const router = routerAt("home", { org_identifier: "o1" });
    writeOverviewUrl(router, { row: "service:a", range: { type: "relative", period: "1h" } });
    expect(router.replace).toHaveBeenCalledWith({
      name: "home",
      query: { row: "service:a", period: "1h", org_identifier: "o1" },
    });
  });

  it("does nothing when the query already says it, or off home", () => {
    const same = routerAt("home", { period: "1h", org_identifier: "o1" });
    writeOverviewUrl(same, { row: null, range: { type: "relative", period: "1h" } });
    expect(same.replace).not.toHaveBeenCalled();
    const away = routerAt("logs", {});
    writeOverviewUrl(away, { row: null, range: { type: "relative", period: "1h" } });
    expect(away.replace).not.toHaveBeenCalled();
  });
});

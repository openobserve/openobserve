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
import { checkIfConfigChangeRequiredApiCallOrNot } from "./checkConfigChangeApiCall";

const panel = (config: any, queryType = "promql") => ({
  queryType,
  queries: [{ query: "up", config }],
});

describe("checkIfConfigChangeRequiredApiCallOrNot", () => {
  it("needs no API call when only a query letter is assigned", () => {
    expect(checkIfConfigChangeRequiredApiCallOrNot(panel({}), panel({ ref: "A" }))).toBe(false);
  });

  it("needs no API call to hide a query, whose data is already loaded", () => {
    expect(checkIfConfigChangeRequiredApiCallOrNot(panel({}), panel({ hide: true }))).toBe(false);
  });

  it("needs an API call to show a hidden PromQL query, which was never sent", () => {
    expect(
      checkIfConfigChangeRequiredApiCallOrNot(panel({ hide: true }), panel({ hide: false })),
    ).toBe(true);
  });

  it("needs no API call to show a hidden SQL query, which still ran", () => {
    expect(
      checkIfConfigChangeRequiredApiCallOrNot(panel({ hide: true }, "sql"), panel({}, "sql")),
    ).toBe(false);
  });

  it("reloads a PromQL panel moved to or from a chart type with its own series cap", () => {
    const typed = (type: string, queryType = "promql") => ({ ...panel({}, queryType), type });
    expect(checkIfConfigChangeRequiredApiCallOrNot(typed("line"), typed("hostmap"))).toBe(true);
    expect(checkIfConfigChangeRequiredApiCallOrNot(typed("hostmap"), typed("line"))).toBe(true);
    expect(checkIfConfigChangeRequiredApiCallOrNot(typed("state-timeline"), typed("hostmap"))).toBe(
      true,
    );
    expect(checkIfConfigChangeRequiredApiCallOrNot(typed("line"), typed("bar"))).toBe(false);
    expect(
      checkIfConfigChangeRequiredApiCallOrNot(typed("line", "sql"), typed("hostmap", "sql")),
    ).toBe(false);
  });
});

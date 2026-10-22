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
import { queryChangeAffectsPanelTimes } from "./panelTimeUtils";

const base = { dashboard: "d1", tab: "t2", period: "15m", "var-tv.t.t2": "a" };

describe("queryChangeAffectsPanelTimes", () => {
  it("ignores an applied tab, panel or global variable", () => {
    expect(queryChangeAffectsPanelTimes({ ...base, "var-tv.t.t2": "b" }, base)).toBe(false);
    expect(queryChangeAffectsPanelTimes({ ...base, "var-pv.p.P6": "y" }, base)).toBe(false);
    expect(queryChangeAffectsPanelTimes({ ...base, "var-env": ["prod"] }, base)).toBe(false);
  });

  it("ignores panel-time and cell params as before", () => {
    expect(queryChangeAffectsPanelTimes({ ...base, "pt-period.P8": "1h" }, base)).toBe(false);
    expect(queryChangeAffectsPanelTimes({ ...base, cell_t0: "1" }, base)).toBe(false);
  });

  it("recomputes when the global time or any other param changes", () => {
    expect(queryChangeAffectsPanelTimes({ ...base, period: "1h" }, base)).toBe(true);
    expect(queryChangeAffectsPanelTimes({ ...base, period: "1h", "var-tv.t.t2": "b" }, base)).toBe(
      true,
    );
    expect(queryChangeAffectsPanelTimes({ ...base, tab: "t1" }, base)).toBe(true);
  });

  it("recomputes on a first or unchanged query, as before", () => {
    expect(queryChangeAffectsPanelTimes(base, undefined)).toBe(true);
    expect(queryChangeAffectsPanelTimes(base, { ...base })).toBe(true);
  });
});

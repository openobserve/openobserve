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
import { formatPercent } from "./format";

describe("formatPercent", () => {
  it("formats a share with two decimals", () => {
    expect(formatPercent(45, 50)).toBe("90.00%");
    expect(formatPercent(1, 3)).toBe("33.33%");
  });

  it("returns the empty text when there is no total", () => {
    expect(formatPercent(5, 0)).toBe("0.00%");
    expect(formatPercent(5, 0, "")).toBe("");
  });
});

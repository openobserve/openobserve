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
import { totalsGridTemplate } from "./totalsBar";

describe("totalsGridTemplate", () => {
  const columns = [{ id: "name" }, { id: "volume", size: 128 }, { id: "cost", size: 112 }];

  it("mirrors the index column, the fill column and each fixed width", () => {
    expect(totalsGridTemplate(columns)).toBe("3.5rem minmax(0, 1fr) 8rem 7rem");
  });

  it("drops a column the table hides, so the cells stay under their headers", () => {
    expect(totalsGridTemplate(columns, { volume: false })).toBe("3.5rem minmax(0, 1fr) 7rem");
  });
});

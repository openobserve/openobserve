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
import { patternsForAgent } from "./harnessText";

describe("patternsForAgent", () => {
  const patterns = ["tag system-reminder", "tag job"];

  it("keeps one agent's patterns off another agent", () => {
    const rules = [{ agent: "omp", patterns }];
    expect(patternsForAgent(rules, "omp")).toEqual(patterns);
    expect(patternsForAgent(rules, "support-bot")).toEqual([]);
    expect(patternsForAgent(rules, null)).toEqual([]);
  });
});

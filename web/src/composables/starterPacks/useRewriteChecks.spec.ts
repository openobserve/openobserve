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

vi.mock("vuex", () => ({ useStore: () => ({ state: {} }) }));

import { withVariableStandIns } from "./useRewriteChecks";

describe("withVariableStandIns", () => {
  it("quotes a bare variable and keeps a quoted one valid", () => {
    expect(withVariableStandIns("a IN (${b}) AND c = '$d' AND e = '${f:csv}x'")).toBe(
      "a IN ('o2var') AND c = 'o2var' AND e = 'o2varx'",
    );
  });
});

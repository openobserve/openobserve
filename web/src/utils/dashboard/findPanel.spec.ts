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
import { findPanelById } from "./findPanel";

describe("findPanelById", () => {
  const dashboard = {
    tabs: [
      { tabId: "a", panels: [{ id: "p1" }, { id: "dup" }] },
      { tabId: "b", panels: [{ id: "p2" }, { id: "dup" }] },
    ],
  };

  it("finds a panel in a tab other than the preferred one", () => {
    const found = findPanelById(dashboard, "p2", "a");
    expect(found?.tab.tabId).toBe("b");
    expect(found?.index).toBe(0);
  });

  it("prefers the given tab when ids repeat", () => {
    expect(findPanelById(dashboard, "dup", "b")?.tab.tabId).toBe("b");
  });

  it("returns undefined for a missing panel or malformed dashboard", () => {
    expect(findPanelById(dashboard, "nope", "a")).toBeUndefined();
    expect(findPanelById(undefined, "p1")).toBeUndefined();
    expect(findPanelById({ tabs: [{ tabId: "a" }] }, "p1")).toBeUndefined();
  });
});

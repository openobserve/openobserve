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
import { createPanelEmptyRegistry } from "./usePanelEmptyRegistry";
import { collectDashboardStreams, latestDataWindow } from "./useDashboardLastData";

describe("createPanelEmptyRegistry", () => {
  it("is not all-empty before any panel reports", () => {
    expect(createPanelEmptyRegistry().allEmpty.value).toBe(false);
  });

  it("is all-empty only when every reporting panel settled empty", () => {
    const registry = createPanelEmptyRegistry();
    registry.report("a", "empty");
    registry.report("b", "pending");
    expect(registry.allEmpty.value).toBe(false);
    registry.report("b", "empty");
    expect(registry.allEmpty.value).toBe(true);
    registry.report("c", "data");
    expect(registry.allEmpty.value).toBe(false);
    registry.unregister("c");
    expect(registry.allEmpty.value).toBe(true);
  });

  it("does not count an errored panel as empty", () => {
    const registry = createPanelEmptyRegistry();
    registry.report("a", "empty");
    registry.report("b", "error");
    expect(registry.allEmpty.value).toBe(false);
  });
});

describe("dashboard last data helpers", () => {
  it("collects distinct streams across tabs, defaulting the type to logs", () => {
    const tabs = [
      { panels: [{ queries: [{ fields: { stream: "app" } }] }] },
      {
        panels: [
          { queries: [{ fields: { stream: "app", stream_type: "logs" } }] },
          { queries: [{ fields: { stream: "cpu", stream_type: "metrics" } }, { fields: {} }] },
        ],
      },
    ];
    expect(collectDashboardStreams(tabs)).toEqual([
      { name: "app", type: "logs" },
      { name: "cpu", type: "metrics" },
    ]);
  });

  it("windows the 15 minutes ending just after the latest record", () => {
    const window = latestDataWindow(1_000_000_000_000);
    expect(window.endTime - window.startTime).toBe(15 * 60 * 1_000_000 + 1_000_000);
  });
});

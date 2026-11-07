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

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  LAST_VISIT_PREFIX,
  RECENT_DASHBOARDS_CAP,
  homeUserKey,
  readLastVisit,
  readRecentDashboards,
  recordRecentDashboard,
  writeLastVisit,
} from "./homeStorage";

vi.mock("@/composables/assistant/flags", () => ({ isAssistantV2: () => true }));

describe("homeStorage", () => {
  beforeEach(() => localStorage.clear());

  it("keys the record by a hash of user and org, so no address sits in storage", () => {
    const key = homeUserKey("marco@example.com", "default");
    expect(key).toBe(homeUserKey("marco@example.com", "default"));
    expect(key).not.toBe(homeUserKey("marco@example.com", "other"));
    expect(key).not.toContain("marco");
  });

  it("reads null on the first visit and the written time after", () => {
    const key = homeUserKey("u@example.com", "o");
    expect(readLastVisit(key)).toBeNull();
    writeLastVisit(key, 1_700_000_000_000);
    expect(localStorage.getItem(LAST_VISIT_PREFIX + key)).toBe("1700000000000");
    expect(readLastVisit(key)).toBe(1_700_000_000_000);
  });

  it("ignores a corrupt last-visit value", () => {
    localStorage.setItem(LAST_VISIT_PREFIX + "k", "yesterday");
    expect(readLastVisit("k")).toBeNull();
  });

  it("keeps the newest dashboards first, once each, up to the cap", () => {
    for (let i = 0; i < RECENT_DASHBOARDS_CAP + 2; i++) {
      recordRecentDashboard("k", {
        dashboardId: `d${i}`,
        folderId: "default",
        title: `D${i}`,
        at: i,
      });
    }
    recordRecentDashboard("k", { dashboardId: "d3", folderId: "default", title: "D3", at: 99 });
    const ids = readRecentDashboards("k").map((d) => d.dashboardId);
    expect(ids).toHaveLength(RECENT_DASHBOARDS_CAP);
    expect(ids[0]).toBe("d3");
    expect(new Set(ids).size).toBe(ids.length);
  });
});

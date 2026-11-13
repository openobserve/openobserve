//  Copyright 2026 OpenObserve Inc.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, expect, it } from "vitest";
import { getOrgSwitchRoute, isDashboardItemRoute } from "./orgSwitchRoute";

describe("getOrgSwitchRoute", () => {
  const dashboardQuery = {
    org_identifier: "default",
    dashboard: "7351",
    folder: "default",
    tab: "default",
  };

  it.each([
    ["/dashboards/view", "viewDashboard"],
    ["/dashboards/add_panel", "addPanel"],
    ["/dashboards/tv", "dashboardTvPlaylist"],
  ])("sends %s to the dashboard list of the new org", (path, name) => {
    expect(getOrgSwitchRoute(path, name, dashboardQuery, "_meta")).toEqual({
      path: "/dashboards",
      query: { org_identifier: "_meta" },
    });
  });

  it("keeps the query on logs pages", () => {
    const query = { org_identifier: "default", stream: "app", sql_mode: "true" };
    expect(getOrgSwitchRoute("/web.logs", "logs", query, "_meta")).toEqual({
      path: "/web.logs",
      query: { stream: "app", sql_mode: "true", org_identifier: "_meta" },
    });
  });

  it.each([
    ["/dashboards", "dashboards"],
    ["/alerts", "alertList"],
    ["/dashboards/import", "importDashboard"],
  ])("keeps the path of %s and drops its query", (path, name) => {
    expect(
      getOrgSwitchRoute(path, name, { folder: "f1", org_identifier: "default" }, "_meta"),
    ).toEqual({ path, query: { org_identifier: "_meta" } });
  });

  it.each([
    ["viewDashboard", true],
    ["addPanel", true],
    ["dashboardTvPlaylist", true],
    ["dashboards", false],
    ["importDashboard", false],
    [undefined, false],
  ])("isDashboardItemRoute(%s) is %s", (name, expected) => {
    expect(isDashboardItemRoute(name)).toBe(expected);
  });
});

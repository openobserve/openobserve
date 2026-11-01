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
import {
  ANALYTICS_SUBTABS,
  PA_ROUTES,
  SUBTAB_ROUTES,
  redirectHeatmaps,
  subTabOfRoute,
} from "./productAnalyticsRoutes";

describe("productAnalyticsRoutes heatmaps", () => {
  it("puts Heatmaps after Paths and before Retention", () => {
    expect(ANALYTICS_SUBTABS.indexOf("heatmaps")).toBe(ANALYTICS_SUBTABS.indexOf("paths") + 1);
    expect(ANALYTICS_SUBTABS.indexOf("retention")).toBe(ANALYTICS_SUBTABS.indexOf("heatmaps") + 1);
    expect(SUBTAB_ROUTES.heatmaps).toBe(PA_ROUTES.heatmaps);
    expect(subTabOfRoute(PA_ROUTES.heatmaps)).toBe("heatmaps");
  });

  it("redirects the old path keeping only the known query keys and mapping range to period", () => {
    expect(
      redirectHeatmaps({
        query: { page_url: "/a", device: "phone", app: "web", range: "7d", x: "1" },
      }),
    ).toEqual({
      name: PA_ROUTES.heatmaps,
      query: { page_url: "/a", device: "phone", app: "web", period: "7d" },
    });
  });
});

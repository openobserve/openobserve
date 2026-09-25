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

import { describe, it, expect, vi, beforeEach } from "vitest";

const record = vi.fn();
vi.mock("./useFrecency", () => ({ useFrecency: () => ({ record }) }));

import { routeToPaletteItemId, useRecentlyViewed } from "./useRecentlyViewed";

const route = (name: string, query: Record<string, any> = {}, params: Record<string, any> = {}) =>
  ({ name, query, params }) as any;

describe("routeToPaletteItemId", () => {
  it("maps plain pages and tabbed pages", () => {
    expect(routeToPaletteItemId(route("logs"))).toBe("page:logs");
    expect(routeToPaletteItemId(route("traces", { tab: "service-graph" }))).toBe(
      "page:traces:service-graph",
    );
  });

  it("maps entity views to entity ids", () => {
    expect(routeToPaletteItemId(route("viewDashboard", { dashboard: "d1", folder: "f1" }))).toBe(
      "dashboard:f1/d1",
    );
    expect(routeToPaletteItemId(route("viewDashboard", { dashboard: "d1" }))).toBe(
      "dashboard:default/d1",
    );
    expect(routeToPaletteItemId(route("alertDetail", {}, { alert_id: "a1" }))).toBe("alert:a1");
    expect(routeToPaletteItemId(route("pipelineEditor", { id: "p1" }))).toBe("pipeline:p1");
    expect(routeToPaletteItemId(route("functionList", { action: "update", name: "fn" }))).toBe(
      "function:fn",
    );
    expect(routeToPaletteItemId(route("functionList", { action: "add" }))).toBe(
      "page:functionList",
    );
  });

  it("ignores auth and unnamed routes", () => {
    expect(routeToPaletteItemId(route("login"))).toBeNull();
    expect(routeToPaletteItemId({ name: undefined, query: {}, params: {} } as any)).toBeNull();
  });
});

describe("useRecentlyViewed", () => {
  beforeEach(() => {
    record.mockClear();
    useRecentlyViewed().resetThrottle();
  });

  it("records a visit and throttles repeats of the same target", () => {
    const { recordRouteVisit } = useRecentlyViewed();
    recordRouteVisit(route("logs"), 1000);
    recordRouteVisit(route("logs"), 2000);
    recordRouteVisit(route("metrics"), 3000);
    recordRouteVisit(route("logs"), 9000);
    expect(record.mock.calls.map((c) => c[1])).toEqual(["page:logs", "page:metrics", "page:logs"]);
    expect(record).toHaveBeenCalledWith("palette_item", "page:logs", 1000, false);
  });
});

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
import { raw } from "@/types/i18n";
import { buildNavGateContext } from "@/lib/core/Navbar/useNavGateContext";
import type { NavItem } from "@/lib/core/Navbar/ONavbar.types";
import { buildPageItems, type PageRouter } from "./pages";

const ROUTES: Record<string, string> = {
  home: "/",
  logs: "/logs",
  traces: "/traces",
  logstreams: "/streams",
  pipelines: "/pipeline",
  functionList: "/functions",
  ingestion: "/ingestion",
  alertList: "/alerts",
  alertDestinations: "/alerts/destinations",
  alertTemplates: "/alerts/templates",
  alertLibrary: "/alerts/library",
  sloList: "/slos",
  settings: "/settings",
};

const router: PageRouter = {
  hasRoute: (name) => name in ROUTES,
  resolve: (to) => {
    const loc = to as { name?: string; path?: string };
    if (loc.name) return { name: loc.name, path: ROUTES[loc.name] ?? "/" };
    const name = Object.keys(ROUTES).find((k) => ROUTES[k] === loc.path);
    return { name, path: loc.path ?? "/" };
  },
};

const t = raw as any;

const link = (
  name: string,
  link: string,
  title: string,
  extra: Partial<NavItem> = {},
): NavItem => ({
  name,
  link,
  title: raw(title),
  icon: "search",
  ...extra,
});

const NAV: NavItem[] = [
  link("home", "/", "Home"),
  link("logs", "/logs", "Logs"),
  link("traces", "/traces", "Traces"),
  link("streams", "/streams", "Streams"),
  link("pipeline", "/pipeline", "Pipelines"),
  link("ingestion", "/ingestion", "Data sources"),
  link("alertList", "/alerts", "Alerts"),
  link("sloList", "/slos", "SLOs"),
  link("iam", "/iam", "IAM", { display: false }),
  link("settings", "/settings", "Settings"),
];

const oss = { isEnterprise: false, isCloud: false };

describe("buildPageItems", () => {
  it("lists standalone links by their resolved route name and path", () => {
    const items = buildPageItems({ navLinks: NAV, ctx: buildNavGateContext({}, oss), router, t });
    const logs = items.find((i) => i.id === "page:logs");
    expect(logs).toMatchObject({
      label: "Logs",
      trailing: { kind: "path", value: "/logs" },
      route: { path: "/logs" },
    });
    expect(items.find((i) => i.id === "page:home")).toBeTruthy();
  });

  it("hides links the rail hides", () => {
    const items = buildPageItems({ navLinks: NAV, ctx: buildNavGateContext({}, oss), router, t });
    expect(items.some((i) => i.id === "page:iam")).toBe(false);
  });

  it("expands NAV_GROUPS into their children instead of a tile row", () => {
    const items = buildPageItems({ navLinks: NAV, ctx: buildNavGateContext({}, oss), router, t });
    const ids = items.map((i) => i.id);
    expect(ids).not.toContain("page:reliability");
    expect(ids).toContain("page:alertList");
    expect(ids).toContain("page:alertDestinations");
    expect(ids).toContain("page:sloList");
    expect(ids).toContain("page:logstreams");
    expect(ids).toContain("page:functionList");
    // Only route names registered in this build survive.
    expect(ids).not.toContain("page:workflows");
    expect(ids).not.toContain("page:enrichmentTables");
    // The absorbed top-level "streams" link is represented once, by its route name.
    expect(ids.filter((id) => id === "page:logstreams")).toHaveLength(1);
    const dest = items.find((i) => i.id === "page:alertDestinations")!;
    expect(dest.subtitle).toBe("menu.reliability · menu.alerts");
    expect(dest.route).toEqual({ name: "alertDestinations", query: {} });
  });

  it("keeps a NAV_SUBNAV parent as a page and adds its tab children, skipping the default tab", () => {
    const items = buildPageItems({ navLinks: NAV, ctx: buildNavGateContext({}, oss), router, t });
    const ids = items.map((i) => i.id);
    expect(ids).toContain("page:traces");
    expect(ids).not.toContain("page:traces:spans");
    expect(ids).toContain("page:traces:traces");
    expect(ids).toContain("page:traces:services-catalog");
    // Service Graph is enterprise-gated.
    expect(ids).not.toContain("page:traces:service-graph");
    const catalog = items.find((i) => i.id === "page:traces:services-catalog")!;
    expect(catalog.trailing).toEqual({ kind: "path", value: "/traces?tab=services-catalog" });
    expect(catalog.route).toEqual({ name: "traces", query: { tab: "services-catalog" } });
  });

  it("applies gate predicates and custom_hide_menus like the rail", () => {
    const ent = buildNavGateContext({}, { isEnterprise: true, isCloud: false });
    expect(buildPageItems({ navLinks: NAV, ctx: ent, router, t }).map((i) => i.id)).toContain(
      "page:traces:service-graph",
    );
    const hidden = buildNavGateContext(
      { zoConfig: { custom_hide_menus: "pipelines,alertDestinations" } },
      oss,
    );
    const ids = buildPageItems({ navLinks: NAV, ctx: hidden, router, t }).map((i) => i.id);
    expect(ids).not.toContain("page:pipelines");
    expect(ids).not.toContain("page:alertDestinations");
  });
});

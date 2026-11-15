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

import type { RouteLocationNormalizedLoaded } from "vue-router";

export type RoutePendingKind = "table" | "dashboard" | "form" | "detail";

/** The layout a route's page will have, so the shell's loading skeleton matches it (K4). */
export interface RoutePendingShape {
  kind: RoutePendingKind;
  /** A full-height section rail beside the page, or a folder rail under its header. */
  rail?: "section" | "folder";
  /** A 40 px tab row under the header. */
  tabs?: boolean;
}

type PendingRoute = Pick<RouteLocationNormalizedLoaded, "name" | "path" | "params" | "matched">;

const DASHBOARD_ROUTES = new Set(["home", "viewDashboard", "securityOverview", "aiLLMInsights"]);
const FORM_ROUTES = new Set(["general", "organizationSettings", "importDashboard"]);
const TABBED_ROUTES = new Set(["home", "alertList", "alertFiring", "alertHistory", "reports"]);
const FOLDER_RAIL_ROUTES = new Set(["dashboards", "alertList", "sloList", "reports"]);
const SECTION_RAIL_PARENTS = new Set(["iam", "settings"]);

const kindOf = (route: PendingRoute, name: string): RoutePendingKind => {
  if (DASHBOARD_ROUTES.has(name)) return "dashboard";
  if (FORM_ROUTES.has(name) || /\/(add|edit|import|new|create)(\/|$)/.test(route.path))
    return "form";
  if (Object.keys(route.params ?? {}).length > 0) return "detail";
  return "table";
};

export function routePendingShape(route: PendingRoute): RoutePendingShape {
  const name = String(route.name ?? "");
  const parents = route.matched.map((record) => String(record.name ?? ""));
  const sectionRail =
    parents.some((parent) => SECTION_RAIL_PARENTS.has(parent)) || route.path.startsWith("/ai/");
  return {
    kind: kindOf(route, name),
    rail: sectionRail ? "section" : FOLDER_RAIL_ROUTES.has(name) ? "folder" : undefined,
    tabs: TABBED_ROUTES.has(name) || parents.includes("pipeline"),
  };
}

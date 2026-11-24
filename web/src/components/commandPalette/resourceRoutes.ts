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

import type { RouteLocationRaw } from "vue-router";
import type { ResourceHit, ResourceKind } from "@/ts/interfaces/resources";
import { syntheticsResultsRoute } from "@/utils/synthetics/routes";

export const RECENT_PAGE_ROUTES = [
  "logs",
  "metrics",
  "traces",
  "dashboards",
  "alertList",
  "functionList",
  "pipelines",
  "synthetics",
  "users",
  "serviceAccounts",
] as const;
export type RecentPageRoute = (typeof RECENT_PAGE_ROUTES)[number];
export type RecentVisit =
  | {
      [Kind in ResourceKind]: {
        kind: Kind;
        id: string;
        name: string;
        route_ref: Extract<ResourceHit, { type: Kind }>["route_ref"];
        visited_at_us: number;
      };
    }[ResourceKind]
  | {
      kind: "page";
      id: RecentPageRoute;
      name: string;
      route_ref: { page: RecentPageRoute };
      visited_at_us: number;
    };

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 4096;
}
export function sanitizeResourceHit(value: unknown): ResourceHit | null {
  if (!object(value) || !text(value.id) || !text(value.name) || !object(value.route_ref))
    return null;
  const { id, name, route_ref: route } = value;
  switch (value.type) {
    case "dashboard":
      return route.dashboard_id === id && text(route.folder_id)
        ? {
            type: "dashboard",
            id,
            name,
            route_ref: { dashboard_id: id, folder_id: route.folder_id },
          }
        : null;
    case "alert": {
      if (
        route.alert_id !== id ||
        !text(route.folder_id) ||
        !["scheduled", "realtime", "composite", "anomaly_detection"].includes(
          String(route.alert_type),
        )
      )
        return null;
      const alert_type = route.alert_type as
        "scheduled" | "realtime" | "composite" | "anomaly_detection";
      return {
        type: "alert",
        id,
        name,
        route_ref: { alert_id: id, folder_id: route.folder_id, alert_type },
      };
    }
    case "stream": {
      if (
        !text(route.stream_name) ||
        !["logs", "metrics", "traces"].includes(String(route.stream_type)) ||
        `${route.stream_type}/${route.stream_name}` !== id
      )
        return null;
      const stream_type = route.stream_type as "logs" | "metrics" | "traces";
      return {
        type: "stream",
        id,
        name,
        route_ref: { stream_type, stream_name: route.stream_name },
      };
    }
    case "function":
      return route.function_name === id
        ? { type: "function", id, name, route_ref: { function_name: id } }
        : null;
    case "pipeline":
      return route.pipeline_id === id
        ? { type: "pipeline", id, name, route_ref: { pipeline_id: id } }
        : null;
    case "synthetic":
      return route.check_id === id && text(route.folder_id)
        ? { type: "synthetic", id, name, route_ref: { check_id: id, folder_id: route.folder_id } }
        : null;
    case "user":
      return route.email === id ? { type: "user", id, name, route_ref: { email: id } } : null;
    case "service_account":
      return route.email === id
        ? { type: "service_account", id, name, route_ref: { email: id } }
        : null;
    default:
      return null;
  }
}

export function resourceRoute(hit: ResourceHit, org: string): RouteLocationRaw | null {
  const safe = sanitizeResourceHit(hit);
  if (!safe || !org) return null;
  const query = { org_identifier: org };
  switch (safe.type) {
    case "dashboard":
      return {
        name: "viewDashboard",
        query: { ...query, dashboard: safe.id, folder: safe.route_ref.folder_id },
      };
    case "alert":
      return {
        name: "alertDetail",
        params: { alert_id: safe.id },
        query: { ...query, folder: safe.route_ref.folder_id },
      };
    case "stream":
      return {
        name: safe.route_ref.stream_type,
        query: {
          ...query,
          [safe.route_ref.stream_type === "metrics" ? "metric" : "stream"]:
            safe.route_ref.stream_name,
          ...(safe.route_ref.stream_type === "logs" ? { stream_type: "logs" } : {}),
        },
      };
    case "function":
      return { name: "functionList", query: { ...query, action: "update", name: safe.id } };
    case "pipeline":
      return { name: "pipelineEditor", query: { ...query, id: safe.id } };
    case "synthetic":
      return syntheticsResultsRoute(
        { orgIdentifier: org, folderId: safe.route_ref.folder_id },
        safe.id,
      );
    case "user":
      return { name: "users", query: { ...query, action: "update", email: safe.id } };
    case "service_account":
      return { name: "serviceAccounts", query: { ...query, action: "update", email: safe.id } };
  }
}

let streamPick: { page: string; stream: string } | null = null;
/** Marks a stream picked in Command K, so an open page applies it even when its URL already names it. */
export function markStreamPick(route: RouteLocationRaw | null) {
  streamPick = null;
  if (!route || typeof route !== "object" || !("name" in route)) return;
  const stream = "query" in route ? route.query?.stream : undefined;
  if ((route.name === "logs" || route.name === "traces") && typeof stream === "string")
    streamPick = { page: route.name, stream };
}
export function isStreamPick(page: string, stream: unknown): boolean {
  return streamPick?.page === page && streamPick.stream === stream;
}

let intentSerial = 0;
export function creationRoute(
  kind: "dashboard" | "alert" | "function" | "pipeline",
  org: string,
): RouteLocationRaw {
  const palette_intent = `${Date.now().toString(36)}-${++intentSerial}`;
  const name = {
    dashboard: "dashboards",
    alert: "alertList",
    function: "functionList",
    pipeline: "createPipeline",
  }[kind];
  return { name, query: { org_identifier: org, action: "add", palette_intent } };
}
export function recentVisitRoute(visit: RecentVisit, org: string): RouteLocationRaw | null {
  if (visit.kind === "page")
    return RECENT_PAGE_ROUTES.includes(visit.route_ref.page)
      ? { name: visit.route_ref.page, query: { org_identifier: org } }
      : null;
  const hit = sanitizeResourceHit({
    type: visit.kind,
    id: visit.id,
    name: visit.name,
    route_ref: visit.route_ref,
  });
  return hit ? resourceRoute(hit, org) : null;
}

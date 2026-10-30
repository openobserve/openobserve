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

import type { NavigationAction } from "@/ts/interfaces/chat";

export { generateNavigationFromToolResult } from "@/composables/assistant/navigationRoutes";

export interface NavigationRoute {
  path: string;
  query: Record<string, string>;
}

const encodeForUrl = (str: string) => btoa(unescape(encodeURIComponent(str)));

export function navigationPageName(action: NavigationAction): string {
  return (
    action.label ||
    action.target.name ||
    action.resource_type.charAt(0).toUpperCase() + action.resource_type.slice(1)
  );
}

/** Returns the route to push for a navigation action, or null when the action has no route. */
export function buildNavigationRoute(
  action: NavigationAction,
  orgIdentifier: string,
): NavigationRoute | null {
  if (action.action === "load_query") {
    const target = action.target;
    const queryParams: Record<string, string> = {
      org_identifier: orgIdentifier,
      stream_type: action.resource_type,
      refresh: "0",
      sql_mode: target.sql_mode?.toString() || "false",
      quick_mode: "false",
      show_histogram: "true",
      type: "ai_chat_query",
    };

    if (target.stream) {
      queryParams.stream = Array.isArray(target.stream) ? target.stream.join(",") : target.stream;
    }

    if (target.from !== undefined && target.to !== undefined) {
      queryParams.from = target.from.toString();
      queryParams.to = target.to.toString();
    } else if (target.period) {
      queryParams.period = target.period;
    }

    if (target.query) {
      queryParams.query = encodeForUrl(
        typeof target.query === "string" ? target.query : JSON.stringify(target.query),
      );
    }

    if (target.functionContent) {
      queryParams.functionContent = encodeForUrl(target.functionContent);
      queryParams.fn_editor = "true";
    } else {
      queryParams.fn_editor = "false";
    }

    return { path: `/${action.resource_type}`, query: queryParams };
  }

  if (action.action === "navigate_direct") {
    let path = action.target.path || `/${action.resource_type}`;
    // navigate_direct always carries the record form of `query`
    const targetQuery = action.target.query as Record<string, any> | undefined;
    const queryParams: Record<string, string> = {
      org_identifier: orgIdentifier,
      ...targetQuery,
    };

    if (action.resource_type === "alert") {
      path = "/alerts";
      const alertId = action.target.alert_id || targetQuery?.alert_id;
      if (alertId) {
        queryParams.action = "update";
        queryParams.alert_id = alertId;
        queryParams.name = action.target.name || targetQuery?.name;
      }
      queryParams.folder = action.target.folder || targetQuery?.folder || "default";
    } else if (action.resource_type === "dashboard") {
      path = "/dashboards/view";
      queryParams.dashboard =
        action.target.dashboard_id || action.target.dashboardId || targetQuery?.dashboardId;
      queryParams.folder = action.target.folder || targetQuery?.folder || "default";
      queryParams.tab = action.target.tab || "tab-1";
      queryParams.refresh = "Off";
      queryParams.period = "15m";
      queryParams.print = "false";
    } else if (action.resource_type === "pipeline") {
      path = "/pipeline/pipelines/edit";
      queryParams.id = action.target.pipeline_id || action.target.id || targetQuery?.id;
      queryParams.name = action.target.name || targetQuery?.name;
    }

    return { path, query: queryParams };
  }

  return null;
}

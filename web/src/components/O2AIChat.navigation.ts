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
import { raw, type TranslateFn } from "@/types/i18n";

export interface NavigationRoute {
  path: string;
  query: Record<string, string>;
}

const encodeForUrl = (str: string) => btoa(unescape(encodeURIComponent(str)));

function parseNavigationResponse(responseBody: any): any {
  if (!responseBody) return {};

  if (responseBody.response) {
    let responseData = responseBody.response;
    if (typeof responseData === "string") {
      try {
        responseData = JSON.parse(responseData);
      } catch (e) {
        console.warn("[Navigation] Failed to parse response string:", e);
      }
    }
    if (typeof responseData === "object" && responseData !== null) {
      return (
        responseData.v8 || responseData.v7 || responseData.v6 || responseData.v5 || responseData
      );
    }
    return responseData;
  }

  if (
    responseBody.content &&
    Array.isArray(responseBody.content) &&
    responseBody.content[0]?.text
  ) {
    try {
      const parsed = JSON.parse(responseBody.content[0].text);
      return parsed.v8 || parsed.v7 || parsed.v6 || parsed.v5 || parsed;
    } catch (e) {
      console.warn("[Navigation] Failed to parse content text:", e);
    }
    return {};
  }

  return responseBody;
}

// undefined means "not a search tool, try the next pattern"; null means "search tool, but unroutable".
function searchNavigation(callArgs: any, t: TranslateFn): NavigationAction | null | undefined {
  const requestBody = callArgs.request_body || {};
  const query = requestBody.query || {};
  const sql = query.sql || "";
  if (!sql) return undefined;

  const streamType = callArgs.stream_type || "logs";
  let streamName = callArgs.stream_name || "";

  if (!streamName) {
    const fromMatch = sql.match(/FROM\s+["']?([^"'\s,()]+)["']?/i);
    if (fromMatch) {
      streamName = fromMatch[1];
    }
  }

  const vrlFunction = query.functionContent || requestBody.function || requestBody.functionContent;

  if (query.start_time === undefined || query.end_time === undefined) return null;
  if (!streamName) return null;

  const target: any = {
    query: sql,
    sql_mode: true,
    from: query.start_time,
    to: query.end_time,
    stream: streamName.split(","),
  };

  if (vrlFunction) {
    target.functionContent = vrlFunction;
  }

  const streamLabel =
    { logs: t("common.logs"), metrics: t("common.metrics"), traces: t("common.traces") }[
      streamType as string
    ] ?? raw(streamType.charAt(0).toUpperCase() + streamType.slice(1));

  return {
    resource_type: streamType,
    action: "load_query",
    label: t("aiAssistant.viewInTarget", { target: streamLabel }),
    target,
  };
}

/**
 * Maps a tool result to a navigation action: SQL-bearing search tools become a
 * `load_query`, create/get/update/delete tools carrying a `{resource}_id` become a
 * `navigate_direct`. Returns null when neither pattern has the fields it needs.
 */
export function generateNavigationFromToolResult(
  toolName: string,
  callArgs: any,
  responseBody: any,
  t: TranslateFn,
): NavigationAction | null {
  if (!callArgs) {
    return null;
  }

  const searchAction = searchNavigation(callArgs, t);
  if (searchAction !== undefined) return searchAction;

  const resourceTypeMatch = toolName.match(/^(create|get|update|delete)(.+)$/i);
  if (!resourceTypeMatch) return null;

  const resourceType = resourceTypeMatch[2].toLowerCase();

  const parsedResponse = parseNavigationResponse(responseBody);

  const requestBodyFromArgs = (callArgs || {}).request_body || {};
  const data = {
    ...parsedResponse,
    ...(callArgs || {}),
    ...requestBodyFromArgs,
  };

  const resourceIdField = `${resourceType}_id`;
  let resourceId = data[resourceIdField] || data.id;

  if (!resourceId) {
    resourceId = data[resourceType + "Id"];
  }

  if (!resourceId) {
    return null;
  }

  const target: any = {
    [resourceIdField]: resourceId,
  };

  const name = data.name;
  if (name) {
    target.name = name;
  }

  const folder = data.folder;
  if (folder || resourceType === "alert" || resourceType === "dashboard") {
    target.folder = folder || "default";
  }

  return {
    resource_type: resourceType,
    action: "navigate_direct",
    label: t("aiAssistant.viewTarget", {
      target: resourceType.charAt(0).toUpperCase() + resourceType.slice(1),
    }),
    target,
  };
}

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

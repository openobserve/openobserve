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
import {
  epochMs,
  explorerOf,
  explorerTarget,
  streamTypeOf,
  type Explorer,
} from "@/utils/assistant/explorerRoutes";
import { b64DecodeUnicodeSafe } from "@/utils/formatters";

import type { QueryRef, RouteTarget } from "./actions/types";

/** What a link card opens: its kind names the title template, the route is typed (never a raw URL). */
export interface LinkTarget {
  kind: LinkKind;
  route: RouteTarget;
  /** The object's name or id, shown as data inside the title template. */
  name?: string;
  /** The object's id, shown beside a name the model supplied. */
  id?: string;
  explorer?: Explorer;
  query?: QueryRef;
}

export type LinkKind =
  | "explorer"
  | "dashboard"
  | "dashboards"
  | "alert"
  | "alerts"
  | "incident"
  | "incidents"
  | "pipelines"
  | "functions"
  | "trace"
  | "chat";

/** The fields of a `navigation_action` the card reads; `label` and `target.path` are never used. */
export interface NavigationActionLike {
  resource_type: string;
  action: string;
  target: Record<string, unknown>;
}

/** The route of `router.resolve(href)` that `rebuildMarkdownTarget` reads. */
export interface ResolvedLink {
  name?: string | symbol | null;
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
}

/** Same-origin Markdown links become cards only for these read-only routes. */
export const MARKDOWN_LINK_ROUTES = [
  "dashboards",
  "viewDashboard",
  "alertList",
  "alertDetail",
  "incidentList",
  "incidentDetail",
  "pipelines",
  "functionList",
  "traceDetails",
  "assistant",
] as const;

/** The ids each route keeps; every other key is dropped, and `assistant` keeps `chatId` only. */
export const ROUTE_ID_KEYS: Readonly<Record<string, readonly string[]>> = {
  viewDashboard: ["dashboard", "folder", "tab"],
  alertDetail: ["alert_id", "folder"],
  incidentDetail: ["id"],
  traceDetails: ["trace_id", "span_id", "stream", "from", "to"],
  assistant: ["chatId"],
};

// Which declared ids are path params of their route; the rest ride the query.
const ROUTE_PARAM_KEYS: Readonly<Record<string, readonly string[]>> = {
  alertDetail: ["alert_id"],
  incidentDetail: ["id"],
  assistant: ["chatId"],
};

const ROUTE_KIND: Readonly<Record<string, LinkKind>> = {
  dashboards: "dashboards",
  viewDashboard: "dashboard",
  alertList: "alerts",
  alertDetail: "alert",
  incidentList: "incidents",
  incidentDetail: "incident",
  pipelines: "pipelines",
  functionList: "functions",
  traceDetails: "trace",
  assistant: "chat",
};

const EXPLORER_OF_ROUTE: Readonly<Record<string, Explorer>> = {
  logs: "logs",
  metrics: "metrics",
  metricsEditor: "metrics",
  traces: "traces",
};

const EXPLORERS: ReadonlySet<string> = new Set(["logs", "metrics", "traces"]);

const MAX_ID_CHARS = 200;

const MAX_QUERY_CHARS = 20_000;

// Tools from MCP servers or other third parties carry a separator in their name; only O2's own tools route.
const THIRD_PARTY_TOOL = /__|\.|:|\/|^mcp/i;

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

/** A search tool's result as `load_query`, a create/get/update result with an id as `navigate_direct`, else null. */
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

  // No delete: a removed resource has no page left to open.
  const resourceTypeMatch = toolName.match(/^(create|get|update)(.+)$/i);
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

/** Only O2's own tools may propose a route. */
export function isFirstPartyTool(tool: string | undefined): boolean {
  return !!tool && !THIRD_PARTY_TOOL.test(tool);
}

/** A navigation action's card target: the route of its `resource_type` with declared ids only, or null. */
export function buildNavigationRoute(action: NavigationActionLike, org: string): LinkTarget | null {
  const type = String(action.resource_type ?? "").toLowerCase();
  const target = (action.target ?? {}) as Record<string, unknown>;
  if (EXPLORERS.has(type) && (action.action === "load_query" || target.query !== undefined)) {
    return explorerLink(explorerQueryOf(type as Explorer, target, org));
  }
  const ids = idsOf(target);
  const name = idText(target.name);
  switch (type) {
    case "dashboard":
    case "dashboards":
      return ids.dashboard
        ? routeLink("viewDashboard", ids, name ?? ids.dashboard, ids.dashboard)
        : routeLink("dashboards", {});
    case "alert":
    case "alerts":
      return ids.alert_id
        ? routeLink(
            "alertDetail",
            { folder: "default", ...ids },
            name ?? ids.alert_id,
            ids.alert_id,
          )
        : routeLink("alertList", {});
    case "incident":
    case "incidents":
      return ids.id
        ? routeLink("incidentDetail", ids, name ?? ids.id, ids.id)
        : routeLink("incidentList", {});
    case "pipeline":
    case "pipelines":
      return routeLink("pipelines", {});
    case "function":
    case "functions":
      return routeLink("functionList", {});
    case "trace":
      return ids.trace_id ? routeLink("traceDetails", ids, ids.trace_id) : null;
    case "chat":
    case "assistant":
      return ids.chatId ? routeLink("assistant", ids) : null;
    default:
      return null;
  }
}

/** A resolved same-origin href as a card target for an allowlisted route, ids rebuilt; explorer links never run. */
export function rebuildMarkdownTarget(resolved: ResolvedLink): LinkTarget | null {
  const name = typeof resolved.name === "string" ? resolved.name : "";
  const query = resolved.query ?? {};
  const explorer = EXPLORER_OF_ROUTE[name];
  if (explorer) {
    const text = decoded(query.query) ?? decoded(query.sql) ?? "";
    if (!text) return null;
    return explorerLink({
      language: explorer === "metrics" ? "promql" : "sql",
      text,
      ...stringField("stream", idText(firstOf(query.stream))),
      ...stringField("streamType", streamTypeOf(firstOf(query.stream_type)) ?? explorer),
      ...rangeOf(firstOf(query.from), firstOf(query.to)),
      org: "",
    });
  }
  if (!(MARKDOWN_LINK_ROUTES as readonly string[]).includes(name)) return null;
  const values = { ...pickIds(resolved.params ?? {}), ...pickIds(query) };
  const ids = Object.fromEntries(
    (ROUTE_ID_KEYS[name] ?? []).flatMap((key) => (values[key] ? [[key, values[key]]] : [])),
  );
  const required = ROUTE_PARAM_KEYS[name] ?? [];
  if (required.some((key) => !ids[key])) return null;
  const label =
    name === "viewDashboard"
      ? ids.dashboard
      : name === "traceDetails"
        ? ids.trace_id
        : (ids.id ?? ids.alert_id);
  return routeLink(name, ids, label);
}

function explorerLink(query: QueryRef): LinkTarget {
  const explorer = explorerOf(query);
  // The nonce is minted again at the click; a stored card never pins one.
  return { kind: "explorer", route: explorerTarget(query, explorer, ""), explorer, query };
}

function explorerQueryOf(type: Explorer, target: Record<string, unknown>, org: string): QueryRef {
  const source = target.query;
  const text = (typeof source === "string" ? source : source ? JSON.stringify(source) : "").slice(
    0,
    MAX_QUERY_CHARS,
  );
  const stream = Array.isArray(target.stream) ? target.stream.join(",") : target.stream;
  return {
    language: type === "metrics" ? "promql" : "sql",
    text,
    ...stringField("stream", idText(stream)),
    streamType: streamTypeOf(target.stream_type) ?? type,
    ...rangeOf(target.from, target.to),
    org,
  };
}

function routeLink(
  name: string,
  ids: Record<string, string>,
  label?: string,
  id?: string,
): LinkTarget {
  const declared = ROUTE_ID_KEYS[name] ?? [];
  const pathKeys = ROUTE_PARAM_KEYS[name] ?? [];
  const params: Record<string, string> = {};
  const query: Record<string, string> = {};
  for (const key of declared) {
    const value = ids[key];
    if (!value) continue;
    if (pathKeys.includes(key)) params[key] = value;
    else query[key] = value;
  }
  const route: RouteTarget = { name, ...(Object.keys(params).length > 0 && { params }), query };
  return {
    kind: ROUTE_KIND[name] ?? "dashboards",
    route,
    ...(label && { name: label }),
    ...(id && id !== label && { id }),
  };
}

// The navigation frame names ids in several spellings; each maps onto the route's declared key.
function idsOf(target: Record<string, unknown>): Record<string, string> {
  const record = (target.query && typeof target.query === "object" ? target.query : {}) as Record<
    string,
    unknown
  >;
  const pick = (...values: unknown[]) => values.map(idText).find((value) => value !== undefined);
  const ids: Record<string, string | undefined> = {
    dashboard: pick(
      target.dashboard_id,
      target.dashboardId,
      target.dashboard,
      record.dashboardId,
      record.dashboard,
    ),
    folder: pick(target.folder, record.folder),
    tab: pick(target.tab, record.tab),
    alert_id: pick(target.alert_id, target.alertId, record.alert_id),
    id: pick(target.incident_id, target.id, record.id),
    trace_id: pick(target.trace_id, record.trace_id),
    span_id: pick(target.span_id, record.span_id),
    stream: pick(target.stream, record.stream),
    from: pick(target.from, record.from),
    to: pick(target.to, record.to),
    chatId: pick(target.chatId, target.chat_id, target.session_id),
  };
  return Object.fromEntries(
    Object.entries(ids).filter((entry): entry is [string, string] => !!entry[1]),
  );
}

function pickIds(source: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    const text = idText(firstOf(value));
    if (text) out[key] = text;
  }
  return out;
}

function idText(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text && text.length <= MAX_ID_CHARS ? text : undefined;
}

function firstOf(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function decoded(value: unknown): string | undefined {
  const text = firstOf(value);
  if (typeof text !== "string" || !text || text.length > MAX_QUERY_CHARS * 2) return undefined;
  const out = b64DecodeUnicodeSafe(text, "").trim();
  return out ? out.slice(0, MAX_QUERY_CHARS) : undefined;
}

function rangeOf(from: unknown, to: unknown): Pick<QueryRef, "from" | "to"> {
  const start = epochMs(from);
  const end = epochMs(to);
  return start !== null && end !== null && end > start ? { from: start, to: end } : {};
}

function stringField<K extends string>(key: K, value: unknown): Partial<Record<K, string>> {
  return typeof value === "string" && value ? ({ [key]: value } as Record<K, string>) : {};
}

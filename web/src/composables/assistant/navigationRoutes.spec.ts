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
import { createMemoryHistory, createRouter } from "vue-router";

import { b64EncodeUnicode } from "@/utils/formatters";

import {
  MARKDOWN_LINK_ROUTES,
  ROUTE_ID_KEYS,
  buildNavigationRoute,
  isFirstPartyTool,
  rebuildMarkdownTarget,
} from "./navigationRoutes";

const blank = { render: () => null };

// The app's route names and shapes for the allowlist, as `router.ts` declares them.
const router = createRouter({
  history: createMemoryHistory("/web/"),
  routes: [
    { path: "/logs", name: "logs", component: blank },
    { path: "/metrics", name: "metrics", component: blank },
    { path: "/traces", name: "traces", component: blank },
    { path: "/dashboards", name: "dashboards", component: blank },
    { path: "/dashboards/view", name: "viewDashboard", component: blank },
    { path: "/alerts", name: "alertList", component: blank },
    { path: "/alerts/detail/:alert_id", name: "alertDetail", component: blank },
    { path: "/incidents", name: "incidentList", component: blank },
    { path: "/incidents/:id", name: "incidentDetail", component: blank },
    { path: "/traces/trace-details", name: "traceDetails", component: blank },
    { path: "/assistant/:chatId?", name: "assistant", component: blank },
    { path: "/logout", name: "logout", component: blank },
    { path: "/settings", name: "settings", component: blank },
    { path: "/import", name: "importDashboard", component: blank },
    { path: "/ai/shared/:token", name: "sharedChat", component: blank },
    { path: "/ingestion", name: "ingestion", component: blank },
    { path: "/", name: "home", component: blank },
  ],
});

const resolve = (href: string) => router.resolve(href);

describe("buildNavigationRoute", () => {
  it("maps resource_type to its allowlisted route and ignores target.path (nav_path_override)", () => {
    const link = buildNavigationRoute(
      {
        resource_type: "dashboard",
        action: "navigate_direct",
        target: { path: "/web/logout", dashboard_id: "d1", folder: "f1", name: "Checkout" },
      },
      "acme",
    );
    expect(link?.route).toEqual({
      name: "viewDashboard",
      query: { dashboard: "d1", folder: "f1" },
    });
  });

  it("never reads the org from the target (nav_org_override); the applier sets the session's", () => {
    const link = buildNavigationRoute(
      {
        resource_type: "alert",
        action: "navigate_direct",
        target: { alert_id: "a1", query: { org_identifier: "evil", folder: "x" } },
      },
      "acme",
    );
    expect(link?.route).toEqual({
      name: "alertDetail",
      params: { alert_id: "a1" },
      query: { folder: "x" },
    });
    expect(JSON.stringify(link)).not.toContain("evil");
  });

  it("builds the explorer target for load_query with the session's org and no run flag", () => {
    const link = buildNavigationRoute(
      {
        resource_type: "logs",
        action: "load_query",
        target: {
          stream: ["default"],
          query: "SELECT 1",
          from: 1_760_000_000_000_000,
          to: 1_760_000_900_000_000,
          run: true,
          stream_type: "logs&search_type=dashboards#",
        },
      },
      "acme",
    );
    expect(link?.kind).toBe("explorer");
    expect(link?.query?.streamType).toBe("logs");
    expect(link?.query).toMatchObject({ stream: "default", from: 1_760_000_000_000, org: "acme" });
    expect(link?.route.query).toMatchObject({ org_identifier: "acme", type: "ai_chat_query" });
    expect(link?.route.query).not.toHaveProperty("run");
  });

  it("returns null for a resource it cannot route, so the card shows it as unsupported", () => {
    expect(
      buildNavigationRoute(
        { resource_type: "billing", action: "navigate_direct", target: {} },
        "acme",
      ),
    ).toBeNull();
    expect(
      buildNavigationRoute(
        { resource_type: "trace", action: "navigate_direct", target: {} },
        "acme",
      ),
    ).toBeNull();
  });

  const nav = (resource_type: string, target: Record<string, unknown> = {}) =>
    buildNavigationRoute({ resource_type, action: "navigate_direct", target }, "acme");

  it.each([
    [
      "incident",
      { incident_id: "i9" },
      { name: "incidentDetail", params: { id: "i9" }, query: {} },
    ],
    ["incidents", {}, { name: "incidentList", query: {} }],
    [
      "incidents",
      { status: "acknowledged" },
      { name: "incidentList", query: { status: "acknowledged" } },
    ],
    ["incidents", { status: "everything" }, { name: "incidentList", query: {} }],
    ["alerts", {}, { name: "alertList", query: {} }],
    ["alerts", { folder: "payments" }, { name: "alertList", query: { folder: "payments" } }],
    ["dashboards", { folder: "f7" }, { name: "dashboards", query: { folder: "f7" } }],
    ["services", {}, { name: "traces", query: { tab: "services-catalog" } }],
    [
      "services",
      { view: "graph", stream: "default" },
      { name: "traces", query: { tab: "service-graph", stream: "default" } },
    ],
    ["services", { view: "spans" }, { name: "traces", query: { tab: "services-catalog" } }],
    [
      "service",
      { service_name: "checkout-api", stream: "default", view: "graph" },
      {
        name: "traces",
        query: { tab: "services-catalog", service: "checkout-api", stream: "default" },
      },
    ],
    ["service", {}, { name: "traces", query: { tab: "services-catalog" } }],
    ["ingestion", { path: "/web/logout" }, { name: "ingestion", query: {} }],
    ["home", {}, { name: "home", query: {} }],
  ])("routes %s %j with its declared keys on the query", (type, target, route) => {
    expect(nav(type, target)?.route).toEqual(route);
  });

  it("gives each new type its own card kind and names a service by its name", () => {
    expect(nav("services")?.kind).toBe("services");
    expect(nav("service", { service_name: "checkout-api" })).toMatchObject({
      kind: "service",
      name: "checkout-api",
    });
    expect(nav("service")?.kind).toBe("services");
    expect(nav("ingestion")?.kind).toBe("ingestion");
    expect(nav("home")?.kind).toBe("home");
    expect(nav("incidents", { status: "open" })?.kind).toBe("incidents");
  });

  it("names the card from the object name as data, never from the action label", () => {
    const link = buildNavigationRoute(
      {
        resource_type: "dashboard",
        action: "navigate_direct",
        target: { dashboard_id: "d1", name: "Checkout" },
      },
      "acme",
    );
    expect(link).toMatchObject({ kind: "dashboard", name: "Checkout", id: "d1" });
  });

  // The navigation_action frames below are copied from a live agent run (persona test, 2026-11-11).
  it("opens SQL on a metrics stream in the SQL editor over the agent's relative window", () => {
    const link = buildNavigationRoute(
      {
        resource_type: "metrics",
        action: "load_query",
        target: {
          query:
            "SELECT histogram(_timestamp, '1 minute') AS x_axis_1, pod, AVG(value) AS y_axis_1 FROM ta_persona_container_memory_working_set_bytes WHERE service = 'ta_persona_payments-worker' GROUP BY x_axis_1, pod ORDER BY x_axis_1",
          sql_mode: true,
          stream: "ta_persona_container_memory_working_set_bytes",
          from: "2h",
          to: "now",
        },
      },
      "default",
    );
    expect(link?.query).toMatchObject({ language: "sql", period: "2h" });
    expect(link?.route).toMatchObject({ name: "metrics" });
    expect(link?.route.query).toMatchObject({ query_type: "sql", period: "2h" });
  });

  it("keeps PromQL on a metrics link that is not a SQL statement", () => {
    const link = buildNavigationRoute(
      {
        resource_type: "metrics",
        action: "load_query",
        target: { query: "avg by (pod) (container_memory_working_set_bytes)", from: "6h" },
      },
      "default",
    );
    expect(link?.route.query).toMatchObject({ query_type: "promql", period: "6h" });
  });

  it("opens a query for one trace in its trace view, with the range in microseconds", () => {
    const link = buildNavigationRoute(
      {
        resource_type: "traces",
        action: "load_query",
        target: {
          query:
            "SELECT service_name, operation_name, span_kind, duration, status_code, status_message FROM ta_persona_traces WHERE trace_id = '3b44ad2e78a81d70dfc27f77457be8b8' ORDER BY start_time ASC",
          sql_mode: true,
          stream: "ta_persona_traces",
          from: 1794395390000000,
          to: 1794395430000000,
        },
      },
      "default",
    );
    expect(link).toMatchObject({ kind: "trace", name: "3b44ad2e78a81d70dfc27f77457be8b8" });
    expect(link?.route).toEqual({
      name: "traceDetails",
      query: {
        trace_id: "3b44ad2e78a81d70dfc27f77457be8b8",
        stream: "ta_persona_traces",
        from: "1794395390000000",
        to: "1794395430000000",
      },
    });
  });

  it("keeps a traces query over many traces in the Traces explorer", () => {
    const link = buildNavigationRoute(
      {
        resource_type: "traces",
        action: "load_query",
        target: {
          query:
            "SELECT * FROM ta_persona_traces WHERE trace_id = 'aaaaaaaa11111111' OR span_status = 'ERROR'",
          stream: "ta_persona_traces",
          from: 1794395390000000,
          to: 1794395430000000,
        },
      },
      "default",
    );
    expect(link?.kind).toBe("explorer");
    expect(link?.route.name).toBe("traces");
  });
});

describe("rebuildMarkdownTarget", () => {
  it("allowlists read-only routes and keeps only their declared ids", () => {
    expect(
      rebuildMarkdownTarget(resolve("/dashboards/view?dashboard=checkout&folder=f&evil=1"))?.route,
    ).toEqual({
      name: "viewDashboard",
      query: { dashboard: "checkout", folder: "f" },
    });
    expect(rebuildMarkdownTarget(resolve("/incidents/i9?x=1"))?.route).toEqual({
      name: "incidentDetail",
      params: { id: "i9" },
      query: {},
    });
  });

  it("keeps only chatId on the assistant route, so a link cannot stage a chip (assistant_stage_link)", () => {
    expect(
      rebuildMarkdownTarget(resolve("/assistant/c1?assistant=1&object=log_row&ref=x"))?.route,
    ).toEqual({
      name: "assistant",
      params: { chatId: "c1" },
      query: {},
    });
  });

  it.each(["/logout", "/ai/shared/abc", "/import", "/settings", "/nowhere"])(
    "renders %s as no card",
    (href) => {
      expect(rebuildMarkdownTarget(resolve(href))).toBeNull();
    },
  );

  it("turns a Logs permalink with run=true into an explorer target that never runs", () => {
    const sql = b64EncodeUnicode("select 1")!;
    const link = rebuildMarkdownTarget(
      resolve(`/logs?sql=${sql}&run=true&stream=default&stream_type=logs%26use_cache%3Dfalse`),
    );
    expect(link?.query?.streamType).toBe("logs");
    expect(link?.kind).toBe("explorer");
    expect(link?.route.query).toMatchObject({ type: "ai_chat_query", stream: "default" });
    expect(link?.route.query).not.toHaveProperty("run");
    expect(link?.query?.text).toBe("select 1");
  });

  it("pins an explorer target to the chat's org, never an empty one when the org is known (WT-04)", () => {
    const href = `/logs?sql=${b64EncodeUnicode("select 1")}&stream=default&org_identifier=other`;
    expect(rebuildMarkdownTarget(resolve(href), "acme")?.route.query?.org_identifier).toBe("acme");
  });

  it("declares ids only for the routes the allowlist names, or the Traces explorer", () => {
    for (const name of Object.keys(ROUTE_ID_KEYS))
      expect([...MARKDOWN_LINK_ROUTES, "traces"]).toContain(name);
  });

  it("keeps a list link's folder and status, and opens Home and the data sources", () => {
    expect(rebuildMarkdownTarget(resolve("/alerts?folder=payments&x=1"))?.route).toEqual({
      name: "alertList",
      query: { folder: "payments" },
    });
    expect(rebuildMarkdownTarget(resolve("/incidents?status=open"))?.route).toEqual({
      name: "incidentList",
      query: { status: "open" },
    });
    expect(rebuildMarkdownTarget(resolve("/ingestion"))?.kind).toBe("ingestion");
    expect(rebuildMarkdownTarget(resolve("/?home_tab=usage"))?.route).toEqual({
      name: "home",
      query: {},
    });
  });
});

describe("isFirstPartyTool", () => {
  it("accepts O2's own tools and refuses MCP and namespaced ones", () => {
    expect(isFirstPartyTool("createDashboard")).toBe(true);
    expect(isFirstPartyTool("o2_UpdateAlert")).toBe(true);
    expect(isFirstPartyTool("mcp__github__create_issue")).toBe(false);
    expect(isFirstPartyTool("server.createThing")).toBe(false);
    expect(isFirstPartyTool(undefined)).toBe(false);
  });
});

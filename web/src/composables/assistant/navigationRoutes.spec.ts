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
    { path: "/metrics/editor", name: "metricsEditor", component: blank },
    { path: "/traces", name: "traces", component: blank },
    { path: "/dashboards", name: "dashboards", component: blank },
    { path: "/dashboards/view", name: "viewDashboard", component: blank },
    { path: "/alerts", name: "alertList", component: blank },
    { path: "/alerts/detail/:alert_id", name: "alertDetail", component: blank },
    { path: "/incidents/:id", name: "incidentDetail", component: blank },
    { path: "/traces/trace-details", name: "traceDetails", component: blank },
    { path: "/assistant/:chatId?", name: "assistant", component: blank },
    { path: "/logout", name: "logout", component: blank },
    { path: "/settings", name: "settings", component: blank },
    { path: "/import", name: "importDashboard", component: blank },
    { path: "/ai/shared/:token", name: "sharedChat", component: blank },
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

  it("declares ids only for the routes the allowlist names", () => {
    for (const name of Object.keys(ROUTE_ID_KEYS))
      expect(MARKDOWN_LINK_ROUTES as readonly string[]).toContain(name);
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

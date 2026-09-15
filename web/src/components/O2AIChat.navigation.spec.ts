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

import { describe, expect, it, vi } from "vitest";

import {
  buildNavigationRoute,
  generateNavigationFromToolResult,
  navigationPageName,
} from "@/components/O2AIChat.navigation";
import type { NavigationAction } from "@/ts/interfaces/chat";
import { raw, type TranslateFn } from "@/types/i18n";

const t = ((key: string, params?: Record<string, any>) =>
  raw(params ? `${key}:${JSON.stringify(params)}` : key)) as unknown as TranslateFn;

const searchArgs = (over: Record<string, any> = {}) => ({
  stream_type: "logs",
  request_body: { query: { sql: "SELECT * FROM default", start_time: 1, end_time: 2 } },
  ...over,
});

describe("generateNavigationFromToolResult", () => {
  it("returns null without callArgs", () => {
    expect(generateNavigationFromToolResult("Search", null, {}, t)).toBeNull();
  });

  it("builds a load_query action from a search tool", () => {
    const action = generateNavigationFromToolResult("Search", searchArgs(), {}, t)!;
    expect(action.action).toBe("load_query");
    expect(action.resource_type).toBe("logs");
    expect(action.target).toMatchObject({
      query: "SELECT * FROM default",
      sql_mode: true,
      from: 1,
      to: 2,
      stream: ["default"],
    });
  });

  it("prefers an explicit stream_name over the FROM clause", () => {
    const action = generateNavigationFromToolResult(
      "Search",
      searchArgs({ stream_name: "a,b" }),
      {},
      t,
    )!;
    expect(action.target.stream).toEqual(["a", "b"]);
  });

  it("carries a VRL function through when present", () => {
    const args = searchArgs();
    args.request_body.query.functionContent = ".x = 1";
    expect(generateNavigationFromToolResult("Search", args, {}, t)!.target.functionContent).toBe(
      ".x = 1",
    );
  });

  it("returns null when the search has no time range", () => {
    const args = searchArgs();
    delete (args.request_body.query as any).end_time;
    expect(generateNavigationFromToolResult("Search", args, {}, t)).toBeNull();
  });

  it("returns null when a search has sql but no derivable stream, never falling through", () => {
    const args = searchArgs({
      request_body: { query: { sql: "SELECT 1", start_time: 1, end_time: 2 } },
    });
    expect(generateNavigationFromToolResult("createAlert", args, { alert_id: "a1" }, t)).toBeNull();
  });

  it("titles unknown stream types", () => {
    const action = generateNavigationFromToolResult(
      "Search",
      searchArgs({ stream_type: "enrichment" }),
      {},
      t,
    )!;
    expect(action.label).toContain("Enrichment");
  });

  it("returns null when the tool name matches no CRUD prefix", () => {
    expect(generateNavigationFromToolResult("listThings", { a: 1 }, { id: "x" }, t)).toBeNull();
  });

  it("builds navigate_direct from a {resource}_id in the response", () => {
    const action = generateNavigationFromToolResult(
      "createAlert",
      { request_body: {} },
      { alert_id: "a1", name: "n" },
      t,
    )!;
    expect(action.action).toBe("navigate_direct");
    expect(action.resource_type).toBe("alert");
    expect(action.target).toEqual({ alert_id: "a1", name: "n", folder: "default" });
  });

  it("accepts the camelCase id variant", () => {
    const action = generateNavigationFromToolResult(
      "getDashboard",
      { request_body: {} },
      { dashboardId: "d1" },
      t,
    )!;
    expect(action.target.dashboard_id).toBe("d1");
  });

  it("omits folder for resources that do not use one", () => {
    const action = generateNavigationFromToolResult(
      "getPipeline",
      { request_body: {} },
      { pipeline_id: "p1" },
      t,
    )!;
    expect(action.target.folder).toBeUndefined();
  });

  it("unwraps a JSON string response and its versioned payload", () => {
    const action = generateNavigationFromToolResult(
      "getDashboard",
      { request_body: {} },
      { response: JSON.stringify({ v5: { dashboard_id: "d5" } }) },
      t,
    )!;
    expect(action.target.dashboard_id).toBe("d5");
  });

  it("unwraps the MCP content[0].text shape", () => {
    const action = generateNavigationFromToolResult(
      "getDashboard",
      { request_body: {} },
      { content: [{ text: JSON.stringify({ v8: { dashboard_id: "d8" } }) }] },
      t,
    )!;
    expect(action.target.dashboard_id).toBe("d8");
  });

  it("returns null when the MCP text is unparseable", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      generateNavigationFromToolResult(
        "getDashboard",
        { request_body: {} },
        { content: [{ text: "not json" }] },
        t,
      ),
    ).toBeNull();
    warn.mockRestore();
  });

  it("lets callArgs.request_body override the parsed response", () => {
    const action = generateNavigationFromToolResult(
      "updateAlert",
      { alert_id: "fromArgs", request_body: { alert_id: "fromBody" } },
      { alert_id: "fromResponse" },
      t,
    )!;
    expect(action.target.alert_id).toBe("fromBody");
  });
});

describe("navigationPageName", () => {
  it("prefers the label", () => {
    expect(
      navigationPageName({ label: raw("L"), resource_type: "alert", target: { name: "N" } } as any),
    ).toBe("L");
  });

  it("falls back to the target name, then the capitalised resource type", () => {
    expect(
      navigationPageName({ label: raw(""), resource_type: "alert", target: { name: "N" } } as any),
    ).toBe("N");
    expect(navigationPageName({ label: raw(""), resource_type: "alert", target: {} } as any)).toBe(
      "Alert",
    );
  });
});

describe("buildNavigationRoute", () => {
  const decode = (s: string) => decodeURIComponent(escape(atob(s)));

  it("builds the logs route for load_query", () => {
    const action: NavigationAction = {
      resource_type: "logs",
      action: "load_query",
      label: raw("l"),
      target: { query: "SELECT 1", sql_mode: true, from: 1, to: 2, stream: ["a", "b"] },
    };
    const route = buildNavigationRoute(action, "org1")!;
    expect(route.path).toBe("/logs");
    expect(route.query).toMatchObject({
      org_identifier: "org1",
      stream_type: "logs",
      stream: "a,b",
      from: "1",
      to: "2",
      sql_mode: "true",
      fn_editor: "false",
      type: "ai_chat_query",
    });
    expect(decode(route.query.query)).toBe("SELECT 1");
  });

  it("uses period when no absolute range is given", () => {
    const route = buildNavigationRoute(
      { resource_type: "logs", action: "load_query", label: raw("l"), target: { period: "15m" } },
      "org1",
    )!;
    expect(route.query.period).toBe("15m");
    expect(route.query.from).toBeUndefined();
  });

  it("enables the function editor when a VRL function is present", () => {
    const route = buildNavigationRoute(
      {
        resource_type: "logs",
        action: "load_query",
        label: raw("l"),
        target: { functionContent: ".x = 1" },
      },
      "org1",
    )!;
    expect(route.query.fn_editor).toBe("true");
    expect(decode(route.query.functionContent)).toBe(".x = 1");
  });

  it("routes alerts to /alerts with the update action", () => {
    const route = buildNavigationRoute(
      {
        resource_type: "alert",
        action: "navigate_direct",
        label: raw("l"),
        target: { alert_id: "a1", name: "n" },
      },
      "org1",
    )!;
    expect(route.path).toBe("/alerts");
    expect(route.query).toEqual({
      org_identifier: "org1",
      action: "update",
      alert_id: "a1",
      name: "n",
      folder: "default",
    });
  });

  it("routes dashboards to the view page with its fixed defaults", () => {
    const route = buildNavigationRoute(
      {
        resource_type: "dashboard",
        action: "navigate_direct",
        label: raw("l"),
        target: { dashboard_id: "d1" },
      },
      "org1",
    )!;
    expect(route.path).toBe("/dashboards/view");
    expect(route.query).toMatchObject({
      dashboard: "d1",
      folder: "default",
      tab: "tab-1",
      refresh: "Off",
      period: "15m",
      print: "false",
    });
  });

  it("routes pipelines to the edit page", () => {
    const route = buildNavigationRoute(
      {
        resource_type: "pipeline",
        action: "navigate_direct",
        label: raw("l"),
        target: { pipeline_id: "p1", name: "n" },
      },
      "org1",
    )!;
    expect(route.path).toBe("/pipeline/pipelines/edit");
    expect(route.query).toMatchObject({ id: "p1", name: "n" });
  });

  it("falls back to /{resource_type} for an unknown navigate_direct resource", () => {
    const route = buildNavigationRoute(
      { resource_type: "stream", action: "navigate_direct", label: raw("l"), target: {} },
      "org1",
    )!;
    expect(route.path).toBe("/stream");
  });

  it("returns null for an action with no route", () => {
    expect(
      buildNavigationRoute(
        { resource_type: "alert", action: "noop" as any, label: raw("l"), target: {} },
        "org1",
      ),
    ).toBeNull();
  });
});

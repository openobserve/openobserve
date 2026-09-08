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

import { describe, it, expect, vi } from "vitest";
import { raw } from "@/types/i18n";

vi.mock("@/services/dashboards", () => ({ default: { list: vi.fn() } }));
vi.mock("@/services/alerts", () => ({ default: { listByFolderId: vi.fn() } }));
vi.mock("@/services/saved_views", () => ({ default: { get: vi.fn() } }));
vi.mock("@/services/jstransform", () => ({ default: { list: vi.fn() } }));
vi.mock("@/services/pipelines", () => ({ default: { getPipelines: vi.fn() } }));
vi.mock("@/services/users", () => ({ default: { orgUsers: vi.fn() } }));
vi.mock("@/services/synthetics", () => ({ default: { listByFolderId: vi.fn() } }));
vi.mock("@/services/service_accounts", () => ({ default: { list: vi.fn() } }));
const searchStreams = vi.fn();

import dashboardService from "@/services/dashboards";
import alertsService from "@/services/alerts";
import transformService from "@/services/jstransform";
import { createEntityProviders } from "./entities";
import { dashboardToItem } from "./dashboards";
import { alertToItem } from "./alerts";
import { streamToItem } from "./streams";
import { pipelineToItem } from "./pipelines";
import { serviceAccountToItem, userToItem } from "./users";
import { syntheticToItem } from "./synthetics";
import syntheticsService from "@/services/synthetics";
import usersService from "@/services/users";

const ctx = (
  over: Partial<{ routes: string[]; state: any; nav: string[]; rail: string[] }> = {},
) => ({
  store: { state: over.state ?? {} },
  navNames: new Set(over.nav ?? []),
  railKeys: over.rail ?? [
    "home",
    "logs",
    "metrics",
    "traces",
    "dashboards",
    "reliability",
    "data",
    "iam",
  ],
  t: raw as any,
  org: "org1",
  hasRoute: (n: string) =>
    (
      over.routes ?? ["dashboards", "alertDetail", "logs", "functionList", "pipelineEditor"]
    ).includes(n),
  searchStreams,
});

describe("entity mappers", () => {
  it("maps a dashboard to its folder-aware deep link", () => {
    expect(
      dashboardToItem({
        dashboard_id: "d1",
        title: "Payments",
        folder_id: "f1",
        folder_name: "SRE",
      }),
    ).toMatchObject({
      id: "dashboard:f1/d1",
      type: "dashboard",
      label: "Payments",
      subtitle: "SRE",
      route: { path: "/dashboards/view", query: { dashboard: "d1", folder: "f1" } },
    });
    expect(dashboardToItem({ dashboard_id: "d1", title: "Payments" }).keywords).toContain("d1");
    expect(dashboardToItem({ dashboard_id: "d2", title: "X" }).route).toEqual({
      path: "/dashboards/view",
      query: { dashboard: "d2", folder: "default" },
    });
  });

  it("maps an alert with its folder and paused state", () => {
    const item = alertToItem({
      alert_id: "a1",
      name: "p99",
      folder_id: "f1",
      folder_name: "SRE",
      enabled: false,
    });
    expect(item.keywords).toContain("a1");
    expect(item).toMatchObject({
      id: "alert:a1",
      subtitle: "SRE · paused",
      route: { name: "alertDetail", params: { alert_id: "a1" }, query: { folder: "f1" } },
    });
  });

  it("routes streams to the explorer for their type", () => {
    expect(streamToItem({ name: "s", stream_type: "logs" }, "Logs stream").route).toEqual({
      name: "logs",
      query: { stream: "s", stream_type: "logs", type: "stream_explorer" },
    });
    expect(streamToItem({ name: "m", stream_type: "metrics" }, "Metrics stream").route).toEqual({
      name: "metrics",
      query: { search: "m" },
    });
    expect(streamToItem({ name: "t", stream_type: "traces" }, "Traces stream").route).toEqual({
      name: "traces",
      query: { stream: "t" },
    });
  });

  it("maps a pipeline with its source summary", () => {
    const item = pipelineToItem({
      pipeline_id: "p1",
      name: "etl",
      enabled: true,
      source: { source_type: "realtime", stream_name: "default" },
    });
    expect(item).toMatchObject({ id: "pipeline:p1", subtitle: "realtime · default" });
    expect(item.route).toEqual({ name: "pipelineEditor", query: { id: "p1", name: "etl" } });
  });
});

describe("createEntityProviders", () => {
  it("gates each provider on its route", () => {
    const providers = createEntityProviders(ctx({ routes: ["logs"] }));
    expect(providers.map((p) => [p.id, p.enabled()])).toEqual([
      ["dashboards", false],
      ["alerts", false],
      ["streams", true],
      ["savedViews", true],
      ["functions", false],
      ["pipelines", false],
      ["synthetics", false],
      ["users", false],
      ["serviceAccounts", false],
    ]);
  });

  it("lists dashboards across folders in one call and skips malformed rows", async () => {
    (dashboardService.list as any).mockResolvedValue({
      data: {
        dashboards: [
          { dashboard_id: "d1", title: "A", folder_id: "f" },
          { dashboard_id: "", title: "bad" },
        ],
      },
    });
    const p = createEntityProviders(ctx()).find((x) => x.id === "dashboards")!;
    const items = await p.list!(new AbortController().signal);
    expect(dashboardService.list).toHaveBeenCalledWith(
      0,
      1000,
      "name",
      false,
      "",
      "org1",
      "",
      "",
      expect.any(AbortSignal),
    );
    expect(items.map((i) => i.id)).toEqual(["dashboard:f/d1"]);
  });

  it("lists alerts through the v2 endpoint without a folder", async () => {
    (alertsService.listByFolderId as any).mockResolvedValue({
      data: { list: [{ alert_id: "a", name: "n" }] },
    });
    const p = createEntityProviders(ctx()).find((x) => x.id === "alerts")!;
    expect((await p.list!(new AbortController().signal)).map((i) => i.id)).toEqual(["alert:a"]);
    expect(alertsService.listByFolderId).toHaveBeenCalledWith(
      0,
      1000,
      "name",
      false,
      "",
      "org1",
      undefined,
      undefined,
      undefined,
      undefined,
      expect.any(AbortSignal),
    );
  });

  it("uses the warm store for functions and falls back to the API", async () => {
    const warm = createEntityProviders(
      ctx({ state: { organizationData: { functions: [{ name: "f1" }] } } }),
    );
    expect(
      (await warm.find((x) => x.id === "functions")!.list!(new AbortController().signal)).map(
        (i) => i.id,
      ),
    ).toEqual(["function:f1"]);
    expect(transformService.list).not.toHaveBeenCalled();
    (transformService.list as any).mockResolvedValue({ data: { list: [{ name: "f2" }] } });
    const cold = createEntityProviders(ctx());
    expect(
      (await cold.find((x) => x.id === "functions")!.list!(new AbortController().signal)).map(
        (i) => i.id,
      ),
    ).toEqual(["function:f2"]);
  });

  it("lists streams once on open and only searches types too large to list", async () => {
    const state = {
      streams: {
        logs: { list: [{ name: "l", stream_type: "logs" }] },
        metrics: null,
        traces: null,
      },
    };
    const p = createEntityProviders(ctx({ state })).find((x) => x.id === "streams")!;
    searchStreams.mockImplementation(async (type: string) =>
      type === "metrics"
        ? { list: [{ name: "m" }], total: 5000 }
        : { list: [{ name: "t" }], total: 1 },
    );
    const listed = await p.list!(new AbortController().signal);
    expect(listed.map((i) => i.id).sort()).toEqual([
      "stream:logs/l",
      "stream:metrics/m",
      "stream:traces/t",
    ]);
    expect(searchStreams).toHaveBeenCalledTimes(2);
    expect(searchStreams).toHaveBeenCalledWith("metrics", "", 1000);
    searchStreams.mockClear();
    expect(await p.search!("x", new AbortController().signal)).toEqual([]);
    expect(searchStreams).not.toHaveBeenCalled();
    searchStreams.mockResolvedValue({ list: [{ name: "xm" }] });
    const found = await p.search!("xm", new AbortController().signal);
    expect(searchStreams).toHaveBeenCalledTimes(1);
    expect(searchStreams).toHaveBeenCalledWith("metrics", "xm", 20);
    expect(found.map((i) => i.id)).toEqual(["stream:metrics/xm"]);
  });

  it("maps people rows and gates them on the IAM rail link", async () => {
    expect(
      userToItem({ email: "a@x.io", first_name: "Ada", last_name: "L", role: "admin" }, "Admin"),
    ).toMatchObject({
      id: "user:a@x.io",
      label: "Ada L",
      subtitle: "a@x.io · Admin",
      route: { name: "users", query: { action: "update", email: "a@x.io" } },
    });
    expect(userToItem({ email: "b@x.io" }, "").label).toBe("b@x.io");
    expect(
      serviceAccountToItem({ email: "svc@x.io", first_name: "CI" }, "Service account").route,
    ).toEqual({
      name: "serviceAccounts",
      query: { action: "update", email: "svc@x.io" },
    });
    const routes = ["users", "serviceAccounts"];
    const member = createEntityProviders(ctx({ routes, nav: ["logs"] }));
    expect(member.find((p) => p.id === "users")!.enabled()).toBe(false);
    const admin = createEntityProviders(ctx({ routes, nav: ["logs", "iam"] }));
    expect(admin.find((p) => p.id === "users")!.enabled()).toBe(true);
    (usersService.orgUsers as any).mockResolvedValue({
      data: { data: [{ email: "a@x.io", role: "admin" }] },
    });
    const items = await admin.find((p) => p.id === "users")!.list!(new AbortController().signal);
    expect(items.map((i) => i.id)).toEqual(["user:a@x.io"]);
  });

  it("maps synthetic checks to their results page and gates on the results route", async () => {
    const item = syntheticToItem(
      {
        id: 42,
        name: "Home page",
        type: "browser",
        target: "https://x.io",
        folder_id: "f1",
        enabled: false,
      },
      "org1",
    );
    expect(item).toMatchObject({ id: "synthetic:42", subtitle: "BROWSER · https://x.io · paused" });
    expect(item.keywords).toContain("42");
    expect(item.route).toMatchObject({ name: "synthetic-monitor-results", params: { id: "42" } });
    const off = createEntityProviders(ctx()).find((p) => p.id === "synthetics")!;
    expect(off.enabled()).toBe(false);
    const on = createEntityProviders(ctx({ routes: ["synthetic-monitor-results"] })).find(
      (p) => p.id === "synthetics",
    )!;
    (syntheticsService.listByFolderId as any).mockResolvedValue({
      data: { checks: [{ id: 1, name: "API" }] },
    });
    expect((await on.list!(new AbortController().signal)).map((i) => i.id)).toEqual([
      "synthetic:1",
    ]);
    expect(syntheticsService.listByFolderId).toHaveBeenCalledWith(
      "org1",
      "all",
      expect.any(AbortSignal),
    );
  });

  it("places entity rows under the rail tile that shows them", () => {
    const flat = createEntityProviders(
      ctx({ rail: ["home", "logs", "alertList", "pipeline", "dashboards"] }),
    );
    const g1 = Object.fromEntries(flat.map((p) => [p.id, p.groups]));
    expect(g1.dashboards).toEqual(["dashboards"]);
    expect(g1.alerts).toEqual(["alertList"]);
    expect(g1.pipelines).toEqual(["pipeline"]);
    expect(g1.streams).toEqual(["logs"]);
    expect(g1.users).toEqual([]);
    const grouped = createEntityProviders(
      ctx({ rail: ["reliability", "data", "iam", "experience"] }),
    );
    const g2 = Object.fromEntries(grouped.map((p) => [p.id, p.groups]));
    expect(g2.alerts).toEqual(["reliability"]);
    expect(g2.functions).toEqual(["data"]);
    expect(g2.synthetics).toEqual(["experience"]);
    expect(g2.serviceAccounts).toEqual(["iam"]);
  });
});

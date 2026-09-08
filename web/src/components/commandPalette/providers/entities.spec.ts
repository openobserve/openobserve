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
const getPaginatedStreams = vi.fn();
vi.mock("@/composables/useStreams", () => ({ default: () => ({ getPaginatedStreams }) }));

import dashboardService from "@/services/dashboards";
import alertsService from "@/services/alerts";
import transformService from "@/services/jstransform";
import { createEntityProviders } from "./entities";
import { dashboardToItem } from "./dashboards";
import { alertToItem } from "./alerts";
import { streamToItem } from "./streams";
import { pipelineToItem } from "./pipelines";

const ctx = (over: Partial<{ routes: string[]; state: any }> = {}) => ({
  store: { state: over.state ?? {} },
  t: raw as any,
  org: "org1",
  hasRoute: (n: string) =>
    (
      over.routes ?? ["dashboards", "alertDetail", "logs", "functionList", "pipelineEditor"]
    ).includes(n),
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
    expect(dashboardService.list).toHaveBeenCalledWith(0, 1000, "name", false, "", "org1", "", "");
    expect(items.map((i) => i.id)).toEqual(["dashboard:f/d1"]);
  });

  it("lists alerts through the v2 endpoint without a folder", async () => {
    (alertsService.listByFolderId as any).mockResolvedValue({
      data: { list: [{ alert_id: "a", name: "n" }] },
    });
    const p = createEntityProviders(ctx()).find((x) => x.id === "alerts")!;
    expect((await p.list!(new AbortController().signal)).map((i) => i.id)).toEqual(["alert:a"]);
    expect(alertsService.listByFolderId).toHaveBeenCalledWith(0, 1000, "name", false, "", "org1");
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

  it("lists streams from the store when warm and searches each type by keyword", async () => {
    const state = {
      streams: {
        logs: { list: [{ name: "l", stream_type: "logs" }] },
        metrics: null,
        traces: null,
      },
    };
    const p = createEntityProviders(ctx({ state })).find((x) => x.id === "streams")!;
    expect((await p.list!(new AbortController().signal)).map((i) => i.id)).toEqual([
      "stream:logs/l",
    ]);
    getPaginatedStreams.mockResolvedValue({ list: [{ name: "x" }] });
    const found = await p.search!("x", new AbortController().signal);
    expect(getPaginatedStreams).toHaveBeenCalledTimes(3);
    expect(getPaginatedStreams).toHaveBeenCalledWith("logs", false, false, 0, 20, "x");
    expect(found.map((i) => i.id).sort()).toEqual([
      "stream:logs/x",
      "stream:metrics/x",
      "stream:traces/x",
    ]);
  });
});

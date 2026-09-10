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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { raw } from "@/types/i18n";

vi.mock("@/services/resources", () => ({ default: { search: vi.fn() } }));

import resourcesService from "@/services/resources";
import { createEntityProviders } from "./entities";
import { dashboardToItem } from "./dashboards";
import { alertToItem } from "./alerts";
import { streamToItem } from "./streams";
import { pipelineToItem } from "./pipelines";
import { serviceAccountToItem, userToItem } from "./users";
import { syntheticToItem } from "./synthetics";
import {
  createResourcesProvider,
  hitToItem,
  resourceTypeSpecs,
  typesForScopes,
  type ResourceHit,
} from "./resources";

const ALL_ROUTES = [
  "dashboards",
  "alertDetail",
  "logs",
  "functionList",
  "pipelineEditor",
  "users",
  "serviceAccounts",
  "synthetic-monitor-results",
];

const ctx = (over: Partial<{ routes: string[]; nav: string[]; rail: string[] }> = {}) => ({
  store: { state: {} },
  navNames: new Set(over.nav ?? ["iam"]),
  railKeys: over.rail ?? [
    "home",
    "logs",
    "metrics",
    "traces",
    "experience",
    "dashboards",
    "reliability",
    "data",
    "iam",
  ],
  t: raw as any,
  org: "org1",
  hasRoute: (n: string) => (over.routes ?? ALL_ROUTES).includes(n),
});

const hit = (
  over: Partial<ResourceHit> & Pick<ResourceHit, "type" | "id" | "name">,
): ResourceHit => ({
  score: 0,
  ...over,
});

const signal = () => new AbortController().signal;

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
    const item = alertToItem(
      {
        alert_id: "a1",
        name: "p99",
        folder_id: "f1",
        folder_name: "SRE",
        enabled: false,
      },
      undefined,
      "paused",
    );
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

  it("maps people rows to their IAM edit forms", () => {
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
  });

  it("maps synthetic checks to their results page", () => {
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
      undefined,
      "paused",
    );
    expect(item).toMatchObject({ id: "synthetic:42", subtitle: "BROWSER · https://x.io · paused" });
    expect(item.keywords).toContain("42");
    expect(item.route).toMatchObject({ name: "synthetic-monitor-results", params: { id: "42" } });
  });
});

describe("resourceTypeSpecs", () => {
  const enabled = (c: ReturnType<typeof ctx>) =>
    resourceTypeSpecs(c)
      .filter((s) => s.enabled)
      .map((s) => s.type);

  it("gates each type on its route and people on the visible IAM link", () => {
    expect(enabled(ctx({ routes: ["logs"] }))).toEqual(["stream", "saved_view"]);
    expect(enabled(ctx({ routes: ["users", "serviceAccounts"], nav: ["logs"] }))).toEqual([]);
    expect(enabled(ctx({ routes: ["users", "serviceAccounts"], nav: ["logs", "iam"] }))).toEqual([
      "user",
      "service_account",
    ]);
    expect(enabled(ctx())).toHaveLength(9);
  });

  it("places each type under the rail tile that shows it", () => {
    const flat = Object.fromEntries(
      resourceTypeSpecs(ctx({ rail: ["home", "logs", "alertList", "pipeline", "dashboards"] })).map(
        (s) => [s.type, s.groups],
      ),
    );
    expect(flat.dashboard).toEqual(["dashboards"]);
    expect(flat.alert).toEqual(["alertList"]);
    expect(flat.pipeline).toEqual(["pipeline"]);
    expect(flat.stream).toEqual(["logs"]);
    expect(flat.user).toEqual([]);
    const grouped = Object.fromEntries(
      resourceTypeSpecs(ctx({ rail: ["reliability", "data", "iam", "experience", "metrics"] })).map(
        (s) => [s.type, s.groups],
      ),
    );
    expect(grouped.alert).toEqual(["reliability"]);
    expect(grouped.function).toEqual(["data"]);
    expect(grouped.synthetic).toEqual(["experience"]);
    expect(grouped.service_account).toEqual(["iam"]);
    expect(grouped.stream).toEqual(["data", "metrics"]);
  });

  it("narrows the requested types to the selected tiles", () => {
    const specs = resourceTypeSpecs(ctx());
    expect(typesForScopes(specs, [])).toHaveLength(9);
    expect(typesForScopes(specs, ["reliability"])).toEqual(["alert"]);
    expect(typesForScopes(specs, ["data", "iam"])).toEqual([
      "function",
      "pipeline",
      "user",
      "service_account",
    ]);
    expect(typesForScopes(specs, ["home"])).toEqual([]);
  });
});

describe("hitToItem", () => {
  const specs = resourceTypeSpecs(ctx());
  const c = ctx();

  it("turns each hit type into the palette row its page opens", () => {
    expect(
      hitToItem(
        hit({ type: "dashboard", id: "d1", name: "Pay", folder_id: "f", folder_name: "SRE" }),
        c,
        specs,
      ),
    ).toMatchObject({ id: "dashboard:f/d1", group: "dashboards", subtitle: "SRE" });
    expect(
      hitToItem(hit({ type: "alert", id: "a1", name: "p99", enabled: false }), c, specs),
    ).toMatchObject({ id: "alert:a1", group: "reliability" });
    expect(
      hitToItem(
        hit({ type: "stream", id: "metrics/m", name: "m", stream_type: "metrics" }),
        c,
        specs,
      ),
    ).toMatchObject({ id: "stream:metrics/m", group: "metrics" });
    expect(
      hitToItem(hit({ type: "stream", id: "x/y", name: "y", stream_type: "x" }), c, specs),
    ).toBe(null);
    expect(hitToItem(hit({ type: "saved_view", id: "v1", name: "errs" }), c, specs)).toMatchObject({
      id: "savedView:v1",
      group: "logs",
    });
    expect(hitToItem(hit({ type: "function", id: "f1", name: "f1" }), c, specs)).toMatchObject({
      id: "function:f1",
      group: "data",
    });
    expect(hitToItem(hit({ type: "pipeline", id: "p1", name: "etl" }), c, specs)).toMatchObject({
      id: "pipeline:p1",
      group: "data",
    });
    expect(
      hitToItem(hit({ type: "user", id: "a@x.io", name: "Ada L", role: "admin" }), c, specs),
    ).toMatchObject({ id: "user:a@x.io", label: "Ada L", group: "iam" });
    expect(hitToItem(hit({ type: "user", id: "b@x.io", name: "b@x.io" }), c, specs)).toMatchObject({
      label: "b@x.io",
    });
    expect(
      hitToItem(hit({ type: "service_account", id: "svc@x.io", name: "CI" }), c, specs),
    ).toMatchObject({ id: "serviceAccount:svc@x.io", group: "iam" });
    expect(
      hitToItem(hit({ type: "synthetic", id: "42", name: "Home", folder_id: "f1" }), c, specs),
    ).toMatchObject({ id: "synthetic:42", group: "experience" });
  });
});

describe("createResourcesProvider", () => {
  beforeEach(() => (resourcesService.search as any).mockReset());

  it("is the only entity provider and covers every tile with an enabled type", () => {
    const providers = createEntityProviders(ctx());
    expect(providers.map((p) => p.id)).toEqual(["resources"]);
    expect([...providers[0].groups].sort()).toEqual(
      [
        "dashboards",
        "data",
        "experience",
        "iam",
        "logs",
        "metrics",
        "reliability",
        "traces",
      ].sort(),
    );
    expect(createEntityProviders(ctx({ routes: [] }))[0].enabled()).toBe(false);
  });

  it("asks the server once with the types for the selected tiles and maps the hits", async () => {
    (resourcesService.search as any).mockResolvedValue({
      data: {
        hits: [
          hit({ type: "alert", id: "a1", name: "p99", folder_id: "f" }),
          hit({ type: "alert", id: "", name: "broken" }),
        ],
        truncated: [],
      },
    });
    const p = createResourcesProvider(ctx());
    const items = await p.search("p9", ["reliability"], signal());
    expect(resourcesService.search).toHaveBeenCalledTimes(1);
    expect(resourcesService.search).toHaveBeenCalledWith(
      "org1",
      { q: "p9", types: "alert", limit: 20 },
      expect.any(AbortSignal),
    );
    expect(items.map((i) => i.id)).toEqual(["alert:a1"]);
  });

  it("lists a tile with a larger limit on an empty query and skips tiles with no types", async () => {
    (resourcesService.search as any).mockResolvedValue({ data: { hits: [] } });
    const p = createResourcesProvider(ctx());
    await p.search("", ["dashboards"], signal());
    expect(resourcesService.search).toHaveBeenCalledWith(
      "org1",
      { q: "", types: "dashboard", limit: 50 },
      expect.any(AbortSignal),
    );
    expect(await p.search("x", ["home"], signal())).toEqual([]);
    expect(resourcesService.search).toHaveBeenCalledTimes(1);
  });
});

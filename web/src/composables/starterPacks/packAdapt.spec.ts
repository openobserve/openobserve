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
  adaptAlert,
  adaptDashboard,
  adaptSavedView,
  addStreamPickers,
  withFlavour,
} from "./packAdapt";
import { fitDashboard } from "./dashboardFit";
import { StreamRewriteError, type RewriteChecks } from "./streamRewriter";
import type { PackBinding } from "./types";

const tree = (query: string) => {
  const names = [...query.matchAll(/\b(kube_\w+|edge\w*|renamed)\b/g)].map((match) => match[1]);
  return { type: "unsupported", children: names.map((name) => ({ name, matchers: [] })) };
};
const checks: RewriteChecks = { sql: vi.fn(async () => {}), promql: async (query) => tree(query) };
const bind = (stream: string, from: string, to: string): PackBinding => ({
  stream,
  from,
  to,
  tier: "alias",
});
const promqlAlert = (promql: string) => ({
  stream_name: "kube_pod_info",
  stream_type: "metrics",
  query_condition: { type: "promql", promql, conditions: {} },
});

describe("adaptAlert", () => {
  const promql = "count by(k8s_cluster) (kube_pod_info{k8s_cluster!=''})";

  it("an alias-ready alert never installs verbatim", async () => {
    const adaptation = {
      repairs: [],
      bindings: [bind("kube_pod_info", "k8s_cluster", "cluster_name")],
    };
    const doc = await adaptAlert(promqlAlert(promql), adaptation, checks);
    expect(doc.query_condition.promql).toBe(
      "count by(cluster_name) (kube_pod_info{cluster_name!=''})",
    );
  });

  it("refuses an alert whose streams spell a label differently", async () => {
    const alert = promqlAlert("kube_a{k8s_cluster='x'} / on(k8s_cluster) kube_b");
    const adaptation = { repairs: [], bindings: [bind("kube_a", "k8s_cluster", "cluster")] };
    await expect(adaptAlert(alert, adaptation, checks)).rejects.toBeInstanceOf(StreamRewriteError);
  });

  it("gives each Use all copy its own stream", async () => {
    const repairs = [{ from: "kube_pod_info", to: "edge_a", also: ["edge_b"] }];
    const doc = await adaptAlert(
      promqlAlert("kube_pod_info"),
      { repairs, bindings: [] },
      checks,
      "edge_b",
    );
    expect(doc.stream_name).toBe("edge_b");
    expect(doc.query_condition.promql).toBe("edge_b");
  });

  it("adds a shared stream's filter to its selector only", async () => {
    const filter = { field: "service_name", value: "web" };
    const repairs = [{ from: "kube_pod_info", to: "edge", filter }];
    const doc = await adaptAlert(promqlAlert("kube_pod_info"), { repairs, bindings: [] }, checks);
    expect(doc.query_condition.promql).toBe('edge{service_name=~"web"}');
  });

  it("binds custom conditions and group by, and adds the filter there", async () => {
    const alert = {
      stream_name: "logs",
      stream_type: "logs",
      query_condition: {
        type: "custom",
        aggregation: { group_by: ["k8s_cluster"] },
        conditions: {
          version: 2,
          conditions: {
            filterType: "group",
            conditions: [{ filterType: "condition", column: "k8s_cluster", value: "a" }],
          },
        },
      },
    };
    const filter = { field: "service_name", value: "web" };
    const doc = await adaptAlert(
      alert,
      {
        repairs: [{ from: "logs", to: "edge", filter }],
        bindings: [bind("edge", "k8s_cluster", "cluster")],
      },
      checks,
    );
    expect(doc.query_condition.aggregation.group_by).toEqual(["cluster"]);
    const rows = (doc.query_condition.conditions as any).conditions.conditions;
    expect(rows.map((row: any) => row.column)).toEqual(["cluster", "service_name"]);
  });

  it("swaps in a flavour's query and stream", () => {
    const doc = withFlavour(promqlAlert("kube_pod_info"), { promql: "edge", streams: ["edge"] });
    expect(doc.query_condition.promql).toBe("edge");
    expect(doc.stream_name).toBe("edge");
  });
});

describe("adaptDashboard", () => {
  const dashboard = () => ({
    tabs: [
      {
        panels: [
          {
            type: "metric",
            queryType: "sql",
            layout: { x: 0, y: 0, w: 1, h: 1 },
            queries: [
              {
                query: `SELECT count(k8s_cluster) AS y FROM "kube_a" WHERE k8s_cluster IN (\${k8s_cluster})`,
                fields: {
                  stream: "kube_a",
                  stream_type: "metrics",
                  x: [{ column: "k8s_cluster" }],
                },
              },
            ],
          },
          { type: "markdown", queries: [{ query: "kube_a k8s_cluster" }] },
        ],
      },
    ],
    variables: {
      list: [
        {
          type: "query_values",
          name: "k8s_cluster",
          query_data: { stream: "kube_a", field: "k8s_cluster", filter: [] },
        },
      ],
    },
  });
  const adaptation = { repairs: [], bindings: [bind("kube_a", "k8s_cluster", "cluster")] };

  it("writes bound names into queries, builder fields and variables, keeping the variable", async () => {
    const doc = await adaptDashboard(dashboard(), adaptation, checks);
    const [panel, note] = doc.tabs[0].panels;
    expect(panel.queries[0].query).toContain("cluster IN (${k8s_cluster})");
    expect(panel.queries[0].fields.x[0].column).toBe("cluster");
    expect(doc.variables.list[0].query_data.field).toBe("cluster");
    expect(note.queries[0].query).toBe("kube_a k8s_cluster");
  });

  it("runs the fit check on bound names", async () => {
    const schemas = new Map([["kube_a", new Set(["cluster"])]]);
    const verbatim = fitDashboard(dashboard(), schemas);
    const bound = fitDashboard(await adaptDashboard(dashboard(), adaptation, checks), schemas);
    expect(verbatim.kept).toBe(0);
    expect(bound.kept).toBe(1);
  });

  it("drops only the panel whose streams disagree on a name", async () => {
    const doc = dashboard();
    doc.tabs[0].panels.push({
      type: "metric",
      queryType: "sql",
      layout: { x: 0, y: 0, w: 1, h: 1 },
      queries: [
        {
          query: `SELECT k8s_cluster FROM "kube_a" JOIN "kube_b" ON 1 = 1`,
          fields: { stream: "kube_a", stream_type: "metrics", x: [] },
        },
      ],
    });
    const adapted = await adaptDashboard(doc, adaptation, checks);
    expect(adapted.tabs[0].panels).toHaveLength(2);
  });

  it("drops only the panel the server refuses after a rename", async () => {
    const doc = dashboard();
    doc.tabs[0].panels[0].queryType = "promql";
    doc.tabs[0].panels[0].queries[0].query = "kube_a{k8s_cluster='x'}";
    const refused = Object.assign(new Error("bad"), { response: { status: 400 } });
    const parse = vi.fn(async () => {
      throw refused;
    });
    const adapted = await adaptDashboard(doc, adaptation, { ...checks, promql: parse });
    expect(adapted.tabs[0].panels.map((panel: any) => panel.type)).toEqual(["markdown"]);
  });

  it("ignores the stale stream a custom panel keeps", async () => {
    const doc = dashboard();
    Object.assign(doc.tabs[0].panels[0].queries[0], { customQuery: true });
    doc.tabs[0].panels[0].queries[0].fields.stream = "kube_other";
    const adapted = await adaptDashboard(doc, adaptation, checks);
    expect(adapted.tabs[0].panels[0].queries[0].query).toContain("cluster IN");
  });

  it("adds a single-select picker that replaces the stream in FROM", async () => {
    const repairs = [{ from: "kube_b", to: "kube_a", also: ["kube_c"] }];
    const doc = await addStreamPickers(dashboard(), repairs);
    const query = doc.tabs[0].panels[0].queries[0];
    expect(query.query).toContain('FROM "$pack_stream_1"');
    expect(query.fields.stream).toBe("$pack_stream_1");
    expect(doc.variables.list.at(-1)).toMatchObject({
      type: "custom",
      name: "pack_stream_1",
      multiSelect: false,
      options: [{ value: "kube_a" }, { value: "kube_c" }],
    });
  });
});

describe("adaptSavedView", () => {
  const search = { data: { stream: { selectedStream: ["k8s_events"] }, query: "" } };

  it("points the view at the repaired stream with its filter", () => {
    const filter = { field: "service_name", value: "o'k" };
    const next = adaptSavedView(search, [{ from: "k8s_events", to: "default", filter }]);
    expect(next.data.stream.selectedStream).toEqual(["default"]);
    expect(next.data.query).toBe("service_name = 'o''k'");
  });

  it("leaves the pack's own view untouched", () => {
    adaptSavedView(search, [{ from: "k8s_events", to: "x" }]);
    expect(search.data.stream.selectedStream).toEqual(["k8s_events"]);
  });
});

import { describe, expect, it } from "vitest";

import hostMetrics from "@/assets/dashboards/host_metrics.dashboard.json";
import bundled from "@/assets/dashboards/kubernetes_overview.dashboard.json";

import {
  dashboardPanelNeeds,
  dashboardStreams,
  fitDashboard,
  type StreamFields,
} from "./dashboardFit";

const sql = (title: string, query: string, y = 0) => ({
  title,
  queryType: "sql",
  queries: [{ query }],
  layout: { x: 0, y, w: 10, h: 4 },
});
const promql = (title: string, query: string, y = 0) => ({
  ...sql(title, query, y),
  queryType: "promql",
});
const doc = (...panels: unknown[]) => ({ tabs: [{ tabId: "a", panels }], variables: { list: [] } });
const schemas = (rows: Record<string, string[]>): StreamFields =>
  new Map(Object.entries(rows).map(([name, fields]) => [name, new Set(fields)]));
const titles = (fit: ReturnType<typeof fitDashboard>) =>
  fit.doc.tabs.flatMap((tab: any) => tab.panels.map((panel: any) => panel.title));

describe("fitDashboard", () => {
  it("keeps a SQL panel only when its stream and every field exist", () => {
    const fit = fitDashboard(
      doc(
        sql(
          "ok",
          `SELECT COUNT(DISTINCT CONCAT(pod, '/', namespace)) AS c FROM kube_pod_info WHERE _timestamp > 0`,
        ),
        sql("no stream", 'SELECT count(*) FROM "certmanager_x"'),
        sql("no field", "SELECT node FROM kube_pod_info"),
      ),
      schemas({ kube_pod_info: ["pod", "namespace"] }),
    );
    expect(titles(fit)).toEqual(["ok"]);
    expect([fit.kept, fit.dropped]).toEqual([1, 2]);
  });

  it("ignores streams and fields that only appear in a comment", () => {
    const query = "SELECT pod FROM s\n-- SELECT other FROM retired\n/* JOIN older */";
    expect(titles(fitDashboard(doc(sql("ok", query)), schemas({ s: ["pod"] })))).toEqual(["ok"]);
  });

  it("reads a join's aliases, CTEs and computed columns as local", () => {
    const query = `WITH latest AS (SELECT pod, max(value) AS peak FROM a GROUP BY pod)
      SELECT l.pod, l.peak, b.node FROM latest l JOIN b ON b.pod = l.pod`;
    const fit = fitDashboard(
      doc(sql("join", query)),
      schemas({ a: ["pod", "value"], b: ["pod", "node"] }),
    );
    expect(titles(fit)).toEqual(["join"]);
  });

  it("checks PromQL metrics and labels from the query, not the stale fields.stream", () => {
    const fit = fitDashboard(
      doc(
        promql("ok", 'sum(rate(k8s_pod_memory_usage{k8s_cluster=~"$c"}[5m])) by (namespace)'),
        promql("no label", "sum(k8s_pod_memory_usage) by (node)"),
        promql("no metric", "sum(k8s_pod_memory_rss)"),
      ),
      schemas({ k8s_pod_memory_usage: ["k8s_cluster", "namespace"] }),
    );
    expect(titles(fit)).toEqual(["ok"]);
  });

  it("drops a variable whose stream is missing, with the panels that read it", () => {
    const fit = fitDashboard(
      {
        ...doc(
          sql("reads", "SELECT pod FROM s WHERE pod IN (${v})"),
          sql("plain", "SELECT pod FROM s"),
        ),
        variables: {
          list: [{ name: "v", type: "query_values", query_data: { stream: "gone", field: "x" } }],
        },
      },
      schemas({ s: ["pod"] }),
    );
    expect(titles(fit)).toEqual(["plain"]);
    expect(fit.doc.variables.list).toEqual([]);
  });

  it("removes empty tabs and closes the holes", () => {
    const fit = fitDashboard(
      doc(sql("gone", "SELECT a FROM gone", 0), sql("low", "SELECT pod FROM s", 8)),
      schemas({ s: ["pod"] }),
    );
    expect(fit.doc.tabs[0].panels[0].layout.y).toBe(0);
    expect(fitDashboard(doc(sql("gone", "SELECT a FROM gone")), schemas({})).doc.tabs).toEqual([]);
  });
});

describe("dashboardPanelNeeds", () => {
  const typed = (query: string, ...types: Array<string | undefined>) => ({
    queryType: "sql",
    queries: types.map((stream_type) => ({ query, fields: { stream_type } })),
  });

  it("carries each panel's single declared stream type with its needs", () => {
    const needs = dashboardPanelNeeds({
      tabs: [
        { panels: [typed("SELECT a FROM s", "logs")] },
        { panels: [{}, typed("SELECT b FROM t", "metrics", "metrics")] },
      ],
    });
    expect(needs.map(({ streamType }) => streamType)).toEqual(["logs", undefined, "metrics"]);
    expect([...needs[2].streams]).toEqual(["t"]);
  });

  it("reads any type for untyped, mixed and PromQL panels", () => {
    const needs = dashboardPanelNeeds(
      doc(typed("SELECT a FROM s", undefined), typed("SELECT a FROM s", "logs", "traces"), {
        ...typed("up", "logs"),
        queryType: "promql",
      }),
    );
    expect(needs.map(({ streamType }) => streamType)).toEqual([undefined, undefined, undefined]);
  });
});

describe("the bundled Kubernetes dashboard", () => {
  it("names its streams and carries no owner", () => {
    expect(bundled.owner).toBe("");
    expect(dashboardStreams(bundled)).toContain("kube_node_info");
    expect(bundled.tabs).toHaveLength(1);
  });
});

describe("the bundled Host Metrics dashboard", () => {
  it("keeps its CPU, network and disk panels when the memory streams are missing", () => {
    const needs = dashboardPanelNeeds(hostMetrics);
    const fields = new Set(needs.flatMap((need) => [...need.fields]));
    for (const variable of hostMetrics.variables.list) fields.add(variable.query_data.field);
    const present = dashboardStreams(hostMetrics).filter((name) => !name.includes("memory"));
    const fit = fitDashboard(hostMetrics, new Map(present.map((name) => [name, new Set(fields)])));

    const read = dashboardPanelNeeds(fit.doc).flatMap((need) => [...need.streams]);
    expect(read).toEqual(
      expect.arrayContaining(["system_cpu_time", "system_network_io", "system_disk_io"]),
    );
    expect(read.some((name) => name.includes("memory"))).toBe(false);
    expect(fit.doc.variables.list.map((variable: { name: string }) => variable.name)).toContain(
      "host_name",
    );
  });
});

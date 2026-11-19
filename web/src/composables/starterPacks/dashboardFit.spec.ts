import { describe, expect, it } from "vitest";

import bundled from "@/assets/dashboards/kubernetes_overview.dashboard.json";

import { dashboardStreams, fitDashboard, type StreamFields } from "./dashboardFit";

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

describe("the bundled Kubernetes dashboard", () => {
  it("names its streams and carries no owner", () => {
    expect(bundled.owner).toBe("");
    expect(dashboardStreams(bundled)).toContain("kube_node_info");
    expect(bundled.tabs).toHaveLength(1);
  });
});

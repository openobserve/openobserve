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
  limitPromqlClusters,
  limitSqlClusters,
  promqlMetricTokens,
  rewriteAlert,
  rewriteDashboard,
  rewritePromql,
  rewriteSql,
  StreamRewriteError,
  type RewriteChecks,
} from "./streamRewriter";

const selector = (name: string) => ({ type: "selector", name, matchers: [] });

const checksFor = (names: (query: string) => string[]): RewriteChecks => ({
  sql: vi.fn().mockResolvedValue(undefined),
  promql: vi.fn(async (query: string) => ({ type: "binary", args: names(query).map(selector) })),
});

const scan = (query: string) => promqlMetricTokens(query).map(({ name }) => name);

const rename = [{ from: "nginx_access", to: "edge" }];

describe("rewriteSql", () => {
  it("renames the table in FROM", async () => {
    const sql = await rewriteSql('SELECT * FROM "nginx_access" WHERE a = 1', rename);
    expect(sql).toMatch(/FROM\s+"edge"/);
    expect(sql).not.toContain("nginx_access");
  });

  it("renames JOINs and subqueries", async () => {
    const sql = await rewriteSql(
      'SELECT a.x FROM "nginx_access" a JOIN "nginx_access" b ON a.x = b.x WHERE a.x IN (SELECT x FROM "nginx_access")',
      rename,
    );
    expect(sql).not.toContain("nginx_access");
    expect(sql.match(/"edge"/g)).toHaveLength(3);
  });

  it("leaves a string and a column of that name alone", async () => {
    const sql = await rewriteSql(
      "SELECT nginx_access FROM \"nginx_access\" WHERE s = 'nginx_access'",
      rename,
    );
    expect(sql).toContain("'nginx_access'");
    expect(sql).toMatch(/SELECT\s+"?nginx_access"?\s+FROM/);
  });

  it("keeps a dashboard variable through the parser", async () => {
    const sql = await rewriteSql("SELECT * FROM \"nginx_access\" WHERE host = '$host'", rename);
    expect(sql).toContain("$host");
    expect(sql).toContain('"edge"');
  });

  it("does not parse a query that never names the stream", async () => {
    expect(await rewriteSql("not sql at all", rename)).toBe("not sql at all");
  });

  it("refuses SQL the parser cannot read", async () => {
    await expect(rewriteSql("SELECT FROM WHERE nginx_access", rename)).rejects.toBeInstanceOf(
      StreamRewriteError,
    );
  });
});

describe("promqlMetricTokens", () => {
  it.each([
    ["up", ["up"]],
    ['rate(http_total{job="a"}[5m])', ["http_total"]],
    ["sum by (pod, http_total) (up)", ["up"]],
    ['a / on(k8s_cluster) group_left(x) b{c="metric"}', ["a", "b"]],
    ["up offset 5m", ["up"]],
    ["up > 1e3", ["up"]],
    ['{__name__="up",job="a"}', ["up"]],
    ["clamp_max(floor(x * 100) / 100, 100)", ["x"]],
  ])("reads %s", (query, names) => {
    expect(scan(query)).toEqual(names);
  });
});

describe("rewritePromql", () => {
  const map = [{ from: "up", to: "o2_up" }];

  it("renames a bare metric and a __name__ matcher, checked by the server parser", async () => {
    const checks = checksFor(scan);
    const out = await rewritePromql('up + {__name__="up"} + upstream', map, checks);
    expect(out).toBe('o2_up + {__name__="o2_up"} + upstream');
    expect(checks.promql).toHaveBeenCalledTimes(2);
  });

  it("leaves a query without the metric unparsed", async () => {
    const checks = checksFor(scan);
    expect(await rewritePromql("other", map, checks)).toBe("other");
    expect(checks.promql).not.toHaveBeenCalled();
  });

  it("refuses when the server tree disagrees with the scan", async () => {
    await expect(
      rewritePromql(
        "up",
        map,
        checksFor(() => ["hidden"]),
      ),
    ).rejects.toBeInstanceOf(StreamRewriteError);
  });

  it("rewrites vector matching, which the server parses but does not expand", async () => {
    const checks: RewriteChecks = {
      sql: vi.fn(),
      promql: vi.fn().mockResolvedValue({ type: "unsupported", kind: "vector matching" }),
    };
    expect(await rewritePromql("up / on(a) other", map, checks)).toBe("o2_up / on(a) other");
  });
});

describe("limitPromqlClusters", () => {
  it("adds the matcher to bare selectors and ones with labels", async () => {
    const out = await limitPromqlClusters(
      'sum by (k8s_cluster) (a{x="1"}) / b',
      "k8s_cluster",
      ["eu-1", "us.2"],
      [],
      checksFor(scan),
    );
    expect(out).toBe(
      'sum by (k8s_cluster) (a{k8s_cluster=~"eu-1|us\\\\.2",x="1"}) / b{k8s_cluster=~"eu-1|us\\\\.2"}',
    );
  });

  it("replaces its own limit and clears it when none is chosen", async () => {
    const checks = checksFor(scan);
    const once = await limitPromqlClusters('a{y="1"} + b', "c", ["x"], [], checks);
    const other = await limitPromqlClusters(once, "c", ["z"], ["x"], checks);
    expect(other).toBe('a{c=~"z",y="1"} + b{c=~"z"}');
    expect(await limitPromqlClusters(other, "c", [], ["z"], checks)).toBe('a{y="1"} + b');
  });

  it("leaves the query alone, unchecked, when nothing is chosen or was applied", async () => {
    const checks = checksFor(scan);
    const authored = 'a{c=~"prod.*"}';
    expect(await limitPromqlClusters(authored, "c", [], [], checks)).toBe(authored);
    expect(checks.promql).not.toHaveBeenCalled();
  });

  it("keeps an authored matcher when replacing the pack's limit", async () => {
    const checks = checksFor(scan);
    const out = await limitPromqlClusters('a{c=~"x",c=~"prod.*"}', "c", [], ["x"], checks);
    expect(out).toBe('a{c=~"prod.*"}');
  });
});

describe("limitSqlClusters", () => {
  const sql = 'SELECT a FROM "s" WHERE a = 1';

  it("keeps the alert's own filter beside the limit", async () => {
    const out = await limitSqlClusters(
      'SELECT a FROM "s" WHERE a = 1 OR b = 2',
      "k8s_cluster",
      ["eu"],
      [],
      checksFor(scan),
      "logs",
    );
    expect(out).toMatch(/\(.*a.*OR.*b.*\) AND .*k8s_cluster.* IN \('eu'\)/);
  });

  it("replaces its own list and restores the filter when cleared", async () => {
    const checks = checksFor(scan);
    const first = await limitSqlClusters(sql, "c", ["x"], [], checks, "logs");
    const second = await limitSqlClusters(first, "c", ["y"], ["x"], checks, "logs");
    expect(second.match(/IN/g)).toHaveLength(1);
    expect(second).toContain("('y')");
    const cleared = await limitSqlClusters(second, "c", [], ["y"], checks, "logs");
    expect(cleared).not.toContain("IN");
  });

  it("does not parse or check when nothing is chosen or was applied", async () => {
    const checks = checksFor(scan);
    const authored = "SELECT a FROM s WHERE a = '${v}' AND c IN ('p')";
    expect(await limitSqlClusters(authored, "c", [], [], checks, "logs")).toBe(authored);
    expect(checks.sql).not.toHaveBeenCalled();
  });

  it("keeps an authored IN that differs from the pack's list", async () => {
    const authored = "SELECT a FROM s WHERE b = 1 AND c IN ('p')";
    const out = await limitSqlClusters(authored, "c", [], ["x"], checksFor(scan), "logs");
    expect(out).toContain("IN ('p')");
  });

  it("keeps a variable through a limit", async () => {
    const out = await limitSqlClusters(
      "SELECT a FROM s WHERE a = '$v'",
      "c",
      ["x"],
      [],
      checksFor(scan),
      "logs",
    );
    expect(out).toContain("$v");
  });
});

describe("server failures", () => {
  it("leaves an outage retryable, and only a refusal means it does not fit", async () => {
    const down: RewriteChecks = {
      sql: vi.fn(),
      promql: vi.fn().mockRejectedValue({ response: { status: 503 } }),
    };
    const error = await rewritePromql("up", [{ from: "up", to: "x" }], down).catch((e) => e);
    expect(error).not.toBeInstanceOf(StreamRewriteError);
    const refused: RewriteChecks = {
      sql: vi.fn(),
      promql: vi.fn().mockRejectedValue({ response: { status: 400 } }),
    };
    await expect(rewritePromql("up", [{ from: "up", to: "x" }], refused)).rejects.toBeInstanceOf(
      StreamRewriteError,
    );
  });
});

describe("rewriteAlert", () => {
  it("makes an imported SQL alert read the chosen stream", async () => {
    const checks = checksFor(scan);
    const { doc, changed } = await rewriteAlert(
      {
        stream_name: "nginx_access",
        stream_type: "logs",
        query_condition: { type: "sql", sql: 'SELECT * FROM "nginx_access"' },
      },
      rename,
      checks,
    );
    expect(changed).toBe(true);
    expect(doc.stream_name).toBe("edge");
    expect(doc.query_condition.sql).toContain('"edge"');
    expect(checks.sql).toHaveBeenCalledWith(doc.query_condition.sql, "logs");
  });

  it("fails rather than hand back a query the server cannot plan", async () => {
    const checks = checksFor(scan);
    checks.sql = vi.fn().mockRejectedValue({ response: { status: 400 } });
    await expect(
      rewriteAlert(
        {
          stream_name: "nginx_access",
          stream_type: "logs",
          query_condition: { type: "sql", sql: 'SELECT * FROM "nginx_access"' },
        },
        rename,
        checks,
      ),
    ).rejects.toBeInstanceOf(StreamRewriteError);
  });

  it("rewrites a PromQL alert and does not touch its source", async () => {
    const source = {
      stream_name: "up",
      stream_type: "metrics",
      query_condition: { type: "promql", promql: "sum(up)" },
    };
    const { doc } = await rewriteAlert(source, [{ from: "up", to: "o2_up" }], checksFor(scan));
    expect(doc.query_condition.promql).toBe("sum(o2_up)");
    expect(source.query_condition.promql).toBe("sum(up)");
  });
});

describe("rewriteDashboard", () => {
  it("moves every stream location and leaves markdown alone", async () => {
    const { doc, changed } = await rewriteDashboard(
      {
        tabs: [
          {
            panels: [
              {
                queryType: "sql",
                queries: [
                  {
                    query: 'SELECT * FROM "nginx_access"',
                    fields: { stream: "nginx_access", stream_type: "logs" },
                    joins: [{ stream: "nginx_access" }],
                  },
                ],
              },
              { type: "markdown", queries: [{ query: "nginx_access", fields: {} }] },
            ],
          },
        ],
        variables: { list: [{ query_data: { stream: "nginx_access" } }] },
        annotationSources: [{ stream: "nginx_access" }],
      },
      rename,
      checksFor(scan),
    );
    expect(changed).toBe(true);
    const [sqlPanel, markdown] = doc.tabs[0].panels;
    expect(sqlPanel.queries[0].fields.stream).toBe("edge");
    expect(sqlPanel.queries[0].joins[0].stream).toBe("edge");
    expect(sqlPanel.queries[0].query).toContain('"edge"');
    expect(markdown.queries[0].query).toBe("nginx_access");
    expect(doc.variables.list[0].query_data.stream).toBe("edge");
    expect(doc.annotationSources[0].stream).toBe("edge");
  });
});

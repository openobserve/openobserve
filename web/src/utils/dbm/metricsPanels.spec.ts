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

import { raw, type TranslateFn } from "@/types/i18n";
import type { MetricStream } from "@/utils/metrics/metricFamily";

import {
  buildDbmLoadPanelSchema,
  buildDbmMetricsSections,
  dbmMetricSystemOf,
  dbmPromqlSelector,
  filterDbmMetricPanels,
  filterDbmMetricStreams,
  humanizeDbmMetricName,
  injectPromqlSelector,
  panelErrorIsForbidden,
} from "./metricsPanels";

/** Key-echoing stub — the assertions read the KEY, not real copy. */
const t = ((key: string, params?: Record<string, unknown>) =>
  raw(params ? `${key}|${JSON.stringify(params)}` : key)) as unknown as TranslateFn;

const stream = (
  name: string,
  type: string,
  opts: { docs?: number; unit?: string; help?: string; stats?: boolean } = {},
): MetricStream => ({
  name,
  stream_type: "metrics",
  metrics_meta: {
    metric_type: type,
    metric_family_name: name,
    help: opts.help ?? "",
    unit: opts.unit ?? "",
  },
  ...(opts.stats === false ? {} : { stats: { doc_num: opts.docs ?? 100 } }),
});

const FLEET: MetricStream[] = [
  stream("postgresql_backends", "gauge"),
  stream("postgresql_connection_max", "gauge"),
  stream("postgresql_commits", "counter"),
  stream("postgresql_blks_hit", "counter"),
  stream("postgresql_blks_read", "counter"),
  stream("postgresql_temp_files", "counter"),
  stream("postgresql_wal_lag", "gauge"),
  stream("postgresql_database_locks", "gauge"),
  stream("mysql_threads", "gauge"),
  stream("mysql_buffer_pool_operations", "counter"),
  stream("http_requests_total", "counter"),
  stream("k8s_pod_cpu_usage", "gauge"),
];

const allPanels = (sections: ReturnType<typeof buildDbmMetricsSections>) => [
  ...sections.featured,
  ...sections.groups.flatMap((g) => g.panels),
];

const featuredQuery = (sections: ReturnType<typeof buildDbmMetricsSections>, key: string) =>
  sections.featured.find((p) => p.key === key)!.schema.queries[0].query;

describe("dbmMetricSystemOf", () => {
  it("maps stream prefixes to their engine", () => {
    expect(dbmMetricSystemOf("postgresql_backends")).toBe("postgresql");
    expect(dbmMetricSystemOf("mysql_threads")).toBe("mysql");
    expect(dbmMetricSystemOf("http_requests_total")).toBeNull();
  });
});

describe("filterDbmMetricStreams", () => {
  it("keeps only database-engine metric streams", () => {
    const names = filterDbmMetricStreams(FLEET).map((s) => s.name);
    expect(names).toContain("postgresql_backends");
    expect(names).toContain("mysql_threads");
    expect(names).not.toContain("http_requests_total");
    expect(names).not.toContain("k8s_pod_cpu_usage");
  });

  it("narrows to the scoped engine, treating mariadb as mysql's streams", () => {
    expect(
      filterDbmMetricStreams(FLEET, "postgresql").every((s) => s.name.startsWith("postgresql_")),
    ).toBe(true);
    expect(filterDbmMetricStreams(FLEET, "mariadb").map((s) => s.name)).toContain("mysql_threads");
    expect(filterDbmMetricStreams(FLEET, "mongodb")).toEqual([]);
  });
});

describe("dbmPromqlSelector", () => {
  it("matches the instance by bare host, tolerant of the receiver's port", () => {
    const sel = dbmPromqlSelector("postgresql_backends", {
      instance: "10.0.0.5:5432",
      namespace: "orders",
    });
    expect(sel).toBe(
      'service_instance_id=~"(\\\\[)?10\\\\.0\\\\.0\\\\.5(\\\\])?(:[0-9]+)?",postgresql_database_name="orders"',
    );
  });

  it("scopes a mysql stream by endpoint only — mysql metrics carry no database label", () => {
    const sel = dbmPromqlSelector("mysql_threads", { instance: "DB-1:3306", namespace: "orders" });
    expect(sel).toBe('mysql_instance_endpoint=~"(\\\\[)?db-1(\\\\])?(:[0-9]+)?"');
  });
});

describe("injectPromqlSelector", () => {
  it("fills empty selectors and appends to non-empty ones, only on named streams", () => {
    expect(
      injectPromqlSelector(
        "rate(postgresql_blks_hit{}[$__rate_interval])",
        ["postgresql_blks_hit"],
        'x="y"',
      ),
    ).toBe('rate(postgresql_blks_hit{x="y"}[$__rate_interval])');
    expect(
      injectPromqlSelector(
        "postgresql_blks_hit{} / postgresql_blks_read{}",
        ["postgresql_blks_hit"],
        'x="y"',
      ),
    ).toBe('postgresql_blks_hit{x="y"} / postgresql_blks_read{}');
  });
});

describe("panelErrorIsForbidden", () => {
  it("recognizes a 403 in either string or number form, and nothing else", () => {
    expect(panelErrorIsForbidden({ code: 403 })).toBe(true);
    expect(panelErrorIsForbidden({ code: "403" })).toBe(true);
    expect(panelErrorIsForbidden({ code: 500 })).toBe(false);
    expect(panelErrorIsForbidden({ code: "" })).toBe(false);
    expect(panelErrorIsForbidden(null)).toBe(false);
  });
});

describe("humanizeDbmMetricName", () => {
  it("drops the engine prefix and reads as words", () => {
    expect(humanizeDbmMetricName("postgresql_bgwriter_buffers_allocated")).toBe(
      "Bgwriter buffers allocated",
    );
  });
});

describe("buildDbmMetricsSections — featured (curated triage roles)", () => {
  it("composes connections and its limit into ONE panel with two queries", () => {
    const sections = buildDbmMetricsSections(FLEET, {}, t);
    const panel = sections.featured.find((p) => p.key === "postgresql:connections")!;
    expect(panel.schema.queries).toHaveLength(2);
    expect(panel.schema.queries[0].query).toContain("postgresql_backends{");
    expect(panel.schema.queries[1].query).toContain("postgresql_connection_max{");
    // The limit is a reference series, one reading repeated — max, never sum.
    expect(panel.schema.queries[1].query).toContain("max");
    // No standalone flat-line limit panel.
    expect(sections.featured.map((p) => p.key)).not.toContain("postgresql:connectionLimit");
  });

  it("keeps connections a single query when no limit stream exists", () => {
    const noLimit = FLEET.filter((s) => s.name !== "postgresql_connection_max");
    const sections = buildDbmMetricsSections(noLimit, {}, t);
    const panel = sections.featured.find((p) => p.key === "postgresql:connections")!;
    expect(panel.schema.queries).toHaveLength(1);
  });

  it("charts a non-cumulative metric as a gauge, never rated", () => {
    const q = featuredQuery(buildDbmMetricsSections(FLEET, {}, t), "postgresql:connections");
    expect(q).not.toContain("rate(");
    expect(q).toContain("sum by (service_instance_id, postgresql_database_name)");
  });

  it("renders the postgres cache hit RATIO, not two raw counters", () => {
    const sections = buildDbmMetricsSections(FLEET, {}, t);
    const panel = sections.featured.find((p) => p.key === "postgresql:cacheHitRatio")!;
    const q = panel.schema.queries[0].query;
    expect(q).toContain("rate(postgresql_blks_hit{");
    expect(q).toContain("rate(postgresql_blks_read{");
    expect(q).toMatch(/\/\s*\(/); // hit / (hit + read)
    expect(panel.schema.config.unit).toBe("percent-1");
    const keys = sections.featured.map((p) => p.key);
    expect(keys).not.toContain("postgresql:cacheHit");
    expect(keys).not.toContain("postgresql:cacheRead");
  });

  it("uses the overlap-safe formula for mysql — read_requests INCLUDES the misses", () => {
    const q = featuredQuery(buildDbmMetricsSections(FLEET, {}, t), "mysql:cacheHitRatio");
    // ratio = 1 - reads/read_requests; hits/(hits+reads) would double-count.
    expect(q.trim().startsWith("1 -")).toBe(true);
    expect(q).toContain('operation="reads"');
    expect(q).toContain('operation="read_requests"');
  });

  it("skips the ratio panel when an operand stream is missing", () => {
    const noRead = FLEET.filter((s) => s.name !== "postgresql_blks_read");
    const keys = buildDbmMetricsSections(noRead, {}, t).featured.map((p) => p.key);
    expect(keys).not.toContain("postgresql:cacheHitRatio");
  });

  it("applies the catalog's narrowing filter and the scope selector together", () => {
    const sections = buildDbmMetricsSections(FLEET, { instance: "db-1" }, t);
    const q = featuredQuery(sections, "mysql:connections");
    expect(q).toContain('kind="connected"');
    expect(q).toContain('mysql_instance_endpoint=~"(\\\\[)?db-1(\\\\])?(:[0-9]+)?"');
  });

  it("titles panels by role and engine", () => {
    const panel = buildDbmMetricsSections(FLEET, {}, t).featured.find(
      (p) => p.key === "postgresql:cacheHitRatio",
    )!;
    expect(String(panel.title)).toContain("dbm.metrics.roles.cacheHitRatio");
    expect(String(panel.title)).toContain("PostgreSQL");
  });
});

describe("buildDbmMetricsSections — engine groups", () => {
  it("orders the long tail by triage relevance, not the alphabet", () => {
    const sections = buildDbmMetricsSections(FLEET, {}, t);
    const pg = sections.groups.find((g) => g.system === "postgresql")!;
    const keys = pg.panels.map((p) => p.key);
    // temp files and locks are slowness signals; commits is bookkeeping.
    expect(keys.indexOf("postgresql_temp_files")).toBeLessThan(keys.indexOf("postgresql_commits"));
    expect(keys.indexOf("postgresql_database_locks")).toBeLessThan(
      keys.indexOf("postgresql_commits"),
    );
    expect(keys.indexOf("postgresql_wal_lag")).toBeLessThan(keys.indexOf("postgresql_commits"));
  });

  it("humanizes titles and keeps the metric id reachable in the help line", () => {
    const commits = buildDbmMetricsSections(FLEET, {}, t)
      .groups.flatMap((g) => g.panels)
      .find((p) => p.key === "postgresql_commits")!;
    expect(String(commits.title)).toBe("Commits");
    expect(commits.help).toContain("postgresql_commits");
    expect(commits.schema.queries[0].config.promql_legend).not.toBe("");
  });

  it("drops known-empty streams but keeps streams with no stats", () => {
    const list = [
      stream("postgresql_backends", "gauge", { docs: 0 }),
      stream("postgresql_commits", "counter", { stats: false }),
    ];
    const keys = allPanels(buildDbmMetricsSections(list, {}, t)).map((p) => p.key);
    expect(keys).not.toContain("postgresql:connections");
    expect(keys).toContain("postgresql_commits");
  });

  it("skips remainder streams the section catalog already charts", () => {
    const sections = buildDbmMetricsSections(FLEET, {}, t, {
      excludeStreams: new Set(["postgresql_commits"]),
    });
    const keys = sections.groups.flatMap((g) => g.panels.map((p) => p.key));
    expect(keys).not.toContain("postgresql_commits");
    expect(keys).toContain("postgresql_temp_files");
  });

  it("scopes the whole tab to the selected engine", () => {
    const keys = allPanels(buildDbmMetricsSections(FLEET, { system: "mysql" }, t)).map(
      (p) => p.key,
    );
    expect(keys.every((k) => k.startsWith("mysql"))).toBe(true);
  });
});

describe("filterDbmMetricPanels", () => {
  it("matches title, key and help, case-insensitively; empty needle keeps all", () => {
    const sections = buildDbmMetricsSections(FLEET, {}, t);
    const pg = sections.groups.find((g) => g.system === "postgresql")!.panels;
    expect(filterDbmMetricPanels(pg, "")).toHaveLength(pg.length);
    const hits = filterDbmMetricPanels(pg, "TEMP");
    expect(hits.map((p) => p.key)).toEqual(["postgresql_temp_files"]);
    // The metric id in the help line is searchable even when the title differs.
    expect(filterDbmMetricPanels(pg, "postgresql_commits")).toHaveLength(1);
  });
});

describe("buildDbmLoadPanelSchema", () => {
  it("builds a line SQL panel over the server-vantage stream", () => {
    const schema = buildDbmLoadPanelSchema({});
    expect(schema.type).toBe("line");
    // Connected lines with a dot on every real sample: the dots keep sparse
    // data honest (each marks an actual bucket) while the line stays readable.
    expect(schema.config.connect_nulls).toBe(true);
    expect(schema.config.show_symbol).toBe(true);
    expect(schema.queryType).toBe("sql");
    const q = schema.queries[0];
    expect(q.customQuery).toBe(true);
    expect(q.fields.stream).toBe("_o2_dbm_server");
    expect(q.query).toContain("histogram(_timestamp)");
    expect(q.query).toContain("o2_dbm_kind = 'activity'");
  });

  it("normalizes to AVERAGE active sessions — zoom-invariant, poll-count denominator", () => {
    const q = buildDbmLoadPanelSchema({}).queries[0].query;
    // Per-poll counts summed over the bucket, divided by the bucket's polls —
    // counted via DENSE_RANK windows so the stream is scanned once, never by
    // a COUNT(DISTINCT) self-join that reads the same bytes twice.
    expect(q).toContain("DENSE_RANK() OVER (PARTITION BY ts ORDER BY poll)");
    expect(q).toContain("MAX(rnk) OVER (PARTITION BY ts) AS polls");
    expect(q).toContain("SUM(cnt) * 1.0 / MAX(polls)");
    expect(q).not.toContain("JOIN");
    // The search API caps results at 1000 rows unless the SQL carries a LIMIT.
    expect(q).toMatch(/LIMIT 30000$/);
  });

  it("excludes every idle state variant rather than allow-listing one engine's word", () => {
    const q = buildDbmLoadPanelSchema({}).queries[0].query;
    // MySQL has no 'active' state — an allow-list hid its CPU load entirely.
    expect(q).not.toContain("= 'active'");
    // 'idle in transaction' (and its aborted variant) wait on ClientRead and
    // painted a constant band of fake load; the prefix match excludes them all.
    expect(q).toContain("o2_dbm_session_state IS NULL OR o2_dbm_session_state NOT LIKE 'idle%'");
  });

  it("defaults the breakdown to wait event with NULL named CPU", () => {
    const q = buildDbmLoadPanelSchema({}).queries[0].query;
    expect(q).toContain("COALESCE(o2_dbm_wait_event, 'CPU')");
  });

  it("slices by query, database or user on request", () => {
    expect(buildDbmLoadPanelSchema({}, {}, "query").queries[0].query).toContain(
      "substr(o2_dbm_activity_query",
    );
    expect(buildDbmLoadPanelSchema({}, {}, "database").queries[0].query).toContain(
      "o2_dbm_database",
    );
    expect(buildDbmLoadPanelSchema({}, {}, "user").queries[0].query).toContain(
      "o2_dbm_session_user",
    );
  });

  it("splices the scope with single quotes escaped into the one base scan", () => {
    const q = buildDbmLoadPanelSchema({
      system: "postgresql",
      instance: "db-1",
      namespace: "o'brien",
    }).queries[0].query;
    expect(q).toContain("o2_dbm_engine = 'postgresql'");
    expect(q).toContain("o2_dbm_database = 'o''brien'");
    // One scan feeds both the session counts and the poll denominator — a
    // second WHERE would mean the self-join (and its 2x scan) crept back.
    expect(q.split("o2_dbm_instance = 'db-1'")).toHaveLength(2);
  });
});

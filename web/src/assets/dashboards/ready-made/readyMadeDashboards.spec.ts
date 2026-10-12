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

import { describe, it, expect } from "vitest";
import { gt } from "@/types/i18n";
import { getUnitOptions } from "@/composables/dashboard/useColumnFormatting";
import { convertDashboardSchemaVersion } from "@/utils/dashboard/convertDashboardSchemaVersion";
import {
  getReadyMadeSource,
  readyMadeMarker,
  type ReadyMadeSourceId,
} from "@/composables/readyMade/catalog";
import postgresql from "./postgresql.dashboard.json";
import mysql from "./mysql.dashboard.json";
import redis from "./redis.dashboard.json";
import otelCollector from "./otel_collector.dashboard.json";

const NOTE =
  "Ready-made by OpenObserve. Charts fill in within a few minutes of new data. Edit or delete anything, including this note.";
const PG_OPTIONAL =
  "Needs `postgresql.deadlocks` / `postgresql.blks_hit` + `postgresql.blks_read` enabled in your collector config (off by default).";

// Metric streams the receivers' default config writes, as measured on a live OpenObserve (contrib 0.115.1 / 0.158).
const words = (s: string) => s.trim().split(/\s+/);
const STREAMS: Record<string, Set<string>> = {
  postgresql: new Set(
    words(
      "backends bgwriter_buffers_allocated bgwriter_buffers_writes bgwriter_checkpoint_count bgwriter_duration bgwriter_maxwritten blks_hit blks_read blocks_read commits connection_max database_count db_size deadlocks index_scans index_size operations rollbacks rows table_count table_size table_vacuum_count",
    ).map((n) => `postgresql_${n}`),
  ),
  mysql: new Set(
    words(
      "buffer_pool_data_pages buffer_pool_limit buffer_pool_operations buffer_pool_page_flushes buffer_pool_pages buffer_pool_usage connection_max double_writes handlers index_io_wait_count index_io_wait_time locks log_operations mysqlx_connections opened_resources operations page_operations prepared_statements row_locks row_operations sorts table_io_wait_count table_io_wait_time threads tmp_resources uptime",
    ).map((n) => `mysql_${n}`),
  ),
  redis: new Set(
    words(
      "clients_blocked clients_connected clients_max_input_buffer clients_max_output_buffer commands commands_processed connections_received connections_rejected cpu_time db_avg_ttl db_expires db_keys keys_evicted keys_expired keyspace_hits keyspace_misses latest_fork memory_fragmentation_ratio memory_lua memory_peak memory_rss memory_used net_input net_output rdb_changes_since_last_save replication_backlog_first_byte_offset replication_offset slaves_connected uptime",
    ).map((n) => `redis_${n}`),
  ),
  otelcol: new Set(
    words(
      `exporter_queue_capacity exporter_queue_size exporter_sent_metric_points process_cpu_seconds process_memory_rss
      process_runtime_heap_alloc_bytes process_runtime_total_alloc_bytes process_runtime_total_sys_memory_bytes process_uptime
      processor_batch_batch_send_size processor_batch_batch_send_size_bucket processor_batch_batch_send_size_count
      processor_batch_batch_send_size_sum processor_batch_metadata_cardinality processor_batch_timeout_trigger_send
      processor_incoming_items processor_outgoing_items receiver_accepted_metric_points receiver_refused_metric_points
      scraper_errored_metric_points scraper_scraped_metric_points exporter_send_failed_metric_points
      processor_accepted_metric_points processor_batch_batch_send_size_min processor_batch_batch_send_size_max
      exporter_in_flight_requests exporter_sent_log_records fileconsumer_open_files fileconsumer_reading_files
      k8s_pod_association otelsvc_k8s_ip_lookup_miss otelsvc_k8s_namespace_added otelsvc_k8s_pod_added
      otelsvc_k8s_pod_table_size otelsvc_k8s_pod_updated processor_memory_limiter_accepted_log_records
      processor_memory_limiter_accepted_metric_points receiver_accepted_log_records receiver_failed_log_records
      receiver_refused_log_records receiver_failed_metric_points resourcedetection_attributes_detected
      resourcedetection_detector_duration resourcedetection_detector_duration_bucket
      resourcedetection_detector_duration_count resourcedetection_detector_duration_sum
      resourcedetection_detector_results`,
    ).map((n) => `otelcol_${n}`),
  ),
};

// Cumulative monotonic sums: only meaningful through rate() / increase().
const MONOTONIC = new Set(
  words(`
    postgresql_bgwriter_buffers_allocated postgresql_bgwriter_buffers_writes postgresql_bgwriter_checkpoint_count
    postgresql_bgwriter_duration postgresql_bgwriter_maxwritten postgresql_blks_hit postgresql_blks_read
    postgresql_blocks_read postgresql_commits postgresql_deadlocks postgresql_index_scans postgresql_operations
    postgresql_rollbacks postgresql_table_vacuum_count
    mysql_buffer_pool_operations mysql_buffer_pool_page_flushes mysql_double_writes mysql_handlers
    mysql_index_io_wait_count mysql_index_io_wait_time mysql_locks mysql_log_operations mysql_mysqlx_connections
    mysql_opened_resources mysql_operations mysql_page_operations mysql_prepared_statements mysql_row_locks
    mysql_row_operations mysql_sorts mysql_table_io_wait_count mysql_table_io_wait_time mysql_tmp_resources
    redis_commands_processed redis_connections_received redis_connections_rejected redis_cpu_time redis_keys_evicted
    redis_keys_expired redis_keyspace_hits redis_keyspace_misses redis_net_input redis_net_output
    otelcol_exporter_send_failed_metric_points otelcol_exporter_sent_metric_points otelcol_process_cpu_seconds
    otelcol_process_runtime_total_alloc_bytes otelcol_processor_incoming_items otelcol_processor_outgoing_items
    otelcol_receiver_accepted_metric_points otelcol_receiver_refused_metric_points
    otelcol_scraper_errored_metric_points otelcol_scraper_scraped_metric_points
  `),
);
// Monotonic too, but the current value (seconds since start) is the reading.
const UPTIME = new Set(["mysql_uptime", "redis_uptime", "otelcol_process_uptime"]);

// postgresql_database_name is on 15 of the 22 streams; bgwriter, connection_max and database_count have no labels.
const PG_UNLABELLED = new Set([
  "postgresql_bgwriter_buffers_allocated",
  "postgresql_bgwriter_buffers_writes",
  "postgresql_bgwriter_checkpoint_count",
  "postgresql_bgwriter_duration",
  "postgresql_bgwriter_maxwritten",
  "postgresql_connection_max",
  "postgresql_database_count",
]);

interface Case {
  id: ReadyMadeSourceId;
  prefix: string;
  doc: any;
  variable: { name: string; label: string; stream: string; field: string } | null;
  matcher: string | null;
  labelled: (stream: string) => boolean;
}

const CASES: Case[] = [
  {
    id: "postgresql",
    prefix: "postgresql",
    doc: postgresql,
    variable: {
      name: "database",
      label: "Database",
      stream: "postgresql_backends",
      field: "postgresql_database_name",
    },
    matcher: 'postgresql_database_name=~"$database"',
    labelled: (stream) => !PG_UNLABELLED.has(stream),
  },
  {
    id: "mysql",
    prefix: "mysql",
    doc: mysql,
    variable: {
      name: "instance",
      label: "Instance",
      stream: "mysql_uptime",
      field: "mysql_instance_endpoint",
    },
    matcher: 'mysql_instance_endpoint=~"$instance"',
    labelled: () => true,
  },
  {
    id: "redis",
    prefix: "redis",
    doc: redis,
    variable: null,
    matcher: null,
    labelled: () => false,
  },
  {
    id: "otelcol",
    prefix: "otelcol",
    doc: otelCollector,
    variable: {
      name: "instance",
      label: "Collector",
      stream: "otelcol_process_uptime",
      field: "service_instance_id",
    },
    matcher: 'service_instance_id=~"$instance"',
    labelled: () => true,
  },
];

const VARIABLE_REF = /$[A-Za-z_{]/;

const panelsOf = (doc: any): any[] => (doc.tabs ?? []).flatMap((t: any) => t.panels ?? []);
const dataPanels = (doc: any): any[] => panelsOf(doc).filter((p) => p.type !== "markdown");
const queriesOf = (doc: any): Array<{ panel: any; query: string }> =>
  dataPanels(doc).flatMap((panel) =>
    (panel.queries ?? []).map((q: any) => ({ panel, query: q.query as string })),
  );

const selectors = (query: string) => {
  // Grouping clauses list label names such as mysql_instance_endpoint, which share the metric prefix.
  const text = query.replace(/\b(by|without|on|ignoring|group_left|group_right)\s*\([^)]*\)/g, "");
  const out: Array<{ name: string; matchers: string; before: string }> = [];
  const re = /\b((?:postgresql|mysql|redis|otelcol)_[a-z0-9_]+)(\{[^}]*\})?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ name: m[1], matchers: m[2] ?? "", before: text.slice(0, m.index) });
  }
  return out;
};

const KNOWN_UNITS = new Set(
  getUnitOptions(gt)
    .map((o) => o.value)
    .filter((v): v is string => v != null),
);

describe.each(CASES)("ready-made $id dashboard", ({ id, prefix, doc, variable, matcher, labelled }) => {
  const source = getReadyMadeSource(id);
  const panels = panelsOf(doc);

  describe("document", () => {
    it("is a v8 document with the catalog title, the marker and no baked-in id", () => {
      expect(doc.version).toBe(8);
      expect(doc.title).toBe(source.dashboards[0].title);
      expect(doc.role).toBe(readyMadeMarker(id, "overview"));
      expect(doc.dashboardId).toBe("");
      expect(doc.description).not.toContain("$");
    });

    it("opens on the last 15 minutes", () => {
      expect(doc.defaultDatetimeDuration).toMatchObject({
        type: "relative",
        relativeTimePeriod: "15m",
      });
    });

    it("passes through the schema converter unchanged", () => {
      expect(convertDashboardSchemaVersion(structuredClone(doc))).toEqual(doc);
    });

    it("has one tab", () => {
      expect(doc.tabs).toHaveLength(1);
    });
  });

  describe("panels", () => {
    it("starts with the one-line ready-made note across the full width", () => {
      const first = panels[0];
      expect(first.type).toBe("markdown");
      expect(first.markdownContent).toBe(NOTE);
      expect(first.layout).toMatchObject({ x: 0, y: 0, w: 192 });
    });

    it("gives every chart a description and a unit from the unit options", () => {
      for (const p of dataPanels(doc)) {
        expect(p.description.trim().length, p.id).toBeGreaterThan(10);
        expect(KNOWN_UNITS.has(p.config.unit), `${p.id} unit ${p.config.unit}`).toBe(true);
      }
    });

    it("runs every chart as custom PromQL", () => {
      for (const p of dataPanels(doc)) {
        expect(p.queryType, p.id).toBe("promql");
        for (const q of p.queries) expect(q.customQuery, p.id).toBe(true);
      }
    });

    it("ships no custom-code or HTML panels", () => {
      expect(panels.filter((p) => ["custom_chart", "html"].includes(p.type))).toEqual([]);
    });

    it("keeps panel ids and layout slots unique", () => {
      expect(new Set(panels.map((p) => p.id)).size).toBe(panels.length);
      expect(new Set(panels.map((p) => p.layout.i)).size).toBe(panels.length);
    });

    it("lays every panel inside the 192-column grid without overlaps", () => {
      for (const p of panels) {
        expect(p.layout.x, p.id).toBeGreaterThanOrEqual(0);
        expect(p.layout.w, p.id).toBeGreaterThan(0);
        expect(p.layout.x + p.layout.w, p.id).toBeLessThanOrEqual(192);
      }
      const overlaps = (a: any, b: any) =>
        a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      for (let i = 0; i < panels.length; i++) {
        for (let j = i + 1; j < panels.length; j++) {
          expect(overlaps(panels[i].layout, panels[j].layout), `${panels[i].id} / ${panels[j].id}`).toBe(
            false,
          );
        }
      }
    });
  });

  describe("queries", () => {
    it(`reads only ${prefix}_* streams that the receiver writes`, () => {
      for (const { panel, query } of queriesOf(doc)) {
        const found = selectors(query);
        expect(found.length, `${panel.id}: ${query}`).toBeGreaterThan(0);
        for (const s of found) expect(STREAMS[prefix].has(s.name), `${panel.id}: ${s.name}`).toBe(true);
      }
      for (const p of dataPanels(doc)) {
        for (const q of p.queries) {
          expect(q.fields.stream_type, p.id).toBe("metrics");
          expect(STREAMS[prefix].has(q.fields.stream), `${p.id} fields.stream`).toBe(true);
        }
      }
    });

    it("reads cumulative counters only through rate() or increase()", () => {
      for (const { panel, query } of queriesOf(doc)) {
        for (const s of selectors(query)) {
          const wrapped = /\b(rate|increase)\(\s*$/.test(s.before);
          const counter = MONOTONIC.has(s.name);
          expect(wrapped, `${panel.id}: ${s.name}`).toBe(counter && !UPTIME.has(s.name));
        }
      }
    });

    it("anchors literal regex alternations so a prefix never matches a longer value", () => {
      for (const { panel, query } of queriesOf(doc)) {
        const literal = [...query.matchAll(/=~"([^"$][^"]*)"/g)].map((m) => m[1]);
        for (const value of literal) {
          if (value.includes("|")) expect(value, panel.id).toMatch(/^\^\(.*\)\$$/);
        }
      }
    });

    it(
      matcher
        ? `filters every labelled selector by the ${variable?.name} variable`
        : "uses no dashboard variables",
      () => {
        for (const { panel, query } of queriesOf(doc)) {
          for (const s of selectors(query)) {
            if (matcher && labelled(s.name)) {
              expect(s.matchers, `${panel.id}: ${s.name}`).toContain(matcher);
            } else {
              expect(s.matchers, `${panel.id}: ${s.name}`).not.toMatch(VARIABLE_REF);
            }
          }
          if (!matcher) expect(query, panel.id).not.toMatch(VARIABLE_REF);
        }
      },
    );
  });

  describe("variables", () => {
    it(
      variable ? `declares only ${variable?.name} as a multi-select over all values` : "declares none",
      () => {
        const list = doc.variables.list;
        if (!variable) {
          expect(list).toEqual([]);
          return;
        }
        expect(list).toHaveLength(1);
        expect(list[0]).toMatchObject({
          type: "query_values",
          name: variable.name,
          label: variable.label,
          multiSelect: true,
          selectAllValueForMultiSelect: "all",
          query_data: { stream_type: "metrics", stream: variable.stream, field: variable.field },
        });
        expect(STREAMS[prefix].has(list[0].query_data.stream)).toBe(true);
      },
    );
  });

  describe("v8 serde-required keys", () => {
    it("every panel carries id/type/title/description/config/queries and config.show_legends", () => {
      for (const p of panels) {
        expect(typeof p.id).toBe("string");
        expect(typeof p.type).toBe("string");
        expect(typeof p.title).toBe("string");
        expect(typeof p.description).toBe("string");
        expect(typeof p.config.show_legends, p.id).toBe("boolean");
        expect(p.queries.length, p.id).toBeGreaterThan(0);
      }
    });

    it("every query carries promql_legend, customQuery and the full fields block", () => {
      for (const p of panels) {
        for (const q of p.queries) {
          expect(typeof q.config.promql_legend, p.id).toBe("string");
          expect(typeof q.customQuery, p.id).toBe("boolean");
          expect(typeof q.fields.stream, p.id).toBe("string");
          expect(typeof q.fields.stream_type, p.id).toBe("string");
          expect(Array.isArray(q.fields.x), p.id).toBe(true);
          expect(Array.isArray(q.fields.y), p.id).toBe(true);
          expect(q.fields.filter, p.id).toBeTypeOf("object");
        }
      }
    });
  });
});

describe("ready-made postgresql dashboard: off-by-default metrics", () => {
  const optional = /postgresql_(deadlocks|blks_hit|blks_read)\b/;

  it("keeps the Deadlocks and Cache hit ratio panels", () => {
    const titles = dataPanels(postgresql).map((p) => p.title);
    expect(titles).toEqual(expect.arrayContaining(["Deadlocks (per 5 min)", "Cache hit ratio"]));
  });

  it("says in the description of every panel that reads them how to turn them on", () => {
    const readers = dataPanels(postgresql).filter((p) =>
      p.queries.some((q: any) => optional.test(q.query)),
    );
    expect(readers.length).toBeGreaterThanOrEqual(2);
    for (const p of readers) expect(p.description, p.id).toContain(PG_OPTIONAL);
    for (const p of dataPanels(postgresql).filter((x) => !readers.includes(x))) {
      expect(p.description, p.id).not.toContain(PG_OPTIONAL);
    }
  });

  it("computes the cache hit ratio as blks_hit / (blks_hit + blks_read)", () => {
    const ratio = dataPanels(postgresql).find((p) => p.title === "Cache hit ratio");
    expect(ratio.queries[0].query.replace(/\{[^}]*\}/g, "")).toBe(
      "100 * sum(rate(postgresql_blks_hit[5m])) / (sum(rate(postgresql_blks_hit[5m])) + sum(rate(postgresql_blks_read[5m])))",
    );
  });
});

describe("ready-made mysql dashboard: connection limit from the sqlquery receiver", () => {
  it("names the sqlquery receiver wherever mysql_connection_max is read", () => {
    const readers = dataPanels(mysql).filter((p) =>
      p.queries.some((q: any) => q.query.includes("mysql_connection_max")),
    );
    expect(readers.length).toBeGreaterThan(0);
    for (const p of readers) expect(p.description, p.id).toContain("sqlquery receiver");
  });
});

describe("ready-made redis dashboard: merged servers", () => {
  it("warns on every chart that servers without server.address share one series", () => {
    for (const p of dataPanels(redis)) expect(p.description, p.id).toContain("server.address");
  });
});

describe("ready-made OTel Collector dashboard", () => {
  const setup = panelsOf(otelCollector)[1];
  const yaml = (setup.markdownContent.match(/```yaml\n([\s\S]*?)```/) ?? [])[1] ?? "";

  it("explains in its second panel how to make the collector send its own metrics", () => {
    expect(setup.type).toBe("markdown");
    expect(setup.markdownContent).toContain("otelcol_*");
    expect(yaml).toContain("service:\n  telemetry:\n    metrics:\n      readers:\n        - periodic:");
    expect(yaml).toContain("exporter:\n              otlp:");
    expect(yaml).toContain("protocol: http/protobuf");
    expect(yaml).toMatch(/endpoint: <url>\/api\/<org>\/v1\/metrics\n/);
  });

  it("writes headers as a map, the only form collector 0.115.1 accepts", () => {
    expect(yaml).toMatch(/headers:\n\s+Authorization: Basic <token>\n/);
    expect(yaml).not.toMatch(/-\s*name:/);
  });

  it("carries placeholders, never a real token", () => {
    expect(setup.markdownContent).not.toMatch(/Basic\s+(?!<token>)[A-Za-z0-9+/=]{8,}/);
    expect(setup.markdownContent).not.toMatch(/o2oi_|\$\{env:/);
  });

  it("charts accepted vs refused, sent vs send-failed, queue size vs capacity, memory and CPU", () => {
    const reads = (title: string) =>
      dataPanels(otelCollector)
        .find((p) => p.title === title)
        ?.queries.flatMap((q: any) => selectors(q.query).map((s) => s.name));
    expect(reads("Accepted vs refused points/s")).toEqual([
      "otelcol_receiver_accepted_metric_points",
      "otelcol_receiver_refused_metric_points",
    ]);
    expect(reads("Sent vs send-failed points/s")).toEqual([
      "otelcol_exporter_sent_metric_points",
      "otelcol_exporter_send_failed_metric_points",
    ]);
    expect(reads("Exporter queue size vs capacity")).toEqual([
      "otelcol_exporter_queue_size",
      "otelcol_exporter_queue_capacity",
    ]);
    expect(reads("Memory (RSS)")).toEqual(["otelcol_process_memory_rss"]);
    expect(reads("CPU")).toEqual(["otelcol_process_cpu_seconds"]);
  });
});

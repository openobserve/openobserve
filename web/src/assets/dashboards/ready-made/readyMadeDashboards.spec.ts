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
import kafka from "./kafka.dashboard.json";
import rabbitmq from "./rabbitmq.dashboard.json";
import nginx from "./nginx.dashboard.json";
import apache from "./apache.dashboard.json";
import mongodb from "./mongodb.dashboard.json";
import sqlserver from "./sqlserver.dashboard.json";
import oracle from "./oracle.dashboard.json";

const NOTE =
  "Ready-made by OpenObserve. Charts fill in within a few minutes of new data. Edit or delete anything, including this note.";
const OTEL_SETUP_POINTER =
  "Setup help for the collector's own metrics is at the end of this dashboard.";
const noteOf = (id: ReadyMadeSourceId) =>
  id === "otelcol" ? `${NOTE} ${OTEL_SETUP_POINTER}` : NOTE;
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
  mongodb: new Set(
    words(
      "cache_operations collection_count connection_count cursor_count cursor_timeout_count data_size database_count document_operation_count global_lock_time index_access_count index_count index_size memory_usage network_io_receive network_io_transmit network_request_count object_count operation_count operation_time session_count storage_size",
    ).map((n) => `mongodb_${n}`),
  ),
  sqlserver: new Set(
    words(
      "batch_request_rate batch_sql_compilation_rate batch_sql_recompilation_rate lock_wait_rate page_buffer_cache_hit_ratio user_connection_count",
    ).map((n) => `sqlserver_${n}`),
  ),
  oracledb: new Set(
    words(
      "cpu_time dml_locks_limit dml_locks_usage enqueue_deadlocks enqueue_locks_limit enqueue_locks_usage enqueue_resources_limit enqueue_resources_usage exchange_deadlocks executions hard_parses logical_reads parse_calls pga_memory physical_reads processes_limit processes_usage sessions_limit sessions_usage tablespace_size_limit tablespace_size_usage transactions_limit transactions_usage user_commits user_rollbacks",
    ).map((n) => `oracledb_${n}`),
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
    mongodb_cache_operations mongodb_global_lock_time mongodb_operation_count mongodb_operation_time
    oracledb_cpu_time oracledb_enqueue_deadlocks oracledb_exchange_deadlocks oracledb_executions
    oracledb_hard_parses oracledb_logical_reads oracledb_parse_calls oracledb_physical_reads
    oracledb_user_commits oracledb_user_rollbacks
  `),
);
// Running totals the receivers flag as non-monotonic (MongoDB) or as gauges named *_rate (SQL Server).
for (const name of words(`
  mongodb_cursor_timeout_count mongodb_document_operation_count mongodb_network_io_receive
  mongodb_network_io_transmit mongodb_network_request_count
  sqlserver_batch_request_rate sqlserver_batch_sql_compilation_rate
  sqlserver_batch_sql_recompilation_rate sqlserver_lock_wait_rate
`)) {
  MONOTONIC.add(name);
}
// mongodb_storage_size and oracledb_pga_memory are flagged monotonic but shrink: they are sizes, read as is.
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
  {
    id: "mongodb",
    prefix: "mongodb",
    doc: mongodb,
    variable: {
      name: "server",
      label: "Server",
      stream: "mongodb_database_count",
      field: "server_address",
    },
    matcher: 'server_address=~"$server"',
    labelled: () => true,
  },
  {
    id: "sqlserver",
    prefix: "sqlserver",
    doc: sqlserver,
    variable: null,
    matcher: null,
    labelled: () => false,
  },
  {
    id: "oracle",
    prefix: "oracledb",
    doc: oracle,
    variable: {
      name: "instance",
      label: "Instance",
      stream: "oracledb_sessions_limit",
      field: "oracledb_instance_name",
    },
    matcher: 'oracledb_instance_name=~"$instance"',
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
  const re = /\b((?:postgresql|mysql|redis|otelcol|mongodb|sqlserver|oracledb)_[a-z0-9_]+)(\{[^}]*\})?/g;
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
    it("starts with the ready-made note across the full width", () => {
      const first = panels[0];
      expect(first.type).toBe("markdown");
      expect(first.markdownContent).toBe(noteOf(id));
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

// A chart that sits at 0 on a healthy system reads as broken unless it says so.
const HEALTHY_AT_ZERO: Array<[string, any, string[]]> = [
  ["postgresql", postgresql, ["pg_rollback_ratio", "pg_rollbacks", "pg_deadlocks"]],
  [
    "mysql",
    mysql,
    ["mysql_rollbacks", "mysql_lock_waits", "mysql_row_lock_time", "mysql_tmp_disk_tables"],
  ],
  ["redis", redis, ["redis_rejected_connections", "redis_evicted_keys", "redis_clients_over_time"]],
  [
    "otelcol",
    otelCollector,
    [
      "otelcol_refused_rate",
      "otelcol_send_failed_rate",
      "otelcol_queue_fill",
      "otelcol_accepted_vs_refused",
      "otelcol_sent_vs_failed",
      "otelcol_queue",
    ],
  ],
  ["mongodb", mongodb, ["mongo_cursor_timeouts", "mongo_cache_misses"]],
  ["sqlserver", sqlserver, ["mssql_lock_waits_rate", "mssql_lock_waits"]],
  ["oracle", oracle, ["ora_rollback_ratio", "ora_rollbacks", "ora_deadlocks"]],
];
const SAYS_ZERO_IS_HEALTHY = /\b0%?\b[^.]*\b(healthy|normal)\b/;

describe.each(HEALTHY_AT_ZERO)("ready-made %s dashboard: zero is healthy", (_id, doc, ids) => {
  it.each(ids)("%s says a flat 0 is healthy", (panelId) => {
    const panel = dataPanels(doc).find((p) => p.id === panelId);
    expect(panel, panelId).toBeDefined();
    expect(panel.description).toMatch(SAYS_ZERO_IS_HEALTHY);
  });

  it("says it on no other chart", () => {
    for (const p of dataPanels(doc).filter((x) => !ids.includes(x.id))) {
      expect(p.description, p.id).not.toMatch(SAYS_ZERO_IS_HEALTHY);
    }
  });
});

describe("ready-made OTel Collector dashboard", () => {
  const all = panelsOf(otelCollector);
  const setup = all.find((p) => p.id === "otelcol_setup");
  const yaml = (setup.markdownContent.match(/```yaml\n([\s\S]*?)```/) ?? [])[1] ?? "";

  it("keeps the note first and puts the setup instructions last, below every chart", () => {
    expect(all[0].id).toBe("otelcol_note");
    expect(all.at(-1)).toBe(setup);
    const bottom = Math.max(...all.filter((p) => p !== setup).map((p) => p.layout.y + p.layout.h));
    expect(setup.layout.y).toBe(bottom);
    expect(setup.layout).toMatchObject({ x: 0, w: 192 });
  });

  it("opens with the shared note, then points at the setup panel at the end", () => {
    const [note] = all;
    expect(note.markdownContent.startsWith(`${NOTE} `)).toBe(true);
    expect(note.markdownContent.endsWith(OTEL_SETUP_POINTER)).toBe(true);
    expect(note.layout.h).toBe(6);
    expect(Math.min(...all.slice(1).map((p) => p.layout.y))).toBe(note.layout.h);
  });

  it("explains in its last panel how to make the collector send its own metrics", () => {
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

// Kafka, RabbitMQ, Nginx, Apache: no setup card in the app, measured on collector contrib 0.115.1.
const RECEIVER_STREAMS = new Set([
  ...words(
    "brokers consumer_group_lag consumer_group_lag_sum consumer_group_members consumer_group_offset consumer_group_offset_sum partition_current_offset partition_oldest_offset partition_replicas partition_replicas_in_sync topic_partitions",
  ).map((n) => `kafka_${n}`),
  ...words(
    "consumer_count message_acknowledged message_current message_delivered message_published",
  ).map((n) => `rabbitmq_${n}`),
  ...words("connections_accepted connections_current connections_handled requests").map(
    (n) => `nginx_${n}`,
  ),
  ...words(
    "cpu_load cpu_time current_connections load_1 load_15 load_5 request_time requests scoreboard traffic uptime workers",
  ).map((n) => `apache_${n}`),
]);
// is_monotonic=true on the live streams; apache_uptime is monotonic too but read as is.
const RECEIVER_MONOTONIC = new Set(
  words(`
    rabbitmq_message_acknowledged rabbitmq_message_delivered rabbitmq_message_published
    nginx_connections_accepted nginx_connections_handled nginx_requests
    apache_cpu_time apache_request_time apache_requests apache_traffic
  `),
);
// Gauges that only grow: a raw value means nothing, so they are read as a rate or as a newest-minus-oldest span.
const KAFKA_OFFSETS = new Set(
  words(
    "kafka_partition_current_offset kafka_partition_oldest_offset kafka_consumer_group_offset kafka_consumer_group_offset_sum",
  ),
);
const KAFKA_UNLABELLED = new Set(["kafka_brokers", "kafka_consumer_group_members"]);

const receiverSelectors = (query: string) => {
  const text = query.replace(/\b(by|without|on|ignoring|group_left|group_right)\s*\([^)]*\)/g, "");
  const out: Array<{ name: string; matchers: string; before: string }> = [];
  const re = /\b((?:kafka|rabbitmq|nginx|apache)_[a-z0-9_]+)(\{[^}]*\})?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ name: m[1], matchers: m[2] ?? "", before: text.slice(0, m.index) });
  }
  return out;
};

interface ReceiverCase {
  id: ReadyMadeSourceId;
  receiver: string;
  doc: any;
  variables: Array<{ name: string; label: string; stream: string; field: string; filter: string[] }>;
  matchers: string[];
  labelled: (stream: string) => boolean;
  zeroHealthy: string[];
}

const RABBIT_VARS = ["node", "vhost", "queue"];
const RECEIVER_CASES: ReceiverCase[] = [
  {
    id: "kafka",
    receiver: "kafkametrics",
    doc: kafka,
    variables: [
      { name: "topic", label: "Topic", stream: "kafka_topic_partitions", field: "topic", filter: [] },
    ],
    matchers: ['topic=~"$topic"'],
    labelled: (s) => !KAFKA_UNLABELLED.has(s),
    zeroHealthy: ["kafka_out_of_sync", "kafka_out_of_sync_by_topic"],
  },
  {
    id: "rabbitmq",
    receiver: "rabbitmq",
    doc: rabbitmq,
    variables: RABBIT_VARS.map((name, k) => ({
      name,
      label: name === "vhost" ? "Vhost" : name[0].toUpperCase() + name.slice(1),
      stream: "rabbitmq_consumer_count",
      field: `rabbitmq_${name}_name`,
      filter: RABBIT_VARS.slice(0, k).map((v) => `rabbitmq_${v}_name`),
    })),
    matchers: RABBIT_VARS.map((v) => `rabbitmq_${v}_name=~"$${v}"`),
    labelled: () => true,
    zeroHealthy: ["rabbitmq_queues_without_consumers"],
  },
  {
    id: "nginx",
    receiver: "nginx",
    doc: nginx,
    variables: [],
    matchers: [],
    labelled: () => false,
    zeroHealthy: ["nginx_dropped_rate", "nginx_dropped"],
  },
  {
    id: "apache",
    receiver: "apache",
    doc: apache,
    variables: [
      { name: "server", label: "Server", stream: "apache_uptime", field: "apache_server_name", filter: [] },
    ],
    matchers: ['apache_server_name=~"$server"'],
    labelled: () => true,
    zeroHealthy: ["apache_connections"],
  },
];

describe.each(RECEIVER_CASES)(
  "ready-made $id dashboard (receiver without a setup card)",
  ({ id, receiver, doc, variables, matchers, labelled, zeroHealthy }) => {
    const panels = panelsOf(doc);
    const charts = dataPanels(doc);

    it("is a v8 document with the catalog title, the marker, 15 minutes and no baked-in id", () => {
      expect(doc.version).toBe(8);
      expect(doc.title).toBe(getReadyMadeSource(id).dashboards[0].title);
      expect(doc.role).toBe(readyMadeMarker(id, "overview"));
      expect(doc.dashboardId).toBe("");
      expect(doc.tabs).toHaveLength(1);
      expect(doc.defaultDatetimeDuration).toMatchObject({ type: "relative", relativeTimePeriod: "15m" });
    });

    it("passes through the schema converter unchanged", () => {
      expect(convertDashboardSchemaVersion(structuredClone(doc))).toEqual(doc);
    });

    it("opens with the shared note plus one sentence naming the collector receiver", () => {
      expect(panels[0].type).toBe("markdown");
      expect(panels[0].markdownContent).toBe(
        `${NOTE} The data comes from the ${receiver} receiver of the OpenTelemetry Collector Contrib.`,
      );
      expect(panels[0].layout).toMatchObject({ x: 0, y: 0, w: 192 });
      expect(panels.filter((p) => p.type === "markdown")).toHaveLength(1);
    });

    it("gives every chart a description, a known unit and custom PromQL", () => {
      for (const p of charts) {
        expect(p.description.trim().length, p.id).toBeGreaterThan(10);
        expect(KNOWN_UNITS.has(p.config.unit), `${p.id} unit ${p.config.unit}`).toBe(true);
        expect(p.queryType, p.id).toBe("promql");
        expect(["metric", "line", "table"], p.id).toContain(p.type);
        for (const q of p.queries) {
          expect(q.customQuery, p.id).toBe(true);
          expect(typeof q.config.promql_legend, p.id).toBe("string");
          expect(q.fields.stream_type, p.id).toBe("metrics");
          expect(q.fields.stream, `${p.id} fields.stream`).toBe(receiverSelectors(q.query)[0]?.name);
        }
      }
    });

    it("keeps ids unique and lays panels inside the 192-column grid without overlaps", () => {
      expect(new Set(panels.map((p) => p.id)).size).toBe(panels.length);
      expect(new Set(panels.map((p) => p.layout.i)).size).toBe(panels.length);
      const overlaps = (a: any, b: any) =>
        a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      for (const [k, p] of panels.entries()) {
        expect(p.layout.x + p.layout.w, p.id).toBeLessThanOrEqual(192);
        for (const q of panels.slice(k + 1)) {
          expect(overlaps(p.layout, q.layout), `${p.id} / ${q.id}`).toBe(false);
        }
      }
    });

    it(`reads only ${id}_* streams the receiver writes, counters only through rate()`, () => {
      for (const { panel, query } of queriesOf(doc)) {
        const found = receiverSelectors(query);
        expect(found.length, `${panel.id}: ${query}`).toBeGreaterThan(0);
        for (const s of found) {
          expect(s.name.startsWith(`${id}_`), `${panel.id}: ${s.name}`).toBe(true);
          expect(RECEIVER_STREAMS.has(s.name), `${panel.id}: ${s.name}`).toBe(true);
          const wrapped = /\b(rate|increase)\(\s*$/.test(s.before);
          if (KAFKA_OFFSETS.has(s.name)) {
            expect(wrapped || panel.id === "kafka_retained", `${panel.id}: ${s.name}`).toBe(true);
          } else {
            expect(wrapped, `${panel.id}: ${s.name}`).toBe(RECEIVER_MONOTONIC.has(s.name));
          }
        }
      }
    });

    it("anchors literal regex alternations", () => {
      for (const { panel, query } of queriesOf(doc)) {
        for (const [, value] of query.matchAll(/=~"([^"$][^"]*)"/g)) {
          if (value.includes("|")) expect(value, panel.id).toMatch(/^\^\(.*\)\$$/);
        }
      }
    });

    it(
      matchers.length
        ? "filters every labelled selector by every dashboard variable"
        : "uses no dashboard variables",
      () => {
        for (const { panel, query } of queriesOf(doc)) {
          for (const s of receiverSelectors(query)) {
            if (labelled(s.name)) {
              for (const m of matchers) expect(s.matchers, `${panel.id}: ${s.name}`).toContain(m);
            } else {
              expect(s.matchers, `${panel.id}: ${s.name}`).not.toMatch(VARIABLE_REF);
            }
          }
        }
      },
    );

    it(`declares ${variables.map((v) => v.name).join(", ") || "no variables"}`, () => {
      const list = doc.variables.list;
      expect(list.map((v: any) => v.name)).toEqual(variables.map((v) => v.name));
      for (const [k, v] of variables.entries()) {
        expect(list[k]).toMatchObject({
          type: "query_values",
          label: v.label,
          multiSelect: true,
          selectAllValueForMultiSelect: "all",
          query_data: { stream_type: "metrics", stream: v.stream, field: v.field },
        });
        expect(RECEIVER_STREAMS.has(v.stream)).toBe(true);
        // Each variable narrows by the ones before it, so a node's vhosts and queues are offered.
        expect(list[k].query_data.filter.map((f: any) => f.name)).toEqual(v.filter);
        for (const f of list[k].query_data.filter) {
          expect(f.operator).toBe("IN");
          expect(f.value).toBe(`$${variables.find((x) => x.field === f.name)?.name}`);
        }
      }
    });

    it.each(zeroHealthy)("%s says a flat 0 is healthy", (panelId) => {
      const panel = charts.find((p) => p.id === panelId);
      expect(panel, panelId).toBeDefined();
      expect(panel.description).toMatch(SAYS_ZERO_IS_HEALTHY);
    });

    it("says a flat 0 is healthy on no other chart", () => {
      for (const p of charts.filter((x) => !zeroHealthy.includes(x.id))) {
        expect(p.description, p.id).not.toMatch(SAYS_ZERO_IS_HEALTHY);
      }
    });
  },
);

describe("ready-made Kafka dashboard: consumer groups", () => {
  it("says on every consumer-group chart that it stays empty without a group", () => {
    const readers = dataPanels(kafka).filter((p) =>
      p.queries.some((q: any) => q.query.includes("kafka_consumer_group_")),
    );
    expect(readers.length).toBeGreaterThanOrEqual(4);
    for (const p of readers) {
      expect(p.description, p.id).toContain("Empty until a consumer group commits offsets.");
    }
  });

  it("says on the Brokers tile that the receiver has no cluster label", () => {
    const brokers = dataPanels(kafka).find((p) => p.id === "kafka_brokers");
    expect(brokers.description).toContain("no cluster label");
  });
});

describe("ready-made RabbitMQ dashboard: dropped messages", () => {
  it("does not chart rabbitmq_message_dropped and says why", () => {
    expect(JSON.stringify(rabbitmq)).not.toContain("rabbitmq_message_dropped");
    const unacked = dataPanels(rabbitmq).find((p) => p.id === "rabbitmq_unacked_by_queue");
    expect(unacked.description).toContain("Dropped (unroutable) messages are not charted");
  });
});

describe.each([
  ["nginx", nginx, "stub_status"],
  ["apache", apache, "mod_status"],
])("ready-made %s dashboard: no HTTP status codes", (_id, doc, module) => {
  it("names the missing status codes in the dashboard and request chart descriptions", () => {
    expect(doc.description).toContain(`${module} has no HTTP status codes`);
    const requestCharts = dataPanels(doc).filter((p) => p.title === "Requests/s");
    expect(requestCharts.length).toBeGreaterThan(0);
    for (const p of requestCharts) expect(p.description, p.id).toMatch(/status codes/);
  });

  it("charts no HTTP error rate", () => {
    for (const p of dataPanels(doc)) {
      expect(p.title, p.id).not.toMatch(/\b(4xx|5xx|HTTP errors?|error rate)\b/i);
    }
  });
});

describe("ready-made Nginx dashboard: merged servers", () => {
  it("warns on every chart that the receiver adds no server label", () => {
    for (const p of dataPanels(nginx)) expect(p.description, p.id).toContain("no server label");
  });
});

describe("ready-made MongoDB dashboard: values repeated per database", () => {
  const repeated = /mongodb_(connection_count|memory_usage|document_operation_count)\b/;
  const readers = dataPanels(mongodb).filter((p) =>
    p.queries.some((q: any) => repeated.test(q.query)),
  );

  it("collapses the per-database copies with max by server before summing", () => {
    expect(readers.length).toBeGreaterThanOrEqual(5);
    for (const p of readers) {
      for (const q of p.queries) {
        for (const s of selectors(q.query).filter((x) => repeated.test(x.name))) {
          expect(q.query.slice(0, q.query.indexOf(s.name)), p.id).toMatch(
            /max by \(server_address(, \w+)?\)\((rate\()?$/,
          );
        }
      }
      expect(p.description, p.id).toContain("counts it once per server");
    }
  });

  it("shows operation time in microseconds and says why", () => {
    const timed = dataPanels(mongodb).filter((p) =>
      p.queries.some((q: any) => q.query.includes("mongodb_operation_time")),
    );
    expect(timed.length).toBe(2);
    for (const p of timed) {
      expect(p.config.unit, p.id).toBe("microseconds");
      expect(p.description, p.id).toContain("MongoDB reports this time in microseconds");
    }
  });
});

describe("ready-made SQL Server dashboard: running totals and merged instances", () => {
  it("says on every chart that instances share one series without the resource attributes", () => {
    for (const p of dataPanels(sqlserver)) {
      expect(p.description, p.id).toContain("sqlserver.instance.name");
    }
  });

  it("explains rate() wherever a *_rate stream is read", () => {
    for (const p of dataPanels(sqlserver)) {
      const reads = p.queries.some((q: any) => /sqlserver_\w+_rate\b/.test(q.query));
      expect(/running totals? despite/.test(p.description), p.id).toBe(reads);
    }
  });
});

describe("ready-made Oracle dashboard: tablespace limits", () => {
  it("divides by positive tablespace limits only", () => {
    const use = dataPanels(oracle).find((p) => p.id === "ora_tablespace_use");
    expect(use.queries[0].query).toMatch(/oracledb_tablespace_size_limit\{[^}]*\} > 0\)$/);
  });
});

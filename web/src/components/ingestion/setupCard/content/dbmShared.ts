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

// Database Monitoring (server-vantage) collector recipes.
//
// WHY THIS FILE EXISTS. The Databases pages under Traces read two different
// vantages. Query timings come from CLIENT spans, which need no setup here — an
// instrumented app already emits them. Deadlocks and blocked queries can only
// ever come from the database SERVER: a blocked query produces no client span
// while it is blocked, and a deadlock's other participant may not be
// instrumented at all. That data is collected by stock OTel Contrib receivers,
// so without a config to copy the Deadlocks and Blocked-queries tabs stay empty
// forever and the empty state can only say "not collecting".
//
// THE FIELD NAMES BELOW ARE A CONTRACT, NOT A STYLE CHOICE. The ingest-side
// parser (src/core/src/traces/db_monitoring/server_vantage.rs) canonicalizes on
// exact keys — `o2_recipe`, `o2_pg_event`, `o2_my_event`, `dl_query_1`,
// `blocked_pid`, `blocking_query`, `my_trx_side`, … Renaming a SQL alias or a
// regex capture group here silently produces records the parser skips, which
// surfaces as "we are collecting but nothing appears". Keep them in lockstep.
//
// Every recipe below is transcribed from a VERIFIED run of the capture rig at
// tests/dbm-server-vantage (collector-contrib 0.135.0, Postgres 16, MySQL 8.4),
// which recorded real deadlocks on both engines with every participant's SQL.
// Findings: docs/___databsepages/dbm-server-vantage-proof.md.

import { raw } from "@/types/i18n";

import type { RichCardStep } from "../types";

/**
 * The logs stream every server-vantage recipe exports to. Must match
 * `DEFAULT_SERVER_STREAM` in api.rs — the read endpoints look here by default.
 */
export const DBM_SERVER_STREAM = "dbm_server";

/**
 * Postgres blocking chains, from `pg_stat_activity` + `pg_blocking_pids()`.
 *
 * This is a SAMPLER, not an event log: it lists who is waiting right now, so a
 * lock that comes and goes between two 10s ticks is invisible. That is inherent
 * to the source (Postgres emits no "blocked" event), and it is why the Blocked
 * queries tab states its sample interval rather than implying completeness.
 */
const PG_BLOCKING_RECEIVER = `  sqlquery/pg_blocking:
    driver: postgres
    datasource: "host={host} port={port} user=\${env:PGUSER} password=\${env:PGPASS} dbname={database} sslmode=disable"
    collection_interval: 10s
    queries:
      - sql: |
          SELECT
            blocked.pid::text                                          AS blocked_pid,
            coalesce(blocked.usename,'')                               AS blocked_user,
            coalesce(blocked.application_name,'')                      AS blocked_app,
            coalesce(blocked.query,'')                                 AS blocked_query,
            coalesce(blocked.wait_event_type,'')                       AS wait_event_type,
            coalesce(blocked.wait_event,'')                            AS wait_event,
            coalesce(round(EXTRACT(EPOCH FROM (now()-blocked.query_start))::numeric,3),0)::text AS blocked_wait_s,
            blocking.pid::text                                         AS blocking_pid,
            coalesce(blocking.state,'')                                AS blocking_state,
            coalesce(blocking.application_name,'')                     AS blocking_app,
            coalesce(blocking.query,'')                                AS blocking_query,
            'pg_blocking_chain'                                        AS o2_recipe
          FROM pg_stat_activity blocked
          JOIN LATERAL unnest(pg_blocking_pids(blocked.pid)) AS b(pid) ON true
          JOIN pg_stat_activity blocking ON blocking.pid = b.pid
        logs:
          - body_column: blocked_query
            attribute_columns:
              [blocked_pid, blocked_user, blocked_app, wait_event_type, wait_event,
               blocked_wait_s, blocking_pid, blocking_state, blocking_app,
               blocking_query, o2_recipe]`;

/**
 * Postgres deadlocks, tailed from the server's own log file.
 *
 * THE GOTCHA THIS RECIPE EXISTS TO HANDLE: Postgres writes a deadlock as TWO
 * separate log entries — an `ERROR: deadlock detected` banner, and a `DETAIL:`
 * block holding the wait cycle and every participant's SQL. A pipeline that
 * matches only "deadlock detected" records that a deadlock happened and loses
 * every query, which is the difference between a useful page and a counter.
 * Both entries are routed to the deadlock branch below.
 */
const PG_DEADLOG_RECEIVER = `  filelog/pg_deadlocks:
    include: [{logpath}]
    start_at: end
    multiline:
      line_start_pattern: '^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}\\.\\d{3} \\w+ \\['
    operators:
      - type: regex_parser
        regex: '^(?P<ts>\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}\\.\\d{3} \\w+) \\[(?P<pg_pid>\\d+)\\] (?:(?P<pg_user>[^@ ]+)@(?P<pg_db>\\S+) )?(?P<pg_severity>[A-Z][A-Z0-9]*):\\s+(?P<pg_message>(?s).*)$'
        on_error: send
        timestamp:
          parse_from: attributes.ts
          layout: "%Y-%m-%d %H:%M:%S.%L %Z"
      - type: add
        field: attributes.o2_pg_event
        value: other
      - type: router
        routes:
          - expr: 'attributes.pg_message matches "^deadlock detected"'
            output: mark_deadlock
          - expr: 'attributes.pg_severity == "DETAIL" and attributes.pg_message matches "waits for .* blocked by process"'
            output: mark_deadlock
        default: emit
      - type: add
        id: mark_deadlock
        field: attributes.o2_pg_event
        value: deadlock
      - type: copy
        from: attributes.pg_pid
        to: attributes.deadlock_victim_pid
      - type: regex_parser
        parse_from: attributes.pg_message
        regex: 'Process (?P<dl_waiter_pid>\\d+) waits for (?P<dl_lock_mode>\\S+) on (?P<dl_lock_target>[^;]+); blocked by process (?P<dl_blocker_pid>\\d+)'
        on_error: send
      - type: regex_parser
        parse_from: attributes.pg_message
        regex: '(?s)blocked by process \\d+\\.\\s*\\n\\s*Process (?P<dl_waiter2_pid>\\d+) waits for (?P<dl_lock_mode2>\\S+) on (?P<dl_lock_target2>[^;]+); blocked by process (?P<dl_blocker2_pid>\\d+)'
        on_error: send
      - type: regex_parser
        parse_from: attributes.pg_message
        regex: '(?s)Process (?P<dl_p1>\\d+): (?P<dl_query_1>[^\\n]+)'
        on_error: send
      - type: regex_parser
        parse_from: attributes.pg_message
        regex: '(?s)Process \\d+: [^\\n]+\\n\\s*Process (?P<dl_p2>\\d+): (?P<dl_query_2>[^\\n]+)'
        on_error: send
      - type: move
        from: attributes.pg_message
        to: attributes.o2_deadlock_raw
        output: emit
      - type: noop
        id: emit`;

/**
 * MySQL blocking, from `performance_schema.data_lock_waits` joined to
 * `innodb_trx` for the statement text on both sides.
 */
const MYSQL_BLOCKING_RECEIVER = `  sqlquery/mysql_locks:
    driver: mysql
    datasource: "\${env:MYSQL_USER}:\${env:MYSQL_PASSWORD}@tcp({host}:{port})/{database}"
    collection_interval: 10s
    queries:
      - sql: |
          SELECT CAST(w.REQUESTING_ENGINE_TRANSACTION_ID AS CHAR) AS waiting_trx,
                 CAST(w.BLOCKING_ENGINE_TRANSACTION_ID AS CHAR)   AS blocking_trx,
                 COALESCE(rt.trx_mysql_thread_id, 0)              AS waiting_thread,
                 COALESCE(bt.trx_mysql_thread_id, 0)              AS blocking_thread,
                 COALESCE(LEFT(rt.trx_query,500), '')             AS waiting_query,
                 COALESCE(LEFT(bt.trx_query,500), '')             AS blocking_query,
                 COALESCE(rt.trx_state,'')                        AS waiting_state,
                 COALESCE(bt.trx_state,'')                        AS blocking_state,
                 CAST(COALESCE(TIMESTAMPDIFF(SECOND, rt.trx_wait_started, NOW()),0) AS CHAR) AS wait_secs,
                 'mysql_lock_waits'                               AS o2_recipe
          FROM performance_schema.data_lock_waits w
          LEFT JOIN information_schema.innodb_trx rt
                 ON rt.trx_id = w.REQUESTING_ENGINE_TRANSACTION_ID
          LEFT JOIN information_schema.innodb_trx bt
                 ON bt.trx_id = w.BLOCKING_ENGINE_TRANSACTION_ID
        logs:
          - body_column: waiting_query
            attribute_columns:
              [waiting_trx, blocking_trx, waiting_thread, blocking_thread,
               blocking_query, waiting_state, blocking_state, wait_secs, o2_recipe]`;

/**
 * MySQL deadlocks, tailed from the error log.
 *
 * TWO GOTCHAS. (1) MySQL 8.4 splits ONE deadlock across MANY separately
 * timestamped entries: MY-012468 is only the banner, and each
 * `*** (N) TRANSACTION:` block is its own MY-012469 entry — so both codes route
 * to the deadlock branch and the sides are stitched back together at read time.
 * (2) Unless `innodb_print_all_deadlocks` is ON, MySQL keeps only the MOST
 * RECENT deadlock, so history is lost; the prepare step turns it on and the
 * Deadlocks page reports the setting when it can read it.
 */
const MYSQL_DEADLOG_RECEIVER = `  filelog/mysql_deadlocks:
    include: [{logpath}]
    start_at: end
    multiline:
      line_start_pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}'
    operators:
      - type: regex_parser
        regex: '^(?P<ts>\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d+Z) (?P<my_thread>\\d+) \\[(?P<my_severity>\\w+)\\] \\[(?P<my_code>[^\\]]+)\\] \\[(?P<my_subsys>[^\\]]+)\\] (?P<my_message>(?s).*)$'
        on_error: send
        timestamp:
          parse_from: attributes.ts
          layout: "%Y-%m-%dT%H:%M:%S.%fZ"
      - type: add
        field: attributes.o2_my_event
        value: other
      - type: router
        routes:
          - expr: 'attributes.my_code == "MY-012468" or attributes.my_code == "MY-012469"'
            output: my_dl
          - expr: 'attributes.my_message != nil and attributes.my_message matches "(?i)deadlock"'
            output: my_dl
        default: my_emit
      - type: add
        id: my_dl
        field: attributes.o2_my_event
        value: deadlock
      - type: regex_parser
        parse_from: attributes.my_message
        regex: '(?s)\\*\\*\\* \\((?P<my_trx_side>\\d+)\\) TRANSACTION:\\s*\\nTRANSACTION (?P<my_trx_id>\\d+).*?MySQL thread id (?P<my_trx_thread>\\d+),[^\\n]*?query id \\d+ (?P<my_trx_host>\\S+) (?P<my_trx_user>\\S+)[^\\n]*\\n(?P<my_trx_query>[^\\n]+)'
        on_error: send
      - type: regex_parser
        parse_from: attributes.my_message
        regex: '(?s)RECORD LOCKS space id \\d+ page no \\d+ n bits \\d+ index (?P<my_lock_index>\\S+) of table (?P<my_lock_table>\\S+) trx id \\d+ (?P<my_lock_mode>lock_mode \\S+)'
        on_error: send
      - type: regex_parser
        parse_from: attributes.my_message
        regex: '\\*\\*\\* WE ROLL BACK TRANSACTION \\((?P<my_victim_side>\\d+)\\)'
        on_error: send
        output: my_emit
      - type: noop
        id: my_emit`;

/**
 * SQL Server blocking, from `sys.dm_exec_requests` joined to `sys.dm_exec_sessions`
 * and `sys.dm_exec_sql_text` for the statement on both sides.
 *
 * BLOCKING ONLY, deliberately. SQL Server records deadlocks as an XML deadlock
 * graph in the `system_health` Extended Events session — a shape the ingest
 * parser cannot read yet, so shipping a deadlock recipe here would fill the
 * stream with records the Deadlocks page silently drops. Blocking needs no new
 * parser: the aliases below are the same column names the Postgres and MySQL
 * recipes emit, which is the whole contract `canonicalize_blocking` reads.
 */
const MSSQL_BLOCKING_RECEIVER = `  sqlquery/mssql_blocking:
    driver: sqlserver
    datasource: "sqlserver://\${env:MSSQL_USER}:\${env:MSSQL_PASSWORD}@{host}:{port}?database={database}"
    collection_interval: 10s
    queries:
      - sql: |
          SELECT CAST(r.session_id AS VARCHAR(20))            AS blocked_pid,
                 COALESCE(s.login_name, '')                   AS blocked_user,
                 COALESCE(s.program_name, '')                 AS blocked_app,
                 COALESCE(SUBSTRING(t.text, 1, 500), '')      AS blocked_query,
                 COALESCE(r.wait_type, '')                    AS wait_event_type,
                 COALESCE(r.wait_resource, '')                AS wait_event,
                 CAST(r.wait_time / 1000.0 AS VARCHAR(20))    AS blocked_wait_s,
                 CAST(r.blocking_session_id AS VARCHAR(20))   AS blocking_pid,
                 COALESCE(bs.status, '')                      AS blocking_state,
                 COALESCE(bs.program_name, '')                AS blocking_app,
                 COALESCE(SUBSTRING(bt.text, 1, 500), '')     AS blocking_query,
                 'mssql_blocking_chain'                       AS o2_recipe
          FROM sys.dm_exec_requests r
          JOIN sys.dm_exec_sessions s  ON s.session_id  = r.session_id
          LEFT JOIN sys.dm_exec_sessions bs ON bs.session_id = r.blocking_session_id
          OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) t
          LEFT JOIN sys.dm_exec_connections bc ON bc.session_id = r.blocking_session_id
          OUTER APPLY sys.dm_exec_sql_text(bc.most_recent_sql_handle) bt
          WHERE r.blocking_session_id <> 0
        logs:
          - body_column: blocked_query
            attribute_columns:
              [blocked_pid, blocked_user, blocked_app, wait_event_type, wait_event,
               blocked_wait_s, blocking_pid, blocking_state, blocking_app,
               blocking_query, o2_recipe]`;

/**
 * Assemble the full DBM config for an engine.
 *
 * A SECOND config file rather than extra receivers bolted onto the metrics one:
 * the two have different lifecycles (metrics is the common case, DBM is opt-in),
 * and the logs pipeline needs its own `logs_endpoint` + `stream-name` header. A
 * user running both simply passes two `--config` flags, which the run step shows.
 */
const RECIPES = {
  postgres: {
    receivers: [PG_BLOCKING_RECEIVER, PG_DEADLOG_RECEIVER],
    names: "sqlquery/pg_blocking, filelog/pg_deadlocks",
  },
  mysql: {
    receivers: [MYSQL_BLOCKING_RECEIVER, MYSQL_DEADLOG_RECEIVER],
    names: "sqlquery/mysql_locks, filelog/mysql_deadlocks",
  },
  // Blocking only — see MSSQL_BLOCKING_RECEIVER for why deadlocks are absent.
  mssql: {
    receivers: [MSSQL_BLOCKING_RECEIVER],
    names: "sqlquery/mssql_blocking",
  },
} as const;

const dbmConfig = (engine: keyof typeof RECIPES) => {
  const { receivers, names } = RECIPES[engine];

  return `receivers:
${receivers.join("\n")}

processors:
  batch:
    timeout: 5s
    send_batch_size: 512

exporters:
  otlphttp/openobserve_dbm:
    logs_endpoint: {url}/api/{org}/v1/logs
    headers:
      Authorization: Basic {token}
      stream-name: ${DBM_SERVER_STREAM}

service:
  pipelines:
    logs:
      receivers: [${names}]
      processors: [batch]
      exporters: [otlphttp/openobserve_dbm]`;
};

export const PG_DBM_CONFIG_YAML = dbmConfig("postgres");
export const MYSQL_DBM_CONFIG_YAML = dbmConfig("mysql");
export const MSSQL_DBM_CONFIG_YAML = dbmConfig("mssql");

/**
 * Grants for the DBM reader. Postgres needs `pg_monitor` to see OTHER sessions'
 * query text in `pg_stat_activity` — without it every `blocking_query` comes
 * back empty and the Blocked-queries page can show that something is blocking
 * but never what. MySQL's PROCESS privilege plays the same role, and is already
 * granted by the metrics step, so only the deadlock-history flag is added here.
 */
export const PG_DBM_GRANT_SQL = `GRANT pg_monitor TO myuser;`;
export const MYSQL_DBM_GRANT_SQL = `SET GLOBAL innodb_print_all_deadlocks = ON;`;
/**
 * SQL Server needs VIEW SERVER STATE to read other sessions in
 * `sys.dm_exec_requests`. The metrics step's login already has
 * VIEW SERVER PERFORMANCE STATE, which is NOT sufficient here — it exposes
 * performance counters, not the session/request DMVs the blocking join reads.
 */
export const MSSQL_DBM_GRANT_SQL = `GRANT VIEW SERVER STATE TO otel;`;

/**
 * The closing "what you just unlocked" step.
 *
 * `pages` differs per engine because the tabs an engine can actually fill
 * differ: SQL Server ships blocking only (no deadlock-graph parser yet), and
 * pointing a user at a Deadlocks tab their config can never populate is the
 * "collecting but empty" trap the lock empty-states exist to prevent.
 */
export function dbmVerifyStep(pages: "both" | "blocking" = "both"): RichCardStep {
  return {
    id: "verify-dbm",
    titleKey: "ingestion.setupCard.dbmVerifyTitle",
    descriptionKey:
      pages === "both"
        ? "ingestion.setupCard.dbmVerifyDesc"
        : "ingestion.setupCard.dbmVerifyBlockingDesc",
    chip: { kind: "traces", labelKey: "ingestion.setupCard.chipLogs" },
    completeOn: "copy",
    // Untranslated: these are the page names in the product's own navigation,
    // so a translated pill would stop matching what the user is looking for.
    pills: pages === "both" ? [raw("Deadlocks"), raw("Blocked queries")] : [raw("Blocked queries")],
  };
}

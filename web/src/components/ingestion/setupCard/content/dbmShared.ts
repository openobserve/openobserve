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
            '{host}'                                                   AS server_address,
            'pg_blocking_chain'                                        AS o2_recipe
          FROM pg_stat_activity blocked
          JOIN LATERAL unnest(pg_blocking_pids(blocked.pid)) AS b(pid) ON true
          JOIN pg_stat_activity blocking ON blocking.pid = b.pid
        logs:
          - body_column: blocked_query
            attribute_columns:
              [blocked_pid, blocked_user, blocked_app, wait_event_type, wait_event,
               blocked_wait_s, blocking_pid, blocking_state, blocking_app,
               blocking_query, server_address, o2_recipe]`;

/**
 * Postgres deadlocks, tailed from the server's own log file.
 *
 * THE GOTCHA THIS RECIPE EXISTS TO HANDLE: Postgres writes a deadlock as TWO
 * separate log entries — an `ERROR: deadlock detected` banner, and a `DETAIL:`
 * block holding the wait cycle and every participant's SQL. A pipeline that
 * matches only "deadlock detected" records that a deadlock happened and loses
 * every query, which is the difference between a useful page and a counter.
 * Both entries are routed to the deadlock branch below.
 *
 * THE PREFIX SEGMENT IS NOT OPTIONAL. The `app=… vxid=… txid=… line=…` group in
 * the regex below mirrors PG_DBM_LOGGING_CONF's `log_line_prefix` field for
 * field. An earlier transcription dropped it, which parsed background-worker
 * lines (they carry no session fields, so the whole group is skipped) while
 * failing EVERY session line — including the deadlock banner itself. The result
 * was a collector that looked healthy and a Deadlocks tab that never filled.
 * Change one side and you must change the other; Postgres.spec.ts runs a real
 * log line through this exact pattern to keep them honest.
 */
const PG_DEADLOG_RECEIVER = `  filelog/pg_deadlocks:
    include: [{logpath}]
    start_at: end
    multiline:
      line_start_pattern: '^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}\\.\\d{3} \\w+ \\['
    operators:
      - type: regex_parser
        regex: '^(?P<ts>\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}\\.\\d{3} \\w+) \\[(?P<pg_pid>\\d+)\\] (?:(?P<pg_user>[^@ ]+)@(?P<pg_db>\\S+) app=(?P<pg_app>\\S*) vxid=(?P<pg_vxid>\\S*) txid=(?P<pg_txid>\\S*) line=(?P<pg_line>\\d+) )?(?P<pg_severity>[A-Z][A-Z0-9]*):\\s+(?P<pg_message>(?s).*)$'
        on_error: send
        timestamp:
          parse_from: attributes.ts
          layout: "%Y-%m-%d %H:%M:%S.%L %Z"
      - type: add
        field: attributes.o2_pg_event
        value: other
      # IDENTITY. Without this every host reporting into dbm_server looks like
      # the same server: the read-time deadlock stitch groups on
      # (engine, instance, database), so untagged sides from two different hosts
      # could fuse into one fabricated multi-participant deadlock. The parser
      # reads server_address first (server_vantage.rs detect_instance), and
      # {host} is already substituted into this file's datasources, so the value
      # is known at config-generation time.
      - type: add
        field: attributes.server_address
        value: "{host}"
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
                 '{host}'                                         AS server_address,
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
               blocking_query, waiting_state, blocking_state, wait_secs, server_address, o2_recipe]`;

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
      # IDENTITY. Without this every host reporting into dbm_server looks like
      # the same server: the read-time deadlock stitch groups on
      # (engine, instance, database), so untagged sides from two different hosts
      # could fuse into one fabricated multi-participant deadlock. The parser
      # reads server_address first (server_vantage.rs detect_instance), and
      # {host} is already substituted into this file's datasources, so the value
      # is known at config-generation time.
      - type: add
        field: attributes.server_address
        value: "{host}"
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
 * MariaDB deadlocks. A SEPARATE receiver from MySQL's, not a loosened shared one.
 *
 * WHY SEPARATE. Everything in the InnoDB *body* is identical to MySQL, but the
 * log-line *envelope* is a different format entirely, and the one body literal
 * that differs is fatal:
 *
 *   MySQL 8.4  2026-08-10T05:43:17.699174Z 0 [Note] [MY-012469] [InnoDB] …
 *              → `MySQL thread id 14, …`
 *   MariaDB 11 2026-08-10  8:56:56 14 [Note] InnoDB: …
 *              → `MariaDB thread id 14, …`
 *
 * Space separator, no `T`, no fractional seconds, no `[MY-nnnnnn]` code, and the
 * subsystem is a bare `InnoDB:` prefix rather than a bracketed group. Loosening
 * the MySQL regex to accept both would let its fallback deadlock-text branch
 * start catching MySQL notes that merely MENTION deadlocks, so the duplication
 * here buys a bit-identical, already-verified MySQL path.
 *
 * SPLIT-ENTRY, EXACTLY LIKE MYSQL — so MariaDB owes the same stitching tax.
 * MariaDB prints the whole deadlock under one CLOCK SECOND, which reads like a
 * single block in a text editor, but every physical line carries its own
 * timestamp prefix. `filelog`'s `line_start_pattern` therefore cuts the capture
 * into EIGHT entries, with side 1, side 2 and the rollback verdict each landing
 * on a DIFFERENT record — the same N+1 shape MySQL 8 produces, and the reason
 * `o2_dbm_victim_side` is a stored column and the read-time stitch exists.
 * Measured on tests/dbm-server-vantage/captures/mariadb-deadlock.log:
 *   entry 2 → SIDE 1 (trx 48, thread 14)
 *   entry 5 → SIDE 2 (trx 47, thread 15)
 *   entry 8 → VERDICT victim_side=2
 * So ONE side-regex per record is correct here, as in the MySQL receiver; a
 * second positionally-anchored regex would never fire.
 *
 * DISTINCT `o2_maria_event` KEY, NOT `o2_my_event`. Reusing the MySQL key would
 * make `detect_engine` report "mysql" (it maps any `my_*` key to MySQL), and —
 * worse — `stitch_mysql_deadlocks` groups on (engine, instance, database) where
 * instance and database both default to "", so under-tagged MariaDB and MySQL
 * rows would land in the SAME group and could fabricate a cross-server deadlock.
 */
const MARIADB_DEADLOG_RECEIVER = `  filelog/mariadb_deadlocks:
    include: [{logpath}]
    start_at: end
    multiline:
      line_start_pattern: '^\\d{4}-\\d{2}-\\d{2} +\\d{1,2}:\\d{2}:\\d{2} '
    operators:
      - type: regex_parser
        regex: '^(?P<ts>\\d{4}-\\d{2}-\\d{2} +\\d{1,2}:\\d{2}:\\d{2}) (?P<maria_thread>\\d+) \\[(?P<maria_severity>\\w+)\\] (?P<maria_message>(?s).*)$'
        on_error: send
        timestamp:
          parse_from: attributes.ts
          layout: "%Y-%m-%d %H:%M:%S"
      - type: add
        field: attributes.o2_maria_event
        value: other
      # IDENTITY. Without this every host reporting into dbm_server looks like
      # the same server: the read-time deadlock stitch groups on
      # (engine, instance, database), so untagged sides from two different hosts
      # could fuse into one fabricated multi-participant deadlock. The parser
      # reads server_address first (server_vantage.rs detect_instance), and
      # {host} is already substituted into this file's datasources, so the value
      # is known at config-generation time.
      - type: add
        field: attributes.server_address
        value: "{host}"
      # MariaDB has no [MY-nnnnnn] error code to route on, so the deadlock text
      # IS the only signal. Anchored to InnoDB's own markers rather than a bare
      # "deadlock" match so ordinary notes mentioning the word do not qualify.
      #
      # THE "*** (N) TRANSACTION:" ROUTE IS THE LOAD-BEARING ONE. MariaDB writes
      # the per-side blocks as CONTINUATION lines under an entry whose own text
      # is a bare "InnoDB:" — that entry contains neither "Transactions deadlock
      # detected" (the banner, a separate entry) nor "WE ROLL BACK TRANSACTION"
      # (the verdict, another separate entry). Routing on only those two phrases
      # captured the verdict and dropped BOTH sides, which reads as "deadlocks
      # with no participants". Verified live against the rig.
      - type: router
        routes:
          - expr: 'attributes.maria_message != nil and attributes.maria_message matches "\\\\*\\\\*\\\\* \\\\(\\\\d+\\\\) TRANSACTION:"'
            output: maria_dl
          - expr: 'attributes.maria_message != nil and attributes.maria_message matches "Transactions deadlock detected"'
            output: maria_dl
          - expr: 'attributes.maria_message != nil and attributes.maria_message matches "WE ROLL BACK TRANSACTION"'
            output: maria_dl
        default: maria_emit
      - type: add
        id: maria_dl
        field: attributes.o2_maria_event
        value: deadlock
      # ONE side per record — see the split-entry note above. Identical to the
      # MySQL pattern except the vendor literal "MariaDB thread id".
      - type: regex_parser
        parse_from: attributes.maria_message
        regex: '(?s)\\*\\*\\* \\((?P<maria_trx_side>\\d+)\\) TRANSACTION:\\s*\\nTRANSACTION (?P<maria_trx_id>\\d+).*?MariaDB thread id (?P<maria_trx_thread>\\d+),[^\\n]*?query id \\d+ (?P<maria_trx_host>\\S+) (?P<maria_trx_user>\\S+)[^\\n]*\\n(?P<maria_trx_query>[^\\n]+)'
        on_error: send
      - type: regex_parser
        parse_from: attributes.maria_message
        regex: '(?s)RECORD LOCKS space id \\d+ page no \\d+ n bits \\d+ index (?P<maria_lock_index>\\S+) of table (?P<maria_lock_table>\\S+) trx id \\d+ (?P<maria_lock_mode>lock_mode \\S+)'
        on_error: send
      - type: regex_parser
        parse_from: attributes.maria_message
        regex: '\\*\\*\\* WE ROLL BACK TRANSACTION \\((?P<maria_victim_side>\\d+)\\)'
        on_error: send
        output: maria_emit
      - type: noop
        id: maria_emit`;

/**
 * MariaDB blocking. Same SQL as MySQL's, different `o2_recipe` tag — and the tag
 * is the entire point.
 *
 * `performance_schema.data_lock_waits` and `information_schema.innodb_trx` carry
 * identical names and semantics on both servers, so the query body is a
 * deliberate copy. What must NOT be copied is `'mysql_lock_waits'`:
 * `detect_engine` maps that tag straight to `"mysql"`
 * (`server_vantage.rs:318`), so reusing it would label every MariaDB blocking
 * row as MySQL — wrong on the Databases page, and wrong for the `?system=`
 * filter. `mariadb_lock_waits` keeps the two servers distinguishable.
 */
const MARIADB_BLOCKING_RECEIVER = `  sqlquery/mariadb_locks:
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
                 '{host}'                                         AS server_address,
                 'mariadb_lock_waits'                             AS o2_recipe
          FROM performance_schema.data_lock_waits w
          LEFT JOIN information_schema.innodb_trx rt
                 ON rt.trx_id = w.REQUESTING_ENGINE_TRANSACTION_ID
          LEFT JOIN information_schema.innodb_trx bt
                 ON bt.trx_id = w.BLOCKING_ENGINE_TRANSACTION_ID
        logs:
          - body_column: waiting_query
            attribute_columns:
              [waiting_trx, blocking_trx, waiting_thread, blocking_thread,
               blocking_query, waiting_state, blocking_state, wait_secs, server_address, o2_recipe]`;

/**
 * SQL Server blocking, from `sys.dm_exec_requests` joined to `sys.dm_exec_sessions`
 * and `sys.dm_exec_sql_text` for the statement on both sides.
 *
 * Blocking needs no engine-specific parser: the aliases below are the same
 * column names the Postgres and MySQL recipes emit, which is the whole contract
 * `canonicalize_blocking` reads. Deadlocks are a separate receiver
 * (MSSQL_DEADLOG_RECEIVER) because they live in the `system_health` Extended
 * Events session as XML and need shredding before they reach that contract.
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
                 '{host}'                                     AS server_address,
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
               blocking_query, server_address, o2_recipe]`;

/**
 * SQL Server deadlocks, shredded from the `system_health` Extended Events ring
 * buffer.
 *
 * SHREDDED IN T-SQL, NOT RUST — deliberately. The raw graph is a ~12 KB XML
 * document that is mostly `<stackFrames>` noise, and `apply_to_record` runs on
 * EVERY log record at four ingest sites; parsing XML there would be a new class
 * of hot-path cost and an ingest-path DoS surface. `.nodes()`/`.value()` here
 * flattens the graph server-side into the same one-row-per-participant shape the
 * Postgres and MySQL recipes already emit, so the existing canonicalizer reads
 * it with no new parser.
 *
 * NO STITCHING NEEDED, UNLIKE MYSQL. SQL Server names the victim INLINE
 * (`<victim-list><victimProcess id=…>`) and that id resolves to a `<process>` in
 * the SAME document, so `mssql_is_victim` is decided per row at query time.
 * There is no cross-record verdict to join, which is why this emits a resolved
 * flag rather than a `side`/`victim_side` pair. Verified against a real captured
 * graph: tests/dbm-server-vantage/captures/mssql-deadlock.xml.
 *
 * `SET QUOTED_IDENTIFIER ON` IS REQUIRED, NOT STYLE: XML methods fail without
 * it, and the sqlqueryreceiver's session does not enable it by default. Omit it
 * and every collection errors with msg 1934 while the pipeline looks healthy.
 *
 * The `timestamp` filter keeps the ring buffer from being re-shredded in full on
 * every interval — `system_health` retains hours of deadlocks, so without it the
 * same events would be re-emitted every collection.
 */
const MSSQL_DEADLOG_RECEIVER = `  sqlquery/mssql_deadlocks:
    driver: sqlserver
    datasource: "sqlserver://\${env:MSSQL_USER}:\${env:MSSQL_PASSWORD}@{host}:{port}?database={database}"
    collection_interval: 30s
    queries:
      - sql: |
          SET QUOTED_IDENTIFIER ON;
          SET NOCOUNT ON;
          WITH src AS (
            SELECT CAST(event_data AS XML) AS x
            FROM sys.fn_xe_file_target_read_file('system_health*.xel', NULL, NULL, NULL)
          ),
          dl AS (
            SELECT x.value('(event/@timestamp)[1]','datetime2') AS dl_ts,
                   x.query('(event/data/value/deadlock)[1]')    AS g
            FROM src
            WHERE x.value('(event/@name)[1]','varchar(50)') = 'xml_deadlock_report'
          ),
          v AS (
            SELECT dl_ts, g,
                   g.value('(deadlock/victim-list/victimProcess/@id)[1]','varchar(64)') AS victim_id
            FROM dl
            WHERE dl_ts > DATEADD(minute, -5, SYSUTCDATETIME())
          )
          SELECT CONVERT(VARCHAR(30), v.dl_ts, 126)                                      AS mssql_dl_ts,
                 CAST(p.value('@spid','int') AS VARCHAR(20))                             AS mssql_spid,
                 CAST(CASE WHEN p.value('@id','varchar(64)') = v.victim_id
                           THEN 1 ELSE 0 END AS VARCHAR(1))                              AS mssql_is_victim,
                 COALESCE(p.value('@lockMode','varchar(32)'),'')                         AS mssql_lock_mode,
                 COALESCE(p.value('@clientapp','varchar(128)'),'')                       AS mssql_app,
                 COALESCE(p.value('@loginname','varchar(128)'),'')                       AS mssql_user,
                 COALESCE(p.value('@currentdbname','varchar(128)'),'')                   AS mssql_db,
                 COALESCE(p.value('(../../resource-list/keylock/@objectname)[1]','varchar(256)'),'') AS mssql_lock_target,
                 LTRIM(RTRIM(REPLACE(REPLACE(COALESCE(p.value('(inputbuf/text())[1]','varchar(500)'),''), CHAR(13), ' '), CHAR(10), ' '))) AS mssql_query,
                 '{host}'                                                                AS server_address,
                 'mssql_deadlock'                                                        AS o2_recipe
          FROM v
          CROSS APPLY v.g.nodes('deadlock/process-list/process') AS t(p)
        logs:
          - body_column: mssql_query
            attribute_columns:
              [mssql_dl_ts, mssql_spid, mssql_is_victim, mssql_lock_mode, mssql_app,
               mssql_user, mssql_db, mssql_lock_target, server_address, o2_recipe]`;

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
  // BOTH receivers are MariaDB-specific, even though the blocking SQL is a copy
  // of MySQL's: the recipe TAG is what tells detect_engine which server a row
  // came from, so sharing MySQL's receiver would file MariaDB rows under MySQL.
  mariadb: {
    receivers: [MARIADB_BLOCKING_RECEIVER, MARIADB_DEADLOG_RECEIVER],
    names: "sqlquery/mariadb_locks, filelog/mariadb_deadlocks",
  },
  mssql: {
    receivers: [MSSQL_BLOCKING_RECEIVER, MSSQL_DEADLOG_RECEIVER],
    names: "sqlquery/mssql_blocking, sqlquery/mssql_deadlocks",
  },
} as const;

const dbmConfig = (engine: keyof typeof RECIPES) => {
  const { receivers, names } = RECIPES[engine];

  return `receivers:
${receivers.join("\n")}

processors:
  # Keep ONLY the records the Database Monitoring pages read.
  #
  # This is load-bearing, not tidiness. The filelog receivers tail the whole
  # database log, so without it every ordinary log line lands in dbm_server
  # too — measured on a real deployment, tagged events were 787 rows against
  # 4.8 MILLION untagged ones in the same hour, and the Deadlocks page slowed
  # to 8-18s because every query scanned all of them.
  #
  # A record is ours if a recipe tagged it: sqlquery rows carry o2_recipe,
  # filelog rows carry o2_pg_event / o2_my_event / o2_maria_event. Anything else
  # is dropped.
  filter/dbm:
    error_mode: ignore
    logs:
      log_record:
        # Tests the VALUE, not just presence. Every filelog pipeline stamps its
        # o2_*_event = "other" on EVERY line before routing (so the router has a
        # default), which means a nil-check keeps the whole error log — the exact
        # noise this filter exists to drop. Only the classified events, and the
        # sqlquery recipes' o2_recipe rows, are ours.
        #
        # o2_maria_event MUST be listed here. It is a separate key from
        # o2_my_event by design (see MARIADB_DEADLOG_RECEIVER), so omitting it
        # would drop every MariaDB deadlock while the pipeline looked healthy.
        - 'attributes["o2_recipe"] == nil and (attributes["o2_pg_event"] == nil or attributes["o2_pg_event"] == "other") and (attributes["o2_my_event"] == nil or attributes["o2_my_event"] == "other") and (attributes["o2_maria_event"] == nil or attributes["o2_maria_event"] == "other")'
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
      processors: [filter/dbm, batch]
      exporters: [otlphttp/openobserve_dbm]`;
};

export const PG_DBM_CONFIG_YAML = dbmConfig("postgres");
export const MYSQL_DBM_CONFIG_YAML = dbmConfig("mysql");
export const MARIADB_DBM_CONFIG_YAML = dbmConfig("mariadb");
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
 * SQL Server needs BOTH grants, for two different reads.
 *
 * `VIEW SERVER STATE` covers the blocking join — other sessions in
 * `sys.dm_exec_requests` / `sys.dm_exec_sessions`. On its own it is NOT enough
 * for deadlocks: `sys.fn_xe_file_target_read_file` reads the `system_health`
 * Extended Events target and fails with "VIEW SERVER PERFORMANCE STATE
 * permission was denied on object 'server'" (msg 300). Measured on SQL Server
 * 2022 against the rig — with only VIEW SERVER STATE the Deadlocks tab stays
 * empty forever while blocking works, which reads as "deadlocks never happen"
 * rather than as a permissions problem.
 *
 * The metrics step's login has VIEW SERVER PERFORMANCE STATE but not VIEW SERVER
 * STATE, so neither grant subsumes the other and both belong here.
 */
export const MSSQL_DBM_GRANT_SQL = `GRANT VIEW SERVER STATE TO otel;
GRANT VIEW SERVER PERFORMANCE STATE TO otel;`;

/**
 * Postgres server settings the deadlock recipe DEPENDS ON. Unlike the grant
 * above, these are not an enhancement — without them the Deadlocks tab can
 * never fill, and it fails silently:
 *
 *  - `log_line_prefix` IS A CONTRACT with PG_DEADLOG_RECEIVER's `regex_parser`
 *    above, which expects `ts [pid] user@db SEVERITY:`. This is NOT the Postgres
 *    default, so a stock server parses to nothing on EVERY line. `%q` is
 *    load-bearing: without it, non-session backends (checkpointer, autovacuum)
 *    emit a prefix missing the session fields and fail the regex. Change one
 *    without the other and the pipeline goes quiet.
 *  - `logging_collector = on` is what produces a file to tail at all. Off (the
 *    default on many distros) means `filelog` matches nothing, reports healthy,
 *    and ingests zero rows — the worst failure shape we have.
 *  - `deadlock_timeout` gates when Postgres writes a deadlock DETAIL block. The
 *    1s default detects late under load, so short-lived cycles resolve and are
 *    never logged.
 *  - `log_lock_waits` is the one genuinely optional line: it adds long waits
 *    that never became deadlocks. Kept because the Blocked-queries empty state
 *    already explains it to users who arrive with no data.
 *
 * Transcribed from the verified rig run in tests/dbm-server-vantage; the full
 * failure-mode table is in docs/___databsepages/pipeline-recipes/postgres-deadlocks.md.
 */
export const PG_DBM_LOGGING_CONF = `# Must match the collector's log parser — %q keeps background workers parseable.
log_line_prefix = '%m [%p] %q%u@%d app=%a vxid=%v txid=%x line=%l '
# Write logs to a file the collector can tail.
logging_collector = on
log_destination = 'stderr'
# Detect deadlocks promptly; the default 1s misses short-lived cycles.
deadlock_timeout = 500ms
# Optional: also record long lock waits that never deadlock.
log_lock_waits = on`;

/**
 * Both settings above need a RESTART, not a reload — `log_line_prefix` and
 * `logging_collector` are not reloadable. Users who only `SELECT
 * pg_reload_conf()` see no change and conclude the recipe is broken, so the
 * check is offered as a copyable step of its own.
 */
export const PG_DBM_LOGGING_VERIFY_SQL = `SHOW log_line_prefix;   -- must match the line you set
SHOW logging_collector; -- must be on
SHOW deadlock_timeout;  -- 500ms`;

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

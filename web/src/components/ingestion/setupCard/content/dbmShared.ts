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
// tests/dbm-server-vantage (originally collector-contrib 0.135.0, re-verified at
// 0.158.0; Postgres 16, MySQL 8.4, MariaDB 11.8, SQL Server 2022), which
// recorded real deadlocks on both engines with every participant's SQL.
// Findings: docs/___databsepages/dbm-server-vantage-proof.md.

import { raw } from "@/types/i18n";

import type { RichCardStep } from "../types";

/**
 * The collector these steps are verified against: UPSTREAM
 * opentelemetry-collector-contrib. Three version facts the cards depend on:
 *
 *  - v0.158.0 is what the capture rig verified every recipe and receiver
 *    config against — it is the version the install steps pin.
 *  - v0.148.0 is the floor for the receiver-native activity/top-query events:
 *    that release flipped `db.server.query_sample` / `db.server.top_query`
 *    to DEFAULT-OFF, and introduced the top-level `events:` block that
 *    re-enables them. Older collectors reject the block as an unknown key.
 *  - The OpenObserve collector distro CANNOT run these configs: it is pinned
 *    at contrib v0.83.0 with zero database receivers. Users must run upstream
 *    contrib for Database Monitoring.
 */
export const DBM_CONTRIB_VERSION = "0.158.0";

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
 * field. The group is optional in the PATTERN only because background-worker
 * lines carry no session fields; every session line — including the deadlock
 * banner itself — carries them and fails to parse without the group, which
 * leaves a collector that looks healthy and a Deadlocks tab that never fills.
 * Change one side and you must change the other; Postgres.spec.ts runs a real
 * log line through this exact pattern to keep them honest.
 *
 * The `qid=` group is OPTIONAL by design: it only appears when the user takes
 * the auto_explain step (PG_DBM_AUTO_EXPLAIN_CONF adds `qid=%Q` to
 * log_line_prefix), and configs written before that step exists must keep
 * parsing. When present it carries the Postgres queryid — the exact join key
 * to top_query rows that survives every text-normalization concern.
 */
const PG_DEADLOG_RECEIVER = `  filelog/pg_deadlocks:
    include: [{logpath}]
    start_at: end
    multiline:
      line_start_pattern: '^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}\\.\\d{3} \\w+ \\['
    operators:
      - type: regex_parser
        regex: '^(?P<ts>\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}\\.\\d{3} \\w+) \\[(?P<pg_pid>\\d+)\\] (?:(?P<pg_user>[^@ ]+)@(?P<pg_db>\\S+) app=(?P<pg_app>\\S*) vxid=(?P<pg_vxid>\\S*) txid=(?P<pg_txid>\\S*) line=(?P<pg_line>\\d+) (?:qid=(?P<pg_query_id>-?\\d+) )?)?(?P<pg_severity>[A-Z][A-Z0-9]*):\\s+(?P<pg_message>(?s).*)$'
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
          # auto_explain entries (optional PG_DBM_AUTO_EXPLAIN_CONF step). The
          # first line is exactly "duration: N.NNN ms  plan:" with the JSON
          # document on the following (multiline-joined) lines — verified
          # against real postgres:16 output in tests/dbm-server-vantage. MUST
          # route before the default: an unrouted entry keeps o2_pg_event =
          # "other" and filter/dbm silently drops it while the collector
          # reports healthy.
          - expr: 'attributes.pg_message matches "^duration: [\\\\d.]+ ms\\\\s+plan:"'
            output: mark_explain
          # Completed-statement durations (log_min_duration_statement) — one
          # line per finished statement with its exact in-engine duration,
          # which is what the Slowest-calls fallback reads. MUST stay AFTER
          # the explain route: an auto_explain entry begins "duration:" too,
          # and this route would otherwise steal every plan.
          - expr: 'attributes.pg_message matches "^duration:"'
            output: mark_duration
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
      # ---- AUTO_EXPLAIN (real executed plan) ----------------------------
      # The tag value MUST NOT be "other": filter/dbm drops on that value.
      - type: add
        id: mark_explain
        field: attributes.o2_pg_event
        value: explain
      # Header: the executed wall-clock duration, ahead of the plan document.
      - type: regex_parser
        if: 'attributes.pg_message != nil and attributes.pg_message matches "^duration: [\\\\d.]+ ms\\\\s+plan:"'
        parse_from: attributes.pg_message
        regex: '^duration: (?P<ae_duration_ms>[\\d.]+) ms\\s+plan:'
        on_error: send
      # Body: the whole JSON document, captured as ONE STRING attribute. Never
      # expand it into a nested object with a JSON-parsing operator: a nested
      # value in a canonicalized record rejects the ENTIRE ingest batch
      # (server_vantage.rs O2_DBM_PLAN). The guard skips entries
      # whose JSON was truncated below the opening brace, so they fail
      # silently and locally.
      - type: regex_parser
        if: 'attributes.pg_message != nil and attributes.pg_message matches "plan:\\\\s*\\\\{"'
        parse_from: attributes.pg_message
        regex: '(?s)plan:\\s*(?P<ae_plan_json>\\{.*\\})\\s*$'
        on_error: send
      - type: move
        from: attributes.pg_message
        to: attributes.o2_explain_raw
        output: emit
      # ---- STATEMENT DURATION (log_min_duration_statement) ---------------
      # The tag value MUST NOT stay "other": filter/dbm drops on that value,
      # and the backend canonicalizer dispatches on statement_duration. The
      # parser captures the phase word too (statement/execute/parse/bind) —
      # the backend keeps only completed EXECUTIONS, so the extended
      # protocol's parse/bind phase lines cannot triple-count a call.
      - type: add
        id: mark_duration
        field: attributes.o2_pg_event
        value: statement_duration
      - type: regex_parser
        parse_from: attributes.pg_message
        regex: '(?s)^duration: (?P<stmt_duration_ms>[\\d.]+) ms\\s+(?P<stmt_kind>statement|execute [^:]*|parse [^:]*|bind [^:]*):\\s+(?P<stmt_text>.*)$'
        on_error: send
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
          # Anchored on the markers InnoDB actually writes, NOT on the word
          # "deadlock". A bare substring catches notes that merely mention it:
          # a plugin warning saying "deadlock avoidance is deprecated" was
          # stamped as a deadlock, passed the filter, and landed in the stream
          # carrying no transaction, no query and no victim, so the backend
          # could not read it back. MariaDB's receiver anchors the same way;
          # this is that precedent applied.
          - expr: 'attributes.my_message != nil and attributes.my_message matches "TRANSACTION|Transactions deadlock detected|WE ROLL BACK TRANSACTION"'
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
 * The query body is NOT a copy of MySQL's, and cannot be.
 * `performance_schema.data_lock_waits` is a MySQL 8.0 table
 * that **MariaDB never adopted** — MariaDB kept the pre-8.0
 * `information_schema.INNODB_LOCK_WAITS`. Verified against MariaDB 11.8.8 at
 * collector v0.158.0: the MySQL query fails every single collection cycle with
 *
 *     Error 1146 (42S02): Table 'performance_schema.data_lock_waits' doesn't exist
 *
 * which is silent to the user — the pipeline stays green and the Blocked
 * queries tab is simply always empty. The column contract below is deliberately
 * identical to the MySQL recipe's, so `canonicalize_blocking` needs no MariaDB
 * branch; only the FROM/JOIN and the id column names differ.
 *
 * What must NOT be copied either is `'mysql_lock_waits'`:
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
          SELECT CAST(w.requesting_trx_id AS CHAR)                AS waiting_trx,
                 CAST(w.blocking_trx_id AS CHAR)                  AS blocking_trx,
                 COALESCE(rt.trx_mysql_thread_id, 0)              AS waiting_thread,
                 COALESCE(bt.trx_mysql_thread_id, 0)              AS blocking_thread,
                 COALESCE(LEFT(rt.trx_query,500), '')             AS waiting_query,
                 COALESCE(LEFT(bt.trx_query,500), '')             AS blocking_query,
                 COALESCE(rt.trx_state,'')                        AS waiting_state,
                 COALESCE(bt.trx_state,'')                        AS blocking_state,
                 CAST(COALESCE(TIMESTAMPDIFF(SECOND, rt.trx_wait_started, NOW()),0) AS CHAR) AS wait_secs,
                 '{host}'                                         AS server_address,
                 'mariadb_lock_waits'                             AS o2_recipe
          FROM information_schema.INNODB_LOCK_WAITS w
          LEFT JOIN information_schema.INNODB_TRX rt
                 ON rt.trx_id = w.requesting_trx_id
          LEFT JOIN information_schema.INNODB_TRX bt
                 ON bt.trx_id = w.blocking_trx_id
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
 * Postgres table health — size, bloat inputs and vacuum state per relation.
 *
 * Transcribed from the verified capture rig's `server.yaml`; the column
 * names below ARE the ingest contract, since `canonicalize_table_stats` reads
 * them verbatim.
 *
 * TWO PROPERTIES THE READ SURFACE DEPENDS ON, both deliberate here:
 *
 *  • `table_name` is the `body_column`, not an attribute. The backend reads the
 *    relation out of `body` for exactly that reason. Promoting it to an
 *    attribute would silently empty the Table health tab.
 *
 *  • The counters this SELECTs from `pg_stat_user_tables` — `seq_scan`,
 *    `idx_scan`, `autovacuum_count` — are CUMULATIVE SINCE THE LAST
 *    `pg_stat_reset()`, and `n_live_tup`/`n_dead_tup` are planner estimates
 *    rather than exact counts. The API states both on its response envelope so
 *    the page cannot label a lifetime total as a per-window one.
 *
 * A 60s interval, not the 10s the lock recipes use: this is a slow-moving
 * snapshot of schema state, and one row PER TABLE per tick is the volume
 * driver. On a 500-table database 10s would write 50 rows/sec to no benefit.
 */
const PG_TABLE_STATS_RECEIVER = `  sqlquery/pg_table_stats:
    driver: postgres
    datasource: "host={host} port={port} user=\${env:PGUSER} password=\${env:PGPASS} dbname={database} sslmode=disable"
    collection_interval: 60s
    queries:
      - sql: |
          SELECT n.nspname                                    AS schema_name,
                 c.relname                                    AS table_name,
                 pg_total_relation_size(c.oid)::text          AS total_bytes,
                 pg_relation_size(c.oid)::text                AS heap_bytes,
                 coalesce(s.seq_scan,0)::text                 AS seq_scan,
                 coalesce(s.seq_tup_read,0)::text             AS seq_tup_read,
                 coalesce(s.idx_scan,0)::text                 AS idx_scan,
                 coalesce(s.n_live_tup,0)::text               AS n_live_tup,
                 coalesce(s.n_dead_tup,0)::text               AS n_dead_tup,
                 coalesce(s.n_mod_since_analyze,0)::text      AS n_mod_since_analyze,
                 coalesce(s.last_vacuum::text,'')             AS last_vacuum,
                 coalesce(s.last_autovacuum::text,'')         AS last_autovacuum,
                 coalesce(s.last_analyze::text,'')            AS last_analyze,
                 coalesce(s.autovacuum_count,0)::text         AS autovacuum_count,
                 age(c.relfrozenxid)::text                    AS frozen_xid_age,
                 CASE WHEN coalesce(s.n_live_tup,0) > 0
                      THEN round(100.0*s.n_dead_tup/(s.n_live_tup+s.n_dead_tup),2)::text
                      ELSE '0' END                            AS dead_tup_pct,
                 '{host}'                                     AS server_address,
                 'pg_table_stats'                             AS o2_recipe
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
          WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog','information_schema')
        logs:
          - body_column: table_name
            attribute_columns:
              [schema_name, total_bytes, heap_bytes, seq_scan, seq_tup_read,
               idx_scan, n_live_tup, n_dead_tup, n_mod_since_analyze,
               last_vacuum, last_autovacuum, last_analyze, autovacuum_count,
               frozen_xid_age, dead_tup_pct, server_address, o2_recipe]`;

/**
 * Index size and usage, one row per INDEX.
 *
 * The companion to `pg_table_stats` and the source of the never-scanned signal:
 * `pg_stat_user_indexes.idx_scan` is how many times the planner has chosen this
 * index, so a zero on an index that has existed for a while is an index nothing
 * reads.
 *
 * Two properties the read surface depends on:
 *
 *  • `idx_scan` is CUMULATIVE since the last `pg_stat_reset()`, exactly as the
 *    table counters are. It is therefore "never scanned since the counters were
 *    reset", never "not scanned in the last hour", and the canonicalizer marks
 *    every row so the UI cannot phrase it the stronger way.
 *  • `index_bytes` is EXACT (`pg_relation_size`), unlike the tuple estimates on
 *    the table feed. It is what separates an unused 8 KB index from an unused
 *    2.8 MB one.
 *
 * `index_name` is an attribute rather than the `body_column` the table recipe
 * uses, because `body` here carries the index DEFINITION — useful context, and
 * the thing a reader needs to judge whether a duplicate index is redundant.
 *
 * 60s, matching the table recipe: schema state moves slowly and one row per
 * index per tick is the volume driver.
 */
const PG_INDEX_STATS_RECEIVER = `  sqlquery/pg_index_stats:
    driver: postgres
    datasource: "host={host} port={port} user=\${env:PGUSER} password=\${env:PGPASS} dbname={database} sslmode=disable"
    collection_interval: 60s
    queries:
      - sql: |
          SELECT s.schemaname                                  AS schema_name,
                 s.relname                                     AS table_name,
                 s.indexrelname                                AS index_name,
                 coalesce(s.idx_scan,0)::text                  AS idx_scan,
                 coalesce(s.idx_tup_read,0)::text              AS idx_tup_read,
                 coalesce(s.idx_tup_fetch,0)::text             AS idx_tup_fetch,
                 pg_relation_size(s.indexrelid)::text          AS index_bytes,
                 (i.indisunique OR i.indisprimary)::text       AS is_unique,
                 coalesce(pg_get_indexdef(s.indexrelid),'')    AS index_def,
                 '{host}'                                      AS server_address,
                 'pg_index_stats'                              AS o2_recipe
          FROM pg_stat_user_indexes s
          JOIN pg_index i ON i.indexrelid = s.indexrelid
          WHERE s.schemaname NOT IN ('pg_catalog','information_schema')
        logs:
          - body_column: index_def
            attribute_columns:
              [schema_name, table_name, index_name, idx_scan, idx_tup_read,
               idx_tup_fetch, index_bytes, is_unique, server_address, o2_recipe]`;

/**
 * MySQL table health — the twin of PG_TABLE_STATS_RECEIVER, same column
 * CONTRACT, different catalogs.
 *
 * The aliases below are deliberately IDENTICAL to the Postgres recipe's (the
 * `mariadb_lock_waits` precedent): `canonicalize_table_stats` reads one set of
 * names and the `o2_recipe` tag names the engine, so no engine-conditional
 * parser branch exists to drift.
 *
 * WHAT MYSQL CANNOT SAY IS OMITTED, NOT ZEROED. There is no dead-tuple state,
 * no vacuum timestamps and no xid age here because InnoDB has no equivalent —
 * selecting a `'0' AS dead_tup_pct` would render "0% bloat" about a
 * measurement that never happened. The canonicalizer stores absent columns as
 * absent, which is the honest reading.
 *
 * `n_live_tup` comes from `mysql.innodb_table_stats.n_rows` (falling back to
 * `information_schema.TABLES.TABLE_ROWS`) — BOTH are estimates, exactly as
 * Postgres's `n_live_tup` is, and the canonicalizer's estimated-tuples flag
 * already discloses that on every row. `last_update` on the stats row is when
 * the persistent statistics were recalculated, which is the closest MySQL
 * analog of `last_analyze`.
 *
 * Verified against the MySQL 8.4 rig 2026-08-13 —
 * tests/dbm-server-vantage/captures/mysql-table-stats.jsonl; the column
 * contract is pinned by the spec tests either way.
 */
const MYSQL_TABLE_STATS_RECEIVER = `  sqlquery/mysql_table_stats:
    driver: mysql
    datasource: "\${env:MYSQL_USER}:\${env:MYSQL_PASSWORD}@tcp({host}:{port})/{database}"
    collection_interval: 60s
    queries:
      - sql: |
          SELECT t.TABLE_SCHEMA                                        AS schema_name,
                 t.TABLE_NAME                                          AS table_name,
                 CAST(COALESCE(t.DATA_LENGTH,0) + COALESCE(t.INDEX_LENGTH,0) AS CHAR) AS total_bytes,
                 CAST(COALESCE(t.DATA_LENGTH,0) AS CHAR)               AS heap_bytes,
                 CAST(COALESCE(s.n_rows, t.TABLE_ROWS, 0) AS CHAR)     AS n_live_tup,
                 COALESCE(CAST(s.last_update AS CHAR), '')             AS last_analyze,
                 '{host}'                                              AS server_address,
                 'mysql_table_stats'                                   AS o2_recipe
          FROM information_schema.TABLES t
          LEFT JOIN mysql.innodb_table_stats s
                 ON s.database_name = t.TABLE_SCHEMA AND s.table_name = t.TABLE_NAME
          WHERE t.TABLE_TYPE = 'BASE TABLE'
            AND t.TABLE_SCHEMA NOT IN ('mysql','information_schema','performance_schema','sys')
        logs:
          - body_column: table_name
            attribute_columns:
              [schema_name, total_bytes, heap_bytes, n_live_tup, last_analyze,
               server_address, o2_recipe]`;

/**
 * MySQL index health — the twin of PG_INDEX_STATS_RECEIVER.
 *
 * `information_schema.STATISTICS` is one row per COLUMN of an index, so the
 * GROUP BY folds each index back to one row and GROUP_CONCAT rebuilds a
 * readable definition for `body` (MySQL has no `pg_get_indexdef`). The
 * identity stays in `index_name` and `body` carries the DDL-ish string,
 * exactly the split the PG recipe established — reading `body` as the
 * identity would file every index under its definition.
 *
 *  • `idx_scan` ← `performance_schema.table_io_waits_summary_by_index_usage.
 *    COUNT_READ`: cumulative reads through the index since the server started,
 *    the closest MySQL analog of `pg_stat_user_indexes.idx_scan`. ON by
 *    default on MySQL 8 — which is exactly what MariaDB does NOT have, and why
 *    its twin below omits the column entirely.
 *  • `index_bytes` ← `mysql.innodb_index_stats` `stat_name='size'` (pages) ×
 *    `@@innodb_page_size`. An ESTIMATE from persistent stats, unlike
 *    Postgres's exact `pg_relation_size`.
 *  • `is_unique` ← `MIN(NON_UNIQUE) = 0`, rendered 'true'/'false' to match the
 *    string parse the canonicalizer already does for Postgres's `::text`
 *    booleans.
 *  • FUNCTIONAL INDEXES (MySQL 8.0.13+): an expression key part has a NULL
 *    `COLUMN_NAME`, which nulls GROUP_CONCAT and then CONCAT — the whole
 *    `index_def` (the body_column!) comes back NULL. Found live on the 8.4
 *    rig with `INDEX ((LOWER(col)))`. The `COALESCE(COLUMN_NAME,
 *    CONCAT('(', EXPRESSION, ')'))` below renders the expression instead.
 *    MySQL-ONLY: MariaDB's STATISTICS has no EXPRESSION column (verified,
 *    Error 1054) and no functional-index syntax, so its twin must NOT copy
 *    this.
 *
 * Verified against the MySQL 8.4 rig 2026-08-13 —
 * tests/dbm-server-vantage/captures/mysql-index-stats.jsonl.
 */
const MYSQL_INDEX_STATS_RECEIVER = `  sqlquery/mysql_index_stats:
    driver: mysql
    datasource: "\${env:MYSQL_USER}:\${env:MYSQL_PASSWORD}@tcp({host}:{port})/{database}"
    collection_interval: 60s
    queries:
      - sql: |
          SELECT st.TABLE_SCHEMA                                       AS schema_name,
                 st.TABLE_NAME                                         AS table_name,
                 st.INDEX_NAME                                         AS index_name,
                 CAST(COALESCE(io.COUNT_READ, 0) AS CHAR)              AS idx_scan,
                 CAST(COALESCE(sz.stat_value, 0) * @@innodb_page_size AS CHAR) AS index_bytes,
                 CASE WHEN MIN(st.NON_UNIQUE) = 0 THEN 'true' ELSE 'false' END AS is_unique,
                 CONCAT('INDEX ', st.INDEX_NAME, ' ON ', st.TABLE_SCHEMA, '.', st.TABLE_NAME,
                        ' (', GROUP_CONCAT(COALESCE(st.COLUMN_NAME, CONCAT('(', st.EXPRESSION, ')'))
                                           ORDER BY st.SEQ_IN_INDEX SEPARATOR ', '), ')') AS index_def,
                 '{host}'                                              AS server_address,
                 'mysql_index_stats'                                   AS o2_recipe
          FROM information_schema.STATISTICS st
          LEFT JOIN performance_schema.table_io_waits_summary_by_index_usage io
                 ON io.OBJECT_SCHEMA = st.TABLE_SCHEMA AND io.OBJECT_NAME = st.TABLE_NAME
                AND io.INDEX_NAME = st.INDEX_NAME
          LEFT JOIN mysql.innodb_index_stats sz
                 ON sz.database_name = st.TABLE_SCHEMA AND sz.table_name = st.TABLE_NAME
                AND sz.index_name = st.INDEX_NAME AND sz.stat_name = 'size'
          WHERE st.TABLE_SCHEMA NOT IN ('mysql','information_schema','performance_schema','sys')
          GROUP BY st.TABLE_SCHEMA, st.TABLE_NAME, st.INDEX_NAME, io.COUNT_READ, sz.stat_value
        logs:
          - body_column: index_def
            attribute_columns:
              [schema_name, table_name, index_name, idx_scan, index_bytes,
               is_unique, server_address, o2_recipe]`;

/**
 * MariaDB table health — a near-copy of the MySQL recipe with its OWN tag,
 * for the same reason every MariaDB receiver has one: `detect_engine` reads
 * the engine off the tag, and `mysql_table_stats` would file every MariaDB
 * table under MySQL on the fleet view and the `?system=` filter.
 *
 * The catalogs themselves ARE shared — MariaDB kept `information_schema.
 * TABLES` and the `mysql.innodb_table_stats` persistent-stats table — so
 * unlike the blocking recipes there is no FROM-clause divergence to carry.
 * Verified against the MariaDB 11.8 rig 2026-08-13 —
 * tests/dbm-server-vantage/captures/mariadb-table-stats.jsonl.
 */
const MARIADB_TABLE_STATS_RECEIVER = `  sqlquery/mariadb_table_stats:
    driver: mysql
    datasource: "\${env:MYSQL_USER}:\${env:MYSQL_PASSWORD}@tcp({host}:{port})/{database}"
    collection_interval: 60s
    queries:
      - sql: |
          SELECT t.TABLE_SCHEMA                                        AS schema_name,
                 t.TABLE_NAME                                          AS table_name,
                 CAST(COALESCE(t.DATA_LENGTH,0) + COALESCE(t.INDEX_LENGTH,0) AS CHAR) AS total_bytes,
                 CAST(COALESCE(t.DATA_LENGTH,0) AS CHAR)               AS heap_bytes,
                 CAST(COALESCE(s.n_rows, t.TABLE_ROWS, 0) AS CHAR)     AS n_live_tup,
                 COALESCE(CAST(s.last_update AS CHAR), '')             AS last_analyze,
                 '{host}'                                              AS server_address,
                 'mariadb_table_stats'                                 AS o2_recipe
          FROM information_schema.TABLES t
          LEFT JOIN mysql.innodb_table_stats s
                 ON s.database_name = t.TABLE_SCHEMA AND s.table_name = t.TABLE_NAME
          WHERE t.TABLE_TYPE = 'BASE TABLE'
            AND t.TABLE_SCHEMA NOT IN ('mysql','information_schema','performance_schema','sys')
        logs:
          - body_column: table_name
            attribute_columns:
              [schema_name, total_bytes, heap_bytes, n_live_tup, last_analyze,
               server_address, o2_recipe]`;

/**
 * MariaDB index health. Its OWN tag, and — the load-bearing difference from
 * the MySQL twin — NO `idx_scan` AT ALL.
 *
 * MariaDB ships with `performance_schema = OFF` by default, so
 * `table_io_waits_summary_by_index_usage` is empty (or the schema is absent)
 * on the ordinary server. A LEFT JOIN COALESCEd to 0 would therefore render
 * `idx_scan = 0` — the never-scanned FINDING — for every index on every
 * MariaDB instance, fabricated from a table that was never populated. The
 * join and the column are omitted ENTIRELY: absent is "honestly unknown", the
 * same discipline the canonicalizer applies to Postgres's missing vacuum
 * timestamps. Size and definition still make the rows worth collecting, and
 * the card note states the limitation.
 *
 * NO functional-index COALESCE here either (the MySQL twin's EXPRESSION
 * fallback): MariaDB's STATISTICS has no EXPRESSION column (Error 1054,
 * verified live) and no functional-index syntax to need it.
 * Verified against the MariaDB 11.8 rig 2026-08-13 —
 * tests/dbm-server-vantage/captures/mariadb-index-stats.jsonl.
 */
const MARIADB_INDEX_STATS_RECEIVER = `  sqlquery/mariadb_index_stats:
    driver: mysql
    datasource: "\${env:MYSQL_USER}:\${env:MYSQL_PASSWORD}@tcp({host}:{port})/{database}"
    collection_interval: 60s
    queries:
      - sql: |
          SELECT st.TABLE_SCHEMA                                       AS schema_name,
                 st.TABLE_NAME                                         AS table_name,
                 st.INDEX_NAME                                         AS index_name,
                 CAST(COALESCE(sz.stat_value, 0) * @@innodb_page_size AS CHAR) AS index_bytes,
                 CASE WHEN MIN(st.NON_UNIQUE) = 0 THEN 'true' ELSE 'false' END AS is_unique,
                 CONCAT('INDEX ', st.INDEX_NAME, ' ON ', st.TABLE_SCHEMA, '.', st.TABLE_NAME,
                        ' (', GROUP_CONCAT(st.COLUMN_NAME ORDER BY st.SEQ_IN_INDEX SEPARATOR ', '), ')') AS index_def,
                 '{host}'                                              AS server_address,
                 'mariadb_index_stats'                                 AS o2_recipe
          FROM information_schema.STATISTICS st
          LEFT JOIN mysql.innodb_index_stats sz
                 ON sz.database_name = st.TABLE_SCHEMA AND sz.table_name = st.TABLE_NAME
                AND sz.index_name = st.INDEX_NAME AND sz.stat_name = 'size'
          WHERE st.TABLE_SCHEMA NOT IN ('mysql','information_schema','performance_schema','sys')
          GROUP BY st.TABLE_SCHEMA, st.TABLE_NAME, st.INDEX_NAME, sz.stat_value
        logs:
          - body_column: index_def
            attribute_columns:
              [schema_name, table_name, index_name, index_bytes,
               is_unique, server_address, o2_recipe]`;

/**
 * Postgres activity samples + server top queries (with estimated plans), from
 * the stock `postgresqlreceiver`'s log events.
 *
 * THE `events:` BLOCK IS THE WHOLE TRAP. Upstream v0.148.0 flipped
 * `db.server.query_sample` and `db.server.top_query` from default-ON to
 * default-OFF. Without the block the receiver starts cleanly, reports healthy,
 * and emits ZERO events — no warning anywhere; with an older collector the
 * block is rejected as an unknown key, which is at least a loud failure.
 * `events:` is a TOP-LEVEL receiver key, a SIBLING of the collection blocks —
 * nesting an `enabled` inside query_sample_collection / top_query_collection
 * is a fatal config error. Subkeys verified against v0.158.0 via `validate`
 * (see tests/dbm-server-vantage/collector/config.yaml).
 *
 * A SEPARATE receiver instance (`postgresql/dbm_events`) rather than reusing
 * the metrics card's `postgresql:`: the two config files are merged by the two
 * `--config` flags, and a same-named receiver would collide.
 */
const PG_EVENTS_RECEIVER = `  postgresql/dbm_events:
    endpoint: {host}:{port}
    transport: tcp
    username: \${env:PGUSER}
    password: \${env:PGPASS}
    databases: [{database}]
    tls:
      insecure: true
    collection_interval: 10s
    query_sample_collection:
      max_rows_per_query: 1000
    top_query_collection:
      top_n_query: 200
      max_explain_each_interval: 200
      query_plan_cache_size: 1000
      collection_interval: 15s
    # REQUIRED since collector v0.148.0 — both events are OFF by default, and
    # without this block the collector looks healthy while sending nothing.
    # events: must stay a TOP-LEVEL key on the receiver (a sibling of the
    # collection settings above), never nested inside them.
    events:
      db.server.query_sample: { enabled: true }
      db.server.top_query: { enabled: true }`;

/**
 * MySQL activity samples + server top queries, from the stock `mysqlreceiver`'s
 * log events. Same v0.148.0 `events:` trap as Postgres — see PG_EVENTS_RECEIVER.
 *
 * SPELLING ASYMMETRY, verified at v0.158.0: mysql says `top_query_count` where
 * postgres says `top_n_query`, and mysql REJECTS `max_rows_per_query` /
 * `max_explain_each_interval` inside top_query_collection. Estimated plans
 * (`mysql.query_plan`) need MySQL >= 8.0.22.
 */
const MYSQL_EVENTS_RECEIVER = `  mysql/dbm_events:
    endpoint: "{host}:{port}"
    username: \${env:MYSQL_USER}
    password: \${env:MYSQL_PASSWORD}
    database: {database}
    collection_interval: 10s
    query_sample_collection:
      max_rows_per_query: 1000
    top_query_collection:
      top_query_count: 200
      collection_interval: 15s
      lookback_time: 120
      query_plan_cache_size: 1000
    # REQUIRED since collector v0.148.0 — both events are OFF by default, and
    # without this block the collector looks healthy while sending nothing.
    # events: must stay a TOP-LEVEL key on the receiver (a sibling of the
    # collection settings above), never nested inside them.
    events:
      db.server.query_sample: { enabled: true }
      db.server.top_query: { enabled: true }`;

/**
 * Assemble the full DBM config for an engine.
 *
 * A SECOND config file rather than extra receivers bolted onto the metrics one:
 * the two have different lifecycles (metrics is the common case, DBM is opt-in),
 * and the logs pipeline needs its own `logs_endpoint` + `stream-name` header. A
 * user running both simply passes two `--config` flags, which the run step shows.
 */
interface DbmRecipeSet {
  receivers: string[];
  names: string;
  /**
   * Receiver-native `db.server.query_sample` / `db.server.top_query` events —
   * Postgres and MySQL ONLY. Absent for MariaDB because no OTel receiver
   * exists for MariaDB at all (an upstream data-capture limit no O2 work can
   * close), and for SQL Server because the upstream `sqlserverreceiver` is not
   * adopted by OpenObserve yet. The per-card copy states both.
   */
  events?: { receiver: string; name: string };
}

const RECIPES: Record<"postgres" | "mysql" | "mariadb" | "mssql", DbmRecipeSet> = {
  // Table/index health ships for Postgres, MySQL AND MariaDB: the catalogs
  // differ per engine (pg_stat_user_tables vs information_schema.TABLES +
  // mysql.innodb_*_stats) but every recipe emits the SAME column aliases under
  // its own engine tag, so one backend canonicalizer reads all of them. SQL
  // Server still has no table-stats recipe, and its Table health tab says so
  // rather than rendering an empty list that reads as "no problems found"
  // about a check that never ran.
  postgres: {
    receivers: [
      PG_BLOCKING_RECEIVER,
      PG_DEADLOG_RECEIVER,
      PG_TABLE_STATS_RECEIVER,
      PG_INDEX_STATS_RECEIVER,
    ],
    names:
      "sqlquery/pg_blocking, filelog/pg_deadlocks, sqlquery/pg_table_stats, sqlquery/pg_index_stats",
    events: { receiver: PG_EVENTS_RECEIVER, name: "postgresql/dbm_events" },
  },
  mysql: {
    receivers: [
      MYSQL_BLOCKING_RECEIVER,
      MYSQL_DEADLOG_RECEIVER,
      MYSQL_TABLE_STATS_RECEIVER,
      MYSQL_INDEX_STATS_RECEIVER,
    ],
    names:
      "sqlquery/mysql_locks, filelog/mysql_deadlocks, sqlquery/mysql_table_stats, sqlquery/mysql_index_stats",
    events: { receiver: MYSQL_EVENTS_RECEIVER, name: "mysql/dbm_events" },
  },
  // EVERY receiver is MariaDB-specific, even where the SQL is a copy of
  // MySQL's: the recipe TAG is what tells detect_engine which server a row
  // came from, so sharing MySQL's receiver would file MariaDB rows under MySQL.
  mariadb: {
    receivers: [
      MARIADB_BLOCKING_RECEIVER,
      MARIADB_DEADLOG_RECEIVER,
      MARIADB_TABLE_STATS_RECEIVER,
      MARIADB_INDEX_STATS_RECEIVER,
    ],
    names:
      "sqlquery/mariadb_locks, filelog/mariadb_deadlocks, sqlquery/mariadb_table_stats, sqlquery/mariadb_index_stats",
  },
  mssql: {
    receivers: [MSSQL_BLOCKING_RECEIVER, MSSQL_DEADLOG_RECEIVER],
    names: "sqlquery/mssql_blocking, sqlquery/mssql_deadlocks",
  },
};

const dbmConfig = (engine: keyof typeof RECIPES) => {
  const { receivers, names, events } = RECIPES[engine];
  const allReceivers = events ? [...receivers, events.receiver] : receivers;

  // The events pipeline deliberately SKIPS filter/dbm: receiver-native events
  // carry no o2_recipe / o2_*_event tag (the backend recognizes them by their
  // OTLP event name), so routing them through the filter would silently drop
  // every one — the exact failure shape the events: block exists to prevent.
  const eventsPipeline = events
    ? `
    logs/dbm_events:
      receivers: [${events.name}]
      processors: [batch]
      exporters: [otlphttp/openobserve_dbm]`
    : "";

  return `receivers:
${allReceivers.join("\n")}

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
      exporters: [otlphttp/openobserve_dbm]${eventsPipeline}`;
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
 *
 * `pg_stat_statements` is what the receiver's server top-queries read. The
 * CREATE EXTENSION works even before the library is preloaded (it creates the
 * SQL objects); the counters only start filling once shared_preload_libraries
 * carries it and Postgres has RESTARTED — which is the logging step's job, and
 * why that step comes next.
 *
 * KNOWN LIMIT, stated on the card: pg_monitor does NOT include SELECT on user
 * tables, so on a locked-down instance the receiver's EXPLAIN-based estimated
 * plans silently come back empty while everything else works.
 */
export const PG_DBM_GRANT_SQL = `GRANT pg_monitor TO myuser;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;`;
/**
 * `SET PERSIST`, not `SET GLOBAL`.
 *
 * `SET GLOBAL` is lost on the next restart, so deadlock history would stop
 * being recorded at the next maintenance window with nothing on screen to say
 * so — monitoring that silently switches itself off is worse than monitoring
 * that was never enabled. `SET PERSIST` (MySQL 8.0+) writes to
 * mysqld-auto.cnf and survives. It needs SYSTEM_VARIABLES_ADMIN (or SUPER),
 * which is a higher privilege than the PROCESS the metrics step granted — run
 * this one as an admin.
 */
export const MYSQL_DBM_GRANT_SQL = `SET PERSIST innodb_print_all_deadlocks = ON;`;
/**
 * MariaDB has no `SET PERSIST` — it is a MySQL 8.0 feature that MariaDB never
 * adopted. So the runtime flag is set for the current server lifetime and the
 * durable half has to go in a config file, which is why this string carries the
 * my.cnf line as a comment rather than pretending one statement is enough.
 */
export const MARIADB_DBM_GRANT_SQL = `SET GLOBAL innodb_print_all_deadlocks = ON;
-- MariaDB has no SET PERSIST: add this to my.cnf ([mysqld] section) so the
-- setting survives a restart, otherwise deadlock history stops silently.
--   innodb_print_all_deadlocks = ON`;
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
# Detect deadlocks sooner. The default 1s does NOT miss deadlocks — a deadlock
# is a cycle and cannot resolve itself, so it is still there at 1s and still
# gets logged. Lowering this only shortens how long the victims wait before
# Postgres breaks the cycle.
# The trade: the detector runs on every lock wait that exceeds this timeout and
# walks the lock graph holding lock-manager partition locks, so on a workload
# with many legitimate 500ms-1s waits, halving the timeout roughly doubles how
# often that check fires. On a high-contention OLTP server, leave it at 1s.
deadlock_timeout = 500ms
# Optional: also record long lock waits that never deadlock. Note this shares
# the threshold above, so the two together log more than either alone.
log_lock_waits = on
# Report every statement slower than this, with its exact duration — the
# database's own account of its slowest calls, one line per completed
# statement. THIS THRESHOLD IS WHAT GOVERNS WHICH CALLS CAN APPEAR on the
# Slowest-calls page: 100ms captures the slow tail at negligible volume.
# 0 logs EVERYTHING — every COMMIT, every ping — which is a diagnosis
# setting, not a monitoring one: the log grows at your workload's own
# statement rate. -1 (the default) reports nothing.
log_min_duration_statement = 100ms
# Server top queries read pg_stat_statements, which must be PRELOADED — append
# it if this line already lists other libraries. Takes effect only on RESTART
# (not reloadable), same as the logging settings above.
shared_preload_libraries = 'pg_stat_statements'`;

/**
 * Both settings above need a RESTART, not a reload — `log_line_prefix` and
 * `logging_collector` are not reloadable. Users who only `SELECT
 * pg_reload_conf()` see no change and conclude the recipe is broken, so the
 * check is offered as a copyable step of its own.
 */
export const PG_DBM_LOGGING_VERIFY_SQL = `SHOW log_line_prefix;   -- must match the line you set
SHOW logging_collector; -- must be on
SHOW deadlock_timeout;  -- 500ms
SHOW log_min_duration_statement; -- 100ms (what governs the Slowest-calls page)
SHOW shared_preload_libraries; -- must include pg_stat_statements`;

/**
 * OPTIONAL — real executed plans via `auto_explain` (Postgres only).
 *
 * The receiver's top-query plans are generic NULL-bound ESTIMATES for a query
 * nobody executed. auto_explain captures the plan Postgres ACTUALLY ran, with
 * the real bound parameters, real row counts and a real per-execution
 * duration. It is squarely optional because it has a real cost, stated
 * honestly below rather than hidden in a footnote.
 *
 * THE COST, so a DBA can sign off on it: with `log_analyze = on` the executor
 * instruments every statement it CONSIDERS, not only the ones it logs —
 * `log_min_duration` is evaluated after the statement finishes, so it controls
 * what is WRITTEN, while `sample_rate` controls what PAYS. `log_timing` stays
 * OFF: per-node timing reads the clock twice per node per tuple and is the
 * single most expensive knob (run `pg_test_timing` before ever enabling it).
 * With analyze on and timing off you still get real row counts, real loops,
 * real buffer counts and the real total duration — most of the diagnostic
 * value at a fraction of the cost. On a busy production primary start at
 * `sample_rate = 0.01` and `log_min_duration = '2s'` and watch p99 for a full
 * business cycle before widening either. `log_analyze = off` is a legitimate
 * middle rung: zero executor overhead, still the real executed plan with real
 * parameters — just no timings or actual rows.
 *
 * `shared_preload_libraries` here REPLACES the logging step's line: it is a
 * comma list, and dropping `pg_stat_statements` from it silently kills the
 * entire top-query path. Same restart as the logging step — sequence both
 * before restarting once.
 *
 * `compute_query_id` + `qid=%Q` gives every log line the server's own queryid
 * — a SECOND, exact join key to top-query rows that survives the cases where
 * text normalization cannot join (driver `= ANY($1)` rewrites of IN-lists,
 * statements over 16 KB). The collector regex treats `qid=` as optional, so
 * configs without this step keep parsing.
 */
export const PG_DBM_AUTO_EXPLAIN_CONF = `# OPTIONAL: capture the plans Postgres ACTUALLY executed (auto_explain).
# REPLACES the shared_preload_libraries line from the logging step — this is a
# comma list; dropping pg_stat_statements from it kills server top queries.
shared_preload_libraries = 'pg_stat_statements,auto_explain'
# Log the executed plan of any statement slower than this. Volume control, NOT
# a cost control: instrumentation is armed before the statement runs.
auto_explain.log_min_duration = '1s'
# The parser reads JSON — other formats are silently unparseable.
auto_explain.log_format = json
# Real row counts and a real total duration. This is the knob with executor
# overhead: every statement CONSIDERED pays it, not only the ones logged.
# Set it off for plan capture with effectively zero overhead (you lose
# actual-rows and duration, the plan itself stays real).
auto_explain.log_analyze = on
# Per-NODE timings read the clock twice per node per tuple — leave OFF unless
# pg_test_timing shows tens of nanoseconds per loop.
auto_explain.log_timing = off
# Block counts are free once log_analyze is on; hit-vs-read is often the answer.
auto_explain.log_buffers = on
# One plan per statement inside function bodies — off unless you live in PL/pgSQL.
auto_explain.log_nested_statements = off
# THE actual cost control on a busy primary: 0.01 = 1% of statements pay for
# instrumentation. Start low in production, widen deliberately.
auto_explain.sample_rate = 1.0
# Exact plan-to-query join key: stamps the server's queryid on every log line.
compute_query_id = on
log_line_prefix = '%m [%p] %q%u@%d app=%a vxid=%v txid=%x line=%l qid=%Q '`;

/**
 * The closing "what you just unlocked" step.
 *
 * `pages` differs per engine because the tabs an engine can actually fill
 * differ — pointing a user at a tab their config can never populate is the
 * "collecting but empty" trap the lock empty-states exist to prevent:
 *  - "full"  — Postgres and MySQL, whose configs also enable the receiver's
 *    activity samples and server top queries (the Activity tab fills too).
 *  - "both"  — deadlocks + blocking only (MariaDB, SQL Server: no receiver
 *    events exist / are adopted for them, so no Activity).
 *  - "blocking" — blocking only.
 *
 * `tableHealth` adds the Table health pill for the engines whose config ships
 * the table/index-stats recipes (Postgres, MySQL, MariaDB). A separate flag
 * rather than a fourth `pages` value because it is orthogonal to the
 * activity/deadlock axis: MariaDB has table health but no Activity, and SQL
 * Server has neither.
 */
export function dbmVerifyStep(
  pages: "both" | "blocking" | "full" = "both",
  tableHealth = false,
): RichCardStep {
  const descriptionKey =
    pages === "blocking"
      ? "ingestion.setupCard.dbmVerifyBlockingDesc"
      : pages === "full"
        ? "ingestion.setupCard.dbmVerifyFullDesc"
        : "ingestion.setupCard.dbmVerifyDesc";
  // Untranslated: these are the page names in the product's own navigation,
  // so a translated pill would stop matching what the user is looking for.
  const pills =
    pages === "blocking"
      ? [raw("Blocked queries")]
      : pages === "full"
        ? [raw("Deadlocks"), raw("Blocked queries"), raw("Activity")]
        : [raw("Deadlocks"), raw("Blocked queries")];
  if (tableHealth) pills.push(raw("Table health"));
  return {
    id: "verify-dbm",
    titleKey: "ingestion.setupCard.dbmVerifyTitle",
    descriptionKey,
    chip: { kind: "traces", labelKey: "ingestion.setupCard.chipLogs" },
    completeOn: "copy",
    pills,
  };
}

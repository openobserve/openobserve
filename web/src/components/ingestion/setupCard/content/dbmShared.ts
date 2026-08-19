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
// THE FIELD NAMES BELOW ARE A CONTRACT, NOT A STYLE CHOICE. The ingest-side
// parser (src/core/src/traces/db_monitoring/server_vantage.rs) canonicalizes on
// exact keys — `o2_recipe`, `o2_pg_event`, `o2_my_event`, `dl_query_1`,
// `blocked_pid`, `blocking_query`, `my_trx_side`, … Renaming a SQL alias or a
// regex capture group here silently produces records the parser skips, which
// surfaces as "we are collecting but nothing appears". Keep them in lockstep.

import { raw } from "@/types/i18n";

import type { RichCardStep } from "../types";

/**
 * The UPSTREAM opentelemetry-collector-contrib version the install steps pin.
 *
 *  - v0.148.0 is the FLOOR: that release flipped `db.server.query_sample` /
 *    `db.server.top_query` to DEFAULT-OFF and introduced the top-level
 *    `events:` block that re-enables them. Older collectors reject the block
 *    as an unknown key.
 *  - The OpenObserve collector distro CANNOT run these configs: it is pinned
 *    at contrib v0.83.0 with zero database receivers.
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
 * All Postgres `sqlquery` datasources carry `sslmode=require`, and they are
 * separate template literals — change one and not the others and the shipped
 * config has some receivers encrypted and some not. Downgrade path for a
 * server built without TLS: `sslmode=disable` (Postgres refuses a `require`
 * connection to a non-TLS server loudly, so this fails visibly rather than
 * silently going clear text). Upgrade: `verify-ca` / `verify-full`, which also
 * need `sslrootcert=` on the COLLECTOR host.
 *
 * This is a SAMPLER, not an event log: it lists who is waiting right now, so a
 * lock that comes and goes between two ticks is invisible. That is inherent to
 * the source (Postgres emits no "blocked" event), and it is why the Blocked
 * queries tab states its sample interval rather than implying completeness.
 */
const PG_BLOCKING_RECEIVER = `  sqlquery/pg_blocking:
    driver: postgres
    datasource: "host={host} port={port} user=\${env:PGUSER} password=\${env:PGPASS} dbname={database} sslmode=require"
    collection_interval: 10s
    # max_open_conn is SINGULAR. The plural max_open_conns is not a key
    # sqlqueryreceiver knows, and an unknown key here is silently ignored
    # rather than rejected -- the misspelling reads like a bound and enforces
    # nothing. Unset means 0, which means UNLIMITED.
    max_open_conn: 2
    queries:
      - sql: |
          SELECT
            blocked.pid::text                                          AS blocked_pid,
            -- PER-SESSION datname, NOT current_database(). pg_stat_activity
            -- spans every database on the cluster while the scrape connects to
            -- one, so current_database() would stamp the scrape's database onto
            -- a lock convoy that happened in a different one -- silently
            -- misattributed rows, and a ?database= filter confidently wrong.
            coalesce(blocked.datname,'')                               AS pg_db,
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
          -- Output-identical: only a Lock waiter can have blockers, so this
          -- removes only rows the LATERAL join drops anyway, and stops
          -- pg_blocking_pids() taking lock-manager state for every session.
          WHERE blocked.wait_event_type = 'Lock'
        logs:
          - body_column: blocked_query
            attribute_columns:
              [blocked_pid, pg_db, blocked_user, blocked_app, wait_event_type, wait_event,
               blocked_wait_s, blocking_pid, blocking_state, blocking_app,
               blocking_query, server_address, o2_recipe]`;

/**
 * Postgres deadlocks, tailed from the server's own log file.
 *
 * TRAP: Postgres writes a deadlock as TWO separate log entries — an `ERROR:
 * deadlock detected` banner, and a `DETAIL:` block holding the wait cycle and
 * every participant's SQL. Matching only "deadlock detected" records that a
 * deadlock happened and loses every query. Both entries route to the deadlock
 * branch below.
 *
 * THE PREFIX SEGMENT IS A CONTRACT with PG_DBM_LOGGING_CONF's
 * `log_line_prefix`, field for field. The `app=… vxid=… txid=… line=…` group is
 * optional in the PATTERN only because background-worker lines carry no session
 * fields; every session line — including the deadlock banner — carries them and
 * fails to parse without it, leaving a healthy-looking collector and a Deadlocks
 * tab that never fills. Change one side and you must change the other.
 *
 * The `qid=` group is OPTIONAL by design: it only appears when the user takes
 * the auto_explain step (PG_DBM_AUTO_EXPLAIN_CONF adds `qid=%Q`), and configs
 * written before that step must keep parsing.
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
      # could fuse into one fabricated multi-participant deadlock.
      - type: add
        field: attributes.server_address
        value: "{host}"
      - type: router
        routes:
          - expr: 'attributes.pg_message matches "^deadlock detected"'
            output: mark_deadlock
          - expr: 'attributes.pg_severity == "DETAIL" and attributes.pg_message matches "waits for .* blocked by process"'
            output: mark_deadlock
          # auto_explain entries (optional PG_DBM_AUTO_EXPLAIN_CONF step).
          # MUST route before the default: an unrouted entry keeps o2_pg_event
          # = "other" and filter/dbm silently drops it while the collector
          # reports healthy.
          - expr: 'attributes.pg_message matches "^duration: [\\\\d.]+ ms\\\\s+plan:"'
            output: mark_explain
          # Completed-statement durations (log_min_duration_statement). MUST
          # stay AFTER the explain route: an auto_explain entry begins
          # "duration:" too, and this route would otherwise steal every plan.
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
      # (server_vantage.rs O2_DBM_PLAN).
      - type: regex_parser
        if: 'attributes.pg_message != nil and attributes.pg_message matches "plan:\\\\s*\\\\{"'
        parse_from: attributes.pg_message
        regex: '(?s)plan:\\s*(?P<ae_plan_json>\\{.*\\})\\s*$'
        on_error: send
      # DROP the message: the regex_parser above already lifted the plan into
      # ae_plan_json, which is what canonicalize_pg_auto_explain reads.
      #
      # A remove operator, not a bare deletion of this step -- the "output:
      # emit" routing is load-bearing. Without it an explain entry falls
      # through into the mark_duration branch below, whose ^duration: route
      # also matches an auto_explain line, and every plan is re-tagged
      # statement_duration.
      - type: remove
        field: attributes.pg_message
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
    # max_open_conn is SINGULAR; the plural is an unknown key that is
    # silently ignored, and unset means unlimited.
    max_open_conn: 2
    queries:
      - sql: |
          SELECT CAST(w.REQUESTING_ENGINE_TRANSACTION_ID AS CHAR) AS waiting_trx,
                 -- PER-SESSION database, from PROCESSLIST joined on the
                 -- transaction's thread id. innodb_trx has NO database column
                 -- of its own, so the waiting session's current schema is the
                 -- only per-row database this source can supply.
                 COALESCE(rp.DB, '')                              AS my_db,
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
          LEFT JOIN information_schema.PROCESSLIST rp
                 ON rp.ID = rt.trx_mysql_thread_id
        logs:
          - body_column: waiting_query
            attribute_columns:
              [waiting_trx, blocking_trx, my_db, waiting_thread, blocking_thread,
               blocking_query, waiting_state, blocking_state, wait_secs, server_address, o2_recipe]`;

/**
 * MySQL deadlocks, tailed from the error log.
 *
 * TWO GOTCHAS. (1) MySQL splits ONE deadlock across MANY separately timestamped
 * entries: MY-012468 is only the banner, and each `*** (N) TRANSACTION:` block
 * is its own MY-012469 entry — so both codes route to the deadlock branch and
 * the sides are stitched back together at read time. (2) Unless
 * `innodb_print_all_deadlocks` is ON, MySQL keeps only the MOST RECENT
 * deadlock, so history is lost; the prepare step turns it on.
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
      # could fuse into one fabricated multi-participant deadlock.
      - type: add
        field: attributes.server_address
        value: "{host}"
      - type: router
        routes:
          - expr: 'attributes.my_code == "MY-012468" or attributes.my_code == "MY-012469"'
            output: my_dl
          # Anchored on the markers InnoDB actually writes, NOT on the word
          # "deadlock": a bare substring stamps ordinary notes that merely
          # mention it (e.g. "deadlock avoidance is deprecated") as deadlocks
          # carrying no transaction, query or victim.
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
        # my_db is captured from the SCHEMA HALF of the qualified table name:
        # InnoDB writes the locked object as db.table, and this is the ONLY
        # place the MySQL error log states the database. detect_database reads
        # my_db.
        #
        # THIS IS A DIFFERENT RECORD FROM THE PARTICIPANT, which is why the two
        # extra captures exist. \`line_start_pattern\` splits on the timestamp, so
        # the RECORD LOCKS line can never share a record with the
        # \`*** (N) TRANSACTION:\` block above it. \`my_lock_side\` and
        # \`my_lock_trx_id\` are what make the two joinable at merge time --
        # without them the lock detail is thrown away and the database comes
        # back null, so the Deadlocks tab's \`?database=\` filter cannot work.
        regex: '(?s)\\*\\*\\* \\((?P<my_lock_side>\\d+)\\) (?:HOLDS THE LOCK|WAITING FOR THIS LOCK).*?RECORD LOCKS space id \\d+ page no \\d+ n bits \\d+ index (?P<my_lock_index>\\S+) of table (?P<my_lock_table>\`?(?P<my_db>[^\`. ]+)\`?\\.\\S+) trx id (?P<my_lock_trx_id>\\d+) (?P<my_lock_mode>lock_mode \\S+)'
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
 * WHY SEPARATE. The InnoDB body is identical, but the log-line ENVELOPE differs
 * (space separator, no `T`, no fractional seconds, no `[MY-nnnnnn]` code, bare
 * `InnoDB:` prefix) and one body literal differs fatally: `MariaDB thread id`
 * where MySQL writes `MySQL thread id`. Loosening the MySQL regex to accept
 * both would let its fallback deadlock-text branch start catching MySQL notes
 * that merely MENTION deadlocks.
 *
 * SPLIT-ENTRY, EXACTLY LIKE MYSQL: every physical line carries its own
 * timestamp prefix, so `line_start_pattern` cuts one deadlock into separate
 * entries with side 1, side 2 and the rollback verdict each on a DIFFERENT
 * record. ONE side-regex per record is therefore correct here.
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
      # could fuse into one fabricated multi-participant deadlock.
      - type: add
        field: attributes.server_address
        value: "{host}"
      # MariaDB has no [MY-nnnnnn] error code to route on, so the deadlock text
      # IS the only signal. Anchored to InnoDB's own markers rather than a bare
      # "deadlock" match so ordinary notes mentioning the word do not qualify.
      #
      # THE "*** (N) TRANSACTION:" ROUTE IS THE LOAD-BEARING ONE. MariaDB writes
      # the per-side blocks under an entry whose own text is a bare "InnoDB:",
      # containing neither "Transactions deadlock detected" (the banner, a
      # separate entry) nor "WE ROLL BACK TRANSACTION" (the verdict, another).
      # Routing on only those two phrases captures the verdict and drops BOTH
      # sides -- deadlocks with no participants.
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
        # See the MySQL receiver above: the schema half of the qualified table
        # name is the database the deadlock occurred in. MariaDB tags its rows
        # maria_*, but the DATABASE alias stays my_db on purpose --
        # detect_database reads my_db and has no maria_db alias, and the engine
        # is already distinguished by o2_maria_event, so this cannot make a
        # MariaDB row look like MySQL.
        #
        # Side and transaction id are captured for the same reason as the MySQL
        # recipe above: InnoDB writes the RECORD LOCKS line as a SEPARATE entry
        # from the \`*** (N) TRANSACTION:\` block, so the lock detail has to be
        # joined back by side + trx id or it is thrown away.
        regex: '(?s)\\*\\*\\* \\((?P<maria_lock_side>\\d+)\\) (?:HOLDS THE LOCK|WAITING FOR THIS LOCK).*?RECORD LOCKS space id \\d+ page no \\d+ n bits \\d+ index (?P<maria_lock_index>\\S+) of table (?P<maria_lock_table>\`?(?P<my_db>[^\`. ]+)\`?\\.\\S+) trx id (?P<maria_lock_trx_id>\\d+) (?P<maria_lock_mode>lock_mode \\S+)'
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
 * `performance_schema.data_lock_waits` is a MySQL 8.0 table MariaDB never
 * adopted — MariaDB kept the pre-8.0 `information_schema.INNODB_LOCK_WAITS`.
 * The MySQL query fails every collection cycle with `Error 1146 (42S02): Table
 * 'performance_schema.data_lock_waits' doesn't exist`, which is SILENT to the
 * user: the pipeline stays green and the Blocked queries tab is always empty.
 * The column contract is deliberately identical to the MySQL recipe's, so
 * `canonicalize_blocking` needs no MariaDB branch.
 *
 * What must NOT be copied either is `'mysql_lock_waits'`: `detect_engine` maps
 * that tag straight to `"mysql"`, so reusing it would label every MariaDB
 * blocking row as MySQL — wrong on the Databases page and for `?system=`.
 */
const MARIADB_BLOCKING_RECEIVER = `  sqlquery/mariadb_locks:
    driver: mysql
    datasource: "\${env:MYSQL_USER}:\${env:MYSQL_PASSWORD}@tcp({host}:{port})/{database}"
    collection_interval: 10s
    # max_open_conn is SINGULAR; the plural is an unknown key that is
    # silently ignored, and unset means unlimited.
    max_open_conn: 2
    queries:
      - sql: |
          SELECT CAST(w.requesting_trx_id AS CHAR)                AS waiting_trx,
                 -- PER-SESSION database, from PROCESSLIST joined on the
                 -- transaction's thread id. innodb_trx has NO database column
                 -- of its own, so the waiting session's current schema is the
                 -- only per-row database this source can supply.
                 COALESCE(rp.DB, '')                              AS my_db,
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
          LEFT JOIN information_schema.PROCESSLIST rp
                 ON rp.ID = rt.trx_mysql_thread_id
        logs:
          - body_column: waiting_query
            attribute_columns:
              [waiting_trx, blocking_trx, my_db, waiting_thread, blocking_thread,
               blocking_query, waiting_state, blocking_state, wait_secs, server_address, o2_recipe]`;

/**
 * SQL Server blocking, from `sys.dm_exec_requests` joined to `sys.dm_exec_sessions`
 * and `sys.dm_exec_sql_text` for the statement on both sides.
 *
 * The aliases below are the same column names the Postgres and MySQL recipes
 * emit, which is the whole contract `canonicalize_blocking` reads.
 */
const MSSQL_BLOCKING_RECEIVER = `  sqlquery/mssql_blocking:
    driver: sqlserver
    datasource: "sqlserver://\${env:MSSQL_USER}:\${env:MSSQL_PASSWORD}@{host}:{port}?database={database}"
    collection_interval: 10s
    # max_open_conn is SINGULAR; the plural is an unknown key that is
    # silently ignored, and unset means unlimited.
    max_open_conn: 2
    queries:
      - sql: |
          SELECT CAST(r.session_id AS VARCHAR(20))            AS blocked_pid,
                 -- PER-REQUEST database, from the request's own database_id
                 -- rather than the connection's: a blocking chain on SQL Server
                 -- can span databases, so DB_NAME(r.database_id) names where
                 -- the contention actually is. BRACKETED because database is a
                 -- RESERVED KEYWORD in T-SQL: written bare, the whole
                 -- collection fails with "Incorrect syntax near the keyword
                 -- 'database'" and the blocking receiver silently stops
                 -- producing rows while the collector still looks healthy. The
                 -- brackets are quoting only -- the emitted column name is
                 -- still database, which is what detect_database reads.
                 COALESCE(DB_NAME(r.database_id), '')         AS [database],
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
              [blocked_pid, database, blocked_user, blocked_app, wait_event_type, wait_event,
               blocked_wait_s, blocking_pid, blocking_state, blocking_app,
               blocking_query, server_address, o2_recipe]`;

/**
 * SQL Server deadlocks, shredded from the `system_health` Extended Events ring
 * buffer. `.nodes()`/`.value()` flattens the graph server-side into the same
 * one-row-per-participant shape the other recipes emit.
 *
 * NO STITCHING NEEDED, UNLIKE MYSQL. SQL Server names the victim INLINE
 * (`<victim-list><victimProcess id=…>`) and that id resolves to a `<process>` in
 * the SAME document, so `mssql_is_victim` is decided per row at query time —
 * hence a resolved flag rather than a `side`/`victim_side` pair.
 *
 * `SET QUOTED_IDENTIFIER ON` IS REQUIRED, NOT STYLE: XML methods fail without
 * it, and the sqlqueryreceiver's session does not enable it by default. Omit it
 * and every collection errors with msg 1934 while the pipeline looks healthy.
 *
 * The `timestamp` filter keeps the ring buffer from being re-shredded in full on
 * every interval — `system_health` retains hours of deadlocks, so without it the
 * same events would be re-emitted every collection.
 */
/**
 * SQL Server table + index health.
 *
 * The column ALIASES match the pg/mysql/mariadb stats recipes exactly, so one
 * canonicalizer serves every engine and reads the engine off `o2_recipe`.
 *
 * WHAT IS DELIBERATELY ABSENT: SQL Server has no autovacuum and no dead-tuple
 * accounting, so there are no vacuum/analyze counters, no timestamps and no
 * bloat estimate. Those columns are OMITTED rather than zero-filled — a
 * fabricated 0% bloat reads as "healthy" and would silence the very rule a
 * reader is looking at the tab for.
 */
const MSSQL_TABLE_STATS_RECEIVER = `  sqlquery/mssql_table_stats:
    driver: sqlserver
    datasource: "server={host};port={port};user id=\${env:MSSQL_USER};password=\${env:MSSQL_PASSWORD};database={database}"
    collection_interval: 60s
    max_open_conn: 2
    queries:
      - sql: |
          SELECT SCHEMA_NAME(t.schema_id)                              AS schema_name,
                 t.name                                                AS table_name,
                 CAST(SUM(a.total_pages) * 8192 AS VARCHAR(32))        AS total_bytes,
                 -- index_id 0 = heap, 1 = clustered: the TABLE's own pages, so
                 -- this means what heap_bytes means on every other engine
                 -- rather than folding every index into the table figure.
                 CAST(SUM(CASE WHEN i.index_id IN (0,1) THEN a.data_pages ELSE 0 END) * 8192 AS VARCHAR(32)) AS heap_bytes,
                 -- MAX, not SUM: sys.partitions holds one row per index, so a
                 -- SUM counts the same rows once per index.
                 CAST(MAX(p.rows) AS VARCHAR(32))                      AS n_live_tup,
                 '{host}'                                              AS server_address,
                 'mssql_table_stats'                                   AS o2_recipe
          FROM sys.tables t
          JOIN sys.indexes i          ON i.object_id = t.object_id
          JOIN sys.partitions p       ON p.object_id = i.object_id AND p.index_id = i.index_id
          JOIN sys.allocation_units a ON a.container_id = p.partition_id
          GROUP BY SCHEMA_NAME(t.schema_id), t.name
        logs:
          - body_column: table_name
            attribute_columns:
              [schema_name, total_bytes, heap_bytes, n_live_tup, server_address, o2_recipe]`;

const MSSQL_INDEX_STATS_RECEIVER = `  sqlquery/mssql_index_stats:
    driver: sqlserver
    datasource: "server={host};port={port};user id=\${env:MSSQL_USER};password=\${env:MSSQL_PASSWORD};database={database}"
    collection_interval: 60s
    max_open_conn: 2
    queries:
      - sql: |
          SELECT SCHEMA_NAME(t.schema_id)                              AS schema_name,
                 t.name                                                AS table_name,
                 i.name                                                AS index_name,
                 -- Seeks + scans + lookups folded into one figure: all three
                 -- are the index being USED, and the unused-index rule asks
                 -- only whether anything touched it.
                 CAST(ISNULL(us.user_seeks,0) + ISNULL(us.user_scans,0) + ISNULL(us.user_lookups,0) AS VARCHAR(32)) AS idx_scan,
                 CAST(SUM(a.total_pages) * 8192 AS VARCHAR(32))        AS index_bytes,
                 CASE WHEN i.is_unique = 1 THEN 'true' ELSE 'false' END AS is_unique,
                 '{host}'                                              AS server_address,
                 'mssql_index_stats'                                   AS o2_recipe
          FROM sys.indexes i
          JOIN sys.tables t           ON t.object_id = i.object_id
          JOIN sys.partitions p       ON p.object_id = i.object_id AND p.index_id = i.index_id
          JOIN sys.allocation_units a ON a.container_id = p.partition_id
          -- LEFT JOIN, scoped to THIS database: the DMV holds no row for an
          -- index nothing has touched since the last restart, and that index is
          -- precisely the one the unused-index rule exists to surface. An inner
          -- join would hide it.
          LEFT JOIN sys.dm_db_index_usage_stats us
                 ON us.object_id = i.object_id AND us.index_id = i.index_id
                AND us.database_id = DB_ID()
          WHERE i.name IS NOT NULL
          GROUP BY SCHEMA_NAME(t.schema_id), t.name, i.name,
                   us.user_seeks, us.user_scans, us.user_lookups, i.is_unique
        logs:
          - body_column: index_name
            attribute_columns:
              [schema_name, table_name, idx_scan, index_bytes, is_unique, server_address, o2_recipe]`;

const MSSQL_DEADLOG_RECEIVER = `  sqlquery/mssql_deadlocks:
    driver: sqlserver
    datasource: "sqlserver://\${env:MSSQL_USER}:\${env:MSSQL_PASSWORD}@{host}:{port}?database={database}"
    collection_interval: 30s
    # max_open_conn is SINGULAR; the plural is an unknown key that is
    # silently ignored, and unset means unlimited.
    max_open_conn: 2
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
 * The column names below ARE the ingest contract: `canonicalize_table_stats`
 * reads them verbatim.
 *
 * TWO PROPERTIES THE READ SURFACE DEPENDS ON:
 *
 *  • `table_name` is the `body_column`, not an attribute — the backend reads
 *    the relation out of `body`. Promoting it to an attribute would silently
 *    empty the Table health tab.
 *
 *  • The counters from `pg_stat_user_tables` — `seq_scan`, `idx_scan`,
 *    `autovacuum_count` — are CUMULATIVE SINCE THE LAST `pg_stat_reset()`, and
 *    `n_live_tup`/`n_dead_tup` are planner estimates rather than exact counts.
 *    The API states both on its response envelope so the page cannot label a
 *    lifetime total as a per-window one.
 *
 * THE BOUND IS A PREDICATE, NOT A LIMIT — deliberately. A LIMIT with no stable
 * ORDER BY keeps whichever tables the catalog scan reached first, so WHICH
 * tables vanish changes between ticks and the tab gains and loses rows
 * non-deterministically. `n_live_tup > 0` drops the same relations every tick.
 */
const PG_TABLE_STATS_RECEIVER = `  sqlquery/pg_table_stats:
    driver: postgres
    datasource: "host={host} port={port} user=\${env:PGUSER} password=\${env:PGPASS} dbname={database} sslmode=require"
    # 300s, not 60s: pg_total_relation_size() walks the catalog and filesystem
    # metadata for every fork of every relation once per table per tick, so
    # cost is O(your schema).
    collection_interval: 300s
    max_open_conn: 2
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
            -- The bound. A relation with zero live tuples has no bloat, no
            -- vacuum debt and no meaningful size. Deliberately NOT a LIMIT: a
            -- LIMIT with no stable ORDER BY drops a different set of tables
            -- each tick and the tab flickers; this drops the same ones.
            AND coalesce(s.n_live_tup, 0) > 0
        logs:
          - body_column: table_name
            attribute_columns:
              [schema_name, total_bytes, heap_bytes, seq_scan, seq_tup_read,
               idx_scan, n_live_tup, n_dead_tup, n_mod_since_analyze,
               last_vacuum, last_autovacuum, last_analyze, autovacuum_count,
               frozen_xid_age, dead_tup_pct, server_address, o2_recipe]`;

/**
 * Index size and usage, one row per INDEX. The companion to `pg_table_stats`
 * and the source of the never-scanned signal.
 *
 * Two properties the read surface depends on:
 *
 *  • `idx_scan` is CUMULATIVE since the last `pg_stat_reset()`, exactly as the
 *    table counters are. It is therefore "never scanned since the counters were
 *    reset", never "not scanned in the last hour", and the canonicalizer marks
 *    every row so the UI cannot phrase it the stronger way.
 *  • `index_bytes` is EXACT (`pg_relation_size`), unlike the tuple estimates on
 *    the table feed.
 *
 * `index_name` is an attribute rather than the `body_column` the table recipe
 * uses, because `body` here carries the index DEFINITION.
 */
const PG_INDEX_STATS_RECEIVER = `  sqlquery/pg_index_stats:
    driver: postgres
    datasource: "host={host} port={port} user=\${env:PGUSER} password=\${env:PGPASS} dbname={database} sslmode=require"
    # 300s, matching pg_table_stats and for the same reason: one
    # pg_relation_size() plus one pg_get_indexdef() per INDEX per tick.
    collection_interval: 300s
    max_open_conn: 2
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
 * CONTRACT, different catalogs. The aliases are deliberately IDENTICAL to the
 * Postgres recipe's: `canonicalize_table_stats` reads one set of names and the
 * `o2_recipe` tag names the engine, so no engine-conditional branch can drift.
 *
 * WHAT MYSQL CANNOT SAY IS OMITTED, NOT ZEROED. There is no dead-tuple state,
 * no vacuum timestamps and no xid age here because InnoDB has no equivalent —
 * selecting a `'0' AS dead_tup_pct` would render "0% bloat" about a
 * measurement that never happened.
 *
 * `n_live_tup` comes from `mysql.innodb_table_stats.n_rows` (falling back to
 * `information_schema.TABLES.TABLE_ROWS`) — BOTH are estimates, exactly as
 * Postgres's `n_live_tup` is, and the canonicalizer's estimated-tuples flag
 * discloses that on every row.
 */
// Keep the 'o2_recipe' tag a STATIC literal in a static template literal: the
// Rust contract test shipped_recipe_tags_and_backend_dispatch_agree
// (tests_server_vantage.rs) parses this file's raw text and skips dynamic tags.
const MYSQL_TABLE_STATS_RECEIVER = `  sqlquery/mysql_table_stats:
    driver: mysql
    datasource: "\${env:MYSQL_USER}:\${env:MYSQL_PASSWORD}@tcp({host}:{port})/{database}"
    collection_interval: 60s
    # max_open_conn is SINGULAR; the plural is an unknown key that is
    # silently ignored, and unset means unlimited.
    max_open_conn: 2
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
 * readable definition for `body` (MySQL has no `pg_get_indexdef`).
 *
 *  • `idx_scan` ← `performance_schema.table_io_waits_summary_by_index_usage.
 *    COUNT_READ`, the closest MySQL analog of `pg_stat_user_indexes.idx_scan`.
 *    ON by default on MySQL 8 — which is exactly what MariaDB does NOT have,
 *    and why its twin below omits the column entirely.
 *  • `index_bytes` ← `mysql.innodb_index_stats` `stat_name='size'` (pages) ×
 *    `@@innodb_page_size`. An ESTIMATE, unlike Postgres's exact
 *    `pg_relation_size`.
 *  • FUNCTIONAL INDEXES (MySQL 8.0.13+): an expression key part has a NULL
 *    `COLUMN_NAME`, which nulls GROUP_CONCAT and then CONCAT — the whole
 *    `index_def` (the body_column!) comes back NULL. The `COALESCE(COLUMN_NAME,
 *    CONCAT('(', EXPRESSION, ')'))` below renders the expression instead.
 *    MySQL-ONLY: MariaDB's STATISTICS has no EXPRESSION column (Error 1054)
 *    and no functional-index syntax, so its twin must NOT copy this.
 */
const MYSQL_INDEX_STATS_RECEIVER = `  sqlquery/mysql_index_stats:
    driver: mysql
    datasource: "\${env:MYSQL_USER}:\${env:MYSQL_PASSWORD}@tcp({host}:{port})/{database}"
    collection_interval: 60s
    # max_open_conn is SINGULAR; the plural is an unknown key that is
    # silently ignored, and unset means unlimited.
    max_open_conn: 2
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
 * The catalogs themselves ARE shared — MariaDB kept `information_schema.TABLES`
 * and `mysql.innodb_table_stats` — so unlike the blocking recipes there is no
 * FROM-clause divergence to carry.
 */
// Keep the 'o2_recipe' tag a STATIC literal in a static template literal: the
// Rust contract test shipped_recipe_tags_and_backend_dispatch_agree
// (tests_server_vantage.rs) parses this file's raw text and skips dynamic tags.
const MARIADB_TABLE_STATS_RECEIVER = `  sqlquery/mariadb_table_stats:
    driver: mysql
    datasource: "\${env:MYSQL_USER}:\${env:MYSQL_PASSWORD}@tcp({host}:{port})/{database}"
    collection_interval: 60s
    # max_open_conn is SINGULAR; the plural is an unknown key that is
    # silently ignored, and unset means unlimited.
    max_open_conn: 2
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
 * `table_io_waits_summary_by_index_usage` is empty (or the schema is absent) on
 * the ordinary server. A LEFT JOIN COALESCEd to 0 would render `idx_scan = 0` —
 * the never-scanned FINDING — for every index on every MariaDB instance,
 * fabricated from a table that was never populated. The join and the column are
 * omitted ENTIRELY: absent is "honestly unknown".
 *
 * NO functional-index COALESCE here either (the MySQL twin's EXPRESSION
 * fallback): MariaDB's STATISTICS has no EXPRESSION column (Error 1054) and no
 * functional-index syntax to need it.
 */
const MARIADB_INDEX_STATS_RECEIVER = `  sqlquery/mariadb_index_stats:
    driver: mysql
    datasource: "\${env:MYSQL_USER}:\${env:MYSQL_PASSWORD}@tcp({host}:{port})/{database}"
    collection_interval: 60s
    # max_open_conn is SINGULAR; the plural is an unknown key that is
    # silently ignored, and unset means unlimited.
    max_open_conn: 2
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
 * THE `events:` BLOCK SHIPS AT `true`. Upstream flipped both events to
 * default-OFF at v0.148.0, so the block is what switches the collection on;
 * without it the collector looks healthy and emits ZERO events, with no
 * warning. OpenObserve accepts both feeds whenever Database Monitoring is
 * enabled (one server flag, `ZO_DB_MONITORING_ENABLED`).
 *
 * `events:` is a TOP-LEVEL receiver key, a SIBLING of the collection blocks —
 * nesting an `enabled` inside query_sample_collection / top_query_collection
 * is a fatal config error. On a collector older than v0.148.0 the block is
 * rejected as an unknown key, which is at least a loud failure.
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
      # DELIBERATE DEVIATION FROM UPSTREAM, WHICH DEFAULTS TO 60s, so an
      # "align with upstream" pass does not revert it silently. It multiplies
      # every per-cycle cost, including the EXPLAIN pass
      # max_explain_each_interval bounds: the ceiling is 200 x 240 = 48,000
      # EXPLAINs/hour against a measured real rate of 1,775. So do NOT cut the
      # budget, and do NOT shorten query_plan_cache_ttl to catch plan
      # regressions sooner -- a shorter TTL pushes more queries back through
      # the cycle and multiplies the one cost here that is real.
      collection_interval: 15s
    # ON. These two events fill the Activity tab and the server-side Top
    # queries. Upstream has shipped them default-OFF since v0.148.0, so without
    # this block the collector looks healthy and emits ZERO events. Set one to
    # false to trim cost, but the block itself must STAY -- and events: must
    # stay a TOP-LEVEL receiver key, never nested inside the blocks above.
    events:
      db.server.query_sample: { enabled: true }
      db.server.top_query: { enabled: true }`;

/**
 * MySQL activity samples + server top queries, from the stock `mysqlreceiver`'s
 * log events. Same v0.148.0 `events:` trap as Postgres — see PG_EVENTS_RECEIVER.
 *
 * SPELLING ASYMMETRY: mysql says `top_query_count` where postgres says
 * `top_n_query`, and mysql REJECTS `max_rows_per_query` /
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
      # mysqlreceiver's OWN default -- NOT Postgres's 1000; the two receivers
      # diverge deliberately (see the spelling asymmetry noted above).
      max_rows_per_query: 100
    top_query_collection:
      top_query_count: 200
      # DELIBERATE DEVIATION FROM UPSTREAM, WHICH DEFAULTS TO 60s -- the same
      # call the Postgres receiver makes. It multiplies every per-cycle cost,
      # so an "align with upstream" pass must not revert it silently alongside
      # the block's other knobs.
      collection_interval: 15s
      lookback_time: 120
      query_plan_cache_size: 1000
    # ON. These two events fill the Activity tab and the server-side Top
    # queries. Upstream has shipped them default-OFF since v0.148.0, so without
    # this block the collector looks healthy and emits ZERO events. Set one to
    # false to trim cost, but the block itself must STAY -- and events: must
    # stay a TOP-LEVEL receiver key, never nested inside the blocks above.
    events:
      db.server.query_sample: { enabled: true }
      db.server.top_query: { enabled: true }`;

/**
 * MariaDB activity samples + server top queries, from the stock `mysqlreceiver`
 * pointed at MariaDB.
 *
 * THERE IS NO `mariadbreceiver` — and there does not need to be. MariaDB speaks
 * the MySQL wire protocol and mysqlreceiver detects the product correctly. Same
 * v0.148.0 `events:` trap as Postgres and MySQL — see PG_EVENTS_RECEIVER — and
 * the same `top_query_count` spelling MySQL uses.
 *
 * ONE HONEST LIMIT, which the receiver discloses itself: it reports
 * `supports_query_sample_text: false` against MariaDB. MariaDB does not expose
 * the statement text the sampler wants, so Activity rows describe a session
 * without carrying its SQL. Top queries and their digests are unaffected.
 *
 * ENGINE IDENTITY — see `transform/mariadb_engine` in dbmConfig(). mysqlreceiver
 * stamps `db.system.name: mysql` even against MariaDB, so without a correction
 * ONE SERVER ANSWERS TO TWO ENGINES and appears twice in the fleet list. The
 * correction belongs at the collector, not the reader: a record-level attribute
 * is the engine's own claim about itself.
 */
const MARIADB_EVENTS_RECEIVER = `  mysql/dbm_events:
    endpoint: "{host}:{port}"
    username: \${env:MYSQL_USER}
    password: \${env:MYSQL_PASSWORD}
    database: {database}
    collection_interval: 10s
    query_sample_collection:
      # mysqlreceiver's OWN default, matching the MySQL card.
      max_rows_per_query: 100
    top_query_collection:
      top_query_count: 200
      collection_interval: 15s
      lookback_time: 120
      query_plan_cache_size: 1000
    # ON. These two events fill the Activity tab and the server-side Top
    # queries. Upstream has shipped them default-OFF since v0.148.0, so without
    # this block the collector looks healthy and emits ZERO events. Set one to
    # false to trim cost, but the block itself must STAY -- and events: must
    # stay a TOP-LEVEL receiver key, never nested inside the blocks above.
    events:
      db.server.query_sample: { enabled: true }
      db.server.top_query: { enabled: true }`;

/**
 * SQL Server activity samples, server top queries AND EXECUTION PLANS, from the
 * stock `sqlserverreceiver`'s log events. The plans the Top queries detail page
 * renders ride on `db.server.top_query` — turning that event off turns the plan
 * tree off, so the two are one switch.
 *
 * NOT INTERCHANGEABLE WITH mysqlreceiver's SHAPE, which is the mistake this
 * comment exists to prevent. sqlserverreceiver splits `server` and `port` into
 * two keys where mysqlreceiver takes one `endpoint`, and it takes NO `database`
 * at all — it reads across the whole instance. Its `top_query_collection` also
 * accepts a SMALLER key set: `top_query_count` is honoured, but the
 * `collection_interval` / `lookback_time` / `query_plan_cache_size` knobs the
 * MySQL block carries are not set here. These blocks are strictly key-validated
 * and an unknown key is FATAL at collector startup, so do not copy keys across
 * receivers without checking them against the receiver's own schema.
 *
 * Same v0.148.0 `events:` trap as every other engine — see PG_EVENTS_RECEIVER.
 */
const MSSQL_EVENTS_RECEIVER = `  sqlserver/dbm_events:
    server: "{host}"
    port: {port}
    username: \${env:MSSQL_USER}
    password: \${env:MSSQL_PASSWORD}
    collection_interval: 10s
    query_sample_collection:
      max_rows_per_query: 1000
    top_query_collection:
      top_query_count: 200
    # ON. These two events fill the Activity tab, the server-side Top queries,
    # and the EXECUTION PLANS on a query's detail page -- the plans ride on
    # db.server.top_query. Upstream has shipped both default-OFF since
    # v0.148.0, so without this block the collector looks healthy and emits
    # ZERO events. Set one to false to trim cost, but the block itself must
    # STAY -- and events: must stay a TOP-LEVEL receiver key, never nested
    # inside the blocks above.
    events:
      db.server.query_sample: { enabled: true }
      db.server.top_query: { enabled: true }`;


/** Assemble the full DBM config for an engine. */
interface DbmRecipeSet {
  receivers: string[];
  names: string;
  /**
   * Receiver-native `db.server.query_sample` / `db.server.top_query` events.
   * Without this block on an engine, its Activity and Top queries tabs stay
   * permanently empty while the collector reports itself healthy.
   */
  events?: { receiver: string; name: string };
  /**
   * OTTL statements correcting an attribute the receiver stamps wrongly on THIS
   * lane, emitted as a `transform/<engine>_engine` processor on the events
   * pipeline. MariaDB alone: `mysqlreceiver` stamps `db.system.name: mysql`
   * even against MariaDB, so without it one server files under two engines.
   */
  eventsEngineFix?: string;
}

const RECIPES: Record<"postgres" | "mysql" | "mariadb" | "mssql", DbmRecipeSet> = {
  // Table/index health and the receiver-native `events:` feeds ship for ALL
  // FOUR engines. The catalogs differ per engine but every recipe emits the
  // SAME column aliases under its own engine tag, so one backend canonicalizer
  // reads all of them.
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
    // The receiver is `mysql/dbm_events` because mysqlreceiver is the one that
    // speaks to MariaDB — the ENGINE FIX below is what stops that borrowing
    // from filing this server's rows under MySQL.
    events: { receiver: MARIADB_EVENTS_RECEIVER, name: "mysql/dbm_events" },
    eventsEngineFix: `          - set(attributes["db.system.name"], "mariadb")
          - set(resource.attributes["db.system.name"], "mariadb")`,
  },
  mssql: {
    receivers: [
      MSSQL_BLOCKING_RECEIVER,
      MSSQL_DEADLOG_RECEIVER,
      MSSQL_TABLE_STATS_RECEIVER,
      MSSQL_INDEX_STATS_RECEIVER,
    ],
    names:
      "sqlquery/mssql_blocking, sqlquery/mssql_deadlocks, sqlquery/mssql_table_stats, sqlquery/mssql_index_stats",
    // No engine fix: sqlserverreceiver stamps its own engine correctly.
    events: { receiver: MSSQL_EVENTS_RECEIVER, name: "sqlserver/dbm_events" },
  },
};

const dbmConfig = (engine: keyof typeof RECIPES) => {
  const { receivers, names, events, eventsEngineFix } = RECIPES[engine];
  const allReceivers = events ? [...receivers, events.receiver] : receivers;

  // ENGINE IDENTITY CORRECTION, on engines that borrow another engine's
  // receiver (MariaDB borrows mysqlreceiver). Both halves are generated from
  // the same flag: a processor listed in a pipeline but not defined fails the
  // collector at startup.
  const engineFixName = eventsEngineFix ? `transform/${engine}_engine` : "";
  const engineFixProcessor = eventsEngineFix
    ? `
  # The borrowed receiver stamps its OWN engine name; this server is not that
  # engine. Runs on the events pipeline only — the sqlquery recipes on the main
  # pipeline already carry this engine's own tags.
  ${engineFixName}:
    error_mode: ignore
    log_statements:
      - context: log
        statements:
${eventsEngineFix}`
    : "";

  // The events pipeline deliberately SKIPS filter/dbm: receiver-native events
  // carry no o2_recipe / o2_*_event tag (the backend recognizes them by their
  // OTLP event name), so routing them through the filter would silently drop
  // every one — the exact failure shape the events: block exists to prevent.
  //
  // memory_limiter stays FIRST for the same reason it is first on the main
  // pipeline: a processor listed ahead of it runs outside the OOM guard.
  const eventsPipeline = events
    ? `
    logs/dbm_events:
      receivers: [${events.name}]
      processors: [memory_limiter, ${engineFixName ? `${engineFixName}, ` : ""}batch]
      exporters: [otlphttp/openobserve_dbm]`
    : "";

  return `receivers:
${allReceivers.join("\n")}

processors:
  # Keep ONLY the records the Database Monitoring pages read. Load-bearing, not
  # tidiness: the filelog receivers tail the WHOLE database log, so without
  # this every ordinary log line lands in dbm_server too and swamps the tagged
  # rows. A record is ours if a recipe tagged it -- sqlquery rows carry
  # o2_recipe, filelog rows carry o2_pg_event / o2_my_event / o2_maria_event.
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
  # SELF-PROTECTION. This collector usually runs on the CUSTOMER'S DATABASE
  # HOST: the filelog receivers read the database log as fast as it grows, so
  # with nothing between them and a stalled exporter the heap absorbs the
  # difference until the OOM killer ends it -- and the stall is most likely
  # during exactly the incident that produced the volume.
  #
  # MUST BE FIRST in every pipeline's processors list: memory_limiter applies
  # back-pressure to whatever is UPSTREAM of it, so a processor listed before
  # it is outside the guard. When over the soft limit it refuses batches, which
  # propagates back into the receivers and makes the collector SHED rather than
  # grow.
  memory_limiter:
    check_interval: 1s
    limit_mib: 768
    spike_limit_mib: 192${engineFixProcessor}
  batch:
    timeout: 5s
    send_batch_size: 512

exporters:
  otlphttp/openobserve_dbm:
    logs_endpoint: {url}/api/{org}/v1/logs
    headers:
      Authorization: Basic {token}
      stream-name: ${DBM_SERVER_STREAM}
    # THE OTHER HALF OF THE OOM GUARD (see memory_limiter above). Left at its
    # defaults the sending queue is effectively an unbounded in-memory buffer,
    # and retry_on_failure with no deadline re-queues batches that will never
    # succeed. Beyond the queue the collector DROPS, which is correct here: a
    # gap in the Deadlocks timeline beats a dead collector on a database host.
    # The queue is IN MEMORY and deliberately not persistent -- persistence
    # needs a storage: extension and a writable state directory on the database
    # host.
    sending_queue:
      enabled: true
      queue_size: 500
    retry_on_failure:
      enabled: true
      max_elapsed_time: 300s

service:
  pipelines:
    logs:
      receivers: [${names}]
      # memory_limiter FIRST — it back-pressures what is upstream of it, so
      # anything listed before it runs outside the guard.
      processors: [memory_limiter, filter/dbm, batch]
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
 * but never what.
 *
 * `pg_stat_statements` is what the receiver's server top-queries read. The
 * CREATE EXTENSION works even before the library is preloaded; the counters
 * only start filling once shared_preload_libraries carries it and Postgres has
 * RESTARTED — which is the logging step's job.
 *
 * KNOWN LIMIT, stated on the card: pg_monitor does NOT include SELECT on user
 * tables, so on a locked-down instance the receiver's EXPLAIN-based estimated
 * plans silently come back empty while everything else works.
 */
export const PG_DBM_GRANT_SQL = `GRANT pg_monitor TO myuser;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;`;
/**
 * `SET PERSIST`, not `SET GLOBAL`. `SET GLOBAL` is lost on the next restart, so
 * deadlock history would stop being recorded at the next maintenance window
 * with nothing on screen to say so. `SET PERSIST` (MySQL 8.0+) writes to
 * mysqld-auto.cnf and survives; it needs SYSTEM_VARIABLES_ADMIN (or SUPER).
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
 * Extended Events target and fails with msg 300 ("VIEW SERVER PERFORMANCE STATE
 * permission was denied"), which leaves the Deadlocks tab empty forever while
 * blocking works — reading as "deadlocks never happen" rather than as a
 * permissions problem. Neither grant subsumes the other.
 */
export const MSSQL_DBM_GRANT_SQL = `GRANT VIEW SERVER STATE TO otel;
GRANT VIEW SERVER PERFORMANCE STATE TO otel;`;

/**
 * Postgres server settings the deadlock recipe DEPENDS ON. Unlike the grant
 * above, these are not an enhancement — without them the Deadlocks tab can
 * never fill, and it fails silently:
 *
 *  - `log_line_prefix` IS A CONTRACT with PG_DEADLOG_RECEIVER's `regex_parser`,
 *    which expects `ts [pid] user@db SEVERITY:`. This is NOT the Postgres
 *    default, so a stock server parses to nothing on EVERY line. `%q` is
 *    load-bearing: without it, non-session backends (checkpointer, autovacuum)
 *    emit a prefix missing the session fields and fail the regex.
 *  - `logging_collector = on` is what produces a file to tail at all. Off (the
 *    default on many distros) means `filelog` matches nothing, reports healthy,
 *    and ingests zero rows.
 *  - `deadlock_timeout` gates when Postgres writes a deadlock DETAIL block.
 *  - `log_lock_waits` is genuinely optional: it adds long waits that never
 *    became deadlocks.
 */
export const PG_DBM_LOGGING_CONF = `# Must match the collector's log parser — %q keeps background workers parseable.
log_line_prefix = '%m [%p] %q%u@%d app=%a vxid=%v txid=%x line=%l '
# Write logs to a file the collector can tail.
logging_collector = on
log_destination = 'stderr'
# Detect deadlocks sooner. The default 1s does NOT miss deadlocks; lowering
# this only shortens how long the victims wait. The detector runs on every lock
# wait that exceeds the timeout, so on a high-contention OLTP server with many
# legitimate 500ms-1s waits, leave it at 1s.
deadlock_timeout = 500ms
# Optional: also record long lock waits that never deadlock. Note this shares
# the threshold above, so the two together log more than either alone.
log_lock_waits = on
# THIS THRESHOLD GOVERNS WHICH CALLS CAN APPEAR on the Slowest-calls page.
# 0 logs EVERYTHING -- every COMMIT, every ping -- which is a diagnosis
# setting, not a monitoring one. -1 (the default) reports nothing.
log_min_duration_statement = 100ms
# Server top queries read pg_stat_statements, which must be PRELOADED — append
# it if this line already lists other libraries. Takes effect only on RESTART
# (not reloadable), same as the logging settings above.
shared_preload_libraries = 'pg_stat_statements'
# NOT SET BY THIS INTEGRATION -- listed because it surprises. OpenObserve never
# collects temp-file lines (no parser rule; they arrive untagged and are
# dropped), but Postgres still WRITES them, and at 0 that is one line per sort
# spill your disk and log shipper pay for and nothing here reads. -1 (the
# default) is off; a size like 1MB logs only the spills worth investigating.
# log_temp_files = -1`;

/**
 * Both settings above need a RESTART, not a reload — `log_line_prefix` and
 * `logging_collector` are not reloadable. Users who only `SELECT
 * pg_reload_conf()` see no change and conclude the recipe is broken.
 */
export const PG_DBM_LOGGING_VERIFY_SQL = `SHOW log_line_prefix;   -- must match the line you set
SHOW logging_collector; -- must be on
SHOW deadlock_timeout;  -- 500ms
SHOW log_min_duration_statement; -- 100ms (what governs the Slowest-calls page)
SHOW shared_preload_libraries; -- must include pg_stat_statements
-- THE VOLUME CHECK. The settings below do not change WHETHER Database
-- Monitoring works -- they change HOW MUCH it costs, by up to two orders of
-- magnitude, and a wrong value looks identical to a right one on every page.
-- current_setting(..., true) returns NULL instead of raising when auto_explain
-- is not loaded -- the auto_explain step is OPTIONAL, and a plain SHOW would
-- ERROR on a server that skipped it. NULL here means "not loaded".
SELECT current_setting('auto_explain.log_min_duration', true) AS auto_explain_log_min_duration,
       -- 2s expected. 0 = a plan for EVERY statement.
       current_setting('auto_explain.sample_rate', true)      AS auto_explain_sample_rate;
       -- 0.01 expected. 1 = every statement PAYS the executor cost,
       -- whether or not it clears the threshold and gets logged.
-- Not a setting this integration uses -- checked because it surprises.
-- OpenObserve never collects temp-file lines (no parser rule, so they are
-- dropped as untagged). At 0 Postgres logs EVERY sort spill: your disk and log
-- shipper pay for it, and nothing in this product shows it to you.
SHOW log_temp_files;                -- -1 (off) or a size like 1MB, not 0`;

/**
 * OPTIONAL — real executed plans via `auto_explain` (Postgres only).
 *
 * The receiver's top-query plans are generic NULL-bound ESTIMATES for a query
 * nobody executed; auto_explain captures the plan Postgres ACTUALLY ran. It is
 * optional because it has a real cost: with `log_analyze = on` the executor
 * instruments every statement it CONSIDERS, not only the ones it logs —
 * `log_min_duration` controls what is WRITTEN, `sample_rate` controls what PAYS.
 *
 * `shared_preload_libraries` here REPLACES the logging step's line: it is a
 * comma list, and dropping `pg_stat_statements` from it silently kills the
 * entire top-query path. Same restart as the logging step.
 *
 * `compute_query_id` + `qid=%Q` gives every log line the server's own queryid —
 * a second, exact join key to top-query rows. The collector regex treats `qid=`
 * as optional, so configs without this step keep parsing.
 */
export const PG_DBM_AUTO_EXPLAIN_CONF = `# OPTIONAL: capture the plans Postgres ACTUALLY executed (auto_explain).
# REPLACES the shared_preload_libraries line from the logging step — this is a
# comma list; dropping pg_stat_statements from it kills server top queries.
shared_preload_libraries = 'pg_stat_statements,auto_explain'
# Log the executed plan of any statement slower than this. Volume control, NOT
# a cost control: instrumentation is armed before the statement runs, so
# raising this saves log volume without saving executor overhead -- that is
# sample_rate's job.
auto_explain.log_min_duration = '2s'
# The parser reads JSON — other formats are silently unparseable.
auto_explain.log_format = json
# Real row counts and a real total duration. This is the knob with executor
# overhead: every statement CONSIDERED pays it, not only the ones logged. Off
# gives plan capture at effectively zero overhead (the plan stays real; you
# lose actual-rows and duration).
auto_explain.log_analyze = on
# Per-NODE timings read the clock twice per node per tuple — leave OFF unless
# pg_test_timing shows tens of nanoseconds per loop.
auto_explain.log_timing = off
# Block counts are free once log_analyze is on; hit-vs-read is often the answer.
auto_explain.log_buffers = on
# One plan per statement inside function bodies — off unless you live in PL/pgSQL.
auto_explain.log_nested_statements = off
# THE actual cost control on a busy primary: 0.01 = 1% of statements pay for
# the instrumentation log_analyze arms. 1.0 means EVERY statement considered
# pays -- a diagnosis window on an instance you are actively investigating,
# never a monitoring default.
auto_explain.sample_rate = 0.01
# Exact plan-to-query join key: stamps the server's queryid on every log line.
compute_query_id = on
log_line_prefix = '%m [%p] %q%u@%d app=%a vxid=%v txid=%x line=%l qid=%Q '`;

/**
 * The closing "what you just unlocked" step.
 *
 * `pages` differs per engine because the tabs an engine can actually fill
 * differ — pointing a user at a tab their config can never populate is the
 * "collecting but empty" trap:
 *  - "full"  — deadlocks, blocking AND the receiver's activity/top-query feeds.
 *  - "both"  — deadlocks + blocking only, for a config that ships no `events:`
 *    receiver. No shipped card is on this value; the honest answer for a future
 *    engine without receiver events is an absent pill.
 *  - "blocking" — blocking only.
 *
 * `tableHealth` adds the Table health pill — a separate flag because the two
 * axes are independent.
 *
 * `tableHealthWait` is how long that first snapshot ACTUALLY takes: MySQL and
 * MariaDB run the table/index recipes at 60s, Postgres at 300s. Promising a
 * Postgres user data four minutes before it can exist reads as a broken
 * collector.
 */
export function dbmVerifyStep(
  pages: "both" | "blocking" | "full" = "both",
  tableHealth = false,
  tableHealthWait: "60s" | "300s" = "60s",
  plans: "mysqlFloor" | "noSampleText" | "plain" = "mysqlFloor",
): RichCardStep {
  // The wait and the plan caveat are baked into the key rather than
  // interpolated: `descriptionKey` takes no params and this module has no `t`
  // of its own — it returns keys, never sentences.
  //   - "mysqlFloor"    — MySQL: estimated plans need 8.0.22 or newer.
  //   - "noSampleText"  — MariaDB: plans work, but the receiver reports
  //                       supports_query_sample_text: false, so an Activity row
  //                       carries no SQL. Stated up front so an empty query
  //                       column reads as a documented gap, not a broken setup.
  //   - "plain"         — Postgres and SQL Server: plans, no engine caveat.
  const slowTableHealth = tableHealth && tableHealthWait === "300s";
  const descriptionKey =
    pages === "blocking"
      ? "ingestion.setupCard.dbmVerifyBlockingDesc"
      : pages === "full"
        ? slowTableHealth
          ? "ingestion.setupCard.dbmVerifyFullSlowTableHealthDesc"
          : plans === "noSampleText"
            ? "ingestion.setupCard.dbmVerifyFullNoSampleTextDesc"
            : plans === "plain"
              ? "ingestion.setupCard.dbmVerifyFullPlainPlansDesc"
              : "ingestion.setupCard.dbmVerifyFullDesc"
        : tableHealth
          ? "ingestion.setupCard.dbmVerifyTableHealthDesc"
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

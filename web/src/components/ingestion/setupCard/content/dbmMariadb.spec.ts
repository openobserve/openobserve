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
import { MARIADB_DBM_CONFIG_YAML, MYSQL_DBM_CONFIG_YAML } from "./dbmShared";
import mariadbCard from "./mariadb";

const SUBS = { url: "https://test.openobserve.ai", org: "test-org", token: "dGVzdEB0b2tlbg==" };

/**
 * The MySQL router's fallback route decides what counts as a deadlock when the
 * error code is absent. A bare case-insensitive `deadlock` substring catches
 * any log line that MERELY MENTIONS the word — reproduced against the real
 * collector with a genuine MySQL note:
 *
 *   [Warning] [MY-013360] Plugin mysql_native_password reported:
 *     "deadlock avoidance is deprecated"
 *
 * That line was stamped `o2_my_event=deadlock`, passed `filter/dbm`, and landed
 * in the DBM stream. It carries no `my_trx_side`, no `my_trx_query` and no
 * victim, so `canonicalize_innodb_deadlock` returns None — the row stores,
 * reads back invisible, and still gets scanned. Four records survived where
 * three were real.
 *
 * This file's own commentary already named the risk as the reason MariaDB is
 * not merged into the MySQL receiver: loosening the regex "would let its
 * fallback deadlock-text branch start catching MySQL notes that merely MENTION
 * deadlocks". The branch was already loose.
 */
describe("the MySQL deadlock fallback does not fire on the word alone", () => {
  it("anchors on an InnoDB deadlock marker, not a bare substring", () => {
    expect(
      MYSQL_DBM_CONFIG_YAML,
      "a bare `(?i)deadlock` match stamps every line that mentions the word",
    ).not.toMatch(/matches "\(\?i\)deadlock"/);
  });

  it("still recognises a real InnoDB deadlock report", () => {
    // The markers InnoDB actually writes. MariaDB's receiver anchors on these
    // same strings, which is the precedent being followed.
    expect(MYSQL_DBM_CONFIG_YAML).toMatch(/TRANSACTION|deadlock detected|WE ROLL BACK TRANSACTION/);
  });

  it("keeps the error-code route, which needs no text matching at all", () => {
    expect(MYSQL_DBM_CONFIG_YAML).toMatch(/MY-012468/);
    expect(MYSQL_DBM_CONFIG_YAML).toMatch(/MY-012469/);
  });
});

// These assert the generated collector config directly. Every expectation
// below was verified by running this exact config through collector-contrib
// 0.158.0 against the rig's live MariaDB — see
// tests/dbm-server-vantage/captures/README.md.
describe("MariaDB Database Monitoring config", () => {
  const config = MARIADB_DBM_CONFIG_YAML;

  it("uses MariaDB-specific receivers, never MySQL's", () => {
    expect(config).toContain("sqlquery/mariadb_locks");
    expect(config).toContain("filelog/mariadb_deadlocks");
    // Sharing MySQL's receivers is the trap: detect_engine maps the
    // `mysql_lock_waits` tag and every `my_*` key straight to "mysql", so
    // MariaDB rows would be filed under the wrong server — and because the
    // deadlock stitch groups on (engine, instance, database) with "" defaults,
    // two different servers' sides could merge into one fabricated deadlock.
    expect(config).not.toContain("sqlquery/mysql_locks");
    expect(config).not.toContain("filelog/mysql_deadlocks");
    expect(config).not.toContain("'mysql_lock_waits'");
    expect(config).toContain("'mariadb_lock_waits'");
  });

  it("matches MariaDB's log envelope, not MySQL's", () => {
    // Space separator, no `T`, no fractional seconds, no [MY-nnnnnn] code —
    // MariaDB 11.8 writes `2026-08-10  8:56:56 14 [Note] InnoDB: …`.
    expect(config).toContain("maria_message");
    expect(config).toContain('layout: "%Y-%m-%d %H:%M:%S"');
    // The vendor literal that makes the MySQL regex return zero matches here.
    expect(config).toContain("MariaDB thread id");
    expect(config).not.toContain("MySQL thread id");
  });

  it("routes the per-side TRANSACTION blocks, not just the banner and verdict", () => {
    // THE REGRESSION THIS FILE EXISTS FOR. MariaDB writes each side as
    // CONTINUATION lines under an entry whose own text is a bare "InnoDB:" —
    // that entry contains neither "Transactions deadlock detected" nor
    // "WE ROLL BACK TRANSACTION". Routing on only those two phrases captured
    // the verdict and silently DROPPED BOTH SIDES, producing deadlocks with no
    // participants. Caught by running the real config against the real server.
    expect(config).toMatch(/matches "\\+\*\\+\*\\+\* \\+\(\\+d\+\\+\) TRANSACTION:"/);
    expect(config).toContain("Transactions deadlock detected");
    expect(config).toContain("WE ROLL BACK TRANSACTION");
  });

  it("keeps MariaDB events through the filter", () => {
    // o2_maria_event is a distinct key from o2_my_event by design, so the
    // filter must name it explicitly or every MariaDB deadlock is dropped
    // while the pipeline still reports healthy.
    expect(config).toContain('attributes["o2_maria_event"]');
    expect(config).toContain("stream-name: dbm_server");
    expect(config).toContain("processors: [memory_limiter, filter/dbm, batch]");
  });

  // THE REGRESSION THIS BLOCK EXISTS FOR. The blocking query was a verbatim
  // copy of MySQL's, justified by a comment claiming the two servers carry
  // "identical names and semantics". They do not: performance_schema
  // .data_lock_waits is a MySQL 8.0 table MariaDB never adopted — it kept the
  // pre-8.0 information_schema.INNODB_LOCK_WAITS. Verified against MariaDB
  // 11.8.8 at collector v0.158.0, the shipped query failed EVERY collection
  // cycle with "Error 1146 (42S02): Table 'performance_schema.data_lock_waits'
  // doesn't exist" — silently, because a scrape error leaves the pipeline green
  // and only makes the Blocked queries tab permanently empty.
  it("reads MariaDB's own lock tables, never MySQL 8.0's", () => {
    expect(config).toContain("information_schema.INNODB_LOCK_WAITS");
    expect(config).not.toContain("performance_schema.data_lock_waits");
  });

  it("keeps the column contract canonicalize_blocking reads", () => {
    // The FROM clause differs from MySQL's; the emitted columns must not, or
    // the shared engine-agnostic parser would need a MariaDB branch.
    for (const column of [
      "waiting_trx",
      "blocking_trx",
      "waiting_thread",
      "blocking_thread",
      "waiting_query",
      "blocking_query",
      "waiting_state",
      "blocking_state",
      "wait_secs",
    ]) {
      expect(config, `blocking column ${column} must survive`).toContain(column);
    }
  });

  it("captures the fields canonicalize_mariadb_deadlock reads", () => {
    for (const field of [
      "maria_trx_side",
      "maria_trx_id",
      "maria_trx_thread",
      "maria_trx_query",
      "maria_victim_side",
      "maria_lock_mode",
      "maria_lock_table",
    ]) {
      expect(config).toContain(field);
    }
  });

  // Tier honesty: NO `mariadbreceiver` exists in collector-contrib, so there
  // are no activity/top-query events to enable — an events: block here would
  // reference a receiver that does not exist, and the card copy states the
  // gap instead of implying parity with MySQL.
  it("ships no receiver-native events, because no MariaDB receiver exists upstream", () => {
    expect(config).not.toContain("db.server.query_sample");
    expect(config).not.toContain("db.server.top_query");
    expect(config).not.toContain("logs/dbm_events");
  });
});

describe("MariaDB setup card honesty copy", () => {
  const card = mariadbCard(SUBS);

  // THE REGRESSION THIS BLOCK EXISTS FOR. The grant note used to claim the
  // blocking recipe reads performance_schema.data_lock_waits and "needs
  // MariaDB 10.6 or newer" — the recipe was FIXED to read MariaDB's own
  // information_schema.INNODB_LOCK_WAITS precisely because data_lock_waits
  // does not exist on MariaDB at all, and the note kept describing the bug.
  it("describes the lock view the recipe actually reads", () => {
    const grant = card.steps.find((s) => s.id === "dbm-grant")!;
    const note = grant.variants!.find((v) => v.id === "mariadb")!.note!;
    expect(note).toContain("information_schema.INNODB_LOCK_WAITS");
    expect(note).not.toMatch(/needs MariaDB 10\.6/);
  });

  // Log tailing cannot work on managed MariaDB, and the missing
  // activity/top-queries/plans are an upstream receiver gap.
  it("states the managed-database limit and the tier scope", () => {
    const note = card.steps.find((s) => s.id === "dbm-configure")!.note!;
    expect(note).toMatch(/RDS/);
    expect(note).toMatch(/not available/i);
    expect(note).toMatch(/blocking chains work there normally/i);
    expect(note).toMatch(/upstream OpenTelemetry Collector Contrib/i);
    // No Activity pill on the verify step — there is no receiver to fill it.
    // Table health IS promised: the mariadb_table_stats/mariadb_index_stats
    // recipes ship in this config.
    const verify = card.steps.find((s) => s.id === "verify-dbm")!;
    expect(verify.pills).toEqual(["Deadlocks", "Blocked queries", "Table health"]);
  });

  // The idx_scan gap is a scoped honesty note, not a footnote: MariaDB ships
  // with performance_schema off, so index USAGE counts are not collected and
  // the note must say so before the user goes looking for them.
  it("states the performance_schema index-usage limitation", () => {
    const note = card.steps.find((s) => s.id === "dbm-configure")!.note!;
    expect(note).toMatch(/performance_schema/);
    expect(note).toMatch(/usage/i);
  });
});

/**
 * THE MARIADB TABLE/INDEX HEALTH CONTRACT — the twins of the MySQL recipes
 * with their own engine tags. Same aliases as Postgres's by design (the
 * backend reads ONE set of names; the tag names the engine), pinned in
 * lockstep exactly as Postgres.spec.ts and MySQL.spec.ts pin theirs.
 */
describe("MariaDB table and index health recipes", () => {
  const config = MARIADB_DBM_CONFIG_YAML;

  it("ships both receivers, in the pipeline, under MariaDB's own tags", () => {
    expect(config).toContain("sqlquery/mariadb_table_stats:");
    expect(config).toContain("sqlquery/mariadb_index_stats:");
    const pipeline = config.split("service:")[1]!;
    expect(pipeline).toContain("sqlquery/mariadb_table_stats");
    expect(pipeline).toContain("sqlquery/mariadb_index_stats");

    // Its own tags — 'mysql_table_stats' here would file every MariaDB table
    // under MySQL on the fleet view and the ?system= filter.
    expect(config).toContain("'mariadb_table_stats'");
    expect(config).toContain("'mariadb_index_stats'");
    expect(config).not.toContain("'mysql_table_stats'");
    expect(config).not.toContain("'mysql_index_stats'");
  });

  it("keeps the table-stats column contract the canonicalizer reads", () => {
    expect(config).toContain("body_column: table_name");
    const tableAttrs = config.match(
      /body_column: table_name\s+attribute_columns:\s+\[([^\]]+)\]/,
    )![1];
    for (const alias of [
      "schema_name",
      "total_bytes",
      "heap_bytes",
      "n_live_tup",
      "last_analyze",
      "server_address",
      "o2_recipe",
    ]) {
      expect(tableAttrs, `table alias ${alias} must ride as an attribute`).toContain(alias);
    }
  });

  // THE LOAD-BEARING OMISSION. performance_schema is OFF by default on
  // MariaDB, so a COUNT_READ join COALESCEd to 0 would stamp idx_scan = 0 —
  // the never-scanned FINDING — on every index of every MariaDB server,
  // fabricated from a table that was never populated. The recipe must omit
  // the join and the column entirely; the backend stores absent as absent.
  it("omits idx_scan entirely rather than fabricating a zero", () => {
    const indexReceiver = config.split("sqlquery/mariadb_index_stats:")[1]!.split("filelog")[0]!;
    expect(indexReceiver).not.toContain("idx_scan");
    expect(indexReceiver).not.toContain("performance_schema.table_io_waits_summary_by_index_usage");

    expect(config).toContain("body_column: index_def");
    const indexAttrs = config.match(
      /body_column: index_def\s+attribute_columns:\s+\[([^\]]+)\]/,
    )![1];
    for (const alias of [
      "schema_name",
      "table_name",
      "index_name",
      "index_bytes",
      "is_unique",
      "server_address",
      "o2_recipe",
    ]) {
      expect(indexAttrs, `index alias ${alias} must ride as an attribute`).toContain(alias);
    }
    expect(indexAttrs).not.toContain("idx_scan");
  });
});

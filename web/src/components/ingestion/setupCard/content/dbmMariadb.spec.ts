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

import { MARIADB_DBM_CONFIG_YAML, MYSQL_DBM_CONFIG_YAML } from "./dbmShared";
import mariadbCard from "./mariadb";

const SUBS = { url: "https://test.openobserve.ai", org: "test-org", token: "dGVzdEB0b2tlbg==" };

/**
 * The MySQL router's fallback route decides what counts as a deadlock when the
 * error code is absent. A bare case-insensitive `deadlock` substring would also
 * catch log lines that merely mention the word (for example the
 * `mysql_native_password` "deadlock avoidance is deprecated" note). Such a line
 * carries no `my_trx_side`, no `my_trx_query` and no victim, so
 * `canonicalize_innodb_deadlock` returns None and the row stores, reads back
 * invisible, and still gets scanned.
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

// These assert the generated collector config directly. The expectations were
// verified against collector-contrib 0.158.0 and a live MariaDB — see
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
    // MariaDB writes each side as continuation lines under an entry whose own
    // text is a bare "InnoDB:", containing neither "Transactions deadlock
    // detected" nor "WE ROLL BACK TRANSACTION". Routing on only those two
    // phrases captures the verdict but drops both sides, yielding deadlocks
    // with no participants.
    expect(config).toMatch(/matches "\\+\*\\+\*\\+\* \\+\(\\+d\+\\+\) TRANSACTION:"/);
    expect(config).toContain("Transactions deadlock detected");
    expect(config).toContain("WE ROLL BACK TRANSACTION");
  });

  it("keeps MariaDB events through the filter", () => {
    // o2_maria_event is a distinct key from o2_my_event by design, so the
    // filter must name it explicitly or every MariaDB deadlock is dropped
    // while the pipeline still reports healthy.
    expect(config).toContain('attributes["o2_maria_event"]');
    expect(config).toContain("stream-name: _o2_dbm_server");
    expect(config).toContain("processors: [memory_limiter, filter/dbm, batch]");
  });

  // MySQL's blocking query does not port: performance_schema.data_lock_waits
  // is a MySQL 8.0 table MariaDB never adopted — it kept the pre-8.0
  // information_schema.INNODB_LOCK_WAITS. Reading the MySQL table fails every
  // collection cycle with "Error 1146 (42S02)", silently: a scrape error leaves
  // the pipeline green and only makes the Blocked queries tab permanently
  // empty.
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

  /**
   * Activity and top queries come from `mysqlreceiver`: there is no
   * `mariadbreceiver`, and none is needed — MariaDB speaks the MySQL wire
   * protocol and the receiver identifies the product correctly.
   *
   * The trap this pins is silent: upstream v0.148.0 made both events
   * default-OFF, so without the `events:` block the collector starts clean,
   * reports itself healthy and emits zero events with no warning at all.
   */
  it("ships the receiver's activity and top-query events on, spelled out", () => {
    expect(config).toContain("mysql/dbm_events:");
    expect(config).toContain("db.server.query_sample: { enabled: true }");
    expect(config).toContain("db.server.top_query: { enabled: true }");

    // `events:` must be TOP-LEVEL on the receiver (a sibling of the collection
    // blocks) — nesting it inside them is a fatal config error.
    expect(config).toMatch(/\n {4}events:\n/);

    // mysqlreceiver's spelling, not Postgres's: `top_query_count`, and it
    // REJECTS max_rows_per_query inside top_query_collection. These blocks are
    // strictly key-validated, so a borrowed key kills the collector at startup.
    expect(config).toContain("top_query_count:");
    expect(config).not.toMatch(/top_query_collection:[\s\S]{0,200}max_rows_per_query/);

    // The events pipeline must BYPASS filter/dbm: receiver-native events carry
    // no o2_recipe / o2_*_event tag (the backend recognises them by their OTLP
    // event name), so the filter would silently drop every one. memory_limiter
    // must still be FIRST — anything ahead of it runs outside the OOM guard.
    expect(config).toMatch(/logs\/dbm_events:\n\s+receivers: \[mysql\/dbm_events\]/);
    const eventsProcessors = config.match(/logs\/dbm_events:[\s\S]*?processors: \[([^\]]+)\]/)![1];
    expect(eventsProcessors).not.toContain("filter/dbm");
    expect(eventsProcessors.split(",")[0]!.trim()).toBe("memory_limiter");
  });

  /**
   * `mysqlreceiver` stamps `db.system.name: mysql` on its events even when the
   * server it scraped is MariaDB, while the sqlquery recipes on this same card
   * stamp `mariadb` through their own tags. Without a correction one server
   * answers to two engines and appears twice in the fleet list.
   *
   * Both levels are set: the record-level attribute is what the log record
   * carries, the resource-level one what the resource it belongs to claims.
   * Setting only one leaves the other saying "mysql".
   */
  it("corrects the engine mysqlreceiver stamps, on the events pipeline only", () => {
    // Declared…
    expect(config).toContain("transform/mariadb_engine:");
    expect(config).toContain('set(attributes["db.system.name"], "mariadb")');
    expect(config).toContain('set(resource.attributes["db.system.name"], "mariadb")');

    // …AND referenced. A processor declared but never named in a pipeline does
    // nothing at all.
    const eventsProcessors = config.match(/logs\/dbm_events:[\s\S]*?processors: \[([^\]]+)\]/)![1];
    expect(eventsProcessors).toContain("transform/mariadb_engine");

    // NOT on the recipe pipeline: those rows already carry MariaDB's own tags,
    // so the transform would be dead weight there.
    const mainProcessors = config.match(/\n {4}logs:\n[\s\S]*?processors: \[([^\]]+)\]/)![1];
    expect(mainProcessors).not.toContain("transform/mariadb_engine");

    // And nothing anywhere may re-stamp this lane as mysql.
    expect(config).not.toContain('set(attributes["db.system.name"], "mysql")');
  });
});

describe("MariaDB setup card honesty copy", () => {
  const card = mariadbCard(SUBS, gt);

  // The grant note must name the lock view the recipe actually reads:
  // MariaDB's own information_schema.INNODB_LOCK_WAITS, not
  // performance_schema.data_lock_waits, which does not exist on MariaDB.
  it("describes the lock view the recipe actually reads", () => {
    const grant = card.steps.find((s) => s.id === "dbm-grant")!;
    const note = grant.variants!.find((v) => v.id === "mariadb")!.note!;
    expect(note).toContain("information_schema.INNODB_LOCK_WAITS");
    expect(note).not.toMatch(/needs MariaDB 10\.6/);
  });

  // Log tailing cannot work on managed MariaDB, so the RDS caveat is scoped to
  // deadlocks alone: activity, top queries and plans come from the borrowed
  // mysqlreceiver, which polls rather than tails and so works there too.
  it("states the managed-database limit and the tier scope", () => {
    const note = card.steps.find((s) => s.id === "dbm-configure")!.note!;
    expect(note).toMatch(/RDS/);
    expect(note).toMatch(/not available/i);
    expect(note).toMatch(/blocking chains, activity samples and top queries work there normally/i);
    expect(note).toMatch(/upstream OpenTelemetry Collector Contrib/i);
    // Every pill this config can actually fill.
    const verify = card.steps.find((s) => s.id === "verify-dbm")!;
    expect(verify.pills).toEqual(["Deadlocks", "Blocked queries", "Activity", "Table health"]);
  });

  // The sample-text gap is the ONE honest limit left, and it is the receiver's
  // own disclosure (supports_query_sample_text: false), not our guess. Stated
  // up front so an Activity row with an empty query column reads as a
  // documented MariaDB limit rather than a broken collector.
  it("discloses that MariaDB activity rows carry no statement text", () => {
    const note = card.steps.find((s) => s.id === "dbm-configure")!.note!;
    expect(note).toMatch(/does not expose the sampled statement text/i);
    const verify = card.steps.find((s) => s.id === "verify-dbm")!;
    expect(verify.descriptionKey).toBe("ingestion.setupCard.dbmVerifyFullNoSampleTextDesc");
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
 * The MariaDB table/index health recipes: twins of the MySQL ones under their
 * own engine tags. They share Postgres's column aliases by design — the backend
 * reads one set of names and the tag names the engine.
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

  // performance_schema is off by default on MariaDB, so a COUNT_READ join
  // COALESCEd to 0 would stamp idx_scan = 0 — the never-scanned finding — on
  // every index of every MariaDB server, fabricated from a table that was
  // never populated. The recipe omits the join and the column entirely; the
  // backend stores absent as absent.
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

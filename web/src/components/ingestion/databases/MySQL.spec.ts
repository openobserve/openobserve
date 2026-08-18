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

import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { createStore } from "vuex";
import { createI18n } from "vue-i18n";
import { ref } from "vue";
import MySQL from "./MySQL.vue";
import mysqlCard from "@/components/ingestion/setupCard/content/mysql";
import { getDataSourceCard } from "@/components/ingestion/setupCard/registry";
import { gt } from "@/types/i18n";

const mockEndpoint = ref({
  url: "https://test.openobserve.ai",
  host: "h",
  port: 443,
  protocol: "https",
  tls: true,
});
vi.mock("@/composables/useIngestion", () => ({
  default: vi.fn(() => ({ endpoint: mockEndpoint })),
}));
vi.mock("@/components/ingestion/setupCard/SetupCardRenderer.vue", () => ({
  default: {
    name: "SetupCardRenderer",
    props: ["content", "subs", "logoUrl", "logoUrlDark"],
    template: '<div data-test="rich-card-stub" />',
  },
}));

const mockStore = createStore({
  state: {
    selectedOrganization: { identifier: "test-org" },
    userInfo: { email: "test@example.com" },
    organizationData: { organizationPasscode: "pc" },
    theme: "light",
  },
});
const mockI18n = createI18n({ locale: "en", messages: { en: {} } });
const SUBS = { url: "https://test.openobserve.ai", org: "test-org", token: "dGVzdEB0b2tlbg==" };

describe("mysqlCard builder", () => {
  it("builds metadata + step flow", () => {
    const card = mysqlCard(SUBS, gt);
    expect(card.provider.name).toBe("MySQL");
    // Logs too: the optional Database Monitoring steps ship deadlock and
    // blocking events into the dbm_server logs stream.
    expect(card.provider.metaBadges).toEqual(["Metrics", "Logs"]);
    expect(card.detect).toMatchObject({
      streamType: "metrics",
      match: "keyword",
      streamName: "mysql",
    });
    expect(card.steps.map((s) => s.id)).toEqual([
      "prepare",
      "install",
      "configure",
      "run",
      "verify",
      "dbm-grant",
      "dbm-configure",
      "dbm-run",
      "verify-dbm",
    ]);
  });

  // Field names here are a CONTRACT with server_vantage.rs — see the Postgres
  // spec for the same reasoning.
  it("ships a Database Monitoring config the ingest parser can read", () => {
    const card = mysqlCard(SUBS);

    // Without this, MySQL keeps only the most recent deadlock and history is
    // lost before the collector can read it.
    const grant = card.steps.find((s) => s.id === "dbm-grant")!;
    expect(grant.variants!.find((v) => v.id === "mysql")!.code.raw).toContain(
      "innodb_print_all_deadlocks",
    );

    const configure = card.steps.find((s) => s.id === "dbm-configure")!;
    expect(configure.inputs?.map((i) => i.id)).toEqual(["database", "logpath"]);

    const config = configure.variants!.find((v) => v.id === "linux-amd64")!.code.raw;
    expect(config).toContain("dbm-config.yaml");
    expect(config).toContain("sqlquery/mysql_locks");
    expect(config).toContain("filelog/mysql_deadlocks");
    // The exact keys server_vantage.rs matches on.
    expect(config).toContain("mysql_lock_waits");
    expect(config).toContain("blocking_query");
    expect(config).toContain("my_trx_side");
    expect(config).toContain("o2_my_event");
    expect(config).toContain("stream-name: dbm_server");
    // The filter is load-bearing: filelog tails the WHOLE database log, so
    // without it every ordinary log line lands in dbm_server too (measured:
    // 787 events vs 4.8M untagged rows in one hour) and the Deadlocks page
    // slows to a crawl. A processor that is defined but not listed in the
    // pipeline does nothing, so both are asserted.
    expect(config).toContain("filter/dbm:");
    expect(config).toContain("processors: [memory_limiter, filter/dbm, batch]");

    const run = card.steps.find((s) => s.id === "dbm-run")!;
    expect(run.code!.raw).toContain("--config ./config.yaml");
    expect(run.code!.raw).toContain("--config ./dbm-config.yaml");
  });

  /**
   * THE v0.148.0 EVENTS BLOCK, SHIPPED ON — upstream flipped both events to
   * default-OFF at v0.148.0, so the block is the switch that turns collection
   * on, and the server now accepts both feeds whenever Database Monitoring is
   * enabled (the per-signal `ZO_DB_MONITORING_*_ENABLED` knobs are gone, so
   * there is no second switch to pair). The block itself must be present and
   * top-level, where nesting it deeper is a fatal config error.
   */
  it("ships the receiver's activity and top-query events on, spelled out", () => {
    const card = mysqlCard(SUBS);
    const configure = card.steps.find((s) => s.id === "dbm-configure")!;
    const config = configure.variants!.find((v) => v.id === "linux-amd64")!.code.raw;

    expect(config).toContain("mysql/dbm_events:");
    expect(config).toContain("db.server.query_sample: { enabled: true }");
    expect(config).toContain("db.server.top_query: { enabled: true }");
    // MySQL spells it top_query_count (postgres says top_n_query), and rejects
    // max_rows_per_query inside top_query_collection — verified at v0.158.0,
    // where an unknown key is a fatal config error.
    expect(config).toContain("top_query_count:");
    expect(config).not.toMatch(/top_query_collection:[\s\S]{0,200}max_rows_per_query/);

    // `events:` must be TOP-LEVEL on the receiver (sibling of the collection
    // blocks) — nesting it deeper is a fatal config error.
    expect(config).toMatch(/\n {4}events:\n/);

    // The events pipeline must BYPASS filter/dbm: receiver-native events carry
    // no o2_recipe tag, so the filter would silently drop every one of them.
    // It must still sit behind memory_limiter, and memory_limiter must be
    // FIRST — a processor listed ahead of it runs outside the OOM guard.
    expect(config).toMatch(/logs\/dbm_events:\n\s+receivers: \[mysql\/dbm_events\]/);
    expect(config).toMatch(/logs\/dbm_events:[\s\S]*?processors: \[memory_limiter, batch\]/);
    const eventsProcessors = config.match(/logs\/dbm_events:[\s\S]*?processors: \[([^\]]+)\]/)![1];
    expect(eventsProcessors).not.toContain("filter/dbm");

    // Same as the Postgres card: with the server always accepting the feeds,
    // prescribing an environment variable would send the user to set a knob
    // that no longer exists. The note states the block is the one switch.
    expect(configure.note).not.toContain("ZO_DB_MONITORING_ACTIVITY_ENABLED");
    expect(configure.note).not.toContain("ZO_DB_MONITORING_TOP_QUERY_ENABLED");
    expect(configure.note).toMatch(/enabled: true/);

    // The verify step now promises the Activity and Table health tabs too.
    const verify = card.steps.find((s) => s.id === "verify-dbm")!;
    expect(verify.pills).toEqual(["Deadlocks", "Blocked queries", "Activity", "Table health"]);
  });

  /**
   * THE CONNECTION-LIMIT RECIPE. mysqlreceiver publishes no max_connections,
   * so without this sqlquery receiver every MySQL row on the Databases page is
   * permanently a count with no denominator. The join is dead unless
   * `mysql_instance_endpoint` is BOTH projected by the SQL and listed in
   * attribute_columns (instanceMetricsRead.ts marks the stream unreadable when
   * its identity column is missing), so the shape is pinned, not just the
   * receiver's presence.
   */
  it("ships a metrics-mode limits recipe whose endpoint column can join", () => {
    const card = mysqlCard(SUBS);
    const configure = card.steps.find((s) => s.id === "configure")!;
    const config = configure.variants!.find((v) => v.id === "linux-amd64")!.code.raw;

    // Defined AND in the metrics pipeline.
    expect(config).toContain("sqlquery/mysql_limits:");
    expect(config).toMatch(/metrics:\n\s+receivers: \[mysql, sqlquery\/mysql_limits\]/);

    // The gauge that lands as the `mysql_connection_max` stream — the twin of
    // postgresql_connection_max in the instance-metrics catalog.
    expect(config).toContain("metric_name: mysql.connection.max");
    expect(config).toContain("value_column: max_connections");
    expect(config).toContain("data_type: gauge");
    expect(config).toContain("value_type: int");

    // The join key: projected in the SQL and carried as an attribute.
    expect(config).toMatch(/AS mysql_instance_endpoint/);
    expect(config).toContain("attribute_columns: [mysql_instance_endpoint]");

    // The datasource reads env the run step must therefore set.
    const run = card.steps.find((s) => s.id === "run")!;
    expect(run.code!.raw).toContain("MYSQL_USER=");
    expect(run.code!.raw).toContain("MYSQL_PASSWORD=");
  });

  /**
   * THE TABLE/INDEX HEALTH CONTRACT — the MySQL twins of the Postgres recipes.
   * Same aliases by design (`canonicalize_table_stats` reads ONE set of names
   * and the tag names the engine), so each alias is pinned in lockstep exactly
   * as the Postgres spec pins its own.
   */
  it("ships the table and index health recipes with every alias the canonicalizers read", () => {
    const card = mysqlCard(SUBS);
    const configure = card.steps.find((s) => s.id === "dbm-configure")!;
    const config = configure.variants!.find((v) => v.id === "linux-amd64")!.code.raw;

    expect(config).toContain("sqlquery/mysql_table_stats:");
    expect(config).toContain("sqlquery/mysql_index_stats:");
    const pipeline = config.split("service:")[1]!;
    expect(pipeline).toContain("sqlquery/mysql_table_stats");
    expect(pipeline).toContain("sqlquery/mysql_index_stats");

    // The engine-naming tags — 'mysql_table_stats', never the pg_ ones, or
    // detect_engine files every MySQL table under Postgres.
    expect(config).toContain("'mysql_table_stats'");
    expect(config).toContain("'mysql_index_stats'");

    // The identity split: table name in body, index identity in the attribute.
    expect(config).toContain("body_column: table_name");
    expect(config).toContain("body_column: index_def");

    // The table aliases MySQL can honestly emit. NO dead-tuple/vacuum/xid
    // aliases: InnoDB has no source for them, and a zeroed column would render
    // "0% bloat" about a measurement that never happened.
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
    expect(tableAttrs).not.toContain("dead_tup_pct");
    expect(tableAttrs).not.toContain("frozen_xid_age");

    // The index aliases, idx_scan included — performance_schema's
    // table_io_waits summary is ON by default on MySQL 8 (unlike MariaDB).
    const indexAttrs = config.match(
      /body_column: index_def\s+attribute_columns:\s+\[([^\]]+)\]/,
    )![1];
    for (const alias of [
      "schema_name",
      "table_name",
      "index_name",
      "idx_scan",
      "index_bytes",
      "is_unique",
      "server_address",
      "o2_recipe",
    ]) {
      expect(indexAttrs, `index alias ${alias} must ride as an attribute`).toContain(alias);
    }
  });

  /**
   * `max_rows_per_query` IS NOT SHARED BETWEEN THE TWO RECEIVERS. Upstream's
   * mysqlreceiver default is 100; postgresqlreceiver's is 1000. This block
   * carried the Postgres number, which is a value that travelled across from
   * PG_EVENTS_RECEIVER rather than one chosen for MySQL — and the file already
   * documents, six lines from the value, that the two receivers diverge
   * (mysql spells it `top_query_count` and REJECTS `max_rows_per_query` inside
   * `top_query_collection`). The asymmetry was known; this value just did not
   * follow it.
   *
   * It bounds rows read from `performance_schema` per sample, so the revert
   * cuts both the activity ceiling and the per-tick read 10× (360,000 → 36,000
   * rows/hour/instance at a 10s interval). The rig runs at ~0.5% of that
   * ceiling, so a healthy fleet sees no change in what the Activity tab shows.
   *
   * Pinned against Postgres's own value too: the failure this guards is not a
   * wrong number, it is the two receivers being edited as though they were one.
   */
  it("ships mysqlreceiver's own max_rows_per_query, not the Postgres receiver's", () => {
    const card = mysqlCard(SUBS);
    const configure = card.steps.find((s) => s.id === "dbm-configure")!;
    const config = configure.variants!.find((v) => v.id === "linux-amd64")!.code.raw;

    const events = config.slice(config.indexOf("mysql/dbm_events:"));
    expect(events).toContain("max_rows_per_query: 100");
    // Postgres's default, and the value that was shipped here by mistake.
    expect(events).not.toContain("max_rows_per_query: 1000");
    // Still inside query_sample_collection, never top_query_collection — the
    // mysql receiver rejects it there and an unknown key is a fatal error.
    expect(events).toMatch(/query_sample_collection:\s*\n\s*(?:#[^\n]*\n\s*)*max_rows_per_query/);

    // The cadence deviation is recorded here too (spec §5.3): it multiplies
    // every per-cycle cost, so an "align with upstream" pass must not revert
    // it silently alongside the block's other knobs.
    expect(events).toContain("collection_interval: 15s");
    expect(events).toMatch(/DELIBERATE DEVIATION FROM UPSTREAM/);
    expect(events).toMatch(/60s/);
  });

  /**
   * THE CONNECTION BUDGET and THE COLLECTOR SELF-PROTECTION — the MySQL side of
   * two guards that live in the shared config generator, so the Postgres spec
   * carries the full reasoning and this pins that MySQL's config got them too.
   * They are worth asserting per engine because both are generated once but
   * shipped four times, and an engine dropping out of the generator is exactly
   * the kind of regression a single-engine test cannot see.
   *
   * `max_open_conn` is SINGULAR: the plural is not a key sqlqueryreceiver knows
   * and is silently ignored, so it reads like a bound and enforces nothing.
   * `memory_limiter` must be FIRST in every pipeline — it guards only what is
   * upstream of it.
   */
  it("caps connections and protects the collector on the MySQL config too", () => {
    const card = mysqlCard(SUBS);
    const configure = card.steps.find((s) => s.id === "dbm-configure")!;
    const config = configure.variants!.find((v) => v.id === "linux-amd64")!.code.raw;

    const receivers = config.match(/^ {2}sqlquery\/\w+:/gm) ?? [];
    expect(receivers.length).toBe(3);
    expect(config.match(/^ {4}max_open_conn: 2$/gm)?.length).toBe(receivers.length);
    const keys = config.split("\n").filter((l) => /^\s+[a-z_]+:/.test(l));
    expect(keys.some((l) => l.includes("max_open_conns"))).toBe(false);

    expect(config).toContain("memory_limiter:");
    expect(config).toContain("limit_mib: 768");
    expect(config).toContain("spike_limit_mib: 192");
    const pipelines = config.split("service:")[1]!.match(/processors: \[([^\]]+)\]/g) ?? [];
    expect(pipelines.length).toBeGreaterThanOrEqual(2);
    for (const list of pipelines) {
      expect(list, `${list} must start with memory_limiter`).toMatch(
        /processors: \[memory_limiter[,\]]/,
      );
    }
    // Setting lines, not raw text: the config comments name queue_size, so a
    // whole-document toContain() survives deleting the setting itself.
    const settings = config
      .split("\n")
      .filter((l) => /^\s+[a-z_]+:/.test(l))
      .map((l) => l.trim());
    expect(settings).toContain("queue_size: 500");
    expect(settings).toContain("max_elapsed_time: 300s");
  });

  /**
   * Managed-database honesty (ship-plan §7 item 1): deadlock capture tails the
   * error log on disk — impossible on RDS/Aurora/Cloud SQL — while everything
   * else keeps working. The card must say so BEFORE the user spends the setup,
   * plus the two version/retention caveats that travel with the events.
   */
  it("tells a managed-database user which half works for them", () => {
    const card = mysqlCard(SUBS);
    const note = card.steps.find((s) => s.id === "dbm-configure")!.note!;

    expect(note).toMatch(/RDS/);
    expect(note).toMatch(/Cloud SQL/);
    expect(note).toMatch(/not available/i);
    // The reason travels with the limit…
    expect(note).toMatch(/error log|file to read/i);
    // …and the unaffected signals are named, so the note reads as scope, not
    // as "DBM does not work on RDS".
    expect(note).toMatch(/blocking chains/i);
    // Plans floor + collector identity + retention caveat.
    expect(note).toContain("8.0.22");
    expect(note).toMatch(/upstream OpenTelemetry Collector Contrib/i);
    expect(note).toMatch(/v0\.148\.0/);
    expect(note).toMatch(/retention/i);
  });

  it("offers mysql / docker / GUI tabs to create the user", () => {
    const prepare = mysqlCard(SUBS, gt).steps.find((s) => s.id === "prepare")!;
    expect(prepare.variants?.map((v) => v.id)).toEqual(["mysql", "docker", "sql-client"]);
    const mysql = prepare.variants!.find((v) => v.id === "mysql")!.code;
    expect(mysql.raw).toContain("mysql");
    expect(mysql.raw).toContain('-e "');
    expect(mysql.raw).toContain("CREATE USER 'otel'@'localhost'");
    expect(prepare.variants!.every((v) => !!v.icon)).toBe(true);
  });

  it("writes a mysql receiver config with the org's exporter", () => {
    const configure = mysqlCard(SUBS, gt).steps.find((s) => s.id === "configure")!;
    expect(configure.inputs?.map((i) => i.id)).toEqual(["host", "port"]);
    const config = configure.variants!.find((v) => v.id === "linux-amd64")!.code.raw;
    expect(config).toContain("mysql:");
    expect(config).toContain(`endpoint: ${SUBS.url}/api/${SUBS.org}`);
    expect(config).toContain(`Basic ${SUBS.token}`);
  });
});

describe("MySQL.vue", () => {
  let wrapper: VueWrapper<any>;
  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });
  it("renders the shared card for the mySQL slug", () => {
    expect(getDataSourceCard("mySQL", SUBS, gt)?.provider.name).toBe("MySQL");
    wrapper = mount(MySQL, { global: { plugins: [mockStore, mockI18n] } });
    expect(wrapper.findComponent({ name: "SetupCardRenderer" }).exists()).toBe(true);
  });
});

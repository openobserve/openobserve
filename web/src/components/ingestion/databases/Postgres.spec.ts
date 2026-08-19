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
import Postgres from "./Postgres.vue";
import postgresCard from "@/components/ingestion/setupCard/content/postgres";
import { getDataSourceCard } from "@/components/ingestion/setupCard/registry";
import { gt } from "@/types/i18n";

const mockEndpoint = ref({
  url: "https://test.openobserve.ai",
  host: "test.openobserve.ai",
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
    selectedOrganization: { identifier: "test-org", name: "Test Organization" },
    userInfo: { email: "test@example.com" },
    organizationData: { organizationPasscode: "test-passcode" },
    theme: "light",
  },
});

const mockI18n = createI18n({ locale: "en", messages: { en: {} } });

const SUBS = {
  url: "https://test.openobserve.ai",
  org: "test-org",
  token: "dGVzdEB0b2tlbg==",
};

describe("postgresCard builder", () => {
  it("builds the Postgres card metadata and step flow", () => {
    const card = postgresCard(SUBS, gt);
    expect(card.provider.name).toBe("Postgres");
    // Logs too: the optional Database Monitoring steps ship deadlock and
    // blocking events into the dbm_server logs stream.
    expect(card.provider.metaBadges).toEqual(["Metrics", "Logs"]);
    expect(card.detect).toMatchObject({
      streamType: "metrics",
      match: "keyword",
      streamName: "postgresql",
    });
    expect(card.steps.map((s) => s.id)).toEqual([
      "prepare",
      "install",
      "configure",
      "run",
      "verify",
      "dbm-grant",
      // The logging prerequisites MUST precede dbm-configure: the collector
      // config tails a log file that only exists once logging_collector is on,
      // and its parser only matches the log_line_prefix set here.
      "dbm-logging",
      "dbm-logging-verify",
      // Optional real-executed-plans step; shares the logging step's restart.
      "dbm-auto-explain",
      "dbm-configure",
      "dbm-run",
      "verify-dbm",
    ]);
  });

  // The Deadlocks / Blocked-queries tabs are empty until this config runs, and
  // the field names below are a CONTRACT with server_vantage.rs — the parser
  // canonicalizes on these exact keys, so a rename here silently produces
  // records the backend skips.
  it("ships a Database Monitoring config the ingest parser can read", () => {
    const card = postgresCard(SUBS, gt);

    const grant = card.steps.find((s) => s.id === "dbm-grant")!;
    expect(grant.variants!.find((v) => v.id === "psql")!.code.raw).toContain("pg_monitor");

    const configure = card.steps.find((s) => s.id === "dbm-configure")!;
    expect(configure.inputs?.map((i) => i.id)).toEqual(["database", "logpath"]);

    const config = configure.variants!.find((v) => v.id === "linux-amd64")!.code.raw;
    // Written alongside the metrics config, never over it.
    expect(config).toContain("dbm-config.yaml");
    expect(config).not.toMatch(/>\s*config\.yaml/);
    // Both vantages the DBM pages read.
    expect(config).toContain("sqlquery/pg_blocking");
    expect(config).toContain("filelog/pg_deadlocks");
    // The exact keys server_vantage.rs matches on.
    expect(config).toContain("pg_blocking_chain");
    expect(config).toContain("blocked_pid");
    expect(config).toContain("blocking_query");
    expect(config).toContain("dl_query_1");
    expect(config).toContain("o2_pg_event");
    // Must land in the stream the read endpoints look in.
    expect(config).toContain("stream-name: dbm_server");
    // The filter is load-bearing: filelog tails the WHOLE database log, so
    // without it every ordinary log line lands in dbm_server too (measured:
    // 787 events vs 4.8M untagged rows in one hour) and the Deadlocks page
    // slows to a crawl. A processor that is defined but not listed in the
    // pipeline does nothing, so both are asserted.
    expect(config).toContain("filter/dbm:");
    expect(config).toContain("processors: [memory_limiter, filter/dbm, batch]");

    expect(config).toContain(`Basic ${SUBS.token}`);

    // Both configs are passed to one collector — and the merged run needs the
    // metrics config's password env TOO: config.yaml reads
    // ${env:POSTGRESQL_PASSWORD}, so a command setting only PGUSER/PGPASS
    // breaks the metrics receiver's auth the moment the files merge.
    const run = card.steps.find((s) => s.id === "dbm-run")!;
    expect(run.code!.raw).toContain("--config ./config.yaml");
    expect(run.code!.raw).toContain("--config ./dbm-config.yaml");
    expect(run.code!.raw).toContain("POSTGRESQL_PASSWORD=");
    expect(run.code!.raw).toContain("PGUSER=");
    expect(run.code!.raw).toContain("PGPASS=");
  });

  /**
   * THE v0.148.0 EVENTS BLOCK, SHIPPED ON.
   *
   * Upstream flipped `db.server.query_sample` / `db.server.top_query` to
   * default-OFF at v0.148.0, so the block is the switch that starts the
   * collection — and OpenObserve accepts both feeds whenever Database
   * Monitoring is enabled (the per-signal `ZO_DB_MONITORING_*_ENABLED` ingest
   * knobs are gone, so a collected row can no longer be silently discarded
   * server-side).
   *
   * The block must be PRESENT and correctly shaped: a TOP-LEVEL `events:` (a
   * sibling of the collection settings, never nested inside them, where it is
   * a fatal config error), with both keys spelled out so the setting is
   * explicit and a user trimming collection cost flips one visible line.
   */
  it("ships the receiver's activity and top-query events on, spelled out", () => {
    const card = postgresCard(SUBS, gt);
    const configure = card.steps.find((s) => s.id === "dbm-configure")!;
    const config = configure.variants!.find((v) => v.id === "linux-amd64")!.code.raw;

    // The dedicated receiver instance (a same-named `postgresql:` would collide
    // with the metrics config when the two --config files merge).
    expect(config).toContain("postgresql/dbm_events:");
    // Both event names, present and explicitly ON — these are what fill the
    // Activity tab and the server-side Top queries.
    expect(config).toContain("db.server.query_sample: { enabled: true }");
    expect(config).toContain("db.server.top_query: { enabled: true }");
    // Postgres spells it top_n_query (mysql says top_query_count) — verified
    // against v0.158.0, where an unknown key is a fatal config error.
    expect(config).toContain("top_n_query:");
    expect(config).toContain("query_sample_collection:");

    // `events:` must be TOP-LEVEL on the receiver: 4-space indent, exactly like
    // the collection blocks — nesting it deeper is a fatal config error.
    expect(config).toMatch(/\n {4}events:\n/);

    // The events pipeline must BYPASS filter/dbm: receiver-native events carry
    // no o2_recipe tag, so the filter would silently drop every one of them.
    // It must still sit behind memory_limiter, and memory_limiter must be
    // FIRST — a processor listed ahead of it runs outside the OOM guard.
    expect(config).toMatch(/logs\/dbm_events:\n\s+receivers: \[postgresql\/dbm_events\]/);
    expect(config).toMatch(/logs\/dbm_events:[\s\S]*?processors: \[memory_limiter, batch\]/);
    const eventsProcessors = config.match(/logs\/dbm_events:[\s\S]*?processors: \[([^\]]+)\]/)![1];
    expect(eventsProcessors).not.toContain("filter/dbm");

    // With the server always accepting the feeds, prescribing an environment
    // variable would send the user to set a knob that no longer exists. The
    // note states the block is the one switch, and names the cost trade.
    expect(configure.note).not.toContain("ZO_DB_MONITORING_ACTIVITY_ENABLED");
    expect(configure.note).not.toContain("ZO_DB_MONITORING_TOP_QUERY_ENABLED");
    expect(configure.note).toMatch(/enabled: true/);

    // Prerequisites travel with the feature: top queries read
    // pg_stat_statements, which must be created AND preloaded (restart).
    const grant = card.steps.find((s) => s.id === "dbm-grant")!;
    expect(grant.variants!.find((v) => v.id === "psql")!.code.raw).toContain("pg_stat_statements");
    const logging = card.steps.find((s) => s.id === "dbm-logging")!;
    expect(logging.code!.raw).toContain("shared_preload_libraries = 'pg_stat_statements'");
    const loggingVerify = card.steps.find((s) => s.id === "dbm-logging-verify")!;
    expect(loggingVerify.code!.raw).toContain("SHOW shared_preload_libraries;");
    // pg_monitor does not include table SELECT, so EXPLAIN-based estimated
    // plans can silently produce nothing — the card must say so.
    expect(grant.variants!.find((v) => v.id === "psql")!.note).toMatch(/SELECT/);

    // Collector identity + retention caveat (ship-plan §7 items 5 and 7).
    const note = configure.note!;
    expect(note).toMatch(/upstream OpenTelemetry Collector Contrib/i);
    expect(note).toMatch(/v0\.148\.0/);
    expect(note).toMatch(/v0\.158\.0/);
    expect(note).toMatch(/OpenObserve collector build does not include/i);
    expect(note).toMatch(/retention/i);

    // The verify step now promises the Activity and Table health tabs too.
    const verify = card.steps.find((s) => s.id === "verify-dbm")!;
    expect(verify.pills).toEqual(["Deadlocks", "Blocked queries", "Activity", "Table health"]);
  });

  /**
   * THE TABLE/INDEX HEALTH CONTRACT. `canonicalize_table_stats` and
   * `canonicalize_index_stats` (server_vantage.rs) read these exact aliases —
   * the file header of dbmShared.ts declares them a parser contract, and a
   * renamed alias ships silent emptiness: the collector stays green, the row
   * stores, and the Table health tab renders nothing.
   */
  it("ships the table and index health recipes with every alias the canonicalizers read", () => {
    const card = postgresCard(SUBS, gt);
    const configure = card.steps.find((s) => s.id === "dbm-configure")!;
    const config = configure.variants!.find((v) => v.id === "linux-amd64")!.code.raw;

    // Both receivers defined AND in the logs pipeline — a receiver defined but
    // not listed collects nothing while looking configured.
    expect(config).toContain("sqlquery/pg_table_stats:");
    expect(config).toContain("sqlquery/pg_index_stats:");
    const pipeline = config.split("service:")[1]!;
    expect(pipeline).toContain("sqlquery/pg_table_stats");
    expect(pipeline).toContain("sqlquery/pg_index_stats");

    // The recipe tags detect_engine and the dispatch arms key on.
    expect(config).toContain("'pg_table_stats'");
    expect(config).toContain("'pg_index_stats'");

    // The identity split the backend depends on: the table name arrives in
    // `body` (body_column: table_name), while the index recipe's body carries
    // the DDL and its identity stays in the index_name ATTRIBUTE.
    expect(config).toContain("body_column: table_name");
    expect(config).toContain("body_column: index_def");

    // Every attribute alias canonicalize_table_stats reads. A column selected
    // but absent from attribute_columns is silently dropped, so each name must
    // appear in the attribute list too.
    const tableAttrs = config.match(
      /body_column: table_name\s+attribute_columns:\s+\[([^\]]+)\]/,
    )![1];
    for (const alias of [
      "schema_name",
      "total_bytes",
      "heap_bytes",
      "seq_scan",
      "seq_tup_read",
      "idx_scan",
      "n_live_tup",
      "n_dead_tup",
      "n_mod_since_analyze",
      "last_vacuum",
      "last_autovacuum",
      "last_analyze",
      "autovacuum_count",
      "frozen_xid_age",
      "dead_tup_pct",
      "server_address",
      "o2_recipe",
    ]) {
      expect(tableAttrs, `table alias ${alias} must ride as an attribute`).toContain(alias);
    }

    // Every attribute alias canonicalize_index_stats reads.
    const indexAttrs = config.match(
      /body_column: index_def\s+attribute_columns:\s+\[([^\]]+)\]/,
    )![1];
    for (const alias of [
      "schema_name",
      "table_name",
      "index_name",
      "idx_scan",
      "idx_tup_read",
      "idx_tup_fetch",
      "index_bytes",
      "is_unique",
      "server_address",
      "o2_recipe",
    ]) {
      expect(indexAttrs, `index alias ${alias} must ride as an attribute`).toContain(alias);
    }
  });

  // The Deadlocks tab's whole failure mode is silent: filelog reports healthy
  // while matching nothing. These two settings are what prevent that, so they
  // are asserted as a contract rather than left to the runbook.
  // The read-time deadlock stitch groups on (engine, instance, database). If the
  // recipes tag no instance, every host reporting into dbm_server collapses into
  // one bucket and two servers' deadlocks can fuse into one fabricated event.
  // server_address is the key detect_instance reads first.
  it("tags every server-vantage record with the host, so two servers never fuse", () => {
    const card = postgresCard(SUBS, gt);
    const configure = card.steps.find((s) => s.id === "dbm-configure")!;
    const config = configure.variants!.find((v) => v.id === "linux-amd64")!.code.raw;

    // Blocking: a literal column, projected AND carried as an attribute (a
    // column selected but absent from attribute_columns is silently dropped).
    expect(config).toMatch(/AS server_address/);
    expect(config).toMatch(/attribute_columns:[\s\S]*server_address/);
    // Deadlocks: filelog has no SQL, so it is stamped by an `add` operator.
    expect(config).toMatch(/field: attributes\.server_address/);

    // {host} must RESOLVE. It is declared on the metrics `configure` step, not on
    // dbm-configure -- SetupCardRenderer flatMaps inputs across every step, so a
    // token authored on one step fills code on another. If that ever became
    // step-scoped, this config would ship a literal "{host}" as the identity of
    // every server, which is worse than no tag at all.
    const hostInput = card.steps.flatMap((s) => s.inputs ?? []).find((i) => i.id === "host");
    expect(hostInput, "a host input must exist somewhere on the card").toBeDefined();
  });

  /**
   * Deadlock capture tails the database's own LOG FILE, so it cannot work on a
   * managed instance — RDS, Aurora and Cloud SQL expose no host filesystem.
   *
   * This step used to end with "Managed Postgres (RDS, Cloud SQL) exposes the
   * same settings as parameter-group values". True about the settings, silent
   * about the outcome, and in this position it reads as encouragement: an RDS
   * user edits a parameter group, takes a restart, and arrives at the next step
   * asking for a log path their instance does not have. Worse than saying
   * nothing, because it costs them the restart to find out.
   */
  it("tells a managed-database user this step cannot work for them", () => {
    const card = postgresCard(SUBS, gt);
    const note = card.steps.find((s) => s.id === "dbm-logging")!.note!;

    expect(note).toMatch(/RDS/);
    expect(note).toMatch(/Cloud SQL/);
    // A caveat pointing the wrong way was the defect; only an explicit
    // unavailability stops the user spending a restart on it.
    expect(note, "must not imply a parameter-group change completes this step").not.toMatch(
      /exposes the same settings/i,
    );
    expect(note, "must state the capability is unavailable there").toMatch(
      /not available|cannot|unavailable/i,
    );
    // The reason travels with the limit, so a reader can check it against their
    // own platform and can tell the non-log DBM signals are unaffected.
    expect(note).toMatch(/log file|log-file|filesystem/i);
  });

  it("ships the Postgres logging prerequisites the deadlock parser depends on", () => {
    const card = postgresCard(SUBS, gt);
    const logging = card.steps.find((s) => s.id === "dbm-logging")!;
    const conf = logging.code!.raw;

    // Without a log file there is nothing to tail; off is the distro default.
    expect(conf).toContain("logging_collector = on");
    // The 1s default detects short-lived cycles too late to ever be logged.
    expect(conf).toContain("deadlock_timeout = 500ms");
    // %q keeps background workers (checkpointer, autovacuum) parseable.
    expect(conf).toMatch(/log_line_prefix = '%m \[%p\] %q/);
    // Goes in a file, not a shell — and needs a restart, not a reload.
    expect(logging.code!.filename).toBe("postgresql.conf");
    expect(logging.note).toMatch(/RESTART/);

    // THE contract: a line formed by this prefix must satisfy the collector's
    // regex_parser. If either side is edited alone, this fails instead of the
    // pipeline going quiet in production.
    const configure = card.steps.find((s) => s.id === "dbm-configure")!;
    const collectorConfig = configure.variants!.find((v) => v.id === "linux-amd64")!.code.raw;
    const regexLine = collectorConfig.split("\n").find((l) => l.includes("(?P<pg_pid>"))!;
    const pattern = regexLine.slice(regexLine.indexOf("'") + 1, regexLine.lastIndexOf("'"));
    // The collector's regex is RE2 (Go). Translate the two constructs JS spells
    // differently — named groups `(?P<x>` → `(?<x>`, and the inline dot-all flag
    // `(?s)` → the `s` flag — so the SAME pattern can be exercised here.
    const parser = new RegExp(
      pattern
        .replace(/\\\\/g, "\\")
        .replace(/\(\?P</g, "(?<")
        .replace(/\(\?s\)/g, ""),
      "s",
    );

    // A real deadlock banner as Postgres writes it under the prefix above.
    const session =
      "2026-08-10 14:22:31.417 UTC [4242] app_user@shop app=api vxid=5/12 txid=991 line=7 ERROR:  deadlock detected";
    const parsed = parser.exec(session);
    expect(parsed).not.toBeNull();
    expect(parsed!.groups!.pg_pid).toBe("4242");
    expect(parsed!.groups!.pg_severity).toBe("ERROR");
    expect(parsed!.groups!.pg_message).toContain("deadlock detected");

    // The %q case: a background worker emits no session fields and must still
    // parse, which is the entire reason %q is in the prescribed prefix.
    const background = "2026-08-10 14:22:31.417 UTC [7] LOG:  checkpoint starting: time";
    expect(parser.exec(background)).not.toBeNull();
  });

  /**
   * THE AUTO_EXPLAIN CONTRACT. Real executed plans arrive as `duration: N.NNN
   * ms  plan:` log entries with the JSON document on continuation lines. Two
   * silent failure shapes are pinned here against REAL captured lines
   * (tests/dbm-server-vantage, postgres:16.14):
   *  - a route that fails to match leaves `o2_pg_event = "other"` and
   *    filter/dbm drops every plan while the collector reports healthy;
   *  - a route that matches too much steals ordinary `duration: … statement:`
   *    lines from users running log_min_duration_statement.
   */
  it("routes a real auto_explain entry to the explain branch and nothing else", () => {
    const card = postgresCard(SUBS, gt);
    const configure = card.steps.find((s) => s.id === "dbm-configure")!;
    const config = configure.variants!.find((v) => v.id === "linux-amd64")!.code.raw;

    // The branch exists, tags the value filter/dbm keeps, and extracts both
    // attributes the backend canonicalizer reads (ae_duration_ms, ae_plan_json).
    expect(config).toContain("id: mark_explain");
    expect(config).toMatch(/id: mark_explain\s+field: attributes\.o2_pg_event\s+value: explain/);
    expect(config).toContain("(?P<ae_duration_ms>");
    expect(config).toContain("(?P<ae_plan_json>");
    // The plan travels as ONE STRING attribute — a json_parser here would emit
    // a nested value, and a nested value rejects the entire ingest batch (X5).
    expect(config, "the plan must never be json_parser-expanded").not.toContain("json_parser");

    // The route pattern, exercised against the real first line.
    const routeLine = config.split("\n").find((l) => l.includes("ms\\\\s+plan:"))!;
    expect(routeLine, "the explain route must exist in the router").toBeDefined();
    const routePattern = routeLine.match(/matches "([^"]+)"/)![1].replace(/\\\\/g, "\\");
    const route = new RegExp(routePattern);
    // Verbatim rig capture (corpus/auto_explain_rig.json first_line, message part).
    expect(route.test("duration: 0.009 ms  plan:")).toBe(true);
    // An ordinary statement-duration line must NOT reach the explain branch.
    expect(
      route.test("duration: 0.295 ms  statement: SELECT balance FROM accounts WHERE id = 42;"),
    ).toBe(false);

    // The extraction regexes, against the real multiline-joined message.
    const message =
      'duration: 0.009 ms  plan:\n\t{\n\t  "Query Text": "SELECT balance FROM accounts WHERE id = 42;",\n\t  "Plan": {\n\t    "Node Type": "Seq Scan"\n\t  }\n\t}';
    const headerLine = config.split("\n").find((l) => l.includes("(?P<ae_duration_ms>"))!;
    const headerPattern = headerLine.slice(
      headerLine.indexOf("'") + 1,
      headerLine.lastIndexOf("'"),
    );
    const header = new RegExp(headerPattern.replace(/\\\\/g, "\\").replace(/\(\?P</g, "(?<"));
    expect(header.exec(message)!.groups!.ae_duration_ms).toBe("0.009");

    const planLine = config.split("\n").find((l) => l.includes("(?P<ae_plan_json>"))!;
    const planPattern = planLine.slice(planLine.indexOf("'") + 1, planLine.lastIndexOf("'"));
    const planRe = new RegExp(
      planPattern
        .replace(/\\\\/g, "\\")
        .replace(/\(\?P</g, "(?<")
        .replace(/\(\?s\)/g, ""),
      "s",
    );
    const planJson = planRe.exec(message)!.groups!.ae_plan_json;
    expect(() => JSON.parse(planJson)).not.toThrow();
    expect(JSON.parse(planJson)["Plan"]["Node Type"]).toBe("Seq Scan");
  });

  /**
   * THE SILENT-DROP TRAP. filter/dbm drops any record whose o2_pg_event is nil
   * OR the literal "other" — it tests the VALUE, because every line is stamped
   * "other" before routing. An explain row must therefore carry a non-"other"
   * value or every plan is discarded downstream of a branch that looks correct
   * in isolation. This test runs the SHIPPED filter condition, not a copy.
   */
  it("keeps explain rows alive through the shipped filter/dbm condition", () => {
    const card = postgresCard(SUBS, gt);
    const configure = card.steps.find((s) => s.id === "dbm-configure")!;
    const config = configure.variants!.find((v) => v.id === "linux-amd64")!.code.raw;

    const condLine = config.split("\n").find((l) => l.includes('attributes["o2_recipe"] == nil'))!;
    const cond = condLine.trim().replace(/^- '/, "").replace(/'$/, "");

    // Evaluate the OTTL condition with JS semantics: == on strings/null, and/or.
    const dropped = (attrs: Record<string, string>) => {
      const js = cond
        .replace(/attributes\["([^"]+)"\]/g, (_m, k: string) => JSON.stringify(attrs[k] ?? null))
        .replace(/\bnil\b/g, "null")
        .replace(/\band\b/g, "&&")
        .replace(/\bor\b/g, "||");
      // Evaluating the SHIPPED filter expression is the point of this test.
      return eval(js) as boolean;
    };

    // A marked explain row SURVIVES…
    expect(dropped({ o2_pg_event: "explain" })).toBe(false);
    // …and so does a marked statement-duration row — the Slowest-calls
    // fallback reads exactly these.
    expect(dropped({ o2_pg_event: "statement_duration" })).toBe(false);
    // …while the stamped-but-unrouted default is dropped (the filter's job),
    // which is exactly why the route must fire before the default.
    expect(dropped({ o2_pg_event: "other" })).toBe(true);
    expect(dropped({})).toBe(true);
    // Control: the existing recipes' rows keep surviving.
    expect(dropped({ o2_recipe: "pg_blocking_chain" })).toBe(false);
    expect(dropped({ o2_pg_event: "deadlock" })).toBe(false);
  });

  /**
   * THE STATEMENT-DURATION CONTRACT. `log_min_duration_statement` writes one
   * line per COMPLETED statement with its exact duration —
   * `duration: N.NNN ms  statement: …` — and the Slowest-calls fallback is
   * built from exactly these lines. Pinned against a REAL line from the live
   * capture rig. Two silent failure shapes:
   *  - an unrouted line keeps `o2_pg_event = "other"` and filter/dbm drops
   *    every duration while the collector reports healthy;
   *  - the route must fire AFTER the explain route — an auto_explain entry
   *    begins `duration:` too, and claiming it here would steal every plan.
   */
  it("routes a real statement-duration line to the duration branch and parses it", () => {
    const card = postgresCard(SUBS, gt);
    const configure = card.steps.find((s) => s.id === "dbm-configure")!;
    const config = configure.variants!.find((v) => v.id === "linux-amd64")!.code.raw;

    // The branch exists and tags the value filter/dbm keeps and the backend
    // canonicalizer dispatches on.
    expect(config).toContain("id: mark_duration");
    expect(config).toMatch(
      /id: mark_duration\s+field: attributes\.o2_pg_event\s+value: statement_duration/,
    );

    // Route ordering: the explain route must appear BEFORE the duration route
    // in the router, so plan headers never reach the duration branch.
    expect(config.indexOf("output: mark_explain")).toBeGreaterThan(-1);
    expect(config.indexOf("output: mark_explain")).toBeLessThan(
      config.indexOf("output: mark_duration"),
    );

    // The extraction regex, against the real captured message (live stream
    // dbm_server_logs, org dbm_notraces, 2026-08-13) and the extended-protocol
    // execute form.
    const regexLine = config.split("\n").find((l) => l.includes("(?P<stmt_duration_ms>"))!;
    expect(regexLine, "the duration parser must exist").toBeDefined();
    const pattern = regexLine.slice(regexLine.indexOf("'") + 1, regexLine.lastIndexOf("'"));
    const re = new RegExp(pattern.replace(/\(\?P</g, "(?<").replace(/\(\?s\)/g, ""), "s");
    const real =
      "duration: 63.149 ms  statement: SELECT count(*), sum(amount) FROM orders WHERE customer_ref = 'CUST-00879'";
    const m = re.exec(real)!;
    expect(m).not.toBeNull();
    expect(m.groups!.stmt_duration_ms).toBe("63.149");
    expect(m.groups!.stmt_kind).toBe("statement");
    expect(m.groups!.stmt_text).toBe(
      "SELECT count(*), sum(amount) FROM orders WHERE customer_ref = 'CUST-00879'",
    );
    const prepared = re.exec(
      "duration: 1.234 ms  execute s_1: SELECT owner FROM accounts WHERE id = $1",
    )!;
    expect(prepared.groups!.stmt_kind).toBe("execute s_1");
  });

  /**
   * The logging step must actually TURN ON the feed the fallback reads: a
   * recommended nonzero threshold (100ms captures the slow tail; 0 is a
   * diagnosis setting whose volume is the workload's own statement rate; the
   * -1 default reports nothing), with the tradeoff stated in the conf
   * comments and the verify step checking it took effect.
   */
  it("ships log_min_duration_statement with a nonzero recommended threshold", () => {
    const card = postgresCard(SUBS, gt);
    const logging = card.steps.find((s) => s.id === "dbm-logging")!;
    expect(logging.code!.raw).toContain("log_min_duration_statement = 100ms");
    expect(logging.code!.raw).toMatch(/0 logs EVERYTHING/);
    const verify = card.steps.find((s) => s.id === "dbm-logging-verify")!;
    expect(verify.code!.raw).toContain("SHOW log_min_duration_statement;");
  });

  /**
   * THE PASTE-IN VALUE IS THE ADVICE. This step's prose, its `note`, and the
   * comment directly above each line all tell a DBA to start at
   * `sample_rate = 0.01` and `log_min_duration = '2s'` on a busy primary — and
   * the config SHIPPED `1.0` and `'1s'`, so the line a reader copies armed
   * instrumentation on 100% of statements while the text beside it said 1%.
   *
   * That is the failure this pins: not a wrong number, but a config whose
   * values contradict their own guidance. `sample_rate` is the one that costs —
   * with `log_analyze = on` every statement CONSIDERED pays, not only the ones
   * logged, and published overhead for analyze-on capture runs from ~2% to a
   * factor of 2 depending on workload and clock cost. A monitoring default must
   * be the safe end of that range; 1.0 is a diagnosis window, not a default.
   *
   * Asserted against the recommendation text itself so the two cannot drift
   * apart again — the previous bug was invisible precisely because nothing
   * compared the value to the sentence above it.
   */
  it("ships auto_explain values that match the advice printed beside them", () => {
    const card = postgresCard(SUBS, gt);
    const step = card.steps.find((s) => s.id === "dbm-auto-explain")!;
    const conf = step.code!.raw;

    // The cost control, at the safe end. NOT 1.0.
    expect(conf).toContain("auto_explain.sample_rate = 0.01");
    expect(conf).not.toContain("auto_explain.sample_rate = 1.0");
    // The volume control, at the production starting point the note names.
    expect(conf).toContain("auto_explain.log_min_duration = '2s'");
    // The most expensive knob stays off; the note and the conf must agree.
    expect(conf).toContain("auto_explain.log_timing = off");

    // The step's own note is the contract the values above are keeping.
    expect(step.note).toMatch(/sample_rate = 0\.01/);
    expect(step.note).toMatch(/log_min_duration = '2s'/);
  });

  /**
   * THE CONNECTION STRING IS THE ADVICE TOO. Every `sqlquery` datasource in the
   * DBM config is pasted verbatim into a config that connects to a PRODUCTION
   * database and carries a password on the wire. `sslmode=disable` shipped as
   * the copyable default sends that password, and every row of
   * `pg_stat_activity` it reads back, in clear text — and it does so silently,
   * because a disabled-TLS connection succeeds exactly like an encrypted one.
   *
   * `require` is the strongest mode that needs no CA bundle on the collector
   * host, so it works unmodified against managed instances, and it fails LOUDLY
   * ("server does not support SSL") against a server without TLS rather than
   * quietly downgrading. The downgrade for a local instance is documented
   * beside the value.
   *
   * Asserted across the WHOLE generated config rather than per-receiver: the
   * three Postgres datasources are separate template literals, so the failure
   * this pins is two of them being fixed and the third being missed.
   */
  it("ships every sqlquery datasource with TLS required, not disabled", () => {
    const card = postgresCard(SUBS, gt);
    const configure = card.steps.find((s) => s.id === "dbm-configure")!;
    const config = configure.variants!.find((v) => v.id === "linux-amd64")!.code.raw;

    const datasources = config.split("\n").filter((l) => l.includes("datasource:"));
    // Guard the extractor: an empty list would make the assertions vacuous.
    expect(datasources.length).toBeGreaterThanOrEqual(3);

    expect(config).not.toContain("sslmode=disable");
    for (const line of datasources) {
      expect(line).toContain("sslmode=require");
    }
  });

  /**
   * THE DATABASE-SIDE COST OF pg_blocking. `pg_blocking_pids()` takes exclusive
   * access to the lock manager's shared state for each pid it is asked about,
   * and the LATERAL join calls it once per row of `pg_stat_activity` — so
   * without a predicate the call count scales with TOTAL CONNECTIONS rather
   * than with contention, ten times a minute, and it is worst on the busiest
   * server during exactly the lock storm the recipe exists to observe.
   *
   * `wait_event_type = 'Lock'` is OUTPUT-IDENTICAL, which is why this can be a
   * pure work reduction rather than a sampling trade: a session that is not
   * waiting on a lock has no blockers, so `pg_blocking_pids()` returns empty
   * and `JOIN LATERAL … ON true` already dropped the row. The measured saving
   * (3.20ms → 2.75ms mean under a 63-session convoy) is modest; the lock
   * manager access it avoids is the point.
   *
   * Pinned together with the column contract, because the failure this guards
   * is someone "simplifying" the WHERE clause away — or narrowing it further
   * and silently dropping the blocking rows the tab is made of.
   */
  it("filters pg_blocking to lock waiters without losing a contract column", () => {
    const card = postgresCard(SUBS, gt);
    const configure = card.steps.find((s) => s.id === "dbm-configure")!;
    const config = configure.variants!.find((v) => v.id === "linux-amd64")!.code.raw;

    // Isolate the pg_blocking recipe: the config holds several sqlquery
    // receivers and a config-wide match would pass on another one's text.
    const blocking = config.slice(
      config.indexOf("sqlquery/pg_blocking:"),
      config.indexOf("filelog/pg_deadlocks:"),
    );
    expect(blocking).toContain("pg_blocking_pids(blocked.pid)");
    expect(blocking).toContain("WHERE blocked.wait_event_type = 'Lock'");

    // The predicate must not have cost the recipe its ingest contract:
    // canonicalize_blocking reads these aliases verbatim, and both sides of
    // the chain must survive.
    for (const alias of [
      "AS blocked_pid",
      "AS blocked_query",
      "AS wait_event_type",
      "AS blocking_pid",
      "AS blocking_query",
      "AS server_address",
      "AS o2_recipe",
    ]) {
      expect(blocking, `pg_blocking must still project ${alias}`).toContain(alias);
    }
    // Still both sides of the join — a WHERE that accidentally replaced the
    // LATERAL would leave a query that returns waiters with no blockers.
    expect(blocking).toContain("JOIN pg_stat_activity blocking ON blocking.pid = b.pid");
  });

  /**
   * BOUNDING THE O(SCHEMA) RECIPES. `pg_total_relation_size()` sums heap, every
   * index, TOAST and TOAST indexes per table per tick, and nothing bounded it:
   * measured warm at 17ms / 500 tables, 161ms / 5,000, 3,037ms / 50,005 — a
   * super-linear curve (9.4× then 18.9×) that is a function of the CUSTOMER's
   * schema, not their workload. Live at 50k tables the collector recorded mean
   * 30.7s against its 60s interval and was eventually OOM-killed.
   *
   * TWO BOUNDS, and the choice between them is the thing worth pinning.
   * `LIMIT 1000` measured fastest (38ms, 80×) and is WRONG: with no stable
   * ORDER BY it keeps whichever tables the catalog scan reached first, so the
   * set of missing tables changes between ticks and the Table health tab gains
   * and loses rows non-deterministically. `n_live_tup > 0` (250ms, 12×) drops
   * only relations with no bloat, no vacuum debt and no meaningful size, and
   * drops the SAME ones every tick. The 300s interval is a further 5× against
   * schema state that moves hourly at most.
   */
  it("bounds the table and index stats recipes without a nondeterministic LIMIT", () => {
    const card = postgresCard(SUBS, gt);
    const configure = card.steps.find((s) => s.id === "dbm-configure")!;
    const config = configure.variants!.find((v) => v.id === "linux-amd64")!.code.raw;

    const tableStats = config.slice(
      config.indexOf("sqlquery/pg_table_stats:"),
      config.indexOf("sqlquery/pg_index_stats:"),
    );
    // Bounded at the next receiver: an open-ended slice would swallow
    // postgresql/dbm_events and make this test fail on that receiver's knobs.
    const indexStats = config.slice(
      config.indexOf("sqlquery/pg_index_stats:"),
      config.indexOf("postgresql/dbm_events:"),
    );

    // The row bound, on the alias the recipe actually gives
    // pg_stat_user_tables — it is a LEFT JOIN, so the coalesce is load-bearing
    // for tables with no stat row at all.
    expect(tableStats).toContain("LEFT JOIN pg_stat_user_tables s");
    expect(tableStats).toContain("AND coalesce(s.n_live_tup, 0) > 0");

    // NOT a LIMIT — the failure mode is a tab that flickers, which reads as
    // data loss rather than as a bound. Checked on SQL lines only: the
    // recipes' own comments name the rejected option, which is the point.
    const sqlLines = (block: string) =>
      block.split("\n").filter((l) => !l.trim().startsWith("#") && !l.trim().startsWith("--"));
    expect(sqlLines(tableStats).join("\n")).not.toMatch(/\bLIMIT\b/);
    expect(sqlLines(indexStats).join("\n")).not.toMatch(/\bLIMIT\b/);

    // The interval, on both, and no 60s left behind on either.
    expect(tableStats).toContain("collection_interval: 300s");
    expect(indexStats).toContain("collection_interval: 300s");
    expect(tableStats).not.toContain("collection_interval: 60s");
    expect(indexStats).not.toContain("collection_interval: 60s");

    // The bound must not have cost the recipe the columns the Table health tab
    // is built from — the size functions are what got expensive, and dropping
    // them would have been the other way to make the numbers look good.
    expect(tableStats).toContain("pg_total_relation_size(c.oid)");
    expect(tableStats).toContain("AS n_dead_tup");
    expect(tableStats).toContain("AS dead_tup_pct");
    expect(indexStats).toContain("pg_relation_size(s.indexrelid)");
    expect(indexStats).toContain("AS idx_scan");
  });

  /**
   * THE CONNECTION BUDGET. `sqlqueryreceiver`'s option is `max_open_conn`,
   * SINGULAR, and it defaults to 0 = unlimited. The plural `max_open_conns` is
   * not a key the receiver knows and is silently ignored, so the misspelling is
   * the dangerous outcome: it reads like a bound in review and enforces
   * nothing.
   *
   * The cap is defence in depth and the test says so rather than implying a
   * bug was fixed: measured steady state on this rig is exactly 13 connections
   * (7 sqlquery receivers + the postgresql receiver) across 30 samples, peaking
   * at 14 under a 150s ACCESS EXCLUSIVE stall. Scrapes serialize; the
   * unbounded growth this guards against did not reproduce.
   */
  it("caps every sqlquery receiver's connections with the singular option name", () => {
    const card = postgresCard(SUBS, gt);
    const configure = card.steps.find((s) => s.id === "dbm-configure")!;
    const config = configure.variants!.find((v) => v.id === "linux-amd64")!.code.raw;

    // One cap per sqlquery receiver — a receiver added later without one would
    // be back to unlimited, and this count is what catches that.
    const receivers = config.match(/^ {2}sqlquery\/\w+:/gm) ?? [];
    expect(receivers.length).toBe(3);
    expect(config.match(/^ {4}max_open_conn: 2$/gm)?.length).toBe(receivers.length);

    // The plural spelling is not a key the receiver knows and is silently
    // ignored, so it must never appear as a SETTING. (It is named in the
    // config's own comment as the thing to avoid, which is why this looks at
    // key lines rather than at the whole text.)
    const keys = config.split("\n").filter((l) => /^\s+[a-z_]+:/.test(l));
    expect(keys.some((l) => l.includes("max_open_conns"))).toBe(false);
  });

  /**
   * COLLECTOR SELF-PROTECTION. This collector usually runs on the customer's
   * DATABASE HOST, so an unbounded heap is a second failure on the machine
   * already having the first one. Observed on this project's rig: a transient
   * DNS failure to the backend produced 28,308 "sending queue is full" events
   * and 2.06 GiB RSS on one collector while an identical sibling reaching a
   * healthy backend sat at 95 MiB.
   *
   * All three parts are pinned because each covers a different unbounded
   * thing: `memory_limiter` back-pressures the receivers instead of growing the
   * heap, a bounded `sending_queue` stops the in-memory buffer being infinite,
   * and `max_elapsed_time` stops a batch that will never succeed being retried
   * forever. And memory_limiter must be FIRST in every pipeline — it guards
   * only what is upstream of it, so a processor listed ahead of it is outside
   * the guard entirely, which is the failure a plain "is it present" assertion
   * would miss.
   */
  it("ships a collector that sheds rather than OOMs the database host", () => {
    const card = postgresCard(SUBS, gt);
    const configure = card.steps.find((s) => s.id === "dbm-configure")!;
    const config = configure.variants!.find((v) => v.id === "linux-amd64")!.code.raw;

    // Defined, with the limits measured stable on this project's own rig.
    expect(config).toContain("memory_limiter:");
    expect(config).toContain("check_interval: 1s");
    expect(config).toContain("limit_mib: 768");
    expect(config).toContain("spike_limit_mib: 192");

    // FIRST in EVERY pipeline. A processor defined but not listed does nothing,
    // and one listed after another does not guard it.
    const pipelines = config.split("service:")[1]!.match(/processors: \[([^\]]+)\]/g) ?? [];
    expect(pipelines.length).toBeGreaterThanOrEqual(2);
    for (const list of pipelines) {
      expect(list, `${list} must start with memory_limiter`).toMatch(
        /processors: \[memory_limiter[,\]]/,
      );
    }

    // The exporter's two bounds. Unset, both are effectively infinite — so
    // these are checked as SETTING lines, not as text: the config's own
    // comments discuss queue_size by name, and a toContain() over the whole
    // document would keep passing after the setting itself was deleted.
    const settings = config
      .split("\n")
      .filter((l) => /^\s+[a-z_]+:/.test(l))
      .map((l) => l.trim());
    expect(settings).toContain("sending_queue:");
    expect(settings).toContain("queue_size: 500");
    expect(settings).toContain("retry_on_failure:");
    expect(settings).toContain("max_elapsed_time: 300s");
  });

  /**
   * THE CADENCE / EXPLAIN-BUDGET RELATIONSHIP (spec §5.3). 15s is a deliberate
   * 4× deviation from upstream's 60s default, bought to keep the Top queries
   * page from feeling a minute stale. It multiplies every per-cycle cost,
   * including the EXPLAIN pass — the ceiling is
   * max_explain_each_interval × (3600 / collection_interval) = 48,000/hour.
   *
   * The ceiling is not the cost: measured on this rig the real rate is
   * 1,775 EXPLAINs/hour (3.7% of it), because `isExplainableQuery()` and the
   * plan cache gate it, and the whole EXPLAIN path costs 23.2ms of database
   * time — 0.034% of exec time. So neither knob is a place to economize, and
   * the comment is what stops an "align with upstream defaults" refactor from
   * reverting the cadence and the budget as if they were independent.
   *
   * Pinned against the comment as well as the values, in the style of the
   * auto_explain test above: the bug this class of test exists to catch is a
   * config whose numbers and whose stated reasoning have drifted apart.
   */
  it("documents why the top-query cadence deviates from upstream, beside the value", () => {
    const card = postgresCard(SUBS, gt);
    const configure = card.steps.find((s) => s.id === "dbm-configure")!;
    const config = configure.variants!.find((v) => v.id === "linux-amd64")!.code.raw;

    const events = config.slice(config.indexOf("postgresql/dbm_events:"));
    // The values, unchanged — the measurement says the cost is negligible, so
    // cutting the budget would lose plan fidelity for nothing.
    expect(events).toContain("collection_interval: 15s");
    expect(events).toContain("max_explain_each_interval: 200");

    // The deviation is recorded as deliberate, with upstream's own default
    // named so the reader knows what they would be "aligning" to.
    expect(events).toMatch(/DELIBERATE DEVIATION FROM UPSTREAM/);
    expect(events).toMatch(/60s/);
    // The relationship the comment exists to protect.
    expect(events).toMatch(/max_explain_each_interval/);
    expect(events).toMatch(/48,000/);
    expect(events).toMatch(/1,775/);
    // And the two changes measurement ruled OUT, so neither is re-proposed.
    expect(events).toMatch(/query_plan_cache_ttl/);
    expect(events).toMatch(/do NOT/i);
  });

  /**
   * THE %Q LOCKSTEP (T6). The optional auto_explain step rewrites
   * log_line_prefix to carry `qid=%Q` — the server's own queryid, the exact
   * join key that survives `= ANY($1)` driver rewrites and >16 KB truncation,
   * where the text fingerprint provably cannot join (measured on the rig).
   * The shared parser regex must accept BOTH prefixes: with qid (this step
   * taken) and without (only the logging step taken).
   */
  it("parses both log_line_prefix shapes, capturing the queryid when present", () => {
    const card = postgresCard(SUBS, gt);
    const explainStep = card.steps.find((s) => s.id === "dbm-auto-explain")!;
    // The step prescribes the queryid prefix and the setting that computes it.
    expect(explainStep.code!.raw).toContain("compute_query_id = on");
    expect(explainStep.code!.raw).toMatch(/log_line_prefix = .*qid=%Q/);

    const configure = card.steps.find((s) => s.id === "dbm-configure")!;
    const collectorConfig = configure.variants!.find((v) => v.id === "linux-amd64")!.code.raw;
    const regexLine = collectorConfig.split("\n").find((l) => l.includes("(?P<pg_pid>"))!;
    const pattern = regexLine.slice(regexLine.indexOf("'") + 1, regexLine.lastIndexOf("'"));
    const parser = new RegExp(
      pattern
        .replace(/\\\\/g, "\\")
        .replace(/\(\?P</g, "(?<")
        .replace(/\(\?s\)/g, ""),
      "s",
    );

    // With the auto_explain step's prefix: qid is captured (negative queryids
    // are real — Postgres queryid is a signed 64-bit hash).
    const withQid =
      "2026-08-13 02:49:33.262 UTC [497] dbm@dbmlab app=t1probe vxid=16/54 txid=0 line=3 qid=-679379679796231264 LOG:  duration: 0.009 ms  plan:";
    const parsedQid = parser.exec(withQid);
    expect(parsedQid).not.toBeNull();
    expect(parsedQid!.groups!.pg_query_id).toBe("-679379679796231264");
    expect(parsedQid!.groups!.pg_message).toContain("plan:");

    // Without it (the logging step's prefix, real captured line): still parses,
    // qid simply absent.
    const withoutQid =
      "2026-08-13 02:49:33.262 UTC [497] dbm@dbmlab app=t1probe vxid=16/54 txid=0 line=3 LOG:  duration: 0.009 ms  plan:";
    const parsedPlain = parser.exec(withoutQid);
    expect(parsedPlain).not.toBeNull();
    expect(parsedPlain!.groups!.pg_query_id).toBeUndefined();
    expect(parsedPlain!.groups!.pg_severity).toBe("LOG");

    // Background workers under the NEW prefix (%q elides the whole session
    // group, qid included) must keep parsing too.
    const background = "2026-08-10 14:22:31.417 UTC [7] LOG:  checkpoint starting: time";
    expect(parser.exec(background)).not.toBeNull();
  });

  /**
   * The auto_explain step is OPTIONAL and must say what it costs. The DBA
   * objection is executor instrumentation on a production primary; a step that
   * hides that gets recipes disabled by the first incident review.
   */
  it("presents auto_explain as optional, after the logging step, with its cost stated", () => {
    const card = postgresCard(SUBS, gt);
    const ids = card.steps.map((s) => s.id);
    expect(ids.indexOf("dbm-auto-explain")).toBeGreaterThan(ids.indexOf("dbm-logging"));

    const step = card.steps.find((s) => s.id === "dbm-auto-explain")!;
    const conf = step.code!.raw;
    // The knob set the parser depends on, spelled exactly.
    expect(conf).toContain("auto_explain.log_format = json");
    expect(conf).toContain("auto_explain.log_analyze = on");
    expect(conf).toContain("auto_explain.log_timing = off");
    expect(conf).toContain("auto_explain.log_buffers = on");
    // BOTH libraries in the preload list — replacing instead of appending
    // silently kills the entire pg_stat_statements top-query path.
    expect(conf).toContain("shared_preload_libraries = 'pg_stat_statements,auto_explain'");
    // …and only in THIS step: the required logging step must not acquire
    // auto_explain, or the optional step stops being optional.
    const loggingConf = card.steps.find((s) => s.id === "dbm-logging")!.code!.raw;
    expect(loggingConf).toContain("shared_preload_libraries = 'pg_stat_statements'");
    expect(loggingConf).not.toContain("auto_explain");

    // The cost story: sampling as the cost control, log_min_duration as the
    // volume control, timing's expense — in the copy a DBA will actually read.
    expect(step.note).toMatch(/sample_rate/);
    expect(step.note).toMatch(/log_min_duration/);
    expect(conf).toMatch(/pg_test_timing|clock/);
    // No server-side knob to pair any more: the note must say ingest is
    // always on with DBM enabled, not send the user to a removed env var.
    expect(step.note).not.toContain("ZO_DB_MONITORING_EXPLAIN_ENABLED");
    expect(step.note).toMatch(/whenever Database Monitoring is enabled/i);
  });

  it("offers psql / docker / GUI tabs to create the monitoring role", () => {
    const prepare = postgresCard(SUBS, gt).steps.find((s) => s.id === "prepare")!;
    expect(prepare.variants?.map((v) => v.id)).toEqual(["psql", "docker", "sql-client"]);
    const psql = prepare.variants!.find((v) => v.id === "psql")!.code;
    expect(psql.raw).toContain("psql");
    expect(psql.raw).toContain("CREATE ROLE myuser");
    expect(prepare.variants!.find((v) => v.id === "docker")!.code.raw).toContain("docker exec");
    expect(prepare.variants!.find((v) => v.id === "sql-client")!.code.lang).toBe("sql");
    expect(prepare.variants!.every((v) => !!v.icon)).toBe(true);
  });

  it("writes a postgresql receiver config with the org's exporter", () => {
    const card = postgresCard(SUBS, gt);
    const configure = card.steps.find((s) => s.id === "configure")!;
    expect(configure.inputs?.map((i) => i.id)).toEqual(["host", "port"]);
    const config = configure.variants!.find((v) => v.id === "linux-amd64")!.code.raw;
    expect(config).toContain("postgresql:");
    expect(config).toContain("endpoint: {host}:{port}");
    expect(config).toContain(`endpoint: ${SUBS.url}/api/${SUBS.org}`);
    expect(config).toContain(`Basic ${SUBS.token}`);
    // Reuses the shared install step (Contrib, per-OS).
    const install = card.steps.find((s) => s.id === "install")!;
    expect(install.variants?.map((v) => v.id)).toContain("linux-amd64");
  });
});

describe("Postgres.vue", () => {
  let wrapper: VueWrapper<any>;

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  it("renders the shared setup card for the postgres slug", () => {
    expect(getDataSourceCard("postgres", SUBS, gt)?.provider.name).toBe("Postgres");
    wrapper = mount(Postgres, { global: { plugins: [mockStore, mockI18n] } });
    const stub = wrapper.findComponent({ name: "SetupCardRenderer" });
    expect(stub.exists()).toBe(true);
    expect((stub.props("content") as any).provider.name).toBe("Postgres");
  });
});

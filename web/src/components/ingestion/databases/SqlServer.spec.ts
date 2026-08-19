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
import SqlServer from "./SqlServer.vue";
import sqlServerCard from "@/components/ingestion/setupCard/content/sqlServer";
import { getDataSourceCard, hasDataSourceCard } from "@/components/ingestion/setupCard/registry";
import { gt } from "@/types/i18n";

// Mock useIngestion so the endpoint is deterministic (no network / URL lookup).
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

// Replace the heavy presentational card with a light stub so we can assert the
// content/subs the wrapper hands it without mounting OStepper/useStreamDetect/etc.
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

describe("sqlServerCard builder", () => {
  it("builds the SQL Server card metadata", () => {
    const card = sqlServerCard(SUBS, gt);
    expect(card.provider.name).toBe("SQL Server");
    // Non-AI metrics card → replaces the "Cost & Tokens Captured" hero badge.
    // Logs too: the optional Database Monitoring steps ship blocking-chain
    // samples into the dbm_server logs stream.
    expect(card.provider.metaBadges).toEqual(["Metrics", "Logs"]);
    expect(card.docUrl).toBe("https://openobserve.ai/blog/monitor-sql-server-with-otel/");
    // The blog's flow: prepare → install → configure → run → verify, then the
    // optional Database Monitoring group.
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

  // SQL Server ships BLOCKING only. Deadlocks arrive as an XML deadlock graph in
  // the system_health session, which the ingest parser cannot read — so a
  // deadlock recipe here would fill the stream with records the Deadlocks page
  // silently drops, which is exactly the "collecting but empty" trap the lock
  // empty-states exist to prevent.
  it("ships a Database Monitoring config the ingest parser can read", () => {
    const card = sqlServerCard(SUBS, gt);

    const grant = card.steps.find((s) => s.id === "dbm-grant")!;
    const grantSql = grant.variants!.find((v) => v.id === "sqlcmd")!.code.raw;
    expect(grantSql).toContain("GRANT VIEW SERVER STATE");
    // BOTH grants, and this one is not optional: sys.fn_xe_file_target_read_file
    // fails with msg 300 without it, so the Deadlocks tab would stay empty
    // forever while blocking kept working — measured against SQL Server 2022.
    expect(grantSql).toContain("GRANT VIEW SERVER PERFORMANCE STATE");

    const configure = card.steps.find((s) => s.id === "dbm-configure")!;
    const config = configure.variants!.find((v) => v.id === "linux-amd64")!.code.raw;
    expect(config).toContain("dbm-config.yaml");
    expect(config).toContain("sqlquery/mssql_blocking");
    // The exact recipe tag server_vantage.rs matches on to resolve the engine.
    expect(config).toContain("mssql_blocking_chain");
    // The aliases canonicalize_blocking reads — renaming any of these silently
    // produces records the backend skips.
    expect(config).toContain("blocked_pid");
    expect(config).toContain("blocking_pid");
    expect(config).toContain("blocking_query");
    expect(config).toContain("stream-name: dbm_server");
    // The filter is load-bearing: filelog tails the WHOLE database log, so
    // without it every ordinary log line lands in dbm_server too (measured:
    // 787 events vs 4.8M untagged rows in one hour) and the Deadlocks page
    // slows to a crawl. A processor that is defined but not listed in the
    // pipeline does nothing, so both are asserted.
    expect(config).toContain("filter/dbm:");
    expect(config).toContain("processors: [memory_limiter, filter/dbm, batch]");

    // Deadlocks ship too, but as a sqlquery receiver rather than a filelog one:
    // SQL Server keeps them in the system_health Extended Events ring buffer as
    // XML, which is shredded server-side into flat rows.
    expect(config).toContain("sqlquery/mssql_deadlocks");
    expect(config).toContain("mssql_deadlock");
    expect(config).not.toContain("filelog/");
    // QUOTED_IDENTIFIER is required for XML methods; without it every collection
    // fails with msg 1934 while the pipeline still looks healthy.
    expect(config).toContain("SET QUOTED_IDENTIFIER ON");
    // The victim is resolved IN the query — SQL Server names it inline, so there
    // is no cross-record verdict to stitch as there is for MySQL/MariaDB.
    expect(config).toContain("victim-list/victimProcess");
    expect(config).toContain("mssql_is_victim");
    // The aliases canonicalize_mssql_deadlock reads.
    expect(config).toContain("mssql_spid");
    expect(config).toContain("mssql_query");

    // EVERY pill this config can fill. Activity and Table health JOINED this
    // list when sqlserverreceiver's events and the mssql table/index-stats
    // recipes were wired in; before that the card promised two tabs and
    // shipped a config that left the others permanently empty.
    const verify = card.steps.find((s) => s.id === "verify-dbm")!;
    expect(verify.pills).toEqual(["Deadlocks", "Blocked queries", "Activity", "Table health"]);
  });

  /**
   * ACTIVITY, TOP QUERIES AND EXECUTION PLANS, from the stock
   * `sqlserverreceiver`. Measured on the rig against SQL Server 2022: 21
   * top_query and 4 query_sample records per window, both previously ZERO.
   *
   * The plans the Top queries detail page renders ride on
   * `db.server.top_query`, so that one key is what turns the plan tree on —
   * which is why the two events are pinned together rather than separately.
   */
  it("ships the receiver's activity, top-query and plan events on, spelled out", () => {
    const card = sqlServerCard(SUBS, gt);
    const configure = card.steps.find((s) => s.id === "dbm-configure")!;
    const config = configure.variants!.find((v) => v.id === "linux-amd64")!.code.raw;

    expect(config).toContain("sqlserver/dbm_events:");
    expect(config).toContain("db.server.query_sample: { enabled: true }");
    expect(config).toContain("db.server.top_query: { enabled: true }");

    // `events:` must be TOP-LEVEL on the receiver (a sibling of the collection
    // blocks) — nesting it inside them is a fatal config error. Upstream
    // v0.148.0 flipped both default-OFF, so without this block the collector
    // looks healthy and emits nothing.
    expect(config).toMatch(/\n {4}events:\n/);

    // SHAPE, and it is NOT mysqlreceiver's. sqlserverreceiver splits `server`
    // and `port` where mysqlreceiver takes one `endpoint`, and it takes NO
    // `database` at all — it reads across the whole instance. These blocks are
    // strictly key-validated, so a key copied across receivers is fatal at
    // startup rather than merely ignored.
    const receiver = config.slice(config.indexOf("sqlserver/dbm_events:"));
    const receiverBlock = receiver.slice(0, receiver.indexOf("\nprocessors:"));
    expect(receiverBlock).toMatch(/\n {4}server:/);
    expect(receiverBlock).toMatch(/\n {4}port:/);
    expect(receiverBlock).not.toMatch(/\n {4}endpoint:/);
    expect(receiverBlock).not.toMatch(/\n {4}database:/);
    // top_query_count is the key this receiver takes; the mysql block's extra
    // knobs are not copied across.
    expect(receiverBlock).toContain("top_query_count:");
    expect(receiverBlock).not.toContain("lookback_time:");

    // The events pipeline must BYPASS filter/dbm: receiver-native events carry
    // no o2_recipe tag, so the filter would silently drop every one.
    // memory_limiter must still be FIRST — anything ahead of it is outside the
    // OOM guard.
    expect(config).toMatch(/logs\/dbm_events:\n\s+receivers: \[sqlserver\/dbm_events\]/);
    expect(config).toMatch(/logs\/dbm_events:[\s\S]*?processors: \[memory_limiter, batch\]/);
    const eventsProcessors = config.match(/logs\/dbm_events:[\s\S]*?processors: \[([^\]]+)\]/)![1];
    expect(eventsProcessors).not.toContain("filter/dbm");

    // NO engine-identity transform here, unlike MariaDB: sqlserverreceiver is
    // SQL Server's own receiver and stamps the right engine itself. Only the
    // borrowed mysqlreceiver on the MariaDB lane misreports.
    expect(config).not.toContain("transform/");
  });

  /**
   * The honesty copy §7 of the ship plan makes a release requirement: SQL
   * Server's capture polls SQL views (works on managed instances, EXCEPT Azure
   * SQL Database), its deadlock text is the whole client batch, and manual runs
   * via sqlcmd hit the QUOTED_IDENTIFIER default-off trap.
   */
  it("states the managed-instance scope and the deadlock-text limits", () => {
    const card = sqlServerCard(SUBS, gt);
    const note = card.steps.find((s) => s.id === "dbm-configure")!.note!;

    // Opposite of the PG/MySQL/MariaDB caveat: SQL polling DOES work managed…
    expect(note).toMatch(/managed SQL Server/i);
    // …except Azure SQL Database, and the reason travels with the limit.
    expect(note).toContain("Azure SQL Database");
    expect(note).toContain("sys.fn_xe_file_target_read_file");
    // Query-text honesty: whole batch, and procs reduce to the EXEC call.
    expect(note).toMatch(/whole batch/i);
    expect(note).toMatch(/EXEC/);
    // The silent sqlcmd trap — the shipped SQL sets it, a manual run must too.
    expect(note).toContain("QUOTED_IDENTIFIER");
  });

  it("writes the config via a shell command with the org's exporter filled in", () => {
    const configure = sqlServerCard(SUBS, gt).steps.find((s) => s.id === "configure")!;
    const unix = configure.variants!.find((v) => v.id === "linux-amd64")!.code;
    expect(unix.lang).toBe("bash");
    // It's a one-shot file-writing command wrapping the full config.
    expect(unix.raw).toContain("cat > config.yaml <<'EOF'");
    expect(unix.raw).toContain("receivers:");
    expect(unix.raw).toContain("otlphttp/openobserve:");
    expect(unix.raw).toContain(`endpoint: ${SUBS.url}/api/${SUBS.org}`);
    expect(unix.raw).toContain(`Basic ${SUBS.token}`);
    // Verified single-receiver config — the blog's duplicate is dropped.
    expect(unix.raw).not.toContain("sqlserver/1");
    // Masked variant hides the token but keeps the rest.
    expect(unix.masked).toBeDefined();
    expect(unix.masked).not.toContain(SUBS.token);
    expect(unix.masked).toContain("otlphttp/openobserve:");
    // Windows variant uses a PowerShell here-string.
    const win = configure.variants!.find((v) => v.id === "windows-amd64")!.code;
    expect(win.lang).toBe("powershell");
    expect(win.raw).toContain("Set-Content -Path config.yaml");
  });

  it("puts host/port inputs on the configure step, referenced via placeholders", () => {
    const configure = sqlServerCard(SUBS, gt).steps.find((s) => s.id === "configure")!;
    expect(configure.inputs?.map((i) => i.id)).toEqual(["server", "port"]);
    // The config keeps {server}/{port} unsubstituted so the renderer fills them
    // live from the inputs (build-time subs only touch url/org/token).
    const unix = configure.variants!.find((v) => v.id === "linux-amd64")!.code;
    expect(unix.raw).toContain("server: {server}");
    expect(unix.raw).toContain("port: {port}");
  });

  it("offers method tabs for applying the grants (sqlcmd / docker / GUI)", () => {
    const prepare = sqlServerCard(SUBS, gt).steps.find((s) => s.id === "prepare")!;
    expect(prepare.code).toBeUndefined();
    expect(prepare.variants?.map((v) => v.id)).toEqual(["sqlcmd", "docker", "sql-client"]);
    // sqlcmd/docker are runnable commands that pipe the SQL via -Q.
    const sqlcmd = prepare.variants!.find((v) => v.id === "sqlcmd")!.code;
    expect(sqlcmd.raw).toContain("sqlcmd");
    expect(sqlcmd.raw).toContain('-Q "');
    expect(sqlcmd.raw).toContain("CREATE LOGIN otel");
    expect(prepare.variants!.find((v) => v.id === "docker")!.code.raw).toContain("docker exec");
    // The GUI tab is the raw SQL to paste into a client.
    const gui = prepare.variants!.find((v) => v.id === "sql-client")!.code;
    expect(gui.lang).toBe("sql");
    expect(gui.raw).toContain("GRANT VIEW SERVER PERFORMANCE STATE");
    expect(gui.raw).not.toContain("sqlcmd");
    // Every tab carries an icon.
    expect(prepare.variants!.every((v) => !!v.icon)).toBe(true);
  });

  it("uses the same literal login in Step 1 and the collector config (in lockstep)", () => {
    const card = sqlServerCard(SUBS, gt);
    const prepare = card.steps.find((s) => s.id === "prepare")!;
    // No extra input fields to decide on — credentials are edited inline.
    expect(prepare.inputs).toBeUndefined();
    const config = card.steps
      .find((s) => s.id === "configure")!
      .variants!.find((v) => v.id === "linux-amd64")!.code.raw;
    expect(config).toContain("username: otel");
    expect(config).toContain('password: "YourStrong@Passw0rd"');
  });

  it("offers OS-specific install variants (no single code block)", () => {
    const install = sqlServerCard(SUBS, gt).steps.find((s) => s.id === "install")!;
    expect(install.code).toBeUndefined();
    expect(install.variants?.map((v) => v.id)).toEqual([
      "linux-amd64",
      "linux-arm64",
      "darwin-arm64",
      "darwin-amd64",
      "windows-amd64",
    ]);
    // Each variant's command targets its own platform asset, pinned to the
    // DBM-verified upstream contrib release (v0.158.0) — the version every
    // Tier-1 recipe was verified against. The OpenObserve collector distro is
    // NOT an option here: it bundles zero database receivers.
    const linux = install.variants!.find((v) => v.id === "linux-amd64")!;
    expect(linux.code.raw).toContain("otelcol-contrib_0.158.0_linux_amd64.tar.gz");
    const win = install.variants!.find((v) => v.id === "windows-amd64")!;
    expect(win.code.lang).toBe("powershell");
    expect(win.code.raw).toContain("windows_amd64");
  });
});

describe("data-source card registry", () => {
  it("resolves the sqlServer slug", () => {
    expect(hasDataSourceCard("sqlServer")).toBe(true);
    expect(getDataSourceCard("sqlServer", SUBS, gt)?.provider.name).toBe("SQL Server");
  });

  it("returns undefined for an unregistered slug", () => {
    expect(hasDataSourceCard("not-a-real-slug")).toBe(false);
    expect(getDataSourceCard("not-a-real-slug", SUBS, gt)).toBeUndefined();
    expect(getDataSourceCard(undefined, SUBS, gt)).toBeUndefined();
  });
});

describe("SqlServer.vue", () => {
  let wrapper: VueWrapper<any>;

  const createWrapper = () =>
    mount(SqlServer, {
      global: { plugins: [mockStore, mockI18n] },
    });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  it("renders the shared setup card for the sqlServer slug", () => {
    wrapper = createWrapper();
    expect(wrapper.findComponent({ name: "SetupCardRenderer" }).exists()).toBe(true);
    // Wrapper tags the card with its own data-test (falls through onto the root).
    expect(wrapper.find('[data-test="data-source-setup-card"]').exists()).toBe(true);
  });

  it("passes the per-org substitutions and SQL Server content to the card", () => {
    wrapper = createWrapper();
    const stub = wrapper.findComponent({ name: "SetupCardRenderer" });
    expect(stub.exists()).toBe(true);

    const subs = stub.props("subs") as Record<string, string>;
    expect(subs.url).toBe("https://test.openobserve.ai");
    expect(subs.org).toBe("test-org");
    // token = base64("email:passcode"), non-empty.
    expect(subs.token).toBeTruthy();

    const content = stub.props("content") as any;
    expect(content.provider.name).toBe("SQL Server");
    const configure = content.steps.find((s: any) => s.id === "configure");
    const unix = configure.variants.find((v: any) => v.id === "linux-amd64");
    expect(unix.code.raw).toContain(`Basic ${subs.token}`);
  });
});

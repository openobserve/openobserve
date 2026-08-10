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
    const card = postgresCard(SUBS);

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
    expect(config).toContain("processors: [filter/dbm, batch]");

    expect(config).toContain(`Basic ${SUBS.token}`);

    // Both configs are passed to one collector.
    const run = card.steps.find((s) => s.id === "dbm-run")!;
    expect(run.code!.raw).toContain("--config ./config.yaml");
    expect(run.code!.raw).toContain("--config ./dbm-config.yaml");
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

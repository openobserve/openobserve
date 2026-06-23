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
import {
  getDataSourceCard,
  hasDataSourceCard,
} from "@/components/ingestion/setupCard/registry";

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
    const card = sqlServerCard(SUBS);
    expect(card.provider.name).toBe("SQL Server");
    // Non-AI metrics card → replaces the "Cost & Tokens Captured" hero badge.
    expect(card.provider.metaBadges).toEqual(["Metrics"]);
    expect(card.docUrl).toBe(
      "https://openobserve.ai/blog/monitor-sql-server-with-otel/",
    );
    // The blog's flow: prepare → install → configure → run → verify.
    expect(card.steps.map((s) => s.id)).toEqual([
      "prepare",
      "install",
      "configure",
      "run",
      "verify",
    ]);
  });

  it("writes the config via a shell command with the org's exporter filled in", () => {
    const configure = sqlServerCard(SUBS).steps.find((s) => s.id === "configure")!;
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
    const configure = sqlServerCard(SUBS).steps.find((s) => s.id === "configure")!;
    expect(configure.inputs?.map((i) => i.id)).toEqual(["server", "port"]);
    // The config keeps {server}/{port} unsubstituted so the renderer fills them
    // live from the inputs (build-time subs only touch url/org/token).
    const unix = configure.variants!.find((v) => v.id === "linux-amd64")!.code;
    expect(unix.raw).toContain("server: {server}");
    expect(unix.raw).toContain("port: {port}");
  });

  it("offers method tabs for applying the grants (sqlcmd / docker / GUI)", () => {
    const prepare = sqlServerCard(SUBS).steps.find((s) => s.id === "prepare")!;
    expect(prepare.code).toBeUndefined();
    expect(prepare.variants?.map((v) => v.id)).toEqual([
      "sqlcmd",
      "docker",
      "sql-client",
    ]);
    // sqlcmd/docker are runnable commands that pipe the SQL via -Q.
    const sqlcmd = prepare.variants!.find((v) => v.id === "sqlcmd")!.code;
    expect(sqlcmd.raw).toContain("sqlcmd");
    expect(sqlcmd.raw).toContain('-Q "');
    expect(sqlcmd.raw).toContain("CREATE LOGIN otel");
    expect(prepare.variants!.find((v) => v.id === "docker")!.code.raw).toContain(
      "docker exec",
    );
    // The GUI tab is the raw SQL to paste into a client.
    const gui = prepare.variants!.find((v) => v.id === "sql-client")!.code;
    expect(gui.lang).toBe("sql");
    expect(gui.raw).toContain("GRANT VIEW SERVER PERFORMANCE STATE");
    expect(gui.raw).not.toContain("sqlcmd");
    // Every tab carries an icon.
    expect(prepare.variants!.every((v) => !!v.icon)).toBe(true);
  });

  it("uses the same literal login in Step 1 and the collector config (in lockstep)", () => {
    const card = sqlServerCard(SUBS);
    const prepare = card.steps.find((s) => s.id === "prepare")!;
    // No extra input fields to decide on — credentials are edited inline.
    expect(prepare.inputs).toBeUndefined();
    const config = card.steps.find((s) => s.id === "configure")!.variants!.find(
      (v) => v.id === "linux-amd64",
    )!.code.raw;
    expect(config).toContain("username: otel");
    expect(config).toContain('password: "YourStrong@Passw0rd"');
  });

  it("offers OS-specific install variants (no single code block)", () => {
    const install = sqlServerCard(SUBS).steps.find((s) => s.id === "install")!;
    expect(install.code).toBeUndefined();
    expect(install.variants?.map((v) => v.id)).toEqual([
      "linux-amd64",
      "linux-arm64",
      "darwin-arm64",
      "darwin-amd64",
      "windows-amd64",
    ]);
    // Each variant's command targets its own platform asset.
    const linux = install.variants!.find((v) => v.id === "linux-amd64")!;
    expect(linux.code.raw).toContain("otelcol-contrib_0.115.1_linux_amd64.tar.gz");
    const win = install.variants!.find((v) => v.id === "windows-amd64")!;
    expect(win.code.lang).toBe("powershell");
    expect(win.code.raw).toContain("windows_amd64");
  });
});

describe("data-source card registry", () => {
  it("resolves the sqlServer slug", () => {
    expect(hasDataSourceCard("sqlServer")).toBe(true);
    expect(getDataSourceCard("sqlServer", SUBS)?.provider.name).toBe(
      "SQL Server",
    );
  });

  it("returns undefined for an unregistered slug", () => {
    expect(hasDataSourceCard("not-a-real-slug")).toBe(false);
    expect(getDataSourceCard("not-a-real-slug", SUBS)).toBeUndefined();
    expect(getDataSourceCard(undefined, SUBS)).toBeUndefined();
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
    expect(
      wrapper.findComponent({ name: "SetupCardRenderer" }).exists(),
    ).toBe(true);
    // Wrapper tags the card with its own data-test (falls through onto the root).
    expect(
      wrapper.find('[data-test="data-source-setup-card"]').exists(),
    ).toBe(true);
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

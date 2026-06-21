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

const mockEndpoint = ref({ url: "https://test.openobserve.ai", host: "h", port: 443, protocol: "https", tls: true });
vi.mock("@/composables/useIngestion", () => ({ default: vi.fn(() => ({ endpoint: mockEndpoint })) }));
vi.mock("@/components/ingestion/setupCard/SetupCardRenderer.vue", () => ({
  default: { name: "SetupCardRenderer", props: ["content", "subs", "logoUrl", "logoUrlDark"], template: '<div data-test="rich-card-stub" />' },
}));

const mockStore = createStore({ state: { selectedOrganization: { identifier: "test-org" }, userInfo: { email: "test@example.com" }, organizationData: { organizationPasscode: "pc" }, theme: "light" } });
const mockI18n = createI18n({ locale: "en", messages: { en: {} } });
const SUBS = { url: "https://test.openobserve.ai", org: "test-org", token: "dGVzdEB0b2tlbg==" };

describe("mysqlCard builder", () => {
  it("builds metadata + step flow", () => {
    const card = mysqlCard(SUBS);
    expect(card.provider.name).toBe("MySQL");
    expect(card.provider.metaBadges).toEqual(["Metrics"]);
    expect(card.detect).toMatchObject({ streamType: "metrics", match: "keyword", streamName: "mysql" });
    expect(card.steps.map((s) => s.id)).toEqual(["prepare", "install", "configure", "run", "verify"]);
  });

  it("offers mysql / docker / GUI tabs to create the user", () => {
    const prepare = mysqlCard(SUBS).steps.find((s) => s.id === "prepare")!;
    expect(prepare.variants?.map((v) => v.id)).toEqual(["mysql", "docker", "sql-client"]);
    const mysql = prepare.variants!.find((v) => v.id === "mysql")!.code;
    expect(mysql.raw).toContain("mysql");
    expect(mysql.raw).toContain('-e "');
    expect(mysql.raw).toContain("CREATE USER 'otel'@'localhost'");
    expect(prepare.variants!.every((v) => !!v.icon)).toBe(true);
  });

  it("writes a mysql receiver config with the org's exporter", () => {
    const configure = mysqlCard(SUBS).steps.find((s) => s.id === "configure")!;
    expect(configure.inputs?.map((i) => i.id)).toEqual(["host", "port"]);
    const config = configure.variants!.find((v) => v.id === "linux-amd64")!.code.raw;
    expect(config).toContain("mysql:");
    expect(config).toContain(`endpoint: ${SUBS.url}/api/${SUBS.org}`);
    expect(config).toContain(`Basic ${SUBS.token}`);
  });
});

describe("MySQL.vue", () => {
  let wrapper: VueWrapper<any>;
  afterEach(() => { if (wrapper) wrapper.unmount(); });
  it("renders the shared card for the mySQL slug", () => {
    expect(getDataSourceCard("mySQL", SUBS)?.provider.name).toBe("MySQL");
    wrapper = mount(MySQL, { global: { plugins: [mockStore, mockI18n] } });
    expect(wrapper.findComponent({ name: "SetupCardRenderer" }).exists()).toBe(true);
  });
});

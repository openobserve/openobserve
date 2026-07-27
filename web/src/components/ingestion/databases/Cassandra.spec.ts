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
import Cassandra from "./Cassandra.vue";
import cassandraCard from "@/components/ingestion/setupCard/content/cassandra";
import { getDataSourceCard } from "@/components/ingestion/setupCard/registry";

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
    userInfo: { email: "t@e.com" },
    organizationData: { organizationPasscode: "pc" },
    theme: "light",
  },
});
const mockI18n = createI18n({ locale: "en", messages: { en: {} } });
const SUBS = { url: "https://test.openobserve.ai", org: "test-org", token: "dGVzdEB0b2tlbg==" };

describe("cassandraCard builder", () => {
  it("builds metadata + JMX step flow", () => {
    const card = cassandraCard(SUBS);
    expect(card.provider.name).toBe("Cassandra");
    expect(card.detect).toMatchObject({
      streamType: "metrics",
      match: "keyword",
      streamName: "cassandra",
    });
    expect(card.steps.map((s) => s.id)).toEqual([
      "jmx-jar",
      "install",
      "configure",
      "run",
      "verify",
    ]);
  });
  it("downloads the JMX jar and uses a jmx receiver targeting cassandra", () => {
    const card = cassandraCard(SUBS);
    expect(card.steps.find((s) => s.id === "jmx-jar")!.code!.raw).toContain(
      "opentelemetry-jmx-metrics.jar",
    );
    const config = card.steps
      .find((s) => s.id === "configure")!
      .variants!.find((v) => v.id === "linux-amd64")!.code.raw;
    expect(config).toContain("jmx:");
    expect(config).toContain("target_system: cassandra");
    expect(config).toContain(`endpoint: ${SUBS.url}/api/${SUBS.org}`);
  });
});
describe("Cassandra.vue", () => {
  let wrapper: VueWrapper<any>;
  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });
  it("renders the shared card", () => {
    expect(getDataSourceCard("cassandra", SUBS)?.provider.name).toBe("Cassandra");
    wrapper = mount(Cassandra, { global: { plugins: [mockStore, mockI18n] } });
    expect(wrapper.findComponent({ name: "SetupCardRenderer" }).exists()).toBe(true);
  });
});

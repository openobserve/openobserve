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
import Aerospike from "./Aerospike.vue";
import aerospikeCard from "@/components/ingestion/setupCard/content/aerospike";
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

describe("aerospikeCard builder", () => {
  it("builds metadata + step flow (no prepare step)", () => {
    const card = aerospikeCard(SUBS);
    expect(card.provider.name).toBe("Aerospike");
    expect(card.detect).toMatchObject({
      streamType: "metrics",
      match: "keyword",
      streamName: "aerospike",
    });
    expect(card.steps.map((s) => s.id)).toEqual(["install", "configure", "run", "verify"]);
  });
  it("has a aerospike receiver config with the org's exporter", () => {
    const config = aerospikeCard(SUBS)
      .steps.find((s) => s.id === "configure")!
      .variants!.find((v) => v.id === "linux-amd64")!.code.raw;
    expect(config).toContain("aerospike:");
    expect(config).toContain(`endpoint: ${SUBS.url}/api/${SUBS.org}`);
    expect(config).toContain(`Basic ${SUBS.token}`);
  });
});
describe("Aerospike.vue", () => {
  let wrapper: VueWrapper<any>;
  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });
  it("renders the shared card", () => {
    expect(getDataSourceCard("aerospike", SUBS)?.provider.name).toBe("Aerospike");
    wrapper = mount(Aerospike, { global: { plugins: [mockStore, mockI18n] } });
    expect(wrapper.findComponent({ name: "SetupCardRenderer" }).exists()).toBe(true);
  });
});

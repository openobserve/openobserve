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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createStore } from "vuex";
import SplunkHec from "@/components/ingestion/logs/SplunkHec.vue";

vi.mock("@/components/CopyContent.vue", () => ({
  default: {
    name: "CopyContent",
    props: ["content"],
    template: "<div class='copy-content-mock'>{{ content }}</div>",
  },
}));

vi.mock("../../../utils/zincutils", () => ({
  getEndPoint: vi.fn().mockReturnValue({
    url: "http://localhost:5080",
    host: "localhost",
    port: "5080",
    protocol: "http",
    tls: false,
  }),
  getImageURL: vi.fn().mockReturnValue("http://example.com/image.png"),
  getIngestionURL: vi.fn().mockReturnValue("http://localhost:5080"),
}));

const mockStore = createStore({
  state: {
    API_ENDPOINT: "http://localhost:5080",
    selectedOrganization: {
      identifier: "test_org_123",
      name: "Test Organization",
    },
    zoConfig: {
      ingestion_url: "",
    },
  },
});

describe("SplunkHec", () => {
  let wrapper: any;

  const createWrapper = (props = {}, customStore = mockStore) =>
    mount(SplunkHec, {
      props: {
        currOrgIdentifier: "test_org_123",
        currUserEmail: "test@example.com",
        ...props,
      },
      global: {
        plugins: [customStore],
        mocks: { $store: customStore },
        stubs: {
          OBanner: { template: "<div class='o-banner-mock'><slot /></div>" },
          OText: { template: "<div class='o-text-mock'><slot /></div>" },
          RouterLink: { template: "<a class='router-link-mock'><slot /></a>" },
        },
      },
    });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Component initialization", () => {
    it("should mount successfully", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should have the correct component name", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe("SplunkHec");
    });

    it("should render inside the shared ingestion content wrapper", () => {
      wrapper = createWrapper();
      expect(wrapper.find(".p-3").exists()).toBe(true);
    });
  });

  describe("Endpoint resolution", () => {
    it("should resolve the endpoint from the ingestion URL", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.endpoint.url).toBe("http://localhost:5080");
    });

    it("should build the collector URL at the root, with no organization segment", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.endpointUrl).toBe("http://localhost:5080/services/collector");
      // The org is resolved from the token, so it must not appear in the path.
      expect(wrapper.vm.endpointUrl).not.toContain("test_org_123");
      expect(wrapper.vm.endpointUrl).not.toContain("/api/");
    });
  });

  describe("Copyable snippets", () => {
    it("should build a curl example carrying the Splunk auth scheme", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.curlContent).toContain("curl");
      expect(wrapper.vm.curlContent).toContain("http://localhost:5080/services/collector");
      expect(wrapper.vm.curlContent).toContain("Authorization: Splunk [SPLUNK_HEC_TOKEN]");
    });

    it("should send a valid HEC envelope in the curl example", () => {
      wrapper = createWrapper();
      const payload = wrapper.vm.curlContent.match(/-d '(.*)'/)[1];
      const parsed = JSON.parse(payload);
      expect(parsed).toHaveProperty("event");
      expect(parsed).toHaveProperty("index");
      expect(parsed).toHaveProperty("time");
    });

    it("should document the full event envelope, including the metadata fields", () => {
      wrapper = createWrapper();
      const parsed = JSON.parse(wrapper.vm.payloadContent);
      expect(parsed.index).toBe("application");
      // Fractional epoch SECONDS, which is what the collector reads.
      expect(parsed.time).toBe(1789060000.123);
      expect(parsed.host).toBeDefined();
      expect(parsed.source).toBeDefined();
      expect(parsed.sourcetype).toBeDefined();
    });

    it("should point the health check at the unauthenticated health path", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.healthContent).toContain("/services/collector/health");
      expect(wrapper.vm.healthContent).not.toContain("Authorization");
    });

    it("should render one copy block per snippet", () => {
      wrapper = createWrapper();
      expect(wrapper.findAll(".copy-content-mock")).toHaveLength(4);
    });
  });

  describe("Token discoverability", () => {
    it("should link to the org-scoped ingestion tokens page", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.ingestionTokensRoute.name).toBe("ingestionTokens");
      expect(wrapper.vm.ingestionTokensRoute.query.org_identifier).toBe("test_org_123");
    });

    it("should tolerate a missing selected organization", () => {
      const storeWithoutOrg = createStore({
        state: { API_ENDPOINT: "http://localhost:5080" },
      });
      wrapper = createWrapper({}, storeWithoutOrg);
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm.ingestionTokensRoute.query.org_identifier).toBeUndefined();
    });
  });

  describe("Operational guidance", () => {
    it("should warn about Edge Processor and TLS", () => {
      wrapper = createWrapper();
      expect(wrapper.findAll(".o-banner-mock")).toHaveLength(2);
    });

    it("should mark the key sections for tests", () => {
      wrapper = createWrapper();
      for (const descriptor of [
        "endpoint",
        "auth",
        "example",
        "payload",
        "health",
        "edge-processor-note",
        "tls-note",
      ]) {
        expect(wrapper.find(`[data-test="ingestion-logs-splunkhec-${descriptor}"]`).exists()).toBe(
          true,
        );
      }
    });
  });

  describe("Props handling", () => {
    it("should accept the shared ingestion props", () => {
      wrapper = createWrapper({
        currOrgIdentifier: "custom_org",
        currUserEmail: "custom@test.com",
      });
      expect(wrapper.props().currOrgIdentifier).toBe("custom_org");
      expect(wrapper.props().currUserEmail).toBe("custom@test.com");
    });

    it("should mount with the props undefined", () => {
      wrapper = createWrapper({ currOrgIdentifier: undefined, currUserEmail: undefined });
      expect(wrapper.exists()).toBe(true);
    });
  });
});

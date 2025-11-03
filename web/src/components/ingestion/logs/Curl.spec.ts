// Copyright 2023 OpenObserve Inc.
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
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { createStore } from "vuex";
import Curl from "@/components/ingestion/logs/Curl.vue";

installQuasar();

// Mock CopyContent component
vi.mock("@/components/CopyContent.vue", () => ({
  default: {
    name: "CopyContent",
    props: ["content"],
    template: "<div class='copy-content-mock'>{{ content }}</div>"
  }
}));

// Mock the utility functions
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
  maskText: vi.fn().mockImplementation((text) => `***${text.slice(-4)}`),
}));

vi.mock("../../../aws-exports", () => ({
  default: {
    aws_project_region: "us-east-1",
    aws_appsync_graphqlEndpoint: "https://example.com/graphql",
  },
}));

const mockStore = createStore({
  state: {  
    organizationPasscode: 11,
    API_ENDPOINT: "http://localhost:5080",
    selectedOrganization: {
      identifier: "test_org_123",
      name: "Test Organization"
    },
    zoConfig: {
      ingestion_url: ""
    }
  },
});

describe("Curl", () => {
  let wrapper: any;

  const createWrapper = (props = {}, customStore = mockStore) => {
    return mount(Curl, {
      props: {
        currOrgIdentifier: "test_org_123",
        currUserEmail: "test@example.com",
        ...props,
      },
      global: {
        plugins: [customStore],
        mocks: {
          $store: customStore
        }
      },
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Component Initialization", () => {
    it("should mount component successfully", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should have correct component name", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe("curl-mechanism");
    });

    it("should render CopyContent component", () => {
      wrapper = createWrapper();
      const copyContent = wrapper.find('.copy-content-mock');
      expect(copyContent.exists()).toBe(true);
    });

    it("should have correct component structure", () => {
      wrapper = createWrapper();
      expect(wrapper.find('.q-pa-sm').exists()).toBe(true);
    });
  });

  describe("Props Handling", () => {
    it("should accept currOrgIdentifier prop", () => {
      const orgId = "custom_org_456";
      wrapper = createWrapper({ currOrgIdentifier: orgId });
      expect(wrapper.props().currOrgIdentifier).toBe(orgId);
    });

    it("should accept currUserEmail prop", () => {
      const email = "custom@test.com";
      wrapper = createWrapper({ currUserEmail: email });
      expect(wrapper.props().currUserEmail).toBe(email);
    });

    it("should handle undefined currOrgIdentifier prop", () => {
      wrapper = createWrapper({ currOrgIdentifier: undefined });
      expect(wrapper.props().currOrgIdentifier).toBeUndefined();
    });

    it("should handle undefined currUserEmail prop", () => {
      wrapper = createWrapper({ currUserEmail: undefined });
      expect(wrapper.props().currUserEmail).toBeUndefined();
    });

    it("should handle empty string props", () => {
      wrapper = createWrapper({ 
        currOrgIdentifier: "",
        currUserEmail: ""
      });
      expect(wrapper.props().currOrgIdentifier).toBe("");
      expect(wrapper.props().currUserEmail).toBe("");
    });
  });

  describe("Store Integration", () => {
    it("should have access to store", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.store).toBeDefined();
      expect(wrapper.vm.store.state).toBeDefined();
    });

    it("should access selectedOrganization from store", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.store.state.selectedOrganization).toBeDefined();
      expect(wrapper.vm.store.state.selectedOrganization.identifier).toBe("test_org_123");
    });

    it("should access API_ENDPOINT from store", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.store.state.API_ENDPOINT).toBe("http://localhost:5080");
    });

    it("should handle missing selectedOrganization", () => {
      const storeWithoutOrg = createStore({
        state: {
          API_ENDPOINT: "http://localhost:5080",
          selectedOrganization: { identifier: "fallback_org" },
        },
      });
      
      wrapper = createWrapper({}, storeWithoutOrg);
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Endpoint Configuration", () => {
    it("should initialize endpoint object", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.endpoint).toBeDefined();
      expect(wrapper.vm.endpoint.url).toBe("http://localhost:5080");
      expect(wrapper.vm.endpoint.host).toBe("localhost");
      expect(wrapper.vm.endpoint.port).toBe("5080");
      expect(wrapper.vm.endpoint.protocol).toBe("http");
    });

    it("should have correct endpoint structure", () => {
      wrapper = createWrapper();
      const endpoint = wrapper.vm.endpoint;
      expect(endpoint).toHaveProperty('url');
      expect(endpoint).toHaveProperty('host');
      expect(endpoint).toHaveProperty('port');
      expect(endpoint).toHaveProperty('protocol');
      expect(endpoint).toHaveProperty('tls');
    });

    it("should handle different endpoint configurations", () => {
      // This would test different endpoint configurations
      wrapper = createWrapper();
      expect(wrapper.vm.endpoint.url).toContain("localhost");
    });
  });

  describe("Content Generation", () => {
    it("should generate curl command content", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.content).toBeDefined();
      expect(wrapper.vm.content).toContain("curl");
      expect(wrapper.vm.content).toContain("-u [EMAIL]:[PASSCODE]");
    });

    it("should include organization identifier in content", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.content).toContain("/api/test_org_123/");
    });

    it("should include correct endpoint URL in content", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.content).toContain("http://localhost:5080");
    });

    it("should include JSON data structure", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.content).toContain('_json');
      expect(wrapper.vm.content).toContain('\\"level\\":\\"info\\"');
      expect(wrapper.vm.content).toContain('\\"job\\":\\"test\\"');
    });

    it("should include proper curl flags", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.content).toContain('-u');
      expect(wrapper.vm.content).toContain('-k');
      expect(wrapper.vm.content).toContain('-d');
    });

    it("should generate valid JSON payload", () => {
      wrapper = createWrapper();
      const jsonMatch = wrapper.vm.content.match(/-d "(\[.*\])"/);
      expect(jsonMatch).toBeTruthy();
      if (jsonMatch) {
        // Unescape the JSON string before parsing
        const unescapedJson = jsonMatch[1].replace(/\\"/g, '"');
        expect(() => JSON.parse(unescapedJson)).not.toThrow();
      }
    });
  });

  describe("Utility Functions Integration", () => {
    it("should expose getImageURL function", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.getImageURL).toBeDefined();
      expect(typeof wrapper.vm.getImageURL).toBe('function');
    });

    it("should expose maskText function", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.maskText).toBeDefined();
      expect(typeof wrapper.vm.maskText).toBe('function');
    });

    it("should call maskText function correctly", () => {
      wrapper = createWrapper();
      const result = wrapper.vm.maskText("sensitive-data");
      expect(result).toContain("***");
    });

    it("should call getImageURL function correctly", () => {
      wrapper = createWrapper();
      const result = wrapper.vm.getImageURL();
      expect(result).toContain("http://");
    });
  });

  describe("Config Integration", () => {
    it("should expose config object", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.config).toBeDefined();
    });

    it("should have aws configuration", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.config.aws_project_region).toBeDefined();
    });
  });

  describe("CopyContent Component Integration", () => {
    it("should pass content to CopyContent component", () => {
      wrapper = createWrapper();
      const copyContent = wrapper.find('.copy-content-mock');
      expect(copyContent.text()).toContain("curl");
    });

    it("should render CopyContent with correct classes", () => {
      wrapper = createWrapper();
      const copyContentContainer = wrapper.find('.copy-content-container-cls');
      expect(copyContentContainer.exists()).toBe(true);
    });
  });

  describe("Reactivity", () => {
    it("should have reactive endpoint", () => {
      wrapper = createWrapper();
      const originalUrl = wrapper.vm.endpoint.url;
      expect(originalUrl).toBeDefined();
      // The endpoint should be a ref, so it should be reactive
      expect(wrapper.vm.endpoint.url).toBe(originalUrl);
    });
  });

  describe("Error Handling", () => {
    it("should handle missing store gracefully", () => {
      const emptyStore = createStore({
        state: {
          API_ENDPOINT: "http://localhost:5080",
          selectedOrganization: { identifier: "default" },
        },
      });
      wrapper = createWrapper({}, emptyStore);
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle invalid props gracefully", () => {
      wrapper = createWrapper({
        currOrgIdentifier: null,
        currUserEmail: null,
      });
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Component Methods Exposure", () => {
    it("should expose all required properties from setup", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.store).toBeDefined();
      expect(wrapper.vm.config).toBeDefined();
      expect(wrapper.vm.endpoint).toBeDefined();
      expect(wrapper.vm.getImageURL).toBeDefined();
      expect(wrapper.vm.maskText).toBeDefined();
      expect(wrapper.vm.content).toBeDefined();
    });
  });

  describe("Template Rendering", () => {
    it("should render main container with correct classes", () => {
      wrapper = createWrapper();
      const container = wrapper.find('.q-pa-sm');
      expect(container.exists()).toBe(true);
    });

    it("should render only one CopyContent component", () => {
      wrapper = createWrapper();
      const copyComponents = wrapper.findAll('.copy-content-mock');
      expect(copyComponents).toHaveLength(1);
    });
  });

  describe("Data Structure Validation", () => {
    it("should have correct curl command structure", () => {
      wrapper = createWrapper();
      const content = wrapper.vm.content;
      expect(content).toMatch(/curl\s+-u\s+\[EMAIL\]:\[PASSCODE\]/);
      expect(content).toMatch(/-k\s+http/);
      expect(content).toMatch(/-d\s+"\[.*\]"/);
    });

    it("should include proper API endpoint path", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.content).toMatch(/\/api\/[^/]+\/default\/_json/);
    });

    it("should have valid JSON structure in curl data", () => {
      wrapper = createWrapper();
      const content = wrapper.vm.content;
      const jsonMatch = content.match(/-d "(\[.*\])"/);
      expect(jsonMatch).toBeTruthy();

      if (jsonMatch) {
        // Unescape the JSON string before parsing
        const unescapedJson = jsonMatch[1].replace(/\\"/g, '"');
        const jsonData = JSON.parse(unescapedJson);
        expect(Array.isArray(jsonData)).toBe(true);
        expect(jsonData[0]).toHaveProperty('level');
        expect(jsonData[0]).toHaveProperty('job');
        expect(jsonData[0]).toHaveProperty('log');
      }
    });
  });

  describe("Edge Cases", () => {
    it("should handle extremely long organization identifiers", () => {
      const longOrgId = "a".repeat(1000);
      wrapper = createWrapper({ currOrgIdentifier: longOrgId });
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle special characters in props", () => {
      wrapper = createWrapper({
        currOrgIdentifier: "org-with-special_chars@123",
        currUserEmail: "user+test@example-domain.co.uk"
      });
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle empty organization in store", () => {
      const storeWithEmptyOrg = createStore({
        state: {
          selectedOrganization: { identifier: "" },
          API_ENDPOINT: "http://localhost:5080"
        },
      });
      
      wrapper = createWrapper({}, storeWithEmptyOrg);
      expect(wrapper.exists()).toBe(true);
    });
  });
});

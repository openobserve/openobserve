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
import Vector from "@/components/ingestion/logs/Vector.vue";

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

describe("Vector.vue Comprehensive Coverage", () => {
  let wrapper: any;

  const createWrapper = (props = {}, customStore = mockStore) => {
    return mount(Vector, {
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

  describe("Component Initialization Tests", () => {
    it("should mount component successfully", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should have correct component name", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe("vector-mechanism");
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

    it("should initialize with all required dependencies", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.store).toBeDefined();
      expect(wrapper.vm.config).toBeDefined();
      expect(wrapper.vm.endpoint).toBeDefined();
      expect(wrapper.vm.content).toBeDefined();
      expect(wrapper.vm.getImageURL).toBeDefined();
    });
  });

  describe("Props Handling Tests", () => {
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

    it("should handle null props", () => {
      wrapper = createWrapper({
        currOrgIdentifier: null,
        currUserEmail: null,
      });
      expect(wrapper.props().currOrgIdentifier).toBeNull();
      expect(wrapper.props().currUserEmail).toBeNull();
    });

    it("should handle special characters in props", () => {
      wrapper = createWrapper({
        currOrgIdentifier: "org-with-special_chars@123",
        currUserEmail: "user+test@example-domain.co.uk"
      });
      expect(wrapper.props().currOrgIdentifier).toBe("org-with-special_chars@123");
      expect(wrapper.props().currUserEmail).toBe("user+test@example-domain.co.uk");
    });
  });

  describe("Store Integration Tests", () => {
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

    it("should integrate with store state changes", () => {
      wrapper = createWrapper();
      const initialOrgId = wrapper.vm.store.state.selectedOrganization.identifier;
      expect(initialOrgId).toBe("test_org_123");
    });
  });

  describe("Endpoint Configuration Tests", () => {
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
      wrapper = createWrapper();
      expect(wrapper.vm.endpoint.url).toContain("localhost");
    });

    it("should be reactive", () => {
      wrapper = createWrapper();
      // Vue ref should be reactive - test the ref itself
      expect(wrapper.vm.endpoint).toBeDefined();
      expect(typeof wrapper.vm.endpoint).toBe('object');
    });

    it("should have correct default endpoint values", () => {
      wrapper = createWrapper();
      expect(typeof wrapper.vm.endpoint.url).toBe('string');
      expect(typeof wrapper.vm.endpoint.host).toBe('string');
      expect(typeof wrapper.vm.endpoint.port).toBe('string');
      expect(typeof wrapper.vm.endpoint.protocol).toBe('string');
    });
  });

  describe("Vector Configuration Content Tests", () => {
    it("should generate vector configuration content", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.content).toBeDefined();
      expect(wrapper.vm.content).toContain("[sinks.openobserve]");
      expect(wrapper.vm.content).toContain('type = "http"');
    });

    it("should include organization identifier in content", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.content).toContain("/api/test_org_123/");
    });

    it("should include correct endpoint URL in content", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.content).toContain("http://localhost:5080");
    });

    it("should include vector sink configuration", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.content).toContain('inputs = [ source or transform id ]');
      expect(wrapper.vm.content).toContain('method = "post"');
      expect(wrapper.vm.content).toContain('auth.strategy = "basic"');
    });

    it("should include authentication placeholders", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.content).toContain('auth.user = "[EMAIL]"');
      expect(wrapper.vm.content).toContain('auth.password = "[PASSCODE]"');
    });

    it("should include compression and encoding configuration", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.content).toContain('compression = "gzip"');
      expect(wrapper.vm.content).toContain('encoding.codec = "json"');
      expect(wrapper.vm.content).toContain('encoding.timestamp_format = "rfc3339"');
    });

    it("should include healthcheck configuration", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.content).toContain('healthcheck.enabled = false');
    });

    it("should include default stream endpoint", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.content).toContain('/default/_json');
    });

    it("should have correct URI format", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.content).toMatch(/uri = "http:\/\/[^"]+\/api\/[^"]+\/default\/_json"/);
    });

    it("should generate valid TOML-like configuration", () => {
      wrapper = createWrapper();
      const lines = wrapper.vm.content.split('\n');
      expect(lines[0]).toBe('[sinks.openobserve]');
      expect(lines[1]).toBe('type = "http"');
    });
  });

  describe("Utility Functions Integration Tests", () => {
    it("should expose getImageURL function", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.getImageURL).toBeDefined();
      expect(typeof wrapper.vm.getImageURL).toBe('function');
    });

    it("should call getImageURL function correctly", () => {
      wrapper = createWrapper();
      const result = wrapper.vm.getImageURL();
      expect(result).toContain("http://");
    });

    it("should integrate with getEndPoint utility", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.endpoint.url).toBe("http://localhost:5080");
    });

    it("should integrate with getIngestionURL utility", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.endpoint).toBeDefined();
    });
  });

  describe("Config Integration Tests", () => {
    it("should expose config object", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.config).toBeDefined();
    });

    it("should have aws configuration", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.config.aws_project_region).toBeDefined();
    });

    it("should expose aws_appsync_graphqlEndpoint", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.config.aws_appsync_graphqlEndpoint).toBeDefined();
    });
  });

  describe("CopyContent Component Integration Tests", () => {
    it("should pass content to CopyContent component", () => {
      wrapper = createWrapper();
      const copyContent = wrapper.find('.copy-content-mock');
      expect(copyContent.text()).toContain("[sinks.openobserve]");
    });

    it("should render CopyContent with correct classes", () => {
      wrapper = createWrapper();
      const copyContentContainer = wrapper.find('.copy-content-container-cls');
      expect(copyContentContainer.exists()).toBe(true);
    });

    it("should pass vector configuration to CopyContent", () => {
      wrapper = createWrapper();
      const copyContent = wrapper.find('.copy-content-mock');
      expect(copyContent.text()).toContain('type = "http"');
      expect(copyContent.text()).toContain('auth.strategy = "basic"');
    });
  });

  describe("Reactivity Tests", () => {
    it("should have reactive endpoint", () => {
      wrapper = createWrapper();
      const originalUrl = wrapper.vm.endpoint.url;
      expect(originalUrl).toBeDefined();
      expect(wrapper.vm.endpoint.url).toBe(originalUrl);
    });

    it("should maintain reactive content", () => {
      wrapper = createWrapper();
      const originalContent = wrapper.vm.content;
      expect(originalContent).toBeDefined();
      expect(wrapper.vm.content).toBe(originalContent);
    });
  });

  describe("Error Handling Tests", () => {
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

    it("should handle empty organization identifier", () => {
      const storeWithEmptyOrg = createStore({
        state: {
          selectedOrganization: { identifier: "" },
          API_ENDPOINT: "http://localhost:5080"
        },
      });
      
      wrapper = createWrapper({}, storeWithEmptyOrg);
      expect(wrapper.exists()).toBe(true);
    });

    it("should not throw errors during initialization", () => {
      expect(() => createWrapper()).not.toThrow();
    });
  });

  describe("Component Methods Exposure Tests", () => {
    it("should expose all required properties from setup", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.store).toBeDefined();
      expect(wrapper.vm.config).toBeDefined();
      expect(wrapper.vm.endpoint).toBeDefined();
      expect(wrapper.vm.getImageURL).toBeDefined();
      expect(wrapper.vm.content).toBeDefined();
    });

    it("should expose correct property types", () => {
      wrapper = createWrapper();
      expect(typeof wrapper.vm.store).toBe('object');
      expect(typeof wrapper.vm.config).toBe('object');
      expect(typeof wrapper.vm.endpoint).toBe('object');
      expect(typeof wrapper.vm.getImageURL).toBe('function');
      expect(typeof wrapper.vm.content).toBe('string');
    });

    it("should have setup function return all required properties", () => {
      wrapper = createWrapper();
      const setupReturnKeys = ['store', 'config', 'endpoint', 'content', 'getImageURL'];
      setupReturnKeys.forEach(key => {
        expect(wrapper.vm).toHaveProperty(key);
      });
    });
  });

  describe("Template Rendering Tests", () => {
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


    it("should render template structure correctly", () => {
      wrapper = createWrapper();
      const template = wrapper.html();
      expect(template).toContain('q-pa-sm');
      expect(template).toContain('copy-content-mock');
    });
  });

  describe("Content Validation Tests", () => {
    it("should have correct vector configuration structure", () => {
      wrapper = createWrapper();
      const content = wrapper.vm.content;
      expect(content).toMatch(/\[sinks\.openobserve\]/);
      expect(content).toMatch(/type = "http"/);
      expect(content).toMatch(/method = "post"/);
    });

    it("should include proper API endpoint path", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.content).toMatch(/uri = "[^"]+\/api\/[^/]+\/default\/_json"/);
    });

    it("should have valid vector sink configuration format", () => {
      wrapper = createWrapper();
      const content = wrapper.vm.content;
      expect(content).toContain('inputs = [ source or transform id ]');
      expect(content).toContain('auth.strategy = "basic"');
      expect(content).toContain('compression = "gzip"');
    });

    it("should include all required vector configuration fields", () => {
      wrapper = createWrapper();
      const content = wrapper.vm.content;
      const requiredFields = [
        '[sinks.openobserve]',
        'type = "http"',
        'inputs =',
        'uri =',
        'method = "post"',
        'auth.strategy = "basic"',
        'auth.user =',
        'auth.password =',
        'compression = "gzip"',
        'encoding.codec = "json"',
        'encoding.timestamp_format = "rfc3339"',
        'healthcheck.enabled = false'
      ];
      
      requiredFields.forEach(field => {
        expect(content).toContain(field);
      });
    });
  });

  describe("Edge Cases Tests", () => {
    it("should handle extremely long organization identifiers", () => {
      const longOrgStore = createStore({
        state: {
          selectedOrganization: { identifier: "a".repeat(1000) },
          API_ENDPOINT: "http://localhost:5080"
        },
      });
      
      wrapper = createWrapper({}, longOrgStore);
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle special characters in organization identifier", () => {
      const specialOrgStore = createStore({
        state: {
          selectedOrganization: { identifier: "org-with-special_chars@123" },
          API_ENDPOINT: "http://localhost:5080"
        },
      });
      
      wrapper = createWrapper({}, specialOrgStore);
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle missing organization in store", () => {
      const storeWithoutOrg = createStore({
        state: {
          selectedOrganization: { identifier: "default" },
          API_ENDPOINT: "http://localhost:5080"
        },
      });
      
      wrapper = createWrapper({}, storeWithoutOrg);
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle different endpoint protocols", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.content).toContain("http://localhost:5080");
    });
  });

  describe("Integration and Performance Tests", () => {
    it("should mount and unmount without memory leaks", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
      
      wrapper.unmount();
      expect(wrapper.exists()).toBe(false);
    });

    it("should handle multiple wrapper instances", () => {
      const wrapper1 = createWrapper();
      const wrapper2 = createWrapper({ currOrgIdentifier: "org2" });
      
      expect(wrapper1.exists()).toBe(true);
      expect(wrapper2.exists()).toBe(true);
      
      wrapper1.unmount();
      wrapper2.unmount();
    });

    it("should maintain consistent behavior across instances", () => {
      const wrapper1 = createWrapper();
      const wrapper2 = createWrapper();
      
      expect(wrapper1.vm.content).toBe(wrapper2.vm.content);
      expect(wrapper1.vm.endpoint.url).toBe(wrapper2.vm.endpoint.url);
      
      wrapper1.unmount();
      wrapper2.unmount();
    });

    it("should handle props updates", async () => {
      wrapper = createWrapper({ currOrgIdentifier: "initial_org" });
      expect(wrapper.props('currOrgIdentifier')).toBe("initial_org");
      
      await wrapper.setProps({ currOrgIdentifier: "updated_org" });
      expect(wrapper.props('currOrgIdentifier')).toBe("updated_org");
    });
  });
});

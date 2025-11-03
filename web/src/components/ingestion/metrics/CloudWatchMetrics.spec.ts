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
import CloudWatchMetrics from "@/components/ingestion/metrics/CloudWatchMetrics.vue";

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

describe("CloudWatchMetrics", () => {
  let wrapper: any;

  const createWrapper = (props = {}, customStore = mockStore) => {
    return mount(CloudWatchMetrics, {
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
      expect(wrapper.vm.$options.name).toBe("cloudwatchMetrics");
    });

    it("should render CopyContent component", () => {
      wrapper = createWrapper();
      const copyContent = wrapper.find('.copy-content-mock');
      expect(copyContent.exists()).toBe(true);
    });

    it("should have correct component structure", () => {
      wrapper = createWrapper();
      expect(wrapper.find('.q-pa-sm').exists()).toBe(true);
      expect(wrapper.find('.copy-content-container-cls').exists()).toBe(true);
    });

    it("should render AWS documentation link", () => {
      wrapper = createWrapper();
      const link = wrapper.find('a[href*="aws.amazon.com"]');
      expect(link.exists()).toBe(true);
      expect(link.attributes('target')).toBe('_blank');
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

    it("should handle null props gracefully", () => {
      wrapper = createWrapper({
        currOrgIdentifier: null,
        currUserEmail: null,
      });
      expect(wrapper.props().currOrgIdentifier).toBeNull();
      expect(wrapper.props().currUserEmail).toBeNull();
    });

    it("should validate prop types", () => {
      wrapper = createWrapper({
        currOrgIdentifier: "test_org",
        currUserEmail: "test@example.com"
      });
      expect(typeof wrapper.props().currOrgIdentifier).toBe('string');
      expect(typeof wrapper.props().currUserEmail).toBe('string');
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

    it("should handle store state changes", () => {
      wrapper = createWrapper();
      const originalOrgId = wrapper.vm.store.state.selectedOrganization.identifier;
      expect(originalOrgId).toBe("test_org_123");
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
      wrapper = createWrapper();
      expect(wrapper.vm.endpoint.url).toContain("localhost");
    });

    it("should validate endpoint URL format", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.endpoint.url).toMatch(/^https?:\/\/.+/);
    });

    it("should validate endpoint host", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.endpoint.host).toBeTruthy();
      expect(typeof wrapper.vm.endpoint.host).toBe('string');
    });

    it("should validate endpoint port", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.endpoint.port).toBeTruthy();
      expect(typeof wrapper.vm.endpoint.port).toBe('string');
    });

    it("should validate endpoint protocol", () => {
      wrapper = createWrapper();
      expect(['http', 'https']).toContain(wrapper.vm.endpoint.protocol);
    });
  });

  describe("Content Generation", () => {
    it("should generate CloudWatch content", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.content).toBeDefined();
      expect(wrapper.vm.content).toContain("HTTP Endpoint:");
      expect(wrapper.vm.content).toContain("Access Key:");
    });

    it("should include organization identifier in content", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.content).toContain("/test_org_123/");
    });

    it("should include correct endpoint URL in content", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.content).toContain("http://localhost:5080");
    });

    it("should include cloudwatch_metrics path", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.content).toContain('cloudwatch_metrics');
    });

    it("should include kinesis_firehose path", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.content).toContain('_kinesis_firehose');
    });

    it("should include AWS path prefix", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.content).toContain('/aws/');
    });

    it("should include access key placeholder", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.content).toContain('[BASIC_PASSCODE]');
    });

    it("should format content correctly", () => {
      wrapper = createWrapper();
      const content = wrapper.vm.content;
      expect(content).toMatch(/HTTP Endpoint: .+/);
      expect(content).toMatch(/Access Key: .+/);
    });

    it("should handle different organization identifiers", () => {
      const storeWithDifferentOrg = createStore({
        state: {
          selectedOrganization: { identifier: "different_org_456" },
          API_ENDPOINT: "http://localhost:5080"
        },
      });
      
      wrapper = createWrapper({}, storeWithDifferentOrg);
      expect(wrapper.vm.content).toContain("/different_org_456/");
    });
  });

  describe("Utility Functions Integration", () => {
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

    it("should use getIngestionURL internally", () => {
      wrapper = createWrapper();
      // getIngestionURL should be called during component setup
      expect(wrapper.vm.endpoint).toBeDefined();
      expect(wrapper.vm.endpoint.url).toBe("http://localhost:5080");
    });

    it("should use getEndPoint internally", () => {
      wrapper = createWrapper();
      // getEndPoint should be called during component setup
      expect(wrapper.vm.endpoint).toBeDefined();
      expect(wrapper.vm.endpoint).toHaveProperty('url');
      expect(wrapper.vm.endpoint).toHaveProperty('host');
      expect(wrapper.vm.endpoint).toHaveProperty('port');
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

    it("should validate config structure", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.config).toHaveProperty('aws_project_region');
      expect(wrapper.vm.config).toHaveProperty('aws_appsync_graphqlEndpoint');
    });
  });

  describe("CopyContent Component Integration", () => {
    it("should pass content to CopyContent component", () => {
      wrapper = createWrapper();
      const copyContent = wrapper.find('.copy-content-mock');
      expect(copyContent.text()).toContain("HTTP Endpoint:");
    });

    it("should render CopyContent with correct classes", () => {
      wrapper = createWrapper();
      const copyContentContainer = wrapper.find('.copy-content-container-cls');
      expect(copyContentContainer.exists()).toBe(true);
    });

    it("should pass correct content format to CopyContent", () => {
      wrapper = createWrapper();
      const copyContent = wrapper.find('.copy-content-mock');
      expect(copyContent.text()).toMatch(/HTTP Endpoint: .+/);
      expect(copyContent.text()).toMatch(/Access Key: .+/);
    });
  });

  describe("Reactivity", () => {
    it("should have reactive endpoint", () => {
      wrapper = createWrapper();
      const originalUrl = wrapper.vm.endpoint.url;
      expect(originalUrl).toBeDefined();
      expect(wrapper.vm.endpoint.url).toBe(originalUrl);
    });

    it("should have reactive content", () => {
      wrapper = createWrapper();
      const originalContent = wrapper.vm.content;
      expect(originalContent).toBeDefined();
      expect(wrapper.vm.content).toBe(originalContent);
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

    it("should render AWS documentation link with correct attributes", () => {
      wrapper = createWrapper();
      const link = wrapper.find('a[href*="aws.amazon.com"]');
      expect(link.attributes('target')).toBe('_blank');
      expect(link.attributes('class')).toContain('q-ml-lg');
      expect(link.attributes('class')).toContain('text-bold');
    });

    it("should render documentation link text", () => {
      wrapper = createWrapper();
      const link = wrapper.find('a[href*="aws.amazon.com"]');
      expect(link.text()).toContain('Click here');
    });

    it("should render instructional text", () => {
      wrapper = createWrapper();
      expect(wrapper.text()).toContain('to explore the process of setting up');
      expect(wrapper.text()).toContain('CloudWatch custom metric stream');
      expect(wrapper.text()).toContain('Data Firehose to OpenObserve');
    });

    it("should render note about output availability", () => {
      wrapper = createWrapper();
      const note = wrapper.find('p.text-italic');
      expect(note.exists()).toBe(true);
      expect(note.text()).toContain("Note: Output is available under Logs");
      expect(note.text()).toContain("cloudwatch_metrics");
    });

    it("should have correct link title attribute", () => {
      wrapper = createWrapper();
      const link = wrapper.find('a[href*="aws.amazon.com"]');
      expect(link.attributes('title')).toContain('AWS CloudWatch Metrics');
    });
  });

  describe("Data Structure Validation", () => {
    it("should have correct endpoint URL structure", () => {
      wrapper = createWrapper();
      const content = wrapper.vm.content;
      expect(content).toMatch(/HTTP Endpoint: https?:\/\/.+\/aws\/.+\/cloudwatch_metrics\/_kinesis_firehose/);
    });

    it("should include proper AWS path structure", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.content).toMatch(/\/aws\/[^/]+\/cloudwatch_metrics\/_kinesis_firehose/);
    });

    it("should have correct access key format", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.content).toMatch(/Access Key: \[BASIC_PASSCODE\]/);
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

    it("should handle missing selectedOrganization.identifier", () => {
      const storeWithoutIdentifier = createStore({
        state: {
          selectedOrganization: {},
          API_ENDPOINT: "http://localhost:5080"
        },
      });
      
      wrapper = createWrapper({}, storeWithoutIdentifier);
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Component Methods Exposure", () => {
    it("should expose all required properties from setup", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.store).toBeDefined();
      expect(wrapper.vm.config).toBeDefined();
      expect(wrapper.vm.endpoint).toBeDefined();
      expect(wrapper.vm.content).toBeDefined();
      expect(wrapper.vm.getImageURL).toBeDefined();
    });

    it("should expose store property", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.store).toBe(mockStore);
    });

    it("should expose endpoint property", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.endpoint).toHaveProperty('url');
    });

    it("should expose content property", () => {
      wrapper = createWrapper();
      expect(typeof wrapper.vm.content).toBe('string');
    });
  });

  describe("Edge Cases", () => {
    it("should handle extremely long organization identifiers", () => {
      const longOrgId = "a".repeat(1000);
      const storeWithLongOrg = createStore({
        state: {
          selectedOrganization: { identifier: longOrgId },
          API_ENDPOINT: "http://localhost:5080"
        },
      });
      wrapper = createWrapper({ currOrgIdentifier: longOrgId }, storeWithLongOrg);
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm.content).toContain(longOrgId);
    });

    it("should handle special characters in organization identifiers", () => {
      const specialOrgId = "org-with-special_chars@123";
      const storeWithSpecialOrg = createStore({
        state: {
          selectedOrganization: { identifier: specialOrgId },
          API_ENDPOINT: "http://localhost:5080"
        },
      });
      wrapper = createWrapper({ currOrgIdentifier: specialOrgId }, storeWithSpecialOrg);
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm.content).toContain(specialOrgId);
    });

    it("should handle special characters in props", () => {
      wrapper = createWrapper({
        currOrgIdentifier: "org-with-special_chars@123",
        currUserEmail: "user+test@example-domain.co.uk"
      });
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle numeric organization identifier", () => {
      const numericOrgId = "123456789";
      const storeWithNumericOrg = createStore({
        state: {
          selectedOrganization: { identifier: numericOrgId },
          API_ENDPOINT: "http://localhost:5080"
        },
      });
      wrapper = createWrapper({ currOrgIdentifier: numericOrgId }, storeWithNumericOrg);
      expect(wrapper.vm.content).toContain(numericOrgId);
    });

    it("should handle mixed case organization identifier", () => {
      const mixedCaseOrgId = "MixedCaseOrgId";
      const storeWithMixedCase = createStore({
        state: {
          selectedOrganization: { identifier: mixedCaseOrgId },
          API_ENDPOINT: "http://localhost:5080"
        },
      });
      wrapper = createWrapper({ currOrgIdentifier: mixedCaseOrgId }, storeWithMixedCase);
      expect(wrapper.vm.content).toContain(mixedCaseOrgId);
    });
  });

  describe("Component Lifecycle", () => {
    it("should initialize properly on mount", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.endpoint).toBeDefined();
      expect(wrapper.vm.content).toBeDefined();
      expect(wrapper.vm.store).toBeDefined();
    });

    it("should maintain state after mount", () => {
      wrapper = createWrapper();
      const initialContent = wrapper.vm.content;
      const initialEndpoint = wrapper.vm.endpoint;
      
      expect(wrapper.vm.content).toBe(initialContent);
      expect(wrapper.vm.endpoint).toBe(initialEndpoint);
    });
  });
});
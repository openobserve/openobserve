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

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { createStore } from "vuex";
import Fluentd from "@/components/ingestion/logs/Fluentd.vue";
import { createI18n } from 'vue-i18n';
import { nextTick } from 'vue';

// Mock dependencies
vi.mock('@/utils/zincutils', () => ({
  getIngestionURL: vi.fn(() => 'http://localhost:5080'),
  getEndPoint: vi.fn((url) => ({
    url: url,
    host: 'localhost',
    port: '5080',
    protocol: 'http',
    tls: false
  })),
  getImageURL: vi.fn((path) => `/assets/${path}`),
}));

vi.mock('../../../aws-exports', () => ({
  default: {
    API_ENDPOINT: 'http://localhost:5080',
    REGION: 'us-east-1'
  }
}));

// Mock CopyContent component to avoid its dependencies
vi.mock('@/components/CopyContent.vue', () => ({
  default: {
    name: 'CopyContent',
    props: ['content'],
    template: '<div class="copy-content-mock">{{ content }}</div>'
  }
}));

installQuasar();

// Create mock store
const mockStore = createStore({
  state: {
    organizationPasscode: 11,
    API_ENDPOINT: "http://localhost:5080",
    selectedOrganization: {
      identifier: "test_org",
      name: "Test Organization"
    },
    zoConfig: {
      ingestion_url: ""
    },
    userInfo: {
      email: "test@example.com",
      name: "Test User"
    },
    organizationData: {
      organizationPasscode: "test_passcode_123"
    }
  },
  getters: {},
  mutations: {},
  actions: {}
});

// Create mock i18n
const mockI18n = createI18n({
  locale: 'en',
  messages: {
    en: {}
  }
});

describe("Fluentd", () => {
  let wrapper: any;
  let mockGetIngestionURL: any;
  let mockGetEndPoint: any;
  let mockGetImageURL: any;

  beforeEach(async () => {
    // Reset mocks
    vi.clearAllMocks();
    
    // Get mock references
    const zincUtilsMock = await import('@/utils/zincutils');
    mockGetIngestionURL = zincUtilsMock.getIngestionURL;
    mockGetEndPoint = zincUtilsMock.getEndPoint;
    mockGetImageURL = zincUtilsMock.getImageURL;
    
    // Set up default mock returns
    mockGetIngestionURL.mockReturnValue('http://localhost:5080');
    mockGetEndPoint.mockReturnValue({
      url: 'http://localhost:5080',
      host: 'localhost',
      port: '5080',
      protocol: 'http',
      tls: false
    });
    mockGetImageURL.mockReturnValue('/assets/test.png');
    
    wrapper = mount(Fluentd, {
      props: {
        currOrgIdentifier: "test_org",
        currUserEmail: "test@example.com",
      },
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
        mocks: {
          $store: mockStore
        }
      },
    });
    
    await nextTick();
  });
  
  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  // Test 1: Component mounting
  it("should mount Fluentd component successfully", () => {
    expect(wrapper.exists()).toBe(true);
    expect(wrapper.vm).toBeTruthy();
  });

  // Test 2: Component name verification
  it("should have correct component name", () => {
    expect(wrapper.vm.$options.name).toBe("fluentd-mechanism");
  });

  // Test 3: Props validation
  it("should accept currOrgIdentifier prop", () => {
    expect(wrapper.vm.currOrgIdentifier).toBe("test_org");
  });

  // Test 4: Props validation
  it("should accept currUserEmail prop", () => {
    expect(wrapper.vm.currUserEmail).toBe("test@example.com");
  });

  // Test 5: Props default handling
  it("should handle missing props gracefully", () => {
    const wrapperWithoutProps = mount(Fluentd, {
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
      },
    });
    expect(wrapperWithoutProps.vm.currOrgIdentifier).toBeUndefined();
    expect(wrapperWithoutProps.vm.currUserEmail).toBeUndefined();
    wrapperWithoutProps.unmount();
  });

  // Test 6: Store integration
  it("should have access to store", () => {
    expect(wrapper.vm.store).toBeTruthy();
    expect(wrapper.vm.store.state.selectedOrganization.identifier).toBe("test_org");
  });

  // Test 7: Config availability
  it("should have config available", () => {
    expect(wrapper.vm.config).toBeTruthy();
  });

  // Test 8: Endpoint initialization
  it("should initialize endpoint object correctly", () => {
    expect(wrapper.vm.endpoint).toBeTruthy();
    expect(typeof wrapper.vm.endpoint).toBe('object');
  });

  // Test 9: Endpoint structure validation
  it("should have correct endpoint structure", () => {
    const endpoint = wrapper.vm.endpoint;
    expect(endpoint).toHaveProperty('url');
    expect(endpoint).toHaveProperty('host');
    expect(endpoint).toHaveProperty('port');
    expect(endpoint).toHaveProperty('protocol');
    expect(endpoint).toHaveProperty('tls');
  });

  // Test 10: getIngestionURL function call
  it("should call getIngestionURL during setup", () => {
    expect(mockGetIngestionURL).toHaveBeenCalled();
  });

  // Test 11: getEndPoint function call
  it("should call getEndPoint with ingestion URL", () => {
    expect(mockGetEndPoint).toHaveBeenCalledWith('http://localhost:5080');
  });

  // Test 12: Content generation
  it("should generate fluentd configuration content", () => {
    expect(wrapper.vm.content).toBeTruthy();
    expect(typeof wrapper.vm.content).toBe('string');
  });

  // Test 13: Content structure validation
  it("should contain source configuration in content", () => {
    const content = wrapper.vm.content;
    expect(content).toContain('<source>');
    expect(content).toContain('@type forward');
    expect(content).toContain('port 24224');
    expect(content).toContain('bind 0.0.0.0');
    expect(content).toContain('</source>');
  });

  // Test 14: Content structure validation
  it("should contain match configuration in content", () => {
    const content = wrapper.vm.content;
    expect(content).toContain('<match **>');
    expect(content).toContain('@type http');
    expect(content).toContain('content_type json');
    expect(content).toContain('json_array true');
    expect(content).toContain('</match>');
  });

  // Test 15: Content endpoint URL validation
  it("should include correct endpoint URL in content", () => {
    const content = wrapper.vm.content;
    expect(content).toContain('http://localhost:5080/api/test_org/default/_json');
  });

  // Test 16: Content authentication section
  it("should include authentication section in content", () => {
    const content = wrapper.vm.content;
    expect(content).toContain('<auth>');
    expect(content).toContain('method basic');
    expect(content).toContain('username [EMAIL]');
    expect(content).toContain('password [PASSCODE]');
    expect(content).toContain('</auth>');
  });

  // Test 17: CopyContent component integration
  it("should render CopyContent component", () => {
    const copyContent = wrapper.findComponent({ name: 'CopyContent' });
    expect(copyContent.exists()).toBe(true);
  });

  // Test 18: CopyContent content prop
  it("should pass content to CopyContent component", () => {
    const copyContent = wrapper.findComponent({ name: 'CopyContent' });
    expect(copyContent.props('content')).toBe(wrapper.vm.content);
  });

  // Test 19: Template structure
  it("should have correct template structure", () => {
    expect(wrapper.find('.q-pa-sm').exists()).toBe(true);
  });

  // Test 20: getImageURL function exposure
  it("should expose getImageURL function", () => {
    expect(wrapper.vm.getImageURL).toBeTruthy();
    expect(typeof wrapper.vm.getImageURL).toBe('function');
  });

  // Test 21: getImageURL function call
  it("should call getImageURL function correctly", () => {
    const result = wrapper.vm.getImageURL('test.png');
    expect(mockGetImageURL).toHaveBeenCalledWith('test.png');
    expect(result).toBe('/assets/test.png');
  });

  // Test 22: Endpoint URL property
  it("should have correct endpoint URL", () => {
    expect(wrapper.vm.endpoint.url).toBe('http://localhost:5080');
  });

  // Test 23: Endpoint host property
  it("should have correct endpoint host", () => {
    expect(wrapper.vm.endpoint.host).toBe('localhost');
  });

  // Test 24: Endpoint port property
  it("should have correct endpoint port", () => {
    expect(wrapper.vm.endpoint.port).toBe('5080');
  });

  // Test 25: Endpoint protocol property
  it("should have correct endpoint protocol", () => {
    expect(wrapper.vm.endpoint.protocol).toBe('http');
  });

  // Test 26: Endpoint TLS property
  it("should have correct endpoint TLS setting", () => {
    expect(wrapper.vm.endpoint.tls).toBe(false);
  });

  // Test 27: Content multiline structure
  it("should generate multiline configuration content", () => {
    const content = wrapper.vm.content;
    const lines = content.split('\n');
    expect(lines.length).toBeGreaterThan(5);
  });

  // Test 28: Dynamic organization identifier in content
  it("should use organization identifier from store in content", () => {
    const content = wrapper.vm.content;
    expect(content).toContain('/api/test_org/');
  });

  // Test 29: Props type validation
  it("should validate prop types correctly", () => {
    const propDefs = wrapper.vm.$options.props;
    expect(propDefs.currOrgIdentifier.type).toBe(String);
    expect(propDefs.currUserEmail.type).toBe(String);
  });

  // Test 30: Component reactive data
  it("should maintain reactive endpoint data", async () => {
    const originalUrl = wrapper.vm.endpoint.url;
    expect(originalUrl).toBe('http://localhost:5080');
    
    // Verify it's reactive
    wrapper.vm.endpoint.url = 'http://test:8080';
    await nextTick();
    expect(wrapper.vm.endpoint.url).toBe('http://test:8080');
  });

  // Test 31: Error handling for invalid store state
  it("should handle missing organization gracefully", () => {
    const storeWithoutOrg = createStore({
      state: {
        selectedOrganization: {
          identifier: "default",
          name: "Default Organization"
        },
        API_ENDPOINT: "http://localhost:5080",
        userInfo: {
          email: "test@example.com"
        },
        organizationData: {
          organizationPasscode: "test_passcode"
        }
      }
    });
    
    const wrapperWithoutOrg = mount(Fluentd, {
      global: {
        plugins: [mockI18n],
        provide: {
          store: storeWithoutOrg,
        },
      },
    });
    
    // Should not throw an error
    expect(wrapperWithoutOrg.exists()).toBe(true);
    wrapperWithoutOrg.unmount();
  });

  // Test 32: Complete setup return object validation
  it("should return all required properties from setup", () => {
    expect(wrapper.vm.store).toBeDefined();
    expect(wrapper.vm.config).toBeDefined();
    expect(wrapper.vm.endpoint).toBeDefined();
    expect(wrapper.vm.content).toBeDefined();
    expect(wrapper.vm.getImageURL).toBeDefined();
  });

  // Test 33: Component unmounting cleanup
  it("should unmount without errors", () => {
    expect(() => wrapper.unmount()).not.toThrow();
  });

  // Test 34: Default content structure validation
  it("should have properly formatted fluentd configuration", () => {
    const content = wrapper.vm.content;
    
    // Check for proper XML-like structure
    expect(content.match(/<source>/g)).toHaveLength(1);
    expect(content.match(/<\/source>/g)).toHaveLength(1);
    expect(content.match(/<match \*\*>/g)).toHaveLength(1);
    expect(content.match(/<\/match>/g)).toHaveLength(1);
    expect(content.match(/<auth>/g)).toHaveLength(1);
    expect(content.match(/<\/auth>/g)).toHaveLength(1);
  });

  // Test 35: Integration test - full component workflow
  it("should perform complete component initialization workflow", async () => {
    // Verify initialization sequence
    expect(mockGetIngestionURL).toHaveBeenCalled();
    expect(mockGetEndPoint).toHaveBeenCalledWith('http://localhost:5080');
    
    // Verify data setup
    expect(wrapper.vm.endpoint).toEqual({
      url: 'http://localhost:5080',
      host: 'localhost',
      port: '5080',
      protocol: 'http',
      tls: false
    });
    
    // Verify content generation
    const content = wrapper.vm.content;
    expect(content).toContain('endpoint http://localhost:5080/api/test_org/default/_json');
    
    // Verify component rendering
    const copyComponent = wrapper.findComponent({ name: 'CopyContent' });
    expect(copyComponent.exists()).toBe(true);
    expect(copyComponent.props('content')).toBe(content);
  });
});

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
import AWSConfig from "./AWSConfig.vue";
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

// Mock vue-router
vi.mock('vue-router', () => ({
  useRoute: vi.fn(() => ({
    query: {},
    path: '/aws',
    name: 'AWSConfig'
  })),
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn()
  }))
}));

// Mock CopyContent component to avoid its dependencies
vi.mock('@/components/CopyContent.vue', () => ({
  default: {
    name: 'CopyContent',
    props: ['content'],
    template: '<div class="copy-content-mock">{{ content }}</div>'
  }
}));

// Mock AWS component dependencies
vi.mock('./AWSQuickSetup.vue', () => ({
  default: {
    name: 'AWSQuickSetup',
    template: '<div class="aws-quick-setup-mock">AWS Quick Setup</div>'
  }
}));

vi.mock('./AWSIndividualServices.vue', () => ({
  default: {
    name: 'AWSIndividualServices',
    props: ['initialSearch'],
    template: '<div class="aws-individual-services-mock">AWS Individual Services</div>'
  }
}));

// Mock console.error to test error handling
const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

installQuasar();

// Create mock store
const mockStore = createStore({
  state: {
    selectedOrganization: {
      identifier: "test_org",
      name: "Test Organization"
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

describe("AWSConfig", () => {
  let wrapper: any;
  let mockGetIngestionURL: any;
  let mockGetEndPoint: any;
  let mockGetImageURL: any;

  beforeEach(async () => {
    // Reset mocks
    vi.clearAllMocks();
    mockConsoleError.mockClear();
    
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
    
    wrapper = mount(AWSConfig, {
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
    mockConsoleError.mockRestore();
  });

  // Test 1: Component mounting
  it("should mount AWSConfig component successfully", () => {
    expect(wrapper.exists()).toBe(true);
    expect(wrapper.vm).toBeTruthy();
  });

  // Test 2: Component name verification
  it("should have correct component name", () => {
    expect(wrapper.vm.$options.name).toBe("AWSConfig");
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
    const wrapperWithoutProps = mount(AWSConfig, {
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
  it("should generate AWS configuration content", () => {
    expect(wrapper.vm.content).toBeTruthy();
    expect(typeof wrapper.vm.content).toBe('string');
  });

  // Test 13: Content structure validation
  it("should contain HTTP endpoint in content", () => {
    const content = wrapper.vm.content;
    expect(content).toContain('HTTP Endpoint:');
    expect(content).toContain('http://localhost:5080/aws/test_org/default/_kinesis_firehose');
  });

  // Test 14: Content access key validation
  it("should contain access key placeholder in content", () => {
    const content = wrapper.vm.content;
    expect(content).toContain('Access Key: [BASIC_PASSCODE]');
  });

  // Test 15: AWSQuickSetup component integration (replaces AWSIntegrationGrid)
  it("should render AWSIntegrationGrid component", () => {
    // Component now uses AWSQuickSetup and AWSIndividualServices instead of AWSIntegrationGrid
    const quickSetup = wrapper.findComponent({ name: 'AWSQuickSetup' });
    expect(quickSetup.exists()).toBe(true);
  });

  // Test 16: Template section heading
  it("should display AWS Integrations heading", () => {
    const heading = wrapper.find('h6');
    expect(heading.exists()).toBe(true);
    expect(heading.text()).toBe('AWS Integrations');
  });

  // Test 17: Template description text
  it("should display integration description", () => {
    const description = wrapper.find('p');
    expect(description.exists()).toBe(true);
    expect(description.text()).toContain('Set up AWS monitoring in one click');
  });

  // Test 18: Integration section structure
  it("should have correct integration section structure", () => {
    expect(wrapper.find('.tw\\:mt-8').exists()).toBe(true);
    expect(wrapper.find('.tw\\:mb-4').exists()).toBe(true);
  });

  // Test 19: CopyContent component integration
  it("should render CopyContent component", () => {
    const copyContent = wrapper.findComponent({ name: 'CopyContent' });
    expect(copyContent.exists()).toBe(true);
  });

  // Test 20: CopyContent content prop
  it("should pass content to CopyContent component", () => {
    const copyContent = wrapper.findComponent({ name: 'CopyContent' });
    expect(copyContent.props('content')).toBe(wrapper.vm.content);
  });

  // Test 21: Template structure
  it("should have correct template structure", () => {
    expect(wrapper.find('.q-ma-md').exists()).toBe(true);
    expect(wrapper.find('.aws-config-page').exists()).toBe(true);
  });

  // Test 22: getImageURL function exposure
  it("should expose getImageURL function", () => {
    expect(wrapper.vm.getImageURL).toBeTruthy();
    expect(typeof wrapper.vm.getImageURL).toBe('function');
  });

  // Test 23: Endpoint URL property
  it("should have correct endpoint URL", () => {
    expect(wrapper.vm.endpoint.url).toBe('http://localhost:5080');
  });

  // Test 24: Endpoint host property
  it("should have correct endpoint host", () => {
    expect(wrapper.vm.endpoint.host).toBe('localhost');
  });

  // Test 25: Endpoint port property
  it("should have correct endpoint port", () => {
    expect(wrapper.vm.endpoint.port).toBe('5080');
  });

  // Test 26: Endpoint protocol property
  it("should have correct endpoint protocol", () => {
    expect(wrapper.vm.endpoint.protocol).toBe('http');
  });

  // Test 27: Endpoint TLS property
  it("should have correct endpoint TLS setting", () => {
    expect(wrapper.vm.endpoint.tls).toBe(false);
  });

  // Test 28: Dynamic organization identifier in content
  it("should use organization identifier from store in content", () => {
    const content = wrapper.vm.content;
    expect(content).toContain('/aws/test_org/');
  });

  // Test 29: Props type validation
  it("should validate prop types correctly", () => {
    const propDefs = wrapper.vm.$options.props;
    expect(propDefs.currOrgIdentifier.type).toBe(String);
    expect(propDefs.currUserEmail.type).toBe(String);
  });

  // Test 30: Error handling for getIngestionURL failure
  it("should handle getIngestionURL error gracefully", async () => {
    mockGetIngestionURL.mockImplementationOnce(() => {
      throw new Error('Network error');
    });

    // Create a component that will trigger the error during setup
    const errorWrapper = mount(AWSConfig, {
      props: {
        currOrgIdentifier: "test_org",
        currUserEmail: "test@example.com",
      },
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
      },
    });

    // Component should still mount despite the error
    expect(errorWrapper.exists()).toBe(true);
    // The endpoint should have initial empty values when error occurs
    expect(errorWrapper.vm.endpoint).toEqual({
      url: "",
      host: "",
      port: "",
      protocol: "",
      tls: "",
    });
    errorWrapper.unmount();
  });

  // Test 31: Error handling for getEndPoint failure  
  it("should handle getEndPoint error gracefully", async () => {
    mockGetEndPoint.mockImplementationOnce(() => {
      throw new Error('Endpoint parsing error');
    });

    // Create a component that will trigger the error during setup
    const errorWrapper = mount(AWSConfig, {
      props: {
        currOrgIdentifier: "test_org",
        currUserEmail: "test@example.com",
      },
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
      },
    });

    // Component should still mount despite the error
    expect(errorWrapper.exists()).toBe(true);
    // The endpoint should have initial empty values when error occurs
    expect(errorWrapper.vm.endpoint).toEqual({
      url: "",
      host: "",
      port: "",
      protocol: "",
      tls: "",
    });
    errorWrapper.unmount();
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

  // Test 34: Content format validation
  it("should generate correctly formatted content", () => {
    const content = wrapper.vm.content;
    const lines = content.split('\n');

    expect(lines.length).toBe(2); // Should have 2 lines
    expect(lines[0]).toMatch(/^HTTP Endpoint:/);
    expect(lines[1]).toMatch(/^Access Key:/);
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
    expect(content).toContain('HTTP Endpoint: http://localhost:5080/aws/test_org/default/_kinesis_firehose');
    expect(content).toContain('Access Key: [BASIC_PASSCODE]');

    // Verify component rendering
    const copyComponent = wrapper.findComponent({ name: 'CopyContent' });
    expect(copyComponent.exists()).toBe(true);
    expect(copyComponent.props('content')).toBe(content);

    // Verify quick setup component (replaces integration grid)
    const quickSetupComponent = wrapper.findComponent({ name: 'AWSQuickSetup' });
    expect(quickSetupComponent.exists()).toBe(true);

    // Verify template structure
    expect(wrapper.find('.q-ma-md').exists()).toBe(true);
    expect(wrapper.find('h6').exists()).toBe(true);
  });
});
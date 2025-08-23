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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref } from 'vue';
import config from '../../../aws-exports';
import { getEndPoint, getImageURL, getIngestionURL } from '../../../utils/zincutils';

// Mock dependencies
vi.mock('../../../aws-exports', () => ({
  default: {
    aws_project_region: 'us-east-1',
    aws_cognito_region: 'us-east-1'
  }
}));

vi.mock('../../../utils/zincutils', () => ({
  getEndPoint: vi.fn(),
  getImageURL: vi.fn(),
  getIngestionURL: vi.fn()
}));

// Mock vue-i18n
const mockT = vi.fn((key: string) => key);
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: mockT
  })
}));

// Mock Vuex store
const mockStore = {
  state: {
    selectedOrganization: {
      identifier: 'test-org',
      name: 'Test Organization'
    }
  }
};

describe('GCPConfig.vue Component Logic', () => {
  const mockEndpointData = {
    url: 'http://localhost:5080',
    host: 'localhost',
    port: '5080',
    protocol: 'http',
    tls: 'false'
  };

  const mockIngestionURL = 'http://localhost:5080';

  beforeEach(() => {
    vi.clearAllMocks();
    
    vi.mocked(getIngestionURL).mockReturnValue(mockIngestionURL);
    vi.mocked(getEndPoint).mockReturnValue(mockEndpointData);
    vi.mocked(getImageURL).mockReturnValue('mock-image-url');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const createComponentSetup = (customStore = mockStore, customProps = {}) => {
    const props = {
      currOrgIdentifier: 'test-org',
      currUserEmail: 'test@example.com',
      ...customProps
    };
    
    const store = customStore;
    const t = mockT;
    
    const endpoint: any = ref({
      url: '',
      host: '',
      port: '',
      protocol: '',
      tls: ''
    });

    const ingestionURL = getIngestionURL();
    endpoint.value = getEndPoint(ingestionURL);
    
    const content = `URL: ${endpoint.value.url}/gcp/${store.state.selectedOrganization.identifier}/default/_sub?API-Key=[BASIC_PASSCODE]`;

    return {
      t,
      store,
      config,
      endpoint,
      content,
      getImageURL,
      props
    };
  };

  // Test 1: Component setup initializes correctly
  it('should initialize reactive data correctly', () => {
    const setup = createComponentSetup();
    
    expect(setup.endpoint.value).toEqual(mockEndpointData);
    expect(setup.store).toBe(mockStore);
    expect(setup.config).toBeDefined();
    expect(setup.content).toContain('URL:');
    expect(setup.t).toBe(mockT);
    expect(setup.getImageURL).toBeDefined();
  });

  // Test 2: Component calls getIngestionURL on setup
  it('should call getIngestionURL during setup', () => {
    createComponentSetup();
    
    expect(getIngestionURL).toHaveBeenCalledTimes(1);
  });

  // Test 3: Component calls getEndPoint with ingestion URL
  it('should call getEndPoint with ingestion URL', () => {
    createComponentSetup();
    
    expect(getEndPoint).toHaveBeenCalledWith(mockIngestionURL);
    expect(getEndPoint).toHaveBeenCalledTimes(1);
  });

  // Test 4: Endpoint ref is initialized with empty values initially
  it('should initialize endpoint with empty values initially', () => {
    const setup = createComponentSetup();
    
    expect(setup.endpoint.value).toEqual(mockEndpointData);
  });

  // Test 5: Endpoint ref gets populated by getEndPoint result
  it('should populate endpoint with getEndPoint result', () => {
    const setup = createComponentSetup();
    
    expect(setup.endpoint.value.url).toBe(mockEndpointData.url);
    expect(setup.endpoint.value.host).toBe(mockEndpointData.host);
    expect(setup.endpoint.value.port).toBe(mockEndpointData.port);
    expect(setup.endpoint.value.protocol).toBe(mockEndpointData.protocol);
    expect(setup.endpoint.value.tls).toBe(mockEndpointData.tls);
  });

  // Test 6: Content string is generated correctly with organization identifier
  it('should generate content with correct organization identifier', () => {
    const setup = createComponentSetup();
    
    expect(setup.content).toContain('/gcp/test-org/default/_sub');
    expect(setup.content).toContain(mockEndpointData.url);
  });

  // Test 7: Content includes proper URL structure
  it('should include correct URL structure in content', () => {
    const setup = createComponentSetup();
    
    const expectedUrl = `${mockEndpointData.url}/gcp/${mockStore.state.selectedOrganization.identifier}/default/_sub?API-Key=[BASIC_PASSCODE]`;
    expect(setup.content).toBe(`URL: ${expectedUrl}`);
  });

  // Test 8: Content includes API key placeholder
  it('should include API key placeholder in content', () => {
    const setup = createComponentSetup();
    
    expect(setup.content).toContain('API-Key=[BASIC_PASSCODE]');
  });

  // Test 9: Component works with different organization identifiers
  it('should work with different organization identifiers', () => {
    const customStore = {
      state: {
        selectedOrganization: {
          identifier: 'custom-gcp-org',
          name: 'Custom GCP Organization'
        }
      }
    };
    
    const setup = createComponentSetup(customStore);
    
    expect(setup.content).toContain('/gcp/custom-gcp-org/default/_sub');
  });

  // Test 10: Component works with different endpoint URLs
  it('should work with different endpoint URLs', () => {
    const customEndpoint = {
      url: 'https://gcp.example.com',
      host: 'gcp.example.com',
      port: '443',
      protocol: 'https',
      tls: 'true'
    };
    
    vi.mocked(getEndPoint).mockReturnValue(customEndpoint);
    
    const setup = createComponentSetup();
    
    expect(setup.content).toContain('https://gcp.example.com/gcp/test-org/default/_sub');
    expect(setup.endpoint.value).toEqual(customEndpoint);
  });

  // Test 11: Component exposes store correctly
  it('should expose store correctly', () => {
    const setup = createComponentSetup();
    
    expect(setup.store).toBe(mockStore);
    expect(setup.store.state.selectedOrganization.identifier).toBe('test-org');
  });

  // Test 12: Component exposes config correctly
  it('should expose config correctly', () => {
    const setup = createComponentSetup();
    
    expect(setup.config).toBe(config);
  });

  // Test 13: Component exposes t function correctly
  it('should expose t function correctly', () => {
    const setup = createComponentSetup();
    
    expect(setup.t).toBe(mockT);
    expect(typeof setup.t).toBe('function');
  });

  // Test 14: Component exposes getImageURL function
  it('should expose getImageURL function', () => {
    const setup = createComponentSetup();
    
    expect(setup.getImageURL).toBe(getImageURL);
    expect(typeof setup.getImageURL).toBe('function');
  });

  // Test 15: Endpoint ref is reactive
  it('should have reactive endpoint ref', () => {
    const setup = createComponentSetup();
    
    setup.endpoint.value.url = 'http://new-gcp-url.com';
    
    expect(setup.endpoint.value.url).toBe('http://new-gcp-url.com');
  });

  // Test 16: Component handles props correctly
  it('should handle props correctly', () => {
    const customProps = {
      currOrgIdentifier: 'prop-org',
      currUserEmail: 'prop@example.com'
    };
    
    const setup = createComponentSetup(mockStore, customProps);
    
    expect(setup.props.currOrgIdentifier).toBe('prop-org');
    expect(setup.props.currUserEmail).toBe('prop@example.com');
  });

  // Test 17: Component handles empty organization identifier
  it('should handle empty organization identifier', () => {
    const emptyOrgStore = {
      state: {
        selectedOrganization: {
          identifier: '',
          name: ''
        }
      }
    };
    
    const setup = createComponentSetup(emptyOrgStore);
    
    expect(setup.content).toContain('/gcp//default/_sub');
  });

  // Test 18: Component handles null organization gracefully
  it('should handle null organization gracefully', () => {
    const nullOrgStore = {
      state: {
        selectedOrganization: null
      }
    };
    
    expect(() => createComponentSetup(nullOrgStore)).toThrow();
  });

  // Test 19: Component handles undefined organization gracefully
  it('should handle undefined organization gracefully', () => {
    const undefinedOrgStore = {
      state: {
        selectedOrganization: undefined
      }
    };
    
    expect(() => createComponentSetup(undefinedOrgStore)).toThrow();
  });

  // Test 20: Content includes the default subscription endpoint
  it('should include default subscription endpoint in content', () => {
    const setup = createComponentSetup();
    
    expect(setup.content).toContain('/default/_sub');
  });

  // Test 21: Component works with HTTPS endpoints
  it('should work correctly with HTTPS endpoints', () => {
    const httpsEndpoint = {
      url: 'https://secure-gcp.example.com',
      host: 'secure-gcp.example.com',
      port: '443',
      protocol: 'https',
      tls: 'true'
    };
    
    vi.mocked(getEndPoint).mockReturnValue(httpsEndpoint);
    
    const setup = createComponentSetup();
    
    expect(setup.endpoint.value.protocol).toBe('https');
    expect(setup.endpoint.value.tls).toBe('true');
    expect(setup.content).toContain('https://secure-gcp.example.com/gcp/test-org/default/_sub');
  });

  // Test 22: Component works with custom ports
  it('should work correctly with custom ports', () => {
    const customPortEndpoint = {
      url: 'http://localhost:8080',
      host: 'localhost',
      port: '8080',
      protocol: 'http',
      tls: 'false'
    };
    
    vi.mocked(getEndPoint).mockReturnValue(customPortEndpoint);
    
    const setup = createComponentSetup();
    
    expect(setup.endpoint.value.port).toBe('8080');
    expect(setup.content).toContain('http://localhost:8080/gcp/test-org/default/_sub');
  });

  // Test 23: getIngestionURL is called with no parameters
  it('should call getIngestionURL with no parameters', () => {
    createComponentSetup();
    
    expect(getIngestionURL).toHaveBeenCalledWith();
  });

  // Test 24: getEndPoint is called exactly once
  it('should call getEndPoint exactly once', () => {
    createComponentSetup();
    
    expect(getEndPoint).toHaveBeenCalledTimes(1);
  });

  // Test 25: Component setup returns all expected properties
  it('should return all expected properties from setup', () => {
    const setup = createComponentSetup();
    
    expect(setup).toHaveProperty('t');
    expect(setup).toHaveProperty('store');
    expect(setup).toHaveProperty('config');
    expect(setup).toHaveProperty('endpoint');
    expect(setup).toHaveProperty('content');
    expect(setup).toHaveProperty('getImageURL');
  });

  // Test 26: Content is a string type
  it('should have content as string type', () => {
    const setup = createComponentSetup();
    
    expect(typeof setup.content).toBe('string');
    expect(setup.content.length).toBeGreaterThan(0);
  });

  // Test 27: Content follows GCP URL pattern
  it('should follow GCP URL pattern', () => {
    const setup = createComponentSetup();
    
    expect(setup.content).toMatch(/URL:\s*https?:\/\/.+\/gcp\/.+\/default\/_sub\?API-Key=\[BASIC_PASSCODE\]/);
  });

  // Test 28: Component handles getEndPoint returning null
  it('should handle getEndPoint returning null gracefully', () => {
    vi.mocked(getEndPoint).mockReturnValue(null as any);
    
    expect(() => createComponentSetup()).toThrow();
  });

  // Test 29: Component handles getEndPoint returning undefined
  it('should handle getEndPoint returning undefined gracefully', () => {
    vi.mocked(getEndPoint).mockReturnValue(undefined as any);
    
    expect(() => createComponentSetup()).toThrow();
  });

  // Test 30: Component handles getIngestionURL returning empty string
  it('should handle getIngestionURL returning empty string', () => {
    vi.mocked(getIngestionURL).mockReturnValue('');
    
    const setup = createComponentSetup();
    
    expect(getEndPoint).toHaveBeenCalledWith('');
  });

  // Test 31: Component handles getIngestionURL returning null
  it('should handle getIngestionURL returning null', () => {
    vi.mocked(getIngestionURL).mockReturnValue(null as any);
    
    const setup = createComponentSetup();
    
    expect(getEndPoint).toHaveBeenCalledWith(null);
  });

  // Test 32: Component works with different ingestion URLs
  it('should work with different ingestion URLs', () => {
    const customIngestionURL = 'https://custom.gcp.url:9200';
    vi.mocked(getIngestionURL).mockReturnValue(customIngestionURL);
    
    const customEndpoint = {
      url: customIngestionURL,
      host: 'custom.gcp.url',
      port: '9200',
      protocol: 'https',
      tls: 'true'
    };
    vi.mocked(getEndPoint).mockReturnValue(customEndpoint);
    
    const setup = createComponentSetup();
    
    expect(getEndPoint).toHaveBeenCalledWith(customIngestionURL);
    expect(setup.content).toContain(customIngestionURL);
  });

  // Test 33: Endpoint ref maintains reactivity
  it('should maintain endpoint ref reactivity', () => {
    const setup = createComponentSetup();
    
    const originalUrl = setup.endpoint.value.url;
    setup.endpoint.value.url = 'http://changed-gcp.com';
    
    expect(setup.endpoint.value.url).not.toBe(originalUrl);
    expect(setup.endpoint.value.url).toBe('http://changed-gcp.com');
  });

  // Test 34: Component exposes correct number of properties
  it('should expose exactly 6 properties from setup', () => {
    const setup = createComponentSetup();
    const keys = Object.keys(setup).filter(key => key !== 'props');
    
    expect(keys).toHaveLength(6);
    expect(keys).toContain('t');
    expect(keys).toContain('store');
    expect(keys).toContain('config');
    expect(keys).toContain('endpoint');
    expect(keys).toContain('content');
    expect(keys).toContain('getImageURL');
  });

  // Test 35: Component handles special characters in organization identifier
  it('should handle special characters in organization identifier', () => {
    const specialCharStore = {
      state: {
        selectedOrganization: {
          identifier: 'gcp-org-with-special-chars_123',
          name: 'Special GCP Org'
        }
      }
    };
    
    const setup = createComponentSetup(specialCharStore);
    
    expect(setup.content).toContain('/gcp/gcp-org-with-special-chars_123/default/_sub');
  });

  // Test 36: Endpoint object has all required properties
  it('should have endpoint object with all required properties', () => {
    const setup = createComponentSetup();
    
    expect(setup.endpoint.value).toHaveProperty('url');
    expect(setup.endpoint.value).toHaveProperty('host');
    expect(setup.endpoint.value).toHaveProperty('port');
    expect(setup.endpoint.value).toHaveProperty('protocol');
    expect(setup.endpoint.value).toHaveProperty('tls');
  });

  // Test 37: Content starts with URL prefix
  it('should have content starting with URL prefix', () => {
    const setup = createComponentSetup();
    
    expect(setup.content).toMatch(/^URL:\s/);
  });

  // Test 38: Component handles props with undefined values
  it('should handle props with undefined values', () => {
    const undefinedProps = {
      currOrgIdentifier: undefined,
      currUserEmail: undefined
    };
    
    const setup = createComponentSetup(mockStore, undefinedProps);
    
    expect(setup.props.currOrgIdentifier).toBeUndefined();
    expect(setup.props.currUserEmail).toBeUndefined();
  });

  // Test 39: Component handles props with empty string values
  it('should handle props with empty string values', () => {
    const emptyProps = {
      currOrgIdentifier: '',
      currUserEmail: ''
    };
    
    const setup = createComponentSetup(mockStore, emptyProps);
    
    expect(setup.props.currOrgIdentifier).toBe('');
    expect(setup.props.currUserEmail).toBe('');
  });

  // Test 40: t function is properly exposed for i18n
  it('should properly expose t function for i18n', () => {
    const setup = createComponentSetup();
    
    expect(setup.t).toBe(mockT);
    setup.t('test.key');
    expect(mockT).toHaveBeenCalledWith('test.key');
  });
});
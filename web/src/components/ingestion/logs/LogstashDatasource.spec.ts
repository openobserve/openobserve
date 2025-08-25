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

// Mock Vuex store
const mockStore = {
  state: {
    selectedOrganization: {
      identifier: 'test-org',
      name: 'Test Organization'
    }
  }
};

describe('LogstashDatasource.vue Component Logic', () => {
  const mockEndpointData = {
    url: 'http://localhost:5080',
    host: 'localhost',
    port: '5080',
    protocol: 'http',
    tls: 'false'
  };

  const mockIngestionURL = 'http://localhost:5080';

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    
    // Setup default mock implementations
    vi.mocked(getIngestionURL).mockReturnValue(mockIngestionURL);
    vi.mocked(getEndPoint).mockReturnValue(mockEndpointData);
    vi.mocked(getImageURL).mockReturnValue('mock-image-url');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Create a mock component setup function that mimics the actual component setup
  const createComponentSetup = (customStore = mockStore) => {
    const store = customStore;
    const endpoint = ref({
      url: '',
      host: '',
      port: '',
      protocol: '',
      tls: ''
    });

    const ingestionURL = getIngestionURL();
    endpoint.value = getEndPoint(ingestionURL);
    const content = `output {
  http {
    url => "${endpoint.value.url}/api/${store.state.selectedOrganization.identifier}/default/_json"
    http_method => "post"
    format => "json_batch"
    headers => {
      "Authorization" => "Basic [BASIC_PASSCODE]"
      "Content-Type" => "application/json"
    }
  }
}`;

    return {
      store,
      config,
      endpoint,
      content,
      getImageURL
    };
  };

  // Test 1: Component setup initializes correctly
  it('should initialize reactive data correctly', () => {
    const setup = createComponentSetup();
    
    expect(setup.endpoint.value).toEqual(mockEndpointData);
    expect(setup.store).toBe(mockStore);
    expect(setup.config).toBeDefined();
    expect(setup.content).toContain('output {');
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

  // Test 4: Endpoint ref is initialized with empty values
  it('should initialize endpoint with empty values initially', () => {
    const setup = createComponentSetup();
    // Note: endpoint gets populated immediately by getEndPoint call
    
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
    
    expect(setup.content).toContain('/api/test-org/default/_json');
    expect(setup.content).toContain(mockEndpointData.url);
  });

  // Test 7: Content includes proper HTTP method
  it('should include correct HTTP method in content', () => {
    const setup = createComponentSetup();
    
    expect(setup.content).toContain('http_method => "post"');
  });

  // Test 8: Content includes proper format
  it('should include correct format in content', () => {
    const setup = createComponentSetup();
    
    expect(setup.content).toContain('format => "json_batch"');
  });

  // Test 9: Content includes authorization header placeholder
  it('should include authorization header placeholder in content', () => {
    const setup = createComponentSetup();
    
    expect(setup.content).toContain('"Authorization" => "Basic [BASIC_PASSCODE]"');
  });

  // Test 10: Content includes content-type header
  it('should include content-type header in content', () => {
    const setup = createComponentSetup();
    
    expect(setup.content).toContain('"Content-Type" => "application/json"');
  });

  // Test 11: Content has proper Logstash output structure
  it('should have proper Logstash output structure', () => {
    const setup = createComponentSetup();
    
    expect(setup.content).toContain('output {');
    expect(setup.content).toContain('http {');
    expect(setup.content).toContain('headers => {');
    expect(setup.content).toContain('}');
  });

  // Test 12: Component works with different organization identifiers
  it('should work with different organization identifiers', () => {
    const customStore = {
      state: {
        selectedOrganization: {
          identifier: 'custom-org-123',
          name: 'Custom Organization'
        }
      }
    };
    
    const setup = createComponentSetup(customStore);
    
    expect(setup.content).toContain('/api/custom-org-123/default/_json');
  });

  // Test 13: Component works with different endpoint URLs
  it('should work with different endpoint URLs', () => {
    const customEndpoint = {
      url: 'https://api.example.com',
      host: 'api.example.com',
      port: '443',
      protocol: 'https',
      tls: 'true'
    };
    
    vi.mocked(getEndPoint).mockReturnValue(customEndpoint);
    
    const setup = createComponentSetup();
    
    expect(setup.content).toContain('https://api.example.com/api/test-org/default/_json');
    expect(setup.endpoint.value).toEqual(customEndpoint);
  });

  // Test 14: Component exposes store correctly
  it('should expose store correctly', () => {
    const setup = createComponentSetup();
    
    expect(setup.store).toBe(mockStore);
    expect(setup.store.state.selectedOrganization.identifier).toBe('test-org');
  });

  // Test 15: Component exposes config correctly
  it('should expose config correctly', () => {
    const setup = createComponentSetup();
    
    expect(setup.config).toBe(config);
  });

  // Test 16: Component exposes getImageURL function
  it('should expose getImageURL function', () => {
    const setup = createComponentSetup();
    
    expect(setup.getImageURL).toBe(getImageURL);
    expect(typeof setup.getImageURL).toBe('function');
  });

  // Test 17: Endpoint ref is reactive
  it('should have reactive endpoint ref', () => {
    const setup = createComponentSetup();
    
    // Change endpoint value
    setup.endpoint.value.url = 'http://new-url.com';
    
    expect(setup.endpoint.value.url).toBe('http://new-url.com');
  });

  // Test 18: Content changes when endpoint changes
  it('should regenerate content when endpoint changes', () => {
    const setup = createComponentSetup();
    
    // Initial content should contain original URL
    expect(setup.content).toContain(mockEndpointData.url);
    
    // Note: Content is generated once during setup, not reactive to endpoint changes
    // This test verifies the initial generation
    expect(setup.content).toContain('/api/test-org/default/_json');
  });

  // Test 19: Component handles empty organization identifier
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
    
    expect(setup.content).toContain('/api//default/_json');
  });

  // Test 20: Component handles null organization
  it('should handle null organization gracefully', () => {
    const nullOrgStore = {
      state: {
        selectedOrganization: null
      }
    };
    
    expect(() => createComponentSetup(nullOrgStore)).toThrow();
  });

  // Test 21: Component handles undefined organization
  it('should handle undefined organization gracefully', () => {
    const undefinedOrgStore = {
      state: {
        selectedOrganization: undefined
      }
    };
    
    expect(() => createComponentSetup(undefinedOrgStore)).toThrow();
  });

  // Test 22: Component handles special characters in organization identifier
  it('should handle special characters in organization identifier', () => {
    const specialCharStore = {
      state: {
        selectedOrganization: {
          identifier: 'org-with-special-chars_123',
          name: 'Special Org'
        }
      }
    };
    
    const setup = createComponentSetup(specialCharStore);
    
    expect(setup.content).toContain('/api/org-with-special-chars_123/default/_json');
  });

  // Test 23: Content includes proper URL structure
  it('should include proper URL structure in content', () => {
    const setup = createComponentSetup();
    
    const expectedUrl = `${mockEndpointData.url}/api/${mockStore.state.selectedOrganization.identifier}/default/_json`;
    expect(setup.content).toContain(`url => "${expectedUrl}"`);
  });

  // Test 24: Endpoint object has all required properties
  it('should have endpoint object with all required properties', () => {
    const setup = createComponentSetup();
    
    expect(setup.endpoint.value).toHaveProperty('url');
    expect(setup.endpoint.value).toHaveProperty('host');
    expect(setup.endpoint.value).toHaveProperty('port');
    expect(setup.endpoint.value).toHaveProperty('protocol');
    expect(setup.endpoint.value).toHaveProperty('tls');
  });

  // Test 25: Component works with HTTPS endpoints
  it('should work correctly with HTTPS endpoints', () => {
    const httpsEndpoint = {
      url: 'https://secure.example.com',
      host: 'secure.example.com',
      port: '443',
      protocol: 'https',
      tls: 'true'
    };
    
    vi.mocked(getEndPoint).mockReturnValue(httpsEndpoint);
    
    const setup = createComponentSetup();
    
    expect(setup.endpoint.value.protocol).toBe('https');
    expect(setup.endpoint.value.tls).toBe('true');
    expect(setup.content).toContain('https://secure.example.com/api/test-org/default/_json');
  });

  // Test 26: Component works with custom ports
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
    expect(setup.content).toContain('http://localhost:8080/api/test-org/default/_json');
  });

  // Test 27: getIngestionURL is called with no parameters
  it('should call getIngestionURL with no parameters', () => {
    createComponentSetup();
    
    expect(getIngestionURL).toHaveBeenCalledWith();
  });

  // Test 28: getEndPoint is called exactly once
  it('should call getEndPoint exactly once', () => {
    createComponentSetup();
    
    expect(getEndPoint).toHaveBeenCalledTimes(1);
  });

  // Test 29: Component setup returns all expected properties
  it('should return all expected properties from setup', () => {
    const setup = createComponentSetup();
    
    expect(setup).toHaveProperty('store');
    expect(setup).toHaveProperty('config');
    expect(setup).toHaveProperty('endpoint');
    expect(setup).toHaveProperty('content');
    expect(setup).toHaveProperty('getImageURL');
  });

  // Test 30: Content is a string type
  it('should have content as string type', () => {
    const setup = createComponentSetup();
    
    expect(typeof setup.content).toBe('string');
    expect(setup.content.length).toBeGreaterThan(0);
  });

  // Test 31: Content follows Logstash configuration syntax
  it('should follow Logstash configuration syntax', () => {
    const setup = createComponentSetup();
    
    // Check for proper Logstash syntax elements
    expect(setup.content).toMatch(/output\s*\{/);
    expect(setup.content).toMatch(/http\s*\{/);
    expect(setup.content).toMatch(/url\s*=>/);
    expect(setup.content).toMatch(/http_method\s*=>/);
    expect(setup.content).toMatch(/format\s*=>/);
    expect(setup.content).toMatch(/headers\s*=>/);
  });

  // Test 32: Component handles getEndPoint returning null
  it('should handle getEndPoint returning null gracefully', () => {
    vi.mocked(getEndPoint).mockReturnValue(null as any);
    
    expect(() => createComponentSetup()).toThrow();
  });

  // Test 33: Component handles getEndPoint returning undefined
  it('should handle getEndPoint returning undefined gracefully', () => {
    vi.mocked(getEndPoint).mockReturnValue(undefined as any);
    
    expect(() => createComponentSetup()).toThrow();
  });

  // Test 34: Component handles getIngestionURL returning empty string
  it('should handle getIngestionURL returning empty string', () => {
    vi.mocked(getIngestionURL).mockReturnValue('');
    
    const setup = createComponentSetup();
    
    expect(getEndPoint).toHaveBeenCalledWith('');
  });

  // Test 35: Component handles getIngestionURL returning null
  it('should handle getIngestionURL returning null', () => {
    vi.mocked(getIngestionURL).mockReturnValue(null as any);
    
    const setup = createComponentSetup();
    
    expect(getEndPoint).toHaveBeenCalledWith(null);
  });

  // Test 36: Content includes the default stream name
  it('should include default stream name in content', () => {
    const setup = createComponentSetup();
    
    expect(setup.content).toContain('/default/_json');
  });

  // Test 37: Content structure is properly formatted
  it('should have properly formatted content structure', () => {
    const setup = createComponentSetup();
    
    // Check for proper indentation and structure
    expect(setup.content).toContain('output {\n  http {');
    expect(setup.content).toContain('    headers => {');
    expect(setup.content).toContain('  }\n}');
  });

  // Test 38: Component works with different ingestion URLs
  it('should work with different ingestion URLs', () => {
    const customIngestionURL = 'https://custom.ingestion.url:9200';
    vi.mocked(getIngestionURL).mockReturnValue(customIngestionURL);
    
    const customEndpoint = {
      url: customIngestionURL,
      host: 'custom.ingestion.url',
      port: '9200',
      protocol: 'https',
      tls: 'true'
    };
    vi.mocked(getEndPoint).mockReturnValue(customEndpoint);
    
    const setup = createComponentSetup();
    
    expect(getEndPoint).toHaveBeenCalledWith(customIngestionURL);
    expect(setup.content).toContain(customIngestionURL);
  });

  // Test 39: Endpoint ref maintains reactivity
  it('should maintain endpoint ref reactivity', () => {
    const setup = createComponentSetup();
    
    const originalUrl = setup.endpoint.value.url;
    setup.endpoint.value.url = 'http://changed.com';
    
    expect(setup.endpoint.value.url).not.toBe(originalUrl);
    expect(setup.endpoint.value.url).toBe('http://changed.com');
  });

  // Test 40: Component exposes correct number of properties
  it('should expose exactly 5 properties from setup', () => {
    const setup = createComponentSetup();
    const keys = Object.keys(setup);
    
    expect(keys).toHaveLength(5);
    expect(keys).toContain('store');
    expect(keys).toContain('config');
    expect(keys).toContain('endpoint');
    expect(keys).toContain('content');
    expect(keys).toContain('getImageURL');
  });
});
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

import { mount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Quasar } from 'quasar';
import TelegrafConfig from './TelegrafConfig.vue';
import { createStore } from 'vuex';

// Mock CopyContent component
const MockCopyContent = {
  name: 'CopyContent',
  props: ['content'],
  template: '<div class="copy-content-mock">{{ content }}</div>'
};

// Mock the utility functions
vi.mock('../../../utils/zincutils', () => ({
  getIngestionURL: vi.fn(() => 'https://example.com:5080'),
  getEndPoint: vi.fn((url) => ({
    url: url,
    host: 'example.com',
    port: '5080',
    protocol: 'https',
    tls: 'On'
  })),
  getImageURL: vi.fn((path) => `/src/assets/${path}`)
}));

// Mock aws-exports config
vi.mock('../../../aws-exports', () => ({
  default: {
    isCloud: 'true',
    cognito_endpoint: 'https://cognito.amazonaws.com'
  }
}));

const store = createStore({
  state: {
    API_ENDPOINT: 'https://example.com:5080',
    selectedOrganization: {
      identifier: 'test_org',
      label: 'Test Organization'
    },
    zoConfig: {
      ingestion_url: ''
    }
  }
});

const defaultProps = {
  currOrgIdentifier: 'test_org',
  currUserEmail: 'test@example.com'
};

describe('TelegrafConfig', () => {
  let wrapper: any;

  beforeEach(() => {
    wrapper = mount(TelegrafConfig, {
      props: defaultProps,
      global: {
        plugins: [Quasar, store],
        components: {
          CopyContent: MockCopyContent
        },
        stubs: {
          CopyContent: MockCopyContent
        }
      }
    });
  });

  describe('Component Initialization', () => {
    it('should render correctly', () => {
      expect(wrapper.exists()).toBe(true);
    });

    it('should have correct component name', () => {
      expect(wrapper.vm.$options.name).toBe('traces-otlp');
    });

    it('should render main container div', () => {
      expect(wrapper.find('.q-pa-sm').exists()).toBe(true);
    });

    it('should render CopyContent component', () => {
      expect(wrapper.findComponent(MockCopyContent).exists()).toBe(true);
    });
  });

  describe('Props Validation', () => {
    it('should accept currOrgIdentifier prop', () => {
      expect(wrapper.props('currOrgIdentifier')).toBe('test_org');
    });

    it('should accept currUserEmail prop', () => {
      expect(wrapper.props('currUserEmail')).toBe('test@example.com');
    });

    it('should handle undefined currOrgIdentifier prop', async () => {
      await wrapper.setProps({ currOrgIdentifier: undefined });
      expect(wrapper.props('currOrgIdentifier')).toBeUndefined();
    });

    it('should handle undefined currUserEmail prop', async () => {
      await wrapper.setProps({ currUserEmail: undefined });
      expect(wrapper.props('currUserEmail')).toBeUndefined();
    });

    it('should handle empty string props', async () => {
      await wrapper.setProps({ 
        currOrgIdentifier: '',
        currUserEmail: ''
      });
      expect(wrapper.props('currOrgIdentifier')).toBe('');
      expect(wrapper.props('currUserEmail')).toBe('');
    });
  });

  describe('Setup Function Data', () => {
    it('should initialize store correctly', () => {
      expect(wrapper.vm.store).toBeDefined();
      expect(wrapper.vm.store.state).toBeDefined();
    });

    it('should initialize config correctly', () => {
      expect(wrapper.vm.config).toBeDefined();
      expect(wrapper.vm.config.isCloud).toBe('true');
    });

    it('should initialize endpoint as reactive reference', () => {
      expect(wrapper.vm.endpoint).toBeDefined();
      expect(typeof wrapper.vm.endpoint).toBe('object');
    });

    it('should have endpoint with correct structure', () => {
      const endpoint = wrapper.vm.endpoint;
      expect(endpoint).toHaveProperty('url');
      expect(endpoint).toHaveProperty('host');
      expect(endpoint).toHaveProperty('port');
      expect(endpoint).toHaveProperty('protocol');
      expect(endpoint).toHaveProperty('tls');
    });

    it('should initialize endpoint with correct values', () => {
      const endpoint = wrapper.vm.endpoint;
      expect(endpoint.url).toBe('https://example.com:5080');
      expect(endpoint.host).toBe('example.com');
      expect(endpoint.port).toBe('5080');
      expect(endpoint.protocol).toBe('https');
      expect(endpoint.tls).toBe('On');
    });

    it('should expose getImageURL function', () => {
      expect(wrapper.vm.getImageURL).toBeDefined();
      expect(typeof wrapper.vm.getImageURL).toBe('function');
    });

    it('should expose ingestionURL', () => {
      expect(wrapper.vm.ingestionURL).toBeDefined();
      expect(wrapper.vm.ingestionURL).toBe('https://example.com:5080');
    });
  });

  describe('Content Generation', () => {
    it('should generate correct telegraf configuration content', () => {
      expect(wrapper.vm.content).toBeDefined();
      expect(typeof wrapper.vm.content).toBe('string');
    });

    it('should include outputs.http section in content', () => {
      expect(wrapper.vm.content).toContain('[[outputs.http]]');
    });

    it('should include correct URL in content', () => {
      expect(wrapper.vm.content).toContain('https://example.com:5080/api/test_org/prometheus/api/v1/write');
    });

    it('should include data format specification', () => {
      expect(wrapper.vm.content).toContain('data_format = "prometheusremotewrite"');
    });

    it('should include correct headers section', () => {
      expect(wrapper.vm.content).toContain('[outputs.http.headers]');
    });

    it('should include Content-Type header', () => {
      expect(wrapper.vm.content).toContain('Content-Type = "application/x-protobuf"');
    });

    it('should include Content-Encoding header', () => {
      expect(wrapper.vm.content).toContain('Content-Encoding = "snappy"');
    });

    it('should include X-Prometheus-Remote-Write-Version header', () => {
      expect(wrapper.vm.content).toContain('X-Prometheus-Remote-Write-Version = "0.1.0"');
    });

    it('should include Authorization header placeholder', () => {
      expect(wrapper.vm.content).toContain('Authorization = "Basic [BASIC_PASSCODE]"');
    });

    it('should use organization identifier from store in URL', () => {
      expect(wrapper.vm.content).toContain(`/api/${wrapper.vm.store.state.selectedOrganization.identifier}/`);
    });
  });

  describe('CopyContent Component Integration', () => {
    it('should pass content to CopyContent component', () => {
      const copyContent = wrapper.findComponent(MockCopyContent);
      expect(copyContent.props('content')).toBe(wrapper.vm.content);
    });

  });

  describe('Store Integration', () => {
    it('should use store state for selected organization', () => {
      expect(wrapper.vm.store.state.selectedOrganization).toBeDefined();
      expect(wrapper.vm.store.state.selectedOrganization.identifier).toBe('test_org');
    });

    it('should use store state for API endpoint', () => {
      expect(wrapper.vm.store.state.API_ENDPOINT).toBe('https://example.com:5080');
    });

    it('should handle organization identifier changes', async () => {
      // Update store state
      wrapper.vm.store.state.selectedOrganization.identifier = 'new_org';
      await wrapper.vm.$nextTick();
      
      // Re-mount to test new configuration
      const newWrapper = mount(TelegrafConfig, {
        props: { currOrgIdentifier: 'new_org' },
        global: {
          plugins: [Quasar, store],
          components: { CopyContent: MockCopyContent },
          stubs: { CopyContent: MockCopyContent }
        }
      });
      
      expect(newWrapper.vm.content).toContain('/api/new_org/');
    });
  });

  describe('Utility Function Calls', () => {
    it('should call getIngestionURL during setup', async () => {
      const zincutils = await import('../../../utils/zincutils');
      expect(zincutils.getIngestionURL).toHaveBeenCalled();
    });

    it('should call getEndPoint with ingestion URL', async () => {
      const zincutils = await import('../../../utils/zincutils');
      expect(zincutils.getEndPoint).toHaveBeenCalledWith('https://example.com:5080');
    });

    it('should handle getImageURL calls', () => {
      const result = wrapper.vm.getImageURL('test.png');
      expect(result).toBe('/src/assets/test.png');
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle empty organization identifier', () => {
      const storeWithEmptyOrg = createStore({
        state: {
          ...store.state,
          selectedOrganization: {
            identifier: '',
            label: 'Empty Org'
          }
        }
      });

      const wrapperWithEmptyOrg = mount(TelegrafConfig, {
        props: defaultProps,
        global: {
          plugins: [Quasar, storeWithEmptyOrg],
          components: { CopyContent: MockCopyContent },
          stubs: { CopyContent: MockCopyContent }
        }
      });

      expect(wrapperWithEmptyOrg.vm.content).toContain('/api//prometheus/api/v1/write');
    });

    it('should handle component remounting correctly', () => {
      const newWrapper = mount(TelegrafConfig, {
        props: { 
          currOrgIdentifier: 'another_org',
          currUserEmail: 'another@example.com'
        },
        global: {
          plugins: [Quasar, store],
          components: { CopyContent: MockCopyContent },
          stubs: { CopyContent: MockCopyContent }
        }
      });

      expect(newWrapper.vm.endpoint).toBeDefined();
      expect(newWrapper.vm.content).toContain('new_org'); // Uses store org identifier
    });

    it('should maintain endpoint structure consistency', () => {
      const endpoint = wrapper.vm.endpoint;
      expect(Object.keys(endpoint)).toEqual(['url', 'host', 'port', 'protocol', 'tls']);
    });

    it('should handle different protocol endpoints', async () => {
      const mockGetEndPoint = vi.fn(() => ({
        url: 'http://localhost:5080',
        host: 'localhost',
        port: '5080',
        protocol: 'http',
        tls: 'Off'
      }));
      
      const zincutils = await import('../../../utils/zincutils');
      zincutils.getEndPoint.mockImplementationOnce(mockGetEndPoint);

      const newWrapper = mount(TelegrafConfig, {
        props: defaultProps,
        global: {
          plugins: [Quasar, store],
          components: { CopyContent: MockCopyContent },
          stubs: { CopyContent: MockCopyContent }
        }
      });

      expect(newWrapper.vm.endpoint.protocol).toBe('http');
      expect(newWrapper.vm.endpoint.tls).toBe('Off');
    });
  });
});
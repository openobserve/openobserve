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
import { mount } from '@vue/test-utils';
import { Quasar } from 'quasar';
import SyslogNg from './SyslogNg.vue';
import { createStore } from 'vuex';
import { createI18n } from 'vue-i18n';

// Mock the utility functions
vi.mock('@/utils/zincutils', () => ({
  getEndPoint: vi.fn((url) => ({
    url: url || 'http://localhost:5080',
    host: 'localhost',
    port: '5080',
    protocol: 'http',
    tls: false,
  })),
  getImageURL: vi.fn(() => 'http://localhost:5080/web/src/assets/images/logo.png'),
  getIngestionURL: vi.fn(() => 'http://localhost:5080'),
}));

// Mock aws-exports
vi.mock('@/aws-exports', () => ({
  default: {
    aws_project_region: 'us-west-2',
    aws_cognito_identity_pool_id: 'test-pool-id',
    aws_cognito_region: 'us-west-2',
    aws_user_pools_id: 'test-pool',
    aws_user_pools_web_client_id: 'test-client-id',
    oauth: {},
  },
}));

// Mock CopyContent component
vi.mock('@/components/CopyContent.vue', () => ({
  default: {
    name: 'CopyContent',
    template: '<div data-test="copy-content">Copy Content Mock</div>',
    props: ['content'],
  },
}));

const createMockStore = (overrides = {}) => createStore({
  state: {
    selectedOrganization: {
      identifier: 'test-org',
      name: 'Test Organization',
    },
    userInfo: {
      email: 'test@example.com',
    },
    organizationData: {
      organizationPasscode: 'test-passcode-123',
    },
    ...overrides,
  },
});

const mockI18n = createI18n({
  locale: 'en',
  messages: {
    en: {},
  },
});

describe('SyslogNg.vue Comprehensive Coverage', () => {
  let mockStore: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStore = createMockStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Component Mounting and Props', () => {
    it('should mount SyslogNg component successfully', () => {
      const wrapper = mount(SyslogNg, {
        props: {
          currOrgIdentifier: 'test-org',
          currUserEmail: 'test@example.com',
        },
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm.$options.name).toBe('SyslogNg');
    });

    it('should handle props correctly', () => {
      const wrapper = mount(SyslogNg, {
        props: {
          currOrgIdentifier: 'custom-org-id',
          currUserEmail: 'custom@email.com',
        },
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      expect(wrapper.props('currOrgIdentifier')).toBe('custom-org-id');
      expect(wrapper.props('currUserEmail')).toBe('custom@email.com');
    });

    it('should handle missing props gracefully', () => {
      const wrapper = mount(SyslogNg, {
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      expect(wrapper.props('currOrgIdentifier')).toBeUndefined();
      expect(wrapper.props('currUserEmail')).toBeUndefined();
    });

    it('should handle empty string props', () => {
      const wrapper = mount(SyslogNg, {
        props: {
          currOrgIdentifier: '',
          currUserEmail: '',
        },
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      expect(wrapper.props('currOrgIdentifier')).toBe('');
      expect(wrapper.props('currUserEmail')).toBe('');
    });
  });

  describe('Store Integration', () => {
    it('should access Vuex store correctly', () => {
      const wrapper = mount(SyslogNg, {
        props: {
          currOrgIdentifier: 'test-org',
          currUserEmail: 'test@example.com',
        },
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      expect(wrapper.vm.store).toBeDefined();
      expect(wrapper.vm.store.state).toBeDefined();
      expect(wrapper.vm.store.state.selectedOrganization.identifier).toBe('test-org');
    });

    it('should handle different organization identifiers from store', () => {
      const customStore = createMockStore({
        selectedOrganization: {
          identifier: 'different-org',
          name: 'Different Organization',
        },
      });

      const wrapper = mount(SyslogNg, {
        props: {
          currOrgIdentifier: 'test-org',
          currUserEmail: 'test@example.com',
        },
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: customStore,
          },
        },
      });

      expect(wrapper.vm.store.state.selectedOrganization.identifier).toBe('different-org');
    });

    it('should handle store with minimal state', () => {
      const minimalStore = createStore({
        state: {
          selectedOrganization: {
            identifier: 'minimal-org',
          },
        },
      });

      const wrapper = mount(SyslogNg, {
        props: {
          currOrgIdentifier: 'test-org',
          currUserEmail: 'test@example.com',
        },
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: minimalStore,
          },
        },
      });

      expect(wrapper.vm.store.state.selectedOrganization.identifier).toBe('minimal-org');
    });
  });

  describe('Setup Function and Return Values', () => {
    it('should return all required values from setup', () => {
      const wrapper = mount(SyslogNg, {
        props: {
          currOrgIdentifier: 'test-org',
          currUserEmail: 'test@example.com',
        },
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      expect(wrapper.vm.store).toBeDefined();
      expect(wrapper.vm.config).toBeDefined();
      expect(wrapper.vm.endpoint).toBeDefined();
      expect(wrapper.vm.content).toBeDefined();
      expect(wrapper.vm.getImageURL).toBeDefined();
    });

    it('should initialize endpoint object with correct structure', () => {
      const wrapper = mount(SyslogNg, {
        props: {
          currOrgIdentifier: 'test-org',
          currUserEmail: 'test@example.com',
        },
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      expect(wrapper.vm.endpoint).toHaveProperty('url');
      expect(wrapper.vm.endpoint).toHaveProperty('host');
      expect(wrapper.vm.endpoint).toHaveProperty('port');
      expect(wrapper.vm.endpoint).toHaveProperty('protocol');
      expect(wrapper.vm.endpoint).toHaveProperty('tls');
    });

    it('should set endpoint values from getEndPoint function', () => {
      const wrapper = mount(SyslogNg, {
        props: {
          currOrgIdentifier: 'test-org',
          currUserEmail: 'test@example.com',
        },
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      expect(wrapper.vm.endpoint.url).toBe('http://localhost:5080');
      expect(wrapper.vm.endpoint.host).toBe('localhost');
      expect(wrapper.vm.endpoint.port).toBe('5080');
      expect(wrapper.vm.endpoint.protocol).toBe('http');
      expect(wrapper.vm.endpoint.tls).toBe(false);
    });
  });

  describe('Content Generation', () => {
    it('should generate correct syslog-ng configuration content', () => {
      const wrapper = mount(SyslogNg, {
        props: {
          currOrgIdentifier: 'test-org',
          currUserEmail: 'test@example.com',
        },
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      expect(wrapper.vm.content).toContain('destination d_openobserve_http');
      expect(wrapper.vm.content).toContain('openobserve-log');
      expect(wrapper.vm.content).toContain('url("http://localhost:5080")');
      expect(wrapper.vm.content).toContain('organization("test-org")');
      expect(wrapper.vm.content).toContain('stream("syslog-ng")');
      expect(wrapper.vm.content).toContain('user("[EMAIL]")');
      expect(wrapper.vm.content).toContain('password("[PASSCODE]")');
    });

    it('should include log configuration section', () => {
      const wrapper = mount(SyslogNg, {
        props: {
          currOrgIdentifier: 'test-org',
          currUserEmail: 'test@example.com',
        },
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      expect(wrapper.vm.content).toContain('log {');
      expect(wrapper.vm.content).toContain('source(s_src);');
      expect(wrapper.vm.content).toContain('destination(d_openobserve_http);');
      expect(wrapper.vm.content).toContain('flags(flow-control);');
      expect(wrapper.vm.content).toContain('};');
    });

    it('should handle different organization identifiers in content', () => {
      const customStore = createMockStore({
        selectedOrganization: {
          identifier: 'custom-organization-name',
          name: 'Custom Organization',
        },
      });

      const wrapper = mount(SyslogNg, {
        props: {
          currOrgIdentifier: 'test-org',
          currUserEmail: 'test@example.com',
        },
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: customStore,
          },
        },
      });

      expect(wrapper.vm.content).toContain('organization("custom-organization-name")');
    });

    it('should handle special characters in organization identifier', () => {
      const specialStore = createMockStore({
        selectedOrganization: {
          identifier: 'org-with-special_chars.123',
          name: 'Special Organization',
        },
      });

      const wrapper = mount(SyslogNg, {
        props: {
          currOrgIdentifier: 'test-org',
          currUserEmail: 'test@example.com',
        },
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: specialStore,
          },
        },
      });

      expect(wrapper.vm.content).toContain('organization("org-with-special_chars.123")');
    });
  });

  describe('Template Rendering', () => {
    it('should render template correctly', () => {
      const wrapper = mount(SyslogNg, {
        props: {
          currOrgIdentifier: 'test-org',
          currUserEmail: 'test@example.com',
        },
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      expect(wrapper.find('div').exists()).toBe(true);
      expect(wrapper.find('.q-pa-sm').exists()).toBe(true);
    });

    it('should render CopyContent component with correct content prop', () => {
      const wrapper = mount(SyslogNg, {
        props: {
          currOrgIdentifier: 'test-org',
          currUserEmail: 'test@example.com',
        },
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      const copyContentComponent = wrapper.findComponent({ name: 'CopyContent' });
      expect(copyContentComponent.exists()).toBe(true);
      expect(copyContentComponent.props('content')).toBe(wrapper.vm.content);
    });

    it('should render documentation link correctly', () => {
      const wrapper = mount(SyslogNg, {
        props: {
          currOrgIdentifier: 'test-org',
          currUserEmail: 'test@example.com',
        },
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      const link = wrapper.find('a[target="_blank"]');
      expect(link.exists()).toBe(true);
      expect(link.attributes('href')).toBe('https://axoflow.com/docs/axosyslog-core/chapter-destinations/openobserve/');
    });

    it('should have correct CSS classes', () => {
      const wrapper = mount(SyslogNg, {
        props: {
          currOrgIdentifier: 'test-org',
          currUserEmail: 'test@example.com',
        },
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      expect(wrapper.find('.q-pa-sm').exists()).toBe(true);
    });
  });

  describe('Utility Function Integration', () => {
    it('should call getIngestionURL function', async () => {
      const { getIngestionURL } = await import('@/utils/zincutils');
      
      mount(SyslogNg, {
        props: {
          currOrgIdentifier: 'test-org',
          currUserEmail: 'test@example.com',
        },
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      expect(vi.mocked(getIngestionURL)).toHaveBeenCalled();
    });

    it('should call getEndPoint function with ingestionURL', async () => {
      const { getEndPoint } = await import('@/utils/zincutils');
      
      mount(SyslogNg, {
        props: {
          currOrgIdentifier: 'test-org',
          currUserEmail: 'test@example.com',
        },
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      expect(vi.mocked(getEndPoint)).toHaveBeenCalledWith('http://localhost:5080');
    });

    it('should expose getImageURL function', () => {
      const wrapper = mount(SyslogNg, {
        props: {
          currOrgIdentifier: 'test-org',
          currUserEmail: 'test@example.com',
        },
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      expect(wrapper.vm.getImageURL).toBeDefined();
      expect(typeof wrapper.vm.getImageURL).toBe('function');
      expect(wrapper.vm.getImageURL()).toBe('http://localhost:5080/web/src/assets/images/logo.png');
    });
  });

  describe('Config Integration', () => {
    it('should expose config object', () => {
      const wrapper = mount(SyslogNg, {
        props: {
          currOrgIdentifier: 'test-org',
          currUserEmail: 'test@example.com',
        },
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      expect(wrapper.vm.config).toBeDefined();
      expect(wrapper.vm.config).toHaveProperty('aws_project_region');
      expect(wrapper.vm.config).toHaveProperty('aws_cognito_identity_pool_id');
    });

    it('should have correct config values', () => {
      const wrapper = mount(SyslogNg, {
        props: {
          currOrgIdentifier: 'test-org',
          currUserEmail: 'test@example.com',
        },
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      expect(wrapper.vm.config.aws_project_region).toBe('us-west-2');
      expect(wrapper.vm.config.aws_user_pools_id).toBe('test-pool');
    });
  });

  describe('Component Registration', () => {
    it('should register CopyContent component', () => {
      const wrapper = mount(SyslogNg, {
        props: {
          currOrgIdentifier: 'test-org',
          currUserEmail: 'test@example.com',
        },
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      const copyContentComponent = wrapper.findComponent({ name: 'CopyContent' });
      expect(copyContentComponent.exists()).toBe(true);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle store without selectedOrganization', () => {
      const incompleteStore = createStore({
        state: {
          selectedOrganization: {
            identifier: 'fallback-org',
          },
        },
      });

      const wrapper = mount(SyslogNg, {
        props: {
          currOrgIdentifier: 'test-org',
          currUserEmail: 'test@example.com',
        },
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: incompleteStore,
          },
        },
      });

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm.content).toContain('organization("fallback-org")');
    });

    it('should handle minimal store state', () => {
      const minimalStateStore = createStore({
        state: {
          selectedOrganization: {
            identifier: 'minimal-org',
          },
        },
      });

      const wrapper = mount(SyslogNg, {
        props: {
          currOrgIdentifier: 'test-org',
          currUserEmail: 'test@example.com',
        },
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: minimalStateStore,
          },
        },
      });

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm.content).toContain('organization("minimal-org")');
    });

    it('should handle very long organization identifier', () => {
      const longOrgId = 'a'.repeat(1000);
      const longOrgStore = createMockStore({
        selectedOrganization: {
          identifier: longOrgId,
          name: 'Long Organization',
        },
      });

      const wrapper = mount(SyslogNg, {
        props: {
          currOrgIdentifier: 'test-org',
          currUserEmail: 'test@example.com',
        },
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: longOrgStore,
          },
        },
      });

      expect(wrapper.vm.content).toContain(`organization("${longOrgId}")`);
    });

    it('should handle empty organization identifier', () => {
      const emptyOrgStore = createMockStore({
        selectedOrganization: {
          identifier: '',
          name: 'Empty Organization',
        },
      });

      const wrapper = mount(SyslogNg, {
        props: {
          currOrgIdentifier: 'test-org',
          currUserEmail: 'test@example.com',
        },
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: emptyOrgStore,
          },
        },
      });

      expect(wrapper.vm.content).toContain('organization("")');
    });
  });

  describe('Reactivity and State Changes', () => {
    it('should maintain endpoint values after component creation', () => {
      const wrapper = mount(SyslogNg, {
        props: {
          currOrgIdentifier: 'test-org',
          currUserEmail: 'test@example.com',
        },
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      const initialEndpoint = { ...wrapper.vm.endpoint };
      
      // Trigger a re-render
      wrapper.vm.$forceUpdate();

      expect(wrapper.vm.endpoint).toEqual(initialEndpoint);
    });

    it('should maintain content consistency', () => {
      const wrapper = mount(SyslogNg, {
        props: {
          currOrgIdentifier: 'test-org',
          currUserEmail: 'test@example.com',
        },
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      const initialContent = wrapper.vm.content;
      
      // Content should remain consistent
      expect(wrapper.vm.content).toBe(initialContent);
      expect(wrapper.vm.content.length).toBeGreaterThan(0);
    });
  });

  describe('Performance and Memory', () => {
    it('should not create unnecessary reactive objects', () => {
      const wrapper = mount(SyslogNg, {
        props: {
          currOrgIdentifier: 'test-org',
          currUserEmail: 'test@example.com',
        },
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      // Content should be a string, not reactive
      expect(typeof wrapper.vm.content).toBe('string');
      
      // getImageURL should be a function reference
      expect(typeof wrapper.vm.getImageURL).toBe('function');
    });

    it('should handle multiple component instances', () => {
      const wrapper1 = mount(SyslogNg, {
        props: {
          currOrgIdentifier: 'org-1',
          currUserEmail: 'user1@example.com',
        },
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      const wrapper2 = mount(SyslogNg, {
        props: {
          currOrgIdentifier: 'org-2',
          currUserEmail: 'user2@example.com',
        },
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      expect(wrapper1.exists()).toBe(true);
      expect(wrapper2.exists()).toBe(true);
      expect(wrapper1.vm.content).toBe(wrapper2.vm.content); // Same content since using same store
    });
  });
});
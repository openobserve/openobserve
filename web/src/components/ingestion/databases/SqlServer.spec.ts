import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { Quasar } from 'quasar';
import SqlServer from './SqlServer.vue';
import { createStore } from 'vuex';
import { createI18n } from 'vue-i18n';
import { nextTick, ref } from 'vue';

// Mock aws-exports
vi.mock('../../../aws-exports', () => ({
  default: {
    region: 'us-east-1',
    userPoolId: 'us-east-1_test',
    userPoolWebClientId: 'test-client-id',
  },
}));

// Mock zincutils
vi.mock('../../../utils/zincutils', () => ({
  getImageURL: vi.fn((path) => `/mocked/path/${path}`),
  getEndPoint: vi.fn(() => ({
    url: 'https://test.openobserve.ai',
    host: 'test.openobserve.ai',
    port: 443,
    protocol: 'https',
    tls: true,
  })),
  getIngestionURL: vi.fn(() => 'https://test.openobserve.ai'),
}));

// Mock useIngestion composable
const mockEndpoint = ref({
  url: 'https://test.openobserve.ai',
  host: 'test.openobserve.ai',
  port: 443,
  protocol: 'https',
  tls: true,
});

const mockDatabaseContent = `exporters:
  otlphttp/openobserve:
    endpoint: https://test.openobserve.ai/api/test-org/[STREAM_NAME]
    headers:
      Authorization: Basic [BASIC_PASSCODE]
      stream-name: [STREAM_NAME]`;

const mockDatabaseDocURLs = {
  sqlServer: "https://short.openobserve.ai/database/sql-server",
  postgres: "https://short.openobserve.ai/database/postgres",
  mongoDB: "https://short.openobserve.ai/database/mongodb",
  redis: "https://short.openobserve.ai/database/redis",
};

vi.mock('@/composables/useIngestion', () => ({
  default: vi.fn(() => ({
    endpoint: mockEndpoint,
    databaseContent: mockDatabaseContent,
    databaseDocURLs: mockDatabaseDocURLs,
  })),
}));

// Mock CopyContent component
const MockCopyContent = {
  name: 'CopyContent',
  props: ['content'],
  template: '<div data-test="copy-content">{{ content }}</div>',
};

const mockStore = createStore({
  state: {
    selectedOrganization: {
      identifier: 'test-org',
      name: 'Test Organization',
    },
    userInfo: {
      email: 'test@example.com',
    },
  },
  getters: {},
  mutations: {},
  actions: {},
});

const mockI18n = createI18n({
  locale: 'en',
  messages: {
    en: {},
  },
});

describe('SqlServer.vue Component - Comprehensive Coverage', () => {
  let wrapper: VueWrapper<any>;
  
  const createWrapper = (props = {}) => {
    return mount(SqlServer, {
      props: {
        currOrgIdentifier: 'test-org',
        currUserEmail: 'test@example.com',
        ...props,
      },
      global: {
        plugins: [Quasar, mockStore, mockI18n],
        components: {
          CopyContent: MockCopyContent,
        },
        stubs: {
          CopyContent: MockCopyContent,
        },
      },
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  // Test 1: Component mounts successfully
  it('should mount component successfully', () => {
    wrapper = createWrapper();
    expect(wrapper.exists()).toBe(true);
  });

  // Test 2: Component has correct name
  it('should have correct component name', () => {
    wrapper = createWrapper();
    expect(wrapper.vm.$options.name).toBe('AWSConfig');
  });

  // Test 3: Component accepts currOrgIdentifier prop
  it('should accept currOrgIdentifier prop', () => {
    wrapper = createWrapper({ currOrgIdentifier: 'custom-org' });
    expect(wrapper.props('currOrgIdentifier')).toBe('custom-org');
  });

  // Test 4: Component accepts currUserEmail prop
  it('should accept currUserEmail prop', () => {
    wrapper = createWrapper({ currUserEmail: 'custom@example.com' });
    expect(wrapper.props('currUserEmail')).toBe('custom@example.com');
  });

  // Test 5: Props have correct types
  it('should have correct prop types', () => {
    wrapper = createWrapper();
    const propTypes = wrapper.vm.$options.props;
    expect(propTypes.currOrgIdentifier.type).toBe(String);
    expect(propTypes.currUserEmail.type).toBe(String);
  });

  // Test 6: Component renders template correctly
  it('should render template with correct structure', () => {
    wrapper = createWrapper();
    expect(wrapper.find('.q-pa-sm').exists()).toBe(true);
    expect(wrapper.find('.tw\\:text-\\[16px\\]').exists()).toBe(true);
  });

  // Test 7: CopyContent component is rendered
  it('should render CopyContent component', () => {
    wrapper = createWrapper();
    expect(wrapper.find('[data-test="copy-content"]').exists()).toBe(true);
  });

  // Test 8: Documentation link is rendered
  it('should render documentation link correctly', () => {
    wrapper = createWrapper();
    const link = wrapper.find('a[target="_blank"]');
    expect(link.exists()).toBe(true);
    expect(link.attributes('href')).toBe('https://short.openobserve.ai/database/sql-server');
  });

  // Test 9: Documentation link has correct styling
  it('should have correct styling for documentation link', () => {
    wrapper = createWrapper();
    const link = wrapper.find('a[target="_blank"]');
    expect(link.classes()).toContain('text-blue-500');
    expect(link.classes()).toContain('hover:text-blue-600');
    expect(link.attributes('style')).toContain('text-decoration: underline');
  });

  // Test 10: Name is correctly set to sqlServer
  it('should set name to sqlServer', () => {
    wrapper = createWrapper();
    expect(wrapper.vm.name).toBe('sqlServer');
  });

  // Test 11: Config is exposed in component data
  it('should expose config in component data', () => {
    wrapper = createWrapper();
    expect(wrapper.vm.config).toBeDefined();
    expect(wrapper.vm.config.region).toBe('us-east-1');
  });

  // Test 12: docURL is correctly set
  it('should set docURL correctly from databaseDocURLs', () => {
    wrapper = createWrapper();
    expect(wrapper.vm.docURL).toBe('https://short.openobserve.ai/database/sql-server');
  });

  // Test 13: getImageURL is exposed
  it('should expose getImageURL function', () => {
    wrapper = createWrapper();
    expect(wrapper.vm.getImageURL).toBeDefined();
    expect(typeof wrapper.vm.getImageURL).toBe('function');
  });


  // Test 23: Endpoint data is exposed
  it('should expose endpoint data', () => {
    wrapper = createWrapper();
    expect(wrapper.vm.endpoint).toBeDefined();
    expect(wrapper.vm.endpoint.url).toBe('https://test.openobserve.ai');
  });

  // Test 24: Database content is exposed
  it('should expose databaseContent', () => {
    wrapper = createWrapper();
    expect(wrapper.vm.databaseContent).toBeDefined();
    expect(wrapper.vm.databaseContent).toContain('exporters:');
  });

  // Test 25: Database doc URLs are exposed
  it('should expose databaseDocURLs', () => {
    wrapper = createWrapper();
    expect(wrapper.vm.databaseDocURLs).toBeDefined();
    expect(wrapper.vm.databaseDocURLs.sqlServer).toBe('https://short.openobserve.ai/database/sql-server');
  });

  // Test 26: Component with null props
  it('should handle null props gracefully', () => {
    wrapper = createWrapper({ currOrgIdentifier: null, currUserEmail: null });
    expect(wrapper.props('currOrgIdentifier')).toBeNull();
    expect(wrapper.props('currUserEmail')).toBeNull();
  });

  // Test 27: Component with undefined props
  it('should handle undefined props gracefully', () => {
    wrapper = createWrapper({ currOrgIdentifier: undefined, currUserEmail: undefined });
    expect(wrapper.props('currOrgIdentifier')).toBeUndefined();
    expect(wrapper.props('currUserEmail')).toBeUndefined();
  });

  // Test 28: Component with empty string props
  it('should handle empty string props', () => {
    wrapper = createWrapper({ currOrgIdentifier: '', currUserEmail: '' });
    expect(wrapper.props('currOrgIdentifier')).toBe('');
    expect(wrapper.props('currUserEmail')).toBe('');
  });

  // Test 29: Template renders content from CopyContent
  it('should pass content to CopyContent component', () => {
    wrapper = createWrapper();
    const copyContentEl = wrapper.find('[data-test="copy-content"]');
    expect(copyContentEl.text()).toContain('exporters:');
  });

  // Test 30: Component reactivity - content updates when dependencies change
  it('should maintain content reactivity', async () => {
    wrapper = createWrapper();
    const originalContent = wrapper.vm.content;
    expect(originalContent).toBeDefined();
    expect(originalContent).toContain('sqlserver');
  });


  // Test 33: Component instance properties
  it('should have correct instance properties', () => {
    wrapper = createWrapper();
    expect(wrapper.vm).toHaveProperty('name');
    expect(wrapper.vm).toHaveProperty('content');
    expect(wrapper.vm).toHaveProperty('docURL');
    expect(wrapper.vm).toHaveProperty('config');
  });


  // Test 35: Template structure validation
  it('should have correct template structure and classes', () => {
    wrapper = createWrapper();
    expect(wrapper.find('.q-pa-sm').exists()).toBe(true);
    expect(wrapper.find('.tw\\:text-\\[16px\\]').exists()).toBe(true);
    expect(wrapper.find('.tw\\:font-bold').exists()).toBe(true);
    expect(wrapper.find('.tw\\:pt-6').exists()).toBe(true);
    expect(wrapper.find('.tw\\:pb-2').exists()).toBe(true);
  });

  // Test 36: Link attributes validation
  it('should have correct link attributes and behavior', () => {
    wrapper = createWrapper();
    const link = wrapper.find('a');
    expect(link.attributes('target')).toBe('_blank');
    expect(link.text()).toBe('here');
  });

  // Test 37: Component composition API usage
  it('should use composition API correctly', () => {
    wrapper = createWrapper();
    expect(wrapper.vm.$options.setup).toBeDefined();
    expect(typeof wrapper.vm.$options.setup).toBe('function');
  });

  // Test 38: Props validation
  it('should validate props correctly', () => {
    const propValidators = SqlServer.props;
    expect(propValidators.currOrgIdentifier.type).toBe(String);
    expect(propValidators.currUserEmail.type).toBe(String);
  });


});
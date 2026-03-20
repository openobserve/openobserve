import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { Quasar } from 'quasar';
import { createStore } from 'vuex';
import { createI18n } from 'vue-i18n';
import { createRouter, createWebHistory } from 'vue-router';
import AzureConfig from './AzureConfig.vue';

vi.mock('../../../aws-exports', () => ({
  default: { API_ENDPOINT: 'http://localhost:5080', region: 'us-east-1' },
}));

vi.mock('../../../utils/zincutils', () => ({
  getImageURL: vi.fn((path) => `mock-image-url-${path}`),
  getEndPoint: vi.fn(() => ({ url: 'http://localhost:5080', host: 'localhost', port: '5080', protocol: 'http', tls: false })),
  getIngestionURL: vi.fn(() => 'http://localhost:5080'),
}));

vi.mock('../../../utils/azureIntegrations', () => ({
  azureIntegrations: [
    { id: 'azure-ad', name: 'AzureAD', displayName: 'Azure Active Directory', description: 'Azure AD logs', category: 'security', hasDashboard: false },
    { id: 'azure-storage', name: 'AzureStorage', displayName: 'Azure Storage', description: 'Azure Storage logs', category: 'storage', hasDashboard: true },
  ],
  generateAzureDashboardURL: vi.fn(() => 'https://mock-dashboard-url'),
}));

vi.mock('@/services/dashboards', () => ({
  default: {
    list_Folders: vi.fn(() => Promise.resolve({ data: { list: [] } })),
    new_Folder: vi.fn(() => Promise.resolve({ data: { folderId: 'folder-1', name: 'Microsoft' } })),
    list: vi.fn(() => Promise.resolve({ data: { dashboards: [] } })),
    create: vi.fn(() => Promise.resolve({ data: {} })),
    delete: vi.fn(() => Promise.resolve({ data: {} })),
  },
}));

vi.mock('@/services/segment_analytics', () => ({
  default: { track: vi.fn() },
}));

vi.mock('./AzureQuickSetup.vue', () => ({
  default: {
    name: 'AzureQuickSetup',
    template: '<div data-test="azure-quick-setup">Azure Quick Setup</div>',
  },
}));

const mockStore = createStore({
  state: {
    selectedOrganization: { identifier: 'test-org', name: 'Test Organization' },
    userInfo: { email: 'test@example.com' },
    organizationData: { organizationPasscode: 'test-passcode' },
  },
});

const mockI18n = createI18n({ locale: 'en', messages: { en: {} } });
const mockRouter = createRouter({
  history: createWebHistory(),
  routes: [{ path: '/', component: { template: '<div>Home</div>' } }],
});

describe('AzureConfig.vue', () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  const createWrapper = () => {
    return mount(AzureConfig, {
      global: {
        plugins: [Quasar, mockI18n, mockRouter],
        provide: { store: mockStore },
      },
    });
  };

  describe('Component Rendering', () => {
    it('should mount without errors', () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it('should unmount without errors', () => {
      wrapper = createWrapper();
      expect(() => wrapper.unmount()).not.toThrow();
    });

    it('should render AzureQuickSetup child component', () => {
      wrapper = createWrapper();
      const child = wrapper.find('[data-test="azure-quick-setup"]');
      expect(child.exists()).toBe(true);
    });

    it('should have azure-config-page class', () => {
      wrapper = createWrapper();
      expect(wrapper.find('.azure-config-page').exists()).toBe(true);
    });
  });

  describe('Component Identity', () => {
    it('should have correct component name', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe('AzureConfig');
    });

    it('should be a Vue component', () => {
      wrapper = createWrapper();
      expect(wrapper.vm).toBeDefined();
      expect(typeof wrapper.vm).toBe('object');
    });
  });
});

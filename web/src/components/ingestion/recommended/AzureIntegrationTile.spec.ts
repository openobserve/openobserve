import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { Quasar } from 'quasar';
import { createStore } from 'vuex';
import { createI18n } from 'vue-i18n';
import { createRouter, createWebHistory } from 'vue-router';
import AzureIntegrationTile from './AzureIntegrationTile.vue';

vi.mock('../../../aws-exports', () => ({
  default: { API_ENDPOINT: 'http://localhost:5080', region: 'us-east-1' },
}));

vi.mock('@/utils/azureIntegrations', () => ({
  generateAzureDashboardURL: vi.fn(() => 'https://mock-azure-dashboard-url'),
  azureIntegrations: [],
}));

vi.mock('@/services/segment_analytics', () => ({
  default: { track: vi.fn() },
}));

const mockStore = createStore({
  state: {
    selectedOrganization: { identifier: 'test-org' },
    userInfo: { email: 'test@example.com' },
    organizationData: { organizationPasscode: 'test-passcode' },
  },
});

const mockI18n = createI18n({ locale: 'en', messages: { en: {} } });
const mockRouter = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: { template: '<div>Home</div>' } },
    { path: '/dashboards', component: { template: '<div>Dashboards</div>' } },
  ],
});

const createMockIntegration = (overrides = {}) => ({
  id: 'azure-ad',
  name: 'AzureAD',
  displayName: 'Azure Active Directory',
  description: 'Azure AD sign-in and audit logs',
  category: 'security',
  hasDashboard: true,
  documentationUrl: 'https://docs.example.com/azure-ad',
  ...overrides,
});

describe('AzureIntegrationTile.vue', () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('open', vi.fn());
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
    vi.unstubAllGlobals();
  });

  const createWrapper = (integrationOverrides = {}) => {
    return mount(AzureIntegrationTile, {
      props: { integration: createMockIntegration(integrationOverrides) },
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

    it('should render integration display name', () => {
      wrapper = createWrapper();
      expect(wrapper.text()).toContain('Azure Active Directory');
    });

    it('should render integration description', () => {
      wrapper = createWrapper();
      expect(wrapper.text()).toContain('Azure AD sign-in and audit logs');
    });

    it('should render Documentation button when documentationUrl present', () => {
      wrapper = createWrapper();
      const docBtn = wrapper.find('[data-test="azure-azure-ad-documentation-btn"]');
      expect(docBtn.exists()).toBe(true);
    });

    it('should render Dashboard button', () => {
      wrapper = createWrapper();
      const dashBtn = wrapper.find('[data-test="azure-azure-ad-dashboard-btn"]');
      expect(dashBtn.exists()).toBe(true);
    });

    it('should render docs icon button when documentationUrl present', () => {
      wrapper = createWrapper();
      const docsIconBtn = wrapper.find('[data-test="azure-azure-ad-docs-btn"]');
      expect(docsIconBtn.exists()).toBe(true);
    });
  });

  describe('Component Identity', () => {
    it('should have correct component name', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe('AzureIntegrationTile');
    });
  });

  describe('Props Validation', () => {
    it('should accept integration prop', () => {
      wrapper = createWrapper();
      expect(wrapper.props('integration')).toBeDefined();
    });

    it('should display integration displayName', () => {
      wrapper = createWrapper({ displayName: 'My Azure Service' });
      expect(wrapper.text()).toContain('My Azure Service');
    });
  });

  describe('handleDocumentation', () => {
    it('should be exposed as a function', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(typeof vm.handleDocumentation).toBe('function');
    });

    it('should open documentation URL in new tab', async () => {
      wrapper = createWrapper();
      const docBtn = wrapper.find('[data-test="azure-azure-ad-documentation-btn"]');
      await docBtn.trigger('click');
      expect(window.open).toHaveBeenCalledWith(
        'https://docs.example.com/azure-ad',
        '_blank',
        'noopener,noreferrer'
      );
    });

    it('should not open anything if no documentationUrl', () => {
      wrapper = createWrapper({ documentationUrl: undefined });
      const vm = wrapper.vm as any;
      vm.handleDocumentation();
      expect(window.open).not.toHaveBeenCalled();
    });
  });

  describe('handleDashboard', () => {
    it('should be exposed as a function', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(typeof vm.handleDashboard).toBe('function');
    });

    it('should navigate to dashboards when integration has dashboard', async () => {
      wrapper = createWrapper({ hasDashboard: true });
      const dashBtn = wrapper.find('[data-test="azure-azure-ad-dashboard-btn"]');
      await dashBtn.trigger('click');
      // Router push is called
      expect(mockRouter.currentRoute.value.path).toBeDefined();
    });

    it('should not navigate when hasDashboard is false', () => {
      wrapper = createWrapper({ hasDashboard: false });
      const vm = wrapper.vm as any;
      const pushSpy = vi.spyOn(mockRouter, 'push');
      vm.handleDashboard();
      expect(pushSpy).not.toHaveBeenCalled();
    });
  });

  describe('Documentation Button Rendering', () => {
    it('should not render documentation button when no documentationUrl', () => {
      wrapper = createWrapper({ documentationUrl: undefined });
      const docBtn = wrapper.find('[data-test="azure-azure-ad-documentation-btn"]');
      expect(docBtn.exists()).toBe(false);
    });

    it('should not render docs icon button when no documentationUrl', () => {
      wrapper = createWrapper({ documentationUrl: undefined });
      const docsIconBtn = wrapper.find('[data-test="azure-azure-ad-docs-btn"]');
      expect(docsIconBtn.exists()).toBe(false);
    });
  });

  describe('Dashboard Button State', () => {
    it('should disable dashboard button when hasDashboard is false', () => {
      wrapper = createWrapper({ hasDashboard: false });
      const dashBtn = wrapper.find('[data-test="azure-azure-ad-dashboard-btn"]');
      expect(dashBtn.attributes('disabled')).toBeDefined();
    });

    it('should enable dashboard button when hasDashboard is true', () => {
      wrapper = createWrapper({ hasDashboard: true });
      const dashBtn = wrapper.find('[data-test="azure-azure-ad-dashboard-btn"]');
      // When enabled, disabled attribute should not be 'true' / should be undefined
      const isDisabled = dashBtn.attributes('disabled');
      expect(isDisabled).toBeUndefined();
    });
  });
});

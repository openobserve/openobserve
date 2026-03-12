import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { Quasar } from 'quasar';
import { createStore } from 'vuex';
import { createI18n } from 'vue-i18n';
import { createRouter, createWebHistory } from 'vue-router';
import AzureQuickSetup from './AzureQuickSetup.vue';

vi.mock('../../../aws-exports', () => ({
  default: { API_ENDPOINT: 'http://localhost:5080', region: 'us-east-1' },
}));

vi.mock('@/utils/azureIntegrations', () => ({
  azureIntegrations: [
    {
      id: 'azure-ad',
      name: 'AzureAD',
      displayName: 'Azure Active Directory',
      description: 'Azure AD logs and sign-ins',
      category: 'security',
      hasDashboard: false,
    },
    {
      id: 'azure-storage',
      name: 'AzureStorage',
      displayName: 'Azure Blob Storage',
      description: 'Azure Blob Storage logs',
      category: 'storage',
      hasDashboard: true,
    },
  ],
  generateAzureDashboardURL: vi.fn(() => 'https://mock-azure-dashboard-url'),
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

const mockStore = createStore({
  state: {
    selectedOrganization: { identifier: 'test-org', name: 'Test Organization' },
    userInfo: { email: 'test@example.com' },
    organizationData: { organizationPasscode: 'test-passcode' },
  },
  actions: {
    'organizationData/getFolders': vi.fn(),
  },
});

const mockI18n = createI18n({ locale: 'en', messages: { en: {} } });
const mockRouter = createRouter({
  history: createWebHistory(),
  routes: [{ path: '/', component: { template: '<div>Home</div>' } }],
});

describe('AzureQuickSetup.vue', () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('open', vi.fn());
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ title: 'Microsoft O365 Dashboard' }),
    })));
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
    vi.unstubAllGlobals();
  });

  const createWrapper = () => {
    return mount(AzureQuickSetup, {
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

    it('should render View Setup Guide button', () => {
      wrapper = createWrapper();
      const deployBtn = wrapper.find('[data-test="azure-quick-setup-deploy-btn"]');
      expect(deployBtn.exists()).toBe(true);
    });

    it('should render Add Dashboard button', () => {
      wrapper = createWrapper();
      const dashboardBtn = wrapper.find('[data-test="azure-quick-setup-add-dashboard-btn"]');
      expect(dashboardBtn.exists()).toBe(true);
    });

    it('should render View/Hide Details button', () => {
      wrapper = createWrapper();
      const detailsBtn = wrapper.find('[data-test="azure-quick-setup-details-btn"]');
      expect(detailsBtn.exists()).toBe(true);
    });

    it('should render Azure Function Integration title', () => {
      wrapper = createWrapper();
      expect(wrapper.text()).toContain('Azure Function Integration');
    });
  });

  describe('Component Identity', () => {
    it('should have correct component name', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe('AzureQuickSetup');
    });
  });

  describe('showDetails Toggle', () => {
    it('should have showDetails false by default', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.showDetails).toBe(false);
    });

    it('should toggle showDetails on details button click', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      const detailsBtn = wrapper.find('[data-test="azure-quick-setup-details-btn"]');
      await detailsBtn.trigger('click');
      expect(vm.showDetails).toBe(true);
    });

    it('should toggle showDetails back when clicked again', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      const detailsBtn = wrapper.find('[data-test="azure-quick-setup-details-btn"]');
      await detailsBtn.trigger('click');
      expect(vm.showDetails).toBe(true);
      await detailsBtn.trigger('click');
      expect(vm.showDetails).toBe(false);
    });
  });

  describe('addingDashboard State', () => {
    it('should have addingDashboard false by default', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.addingDashboard).toBe(false);
    });
  });

  describe('includedServices Computed', () => {
    it('should compute includedServices from azureIntegrations', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.includedServices).toBeDefined();
      expect(Array.isArray(vm.includedServices)).toBe(true);
      expect(vm.includedServices.length).toBe(2);
    });

    it('should include services with name, description, category', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.includedServices[0].name).toBeDefined();
      expect(vm.includedServices[0].description).toBeDefined();
      expect(vm.includedServices[0].category).toBeDefined();
    });

    it('should sort services alphabetically by name', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      const names = vm.includedServices.map((s: any) => s.name);
      const sorted = [...names].sort();
      expect(names).toEqual(sorted);
    });
  });

  describe('getCategoryIcon Function', () => {
    it('should return description icon for logs', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.getCategoryIcon('logs')).toBe('description');
    });

    it('should return computer icon for compute', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.getCategoryIcon('compute')).toBe('computer');
    });

    it('should return storage icon for storage', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.getCategoryIcon('storage')).toBe('storage');
    });

    it('should return cloud for unknown category', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.getCategoryIcon('unknown')).toBe('cloud');
    });
  });

  describe('formatCategory Function', () => {
    it('should capitalize first letter of category', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.formatCategory('storage')).toBe('Storage');
      expect(vm.formatCategory('security')).toBe('Security');
    });
  });

  describe('handleDeployFunction', () => {
    it('should be exposed as a function', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(typeof vm.handleDeployFunction).toBe('function');
    });

    it('should open GitHub repository when View Setup Guide is clicked', async () => {
      wrapper = createWrapper();
      const deployBtn = wrapper.find('[data-test="azure-quick-setup-deploy-btn"]');
      await deployBtn.trigger('click');
      expect(window.open).toHaveBeenCalledWith(
        'https://github.com/openobserve/azure-function-openobserve',
        '_blank',
        'noopener,noreferrer'
      );
    });
  });

  describe('handleAddDashboard', () => {
    it('should be exposed as a function', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(typeof vm.handleAddDashboard).toBe('function');
    });
  });
});

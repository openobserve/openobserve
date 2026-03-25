import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { Quasar } from 'quasar';
import { createStore } from 'vuex';
import { createI18n } from 'vue-i18n';
import { createRouter, createWebHistory } from 'vue-router';
import { nextTick } from 'vue';
import AzureIndividualServices from './AzureIndividualServices.vue';

vi.mock('../../../aws-exports', () => ({
  default: { API_ENDPOINT: 'http://localhost:5080', region: 'us-east-1' },
}));

vi.mock('@/utils/azureIntegrations', () => ({
  azureIntegrations: [
    {
      id: 'azure-ad',
      name: 'AzureAD',
      displayName: 'Azure Active Directory',
      description: 'Azure AD sign-in and audit logs',
      category: 'security',
      hasDashboard: false,
      documentationUrl: 'https://docs.example.com/azure-ad',
    },
    {
      id: 'azure-blob',
      name: 'AzureBlob',
      displayName: 'Azure Blob Storage',
      description: 'Azure Blob Storage logs',
      category: 'storage',
      hasDashboard: true,
    },
    {
      id: 'azure-vm',
      name: 'AzureVM',
      displayName: 'Azure Virtual Machines',
      description: 'Azure VM metrics and logs',
      category: 'compute',
      hasDashboard: false,
    },
    {
      id: 'azure-nsg',
      name: 'AzureNSG',
      displayName: 'Azure NSG Flow Logs',
      description: 'Azure Network Security Group flow logs',
      category: 'networking',
      hasDashboard: false,
    },
  ],
  generateAzureDashboardURL: vi.fn(() => 'https://mock-azure-dashboard-url'),
}));

vi.mock('@/services/segment_analytics', () => ({
  default: { track: vi.fn() },
}));

vi.mock('./AzureIntegrationTile.vue', () => ({
  default: {
    name: 'AzureIntegrationTile',
    template: '<div class="azure-tile" :data-id="integration.id">{{ integration.displayName }}</div>',
    props: ['integration'],
  },
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
  routes: [{ path: '/', component: { template: '<div>Home</div>' } }],
});

describe('AzureIndividualServices.vue', () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  const createWrapper = () => {
    return mount(AzureIndividualServices, {
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

    it('should render search input', () => {
      wrapper = createWrapper();
      const searchInput = wrapper.find('[data-test="azure-integration-search"]');
      expect(searchInput.exists()).toBe(true);
    });

    it('should render category tabs', () => {
      wrapper = createWrapper();
      const tabs = wrapper.find('[data-test="azure-integration-category-tabs"]');
      expect(tabs.exists()).toBe(true);
    });

    it('should render All Services tab', () => {
      wrapper = createWrapper();
      expect(wrapper.text()).toContain('All Services');
    });

    it('should render Azure-specific category tabs', () => {
      wrapper = createWrapper();
      const text = wrapper.text();
      expect(text).toContain('Compute');
      expect(text).toContain('Storage');
      expect(text).toContain('Security');
      expect(text).toContain('Networking');
    });

    it('should render integration tiles', () => {
      wrapper = createWrapper();
      const tiles = wrapper.findAll('.azure-tile');
      expect(tiles.length).toBe(4);
    });
  });

  describe('Component Identity', () => {
    it('should have correct component name', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe('AzureIndividualServices');
    });
  });

  describe('filteredIntegrations Computed', () => {
    it('should return all integrations when no filter', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.filteredIntegrations.length).toBe(4);
    });

    it('should filter by displayName search query', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.searchQuery = 'Active Directory';
      await nextTick();
      expect(vm.filteredIntegrations.length).toBe(1);
      expect(vm.filteredIntegrations[0].displayName).toBe('Azure Active Directory');
    });

    it('should filter by category compute', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.activeCategory = 'compute';
      await nextTick();
      expect(vm.filteredIntegrations.length).toBe(1);
      expect(vm.filteredIntegrations[0].category).toBe('compute');
    });

    it('should filter by category storage', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.activeCategory = 'storage';
      await nextTick();
      expect(vm.filteredIntegrations.length).toBe(1);
      expect(vm.filteredIntegrations[0].displayName).toBe('Azure Blob Storage');
    });

    it('should filter by category security', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.activeCategory = 'security';
      await nextTick();
      expect(vm.filteredIntegrations.length).toBe(1);
    });

    it('should return empty when search has no matches', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.searchQuery = 'zzz-nomatch-service';
      await nextTick();
      expect(vm.filteredIntegrations.length).toBe(0);
    });

    it('should sort alphabetically by displayName', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      const names = vm.filteredIntegrations.map((i: any) => i.displayName);
      const sorted = [...names].sort();
      expect(names).toEqual(sorted);
    });

    it('should filter case insensitively', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.searchQuery = 'azure blob';
      await nextTick();
      expect(vm.filteredIntegrations.length).toBe(1);
    });
  });

  describe('searchQuery and activeCategory State', () => {
    it('should default searchQuery to empty string', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.searchQuery).toBe('');
    });

    it('should default activeCategory to "all"', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.activeCategory).toBe('all');
    });
  });

  describe('Empty State', () => {
    it('should show empty state when no integrations match', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.searchQuery = 'zzz-absolutely-nothing';
      await nextTick();
      expect(wrapper.text()).toContain('No integrations found');
    });
  });
});

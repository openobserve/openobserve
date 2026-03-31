import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { Quasar } from 'quasar';
import { createStore } from 'vuex';
import { createI18n } from 'vue-i18n';
import { createRouter, createWebHistory } from 'vue-router';
import { nextTick } from 'vue';
import AWSIndividualServices from './AWSIndividualServices.vue';

vi.mock('../../../aws-exports', () => ({
  default: { API_ENDPOINT: 'http://localhost:5080', region: 'us-east-1' },
}));

vi.mock('@/utils/zincutils', () => ({
  getEndPoint: vi.fn(() => ({ url: 'http://localhost:5080', host: 'localhost', port: '5080', protocol: 'http', tls: false })),
  getIngestionURL: vi.fn(() => 'http://localhost:5080'),
}));

vi.mock('@/utils/awsIntegrations', () => ({
  awsIntegrations: [
    {
      id: 'cloudwatch-logs',
      name: 'CloudWatchLogs',
      displayName: 'CloudWatch Logs',
      description: 'Collect CloudWatch logs',
      category: 'logs',
      cloudFormationTemplate: 'https://example.com/cloudwatch.yaml',
      hasDashboard: true,
    },
    {
      id: 's3-events',
      name: 'S3Events',
      displayName: 'S3 Events',
      description: 'Collect S3 bucket events',
      category: 'logs',
      cloudFormationTemplate: 'https://example.com/s3.yaml',
      hasDashboard: false,
    },
    {
      id: 'vpc-flow',
      name: 'VPCFlow',
      displayName: 'VPC Flow Logs',
      description: 'Collect VPC flow logs',
      category: 'networking',
      hasDashboard: false,
    },
    {
      id: 'guardduty',
      name: 'GuardDuty',
      displayName: 'GuardDuty',
      description: 'AWS GuardDuty findings',
      category: 'security',
      cloudFormationTemplate: 'https://example.com/guardduty.yaml',
      hasDashboard: true,
    },
  ],
  generateCloudFormationURL: vi.fn(() => 'https://console.aws.amazon.com/cloudformation'),
}));

vi.mock('@/services/segment_analytics', () => ({
  default: { track: vi.fn() },
}));

vi.mock('./AWSIntegrationTile.vue', () => ({
  default: {
    name: 'AWSIntegrationTile',
    template: '<div class="aws-tile" :data-id="integration.id">{{ integration.displayName }}</div>',
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

describe('AWSIndividualServices.vue', () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  const createWrapper = (props = {}) => {
    return mount(AWSIndividualServices, {
      props,
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
      const searchInput = wrapper.find('[data-test="aws-integration-search"]');
      expect(searchInput.exists()).toBe(true);
    });

    it('should render category tabs', () => {
      wrapper = createWrapper();
      const tabs = wrapper.find('[data-test="aws-integration-category-tabs"]');
      expect(tabs.exists()).toBe(true);
    });

    it('should render All Services tab', () => {
      wrapper = createWrapper();
      expect(wrapper.text()).toContain('All Services');
    });

    it('should render integration tiles', () => {
      wrapper = createWrapper();
      const tiles = wrapper.findAll('.aws-tile');
      expect(tiles.length).toBe(4);
    });
  });

  describe('Component Identity', () => {
    it('should have correct component name', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe('AWSIndividualServices');
    });
  });

  describe('Props', () => {
    it('should accept initialSearch prop', () => {
      wrapper = createWrapper({ initialSearch: 'S3' });
      expect(wrapper.props('initialSearch')).toBe('S3');
    });

    it('should initialize searchQuery from initialSearch prop', () => {
      wrapper = createWrapper({ initialSearch: 'S3' });
      const vm = wrapper.vm as any;
      expect(vm.searchQuery).toBe('S3');
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
      vm.searchQuery = 'CloudWatch';
      await nextTick();
      expect(vm.filteredIntegrations.length).toBe(1);
    });

    it('should filter by category networking', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.activeCategory = 'networking';
      await nextTick();
      expect(vm.filteredIntegrations.length).toBe(1);
      expect(vm.filteredIntegrations[0].category).toBe('networking');
    });

    it('should combine search and category filter', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.activeCategory = 'logs';
      vm.searchQuery = 'S3';
      await nextTick();
      expect(vm.filteredIntegrations.length).toBe(1);
      expect(vm.filteredIntegrations[0].displayName).toBe('S3 Events');
    });

    it('should return empty when search has no matches', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.searchQuery = 'xyz-no-match';
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

    it('should update searchQuery reactively', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.searchQuery = 'GuardDuty';
      await nextTick();
      expect(vm.filteredIntegrations.length).toBe(1);
    });
  });

  describe('Empty State', () => {
    it('should show empty state when no integrations match', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.searchQuery = 'zzz-nomatch';
      await nextTick();
      expect(wrapper.text()).toContain('No integrations found');
    });
  });
});

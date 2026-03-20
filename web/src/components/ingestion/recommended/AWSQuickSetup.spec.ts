import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { Quasar } from 'quasar';
import { createStore } from 'vuex';
import { createI18n } from 'vue-i18n';
import { createRouter, createWebHistory } from 'vue-router';
import AWSQuickSetup from './AWSQuickSetup.vue';

vi.mock('../../../aws-exports', () => ({
  default: { API_ENDPOINT: 'http://localhost:5080', region: 'us-east-1' },
}));

vi.mock('@/utils/zincutils', () => ({
  getEndPoint: vi.fn(() => ({
    url: 'http://localhost:5080',
    host: 'localhost',
    port: '5080',
    protocol: 'http',
    tls: false,
  })),
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
      description: 'Collect S3 events',
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
  ],
  generateCloudFormationURL: vi.fn(() => 'https://console.aws.amazon.com/cloudformation'),
  awsIntegrationCategories: { logs: 'Logs', networking: 'Networking' },
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
});

const mockI18n = createI18n({ locale: 'en', messages: { en: {} } });
const mockRouter = createRouter({
  history: createWebHistory(),
  routes: [{ path: '/', component: { template: '<div>Home</div>' } }],
});

describe('AWSQuickSetup.vue', () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock window.open
    vi.stubGlobal('open', vi.fn());
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
    vi.unstubAllGlobals();
  });

  const createWrapper = () => {
    return mount(AWSQuickSetup, {
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

    it('should render Deploy Complete Stack button', () => {
      wrapper = createWrapper();
      const deployBtn = wrapper.find('[data-test="aws-quick-setup-deploy-btn"]');
      expect(deployBtn.exists()).toBe(true);
    });

    it('should render View/Hide Details button', () => {
      wrapper = createWrapper();
      const detailsBtn = wrapper.find('[data-test="aws-quick-setup-details-btn"]');
      expect(detailsBtn.exists()).toBe(true);
    });

    it('should render Complete AWS Integration title', () => {
      wrapper = createWrapper();
      expect(wrapper.text()).toContain('Complete AWS Integration');
    });
  });

  describe('Component Identity', () => {
    it('should have correct component name', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe('AWSQuickSetup');
    });
  });

  describe('showDetails Toggle', () => {
    it('should have showDetails false by default', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.showDetails).toBe(false);
    });

    it('should toggle showDetails when details button is clicked', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.showDetails).toBe(false);
      const detailsBtn = wrapper.find('[data-test="aws-quick-setup-details-btn"]');
      await detailsBtn.trigger('click');
      expect(vm.showDetails).toBe(true);
    });

    it('should toggle showDetails back when clicked again', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      const detailsBtn = wrapper.find('[data-test="aws-quick-setup-details-btn"]');
      await detailsBtn.trigger('click');
      expect(vm.showDetails).toBe(true);
      await detailsBtn.trigger('click');
      expect(vm.showDetails).toBe(false);
    });
  });

  describe('includedServices Computed', () => {
    it('should compute includedServices with services having CloudFormation templates', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.includedServices).toBeDefined();
      expect(Array.isArray(vm.includedServices)).toBe(true);
    });

    it('should include services with cloudFormationTemplate', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      // CloudWatch Logs and S3 Events have cloudFormationTemplate
      expect(vm.includedServices.length).toBeGreaterThan(0);
    });

    it('should sort services by name', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      const names = vm.includedServices.map((s: any) => s.name);
      const sortedNames = [...names].sort();
      expect(names).toEqual(sortedNames);
    });

    it('should include service with name and description', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      if (vm.includedServices.length > 0) {
        expect(vm.includedServices[0].name).toBeDefined();
        expect(vm.includedServices[0].description).toBeDefined();
        expect(vm.includedServices[0].category).toBeDefined();
      }
    });
  });

  describe('getCategoryIcon Function', () => {
    it('should return icon for logs category', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.getCategoryIcon('logs')).toBe('description');
    });

    it('should return icon for metrics category', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.getCategoryIcon('metrics')).toBe('speed');
    });

    it('should return icon for security category', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.getCategoryIcon('security')).toBe('security');
    });

    it('should return cloud icon for unknown category', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.getCategoryIcon('unknown')).toBe('cloud');
    });
  });

  describe('formatCategory Function', () => {
    it('should capitalize first letter', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.formatCategory('logs')).toBe('Logs');
    });

    it('should capitalize security', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.formatCategory('security')).toBe('Security');
    });
  });

  describe('handleDeployStack', () => {
    it('should be exposed as a function', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(typeof vm.handleDeployStack).toBe('function');
    });

    it('should call window.open when endpoint is valid', async () => {
      wrapper = createWrapper();
      const deployBtn = wrapper.find('[data-test="aws-quick-setup-deploy-btn"]');
      await deployBtn.trigger('click');
      expect(window.open).toHaveBeenCalled();
    });
  });
});

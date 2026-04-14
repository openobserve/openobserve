import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { Quasar } from 'quasar';
import { createStore } from 'vuex';
import { createI18n } from 'vue-i18n';
import { createRouter, createWebHistory } from 'vue-router';
import AWSQuickSetup from './AWSQuickSetup.vue';

const { MOCK_SERVICES, MOCK_REGIONS } = vi.hoisted(() => ({
  MOCK_SERVICES: [
    { label: 'CloudTrail', flag: 'EnableCloudTrail' },
    { label: 'CloudWatch Metrics', flag: 'EnableCloudWatchMetrics' },
    { label: 'VPC Flow Logs', flag: 'EnableVPCFlowLogs' },
  ],
  MOCK_REGIONS: [
    { value: 'us-east-1', label: 'US East (N. Virginia)' },
    { value: 'us-west-2', label: 'US West (Oregon)' },
    { value: 'eu-west-1', label: 'Europe (Ireland)' },
  ],
}));

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
  awsIntegrations: [],
  generateCloudFormationURL: vi.fn(() => 'https://console.aws.amazon.com/cloudformation'),
  AWS_REGIONS: MOCK_REGIONS,
  QUICK_SETUP_SERVICES: MOCK_SERVICES,
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
    vi.stubGlobal('open', vi.fn());
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
    vi.unstubAllGlobals();
  });

  const createWrapper = () =>
    mount(AWSQuickSetup, {
      global: {
        plugins: [Quasar, mockI18n, mockRouter],
        provide: { store: mockStore },
      },
    });

  describe('Component Rendering', () => {
    it('should mount without errors', () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it('should unmount without errors', () => {
      wrapper = createWrapper();
      expect(() => wrapper.unmount()).not.toThrow();
    });

    it('should have correct component name', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe('AWSQuickSetup');
    });

    it('should render Complete AWS Integration title', () => {
      wrapper = createWrapper();
      expect(wrapper.text()).toContain('Complete AWS Integration');
    });

    it('should render deployment mode toggle', () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="aws-deployment-mode-toggle"]').exists()).toBe(true);
    });

    it('should render launch button', () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="aws-quick-setup-deploy-btn"]').exists()).toBe(true);
    });
  });

  describe('Deployment Mode', () => {
    it('should default to single region mode', () => {
      wrapper = createWrapper();
      expect((wrapper.vm as any).deploymentMode).toBe('single');
    });

    it('should show region select in single mode', () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="aws-region-select"]').exists()).toBe(true);
    });

    it('should default selected region to us-east-1', () => {
      wrapper = createWrapper();
      expect((wrapper.vm as any).selectedRegion).toBe('us-east-1');
    });

    it('should switch to stackset mode', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.deploymentMode = 'stackset';
      await wrapper.vm.$nextTick();
      expect(vm.deploymentMode).toBe('stackset');
    });
  });

  describe('Services Selection', () => {
    it('should start with all services enabled', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.enabledServices.length).toBe(MOCK_SERVICES.length);
    });

    it('should deselect all services', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.deselectAll();
      expect(vm.enabledServices.length).toBe(0);
    });

    it('should select all services', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.deselectAll();
      vm.selectAll();
      expect(vm.enabledServices.length).toBe(MOCK_SERVICES.length);
    });

    it('should start with services section collapsed', () => {
      wrapper = createWrapper();
      expect((wrapper.vm as any).showServices).toBe(false);
    });
  });

  describe('StackSets Mode', () => {
    it('should default stackset model to self-managed', () => {
      wrapper = createWrapper();
      expect((wrapper.vm as any).stackSetModel).toBe('self');
    });

    it('should default target regions to us-east-1', () => {
      wrapper = createWrapper();
      expect((wrapper.vm as any).targetRegions).toEqual(['us-east-1']);
    });

    it('should start with target regions collapsed', () => {
      wrapper = createWrapper();
      expect((wrapper.vm as any).showTargetRegions).toBe(false);
    });

    it('should select all regions', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.selectAllRegions();
      expect(vm.targetRegions.length).toBe(MOCK_REGIONS.length);
    });

    it('should clear target regions', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.targetRegions = [];
      expect(vm.targetRegions.length).toBe(0);
    });
  });

  describe('handleLaunch - Single Region', () => {
    it('should be exposed as a function', () => {
      wrapper = createWrapper();
      expect(typeof (wrapper.vm as any).handleLaunch).toBe('function');
    });

    it('should call window.open when endpoint is valid', async () => {
      wrapper = createWrapper();
      const deployBtn = wrapper.find('[data-test="aws-quick-setup-deploy-btn"]');
      await deployBtn.trigger('click');
      expect(window.open).toHaveBeenCalled();
    });

    it('should not call window.open when no services selected', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.deselectAll();
      await wrapper.vm.$nextTick();
      const deployBtn = wrapper.find('[data-test="aws-quick-setup-deploy-btn"]');
      await deployBtn.trigger('click');
      expect(window.open).not.toHaveBeenCalled();
    });
  });

  describe('handleLaunch - StackSets', () => {
    it('should open stacksets console URL in stackset mode', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.deploymentMode = 'stackset';
      await wrapper.vm.$nextTick();
      vm.handleLaunch();
      expect(window.open).toHaveBeenCalledWith(
        expect.stringContaining('stacksets/create'),
        '_blank',
        'noopener,noreferrer',
      );
    });

    it('should show param helper after stackset launch', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.deploymentMode = 'stackset';
      await wrapper.vm.$nextTick();
      vm.handleLaunch();
      expect(vm.showParamHelper).toBe(true);
    });

    it('should not launch stackset when no target regions selected', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.deploymentMode = 'stackset';
      vm.targetRegions = [];
      await wrapper.vm.$nextTick();
      vm.handleLaunch();
      expect(window.open).not.toHaveBeenCalled();
    });
  });

  describe('stackSetParams computed', () => {
    it('should include template URL as first param', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      const params = vm.stackSetParams;
      expect(params[0].key).toBe('Amazon S3 URL (template)');
      expect(params[0].value).toContain('aws_complete.yaml');
    });

    it('should include TemplateS3Bucket param', () => {
      wrapper = createWrapper();
      const params = (wrapper.vm as any).stackSetParams;
      const bucket = params.find((p: any) => p.key === 'TemplateS3Bucket');
      expect(bucket?.value).toBe('openobserve-datasources-bucket');
    });

    it('should include OpenObserveEndpoint param', () => {
      wrapper = createWrapper();
      const params = (wrapper.vm as any).stackSetParams;
      const ep = params.find((p: any) => p.key === 'OpenObserveEndpoint');
      expect(ep?.value).toContain('localhost');
    });

    it('should include a param for each service flag', () => {
      wrapper = createWrapper();
      const params = (wrapper.vm as any).stackSetParams;
      MOCK_SERVICES.forEach(({ flag }) => {
        expect(params.find((p: any) => p.key === flag)).toBeDefined();
      });
    });
  });
});

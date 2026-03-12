import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { Quasar } from 'quasar';
import { createStore } from 'vuex';
import { createI18n } from 'vue-i18n';
import { createRouter, createWebHistory } from 'vue-router';
import AWSIntegrationTile from './AWSIntegrationTile.vue';

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
  generateCloudFormationURL: vi.fn(() => 'https://console.aws.amazon.com/cloudformation?stackName=test'),
  generateDashboardURL: vi.fn(() => 'https://example.com/dashboard'),
  awsIntegrations: [],
}));

vi.mock('@/services/segment_analytics', () => ({
  default: { track: vi.fn() },
}));

vi.mock('@/services/dashboards', () => ({
  default: {
    list_Folders: vi.fn(() => Promise.resolve({ data: { list: [] } })),
    new_Folder: vi.fn(() => Promise.resolve({ data: { folderId: 'folder-1', name: 'AWS' } })),
    list: vi.fn(() => Promise.resolve({ data: { dashboards: [] } })),
    create: vi.fn(() => Promise.resolve({ data: {} })),
    delete: vi.fn(() => Promise.resolve({ data: {} })),
  },
}));

vi.mock('./WindowsConfig.vue', () => ({
  default: { name: 'WindowsConfig', template: '<div>Windows Config</div>', props: ['currOrgIdentifier', 'currUserEmail'] },
}));

vi.mock('./LinuxConfig.vue', () => ({
  default: { name: 'LinuxConfig', template: '<div>Linux Config</div>', props: ['currOrgIdentifier', 'currUserEmail'] },
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
  id: 'cloudwatch-logs',
  name: 'CloudWatchLogs',
  displayName: 'CloudWatch Logs',
  description: 'Collect CloudWatch logs',
  category: 'logs',
  cloudFormationTemplate: 'https://example.com/cloudwatch.yaml',
  hasDashboard: true,
  dashboardGithubUrl: 'https://raw.githubusercontent.com/openobserve/dashboards/main/aws/cloudwatch.json',
  documentationUrl: 'https://docs.example.com/cloudwatch',
  ...overrides,
});

describe('AWSIntegrationTile.vue', () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('open', vi.fn());
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ title: 'CloudWatch Dashboard' }),
    })));
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
    vi.unstubAllGlobals();
  });

  const createWrapper = (integrationOverrides = {}) => {
    return mount(AWSIntegrationTile, {
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
      expect(wrapper.text()).toContain('CloudWatch Logs');
    });

    it('should render integration description', () => {
      wrapper = createWrapper();
      expect(wrapper.text()).toContain('Collect CloudWatch logs');
    });

    it('should render Add Source button when has CloudFormation', () => {
      wrapper = createWrapper();
      const addSourceBtn = wrapper.find('[data-test="aws-cloudwatch-logs-add-source-btn"]');
      expect(addSourceBtn.exists()).toBe(true);
    });

    it('should render Add Dashboard button', () => {
      wrapper = createWrapper();
      const dashboardBtn = wrapper.find('[data-test="aws-cloudwatch-logs-add-dashboard-btn"]');
      expect(dashboardBtn.exists()).toBe(true);
    });

    it('should render documentation button when documentationUrl present', () => {
      wrapper = createWrapper();
      const docsBtn = wrapper.find('[data-test="aws-cloudwatch-logs-docs-btn"]');
      expect(docsBtn.exists()).toBe(true);
    });
  });

  describe('Component Identity', () => {
    it('should have correct component name', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe('AWSIntegrationTile');
    });
  });

  describe('Props Validation', () => {
    it('should accept integration prop', () => {
      wrapper = createWrapper();
      expect(wrapper.props('integration')).toBeDefined();
    });

    it('should expose organizationId from store', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.organizationId).toBe('test-org');
    });

    it('should expose userEmail from store', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.userEmail).toBe('test@example.com');
    });
  });

  describe('hasCloudFormation Computed', () => {
    it('should be true when cloudFormationTemplate is set', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.hasCloudFormation).toBe(true);
    });

    it('should be true when cloudFormationTemplates array has items', () => {
      wrapper = createWrapper({
        cloudFormationTemplate: undefined,
        cloudFormationTemplates: [{ name: 'Template', url: 'https://example.com', description: 'desc' }],
      });
      const vm = wrapper.vm as any;
      expect(vm.hasCloudFormation).toBe(true);
    });

    it('should be true when componentOptions array has items', () => {
      wrapper = createWrapper({
        cloudFormationTemplate: undefined,
        componentOptions: [{ name: 'Linux', component: 'LinuxConfig', description: 'Linux setup' }],
      });
      const vm = wrapper.vm as any;
      expect(vm.hasCloudFormation).toBe(true);
    });

    it('should be false when no cloudFormation or components', () => {
      wrapper = createWrapper({
        cloudFormationTemplate: undefined,
        cloudFormationTemplates: undefined,
        componentOptions: undefined,
      });
      const vm = wrapper.vm as any;
      expect(vm.hasCloudFormation).toBe(false);
    });
  });

  describe('showTemplateDialog and showComponentContent State', () => {
    it('should have showTemplateDialog false by default', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.showTemplateDialog).toBe(false);
    });

    it('should have showComponentContent false by default', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.showComponentContent).toBe(false);
    });
  });

  describe('handleAddSource', () => {
    it('should open CloudFormation URL for single template', async () => {
      wrapper = createWrapper();
      const addSourceBtn = wrapper.find('[data-test="aws-cloudwatch-logs-add-source-btn"]');
      await addSourceBtn.trigger('click');
      expect(window.open).toHaveBeenCalled();
    });

    it('should show template dialog for multiple templates', async () => {
      wrapper = createWrapper({
        cloudFormationTemplate: undefined,
        cloudFormationTemplates: [
          { name: 'Template A', url: 'https://example.com/a.yaml', description: 'A' },
          { name: 'Template B', url: 'https://example.com/b.yaml', description: 'B' },
        ],
      });
      const vm = wrapper.vm as any;
      const addSourceBtn = wrapper.find('[data-test="aws-cloudwatch-logs-add-source-btn"]');
      await addSourceBtn.trigger('click');
      expect(vm.showTemplateDialog).toBe(true);
    });
  });

  describe('handleDocumentation', () => {
    it('should be exposed as a function', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(typeof vm.handleDocumentation).toBe('function');
    });

    it('should open documentation URL when docs button is clicked', async () => {
      wrapper = createWrapper();
      const docsBtn = wrapper.find('[data-test="aws-cloudwatch-logs-docs-btn"]');
      await docsBtn.trigger('click');
      expect(window.open).toHaveBeenCalledWith(
        'https://docs.example.com/cloudwatch',
        '_blank',
        'noopener,noreferrer'
      );
    });
  });

  describe('Add Dashboard Button State', () => {
    it('should disable Add Dashboard when hasDashboard is false', () => {
      wrapper = createWrapper({ hasDashboard: false, dashboardGithubUrl: undefined });
      const dashboardBtn = wrapper.find('[data-test="aws-cloudwatch-logs-add-dashboard-btn"]');
      expect(dashboardBtn.attributes('disabled')).toBeDefined();
    });
  });

  describe('Documentation Button Rendering', () => {
    it('should not render docs button when no documentationUrl', () => {
      wrapper = createWrapper({ documentationUrl: undefined });
      const docsBtn = wrapper.find('[data-test="aws-cloudwatch-logs-docs-btn"]');
      expect(docsBtn.exists()).toBe(false);
    });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { Quasar, Notify, Dialog } from 'quasar';
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

// Stub ODialog so tests are deterministic (no Portal/Reka teleport)
// and so we can assert on the props the component forwards + emit
// the click events the component listens to.
const ODialogStub = {
  name: 'ODialog',
  props: [
    'open',
    'size',
    'title',
    'subTitle',
    'persistent',
    'showClose',
    'width',
    'primaryButtonLabel',
    'secondaryButtonLabel',
    'neutralButtonLabel',
    'primaryButtonVariant',
    'secondaryButtonVariant',
    'neutralButtonVariant',
    'primaryButtonDisabled',
    'secondaryButtonDisabled',
    'neutralButtonDisabled',
    'primaryButtonLoading',
    'secondaryButtonLoading',
    'neutralButtonLoading',
  ],
  emits: ['update:open', 'click:primary', 'click:secondary', 'click:neutral'],
  template: `
    <div
      data-test="o-dialog-stub"
      :data-open="String(open)"
      :data-size="size"
      :data-title="title"
      :data-secondary-label="secondaryButtonLabel"
    >
      <span data-test="o-dialog-stub-title">{{ title }}</span>
      <slot name="header" />
      <slot />
      <slot name="footer" />
      <button
        data-test="o-dialog-stub-primary"
        @click="$emit('click:primary')"
      >{{ primaryButtonLabel }}</button>
      <button
        data-test="o-dialog-stub-secondary"
        @click="$emit('click:secondary')"
      >{{ secondaryButtonLabel }}</button>
    </div>
  `,
};

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
        plugins: [[Quasar, { plugins: { Notify, Dialog } }], mockI18n, mockRouter],
        provide: { store: mockStore },
        stubs: {
          ODialog: ODialogStub,
        },
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

  describe('ODialog migration', () => {
    it('renders the template selection ODialog stub', () => {
      wrapper = createWrapper();
      const dialogs = wrapper.findAllComponents(ODialogStub);
      // Two ODialogs: template selection + component content
      expect(dialogs.length).toBe(2);
    });

    it('passes title "Choose Integration Method" to the template selection ODialog', () => {
      wrapper = createWrapper();
      const dialogs = wrapper.findAllComponents(ODialogStub);
      const templateDialog = dialogs.find((d) => d.props('title') === 'Choose Integration Method');
      expect(templateDialog).toBeTruthy();
    });

    it('passes size "sm" to the template selection ODialog', () => {
      wrapper = createWrapper();
      const dialogs = wrapper.findAllComponents(ODialogStub);
      const templateDialog = dialogs.find((d) => d.props('title') === 'Choose Integration Method');
      expect(templateDialog!.props('size')).toBe('sm');
    });

    it('passes secondaryButtonLabel "Cancel" to the template selection ODialog', () => {
      wrapper = createWrapper();
      const dialogs = wrapper.findAllComponents(ODialogStub);
      const templateDialog = dialogs.find((d) => d.props('title') === 'Choose Integration Method');
      expect(templateDialog!.props('secondaryButtonLabel')).toBe('Cancel');
    });

    it('passes size "xl" to the component-content ODialog', () => {
      wrapper = createWrapper();
      const dialogs = wrapper.findAllComponents(ODialogStub);
      // The component content dialog title is dynamic; size identifies it.
      const componentDialog = dialogs.find((d) => d.props('size') === 'xl');
      expect(componentDialog).toBeTruthy();
    });

    it('forwards open=false to the template selection ODialog initially', () => {
      wrapper = createWrapper();
      const dialogs = wrapper.findAllComponents(ODialogStub);
      const templateDialog = dialogs.find((d) => d.props('title') === 'Choose Integration Method');
      expect(templateDialog!.props('open')).toBe(false);
    });

    it('forwards open=false to the component-content ODialog initially', () => {
      wrapper = createWrapper();
      const dialogs = wrapper.findAllComponents(ODialogStub);
      const componentDialog = dialogs.find((d) => d.props('size') === 'xl');
      expect(componentDialog!.props('open')).toBe(false);
    });

    it('opens the template selection ODialog when handleAddSource triggers multi-option flow', async () => {
      wrapper = createWrapper({
        cloudFormationTemplate: undefined,
        cloudFormationTemplates: [
          { name: 'Template A', url: 'https://example.com/a.yaml', description: 'A' },
          { name: 'Template B', url: 'https://example.com/b.yaml', description: 'B' },
        ],
      });
      const addSourceBtn = wrapper.find('[data-test="aws-cloudwatch-logs-add-source-btn"]');
      await addSourceBtn.trigger('click');

      const dialogs = wrapper.findAllComponents(ODialogStub);
      const templateDialog = dialogs.find((d) => d.props('title') === 'Choose Integration Method');
      expect(templateDialog!.props('open')).toBe(true);
    });

    it('closes the template selection ODialog when its click:secondary fires (Cancel)', async () => {
      wrapper = createWrapper({
        cloudFormationTemplate: undefined,
        cloudFormationTemplates: [
          { name: 'Template A', url: 'https://example.com/a.yaml', description: 'A' },
          { name: 'Template B', url: 'https://example.com/b.yaml', description: 'B' },
        ],
      });
      const vm = wrapper.vm as any;
      // Open dialog first
      const addSourceBtn = wrapper.find('[data-test="aws-cloudwatch-logs-add-source-btn"]');
      await addSourceBtn.trigger('click');
      expect(vm.showTemplateDialog).toBe(true);

      // Drive Cancel button via click:secondary emit
      const dialogs = wrapper.findAllComponents(ODialogStub);
      const templateDialog = dialogs.find((d) => d.props('title') === 'Choose Integration Method');
      await templateDialog!.vm.$emit('click:secondary');

      expect(vm.showTemplateDialog).toBe(false);
    });

    it('closes the template selection ODialog after selecting a template', async () => {
      wrapper = createWrapper({
        cloudFormationTemplate: undefined,
        cloudFormationTemplates: [
          { name: 'Template A', url: 'https://example.com/a.yaml', description: 'A' },
          { name: 'Template B', url: 'https://example.com/b.yaml', description: 'B' },
        ],
      });
      const vm = wrapper.vm as any;
      vm.showTemplateDialog = true;
      await wrapper.vm.$nextTick();

      vm.handleTemplateSelection({ name: 'Template A', url: 'https://example.com/a.yaml', description: 'A' });
      await wrapper.vm.$nextTick();

      expect(vm.showTemplateDialog).toBe(false);
      expect(window.open).toHaveBeenCalled();
    });

    it('opens the component-content ODialog after handleComponentSelection', async () => {
      wrapper = createWrapper({
        cloudFormationTemplate: undefined,
        componentOptions: [
          { name: 'Linux', component: 'LinuxConfig', description: 'Linux setup' },
        ],
      });
      const vm = wrapper.vm as any;

      vm.handleComponentSelection({ name: 'Linux', component: 'LinuxConfig', description: 'Linux setup' });
      await wrapper.vm.$nextTick();

      expect(vm.showComponentContent).toBe(true);
      expect(vm.selectedComponentTitle).toBe('CloudWatch Logs - Linux');

      const dialogs = wrapper.findAllComponents(ODialogStub);
      const componentDialog = dialogs.find((d) => d.props('size') === 'xl');
      expect(componentDialog!.props('open')).toBe(true);
      // Title is dynamically bound
      expect(componentDialog!.props('title')).toBe('CloudWatch Logs - Linux');
    });

    it('closes the template selection ODialog when handleComponentSelection is invoked', async () => {
      wrapper = createWrapper({
        cloudFormationTemplate: undefined,
        cloudFormationTemplates: [
          { name: 'Template A', url: 'https://example.com/a.yaml', description: 'A' },
        ],
        componentOptions: [
          { name: 'Linux', component: 'LinuxConfig', description: 'Linux setup' },
        ],
      });
      const vm = wrapper.vm as any;
      vm.showTemplateDialog = true;
      await wrapper.vm.$nextTick();

      vm.handleComponentSelection({ name: 'Linux', component: 'LinuxConfig', description: 'Linux setup' });
      await wrapper.vm.$nextTick();

      expect(vm.showTemplateDialog).toBe(false);
      expect(vm.showComponentContent).toBe(true);
    });
  });
});

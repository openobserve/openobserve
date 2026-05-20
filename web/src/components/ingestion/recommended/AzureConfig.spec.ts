import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
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
  b64EncodeStandard: vi.fn((str) => btoa(str)),
  maskText: vi.fn((str) => '***'),
}));

vi.mock('../../../utils/azureIntegrations', () => ({
  azureIntegrations: [
    {
      id: 'activity-logs',
      name: 'Activity Logs',
      displayName: 'Azure Activity Logs',
      description: 'Stream Azure subscription activity logs',
      armTemplate: 'https://mock-s3-bucket.s3.amazonaws.com/activity-logs.json',
      hasDashboard: false,
      category: 'logs',
    },
  ],
  generateARMTemplateURL: vi.fn(() => 'https://portal.azure.com/#create/Microsoft.Template/uri/mock'),
  generateAzureDashboardURL: vi.fn(() => 'https://mock-dashboard-url'),
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

describe('AzureConfig.vue', () => {
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
    mount(AzureConfig, {
      global: {
        plugins: [mockI18n, mockRouter, mockStore],
        provide: { store: mockStore },
        stubs: {
          OToggleGroup: {
            template: '<div data-test="o-toggle-group" :data-value="modelValue"><slot /></div>',
            props: ['modelValue'],
            emits: ['update:modelValue'],
          },
          OToggleGroupItem: {
            template: '<button :data-value="value" @click="$emit(\'select\', value)"><slot /></button>',
            props: ['value'],
            emits: ['select'],
          },
          OSelect: {
            template: '<select :data-test="$attrs[\'data-test\']" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="o in options" :key="o.value || o" :value="o.value || o">{{ o.label || o }}</option></select>',
            props: ['modelValue', 'options', 'valueKey', 'labelKey'],
            emits: ['update:modelValue'],
          },
          OCheckbox: {
            template: '<input type="checkbox" :value="value" :checked="Array.isArray(modelValue) ? modelValue.includes(value) : modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />',
            props: ['modelValue', 'value', 'label'],
            emits: ['update:modelValue'],
          },
          OButton: {
            template: '<button :data-test="$attrs[\'data-test\']" :disabled="disabled" @click="$emit(\'click\')"><slot name="icon-left" /><slot /></button>',
            props: ['variant', 'size', 'disabled'],
            emits: ['click'],
          },
          OIcon: { template: '<i></i>', props: ['name', 'size', 'color'] },
          OBadge: { template: '<span><slot /></span>', props: ['variant', 'size'] },
          OTooltip: { template: '<span></span>', props: ['content'] },
          OSeparator: { template: '<hr />' },
          OInput: {
            template: '<input :data-test="$attrs[\'data-test\']" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
            props: ['modelValue'],
            emits: ['update:modelValue'],
          },
        },
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

    it('should have azure-config-page class', () => {
      wrapper = createWrapper();
      expect(wrapper.find('.azure-config-page').exists()).toBe(true);
    });

    it('should render Azure Activity Logs title', () => {
      wrapper = createWrapper();
      expect(wrapper.text()).toContain('Azure Activity Logs');
    });

    it('should render deploy button', () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="azure-activity-logs-deploy-btn"]').exists()).toBe(true);
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

  describe('Step 2 Mode Toggle', () => {
    it('should default to portal mode', () => {
      wrapper = createWrapper();
      expect((wrapper.vm as any).step2Mode).toBe('portal');
    });

    it('should switch to cli mode', async () => {
      wrapper = createWrapper();
      (wrapper.vm as any).step2Mode = 'cli';
      await wrapper.vm.$nextTick();
      expect((wrapper.vm as any).step2Mode).toBe('cli');
    });
  });

  describe('Category Selection', () => {
    it('should start with all categories enabled', () => {
      wrapper = createWrapper();
      expect((wrapper.vm as any).enabledCategories.length).toBe(8);
    });

    it('should clear categories', () => {
      wrapper = createWrapper();
      (wrapper.vm as any).enabledCategories = [];
      expect((wrapper.vm as any).enabledCategories.length).toBe(0);
    });
  });

  describe('handleDeploy', () => {
    it('should call window.open when credentials are valid', () => {
      wrapper = createWrapper();
      (wrapper.vm as any).handleDeploy();
      expect(window.open).toHaveBeenCalled();
    });
  });
});

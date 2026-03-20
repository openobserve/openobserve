import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { Quasar } from 'quasar';
import { createStore } from 'vuex';
import { createI18n } from 'vue-i18n';
import { createRouter, createWebHistory } from 'vue-router';
import LinuxConfig from './LinuxConfig.vue';
import CopyContent from '@/components/CopyContent.vue';

vi.mock('../../../aws-exports', () => ({
  default: { API_ENDPOINT: 'http://localhost:5080', region: 'us-east-1' },
}));

vi.mock('../../../utils/zincutils', () => ({
  getImageURL: vi.fn((path) => `mock-image-url-${path}`),
  getEndPoint: vi.fn(() => ({ url: 'http://localhost:5080', host: 'localhost', port: '5080', protocol: 'http', tls: false })),
  getIngestionURL: vi.fn(() => 'http://localhost:5080'),
  b64EncodeStandard: vi.fn((str) => btoa(str)),
}));

vi.mock('@/components/CopyContent.vue', () => ({
  default: {
    name: 'CopyContent',
    template: '<div data-test="copy-content">{{ content }}</div>',
    props: ['content'],
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
const mockRouter = createRouter({ history: createWebHistory(), routes: [{ path: '/', component: { template: '<div>Home</div>' } }] });

describe('LinuxConfig.vue', () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  const createWrapper = (props = {}) => {
    const defaultProps = { currOrgIdentifier: 'test-org', currUserEmail: 'test@example.com' };
    return mount(LinuxConfig, {
      props: { ...defaultProps, ...props },
      global: {
        plugins: [Quasar, mockI18n, mockRouter],
        provide: { store: mockStore },
        components: { CopyContent },
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

    it('should render CopyContent component', () => {
      wrapper = createWrapper();
      const copyContent = wrapper.findComponent(CopyContent);
      expect(copyContent.exists()).toBe(true);
    });

    it('should render installation description', () => {
      wrapper = createWrapper();
      expect(wrapper.text()).toContain('Once you have installed');
    });

    it('should render system logs collection info', () => {
      wrapper = createWrapper();
      expect(wrapper.text()).toContain('Collect system logs');
    });

    it('should render host metrics collection info', () => {
      wrapper = createWrapper();
      expect(wrapper.text()).toContain('Collect host metrics');
    });
  });

  describe('Props Validation', () => {
    it('should accept currOrgIdentifier prop', () => {
      wrapper = createWrapper({ currOrgIdentifier: 'my-org' });
      expect(wrapper.exists()).toBe(true);
    });

    it('should accept currUserEmail prop', () => {
      wrapper = createWrapper({ currUserEmail: 'user@test.com' });
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe('getCommand Computed', () => {
    it('should generate a command string', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(typeof vm.getCommand).toBe('string');
    });

    it('should include install.sh in the command', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.getCommand).toContain('install.sh');
    });

    it('should include the endpoint URL in the command', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.getCommand).toContain('http://localhost:5080');
    });

    it('should include the org identifier in the command', () => {
      wrapper = createWrapper({ currOrgIdentifier: 'my-org' });
      const vm = wrapper.vm as any;
      expect(vm.getCommand).toContain('my-org');
    });

    it('should include BASIC_PASSCODE placeholder', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.getCommand).toContain('[BASIC_PASSCODE]');
    });

    it('should include curl command', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.getCommand).toContain('curl');
    });
  });

  describe('CopyContent Integration', () => {
    it('should pass getCommand to CopyContent', () => {
      wrapper = createWrapper();
      const copyContent = wrapper.findComponent(CopyContent);
      expect(copyContent.props('content')).toBeDefined();
      expect(typeof copyContent.props('content')).toBe('string');
    });

    it('should pass command with org identifier to CopyContent', () => {
      wrapper = createWrapper({ currOrgIdentifier: 'test-org' });
      const copyContent = wrapper.findComponent(CopyContent);
      expect(copyContent.props('content')).toContain('test-org');
    });
  });

  describe('getImageURL and Utilities', () => {
    it('should call getEndPoint on setup', async () => {
      const zincutils = await import('../../../utils/zincutils');
      wrapper = createWrapper();
      expect(zincutils.getEndPoint).toHaveBeenCalled();
    });

    it('should call getIngestionURL on setup', async () => {
      const zincutils = await import('../../../utils/zincutils');
      wrapper = createWrapper();
      expect(zincutils.getIngestionURL).toHaveBeenCalled();
    });
  });
});

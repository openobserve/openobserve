import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { Quasar } from 'quasar';
import { createStore } from 'vuex';
import { createI18n } from 'vue-i18n';
import { createRouter, createWebHistory } from 'vue-router';
import Nginx from './Nginx.vue';
import CopyContent from '@/components/CopyContent.vue';

vi.mock('../../../aws-exports', () => ({
  default: { API_ENDPOINT: 'http://localhost:5080', region: 'us-east-1' },
}));

vi.mock('../../../utils/zincutils', () => ({
  getImageURL: vi.fn((path) => `mock-image-url-${path}`),
  getEndPoint: vi.fn(() => ({ url: 'http://localhost:5080', host: 'localhost', port: '5080', protocol: 'http', tls: false })),
  getIngestionURL: vi.fn(() => 'http://localhost:5080'),
}));

vi.mock('@/composables/useIngestion', () => ({
  default: vi.fn(() => ({
    endpoint: { url: 'http://localhost:5080', host: 'localhost', port: '5080', protocol: 'http', tls: false },
    serverContent: `HTTP Endpoint: http://localhost:5080/api/test-org/[STREAM_NAME]/_json\nAccess Key: [BASIC_PASSCODE]`,
    serverDocURLs: {
      nginx: 'https://short.openobserve.ai/server/nginx',
      apache: 'https://short.openobserve.ai/server/apache',
      iis: 'https://short.openobserve.ai/server/iis',
    },
  })),
}));

vi.mock('@/components/CopyContent.vue', () => ({
  default: { name: 'CopyContent', template: '<div data-test="copy-content">{{ content }}</div>', props: ['content'] },
}));

const mockStore = createStore({
  state: {
    selectedOrganization: { identifier: 'test-org', name: 'Test Organization' },
    userInfo: { email: 'test@example.com' },
  },
});

const mockI18n = createI18n({ locale: 'en', messages: { en: {} } });

const mockRouter = createRouter({
  history: createWebHistory(),
  routes: [{ path: '/', component: { template: '<div>Home</div>' } }],
});

describe('Nginx.vue Comprehensive Coverage', () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllMocks();
  });

  const createWrapper = (props = {}) => {
    const defaultProps = { currOrgIdentifier: 'test-org', currUserEmail: 'test@example.com' };
    return mount(Nginx, {
      props: { ...defaultProps, ...props },
      global: {
        plugins: [Quasar, mockI18n, mockRouter],
        provide: { store: mockStore },
        components: { CopyContent },
      },
    });
  };

  describe('Component Rendering Tests', () => {
    it('should render CopyContent component', () => {
      wrapper = createWrapper();
      const copyContent = wrapper.findComponent(CopyContent);
      expect(copyContent.exists()).toBe(true);
    });

    it('should render documentation link', () => {
      wrapper = createWrapper();
      const docLink = wrapper.find('a');
      expect(docLink.exists()).toBe(true);
      expect(docLink.attributes('target')).toBe('_blank');
    });

    it('should apply correct styling to documentation link', () => {
      wrapper = createWrapper();
      const docLink = wrapper.find('a');
      expect(docLink.classes()).toContain('text-blue-500');
    });

    it('should render documentation text correctly', () => {
      wrapper = createWrapper();
      const text = wrapper.text();
      expect(text).toContain('Click');
      expect(text).toContain('here');
      expect(text).toContain('to check further documentation');
    });
  });

  describe('Props Validation Tests', () => {
    it('should accept currOrgIdentifier string prop', () => {
      wrapper = createWrapper({ currOrgIdentifier: 'custom-org' });
      expect(wrapper.exists()).toBe(true);
    });

    it('should accept currUserEmail string prop', () => {
      wrapper = createWrapper({ currUserEmail: 'custom@example.com' });
      expect(wrapper.exists()).toBe(true);
    });

    it('should handle undefined currOrgIdentifier', () => {
      wrapper = createWrapper({ currOrgIdentifier: undefined });
      expect(wrapper.exists()).toBe(true);
    });

    it('should handle undefined currUserEmail', () => {
      wrapper = createWrapper({ currUserEmail: undefined });
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe('Setup Function Tests', () => {
    it('should initialize content as a string', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(typeof vm.content).toBe('string');
    });

    it('should not contain [STREAM_NAME] in content', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.content).not.toContain('[STREAM_NAME]');
    });

    it('should expose docURL as a defined string', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.docURL).toBeDefined();
      expect(typeof vm.docURL).toBe('string');
    });

    it('should expose content', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.content).toBeDefined();
    });
  });

  describe('Content Processing Tests', () => {
    it('should replace [STREAM_NAME] with nginx in content', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.content).toContain('nginx');
      expect(vm.content).not.toContain('[STREAM_NAME]');
    });

    it('should generate content with HTTP Endpoint structure', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.content).toContain('HTTP Endpoint:');
    });

    it('should produce content with Access Key field', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.content).toContain('Access Key:');
    });
  });

  describe('Component Props Passing Tests', () => {
    it('should pass content prop to CopyContent that is defined', () => {
      wrapper = createWrapper();
      const copyContent = wrapper.findComponent(CopyContent);
      expect(copyContent.props('content')).toBeDefined();
    });

    it('should pass href to documentation link that is defined', () => {
      wrapper = createWrapper();
      const docLink = wrapper.find('a');
      expect(docLink.attributes('href')).toBeDefined();
    });

    it('should pass the correct nginx doc URL as href', () => {
      wrapper = createWrapper();
      const docLink = wrapper.find('a');
      expect(docLink.attributes('href')).toBe('https://short.openobserve.ai/server/nginx');
    });
  });

  describe('Component Lifecycle Tests', () => {
    it('should mount without errors', () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it('should unmount without errors', () => {
      wrapper = createWrapper();
      expect(() => wrapper.unmount()).not.toThrow();
    });

    it('should handle props updates', async () => {
      wrapper = createWrapper({ currOrgIdentifier: 'initial-org' });
      await wrapper.setProps({ currOrgIdentifier: 'updated-org' });
      expect(wrapper.exists()).toBe(true);
    });
  });
});

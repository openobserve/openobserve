import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { Quasar } from 'quasar';
import { createStore } from 'vuex';
import { createI18n } from 'vue-i18n';
import { createRouter, createWebHistory } from 'vue-router';
import Java from './Java.vue';
import CopyContent from '@/components/CopyContent.vue';

vi.mock('../../../aws-exports', () => ({
  default: {
    API_ENDPOINT: 'http://localhost:5080',
    region: 'us-east-1',
  },
}));

vi.mock('../../../utils/zincutils', () => ({
  getImageURL: vi.fn((path) => `mock-image-url-${path}`),
  getEndPoint: vi.fn(() => ({
    url: 'http://localhost:5080',
    host: 'localhost',
    port: '5080',
    protocol: 'http',
    tls: false,
  })),
  getIngestionURL: vi.fn(() => 'http://localhost:5080'),
}));

vi.mock('@/composables/useIngestion', () => ({
  default: vi.fn(() => ({
    endpoint: {
      url: 'http://localhost:5080',
      host: 'localhost',
      port: '5080',
      protocol: 'http',
      tls: false,
    },
    languagesContent: `exporters:\n  otlphttp/openobserve:\n    endpoint: http://localhost:5080/api/test-org/\n    headers:\n      Authorization: Basic [BASIC_PASSCODE]\n      stream-name: [STREAM_NAME]`,
    languagesDocURLs: {
      java: 'https://short.openobserve.ai/languages/java',
    },
  })),
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
    selectedOrganization: {
      identifier: 'test-org',
      name: 'Test Organization',
    },
    userInfo: {
      email: 'test@example.com',
    },
  },
});

const mockI18n = createI18n({
  locale: 'en',
  messages: { en: {} },
});

const mockRouter = createRouter({
  history: createWebHistory(),
  routes: [{ path: '/', component: { template: '<div>Home</div>' } }],
});

describe('Java.vue Comprehensive Coverage', () => {
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
    const defaultProps = {
      currOrgIdentifier: 'test-org',
      currUserEmail: 'test@example.com',
    };
    return mount(Java, {
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
      expect(docLink.attributes('style')).toContain('text-decoration: underline');
    });

    it('should render documentation text correctly', () => {
      wrapper = createWrapper();
      const docSection = wrapper.find('.tw\\:font-bold');
      expect(docSection.text()).toContain('Click');
      expect(docSection.text()).toContain('here');
      expect(docSection.text()).toContain('to check further documentation');
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

    it('should handle empty string props', () => {
      wrapper = createWrapper({ currOrgIdentifier: '', currUserEmail: '' });
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe('Setup Function Tests', () => {
    it('should initialize content as a string', () => {
      wrapper = createWrapper();
      expect(typeof (wrapper.vm as any).content).toBe('string');
    });

    it('should NOT contain [STREAM_NAME] in content', () => {
      wrapper = createWrapper();
      expect((wrapper.vm as any).content).not.toContain('[STREAM_NAME]');
    });

    it('should replace [STREAM_NAME] with java', () => {
      wrapper = createWrapper();
      expect((wrapper.vm as any).content).toContain('java');
    });

    it('should define docURL as a string', () => {
      wrapper = createWrapper();
      expect(typeof (wrapper.vm as any).docURL).toBe('string');
      expect((wrapper.vm as any).docURL).toBeDefined();
    });

    it('should expose all required properties', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.content).toBeDefined();
      expect(vm.docURL).toBeDefined();
    });
  });

  describe('Content Processing Tests', () => {
    it('should replace [STREAM_NAME] with processed name', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.content).not.toContain('[STREAM_NAME]');
      expect(vm.content).toContain('java');
    });

    it('should generate valid YAML structure', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.content).toContain('exporters:');
      expect(vm.content).toContain('otlphttp/openobserve:');
    });

    it('should produce lowercase stream name', () => {
      wrapper = createWrapper();
      expect((wrapper.vm as any).content).not.toContain('JAVA');
    });
  });

  describe('Component Props Passing Tests', () => {
    it('should pass content prop to CopyContent component', () => {
      wrapper = createWrapper();
      const copyContent = wrapper.findComponent(CopyContent);
      expect(copyContent.props('content')).toBeDefined();
      expect(typeof copyContent.props('content')).toBe('string');
    });

    it('should pass processed content without [STREAM_NAME] to CopyContent', () => {
      wrapper = createWrapper();
      const content = wrapper.findComponent(CopyContent).props('content');
      expect(content).not.toContain('[STREAM_NAME]');
      expect(content).toContain('java');
    });

    it('should pass correct href to documentation link', () => {
      wrapper = createWrapper();
      const docLink = wrapper.find('a');
      expect(docLink.attributes('href')).toBeDefined();
      expect(docLink.attributes('href')).toBe('https://short.openobserve.ai/languages/java');
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

    it('should maintain content after props update', async () => {
      wrapper = createWrapper();
      const initialContent = (wrapper.vm as any).content;
      await wrapper.setProps({ currUserEmail: 'new@example.com' });
      expect((wrapper.vm as any).content).toBe(initialContent);
    });
  });
});

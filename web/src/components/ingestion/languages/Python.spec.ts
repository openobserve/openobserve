import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { Quasar } from 'quasar';
import { createStore } from 'vuex';
import { createI18n } from 'vue-i18n';
import { createRouter, createWebHistory } from 'vue-router';
import Python from './Python.vue';
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
      python: 'https://short.openobserve.ai/languages/python',
      fastapi: 'https://short.openobserve.ai/languages/fastapi',
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

describe('Python.vue Comprehensive Coverage', () => {
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
    return mount(Python, {
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

    it('should render at least one documentation link with target _blank', () => {
      wrapper = createWrapper();
      const links = wrapper.findAll('a');
      expect(links.length).toBeGreaterThan(0);
      expect(links[0].attributes('target')).toBe('_blank');
    });

    it('should apply correct styling to documentation links', () => {
      wrapper = createWrapper();
      const links = wrapper.findAll('a');
      expect(links[0].classes()).toContain('text-blue-500');
    });

    it('should render documentation section text', () => {
      wrapper = createWrapper();
      const docSection = wrapper.find('.tw\\:font-bold');
      expect(docSection.exists()).toBe(true);
      expect(docSection.text()).toContain('Check further documentation');
    });
  });

  describe('Props Validation Tests', () => {
    it('should accept currOrgIdentifier string prop', () => {
      wrapper = createWrapper({ currOrgIdentifier: 'custom-org' });
      expect(wrapper.props('currOrgIdentifier')).toBe('custom-org');
    });

    it('should accept currUserEmail string prop', () => {
      wrapper = createWrapper({ currUserEmail: 'custom@example.com' });
      expect(wrapper.props('currUserEmail')).toBe('custom@example.com');
    });

    it('should handle undefined currOrgIdentifier', () => {
      wrapper = createWrapper({ currOrgIdentifier: undefined });
      expect(wrapper.props('currOrgIdentifier')).toBeUndefined();
    });

    it('should handle undefined currUserEmail', () => {
      wrapper = createWrapper({ currUserEmail: undefined });
      expect(wrapper.props('currUserEmail')).toBeUndefined();
    });

    it('should handle empty string props', () => {
      wrapper = createWrapper({ currOrgIdentifier: '', currUserEmail: '' });
      expect(wrapper.props('currOrgIdentifier')).toBe('');
      expect(wrapper.props('currUserEmail')).toBe('');
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

    it('should replace [STREAM_NAME] with python', () => {
      wrapper = createWrapper();
      expect((wrapper.vm as any).content).toContain('python');
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
      expect(vm.content).toContain('python');
    });

    it('should generate valid YAML structure', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.content).toContain('exporters:');
      expect(vm.content).toContain('otlphttp/openobserve:');
    });

    it('should produce lowercase stream name', () => {
      wrapper = createWrapper();
      expect((wrapper.vm as any).content).not.toContain('PYTHON');
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
      expect(content).toContain('python');
    });

    it('should have documentation links with defined hrefs', () => {
      wrapper = createWrapper();
      const links = wrapper.findAll('a');
      links.forEach((link) => {
        expect(link.attributes('href')).toBeDefined();
      });
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
      expect(wrapper.props('currOrgIdentifier')).toBe('updated-org');
    });

    it('should maintain content after props update', async () => {
      wrapper = createWrapper();
      const initialContent = (wrapper.vm as any).content;
      await wrapper.setProps({ currUserEmail: 'new@example.com' });
      expect((wrapper.vm as any).content).toBe(initialContent);
    });
  });
});

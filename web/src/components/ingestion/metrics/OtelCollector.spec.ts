import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { Quasar } from 'quasar';
import { createStore } from 'vuex';
import { createI18n } from 'vue-i18n';
import { createRouter, createWebHistory } from 'vue-router';
import OtelCollector from './OtelCollector.vue';
import CopyContent from '@/components/CopyContent.vue';

vi.mock('../../../aws-exports', () => ({
  default: { API_ENDPOINT: 'http://localhost:5080', region: 'us-east-1' },
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
const mockRouter = createRouter({
  history: createWebHistory(),
  routes: [{ path: '/', component: { template: '<div>Home</div>' } }],
});

describe('OtelCollector.vue', () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  const createWrapper = (props = {}) => {
    const defaultProps = { currOrgIdentifier: 'test-org', currUserEmail: 'test@example.com' };
    return mount(OtelCollector, {
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

    it('should render two CopyContent components', () => {
      wrapper = createWrapper();
      const copyContents = wrapper.findAllComponents(CopyContent);
      expect(copyContents.length).toBe(2);
    });

    it('should render OTLP HTTP label', () => {
      wrapper = createWrapper();
      expect(wrapper.text()).toContain('OTLP HTTP');
    });

    it('should render OTLP gRPC label', () => {
      wrapper = createWrapper();
      expect(wrapper.text()).toContain('OTLP gRPC');
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

  describe('getOtelHttpConfig Computed', () => {
    it('should generate HTTP config string', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(typeof vm.getOtelHttpConfig).toBe('string');
    });

    it('should include otlphttp/openobserve exporter in HTTP config', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.getOtelHttpConfig).toContain('otlphttp/openobserve');
    });

    it('should include endpoint URL in HTTP config', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.getOtelHttpConfig).toContain('http://localhost:5080');
    });

    it('should include org identifier in HTTP config', () => {
      wrapper = createWrapper({ currOrgIdentifier: 'my-org' });
      const vm = wrapper.vm as any;
      expect(vm.getOtelHttpConfig).toContain('my-org');
    });

    it('should include BASIC_PASSCODE placeholder in HTTP config', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.getOtelHttpConfig).toContain('[BASIC_PASSCODE]');
    });

    it('should include stream-name default in HTTP config', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.getOtelHttpConfig).toContain('stream-name: default');
    });

    it('should include Authorization header in HTTP config', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.getOtelHttpConfig).toContain('Authorization');
    });

    it('should include service telemetry logs level warn in HTTP config', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.getOtelHttpConfig).toContain('service:');
      expect(vm.getOtelHttpConfig).toContain('telemetry:');
      expect(vm.getOtelHttpConfig).toContain('level: warn');
    });
  });

  describe('getOtelGrpcConfig Computed', () => {
    it('should generate gRPC config string', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(typeof vm.getOtelGrpcConfig).toBe('string');
    });

    it('should include otlp/openobserve exporter in gRPC config', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.getOtelGrpcConfig).toContain('otlp/openobserve');
    });

    it('should include port 5081 in gRPC config', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.getOtelGrpcConfig).toContain('5081');
    });

    it('should include org identifier in gRPC config', () => {
      wrapper = createWrapper({ currOrgIdentifier: 'my-org' });
      const vm = wrapper.vm as any;
      expect(vm.getOtelGrpcConfig).toContain('my-org');
    });

    it('should include BASIC_PASSCODE placeholder in gRPC config', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.getOtelGrpcConfig).toContain('[BASIC_PASSCODE]');
    });

    it('should include insecure: true in gRPC config', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.getOtelGrpcConfig).toContain('insecure: true');
    });

    it('should include localhost host in gRPC config', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.getOtelGrpcConfig).toContain('localhost');
    });

    it('should include service telemetry logs level warn in gRPC config', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.getOtelGrpcConfig).toContain('service:');
      expect(vm.getOtelGrpcConfig).toContain('telemetry:');
      expect(vm.getOtelGrpcConfig).toContain('level: warn');
    });
  });

  describe('CopyContent Integration', () => {
    it('should pass getOtelHttpConfig to first CopyContent', () => {
      wrapper = createWrapper();
      const copyContents = wrapper.findAllComponents(CopyContent);
      const httpContent = copyContents[0].props('content');
      expect(httpContent).toBeDefined();
      expect(typeof httpContent).toBe('string');
      expect(httpContent).toContain('otlphttp/openobserve');
    });

    it('should pass getOtelGrpcConfig to second CopyContent', () => {
      wrapper = createWrapper();
      const copyContents = wrapper.findAllComponents(CopyContent);
      const grpcContent = copyContents[1].props('content');
      expect(grpcContent).toBeDefined();
      expect(typeof grpcContent).toBe('string');
      expect(grpcContent).toContain('5081');
    });

    it('should pass org identifier in HTTP config to CopyContent', () => {
      wrapper = createWrapper({ currOrgIdentifier: 'test-org' });
      const copyContents = wrapper.findAllComponents(CopyContent);
      expect(copyContents[0].props('content')).toContain('test-org');
    });
  });

  describe('Utilities', () => {
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

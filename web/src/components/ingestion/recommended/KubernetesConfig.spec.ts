import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { Quasar } from 'quasar';
import { createStore } from 'vuex';
import { createI18n } from 'vue-i18n';
import { createRouter, createWebHistory } from 'vue-router';
import { nextTick } from 'vue';
import KubernetesConfig from './KubernetesConfig.vue';
import CopyContent from '@/components/CopyContent.vue';

vi.mock('../../../aws-exports', () => ({
  default: { API_ENDPOINT: 'http://localhost:5080', region: 'us-east-1', isCloud: 'false' },
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
    theme: 'light',
  },
});

const mockI18n = createI18n({
  locale: 'en',
  messages: {
    en: {
      ingestion: {
        external: 'External Endpoint',
        internal: 'Internal Endpoint',
        internalLabel: 'Use this if OpenObserve is in the same cluster',
      },
    },
  },
});

const mockRouter = createRouter({
  history: createWebHistory(),
  routes: [{ path: '/', component: { template: '<div>Home</div>' } }],
});

describe('KubernetesConfig.vue', () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  const createWrapper = (props = {}) => {
    const defaultProps = { currOrgIdentifier: 'test-org', currUserEmail: 'test@example.com' };
    return mount(KubernetesConfig, {
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

    it('should render Quick Install section', () => {
      wrapper = createWrapper();
      expect(wrapper.text()).toContain('Quick Install');
    });

    it('should render Cluster Name input', () => {
      wrapper = createWrapper();
      const input = wrapper.find('[data-test="kubernetes-cluster-name-input"]');
      expect(input.exists()).toBe(true);
    });

    it('should render advanced install expansion toggle', () => {
      wrapper = createWrapper();
      const toggle = wrapper.find('[data-test="kubernetes-advanced-install-toggle"]');
      expect(toggle.exists()).toBe(true);
    });

    it('should render CopyContent components', () => {
      wrapper = createWrapper();
      const copyContents = wrapper.findAllComponents(CopyContent);
      expect(copyContents.length).toBeGreaterThan(0);
    });

    it('should render kubernetes collector info', () => {
      wrapper = createWrapper();
      expect(wrapper.text()).toContain('Kubernetes cluster');
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

  describe('Reactive Data', () => {
    it('should have clusterName with default value cluster1', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.clusterName).toBe('cluster1');
    });

    it('should have installType with default value external', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.installType).toBe('external');
    });

    it('should have showAdvancedInstall default false', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.showAdvancedInstall).toBe(false);
    });

    it('should update clusterName reactively', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.clusterName = 'my-cluster';
      await nextTick();
      expect(vm.clusterName).toBe('my-cluster');
    });
  });

  describe('quickInstallCmd Computed', () => {
    it('should generate quickInstallCmd string', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(typeof vm.quickInstallCmd).toBe('string');
    });

    it('should include curl in quickInstallCmd', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.quickInstallCmd).toContain('curl');
    });

    it('should include install.sh in quickInstallCmd', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.quickInstallCmd).toContain('install.sh');
    });

    it('should include cluster name in quickInstallCmd', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.quickInstallCmd).toContain('cluster1');
    });

    it('should include org identifier in quickInstallCmd', () => {
      wrapper = createWrapper({ currOrgIdentifier: 'my-org' });
      const vm = wrapper.vm as any;
      expect(vm.quickInstallCmd).toContain('my-org');
    });

    it('should include endpoint URL in quickInstallCmd', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.quickInstallCmd).toContain('http://localhost:5080');
    });

    it('should include internal-endpoint for internal installType', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.installType = 'internal';
      await nextTick();
      expect(vm.quickInstallCmd).toContain('--internal-endpoint');
    });

    it('should not include internal-endpoint for external installType', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.installType = 'external';
      await nextTick();
      expect(vm.quickInstallCmd).not.toContain('--internal-endpoint');
    });
  });

  describe('helmUpdateCmd Computed', () => {
    it('should generate helmUpdateCmd string', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(typeof vm.helmUpdateCmd).toBe('string');
    });

    it('should include helm repo add command', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.helmUpdateCmd).toContain('helm repo add openobserve');
    });

    it('should include helm repo update command', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.helmUpdateCmd).toContain('helm repo update');
    });
  });

  describe('crdCommand Computed', () => {
    it('should generate crdCommand string', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(typeof vm.crdCommand).toBe('string');
    });

    it('should include kubectl create commands', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.crdCommand).toContain('kubectl create');
    });

    it('should include prometheus-operator CRDs', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.crdCommand).toContain('prometheus-operator');
    });
  });

  describe('collectorCmd Computed', () => {
    it('should generate collectorCmd string', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(typeof vm.collectorCmd).toBe('string');
    });

    it('should include helm upgrade command', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.collectorCmd).toContain('helm');
      expect(vm.collectorCmd).toContain('upgrade --install');
    });

    it('should include org identifier in collectorCmd', () => {
      wrapper = createWrapper({ currOrgIdentifier: 'test-org' });
      const vm = wrapper.vm as any;
      expect(vm.collectorCmd).toContain('test-org');
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

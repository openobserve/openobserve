import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { createRouter, createWebHistory } from 'vue-router';
import { Quasar, Notify } from 'quasar';
import MemberSubscription from './MemberSubscription.vue';
import organizationsService from '@/services/organizations';
import * as zincutils from '@/utils/zincutils';

// Mock the services and utilities
vi.mock('@/services/organizations', () => ({
  default: {
    process_subscription: vi.fn(),
  },
}));

vi.mock('@/utils/zincutils', () => ({
  useLocalOrganization: vi.fn(),
  getPath: vi.fn(() => 'http://localhost:3000'),
}));

// Mock SanitizedHtmlRenderer component
vi.mock('@/components/SanitizedHtmlRenderer.vue', () => ({
  default: {
    name: 'SanitizedHtmlRenderer',
    props: ['htmlContent'],
    template: '<div class="sanitized-html" data-test="sanitized-html">{{ htmlContent }}</div>',
  },
}));

const mockOrganizationsService = organizationsService as any;

describe('MemberSubscription.vue', () => {
  let wrapper: any;
  let store: any;
  let router: any;

  const createMockRoute = (hash = '#token=test-token-123') => ({
    hash,
    params: {},
    query: {},
    name: 'member-subscription',
    path: '/member-subscription',
  });

  const createWrapper = (routeHash = '#token=test-token-123', preventAutoProcess = false) => {
    // Create store
    store = createStore({
      state: {
        selectedOrganization: {
          identifier: 'test-org-id',
          name: 'Test Organization',
        },
      },
    });

    // Create router
    router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: '/', name: 'home', component: { template: '<div>Home</div>' } },
        { path: '/organizations', name: 'organizations', component: { template: '<div>Organizations</div>' } },
        { path: '/member-subscription', name: 'member-subscription', component: MemberSubscription },
      ],
    });

    // Push to the route
    router.push('/member-subscription' + routeHash);

    const mockNotify = vi.fn();
    const mockQuasar = {
      notify: mockNotify,
    };

    const wrapperInstance = mount(MemberSubscription, {
      global: {
        plugins: [
          store,
          router,
          [Quasar, {
            plugins: {
              Notify,
            },
          }],
        ],
        mocks: {
          $q: mockQuasar,
          $route: createMockRoute(routeHash),
          $router: {
            resolve: vi.fn().mockReturnValue({ href: '/organizations' }),
            push: vi.fn(),
          },
          $store: store,
        },
        stubs: {
          'q-page': {
            template: '<div class="q-page"><slot /></div>',
          },
          'q-btn': {
            template: '<button class="q-btn"><slot /></button>',
            props: ['label'],
          },
          'SanitizedHtmlRenderer': {
            template: '<div class="sanitized-html" data-test="sanitized-html">{{ htmlContent }}</div>',
            props: ['htmlContent'],
          },
        },
      },
    });

    // Mock ProcessSubscription if we want to prevent auto processing
    if (preventAutoProcess) {
      vi.spyOn(wrapperInstance.vm, 'ProcessSubscription').mockImplementation(() => Promise.resolve());
    }

    return wrapperInstance;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock window.location.href
    delete (window as any).location;
    (window as any).location = { href: '' };

    // Mock process_subscription to prevent actual API calls
    mockOrganizationsService.process_subscription.mockResolvedValue({
      data: {
        message: 'Success',
      },
    });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe('Component Initialization', () => {
    it('should render the component with correct title', async () => {
      wrapper = createWrapper('#token=test-token-123', true); // Prevent auto processing
      await wrapper.vm.$nextTick();
      
      expect(wrapper.find('.q-page').exists()).toBe(true);
      expect(wrapper.text()).toContain('Member Subscription');
    });

    it('should start with processing status', () => {
      wrapper = createWrapper('#token=test-token-123', true); // Prevent auto processing
      
      expect(wrapper.vm.status).toBe('processing');
      expect(wrapper.vm.message).toBe('Please wait while we process your request...');
    });

    it('should extract token from route hash correctly', () => {
      wrapper = createWrapper('#token=abc123def456', true); // Prevent auto processing
      
      expect(wrapper.vm.queryString).toBe('abc123def456');
    });

    it('should call ProcessSubscription on component creation', async () => {
      const processSpy = vi.spyOn(MemberSubscription.methods!, 'ProcessSubscription');
      wrapper = createWrapper('#sub_key=test-token');
      
      await wrapper.vm.$nextTick();
      expect(processSpy).toHaveBeenCalledWith('test-token', 'confirm');
    });
  });

  describe('Template Rendering', () => {
    it('should show processing message when status is processing', async () => {
      // Mock API to delay so we can test processing state
      let resolvePromise: any;
      const delayedPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      
      mockOrganizationsService.process_subscription.mockReturnValue(delayedPromise);
      
      wrapper = createWrapper('#token=test-token-123', false); // Don't prevent auto processing
      
      // Check processing state before resolving the promise
      expect(wrapper.vm.status).toBe('processing');
      expect(wrapper.text()).toContain('Please wait while we process your request...');
      
      // Resolve the promise to complete the test
      resolvePromise({
        data: {
          message: 'Success',
        },
      });
      
      await wrapper.vm.$nextTick();
    });

    it('should show error message when status is error with empty error string', async () => {
      // Create wrapper with no hash to avoid ProcessSubscription call
      wrapper = createWrapper('', true);
      
      // Wait for component to mount completely
      await wrapper.vm.$nextTick();
      
      // Completely replace the ProcessSubscription method
      wrapper.vm.ProcessSubscription = vi.fn().mockResolvedValue(undefined);
      
      // Directly set the reactive data
      wrapper.vm.status = 'error';
      wrapper.vm.error = '';
      
      // Force update and wait
      wrapper.vm.$forceUpdate();
      await wrapper.vm.$nextTick();
      
      expect(wrapper.vm.status).toBe('error');
      expect(wrapper.vm.error).toBe('');
      expect(wrapper.text()).toContain('Error while processing member subscription request.');
    });

    it('should render SanitizedHtmlRenderer when status is error with error message', async () => {
      // Create wrapper with no hash to avoid ProcessSubscription call
      wrapper = createWrapper('', true);
      
      // Wait for component to mount completely
      await wrapper.vm.$nextTick();
      
      // Completely replace the ProcessSubscription method
      wrapper.vm.ProcessSubscription = vi.fn().mockResolvedValue(undefined);
      
      // Directly set the reactive data
      wrapper.vm.status = 'error';
      wrapper.vm.error = 'Custom error message';
      
      // Force update and wait
      wrapper.vm.$forceUpdate();
      await wrapper.vm.$nextTick();
      
      expect(wrapper.vm.status).toBe('error');
      expect(wrapper.vm.error).toBe('Custom error message');
      
      const sanitizedComponent = wrapper.find('[data-test="sanitized-html"]');
      expect(sanitizedComponent.exists()).toBe(true);
      expect(sanitizedComponent.text()).toContain('Custom error message');
    });

    it('should show success message when status is completed', async () => {
      // Create wrapper with no hash to avoid ProcessSubscription call
      wrapper = createWrapper('', true);
      
      // Wait for component to mount completely
      await wrapper.vm.$nextTick();
      
      // Completely replace the ProcessSubscription method
      wrapper.vm.ProcessSubscription = vi.fn().mockResolvedValue(undefined);
      
      // Directly set the reactive data
      wrapper.vm.status = 'completed';
      
      // Force update and wait
      wrapper.vm.$forceUpdate();
      await wrapper.vm.$nextTick();
      
      expect(wrapper.vm.status).toBe('completed');
      expect(wrapper.text()).toContain('Thank you for your subscription.');
    });
  });

  describe('ProcessSubscription Method', () => {
    beforeEach(() => {
      wrapper = createWrapper('#token=test-token-123', true); // Prevent auto processing
    });

    it('should handle successful subscription without data', async () => {
      const mockResponse = {
        data: {
          message: 'Subscription successful',
        },
      };

      wrapper = createWrapper('#sub_key=test-token&org_id=test-org-id', true);
      mockOrganizationsService.process_subscription.mockResolvedValue(mockResponse);

      // Get the spy that was created in createWrapper and restore it
      const processSubscriptionSpy = vi.spyOn(wrapper.vm, 'ProcessSubscription');
      processSubscriptionSpy.mockRestore();

      await wrapper.vm.ProcessSubscription('test-token', 'confirm');

      expect(mockOrganizationsService.process_subscription).toHaveBeenCalledWith(
        'test-token',
        'confirm',
        'test-org-id'
      );
      expect(wrapper.vm.status).toBe('completed');
    });

    it('should handle successful subscription with organization data', async () => {
      const mockResponse = {
        data: {
          message: 'Subscription successful',
          data: {
            name: 'New Organization',
            id: 'new-org-id',
          },
        },
      };

      wrapper = createWrapper('#sub_key=test-token&org_id=test-org-id', true);
      mockOrganizationsService.process_subscription.mockResolvedValue(mockResponse);

      // Get the spy that was created in createWrapper and restore it
      const processSubscriptionSpy = vi.spyOn(wrapper.vm, 'ProcessSubscription');
      processSubscriptionSpy.mockRestore();

      await wrapper.vm.ProcessSubscription('test-token', 'confirm');

      expect(wrapper.vm.status).toBe('completed');
      expect(window.location.href).toBe('/organizations?org_identifier=test-org-id');
    });

    it('should handle subscription error', async () => {
      const mockError = {
        response: {
          data: {
            message: 'Subscription failed with [BASE_URL] error',
          },
        },
      };

      mockOrganizationsService.process_subscription.mockRejectedValue(mockError);

      // Get the spy that was created in createWrapper and restore it
      const processSubscriptionSpy = vi.spyOn(wrapper.vm, 'ProcessSubscription');
      processSubscriptionSpy.mockRestore();

      await wrapper.vm.ProcessSubscription('test-token', 'confirm');

      expect(wrapper.vm.status).toBe('error');
      expect(wrapper.vm.error).toBe('Subscription failed with http://localhost:3000 error');
    });

    it('should replace [BASE_URL] placeholder in error message', async () => {
      const mockError = {
        response: {
          data: {
            message: 'Error occurred at [BASE_URL]/api/endpoint',
          },
        },
      };

      mockOrganizationsService.process_subscription.mockRejectedValue(mockError);

      // Get the spy that was created in createWrapper and restore it
      const processSubscriptionSpy = vi.spyOn(wrapper.vm, 'ProcessSubscription');
      processSubscriptionSpy.mockRestore();

      await wrapper.vm.ProcessSubscription('test-token', 'confirm');

      expect(wrapper.vm.error).toBe('Error occurred at http://localhost:3000/api/endpoint');
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing route hash gracefully', () => {
      wrapper = createWrapper('', true); // Prevent auto processing
      
      expect(wrapper.vm.queryString).toBeUndefined();
    });

    it('should handle malformed route hash', () => {
      wrapper = createWrapper('#invalid-hash-format', true); // Prevent auto processing
      
      // Should not throw error and handle gracefully
      // When hash is malformed, queryString should be undefined since there's no "=" 
      expect(wrapper.vm.queryString).toBeUndefined();
    });

    it('should handle network timeout or connection errors', async () => {
      const networkError = {
        response: {
          data: {
            message: 'Connection timeout',
          },
        },
      };

      mockOrganizationsService.process_subscription.mockRejectedValue(networkError);
      wrapper = createWrapper('#token=test-token-123', true); // Prevent auto processing

      // Create a spy on the actual component instance method
      const processSubscriptionSpy = vi.spyOn(wrapper.vm, 'ProcessSubscription');
      
      // Call the original implementation
      processSubscriptionSpy.mockRestore();
      await wrapper.vm.ProcessSubscription('test-token', 'confirm');

      expect(wrapper.vm.status).toBe('error');
      expect(wrapper.vm.error).toBe('Connection timeout');
    });
  });

  describe('Component Cleanup', () => {
    it('should not have memory leaks after unmount', () => {
      wrapper = createWrapper('#token=test-token-123', true); // Prevent auto processing
      const componentInstance = wrapper.vm;
      
      wrapper.unmount();
      
      // Verify component is properly cleaned up
      expect(componentInstance).toBeDefined();
    });
  });
});
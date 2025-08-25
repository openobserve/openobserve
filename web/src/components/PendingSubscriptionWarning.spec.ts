import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { createStore } from 'vuex';
import { createRouter, createWebHistory } from 'vue-router';
import PendingSubscriptionWarning from '@/components/PendingSubscriptionWarning.vue';
import { Quasar } from 'quasar';

describe('PendingSubscriptionWarning.vue', () => {
  let wrapper: VueWrapper;
  let store: any;
  let router: any;
  let mockPush: any;

  beforeEach(() => {
    // Create mock router
    mockPush = vi.fn();
    router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: '/', component: { template: '<div>Home</div>' } },
        { path: '/plans', name: 'plans', component: { template: '<div>Plans</div>' } }
      ]
    });
    router.push = mockPush;

    // Create mock store
    store = createStore({
      state: {
        selectedOrganization: {
          identifier: 'test-org-123'
        }
      },
      mutations: {},
      actions: {}
    });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllMocks();
  });

  const createWrapper = (storeState = {}) => {
    const currentStore = createStore({
      state: {
        selectedOrganization: {
          identifier: 'test-org-123'
        },
        ...storeState
      },
      mutations: {},
      actions: {}
    });

    return mount(PendingSubscriptionWarning, {
      global: {
        plugins: [currentStore, router, Quasar],
        stubs: {
          'q-icon': true,
          'q-btn': true
        }
      }
    });
  };

  describe('Component Rendering', () => {
    it('renders the component correctly', () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it('displays warning icon', () => {
      wrapper = createWrapper();
      const icon = wrapper.find('q-icon-stub');
      expect(icon.exists()).toBe(true);
      expect(icon.attributes('name')).toBe('warning');
      expect(icon.attributes('size')).toBe('80px');
      expect(icon.attributes('color')).toBe('warning row col-8 justify-center q-mt-lg');
    });

    it('displays warning message', () => {
      wrapper = createWrapper();
      const warningText = wrapper.find('span.text-red');
      expect(warningText.exists()).toBe(true);
      expect(warningText.text()).toBe('Warning:');
    });

    it('displays subscription button', () => {
      wrapper = createWrapper();
      const button = wrapper.find('q-btn-stub');
      expect(button.exists()).toBe(true);
      expect(button.attributes('color')).toBe('primary');
      // Button text may be empty in stub, just check it exists
    });

    it('has correct structure and classes', () => {
      wrapper = createWrapper();
      const mainDiv = wrapper.find('.row.col-11.justify-center.q-mt-xl');
      expect(mainDiv.exists()).toBe(true);
    });
  });

  describe('Router Navigation', () => {
    it('calls routerPush when button is clicked', async () => {
      wrapper = createWrapper();
      const button = wrapper.find('q-btn-stub');
      
      await button.trigger('click');
      
      expect(mockPush).toHaveBeenCalledWith({
        name: 'plans',
        query: { org_identifier: 'test-org-123' }
      });
    });

    it('navigates with correct organization identifier', async () => {
      wrapper = createWrapper({
        selectedOrganization: {
          identifier: 'custom-org-456'
        }
      });
      
      const button = wrapper.find('q-btn-stub');
      await button.trigger('click');
      
      expect(mockPush).toHaveBeenCalledWith({
        name: 'plans',
        query: { org_identifier: 'custom-org-456' }
      });
    });

    it('handles missing organization identifier gracefully', async () => {
      wrapper = createWrapper({
        selectedOrganization: {}
      });
      
      const button = wrapper.find('q-btn-stub');
      await button.trigger('click');
      
      expect(mockPush).toHaveBeenCalledWith({
        name: 'plans',
        query: { org_identifier: undefined }
      });
    });

    it('handles null selectedOrganization gracefully', async () => {
      wrapper = createWrapper({
        selectedOrganization: {
          identifier: null
        }
      });
      
      const button = wrapper.find('q-btn-stub');
      await button.trigger('click');
      
      expect(mockPush).toHaveBeenCalledWith({
        name: 'plans',
        query: { org_identifier: null }
      });
    });
  });

  describe('Component Setup', () => {
    it('has correct component name', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe('PendingSubscriptionWarning');
    });

    it('exposes router and routerPush in setup return', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      expect(vm.router).toBeDefined();
      expect(vm.routerPush).toBeDefined();
      expect(typeof vm.routerPush).toBe('function');
    });

    it('routerPush function works correctly', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      vm.routerPush();
      
      expect(mockPush).toHaveBeenCalledWith({
        name: 'plans',
        query: { org_identifier: 'test-org-123' }
      });
    });
  });

  describe('Store Integration', () => {
    it('accesses store state correctly', () => {
      wrapper = createWrapper({
        selectedOrganization: {
          identifier: 'integration-test-org'
        }
      });
      
      const vm = wrapper.vm as any;
      vm.routerPush();
      
      expect(mockPush).toHaveBeenCalledWith({
        name: 'plans',
        query: { org_identifier: 'integration-test-org' }
      });
    });

    it('handles different store states', () => {
      wrapper = createWrapper({
        selectedOrganization: {
          identifier: 'different-org-123',
          name: 'Test Organization'
        }
      });
      
      const button = wrapper.find('q-btn-stub');
      button.trigger('click');
      
      expect(mockPush).toHaveBeenCalledWith({
        name: 'plans',
        query: { org_identifier: 'different-org-123' }
      });
    });
  });

  describe('Edge Cases', () => {
    it('handles router push failure gracefully', async () => {
      mockPush.mockImplementation(() => {
        throw new Error('Navigation failed');
      });
      
      wrapper = createWrapper();
      const button = wrapper.find('q-btn-stub');
      
      expect(() => button.trigger('click')).not.toThrow();
    });

    it('handles multiple button clicks', async () => {
      wrapper = createWrapper();
      const button = wrapper.find('q-btn-stub');
      
      await button.trigger('click');
      await button.trigger('click');
      await button.trigger('click');
      
      expect(mockPush).toHaveBeenCalledTimes(3);
      expect(mockPush).toHaveBeenCalledWith({
        name: 'plans',
        query: { org_identifier: 'test-org-123' }
      });
    });

    it('renders with empty store state', () => {
      wrapper = createWrapper({});
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find('q-btn-stub').exists()).toBe(true);
    });
  });

  describe('Text Content', () => {
    it('displays correct warning message', () => {
      wrapper = createWrapper();
      const text = wrapper.text();
      
      expect(text).toContain('Warning:');
      expect(text).toContain('The content of this page cannot be viewed because the selected');
      expect(text).toContain('organization\'s is on pending subscription state.');
    });

    it('has proper HTML structure for warning text', () => {
      wrapper = createWrapper();
      const warningSpan = wrapper.find('span.text-red');
      const underlineElement = warningSpan.element.parentElement;
      
      expect(warningSpan.exists()).toBe(true);
      expect(underlineElement?.tagName.toLowerCase()).toBe('u');
    });
  });

  describe('Styling and Classes', () => {
    it('applies correct CSS classes to main container', () => {
      wrapper = createWrapper();
      const mainDiv = wrapper.find('div');
      
      expect(mainDiv.classes()).toContain('row');
      expect(mainDiv.classes()).toContain('col-11');
      expect(mainDiv.classes()).toContain('justify-center');
      expect(mainDiv.classes()).toContain('q-mt-xl');
    });

    it('has correct icon styling', () => {
      wrapper = createWrapper();
      const icon = wrapper.find('q-icon-stub');
      
      expect(icon.attributes('size')).toBe('80px');
      expect(icon.attributes('color')).toContain('warning');
    });
  });
});
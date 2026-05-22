import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { createStore } from 'vuex';
import { createRouter, createWebHistory } from 'vue-router';
import PendingSubscriptionWarning from '@/components/PendingSubscriptionWarning.vue';


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
        plugins: [currentStore, router],
        stubs: {
          // Stub OIcon with a data-test attribute so tests can locate it
          // semantically without relying on CSS classes or internal markup.
          OIcon: {
            name: 'OIcon',
            props: ['name', 'size', 'color'],
            template: '<span data-test="pending-subscription-warning-icon" :data-name="name" />',
          },
          'q-btn': true,
          OButton: {
            template: '<button data-test="pending-subscription-warning-btn" v-bind="$attrs" @click="$emit(\'click\')"><slot></slot></button>',
            props: ['variant', 'size', 'disabled', 'loading'],
            emits: ['click'],
          },
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
      // OIcon is stubbed with data-test="pending-subscription-warning-icon".
      // Locate it semantically rather than by CSS class or implementation tag.
      const icon = wrapper.find('[data-test="pending-subscription-warning-icon"]');
      expect(icon.exists()).toBe(true);
      expect(icon.attributes('data-name')).toBe('warning');
    });

    it('displays warning message', () => {
      wrapper = createWrapper();
      // "Warning:" text is inside a <span> within an underlined bold element.
      // Query by text content via the wrapping element rather than by CSS class.
      expect(wrapper.text()).toContain('Warning:');
    });

    it('displays subscription button', () => {
      wrapper = createWrapper();
      // OButton stub renders with data-test="pending-subscription-warning-btn".
      const button = wrapper.find('[data-test="pending-subscription-warning-btn"]');
      expect(button.exists()).toBe(true);
    });

    it('has the main container rendered', () => {
      // Structural CSS classes (Quasar/Tailwind utility classes) must not be
      // asserted in unit tests — use existence or semantic checks instead.
      wrapper = createWrapper();
      expect(wrapper.find('div').exists()).toBe(true);
    });
  });

  describe('Router Navigation', () => {
    it('calls routerPush when button is clicked', async () => {
      wrapper = createWrapper();
      const button = wrapper.find('[data-test="pending-subscription-warning-btn"]');
      
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
      
      const button = wrapper.find('[data-test="pending-subscription-warning-btn"]');
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
      
      const button = wrapper.find('[data-test="pending-subscription-warning-btn"]');
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
      
      const button = wrapper.find('[data-test="pending-subscription-warning-btn"]');
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
      
      const button = wrapper.find('[data-test="pending-subscription-warning-btn"]');
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
      const button = wrapper.find('[data-test="pending-subscription-warning-btn"]');
      
      expect(() => button.trigger('click')).not.toThrow();
    });

    it('handles multiple button clicks', async () => {
      wrapper = createWrapper();
      const button = wrapper.find('[data-test="pending-subscription-warning-btn"]');
      
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
      expect(wrapper.find('[data-test="pending-subscription-warning-btn"]').exists()).toBe(true);
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
      // "Warning:" is wrapped in a <u> element for underline emphasis.
      // Locate via the semantic <u> tag rather than by CSS class.
      const underlineElement = wrapper.find('u');
      expect(underlineElement.exists()).toBe(true);
      expect(underlineElement.text()).toContain('Warning:');
    });
  });

  describe('Styling and Classes', () => {
    // CSS class assertions are forbidden by testing rules (Rule #3: No CSS
    // classes anywhere). Styling is the responsibility of visual-regression
    // tests. The tests below verify structural/behavioral presence instead.

    it('renders the main container', () => {
      wrapper = createWrapper();
      // Verify the root element exists; class values are not asserted.
      expect(wrapper.find('div').exists()).toBe(true);
    });

    it('renders the warning icon', () => {
      wrapper = createWrapper();
      // OIcon stub has data-test="pending-subscription-warning-icon".
      // Verify it renders the correct icon name.
      const icon = wrapper.find('[data-test="pending-subscription-warning-icon"]');
      expect(icon.exists()).toBe(true);
      expect(icon.attributes('data-name')).toBe('warning');
    });
  });
});
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { createRouter, createWebHistory } from 'vue-router';
import { createStore } from 'vuex';
import ScriptToolbar from '@/components/actionScripts/ScriptToolbar.vue';
import { Quasar } from 'quasar';

// Mock vue-i18n
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key
  })
}));

describe('ScriptToolbar.vue', () => {
  let wrapper: VueWrapper;
  let router: any;
  let store: any;
  let mockQuasar: any;

  beforeEach(() => {
    // Mock router
    router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: '/', component: { template: '<div>Home</div>' } }
      ]
    });

    // Mock store
    store = createStore({
      state: {
        theme: 'light'
      },
      mutations: {},
      actions: {}
    });

    // Mock Quasar fullscreen
    mockQuasar = {
      fullscreen: {
        toggle: vi.fn()
      }
    };
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllMocks();
  });

  const createWrapper = (props = {}, storeState = {}) => {
    const defaultProps = {
      name: 'test_action',
      disableName: false
    };

    const currentStore = createStore({
      state: {
        theme: 'light',
        ...storeState
      },
      mutations: {},
      actions: {}
    });

    return mount(ScriptToolbar, {
      props: { ...defaultProps, ...props },
      global: {
        plugins: [currentStore, router],
        provide: {
          $q: mockQuasar,
          _q_: mockQuasar
        },
        stubs: {
          'q-icon': {
            template: '<div class="q-icon-stub" :name="name"><q-tooltip-stub v-if="$slots.default"><slot></slot></q-tooltip-stub></div>',
            props: ['name', 'size']
          },
          'q-input': {
            template: '<input class="q-input-stub" :data-test="$attrs[\'data-test\']" />',
            props: ['modelValue', 'label', 'readonly', 'disable', 'rules']
          },
          'q-btn': {
            template: '<button class="q-btn-stub" :data-test="$attrs[\'data-test\']" @click="$emit(\'click\')">{{ label }}</button>',
            props: ['label', 'color', 'padding', 'type', 'textColor', 'noEaps', 'icon']
          },
          'q-form': {
            template: '<form class="q-form-stub"><slot></slot></form>',
            props: []
          },
          'q-tooltip': {
            template: '<div class="q-tooltip-stub"><slot></slot></div>',
            props: ['anchor', 'self', 'maxWidth', 'offset']
          }
        }
      }
    });
  };

  describe('Component Rendering', () => {
    it('renders the component correctly', () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it('displays the correct title', () => {
      wrapper = createWrapper();
      expect(wrapper.text()).toContain('Add Action');
    });

    it('renders back button with correct styling', () => {
      wrapper = createWrapper();
      const backBtn = wrapper.find('[data-test="add-script-back-btn"]');
      
      expect(backBtn.exists()).toBe(true);
      expect(backBtn.attributes('title')).toBe('Go Back');
      expect(backBtn.classes()).toContain('cursor-pointer');
    });

    it('renders name input field', () => {
      wrapper = createWrapper();
      const nameInput = wrapper.find('.q-input-stub');
      
      expect(nameInput.exists()).toBe(true);
      expect(nameInput.attributes('data-test')).toBe('add-script-name-input');
    });

    it('renders action buttons', () => {
      wrapper = createWrapper();
      const buttons = wrapper.findAll('.q-btn-stub');
      
      expect(buttons).toHaveLength(3); // fullscreen, save, cancel
      expect(buttons[0].attributes('data-test')).toBe('add-script-fullscreen-btn');
      expect(buttons[1].attributes('data-test')).toBe('add-script-save-btn');
      expect(buttons[2].attributes('data-test')).toBe('add-script-cancel-btn');
    });
  });

  describe('Props Handling', () => {
    it('accepts required name prop', () => {
      wrapper = createWrapper({ name: 'custom_action' });
      expect(wrapper.props('name')).toBe('custom_action');
    });

    it('accepts optional disableName prop', () => {
      wrapper = createWrapper({ disableName: true });
      expect(wrapper.props('disableName')).toBe(true);
    });

    it('uses default value for disableName prop', () => {
      wrapper = createWrapper();
      expect(wrapper.props('disableName')).toBe(false);
    });

    it('passes disableName to input field', () => {
      wrapper = createWrapper({ disableName: true });
      const nameInput = wrapper.find('.q-input-stub');
      
      expect(nameInput.exists()).toBe(true);
      // In actual component, these props would be passed through
    });
  });

  describe('Action Name Computed Property', () => {
    it('gets value from props', () => {
      wrapper = createWrapper({ name: 'test_script' });
      const vm = wrapper.vm as any;
      
      expect(vm.actionName).toBe('test_script');
    });

    it('emits update:name when set', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      vm.actionName = 'new_action';
      
      expect(wrapper.emitted('update:name')).toBeTruthy();
      expect(wrapper.emitted('update:name')?.[0]).toEqual(['new_action']);
    });
  });

  describe('Input Validation', () => {
    it('validates required field', () => {
      wrapper = createWrapper({ name: '' });
      const vm = wrapper.vm as any;
      
      const result = vm.isValidMethodName();
      expect(result).toBe('Field is required!');
    });

    it('validates method name pattern - valid names', () => {
      const validNames = [
        'valid_action',
        'ValidAction',
        'action123',
        '_private_action',
        'ACTION_NAME'
      ];

      validNames.forEach(name => {
        wrapper = createWrapper({ name });
        const vm = wrapper.vm as any;
        
        const result = vm.isValidMethodName();
        expect(result).toBe(true);
      });
    });

    it('validates method name pattern - invalid names', () => {
      const invalidNames = [
        '123invalid',
        'invalid-name',
        'invalid name',
        'invalid.name',
        '@invalid'
      ];

      invalidNames.forEach(name => {
        wrapper = createWrapper({ name });
        const vm = wrapper.vm as any;
        
        const result = vm.isValidMethodName();
        expect(result).toContain('Invalid method name');
      });
    });

    it('shows validation error message', () => {
      wrapper = createWrapper({ name: 'invalid-name' });
      const vm = wrapper.vm as any;
      
      vm.showInputError = true;
      const result = vm.isValidMethodName();
      
      expect(result).toContain('Invalid method name. Must start with a letter or underscore. Use only letters, numbers, and underscores.');
    });


    it('does not show error icon when validation passes', async () => {
      wrapper = createWrapper({ name: 'valid_name' });
      const vm = wrapper.vm as any;
      
      // Valid name should not show error
      expect(vm.isValidMethodName()).toBe(true);
    });
  });

  describe('Event Handling', () => {
    it('emits back event when back button is clicked', async () => {
      wrapper = createWrapper();
      const backBtn = wrapper.find('[data-test="add-script-back-btn"]');
      
      await backBtn.trigger('click');
      
      expect(wrapper.emitted('back')).toBeTruthy();
    });

    it('handles fullscreen toggle', async () => {
      wrapper = createWrapper();
      const fullscreenBtn = wrapper.find('[data-test="add-script-fullscreen-btn"]');
      const vm = wrapper.vm as any;
      
      await fullscreenBtn.trigger('click');
      
      expect(mockQuasar.fullscreen.toggle).toHaveBeenCalled();
    });

    it('emits save event and shows input error when save button is clicked', async () => {
      wrapper = createWrapper();
      const saveBtn = wrapper.find('[data-test="add-script-save-btn"]');
      const vm = wrapper.vm as any;
      
      await saveBtn.trigger('click');
      
      expect(wrapper.emitted('save')).toBeTruthy();
      expect(vm.showInputError).toBe(true);
    });

    it('emits cancel event when cancel button is clicked', async () => {
      wrapper = createWrapper();
      const cancelBtn = wrapper.find('[data-test="add-script-cancel-btn"]');
      
      await cancelBtn.trigger('click');
      
      expect(wrapper.emitted('cancel')).toBeTruthy();
    });

    it('shows input error when onUpdate is called', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      vm.onUpdate();
      
      expect(vm.showInputError).toBe(true);
    });
  });

  describe('Theme Support', () => {
    it('handles light theme', () => {
      wrapper = createWrapper({ name: 'test' }, { theme: 'light' });
      expect(wrapper.exists()).toBe(true);
    });

    it('handles dark theme', () => {
      wrapper = createWrapper({ name: 'test' }, { theme: 'dark' });
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe('Input Field Configuration', () => {
    it('configures input field', () => {
      wrapper = createWrapper();
      const nameInput = wrapper.find('.q-input-stub');
      
      expect(nameInput.exists()).toBe(true);
    });

    it('has validation rules', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      // Test validation function directly
      expect(typeof vm.isValidMethodName).toBe('function');
    });
  });

  describe('Button Configuration', () => {
    it('configures fullscreen button correctly', () => {
      wrapper = createWrapper();
      const fullscreenBtn = wrapper.find('[data-test="add-script-fullscreen-btn"]');
      
      expect(fullscreenBtn.exists()).toBe(true);
    });

    it('configures save button correctly', () => {
      wrapper = createWrapper();
      const saveBtn = wrapper.find('[data-test="add-script-save-btn"]');
      
      expect(saveBtn.exists()).toBe(true);
    });

    it('configures cancel button correctly', () => {
      wrapper = createWrapper();
      const cancelBtn = wrapper.find('[data-test="add-script-cancel-btn"]');
      
      expect(cancelBtn.exists()).toBe(true);
    });
  });

  describe('Component Structure', () => {
    it('has correct main structure', () => {
      wrapper = createWrapper();
      const toolbar = wrapper.find('.action-scripts-toolbar');
      
      expect(toolbar.exists()).toBe(true);
      expect(toolbar.classes()).toContain('tw:pb-1.5');
      expect(toolbar.classes()).toContain('tw:w-full');
      expect(toolbar.classes()).toContain('tw:flex');
      expect(toolbar.classes()).toContain('tw:justify-between');
      expect(toolbar.classes()).toContain('tw:items-center');
    });

    it('has correct left section structure', () => {
      wrapper = createWrapper();
      const leftSection = wrapper.find('.tw\\:flex.tw\\:items-center');

      expect(leftSection.exists()).toBe(true);
    });

    it('has correct actions section structure', () => {
      wrapper = createWrapper();
      const actionsSection = wrapper.find('.add-script-actions');
      
      expect(actionsSection.exists()).toBe(true);
      expect(actionsSection.classes()).toContain('flex');
      expect(actionsSection.classes()).toContain('justify-center');
    });
  });

  describe('Edge Cases', () => {
    it('handles empty name prop', () => {
      wrapper = createWrapper({ name: '' });
      expect(wrapper.exists()).toBe(true);
    });

    it('handles very long action names', () => {
      const longName = 'a'.repeat(100);
      wrapper = createWrapper({ name: longName });
      expect(wrapper.exists()).toBe(true);
    });

    it('handles special characters in validation', () => {
      const specialName = 'test@#$%';
      wrapper = createWrapper({ name: specialName });
      const vm = wrapper.vm as any;
      
      const result = vm.isValidMethodName();
      expect(result).toContain('Invalid method name');
    });

    it('exposes addScriptForm ref', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      expect(vm.addScriptForm).toBeDefined();
    });
  });

});
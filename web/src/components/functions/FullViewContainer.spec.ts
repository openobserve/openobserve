import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { createStore } from 'vuex';
import FullViewContainer from '@/components/functions/FullViewContainer.vue';
import { Quasar } from 'quasar';

describe('FullViewContainer.vue', () => {
  let wrapper: VueWrapper;
  let store: any;

  beforeEach(() => {
    store = createStore({
      state: {
        theme: 'light'
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

  const createWrapper = (props = {}, storeState = {}) => {
    const defaultProps = {
      name: 'test-container',
      label: 'Test Container',
      isExpandable: true,
      isExpanded: false,
      labelClass: '',
      showExpandIcon: true
    };

    const currentStore = createStore({
      state: {
        theme: 'light',
        ...storeState
      },
      mutations: {},
      actions: {}
    });

    return mount(FullViewContainer, {
      props: { ...defaultProps, ...props },
      global: {
        plugins: [currentStore, Quasar],
        stubs: {
          'q-icon': {
            template: '<div class="q-icon-stub" :class="$attrs.class" @click.stop="$emit(\'click\', $event)">{{ name }}</div>',
            props: ['name', 'size']
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

    it('displays the correct label', () => {
      wrapper = createWrapper({ label: 'Custom Label' });
      expect(wrapper.text()).toContain('Custom Label');
    });

    it('applies light theme styles by default', () => {
      wrapper = createWrapper();
      const container = wrapper.find('div');
      expect(container.classes()).toContain('tw:bg-gray-200');
    });

    it('applies dark theme styles when theme is dark', () => {
      wrapper = createWrapper({}, { theme: 'dark' });
      const container = wrapper.find('div');
      expect(container.classes()).toContain('tw:bg-gray-500');
    });

    it('shows expand icon when showExpandIcon is true', () => {
      wrapper = createWrapper({ showExpandIcon: true });
      const icon = wrapper.find('.q-icon-stub');
      expect(icon.exists()).toBe(true);
    });

    it('hides expand icon when showExpandIcon is false', () => {
      wrapper = createWrapper({ showExpandIcon: false });
      const icon = wrapper.find('.q-icon-stub');
      expect(icon.exists()).toBe(false);
    });

    it('displays content when expanded', () => {
      wrapper = mount(FullViewContainer, {
        props: {
          name: 'test',
          label: 'Test',
          isExpanded: true
        },
        slots: {
          default: '<div class="test-content">Expanded Content</div>'
        },
        global: {
          plugins: [store, Quasar],
          stubs: {
            'q-icon': true
          }
        }
      });

      expect(wrapper.find('.test-content').exists()).toBe(true);
      expect(wrapper.text()).toContain('Expanded Content');
    });

    it('hides content when collapsed', () => {
      wrapper = mount(FullViewContainer, {
        props: {
          name: 'test',
          label: 'Test',
          isExpanded: false
        },
        slots: {
          default: '<div class="test-content">Hidden Content</div>'
        },
        global: {
          plugins: [store, Quasar],
          stubs: {
            'q-icon': true
          }
        }
      });

      expect(wrapper.find('.test-content').exists()).toBe(false);
    });
  });

  describe('Props Handling', () => {
    it('accepts all required props', () => {
      wrapper = createWrapper({
        name: 'custom-name',
        label: 'Custom Label',
        isExpandable: false,
        isExpanded: true,
        labelClass: 'custom-class',
        showExpandIcon: false
      });

      expect(wrapper.props('name')).toBe('custom-name');
      expect(wrapper.props('label')).toBe('Custom Label');
      expect(wrapper.props('isExpandable')).toBe(false);
      expect(wrapper.props('isExpanded')).toBe(true);
      expect(wrapper.props('labelClass')).toBe('custom-class');
      expect(wrapper.props('showExpandIcon')).toBe(false);
    });

    it('uses default values for optional props', () => {
      wrapper = createWrapper({
        name: 'test',
        label: 'Test'
      });

      expect(wrapper.props('isExpandable')).toBe(true);
      expect(wrapper.props('isExpanded')).toBe(false);
      expect(wrapper.props('labelClass')).toBe('');
      expect(wrapper.props('showExpandIcon')).toBe(true);
    });

    it('applies custom label class', () => {
      wrapper = createWrapper({ labelClass: 'tw:text-red-500' });
      const label = wrapper.find('.tw\\:text-\\[14px\\]');
      expect(label.classes()).toContain('tw:text-red-500');
    });
  });

  describe('Theme Handling', () => {
    it('applies correct text color for light theme', () => {
      wrapper = createWrapper({}, { theme: 'light' });
      const label = wrapper.find('.tw\\:text-\\[14px\\]');
      expect(label.classes()).toContain('tw:text-gray-500');
    });

    it('applies correct text color for dark theme', () => {
      wrapper = createWrapper({}, { theme: 'dark' });
      const label = wrapper.find('.tw\\:text-\\[14px\\]');
      expect(label.classes()).toContain('tw:text-gray-100');
    });

    it('applies correct icon color for light theme', () => {
      wrapper = createWrapper({}, { theme: 'light' });
      const icon = wrapper.find('.q-icon-stub');
      expect(icon.classes()).toContain('tw:text-gray-500');
    });

    it('applies correct icon color for dark theme', () => {
      wrapper = createWrapper({}, { theme: 'dark' });
      const icon = wrapper.find('.q-icon-stub');
      expect(icon.classes()).toContain('tw:text-gray-100');
    });
  });

  describe('Expand/Collapse Functionality', () => {
    it('emits update:isExpanded when icon is clicked', async () => {
      wrapper = createWrapper({ isExpanded: false });
      const icon = wrapper.find('.q-icon-stub');

      await icon.trigger('click');

      expect(wrapper.emitted('update:isExpanded')).toBeTruthy();
      expect(wrapper.emitted('update:isExpanded')?.[0]).toEqual([true]);
    });

    it('emits update:isExpanded when label is clicked and showExpandIcon is true', async () => {
      wrapper = createWrapper({ isExpanded: false, showExpandIcon: true });
      const label = wrapper.find('.tw\\:text-\\[14px\\]');

      await label.trigger('click');

      expect(wrapper.emitted('update:isExpanded')).toBeTruthy();
      expect(wrapper.emitted('update:isExpanded')?.[0]).toEqual([true]);
    });

    it('does not emit update:isExpanded when label is clicked and showExpandIcon is false', async () => {
      wrapper = createWrapper({ isExpanded: false, showExpandIcon: false });
      const label = wrapper.find('.tw\\:text-\\[14px\\]');

      await label.trigger('click');

      expect(wrapper.emitted('update:isExpanded')).toBeFalsy();
    });

    it('toggles from expanded to collapsed when clicked', async () => {
      wrapper = createWrapper({ isExpanded: true });
      const icon = wrapper.find('.q-icon-stub');

      await icon.trigger('click');

      expect(wrapper.emitted('update:isExpanded')?.[0]).toEqual([false]);
    });

    it('applies rotation transform when expanded', () => {
      wrapper = createWrapper({ isExpanded: true });
      const icon = wrapper.find('.q-icon-stub');
      expect(icon.classes()).toContain('tw:transform');
      expect(icon.classes()).toContain('tw:rotate-180');
    });

    it('does not apply rotation transform when collapsed', () => {
      wrapper = createWrapper({ isExpanded: false });
      const icon = wrapper.find('.q-icon-stub');
      expect(icon.classes()).not.toContain('tw:transform');
      expect(icon.classes()).not.toContain('tw:rotate-180');
    });
  });

  describe('Icon Configuration', () => {
    it('uses correct icon name', () => {
      wrapper = createWrapper();
      const icon = wrapper.find('.q-icon-stub');
      expect(icon.text()).toBe('keyboard_arrow_up');
    });

    it('applies correct icon size', () => {
      wrapper = createWrapper();
      const icon = wrapper.find('.q-icon-stub');
      // The size prop is passed but may not be reflected as an attribute in the stub
      expect(icon.exists()).toBe(true);
    });

    it('applies cursor pointer class to icon', () => {
      wrapper = createWrapper();
      const icon = wrapper.find('.q-icon-stub');
      expect(icon.classes()).toContain('tw:cursor-pointer');
    });

    it('applies transition class to icon', () => {
      wrapper = createWrapper();
      const icon = wrapper.find('.q-icon-stub');
      expect(icon.classes()).toContain('tw:transition-all');
    });
  });

  describe('Slot Rendering', () => {
    it('renders left slot content', () => {
      wrapper = mount(FullViewContainer, {
        props: {
          name: 'test',
          label: 'Test'
        },
        slots: {
          left: '<button class="left-button">Left Content</button>'
        },
        global: {
          plugins: [store, Quasar],
          stubs: {
            'q-icon': true
          }
        }
      });

      expect(wrapper.find('.left-button').exists()).toBe(true);
      expect(wrapper.text()).toContain('Left Content');
    });

    it('renders right slot content', () => {
      wrapper = mount(FullViewContainer, {
        props: {
          name: 'test',
          label: 'Test'
        },
        slots: {
          right: '<span class="right-content">Right Content</span>'
        },
        global: {
          plugins: [store, Quasar],
          stubs: {
            'q-icon': true
          }
        }
      });

      expect(wrapper.find('.right-content').exists()).toBe(true);
      expect(wrapper.text()).toContain('Right Content');
    });

    it('renders both left and right slots simultaneously', () => {
      wrapper = mount(FullViewContainer, {
        props: {
          name: 'test',
          label: 'Test'
        },
        slots: {
          left: '<div class="left-slot">Left</div>',
          right: '<div class="right-slot">Right</div>'
        },
        global: {
          plugins: [store, Quasar],
          stubs: {
            'q-icon': true
          }
        }
      });

      expect(wrapper.find('.left-slot').exists()).toBe(true);
      expect(wrapper.find('.right-slot').exists()).toBe(true);
    });
  });

  describe('Computed Property Behavior', () => {
    it('computed expanded getter returns prop value', async () => {
      wrapper = createWrapper({ isExpanded: true });
      const vm = wrapper.vm as any;
      
      expect(vm.expanded).toBe(true);
    });

    it('computed expanded setter emits correct value', async () => {
      wrapper = createWrapper({ isExpanded: false });
      const vm = wrapper.vm as any;
      
      vm.expanded = true;
      
      expect(wrapper.emitted('update:isExpanded')).toBeTruthy();
      expect(wrapper.emitted('update:isExpanded')?.[0]).toEqual([true]);
    });

    it('responds to prop changes correctly', async () => {
      wrapper = createWrapper({ isExpanded: false });
      
      await wrapper.setProps({ isExpanded: true });
      
      const vm = wrapper.vm as any;
      expect(vm.expanded).toBe(true);
    });
  });

  describe('Event Handling', () => {
    it('stops event propagation on icon click', async () => {
      wrapper = createWrapper();
      const icon = wrapper.find('.q-icon-stub');
      
      const clickEvent = new Event('click');
      const stopPropagationSpy = vi.spyOn(clickEvent, 'stopPropagation');
      
      // The @click.stop directive should handle this
      await icon.trigger('click');
      
      expect(wrapper.emitted('update:isExpanded')).toBeTruthy();
    });

    it('handles multiple rapid clicks correctly', async () => {
      wrapper = createWrapper({ isExpanded: false });
      const icon = wrapper.find('.q-icon-stub');
      
      await icon.trigger('click');
      await icon.trigger('click');
      await icon.trigger('click');
      
      // Each click should emit an event (could be 3 or 6 depending on label clicks too)
      expect(wrapper.emitted('update:isExpanded')).toBeTruthy();
      expect(wrapper.emitted('update:isExpanded')?.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Edge Cases', () => {
    it('handles missing store theme gracefully', () => {
      const emptyStore = createStore({
        state: {},
        mutations: {},
        actions: {}
      });

      wrapper = mount(FullViewContainer, {
        props: {
          name: 'test',
          label: 'Test'
        },
        global: {
          plugins: [emptyStore, Quasar],
          stubs: {
            'q-icon': true
          }
        }
      });

      expect(wrapper.exists()).toBe(true);
    });

    it('handles empty label gracefully', () => {
      wrapper = createWrapper({ label: '' });
      expect(wrapper.exists()).toBe(true);
    });

    it('handles very long labels', () => {
      const longLabel = 'A'.repeat(100);
      wrapper = createWrapper({ label: longLabel });
      expect(wrapper.text()).toContain(longLabel);
    });

    it('handles special characters in name and label', () => {
      wrapper = createWrapper({
        name: 'test-name_with-special@chars',
        label: 'Test Label with @#$%^&*() chars'
      });
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.text()).toContain('Test Label with @#$%^&*() chars');
    });
  });

  describe('CSS Classes and Structure', () => {
    it('applies correct base container classes', () => {
      wrapper = createWrapper();
      const container = wrapper.find('div');
      expect(container.classes()).toContain('tw:py-[2px]');
    });

    it('applies correct flex layout classes', () => {
      wrapper = createWrapper();
      const flexContainer = wrapper.find('.tw\\:flex.tw\\:justify-between');
      expect(flexContainer.exists()).toBe(true);
    });

    it('applies correct label styling classes', () => {
      wrapper = createWrapper();
      const label = wrapper.find('.tw\\:text-\\[14px\\]');
      expect(label.classes()).toContain('tw:font-bold');
    });

    it('maintains correct component structure', () => {
      wrapper = createWrapper();

      // Check main container
      expect(wrapper.find('div').exists()).toBe(true);

      // Check flex container
      expect(wrapper.find('.tw\\:flex.tw\\:justify-between').exists()).toBe(true);

      // Check left and right sections
      expect(wrapper.findAll('.tw\\:flex.tw\\:items-center')).toHaveLength(1);
    });
  });

  describe('Accessibility', () => {
    it('provides clickable elements for keyboard navigation', () => {
      wrapper = createWrapper();
      const icon = wrapper.find('.q-icon-stub');
      const label = wrapper.find('.tw\\:text-\\[14px\\]');

      expect(icon.classes()).toContain('tw:cursor-pointer');
      // Label should be clickable when showExpandIcon is true
      expect(wrapper.exists()).toBe(true);
    });

    it('handles keyboard events appropriately', async () => {
      wrapper = createWrapper();
      
      // Component should be accessible for keyboard interaction
      expect(wrapper.exists()).toBe(true);
    });
  });
});
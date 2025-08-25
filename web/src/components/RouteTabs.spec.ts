import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import RouteTabs from '@/components/RouteTabs.vue';
import { Quasar } from 'quasar';

describe('RouteTabs.vue', () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  const mockTabs = [
    {
      name: 'tab1',
      to: '/tab1',
      label: 'Tab 1',
      class: 'tab-class-1',
      dataTest: 'tab-1-test'
    },
    {
      name: 'tab2',
      to: '/tab2',
      label: 'Tab 2',
      class: 'tab-class-2',
      dataTest: 'tab-2-test'
    },
    {
      name: 'tab3',
      to: '/tab3',
      label: 'Tab 3',
      class: 'tab-class-3',
      dataTest: 'tab-3-test'
    }
  ];

  const createWrapper = (props = {}) => {
    const defaultProps = {
      tabs: mockTabs,
      activeTab: 'tab1',
      dataTest: 'route-tabs-test',
      direction: 'vertical'
    };

    return mount(RouteTabs, {
      props: { ...defaultProps, ...props },
      global: {
        plugins: [Quasar],
        stubs: {
          'q-tabs': {
            template: '<div class="q-tabs-stub" :data-test="dataTest" :class="{ vertical: vertical }"><slot></slot></div>',
            props: ['dataTest', 'modelValue', 'vertical', 'indicatorColor', 'inlineLabel']
          },
          'q-route-tab': {
            template: '<div class="q-route-tab-stub" :data-test="dataTest">{{ label }}</div>',
            props: ['dataTest', 'name', 'to', 'label', 'contentClass']
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

    it('renders q-tabs component', () => {
      wrapper = createWrapper();
      const tabs = wrapper.find('.q-tabs-stub');
      expect(tabs.exists()).toBe(true);
    });

    it('passes correct props to q-tabs', () => {
      wrapper = createWrapper({ dataTest: 'custom-test' });
      const tabs = wrapper.find('.q-tabs-stub');
      
      expect(tabs.attributes('data-test')).toBe('custom-test');
    });

    it('renders all tab items', () => {
      wrapper = createWrapper();
      const routeTabs = wrapper.findAll('.q-route-tab-stub');
      
      expect(routeTabs.length).toBe(3);
    });

    it('displays tab labels correctly', () => {
      wrapper = createWrapper();
      const routeTabs = wrapper.findAll('.q-route-tab-stub');
      
      expect(routeTabs[0].text()).toBe('Tab 1');
      expect(routeTabs[1].text()).toBe('Tab 2');
      expect(routeTabs[2].text()).toBe('Tab 3');
    });
  });

  describe('Props Handling', () => {
    it('accepts required props', () => {
      const props = {
        tabs: mockTabs,
        activeTab: 'tab2',
        dataTest: 'test-tabs'
      };
      
      wrapper = createWrapper(props);
      
      expect(wrapper.props('tabs')).toEqual(mockTabs);
      expect(wrapper.props('activeTab')).toBe('tab2');
      expect(wrapper.props('dataTest')).toBe('test-tabs');
    });

    it('uses default direction when not provided', () => {
      wrapper = createWrapper({ direction: undefined });
      expect(wrapper.props('direction')).toBe('vertical');
    });

    it('accepts custom direction prop', () => {
      wrapper = createWrapper({ direction: 'horizontal' });
      expect(wrapper.props('direction')).toBe('horizontal');
    });

    it('handles empty tabs array', () => {
      wrapper = createWrapper({ tabs: [] });
      const routeTabs = wrapper.findAll('.q-route-tab-stub');
      
      expect(routeTabs.length).toBe(0);
    });

    it('passes tab properties to q-route-tab', () => {
      wrapper = createWrapper();
      const firstTab = wrapper.find('.q-route-tab-stub');
      
      expect(firstTab.attributes('data-test')).toBe('tab-1-test');
    });
  });

  describe('Active Tab Management', () => {
    it('initializes with correct active tab', () => {
      wrapper = createWrapper({ activeTab: 'tab2' });
      const vm = wrapper.vm as any;
      
      expect(vm.activeTab).toBe('tab2');
    });

    it('initializes with props but maintains internal state', async () => {
      wrapper = createWrapper({ activeTab: 'tab1' });
      const vm = wrapper.vm as any;
      
      expect(vm.activeTab).toBe('tab1');
      
      // Internal state doesn't automatically update with prop changes
      await wrapper.setProps({ activeTab: 'tab3' });
      expect(vm.activeTab).toBe('tab1'); // Still has initial value
    });

    it('exposes setActiveTab method', () => {
      wrapper = createWrapper();
      
      expect(typeof wrapper.vm.setActiveTab).toBe('function');
    });

    it('setActiveTab updates internal state', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      await vm.setActiveTab('tab3');
      
      expect(vm.activeTab).toBe('tab3');
    });
  });

  describe('Event Handling', () => {
    it('emits update:activeTab when handleTabChange is called', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      vm.handleTabChange('tab2');
      
      expect(wrapper.emitted('update:activeTab')).toBeTruthy();
      expect(wrapper.emitted('update:activeTab')?.[0]).toEqual(['tab2']);
    });

    it('updates internal state when handleTabChange is called', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      vm.handleTabChange('tab3');
      
      expect(vm.activeTab).toBe('tab3');
    });

    it('handles multiple tab changes', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      vm.handleTabChange('tab2');
      vm.handleTabChange('tab3');
      vm.handleTabChange('tab1');
      
      expect(wrapper.emitted('update:activeTab')).toHaveLength(3);
      expect(wrapper.emitted('update:activeTab')?.[2]).toEqual(['tab1']);
      expect(vm.activeTab).toBe('tab1');
    });
  });

  describe('Direction Handling', () => {
    it('applies vertical direction by default', () => {
      wrapper = createWrapper();
      const tabs = wrapper.find('.q-tabs-stub');
      
      // Check if vertical class or attribute is applied
      expect(wrapper.props('direction')).toBe('vertical');
    });

    it('handles horizontal direction', () => {
      wrapper = createWrapper({ direction: 'horizontal' });
      
      expect(wrapper.props('direction')).toBe('horizontal');
    });

    it('passes direction to q-tabs component', () => {
      wrapper = createWrapper({ direction: 'vertical' });
      const tabs = wrapper.find('.q-tabs-stub');
      
      expect(tabs.classes()).toContain('vertical');
    });
  });

  describe('Tab Configuration', () => {
    it('handles tabs with all properties', () => {
      const complexTabs = [
        {
          name: 'complex-tab',
          to: '/complex',
          label: 'Complex Tab',
          class: 'complex-class',
          dataTest: 'complex-test'
        }
      ];
      
      wrapper = createWrapper({ tabs: complexTabs });
      const tab = wrapper.find('.q-route-tab-stub');
      
      expect(tab.exists()).toBe(true);
      expect(tab.text()).toBe('Complex Tab');
      expect(tab.attributes('data-test')).toBe('complex-test');
    });

    it('handles tabs without optional properties', () => {
      const simpleTabs = [
        {
          name: 'simple-tab',
          to: '/simple',
          label: 'Simple Tab'
        }
      ];
      
      wrapper = createWrapper({ tabs: simpleTabs });
      const tab = wrapper.find('.q-route-tab-stub');
      
      expect(tab.exists()).toBe(true);
      expect(tab.text()).toBe('Simple Tab');
    });

    it('maintains tab order', () => {
      wrapper = createWrapper();
      const tabs = wrapper.findAll('.q-route-tab-stub');
      
      expect(tabs[0].text()).toBe('Tab 1');
      expect(tabs[1].text()).toBe('Tab 2');
      expect(tabs[2].text()).toBe('Tab 3');
    });
  });

  describe('Component Setup', () => {
    it('uses Vue 3 setup syntax', () => {
      wrapper = createWrapper();
      
      // Component should be properly mounted with setup
      expect(wrapper.vm).toBeTruthy();
    });

    it('defines props correctly', () => {
      wrapper = createWrapper();
      
      expect(wrapper.props()).toHaveProperty('tabs');
      expect(wrapper.props()).toHaveProperty('activeTab');
      expect(wrapper.props()).toHaveProperty('dataTest');
      expect(wrapper.props()).toHaveProperty('direction');
    });

    it('defines emits correctly', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      vm.handleTabChange('test');
      expect(wrapper.emitted()).toHaveProperty('update:activeTab');
    });

    it('exposes methods correctly', () => {
      wrapper = createWrapper();
      
      expect(wrapper.vm.setActiveTab).toBeDefined();
      expect(typeof wrapper.vm.setActiveTab).toBe('function');
    });
  });

  describe('Reactivity', () => {
    it('maintains independent internal state', async () => {
      wrapper = createWrapper({ activeTab: 'tab1' });
      const vm = wrapper.vm as any;
      
      // Initial state matches prop
      expect(vm.activeTab).toBe('tab1');
      
      // Internal state is independent after initialization
      await wrapper.setProps({ activeTab: 'tab2' });
      expect(vm.activeTab).toBe('tab1'); // Internal state unchanged
    });

    it('maintains internal state consistency', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      vm.handleTabChange('tab2');
      expect(vm.activeTab).toBe('tab2');
      
      await vm.setActiveTab('tab3');
      expect(vm.activeTab).toBe('tab3');
    });
  });

  describe('Edge Cases', () => {
    it('handles tabs with special characters in names', () => {
      const specialTabs = [
        {
          name: 'tab-with-dashes',
          to: '/tab-with-dashes',
          label: 'Tab With Dashes'
        },
        {
          name: 'tab_with_underscores',
          to: '/tab_with_underscores',
          label: 'Tab With Underscores'
        }
      ];
      
      wrapper = createWrapper({ tabs: specialTabs });
      const tabs = wrapper.findAll('.q-route-tab-stub');
      
      expect(tabs).toHaveLength(2);
      expect(tabs[0].text()).toBe('Tab With Dashes');
      expect(tabs[1].text()).toBe('Tab With Underscores');
    });

    it('handles empty activeTab string', () => {
      wrapper = createWrapper({ activeTab: '' });
      const vm = wrapper.vm as any;
      
      expect(vm.activeTab).toBe('');
    });

    it('handles tab change to non-existent tab', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      vm.handleTabChange('non-existent-tab');
      
      expect(vm.activeTab).toBe('non-existent-tab');
      expect(wrapper.emitted('update:activeTab')?.[0]).toEqual(['non-existent-tab']);
    });
  });

  describe('Component Lifecycle', () => {
    it('mounts without errors', () => {
      expect(() => {
        wrapper = createWrapper();
      }).not.toThrow();
    });

    it('unmounts cleanly', () => {
      wrapper = createWrapper();
      
      expect(() => {
        wrapper.unmount();
      }).not.toThrow();
    });

    it('initializes reactive state correctly', () => {
      wrapper = createWrapper({ activeTab: 'initial-tab' });
      const vm = wrapper.vm as any;
      
      expect(vm.activeTab).toBe('initial-tab');
    });
  });
});
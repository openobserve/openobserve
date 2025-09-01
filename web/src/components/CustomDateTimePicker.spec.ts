import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { createStore } from 'vuex';
import CustomDateTimePicker from '@/components/CustomDateTimePicker.vue';
import { Quasar } from 'quasar';

describe('CustomDateTimePicker.vue', () => {
  let wrapper: VueWrapper;
  let store: any;

  beforeEach(() => {
    // Create mock store
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
  });

  const createWrapper = (props = {}, storeState = {}) => {
    const currentStore = createStore({
      state: {
        theme: 'light',
        ...storeState
      },
      mutations: {},
      actions: {}
    });

    return mount(CustomDateTimePicker, {
      props,
      global: {
        plugins: [currentStore, Quasar],
        stubs: {
          'q-btn': true,
          'q-menu': true,
          'q-tab-panels': true,
          'q-tab-panel': true,
          'q-input': true,
          'q-select': true
        }
      }
    });
  };

  describe('Component Setup and Props', () => {
    it('renders with default props', () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it('accepts modelValue prop', () => {
      wrapper = createWrapper({ modelValue: '5m' });
      expect(wrapper.props('modelValue')).toBe('5m');
    });

    it('accepts isFirstEntry prop', () => {
      wrapper = createWrapper({ isFirstEntry: true });
      expect(wrapper.props('isFirstEntry')).toBe(true);
    });

    it('accepts changeStyle prop', () => {
      wrapper = createWrapper({ changeStyle: true });
      expect(wrapper.props('changeStyle')).toBe(true);
    });

    it('has correct default values for changeStyle', () => {
      wrapper = createWrapper();
      expect(wrapper.props('changeStyle')).toBe(false);
    });
  });

  describe('Model Value Handling', () => {
    it('parses modelValue correctly on initialization', () => {
      wrapper = createWrapper({ modelValue: '10m' });
      const vm = wrapper.vm as any;
      
      expect(vm.picker.data.selectedDate.relative.value).toBe(10);
      expect(vm.picker.data.selectedDate.relative.period).toBe('m');
    });

    it('handles different period formats', () => {
      wrapper = createWrapper({ modelValue: '2h' });
      const vm = wrapper.vm as any;
      
      expect(vm.picker.data.selectedDate.relative.value).toBe(2);
      expect(vm.picker.data.selectedDate.relative.period).toBe('h');
    });

    it('handles days format', () => {
      wrapper = createWrapper({ modelValue: '7d' });
      const vm = wrapper.vm as any;
      
      expect(vm.picker.data.selectedDate.relative.value).toBe(7);
      expect(vm.picker.data.selectedDate.relative.period).toBe('d');
    });

    it('handles weeks format', () => {
      wrapper = createWrapper({ modelValue: '2w' });
      const vm = wrapper.vm as any;
      
      expect(vm.picker.data.selectedDate.relative.value).toBe(2);
      expect(vm.picker.data.selectedDate.relative.period).toBe('w');
    });

    it('handles months format', () => {
      wrapper = createWrapper({ modelValue: '3M' });
      const vm = wrapper.vm as any;
      
      expect(vm.picker.data.selectedDate.relative.value).toBe(3);
      expect(vm.picker.data.selectedDate.relative.period).toBe('M');
    });
  });

  describe('Display Functions', () => {
    it('getDisplayValue returns correct format', () => {
      wrapper = createWrapper({ modelValue: '5m' });
      const vm = wrapper.vm as any;
      
      expect(vm.getDisplayValue()).toBe('5 Minutes ago');
    });

    it('getTrimmedDisplayValue returns correct format', () => {
      wrapper = createWrapper({ modelValue: '5m' });
      const vm = wrapper.vm as any;
      
      expect(vm.getTrimmedDisplayValue()).toBe('Past 5 Minutes');
    });

    it('getDisplayValue works with hours', () => {
      wrapper = createWrapper({ modelValue: '2h' });
      const vm = wrapper.vm as any;
      
      expect(vm.getDisplayValue()).toBe('2 Hours ago');
    });

    it('getTrimmedDisplayValue works with days', () => {
      wrapper = createWrapper({ modelValue: '3d' });
      const vm = wrapper.vm as any;
      
      expect(vm.getTrimmedDisplayValue()).toBe('Past 3 Days');
    });
  });

  describe('Period Label Functions', () => {
    it('getPeriodLabelFromValue returns correct labels', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      expect(vm.getPeriodLabelFromValue('s')).toBe('Seconds');
      expect(vm.getPeriodLabelFromValue('m')).toBe('Minutes');
      expect(vm.getPeriodLabelFromValue('h')).toBe('Hours');
      expect(vm.getPeriodLabelFromValue('d')).toBe('Days');
      expect(vm.getPeriodLabelFromValue('w')).toBe('Weeks');
      expect(vm.getPeriodLabelFromValue('M')).toBe('Months');
    });

    it('getPeriodLabelFromValue returns default for invalid period', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      expect(vm.getPeriodLabelFromValue('x')).toBe('Minutes');
    });

    it('getPeriodLabel returns current period label', () => {
      wrapper = createWrapper({ modelValue: '5h' });
      const vm = wrapper.vm as any;
      
      expect(vm.getPeriodLabel()).toBe('Hours');
    });
  });

  describe('Selection Functions', () => {
    it('isSelected returns true for matching values', () => {
      wrapper = createWrapper({ modelValue: '5m' });
      const vm = wrapper.vm as any;
      
      expect(vm.isSelected(5, 'm')).toBe(true);
      expect(vm.isSelected(10, 'm')).toBe(false);
      expect(vm.isSelected(5, 'h')).toBe(false);
    });

    it('isSelected handles different types correctly', () => {
      wrapper = createWrapper({ modelValue: '15s' });
      const vm = wrapper.vm as any;
      
      expect(vm.isSelected(15, 's')).toBe(true);
      expect(vm.isSelected('15', 's')).toBe(true); // Should handle string comparison
    });
  });

  describe('Event Emission', () => {
    it('emits update:modelValue when setRelativeDate is called', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      const period = { value: 'h', label: 'Hours' };
      vm.setRelativeDate(period, 2);
      
      expect(wrapper.emitted('update:modelValue')).toBeTruthy();
      expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['2h']);
    });

    it('emits correct value for different periods', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      const periodDays = { value: 'd', label: 'Days' };
      vm.setRelativeDate(periodDays, 7);
      
      expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['7d']);
    });

    it('emits update:modelValue when updateCustomPeriod is called', () => {
      wrapper = createWrapper({ modelValue: '5m' });
      const vm = wrapper.vm as any;
      
      vm.updateCustomPeriod('h');
      
      expect(wrapper.emitted('update:modelValue')).toBeTruthy();
      expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['5h']);
    });
  });

  describe('Theme and Styling', () => {
    it('computedClass returns dark mode class for dark theme', () => {
      wrapper = createWrapper(
        { changeStyle: true }, 
        { theme: 'dark' }
      );
      const vm = wrapper.vm as any;
      
      expect(vm.computedClass).toBe('dark-mode-date-time-picker');
    });

    it('computedClass returns light mode class for light theme', () => {
      wrapper = createWrapper(
        { changeStyle: true }, 
        { theme: 'light' }
      );
      const vm = wrapper.vm as any;
      
      expect(vm.computedClass).toBe('light-mode-date-time-picker');
    });

    it('computedClass returns empty string when changeStyle is false', () => {
      wrapper = createWrapper(
        { changeStyle: false }, 
        { theme: 'dark' }
      );
      const vm = wrapper.vm as any;
      
      expect(vm.computedClass).toBe('');
    });
  });

  describe('Reactive Data Updates', () => {
    it('updates picker data when setRelativeDate is called', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      const period = { value: 's', label: 'Seconds' };
      vm.setRelativeDate(period, 30);
      
      expect(vm.picker.data.selectedDate.relative.value).toBe(30);
      expect(vm.picker.data.selectedDate.relative.period).toBe('s');
      expect(vm.picker.data.selectedDate.relative.label).toBe('Seconds');
    });

    it('updates label when updateCustomPeriod is called', () => {
      wrapper = createWrapper({ modelValue: '10m' });
      const vm = wrapper.vm as any;
      
      vm.updateCustomPeriod('d');
      
      expect(vm.picker.data.selectedDate.relative.label).toBe('Days');
    });
  });

  describe('Menu State Management', () => {
    it('initializes with showMenu false', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      expect(vm.picker.showMenu).toBe(false);
    });

    it('has correct activeTab default', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      expect(vm.picker.activeTab).toBe('relative');
    });
  });

  describe('Edge Cases', () => {
    it('handles null modelValue gracefully', () => {
      wrapper = createWrapper({ modelValue: null });
      expect(wrapper.exists()).toBe(true);
    });

    it('handles empty modelValue gracefully', () => {
      wrapper = createWrapper({ modelValue: '' });
      expect(wrapper.exists()).toBe(true);
    });

    it('handles undefined modelValue gracefully', () => {
      wrapper = createWrapper({ modelValue: undefined });
      expect(wrapper.exists()).toBe(true);
    });

    it('handles malformed modelValue', () => {
      // Component will attempt to parse but should not crash entirely
      expect(() => {
        wrapper = createWrapper({ modelValue: 'invalid' });
      }).toThrow(); // This test expects the error from malformed parsing
    });

    it('setRelativeDate with zero value', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      const period = { value: 'm', label: 'Minutes' };
      vm.setRelativeDate(period, 0);
      
      expect(vm.picker.data.selectedDate.relative.value).toBe(0);
      expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['0m']);
    });
  });
});
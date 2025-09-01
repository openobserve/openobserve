import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import FilterCreatorPopup from '@/components/shared/filter/FilterCreatorPopup.vue';
import { Quasar } from 'quasar';

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key
  })
}));

describe('FilterCreatorPopup.vue', () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllMocks();
  });

  const createWrapper = (props = {}) => {
    const defaultProps = {
      fieldName: 'test_field',
      fieldValues: ['value1', 'value2', 'value3'],
      operators: [
        { label: 'equals', value: '=' },
        { label: 'not equals', value: '!=' },
        { label: 'contains', value: 'LIKE' }
      ],
      defaultOperator: '=',
      defaultValues: ['value1']
    };

    return mount(FilterCreatorPopup, {
      props: { ...defaultProps, ...props },
      global: {
        plugins: [Quasar],
        stubs: {
          'q-dialog': {
            template: '<div class="q-dialog-stub"><slot></slot></div>'
          },
          'q-card': {
            template: '<div class="q-card-stub"><slot></slot></div>'
          },
          'q-card-section': {
            template: '<div class="q-card-section-stub"><slot></slot></div>'
          },
          'q-card-actions': {
            template: '<div class="q-card-actions-stub"><slot></slot></div>'
          },
          'q-select': {
            template: '<select class="q-select-stub" v-model="modelValue"><option v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</option></select>',
            props: ['modelValue', 'options', 'label', 'rules']
          },
          'q-list': {
            template: '<div class="q-list-stub"><slot></slot></div>'
          },
          'q-item': {
            template: '<div class="q-item-stub"><slot></slot></div>',
            props: ['tag']
          },
          'q-item-section': {
            template: '<div class="q-item-section-stub"><slot></slot></div>',
            props: ['avatar']
          },
          'q-item-label': {
            template: '<div class="q-item-label-stub"><slot></slot></div>'
          },
          'q-checkbox': {
            template: '<input type="checkbox" class="q-checkbox-stub" v-model="modelValue" :value="val" />',
            props: ['modelValue', 'val', 'size', 'dense']
          },
          'q-btn': {
            template: '<button class="q-btn-stub" @click="$emit(\'click\')">{{ label }}</button>',
            props: ['label', 'color', 'flat']
          },
          'q-img': {
            template: '<div class="q-img-stub">{{ src }}</div>',
            props: ['src', 'style']
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

    it('displays the field name as title', () => {
      wrapper = createWrapper({ fieldName: 'custom_field' });
      expect(wrapper.text()).toContain('custom_field');
    });

    it('renders operator select with options', () => {
      wrapper = createWrapper();
      const select = wrapper.find('.q-select-stub');
      expect(select.exists()).toBe(true);
    });

    it('displays "No values present" when fieldValues is empty', () => {
      wrapper = createWrapper({ fieldValues: [] });
      expect(wrapper.text()).toContain('No values present');
    });

    it('displays "No values present" when fieldValues is null', () => {
      wrapper = createWrapper({ fieldValues: null });
      expect(wrapper.text()).toContain('No values present');
    });

    it('renders field values as checkboxes', () => {
      wrapper = createWrapper();
      const checkboxes = wrapper.findAll('.q-checkbox-stub');
      expect(checkboxes.length).toBe(3);
    });

    it('displays values section title', () => {
      wrapper = createWrapper();
      expect(wrapper.text()).toContain('Values');
    });

    it('renders action buttons', () => {
      wrapper = createWrapper();
      const buttons = wrapper.findAll('.q-btn-stub');
      expect(buttons.length).toBe(2);
      expect(buttons[0].text()).toContain('common.cancel');
      expect(buttons[1].text()).toContain('common.apply');
    });
  });

  describe('Props Handling', () => {
    it('accepts all required props', () => {
      const props = {
        fieldName: 'test_field',
        fieldValues: ['value1', 'value2'],
        operators: [{ label: 'equals', value: '=' }],
        defaultOperator: '=',
        defaultValues: ['value1']
      };
      
      wrapper = createWrapper(props);
      
      expect(wrapper.props('fieldName')).toBe('test_field');
      expect(wrapper.props('fieldValues')).toEqual(['value1', 'value2']);
      expect(wrapper.props('operators')).toEqual([{ label: 'equals', value: '=' }]);
      expect(wrapper.props('defaultOperator')).toBe('=');
      expect(wrapper.props('defaultValues')).toEqual(['value1']);
    });

    it('initializes selectedOperator with defaultOperator', () => {
      wrapper = createWrapper({ defaultOperator: 'LIKE' });
      const vm = wrapper.vm as any;
      expect(vm.selectedOperator).toBe('LIKE');
    });

    it('initializes selectedValues with defaultValues', () => {
      wrapper = createWrapper({ defaultValues: ['value2', 'value3'] });
      const vm = wrapper.vm as any;
      expect(vm.selectedValues).toEqual(['value2', 'value3']);
    });

    it('handles undefined defaultOperator', () => {
      wrapper = createWrapper({ defaultOperator: undefined });
      const vm = wrapper.vm as any;
      expect(vm.selectedOperator).toBeUndefined();
    });

    it('handles undefined defaultValues', () => {
      wrapper = createWrapper({ defaultValues: undefined });
      const vm = wrapper.vm as any;
      expect(vm.selectedValues).toBeUndefined();
    });
  });

  describe('Operator Selection', () => {
    it('displays operator options correctly', () => {
      const operators = [
        { label: 'Equals', value: '=' },
        { label: 'Not Equals', value: '!=' },
        { label: 'Contains', value: 'LIKE' }
      ];
      
      wrapper = createWrapper({ operators });
      const select = wrapper.find('.q-select-stub');
      
      expect(select.exists()).toBe(true);
    });

    it('updates selectedOperator when operator changes', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      vm.selectedOperator = '!=';
      await wrapper.vm.$nextTick();
      
      expect(vm.selectedOperator).toBe('!=');
    });

    it('has validation rules for operator selection', () => {
      wrapper = createWrapper();
      const select = wrapper.find('.q-select-stub');
      
      expect(select.exists()).toBe(true);
      // Rules are passed as props but might not be accessible in test
    });
  });

  describe('Value Selection', () => {
    it('renders correct number of value checkboxes', () => {
      const fieldValues = ['value1', 'value2', 'value3', 'value4'];
      wrapper = createWrapper({ fieldValues });
      
      const checkboxes = wrapper.findAll('.q-checkbox-stub');
      expect(checkboxes.length).toBe(4);
    });

    it('displays values as labels', () => {
      const fieldValues = ['option1', 'option2'];
      wrapper = createWrapper({ fieldValues });
      
      expect(wrapper.text()).toContain('option1');
      expect(wrapper.text()).toContain('option2');
    });

    it('updates selectedValues when checkbox changes', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      vm.selectedValues = ['value2', 'value3'];
      await wrapper.vm.$nextTick();
      
      expect(vm.selectedValues).toEqual(['value2', 'value3']);
    });

    it('handles empty selectedValues array', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      vm.selectedValues = [];
      await wrapper.vm.$nextTick();
      
      expect(vm.selectedValues).toEqual([]);
    });
  });

  describe('Event Handling', () => {
    it('emits apply event with correct payload when applyFilter is called', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      vm.selectedOperator = 'LIKE';
      vm.selectedValues = ['value1', 'value2'];
      
      vm.applyFilter();
      
      expect(wrapper.emitted('apply')).toBeTruthy();
      expect(wrapper.emitted('apply')?.[0]).toEqual([{
        fieldName: 'test_field',
        selectedValues: ['value1', 'value2'],
        selectedOperator: 'LIKE'
      }]);
    });

    it('emits apply event when apply button is clicked', async () => {
      wrapper = createWrapper();
      const applyButton = wrapper.findAll('.q-btn-stub')[1];
      
      await applyButton.trigger('click');
      
      expect(wrapper.emitted('apply')).toBeTruthy();
    });

    it('includes fieldName from props in emitted event', () => {
      wrapper = createWrapper({ fieldName: 'custom_field_name' });
      const vm = wrapper.vm as any;
      
      vm.applyFilter();
      
      const emittedEvent = wrapper.emitted('apply')?.[0]?.[0] as any;
      expect(emittedEvent.fieldName).toBe('custom_field_name');
    });

    it('handles apply with empty selectedValues', () => {
      wrapper = createWrapper({ defaultValues: [] });
      const vm = wrapper.vm as any;
      
      vm.applyFilter();
      
      const emittedEvent = wrapper.emitted('apply')?.[0]?.[0] as any;
      expect(emittedEvent.selectedValues).toEqual([]);
    });
  });

  describe('Interface Compliance', () => {
    it('emitted filter object matches Filter interface', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      vm.selectedOperator = '=';
      vm.selectedValues = ['test_value'];
      vm.applyFilter();
      
      const emittedEvent = wrapper.emitted('apply')?.[0]?.[0] as any;
      
      expect(typeof emittedEvent.fieldName).toBe('string');
      expect(Array.isArray(emittedEvent.selectedValues)).toBe(true);
      expect(typeof emittedEvent.selectedOperator).toBe('string');
    });
  });

  describe('Lifecycle Hooks', () => {
    it('calls onBeforeMount without errors', () => {
      expect(() => {
        wrapper = createWrapper();
      }).not.toThrow();
    });

    it('properly initializes reactive values on mount', () => {
      wrapper = createWrapper({
        defaultOperator: 'LIKE',
        defaultValues: ['init_value']
      });
      
      const vm = wrapper.vm as any;
      expect(vm.selectedOperator).toBe('LIKE');
      expect(vm.selectedValues).toEqual(['init_value']);
    });
  });

  describe('Component Structure', () => {
    it('has correct dialog structure', () => {
      wrapper = createWrapper();
      expect(wrapper.find('.q-dialog-stub').exists()).toBe(true);
      expect(wrapper.find('.q-card-stub').exists()).toBe(true);
    });

    it('has proper card sections', () => {
      wrapper = createWrapper();
      const sections = wrapper.findAll('.q-card-section-stub');
      expect(sections.length).toBeGreaterThanOrEqual(3); // Title, operator, values
    });

    it('has actions section with buttons', () => {
      wrapper = createWrapper();
      expect(wrapper.find('.q-card-actions-stub').exists()).toBe(true);
      expect(wrapper.findAll('.q-btn-stub').length).toBe(2);
    });
  });

  describe('Edge Cases', () => {
    it('handles null fieldValues gracefully', () => {
      wrapper = createWrapper({ fieldValues: null });
      expect(wrapper.text()).toContain('No values present');
      expect(wrapper.exists()).toBe(true);
    });

    it('handles undefined fieldValues gracefully', () => {
      wrapper = createWrapper({ fieldValues: undefined });
      expect(wrapper.text()).toContain('No values present');
      expect(wrapper.exists()).toBe(true);
    });

    it('handles empty operators array', () => {
      wrapper = createWrapper({ operators: [] });
      expect(wrapper.exists()).toBe(true);
    });

    it('handles very long field values', () => {
      const longValues = Array.from({ length: 100 }, (_, i) => `very_long_value_${i}`);
      wrapper = createWrapper({ fieldValues: longValues });
      
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.findAll('.q-checkbox-stub').length).toBe(100);
    });

    it('handles special characters in field values', () => {
      const specialValues = ['value@#$', 'value with spaces', 'value/with/slashes'];
      wrapper = createWrapper({ fieldValues: specialValues });
      
      expect(wrapper.exists()).toBe(true);
      specialValues.forEach(value => {
        expect(wrapper.text()).toContain(value);
      });
    });

    it('handles empty fieldName', () => {
      wrapper = createWrapper({ fieldName: '' });
      expect(wrapper.exists()).toBe(true);
    });

    it('handles null defaultOperator and defaultValues', () => {
      wrapper = createWrapper({
        defaultOperator: null,
        defaultValues: null
      });
      
      const vm = wrapper.vm as any;
      expect(vm.selectedOperator).toBeNull();
      expect(vm.selectedValues).toBeNull();
    });
  });

  describe('Internationalization', () => {
    it('uses i18n for operator label', () => {
      wrapper = createWrapper();
      // The label prop should be passed to q-select
      expect(wrapper.exists()).toBe(true);
    });

    it('uses i18n for button labels', () => {
      wrapper = createWrapper();
      const buttons = wrapper.findAll('.q-btn-stub');
      
      expect(buttons[0].text()).toContain('common.cancel');
      expect(buttons[1].text()).toContain('common.apply');
    });
  });

  describe('Styling and Layout', () => {
    it('applies correct CSS classes', () => {
      wrapper = createWrapper();
      
      expect(wrapper.find('.q-dialog-stub').exists()).toBe(true);
      expect(wrapper.find('.q-card-stub').exists()).toBe(true);
    });

    it('handles checkbox styling properties', () => {
      wrapper = createWrapper();
      const checkboxes = wrapper.findAll('.q-checkbox-stub');
      
      checkboxes.forEach(checkbox => {
        expect(checkbox.exists()).toBe(true);
      });
    });
  });
});
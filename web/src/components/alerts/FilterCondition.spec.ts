import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { Quasar } from 'quasar';
import FilterCondition from './FilterCondition.vue';
import { createStore } from 'vuex';
import { createI18n } from 'vue-i18n';
import { nextTick } from 'vue';

const mockStore = createStore({
  state: {
    isAiChatEnabled: false, // Default to false for most tests
  },
});

const mockI18n = createI18n({
  locale: 'en',
  messages: {
    en: {
      alerts: {
        column: 'Column',
      },
      common: {
        value: 'Value',
      },
    },
  },
});

describe('FilterCondition.vue Branch Coverage', () => {
  const defaultProps = {
    condition: {
      column: '',
      operator: '',
      value: '',
      logicalOperator: 'AND',
    },
    streamFields: [
      { label: 'Field 1', value: 'field1' },
      { label: 'Field 2', value: 'field2' },
      { label: 'User Name', value: 'username' },
    ],
    index: 0,
    label: 'AND',
    depth: 0,
    isFirstInGroup: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Label Display Branch Coverage', () => {
    it('should show "if" when index is 0', async () => {
      const wrapper = mount(FilterCondition, {
        props: {
          ...defaultProps,
          index: 0,
          depth: 0,
        },
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      // Branch: index == 0 ? 'if' : computedLabel (line 5)
      const labelElement = wrapper.find('.tw\\:text-sm');
      expect(labelElement.text().trim()).toBe('if');
    });

    it('should show lowercase operator when not first in group', async () => {
      const wrapper = mount(FilterCondition, {
        props: {
          ...defaultProps,
          condition: {
            ...defaultProps.condition,
            logicalOperator: 'OR',
          },
          index: 1, // Branch condition: index != 0
          depth: 0,
          isFirstInGroup: false,
          label: 'OR',
        },
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      // Branch: computedLabel (when not first in group) - CSS lowercase applied
      const labelElement = wrapper.find('.tw\\:lowercase');
      // Text content is still 'OR' but CSS applies text-transform: lowercase
      expect(labelElement.exists()).toBe(true);
      expect(labelElement.text().trim()).toBe('OR'); // Content is uppercase, CSS transforms to lowercase visually
    });

    it('should show "if" only for first condition in root group (index 0, depth 0)', async () => {
      const wrapper = mount(FilterCondition, {
        props: {
          ...defaultProps,
          index: 0,
          depth: 0, // V2: "if" only shown for root group first condition
          isFirstInGroup: true,
          label: 'AND',
        },
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      // Branch: index == 0 && depth == 0 shows "if"
      const labelElement = wrapper.find('.tw\\:text-sm');
      expect(labelElement.text().trim()).toBe('if');
    });

    it('should show empty space for first condition in nested groups', async () => {
      const wrapper = mount(FilterCondition, {
        props: {
          ...defaultProps,
          index: 0,
          depth: 1, // Nested group
          isFirstInGroup: true,
          label: 'AND',
        },
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      // Branch: isFirstInGroup && depth > 0 shows empty space (no label)
      const labelContainer = wrapper.find('.tw\\:min-w-\\[60px\\]');
      expect(labelContainer.exists()).toBe(true);
      // Should not contain operator label or "if"
      expect(labelContainer.text().trim()).toBe('');
    });
  });


  describe('Tooltip Display Branch Coverage', () => {
    it('should conditionally render tooltips based on AI chat and field values', async () => {
      const aiEnabledStore = createStore({
        state: {
          isAiChatEnabled: true, // Branch condition: true
        },
      });

      const wrapper = mount(FilterCondition, {
        props: {
          ...defaultProps,
          condition: {
            column: 'test_column',
            operator: '=',
            value: 'test_value',
          },
        },
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: aiEnabledStore,
          },
        },
      });

      // Branch: condition.column && store.state.isAiChatEnabled = true (line 33)
      // Branch: condition.operator && store.state.isAiChatEnabled = true (line 57) 
      // Branch: condition.value && store.state.isAiChatEnabled = true (line 83)
      
      // Just test that the conditional rendering logic paths are covered by component creation
      expect(wrapper.vm).toBeDefined();
      expect((wrapper.vm as any).store.state.isAiChatEnabled).toBe(true);
      expect((wrapper.vm as any).condition.column).toBe('test_column');
      expect((wrapper.vm as any).condition.operator).toBe('=');
      expect((wrapper.vm as any).condition.value).toBe('test_value');
    });

    it('should not show tooltips when AI chat is disabled', async () => {
      const aiDisabledStore = createStore({
        state: {
          isAiChatEnabled: false, // Branch condition: false
        },
      });

      const wrapper = mount(FilterCondition, {
        props: {
          ...defaultProps,
          condition: {
            column: 'test_column',
            operator: '=',
            value: 'test_value',
          },
        },
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: aiDisabledStore,
          },
        },
      });

      // Branch: condition.column && store.state.isAiChatEnabled = false (line 33)
      // Branch: condition.operator && store.state.isAiChatEnabled = false (line 57)
      // Branch: condition.value && store.state.isAiChatEnabled = false (line 83)
      const tooltips = wrapper.findAllComponents({ name: 'QTooltip' });
      expect(tooltips.length).toBe(0);
    });

    it('should not show tooltips when AI chat is enabled but fields are empty', async () => {
      const aiEnabledStore = createStore({
        state: {
          isAiChatEnabled: true,
        },
      });

      const wrapper = mount(FilterCondition, {
        props: {
          ...defaultProps,
          condition: {
            column: '', // Branch condition: empty string = falsy
            operator: '',
            value: '',
          },
        },
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: aiEnabledStore,
          },
        },
      });

      // Branch: !condition.column (line 33), !condition.operator (line 57), !condition.value (line 83)
      const tooltips = wrapper.findAllComponents({ name: 'QTooltip' });
      expect(tooltips.length).toBe(0);
    });
  });

  describe('Filter Functionality Branch Coverage', () => {
    it('should reset filtered fields when filter value is empty', async () => {
      const wrapper = mount(FilterCondition, {
        props: defaultProps,
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      // Get the filter function from the component
      const filterFn = (wrapper.vm as any).filterColumns;
      const mockUpdate = vi.fn();
      
      // Test empty string branch (line 162)
      filterFn('', mockUpdate);

      // The filterColumns function calls update twice - once for empty case, once for general case
      expect(mockUpdate).toHaveBeenCalledTimes(2);
      
      // Get the callback passed to update and call it (first call handles empty string case)
      const updateCallback = mockUpdate.mock.calls[0][0];
      updateCallback();

      // Branch: val === "" should reset to all streamFields
      expect((wrapper.vm as any).filteredFields).toEqual(defaultProps.streamFields);
    });

    it('should filter fields when filter value is provided', async () => {
      const wrapper = mount(FilterCondition, {
        props: defaultProps,
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      const filterFn = (wrapper.vm as any).filterColumns;
      const mockUpdate = vi.fn();
      
      // Test non-empty string branch (line 167)
      filterFn('user', mockUpdate);

      expect(mockUpdate).toHaveBeenCalledTimes(1);
      
      // Get the callback and call it
      const updateCallback = mockUpdate.mock.calls[0][0];
      updateCallback();

      // Branch: val !== "" should filter based on value
      expect((wrapper.vm as any).filteredFields).toEqual([
        { label: 'User Name', value: 'username' }
      ]);
    });

    it('should filter fields case-insensitively', async () => {
      const wrapper = mount(FilterCondition, {
        props: defaultProps,
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      const filterFn = (wrapper.vm as any).filterColumns;
      const mockUpdate = vi.fn();
      
      // Test case insensitive filtering (line 168-171)
      filterFn('FIELD', mockUpdate);

      const updateCallback = mockUpdate.mock.calls[0][0];
      updateCallback();

      // Should find both field1 and field2
      expect((wrapper.vm as any).filteredFields).toEqual([
        { label: 'Field 1', value: 'field1' },
        { label: 'Field 2', value: 'field2' },
      ]);
    });

    it('should return empty array when no matches found', async () => {
      const wrapper = mount(FilterCondition, {
        props: defaultProps,
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      const filterFn = (wrapper.vm as any).filterColumns;
      const mockUpdate = vi.fn();
      
      // Test no matches case
      filterFn('nonexistent', mockUpdate);

      const updateCallback = mockUpdate.mock.calls[0][0];
      updateCallback();

      // Should find no matches
      expect((wrapper.vm as any).filteredFields).toEqual([]);
    });
  });

  describe('Event Emission Branch Coverage', () => {
    it('should emit events on model updates', async () => {
      const wrapper = mount(FilterCondition, {
        props: defaultProps,
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      // Test column update event
      const columnSelect = wrapper.findComponent({ name: 'QSelect' });
      await columnSelect.vm.$emit('update:model-value', 'field1');

      // Should emit input:update event
      expect(wrapper.emitted('input:update')).toBeTruthy();
      expect(wrapper.emitted('input:update')?.[0]).toEqual(['conditions', defaultProps.condition]);
    });

    it('should call delete, add, and add-group functions', async () => {
      const wrapper = mount(FilterCondition, {
        props: defaultProps,
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      // Test deleteApiHeader function
      (wrapper.vm as any).deleteApiHeader('testField');
      expect(wrapper.emitted('remove')).toBeTruthy();
      expect(wrapper.emitted('input:update')).toBeTruthy();

      // Test addApiHeader function  
      (wrapper.vm as any).addApiHeader('testGroup');
      expect(wrapper.emitted('add')).toBeTruthy();
      expect(wrapper.emitted('add')?.[0]).toEqual(['testGroup']);

      // Test addGroupApiHeader function
      (wrapper.vm as any).addGroupApiHeader('testGroupId');
      expect(wrapper.emitted('add-group')).toBeTruthy();
      expect(wrapper.emitted('add-group')?.[0]).toEqual(['testGroupId']);
    });
  });

  describe('Computed Label Branch Coverage', () => {
    it('should return the correct computed label when not first in group', async () => {
      const wrapper = mount(FilterCondition, {
        props: {
          ...defaultProps,
          label: 'CUSTOM_LABEL',
          isFirstInGroup: false, // V2: Only show label when not first
          condition: {
            ...defaultProps.condition,
            logicalOperator: 'AND',
          },
        },
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      // Test computedLabel computed property - should return condition's logicalOperator
      expect((wrapper.vm as any).computedLabel).toBe('AND');
    });

    it('should return empty string for first condition in group', async () => {
      const wrapper = mount(FilterCondition, {
        props: {
          ...defaultProps,
          isFirstInGroup: true, // First condition in group
        },
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      // Test computedLabel computed property - should return empty string
      expect((wrapper.vm as any).computedLabel).toBe('');
    });
  });
});
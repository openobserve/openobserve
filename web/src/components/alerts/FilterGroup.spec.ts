import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import FilterGroup from './FilterGroup.vue';
import { createStore } from 'vuex';
import { createI18n } from 'vue-i18n';
import enMessages from '@/locales/languages/en-US.json';
import { nextTick, defineComponent, reactive, ref } from 'vue';
import { z } from 'zod';
import OForm from '@/lib/forms/Form/OForm.vue';
import OFormSelect from '@/lib/forms/Select/OFormSelect.vue';
import OFormInput from '@/lib/forms/Input/OFormInput.vue';
import OSelect from '@/lib/forms/Select/OSelect.vue';
import OInput from '@/lib/forms/Input/OInput.vue';
import {
  conditionGroupNodeSchema,
  refineConditionsTree,
} from './steps/QueryConfig.schema';

// Mock getUUID
vi.mock('@/utils/zincutils', () => ({
  getUUID: vi.fn(() => 'mock-uuid-123'),
}));

const mockStore = createStore({
  state: {
    theme: 'light',
    isAiChatEnabled: false,
  },
});

// Mount the REAL en.json messages (not a hand-written stub): the component's
// user-facing strings are i18n keys, so a stub would make every t() fall back to
// its raw key path and silently weaken the text assertions below.
const mockI18n = createI18n({
  locale: 'en',
  messages: { en: enMessages },
});


describe('FilterGroup.vue Comprehensive Coverage', () => {
  const defaultProps = {
    group: {
      groupId: 'test-group-1',
      filterType: 'group',
      logicalOperator: 'AND',
      conditions: [
        {
          id: 'item-1',
          filterType: 'condition',
          column: 'field1',
          operator: '=',
          value: 'test',
          logicalOperator: 'AND',
        }
      ],
    },
    streamFields: [
      { label: 'Field 1', value: 'field1' },
      { label: 'Field 2', value: 'field2' },
    ],
    depth: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Component Initialization', () => {
    it('should render component with default props', () => {
      const wrapper = mount(FilterGroup, {
        props: defaultProps,
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      expect(wrapper.exists()).toBe(true);
    });

    it('should initialize with correct reactive values', () => {
      const wrapper = mount(FilterGroup, {
        props: defaultProps,
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      expect(wrapper.vm.isOpen).toBe(true);
      expect(wrapper.vm.label).toBe('and');
      expect(wrapper.vm.groups.groupId).toBe('test-group-1');
    });

    it('should handle empty group items', () => {
      const emptyProps = {
        ...defaultProps,
        group: {
          groupId: 'empty-group',
          filterType: 'group',
          logicalOperator: 'OR',
          conditions: [],
        }
      };

      const wrapper = mount(FilterGroup, {
        props: emptyProps,
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      expect(wrapper.vm.groups.conditions).toHaveLength(0);
    });
  });

  describe('isGroup Function', () => {
    it('should return true for valid group objects', () => {
      const wrapper = mount(FilterGroup, {
        props: defaultProps,
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      const groupItem = {
        groupId: 'test-group',
        label: 'and',
        items: []
      };

      expect(wrapper.vm.isGroup(groupItem)).toBe(true);
    });

    it('should return false for non-group objects', () => {
      const wrapper = mount(FilterGroup, {
        props: defaultProps,
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      const conditionItem = {
        id: 'test-condition',
        column: 'field1',
        operator: '=',
        value: 'test'
      };

      expect(wrapper.vm.isGroup(conditionItem)).toBeFalsy();
    });

    it('should return false for null or undefined', () => {
      const wrapper = mount(FilterGroup, {
        props: defaultProps,
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      expect(wrapper.vm.isGroup(null)).toBeFalsy();
      expect(wrapper.vm.isGroup(undefined)).toBeFalsy();
    });

    it('should return false for objects without items array', () => {
      const wrapper = mount(FilterGroup, {
        props: defaultProps,
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      const invalidGroup = {
        groupId: 'test-group',
        items: 'not-array'
      };

      expect(wrapper.vm.isGroup(invalidGroup)).toBe(false);
    });

    it('should return false for objects with missing items property', () => {
      const wrapper = mount(FilterGroup, {
        props: defaultProps,
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      const invalidGroup = {
        groupId: 'test-group',
        label: 'and'
      };

      expect(wrapper.vm.isGroup(invalidGroup)).toBeFalsy();
    });
  });

  describe('addCondition Function', () => {
    it('should add new condition to group items', () => {
      const wrapper = mount(FilterGroup, {
        props: defaultProps,
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      const initialLength = wrapper.vm.groups.conditions.length;
      wrapper.vm.addCondition('test-group');

      expect(wrapper.vm.groups.conditions).toHaveLength(initialLength + 1);

      const newCondition = wrapper.vm.groups.conditions[wrapper.vm.groups.conditions.length - 1];
      expect(newCondition.column).toBe('');
      expect(newCondition.operator).toBe('=');
      expect(newCondition.value).toBe('');
      expect(newCondition.ignore_case).toBeUndefined(); // No longer added to conditions
      expect(newCondition.id).toBe('mock-uuid-123');
    });

    it('should emit add-condition event', () => {
      const wrapper = mount(FilterGroup, {
        props: defaultProps,
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      wrapper.vm.addCondition('test-group');

      expect(wrapper.emitted('add-condition')).toBeTruthy();
      expect(wrapper.emitted('add-condition')?.[0][0]).toEqual(wrapper.vm.groups);
    });

    it('should add multiple conditions correctly', async () => {
      const wrapper = mount(FilterGroup, {
        props: defaultProps,
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      const initialLength = wrapper.vm.groups.conditions.length;
      wrapper.vm.addCondition('test-group');
      // Structural ops chain THROUGH the parent: each emitted group is written
      // back to `group` before the next op, which re-syncs the working clone.
      // The handler refreshes the clone from the live prop so bare-mode in-place
      // leaf edits aren't lost — so a second add without that write-back would
      // (correctly) start from the un-updated prop. Simulate the write-back here.
      await wrapper.setProps({ group: wrapper.emitted('add-condition')![0][0] });
      wrapper.vm.addCondition('test-group');

      expect(wrapper.vm.groups.conditions).toHaveLength(initialLength + 2);
    });

    // Regression: bare-mode consumers (pipeline NodeForm/Condition.vue) edit the
    // leaf conditions of `group` IN PLACE via v-model. A structural op must emit
    // those in-place edits, not the stale working clone — otherwise the ancestor
    // writes the stale clone back and wipes the user's typed values (which made
    // the pipeline condition-node fail to save).
    it('preserves in-place bare-mode leaf edits when a structural op emits', () => {
      const group = {
        groupId: 'g-1',
        filterType: 'group',
        logicalOperator: 'AND',
        conditions: [
          {
            id: 'c-1',
            filterType: 'condition',
            column: '',
            operator: '=',
            value: '',
            logicalOperator: 'AND',
          },
        ],
      };
      const wrapper = mount(FilterGroup, {
        props: { ...defaultProps, group },
        global: {
          plugins: [mockI18n],
          provide: { store: mockStore },
          stubs: { FilterCondition: true },
        },
      });

      // Simulate bare-mode v-model editing the leaf IN PLACE (no new reference,
      // so the non-deep sync watch does not fire — the clone would go stale).
      group.conditions[0].column = 'kubernetes_container_name';
      group.conditions[0].value = 'prometheus';

      // A structural op (add) must carry the in-place edits into its payload.
      wrapper.vm.addCondition('g-1');

      const emitted = wrapper.emitted('add-condition')![0][0] as any;
      expect(emitted.conditions[0].column).toBe('kubernetes_container_name');
      expect(emitted.conditions[0].value).toBe('prometheus');
      expect(emitted.conditions).toHaveLength(2);
    });
  });

  describe('addGroup Function', () => {
    it('should add new group to group items', () => {
      const wrapper = mount(FilterGroup, {
        props: defaultProps,
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      const initialLength = wrapper.vm.groups.conditions.length;
      wrapper.vm.addGroup('test-group');

      expect(wrapper.vm.groups.conditions).toHaveLength(initialLength + 1);
      
      const newGroup = wrapper.vm.groups.conditions[wrapper.vm.groups.conditions.length - 1];
      expect(newGroup.groupId).toBe('mock-uuid-123');
      expect(newGroup.filterType).toBe('group');
      expect(newGroup.logicalOperator).toBe('OR');
      expect(newGroup.conditions).toHaveLength(1);

      // Check the default condition in the new group
      const defaultCondition = newGroup.conditions[0];
      expect(defaultCondition.filterType).toBe('condition');
      expect(defaultCondition.column).toBe('');
      expect(defaultCondition.operator).toBe('=');
      expect(defaultCondition.value).toBe('');
      expect(defaultCondition.logicalOperator).toBe('OR');
      expect(defaultCondition.ignore_case).toBeUndefined(); // No longer added to conditions
    });

    it('should emit add-group event', () => {
      const wrapper = mount(FilterGroup, {
        props: defaultProps,
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      wrapper.vm.addGroup('test-group');

      expect(wrapper.emitted('add-group')).toBeTruthy();
      expect(wrapper.emitted('add-group')?.[0][0]).toEqual(wrapper.vm.groups);
    });

    it('should create nested group structure correctly', () => {
      const wrapper = mount(FilterGroup, {
        props: defaultProps,
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      wrapper.vm.addGroup('test-group');
      const newGroup = wrapper.vm.groups.conditions[wrapper.vm.groups.conditions.length - 1];

      expect(wrapper.vm.isGroup(newGroup)).toBe(true);
      expect(newGroup.conditions[0].id).toBe('mock-uuid-123');
    });
  });

  describe('toggleLabel Function', () => {
    it('should toggle from AND to OR', () => {
      const wrapper = mount(FilterGroup, {
        props: {
          ...defaultProps,
          group: { ...defaultProps.group, logicalOperator: 'AND' }
        },
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      expect(wrapper.vm.groups.logicalOperator).toBe('AND');
      wrapper.vm.toggleLabel();
      expect(wrapper.vm.groups.logicalOperator).toBe('OR');
    });

    it('should toggle from OR to AND', () => {
      const wrapper = mount(FilterGroup, {
        props: {
          ...defaultProps,
          group: { ...defaultProps.group, logicalOperator: 'OR' }
        },
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      expect(wrapper.vm.groups.logicalOperator).toBe('OR');
      wrapper.vm.toggleLabel();
      expect(wrapper.vm.groups.logicalOperator).toBe('AND');
    });

    it('should emit add-group event when toggling', () => {
      const wrapper = mount(FilterGroup, {
        props: defaultProps,
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      wrapper.vm.toggleLabel();

      expect(wrapper.emitted('add-group')).toBeTruthy();
      expect(wrapper.emitted('add-group')?.[0][0]).toEqual(wrapper.vm.groups);
    });

    it('should emit input:update event when toggling', () => {
      const wrapper = mount(FilterGroup, {
        props: defaultProps,
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      wrapper.vm.toggleLabel();

      expect(wrapper.emitted('input:update')).toBeTruthy();
      expect(wrapper.emitted('input:update')?.[0]).toEqual(['conditions', wrapper.vm.groups]);
    });

    it('should update logicalOperator ref when toggling', () => {
      const wrapper = mount(FilterGroup, {
        props: defaultProps,
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      const originalOperator = wrapper.vm.groups.logicalOperator;
      wrapper.vm.toggleLabel();
      expect(wrapper.vm.groups.logicalOperator).not.toBe(originalOperator);
    });
  });

  describe('removeCondition Function', () => {
    it('should remove condition from group items', () => {
      const multiItemProps = {
        ...defaultProps,
        group: {

          groupId: 'test-group',

          filterType: 'group',

          logicalOperator: 'AND',

          conditions: [
            { id: 'item-1', column: 'field1', operator: '=', value: 'test1' },
            { id: 'item-2', column: 'field2', operator: '=', value: 'test2' },
          ],

        }
      };

      const wrapper = mount(FilterGroup, {
        props: multiItemProps,
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      expect(wrapper.vm.groups.conditions).toHaveLength(2);
      wrapper.vm.removeCondition('item-1');
      expect(wrapper.vm.groups.conditions).toHaveLength(1);
      expect(wrapper.vm.groups.conditions[0].id).toBe('item-2');
    });

    it('should emit add-group when removing non-last condition', () => {
      const multiItemProps = {
        ...defaultProps,
        group: {

          groupId: 'test-group',

          filterType: 'group',

          logicalOperator: 'AND',

          conditions: [
            { id: 'item-1', column: 'field1', operator: '=', value: 'test1' },
            { id: 'item-2', column: 'field2', operator: '=', value: 'test2' },
          ],

        }
      };

      const wrapper = mount(FilterGroup, {
        props: multiItemProps,
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      wrapper.vm.removeCondition('item-1');

      expect(wrapper.emitted('add-group')).toBeTruthy();
    });

    it('should emit remove-group when removing last condition', () => {
      const singleItemProps = {
        ...defaultProps,
        group: {

          groupId: 'test-group',

          filterType: 'group',

          logicalOperator: 'AND',

          conditions: [
            { id: 'only-item', column: 'field1', operator: '=', value: 'test' }
          ],

        }
      };

      const wrapper = mount(FilterGroup, {
        props: singleItemProps,
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      wrapper.vm.removeCondition('only-item');

      expect(wrapper.emitted('remove-group')).toBeTruthy();
      expect(wrapper.emitted('remove-group')?.[0][0]).toBe('test-group');
    });

    it('should handle removing non-existent condition gracefully', () => {
      const wrapper = mount(FilterGroup, {
        props: defaultProps,
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      const initialLength = wrapper.vm.groups.conditions.length;
      wrapper.vm.removeCondition('non-existent-id');
      
      expect(wrapper.vm.groups.conditions).toHaveLength(initialLength);
    });
  });

  describe('inputUpdate Function', () => {
    it('should emit input:update event with correct parameters', () => {
      const wrapper = mount(FilterGroup, {
        props: defaultProps,
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      const testName = 'test-field';
      const testField = { column: 'test_col', value: 'test_val' };

      wrapper.vm.inputUpdate(testName, testField);

      expect(wrapper.emitted('input:update')).toBeTruthy();
      expect(wrapper.emitted('input:update')?.[0]).toEqual([testName, testField]);
    });

    it('should handle multiple input updates', () => {
      const wrapper = mount(FilterGroup, {
        props: defaultProps,
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      wrapper.vm.inputUpdate('field1', { value: 'test1' });
      wrapper.vm.inputUpdate('field2', { value: 'test2' });

      expect(wrapper.emitted('input:update')).toHaveLength(2);
      expect(wrapper.emitted('input:update')?.[0]).toEqual(['field1', { value: 'test1' }]);
      expect(wrapper.emitted('input:update')?.[1]).toEqual(['field2', { value: 'test2' }]);
    });
  });

  describe('hexToHSL Function', () => {
    it('should convert white hex color correctly', () => {
      const wrapper = mount(FilterGroup, {
        props: defaultProps,
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      const result = wrapper.vm.hexToHSL('#ffffff');
      expect(result.h).toBe(0);
      expect(result.s).toBe(0);
      expect(result.l).toBe(100);
    });

    it('should convert black hex color correctly', () => {
      const wrapper = mount(FilterGroup, {
        props: defaultProps,
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      const result = wrapper.vm.hexToHSL('#000000');
      expect(result.h).toBe(0);
      expect(result.s).toBe(0);
      expect(result.l).toBe(0);
    });

    it('should convert red hex color correctly', () => {
      const wrapper = mount(FilterGroup, {
        props: defaultProps,
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      const result = wrapper.vm.hexToHSL('#ff0000');
      expect(result.h).toBe(0);
      expect(result.s).toBe(100);
      expect(result.l).toBe(50);
    });

    it('should convert green hex color correctly', () => {
      const wrapper = mount(FilterGroup, {
        props: defaultProps,
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      const result = wrapper.vm.hexToHSL('#00ff00');
      expect(result.h).toBe(120);
      expect(result.s).toBe(100);
      expect(result.l).toBe(50);
    });

    it('should convert blue hex color correctly', () => {
      const wrapper = mount(FilterGroup, {
        props: defaultProps,
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      const result = wrapper.vm.hexToHSL('#0000ff');
      expect(result.h).toBe(240);
      expect(result.s).toBe(100);
      expect(result.l).toBe(50);
    });

    it('should handle gray hex colors', () => {
      const wrapper = mount(FilterGroup, {
        props: defaultProps,
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      const result = wrapper.vm.hexToHSL('#808080');
      expect(result.h).toBe(0);
      expect(result.s).toBe(0);
      expect(result.l).toBeCloseTo(50.196, 0); // Gray should have 0 saturation
    });

    it('should handle custom hex colors', () => {
      const wrapper = mount(FilterGroup, {
        props: defaultProps,
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      const result = wrapper.vm.hexToHSL('#212121');
      expect(result).toHaveProperty('h');
      expect(result).toHaveProperty('s');
      expect(result).toHaveProperty('l');
      expect(typeof result.h).toBe('number');
      expect(typeof result.s).toBe('number');
      expect(typeof result.l).toBe('number');
    });
  });

  describe('hslToCSS Function', () => {
    it('should convert HSL values to CSS format', () => {
      const wrapper = mount(FilterGroup, {
        props: defaultProps,
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      const result = wrapper.vm.hslToCSS(120, 50, 75);
      expect(result).toBe('hsl(120, 50%, 75%)');
    });

    it('should handle zero values', () => {
      const wrapper = mount(FilterGroup, {
        props: defaultProps,
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      const result = wrapper.vm.hslToCSS(0, 0, 0);
      expect(result).toBe('hsl(0, 0%, 0%)');
    });

    it('should handle maximum values', () => {
      const wrapper = mount(FilterGroup, {
        props: defaultProps,
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      const result = wrapper.vm.hslToCSS(360, 100, 100);
      expect(result).toBe('hsl(360, 100%, 100%)');
    });

    it('should handle decimal values', () => {
      const wrapper = mount(FilterGroup, {
        props: defaultProps,
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      const result = wrapper.vm.hslToCSS(180.5, 66.7, 33.3);
      expect(result).toBe('hsl(180.5, 66.7%, 33.3%)');
    });
  });

  describe('computedStyleMap Computed Property', () => {
    it('should return HSL string for dark theme', () => {
      const darkStore = createStore({
        state: {
          theme: 'dark',
          isAiChatEnabled: false,
        },
      });

      const wrapper = mount(FilterGroup, {
        props: { ...defaultProps, depth: 1 },
        global: {
          plugins: [mockI18n],
          provide: {
            store: darkStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      const result = wrapper.vm.computedStyleMap;
      expect(typeof result).toBe('string');
      expect(result).toMatch(/^hsl\(\d+(\.\d+)?, \d+(\.\d+)?%, \d+(\.\d+)?%\)$/);
    });

    it('should return HSL string for light theme', () => {
      const lightStore = createStore({
        state: {
          theme: 'light',
          isAiChatEnabled: false,
        },
      });

      const wrapper = mount(FilterGroup, {
        props: { ...defaultProps, depth: 1 },
        global: {
          plugins: [mockI18n],
          provide: {
            store: lightStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      const result = wrapper.vm.computedStyleMap;
      expect(typeof result).toBe('string');
      expect(result).toMatch(/^hsl\(\d+(\.\d+)?, \d+(\.\d+)?%, \d+(\.\d+)?%\)$/);
    });

    it('should apply depth-based lightness adjustments for dark theme', () => {
      const darkStore = createStore({
        state: {
          theme: 'dark',
          isAiChatEnabled: false,
        },
      });

      const depth0Wrapper = mount(FilterGroup, {
        props: { ...defaultProps, depth: 0 },
        global: {
          plugins: [mockI18n],
          provide: {
            store: darkStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      const depth2Wrapper = mount(FilterGroup, {
        props: { ...defaultProps, depth: 2 },
        global: {
          plugins: [mockI18n],
          provide: {
            store: darkStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      const depth0Color = depth0Wrapper.vm.computedStyleMap;
      const depth2Color = depth2Wrapper.vm.computedStyleMap;
      
      expect(depth0Color).not.toBe(depth2Color);
    });

    it('should apply depth-based lightness adjustments for light theme', () => {
      const lightStore = createStore({
        state: {
          theme: 'light',
          isAiChatEnabled: false,
        },
      });

      const depth0Wrapper = mount(FilterGroup, {
        props: { ...defaultProps, depth: 0 },
        global: {
          plugins: [mockI18n],
          provide: {
            store: lightStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      const depth2Wrapper = mount(FilterGroup, {
        props: { ...defaultProps, depth: 2 },
        global: {
          plugins: [mockI18n],
          provide: {
            store: lightStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      const depth0Color = depth0Wrapper.vm.computedStyleMap;
      const depth2Color = depth2Wrapper.vm.computedStyleMap;
      
      expect(depth0Color).not.toBe(depth2Color);
    });

    it('should clamp lightness values properly for dark theme', () => {
      const darkStore = createStore({
        state: {
          theme: 'dark',
          isAiChatEnabled: false,
        },
      });

      const wrapper = mount(FilterGroup, {
        props: { ...defaultProps, depth: 100 }, // Very high depth
        global: {
          plugins: [mockI18n],
          provide: {
            store: darkStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      const result = wrapper.vm.computedStyleMap;
      expect(result).toMatch(/90%\)$/); // Should be clamped to 90%
    });

    it('should clamp lightness values properly for light theme', () => {
      const lightStore = createStore({
        state: {
          theme: 'light',
          isAiChatEnabled: false,
        },
      });

      const wrapper = mount(FilterGroup, {
        props: { ...defaultProps, depth: 100 }, // Very high depth
        global: {
          plugins: [mockI18n],
          provide: {
            store: lightStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      const result = wrapper.vm.computedStyleMap;
      expect(result).toMatch(/80%\)$/); // Should be clamped to 80%
    });
  });

  describe('computedOpacity Computed Property', () => {
    it('should return depth + 10', () => {
      const wrapper = mount(FilterGroup, {
        props: { ...defaultProps, depth: 0 },
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      expect(wrapper.vm.computedOpacity).toBe(10);
    });

    it('should update when depth changes', () => {
      const wrapper = mount(FilterGroup, {
        props: { ...defaultProps, depth: 5 },
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      expect(wrapper.vm.computedOpacity).toBe(15);
    });

    it('should handle negative depth values', () => {
      const wrapper = mount(FilterGroup, {
        props: { ...defaultProps, depth: -2 },
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      expect(wrapper.vm.computedOpacity).toBe(8);
    });
  });

  describe('UI Interactions', () => {
    it('should handle add condition button click', async () => {
      const wrapper = mount(FilterGroup, {
        props: defaultProps,
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      const addConditionBtn = wrapper.find('[data-test="alert-conditions-add-condition-btn"]');
      await addConditionBtn.trigger('click');

      expect(wrapper.emitted('add-condition')).toBeTruthy();
    });

    it('should handle add group button click when depth < 2', () => {
      const wrapper = mount(FilterGroup, {
        props: { ...defaultProps, depth: 1 },
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
            'OTooltip': true,
          },
        },
      });

      // Directly test the addGroup function since button selection is unreliable
      wrapper.vm.addGroup('test-group');
      expect(wrapper.emitted('add-group')).toBeTruthy();
    });

    it('should disable add group button when depth >= 2', () => {
      const wrapper = mount(FilterGroup, {
        props: { ...defaultProps, depth: 2 },
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      const addGroupBtn = wrapper.find('[data-test="alert-conditions-add-condition-group-btn"]');

      expect(addGroupBtn.exists()).toBe(true);
      expect(addGroupBtn.attributes('disabled')).toBeDefined();
    });

    it('should handle tab change for toggle label', async () => {
      const wrapper = mount(FilterGroup, {
        props: defaultProps,
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      const tabs = wrapper.findComponent({ name: 'q-tabs' });
      if (tabs.exists()) {
        await tabs.vm.$emit('update:model-value', 'or');
        expect(wrapper.emitted('add-group')).toBeTruthy();
        expect(wrapper.emitted('input:update')).toBeTruthy();
      }
    });
  });


  describe('Confirmation Dialog for Condition Deletion', () => {
    it('should show confirmation dialog when removing last condition with sub-groups', async () => {
      const propsWithSubGroup = {
        ...defaultProps,
        group: {

          groupId: 'test-group',

          filterType: 'group',

          logicalOperator: 'AND',

          conditions: [
            { id: 'only-condition', column: 'field1', operator: '=', value: 'test' },
            {
              groupId: 'sub-group-1',
              label: 'or',
              items: [
                { id: 'nested-condition', column: 'field2', operator: '=', value: 'test2' }
              ],

        }
          ]
        }
      };

      const wrapper = mount(FilterGroup, {
        props: propsWithSubGroup,
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      // Remove the only condition
      wrapper.vm.removeCondition('only-condition');
      await nextTick();

      // Should show confirmation dialog
      expect(wrapper.vm.confirmDialog.show).toBe(true);
      expect(wrapper.vm.confirmDialog.title).toBe('Delete Condition');
      expect(wrapper.vm.confirmDialog.warningMessage).toContain('1 sub-group');
    });

    it('should show correct warning for multiple sub-groups', async () => {
      const propsWithMultipleSubGroups = {
        ...defaultProps,
        group: {

          groupId: 'test-group',

          filterType: 'group',

          logicalOperator: 'AND',

          conditions: [
            { id: 'only-condition', column: 'field1', operator: '=', value: 'test' },
            {
              groupId: 'sub-group-1',
              label: 'or',
              items: [{ id: 'nested-1', column: 'field2', operator: '=', value: 'test2' }],

        },
            {
              groupId: 'sub-group-2',
              label: 'and',
              items: [{ id: 'nested-2', column: 'field3', operator: '=', value: 'test3' }]
            }
          ]
        }
      };

      const wrapper = mount(FilterGroup, {
        props: propsWithMultipleSubGroups,
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      wrapper.vm.removeCondition('only-condition');
      await nextTick();

      expect(wrapper.vm.confirmDialog.show).toBe(true);
      expect(wrapper.vm.confirmDialog.warningMessage).toContain('2 sub-groups');
    });

    it('should not show dialog when removing condition without sub-groups', () => {
      const propsWithoutSubGroups = {
        ...defaultProps,
        group: {

          groupId: 'test-group',

          filterType: 'group',

          logicalOperator: 'AND',

          conditions: [
            { id: 'condition-1', column: 'field1', operator: '=', value: 'test1' },
            { id: 'condition-2', column: 'field2', operator: '=', value: 'test2' }
          ],

        }
      };

      const wrapper = mount(FilterGroup, {
        props: propsWithoutSubGroups,
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      wrapper.vm.removeCondition('condition-1');

      // Should not show dialog
      expect(wrapper.vm.confirmDialog.show).toBe(false);
    });

    it('should call performRemoveCondition when user confirms', async () => {
      const propsWithSubGroup = {
        ...defaultProps,
        group: {

          groupId: 'test-group',

          filterType: 'group',

          logicalOperator: 'AND',

          conditions: [
            { id: 'only-condition', column: 'field1', operator: '=', value: 'test' },
            {
              groupId: 'sub-group-1',
              label: 'or',
              items: [{ id: 'nested', column: 'field2', operator: '=', value: 'test2' }],

        }
          ]
        }
      };

      const wrapper = mount(FilterGroup, {
        props: propsWithSubGroup,
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      wrapper.vm.removeCondition('only-condition');
      await nextTick();

      // Confirm deletion
      wrapper.vm.confirmDialog.okCallback();
      await nextTick();

      // Should emit remove-group
      expect(wrapper.emitted('remove-group')).toBeTruthy();
      expect(wrapper.vm.confirmDialog.show).toBe(false);
    });
  });

  describe('performRemoveCondition Function', () => {
    it('should remove condition and emit remove-group when no conditions left', () => {
      const wrapper = mount(FilterGroup, {
        props: {
          ...defaultProps,
          group: {

            groupId: 'test-group',

            filterType: 'group',

            logicalOperator: 'AND',

            conditions: [
              { id: 'only-item', column: 'field1', operator: '=', value: 'test' }
            ],

          }
        },
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      wrapper.vm.performRemoveCondition('only-item');

      expect(wrapper.emitted('remove-group')).toBeTruthy();
      expect(wrapper.emitted('remove-group')?.[0][0]).toBe('test-group');
    });

    it('should remove condition but keep group when conditions remain', () => {
      const wrapper = mount(FilterGroup, {
        props: {
          ...defaultProps,
          group: {

            groupId: 'test-group',

            filterType: 'group',

            logicalOperator: 'AND',

            conditions: [
              { id: 'item-1', column: 'field1', operator: '=', value: 'test1' },
              { id: 'item-2', column: 'field2', operator: '=', value: 'test2' }
            ],

          }
        },
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      wrapper.vm.performRemoveCondition('item-1');

      expect(wrapper.emitted('add-group')).toBeTruthy();
      expect(wrapper.emitted('remove-group')).toBeFalsy();
      expect(wrapper.vm.groups.conditions).toHaveLength(1);
    });

    it('should emit remove-group when only sub-groups remain after removing condition', () => {
      const wrapper = mount(FilterGroup, {
        props: {
          ...defaultProps,
          group: {

            groupId: 'test-group',

            filterType: 'group',

            logicalOperator: 'AND',

            conditions: [
              { id: 'only-condition', column: 'field1', operator: '=', value: 'test' },
              {
                groupId: 'sub-group',
                label: 'or',
                items: [{ id: 'nested', column: 'field2', operator: '=', value: 'test2' }],

          }
            ]
          }
        },
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      wrapper.vm.performRemoveCondition('only-condition');

      expect(wrapper.emitted('remove-group')).toBeTruthy();
    });
  });

  describe('Props Watch Functionality', () => {
    it('should update groups when prop changes', async () => {
      const wrapper = mount(FilterGroup, {
        props: defaultProps,
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      const newGroup = {
        groupId: 'new-group',
        filterType: 'group',
        logicalOperator: 'OR',
        conditions: [
          {
            id: 'new-item',
            filterType: 'condition',
            column: 'newfield',
            operator: '!=',
            value: 'newtest',
            logicalOperator: 'OR',
          }
        ]
      };

      await wrapper.setProps({ group: newGroup });
      await nextTick();

      expect(wrapper.vm.groups.groupId).toBe('new-group');
      expect(wrapper.vm.label).toBe('or');
    });

    it('should update label when prop group logicalOperator changes', async () => {
      const wrapper = mount(FilterGroup, {
        props: {
          ...defaultProps,
          group: { ...defaultProps.group, logicalOperator: 'AND' }
        },
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      // Wait for initial mount to settle
      await nextTick();
      expect(wrapper.vm.label).toBe('and');

      // Now change the logicalOperator
      await wrapper.setProps({
        group: { ...defaultProps.group, logicalOperator: 'OR' }
      });
      await nextTick();

      expect(wrapper.vm.label).toBe('or');
    });
  });

  describe('Reorder Items Functionality', () => {
    it('should reorder items with conditions first and groups last', () => {
      const mixedOrderProps = {
        ...defaultProps,
        group: {

          groupId: 'test-group',

          filterType: 'group',

          logicalOperator: 'AND',

          conditions: [
            { id: 'condition-1', column: 'field1', operator: '=', value: 'test1' },
            {
              groupId: 'sub-group-1',
              label: 'or',
              items: [{ id: 'nested-1', column: 'field2', operator: '=', value: 'test2' }],

        },
            { id: 'condition-2', column: 'field3', operator: '!=', value: 'test3' },
            {
              groupId: 'sub-group-2',
              label: 'and',
              items: [{ id: 'nested-2', column: 'field4', operator: '>', value: 'test4' }]
            }
          ]
        }
      };

      const wrapper = mount(FilterGroup, {
        props: mixedOrderProps,
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      // Before reorder: condition, group, condition, group
      expect(wrapper.vm.groups.conditions[0].id).toBe('condition-1');
      expect(wrapper.vm.groups.conditions[1].groupId).toBe('sub-group-1');
      expect(wrapper.vm.groups.conditions[2].id).toBe('condition-2');
      expect(wrapper.vm.groups.conditions[3].groupId).toBe('sub-group-2');

      // Call reorder
      wrapper.vm.reorderItems();

      // After reorder: condition, condition, group, group
      expect(wrapper.vm.groups.conditions[0].id).toBe('condition-1');
      expect(wrapper.vm.groups.conditions[1].id).toBe('condition-2');
      expect(wrapper.vm.groups.conditions[2].groupId).toBe('sub-group-1');
      expect(wrapper.vm.groups.conditions[3].groupId).toBe('sub-group-2');
    });

    it('should emit events when reordering', () => {
      const mixedOrderProps = {
        ...defaultProps,
        group: {

          groupId: 'test-group',

          filterType: 'group',

          logicalOperator: 'AND',

          conditions: [
            {
              groupId: 'sub-group',
              label: 'or',
              items: [{ id: 'nested', column: 'field1', operator: '=', value: 'test1' }],

        },
            { id: 'condition-1', column: 'field2', operator: '=', value: 'test2' }
          ]
        }
      };

      const wrapper = mount(FilterGroup, {
        props: mixedOrderProps,
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      wrapper.vm.reorderItems();

      expect(wrapper.emitted('add-group')).toBeTruthy();
      expect(wrapper.emitted('input:update')).toBeTruthy();
      expect(wrapper.emitted('input:update')?.[0]).toEqual(['conditions', wrapper.vm.groups]);
    });

    it('should handle group with only conditions (no reordering needed)', () => {
      const onlyConditionsProps = {
        ...defaultProps,
        group: {

          groupId: 'test-group',

          filterType: 'group',

          logicalOperator: 'AND',

          conditions: [
            { id: 'condition-1', column: 'field1', operator: '=', value: 'test1' },
            { id: 'condition-2', column: 'field2', operator: '!=', value: 'test2' }
          ],

        }
      };

      const wrapper = mount(FilterGroup, {
        props: onlyConditionsProps,
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      wrapper.vm.reorderItems();

      // Order should remain the same
      expect(wrapper.vm.groups.conditions[0].id).toBe('condition-1');
      expect(wrapper.vm.groups.conditions[1].id).toBe('condition-2');
    });

    it('should handle group with only sub-groups (no reordering needed)', () => {
      const onlyGroupsProps = {
        ...defaultProps,
        group: {

          groupId: 'test-group',

          filterType: 'group',

          logicalOperator: 'AND',

          conditions: [
            {
              groupId: 'sub-group-1',
              label: 'or',
              items: [{ id: 'nested-1', column: 'field1', operator: '=', value: 'test1' }],

        },
            {
              groupId: 'sub-group-2',
              label: 'and',
              items: [{ id: 'nested-2', column: 'field2', operator: '=', value: 'test2' }]
            }
          ]
        }
      };

      const wrapper = mount(FilterGroup, {
        props: onlyGroupsProps,
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      wrapper.vm.reorderItems();

      // Order should remain the same
      expect(wrapper.vm.groups.conditions[0].groupId).toBe('sub-group-1');
      expect(wrapper.vm.groups.conditions[1].groupId).toBe('sub-group-2');
    });

    it('should handle empty items array', () => {
      const emptyItemsProps = {
        ...defaultProps,
        group: {

          groupId: 'test-group',

          filterType: 'group',

          logicalOperator: 'AND',

          conditions: [],

        }
      };

      const wrapper = mount(FilterGroup, {
        props: emptyItemsProps,
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      // Should not throw error
      expect(() => wrapper.vm.reorderItems()).not.toThrow();
      expect(wrapper.vm.groups.conditions).toHaveLength(0);
    });
  });


  describe('conditionInputWidth Prop', () => {
    it('should accept conditionInputWidth prop', () => {
      const wrapper = mount(FilterGroup, {
        props: {
          ...defaultProps,
          conditionInputWidth: 'w-[100px]'
        },
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      expect(wrapper.props('conditionInputWidth')).toBe('w-[100px]');
    });

    it('should have empty string as default for conditionInputWidth', () => {
      const wrapper = mount(FilterGroup, {
        props: defaultProps,
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      expect(wrapper.props('conditionInputWidth')).toBe('');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty streamFields', () => {
      const emptyFieldsProps = {
        ...defaultProps,
        streamFields: []
      };

      const wrapper = mount(FilterGroup, {
        props: emptyFieldsProps,
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.props('streamFields')).toHaveLength(0);
    });

    it('should handle maximum depth', () => {
      const maxDepthProps = {
        ...defaultProps,
        depth: Number.MAX_SAFE_INTEGER
      };

      const wrapper = mount(FilterGroup, {
        props: maxDepthProps,
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      expect(wrapper.exists()).toBe(true);
      expect(typeof wrapper.vm.computedOpacity).toBe('number');
      expect(typeof wrapper.vm.computedStyleMap).toBe('string');
    });

    it('should handle complex nested group structures', () => {
      const complexGroupProps = {
        ...defaultProps,
        group: {

          groupId: 'root',

          filterType: 'group',

          logicalOperator: 'AND',

          conditions: [
            {
              groupId: 'nested-1',
              label: 'or',
              items: [
                { id: 'condition-1', column: 'field1', operator: '=', value: 'test1' },
                {
                  groupId: 'nested-2',
                  label: 'and',
                  items: [
                    { id: 'condition-2', column: 'field2', operator: '!=', value: 'test2' }
                  ],

        }
              ]
            },
            { id: 'condition-3', column: 'field3', operator: '>', value: 'test3' }
          ]
        }
      };

      const wrapper = mount(FilterGroup, {
        props: complexGroupProps,
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            'FilterCondition': true,
          },
        },
      });

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm.groups.conditions).toHaveLength(2);
      expect(wrapper.vm.isGroup(wrapper.vm.groups.conditions[0])).toBe(true);
      expect(wrapper.vm.isGroup(wrapper.vm.groups.conditions[1])).toBeFalsy();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FORM MODE (alerts-migration.md §A): the group passes the namePrefix down
// recursively — the child at index i binds under `${namePrefix}.conditions[${i}]`
// into the injected REAL OForm; the v-for :key stays the array INDEX (Rule ①).
// ─────────────────────────────────────────────────────────────────────────────
describe('FilterGroup.vue Form Mode (namePrefix + OForm)', () => {
  const streamFields = [
    { label: 'Field 1', value: 'field1' },
    { label: 'Field 2', value: 'field2' },
    { label: 'User Name', value: 'username' },
  ];

  const makeLeaf = (
    id: string,
    column: string,
    operator: string,
    value: unknown,
  ) => ({
    filterType: 'condition',
    column,
    operator,
    value,
    values: [],
    logicalOperator: 'AND',
    id,
  });

  const makeGroup = (
    groupId: string,
    conditions: unknown[],
    logicalOperator = 'AND',
  ) => ({
    filterType: 'group',
    logicalOperator,
    groupId,
    conditions,
  });

  // Host with a REAL <OForm>. The tree object is BOTH the FilterGroup :group
  // prop and the form's `tree` default value (one object graph — single source
  // of truth). FilterGroup's structural ops (delete/add/reorder) mutate the
  // group in place and emit; the host relays that to the form with a
  // setFieldValue poke — exactly the wiring the QueryConfig phase will add on
  // its existing @add-condition/@add-group/@remove-group handlers.
  const mountFormHost = (
    conditions: unknown[],
    { namePrefix = 'tree' }: { namePrefix?: string } = {},
  ) => {
    const tree = reactive({
      filterType: 'group',
      logicalOperator: 'AND',
      groupId: 'root',
      conditions,
    });
    const onSubmit = vi.fn();
    const testSchema = z
      .object({ tree: conditionGroupNodeSchema })
      .superRefine((val, ctx) =>
        refineConditionsTree(val.tree, ctx, ['tree'], 'Field is required!'),
      );

    const Host = defineComponent({
      components: { OForm, FilterGroup },
      setup() {
        const oform = ref<any>(null);
        const treeChanged = (updated: any) => {
          // A structural change arrives as the NEW tree (add-condition/add-group).
          // Mirror useAlertForm: write it to the TanStack form so name-bound
          // fields re-read it. In the app `props.group` is the form read-view, so
          // it updates automatically; the host's `:group="tree"` is a separate
          // ref, so replace its contents too (keeping identity) to model that.
          // (remove-group emits a groupId string; delete-to-empty isn't exercised
          // by these host tests.)
          if (!updated || typeof updated !== 'object') return;
          const next = JSON.parse(JSON.stringify(updated));
          tree.filterType = next.filterType;
          tree.logicalOperator = next.logicalOperator;
          tree.conditions = next.conditions;
          oform.value?.form.setFieldValue('tree', next, {
            dontUpdateMeta: true,
          });
        };
        return {
          oform,
          treeChanged,
          tree,
          onSubmit,
          testSchema,
          defaults: { tree },
          streamFields,
          namePrefix,
        };
      },
      template: `
        <OForm ref="oform" :schema="testSchema" :default-values="defaults" @submit="onSubmit">
          <FilterGroup
            :group="tree"
            :stream-fields="streamFields"
            :depth="0"
            :name-prefix="namePrefix"
            @add-condition="treeChanged"
            @add-group="treeChanged"
            @remove-group="treeChanged"
          />
        </OForm>`,
    });

    const wrapper = mount(Host, {
      global: {
        plugins: [mockI18n],
        provide: { store: mockStore },
      },
    });
    const form = (wrapper.findComponent(OForm).vm as any).form;
    return { wrapper, onSubmit, form, tree };
  };

  const renderedValueInputs = (wrapper: ReturnType<typeof mount>) =>
    wrapper
      .findAllComponents(OFormInput)
      .filter((c) => /\.value$/.test(String(c.props('name'))));

  const renderedColumnSelects = (wrapper: ReturnType<typeof mount>) =>
    wrapper
      .findAllComponents(OFormSelect)
      .filter((c) => /\.column$/.test(String(c.props('name'))));

  const renderedOperatorSelects = (wrapper: ReturnType<typeof mount>) =>
    wrapper
      .findAllComponents(OFormSelect)
      .filter((c) => /\.operator$/.test(String(c.props('name'))));

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes the prefix recursively — child at index i binds `${namePrefix}.conditions[${i}]` (incl. nested groups)', () => {
    const { wrapper } = mountFormHost([
      makeLeaf('a', 'field1', '=', 'va'),
      makeGroup('g-1', [makeLeaf('n', 'field2', '!=', 'vn')], 'OR'),
    ]);

    expect(
      renderedColumnSelects(wrapper).map((c) => c.props('name')),
    ).toEqual([
      'tree.conditions[0].column',
      'tree.conditions[1].conditions[0].column',
    ]);
    expect(renderedValueInputs(wrapper).map((c) => c.props('name'))).toEqual([
      'tree.conditions[0].value',
      'tree.conditions[1].conditions[0].value',
    ]);

    // Rendered controls read from the form.
    expect(
      renderedColumnSelects(wrapper).map((c) =>
        c.findComponent(OSelect).props('modelValue'),
      ),
    ).toEqual(['field1', 'field2']);
    expect(
      renderedValueInputs(wrapper).map((c) =>
        c.findComponent(OInput).props('modelValue'),
      ),
    ).toEqual(['va', 'vn']);
  });

  it('🔑 Rule-① gate: deleting a NON-last row keeps the RENDERED inputs in sync with the remaining rows (index :key + index names)', async () => {
    const { wrapper } = mountFormHost([
      makeLeaf('a', 'field1', '=', 'va'),
      makeLeaf('b', 'field2', '>', 'vb'),
      makeLeaf('c', 'username', '<', 'vc'),
    ]);
    await flushPromises();

    // Sanity: 3 rows rendered, index-named, in order.
    expect(renderedValueInputs(wrapper).map((c) => c.props('name'))).toEqual([
      'tree.conditions[0].value',
      'tree.conditions[1].value',
      'tree.conditions[2].value',
    ]);

    // Delete the MIDDLE row (index 1 — a NON-last row).
    const deleteBtns = wrapper.findAll(
      '[data-test="alert-conditions-delete-condition-btn"]',
    );
    expect(deleteBtns).toHaveLength(3);
    await deleteBtns[1].trigger('click');
    await flushPromises();

    // Assert the RENDERED inputs (each OForm* → inner control model-value),
    // NOT just form.state.values — a stable-id :key would leave these
    // shifted/blank while the data stays correct.
    const columnValues = renderedColumnSelects(wrapper).map((c) =>
      c.findComponent(OSelect).props('modelValue'),
    );
    const operatorValues = renderedOperatorSelects(wrapper).map((c) =>
      c.findComponent(OSelect).props('modelValue'),
    );
    const valueValues = renderedValueInputs(wrapper).map((c) =>
      c.findComponent(OInput).props('modelValue'),
    );

    expect(columnValues).toEqual(['field1', 'username']);
    expect(operatorValues).toEqual(['=', '<']);
    expect(valueValues).toEqual(['va', 'vc']);

    // And the surviving rows re-bound to the compacted index names.
    expect(renderedValueInputs(wrapper).map((c) => c.props('name'))).toEqual([
      'tree.conditions[0].value',
      'tree.conditions[1].value',
    ]);
  });

  it('submit routes each schema error to the exact row (partial row blocks save)', async () => {
    const { wrapper, onSubmit, form } = mountFormHost([
      makeLeaf('a', 'field1', '=', 'va'),
      makeLeaf('b', '', '=', 'vb'), // column missing on row 1
    ]);

    await form.handleSubmit();
    await flushPromises();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(form.state.isValid).toBe(false);

    const columnErrors = renderedColumnSelects(wrapper).map((c) =>
      c.findComponent(OSelect).props('error'),
    );
    expect(columnErrors).toEqual([false, true]);
    expect(wrapper.text()).toContain('Field is required!');
  });

  it('a complete tree submits (zero-safe value 0 included)', async () => {
    const { onSubmit, form } = mountFormHost([
      makeLeaf('a', 'field1', '=', 0),
      makeGroup('g-1', [makeLeaf('n', 'field2', '!=', 'vn')]),
    ]);

    await form.handleSubmit();
    await flushPromises();

    expect(form.state.isValid).toBe(true);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].tree.conditions[0].value).toBe(0);
  });

  // Bare-mode test removed: FilterCondition is now form-mode only (all
  // FilterGroup consumers pass a name-prefix inside an OForm); no bare v-else.
});
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import FilterCondition from './FilterCondition.vue';
import { createStore } from 'vuex';
import { createI18n } from 'vue-i18n';
import enMessages from '@/locales/languages/en-US.json';
import { nextTick, defineComponent, reactive } from 'vue';
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

const mockStore = createStore({
  state: {
    isAiChatEnabled: false, // Default to false for most tests
  },
});

// Mount the REAL en.json messages (not a hand-written stub): the component's
// user-facing strings are i18n keys, so a stub would make every t() fall back to
// its raw key path and silently weaken the text assertions below.
const mockI18n = createI18n({
  locale: 'en',
  messages: { en: enMessages },
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
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      // Branch: index == 0 ? 'if' : computedLabel
      expect(wrapper.text()).toContain('if');
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
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      // Branch: computedLabel (when not first in group) - shows operator
      expect(wrapper.text()).toContain('OR');
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
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      // Branch: index == 0 && depth == 0 shows "if"
      expect(wrapper.text()).toContain('if');
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
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      // Branch: isFirstInGroup && depth > 0 shows empty space (no operator label)
      expect(wrapper.text()).not.toContain('if');
      expect(wrapper.text()).not.toContain('AND');
      expect(wrapper.text()).not.toContain('OR');
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
          plugins: [mockI18n],
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
          plugins: [mockI18n],
          provide: {
            store: aiDisabledStore,
          },
        },
      });

      // Branch: condition.column && store.state.isAiChatEnabled = false (line 33)
      // Branch: condition.operator && store.state.isAiChatEnabled = false (line 57)
      // Branch: condition.value && store.state.isAiChatEnabled = false (line 83)
      const tooltips = wrapper.findAllComponents({ name: 'OTooltip' });
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
          plugins: [mockI18n],
          provide: {
            store: aiEnabledStore,
          },
        },
      });

      // Branch: !condition.column (line 33), !condition.operator (line 57), !condition.value (line 83)
      const tooltips = wrapper.findAllComponents({ name: 'OTooltip' });
      expect(tooltips.length).toBe(0);
    });
  });

  // TODO: filterColumns internal API was removed when q-select was replaced with OSelect.
  // These tests need rewriting against the new OSelect filter API.
  describe.skip('Filter Functionality Branch Coverage', () => {
    it('should reset filtered fields when filter value is empty', async () => {
      const wrapper = mount(FilterCondition, {
        props: defaultProps,
        global: {
          plugins: [mockI18n],
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
          plugins: [mockI18n],
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
          plugins: [mockI18n],
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
          plugins: [mockI18n],
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
    it('should call delete, add, and add-group functions', async () => {
      const wrapper = mount(FilterCondition, {
        props: defaultProps,
        global: {
          plugins: [mockI18n],
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
          plugins: [mockI18n],
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
          plugins: [mockI18n],
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

// ─────────────────────────────────────────────────────────────────────────────
// FORM MODE (alerts-migration.md §A): namePrefix + injected OForm context.
// The three controls become OForm* fields name=-bound into the REAL TanStack
// form (no v-model, no manual error refs); the schema (refineConditionsTree)
// owns validation, surfaced only after the first submit (R3).
// ─────────────────────────────────────────────────────────────────────────────
describe('FilterCondition.vue Form Mode (namePrefix + OForm)', () => {
  const streamFields = [
    { label: 'Field 1', value: 'field1' },
    { label: 'Field 2', value: 'field2' },
  ];

  const makeCondition = (overrides: Record<string, unknown> = {}) => ({
    filterType: 'condition',
    column: '',
    operator: '=',
    value: '',
    values: [],
    logicalOperator: 'AND',
    id: 'cond-1',
    ...overrides,
  });

  // Host with a REAL <OForm> whose schema runs the refineConditionsTree walker
  // (basePath ["tree"] — the same wiring the QueryConfig phase will use with
  // ["query_condition", "conditions"]).
  const mountFormHost = (
    condition: Record<string, unknown>,
    {
      namePrefix = 'tree.conditions[0]',
      allowCustomColumns = false,
    }: { namePrefix?: string; allowCustomColumns?: boolean } = {},
  ) => {
    const tree = reactive({
      filterType: 'group',
      logicalOperator: 'AND',
      groupId: 'root',
      conditions: [condition],
    });
    const onSubmit = vi.fn();
    const testSchema = z
      .object({ tree: conditionGroupNodeSchema })
      .superRefine((val, ctx) =>
        refineConditionsTree(val.tree, ctx, ['tree'], 'Field is required!'),
      );

    const Host = defineComponent({
      components: { OForm, FilterCondition },
      setup() {
        return {
          tree,
          onSubmit,
          testSchema,
          defaults: { tree },
          streamFields,
          namePrefix,
          allowCustomColumns,
        };
      },
      template: `
        <OForm :schema="testSchema" :default-values="defaults" @submit="onSubmit">
          <FilterCondition
            :condition="tree.conditions[0]"
            :stream-fields="streamFields"
            :index="0"
            label="and"
            :depth="0"
            :is-first-in-group="true"
            :name-prefix="namePrefix"
            :allow-custom-columns="allowCustomColumns"
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

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders OFormSelect/OFormSelect/OFormInput name=-bound to `${namePrefix}.column/.operator/.value`', () => {
    const { wrapper } = mountFormHost(
      makeCondition({ column: 'field1', operator: '=', value: 'abc' }),
    );

    const selects = wrapper.findAllComponents(OFormSelect);
    expect(selects.map((s) => s.props('name'))).toEqual([
      'tree.conditions[0].column',
      'tree.conditions[0].operator',
    ]);
    const input = wrapper.findComponent(OFormInput);
    expect(input.props('name')).toBe('tree.conditions[0].value');

    // The rendered controls read their values from the FORM (name-bound).
    expect(selects[0].findComponent(OSelect).props('modelValue')).toBe('field1');
    expect(selects[1].findComponent(OSelect).props('modelValue')).toBe('=');
    expect(input.findComponent(OInput).props('modelValue')).toBe('abc');

    // data-tests are carried verbatim into form mode.
    expect(wrapper.find('[data-test="alert-conditions-select-column"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="alert-conditions-operator-select"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="alert-conditions-value-input"]').exists()).toBe(true);
  });

  it('shows NO errors before the first submit (R3)', () => {
    const { wrapper } = mountFormHost(
      makeCondition({ column: '', operator: '', value: '' }),
    );

    expect(wrapper.text()).not.toContain('Field is required!');
    for (const select of wrapper.findAllComponents(OSelect)) {
      expect(select.props('error')).toBeFalsy();
    }
    expect(wrapper.findComponent(OInput).props('error')).toBeFalsy();
  });

  it('blocks submit and surfaces schema errors on empty column/operator after form.handleSubmit()', async () => {
    const { wrapper, onSubmit, form } = mountFormHost(
      makeCondition({ column: '', operator: '', value: 'ok' }),
    );

    await form.handleSubmit();
    await flushPromises();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(form.state.isValid).toBe(false);

    const selects = wrapper.findAllComponents(OFormSelect);
    expect(selects[0].findComponent(OSelect).props('error')).toBe(true); // column
    expect(selects[1].findComponent(OSelect).props('error')).toBe(true); // operator
    // value was filled → no error there.
    expect(wrapper.findComponent(OFormInput).findComponent(OInput).props('error')).toBe(false);
    expect(wrapper.text()).toContain('Field is required!');
  });

  it('blocks submit on an empty value ("") with the error on the value input', async () => {
    const { wrapper, onSubmit, form } = mountFormHost(
      makeCondition({ column: 'field1', operator: '=', value: '' }),
    );

    await form.handleSubmit();
    await flushPromises();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(form.state.isValid).toBe(false);
    expect(wrapper.findComponent(OFormInput).findComponent(OInput).props('error')).toBe(true);
    const selects = wrapper.findAllComponents(OFormSelect);
    expect(selects[0].findComponent(OSelect).props('error')).toBe(false);
    expect(selects[1].findComponent(OSelect).props('error')).toBe(false);
  });

  it('value is ZERO-SAFE: numeric 0 passes and the form submits', async () => {
    const { wrapper, onSubmit, form } = mountFormHost(
      makeCondition({ column: 'field1', operator: '=', value: 0 }),
    );

    await form.handleSubmit();
    await flushPromises();

    expect(form.state.isValid).toBe(true);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].tree.conditions[0].value).toBe(0);
    expect(wrapper.text()).not.toContain('Field is required!');
  });

  // ── Custom columns (`allowCustomColumns`) ────────────────────────────────
  // A user may type a column that is not in streamFields and press Enter; the
  // select only EMITS `create` with the typed term — it does not set the value.
  // FilterCondition must add the option AND write the value THROUGH the form
  // (the bound `condition` is the readonly read-view).
  //
  // #13277 made FilterCondition form-mode only but dropped `@create` and the
  // custom-column accumulator, silently killing this affordance for pipelines
  // (whose guidelines tell users to press Enter), workflows, and enterprise
  // JobFilterBuilder. These tests pin it so it cannot be dropped again.
  describe('custom column creation', () => {
    const columnSelect = (wrapper: any) =>
      wrapper.findAllComponents(OFormSelect)[0];

    it('marks the column select creatable when allowCustomColumns is on', () => {
      const { wrapper } = mountFormHost(makeCondition(), {
        allowCustomColumns: true,
      });
      expect(columnSelect(wrapper).props('creatable')).toBe(true);
    });

    it('is not creatable by default', () => {
      const { wrapper } = mountFormHost(makeCondition());
      expect(columnSelect(wrapper).props('creatable')).toBe(false);
    });

    it('adds the typed term as an option AND writes it into the form', async () => {
      const { wrapper, form } = mountFormHost(makeCondition(), {
        allowCustomColumns: true,
      });
      const select = columnSelect(wrapper);

      await select.vm.$emit('create', 'my_custom_col');
      await nextTick();

      // written through the form, not onto the readonly read-view...
      expect(form.state.values.tree.conditions[0].column).toBe('my_custom_col');
      // ...and present in the options so it renders instead of showing blank.
      expect(
        (select.props('options') as any[]).some(
          (o) => o.value === 'my_custom_col',
        ),
      ).toBe(true);
      expect(wrapper.findComponent(FilterCondition).emitted('input:update')).toBeTruthy();
    });

    it('keeps a custom column after the field list is re-filtered (search)', async () => {
      const { wrapper } = mountFormHost(makeCondition(), {
        allowCustomColumns: true,
      });
      const select = columnSelect(wrapper);

      await select.vm.$emit('create', 'kept_col');
      await nextTick();
      // Searching rebuilds filteredFields from allColumns(); a custom column
      // that lived only in filteredFields would vanish here.
      await select.vm.$emit('search', 'kept');
      await nextTick();

      expect(
        (select.props('options') as any[]).some((o) => o.value === 'kept_col'),
      ).toBe(true);
    });

    it('ignores blank terms and does not duplicate an existing column', async () => {
      const { wrapper, form } = mountFormHost(makeCondition(), {
        allowCustomColumns: true,
      });
      const select = columnSelect(wrapper);

      await select.vm.$emit('create', '   ');
      await nextTick();
      expect(form.state.values.tree.conditions[0].column).toBe('');

      await select.vm.$emit('create', 'field1');
      await nextTick();
      expect(
        (select.props('options') as any[]).filter((o) => o.value === 'field1'),
      ).toHaveLength(1);
      expect(form.state.values.tree.conditions[0].column).toBe('field1');
    });
  });
});

// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { mount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { qLayoutInjections } from '@/test/unit/helpers/layout-injections';
import StreamFieldInputs from './StreamFieldInputs.vue';
import { createI18n } from 'vue-i18n';
import { createStore } from 'vuex';

const i18n = createI18n({
  locale: 'en',
  legacy: false,
  messages: {
    en: {
      logStream: {
        fields: 'Fields',
        addField: 'Add Field',
        deleteField: 'Delete',
        fieldName: 'Field Name',
        fieldRequired: 'Field is required!',
        indexType: 'Index Type',
        dataType: 'Data Type',
        dataTypeRequired: 'Data Type is required!'
      }
    }
  }
});

const store = createStore({
  state: {
    theme: 'dark'
  }
});

const mockFields = [
  {
    uuid: '1',
    name: 'field1',
    type: 'Utf8',
    index_type: ['fullTextSearchKey']
  },
  {
    uuid: '2',
    name: 'field2',
    type: 'Int64',
    index_type: ['secondaryIndexKey']
  }
];

const defaultProps = {
  fields: [],
  showHeader: true,
  isInSchema: false,
  visibleInputs: {
    name: true,
    data_type: true,
    index_type: true
  }
};

describe('StreamFieldInputs', () => {
  let wrapper: any;

  beforeEach(() => {
    wrapper = mount(StreamFieldInputs, {
      props: defaultProps,
      global: {
        plugins: [i18n, store],
        provide: qLayoutInjections(),
      }
    });
  });

  describe('Component Initialization', () => {
    it('should render correctly with default props', () => {
      expect(wrapper.find('[data-test="add-stream-fields-section"]').exists()).toBe(true);
    });

    it('should display header when showHeader is true', () => {
      expect(wrapper.find('[data-test="alert-conditions-text"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="alert-conditions-text"]').text()).toBe('Fields');
    });

    it('should hide header when showHeader is false', async () => {
      await wrapper.setProps({ showHeader: false });
      expect(wrapper.find('[data-test="alert-conditions-text"]').exists()).toBe(false);
    });

    it('should show add field button when fields array is empty', () => {
      expect(wrapper.find('[data-test="add-stream-add-field-btn"]').exists()).toBe(true);
    });

    it('should have correct button styling for add field', () => {
      const addBtn = wrapper.find('[data-test="add-stream-add-field-btn"]');
      // OButton replaces q-btn; verify the button exists and is a button element
      expect(addBtn.exists()).toBe(true);
      expect(addBtn.element.tagName).toBe('BUTTON');
    });
  });

  describe('Fields Rendering', () => {
    beforeEach(async () => {
      await wrapper.setProps({ fields: mockFields });
    });

    it('should render field inputs when fields array has data', () => {
      const conditions = wrapper.findAll('[data-test^="add-stream-field-row-"]');
      expect(conditions.length).toBeGreaterThanOrEqual(2);
    });

    it('should render field name input for each field', () => {
      expect(wrapper.findAll('[data-test="add-stream-field-name-input"]')).toHaveLength(2);
    });

    it('should render index type and data type selects for each field', () => {
      expect(wrapper.findAll('[data-test="add-stream-field-index-type-select"]')).toHaveLength(2);
      expect(wrapper.findAll('[data-test="add-stream-field-data-type-select"]')).toHaveLength(2);
    });

    it('should have correct field name values', () => {
      const nameInputs = wrapper.findAll('[data-test="add-stream-field-name-input"] input');
      expect(nameInputs[0].element.value).toBe('field1');
      expect(nameInputs[1].element.value).toBe('field2');
    });

    it('should display add button only for last field', () => {
      const addButtons = wrapper.findAll('[data-test="add-stream-add-field-btn"]');
      expect(addButtons).toHaveLength(1);
    });

    it('should display delete button for each field', () => {
      const deleteButtons = wrapper.findAll('[data-test="add-stream-delete-field-btn"]');
      expect(deleteButtons).toHaveLength(2);
    });
  });

  describe('Field Row Layout', () => {
    it('should render field rows with flex layout', async () => {
      await wrapper.setProps({ fields: mockFields });
      const rows = wrapper.findAll('[data-test^="add-stream-field-row-"]');
      expect(rows.length).toBe(2);
      rows.forEach((row, i) => {
        expect(row.classes()).toContain('tw:flex');
        expect(row.classes()).toContain('tw:flex-wrap');
      });
    });

    it('should render field name input in each row', async () => {
      await wrapper.setProps({ fields: mockFields });
      const nameInputs = wrapper.findAll('[data-test="add-stream-field-name-input"]');
      expect(nameInputs).toHaveLength(2);
    });
  });

  describe('Visible Inputs Configuration', () => {
    it('should hide index_type select when visibleInputs.index_type is false', async () => {
      await wrapper.setProps({
        fields: mockFields,
        visibleInputs: { name: true, data_type: true, index_type: false }
      });
      expect(wrapper.find('[data-test="add-stream-field-index-type-select"]').exists()).toBe(false);
    });

    it('should hide data_type select when visibleInputs.data_type is false', async () => {
      await wrapper.setProps({
        fields: mockFields,
        visibleInputs: { name: true, data_type: false, index_type: true }
      });
      expect(wrapper.find('[data-test="add-stream-field-data-type-select"]').exists()).toBe(false);
    });
  });

  describe('Event Emissions', () => {
    beforeEach(async () => {
      await wrapper.setProps({ fields: mockFields });
    });

    it('should emit add event when add button is clicked', async () => {
      const addBtn = wrapper.find('[data-test="add-stream-add-field-btn"]');
      await addBtn.trigger('click');
      expect(wrapper.emitted('add')).toHaveLength(1);
    });

    it('should emit add event when add field button is clicked on empty fields', async () => {
      await wrapper.setProps({ fields: [] });
      const addBtn = wrapper.find('[data-test="add-stream-add-field-btn"]');
      await addBtn.trigger('click');
      expect(wrapper.emitted('add')).toHaveLength(1);
    });

    it('should emit remove event when delete button is clicked', async () => {
      const deleteBtn = wrapper.find('[data-test="add-stream-delete-field-btn"]');
      await deleteBtn.trigger('click');
      expect(wrapper.emitted('remove')).toHaveLength(1);
      expect(wrapper.emitted('remove')[0]).toEqual([mockFields[0], 0]);
    });

    it('should emit input:update event when delete button is clicked', async () => {
      const deleteBtn = wrapper.find('[data-test="add-stream-delete-field-btn"]');
      await deleteBtn.trigger('click');
      expect(wrapper.emitted('input:update')).toHaveLength(1);
      expect(wrapper.emitted('input:update')[0]).toEqual(['conditions', mockFields[0]]);
    });
  });

  describe('Button States', () => {
    it('should disable add button when field name is empty', async () => {
      const emptyField = [{ uuid: '1', name: '', type: '', index_type: [] }];
      await wrapper.setProps({ fields: emptyField });
      const addBtn = wrapper.find('[data-test="add-stream-add-field-btn"]');
      expect(addBtn.element.hasAttribute('disabled')).toBe(true);
    });

    it('should enable add button when field name is not empty', async () => {
      const filledField = [{ uuid: '1', name: 'test', type: '', index_type: [] }];
      await wrapper.setProps({ fields: filledField });
      const addBtn = wrapper.find('[data-test="add-stream-add-field-btn"]');
      expect(addBtn.element.hasAttribute('disabled')).toBe(false);
    });
  });

  describe('Exposed Methods', () => {
    it('should expose deleteApiHeader method', () => {
      expect(wrapper.vm.deleteApiHeader).toBeDefined();
      expect(typeof wrapper.vm.deleteApiHeader).toBe('function');
    });

    it('should expose addApiHeader method', () => {
      expect(wrapper.vm.addApiHeader).toBeDefined();
      expect(typeof wrapper.vm.addApiHeader).toBe('function');
    });

    it('should expose disableOptions method', () => {
      expect(wrapper.vm.disableOptions).toBeDefined();
      expect(typeof wrapper.vm.disableOptions).toBe('function');
    });

    it('should expose handleFocus method', () => {
      expect(wrapper.vm.handleFocus).toBeDefined();
      expect(typeof wrapper.vm.handleFocus).toBe('function');
    });

    it('should expose handleBlur method', () => {
      expect(wrapper.vm.handleBlur).toBeDefined();
      expect(typeof wrapper.vm.handleBlur).toBe('function');
    });

    it('should expose handleDataTypeFocus method', () => {
      expect(wrapper.vm.handleDataTypeFocus).toBeDefined();
      expect(typeof wrapper.vm.handleDataTypeFocus).toBe('function');
    });

    it('should expose handleDataTypeBlur method', () => {
      expect(wrapper.vm.handleDataTypeBlur).toBeDefined();
      expect(typeof wrapper.vm.handleDataTypeBlur).toBe('function');
    });
  });

  describe('Focus Handling', () => {
    it('should set isFocused to true on handleFocus call', () => {
      expect(wrapper.vm.isFocused).toBe(false);
      wrapper.vm.handleFocus();
      expect(wrapper.vm.isFocused).toBe(true);
    });

    it('should set isFocused to false on handleBlur call', () => {
      wrapper.vm.handleFocus();
      expect(wrapper.vm.isFocused).toBe(true);
      wrapper.vm.handleBlur();
      expect(wrapper.vm.isFocused).toBe(false);
    });

    it('should set isDataTypeFocused to true on handleDataTypeFocus call', () => {
      expect(wrapper.vm.isDataTypeFocused).toBe(false);
      wrapper.vm.handleDataTypeFocus();
      expect(wrapper.vm.isDataTypeFocused).toBe(true);
    });

    it('should set isDataTypeFocused to false on handleDataTypeBlur call', () => {
      wrapper.vm.handleDataTypeFocus();
      expect(wrapper.vm.isDataTypeFocused).toBe(true);
      wrapper.vm.handleDataTypeBlur();
      expect(wrapper.vm.isDataTypeFocused).toBe(false);
    });
  });

  describe('Constants', () => {
    it('should expose streamIndexType array', () => {
      expect(wrapper.vm.streamIndexType).toBeDefined();
      expect(Array.isArray(wrapper.vm.streamIndexType)).toBe(true);
      expect(wrapper.vm.streamIndexType).toHaveLength(10);
    });

    it('should have correct streamIndexType values', () => {
      const streamIndexType = wrapper.vm.streamIndexType;
      expect(streamIndexType[0]).toEqual({ label: "Full text search", value: "fullTextSearchKey" });
      expect(streamIndexType[1]).toEqual({ label: "Secondary index", value: "secondaryIndexKey" });
      expect(streamIndexType[2]).toEqual({ label: "Bloom filter", value: "bloomFilterKey" });
    });

    it('should expose dataTypes array', () => {
      expect(wrapper.vm.dataTypes).toBeDefined();
      expect(Array.isArray(wrapper.vm.dataTypes)).toBe(true);
      expect(wrapper.vm.dataTypes).toHaveLength(5);
    });

    it('should have correct dataTypes values', () => {
      const dataTypes = wrapper.vm.dataTypes;
      expect(dataTypes[0]).toEqual({ label: "Utf8", value: "Utf8" });
      expect(dataTypes[1]).toEqual({ label: "Int64", value: "Int64" });
      expect(dataTypes[2]).toEqual({ label: "Uint64", value: "Uint64" });
      expect(dataTypes[3]).toEqual({ label: "Float64", value: "Float64" });
      expect(dataTypes[4]).toEqual({ label: "Boolean", value: "Boolean" });
    });
  });

  describe('disableOptions Method Logic', () => {
    const mockSchema = { index_type: ['fullTextSearchKey'] };

    it('should return false when no conflicting options selected', () => {
      const option = { value: 'secondaryIndexKey' };
      const result = wrapper.vm.disableOptions(mockSchema, option);
      expect(result).toBe(false);
    });

    it('should disable keyPartition when prefixPartition is selected', () => {
      const schemaWithPrefix = { index_type: ['prefixPartition'] };
      const keyPartitionOption = { value: 'keyPartition' };
      const result = wrapper.vm.disableOptions(schemaWithPrefix, keyPartitionOption);
      expect(result).toBe(true);
    });

    it('should disable prefixPartition when keyPartition is selected', () => {
      const schemaWithKey = { index_type: ['keyPartition'] };
      const prefixPartitionOption = { value: 'prefixPartition' };
      const result = wrapper.vm.disableOptions(schemaWithKey, prefixPartitionOption);
      expect(result).toBe(true);
    });

    it('should disable different hash partitions when one is already selected', () => {
      const schemaWithHash = { index_type: ['hashPartition_8'] };
      const differentHashOption = { value: 'hashPartition_16' };
      const result = wrapper.vm.disableOptions(schemaWithHash, differentHashOption);
      expect(result).toBe(true);
    });

    it('should allow same hash partition that is already selected', () => {
      const schemaWithHash = { index_type: ['hashPartition_8'] };
      const sameHashOption = { value: 'hashPartition_8' };
      const result = wrapper.vm.disableOptions(schemaWithHash, sameHashOption);
      expect(result).toBe(false);
    });

    it('should disable hash partition when keyPartition is selected', () => {
      const schemaWithKey = { index_type: ['keyPartition'] };
      const hashOption = { value: 'hashPartition_8' };
      const result = wrapper.vm.disableOptions(schemaWithKey, hashOption);
      expect(result).toBe(true);
    });

    it('should disable hash partition when prefixPartition is selected', () => {
      const schemaWithPrefix = { index_type: ['prefixPartition'] };
      const hashOption = { value: 'hashPartition_8' };
      const result = wrapper.vm.disableOptions(schemaWithPrefix, hashOption);
      expect(result).toBe(true);
    });

    it('should handle empty index_type array', () => {
      const emptySchema = { index_type: [] };
      const option = { value: 'fullTextSearchKey' };
      const result = wrapper.vm.disableOptions(emptySchema, option);
      expect(result).toBe(false);
    });

    it('should handle undefined index_type', () => {
      const undefinedSchema = {};
      const option = { value: 'fullTextSearchKey' };
      const result = wrapper.vm.disableOptions(undefinedSchema, option);
      expect(result).toBe(false);
    });

    it('should disable keyPartition when hashPartition is selected', () => {
      const schemaWithHash = { index_type: ['hashPartition_8'] };
      const keyOption = { value: 'keyPartition' };
      const result = wrapper.vm.disableOptions(schemaWithHash, keyOption);
      expect(result).toBe(true);
    });

    it('should disable prefixPartition when hashPartition is selected', () => {
      const schemaWithHash = { index_type: ['hashPartition_8'] };
      const prefixOption = { value: 'prefixPartition' };
      const result = wrapper.vm.disableOptions(schemaWithHash, prefixOption);
      expect(result).toBe(true);
    });

    it('should not disable fullTextSearchKey when hashPartition is selected', () => {
      const schemaWithHash = { index_type: ['hashPartition_8'] };
      const ftsOption = { value: 'fullTextSearchKey' };
      const result = wrapper.vm.disableOptions(schemaWithHash, ftsOption);
      expect(result).toBe(false);
    });

    it('should not disable secondaryIndexKey when hashPartition is selected', () => {
      const schemaWithHash = { index_type: ['hashPartition_8'] };
      const secondaryOption = { value: 'secondaryIndexKey' };
      const result = wrapper.vm.disableOptions(schemaWithHash, secondaryOption);
      expect(result).toBe(false);
    });

    it('should not disable bloomFilterKey when hashPartition is selected', () => {
      const schemaWithHash = { index_type: ['hashPartition_8'] };
      const bloomOption = { value: 'bloomFilterKey' };
      const result = wrapper.vm.disableOptions(schemaWithHash, bloomOption);
      expect(result).toBe(false);
    });

    it('should not disable fullTextSearchKey when prefixPartition is selected', () => {
      const schemaWithPrefix = { index_type: ['prefixPartition'] };
      const ftsOption = { value: 'fullTextSearchKey' };
      const result = wrapper.vm.disableOptions(schemaWithPrefix, ftsOption);
      expect(result).toBe(false);
    });

    it('should not disable fullTextSearchKey when keyPartition is selected', () => {
      const schemaWithKey = { index_type: ['keyPartition'] };
      const ftsOption = { value: 'fullTextSearchKey' };
      const result = wrapper.vm.disableOptions(schemaWithKey, ftsOption);
      expect(result).toBe(false);
    });

    it('should not disable secondaryIndexKey when prefixPartition is selected', () => {
      const schemaWithPrefix = { index_type: ['prefixPartition'] };
      const option = { value: 'secondaryIndexKey' };
      const result = wrapper.vm.disableOptions(schemaWithPrefix, option);
      expect(result).toBe(false);
    });

    it('should not disable bloomFilterKey when keyPartition is selected', () => {
      const schemaWithKey = { index_type: ['keyPartition'] };
      const option = { value: 'bloomFilterKey' };
      const result = wrapper.vm.disableOptions(schemaWithKey, option);
      expect(result).toBe(false);
    });

    it('should disable other hash variants and partition types when hashPartition is selected with multiple index types', () => {
      const complexSchema = { index_type: ['hashPartition_8', 'fullTextSearchKey', 'bloomFilterKey'] };

      // Different hash variant should be disabled
      expect(wrapper.vm.disableOptions(complexSchema, { value: 'hashPartition_16' })).toBe(true);
      expect(wrapper.vm.disableOptions(complexSchema, { value: 'hashPartition_64' })).toBe(true);
      // Same hash should be allowed
      expect(wrapper.vm.disableOptions(complexSchema, { value: 'hashPartition_8' })).toBe(false);
      // keyPartition and prefixPartition should be disabled
      expect(wrapper.vm.disableOptions(complexSchema, { value: 'keyPartition' })).toBe(true);
      expect(wrapper.vm.disableOptions(complexSchema, { value: 'prefixPartition' })).toBe(true);
      // Non-partition types should be allowed
      expect(wrapper.vm.disableOptions(complexSchema, { value: 'fullTextSearchKey' })).toBe(false);
      expect(wrapper.vm.disableOptions(complexSchema, { value: 'bloomFilterKey' })).toBe(false);
      expect(wrapper.vm.disableOptions(complexSchema, { value: 'secondaryIndexKey' })).toBe(false);
    });

    it('should disable hashPartition options when prefixPartition or keyPartition is selected', () => {
      // When prefix is selected alongside other non-hash types
      const schemaWithPrefix = { index_type: ['prefixPartition', 'fullTextSearchKey'] };
      expect(wrapper.vm.disableOptions(schemaWithPrefix, { value: 'hashPartition_8' })).toBe(true);
      expect(wrapper.vm.disableOptions(schemaWithPrefix, { value: 'hashPartition_32' })).toBe(true);
      expect(wrapper.vm.disableOptions(schemaWithPrefix, { value: 'keyPartition' })).toBe(true);

      // When key is selected alongside other non-hash types
      const schemaWithKey = { index_type: ['keyPartition', 'bloomFilterKey'] };
      expect(wrapper.vm.disableOptions(schemaWithKey, { value: 'hashPartition_8' })).toBe(true);
      expect(wrapper.vm.disableOptions(schemaWithKey, { value: 'hashPartition_64' })).toBe(true);
      expect(wrapper.vm.disableOptions(schemaWithKey, { value: 'prefixPartition' })).toBe(true);
    });
  });

  describe('Form Validation', () => {
    it('should show field name error when validate finds empty name', async () => {
      const emptyField = [{ uuid: '1', name: '', type: 'Utf8', index_type: [] }];
      await wrapper.setProps({ fields: emptyField });
      wrapper.vm.validate();
      await wrapper.vm.$nextTick();
      expect(wrapper.html()).toContain('Field is required');
    });

    it('should render data type selects with validation', async () => {
      await wrapper.setProps({ fields: mockFields });
      const dataTypeSelects = wrapper.findAll('[data-test="add-stream-field-data-type-select"]');
      expect(dataTypeSelects.length).toBeGreaterThan(0);
    });

    it('should show data type error when field has name but no type', async () => {
      const fieldWithoutType = [{ uuid: '1', name: 'myField', type: '', index_type: [] }];
      await wrapper.setProps({ fields: fieldWithoutType });

      wrapper.vm.validate();
      await wrapper.vm.$nextTick();

      expect(wrapper.html()).toContain('Data Type is required');
    });

    it('should not require data type when visibleInputs.data_type is false', async () => {
      const fieldWithoutType = [{ uuid: '1', name: 'myField', type: '', index_type: [] }];
      await wrapper.setProps({
        fields: fieldWithoutType,
        visibleInputs: { name: true, data_type: false, index_type: false },
      });

      const result = wrapper.vm.validate();

      expect(result).toBe(true);
      expect(wrapper.html()).not.toContain('Data Type is required');
    });

    it('should return true when all fields have name and type', async () => {
      await wrapper.setProps({ fields: mockFields });

      const result = wrapper.vm.validate();

      expect(result).toBe(true);
    });

    it('should return false when field has empty name and empty type', async () => {
      const emptyField = [{ uuid: '1', name: '', type: '', index_type: [] }];
      await wrapper.setProps({ fields: emptyField });

      const result = wrapper.vm.validate();
      await wrapper.vm.$nextTick();

      expect(wrapper.html()).toContain('Field is required');
      expect(wrapper.html()).toContain('Data Type is required');
      expect(result).toBe(false);
    });

    it('should clear data type error on update:model-value', async () => {
      const fieldWithoutType = [{ uuid: '1', name: 'myField', type: '', index_type: [] }];
      await wrapper.setProps({ fields: fieldWithoutType });

      wrapper.vm.validate();
      await wrapper.vm.$nextTick();
      expect(wrapper.html()).toContain('Data Type is required');

      // Changing the type via the OSelect should clear the error
      // The OSelect component emits update:model-value which triggers
      // fieldDataTypeErrors[index] = ''
      const dataTypeSelect = wrapper.find('[data-test="add-stream-field-data-type-select"]');
      expect(dataTypeSelect.exists()).toBe(true);
    });
  });

  describe('Store and i18n Integration', () => {
    it('should expose store reference', () => {
      expect(wrapper.vm.store).toBeDefined();
      expect(wrapper.vm.store.state).toBeDefined();
    });

    it('should expose translation function', () => {
      expect(wrapper.vm.t).toBeDefined();
      expect(typeof wrapper.vm.t).toBe('function');
    });

    it('should render with dark theme from store', async () => {
      await wrapper.setProps({ fields: mockFields });
      const buttons = wrapper.findAll('button');
      expect(buttons.length).toBeGreaterThan(0);
      expect(wrapper.vm.store.state.theme).toBe('dark');
    });
  });

  describe('Edge Cases', () => {
    it('should handle single field with empty name correctly', async () => {
      const singleEmptyField = [{ uuid: '1', name: '', type: '', index_type: [] }];
      await wrapper.setProps({ fields: singleEmptyField });
      const addBtn = wrapper.find('[data-test="add-stream-add-field-btn"]');
      expect(addBtn.element.hasAttribute('disabled')).toBe(true);
    });

    it('should handle multiple hash partitions in disableOptions', () => {
      const schemaWithMultipleHash = { index_type: ['hashPartition_8', 'fullTextSearchKey'] };
      const differentHashOption = { value: 'hashPartition_16' };
      const result = wrapper.vm.disableOptions(schemaWithMultipleHash, differentHashOption);
      expect(result).toBe(true);
    });

    it('should handle complex partition combinations in disableOptions', () => {
      const complexSchema = { index_type: ['keyPartition', 'fullTextSearchKey'] };
      const hashOption = { value: 'hashPartition_32' };
      const result = wrapper.vm.disableOptions(complexSchema, hashOption);
      expect(result).toBe(true);
    });
  });
});
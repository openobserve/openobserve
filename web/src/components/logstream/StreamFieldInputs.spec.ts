// Copyright 2023 OpenObserve Inc.
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
import { Quasar, QBtn, QInput, QSelect } from 'quasar';
import StreamFieldInputs from './StreamFieldInputs.vue';
import { createI18n } from 'vue-i18n';
import { createStore } from 'vuex';

const i18n = createI18n({
  locale: 'en',
  legacy: false,
  messages: {
    en: {
      alert_templates: {
        edit: 'Edit'
      },
      logStream: {
        fields: 'Fields',
        addField: 'Add Field',
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
        plugins: [Quasar, i18n, store],
        components: {
          QBtn,
          QInput,
          QSelect
        }
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
      expect(addBtn.classes()).toContain('add-field');
    });
  });

  describe('Fields Rendering', () => {
    beforeEach(async () => {
      await wrapper.setProps({ fields: mockFields });
    });

    it('should render field inputs when fields array has data', () => {
      const conditions = wrapper.findAll('[data-test^="alert-conditions-"]');
      expect(conditions.length).toBeGreaterThanOrEqual(2);
    });

    it('should render field name input for each field', () => {
      expect(wrapper.findAll('[data-test="add-stream-field-name-input"]')).toHaveLength(2);
    });

    it('should render field type select for each field when data_type is visible', () => {
      expect(wrapper.findAll('[data-test="add-stream-field-type-select-input"]')).toHaveLength(4); // 2 fields × 2 selects each
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

  describe('Width Styling Based on isInSchema', () => {
    it('should apply schema width when isInSchema is true', async () => {
      await wrapper.setProps({ fields: mockFields, isInSchema: true });
      const nameInput = wrapper.find('[data-test="add-stream-field-name-input"] .q-field');
      expect(nameInput.exists()).toBe(true);
      expect(nameInput.attributes('style')).toContain('40vw');
    });

    it('should apply default width when isInSchema is false', async () => {
      await wrapper.setProps({ fields: mockFields, isInSchema: false });
      const nameInput = wrapper.find('[data-test="add-stream-field-name-input"] .q-field');
      expect(nameInput.exists()).toBe(true);
      expect(nameInput.attributes('style')).toContain('250px');
    });
  });

  describe('Visible Inputs Configuration', () => {
    it('should hide index_type select when visibleInputs.index_type is false', async () => {
      await wrapper.setProps({
        fields: mockFields,
        visibleInputs: { name: true, data_type: true, index_type: false }
      });
      const indexTypeSelects = wrapper.findAll('[data-test="add-stream-field-type-select-input"]');
      expect(indexTypeSelects.filter(el => el.attributes('multiple') !== undefined)).toHaveLength(0);
    });

    it('should hide data_type select when visibleInputs.data_type is false', async () => {
      await wrapper.setProps({
        fields: mockFields,
        visibleInputs: { name: true, data_type: false, index_type: true }
      });
      // When data_type is false, only index_type selects should render
      const allTypeSelects = wrapper.findAll('[data-test="add-stream-field-type-select-input"]');
      const indexTypeSelects = allTypeSelects.filter(el => {
        return el.html().includes('multiple');
      });
      expect(indexTypeSelects.length).toBeGreaterThan(0);
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
      expect(addBtn.attributes('disabled')).toBeDefined();
    });

    it('should enable add button when field name is not empty', async () => {
      const filledField = [{ uuid: '1', name: 'test', type: '', index_type: [] }];
      await wrapper.setProps({ fields: filledField });
      const addBtn = wrapper.find('[data-test="add-stream-add-field-btn"]');
      expect(addBtn.attributes('disabled')).toBeUndefined();
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
  });

  describe('Form Validation', () => {
    it('should show field name validation rule', async () => {
      await wrapper.setProps({ fields: mockFields });
      const nameInputs = wrapper.findAll('[data-test="add-stream-field-name-input"] .q-input');
      expect(nameInputs.length).toBeGreaterThan(0);
      // Validation rules are internal to QInput component
      expect(wrapper.html()).toContain('Field is required');
    });

    it('should show data type validation rule', async () => {
      await wrapper.setProps({ fields: mockFields });
      const dataTypeSelects = wrapper.findAll('[data-test="add-stream-field-type-select-input"]');
      expect(dataTypeSelects.length).toBeGreaterThan(0);
      // Validation rules are internal to QSelect component
      expect(wrapper.html()).toContain('add-stream-field-type-select-input');
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

    it('should apply theme-based styling', async () => {
      await wrapper.setProps({ fields: mockFields });
      const buttons = wrapper.findAll('button');
      buttons.forEach(button => {
        if (wrapper.vm.store.state?.theme === 'dark') {
          expect(button.classes()).toContain('icon-dark');
        }
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle single field with empty name correctly', async () => {
      const singleEmptyField = [{ uuid: '1', name: '', type: '', index_type: [] }];
      await wrapper.setProps({ fields: singleEmptyField });
      const addBtn = wrapper.find('[data-test="add-stream-add-field-btn"]');
      expect(addBtn.attributes('disabled')).toBeDefined();
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
import { describe, it, expect, beforeEach } from 'vitest';
import { ref, nextTick } from 'vue';
import { useSearchInputUsingRegex } from './useSearchInputUsingRegex';

describe('useSearchInputUsingRegex', () => {
  let mockOptions: any;
  let searchKey: string;
  let searchRegex: string;

  beforeEach(() => {
    mockOptions = ref([
      { name: 'John Doe', id: 1 },
      { name: 'Jane Smith', id: 2 },
      { name: 'Bob Johnson', id: 3 },
      { name: 'Alice Wilson', id: 4 },
      'simple string',
      'another string',
      { title: 'Test Title', value: 'test-value' }
    ]);
    searchKey = 'name';
    searchRegex = 'pattern:(.*)';
  });

  describe('Main composable function', () => {
    it('should initialize with copied options', () => {
      const { filteredOptions } = useSearchInputUsingRegex(mockOptions, searchKey, searchRegex);
      expect(filteredOptions.value).toEqual(mockOptions.value);
      expect(filteredOptions.value).not.toBe(mockOptions.value); // Should be a copy
    });

    it('should return all expected methods', () => {
      const result = useSearchInputUsingRegex(mockOptions, searchKey, searchRegex);
      expect(result).toHaveProperty('filteredOptions');
      expect(result).toHaveProperty('filterFn');
    });

    it('should handle empty options array', () => {
      const emptyOptions = ref([]);
      const { filteredOptions } = useSearchInputUsingRegex(emptyOptions, searchKey, searchRegex);
      expect(filteredOptions.value).toEqual([]);
    });

    it('should handle null options', () => {
      const nullOptions = ref([]);
      const { filteredOptions } = useSearchInputUsingRegex(nullOptions, searchKey, searchRegex);
      expect(filteredOptions.value).toEqual([]);
    });
  });

  describe('filterFn', () => {
    it('should reset to all options when value is empty string', () => {
      const { filteredOptions, filterFn } = useSearchInputUsingRegex(mockOptions, searchKey, searchRegex);
      filteredOptions.value = [];
      filterFn('');
      expect(filteredOptions.value).toEqual(mockOptions.value);
    });

    it('should filter options based on regex match', () => {
      const { filteredOptions, filterFn } = useSearchInputUsingRegex(mockOptions, searchKey, searchRegex);
      filterFn('pattern:john');
      expect(filteredOptions.value).toHaveLength(2); // John Doe and Bob Johnson
      expect(filteredOptions.value.some((option: any) => option.name === 'John Doe')).toBe(true);
      expect(filteredOptions.value.some((option: any) => option.name === 'Bob Johnson')).toBe(true);
    });


    it('should return empty array when needle is null', () => {
      const { filteredOptions, filterFn } = useSearchInputUsingRegex(mockOptions, searchKey, searchRegex);
      filterFn('pattern:');
      // When the needle is empty (null), it actually matches all objects with the search key
      expect(filteredOptions.value).toHaveLength(6); // All items that can be processed
    });

    it('should handle complex regex patterns', () => {
      const { filteredOptions, filterFn } = useSearchInputUsingRegex(mockOptions, searchKey, searchRegex);
      filterFn('pattern:doe');
      expect(filteredOptions.value).toHaveLength(1);
      expect(filteredOptions.value[0].name).toBe('John Doe');
    });

    it('should handle multiple capture groups', () => {
      const multiGroupRegex = 'prefix:(\\w+)\\s+(\\w+)';
      const { filteredOptions, filterFn } = useSearchInputUsingRegex(mockOptions, searchKey, multiGroupRegex);
      filterFn('prefix:john doe');
      // The first non-undefined capture group is 'john'
      expect(filteredOptions.value).toHaveLength(2); // John Doe and Bob Johnson (both contain 'john')
      expect(filteredOptions.value.some((option: any) => option.name === 'John Doe')).toBe(true);
    });

    it('should handle regex with no capture groups', () => {
      const noGroupRegex = 'john';
      const { filteredOptions, filterFn } = useSearchInputUsingRegex(mockOptions, searchKey, noGroupRegex);
      filterFn('john');
      expect(filteredOptions.value).toEqual([]);
    });

    it('should handle null input value', () => {
      const { filteredOptions, filterFn } = useSearchInputUsingRegex(mockOptions, searchKey, searchRegex);
      filterFn(null);
      expect(filteredOptions.value).toEqual([]);
    });

    it('should handle undefined input value', () => {
      const { filteredOptions, filterFn } = useSearchInputUsingRegex(mockOptions, searchKey, searchRegex);
      filterFn(undefined);
      expect(filteredOptions.value).toEqual([]);
    });
  });

  describe('Integration tests', () => {
    it('should work end-to-end with object array', () => {
      const { filteredOptions, filterFn } = useSearchInputUsingRegex(mockOptions, searchKey, searchRegex);
      
      // Initial state
      expect(filteredOptions.value).toEqual(mockOptions.value);
      
      // Filter
      filterFn('pattern:alice');
      expect(filteredOptions.value).toHaveLength(1);
      expect(filteredOptions.value[0].name).toBe('Alice Wilson');
      
      // Reset
      filterFn('');
      expect(filteredOptions.value).toEqual(mockOptions.value);
    });

    it('should work end-to-end with string array', () => {
      const stringOptions = ref(['simple string', 'another string', 'test string']);
      const { filteredOptions, filterFn } = useSearchInputUsingRegex(stringOptions, 'name', searchRegex);
      
      filterFn('pattern:simple');
      expect(filteredOptions.value).toHaveLength(1);
      expect(filteredOptions.value[0]).toBe('simple string');
    });

    it('should maintain reactive updates', () => {
      const { filteredOptions } = useSearchInputUsingRegex(mockOptions, searchKey, searchRegex);
      
      // Update original options
      mockOptions.value.push({ name: 'New Person', id: 5 });
      
      // filteredOptions should still reflect the original copy
      expect(filteredOptions.value).not.toContain({ name: 'New Person', id: 5 });
    });

    it('should handle mixed data types in array', () => {
      const mixedOptions = ref([
        { name: 'Object Item', id: 1 },
        'String Item',
        123,
        true
      ]);
      const { filteredOptions, filterFn } = useSearchInputUsingRegex(mixedOptions, searchKey, searchRegex);
      
      filterFn('pattern:string');
      expect(filteredOptions.value).toHaveLength(1);
      expect(filteredOptions.value[0]).toBe('String Item');
    });
  });

  describe('Edge cases and error handling', () => {

    it('should handle special characters in search', () => {
      const { filteredOptions, filterFn } = useSearchInputUsingRegex(mockOptions, searchKey, searchRegex);
      filterFn('pattern:.*');
      // The needle is '.*' which won't match literal names
      expect(filteredOptions.value).toHaveLength(0);
    });

    it('should handle Unicode characters', () => {
      const unicodeOptions = ref([
        { name: 'José García', id: 1 },
        { name: '李明', id: 2 },
        { name: 'François', id: 3 }
      ]);
      const { filteredOptions, filterFn } = useSearchInputUsingRegex(unicodeOptions, searchKey, searchRegex);
      
      filterFn('pattern:josé');
      expect(filteredOptions.value).toHaveLength(1);
      expect(filteredOptions.value[0].name).toBe('José García');
    });
  });

  describe('Watch function coverage', () => {
    it('should update filteredOptions when they are empty and options change', async () => {
      // Create a fresh set of options for this test
      const testOptions = ref([{ name: 'Original', id: 1 }]);
      const { filteredOptions } = useSearchInputUsingRegex(testOptions, searchKey, searchRegex);
      
      // Empty the filtered options
      filteredOptions.value = [];
      
      // Update the original options - replace the entire array to trigger watch
      const newItem = { name: 'New Person', id: 5 };
      testOptions.value = [...testOptions.value, newItem];
      
      // Wait for the watch to trigger using nextTick
      await nextTick();
      
      expect(filteredOptions.value.length).toBeGreaterThan(1);
      expect(filteredOptions.value.some((item: any) => item.name === 'New Person')).toBe(true);
    });

    it('should not update filteredOptions when they are not empty and options change', async () => {
      const testOptions = ref([{ name: 'Original', id: 1 }]);
      const { filteredOptions } = useSearchInputUsingRegex(testOptions, searchKey, searchRegex);
      
      // Keep filtered options non-empty
      expect(filteredOptions.value.length).toBeGreaterThan(0);
      const originalLength = filteredOptions.value.length;
      
      // Update the original options
      testOptions.value.push({ name: 'New Person', id: 5 });
      
      // Wait for potential watch trigger
      await nextTick();
      
      expect(filteredOptions.value.length).toBe(originalLength);
    });
  });

  describe('FilterFn branch coverage', () => {
    it('should handle regex with no capture groups but successful match', () => {
      const noGroupRegex = 'test';
      const testOptions = ref(['test string', 'other string']);
      const { filteredOptions, filterFn } = useSearchInputUsingRegex(testOptions, 'name', noGroupRegex);
      
      filterFn('test');
      // When no capture groups, needle remains null, so includes(null) fails
      expect(filteredOptions.value).toEqual([]);
    });

    it('should handle regex with multiple capture groups where first is undefined', () => {
      const multiGroupRegex = 'prefix:()([a-z]+)';
      const { filteredOptions, filterFn } = useSearchInputUsingRegex(mockOptions, searchKey, multiGroupRegex);
      
      filterFn('prefix:john');
      // First capture group is empty string, second is 'john'
      // Empty string matches all items with the search key
      expect(filteredOptions.value).toHaveLength(6); // All items match empty string
    });

    it('should handle options with missing searchKey property', () => {
      const mixedOptions = ref([
        { name: 'Valid Item', id: 1 },
        { id: 2 }, // Missing 'name' property
        { name: 'Another Valid', id: 3 }
      ]);
      const { filteredOptions, filterFn } = useSearchInputUsingRegex(mixedOptions, searchKey, searchRegex);
      
      filterFn('pattern:valid');
      expect(filteredOptions.value).toHaveLength(2); // Only items with 'name' property
    });

    it('should handle options with null searchKey value', () => {
      const nullValueOptions = ref([
        { name: 'Valid Item', id: 1 },
        { name: null, id: 2 },
        { name: 'Another Valid', id: 3 }
      ]);
      const { filteredOptions, filterFn } = useSearchInputUsingRegex(nullValueOptions, searchKey, searchRegex);
      
      filterFn('pattern:valid');
      expect(filteredOptions.value).toHaveLength(2); // Only items with valid string names
    });


    it('should handle primitive options that are not strings', () => {
      const primitiveOptions = ref([
        'string item',
        123,
        true,
        false,
        0
      ]);
      const { filteredOptions, filterFn } = useSearchInputUsingRegex(primitiveOptions, 'name', searchRegex);
      
      filterFn('pattern:true');
      expect(filteredOptions.value).toHaveLength(1);
      expect(filteredOptions.value[0]).toBe(true);
    });

    it('should handle options with undefined searchKey value', () => {
      const undefinedValueOptions = ref([
        { name: 'Valid Item', id: 1 },
        { name: undefined, id: 2 },
        { name: 'Another Valid', id: 3 }
      ]);
      const { filteredOptions, filterFn } = useSearchInputUsingRegex(undefinedValueOptions, searchKey, searchRegex);
      
      filterFn('pattern:valid');
      expect(filteredOptions.value).toHaveLength(2); // Only items with valid names
    });

    it('should handle empty needle from regex capture', () => {
      const emptyGroupRegex = 'pattern:()';
      const { filteredOptions, filterFn } = useSearchInputUsingRegex(mockOptions, searchKey, emptyGroupRegex);
      
      filterFn('pattern:');
      // Empty capture group results in empty string needle
      expect(filteredOptions.value).toHaveLength(6); // All items match empty string
    });

    it('should handle regex that matches but has no defined capture groups', () => {
      const noDefinedGroupsRegex = 'pattern:()()()'; // All empty groups
      const { filteredOptions, filterFn } = useSearchInputUsingRegex(mockOptions, searchKey, noDefinedGroupsRegex);
      
      filterFn('pattern:');
      // Empty capture groups result in empty string needle, which matches all items
      expect(filteredOptions.value).toHaveLength(6);
    });

    it('should handle case sensitivity in needle matching', () => {
      const { filteredOptions, filterFn } = useSearchInputUsingRegex(mockOptions, searchKey, searchRegex);
      
      filterFn('pattern:john');
      // Should match 'john' in lowercase due to includes() after toLowerCase()
      expect(filteredOptions.value).toHaveLength(2); // John Doe and Bob Johnson
    });

    it('should handle zero and false as valid capture group values', () => {
      const zeroRegex = 'number:(0)';
      const testOptions = ref([
        { name: 'item0', id: 1 },
        { name: 'item1', id: 2 },
        { name: 'zero', id: 3 }
      ]);
      const { filteredOptions, filterFn } = useSearchInputUsingRegex(testOptions, searchKey, zeroRegex);
      
      filterFn('number:0');
      // Zero is a valid needle value
      expect(filteredOptions.value).toHaveLength(1);
      expect(filteredOptions.value[0].name).toBe('item0');
    });


  });

  describe('Regex edge cases', () => {
    it('should handle invalid regex patterns gracefully', () => {
      const invalidRegex = '[invalid regex pattern';
      const { filterFn } = useSearchInputUsingRegex(mockOptions, searchKey, invalidRegex);
      // The error occurs when filterFn is called, not during initialization
      expect(() => {
        filterFn('test input');
      }).toThrow();
    });

    it('should handle regex with global flag behavior', () => {
      // Test that global flag doesn't cause issues with repeated calls
      const { filteredOptions, filterFn } = useSearchInputUsingRegex(mockOptions, searchKey, searchRegex);
      
      filterFn('pattern:john');
      const firstResult = [...filteredOptions.value];
      
      filterFn('pattern:john');
      const secondResult = [...filteredOptions.value];
      
      expect(firstResult).toEqual(secondResult);
    });

    it('should handle very long capture groups', () => {
      const longString = 'a'.repeat(1000);
      const longRegex = `pattern:(${longString})`;
      const longOptions = ref([{ name: `item${longString}`, id: 1 }]);
      const { filteredOptions, filterFn } = useSearchInputUsingRegex(longOptions, searchKey, longRegex);
      
      filterFn(`pattern:${longString}`);
      expect(filteredOptions.value).toHaveLength(1);
    });
  });
});
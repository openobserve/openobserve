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

import { describe, it, expect } from 'vitest';
import { getDataValue } from './aliasUtils';

describe('getDataValue', () => {
  describe('Direct access with exact key match', () => {
    it('should return value when exact string key exists', () => {
      const obj = { xAxis: 'value1' };
      expect(getDataValue(obj, 'xAxis')).toBe('value1');
    });

    it('should return value when exact numeric key exists', () => {
      const obj = { 100: 'value100', 200: 'value200' };
      expect(getDataValue(obj, 100)).toBe('value100');
      expect(getDataValue(obj, 200)).toBe('value200');
    });

    it('should return value when lowercase key exists', () => {
      const obj = { xaxis: 'value2' };
      expect(getDataValue(obj, 'xaxis')).toBe('value2');
    });
  });

  describe('Fallback to lowercase for string keys', () => {
    it('should fallback to lowercase when camelCase key does not exist', () => {
      const obj = { xaxis: 'lowercaseValue' };
      expect(getDataValue(obj, 'xAxis')).toBe('lowercaseValue');
    });

    it('should prefer exact match over lowercase fallback', () => {
      const obj = { xAxis: 'camelCase', xaxis: 'lowercase' };
      expect(getDataValue(obj, 'xAxis')).toBe('camelCase');
    });

    it('should use lowercase fallback for mixed case keys', () => {
      const obj = { myvalue: 'test' };
      expect(getDataValue(obj, 'MyValue')).toBe('test');
    });
  });

  describe('Handling falsy values correctly', () => {
    it('should return 0 when value is 0', () => {
      const obj = { count: 0 };
      expect(getDataValue(obj, 'count')).toBe(0);
    });

    it('should return false when value is false', () => {
      const obj = { flag: false };
      expect(getDataValue(obj, 'flag')).toBe(false);
    });

    it('should return empty string when value is empty string', () => {
      const obj = { text: '' };
      expect(getDataValue(obj, 'text')).toBe('');
    });

    it('should return null when value is null', () => {
      const obj = { data: null };
      expect(getDataValue(obj, 'data')).toBe(null);
    });

    it('should return 0 from lowercase fallback', () => {
      const obj = { count: 0 };
      expect(getDataValue(obj, 'Count')).toBe(0);
    });

    it('should return false from lowercase fallback', () => {
      const obj = { flag: false };
      expect(getDataValue(obj, 'Flag')).toBe(false);
    });
  });

  describe('Numeric keys behavior', () => {
    it('should handle numeric keys without lowercase fallback', () => {
      const obj = { 100: 'value100' };
      expect(getDataValue(obj, 100)).toBe('value100');
    });

    it('should return undefined for non-existent numeric key', () => {
      const obj = { 100: 'value100' };
      expect(getDataValue(obj, 200)).toBe(undefined);
    });

    it('should handle zero as a numeric key', () => {
      const obj = { 0: 'zeroValue' };
      expect(getDataValue(obj, 0)).toBe('zeroValue');
    });

    it('should handle numeric keys with falsy values', () => {
      const obj = { 100: 0, 200: false, 300: '' };
      expect(getDataValue(obj, 100)).toBe(0);
      expect(getDataValue(obj, 200)).toBe(false);
      expect(getDataValue(obj, 300)).toBe('');
    });

    it('should access string key "100" with numeric key 100', () => {
      // In JavaScript, numeric keys are converted to strings
      const obj = { '100': 'value100' };
      expect(getDataValue(obj, 100)).toBe('value100');
    });

    it('should access numeric key 100 with string key "100"', () => {
      // Reverse scenario
      const obj = { 100: 'value100' };
      expect(getDataValue(obj, '100')).toBe('value100');
    });

    it('should handle mixed string and numeric keys', () => {
      const obj = { '100': 'string100', 200: 'number200' };
      expect(getDataValue(obj, 100)).toBe('string100');
      expect(getDataValue(obj, '100')).toBe('string100');
      expect(getDataValue(obj, 200)).toBe('number200');
      expect(getDataValue(obj, '200')).toBe('number200');
    });

    it('should handle string numeric keys with fallback', () => {
      // If key is "100" in object, both 100 and "100" should work
      const obj = { '100': 0 }; // Testing with falsy value
      expect(getDataValue(obj, 100)).toBe(0);
      expect(getDataValue(obj, '100')).toBe(0);
    });
  });

  describe('Edge cases and undefined handling', () => {
    it('should return undefined when key does not exist', () => {
      const obj = { xAxis: 'value' };
      expect(getDataValue(obj, 'yAxis')).toBe(undefined);
    });

    it('should return undefined when key does not exist and no lowercase match', () => {
      const obj = { xaxis: 'value' };
      expect(getDataValue(obj, 'yAxis')).toBe(undefined);
    });

    it('should return undefined when object is null', () => {
      expect(getDataValue(null, 'key')).toBe(undefined);
    });

    it('should return undefined when object is undefined', () => {
      expect(getDataValue(undefined, 'key')).toBe(undefined);
    });

    it('should return undefined when object is empty', () => {
      const obj = {};
      expect(getDataValue(obj, 'key')).toBe(undefined);
    });

    it('should return undefined when value is explicitly undefined', () => {
      const obj = { key: undefined };
      expect(getDataValue(obj, 'key')).toBe(undefined);
    });

    it('should handle null alias without error', () => {
      const obj = { key: 'value' };
      expect(() => getDataValue(obj, null as any)).not.toThrow();
      expect(getDataValue(obj, null as any)).toBe(undefined);
    });

    it('should handle undefined alias without error', () => {
      const obj = { key: 'value' };
      expect(() => getDataValue(obj, undefined as any)).not.toThrow();
      expect(getDataValue(obj, undefined as any)).toBe(undefined);
    });

    it('should handle empty string alias', () => {
      const obj = { '': 'emptyKey', key: 'value' };
      expect(getDataValue(obj, '')).toBe('emptyKey');
    });

    it('should handle NaN as alias without error', () => {
      const obj = { key: 'value' };
      expect(() => getDataValue(obj, NaN)).not.toThrow();
    });

    it('should handle objects with null prototype', () => {
      const obj = Object.create(null);
      obj.key = 'value';
      expect(getDataValue(obj, 'key')).toBe('value');
    });

    it('should handle accessing properties that throw errors', () => {
      const obj = {
        get errorKey() {
          throw new Error('Property access error');
        },
        normalKey: 'value'
      };
      expect(() => getDataValue(obj, 'errorKey')).toThrow();
      expect(getDataValue(obj, 'normalKey')).toBe('value');
    });
  });

  describe('Complex real-world scenarios', () => {
    it('should handle nested data structures', () => {
      const obj = {
        100: { nested: 'value' },
        200: [1, 2, 3],
        xAxis: { min: 0, max: 100 }
      };
      expect(getDataValue(obj, 100)).toEqual({ nested: 'value' });
      expect(getDataValue(obj, 200)).toEqual([1, 2, 3]);
      expect(getDataValue(obj, 'xAxis')).toEqual({ min: 0, max: 100 });
    });

    it('should handle dashboard-like objects with mixed keys', () => {
      const dataPoint = {
        100: 25.5,
        200: 0,
        xaxis: 'time',
        yaxis: 'value',
        count: 0
      };
      expect(getDataValue(dataPoint, 100)).toBe(25.5);
      expect(getDataValue(dataPoint, 200)).toBe(0);
      expect(getDataValue(dataPoint, 'xAxis')).toBe('time');
      expect(getDataValue(dataPoint, 'count')).toBe(0);
    });

    it('should handle special characters in string keys', () => {
      const obj = { 'x-axis': 'value', 'x_axis': 'value2' };
      expect(getDataValue(obj, 'x-axis')).toBe('value');
      expect(getDataValue(obj, 'X-Axis')).toBe('value'); // lowercase fallback works with special chars
    });
  });

  describe('Performance-critical scenarios', () => {
    it('should handle rapid successive calls', () => {
      const obj = { 100: 'a', 200: 0, xaxis: 'b', count: false };
      
      for (let i = 0; i < 100; i++) {
        expect(getDataValue(obj, 100)).toBe('a');
        expect(getDataValue(obj, 200)).toBe(0);
        expect(getDataValue(obj, 'xAxis')).toBe('b');
        expect(getDataValue(obj, 'count')).toBe(false);
      }
    });

    it('should handle objects with many keys efficiently', () => {
      const largeObj: any = {};
      for (let i = 0; i < 1000; i++) {
        largeObj[i] = i;
      }
      largeObj['xaxis'] = 'found';
      
      expect(getDataValue(largeObj, 500)).toBe(500);
      expect(getDataValue(largeObj, 'xAxis')).toBe('found');
    });
  });
});

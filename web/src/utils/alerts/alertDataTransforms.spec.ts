import { describe, it, expect } from 'vitest';
import { transformFEToBE, retransformBEToFE } from './alertDataTransforms';
import { getUUID } from '@/utils/zincutils';

describe('alertDataTransforms', () => {
  describe('transformFEToBE', () => {
    it('should transform a simple AND group to backend format', () => {
      const input = {
        groupId: 'test-group-1',
        label: 'and',
        items: [
          {
            column: 'status',
            operator: '=',
            value: 'error',
            ignore_case: false,
            id: 'cond-1'
          },
          {
            column: 'level',
            operator: '>=',
            value: '5',
            ignore_case: true,
            id: 'cond-2'
          }
        ]
      };

      const result = transformFEToBE(input);

      expect(result).toEqual({
        and: [
          {
            column: 'status',
            operator: '=',
            value: 'error',
            ignore_case: false
          },
          {
            column: 'level',
            operator: '>=',
            value: '5',
            ignore_case: true
          }
        ]
      });
    });

    it('should transform a simple OR group to backend format', () => {
      const input = {
        groupId: 'test-group-1',
        label: 'or',
        items: [
          {
            column: 'level',
            operator: '=',
            value: 'error',
            ignore_case: false,
            id: 'cond-1'
          },
          {
            column: 'level',
            operator: '=',
            value: 'critical',
            ignore_case: false,
            id: 'cond-2'
          }
        ]
      };

      const result = transformFEToBE(input);

      expect(result).toEqual({
        or: [
          {
            column: 'level',
            operator: '=',
            value: 'error',
            ignore_case: false
          },
          {
            column: 'level',
            operator: '=',
            value: 'critical',
            ignore_case: false
          }
        ]
      });
    });

    it('should transform nested groups correctly', () => {
      const input = {
        groupId: 'root-group',
        label: 'and',
        items: [
          {
            column: 'app',
            operator: '=',
            value: 'myapp',
            ignore_case: false,
            id: 'cond-1'
          },
          {
            groupId: 'nested-group',
            label: 'or',
            items: [
              {
                column: 'level',
                operator: '=',
                value: 'error',
                ignore_case: false,
                id: 'cond-2'
              },
              {
                column: 'level',
                operator: '=',
                value: 'critical',
                ignore_case: false,
                id: 'cond-3'
              }
            ]
          }
        ]
      };

      const result = transformFEToBE(input);

      expect(result).toEqual({
        and: [
          {
            column: 'app',
            operator: '=',
            value: 'myapp',
            ignore_case: false
          },
          {
            or: [
              {
                column: 'level',
                operator: '=',
                value: 'error',
                ignore_case: false
              },
              {
                column: 'level',
                operator: '=',
                value: 'critical',
                ignore_case: false
              }
            ]
          }
        ]
      });
    });

    it('should handle empty or invalid input', () => {
      expect(transformFEToBE(null)).toEqual({});
      expect(transformFEToBE(undefined)).toEqual({});
      expect(transformFEToBE({})).toEqual({});
      expect(transformFEToBE({ items: [] })).toEqual({});
      expect(transformFEToBE({ groupId: 'test', items: [] })).toEqual({});
    });

    it('should handle invalid label values', () => {
      const input = {
        groupId: 'test-group',
        label: 'invalid',
        items: [
          {
            column: 'field',
            operator: '=',
            value: 'value',
            ignore_case: false,
            id: 'cond-1'
          }
        ]
      };

      const result = transformFEToBE(input);
      expect(result).toEqual({});
    });

    it('should handle ignore_case correctly', () => {
      const input = {
        groupId: 'test-group',
        label: 'and',
        items: [
          {
            column: 'name',
            operator: 'Contains',
            value: 'test',
            ignore_case: true,
            id: 'cond-1'
          },
          {
            column: 'id',
            operator: '=',
            value: '123',
            // ignore_case not specified
            id: 'cond-2'
          }
        ]
      };

      const result = transformFEToBE(input);

      expect(result.and[0].ignore_case).toBe(true);
      expect(result.and[1].ignore_case).toBe(false); // Should default to false
    });
  });

  describe('retransformBEToFE', () => {
    it('should transform backend AND format to frontend', () => {
      const input = {
        and: [
          {
            column: 'status',
            operator: '=',
            value: 'active',
            ignore_case: false
          },
          {
            column: 'count',
            operator: '>',
            value: '10',
            ignore_case: false
          }
        ]
      };

      const result = retransformBEToFE(input);

      expect(result.label).toBe('and');
      expect(result.groupId).toBeDefined();
      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toMatchObject({
        column: 'status',
        operator: '=',
        value: 'active',
        ignore_case: false
      });
      expect(result.items[0].id).toBeDefined();
    });

    it('should transform backend OR format to frontend', () => {
      const input = {
        or: [
          {
            column: 'level',
            operator: '=',
            value: 'error',
            ignore_case: false
          },
          {
            column: 'level',
            operator: '=',
            value: 'critical',
            ignore_case: true
          }
        ]
      };

      const result = retransformBEToFE(input);

      expect(result.label).toBe('or');
      expect(result.groupId).toBeDefined();
      expect(result.items).toHaveLength(2);
      expect(result.items[1].ignore_case).toBe(true);
    });

    it('should transform nested backend format to frontend', () => {
      const input = {
        and: [
          {
            column: 'app',
            operator: '=',
            value: 'myapp',
            ignore_case: false
          },
          {
            or: [
              {
                column: 'level',
                operator: '=',
                value: 'error',
                ignore_case: false
              },
              {
                column: 'level',
                operator: '=',
                value: 'warning',
                ignore_case: false
              }
            ]
          }
        ]
      };

      const result = retransformBEToFE(input);

      expect(result.label).toBe('and');
      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toMatchObject({
        column: 'app',
        operator: '=',
        value: 'myapp'
      });
      expect(result.items[1].label).toBe('or');
      expect(result.items[1].items).toHaveLength(2);
    });

    it('should handle null or invalid input', () => {
      expect(retransformBEToFE(null)).toBeNull();
      expect(retransformBEToFE(undefined)).toBeNull();
      expect(retransformBEToFE({})).toBeNull();
    });

    it('should handle multiple keys in object', () => {
      const input = {
        and: [],
        or: []
      };

      const result = retransformBEToFE(input);
      expect(result).toBeNull();
    });

    it('should correctly set ignore_case boolean', () => {
      const input = {
        and: [
          {
            column: 'name',
            operator: 'Contains',
            value: 'test',
            ignore_case: true
          },
          {
            column: 'id',
            operator: '=',
            value: '123',
            ignore_case: false
          }
        ]
      };

      const result = retransformBEToFE(input);

      expect(result.items[0].ignore_case).toBe(true);
      expect(result.items[1].ignore_case).toBe(false);
    });
  });

  describe('round-trip transformation', () => {
    it('should maintain data integrity through FE->BE->FE transformation', () => {
      const original = {
        groupId: 'test-group',
        label: 'and',
        items: [
          {
            column: 'status',
            operator: '=',
            value: 'active',
            ignore_case: false,
            id: 'cond-1'
          },
          {
            groupId: 'nested',
            label: 'or',
            items: [
              {
                column: 'level',
                operator: '=',
                value: 'error',
                ignore_case: true,
                id: 'cond-2'
              },
              {
                column: 'level',
                operator: '=',
                value: 'critical',
                ignore_case: false,
                id: 'cond-3'
              }
            ]
          }
        ]
      };

      const backend = transformFEToBE(original);
      const roundTrip = retransformBEToFE(backend);

      expect(roundTrip.label).toBe(original.label);
      expect(roundTrip.items).toHaveLength(original.items.length);
      expect(roundTrip.items[0].column).toBe(original.items[0].column);
      expect(roundTrip.items[1].label).toBe('or');
      expect(roundTrip.items[1].items).toHaveLength(2);
    });
  });
});

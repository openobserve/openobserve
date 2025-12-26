import { describe, it, expect } from 'vitest';
import { buildConditionsString } from './conditionsFormatter';
import type { StreamFieldsMap } from './alertQueryBuilder';

describe('conditionsFormatter', () => {
  const streamFieldsMap: StreamFieldsMap = {
    age: { label: 'age', value: 'age', type: 'Int64' },
    name: { label: 'name', value: 'name', type: 'String' },
    city: { label: 'city', value: 'city', type: 'String' },
  };

  describe('buildConditionsString', () => {
    it('generates display format (lowercase operators, no WHERE)', () => {
      const group = {
        filterType: 'group',
        logicalOperator: 'AND',
        conditions: [
          { filterType: 'condition', column: 'age', operator: '>', value: 30, logicalOperator: 'AND' },
          { filterType: 'condition', column: 'city', operator: '=', value: 'delhi', logicalOperator: 'AND' }
        ]
      };

      const result = buildConditionsString(group, {
        sqlMode: false,
        addWherePrefix: false,
        formatValues: false,
      });

      expect(result).toBe("age > '30' and city = 'delhi'");
    });

    it('generates SQL format (uppercase operators, with WHERE)', () => {
      const group = {
        filterType: 'group',
        logicalOperator: 'AND',
        conditions: [
          { filterType: 'condition', column: 'age', operator: '>', value: 30, logicalOperator: 'AND' },
          { filterType: 'condition', column: 'city', operator: '=', value: 'delhi', logicalOperator: 'AND' }
        ]
      };

      const result = buildConditionsString(group, {
        sqlMode: true,
        addWherePrefix: true,
        formatValues: true,
        streamFieldsMap,
      });

      expect(result).toBe("WHERE age > 30 AND city = 'delhi'");
    });

    it('handles nested groups correctly in display mode', () => {
      const group = {
        filterType: 'group',
        logicalOperator: 'AND',
        conditions: [
          { filterType: 'condition', column: 'age', operator: '>', value: 30, logicalOperator: 'AND' },
          {
            filterType: 'group',
            logicalOperator: 'AND',
            conditions: [
              { filterType: 'condition', column: 'city', operator: '=', value: 'delhi', logicalOperator: 'OR' },
              { filterType: 'condition', column: 'city', operator: '=', value: 'mumbai', logicalOperator: 'OR' }
            ]
          }
        ]
      };

      const result = buildConditionsString(group, {
        sqlMode: false,
        addWherePrefix: false,
        formatValues: false,
      });

      expect(result).toBe("age > '30' and (city = 'delhi' or city = 'mumbai')");
    });

    it('handles nested groups correctly in SQL mode', () => {
      const group = {
        filterType: 'group',
        logicalOperator: 'AND',
        conditions: [
          { filterType: 'condition', column: 'age', operator: '>', value: 30, logicalOperator: 'AND' },
          {
            filterType: 'group',
            logicalOperator: 'AND',
            conditions: [
              { filterType: 'condition', column: 'city', operator: '=', value: 'delhi', logicalOperator: 'OR' },
              { filterType: 'condition', column: 'city', operator: '=', value: 'mumbai', logicalOperator: 'OR' }
            ]
          }
        ]
      };

      const result = buildConditionsString(group, {
        sqlMode: true,
        addWherePrefix: true,
        formatValues: true,
        streamFieldsMap,
      });

      expect(result).toBe("WHERE age > 30 AND (city = 'delhi' OR city = 'mumbai')");
    });

    it('handles contains operator in display mode', () => {
      const group = {
        filterType: 'group',
        logicalOperator: 'AND',
        conditions: [
          { filterType: 'condition', column: 'name', operator: 'contains', value: 'john', logicalOperator: 'AND' }
        ]
      };

      const result = buildConditionsString(group, {
        sqlMode: false,
        addWherePrefix: false,
        formatValues: false,
      });

      expect(result).toBe("name contains 'john'");
    });

    it('handles contains operator in SQL mode (LIKE)', () => {
      const group = {
        filterType: 'group',
        logicalOperator: 'AND',
        conditions: [
          { filterType: 'condition', column: 'name', operator: 'contains', value: 'john', logicalOperator: 'AND' }
        ]
      };

      const result = buildConditionsString(group, {
        sqlMode: true,
        addWherePrefix: true,
        formatValues: true,
        streamFieldsMap,
      });

      expect(result).toBe("WHERE name LIKE '%john%'");
    });

    it('handles Int64 type without quotes in SQL mode', () => {
      const group = {
        filterType: 'group',
        logicalOperator: 'AND',
        conditions: [
          { filterType: 'condition', column: 'age', operator: '>=', value: 25, logicalOperator: 'AND' }
        ]
      };

      const result = buildConditionsString(group, {
        sqlMode: true,
        addWherePrefix: true,
        formatValues: true,
        streamFieldsMap,
      });

      expect(result).toBe("WHERE age >= 25");
    });

    it('handles String type with quotes in SQL mode', () => {
      const group = {
        filterType: 'group',
        logicalOperator: 'AND',
        conditions: [
          { filterType: 'condition', column: 'name', operator: '=', value: 'Alice', logicalOperator: 'AND' }
        ]
      };

      const result = buildConditionsString(group, {
        sqlMode: true,
        addWherePrefix: true,
        formatValues: true,
        streamFieldsMap,
      });

      expect(result).toBe("WHERE name = 'Alice'");
    });

    it('returns empty string for empty conditions', () => {
      const group = {
        filterType: 'group',
        logicalOperator: 'AND',
        conditions: []
      };

      const result = buildConditionsString(group, {
        sqlMode: true,
        addWherePrefix: true,
        formatValues: true,
        streamFieldsMap,
      });

      expect(result).toBe("");
    });

    it('handles not_contains operator in SQL mode', () => {
      const group = {
        filterType: 'group',
        logicalOperator: 'AND',
        conditions: [
          { filterType: 'condition', column: 'name', operator: 'not_contains', value: 'test', logicalOperator: 'AND' }
        ]
      };

      const result = buildConditionsString(group, {
        sqlMode: true,
        addWherePrefix: true,
        formatValues: true,
        streamFieldsMap,
      });

      expect(result).toBe("WHERE name NOT LIKE '%test%'");
    });

    it('handles mixed OR and AND operators', () => {
      const group = {
        filterType: 'group',
        logicalOperator: 'AND',
        conditions: [
          { filterType: 'condition', column: 'age', operator: '>', value: 18, logicalOperator: 'AND' },
          { filterType: 'condition', column: 'age', operator: '<', value: 65, logicalOperator: 'AND' },
          { filterType: 'condition', column: 'city', operator: '=', value: 'NYC', logicalOperator: 'OR' }
        ]
      };

      const result = buildConditionsString(group, {
        sqlMode: true,
        addWherePrefix: true,
        formatValues: true,
        streamFieldsMap,
      });

      expect(result).toBe("WHERE age > 18 AND age < 65 OR city = 'NYC'");
    });
  });
});

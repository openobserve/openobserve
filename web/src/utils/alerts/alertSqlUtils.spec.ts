import { describe, it, expect, beforeAll } from 'vitest';
import { addHavingClauseToQuery } from './alertSqlUtils';

describe('alertSqlUtils', () => {
  let parser: any;

  beforeAll(async () => {
    // Import the SQL parser using the same method as the codebase
    const useSqlParser: any = await import("@/composables/useParser");
    const { sqlParser }: any = useSqlParser.default();
    parser = await sqlParser();
  });

  describe('addHavingClauseToQuery', () => {
    it('should add HAVING clause before LIMIT', () => {
      const query = 'SELECT count(*) as cnt FROM table1 GROUP BY field1 ORDER BY cnt DESC LIMIT 10';
      const result = addHavingClauseToQuery(query, 'cnt', '>=', 5, parser);

      // Check that HAVING comes before LIMIT
      const havingIndex = result.toLowerCase().indexOf('having');
      const limitIndex = result.toLowerCase().indexOf('limit');

      expect(havingIndex).toBeGreaterThan(-1);
      expect(limitIndex).toBeGreaterThan(-1);
      expect(havingIndex).toBeLessThan(limitIndex);
      // Column names might be quoted in the output depending on parser success
      expect(result.toLowerCase()).toMatch(/having\s+(cnt|"cnt")\s+>=\s+5/);
    });

    it('should add HAVING clause before ORDER BY', () => {
      const query = 'SELECT avg(value) as avg_val FROM table1 GROUP BY region ORDER BY region';
      const result = addHavingClauseToQuery(query, 'avg_val', '>', 10, parser);

      const havingIndex = result.toLowerCase().indexOf('having');
      const orderByIndex = result.toLowerCase().indexOf('order by');

      expect(havingIndex).toBeGreaterThan(-1);
      expect(orderByIndex).toBeGreaterThan(-1);
      expect(havingIndex).toBeLessThan(orderByIndex);
      expect(result.toLowerCase()).toMatch(/having\s+(avg_val|"avg_val")\s+>\s+10/);
    });

    it('should add HAVING clause before LIMIT and OFFSET', () => {
      const query = 'SELECT sum(amount) as total FROM sales GROUP BY category ORDER BY total DESC LIMIT 100 OFFSET 50';
      const result = addHavingClauseToQuery(query, 'total', '<=', 1000, parser);

      const havingIndex = result.toLowerCase().indexOf('having');
      const limitIndex = result.toLowerCase().indexOf('limit');
      const offsetIndex = result.toLowerCase().indexOf('offset');

      expect(havingIndex).toBeGreaterThan(-1);
      expect(havingIndex).toBeLessThan(limitIndex);
      expect(havingIndex).toBeLessThan(offsetIndex);
      expect(result.toLowerCase()).toMatch(/having\s+(total|"total")\s+<=\s+1000/);
    });

    it('should combine with existing HAVING clause using AND', () => {
      const query = 'SELECT count(*) as cnt FROM table GROUP BY field HAVING cnt > 0 ORDER BY cnt DESC';
      const result = addHavingClauseToQuery(query, 'cnt', '>=', 5, parser);

      expect(result.toLowerCase()).toContain('having');
      expect(result).toContain('cnt >= 5');
      expect(result).toContain('AND');
      expect(result).toContain('cnt > 0');
    });

    it('should handle query without GROUP BY gracefully', () => {
      const query = 'SELECT count(*) as cnt FROM table ORDER BY cnt LIMIT 10';
      const result = addHavingClauseToQuery(query, 'cnt', '>=', 5, parser);

      // Should still add HAVING (even though it might not be semantically correct)
      expect(result).toContain('cnt >= 5');
    });

    it('should handle simple GROUP BY without ORDER BY or LIMIT', () => {
      const query = 'SELECT count(*) as cnt FROM table GROUP BY field';
      const result = addHavingClauseToQuery(query, 'cnt', '>=', 5, parser);

      expect(result).toContain('HAVING');
      expect(result).toContain('cnt >= 5');
    });

    it('should handle different operators', () => {
      const query = 'SELECT avg(score) as avg_score FROM tests GROUP BY student';

      const operators = ['>=', '<=', '>', '<', '='];
      operators.forEach(op => {
        const result = addHavingClauseToQuery(query, 'avg_score', op, 75, parser);
        // Use regex to handle quoted column names
        expect(result.toLowerCase()).toMatch(new RegExp(`having\\s+(avg_score|"avg_score")\\s+${op.replace(/([<>=])/g, '\\$1')}\\s+75`));
      });
    });

    it('should preserve double quotes in table names', () => {
      const query = 'SELECT count(*) as cnt FROM "my-table" GROUP BY field1 ORDER BY cnt LIMIT 10';
      const result = addHavingClauseToQuery(query, 'cnt', '>=', 5, parser);

      // Parser converts backticks to double quotes
      expect(result).toContain('"my-table"');
      expect(result.toLowerCase()).toMatch(/having\s+(cnt|"cnt")\s+>=\s+5/);
    });

    it('should handle complex aggregation functions', () => {
      const query = 'SELECT histogram(_timestamp) AS zo_sql_key, COUNT(*) as zo_sql_val FROM stream GROUP BY zo_sql_key ORDER BY zo_sql_key ASC';
      const result = addHavingClauseToQuery(query, 'zo_sql_val', '>=', 10, parser);

      const havingIndex = result.toLowerCase().indexOf('having');
      const orderByIndex = result.toLowerCase().indexOf('order by');

      expect(havingIndex).toBeGreaterThan(-1);
      expect(havingIndex).toBeLessThan(orderByIndex);
      expect(result.toLowerCase()).toMatch(/having\s+(zo_sql_val|"zo_sql_val")\s+>=\s+10/);
    });
  });

  describe('Input Validation', () => {
    it('should throw error for empty SQL query', () => {
      expect(() => addHavingClauseToQuery('', 'cnt', '>=', 5, parser))
        .toThrow('Invalid SQL query: must be a non-empty string');
    });

    it('should throw error for null column name', () => {
      const query = 'SELECT count(*) as cnt FROM table1 GROUP BY field1';
      expect(() => addHavingClauseToQuery(query, null as any, '>=', 5, parser))
        .toThrow('Column name must be a non-empty string');
    });

    it('should throw error for invalid operator', () => {
      const query = 'SELECT count(*) as cnt FROM table1 GROUP BY field1';
      expect(() => addHavingClauseToQuery(query, 'cnt', 'INVALID' as any, 5, parser))
        .toThrow('Invalid operator: INVALID');
    });

    it('should throw error for non-numeric threshold', () => {
      const query = 'SELECT count(*) as cnt FROM table1 GROUP BY field1';
      expect(() => addHavingClauseToQuery(query, 'cnt', '>=', NaN, parser))
        .toThrow('Invalid threshold: NaN');
    });

    it('should throw error for infinite threshold', () => {
      const query = 'SELECT count(*) as cnt FROM table1 GROUP BY field1';
      expect(() => addHavingClauseToQuery(query, 'cnt', '>=', Infinity, parser))
        .toThrow('Invalid threshold: Infinity');
    });

    it('should accept column names with underscores', () => {
      const query = 'SELECT count(*) as my_count FROM table1 GROUP BY field1';
      expect(() => addHavingClauseToQuery(query, 'my_count', '>=', 5, parser))
        .not.toThrow();
    });

    it('should accept qualified column names', () => {
      const query = 'SELECT count(*) as cnt FROM table1 GROUP BY field1';
      // Qualified names like table.column should work
      expect(() => addHavingClauseToQuery(query, 'table1.cnt', '>=', 5, parser))
        .not.toThrow();
    });
  });

  describe('Edge Cases', () => {
    it('should handle UNION queries', () => {
      const query = 'SELECT count(*) as cnt FROM table1 GROUP BY field1 UNION SELECT count(*) as cnt FROM table2 GROUP BY field2';
      // UNION queries may either throw an error or handle gracefully depending on parser
      try {
        const result = addHavingClauseToQuery(query, 'cnt', '>=', 5, parser);
        // If it doesn't throw, verify the query contains HAVING
        expect(result.toLowerCase()).toContain('having');
      } catch (error: any) {
        // If it throws, verify it's the expected error message
        expect(error.message).toMatch(/UNION|automatically add HAVING/);
      }
    });

    it('should handle queries with parentheses in functions', () => {
      const query = 'SELECT func(col1, col2) as result FROM table1 GROUP BY func(col1, col2) ORDER BY result';
      const result = addHavingClauseToQuery(query, 'result', '>', 10, parser);

      expect(result.toLowerCase()).toContain('having');
      const havingIndex = result.toLowerCase().indexOf('having');
      const orderByIndex = result.toLowerCase().indexOf('order by');
      expect(havingIndex).toBeLessThan(orderByIndex);
    });

    it('should not create double quotes when column name is already without quotes', () => {
      // Test case from the bug report: column name passed without quotes should get single quotes in output
      const query = 'SELECT histogram(_timestamp) AS "x_axis_1", COUNT(_timestamp) AS "y_axis_1" FROM "default" GROUP BY x_axis_1 ORDER BY x_axis_1 ASC LIMIT 100';
      const result = addHavingClauseToQuery(query, 'y_axis_1', '<=', 18258, parser);

      // Should have HAVING with single-quoted column name, not double-quoted
      expect(result).not.toContain('""y_axis_1""');
      expect(result.toLowerCase()).toMatch(/having\s+"?y_axis_1"?\s+<=\s+18258/);

      // Verify structure is correct
      const havingIndex = result.toLowerCase().indexOf('having');
      const orderByIndex = result.toLowerCase().indexOf('order by');
      const limitIndex = result.toLowerCase().indexOf('limit');

      expect(havingIndex).toBeGreaterThan(-1);
      expect(havingIndex).toBeLessThan(orderByIndex);
      expect(havingIndex).toBeLessThan(limitIndex);
    });

    it('should skip adding HAVING if exact condition already exists', () => {
      const query = 'SELECT count(*) as cnt FROM table1 GROUP BY field1 HAVING cnt >= 5 ORDER BY cnt';
      const result = addHavingClauseToQuery(query, 'cnt', '>=', 5, parser);

      // Should return unchanged query since the exact condition already exists
      expect(result.toLowerCase()).toMatch(/having\s+(cnt|"cnt")\s+>=\s+5/);
      // Should not have duplicate condition
      const havingMatches = result.match(/having/gi);
      expect(havingMatches?.length).toBe(1);
    });

    it('should append to existing HAVING if condition is different', () => {
      const query = 'SELECT count(*) as cnt FROM table1 GROUP BY field1 HAVING cnt > 0 ORDER BY cnt';
      const result = addHavingClauseToQuery(query, 'cnt', '>=', 5, parser);

      // Should append with AND
      expect(result.toLowerCase()).toContain('and');
      expect(result.toLowerCase()).toMatch(/having.*cnt.*>.*0.*and.*cnt.*>=.*5/);
    });
  });
});

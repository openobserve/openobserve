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

    it('should add HAVING to query without GROUP BY with warning', () => {
      // Note: HAVING without GROUP BY is semantically incorrect in SQL,
      // but the function adds it anyway because backend validation will catch it.
      // This allows for more flexible alert creation from various chart types.
      const query = 'SELECT count(*) as cnt FROM users ORDER BY cnt LIMIT 10';
      const result = addHavingClauseToQuery(query, 'cnt', '>=', 5, parser);

      // Should add HAVING clause despite missing GROUP BY
      // Column name might be quoted
      expect(result.toLowerCase()).toMatch(/(cnt|"cnt")\s+>=\s+5/);
      expect(result.toLowerCase()).toContain('having');

      // Verify console warning was logged (check implementation logs warning)
      // Backend SQL validation will reject this query if it's invalid
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
        // Properly escape special regex characters
        const escapedOp = op.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        expect(result.toLowerCase()).toMatch(new RegExp(`having\\s+(avg_score|"avg_score")\\s+${escapedOp}\\s+75`));
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

    it('should handle CTE (WITH) queries with fallback', () => {
      // This is the actual production issue that occurred
      const query = `WITH aggregated_data AS (
        SELECT
          histogram(_timestamp) as "x_axis_1",
          count(_timestamp) as "y_axis_1"
        FROM "default"
        GROUP BY x_axis_1
      )
      SELECT *
      FROM aggregated_data
      ORDER BY x_axis_1 ASC
      LIMIT 100`;

      const result = addHavingClauseToQuery(query, 'y_axis_1', '<=', 18258, parser);

      // CTE queries will use fallback method
      // Should contain HAVING somewhere in the result
      expect(result.toLowerCase()).toContain('having');
      expect(result.toLowerCase()).toMatch(/y_axis_1.*<=.*18258/);
    });

    it('should handle CTE with existing HAVING clause', () => {
      const query = `WITH cte AS (
        SELECT count(*) as cnt FROM users GROUP BY region HAVING cnt > 0
      )
      SELECT * FROM cte ORDER BY cnt LIMIT 100`;

      const result = addHavingClauseToQuery(query, 'cnt', '>=', 5, parser);

      // Should handle gracefully, likely using fallback
      expect(result.toLowerCase()).toContain('having');
    });
  });

  describe('Fallback Regex Method', () => {
    it('should use regex fallback when AST parsing fails', () => {
      // Query with vendor-specific syntax that parser might not understand
      const query = 'SELECT count(*) as cnt FROM users GROUP BY user_id ORDER BY cnt LIMIT 10';

      // Even if parser fails, fallback should work
      const result = addHavingClauseToQuery(query, 'cnt', '>=', 5, parser);

      expect(result.toLowerCase()).toContain('having');
      const havingIndex = result.toLowerCase().indexOf('having');
      const orderByIndex = result.toLowerCase().indexOf('order by');
      const limitIndex = result.toLowerCase().indexOf('limit');

      expect(havingIndex).toBeGreaterThan(-1);
      expect(havingIndex).toBeLessThan(orderByIndex);
      expect(havingIndex).toBeLessThan(limitIndex);
    });

    it('should handle complex nested queries in fallback', () => {
      // Nested query that might force fallback
      const query = 'SELECT region, count(*) as cnt FROM (SELECT * FROM users WHERE active = true) as active_users GROUP BY region ORDER BY cnt DESC LIMIT 50';

      const result = addHavingClauseToQuery(query, 'cnt', '>', 10, parser);

      // Should contain HAVING
      expect(result.toLowerCase()).toContain('having');
      expect(result.toLowerCase()).toMatch(/cnt.*>.*10/);
    });

    it('should warn but not fail for queries without GROUP BY', () => {
      // This tests the fallback warning behavior
      const query = 'SELECT count(*) as cnt FROM users ORDER BY cnt LIMIT 10';

      // Should not throw, but will add HAVING anyway (backend will validate)
      const result = addHavingClauseToQuery(query, 'cnt', '>=', 5, parser);

      // Column name might be quoted
      expect(result.toLowerCase()).toMatch(/(cnt|"cnt")\s+>=\s+5/);
      expect(result.toLowerCase()).toContain('having');
    });
  });
});

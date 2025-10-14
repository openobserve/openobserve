/**
 * Alert SQL Query Utilities
 * Extracted from AddAlert.vue to reduce file complexity
 */

export interface SqlUtilsContext {
  parser: any;
  sqlQueryErrorMsg: any;
}
type ComparisonOperator = '>=' | '<=' | '>' | '<' | '=' | '!=' | '<>';

export const getParser = (sqlQuery: string, context: SqlUtilsContext): boolean => {
  const { parser, sqlQueryErrorMsg } = context;
  try {
    // As default is a reserved keyword in sql-parser, we are replacing it with default1
    const regex = /\bdefault\b/g;
    const columns = parser.astify(
      sqlQuery.replace(regex, "default1"),
    ).columns;
    for (const column of columns) {
      if (column.expr.column === "*") {
        sqlQueryErrorMsg.value = "Selecting all columns is not allowed";
        return false;
      }
    }
    return true;
  } catch (error) {
    // In catch block we are returning true, as we just wanted to validate if user have added * in the query to select all columns
    // select field from default // here default is not wrapped in "" so node sql parser will throw error as default is a reserved keyword. But our Backend supports this query without quotes
    // Query will be validated in the backend
    console.log(error);
    return true;
  }
};

/**
 * Adds or appends a HAVING clause to a SQL query in the correct position
 *
 * Strategy:
 * 1. Parse SQL into AST using node-sql-parser
 * 2. Add HAVING condition to the AST
 * 3. Let node-sql-parser generate the SQL with correct clause ordering
 * 4. If parsing fails, fall back to regex-based insertion
 *
 * @param sqlQuery - The original SQL query
 * @param yAxisColumn - The column name to use in the HAVING clause
 * @param operator - The comparison operator (e.g., '>=', '<=', '>', '<', '=')
 * @param threshold - The threshold value for comparison
 * @param parser - The node-sql-parser instance
 * @returns The modified SQL query with the HAVING clause properly inserted
 */
export const addHavingClauseToQuery = (
  sqlQuery: string,
  yAxisColumn: string,
  operator: string,
  threshold: number,
  parser: any
): string => {
  // === Input Validation ===
  if (!sqlQuery || typeof sqlQuery !== 'string' || sqlQuery.trim().length === 0) {
    throw new Error('Invalid SQL query: must be a non-empty string');
  }

  // Validate column name - allow qualified names (table.column) and quoted identifiers
  if (!yAxisColumn || typeof yAxisColumn !== 'string') {
    throw new Error('Column name must be a non-empty string');
  }

  // Validate operator
  const validOperators: ComparisonOperator[] = ['>=', '<=', '>', '<', '=', '!=', '<>'];
  if (!validOperators.includes(operator as ComparisonOperator)) {
    throw new Error(`Invalid operator: ${operator}. Must be one of: ${validOperators.join(', ')}`);
  }

  // Validate threshold
  if (typeof threshold !== 'number' || !isFinite(threshold)) {
    throw new Error(`Invalid threshold: ${threshold}. Must be a finite number`);
  }

  if (!parser || typeof parser.astify !== 'function' || typeof parser.sqlify !== 'function') {
    throw new Error('Invalid parser: must have astify and sqlify methods');
  }

  try {
    // Parse the SQL query into an AST
    const ast = parser.astify(sqlQuery);

    // Handle array of statements (e.g., UNION queries)
    if (Array.isArray(ast)) {
      // UNION queries are complex - adding HAVING to the wrong SELECT can break the query
      // Use fallback method instead
      console.warn('UNION query detected, using fallback method');
      throw new Error('UNION queries require fallback method');
    }

    // Validate that query has GROUP BY (HAVING requires it)
    if (!ast.groupby || ast.groupby.length === 0) {
      console.warn('Adding HAVING clause to query without GROUP BY may cause SQL error');
    }

    // Create the new HAVING condition
    const newHavingCondition = {
      type: 'binary_expr',
      operator: operator,
      left: {
        type: 'column_ref',
        table: null,
        column: yAxisColumn  // node-sql-parser handles quoting
      },
      right: {
        type: 'number',
        value: threshold
      }
    };

    // If there's already a HAVING clause, check if it's a duplicate before combining
    if (ast.having) {
      // Check if the exact condition already exists
      const sqlified = parser.sqlify(ast, { database: 'PostgreSQL' });
      const conditionPattern = new RegExp(
        `${yAxisColumn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*${operator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*${threshold}`,
        'i'
      );

      if (conditionPattern.test(sqlified)) {
        console.log('HAVING clause with same condition already exists in AST, skipping addition');
        return sqlified; // Return the query as-is
      }

      // Keep existing condition on the left with parentheses for proper grouping
      // Example: HAVING (a OR b) AND new_condition
      ast.having = {
        type: 'binary_expr',
        operator: 'AND',
        left: {
          ...ast.having,
          parentheses: true  // Preserve original condition grouping
        },
        right: newHavingCondition
      };
    } else {
      // Add the new HAVING clause
      ast.having = newHavingCondition;
    }

    // Convert AST back to SQL with PostgreSQL dialect (uses double quotes)
    const modifiedQuery = parser.sqlify(ast, {
      database: 'PostgreSQL'
    });

    return modifiedQuery;

  } catch (error) {
    // If parsing fails, fall back to regex-based insertion
    console.warn('Failed to parse SQL query for HAVING clause insertion:', error);
    console.warn('Query:', sqlQuery);
    console.warn('Column:', yAxisColumn, 'Operator:', operator, 'Threshold:', threshold);
    console.warn('Using fallback regex method...');
    return fallbackHavingInsertion(sqlQuery, yAxisColumn, operator, threshold);
  }
};

/**
 * Fallback method using regex when AST parsing fails
 * This method has limitations and should only be used as a last resort
 */
function fallbackHavingInsertion(
  sqlQuery: string,
  yAxisColumn: string,
  operator: string,
  threshold: number
): string {
  const havingClause = `HAVING ${yAxisColumn} ${operator} ${threshold}`;
  const sqlLower = sqlQuery.toLowerCase();

  // Warn about subqueries - fallback may not work correctly
  if (sqlQuery.match(/\(\s*SELECT/i)) {
    console.warn('Query contains subqueries. Fallback HAVING insertion may not work correctly.');
    console.warn('The HAVING clause will be added to the outermost query, which may not be the intended location.');
  }

  // Check if GROUP BY exists - HAVING requires it
  const groupByMatch = sqlQuery.match(/\s+GROUP\s+BY\s+/i);
  if (!groupByMatch) {
    console.warn('Adding HAVING without GROUP BY - this will likely cause a SQL error');
  }

  // Check if HAVING already exists
  if (sqlLower.includes('having')) {
    // Check if the exact condition already exists in the HAVING clause
    const existingConditionPattern = new RegExp(
      `having\\s+.*${yAxisColumn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*${operator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*${threshold}`,
      'i'
    );

    if (existingConditionPattern.test(sqlQuery)) {
      console.log('HAVING clause with same condition already exists, skipping addition');
      return sqlQuery; // Return unchanged
    }

    // Find the existing HAVING clause and append with AND
    // Match HAVING ... up to ORDER BY/LIMIT/OFFSET or end of string
    console.log('Appending new condition to existing HAVING clause');
    return sqlQuery.replace(
      /(having\s+.+?)(\s+(?:order\s+by|limit|offset)|$)/i,
      `$1 AND ${yAxisColumn} ${operator} ${threshold}$2`
    );
  }

  // Find the position to insert HAVING clause
  // Priority: after GROUP BY, before ORDER BY, before LIMIT, before OFFSET

  // Try to find ORDER BY
  const orderByMatch = sqlQuery.match(/\s+ORDER\s+BY\s+/i);
  if (orderByMatch && orderByMatch.index !== undefined) {
    return sqlQuery.slice(0, orderByMatch.index) +
           ` ${havingClause}` +
           sqlQuery.slice(orderByMatch.index);
  }

  // Try to find LIMIT
  const limitMatch = sqlQuery.match(/\s+LIMIT\s+/i);
  if (limitMatch && limitMatch.index !== undefined) {
    return sqlQuery.slice(0, limitMatch.index) +
           ` ${havingClause}` +
           sqlQuery.slice(limitMatch.index);
  }

  // Try to find OFFSET (without LIMIT)
  const offsetMatch = sqlQuery.match(/\s+OFFSET\s+/i);
  if (offsetMatch && offsetMatch.index !== undefined) {
    return sqlQuery.slice(0, offsetMatch.index) +
           ` ${havingClause}` +
           sqlQuery.slice(offsetMatch.index);
  }

  // If no ORDER BY, LIMIT, or OFFSET found, append at the end
  return `${sqlQuery.trim()} ${havingClause}`;
}
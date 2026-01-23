// Copyright 2025 OpenObserve Inc.
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

import { Parser } from "@openobserve/node-sql-parser";

interface AxisItem {
  label: string;
  alias: string;
  column?: string;
  type: "build" | "raw" | "custom";
  color: string | null;
  functionName: string | null;
  sortBy: string | null;
  args: AxisArg[];
  isDerived?: boolean;
  havingConditions?: HavingCondition[];
  treatAsNonTimestamp?: boolean;
  showFieldAsJson?: boolean;
  rawQuery?: string;  // Raw SQL expression for type="raw" fields (CASE statements, etc.)
}

interface AxisArg {
  type: string;
  value?: AxisArgValue | string | number;
}

interface AxisArgValue {
  field?: string;
  streamAlias?: string;
}

interface HavingCondition {
  value: number | null;
  operator: string | null;
}

interface FilterCondition {
  type: string;
  values: string[];
  column: { field: string; streamAlias?: string } | null;
  operator: string | null;
  value: string | null;
  logicalOperator: string;
  filterType: string;
}

interface PanelFilter {
  filterType: string;
  logicalOperator: string;
  conditions: (FilterCondition | PanelFilter)[];
}

interface JoinItem {
  stream: string;
  streamAlias: string;
  joinType: string;
  conditions: JoinCondition[];
}

interface JoinCondition {
  leftField: {
    streamAlias?: string;
    field: string;
  };
  rightField: {
    streamAlias?: string;
    field: string;
  };
  operation: string;
}

interface PanelQuery {
  query: string;
  vrlFunctionQuery: string;
  customQuery: boolean;
  joins: JoinItem[];
  fields: {
    stream: string;
    stream_type: "logs" | "metrics" | "traces";
    x: AxisItem[];
    y: AxisItem[];
    z: AxisItem[];
    breakdown: AxisItem[];
    promql_labels: any[];
    promql_operations: any[];
    filter: PanelFilter;
    latitude: AxisItem | null;
    longitude: AxisItem | null;
    weight: AxisItem | null;
    name: AxisItem | null;
    value_for_maps: AxisItem | null;
    source: AxisItem | null;
    target: AxisItem | null;
    value: AxisItem | null;
  };
  config: {
    promql_legend: string;
    step_value: string | null;
    layer_type: string;
    weight_fixed: number;
    limit: number;
    min: number;
    max: number;
    time_shift: any[];
  };
}

/**
 * SQL Query Parser for OpenObserve Dashboard Panels
 *
 * This parser converts SQL queries into dashboard panel query objects.
 * It supports:
 * - Complex nested functions with multiple arguments
 * - JOINs (INNER, LEFT, RIGHT, FULL OUTER)
 * - WHERE clause filters (converted to filter conditions)
 * - GROUP BY (converted to x-axis fields)
 * - Aggregation functions (converted to y-axis fields)
 * - HAVING clause (converted to havingConditions)
 * - ORDER BY (converted to sortBy)
 * - Multi-level function nesting
 *
 * @example
 * const parser = new SQLQueryParser();
 * const query = `
 *   SELECT
 *     histogram(_timestamp, '1h') as time_bucket,
 *     COUNT(*) as total_count,
 *     AVG(response_time) as avg_response
 *   FROM logs
 *   WHERE status_code >= 400
 *   GROUP BY time_bucket
 *   ORDER BY time_bucket ASC
 * `;
 * const panelQuery = parser.parseQueryToPanelObject(query);
 */
export class SQLQueryParser {
  private parser: Parser;
  private colors = [
    "#5960b2",
    "#c23531",
    "#2f4554",
    "#61a0a8",
    "#d48265",
    "#91c7ae",
    "#749f83",
    "#ca8622",
    "#bda29a",
    "#6e7074",
    "#546570",
    "#c4ccd3",
  ];
  private colorIndex = 0;

  constructor() {
    this.parser = new Parser();
  }

  /**
   * Main parsing function that converts SQL query to panel query object
   */
  public parseQueryToPanelObject(
    sqlQuery: string,
    streamType: "logs" | "metrics" | "traces" = "logs"
  ): PanelQuery {
    console.log("[SQLQueryParser] Starting to parse query:", sqlQuery);

    try {
      console.log("[SQLQueryParser] Step 1: Parsing SQL to AST...");
      const ast = this.parser.astify(sqlQuery, { database: "PostgresQL" });
      console.log("[SQLQueryParser] AST parsed successfully:", JSON.stringify(ast, null, 2));

      const selectAst = Array.isArray(ast) ? ast[0] : ast;
      console.log("[SQLQueryParser] Select AST:", JSON.stringify(selectAst, null, 2));

      if (selectAst.type !== "select") {
        throw new Error("Only SELECT queries are supported");
      }

      // Extract main stream name
      console.log("[SQLQueryParser] Step 2: Extracting stream name...");
      const stream = this.extractStreamName(selectAst);
      console.log("[SQLQueryParser] Stream name:", stream);

      // Check if columns exist
      console.log("[SQLQueryParser] Step 3: Checking columns...");
      console.log("[SQLQueryParser] Columns:", JSON.stringify(selectAst.columns, null, 2));

      if (!selectAst.columns || selectAst.columns.length === 0) {
        throw new Error("Query must have SELECT columns");
      }

      // Check for SELECT * - create default histogram + count visualization
      const isSelectStar =
        selectAst.columns.length === 1 &&
        selectAst.columns[0].expr &&
        ((selectAst.columns[0].expr.type === "star") ||
         (selectAst.columns[0].expr.type === "column_ref" &&
          selectAst.columns[0].expr.column === "*"));

      let xAxis: AxisItem[] = [];
      let yAxis: AxisItem[] = [];
      let breakdown: AxisItem[] = [];

      if (isSelectStar) {
        console.log("[SQLQueryParser] SELECT * detected, creating default histogram + count");

        // Create default x-axis: histogram(_timestamp) as "x_axis_1"
        xAxis = [{
          label: "Timestamp",
          alias: "x_axis_1",
          column: "_timestamp",
          type: "build",
          color: null,
          functionName: "histogram",
          sortBy: "ASC",
          args: [
            {
              type: "field",
              value: {
                field: "_timestamp",
              },
            },
          ],
          isDerived: false,
          havingConditions: [],
          treatAsNonTimestamp: false,
          showFieldAsJson: false,
        }];

        // Create default y-axis: count(_timestamp) as "y_axis_1"
        yAxis = [{
          label: "Count",
          alias: "y_axis_1",
          type: "build",
          color: this.getNextColor(),
          functionName: "count",
          sortBy: null,
          args: [
            {
              type: "field",
              value: {
                field: "_timestamp",
              },
            },
          ],
          isDerived: false,
          havingConditions: [],
          treatAsNonTimestamp: true,
          showFieldAsJson: false,
        }];
      } else {
        // Parse columns normally
        console.log("[SQLQueryParser] Step 4: Parsing columns...");
        const parsed = this.parseColumns(selectAst.columns);
        xAxis = parsed.xAxis;
        yAxis = parsed.yAxis;
        breakdown = parsed.breakdown;
      }

      console.log("[SQLQueryParser] Parsed axes - xAxis:", xAxis.length, "yAxis:", yAxis.length, "breakdown:", breakdown.length);

      // Parse WHERE clause to filters
      const filter = this.parseWhereClause(selectAst.where);

      // Parse GROUP BY clause
      const groupByFields = this.parseGroupBy(selectAst.groupby);
      console.log("[SQLQueryParser] Step 5: Parsed GROUP BY fields:", groupByFields.length);

      // Identify breakdown field: if GROUP BY has 2+ columns, the 2nd+ are breakdown
      // Move fields from xAxis to breakdown based on GROUP BY order
      if (groupByFields.length >= 2) {
        // First GROUP BY field stays in xAxis
        // Second+ GROUP BY fields should be breakdown
        for (let i = 1; i < groupByFields.length; i++) {
          const groupByAlias = groupByFields[i].alias;
          console.log("[SQLQueryParser] Looking for breakdown field with alias:", groupByAlias);

          // Find matching field in xAxis and move to breakdown
          const xIndex = xAxis.findIndex(
            (x) => x.alias === groupByAlias || x.column === groupByAlias
          );

          if (xIndex !== -1) {
            console.log("[SQLQueryParser] Moving field from xAxis to breakdown:", xAxis[xIndex].alias);
            breakdown.push(xAxis[xIndex]);
            xAxis.splice(xIndex, 1);
          }
        }
      }

      // Merge GROUP BY fields into x-axis (if not already there)
      this.mergeGroupByIntoXAxis(xAxis, groupByFields.slice(0, 1)); // Only merge first GROUP BY field

      // Parse HAVING clause
      this.parseHavingClause(selectAst.having, yAxis);

      // Parse ORDER BY clause
      this.parseOrderBy(selectAst.orderby, xAxis, yAxis);

      // Parse JOINs
      const joins = this.parseJoins(selectAst);

      return {
        query: sqlQuery,
        vrlFunctionQuery: "",
        customQuery: false, // Set to false for visual query builder
        joins,
        fields: {
          stream,
          stream_type: streamType,
          x: xAxis,
          y: yAxis,
          z: [],
          breakdown,
          promql_labels: [],
          promql_operations: [],
          filter,
          latitude: null,
          longitude: null,
          weight: null,
          name: null,
          value_for_maps: null,
          source: null,
          target: null,
          value: null,
        },
        config: {
          promql_legend: "",
          step_value: null,
          layer_type: "scatter",
          weight_fixed: 1,
          limit: selectAst.limit?.value?.[0]?.value || 0,
          min: 0,
          max: 100,
          time_shift: [],
        },
      };
    } catch (error: any) {
      console.error("SQL parsing error:", error);
      throw new Error(`Failed to parse SQL query: ${error.message}`);
    }
  }

  /**
   * Extract stream name from FROM clause
   */
  private extractStreamName(ast: any): string {
    if (!ast.from || ast.from.length === 0) {
      return "";
    }

    const from = ast.from[0];
    return from.table || "";
  }

  /**
   * Parse SELECT columns into x-axis, y-axis, and breakdown fields
   */
  private parseColumns(columns: any[]): {
    xAxis: AxisItem[];
    yAxis: AxisItem[];
    breakdown: AxisItem[];
  } {
    const xAxis: AxisItem[] = [];
    const yAxis: AxisItem[] = [];
    const breakdown: AxisItem[] = [];

    if (!columns || columns.length === 0) {
      return { xAxis, yAxis, breakdown };
    }

    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      console.log(`[SQLQueryParser.parseColumns] Processing column ${i}:`, JSON.stringify(col, null, 2));

      // Skip columns without expr property
      if (!col.expr) {
        console.log(`[SQLQueryParser.parseColumns] Column ${i} has no expr, skipping`);
        continue;
      }

      console.log(`[SQLQueryParser.parseColumns] Column ${i} type:`, col.expr.type);

      if (col.expr.type === "column_ref") {
        // Simple column reference - could be x-axis or breakdown
        console.log(`[SQLQueryParser.parseColumns] Column ${i} is column_ref, creating axis item...`);
        const axisItem = this.createAxisItemFromColumn(col);
        xAxis.push(axisItem);
      } else if (col.expr.type === "aggr_func") {
        // Aggregation function - y-axis
        console.log(`[SQLQueryParser.parseColumns] Column ${i} is aggr_func, creating axis item...`);
        const axisItem = this.createAxisItemFromAggregation(col);
        yAxis.push(axisItem);
      } else if (col.expr.type === "function") {
        // Function call - need to determine if it's aggregation or transformation
        console.log(`[SQLQueryParser.parseColumns] Column ${i} is function:`, col.expr.name);
        const axisItem = this.createAxisItemFromFunction(col);

        // Extract function name to check if it's aggregation
        // @openobserve/node-sql-parser returns name as object: { name: [{ type: "default", value: "..." }] }
        let funcName: string = "";
        if (col.expr.name) {
          if (typeof col.expr.name === "string") {
            funcName = col.expr.name;
          } else if (col.expr.name?.name && Array.isArray(col.expr.name.name)) {
            funcName = col.expr.name.name[0]?.value || "";
          }
        }

        // Check if it's an aggregation function
        if (funcName && this.isAggregationFunction(funcName)) {
          console.log(`[SQLQueryParser.parseColumns] Function ${funcName} is aggregation, adding to yAxis`);
          yAxis.push(axisItem);
        } else {
          // Non-aggregation functions go to x-axis (like histogram, date_trunc, etc.)
          console.log(`[SQLQueryParser.parseColumns] Function ${funcName} is transformation, adding to xAxis`);
          xAxis.push(axisItem);
        }
      } else if (col.expr.type === "binary_expr") {
        // Binary expression - treat as y-axis (calculated field)
        console.log(`[SQLQueryParser.parseColumns] Column ${i} is binary_expr, creating axis item...`);
        const axisItem = this.createAxisItemFromExpression(col);
        yAxis.push(axisItem);
      } else if (col.expr.type === "case") {
        // CASE statement - cannot be parsed into visual builder
        // Throw error to trigger customQuery mode
        console.log(`[SQLQueryParser.parseColumns] Column ${i} is CASE statement, cannot parse into visual builder`);
        throw new Error("CASE statements are not supported in visual query builder. Please use custom SQL mode.");
      } else {
        // Other expressions - treat as raw fields
        console.log(`[SQLQueryParser.parseColumns] Column ${i} has unknown type (${col.expr.type}), treating as raw field`);
        const axisItem = this.createRawAxisItem(col);
        xAxis.push(axisItem);
      }
    }

    return { xAxis, yAxis, breakdown };
  }

  /**
   * Create axis item from simple column reference
   */
  private createAxisItemFromColumn(col: any): AxisItem {
    // @openobserve/node-sql-parser uses column.expr.value instead of just column
    let columnName = "";
    if (typeof col.expr.column === "string") {
      columnName = col.expr.column;
    } else if (col.expr.column?.expr?.value) {
      columnName = col.expr.column.expr.value;
    }

    const alias = col.as || columnName;
    const streamAlias = col.expr.table || undefined;

    return {
      label: this.generateLabel(alias),
      alias: alias,
      column: columnName,
      type: "build",  // Changed from "raw" to "build" to match addBreakDownAxisItem structure
      color: null,
      functionName: null,  // null for plain columns (non-aggregation, non-function)
      sortBy: null,
      args: [
        {
          type: "field",
          value: {
            field: columnName,
            streamAlias,
          },
        },
      ],
      isDerived: false,
      havingConditions: [],
      treatAsNonTimestamp: true,
      showFieldAsJson: false,
    };
  }

  /**
   * Create axis item from aggregation function
   */
  private createAxisItemFromAggregation(col: any): AxisItem {
    // Note: aggr_func name is a string, not an object like function names
    const funcName = col.expr.name.toLowerCase();

    // Extract column name for alias fallback
    let columnForAlias = "value";
    if (col.expr.args?.expr?.column) {
      if (typeof col.expr.args.expr.column === "string") {
        columnForAlias = col.expr.args.expr.column;
      } else if (col.expr.args.expr.column?.expr?.value) {
        columnForAlias = col.expr.args.expr.column.expr.value;
      }
    }

    const alias = col.as || `${funcName}_${columnForAlias}`;
    const args = this.parseAggregationArgs(col.expr.args);

    return {
      label: this.generateLabel(alias),
      alias: alias,
      type: "build",
      color: this.getNextColor(),
      functionName: funcName,
      sortBy: null,
      args: args,
      isDerived: false,
      havingConditions: [],
      treatAsNonTimestamp: true,
      showFieldAsJson: false,
    };
  }

  /**
   * Create axis item from function call (supports nested functions)
   */
  private createAxisItemFromFunction(col: any): AxisItem {
    console.log("[SQLQueryParser.createAxisItemFromFunction] Input col:", JSON.stringify(col, null, 2));
    console.log("[SQLQueryParser.createAxisItemFromFunction] col.expr:", JSON.stringify(col.expr, null, 2));

    // Extract function name for alias fallback
    // @openobserve/node-sql-parser returns name as object: { name: [{ type: "default", value: "..." }] }
    let funcNameForAlias = "";
    if (col.expr.name) {
      if (typeof col.expr.name === "string") {
        funcNameForAlias = col.expr.name;
      } else if (col.expr.name?.name && Array.isArray(col.expr.name.name)) {
        funcNameForAlias = col.expr.name.name[0]?.value || "";
      }
    }

    const alias = col.as || funcNameForAlias;
    console.log("[SQLQueryParser.createAxisItemFromFunction] Alias:", alias);
    console.log("[SQLQueryParser.createAxisItemFromFunction] Calling parseFunctionRecursive...");

    const { functionName, args, isAggregation } = this.parseFunctionRecursive(col.expr);

    console.log("[SQLQueryParser.createAxisItemFromFunction] Parsed function:", functionName, "isAggregation:", isAggregation);

    return {
      label: this.generateLabel(alias),
      alias: alias,
      type: "build",
      color: isAggregation ? this.getNextColor() : null,
      functionName: functionName,
      sortBy: null,
      args: args,
      isDerived: false,
      havingConditions: [],
      treatAsNonTimestamp: functionName === "histogram" ? false : true,
      showFieldAsJson: false,
    };
  }

  /**
   * Create axis item from binary expression
   */
  private createAxisItemFromExpression(col: any): AxisItem {
    const alias = col.as || "expression";

    return {
      label: this.generateLabel(alias),
      alias: alias,
      type: "custom",
      color: this.getNextColor(),
      functionName: null,
      sortBy: null,
      args: [],
      isDerived: true,
      havingConditions: [],
      treatAsNonTimestamp: true,
      showFieldAsJson: false,
    };
  }

  /**
   * Create raw axis item for unknown types (CASE statements, subqueries, etc.)
   */
  private createRawAxisItem(col: any, assignColor: boolean = false): AxisItem {
    const alias = col.as || "field";

    // Convert the expression back to SQL using the parser's sqlify method
    let rawQuery = "";
    try {
      rawQuery = this.parser.sqlify(col.expr);
      console.log(`[SQLQueryParser.createRawAxisItem] Converted expression to SQL: ${rawQuery}`);
    } catch (error) {
      console.warn("[SQLQueryParser.createRawAxisItem] Failed to convert expression to SQL:", error);
      rawQuery = "";
    }

    return {
      label: this.generateLabel(alias),
      alias: alias,
      type: "raw",
      color: null,
      functionName: null,
      sortBy: null,
      args: [],
      isDerived: false,
      havingConditions: [],
      treatAsNonTimestamp: true,
      showFieldAsJson: false,
      rawQuery: rawQuery,  // Store the raw SQL expression
    };
  }

  /**
   * Recursively parse nested functions
   * Supports multi-level nesting like: ROUND(AVG(COUNT(field)), 2)
   */
  private parseFunctionRecursive(funcExpr: any): {
    functionName: string;
    args: AxisArg[];
    isAggregation: boolean;
  } {
    console.log("[SQLQueryParser.parseFunctionRecursive] Input funcExpr:", JSON.stringify(funcExpr, null, 2));

    // Handle null or undefined function expressions
    if (!funcExpr || !funcExpr.name) {
      console.error("[SQLQueryParser.parseFunctionRecursive] ERROR: Invalid function expression:", funcExpr);
      throw new Error("Invalid function expression: missing function name");
    }

    // Extract function name - @openobserve/node-sql-parser returns name as an object
    // with structure: { name: [{ type: "default", value: "function_name" }] }
    let functionName: string;
    if (typeof funcExpr.name === "string") {
      functionName = funcExpr.name.toLowerCase();
    } else if (funcExpr.name?.name && Array.isArray(funcExpr.name.name)) {
      functionName = funcExpr.name.name[0]?.value?.toLowerCase() || "";
    } else {
      console.error("[SQLQueryParser.parseFunctionRecursive] ERROR: Unknown function name format:", funcExpr.name);
      throw new Error("Invalid function expression: unknown function name format");
    }

    console.log("[SQLQueryParser.parseFunctionRecursive] Function name:", functionName);

    const isAggregation = this.isAggregationFunction(functionName);
    console.log("[SQLQueryParser.parseFunctionRecursive] Is aggregation:", isAggregation);

    const args: AxisArg[] = [];

    // Check for both args.value (OpenObserve parser) and args.expr (standard parser)
    if (!funcExpr.args || (!funcExpr.args.value && !funcExpr.args.expr)) {
      console.log("[SQLQueryParser.parseFunctionRecursive] No args, returning early");
      return { functionName, args, isAggregation };
    }

    console.log("[SQLQueryParser.parseFunctionRecursive] Has args, processing...");

    // Handle different argument types
    // @openobserve/node-sql-parser uses args.value instead of args.expr for function args
    const argsArray = Array.isArray(funcExpr.args.value)
      ? funcExpr.args.value
      : funcExpr.args.expr
      ? (Array.isArray(funcExpr.args.expr) ? funcExpr.args.expr : [funcExpr.args.expr])
      : [];

    console.log("[SQLQueryParser.parseFunctionRecursive] Args array:", JSON.stringify(argsArray, null, 2));

    for (const arg of argsArray) {
      console.log("[SQLQueryParser.parseFunctionRecursive] Processing arg:", JSON.stringify(arg, null, 2));

      if (arg.type === "column_ref") {
        // Column reference
        // @openobserve/node-sql-parser uses column.expr.value instead of just column
        let columnName = "";
        if (typeof arg.column === "string") {
          columnName = arg.column;
        } else if (arg.column?.expr?.value) {
          columnName = arg.column.expr.value;
        }

        console.log("[SQLQueryParser.parseFunctionRecursive] Column name:", columnName);

        args.push({
          type: "field",
          value: {
            field: columnName,
            streamAlias: arg.table || undefined,
          },
        });
      } else if (arg.type === "function" || arg.type === "aggr_func") {
        // Nested function - recursively parse
        const nested = this.parseFunctionRecursive(arg);
        args.push({
          type: "function",
          value: {
            functionName: nested.functionName,
            args: nested.args,
          } as any,
        });
      } else if (arg.type === "number") {
        // Numeric argument
        args.push({
          type: "number",
          value: arg.value,
        });
      } else if (arg.type === "string" || arg.type === "single_quote_string") {
        // String argument (like histogram interval)
        args.push({
          type: arg.name === "interval" ? "histogramInterval" : "string",
          value: arg.value,
        });
      } else if (arg.type === "star") {
        // COUNT(*) case
        args.push({
          type: "star",
        });
      } else {
        // Unknown type - store as raw
        args.push({
          type: "raw",
          value: JSON.stringify(arg),
        });
      }
    }

    return { functionName, args, isAggregation };
  }

  /**
   * Parse aggregation function arguments
   */
  private parseAggregationArgs(argsExpr: any): AxisArg[] {
    if (!argsExpr || !argsExpr.expr) {
      return [];
    }

    const args: AxisArg[] = [];

    if (argsExpr.expr.type === "column_ref") {
      // @openobserve/node-sql-parser uses column.expr.value instead of just column
      let columnName = "";
      if (typeof argsExpr.expr.column === "string") {
        columnName = argsExpr.expr.column;
      } else if (argsExpr.expr.column?.expr?.value) {
        columnName = argsExpr.expr.column.expr.value;
      }

      args.push({
        type: "field",
        value: {
          field: columnName,
          streamAlias: argsExpr.expr.table || undefined,
        },
      });
    } else if (argsExpr.expr.type === "star") {
      // COUNT(*) case
      args.push({
        type: "star",
      });
    } else if (argsExpr.expr.type === "function") {
      // Nested function in aggregation
      const nested = this.parseFunctionRecursive(argsExpr.expr);
      args.push({
        type: "function",
        value: {
          functionName: nested.functionName,
          args: nested.args,
        } as any,
      });
    }

    return args;
  }

  /**
   * Parse WHERE clause into filter conditions
   */
  private parseWhereClause(whereClause: any): PanelFilter {
    const defaultFilter: PanelFilter = {
      filterType: "group",
      logicalOperator: "AND",
      conditions: [],
    };

    if (!whereClause) {
      return defaultFilter;
    }

    const result = this.parseFilterRecursive(whereClause);

    // If result is a single condition, wrap it in a group
    if ('column' in result && result.filterType === 'condition') {
      return {
        filterType: "group",
        logicalOperator: "AND",
        conditions: [result],
      };
    }

    return result as PanelFilter;
  }

  /**
   * Recursively parse filter conditions (supports nested AND/OR)
   */
  private parseFilterRecursive(expr: any): PanelFilter | FilterCondition {
    if (expr.type === "binary_expr") {
      const operator = expr.operator.toUpperCase();

      // Logical operators (AND, OR)
      if (operator === "AND" || operator === "OR") {
        const left = this.parseFilterRecursive(expr.left);
        const right = this.parseFilterRecursive(expr.right);

        return {
          filterType: "group",
          logicalOperator: operator,
          conditions: [left, right],
        };
      }

      // Comparison operators (=, !=, >, <, >=, <=, LIKE, IN, etc.)
      return this.createFilterCondition(expr);
    }

    // Default empty group
    return {
      filterType: "group",
      logicalOperator: "AND",
      conditions: [],
    };
  }

  /**
   * Create filter condition from binary expression
   */
  private createFilterCondition(expr: any): FilterCondition {
    const operator = expr.operator.toUpperCase();

    // @openobserve/node-sql-parser uses column.expr.value instead of just column
    let column = "";
    if (expr.left.column) {
      if (typeof expr.left.column === "string") {
        column = expr.left.column;
      } else if (expr.left.column?.expr?.value) {
        column = expr.left.column.expr.value;
      }
    }

    const streamAlias = expr.left.table || undefined;

    let value = null;
    let values: string[] = [];
    let conditionType = "condition";

    // Handle different right-hand side types
    if (expr.right.type === "string" || expr.right.type === "single_quote_string") {
      value = expr.right.value;
      values = [value];
    } else if (expr.right.type === "number") {
      value = String(expr.right.value);
      values = [value];
    } else if (expr.right.type === "expr_list") {
      // IN clause
      values = expr.right.value.map((v: any) => {
        if (v.type === "string" || v.type === "single_quote_string") {
          return v.value;
        } else if (v.type === "number") {
          return String(v.value);
        }
        return String(v);
      });
      conditionType = "list";
    }

    return {
      type: conditionType,
      values,
      column: {
        field: column,
        streamAlias,
      },
      operator: this.mapOperator(operator),
      value,
      logicalOperator: "AND",
      filterType: "condition",
    };
  }

  /**
   * Map SQL operators to OpenObserve operators
   */
  private mapOperator(sqlOperator: string): string {
    const operatorMap: { [key: string]: string } = {
      "=": "=",
      "!=": "!=",
      "<>": "!=",
      ">": ">",
      "<": "<",
      ">=": ">=",
      "<=": "<=",
      "LIKE": "Contains",
      "NOT LIKE": "Not Contains",
      "IN": "In",
      "NOT IN": "Not In",
      "IS NULL": "Is Null",
      "IS NOT NULL": "Is Not Null",
    };

    return operatorMap[sqlOperator] || sqlOperator;
  }

  /**
   * Parse GROUP BY clause
   */
  private parseGroupBy(groupby: any): AxisItem[] {
    // @openobserve/node-sql-parser returns groupby as { columns: [...] }
    const groupByColumns = groupby?.columns || groupby;

    if (!groupByColumns || groupByColumns.length === 0) {
      return [];
    }

    const fields: AxisItem[] = [];

    for (const group of groupByColumns) {
      if (group.type === "column_ref") {
        // @openobserve/node-sql-parser uses column.expr.value instead of just column
        let columnName = "";
        if (typeof group.column === "string") {
          columnName = group.column;
        } else if (group.column?.expr?.value) {
          columnName = group.column.expr.value;
        }

        fields.push({
          label: this.generateLabel(columnName),
          alias: columnName,
          column: columnName,
          type: "raw",
          color: null,
          functionName: null,
          sortBy: null,
          args: [
            {
              type: "field",
              value: {
                field: columnName,
                streamAlias: group.table || undefined,
              },
            },
          ],
          isDerived: false,
          havingConditions: [],
          treatAsNonTimestamp: true,
          showFieldAsJson: false,
        });
      } else if (group.type === "function") {
        // Function in GROUP BY (like DATE_TRUNC)
        const axisItem = this.createAxisItemFromFunction({ expr: group, as: null });
        fields.push(axisItem);
      }
    }

    return fields;
  }

  /**
   * Merge GROUP BY fields into x-axis
   */
  private mergeGroupByIntoXAxis(xAxis: AxisItem[], groupByFields: AxisItem[]) {
    for (const field of groupByFields) {
      // Check if field already exists in xAxis
      const exists = xAxis.some((x) => x.alias === field.alias);
      if (!exists) {
        xAxis.push(field);
      }
    }
  }

  /**
   * Parse HAVING clause and add to y-axis items
   */
  private parseHavingClause(having: any, yAxis: AxisItem[]) {
    if (!having) {
      return;
    }

    // Parse HAVING conditions and map to y-axis items
    // This is a simplified implementation
    if (having.type === "binary_expr") {
      const condition = this.parseHavingCondition(having);

      // Try to match with y-axis field
      for (const yItem of yAxis) {
        if (yItem.havingConditions) {
          yItem.havingConditions.push(condition);
        }
      }
    }
  }

  /**
   * Parse individual HAVING condition
   */
  private parseHavingCondition(expr: any): HavingCondition {
    return {
      value: expr.right?.value || null,
      operator: expr.operator || null,
    };
  }

  /**
   * Parse ORDER BY clause
   */
  private parseOrderBy(orderby: any, xAxis: AxisItem[], yAxis: AxisItem[]) {
    if (!orderby || orderby.length === 0) {
      return;
    }

    for (const order of orderby) {
      // @openobserve/node-sql-parser uses column.expr.value instead of just column
      let column = "";
      if (order.expr.column) {
        if (typeof order.expr.column === "string") {
          column = order.expr.column;
        } else if (order.expr.column?.expr?.value) {
          column = order.expr.column.expr.value;
        }
      } else if (order.expr.name) {
        // For function names in ORDER BY
        if (typeof order.expr.name === "string") {
          column = order.expr.name;
        } else if (order.expr.name?.name && Array.isArray(order.expr.name.name)) {
          column = order.expr.name.name[0]?.value || "";
        }
      }

      const sortDirection = order.type.toUpperCase(); // ASC or DESC

      // Find matching field in x or y axis
      const allFields = [...xAxis, ...yAxis];
      const field = allFields.find((f) => f.alias === column || f.column === column);

      if (field) {
        field.sortBy = sortDirection;
      }
    }
  }

  /**
   * Parse JOIN clauses
   */
  private parseJoins(ast: any): JoinItem[] {
    const joins: JoinItem[] = [];

    if (!ast.from || ast.from.length <= 1) {
      return joins;
    }

    for (let i = 1; i < ast.from.length; i++) {
      const join = ast.from[i];

      if (!join.join) {
        continue;
      }

      const joinItem: JoinItem = {
        stream: join.table || "",
        streamAlias: join.as || join.table || "",
        joinType: join.join.toUpperCase(),
        conditions: this.parseJoinConditions(join.on),
      };

      joins.push(joinItem);
    }

    return joins;
  }

  /**
   * Parse JOIN conditions
   */
  private parseJoinConditions(onClause: any): JoinCondition[] {
    const conditions: JoinCondition[] = [];

    if (!onClause) {
      return conditions;
    }

    if (onClause.type === "binary_expr" && onClause.operator === "=") {
      // Extract column names - handle both string and object formats
      let leftColumn = "";
      if (typeof onClause.left.column === "string") {
        leftColumn = onClause.left.column;
      } else if (onClause.left.column?.expr?.value) {
        leftColumn = onClause.left.column.expr.value;
      }

      let rightColumn = "";
      if (typeof onClause.right.column === "string") {
        rightColumn = onClause.right.column;
      } else if (onClause.right.column?.expr?.value) {
        rightColumn = onClause.right.column.expr.value;
      }

      conditions.push({
        leftField: {
          field: leftColumn,
          streamAlias: onClause.left.table || undefined,
        },
        rightField: {
          field: rightColumn,
          streamAlias: onClause.right.table || undefined,
        },
        operation: "=",
      });
    }

    return conditions;
  }

  /**
   * Check if function is an aggregation function
   */
  private isAggregationFunction(funcName: string): boolean {
    const aggFunctions = [
      "count",
      "sum",
      "avg",
      "min",
      "max",
      "median",
      "stddev",
      "variance",
      "percentile",
      "array_agg",
      "string_agg",
      "count_distinct",
    ];

    return aggFunctions.includes(funcName.toLowerCase());
  }

  /**
   * Generate human-readable label from field name
   */
  private generateLabel(name: string): string {
    return name
      .replace(/[_\-\s\.]/g, " ")
      .split(" ")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .filter((it) => it)
      .join(" ");
  }

  /**
   * Get next color from color palette
   */
  private getNextColor(): string {
    const color = this.colors[this.colorIndex % this.colors.length];
    this.colorIndex++;
    return color;
  }

  /**
   * Reset color index (useful for parsing multiple queries)
   */
  public resetColorIndex() {
    this.colorIndex = 0;
  }
}

/**
 * Convenience function to parse SQL query
 */
export function parseSQLQueryToPanelObject(
  sqlQuery: string,
  streamType: "logs" | "metrics" | "traces" = "logs"
): PanelQuery {
  const parser = new SQLQueryParser();
  return parser.parseQueryToPanelObject(sqlQuery, streamType);
}

export default SQLQueryParser;

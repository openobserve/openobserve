import pkg from "@openobserve/node-sql-parser/build/datafusionsql.js";
const { Parser } = pkg;

const TIMESTAMP_COL_NAME = "_timestamp";

// Type definitions for node-sql-parser AST
interface ColumnRef {
  type: "column_ref";
  table?: string;
  column: string | { expr: { type: string; value: string } };
}

interface StarExpr {
  type: "star";
  value: string;
}

interface FunctionExpr {
  type: "function";
  name: string;
  args?: {
    value: ASTNode[];
  };
}

interface SelectItem {
  type: string;
  expr: ColumnRef | StarExpr | FunctionExpr | ASTNode;
  as?: string;
}

interface TableRef {
  table?: string;
  as?: string;
  expr?: SelectAST;
}

interface CTEDefinition {
  name: string | { value: string };
  stmt: SelectAST;
}

interface SelectAST {
  type: "select";
  columns: SelectItem[];
  from?: TableRef[];
  with?: CTEDefinition[];
  groupby?: {
    type: string;
    column: string | { expr: { type: string; value: string } };
  }[];
}

type ASTNode = ColumnRef | StarExpr | FunctionExpr | SelectAST | any;

interface QueryInfo {
  projections: SelectItem[];
  isMainQuery: boolean;
}

export class TimestampAnalysisResult {
  public hasTimestamp: boolean;
  public columnNames: string[];

  constructor(hasTimestamp: boolean, columnNames: string[]) {
    this.hasTimestamp = hasTimestamp;
    this.columnNames = columnNames;
  }
}

export class TimestampVisitor {
  public timestampSelected: boolean = false;
  public timestampAliases: Set<string> = new Set();
  public timestampColumns: string[] = [];
  public queryDepth: number = 0;
  public cteTimestampColumns: Map<string, Set<string>> = new Map();
  public currentScopeTimestampColumns: Set<string> = new Set();
  private queryQueue: QueryInfo[] = [];

  constructor() {
    this.reset();
  }

  private reset(): void {
    this.timestampSelected = false;
    this.timestampAliases.clear();
    this.timestampColumns = [];
    this.queryDepth = 0;
    this.cteTimestampColumns.clear();
    this.currentScopeTimestampColumns.clear();
    this.queryQueue = [];
  }

  public addTimestampColumn(column: string): void {
    if (!this.timestampColumns.includes(column)) {
      this.timestampColumns.push(column);
    }
  }

  public static isTimestampExpr(expr: ASTNode): boolean {
    if (!expr) return false;

    switch (expr.type) {
      case "column_ref": {
        const columnRef = expr as ColumnRef;
        // Direct string
        if (typeof columnRef.column === "string") {
          return columnRef.column === TIMESTAMP_COL_NAME;
        }
        // Nested expr.value
        if (
          typeof columnRef.column === "object" &&
          columnRef.column.expr &&
          typeof columnRef.column.expr.value === "string"
        ) {
          return columnRef.column.expr.value === TIMESTAMP_COL_NAME;
        }
        return false;
      }
      case "function": {
        const funcExpr = expr as any;
        if (
          funcExpr.name &&
          typeof funcExpr.name === "string" &&
          funcExpr.name.toLowerCase() === "histogram"
        ) {
          if (funcExpr.args && funcExpr.args.value) {
            return funcExpr.args.value.some((arg) => this.isTimestampExpr(arg));
          }
        } else if (
          funcExpr?.name &&
          funcExpr?.name?.name?.[0]?.value &&
          funcExpr?.name?.name?.[0]?.value.toLowerCase() === "histogram"
        ) {
          return true;
        }
      }
      default:
        return false;
    }
  }

  private isTimestampColumnReference(column: string, table?: string): boolean {
    return column === TIMESTAMP_COL_NAME || this.timestampAliases.has(column);
  }

  public processQueryQueue(): void {
    while (this.queryQueue.length > 0) {
      const queryInfo = this.queryQueue.shift();
      if (queryInfo) {
        this.processQueryProjections(
          queryInfo.projections,
          queryInfo.isMainQuery,
        );
      }
    }
  }

  private processQueryProjections(
    projections: SelectItem[],
    isMainQuery: boolean,
  ): void {
    if (!projections) return;

    for (const item of projections) {
      switch (item.expr.type) {
        case "column_ref":
          this.handleColumnRef(item, isMainQuery);
          break;

        case "star":
          this.handleStarExpression(item, isMainQuery);
          break;

        case "function":
          this.handleFunctionExpression(item, isMainQuery);
          break;

        default:
          this.handleOtherExpression(item, isMainQuery);
          break;
      }
    }
  }

  private handleColumnRef(item: SelectItem, isMainQuery: boolean): void {
    const columnRef = item.expr as ColumnRef;
    const columnName = columnRef.column;
    let isTimestamp = false;
    let actualColumnName: string = TIMESTAMP_COL_NAME;

    if (typeof columnName === "string") {
      isTimestamp =
        TimestampVisitor.isTimestampExpr(item.expr) ||
        this.timestampAliases.has(columnName) ||
        this.isTimestampColumnReference(columnName);
      actualColumnName = columnName;
    } else if (
      typeof columnName === "object" &&
      columnName.expr &&
      typeof columnName.expr.value === "string"
    ) {
      // Handle nested expr.value
      const nestedColumn = columnName.expr.value;
      isTimestamp =
        nestedColumn === TIMESTAMP_COL_NAME ||
        this.timestampAliases.has(nestedColumn);
      actualColumnName = nestedColumn;
    }

    if (isTimestamp) {
      this.currentScopeTimestampColumns.add(actualColumnName);
      if (isMainQuery) {
        this.timestampSelected = true;
        this.addTimestampColumn(actualColumnName);
      }
    }

    // Handle aliases
    if (item.as) {
      if (item.as === TIMESTAMP_COL_NAME || isTimestamp) {
        this.currentScopeTimestampColumns.add(item.as);
        this.timestampAliases.add(item.as);
        if (isMainQuery) {
          this.timestampSelected = true;
          this.addTimestampColumn(item.as);
        }
      }

      // Handle alias chains
      if (
        !isTimestamp &&
        typeof actualColumnName === "string" &&
        this.timestampAliases.has(actualColumnName)
      ) {
        this.currentScopeTimestampColumns.add(item.as);
        this.timestampAliases.add(item.as);
        if (isMainQuery) {
          this.timestampSelected = true;
          this.addTimestampColumn(item.as);
        }
      }
    }
  }

  private handleStarExpression(item: SelectItem, isMainQuery: boolean): void {
    // Wildcard selection
    if (this.currentScopeTimestampColumns.size > 0) {
      Array.from(this.currentScopeTimestampColumns).forEach((col) => {
        if (isMainQuery) {
          this.timestampSelected = true;
          this.addTimestampColumn(col);
        }
      });
    } else {
      this.currentScopeTimestampColumns.add(TIMESTAMP_COL_NAME);
      if (isMainQuery) {
        this.timestampSelected = true;
        this.addTimestampColumn(TIMESTAMP_COL_NAME);
      }
    }
  }

  private handleFunctionExpression(
    item: SelectItem,
    isMainQuery: boolean,
  ): void {
    // Handle function expressions
    const isTimestampFunc = TimestampVisitor.isTimestampExpr(item.expr);
    if (item.as) {
      if (item.as === TIMESTAMP_COL_NAME || isTimestampFunc) {
        this.currentScopeTimestampColumns.add(item.as);
        this.timestampAliases.add(item.as);
        if (isMainQuery) {
          this.timestampSelected = true;
          this.addTimestampColumn(item.as);
        }
      }
    }
  }

  private handleOtherExpression(item: SelectItem, isMainQuery: boolean): void {
    // Handle other expression types with aliases
    if (item.as) {
      if (item.as === TIMESTAMP_COL_NAME) {
        this.currentScopeTimestampColumns.add(item.as);
        this.timestampAliases.add(item.as);
        if (isMainQuery) {
          this.timestampSelected = true;
          this.addTimestampColumn(item.as);
        }
      }
    }
  }

  public visitQuery(ast: SelectAST): void {
    const isOutermost = this.queryDepth === 0;
    this.queryDepth++;

    const savedScopeColumns = new Set(this.currentScopeTimestampColumns);
    this.currentScopeTimestampColumns.clear();

    // Handle WITH clause (CTEs) first
    if (ast.with) {
      for (const cte of ast.with) {
        const savedCteScope = new Set(this.currentScopeTimestampColumns);
        this.currentScopeTimestampColumns.clear();

        // Process CTE query recursively
        if (cte.stmt) {
          this.visitQuery(cte.stmt);
        }

        // Store timestamp columns for this CTE
        const cteName =
          typeof cte.name === "string" ? cte.name : cte.name.value;
        this.cteTimestampColumns.set(
          cteName,
          new Set(this.currentScopeTimestampColumns),
        );
        this.currentScopeTimestampColumns = savedCteScope;
      }
    }

    // Determine if this is the main query
    const isMainQuery = !!ast.with || (isOutermost && !ast.with);

    // Process FROM clause
    if (ast.from) {
      this.visitFrom(ast.from);
    }

    // Build aliases during visitor phase
    if (ast.columns) {
      for (const item of ast.columns) {
        if (item.as && item.expr.type === "column_ref") {
          const columnRef = item.expr as ColumnRef;
          const columnName = columnRef.column;
          let isTimestamp = false;

          if (item.as === TIMESTAMP_COL_NAME) {
            isTimestamp = true;
          } else if (typeof columnName === "string") {
            isTimestamp =
              TimestampVisitor.isTimestampExpr(item.expr) ||
              this.timestampAliases.has(columnName) ||
              this.isTimestampColumnReference(columnName);
          } else if (typeof columnName === "object" && columnName.expr) {
            const actualColumn = columnName.expr.value;
            isTimestamp =
              actualColumn === TIMESTAMP_COL_NAME ||
              this.timestampAliases.has(actualColumn);
          }

          if (isTimestamp) {
            this.timestampAliases.add(item.as);
            this.currentScopeTimestampColumns.add(item.as);
          }

          // Handle alias chains
          if (
            !isTimestamp &&
            typeof columnName === "string" &&
            this.timestampAliases.has(columnName)
          ) {
            this.timestampAliases.add(item.as);
            this.currentScopeTimestampColumns.add(item.as);
          }
        }
      }

      // Add to queue for processing
      const queryInfo: QueryInfo = {
        projections: ast.columns,
        isMainQuery: isMainQuery,
      };

      if (isMainQuery) {
        this.queryQueue.push(queryInfo);
      } else {
        this.queryQueue.unshift(queryInfo);
      }
    }

    // Restore scope
    if (!isOutermost) {
      this.currentScopeTimestampColumns = savedScopeColumns;
    }

    this.queryDepth--;
  }

  private visitFrom(fromClause: TableRef[]): void {
    if (!fromClause) return;

    for (const table of fromClause) {
      if (table.table) {
        // Regular table
        const tableName = table.table;
        if (this.cteTimestampColumns.has(tableName)) {
          const cteColumns = this.cteTimestampColumns.get(tableName);
          if (cteColumns) {
            Array.from(cteColumns).forEach((col) => {
              this.currentScopeTimestampColumns.add(col);
            });
          }
        }
      } else if (table.expr && table.expr.type === "select") {
        // Subquery
        const savedScope = new Set(this.currentScopeTimestampColumns);
        this.currentScopeTimestampColumns.clear();

        this.visitQuery(table.expr);

        const subqueryColumns = new Set(this.currentScopeTimestampColumns);
        this.currentScopeTimestampColumns = savedScope;

        Array.from(subqueryColumns).forEach((col) => {
          this.currentScopeTimestampColumns.add(col);
        });
      }
    }
  }
}

export function analyzeTimestampSelection(
  sql: string,
): TimestampAnalysisResult {
  try {
    const parser = new Parser();
    const ast = parser.astify(sql);

    if (!ast || (Array.isArray(ast) && ast.length !== 1)) {
      throw new Error("Expected exactly one statement");
    }

    const query = Array.isArray(ast) ? ast[0] : ast;

    if (query.type !== "select") {
      throw new Error("Expected a select statement");
    }

    const visitor = new TimestampVisitor();
    visitor.visitQuery(query as unknown as SelectAST);
    visitor.processQueryQueue();

    return new TimestampAnalysisResult(
      visitor.timestampSelected,
      visitor.timestampColumns,
    );
  } catch (error: any) {
    throw new Error(`Parse error: ${error.message}`);
  }
}

export function getTimestampColumnName(sql: string): string | null {
  try {
    const result = analyzeTimestampSelection(sql);
    return result.columnNames.length > 0 ? result.columnNames[0] : null;
  } catch (error) {
    return null;
  }
}

/**
 * Extracts the timestamp column/alias, group by columns (excluding timestamp/alias), and y-axis fields from a SQL query.
 * @param sql The SQL query string
 * @returns { timestamp: string|null, groupBy: string[], yAxisFields: string[] }
 */
export function extractTimestampAndGroupBy(sql: string): {
  timestamp: string | null;
  groupBy: string[];
  yAxisFields: string[];
} {
  const parser = new Parser();
  let ast: any;
  try {
    ast = parser.astify(sql);
  } catch (e) {
    return { timestamp: null, groupBy: [], yAxisFields: [] };
  }
  const query = Array.isArray(ast) ? ast[0] : ast;

  // Determine default table name if query selects from a single plain table
  let defaultTable: string | null = null;
  if (query && query.from && Array.isArray(query.from)) {
    const plainTables = query.from.filter((f: any) => f.table && !f.as);
    if (plainTables.length === 1) {
      defaultTable = plainTables[0].table;
    }
  }
  if (!query || query.type !== "select") {
    return { timestamp: null, groupBy: [], yAxisFields: [] };
  }

  // Find timestamp column/alias
  const visitor = new TimestampVisitor();
  visitor.visitQuery(query as unknown as SelectAST);
  visitor.processQueryQueue();
  let timestampColumns = visitor.timestampColumns;
  let timestampAliases = visitor.timestampAliases;
  let timestamp = timestampColumns.length > 0 ? timestampColumns[0] : null;

  // Find group by columns (excluding timestamp/alias)
  const groupBy: string[] = [];
  const groupByColumns =
    query.groupby && query.groupby.columns ? query.groupby.columns : [];

  // Build a map of select aliases to their expressions
  const selectAliasToExpr: Record<string, any> = {};
  if (Array.isArray(query.columns)) {
    for (const col of query.columns) {
      if (col.as) {
        selectAliasToExpr[col.as] = col.expr;
      }
    }
  }

  // Helper to extract column name from group by AST node
  function extractColName(groupItem: any): string | null {
    if (groupItem.type === "column_ref") {
      if (typeof groupItem.column === "string") {
        return groupItem.column;
      } else if (
        typeof groupItem.column === "object" &&
        groupItem.column.expr &&
        typeof groupItem.column.expr.value === "string"
      ) {
        return groupItem.column.expr.value;
      }
    } else if (
      groupItem.type === "expr" &&
      groupItem.column &&
      typeof groupItem.column === "string"
    ) {
      return groupItem.column;
    } else if (
      groupItem.type === "expr" &&
      groupItem.expr &&
      groupItem.expr.type === "column_ref"
    ) {
      if (typeof groupItem.expr.column === "string") {
        return groupItem.expr.column;
      } else if (
        typeof groupItem.expr.column === "object" &&
        groupItem.expr.column.expr &&
        typeof groupItem.expr.column.expr.value === "string"
      ) {
        return groupItem.expr.column.expr.value;
      }
    }
    return null;
  }

  // Try to find timestamp alias in group by if not found in select
  if (!timestamp && groupByColumns.length > 0) {
    for (const groupItem of groupByColumns) {
      const col = extractColName(groupItem);
      // If group by column is an alias for a select expression involving _timestamp
      if (
        col &&
        selectAliasToExpr[col] &&
        TimestampVisitor.isTimestampExpr(selectAliasToExpr[col])
      ) {
        timestamp = col;
        break;
      }
      // If group by column is _timestamp itself
      if (col === TIMESTAMP_COL_NAME) {
        timestamp = TIMESTAMP_COL_NAME;
        break;
      }
    }
  }

  // For wildcard selects, if _timestamp is in group by, treat as timestamp
  if (
    !timestamp &&
    Array.isArray(query.columns) &&
    query.columns.some((c: any) => c.expr && c.expr.column === "*")
  ) {
    for (const groupItem of groupByColumns) {
      const col = extractColName(groupItem);
      if (col === TIMESTAMP_COL_NAME) {
        timestamp = TIMESTAMP_COL_NAME;
        break;
      }
    }
  }

  for (const groupItem of groupByColumns) {
    const col = extractColName(groupItem);
    if (
      col &&
      col !== TIMESTAMP_COL_NAME &&
      !timestampAliases.has(col) &&
      col !== timestamp
    ) {
      groupBy.push(col);
    }
  }

  // Extract all SELECT fields for yAxisFields
  const yAxisFields: string[] = [];

  if (Array.isArray(query.columns)) {
    for (const col of query.columns) {
      if (col.expr && col.expr.type === "star") {
        // For wildcard selects, we can't determine specific fields
        // Skip adding to yAxisFields for now
        continue;
      }

      // Get the field name (alias if present, otherwise column name)
      let fieldName: string | null = null;
      if (col.as) {
        fieldName = col.as;
      } else if (col.expr) {
        // use generic helper

        const stringifyExpression = (expr: any): string => stringifyAstExpr(expr, defaultTable);

        // Handle column references
        if (col.expr.type === "column_ref") {
          if (typeof col.expr.column === "string") {
            fieldName = col.expr.column;
          } else if (
            typeof col.expr.column === "object" &&
            col.expr.column.expr &&
            typeof col.expr.column.expr.value === "string"
          ) {
            fieldName = col.expr.column.expr.value;
          }
        }

        // Handle regular and aggregate functions without aliases
        if (
          (col.expr.type === "function" || col.expr.type === "aggr_func") &&
          !fieldName
        ) {
          const funcExpr: any = col.expr;

          // Generate projection for functions (supports nesting)
          if (
            (funcExpr.type === "function" || funcExpr.type === "aggr_func") &&
            !fieldName
          ) {
            fieldName = stringifyExpression(funcExpr);
          }
        }

        // Fallback: if still no field name derived, stringify the full expression
        if (!fieldName) {
          fieldName = stringifyExpression(col.expr);
        }
      }

      if (fieldName) {
        // Check if this field should be in yAxisFields
        const isTimestampField =
          fieldName === timestamp ||
          fieldName === TIMESTAMP_COL_NAME ||
          timestampAliases.has(fieldName);
        const isGroupByField = groupBy.includes(fieldName);

        if (!isTimestampField && !isGroupByField) {
          yAxisFields.push(fieldName);
        }
      }
    }
  }

  return { timestamp, groupBy, yAxisFields };
}

// Utility to convert an AST expression into a deterministic DataFusion-style string
function stringifyAstExpr(expr: any, defaultTable?: string): string {
  const getFunctionName = (fn: any): string => {
    if (!fn) return "func";
    if (typeof fn.name === "string") return fn.name.toLowerCase();
    if (fn.name && Array.isArray(fn.name.name)) {
      return fn.name.name
        .map((n: any) => (typeof n === "string" ? n : n.value || ""))
        .join(".")
        .toLowerCase();
    }
    if (fn.name && typeof fn.name.value === "string") {
      return fn.name.value.toLowerCase();
    }
    return "func";
  };

  const stringifyFuncArgs = (args: any): string => {
    if (!args) return "";
    const distinctPrefix = args.distinct ? "DISTINCT " : "";
    if (args.expr) {
      return `${distinctPrefix}${stringifyAstExpr(args.expr, defaultTable)}`;
    }
    if (Array.isArray(args.value)) {
      return `${distinctPrefix}${args.value
        .map((arg: any) => stringifyAstExpr(arg, defaultTable))
        .join(",")}`;
    }
    return "";
  };

  const getFullColumnName = (columnRef: any): string => {
    if (typeof columnRef.column === "string") {
      if (columnRef.table) return `${columnRef.table}.${columnRef.column}`;
      if (defaultTable) return `${defaultTable}.${columnRef.column}`;
      return columnRef.column;
    } else if (
      typeof columnRef.column === "object" &&
      columnRef.column.expr &&
      typeof columnRef.column.expr.value === "string"
    ) {
      const prefix = columnRef.column.expr.type;
      const value = columnRef.column.expr.value;
      if (prefix) return `${prefix}.${value}`;
      if (defaultTable) return `${defaultTable}.${value}`;
      return value;
    }
    return "column";
  };

  if (!expr) return "expr";

  switch (expr.type) {
    case "column_ref":
      return getFullColumnName(expr);
    case "star":
      return "*";
    case "function":
    case "aggr_func": {
      const fname = getFunctionName(expr);
      if (fname === "array_element") {
        if (
          expr.args &&
          expr.args.value &&
          Array.isArray(expr.args.value) &&
          expr.args.value.length >= 2
        ) {
          const collectionExpr = stringifyAstExpr(expr.args.value[0], defaultTable);
          const indexExpr = stringifyAstExpr(expr.args.value[1], defaultTable);
          return `${collectionExpr}[${indexExpr}]`;
        }
      }

      const argStr = stringifyFuncArgs(expr.args);
      return `${fname}(${argStr})`;
    }
    case "cast": {
      if (expr.expr) return stringifyAstExpr(expr.expr, defaultTable);
      return "cast_expr";
    }
    case "binary_expr": {
      const left = stringifyAstExpr(expr.left, defaultTable);
      const right = stringifyAstExpr(expr.right, defaultTable);
      const op = expr.operator ? expr.operator.trim() : "+";
      return `${left}${op}${right}`;
    }
    case "unary_expr": {
      const operand = stringifyAstExpr(expr.expr, defaultTable);
      const op = expr.operator ? expr.operator.trim() : "";
      return `${op}${operand}`;
    }
    case "number":
      return `Int64(${expr.value})`;
    case "string": {
      let raw = typeof expr.value === "string" ? expr.value : String(expr.value);
      if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"')))
        raw = raw.substring(1, raw.length - 1);
      const escaped = raw.replace(/"/g, '\\"');
      return `Utf8("${escaped}")`;
    }
    case "bool":
      return typeof expr.value === "boolean" ? String(expr.value) : "bool";
    case "null":
      return "Null";
    case "interval":
      return "interval_expr";
    default:
      return "expr";
  }
}

// -----------------------------------------

// /**
//  * Extracts clean column name from column reference, removing table prefixes
//  * @param columnRef Column reference object
//  * @returns Clean column name
//  */
// function extractCleanColumnName(columnRef: any): string {
//   if (typeof columnRef.column === "string") {
//     // Remove table prefix if present (e.g., "default._timestamp" -> "_timestamp")
//     const parts = columnRef.column.split('.');
//     return parts[parts.length - 1];
//   } else if (
//     typeof columnRef.column === "object" &&
//     columnRef.column.expr &&
//     typeof columnRef.column.expr.value === "string"
//   ) {
//     const parts = columnRef.column.expr.value.split('.');
//     return parts[parts.length - 1];
//   }
//   return "column";
// }

// /**
//  * Checks if two function expressions are equivalent
//  * @param func1 First function expression
//  * @param func2 Second function expression
//  * @returns True if functions are equivalent
//  */
// function areFunctionExpressionsEqual(func1: any, func2: any): boolean {
//   if (!func1 || !func2 || func1.type !== "function" || func2.type !== "function") {
//     return false;
//   }

//   // Compare function names
//   let name1 = "";
//   let name2 = "";

//   if (typeof func1.name === "string") {
//     name1 = func1.name.toLowerCase();
//   } else if (func1.name && func1.name.name && Array.isArray(func1.name.name)) {
//     name1 = func1.name.name.map((n: any) => n.value || n).join("_").toLowerCase();
//   }

//   if (typeof func2.name === "string") {
//     name2 = func2.name.toLowerCase();
//   } else if (func2.name && func2.name.name && Array.isArray(func2.name.name)) {
//     name2 = func2.name.name.map((n: any) => n.value || n).join("_").toLowerCase();
//   }

//   if (name1 !== name2) {
//     return false;
//   }

//   // Compare arguments
//   const args1 = func1.args && func1.args.value ? func1.args.value : [];
//   const args2 = func2.args && func2.args.value ? func2.args.value : [];

//   if (args1.length !== args2.length) {
//     return false;
//   }

//   for (let i = 0; i < args1.length; i++) {
//     const arg1 = args1[i];
//     const arg2 = args2[i];

//     if (arg1.type !== arg2.type) {
//       return false;
//     }

//     if (arg1.type === "column_ref") {
//       const col1 = extractCleanColumnName(arg1);
//       const col2 = extractCleanColumnName(arg2);
//       if (col1 !== col2) {
//         return false;
//       }
//     } else if (arg1.type === "string" || arg1.type === "number") {
//       if (arg1.value !== arg2.value) {
//         return false;
//       }
//     }
//   }

//   return true;
// }

// /**
//  * Generates a projection name for an AST expression node
//  * @param expr The AST expression node
//  * @returns Generated projection name
//  */
// export function generateProjectionName(expr: ASTNode): string {
//   if (!expr) return "unknown";

//   switch (expr.type) {
//     case "column_ref": {
//       const columnRef = expr as ColumnRef;
//       return extractCleanColumnName(columnRef);
//     }

//     case "function": {
//       const funcExpr = expr as any;
//       let functionName = "";

//       // Handle different function name structures
//       if (typeof funcExpr.name === "string") {
//         functionName = funcExpr.name.toLowerCase();
//       } else if (funcExpr.name && funcExpr.name.name && Array.isArray(funcExpr.name.name)) {
//         functionName = funcExpr.name.name.map((n: any) => n.value || n).join("_").toLowerCase();
//       } else if (funcExpr.name && typeof funcExpr.name === "object") {
//         functionName = funcExpr.name.value || "function";
//       }

//       // Generate arguments part - only use meaningful column names
//       let argsStr = "";
//       if (funcExpr.args && funcExpr.args.value && Array.isArray(funcExpr.args.value)) {
//         const argNames = funcExpr.args.value
//           .map((arg: any) => {
//             if (arg.type === "column_ref") {
//               return extractCleanColumnName(arg);
//             } else if (arg.type === "star") {
//               return "*";
//             } else if (arg.type === "number") {
//               return arg.value;
//             } else if (arg.type === "string") {
//               // For string literals, only include simple values, skip complex ones
//               if (arg.value && typeof arg.value === "string") {
//                 // Skip complex function arguments like 'Utf8("10 seconds")'
//                 if (arg.value.includes("(") || arg.value.includes('"')) {
//                   return null; // Skip this argument
//                 }
//                 return arg.value;
//               }
//               return null;
//             }
//             return null;
//           })
//           .filter(Boolean); // Remove null values

//         argsStr = argNames.join("_");
//       }

//       // Create meaningful function names
//       if (functionName === "count" && argsStr === "*") {
//         return "count";
//       } else if (functionName === "count" && argsStr) {
//         return `count_${argsStr}`;
//       } else if (functionName === "sum" && argsStr) {
//         return `sum_${argsStr}`;
//       } else if (functionName === "avg" && argsStr) {
//         return `avg_${argsStr}`;
//       } else if (functionName === "min" && argsStr) {
//         return `min_${argsStr}`;
//       } else if (functionName === "max" && argsStr) {
//         return `max_${argsStr}`;
//       } else if (functionName === "histogram" && argsStr) {
//         return `histogram_${argsStr}`;
//       } else if (functionName && argsStr) {
//         return `${functionName}_${argsStr}`;
//       } else if (functionName) {
//         return functionName;
//       }
//       return "function";
//     }

//     case "binary_expr": {
//       const binaryExpr = expr as any;
//       const leftName = generateProjectionName(binaryExpr.left);
//       const rightName = generateProjectionName(binaryExpr.right);
//       const operator = binaryExpr.operator ? binaryExpr.operator.toLowerCase() : "op";
//       return `${leftName}_${operator}_${rightName}`;
//     }

//     case "unary_expr": {
//       const unaryExpr = expr as any;
//       const exprName = generateProjectionName(unaryExpr.expr);
//       const operator = unaryExpr.operator ? unaryExpr.operator.toLowerCase() : "op";
//       return `${operator}_${exprName}`;
//     }

//     case "case": {
//       return "case_expr";
//     }

//     case "cast": {
//       const castExpr = expr as any;
//       const exprName = generateProjectionName(castExpr.expr);
//       const targetType = castExpr.target && castExpr.target.dataType ? castExpr.target.dataType.toLowerCase() : "unknown";
//       return `cast_${exprName}_${targetType}`;
//     }

//     case "interval": {
//       return "interval_expr";
//     }

//     case "extract": {
//       const extractExpr = expr as any;
//       const field = extractExpr.field ? extractExpr.field.toLowerCase() : "field";
//       const fromExpr = extractExpr.from ? generateProjectionName(extractExpr.from) : "expr";
//       return `extract_${field}_${fromExpr}`;
//     }

//     case "number":
//     case "string":
//     case "null":
//     case "bool": {
//       const literalExpr = expr as any;
//       return `literal_${literalExpr.value || expr.type}`;
//     }

//     default:
//       return expr.type || "unknown";
//   }
// }

// /**
//  * Extracts field projections with generated names for fields without aliases
//  * @param sql The SQL query string
//  * @returns Array of field projections with names
//  */
// export function extractFieldProjections(sql: string): Array<{
//   name: string;
//   expression: string;
//   hasAlias: boolean;
// }> {
//   const parser = new Parser();
//   let ast: any;
//   try {
//     ast = parser.astify(sql);
//   } catch (e) {
//     return [];
//   }

//   const query = Array.isArray(ast) ? ast[0] : ast;
//   if (!query || query.type !== "select") {
//     return [];
//   }

//   const projections: Array<{
//     name: string;
//     expression: string;
//     hasAlias: boolean;
//   }> = [];

//   if (Array.isArray(query.columns)) {
//     for (const col of query.columns) {
//       if (col.expr && col.expr.type === "star") {
//         // Handle wildcard selection
//         projections.push({
//           name: "*",
//           expression: "*",
//           hasAlias: false
//         });
//         continue;
//       }

//       let fieldName: string;
//       let hasAlias = false;
//       let expression = "";

//       if (col.as) {
//         // Field has an alias
//         fieldName = col.as;
//         hasAlias = true;
//       } else {
//         // Determine default table (same logic as earlier)
//         let defaultTbl: string | null = null;
//         if (query.from && Array.isArray(query.from)) {
//           const pts = query.from.filter((f: any) => f.table && !f.as);
//           if (pts.length === 1) defaultTbl = pts[0].table;
//         }

//         // Generate projection name using generic helper
//         fieldName = stringifyAstExpr(col.expr, defaultTbl || undefined);
//       }

//              // Try to reconstruct expression string for display
//        try {
//          if (col.expr.type === "column_ref") {
//            const columnRef = col.expr as ColumnRef;
//            expression = extractCleanColumnName(columnRef);
//          } else if (col.expr.type === "function") {
//           const funcExpr = col.expr as any;
//           let funcName = "";
//           if (typeof funcExpr.name === "string") {
//             funcName = funcExpr.name;
//           } else if (funcExpr.name && funcExpr.name.name && Array.isArray(funcExpr.name.name)) {
//             funcName = funcExpr.name.name.map((n: any) => n.value || n).join(".");
//           }

//                      if (funcExpr.args && funcExpr.args.value && Array.isArray(funcExpr.args.value)) {
//              const argStrs = funcExpr.args.value.map((arg: any) => {
//                if (arg.type === "column_ref") {
//                  return extractCleanColumnName(arg);
//                } else if (arg.type === "star") {
//                  return "*";
//                } else if (arg.type === "number" || arg.type === "string") {
//                  return arg.value;
//                }
//                return "arg";
//              });
//              expression = `${funcName}(${argStrs.join(", ")})`;
//            } else {
//              expression = `${funcName}()`;
//            }
//         } else {
//           expression = fieldName;
//         }
//       } catch (e) {
//         expression = fieldName;
//       }

//       projections.push({
//         name: fieldName,
//         expression: expression,
//         hasAlias: hasAlias
//       });
//     }
//   }

//   return projections;
// }

// extractTimestampAndGroupBy - returns timestamp field, group by fields, and y-axis fields

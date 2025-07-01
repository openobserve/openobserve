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
      } else if (col.expr && col.expr.type === "column_ref") {
        if (typeof col.expr.column === "string") {
          fieldName = col.expr.column;
        } else if (
          typeof col.expr.column === "object" &&
          col.expr.column.expr &&
          typeof col.expr.column.expr.value === "string"
        ) {
          fieldName = col.expr.column.expr.value;
        }
      } else if (col.expr && col.expr.type === "function") {
        // For functions, use alias if available, otherwise skip
        if (col.as) {
          fieldName = col.as;
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

// extractTimestampAndGroupBy - returns timestamp field, group by fields, and y-axis fields

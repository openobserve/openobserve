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

/**
 * Represents a label filter in a PromQL query
 * Example: {label="value"}
 */
export interface QueryBuilderLabelFilter {
  label: string;
  op: "=" | "!=" | "=~" | "!~"; // Operators: equals, not equals, regex match, regex not match
  value: string;
}

/**
 * Represents an operation in the query builder
 * Example: rate(), sum(), avg()
 */
export interface QueryBuilderOperation {
  id: string; // Operation identifier (e.g., "rate", "sum")
  params: QueryBuilderOperationParamValue[]; // Parameters for the operation
}

/**
 * Main visual query structure for PromQL
 */
export interface PromVisualQuery {
  metric: string; // Metric name
  labels: QueryBuilderLabelFilter[]; // Label filters
  operations: QueryBuilderOperation[]; // Applied operations
  binaryQueries?: PromVisualQueryBinary[]; // Binary operations with other queries
}

/**
 * Binary operation between queries
 * Example: query1 + query2
 */
export interface PromVisualQueryBinary {
  operator: string; // +, -, *, /, %, ^, ==, !=, >, <, >=, <=
  vectorMatchesType?: "on" | "ignoring"; // Vector matching type
  vectorMatches?: string; // Vector matching labels
  query: PromVisualQuery; // The other query
}

/**
 * Operation parameter value types
 */
export type QueryBuilderOperationParamValue = string | number | boolean | string[];

/**
 * Parameter definition for an operation
 */
export interface QueryBuilderOperationParamDef {
  name: string; // Parameter name
  type: "string" | "number" | "boolean" | "select"; // Parameter type
  options?: boolean; // Predefined options
  optional?: boolean; // Whether parameter is optional
  placeholder?: string; // Placeholder text
  description?: string; // Parameter description
}

/**
 * Operation definition/metadata
 */
export interface QueryBuilderOperationDef {
  id: string; // Unique operation ID
  name: string; // Display name
  params: QueryBuilderOperationParamDef[]; // Parameter definitions
  defaultParams: QueryBuilderOperationParamValue[]; // Default parameter values
  category: string; // Category for grouping
  documentation?: string; // Documentation text
  hideFromList?: boolean; // Hide from operation list
  alternativesKey?: string; // Key for alternative operations
  orderRank?: number; // Order in list
}

/**
 * Operation categories
 */
export enum PromVisualQueryOperationCategory {
  Aggregations = "Aggregations",
  RangeFunctions = "Range Functions",
  Functions = "Functions",
  BinaryOps = "Binary Operations",
  Trigonometric = "Trigonometric",
  Time = "Time Functions",
}

/**
 * Common PromQL operation IDs
 */
export enum PromOperationId {
  // Range functions
  Rate = "rate",
  Irate = "irate",
  Increase = "increase",
  Delta = "delta",
  Idelta = "idelta",
  AvgOverTime = "avg_over_time",
  MinOverTime = "min_over_time",
  MaxOverTime = "max_over_time",
  SumOverTime = "sum_over_time",
  CountOverTime = "count_over_time",
  StddevOverTime = "stddev_over_time",
  QuantileOverTime = "quantile_over_time",
  LastOverTime = "last_over_time",

  // Aggregations
  Sum = "sum",
  Avg = "avg",
  Max = "max",
  Min = "min",
  Count = "count",
  Stddev = "stddev",
  Stdvar = "stdvar",
  TopK = "topk",
  BottomK = "bottomk",
  Quantile = "quantile",
  CountValues = "count_values",
  Group = "group",

  // Functions
  HistogramQuantile = "histogram_quantile",
  Abs = "abs",
  Ceil = "ceil",
  Floor = "floor",
  Round = "round",
  Sqrt = "sqrt",
  Exp = "exp",
  Ln = "ln",
  Log2 = "log2",
  Log10 = "log10",
  Sort = "sort",
  SortDesc = "sort_desc",
  Clamp = "clamp",
  ClampMax = "clamp_max",
  ClampMin = "clamp_min",

  // Time functions
  Time = "time",
  Timestamp = "timestamp",
  Hour = "hour",
  Minute = "minute",
  Month = "month",
  Year = "year",
  DayOfMonth = "day_of_month",
  DayOfWeek = "day_of_week",
  DaysInMonth = "days_in_month",

  // Trigonometric functions
  Sin = "sin",
  Cos = "cos",
  Tan = "tan",
  Asin = "asin",
  Acos = "acos",
  Atan = "atan",
  Sinh = "sinh",
  Cosh = "cosh",
  Tanh = "tanh",
  Asinh = "asinh",
  Acosh = "acosh",
  Atanh = "atanh",
  Deg = "deg",
  Rad = "rad",
  Pi = "pi",

  // Binary operations
  Addition = "__addition",
  Subtraction = "__subtraction",
  MultiplyBy = "__multiply_by",
  DivideBy = "__divide_by",
  Modulo = "__modulo",
  Exponent = "__exponent",
}

/**
 * Query modeller interface for rendering and operations
 */
export interface PromQueryModeller {
  renderQuery(query: PromVisualQuery): string;
  renderLabels(labels: QueryBuilderLabelFilter[]): string;
  getOperationDef(id: string): QueryBuilderOperationDef | undefined;
  getOperationsForCategory(category: string): QueryBuilderOperationDef[];
  getCategories(): string[];
  getAllOperations(): QueryBuilderOperationDef[];
}

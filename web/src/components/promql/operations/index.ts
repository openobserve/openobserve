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

import {
  QueryBuilderOperationDef,
  PromOperationId,
  PromVisualQueryOperationCategory,
} from "../types";

/**
 * Helper to get display name for operation
 */
function getOperationDisplayName(id: string): string {
  return id
    .replace(/_/g, " ")
    .replace(/\b\w/g, (l) => l.toUpperCase());
}

/**
 * Get all operation definitions for PromQL query builder
 */
export function getOperationDefinitions(): QueryBuilderOperationDef[] {
  return [
    // ============ Range Functions ============
    {
      id: PromOperationId.Rate,
      name: "Rate",
      params: [
        {
          name: "Range",
          type: "string",
          placeholder: "5m",
          description: "Time range for rate calculation",
        },
      ],
      defaultParams: ["$__rate_interval"],
      category: PromVisualQueryOperationCategory.RangeFunctions,
      documentation:
        "Calculates the per-second average rate of increase over the specified time range",
    },
    {
      id: PromOperationId.Irate,
      name: "Irate",
      params: [
        {
          name: "Range",
          type: "string",
          placeholder: "5m",
          description: "Time range for instant rate calculation",
        },
      ],
      defaultParams: ["$__interval"],
      category: PromVisualQueryOperationCategory.RangeFunctions,
      documentation:
        "Calculates the per-second instant rate of increase based on the last two data points",
    },
    {
      id: PromOperationId.Increase,
      name: "Increase",
      params: [
        {
          name: "Range",
          type: "string",
          placeholder: "5m",
          description: "Time range for increase calculation",
        },
      ],
      defaultParams: ["$__rate_interval"],
      category: PromVisualQueryOperationCategory.RangeFunctions,
      documentation:
        "Calculates the total increase over the specified time range",
    },
    {
      id: PromOperationId.Delta,
      name: "Delta",
      params: [
        {
          name: "Range",
          type: "string",
          placeholder: "5m",
        },
      ],
      defaultParams: ["$__interval"],
      category: PromVisualQueryOperationCategory.RangeFunctions,
      documentation:
        "Calculates the difference between the first and last value in the range",
    },
    {
      id: PromOperationId.Idelta,
      name: "Idelta",
      params: [
        {
          name: "Range",
          type: "string",
          placeholder: "5m",
        },
      ],
      defaultParams: ["$__interval"],
      category: PromVisualQueryOperationCategory.RangeFunctions,
      documentation:
        "Calculates the difference between the last two samples in the range",
    },
    {
      id: PromOperationId.AvgOverTime,
      name: "Avg Over Time",
      params: [
        {
          name: "Range",
          type: "string",
          placeholder: "5m",
        },
      ],
      defaultParams: ["$__interval"],
      category: PromVisualQueryOperationCategory.RangeFunctions,
      documentation: "Average of all points in the specified interval",
    },
    {
      id: PromOperationId.MinOverTime,
      name: "Min Over Time",
      params: [
        {
          name: "Range",
          type: "string",
          placeholder: "5m",
        },
      ],
      defaultParams: ["$__interval"],
      category: PromVisualQueryOperationCategory.RangeFunctions,
      documentation: "Minimum of all points in the specified interval",
    },
    {
      id: PromOperationId.MaxOverTime,
      name: "Max Over Time",
      params: [
        {
          name: "Range",
          type: "string",
          placeholder: "5m",
        },
      ],
      defaultParams: ["$__interval"],
      category: PromVisualQueryOperationCategory.RangeFunctions,
      documentation: "Maximum of all points in the specified interval",
    },
    {
      id: PromOperationId.SumOverTime,
      name: "Sum Over Time",
      params: [
        {
          name: "Range",
          type: "string",
          placeholder: "5m",
        },
      ],
      defaultParams: ["$__interval"],
      category: PromVisualQueryOperationCategory.RangeFunctions,
      documentation: "Sum of all points in the specified interval",
    },
    {
      id: PromOperationId.CountOverTime,
      name: "Count Over Time",
      params: [
        {
          name: "Range",
          type: "string",
          placeholder: "5m",
        },
      ],
      defaultParams: ["$__interval"],
      category: PromVisualQueryOperationCategory.RangeFunctions,
      documentation: "Count of all points in the specified interval",
    },
    {
      id: PromOperationId.StddevOverTime,
      name: "Stddev Over Time",
      params: [
        {
          name: "Range",
          type: "string",
          placeholder: "5m",
        },
      ],
      defaultParams: ["$__interval"],
      category: PromVisualQueryOperationCategory.RangeFunctions,
      documentation:
        "Standard deviation of all points in the specified interval",
    },
    {
      id: PromOperationId.QuantileOverTime,
      name: "Quantile Over Time",
      params: [
        {
          name: "Quantile",
          type: "number",
          placeholder: "0.95",
          options: [0.99, 0.95, 0.90, 0.75, 0.50],
        },
        {
          name: "Range",
          type: "string",
          placeholder: "5m",
        },
      ],
      defaultParams: [0.95, "$__interval"],
      category: PromVisualQueryOperationCategory.RangeFunctions,
      documentation:
        "Quantile of all points in the specified interval (0-1)",
    },
    {
      id: PromOperationId.LastOverTime,
      name: "Last Over Time",
      params: [
        {
          name: "Range",
          type: "string",
          placeholder: "5m",
        },
      ],
      defaultParams: ["$__interval"],
      category: PromVisualQueryOperationCategory.RangeFunctions,
      documentation: "The most recent point value in the specified interval",
    },

    // ============ Aggregations ============
    {
      id: PromOperationId.Sum,
      name: "Sum",
      params: [
        {
          name: "By Labels",
          type: "select",
          optional: true,
          options: true,
          placeholder: "Select labels",
          description: "Labels to group by",
        },
      ],
      defaultParams: [[]],
      category: PromVisualQueryOperationCategory.Aggregations,
      documentation: "Sum of all values",
    },
    {
      id: PromOperationId.Avg,
      name: "Avg",
      params: [
        {
          name: "By Labels",
          type: "select",
          optional: true,
          options: true,
          placeholder: "Select labels",
        },
      ],
      defaultParams: [[]],
      category: PromVisualQueryOperationCategory.Aggregations,
      documentation: "Average of all values",
    },
    {
      id: PromOperationId.Max,
      name: "Max",
      params: [
        {
          name: "By Labels",
          type: "select",
          optional: true,
          options: true,
          placeholder: "Select labels",
        },
      ],
      defaultParams: [[]],
      category: PromVisualQueryOperationCategory.Aggregations,
      documentation: "Maximum of all values",
    },
    {
      id: PromOperationId.Min,
      name: "Min",
      params: [
        {
          name: "By Labels",
          type: "select",
          optional: true,
          options: true,
          placeholder: "Select labels",
        },
      ],
      defaultParams: [[]],
      category: PromVisualQueryOperationCategory.Aggregations,
      documentation: "Minimum of all values",
    },
    {
      id: PromOperationId.Count,
      name: "Count",
      params: [
        {
          name: "By Labels",
          type: "select",
          optional: true,
          options: true,
          placeholder: "Select labels",
        },
      ],
      defaultParams: [[]],
      category: PromVisualQueryOperationCategory.Aggregations,
      documentation: "Count of elements",
    },
    {
      id: PromOperationId.Stddev,
      name: "Stddev",
      params: [
        {
          name: "By Labels",
          type: "select",
          optional: true,
          options: true,
          placeholder: "Select labels",
        },
      ],
      defaultParams: [[]],
      category: PromVisualQueryOperationCategory.Aggregations,
      documentation: "Standard deviation",
    },
    {
      id: PromOperationId.TopK,
      name: "Top K",
      params: [
        {
          name: "K",
          type: "number",
          placeholder: "10",
          description: "Number of top elements to return",
        },
        {
          name: "By Labels",
          type: "select",
          optional: true,
          options: true,
          placeholder: "Select labels",
        },
      ],
      defaultParams: [10, []],
      category: PromVisualQueryOperationCategory.Aggregations,
      documentation: "Top K largest elements",
    },
    {
      id: PromOperationId.BottomK,
      name: "Bottom K",
      params: [
        {
          name: "K",
          type: "number",
          placeholder: "10",
        },
        {
          name: "By Labels",
          type: "select",
          optional: true,
          options: true,
          placeholder: "Select labels",
        },
      ],
      defaultParams: [10, []],
      category: PromVisualQueryOperationCategory.Aggregations,
      documentation: "Bottom K smallest elements",
    },
    {
      id: PromOperationId.Quantile,
      name: "Quantile",
      params: [
        {
          name: "Quantile",
          type: "number",
          placeholder: "0.95",
          options: [0.99, 0.95, 0.90, 0.75, 0.50],
        },
        {
          name: "By Labels",
          type: "select",
          optional: true,
          options: true,
          placeholder: "Select labels",
        },
      ],
      defaultParams: [0.95, []],
      category: PromVisualQueryOperationCategory.Aggregations,
      documentation: "Quantile aggregation (0-1)",
    },

    // ============ Functions ============
    {
      id: PromOperationId.HistogramQuantile,
      name: "Histogram Quantile",
      params: [
        {
          name: "Quantile",
          type: "number",
          placeholder: "0.95",
          options: [0.99, 0.95, 0.90, 0.75, 0.50],
        },
      ],
      defaultParams: [0.95],
      category: PromVisualQueryOperationCategory.Functions,
      documentation:
        "Calculate quantile from histogram buckets (requires le label)",
    },
    {
      id: PromOperationId.Abs,
      name: "Abs",
      params: [],
      defaultParams: [],
      category: PromVisualQueryOperationCategory.Functions,
      documentation: "Absolute value",
    },
    {
      id: PromOperationId.Ceil,
      name: "Ceil",
      params: [],
      defaultParams: [],
      category: PromVisualQueryOperationCategory.Functions,
      documentation: "Round up to nearest integer",
    },
    {
      id: PromOperationId.Floor,
      name: "Floor",
      params: [],
      defaultParams: [],
      category: PromVisualQueryOperationCategory.Functions,
      documentation: "Round down to nearest integer",
    },
    {
      id: PromOperationId.Round,
      name: "Round",
      params: [
        {
          name: "To Nearest",
          type: "number",
          optional: true,
          placeholder: "1",
        },
      ],
      defaultParams: [1],
      category: PromVisualQueryOperationCategory.Functions,
      documentation: "Round to nearest multiple",
    },
    {
      id: PromOperationId.Sqrt,
      name: "Sqrt",
      params: [],
      defaultParams: [],
      category: PromVisualQueryOperationCategory.Functions,
      documentation: "Square root",
    },
    {
      id: PromOperationId.Exp,
      name: "Exp",
      params: [],
      defaultParams: [],
      category: PromVisualQueryOperationCategory.Functions,
      documentation: "Exponential function (e^x)",
    },
    {
      id: PromOperationId.Ln,
      name: "Ln",
      params: [],
      defaultParams: [],
      category: PromVisualQueryOperationCategory.Functions,
      documentation: "Natural logarithm",
    },
    {
      id: PromOperationId.Log2,
      name: "Log2",
      params: [],
      defaultParams: [],
      category: PromVisualQueryOperationCategory.Functions,
      documentation: "Base-2 logarithm",
    },
    {
      id: PromOperationId.Log10,
      name: "Log10",
      params: [],
      defaultParams: [],
      category: PromVisualQueryOperationCategory.Functions,
      documentation: "Base-10 logarithm",
    },
    {
      id: PromOperationId.Sort,
      name: "Sort",
      params: [],
      defaultParams: [],
      category: PromVisualQueryOperationCategory.Functions,
      documentation: "Sort by sample value ascending",
    },
    {
      id: PromOperationId.SortDesc,
      name: "Sort Desc",
      params: [],
      defaultParams: [],
      category: PromVisualQueryOperationCategory.Functions,
      documentation: "Sort by sample value descending",
    },
    {
      id: PromOperationId.Clamp,
      name: "Clamp",
      params: [
        {
          name: "Min",
          type: "number",
          placeholder: "0",
        },
        {
          name: "Max",
          type: "number",
          placeholder: "100",
        },
      ],
      defaultParams: [0, 100],
      category: PromVisualQueryOperationCategory.Functions,
      documentation: "Clamp values to min/max range",
    },
    {
      id: PromOperationId.ClampMax,
      name: "Clamp Max",
      params: [
        {
          name: "Max",
          type: "number",
          placeholder: "100",
        },
      ],
      defaultParams: [100],
      category: PromVisualQueryOperationCategory.Functions,
      documentation: "Clamp values to maximum",
    },
    {
      id: PromOperationId.ClampMin,
      name: "Clamp Min",
      params: [
        {
          name: "Min",
          type: "number",
          placeholder: "0",
        },
      ],
      defaultParams: [0],
      category: PromVisualQueryOperationCategory.Functions,
      documentation: "Clamp values to minimum",
    },
    {
      id: PromOperationId.Deg,
      name: "Deg",
      params: [],
      defaultParams: [],
      category: PromVisualQueryOperationCategory.Functions,
      documentation: "Convert radians to degrees",
    },
    {
      id: PromOperationId.Rad,
      name: "Rad",
      params: [],
      defaultParams: [],
      category: PromVisualQueryOperationCategory.Functions,
      documentation: "Convert degrees to radians",
    },
    {
      id: PromOperationId.Pi,
      name: "Pi",
      params: [],
      defaultParams: [],
      category: PromVisualQueryOperationCategory.Functions,
      documentation: "Returns the mathematical constant π (pi)",
    },

    // ============ Time Functions ============
    {
      id: PromOperationId.Hour,
      name: "Hour",
      params: [],
      defaultParams: [],
      category: PromVisualQueryOperationCategory.Time,
      documentation: "Hour of the day (0-23)",
    },
    {
      id: PromOperationId.Minute,
      name: "Minute",
      params: [],
      defaultParams: [],
      category: PromVisualQueryOperationCategory.Time,
      documentation: "Minute of the hour (0-59)",
    },
    {
      id: PromOperationId.Month,
      name: "Month",
      params: [],
      defaultParams: [],
      category: PromVisualQueryOperationCategory.Time,
      documentation: "Month of the year (1-12)",
    },
    {
      id: PromOperationId.Year,
      name: "Year",
      params: [],
      defaultParams: [],
      category: PromVisualQueryOperationCategory.Time,
      documentation: "Year",
    },
    {
      id: PromOperationId.DayOfMonth,
      name: "Day of Month",
      params: [],
      defaultParams: [],
      category: PromVisualQueryOperationCategory.Time,
      documentation: "Day of the month (1-31)",
    },
    {
      id: PromOperationId.DayOfWeek,
      name: "Day of Week",
      params: [],
      defaultParams: [],
      category: PromVisualQueryOperationCategory.Time,
      documentation: "Day of the week (0-6, Sunday=0)",
    },
    {
      id: PromOperationId.DaysInMonth,
      name: "Days in Month",
      params: [],
      defaultParams: [],
      category: PromVisualQueryOperationCategory.Time,
      documentation: "Number of days in the month (28-31)",
    },

    // ============ Trigonometric Functions ============
    {
      id: PromOperationId.Sin,
      name: "Sin",
      params: [],
      defaultParams: [],
      category: PromVisualQueryOperationCategory.Trigonometric,
      documentation: "Sine function (input in radians)",
    },
    {
      id: PromOperationId.Cos,
      name: "Cos",
      params: [],
      defaultParams: [],
      category: PromVisualQueryOperationCategory.Trigonometric,
      documentation: "Cosine function (input in radians)",
    },
    {
      id: PromOperationId.Tan,
      name: "Tan",
      params: [],
      defaultParams: [],
      category: PromVisualQueryOperationCategory.Trigonometric,
      documentation: "Tangent function (input in radians)",
    },
    {
      id: PromOperationId.Asin,
      name: "Asin",
      params: [],
      defaultParams: [],
      category: PromVisualQueryOperationCategory.Trigonometric,
      documentation: "Arcsine function (returns radians)",
    },
    {
      id: PromOperationId.Acos,
      name: "Acos",
      params: [],
      defaultParams: [],
      category: PromVisualQueryOperationCategory.Trigonometric,
      documentation: "Arccosine function (returns radians)",
    },
    {
      id: PromOperationId.Atan,
      name: "Atan",
      params: [],
      defaultParams: [],
      category: PromVisualQueryOperationCategory.Trigonometric,
      documentation: "Arctangent function (returns radians)",
    },
    {
      id: PromOperationId.Sinh,
      name: "Sinh",
      params: [],
      defaultParams: [],
      category: PromVisualQueryOperationCategory.Trigonometric,
      documentation: "Hyperbolic sine function",
    },
    {
      id: PromOperationId.Cosh,
      name: "Cosh",
      params: [],
      defaultParams: [],
      category: PromVisualQueryOperationCategory.Trigonometric,
      documentation: "Hyperbolic cosine function",
    },
    {
      id: PromOperationId.Tanh,
      name: "Tanh",
      params: [],
      defaultParams: [],
      category: PromVisualQueryOperationCategory.Trigonometric,
      documentation: "Hyperbolic tangent function",
    },
    {
      id: PromOperationId.Asinh,
      name: "Asinh",
      params: [],
      defaultParams: [],
      category: PromVisualQueryOperationCategory.Trigonometric,
      documentation: "Inverse hyperbolic sine function",
    },
    {
      id: PromOperationId.Acosh,
      name: "Acosh",
      params: [],
      defaultParams: [],
      category: PromVisualQueryOperationCategory.Trigonometric,
      documentation: "Inverse hyperbolic cosine function",
    },
    {
      id: PromOperationId.Atanh,
      name: "Atanh",
      params: [],
      defaultParams: [],
      category: PromVisualQueryOperationCategory.Trigonometric,
      documentation: "Inverse hyperbolic tangent function",
    },

    // ============ Binary Operations ============
    {
      id: PromOperationId.Addition,
      name: "Addition",
      params: [
        {
          name: "Value",
          type: "number",
          placeholder: "0",
          description: "Value to add",
        },
      ],
      defaultParams: [0],
      category: PromVisualQueryOperationCategory.BinaryOps,
      documentation: "Add a scalar value to each sample",
    },
    {
      id: PromOperationId.Subtraction,
      name: "Subtraction",
      params: [
        {
          name: "Value",
          type: "number",
          placeholder: "0",
          description: "Value to subtract",
        },
      ],
      defaultParams: [0],
      category: PromVisualQueryOperationCategory.BinaryOps,
      documentation: "Subtract a scalar value from each sample",
    },
    {
      id: PromOperationId.MultiplyBy,
      name: "Multiply By",
      params: [
        {
          name: "Value",
          type: "number",
          placeholder: "1",
          description: "Value to multiply by",
        },
      ],
      defaultParams: [1],
      category: PromVisualQueryOperationCategory.BinaryOps,
      documentation: "Multiply each sample by a scalar value",
    },
    {
      id: PromOperationId.DivideBy,
      name: "Divide By",
      params: [
        {
          name: "Value",
          type: "number",
          placeholder: "1",
          description: "Value to divide by",
        },
      ],
      defaultParams: [1],
      category: PromVisualQueryOperationCategory.BinaryOps,
      documentation: "Divide each sample by a scalar value",
    },
    {
      id: PromOperationId.Modulo,
      name: "Modulo",
      params: [
        {
          name: "Value",
          type: "number",
          placeholder: "1",
          description: "Modulo divisor",
        },
      ],
      defaultParams: [1],
      category: PromVisualQueryOperationCategory.BinaryOps,
      documentation: "Calculate modulo of each sample with a scalar value",
    },
    {
      id: PromOperationId.Exponent,
      name: "Exponent",
      params: [
        {
          name: "Value",
          type: "number",
          placeholder: "2",
          description: "Exponent power",
        },
      ],
      defaultParams: [2],
      category: PromVisualQueryOperationCategory.BinaryOps,
      documentation: "Raise each sample to the power of a scalar value",
    },
  ];
}

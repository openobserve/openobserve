// Copyright 2026 OpenObserve Inc.
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
  PromqlStepSpec,
  PromqlStepId,
  PromqlStepGroup,
} from "../types";

/**
 * Get all operation definitions for PromQL query builder
 */
export function buildPromqlStepCatalog(): PromqlStepSpec[] {
  return [
    // ============ Range Functions ============
    {
      id: PromqlStepId.Rate,
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
      group: PromqlStepGroup.RateAndRange,
      documentation:
        "Calculates the per-second average rate of increase over the specified time range",
    },
    {
      id: PromqlStepId.Irate,
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
      group: PromqlStepGroup.RateAndRange,
      documentation:
        "Calculates the per-second instant rate of increase based on the last two data points",
    },
    {
      id: PromqlStepId.Increase,
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
      group: PromqlStepGroup.RateAndRange,
      documentation:
        "Calculates the total increase over the specified time range",
    },
    {
      id: PromqlStepId.Delta,
      name: "Delta",
      params: [
        {
          name: "Range",
          type: "string",
          placeholder: "5m",
        },
      ],
      defaultParams: ["$__interval"],
      group: PromqlStepGroup.RateAndRange,
      documentation:
        "Calculates the difference between the first and last value in the range",
    },
    {
      id: PromqlStepId.Idelta,
      name: "Idelta",
      params: [
        {
          name: "Range",
          type: "string",
          placeholder: "5m",
        },
      ],
      defaultParams: ["$__interval"],
      group: PromqlStepGroup.RateAndRange,
      documentation:
        "Calculates the difference between the last two samples in the range",
    },
    {
      id: PromqlStepId.AvgOverTime,
      name: "Avg Over Time",
      params: [
        {
          name: "Range",
          type: "string",
          placeholder: "5m",
        },
      ],
      defaultParams: ["$__interval"],
      group: PromqlStepGroup.RateAndRange,
      documentation: "Average of all points in the specified interval",
    },
    {
      id: PromqlStepId.MinOverTime,
      name: "Min Over Time",
      params: [
        {
          name: "Range",
          type: "string",
          placeholder: "5m",
        },
      ],
      defaultParams: ["$__interval"],
      group: PromqlStepGroup.RateAndRange,
      documentation: "Minimum of all points in the specified interval",
    },
    {
      id: PromqlStepId.MaxOverTime,
      name: "Max Over Time",
      params: [
        {
          name: "Range",
          type: "string",
          placeholder: "5m",
        },
      ],
      defaultParams: ["$__interval"],
      group: PromqlStepGroup.RateAndRange,
      documentation: "Maximum of all points in the specified interval",
    },
    {
      id: PromqlStepId.SumOverTime,
      name: "Sum Over Time",
      params: [
        {
          name: "Range",
          type: "string",
          placeholder: "5m",
        },
      ],
      defaultParams: ["$__interval"],
      group: PromqlStepGroup.RateAndRange,
      documentation: "Sum of all points in the specified interval",
    },
    {
      id: PromqlStepId.CountOverTime,
      name: "Count Over Time",
      params: [
        {
          name: "Range",
          type: "string",
          placeholder: "5m",
        },
      ],
      defaultParams: ["$__interval"],
      group: PromqlStepGroup.RateAndRange,
      documentation: "Count of all points in the specified interval",
    },
    {
      id: PromqlStepId.StddevOverTime,
      name: "Stddev Over Time",
      params: [
        {
          name: "Range",
          type: "string",
          placeholder: "5m",
        },
      ],
      defaultParams: ["$__interval"],
      group: PromqlStepGroup.RateAndRange,
      documentation:
        "Standard deviation of all points in the specified interval",
    },
    {
      id: PromqlStepId.QuantileOverTime,
      name: "Quantile Over Time",
      params: [
        {
          name: "Quantile",
          type: "number",
          placeholder: "0.95",
          options: [0.5, 0.75, 0.9, 0.95, 0.99],
        },
        {
          name: "Range",
          type: "string",
          placeholder: "5m",
        },
      ],
      defaultParams: [0.95, "$__interval"],
      group: PromqlStepGroup.RateAndRange,
      documentation:
        "Quantile of all points in the specified interval (0-1)",
    },
    {
      id: PromqlStepId.LastOverTime,
      name: "Last Over Time",
      params: [
        {
          name: "Range",
          type: "string",
          placeholder: "5m",
        },
      ],
      defaultParams: ["$__interval"],
      group: PromqlStepGroup.RateAndRange,
      documentation: "The most recent point value in the specified interval",
    },

    // ============ Aggregations ============
    {
      id: PromqlStepId.Sum,
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
      group: PromqlStepGroup.Aggregation,
      documentation: "Sum of all values",
    },
    {
      id: PromqlStepId.Avg,
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
      group: PromqlStepGroup.Aggregation,
      documentation: "Average of all values",
    },
    {
      id: PromqlStepId.Max,
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
      group: PromqlStepGroup.Aggregation,
      documentation: "Maximum of all values",
    },
    {
      id: PromqlStepId.Min,
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
      group: PromqlStepGroup.Aggregation,
      documentation: "Minimum of all values",
    },
    {
      id: PromqlStepId.Count,
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
      group: PromqlStepGroup.Aggregation,
      documentation: "Count of elements",
    },
    {
      id: PromqlStepId.Stddev,
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
      group: PromqlStepGroup.Aggregation,
      documentation: "Standard deviation",
    },
    {
      id: PromqlStepId.TopK,
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
      group: PromqlStepGroup.Aggregation,
      documentation: "Top K largest elements",
    },
    {
      id: PromqlStepId.BottomK,
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
      group: PromqlStepGroup.Aggregation,
      documentation: "Bottom K smallest elements",
    },
    {
      id: PromqlStepId.Quantile,
      name: "Quantile",
      params: [
        {
          name: "Quantile",
          type: "number",
          placeholder: "0.95",
          options: [0.5, 0.75, 0.9, 0.95, 0.99],
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
      group: PromqlStepGroup.Aggregation,
      documentation: "Quantile aggregation (0-1)",
    },

    // ============ Functions ============
    {
      id: PromqlStepId.HistogramQuantile,
      name: "Histogram Quantile",
      params: [
        {
          name: "Quantile",
          type: "number",
          placeholder: "0.95",
          options: [0.5, 0.75, 0.9, 0.95, 0.99],
        },
      ],
      defaultParams: [0.95],
      group: PromqlStepGroup.Math,
      documentation:
        "Calculate quantile from histogram buckets (requires le label)",
    },
    {
      id: PromqlStepId.Abs,
      name: "Abs",
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.Math,
      documentation: "Absolute value",
    },
    {
      id: PromqlStepId.Ceil,
      name: "Ceil",
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.Math,
      documentation: "Round up to nearest integer",
    },
    {
      id: PromqlStepId.Floor,
      name: "Floor",
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.Math,
      documentation: "Round down to nearest integer",
    },
    {
      id: PromqlStepId.Round,
      name: "Round",
      params: [
        {
          name: "Nearest multiple",
          type: "number",
          optional: true,
          placeholder: "1",
        },
      ],
      defaultParams: [1],
      group: PromqlStepGroup.Math,
      documentation: "Round to nearest multiple",
    },
    {
      id: PromqlStepId.Sqrt,
      name: "Sqrt",
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.Math,
      documentation: "Square root",
    },
    {
      id: PromqlStepId.Exp,
      name: "Exp",
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.Math,
      documentation: "Exponential function (e^x)",
    },
    {
      id: PromqlStepId.Ln,
      name: "Ln",
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.Math,
      documentation: "Natural logarithm",
    },
    {
      id: PromqlStepId.Log2,
      name: "Log2",
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.Math,
      documentation: "Base-2 logarithm",
    },
    {
      id: PromqlStepId.Log10,
      name: "Log10",
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.Math,
      documentation: "Base-10 logarithm",
    },
    {
      id: PromqlStepId.Sort,
      name: "Sort",
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.Math,
      documentation: "Sort by sample value ascending",
    },
    {
      id: PromqlStepId.SortDesc,
      name: "Sort Desc",
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.Math,
      documentation: "Sort by sample value descending",
    },
    {
      id: PromqlStepId.Clamp,
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
      group: PromqlStepGroup.Math,
      documentation: "Clamp values to min/max range",
    },
    {
      id: PromqlStepId.ClampMax,
      name: "Clamp Max",
      params: [
        {
          name: "Max",
          type: "number",
          placeholder: "100",
        },
      ],
      defaultParams: [100],
      group: PromqlStepGroup.Math,
      documentation: "Clamp values to maximum",
    },
    {
      id: PromqlStepId.ClampMin,
      name: "Clamp Min",
      params: [
        {
          name: "Min",
          type: "number",
          placeholder: "0",
        },
      ],
      defaultParams: [0],
      group: PromqlStepGroup.Math,
      documentation: "Clamp values to minimum",
    },
    {
      id: PromqlStepId.Deg,
      name: "Deg",
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.Trigonometry,
      documentation: "Convert radians to degrees",
    },
    {
      id: PromqlStepId.Rad,
      name: "Rad",
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.Trigonometry,
      documentation: "Convert degrees to radians",
    },
    {
      id: PromqlStepId.Pi,
      name: "Pi",
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.Trigonometry,
      documentation: "Returns the mathematical constant π (pi)",
    },

    // ============ Time Functions ============
    {
      id: PromqlStepId.Hour,
      name: "Hour",
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.TimeAndDate,
      documentation: "Hour of the day (0-23)",
    },
    {
      id: PromqlStepId.Minute,
      name: "Minute",
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.TimeAndDate,
      documentation: "Minute of the hour (0-59)",
    },
    {
      id: PromqlStepId.Month,
      name: "Month",
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.TimeAndDate,
      documentation: "Month of the year (1-12)",
    },
    {
      id: PromqlStepId.Year,
      name: "Year",
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.TimeAndDate,
      documentation: "Year",
    },
    {
      id: PromqlStepId.DayOfMonth,
      name: "Day of Month",
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.TimeAndDate,
      documentation: "Day of the month (1-31)",
    },
    {
      id: PromqlStepId.DayOfWeek,
      name: "Day of Week",
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.TimeAndDate,
      documentation: "Day of the week (0-6, Sunday=0)",
    },
    {
      id: PromqlStepId.DaysInMonth,
      name: "Days in Month",
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.TimeAndDate,
      documentation: "Number of days in the month (28-31)",
    },

    // ============ Trigonometric Functions ============
    {
      id: PromqlStepId.Sin,
      name: "Sin",
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.Trigonometry,
      documentation: "Sine function (input in radians)",
    },
    {
      id: PromqlStepId.Cos,
      name: "Cos",
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.Trigonometry,
      documentation: "Cosine function (input in radians)",
    },
    {
      id: PromqlStepId.Tan,
      name: "Tan",
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.Trigonometry,
      documentation: "Tangent function (input in radians)",
    },
    {
      id: PromqlStepId.Asin,
      name: "Asin",
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.Trigonometry,
      documentation: "Arcsine function (returns radians)",
    },
    {
      id: PromqlStepId.Acos,
      name: "Acos",
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.Trigonometry,
      documentation: "Arccosine function (returns radians)",
    },
    {
      id: PromqlStepId.Atan,
      name: "Atan",
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.Trigonometry,
      documentation: "Arctangent function (returns radians)",
    },
    {
      id: PromqlStepId.Sinh,
      name: "Sinh",
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.Trigonometry,
      documentation: "Hyperbolic sine function",
    },
    {
      id: PromqlStepId.Cosh,
      name: "Cosh",
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.Trigonometry,
      documentation: "Hyperbolic cosine function",
    },
    {
      id: PromqlStepId.Tanh,
      name: "Tanh",
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.Trigonometry,
      documentation: "Hyperbolic tangent function",
    },
    {
      id: PromqlStepId.Asinh,
      name: "Asinh",
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.Trigonometry,
      documentation: "Inverse hyperbolic sine function",
    },
    {
      id: PromqlStepId.Acosh,
      name: "Acosh",
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.Trigonometry,
      documentation: "Inverse hyperbolic cosine function",
    },
    {
      id: PromqlStepId.Atanh,
      name: "Atanh",
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.Trigonometry,
      documentation: "Inverse hyperbolic tangent function",
    },

    // ============ Binary Operations ============
    {
      id: PromqlStepId.Addition,
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
      group: PromqlStepGroup.ScalarMath,
      documentation: "Add a scalar value to each sample",
    },
    {
      id: PromqlStepId.Subtraction,
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
      group: PromqlStepGroup.ScalarMath,
      documentation: "Subtract a scalar value from each sample",
    },
    {
      id: PromqlStepId.MultiplyBy,
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
      group: PromqlStepGroup.ScalarMath,
      documentation: "Multiply each sample by a scalar value",
    },
    {
      id: PromqlStepId.DivideBy,
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
      group: PromqlStepGroup.ScalarMath,
      documentation: "Divide each sample by a scalar value",
    },
    {
      id: PromqlStepId.Modulo,
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
      group: PromqlStepGroup.ScalarMath,
      documentation: "Calculate modulo of each sample with a scalar value",
    },
    {
      id: PromqlStepId.Exponent,
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
      group: PromqlStepGroup.ScalarMath,
      documentation: "Raise each sample to the power of a scalar value",
    },
  ];
}

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

import { gt, raw } from "@/types/i18n";

import { PromqlStepSpec, PromqlStepId, PromqlStepGroup } from "../types";

/**
 * Get all operation definitions for PromQL query builder
 *
 * `gt` rather than a threaded `t`: this catalog is built at import time by a
 * module-scope singleton, so there is no setup context to take `t` from.
 * `raw()` marks the labels that ARE the PromQL token they emit (`Rate` ->
 * `rate()`); English description goes through `gt()`.
 */
export function buildPromqlStepCatalog(): PromqlStepSpec[] {
  return [
    // ============ Range Functions ============
    {
      id: PromqlStepId.Rate,
      name: raw("Rate"),
      params: [
        {
          name: gt("metrics.promQLBuilderOptions.range"),
          type: "string",
          placeholder: raw("5m"),
          descriptionKey: "metrics.operationsList.params.rateRangeDesc",
        },
      ],
      defaultParams: ["$__rate_interval"],
      group: PromqlStepGroup.RateAndRange,
      documentation: gt("promql.operations.rateDoc"),
    },
    {
      id: PromqlStepId.Irate,
      name: raw("Irate"),
      params: [
        {
          name: gt("metrics.promQLBuilderOptions.range"),
          type: "string",
          placeholder: raw("5m"),
          descriptionKey: "metrics.operationsList.params.irateRangeDesc",
        },
      ],
      defaultParams: ["$__interval"],
      group: PromqlStepGroup.RateAndRange,
      documentation: gt("promql.operations.irateDoc"),
    },
    {
      id: PromqlStepId.Increase,
      name: raw("Increase"),
      params: [
        {
          name: gt("metrics.promQLBuilderOptions.range"),
          type: "string",
          placeholder: raw("5m"),
          descriptionKey: "metrics.operationsList.params.increaseRangeDesc",
        },
      ],
      defaultParams: ["$__rate_interval"],
      group: PromqlStepGroup.RateAndRange,
      documentation: gt("promql.operations.increaseDoc"),
    },
    {
      id: PromqlStepId.Delta,
      name: raw("Delta"),
      params: [
        {
          name: gt("metrics.promQLBuilderOptions.range"),
          type: "string",
          placeholder: raw("5m"),
        },
      ],
      defaultParams: ["$__interval"],
      group: PromqlStepGroup.RateAndRange,
      documentation: gt("promql.operations.deltaDoc"),
    },
    {
      id: PromqlStepId.Idelta,
      name: raw("Idelta"),
      params: [
        {
          name: gt("metrics.promQLBuilderOptions.range"),
          type: "string",
          placeholder: raw("5m"),
        },
      ],
      defaultParams: ["$__interval"],
      group: PromqlStepGroup.RateAndRange,
      documentation: gt("promql.operations.ideltaDoc"),
    },
    {
      id: PromqlStepId.AvgOverTime,
      name: raw("Avg Over Time"),
      params: [
        {
          name: gt("metrics.promQLBuilderOptions.range"),
          type: "string",
          placeholder: raw("5m"),
        },
      ],
      defaultParams: ["$__interval"],
      group: PromqlStepGroup.RateAndRange,
      documentation: gt("promql.operations.avgOverTimeDoc"),
    },
    {
      id: PromqlStepId.MinOverTime,
      name: raw("Min Over Time"),
      params: [
        {
          name: gt("metrics.promQLBuilderOptions.range"),
          type: "string",
          placeholder: raw("5m"),
        },
      ],
      defaultParams: ["$__interval"],
      group: PromqlStepGroup.RateAndRange,
      documentation: gt("promql.operations.minOverTimeDoc"),
    },
    {
      id: PromqlStepId.MaxOverTime,
      name: raw("Max Over Time"),
      params: [
        {
          name: gt("metrics.promQLBuilderOptions.range"),
          type: "string",
          placeholder: raw("5m"),
        },
      ],
      defaultParams: ["$__interval"],
      group: PromqlStepGroup.RateAndRange,
      documentation: gt("promql.operations.maxOverTimeDoc"),
    },
    {
      id: PromqlStepId.SumOverTime,
      name: raw("Sum Over Time"),
      params: [
        {
          name: gt("metrics.promQLBuilderOptions.range"),
          type: "string",
          placeholder: raw("5m"),
        },
      ],
      defaultParams: ["$__interval"],
      group: PromqlStepGroup.RateAndRange,
      documentation: gt("promql.operations.sumOverTimeDoc"),
    },
    {
      id: PromqlStepId.CountOverTime,
      name: raw("Count Over Time"),
      params: [
        {
          name: gt("metrics.promQLBuilderOptions.range"),
          type: "string",
          placeholder: raw("5m"),
        },
      ],
      defaultParams: ["$__interval"],
      group: PromqlStepGroup.RateAndRange,
      documentation: gt("promql.operations.countOverTimeDoc"),
    },
    {
      id: PromqlStepId.StddevOverTime,
      name: raw("Stddev Over Time"),
      params: [
        {
          name: gt("metrics.promQLBuilderOptions.range"),
          type: "string",
          placeholder: raw("5m"),
        },
      ],
      defaultParams: ["$__interval"],
      group: PromqlStepGroup.RateAndRange,
      documentation: gt("promql.operations.stddevOverTimeDoc"),
    },
    {
      id: PromqlStepId.QuantileOverTime,
      name: raw("Quantile Over Time"),
      params: [
        {
          name: gt("metrics.operationsList.params.quantileLabel"),
          type: "number",
          placeholder: raw("0.95"),
          options: [0.5, 0.75, 0.9, 0.95, 0.99],
        },
        {
          name: gt("metrics.promQLBuilderOptions.range"),
          type: "string",
          placeholder: raw("5m"),
        },
      ],
      defaultParams: [0.95, "$__interval"],
      group: PromqlStepGroup.RateAndRange,
      documentation: gt("promql.operations.quantileOverTimeDoc"),
    },
    {
      id: PromqlStepId.LastOverTime,
      name: raw("Last Over Time"),
      params: [
        {
          name: gt("metrics.promQLBuilderOptions.range"),
          type: "string",
          placeholder: raw("5m"),
        },
      ],
      defaultParams: ["$__interval"],
      group: PromqlStepGroup.RateAndRange,
      documentation: gt("promql.operations.lastOverTimeDoc"),
    },

    // ============ Aggregations ============
    {
      id: PromqlStepId.Sum,
      name: raw("Sum"),
      params: [
        {
          name: gt("metrics.operationsList.params.byLabelsLabel"),
          type: "select",
          optional: true,
          options: true,
          placeholderKey: "metrics.operationsList.params.selectLabelsPlaceholder",
          descriptionKey: "metrics.operationsList.params.byLabelsDesc",
        },
      ],
      defaultParams: [[]],
      group: PromqlStepGroup.Aggregation,
      documentation: gt("promql.operations.sumDoc"),
    },
    {
      id: PromqlStepId.Avg,
      name: raw("Avg"),
      params: [
        {
          name: gt("metrics.operationsList.params.byLabelsLabel"),
          type: "select",
          optional: true,
          options: true,
          placeholderKey: "metrics.operationsList.params.selectLabelsPlaceholder",
        },
      ],
      defaultParams: [[]],
      group: PromqlStepGroup.Aggregation,
      documentation: gt("promql.operations.avgDoc"),
    },
    {
      id: PromqlStepId.Max,
      name: raw("Max"),
      params: [
        {
          name: gt("metrics.operationsList.params.byLabelsLabel"),
          type: "select",
          optional: true,
          options: true,
          placeholderKey: "metrics.operationsList.params.selectLabelsPlaceholder",
        },
      ],
      defaultParams: [[]],
      group: PromqlStepGroup.Aggregation,
      documentation: gt("promql.operations.maxDoc"),
    },
    {
      id: PromqlStepId.Min,
      name: raw("Min"),
      params: [
        {
          name: gt("metrics.operationsList.params.byLabelsLabel"),
          type: "select",
          optional: true,
          options: true,
          placeholderKey: "metrics.operationsList.params.selectLabelsPlaceholder",
        },
      ],
      defaultParams: [[]],
      group: PromqlStepGroup.Aggregation,
      documentation: gt("promql.operations.minDoc"),
    },
    {
      id: PromqlStepId.Count,
      name: raw("Count"),
      params: [
        {
          name: gt("metrics.operationsList.params.byLabelsLabel"),
          type: "select",
          optional: true,
          options: true,
          placeholderKey: "metrics.operationsList.params.selectLabelsPlaceholder",
        },
      ],
      defaultParams: [[]],
      group: PromqlStepGroup.Aggregation,
      documentation: gt("promql.operations.countDoc"),
    },
    {
      id: PromqlStepId.Stddev,
      name: raw("Stddev"),
      params: [
        {
          name: gt("metrics.operationsList.params.byLabelsLabel"),
          type: "select",
          optional: true,
          options: true,
          placeholderKey: "metrics.operationsList.params.selectLabelsPlaceholder",
        },
      ],
      defaultParams: [[]],
      group: PromqlStepGroup.Aggregation,
      documentation: gt("promql.operations.stddevDoc"),
    },
    {
      id: PromqlStepId.TopK,
      name: raw("Top K"),
      params: [
        {
          name: gt("metrics.operationsList.params.kLabel"),
          type: "number",
          placeholder: raw("10"),
          descriptionKey: "metrics.operationsList.params.topKDesc",
        },
        {
          name: gt("metrics.operationsList.params.byLabelsLabel"),
          type: "select",
          optional: true,
          options: true,
          placeholderKey: "metrics.operationsList.params.selectLabelsPlaceholder",
        },
      ],
      defaultParams: [10, []],
      group: PromqlStepGroup.Aggregation,
      documentation: gt("promql.operations.topKDoc"),
    },
    {
      id: PromqlStepId.BottomK,
      name: raw("Bottom K"),
      params: [
        {
          name: gt("metrics.operationsList.params.kLabel"),
          type: "number",
          placeholder: raw("10"),
        },
        {
          name: gt("metrics.operationsList.params.byLabelsLabel"),
          type: "select",
          optional: true,
          options: true,
          placeholderKey: "metrics.operationsList.params.selectLabelsPlaceholder",
        },
      ],
      defaultParams: [10, []],
      group: PromqlStepGroup.Aggregation,
      documentation: gt("promql.operations.bottomKDoc"),
    },
    {
      id: PromqlStepId.Quantile,
      name: raw("Quantile"),
      params: [
        {
          name: gt("metrics.operationsList.params.quantileLabel"),
          type: "number",
          placeholder: raw("0.95"),
          options: [0.5, 0.75, 0.9, 0.95, 0.99],
        },
        {
          name: gt("metrics.operationsList.params.byLabelsLabel"),
          type: "select",
          optional: true,
          options: true,
          placeholderKey: "metrics.operationsList.params.selectLabelsPlaceholder",
        },
      ],
      defaultParams: [0.95, []],
      group: PromqlStepGroup.Aggregation,
      documentation: gt("promql.operations.quantileDoc"),
    },

    // ============ Functions ============
    {
      id: PromqlStepId.HistogramQuantile,
      name: raw("Histogram Quantile"),
      params: [
        {
          name: gt("metrics.operationsList.params.quantileLabel"),
          type: "number",
          placeholder: raw("0.95"),
          options: [0.5, 0.75, 0.9, 0.95, 0.99],
        },
      ],
      defaultParams: [0.95],
      group: PromqlStepGroup.Math,
      documentation: gt("promql.operations.histogramQuantileDoc"),
    },
    {
      id: PromqlStepId.Abs,
      name: raw("Abs"),
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.Math,
      documentation: gt("promql.operations.absDoc"),
    },
    {
      id: PromqlStepId.Ceil,
      name: raw("Ceil"),
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.Math,
      documentation: gt("promql.operations.ceilDoc"),
    },
    {
      id: PromqlStepId.Floor,
      name: raw("Floor"),
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.Math,
      documentation: gt("promql.operations.floorDoc"),
    },
    {
      id: PromqlStepId.Round,
      name: raw("Round"),
      params: [
        {
          name: gt("metrics.operationsList.params.nearestMultipleLabel"),
          type: "number",
          optional: true,
          placeholder: raw("1"),
        },
      ],
      defaultParams: [1],
      group: PromqlStepGroup.Math,
      documentation: gt("promql.operations.roundDoc"),
    },
    {
      id: PromqlStepId.Sqrt,
      name: raw("Sqrt"),
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.Math,
      documentation: gt("promql.operations.sqrtDoc"),
    },
    {
      id: PromqlStepId.Exp,
      name: raw("Exp"),
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.Math,
      documentation: gt("promql.operations.expDoc"),
    },
    {
      id: PromqlStepId.Ln,
      name: raw("Ln"),
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.Math,
      documentation: gt("promql.operations.lnDoc"),
    },
    {
      id: PromqlStepId.Log2,
      name: raw("Log2"),
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.Math,
      documentation: gt("promql.operations.log2Doc"),
    },
    {
      id: PromqlStepId.Log10,
      name: raw("Log10"),
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.Math,
      documentation: gt("promql.operations.log10Doc"),
    },
    {
      id: PromqlStepId.Sort,
      name: raw("Sort"),
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.Math,
      documentation: gt("promql.operations.sortDoc"),
    },
    {
      id: PromqlStepId.SortDesc,
      name: raw("Sort Desc"),
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.Math,
      documentation: gt("promql.operations.sortDescDoc"),
    },
    {
      id: PromqlStepId.Clamp,
      name: raw("Clamp"),
      params: [
        {
          name: raw("Min"),
          type: "number",
          placeholder: raw("0"),
        },
        {
          name: raw("Max"),
          type: "number",
          placeholder: raw("100"),
        },
      ],
      defaultParams: [0, 100],
      group: PromqlStepGroup.Math,
      documentation: gt("promql.operations.clampDoc"),
    },
    {
      id: PromqlStepId.ClampMax,
      name: raw("Clamp Max"),
      params: [
        {
          name: raw("Max"),
          type: "number",
          placeholder: raw("100"),
        },
      ],
      defaultParams: [100],
      group: PromqlStepGroup.Math,
      documentation: gt("promql.operations.clampMaxDoc"),
    },
    {
      id: PromqlStepId.ClampMin,
      name: raw("Clamp Min"),
      params: [
        {
          name: raw("Min"),
          type: "number",
          placeholder: raw("0"),
        },
      ],
      defaultParams: [0],
      group: PromqlStepGroup.Math,
      documentation: gt("promql.operations.clampMinDoc"),
    },
    {
      id: PromqlStepId.Deg,
      name: raw("Deg"),
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.Trigonometry,
      documentation: gt("promql.operations.degDoc"),
    },
    {
      id: PromqlStepId.Rad,
      name: raw("Rad"),
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.Trigonometry,
      documentation: gt("promql.operations.radDoc"),
    },
    {
      id: PromqlStepId.Pi,
      name: raw("Pi"),
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.Trigonometry,
      documentation: gt("promql.operations.piDoc"),
    },

    // ============ Time Functions ============
    {
      id: PromqlStepId.Hour,
      name: raw("Hour"),
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.TimeAndDate,
      documentation: gt("promql.operations.hourDoc"),
    },
    {
      id: PromqlStepId.Minute,
      name: raw("Minute"),
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.TimeAndDate,
      documentation: gt("promql.operations.minuteDoc"),
    },
    {
      id: PromqlStepId.Month,
      name: raw("Month"),
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.TimeAndDate,
      documentation: gt("promql.operations.monthDoc"),
    },
    {
      id: PromqlStepId.Year,
      name: raw("Year"),
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.TimeAndDate,
      documentation: gt("promql.operations.yearDoc"),
    },
    {
      id: PromqlStepId.DayOfMonth,
      name: raw("Day of Month"),
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.TimeAndDate,
      documentation: gt("promql.operations.dayOfMonthDoc"),
    },
    {
      id: PromqlStepId.DayOfWeek,
      name: raw("Day of Week"),
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.TimeAndDate,
      documentation: gt("promql.operations.dayOfWeekDoc"),
    },
    {
      id: PromqlStepId.DaysInMonth,
      name: raw("Days in Month"),
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.TimeAndDate,
      documentation: gt("promql.operations.daysInMonthDoc"),
    },

    // ============ Trigonometric Functions ============
    {
      id: PromqlStepId.Sin,
      name: raw("Sin"),
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.Trigonometry,
      documentation: gt("promql.operations.sinDoc"),
    },
    {
      id: PromqlStepId.Cos,
      name: raw("Cos"),
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.Trigonometry,
      documentation: gt("promql.operations.cosDoc"),
    },
    {
      id: PromqlStepId.Tan,
      name: raw("Tan"),
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.Trigonometry,
      documentation: gt("promql.operations.tanDoc"),
    },
    {
      id: PromqlStepId.Asin,
      name: raw("Asin"),
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.Trigonometry,
      documentation: gt("promql.operations.asinDoc"),
    },
    {
      id: PromqlStepId.Acos,
      name: raw("Acos"),
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.Trigonometry,
      documentation: gt("promql.operations.acosDoc"),
    },
    {
      id: PromqlStepId.Atan,
      name: raw("Atan"),
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.Trigonometry,
      documentation: gt("promql.operations.atanDoc"),
    },
    {
      id: PromqlStepId.Sinh,
      name: raw("Sinh"),
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.Trigonometry,
      documentation: gt("promql.operations.sinhDoc"),
    },
    {
      id: PromqlStepId.Cosh,
      name: raw("Cosh"),
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.Trigonometry,
      documentation: gt("promql.operations.coshDoc"),
    },
    {
      id: PromqlStepId.Tanh,
      name: raw("Tanh"),
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.Trigonometry,
      documentation: gt("promql.operations.tanhDoc"),
    },
    {
      id: PromqlStepId.Asinh,
      name: raw("Asinh"),
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.Trigonometry,
      documentation: gt("promql.operations.asinhDoc"),
    },
    {
      id: PromqlStepId.Acosh,
      name: raw("Acosh"),
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.Trigonometry,
      documentation: gt("promql.operations.acoshDoc"),
    },
    {
      id: PromqlStepId.Atanh,
      name: raw("Atanh"),
      params: [],
      defaultParams: [],
      group: PromqlStepGroup.Trigonometry,
      documentation: gt("promql.operations.atanhDoc"),
    },

    // ============ Binary Operations ============
    {
      id: PromqlStepId.Addition,
      name: gt("promql.operations.additionName"),
      params: [
        {
          name: gt("common.value"),
          type: "number",
          placeholder: raw("0"),
          descriptionKey: "metrics.operationsList.params.valueToAddDesc",
        },
      ],
      defaultParams: [0],
      group: PromqlStepGroup.ScalarMath,
      documentation: gt("promql.operations.additionDoc"),
    },
    {
      id: PromqlStepId.Subtraction,
      name: gt("promql.operations.subtractionName"),
      params: [
        {
          name: gt("common.value"),
          type: "number",
          placeholder: raw("0"),
          descriptionKey: "metrics.operationsList.params.valueToSubtractDesc",
        },
      ],
      defaultParams: [0],
      group: PromqlStepGroup.ScalarMath,
      documentation: gt("promql.operations.subtractionDoc"),
    },
    {
      id: PromqlStepId.MultiplyBy,
      name: gt("promql.operations.multiplyByName"),
      params: [
        {
          name: gt("common.value"),
          type: "number",
          placeholder: raw("1"),
          descriptionKey: "metrics.operationsList.params.valueToMultiplyDesc",
        },
      ],
      defaultParams: [1],
      group: PromqlStepGroup.ScalarMath,
      documentation: gt("promql.operations.multiplyByDoc"),
    },
    {
      id: PromqlStepId.DivideBy,
      name: gt("promql.operations.divideByName"),
      params: [
        {
          name: gt("common.value"),
          type: "number",
          placeholder: raw("1"),
          descriptionKey: "metrics.operationsList.params.valueToDivideDesc",
        },
      ],
      defaultParams: [1],
      group: PromqlStepGroup.ScalarMath,
      documentation: gt("promql.operations.divideByDoc"),
    },
    {
      id: PromqlStepId.Modulo,
      name: gt("promql.operations.moduloName"),
      params: [
        {
          name: gt("common.value"),
          type: "number",
          placeholder: raw("1"),
          descriptionKey: "metrics.operationsList.params.moduloDivisorDesc",
        },
      ],
      defaultParams: [1],
      group: PromqlStepGroup.ScalarMath,
      documentation: gt("promql.operations.moduloDoc"),
    },
    {
      id: PromqlStepId.Exponent,
      name: gt("promql.operations.exponentName"),
      params: [
        {
          name: gt("common.value"),
          type: "number",
          placeholder: raw("2"),
          descriptionKey: "metrics.operationsList.params.exponentPowerDesc",
        },
      ],
      defaultParams: [2],
      group: PromqlStepGroup.ScalarMath,
      documentation: gt("promql.operations.exponentDoc"),
    },
  ];
}

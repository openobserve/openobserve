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

/**
 * The PromQL vocabulary: every aggregation, function, modifier and word-shaped
 * operator the language has, with Prometheus's own one-line description.
 *
 * SNAPSHOT, not hand-written: taken from the term tables the Prometheus project
 * publishes for its own query editor (v0.311.3, Apache-2.0). A snapshot rather
 * than an import because that package requires an unrelated editor library at
 * module scope — for a require it never uses — which dragged ~376 KB of that
 * library's runtime into every route touching PromQL. This app runs on monaco,
 * exclusively, and so does its bundle.
 *
 * To refresh after a Prometheus release: the generator that produced this file
 * is in git history — `git log --diff-filter=D -- web/scripts/generate-promql-terms.mjs`
 * — and it is twenty lines. Editing this file by hand is equally fine: the data
 * is inert, labels and prose with no behaviour, and promqlCompletion.spec.ts
 * guards the shape either way.
 */

export interface PromqlTerm {
  label: string;
  /** Upstream's group name: "function", "aggregation". Absent on modifiers. */
  detail?: string;
  /** Upstream's one-line description. Absent on the set operators. */
  info?: string;
}

export const AGGREGATION_TERMS: PromqlTerm[] = [
  {
    label: "avg",
    detail: "aggregation",
    info: "Calculate the average over dimensions",
  },
  {
    label: "bottomk",
    detail: "aggregation",
    info: "Smallest k elements by sample value",
  },
  {
    label: "count",
    detail: "aggregation",
    info: "Count number of elements in the vector",
  },
  {
    label: "count_values",
    detail: "aggregation",
    info: "Count number of elements with the same value",
  },
  {
    label: "group",
    detail: "aggregation",
    info: "Group series, while setting the sample value to 1",
  },
  {
    label: "limitk",
    detail: "aggregation",
    info: "Sample k elements",
  },
  {
    label: "limit_ratio",
    detail: "aggregation",
    info: "Sample given ratio of elements",
  },
  {
    label: "max",
    detail: "aggregation",
    info: "Select maximum over dimensions",
  },
  {
    label: "min",
    detail: "aggregation",
    info: "Select minimum over dimensions",
  },
  {
    label: "quantile",
    detail: "aggregation",
    info: "Calculate φ-quantile (0 ≤ φ ≤ 1) over dimensions",
  },
  {
    label: "stddev",
    detail: "aggregation",
    info: "Calculate population standard deviation over dimensions",
  },
  {
    label: "stdvar",
    detail: "aggregation",
    info: "Calculate population standard variance over dimensions",
  },
  {
    label: "sum",
    detail: "aggregation",
    info: "Calculate sum over dimensions",
  },
  {
    label: "topk",
    detail: "aggregation",
    info: "Largest k elements by sample value",
  },
];

export const FUNCTION_TERMS: PromqlTerm[] = [
  {
    label: "abs",
    detail: "function",
    info: "Return absolute values of input series",
  },
  {
    label: "absent",
    detail: "function",
    info: "Determine whether input vector is empty",
  },
  {
    label: "absent_over_time",
    detail: "function",
    info: "Determine whether input range vector is empty",
  },
  {
    label: "acos",
    detail: "function",
    info: "Calculate the arccosine, in radians, for input series",
  },
  {
    label: "acosh",
    detail: "function",
    info: "Calculate the inverse hyperbolic cosine, in radians, for input series",
  },
  {
    label: "asin",
    detail: "function",
    info: "Calculate the arcsine, in radians, for input series",
  },
  {
    label: "asinh",
    detail: "function",
    info: "Calculate the inverse hyperbolic sine, in radians, for input series",
  },
  {
    label: "atan",
    detail: "function",
    info: "Calculate the arctangent, in radians, for input series",
  },
  {
    label: "atanh",
    detail: "function",
    info: "Calculate the inverse hyperbolic tangent, in radians, for input series",
  },
  {
    label: "avg_over_time",
    detail: "function",
    info: "Average series values over time",
  },
  {
    label: "ceil",
    detail: "function",
    info: "Round up values of input series to nearest integer",
  },
  {
    label: "changes",
    detail: "function",
    info: "Return number of value changes in input series over time",
  },
  {
    label: "clamp",
    detail: "function",
    info: "Limit the value of input series between a minimum and a maximum",
  },
  {
    label: "clamp_max",
    detail: "function",
    info: "Limit the value of input series to a maximum",
  },
  {
    label: "clamp_min",
    detail: "function",
    info: "Limit the value of input series to a minimum",
  },
  {
    label: "cos",
    detail: "function",
    info: "Calculate the cosine, in radians, for input series",
  },
  {
    label: "cosh",
    detail: "function",
    info: "Calculate the hyperbolic cosine, in radians, for input series",
  },
  {
    label: "count_over_time",
    detail: "function",
    info: "Count the number of values for each input series",
  },
  {
    label: "days_in_month",
    detail: "function",
    info: "Return the number of days in current month for provided timestamps",
  },
  {
    label: "day_of_month",
    detail: "function",
    info: "Return the day of the month for provided timestamps",
  },
  {
    label: "day_of_week",
    detail: "function",
    info: "Return the day of the week for provided timestamps",
  },
  {
    label: "day_of_year",
    detail: "function",
    info: "Return the day of the year for provided timestamps",
  },
  {
    label: "deg",
    detail: "function",
    info: "Convert radians to degrees for input series",
  },
  {
    label: "delta",
    detail: "function",
    info: "Calculate the difference between beginning and end of a range vector (for gauges)",
  },
  {
    label: "deriv",
    detail: "function",
    info: "Calculate the per-second derivative over series in a range vector (for gauges)",
  },
  {
    label: "exp",
    detail: "function",
    info: "Calculate exponential function for input vector values",
  },
  {
    label: "floor",
    detail: "function",
    info: "Round down values of input series to nearest integer",
  },
  {
    label: "histogram_avg",
    detail: "function",
    info: "Return the average of observations from a native histogram",
  },
  {
    label: "histogram_count",
    detail: "function",
    info: "Return the count of observations from a native histogram",
  },
  {
    label: "histogram_fraction",
    detail: "function",
    info: "Calculate fractions of observations within an interval from a native histogram",
  },
  {
    label: "histogram_quantile",
    detail: "function",
    info: "Calculate quantiles from native histograms and from conventional histogram buckets",
  },
  {
    label: "histogram_quantiles",
    detail: "function",
    info: "Calculate multiple quantiles from native histograms and from conventional histogram buckets",
  },
  {
    label: "histogram_sum",
    detail: "function",
    info: "Return the sum of observations from a native histogram",
  },
  {
    label: "histogram_stddev",
    detail: "function",
    info: "Estimate the standard deviation of observations from a native histogram",
  },
  {
    label: "histogram_stdvar",
    detail: "function",
    info: "Estimate the standard variance of observations from a native histogram",
  },
  {
    label: "double_exponential_smoothing",
    detail: "function",
    info: "Calculate smoothed value of input series",
  },
  {
    label: "hour",
    detail: "function",
    info: "Return the hour of the day for provided timestamps",
  },
  {
    label: "idelta",
    detail: "function",
    info: "Calculate the difference between the last two samples of a range vector (for counters)",
  },
  {
    label: "increase",
    detail: "function",
    info: "Calculate the increase in value over a range of time (for counters)",
  },
  {
    label: "info",
    detail: "function",
    info: "Add data labels from corresponding info metrics",
  },
  {
    label: "irate",
    detail: "function",
    info: "Calculate the per-second increase over the last two samples of a range vector (for counters)",
  },
  {
    label: "label_replace",
    detail: "function",
    info: "Set or replace label values",
  },
  {
    label: "label_join",
    detail: "function",
    info: "Join together label values into new label",
  },
  {
    label: "first_over_time",
    detail: "function",
    info: "Return the value of the oldest sample in the specified interval",
  },
  {
    label: "last_over_time",
    detail: "function",
    info: "Return the value of the most recent sample in the specified interval",
  },
  {
    label: "ln",
    detail: "function",
    info: "Calculate natural logarithm of input series",
  },
  {
    label: "log10",
    detail: "function",
    info: "Calulcate base-10 logarithm of input series",
  },
  {
    label: "log2",
    detail: "function",
    info: "Calculate base-2 logarithm of input series",
  },
  {
    label: "mad_over_time",
    detail: "function",
    info: "Return the median absolute deviation over time for input series",
  },
  {
    label: "max_over_time",
    detail: "function",
    info: "Return the maximum value over time for input series",
  },
  {
    label: "min_over_time",
    detail: "function",
    info: "Return the minimum value over time for input series",
  },
  {
    label: "ts_of_max_over_time",
    detail: "function",
    info: "Return the timestamp of the maximum value over time for input series",
  },
  {
    label: "ts_of_min_over_time",
    detail: "function",
    info: "Return the timestamp of the minimum value over time for input series",
  },
  {
    label: "ts_of_first_over_time",
    detail: "function",
    info: "Return the timestamp of the first value over time for input series",
  },
  {
    label: "ts_of_last_over_time",
    detail: "function",
    info: "Return the timestamp of the last value over time for input series",
  },
  {
    label: "minute",
    detail: "function",
    info: "Return the minute of the hour for provided timestamps",
  },
  {
    label: "month",
    detail: "function",
    info: "Return the month for provided timestamps",
  },
  {
    label: "pi",
    detail: "function",
    info: "Return pi",
  },
  {
    label: "predict_linear",
    detail: "function",
    info: "Predict the value of a gauge into the future",
  },
  {
    label: "present_over_time",
    detail: "function",
    info: "the value 1 for any series in the specified interval",
  },
  {
    label: "quantile_over_time",
    detail: "function",
    info: "Calculate value quantiles over time for input series",
  },
  {
    label: "rad",
    detail: "function",
    info: "Convert degrees to radians for input series",
  },
  {
    label: "rate",
    detail: "function",
    info: "Calculate per-second increase over a range vector (for counters)",
  },
  {
    label: "resets",
    detail: "function",
    info: "Return number of value decreases (resets) in input series of time",
  },
  {
    label: "round",
    detail: "function",
    info: "Round values of input series to nearest integer",
  },
  {
    label: "scalar",
    detail: "function",
    info: "Convert single-element series vector into scalar value",
  },
  {
    label: "sgn",
    detail: "function",
    info: "Returns the sign of the instant vector",
  },
  {
    label: "sin",
    detail: "function",
    info: "Calculate the sine, in radians, for input series",
  },
  {
    label: "sinh",
    detail: "function",
    info: "Calculate the hyperbolic sine, in radians, for input series",
  },
  {
    label: "sort",
    detail: "function",
    info: "Sort input series ascendingly by value",
  },
  {
    label: "sort_desc",
    detail: "function",
    info: "Sort input series descendingly by value",
  },
  {
    label: "sort_by_label",
    detail: "function",
    info: "Sort input series ascendingly by label value",
  },
  {
    label: "sort_by_label_desc",
    detail: "function",
    info: "Sort input series descendingly by value value",
  },
  {
    label: "sqrt",
    detail: "function",
    info: "Return the square root for input series",
  },
  {
    label: "stddev_over_time",
    detail: "function",
    info: "Calculate the standard deviation within input series over time",
  },
  {
    label: "stdvar_over_time",
    detail: "function",
    info: "Calculate the standard variance within input series over time",
  },
  {
    label: "sum_over_time",
    detail: "function",
    info: "Calculate the sum over the values of input series over time",
  },
  {
    label: "tan",
    detail: "function",
    info: "Calculate the tangent, in radians, for input series",
  },
  {
    label: "tanh",
    detail: "function",
    info: "Calculate the hyperbolic tangent, in radians, for input series",
  },
  {
    label: "time",
    detail: "function",
    info: "Return the Unix timestamp at the current evaluation time",
  },
  {
    label: "timestamp",
    detail: "function",
    info: "Return the Unix timestamp for the samples in the input vector",
  },
  {
    label: "vector",
    detail: "function",
    info: "Convert a scalar value into a single-element series vector",
  },
  {
    label: "year",
    detail: "function",
    info: "Return the year for provided timestamps",
  },
];

export const AGGREGATION_MODIFIER_TERMS: PromqlTerm[] = [
  {
    label: "by",
    info: "Keep the listed labels, remove all others.",
  },
  {
    label: "without",
    info: "Remove the listed labels, preserve all others.",
  },
];

export const BINARY_MODIFIER_TERMS: PromqlTerm[] = [
  {
    label: "on",
    info: "Match only on specified labels",
  },
  {
    label: "ignoring",
    info: "Ignore specified labels for matching",
  },
  {
    label: "group_left",
    info: "Allow many-to-one matching",
  },
  {
    label: "group_right",
    info: "Allow one-to-many matching",
  },
  {
    label: "bool",
    info: "Return boolean result (0 or 1) instead of filtering",
  },
  {
    label: "fill",
    info: "Fill in missing series on both sides",
  },
  {
    label: "fill_left",
    info: "Fill in missing series on the left side",
  },
  {
    label: "fill_right",
    info: "Fill in missing series on the right side",
  },
];

export const AT_MODIFIER_TERMS: PromqlTerm[] = [
  {
    label: "start()",
    info: "resolve to the start of the query",
  },
  {
    label: "end()",
    info: "resolve to the end of the query",
  },
];

export const BINARY_OPERATOR_TERMS: PromqlTerm[] = [
  {
    label: "^",
  },
  {
    label: "*",
  },
  {
    label: "/",
  },
  {
    label: "%",
  },
  {
    label: "+",
  },
  {
    label: "-",
  },
  {
    label: "==",
  },
  {
    label: ">=",
  },
  {
    label: ">",
  },
  {
    label: "<",
  },
  {
    label: "</",
  },
  {
    label: ">/",
  },
  {
    label: "<=",
  },
  {
    label: "!=",
  },
  {
    label: "atan2",
  },
  {
    label: "and",
  },
  {
    label: "or",
  },
  {
    label: "unless",
  },
];

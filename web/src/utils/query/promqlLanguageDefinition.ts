// Copyright 2026 OpenObserve Inc.
//
// Monarch grammar for PromQL so Monaco can syntax-highlight metric queries.
// Monaco ships no built-in PromQL language — registering the id alone (which
// is all we did historically) renders queries in a single colour. Token names
// reuse Monaco's standard vocabulary (keyword / predefined / string / number /
// variable) so the existing light and dark editor themes colour them exactly
// like the SQL editor does, with no extra theme rules.

// Aggregation operators — keyword-blue, like SQL's SELECT/GROUP BY.
const AGGREGATIONS = [
  "sum",
  "min",
  "max",
  "avg",
  "group",
  "stddev",
  "stdvar",
  "count",
  "count_values",
  "bottomk",
  "topk",
  "quantile",
  "limitk",
  "limit_ratio",
];

// Vector-matching / modifier keywords and set operators.
const KEYWORDS = [
  "by",
  "without",
  "on",
  "ignoring",
  "group_left",
  "group_right",
  "offset",
  "bool",
  "and",
  "or",
  "unless",
  "atan2",
  "start",
  "end",
];

// Built-in functions — "predefined" token, same as SQL built-ins.
const FUNCTIONS = [
  "abs",
  "absent",
  "absent_over_time",
  "acos",
  "acosh",
  "asin",
  "asinh",
  "atan",
  "atanh",
  "avg_over_time",
  "ceil",
  "changes",
  "clamp",
  "clamp_max",
  "clamp_min",
  "cos",
  "cosh",
  "count_over_time",
  "day_of_month",
  "day_of_week",
  "day_of_year",
  "days_in_month",
  "deg",
  "delta",
  "deriv",
  "double_exponential_smoothing",
  "exp",
  "floor",
  "histogram_avg",
  "histogram_count",
  "histogram_fraction",
  "histogram_quantile",
  "histogram_stddev",
  "histogram_stdvar",
  "histogram_sum",
  "holt_winters",
  "hour",
  "idelta",
  "increase",
  "info",
  "irate",
  "label_join",
  "label_replace",
  "last_over_time",
  "ln",
  "log10",
  "log2",
  "mad_over_time",
  "max_over_time",
  "min_over_time",
  "minute",
  "month",
  "pi",
  "predict_linear",
  "present_over_time",
  "quantile_over_time",
  "rad",
  "rate",
  "resets",
  "round",
  "scalar",
  "sgn",
  "sin",
  "sinh",
  "sort",
  "sort_by_label",
  "sort_by_label_desc",
  "sort_desc",
  "sqrt",
  "stddev_over_time",
  "stdvar_over_time",
  "sum_over_time",
  "tan",
  "tanh",
  "time",
  "timestamp",
  "vector",
  "year",
];

export const promqlLanguageDefinition = {
  defaultToken: "",
  tokenPostfix: ".promql",
  ignoreCase: false,

  aggregations: AGGREGATIONS,
  keywords: KEYWORDS,
  functions: FUNCTIONS,

  symbols: /[=><!~+\-*/%^]+/,
  escapes: /\\(?:[abfnrtv\\"'0]|x[0-9A-Fa-f]{2}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,

  tokenizer: {
    root: [
      [/#.*$/, "comment"],

      // Dashboard/template variables: $__rate_interval, $var, ${var}
      [/\$\{[a-zA-Z_][a-zA-Z0-9_]*\}/, "variable"],
      [/\$[a-zA-Z_][a-zA-Z0-9_]*/, "variable"],

      // Durations before plain numbers: 5m, 1h30m, 90s, 1ms
      [/\d+(?:\.\d+)?(?:ms|[smhdwy])(?:\d+(?:\.\d+)?(?:ms|[smhdwy]))*/, "number"],

      // Numbers: hex, decimal/scientific, special values
      [/0x[0-9a-fA-F]+/, "number"],
      [/\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, "number"],
      [/\.\d+(?:[eE][+-]?\d+)?/, "number"],
      [/\b(?:Inf|inf|NaN|nan)\b/, "number"],

      // Quoted numeric label values colour as numbers (green) — PromQL values
      // are always quoted, and this matches the builder chips' number/string
      // split (same /^-?[\d.]+$/ test) and SQL's unquoted number colouring.
      [/"-?[\d.]+"/, "number"],
      [/'-?[\d.]+'/, "number"],

      // Strings (label values); unterminated tail stays string-coloured while typing
      [/"(?:[^"\\]|@escapes)*"/, "string"],
      [/'(?:[^'\\]|@escapes)*'/, "string"],
      [/`[^`]*`/, "string"],
      [/"(?:[^"\\]|@escapes)*$/, "string"],
      [/'(?:[^'\\]|@escapes)*$/, "string"],

      // Identifiers: aggregations/keywords/functions, else metric or label name.
      // Metric names may contain colons (recording rules).
      [
        /[a-zA-Z_][a-zA-Z0-9_:]*/,
        {
          cases: {
            "@aggregations": "keyword",
            "@keywords": "keyword",
            "@functions": "predefined",
            "@default": "identifier",
          },
        },
      ],

      [/[{}()[\]]/, "@brackets"],
      [/@symbols/, "operator"],
      [/[,:;]/, "delimiter"],
      [/\s+/, "white"],
    ],
  },
};

// Copyright 2026 OpenObserve Inc.

/**
 * Detects when a panel aggregation is pointed at a text column, and builds the
 * cast expression that fixes it. A field ingested as `Utf8` can never widen back
 * to a number in the stream schema, so casting in the query is the only remedy.
 */

/** Arrow type names the schema API reports for text columns. */
const TEXT_FIELD_TYPES = new Set(["Utf8", "LargeUtf8", "Utf8View", "utf8", "string"]);

/** Rejects a text argument outright — the planner fails and nothing renders. */
const NUMERIC_ARG_FUNCTIONS = new Set([
  "sum",
  "avg",
  "mean",
  "median",
  "p50",
  "p90",
  "p95",
  "p99",
  "approx_percentile_cont",
  "approx_percentile_cont_with_weight",
  "approx_median",
  "percentile_cont",
  "var",
  "var_pop",
  "var_samp",
  "stddev",
  "stddev_pop",
  "abs",
  "ceil",
  "floor",
  "round",
  "sqrt",
  "cbrt",
  "exp",
  "ln",
  "log",
  "log2",
  "log10",
  "pow",
  "power",
  "signum",
  "trunc",
  "corr",
  "covar",
  "covar_pop",
  "bit_and",
  "bit_or",
  "bit_xor",
  "factorial",
  "gcd",
  "lcm",
  "isnan",
  "iszero",
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "atan2",
  "sinh",
  "cosh",
  "tanh",
  "asinh",
  "acosh",
  "atanh",
  "cot",
  "degrees",
  "radians",
]);

export const SAFE_CAST_FUNCTION = "try_cast";
export const STRICT_CAST_FUNCTION = "cast";

/** SQL type names offered as cast targets; anything else is rejected at build time. */
export const CAST_TARGET_TYPES = ["DOUBLE", "BIGINT"] as const;

/**
 * The one-click suggestion always offers DOUBLE, never BIGINT: text amounts are
 * usually decimals, and `TRY_CAST('15.46' AS BIGINT)` is NULL, so a one-click
 * BIGINT would silently empty the chart. BIGINT stays available on the cast
 * node's own selector, where the user is choosing it deliberately.
 */
export const DEFAULT_CAST_TARGET_TYPE: CastTargetType = "DOUBLE";

export type CastTargetType = (typeof CAST_TARGET_TYPES)[number];

/**
 * Only one severity today: the query provably cannot run. `min`/`max` accept text
 * and are deliberately NOT flagged — `max(hostname)` is an ordinary query, and
 * nothing here can tell a text column of numbers from a column of words.
 */
export type CastSeverity = "error";

interface FieldRef {
  field?: string;
  streamAlias?: string | null;
}

interface FunctionArg {
  type: string;
  value: unknown;
}

export function isCastFunction(functionName: string | null | undefined): boolean {
  return functionName === SAFE_CAST_FUNCTION || functionName === STRICT_CAST_FUNCTION;
}

export function isTextFieldType(fieldType: string | null | undefined): boolean {
  return !!fieldType && TEXT_FIELD_TYPES.has(fieldType);
}

export function isCastTargetType(value: unknown): value is CastTargetType {
  return CAST_TARGET_TYPES.includes(value as CastTargetType);
}

/**
 * Looks a field's Arrow type up in the panel's already-loaded stream schemas.
 * Returns null when the schema has not loaded yet, which suppresses the
 * suggestion rather than guessing.
 */
export function resolveFieldType(
  groupedFields: any[] | undefined,
  fieldRef: FieldRef | null | undefined,
): string | null {
  const name = fieldRef?.field;
  if (!name || !Array.isArray(groupedFields)) return null;

  // Match the named stream only. Falling back to any stream would read a
  // same-named column off an unrelated join and suggest a cast on its type.
  const alias = fieldRef?.streamAlias ?? null;
  const matchesAlias = groupedFields.filter(
    (group: any) => (group?.stream_alias ?? null) === alias,
  );

  for (const group of matchesAlias) {
    const match = (group?.schema ?? []).find((schemaField: any) => schemaField?.name === name);
    if (match?.type) return match.type;
  }

  return null;
}

export function getCastSeverity(
  functionName: string | null | undefined,
  fieldType: string | null | undefined,
): CastSeverity | null {
  if (!functionName || !isTextFieldType(fieldType)) return null;
  if (isCastFunction(functionName)) return null;
  return NUMERIC_ARG_FUNCTIONS.has(functionName) ? "error" : null;
}

/**
 * Wraps an argument in a cast node. The cast is an ordinary function node, so
 * the existing recursive SQL builder renders it without special handling.
 */
export function wrapArgInCast(
  arg: FunctionArg,
  targetType: CastTargetType = DEFAULT_CAST_TARGET_TYPE,
  functionName: string = SAFE_CAST_FUNCTION,
): FunctionArg {
  return {
    type: "function",
    value: {
      functionName,
      args: [
        { type: arg.type, value: arg.value },
        { type: "castType", value: targetType },
      ],
    },
  };
}

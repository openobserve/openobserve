// Copyright 2026 OpenObserve Inc.
//
// Auto-name generators — turn what the user has configured so far into a name a
// human would have written. Paired with `useAutoName`, which decides WHEN a
// generated name is allowed to win; these functions only decide WHAT it says.
//
// Two rules keep the output honest:
//   • Only describe what is actually configured. A half-built panel yields a
//     shorter name, never a speculative one, and an empty string when there is
//     nothing to say (the field then shows its placeholder).
//   • Sentence templates come from i18n; the identifiers interpolated into them
//     (column names, SQL aggregation functions, operators, stream names) are
//     user data and stay verbatim.

/** Minimal shape of vue-i18n's `t` — avoids dragging the composer type in. */
type TranslateFn = (_key: string, _params?: Record<string, unknown>) => string;

const MAX_MEASURES = 2;

const capitalize = (value: string): string =>
  value.length > 0 ? value[0].toUpperCase() + value.slice(1) : value;

/**
 * Collapse runs of whitespace and trim. The FULL name is kept — the header
 * truncates it visually with CSS (an ellipsis in the saved value is wrong; the
 * stored name must be the complete one).
 */
const tidy = (value: string): string => value.replace(/\s+/g, " ").trim();

// ── Dashboard panels ───────────────────────────────────────────────────────

/**
 * A panel field as stored in `queries[].fields.{x,y,breakdown}`. TWO shapes
 * exist and both are live:
 *
 *   • BUILDER (what usePanelFields writes today) — the aggregation is
 *     `functionName` and the column lives inside `args`, as
 *     `args[{type:"field"}].value.field`. There is no `column` key at all.
 *   • LEGACY (older saved panels and the bundled dashboards, e.g.
 *     utils/rum/web_vitals.json) — flat `column` + `aggregationFunction`.
 *
 * Reading only one of them is how the first cut produced "_timestamp by Cost"
 * for a sum(_timestamp): `aggregationFunction` was undefined on a builder
 * field, so every measure silently degraded to its bare field name.
 */
interface PanelFieldArg {
  type?: string;
  value?: { field?: string } | null;
}

interface PanelField {
  label?: string;
  alias?: string;
  /** LEGACY shape. */
  column?: string;
  /** LEGACY shape. */
  aggregationFunction?: string | null;
  /** BUILDER shape. */
  functionName?: string | null;
  /** BUILDER shape. `false` marks the field AS the time column (see isTimeColumn). */
  treatAsNonTimestamp?: boolean;
  /** BUILDER shape. */
  args?: PanelFieldArg[];
}

/** Chart types that carry no field config at all — nothing to derive a name from. */
const FIELDLESS_CHART_TYPES = ["markdown", "html", "custom_chart"];

/** Time bucketing is HOW a chart is drawn, not WHAT it measures. */
const TIME_AGGREGATIONS = ["histogram", "date_bin"];

/**
 * The time column is deployment-configurable (`zoConfig.timestamp_column`) —
 * `_timestamp` is only its default. usePanelFields already compares against the
 * configured value, so this must too; hardcoding `_timestamp` would silently
 * mis-name every panel on a deployment that renames it.
 */
export const DEFAULT_TIMESTAMP_COLUMN = "_timestamp";

export interface PanelAutoNameOptions {
  /** From `store.state.zoConfig.timestamp_column`. */
  timestampColumn?: string;
}

const aggregationOf = (field: PanelField | null | undefined): string | null =>
  field?.functionName ?? field?.aggregationFunction ?? null;

/** The underlying column, from whichever of the two shapes this field uses. */
const columnOf = (field: PanelField | null | undefined): string => {
  const fromArgs = field?.args?.find((arg) => arg?.type === "field")?.value?.field;
  return (fromArgs || field?.column || field?.alias || "").trim();
};

/**
 * How to refer to a field in prose. The builder's `label` is the humanised name
 * the dashboard already shows on axes and legends ("Cost"), so it reads best;
 * the raw column is the fallback. Generated aliases (x_axis_1) are never a name
 * a human would recognise, so they lose to the column.
 */
const fieldName = (field: PanelField | null | undefined): string => {
  const label = (field?.label || "").trim();
  if (label) return label;
  return columnOf(field);
};

/**
 * True when this field IS the time column. Builder fields record that decision
 * at add-time as `treatAsNonTimestamp: false`, which is authoritative even if
 * the deployment's configured column changes later; otherwise fall back to
 * comparing the column against the configured name.
 */
const isTimeColumn = (field: PanelField | null | undefined, timestampColumn: string): boolean => {
  if (field?.treatAsNonTimestamp === false) return true;
  return columnOf(field) === timestampColumn;
};

/**
 * "Record count" for count(*)/count(<time column>); otherwise "Avg of Duration".
 * Capitalised per measure, not once over the whole name — otherwise a two-
 * measure panel reads "Sum of Cost, max of Calls", capitalised on the first
 * word only.
 */
const measureLabel = (field: PanelField, t: TranslateFn, timestampColumn: string): string => {
  const name = fieldName(field);
  if (!name) return "";
  const fn = aggregationOf(field);
  if (!fn || TIME_AGGREGATIONS.includes(fn)) return capitalize(name);
  if (fn === "count" && (columnOf(field) === "*" || isTimeColumn(field, timestampColumn)))
    return capitalize(t("dashboard.autoName.recordCount"));
  return capitalize(t("dashboard.autoName.measure", { fn, field: name }));
};

/**
 * Build a panel title from its configured measures and breakdown, e.g.
 * "Avg of duration by service" / "Record count" / "k8s_logs overview".
 * Returns "" when the panel has nothing worth describing yet.
 */
export function buildPanelAutoName(
  panelData: any,
  t: TranslateFn,
  options: PanelAutoNameOptions = {},
): string {
  const timestampColumn = options.timestampColumn || DEFAULT_TIMESTAMP_COLUMN;
  const data = panelData?.data;
  if (!data) return "";

  const queryIndex = panelData?.layout?.currentQueryIndex ?? 0;
  const query = data.queries?.[queryIndex];
  const stream = (query?.fields?.stream || "").trim();

  const streamFallback = () =>
    stream ? tidy(capitalize(t("dashboard.autoName.streamOverview", { stream }))) : "";

  if (FIELDLESS_CHART_TYPES.includes(data.type)) return streamFallback();

  // A hand-written query exposes only generated aliases (x_axis_1, y_axis_1);
  // naming a panel after those is worse than saying nothing about them.
  if (query?.customQuery) return streamFallback();

  const measures = (query?.fields?.y ?? [])
    .map((field: PanelField) => measureLabel(field, t, timestampColumn))
    .filter(Boolean);

  if (measures.length === 0) return streamFallback();

  // Name after the first couple of measures only — a short, readable name beats
  // a complete one. A trailing "+N more" count just reads as clutter, so extra
  // measures are dropped silently rather than tallied.
  const subject = measures.slice(0, MAX_MEASURES).join(", ");

  // Breakdown is the explicit "split by" axis; on charts without one, a
  // non-time X field plays the same role. The time bucket is excluded by both
  // its aggregation and its column, since an X field can carry the timestamp
  // with no histogram on it at all.
  const breakdown = fieldName(query?.fields?.breakdown?.[0]);
  const xDimension = (query?.fields?.x ?? []).find(
    (field: PanelField) =>
      !TIME_AGGREGATIONS.includes(aggregationOf(field) ?? "") &&
      !isTimeColumn(field, timestampColumn),
  );
  const dimension = breakdown || fieldName(xDimension);

  // "Count of Cost by Cost" is noise, not a name — a dimension that repeats the
  // measure adds nothing.
  const name =
    dimension && dimension !== subject
      ? t("dashboard.autoName.measureByDimension", { subject, dimension })
      : subject;

  return tidy(name);
}

// ── Alerts ─────────────────────────────────────────────────────────────────

// An alert name is an IDENTIFIER, not a sentence: the backend rejects
// `[:#?\s'"%&]` (RE_OFGA_UNSUPPORTED_NAME in src/common/utils/auth.rs, mirrored
// by AddAlert.schema's nameNoSpecialChars rule). So the alert templates join
// with underscores, comparison symbols are spelled out, and everything is run
// through `slugify` as a backstop — a generated name that the form would then
// reject as invalid is worse than no name at all.
const ALERT_NAME_UNSUPPORTED_CHARS = /[:#?\s'"%&]+/g;

/** Comparison symbols spelled out — `>=` is legal in a name but unreadable in one. */
const OPERATOR_WORDS: Record<string, string> = {
  "=": "eq",
  "==": "eq",
  "!=": "neq",
  "<>": "neq",
  ">": "gt",
  ">=": "gte",
  "<": "lt",
  "<=": "lte",
};

// Only the TRAILING underscore is trimmed: a leading one is meaningful here —
// OpenObserve's internal streams are named `_rundata`, `_rumdata`, and so on,
// so stripping it would rename the very streams most likely to be alerted on.
const slugify = (value: string): string =>
  value.replace(ALERT_NAME_UNSUPPORTED_CHARS, "_").replace(/_{2,}/g, "_").replace(/_+$/g, "");

const operatorWord = (operator: string): string => OPERATOR_WORDS[operator] ?? operator;

interface AlertCondition {
  column?: string;
  operator?: string;
  value?: unknown;
  conditions?: AlertCondition[];
}

/** First leaf condition of a (possibly nested) condition group. */
const firstLeafCondition = (group: AlertCondition | undefined): AlertCondition | null => {
  for (const node of group?.conditions ?? []) {
    if (Array.isArray(node?.conditions)) {
      const nested = firstLeafCondition(node);
      if (nested) return nested;
    } else if (node?.column) {
      return node;
    }
  }
  return null;
};

/**
 * Build an alert name from its stream and what it actually watches, e.g.
 * "anomaly_k8s_logs" / "k8s_logs_status_gte_500" / "k8s_logs_avg_latency".
 * Returns "" until a stream is chosen — before that there is nothing to name
 * the alert after.
 */
export function buildAlertAutoName(formData: any, t: TranslateFn): string {
  const stream = (formData?.stream_name || "").trim();
  if (!stream) return "";

  const name = (key: string, params: Record<string, unknown>) =>
    slugify(tidy(t(`alerts.autoName.${key}`, params)));

  const mode = String(formData?.is_real_time ?? "false");
  if (mode === "anomaly") return name("anomaly", { stream });
  if (mode === "true") return name("realTime", { stream });

  const queryCondition = formData?.query_condition ?? {};

  // SQL/PromQL alerts are defined by a query the name can't summarise; the
  // stream plus the alert's nature is the most it can honestly say.
  if (queryCondition.type === "sql" || queryCondition.type === "promql") {
    return name("queryAlert", { stream });
  }

  const aggregation = queryCondition.aggregation;
  const aggregationColumn = (aggregation?.having?.column || "").trim();
  if (aggregationColumn && aggregation?.function) {
    return name("aggregation", { stream, fn: aggregation.function, field: aggregationColumn });
  }

  const condition = firstLeafCondition(queryCondition.conditions);
  if (
    condition?.column &&
    condition.operator &&
    condition.value !== "" &&
    condition.value != null
  ) {
    return name("condition", {
      stream,
      column: condition.column,
      operator: operatorWord(condition.operator),
      value: String(condition.value),
    });
  }

  return name("streamAlert", { stream });
}

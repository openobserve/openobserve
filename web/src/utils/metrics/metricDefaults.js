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
 * Metrics Explorer rule sets.
 *
 * Rule set A (default function per metric) and rule set B (unit inference) live
 * together in this one dependency-free JavaScript module so they can be unit
 * tested in isolation and reused by the explorer grid, the function dialog and
 * the drill-in prefill.
 *
 * Nothing here may import from the app: no store, no Vue, no services. Every
 * export is a pure function of its arguments. The one exception is the
 * `PromqlStepId` enum below — the panel editor's PromQL builder owns that
 * vocabulary, and naming its operations by hand here would let the two drift
 * silently. It is a bare enum in a types module with no imports of its own.
 */

import { PromqlStepId } from "@/components/promql/types";

/**
 * Fallback scrape interval, in seconds, for when the org has not set one.
 *
 * The rate window is `max(step + scrape, 4 * scrape)`, so this number decides how
 * much smoothing a card gets. It is NOT ours to invent: the org already declares
 * it (`organizationSettings.scrape_interval`), the dashboards resolve
 * `$__rate_interval` against exactly that value, and a card that assumed
 * something else charted a metric with different smoothing than the panel you
 * land on when you click it — 4m on the card, 1m in the editor. Callers pass the
 * org's value in; this is only the floor for when it is missing, and it matches
 * the `?? 15` the panel substitution already falls back to (see
 * usePanelVariableSubstitution), so the two cannot disagree even then.
 */
export const DEFAULT_SCRAPE_INTERVAL_SECONDS = 15;

/** Upper bound on points requested per preview chart. */
export const MAX_DATA_POINTS = 300;

/**
 * Floor on the step, in seconds.
 *
 * A step finer than the scrape interval cannot reveal anything — it just asks
 * Prometheus to re-emit the same sample under several timestamps — so the floor
 * tracks the default scrape interval above.
 */
export const MIN_STEP_SECONDS = 15;

/**
 * Card kinds. A card kind — not the declared metric type — drives a card's
 * query, badge, type-filter bucket, variant list and telemetry.
 *
 * `expHistogramFallback` is an addition to the PRD's enumeration: an
 * ExponentialHistogram `_bucket` card needs a preview query (the count line)
 * but must expose only that one variant, so it can be neither `other` (no
 * query at all) nor `counterRate` (full counter variant list).
 */
export const CARD_KIND = {
  COUNTER_RATE: "counterRate",
  GAUGE: "gauge",
  CLASSIC_HISTOGRAM_BUCKETS: "classicHistogramBuckets",
  MEAN_PAIR: "meanPair",
  SUMMARY_QUANTILES: "summaryQuantiles",
  EXP_HISTOGRAM_FALLBACK: "expHistogramFallback",
  INFO: "info",
  TIMESTAMP: "timestamp",
  OTHER: "other",
};

/** Buckets the rail's type-filter checkboxes operate on. */
export const TYPE_FILTER_BUCKET = {
  [CARD_KIND.COUNTER_RATE]: "counter",
  [CARD_KIND.GAUGE]: "gauge",
  [CARD_KIND.CLASSIC_HISTOGRAM_BUCKETS]: "histogram",
  [CARD_KIND.EXP_HISTOGRAM_FALLBACK]: "histogram",
  [CARD_KIND.MEAN_PAIR]: "summary",
  [CARD_KIND.SUMMARY_QUANTILES]: "summary",
  [CARD_KIND.INFO]: "other",
  [CARD_KIND.TIMESTAMP]: "other",
  [CARD_KIND.OTHER]: "other",
};

/** OpenMetrics member suffixes that make a stream part of a family. */
export const FAMILY_SUFFIXES = [
  "total",
  "created",
  "bucket",
  "sum",
  "count",
  "gsum",
  "gcount",
  "info",
];

/**
 * Suffixes whose unit segment sits one position *before* the suffix.
 * `_count`/`_gcount` are deliberately absent: they count events, so
 * `foo_seconds_count` rates to count/sec, never s/s.
 */
const LOOKBACK_SUFFIXES = ["total", "sum", "bucket", "gsum"];

/* -------------------------------------------------------------------------- */
/* Rule set B — units                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Ordered lookup: the first rule whose `match` contains the segment wins.
 * Because segments are probed nearest-to-end first, "last matching segment
 * wins" falls out of the probe order rather than the table order.
 *
 * `rated` is the unit when the *query output* is a rate — i.e. the resolved
 * card kind is a counter — not when the query text merely contains `rate()`.
 */
export const UNIT_RULES = [
  { match: ["bytes"], unit: "bytes", rated: "bytes-per-sec" },
  // Rating a seconds-counter gives seconds per second: the units cancel, and
  // what is left is a dimensionless ratio (how much time is spent per unit of
  // wall-clock). There is no unit to print, so print none.
  { match: ["seconds"], unit: "seconds", rated: "none" },
  // Rating an ms-counter yields ms-per-second, numerically 1000x off from s/s.
  // Label it honestly rather than silently rescaling.
  { match: ["milliseconds", "ms"], unit: "milliseconds", rated: "ms-per-sec" },
  { match: ["microseconds", "us"], unit: "microseconds", rated: "us-per-sec" },
  { match: ["nanoseconds", "ns"], unit: "nanoseconds", rated: "ns-per-sec" },
  { match: ["bits"], unit: "bits", rated: "bits-per-sec" },
  { match: ["ratio"], unit: "percent-1", rated: "percent-1" },
  { match: ["percent"], unit: "percent", rated: "percent" },
  { match: ["celsius"], unit: "celsius", rated: "celsius" },
  { match: ["volts"], unit: "volts", rated: "volts" },
  { match: ["amperes"], unit: "amperes", rated: "amperes" },
  { match: ["joules"], unit: "joules", rated: "joules" },
  { match: ["watts"], unit: "watts", rated: "watts" },
  {
    match: ["requests", "errors", "packets", "spans", "ops", "reads", "writes"],
    unit: "short",
    rated: "count-per-sec",
  },
];

/** Fallback when no name segment matches. */
const DEFAULT_UNIT = { unit: "short", rated: "count-per-sec" };

/**
 * Normalizes a declared `metrics_meta.unit` (Prometheus `# UNIT` / OTLP UCUM)
 * onto a canonical unit id. Unrecognized values fall through to name inference.
 */
const DECLARED_UNIT_ALIASES = {
  s: "seconds",
  sec: "seconds",
  secs: "seconds",
  second: "seconds",
  seconds: "seconds",
  ms: "milliseconds",
  millisecond: "milliseconds",
  milliseconds: "milliseconds",
  us: "microseconds",
  µs: "microseconds",
  microsecond: "microseconds",
  microseconds: "microseconds",
  ns: "nanoseconds",
  nanosecond: "nanoseconds",
  nanoseconds: "nanoseconds",
  b: "bytes",
  by: "bytes", // OTLP / UCUM
  byte: "bytes",
  bytes: "bytes",
  bit: "bits",
  bits: "bits",
  1: "short",
  short: "short",
  count: "short",
  "%": "percent",
  percent: "percent",
  ratio: "percent-1",
  cel: "celsius",
  degc: "celsius",
  celsius: "celsius",
  v: "volts",
  volts: "volts",
  a: "amperes",
  amperes: "amperes",
  j: "joules",
  joules: "joules",
  w: "watts",
  watts: "watts",
};

/**
 * Rated mapping applied to an *observation* unit when the card kind is a
 * counter. Anything not listed rates to count/sec.
 */
const RATED_BY_OBSERVATION = {
  bytes: "bytes-per-sec",
  seconds: "none",
  milliseconds: "ms-per-sec",
  microseconds: "us-per-sec",
  nanoseconds: "ns-per-sec",
  bits: "bits-per-sec",
  short: "count-per-sec",
  none: "none",
  "percent-1": "percent-1",
  percent: "percent",
  celsius: "celsius",
  volts: "volts",
  amperes: "amperes",
  joules: "joules",
  watts: "watts",
};

/**
 * Canonical unit id -> OpenObserve panel unit. `unitCustom` is only meaningful
 * when `unit === "custom"`; see `getUnitOptions` in useColumnFormatting.ts for
 * the authoritative list of ids the formatter understands.
 */
const O2_UNIT_MAP = {
  seconds: { unit: "seconds", unitCustom: null },
  milliseconds: { unit: "milliseconds", unitCustom: null },
  microseconds: { unit: "microseconds", unitCustom: null },
  nanoseconds: { unit: "nanoseconds", unitCustom: null },
  bytes: { unit: "bytes", unitCustom: null },
  "bytes-per-sec": { unit: "bps", unitCustom: null },
  "count-per-sec": { unit: "custom", unitCustom: "c/s" },
  "ms-per-sec": { unit: "custom", unitCustom: "ms/s" },
  "us-per-sec": { unit: "custom", unitCustom: "µs/s" },
  "ns-per-sec": { unit: "custom", unitCustom: "ns/s" },
  bits: { unit: "custom", unitCustom: "bits" },
  "bits-per-sec": { unit: "custom", unitCustom: "bits/s" },
  "percent-1": { unit: "percent-1", unitCustom: null },
  percent: { unit: "percent", unitCustom: null },
  celsius: { unit: "custom", unitCustom: "°C" },
  volts: { unit: "custom", unitCustom: "V" },
  amperes: { unit: "custom", unitCustom: "A" },
  joules: { unit: "custom", unitCustom: "J" },
  watts: { unit: "custom", unitCustom: "W" },
  short: { unit: "numbers", unitCustom: null },
  none: { unit: "numbers", unitCustom: null },
};

/* -------------------------------------------------------------------------- */
/* Small helpers                                                              */
/* -------------------------------------------------------------------------- */

const lower = (v) => (typeof v === "string" ? v.trim().toLowerCase() : "");

const segmentsOf = (metricName) => lower(metricName).split("_").filter(Boolean);

/** The trailing OpenMetrics member suffix, or "" for a bare name. */
export function familySuffixOf(metricName) {
  const parts = segmentsOf(metricName);
  if (parts.length < 2) return "";
  const last = parts[parts.length - 1];
  if (!FAMILY_SUFFIXES.includes(last)) return "";
  return lower(metricName).endsWith(`_${last}`) ? last : "";
}

/**
 * The family base name: the metric name minus its OpenMetrics member suffix.
 * `foo_seconds_bucket` -> `foo_seconds`; a bare name is its own base.
 */
export function baseNameOf(metricName) {
  const suffix = familySuffixOf(metricName);
  if (!suffix) return metricName;
  return metricName.slice(0, metricName.length - (suffix.length + 1));
}

/**
 * `gaugehistogram` / `exponentialhistogram` are the only types whose presence
 * on *either* the member or the family changes the dispatch, so they win over a
 * generic type from the other source.
 */
function pickTypeEvidence(ownType, familyType) {
  const SPECIFIC = ["gaugehistogram", "exponentialhistogram"];
  if (SPECIFIC.includes(ownType)) return ownType;
  if (SPECIFIC.includes(familyType)) return familyType;
  return ownType || familyType;
}

/* -------------------------------------------------------------------------- */
/* Rule set A — type resolution (PRD 6.1)                                      */
/* -------------------------------------------------------------------------- */

/**
 * Resolves a stream to a card kind.
 *
 * Family suffixes dispatch on the *name*, not the declared type: OpenObserve
 * writes real metadata only to the base family stream, and its fallback coerces
 * `_bucket`/`_sum`/`_count` streams to `counter` (src/service/stream.rs:198).
 * Routing `X_sum` by that coerced type would yield `sum(rate(X_sum))` instead of
 * the mean pair. Declared type is decisive only for bare names.
 *
 * @param {string} metricName
 * @param {string|undefined} metricType from metrics_meta.metric_type
 * @param {{streamNames?: Set<string>, familyType?: string}} [ctx]
 * @returns {string} one of CARD_KIND
 */
export function resolveCardKind(metricName, metricType, ctx) {
  const own = lower(metricType);
  const fam = lower(ctx?.familyType);
  const suffix = familySuffixOf(metricName);
  const base = baseNameOf(metricName);

  switch (suffix) {
    case "bucket": {
      const evidence = pickTypeEvidence(own, fam);
      if (evidence === "gaugehistogram") return CARD_KIND.OTHER;
      if (evidence === "exponentialhistogram")
        return CARD_KIND.EXP_HISTOGRAM_FALLBACK;
      return CARD_KIND.CLASSIC_HISTOGRAM_BUCKETS;
    }

    case "sum": {
      // A `_sum` with a `_count` sibling is half of a summary/histogram mean.
      // An orphan `_sum` is usually monotonic; counter treatment is the best
      // available fallback and matches the backend's own coercion.
      const hasCount = ctx?.streamNames?.has(`${base}_count`);
      return hasCount ? CARD_KIND.MEAN_PAIR : CARD_KIND.COUNTER_RATE;
    }

    case "gsum":
    case "gcount":
      // GaugeHistogram members: gauge treatment, never rated. Unsupported in v1.
      return CARD_KIND.OTHER;

    case "created":
      return CARD_KIND.TIMESTAMP;

    case "count":
    case "total":
      // The fallback coercion only ever produces `counter`, so a declared
      // `gauge` here is real metadata and wins the contradiction.
      return own === "gauge" ? CARD_KIND.GAUGE : CARD_KIND.COUNTER_RATE;

    case "info":
      return CARD_KIND.INFO;

    default:
      if (own === "counter") return CARD_KIND.COUNTER_RATE;
      if (own === "summary") return CARD_KIND.SUMMARY_QUANTILES;
      // A bare name declared as a histogram is the *base* stream of a classic
      // histogram family: its records all live in X_bucket/X_sum/X_count, so it
      // holds no series of its own. Charting `avg()` over it yields a confident,
      // permanently-empty gauge card — worse than admitting we cannot chart it.
      // (Phantom suppression normally removes these before they ever reach a
      // card; this is the backstop for when it cannot.)
      if (
        own === "histogram" ||
        own === "exponentialhistogram" ||
        own === "gaugehistogram"
      ) {
        return CARD_KIND.OTHER;
      }
      return CARD_KIND.GAUGE;
  }
}

/* -------------------------------------------------------------------------- */
/* PromQL construction (PRD 7.4)                                               */
/* -------------------------------------------------------------------------- */

const LABEL_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const VALID_OPERATORS = ["=", "!=", "=~", "!~"];

/** Escapes a PromQL double-quoted string literal. */
function escapePromqlString(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

/**
 * Builds a PromQL selector. This is the ONLY place a metric name or a filter
 * value is embedded into a query.
 *
 * Always emits the `{__name__="…"}` form rather than interpolating the metric
 * name as a bare identifier: OpenObserve stream-name normalization strips only
 * `[^a-zA-Z0-9_:]`, so a name may begin with a digit, which is not a valid
 * PromQL identifier. The engine resolves the name from the `__name__` matcher
 * (src/promql/src/engine.rs:357).
 *
 * Matchers are emitted in deterministic (sorted) order so an equal filter set
 * always produces a byte-identical query — that is what makes the preview
 * cache key stable.
 *
 * @param {string} metricName
 * @param {Array<{label: string, value: string, operator?: string}>|Record<string,string>} [filters]
 * @param {Record<string,string>} [extraMatchers] appended verbatim as `=` matchers
 * @returns {string} e.g. `{__name__="http_requests_total",job="api"}`
 */
export function buildSelector(metricName, filters, extraMatchers) {
  if (!metricName) throw new Error("buildSelector: metricName is required");

  const matchers = normalizeMatchers(filters, extraMatchers).map(
    (f) => `${f.label}${f.operator}"${escapePromqlString(f.value)}"`,
  );

  return `{__name__="${escapePromqlString(metricName)}"${
    matchers.length ? `,${matchers.join(",")}` : ""
  }}`;
}

/**
 * Validates a filter list and puts it in canonical order.
 *
 * The single place matchers are vetted and ordered, because two renderers
 * consume them: `buildSelector` writes the `{__name__="x",…}` form the preview
 * queries use, and `builderLabelsOf` writes the `{label, op, value}` records the
 * panel editor's PromQL builder stores. Sharing this step is what keeps the two
 * from drifting apart.
 *
 * @param {Array<{label: string, value: string, operator?: string}>|Record<string,string>} [filters]
 * @param {Record<string,string>} [extraMatchers] appended as `=` matchers
 * @returns {Array<{label: string, operator: string, value: string}>}
 */
function normalizeMatchers(filters, extraMatchers) {
  const list = [];
  if (Array.isArray(filters)) {
    list.push(...filters);
  } else if (filters && typeof filters === "object") {
    for (const [label, value] of Object.entries(filters)) {
      list.push({ label, value });
    }
  }
  if (extraMatchers && typeof extraMatchers === "object") {
    for (const [label, value] of Object.entries(extraMatchers)) {
      list.push({ label, value });
    }
  }

  return list
    .filter((f) => f && f.label)
    .map((f) => {
      const label = String(f.label);
      if (!LABEL_NAME_RE.test(label)) {
        // Rejected here rather than silently dropped: a dropped matcher would
        // render unfiltered data with no indication.
        throw new Error(`buildSelector: invalid label name "${label}"`);
      }
      const operator = f.operator ?? "=";
      if (!VALID_OPERATORS.includes(operator)) {
        throw new Error(`buildSelector: invalid operator "${operator}"`);
      }
      return { label, operator, value: String(f.value ?? "") };
    })
    .sort((a, b) =>
      a.label === b.label
        ? a.value.localeCompare(b.value)
        : a.label.localeCompare(b.label),
    );
}

/**
 * The same matchers as `buildSelector`, in the shape the panel editor's PromQL
 * builder persists (`fields.promql_labels`).
 *
 * Values are handed over RAW: the query modeller escapes them itself when it
 * renders, so escaping here would double it.
 *
 * @returns {Array<{label: string, op: string, value: string}>}
 */
export function builderLabelsOf(filters) {
  return normalizeMatchers(filters).map(({ label, operator, value }) => ({
    label,
    op: operator,
    value,
  }));
}

/**
 * Card kinds whose default query does NOT wrap the selector in `rate()`.
 *
 * Only these can carry the extreme-value guard: `rate()` needs a range-vector
 * SELECTOR, so `rate((a and a > -Inf)[5m])` is not valid PromQL.
 */
const RATE_FREE_KINDS = [
  CARD_KIND.GAUGE,
  CARD_KIND.SUMMARY_QUANTILES,
  CARD_KIND.TIMESTAMP,
];

/**
 * Does this card kind's default query wrap its selector in `rate()`?
 *
 * The counter, classic-histogram, mean-pair and exponential-histogram kinds all
 * do. It matters because an empty result means something DIFFERENT for them: see
 * `buildPresenceQuery`.
 *
 * @param {string} cardKind one of CARD_KIND
 * @returns {boolean}
 */
export function isRateBasedKind(cardKind) {
  return !RATE_FREE_KINDS.includes(cardKind);
}

/**
 * "Does this stream carry ANY sample in the window?" — the question a rate-based
 * card cannot answer about itself.
 *
 * `rate()` needs TWO samples inside its window to compute a delta. One sample
 * yields nothing, and so does a scrape interval longer than the window. So a
 * rate-based card can come back completely empty while its metric is sitting
 * right there in the selected range, fully ingested — and treating that empty
 * result as "this metric has no data" hides the card behind the "With data"
 * filter, whose contract is *"only metrics with data in the selected time
 * range"*. The metric then vanishes from the product: a Prometheus histogram is
 * hit hardest, because its base stream is a metadata-only phantom that carries
 * no series of its own (see `isPhantomBase`), so once `X_bucket`, `X_sum` and
 * `X_count` are each hidden as "empty", the whole histogram renders NO card at
 * all and its data is unreachable from the UI.
 *
 * `count()` rather than the bare selector: presence is a yes/no question, and a
 * raw selector on a high-cardinality metric would drag every series over the
 * wire to answer it. `count()` collapses that to one number per step and is
 * empty only when the window truly holds nothing.
 *
 * @param {string} streamName
 * @param {Array<{label: string, value: string, operator?: string}>} [filters]
 * @returns {string} PromQL
 */
export function buildPresenceQuery(streamName, filters) {
  return `count(${buildSelector(streamName, filters)})`;
}

/**
 * Guards a selector against NaN samples.
 *
 * A float64 sample can be NaN, and NaN propagates: one NaN anywhere in an
 * aggregation's input makes the whole output NaN, so `avg(metric)` charts as a
 * blank card even when almost every series behind it is fine.
 *
 * `x and x > -Inf` drops those samples before they reach the aggregation. It
 * works because every comparison against NaN is false — including `> -Inf`,
 * which every real float, however large or small, satisfies. So the filter
 * passes all genuine samples and only NaN fails it.
 *
 * Applied only as a RETRY, after a plain first query has actually come back
 * all-NaN. Doing it up front would make every query needlessly complex.
 */
function withNanGuard(selector) {
  return `(${selector} and ${selector} > -Inf)`;
}

/* -------------------------------------------------------------------------- */
/* Rate window (PRD 6.4)                                                       */
/* -------------------------------------------------------------------------- */

/** Serializes whole seconds as a PromQL duration, e.g. 3660 -> "1h1m". */
export function formatPromDuration(totalSeconds) {
  let s = Math.max(1, Math.ceil(Number(totalSeconds) || 0));
  const parts = [];
  const units = [
    ["d", 86400],
    ["h", 3600],
    ["m", 60],
    ["s", 1],
  ];
  for (const [suffix, size] of units) {
    const n = Math.floor(s / size);
    if (n > 0) {
      parts.push(`${n}${suffix}`);
      s -= n * size;
    }
  }
  return parts.join("") || "1s";
}

/**
 * Step size for a query_range, in seconds.
 * @param {number} rangeSeconds end - start
 * @param {number} [maxDataPoints] roughly the chart's pixel width, capped
 */
export function computeStepSeconds(
  rangeSeconds,
  maxDataPoints = MAX_DATA_POINTS,
) {
  const points = Math.min(
    MAX_DATA_POINTS,
    Math.max(1, Math.round(Number(maxDataPoints) || MAX_DATA_POINTS)),
  );
  const range = Math.max(0, Number(rangeSeconds) || 0);
  return Math.max(MIN_STEP_SECONDS, Math.ceil(range / points));
}

/**
 * The rate window `[W]`.
 *
 * `W = max(4 * scrape, step + scrape)`.
 *
 * Both terms are floors, and each covers a different failure:
 *
 *   - `step + scrape` keeps consecutive windows touching. A window shorter than
 *     the step would leave gaps between the points we ask for, so samples
 *     falling in a gap would be silently dropped from the chart.
 *   - `4 * scrape` guarantees the window can actually hold the two samples
 *     `rate()` needs to compute a delta. Against a slowly-scraped target a
 *     window sized only by the step often contains one sample, or none, and
 *     `rate()` yields nothing — the panel renders empty.
 *
 * This is deliberately the same window OpenObserve's panels resolve
 * `$__rate_interval` to (see usePanelVariableSubstitution), so a card and the
 * panel you land on when you click it smooth the metric identically instead of
 * disagreeing — 4m on the card, 1m in the editor.
 *
 * @returns {string} a PromQL duration, e.g. "4m"
 */
export function computeRateWindow(
  rangeSeconds,
  maxDataPoints = MAX_DATA_POINTS,
  scrapeIntervalSeconds = DEFAULT_SCRAPE_INTERVAL_SECONDS,
) {
  const step = computeStepSeconds(rangeSeconds, maxDataPoints);
  const w = Math.max(4 * scrapeIntervalSeconds, step + scrapeIntervalSeconds);
  return formatPromDuration(w);
}

/**
 * The rate window to hand to a PANEL, as opposed to one we execute ourselves.
 *
 * A card preview needs a concrete window: the explorer calls the search API
 * directly and nothing substitutes variables for it, so `computeRateWindow`
 * resolves one from the range and the card's point count.
 *
 * A panel is different. The dashboards already define `$__rate_interval`
 * (usePanelVariableSubstitution: `max(interval + scrape, 4 * scrape)`, where
 * `interval` is the range over the PANEL's pixel width), every PromQL query goes
 * through the substitution on its way to the backend, and the PromQL builder's
 * own `rate()` operation defaults to exactly this token. Baking a literal `[4m]`
 * into a seeded panel meant the window stopped tracking the range the moment the
 * user changed it — a rate over a 4-minute window sampled every 30 minutes on a
 * 7-day view — and it disagreed with what the builder produces when the same
 * user adds `rate()` by hand. Hand over the variable and let the panel resolve
 * it, which is what a panel is for.
 */
export const PANEL_RATE_WINDOW = "$__rate_interval";

/** The window used when a caller supplies no time context. */
const DEFAULT_RATE_WINDOW = formatPromDuration(
  4 * DEFAULT_SCRAPE_INTERVAL_SECONDS,
);

/* -------------------------------------------------------------------------- */
/* Rule set B — unit inference (PRD 7.0 - 7.3)                                 */
/* -------------------------------------------------------------------------- */

function lookupSegment(segment) {
  if (!segment) return null;
  for (const rule of UNIT_RULES) {
    if (rule.match.includes(segment)) return rule;
  }
  return null;
}

/**
 * Name-based unit inference.
 *
 * Probes the last two underscore segments, nearest-to-end first. `_total`,
 * `_sum`, `_bucket` and `_gsum` take their unit segment from the one *before*
 * the suffix; `_count`/`_gcount` deliberately do not look back at all.
 *
 * @param {string} metricName
 * @param {{rated?: boolean}} [opts]
 * @returns {string} canonical unit id
 */
export function inferUnit(metricName, opts) {
  const rated = !!opts?.rated;
  const parts = segmentsOf(metricName);
  const last = parts[parts.length - 1];

  let candidates;
  if (last === "count" || last === "gcount") {
    candidates = []; // counts events, never the observed quantity
  } else if (LOOKBACK_SUFFIXES.includes(last)) {
    candidates = [parts[parts.length - 2]];
  } else {
    candidates = [parts[parts.length - 1], parts[parts.length - 2]];
  }

  for (const segment of candidates) {
    const rule = lookupSegment(segment);
    if (rule) return rated ? rule.rated : rule.unit;
  }
  return rated ? DEFAULT_UNIT.rated : DEFAULT_UNIT.unit;
}

/** Normalizes a declared unit onto a canonical id, or null if unrecognized. */
export function normalizeDeclaredUnit(declaredUnit) {
  const raw = typeof declaredUnit === "string" ? declaredUnit.trim() : "";
  if (!raw) return null;
  return DECLARED_UNIT_ALIASES[raw.toLowerCase()] ?? null;
}

/** Applies the rated mapping to an observation unit. */
function rateUnit(observationUnit) {
  return RATED_BY_OBSERVATION[observationUnit] ?? "count-per-sec";
}

/** Canonical unit id -> `{ unit, unitCustom }` for a panel's config. */
export function toO2Unit(canonicalUnit) {
  return O2_UNIT_MAP[canonicalUnit] ?? { unit: "numbers", unitCustom: null };
}

/**
 * Resolves the unit for a card, honouring the PRD 7.0 precedence:
 * declared unit (normalized) beats name inference; a counter's observation unit
 * is then converted through the rated mapping.
 */
function resolveUnit(metricName, cardKind, declaredUnit) {
  // `_created` is seconds-since-epoch by definition, whatever anyone declared.
  if (cardKind === CARD_KIND.TIMESTAMP) return "seconds";
  if (cardKind === CARD_KIND.INFO) return "short";

  const suffix = familySuffixOf(metricName);
  const rated =
    cardKind === CARD_KIND.COUNTER_RATE ||
    cardKind === CARD_KIND.EXP_HISTOGRAM_FALLBACK;

  // Count members never inherit a declared/family observation unit: they count
  // events, so a family-declared `seconds` on X_count must still yield count/s.
  const countMember = suffix === "count" || suffix === "gcount";
  if (countMember) {
    return rated ? "count-per-sec" : "short";
  }

  const declared = normalizeDeclaredUnit(declaredUnit);
  if (declared) return rated ? rateUnit(declared) : declared;

  return inferUnit(metricName, { rated });
}

/* -------------------------------------------------------------------------- */
/* Rule set A — query templates and variants (PRD 6.2, 6.3)                    */
/* -------------------------------------------------------------------------- */

/**
 * One query of a variant.
 *
 * `expr` is what the card previews with. `builder` is the same query expressed
 * as panel-editor builder state — `{metric, labels, operations}` — so that
 * Select can land the user in Builder mode rather than Custom. It is omitted
 * when the query cannot be expressed in the builder's vocabulary (see
 * `buildVariants`), and the handoff falls back to Custom for the whole variant.
 *
 * The two are NOT the same string: `expr` uses the `{__name__="x"}` selector
 * form (digit-leading stream names are legal in OpenObserve but not as PromQL
 * identifiers), while the builder renders `x{}`. They must stay semantically
 * identical — `metricDefaults.builder.spec.ts` renders every builder descriptor
 * through the real query modeller and diffs it against `expr`.
 */
const q = (expr, legendTemplate, builder) => {
  const out = { expr };
  if (legendTemplate !== undefined) out.legendTemplate = legendTemplate;
  if (builder !== undefined) out.builder = builder;
  return out;
};

/* The builder's operation vocabulary. `operations[0]` is the innermost call. */
const RATE = (window) => ({ id: PromqlStepId.Rate, params: [window] });
const INCREASE = (window) => ({ id: PromqlStepId.Increase, params: [window] });
/** Aggregations take their `by (...)` labels as the LAST param. */
const AGG = (id, byLabels = []) => ({ id, params: [[...byLabels]] });
const TOPK = (k, byLabels = []) => ({
  id: PromqlStepId.TopK,
  params: [k, [...byLabels]],
});
const QUANTILE = (ratio, byLabels = []) => ({
  id: PromqlStepId.Quantile,
  params: [ratio, [...byLabels]],
});
const HISTOGRAM_QUANTILE = (ratio) => ({
  id: PromqlStepId.HistogramQuantile,
  params: [ratio],
});

const DEFAULT_PERCENTILES = [50, 90, 99];
const GAUGE_PERCENTILES = [50, 75, 90, 95, 99];

/**
 * Internal labels a top-k breakdown must never group by.
 */
function resolveTopkLabel(labels) {
  if (!Array.isArray(labels) || labels.length === 0) return null;
  const excluded = new Set(["le", "quantile"]);
  const eligible = labels
    .filter(
      (l) =>
        typeof l === "string" &&
        !l.startsWith("__") &&
        !l.startsWith("_") &&
        !excluded.has(l),
    )
    .sort();
  if (eligible.includes("instance")) return "instance";
  return eligible[0] ?? null;
}

/**
 * Builds the ordered variant list for a card kind. Index 0 is the default.
 * Variants are card-kind aware: info/`_created`/GaugeHistogram cards get none,
 * and an ExponentialHistogram fallback gets only its count line.
 */
function buildVariants(cardKind, ctx) {
  const {
    metricName,
    base,
    sel,
    baseSel,
    countSel,
    w,
    labels,
    unit,
    builderLabels,
    builderSafe,
  } = ctx;

  /**
   * Builder state for one query, or `undefined` when this variant cannot be
   * expressed in the builder's vocabulary — which is the case whenever the
   * NaN guard has rewritten the selector into `(x and x > -Inf)`.
   */
  const b = (metric, operations) =>
    builderSafe ? { metric, labels: builderLabels, operations } : undefined;

  switch (cardKind) {
    case CARD_KIND.GAUGE:
      return [
        {
          id: "avg",
          footerLabel: "avg",
          label: "Average",
          queries: [
            q(`avg(${sel})`, metricName, b(metricName, [AGG(PromqlStepId.Avg)])),
          ],
          chartType: "line",
        },
        {
          id: "sum",
          footerLabel: "sum",
          label: "Sum",
          queries: [
            q(`sum(${sel})`, metricName, b(metricName, [AGG(PromqlStepId.Sum)])),
          ],
          chartType: "line",
        },
        {
          id: "minmax",
          footerLabel: "min / max",
          label: "Min / Max",
          queries: [
            q(`min(${sel})`, "min", b(metricName, [AGG(PromqlStepId.Min)])),
            q(`max(${sel})`, "max", b(metricName, [AGG(PromqlStepId.Max)])),
          ],
          chartType: "line",
        },
        {
          id: "stddev",
          footerLabel: "stddev",
          label: "Std dev",
          queries: [
            q(
              `stddev(${sel})`,
              metricName,
              b(metricName, [AGG(PromqlStepId.Stddev)]),
            ),
          ],
          chartType: "line",
        },
        {
          id: "percentiles",
          footerLabel: "percentiles",
          label: "Percentiles",
          // A query per OFFERED percentile, not per default-checked one. The
          // dialog builds its checkboxes from `availablePercentiles`, and
          // `resolveVariant` narrows these queries down to the checked set — so
          // any percentile without a query here is a checkbox that silently does
          // nothing (or worse, empties the subset and falls back to all of them).
          queries: GAUGE_PERCENTILES.map((p) =>
            q(
              `quantile(${p / 100}, ${sel})`,
              `p${p}`,
              b(metricName, [QUANTILE(p / 100)]),
            ),
          ),
          chartType: "line",
          // Checked by default; the other offered percentiles start unchecked.
          options: { percentiles: [...DEFAULT_PERCENTILES] },
          availablePercentiles: [...GAUGE_PERCENTILES],
        },
      ];

    case CARD_KIND.COUNTER_RATE: {
      const variants = [
        {
          id: "rate-sum",
          footerLabel: "sum(rate)",
          label: "Rate (sum)",
          queries: [
            q(
              `sum(rate(${sel}[${w}]))`,
              metricName,
              b(metricName, [RATE(w), AGG(PromqlStepId.Sum)]),
            ),
          ],
          chartType: "line",
        },
        {
          id: "rate-avg",
          footerLabel: "avg(rate)",
          label: "Rate (avg)",
          queries: [
            q(
              `avg(rate(${sel}[${w}]))`,
              metricName,
              b(metricName, [RATE(w), AGG(PromqlStepId.Avg)]),
            ),
          ],
          chartType: "line",
        },
        {
          id: "increase",
          footerLabel: "sum(increase)",
          label: "Increase",
          queries: [
            q(
              `sum(increase(${sel}[${w}]))`,
              metricName,
              b(metricName, [INCREASE(w), AGG(PromqlStepId.Sum)]),
            ),
          ],
          chartType: "line",
          // increase() over a window is a count, not a rate.
          unit: unit === "count-per-sec" ? "short" : undefined,
        },
      ];
      const topkLabel = resolveTopkLabel(labels);
      if (topkLabel) {
        variants.push({
          id: "topk",
          footerLabel: `topk(5) by ${topkLabel}`,
          label: `Top 5 by ${topkLabel}`,
          queries: [
            q(
              `topk(5, sum by (${topkLabel}) (rate(${sel}[${w}])))`,
              `{${topkLabel}}`,
              b(metricName, [
                RATE(w),
                AGG(PromqlStepId.Sum, [topkLabel]),
                TOPK(5),
              ]),
            ),
          ],
          chartType: "line",
        });
      }
      return variants;
    }

    case CARD_KIND.CLASSIC_HISTOGRAM_BUCKETS:
      return [
        {
          id: "heatmap",
          footerLabel: "heatmap",
          label: "Heatmap",
          queries: [
            q(
              `sum by (le) (rate(${sel}[${w}]))`,
              "{le}",
              b(metricName, [RATE(w), AGG(PromqlStepId.Sum, ["le"])]),
            ),
          ],
          chartType: "heatmap",
          // A histogram heatmap carries TWO units, and this is the one for the
          // CELLS: `rate(X_bucket)` is observations per second, whatever the
          // observation happens to be. The `le` axis keeps the observation unit
          // and rides separately on `bucketUnit`.
          //
          // Without this the cells inherited the card's unit — so every cell of a
          // `*_seconds_bucket` heatmap was formatted as a duration ("0.42 s") when
          // it is a rate ("0.42 c/s"). Wrong by a dimension, on the chart's whole
          // colour scale and every tooltip.
          unit: "count-per-sec",
        },
        {
          id: "percentiles",
          footerLabel: "percentiles",
          label: "Percentiles",
          queries: DEFAULT_PERCENTILES.map((p) =>
            q(
              `histogram_quantile(${p / 100}, sum by (le) (rate(${sel}[${w}])))`,
              `p${p}`,
              b(metricName, [
                RATE(w),
                AGG(PromqlStepId.Sum, ["le"]),
                HISTOGRAM_QUANTILE(p / 100),
              ]),
            ),
          ),
          chartType: "line",
          options: { percentiles: [...DEFAULT_PERCENTILES] },
          availablePercentiles: [...DEFAULT_PERCENTILES],
        },
        {
          id: "count-rate",
          footerLabel: "sum(rate) of count",
          label: "Rate of count",
          queries: [
            q(
              `sum(rate(${countSel}[${w}]))`,
              `${base}_count`,
              // Reads the sibling count stream, not the card's own bucket
              // stream — so the editor must land on that stream too.
              b(`${base}_count`, [RATE(w), AGG(PromqlStepId.Sum)]),
            ),
          ],
          chartType: "line",
          unit: "count-per-sec",
        },
      ];

    case CARD_KIND.EXP_HISTOGRAM_FALLBACK:
      // The flattened exponential-histogram buckets are currently corrupt
      // (XOR bucket bounds, non-cumulative counts, no +Inf bucket), so the
      // heatmap and percentile paths must stay closed here — including in the
      // function dialog.
      return [
        {
          id: "count-rate",
          footerLabel: "sum(rate) of count",
          label: "Rate of count",
          queries: [
            q(
              `sum(rate(${countSel}[${w}]))`,
              `${base}_count`,
              // Reads the sibling count stream, not the card's own stream — so
              // the editor must land on that stream too.
              b(`${base}_count`, [RATE(w), AGG(PromqlStepId.Sum)]),
            ),
          ],
          chartType: "line",
          unit: "count-per-sec",
        },
      ];

    case CARD_KIND.MEAN_PAIR:
      return [
        {
          id: "mean",
          footerLabel: "avg",
          label: "Average",
          queries: [
            q(
              `sum(rate(${sel}[${w}])) / sum(rate(${countSel}[${w}]))`,
              metricName,
              // No builder state: this divides one vector by another, and the
              // builder's binary ops only take a scalar operand. Selecting this
              // card hands off in Custom mode.
              undefined,
            ),
          ],
          chartType: "line",
        },
        {
          id: "count-rate",
          footerLabel: "sum(rate) of count",
          label: "Rate of count",
          queries: [
            q(
              `sum(rate(${countSel}[${w}]))`,
              `${base}_count`,
              // Reads the sibling count stream, not the card's own stream — so
              // the editor must land on that stream too.
              b(`${base}_count`, [RATE(w), AGG(PromqlStepId.Sum)]),
            ),
          ],
          chartType: "line",
          unit: "count-per-sec",
        },
      ];

    case CARD_KIND.SUMMARY_QUANTILES:
      return [
        {
          id: "avg-quantiles",
          footerLabel: "avg by quantile",
          // Averaging pre-computed quantiles across targets is NOT statistically
          // mergeable. The copy says "avg of reported quantiles" and the pXX
          // vocabulary is deliberately withheld — that is reserved for
          // histogram_quantile.
          label: "Avg of reported quantiles",
          queries: [
            q(
              `avg by (quantile) (${sel})`,
              "{quantile}",
              b(metricName, [AGG(PromqlStepId.Avg, ["quantile"])]),
            ),
          ],
          chartType: "line",
        },
        {
          id: "raw-quantiles",
          footerLabel: "raw quantiles",
          label: "Reported quantiles (raw)",
          // {quantile} alone would duplicate legend names across targets.
          queries: [q(sel, "{instance} {quantile}", b(metricName, []))],
          chartType: "line",
        },
      ];

    case CARD_KIND.OTHER: {
      const suffix = familySuffixOf(metricName);

      // GaugeHistogram `_bucket`: a handoff-only bucket line. Buckets are
      // snapshots, so no rate().
      if (suffix === "bucket") {
        return [
          {
            id: "buckets",
            footerLabel: "buckets",
            label: "Buckets",
            queries: [
              q(
                `sum by (le) (${sel})`,
                "{le}",
                b(metricName, [AGG(PromqlStepId.Sum, ["le"])]),
              ),
            ],
            chartType: "line",
            previewable: false,
          },
        ];
      }

      // GaugeHistogram `_gsum`/`_gcount`: plain gauge treatment, never rated.
      if (suffix === "gsum" || suffix === "gcount") {
        return [
          {
            id: "avg",
            footerLabel: "avg",
            label: "Average",
            queries: [
              q(
                `avg(${sel})`,
                metricName,
                b(metricName, [AGG(PromqlStepId.Avg)]),
              ),
            ],
            chartType: "line",
          },
        ];
      }

      // A histogram-family base stream. Its series live in the derived streams,
      // so there is nothing here to chart or hand off.
      return [];
    }

    case CARD_KIND.TIMESTAMP:
      return [
        {
          id: "avg",
          footerLabel: "avg",
          label: "Average",
          queries: [
            q(`avg(${sel})`, metricName, b(metricName, [AGG(PromqlStepId.Avg)])),
          ],
          chartType: "line",
        },
      ];

    case CARD_KIND.INFO:
      return [
        {
          id: "count",
          footerLabel: "count",
          label: "Count of series",
          // An info metric carries its payload in its LABELS; the value is
          // always 1. Charting the value would therefore draw a flat line at 1
          // for every such metric — true, and useless. What carries information
          // is how MANY of them there are: `count(kube_pod_container_info)` is
          // the number of containers, and its shape over time is what you want.
          //
          // This card previously had no preview at all, which rendered as a grey
          // box: every `*_info` metric in a Kubernetes org (`go_info`,
          // `kube_node_info`, `coredns_build_info`, …) looked like a chart that
          // had failed to load.
          queries: [
            q(
              `count(${sel})`,
              "count",
              b(metricName, [AGG(PromqlStepId.Count)]),
            ),
          ],
          chartType: "line",
        },
        {
          id: "series",
          footerLabel: "series",
          label: "Series (labels)",
          // The label sets themselves. Not previewable: a card renders through
          // ECharts, which does not draw a table at all — and there is no room
          // for one at 120px anyway. Reachable from the ⚙ dialog, and the
          // drill-in then opens it in the editor, where there IS room.
          queries: [q(sel, "", b(metricName, []))],
          chartType: "table",
          previewable: false,
        },
      ];

    default:
      return [];
  }
}

/** Footer label shown on the card — explorer UI only, never written to a panel. */
const FOOTER_LABEL = {
  [CARD_KIND.COUNTER_RATE]: "sum(rate)",
  [CARD_KIND.EXP_HISTOGRAM_FALLBACK]: "sum(rate)",
  [CARD_KIND.GAUGE]: "avg",
  [CARD_KIND.CLASSIC_HISTOGRAM_BUCKETS]: "heatmap",
  [CARD_KIND.MEAN_PAIR]: "avg",
  [CARD_KIND.SUMMARY_QUANTILES]: "avg",
  [CARD_KIND.TIMESTAMP]: "avg",
  [CARD_KIND.INFO]: "",
  [CARD_KIND.OTHER]: "",
};

/**
 * The whole rule set, resolved for one metric stream.
 *
 * Queries come back fully resolved: `{F}` and `[W]` are substituted here from
 * `ctx.filters` / `ctx.rateWindow`, so the returned strings are exactly what
 * gets executed and cached. Callers never concatenate PromQL themselves.
 *
 * @param {string} metricName          e.g. "apiserver_request_duration_seconds_bucket"
 * @param {string|undefined} metricType   metrics_meta.metric_type (case-insensitive)
 * @param {string|undefined} declaredUnit metrics_meta.unit (may be "")
 * @param {{
 *   streamNames?: Set<string>,   // feeds the `_sum` sibling check
 *   familyType?: string,         // the family's declared type (5.1 family model)
 *   filters?: Array<{label: string, value: string, operator?: string}>,
 *   rateWindow?: string,         // PromQL duration; defaults to the 4m floor
 *   labels?: string[],           // the stream's label names, when known
 *   applyNanGuard?: boolean, // retry mode: guard the selector against NaN samples
 * }} [ctx]
 */
export function getMetricDefaults(metricName, metricType, declaredUnit, ctx) {
  const cardKind = resolveCardKind(metricName, metricType, ctx);
  const base = baseNameOf(metricName);
  const filters = ctx?.filters ?? [];
  const w = ctx?.rateWindow || DEFAULT_RATE_WINDOW;

  const supportsNanGuard = RATE_FREE_KINDS.includes(cardKind);
  const guarded = !!ctx?.applyNanGuard && supportsNanGuard;
  const guard = guarded ? withNanGuard : (selector) => selector;

  const sel = guard(buildSelector(metricName, filters));
  const baseSel = guard(buildSelector(base, filters));
  const countSel = buildSelector(`${base}_count`, filters);

  const unit = resolveUnit(metricName, cardKind, declaredUnit);
  const o2 = toO2Unit(unit);

  const variants = buildVariants(cardKind, {
    metricName,
    base,
    sel,
    baseSel,
    countSel,
    w,
    labels: ctx?.labels,
    unit,
    builderLabels: builderLabelsOf(filters),
    // The NaN guard rewrites the selector into `(x and x > -Inf)`, which the
    // builder cannot express — so a guarded re-query carries no builder state
    // and would hand off in Custom mode. In practice the handoff always asks
    // for the unguarded variant; this is the belt to that braces.
    builderSafe: !guarded,
  });

  const defaultVariant = variants[0] ?? null;
  // `_gsum`/`_gcount` are the one OTHER shape we can still chart honestly (as a
  // gauge). Everything else that lands in OTHER — a GaugeHistogram `_bucket`, a
  // histogram-family base stream — gets the placeholder instead of a chart.
  const otherSuffix = familySuffixOf(metricName);
  const unsupported =
    cardKind === CARD_KIND.OTHER &&
    otherSuffix !== "gsum" &&
    otherSuffix !== "gcount";
  const previewable =
    !!defaultVariant && defaultVariant.previewable !== false && !unsupported;

  const chartType = previewable ? (defaultVariant.chartType ?? "line") : "none";

  return {
    type: cardKind,
    cardKind,
    supportsNanGuard,
    typeFilterBucket: TYPE_FILTER_BUCKET[cardKind] ?? "other",
    baseName: base,

    unit,
    o2Unit: o2.unit,
    o2UnitCustom: o2.unitCustom,
    // A histogram carries two units: the `le` axis is the observation unit,
    // while cell intensity is count/s. config.unit alone cannot carry both.
    bucketUnit: cardKind === CARD_KIND.CLASSIC_HISTOGRAM_BUCKETS ? unit : null,

    defaultQuery: previewable ? defaultVariant.queries[0].expr : "",
    chartType,
    previewable,
    unsupported,

    footerLabel: FOOTER_LABEL[cardKind] ?? "",
    legendTemplate: defaultVariant?.queries?.[0]?.legendTemplate ?? "",

    // Variant-level ⚙ availability. `_created` and GaugeHistogram cards have
    // nothing meaningful to reconfigure. Info cards now do: count of series (the
    // default) or the label table itself.
    configurable:
      cardKind !== CARD_KIND.TIMESTAMP &&
      cardKind !== CARD_KIND.OTHER &&
      variants.length > 1,

    variants,
  };
}

/**
 * Re-resolves a variant (default or a persisted ⚙ override) against a fresh
 * filter set / rate window, applying any `options.percentiles` selection.
 *
 * @returns {{variant: object, queries: Array<{expr,legendTemplate,builder}>, chartType: string, unit: string} | null}
 */
export function resolveVariant(defaults, variantId, options) {
  const variant =
    defaults.variants.find((v) => v.id === variantId) ??
    defaults.variants[0] ??
    null;
  if (!variant) return null;

  let queries = variant.queries;
  const picked = options?.percentiles ?? variant.options?.percentiles;
  if (Array.isArray(picked) && picked.length && variant.options?.percentiles) {
    // Percentile sets are a checkbox group; rebuild from the variant's full set
    // so an override that selects a subset keeps the same query shape.
    const wanted = new Set(picked.map(Number));
    const subset = variant.queries.filter((query) => {
      const m = /^p(\d+)$/.exec(query.legendTemplate ?? "");
      return m ? wanted.has(Number(m[1])) : true;
    });
    // Never let the set go empty — the dialog prevents unchecking the last one,
    // but a stale persisted override could still arrive empty.
    if (subset.length) queries = subset;
  }

  return {
    variant,
    queries,
    chartType: variant.chartType ?? defaults.chartType,
    unit: variant.unit ?? defaults.unit,
    // The card footer must name the function actually IN EFFECT. Falling back to
    // the card-kind default left an overridden card still reading "sum(rate)"
    // after the user switched to avg(rate) — so the change looked like it had
    // never applied at all.
    footerLabel: variant.footerLabel ?? defaults.footerLabel,
  };
}

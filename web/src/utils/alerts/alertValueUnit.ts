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
  CARD_KIND,
  getMetricDefaults,
  toO2Unit,
  type O2Unit,
} from "@/utils/metrics/metricDefaults";

/** Functions that keep the unit of the values they read. */
const KEEPS_UNIT = new Set([
  "sum",
  "avg",
  "min",
  "max",
  "quantile",
  "topk",
  "bottomk",
  "abs",
  "ceil",
  "floor",
  "round",
  "clamp",
  "clamp_min",
  "clamp_max",
  "sort",
  "sort_desc",
  "label_replace",
  "label_join",
  "avg_over_time",
  "min_over_time",
  "max_over_time",
  "quantile_over_time",
  "last_over_time",
]);
const RATES = new Set(["rate", "irate"]);
const KEYWORDS = new Set([
  "by",
  "without",
  "on",
  "ignoring",
  "group_left",
  "group_right",
  "bool",
  "offset",
  "and",
  "or",
  "unless",
  "inf",
  "nan",
]);
const NO_UNIT = new Set(["", "short", "none"]);

export interface MetricMeta {
  name: string;
  /** `metrics_meta.metric_type` of the stream. */
  type?: string;
  /** `metrics_meta.unit` as the exporter declared it. */
  unit?: string;
}

// Strings, label matchers, ranges and grouping lists hold no metric and no arithmetic.
const skeletonOf = (query: string) =>
  query
    .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`[^`]*`/g, '""')
    .replace(/\{[^}]*\}/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\b(by|without|on|ignoring|group_left|group_right)\s*\([^)]*\)/g, " ");

/**
 * The canonical unit (metricDefaults id) of a PromQL query's values, when the query reads one
 * metric through functions that keep or rate its unit; null when arithmetic or a count hides it.
 */
export function promqlValueUnit(query: string, meta: MetricMeta): string | null {
  const skeleton = skeletonOf(query);
  if (/[-+*/%^<>!=]/.test(skeleton)) return null;
  const metrics = new Set(
    [...query.matchAll(/__name__\s*=\s*"([^"]+)"/g)].map((match) => match[1]),
  );
  const functions = new Set<string>();
  for (const match of skeleton.matchAll(/(?<![\w:.])([A-Za-z_:][\w:]*)(\s*\()?/g)) {
    if (match[2]) functions.add(match[1]);
    else if (!KEYWORDS.has(match[1].toLowerCase())) metrics.add(match[1]);
  }
  if (metrics.size !== 1 || !metrics.has(meta.name)) return null;
  const defaults = getMetricDefaults(meta.name, meta.type, meta.unit);
  const rest = [...functions].filter((fn) => !KEEPS_UNIT.has(fn));
  let unit: string | null = null;
  if (rest.includes("histogram_quantile")) {
    const others = rest.filter((fn) => fn !== "histogram_quantile" && !RATES.has(fn));
    if (!others.length && defaults.cardKind === CARD_KIND.CLASSIC_HISTOGRAM_BUCKETS)
      unit = defaults.unit;
  } else if (rest.some((fn) => RATES.has(fn))) {
    if (rest.every((fn) => RATES.has(fn)) && defaults.cardKind === CARD_KIND.COUNTER_RATE)
      unit = defaults.unit;
  } else if (!rest.length && defaults.cardKind === CARD_KIND.GAUGE) {
    unit = annotatedUnit(meta) ?? defaults.unit;
  }
  return unit && !NO_UNIT.has(unit) ? unit : null;
}

// A UCUM annotation such as {cpu} counts things of that name, which no unit table lists.
const annotatedUnit = (meta: MetricMeta): string | null =>
  /^\{([^{}]+)\}$/.exec(meta.unit?.trim() ?? "")?.[1] ?? null;

/** The unit of a gauge's own values, which min, max, avg, sum and percentiles keep. */
export function gaugeValueUnit(meta: MetricMeta): string | null {
  const defaults = getMetricDefaults(meta.name, meta.type, meta.unit);
  if (defaults.cardKind !== CARD_KIND.GAUGE) return null;
  const unit = annotatedUnit(meta) ?? defaults.unit;
  return NO_UNIT.has(unit) ? null : unit;
}

/** A chart's unit setting; a unit no table knows is shown as written. */
export function chartUnit(unit: string | null): O2Unit {
  const known = toO2Unit(unit ?? "none");
  return unit && known.unit === "numbers" && !NO_UNIT.has(unit)
    ? { unit: "custom", unitCustom: unit }
    : known;
}

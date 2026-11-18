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

import { raw, type I18nText, type TranslateFn } from "@/types/i18n";
import { formatNumber, joinListMore } from "@/utils/alerts/alertCopy";

export interface PromqlMatcher {
  label: string;
  op: string;
  value: string;
}

export interface PromqlSelector {
  name: string;
  matchers: PromqlMatcher[];
}

export type SeriesLabels = Record<string, string>;

export type NoSeriesReason =
  | { kind: "noData"; metric: string }
  | { kind: "labelMissing"; metric: string; label: string; labels: string[] }
  | { kind: "valueNotSeen"; matcher: string; label: string; seen: [string | null, number][] }
  | { kind: "expression"; metric: string; series: number };

/** Every vector selector in a parse_tree AST, in query order, each distinct one once. */
export function selectorsOf(tree: unknown): PromqlSelector[] {
  const found = new Map<string, PromqlSelector>();
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(walk);
    const record = node as Record<string, unknown>;
    if (typeof record.name === "string" && Array.isArray(record.matchers)) {
      const selector = {
        name: record.name,
        matchers: (record.matchers as PromqlMatcher[]).filter((m) => m.label !== "__name__"),
      };
      found.set(JSON.stringify(selector), selector);
      return;
    }
    Object.values(record).forEach(walk);
  };
  walk(tree);
  return [...found.values()];
}

// A series without the label reads as "", as PromQL matches it; regexes are fully anchored.
const matches = (matcher: PromqlMatcher, series: SeriesLabels): boolean => {
  const value = series[matcher.label] ?? "";
  switch (matcher.op) {
    case "=":
      return value === matcher.value;
    case "!=":
      return value !== matcher.value;
    case "=~":
    case "!~": {
      let hit: boolean;
      try {
        hit = new RegExp(`^(?:${matcher.value})$`).test(value);
      } catch {
        return true;
      }
      return matcher.op === "=~" ? hit : !hit;
    }
    default:
      return true;
  }
};

const labelNames = (series: SeriesLabels[]) =>
  [...new Set(series.flatMap((s) => Object.keys(s)))].filter((l) => !l.startsWith("__")).sort();

// null counts the series without the label: often the filter names the wrong one of two look-alikes.
const valueCounts = (series: SeriesLabels[], label: string): [string | null, number][] => {
  const counts = new Map<string | null, number>();
  for (const s of series) counts.set(s[label] ?? null, (counts.get(s[label] ?? null) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
};

/** Why a PromQL query that drew nothing matched no series: the first selector that explains it. */
export function noSeriesReason(
  selectors: PromqlSelector[],
  seriesOf: (metric: string) => SeriesLabels[],
): NoSeriesReason | null {
  for (const { name, matchers } of selectors) {
    const series = seriesOf(name);
    if (!series.length) return { kind: "noData", metric: name };
    const labels = labelNames(series);
    for (const matcher of matchers) {
      if (!labels.includes(matcher.label) && !matches(matcher, {}))
        return { kind: "labelMissing", metric: name, label: matcher.label, labels };
    }
    if (series.some((s) => matchers.every((m) => matches(m, s)))) continue;
    // Each matcher alone may match; then it is the combination, which the expression line covers.
    const culprit = matchers.find((m) => !series.some((s) => matches(m, s)));
    if (culprit)
      return {
        kind: "valueNotSeen",
        matcher: `${culprit.label}${culprit.op}"${culprit.value}"`,
        label: culprit.label,
        seen: valueCounts(series, culprit.label),
      };
  }
  const first = selectors[0];
  if (!first) return null;
  const series = seriesOf(first.name).filter((s) => first.matchers.every((m) => matches(m, s)));
  return { kind: "expression", metric: first.name, series: series.length };
}

/** The reason as the sentence the empty chart shows. */
export function noSeriesSentence(reason: NoSeriesReason, t: TranslateFn): I18nText {
  switch (reason.kind) {
    case "noData":
      return t("alerts.testRun.noSeries", { metric: raw(reason.metric), count: 0 }, 0);
    case "labelMissing":
      return reason.labels.length
        ? t("alerts.guard.labelMissing", {
            label: raw(reason.label),
            metric: raw(reason.metric),
            labels: joinListMore(reason.labels, t),
          })
        : t("alerts.guard.labelMissingNone", {
            label: raw(reason.label),
            metric: raw(reason.metric),
          });
    case "valueNotSeen":
      return t("alerts.guard.valueNotSeen", {
        value: raw(reason.matcher),
        seen: joinListMore(
          reason.seen.map(([value, count]) =>
            value === null
              ? t("alerts.guard.seenWithout", {
                  label: raw(reason.label),
                  count: formatNumber(count),
                })
              : t("alerts.discovery.valueCount", { value: raw(value), count: formatNumber(count) }),
          ),
          t,
        ),
      });
    case "expression":
      return t(
        "alerts.testRun.noSeries",
        { metric: raw(reason.metric), count: formatNumber(reason.series) },
        reason.series,
      );
  }
}

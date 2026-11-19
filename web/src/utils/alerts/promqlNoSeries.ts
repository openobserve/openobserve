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
import { formatNumber, joinListMore, joinListOrMore } from "@/utils/alerts/alertCopy";

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
  | {
      kind: "valueNotSeen";
      matchers: string[];
      labels: string[];
      seen: [string | null, number][];
    }
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

// null counts the series carrying none of the labels: often the filter names the wrong look-alike.
const valueCounts = (series: SeriesLabels[], labels: string[]): [string | null, number][] => {
  const counts = new Map<string | null, number>();
  for (const s of series) {
    const value = labels.map((l) => s[l]).find((v) => v !== undefined) ?? null;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
};

const culpritOf = (selector: PromqlSelector, series: SeriesLabels[]) =>
  series.some((s) => selector.matchers.every((m) => matches(m, s)))
    ? undefined
    : selector.matchers.find((m) => !series.some((s) => matches(m, s)));

/** One value missing under every spelling of its label (an `or` across naming generations) is one reason. */
const valueNotSeen = (
  culprit: PromqlMatcher,
  selectors: PromqlSelector[],
  seriesOf: (metric: string) => SeriesLabels[],
): NoSeriesReason => {
  const same = selectors.flatMap((sel) => {
    const m = culpritOf(sel, seriesOf(sel.name));
    return m && m.op === culprit.op && m.value === culprit.value ? [{ sel, m }] : [];
  });
  const labels = [...new Set(same.map(({ m }) => m.label))];
  const metrics = [...new Set(same.map(({ sel }) => sel.name))];
  return {
    kind: "valueNotSeen",
    matchers: [...new Set(same.map(({ m }) => `${m.label}${m.op}"${m.value}"`))],
    labels,
    seen: valueCounts(metrics.flatMap(seriesOf), labels),
  };
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
    if (culprit) return valueNotSeen(culprit, selectors, seriesOf);
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
        value: joinListOrMore(reason.matchers, t),
        seen: joinListMore(
          reason.seen.map(([value, count]) =>
            value === null
              ? t("alerts.guard.seenWithout", {
                  label: joinListOrMore(reason.labels, t),
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

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

import { gt, raw, type TranslateFn } from "@/types/i18n";

import {
  doorChip,
  finish,
  ident,
  inline,
  num,
  promptRange,
  type PromptBuild,
  type PromptRange,
} from "./format";

/** One series of the Metrics explorer legend. */
export interface MetricSeriesInput {
  org: string;
  metric: string;
  labels?: Record<string, string>;
  query?: string;
  language?: "PromQL" | "SQL";
  aggregation?: string;
  range: PromptRange;
  timeZone: string;
  lastValue?: number;
  unit?: string;
}

// A series with dozens of labels keeps the first ones, so the closing question survives.
const MAX_LABELS = 12;

/** `{a="1", b="2"}`, the label set as PromQL writes it; empty when there are none. */
export function labelSet(labels: Record<string, string> = {}): string {
  const pairs = Object.entries(labels)
    .slice(0, MAX_LABELS)
    .map(([name, value]) => `${inline(name, 40)}="${inline(value, 60).replace(/"/g, "'")}"`);
  return pairs.length ? `{${pairs.join(", ")}}` : "";
}

/** Explain this series: the metric name if it is an identifier, numbers and the window in the text; label values and the query in the Query block. */
export function buildMetricSeriesPrompt(
  input: MetricSeriesInput,
  t: TranslateFn = gt,
): PromptBuild {
  const series = `${inline(input.metric, 60)}${labelSet(input.labels)}`;
  const metric = ident(input.metric);
  const aggregation = input.aggregation ? ident(input.aggregation) : null;
  const window = promptRange(input.range, input.timeZone);
  const unit = input.unit ? ident(input.unit) : null;
  const last =
    input.lastValue === undefined
      ? null
      : `Last value ${num(input.lastValue)}${unit ? ` ${unit}` : ""}.`;
  const chip = doorChip({
    kind: "query",
    key: `${input.org}|series|${series}|${input.query ?? ""}`,
    label: t("assistant.entry.chip.series", { name: raw(inline(series, 80)) }),
    short: raw(inline(input.metric, 60)),
    ref: { type: "metric_series", org: input.org, from: input.range.from, to: input.range.to },
    data: {
      metric: input.metric,
      labels: input.labels ?? {},
      ...(input.query && { query: input.query, language: input.language ?? "PromQL" }),
      ...(input.aggregation && { aggregation: input.aggregation }),
    },
    sent: "serialized",
  });
  const text = finish([
    `Explain the series of ${metric ? `metric \`${metric}\`` : "the metric"} over ${window}${aggregation ? `, aggregated with ${aggregation}` : ""}.`,
    `Its labels${input.query ? ", the query that plotted it" : ""} and its metric name are in the attached Query block.`,
    last,
    "What drives it and what changed?",
  ]);
  const title = t("assistant.entry.chip.series", {
    name: raw(`${inline(input.metric, 60)} · ${window}`),
  });
  return { text, chips: [chip], title };
}

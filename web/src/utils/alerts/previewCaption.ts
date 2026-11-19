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
import { joinList, measureWords } from "./alertCopy";
import { promqlQuantileAgg } from "./alertIntents";
import { promqlByLabels } from "./queryGroupLabels";

export interface PreviewCaptionInput {
  tab: string;
  streamType?: string;
  query?: string;
  /** The builder measures a value; otherwise it counts events. */
  measured: boolean;
  aggregation?: {
    function?: string;
    group_by?: string[] | null;
    having?: { column?: string };
  } | null;
  /** SQL "One per" judges this column of each row. */
  sqlColumn?: string | null;
}

/** What the preview chart plots, so a scale that changes with the setup says why. */
export function previewCaption(input: PreviewCaptionInput, t: TranslateFn): I18nText | null {
  const groups = (input.aggregation?.group_by ?? []).filter((g) => !!g?.trim());
  const each = (what: I18nText) =>
    groups.length
      ? t("alerts.form.preview.plotsEach", { what, groups: joinList(groups) })
      : t("alerts.form.preview.plots", { what });
  if (input.tab === "promql") return input.query ? promqlCaption(input.query, t) : null;
  if (input.tab === "sql") return input.sqlColumn ? each(raw(input.sqlColumn)) : null;
  if (!input.measured)
    return t("alerts.form.preview.plots", {
      what: measureWords({ function: "count" }, [], input.streamType, t),
    });
  const what = measureWords(input.aggregation, groups, input.streamType, t);
  // A metric stream holds many series; one line for all of them is their combined value.
  if (!groups.length && input.streamType === "metrics")
    return t("alerts.form.preview.plotsAll", { what });
  return each(what);
}

const PROMQL_QUANTILE =
  /^histogram_quantile\(\s*[\d.]+\s*,\s*sum by \([^)]*\)\s*\(rate\((\w+)\[\w+\]\)\)\s*\)$/;
const PROMQL_SHARE = /^sum(?: by \([^)]*\))? \((?:rate\()?(\w+)\{.*\) \/ sum\b.*\* 100$/;
const PROMQL_RATE = /^(?:sum by \([^)]*\)\s*\()?rate\((\w+)\[\w+\]\)\)?$/;

/** The starters' PromQL shapes in words; any other query is shown as written. */
function promqlCaption(query: string, t: TranslateFn): I18nText {
  const q = query.trim();
  const bucket = PROMQL_QUANTILE.exec(q)?.[1];
  const quantile = bucket ? promqlQuantileAgg(q) : undefined;
  const share = PROMQL_SHARE.exec(q)?.[1];
  const rate = PROMQL_RATE.exec(q)?.[1];
  const what = quantile
    ? measureWords({ function: quantile, having: { column: bucket } }, [], "metrics", t)
    : share
      ? t("alerts.form.preview.shareOf", { metric: raw(share) })
      : rate
        ? t("alerts.intent.rows.perSecond", { metric: raw(rate) })
        : null;
  if (!what) return t("alerts.form.preview.plots", { what: raw(query) });
  const groups = promqlByLabels(q);
  return groups.length
    ? t("alerts.form.preview.plotsEach", { what, groups: joinList(groups) })
    : t("alerts.form.preview.plots", { what });
}

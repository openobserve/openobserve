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

import type { I18nKey, I18nText, TranslateFn } from "@/types/i18n";
import { formatNumber } from "./alertCopy";

// A count of groups or series reads "fewer than 3", not "less than 3".
const COUNT_COMPARISON_KEYS: Record<string, I18nKey> = {
  ">=": "alerts.sections.operators.gte",
  ">": "alerts.sections.operators.gt",
  "<=": "alerts.sections.operators.lte",
  "<": "alerts.form.group.fewerThan",
  "=": "alerts.sections.operators.eq",
  "!=": "alerts.sections.operators.ne",
};

/** The comparison a "when … N groups / series" count reads with. */
export const countComparisonWords = (operator: unknown, t: TranslateFn): I18nText =>
  t(COUNT_COMPARISON_KEYS[String(operator ?? "")] ?? COUNT_COMPARISON_KEYS[">="]);

/** "at least 3", "fewer than 2": the group or series count a one-alert rule needs. */
export const countRuleText = (operator: unknown, threshold: unknown, t: TranslateFn): I18nText =>
  t("alerts.sections.review.comparison", {
    op: countComparisonWords(operator, t),
    value: formatNumber(Number(threshold ?? 1)),
  });

export const countComparisonOptions = (t: TranslateFn) =>
  Object.keys(COUNT_COMPARISON_KEYS).map((value) => ({
    label: countComparisonWords(value, t),
    value,
  }));

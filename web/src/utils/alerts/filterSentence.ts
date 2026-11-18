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

import type { TranslateFn } from "@/types/i18n";
import {
  OPERATORS,
  conditionValueLabel,
  type FilterCondition,
  type FilterConnector,
  type FilterGroup,
  type FilterRawNode,
} from "@/utils/query/filterBar";

/** One condition in words; a raw node has only `text`. `text` is the whole phrase as it reads. */
export interface FilterPhrase {
  field?: string;
  operator?: string;
  value?: string;
  text: string;
}

/** A group's brackets ride on its first and last condition (`opens`, `closes`), so a line never breaks inside them. */
export type FilterSentencePart =
  | { kind: "condition"; id: string; phrase: FilterPhrase; opens: number; closes: number }
  | { kind: "connector"; id: string; connector: FilterConnector };

/** A whole filter tree as one sentence, every condition written out; each connector is the stored one of the item after it. */
export function filterSentenceParts(
  group: FilterGroup,
  describe: (n: FilterCondition | FilterRawNode) => FilterPhrase,
): FilterSentencePart[] {
  const parts: FilterSentencePart[] = [];
  for (const item of group.items) {
    const inner: FilterSentencePart[] =
      item.kind === "group"
        ? filterSentenceParts(item, describe)
        : [{ kind: "condition", id: item.id, phrase: describe(item), opens: 0, closes: 0 }];
    const first = inner[0];
    const last = inner.at(-1);
    // An empty group says nothing, so it takes no connector either.
    if (first?.kind !== "condition" || last?.kind !== "condition") continue;
    if (item.kind === "group") {
      first.opens += 1;
      last.closes += 1;
    }
    if (parts.length) parts.push({ kind: "connector", id: item.id, connector: item.connector });
    parts.push(...inner);
  }
  return parts;
}

/** One condition as prose ("log contains error"); the operator's label reads mid-sentence, unlike its chip name. */
export function describeFilterNode(
  n: FilterCondition | FilterRawNode,
  dialect: string,
  t: TranslateFn,
): FilterPhrase {
  if (n.kind === "raw") return { text: n.label };
  const op = OPERATORS[n.operator];
  const operator = dialect === "promql" && op.promqlSymbol ? op.promqlSymbol : t(op.labelKey);
  const field = n.field || t("filterBar.textField");
  const value =
    op.arity === "none" ? "" : conditionValueLabel(n).trim() || t("filterBar.emptyValue");
  return { field, operator, value, text: [field, operator, value].filter(Boolean).join(" ") };
}

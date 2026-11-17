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

export type FilterSentencePart =
  | { kind: "condition"; id: string; text: string }
  | { kind: "connector"; id: string; connector: FilterConnector }
  | { kind: "open" }
  | { kind: "close" };

/** A whole filter tree as one sentence, every condition written out; each connector is the stored one of the item after it. */
export function filterSentenceParts(
  group: FilterGroup,
  describe: (n: FilterCondition | FilterRawNode) => string,
): FilterSentencePart[] {
  const parts: FilterSentencePart[] = [];
  group.items.forEach((item, index) => {
    if (index) parts.push({ kind: "connector", id: item.id, connector: item.connector });
    if (item.kind === "group") {
      parts.push({ kind: "open" }, ...filterSentenceParts(item, describe), { kind: "close" });
    } else {
      parts.push({ kind: "condition", id: item.id, text: describe(item) });
    }
  });
  return parts;
}

/** One condition as prose ("log contains error"); the operator's label reads mid-sentence, unlike its chip name. */
export function describeFilterNode(
  n: FilterCondition | FilterRawNode,
  dialect: string,
  t: TranslateFn,
): string {
  if (n.kind === "raw") return n.label;
  const op = OPERATORS[n.operator];
  const operator = dialect === "promql" && op.promqlSymbol ? op.promqlSymbol : t(op.labelKey);
  const field = n.field || t("filterBar.textField");
  return [field, operator, conditionValueLabel(n)].filter(Boolean).join(" ");
}

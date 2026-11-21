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

import { computed, type Ref } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";

/** The placeholder on the empty filter row; label names are fetched lazily on the first `+ Filter` click. */
export function useFilterHint(
  /** Label names from the grid's schema; empty until the picker is first opened. */
  labelNames: Ref<string[]>,
) {
  const { t } = useI18nTyped();
  // Internal labels (`__name__`, `_o2_*`) make a poor example of a filter.
  const placeholder = computed<string>(() => {
    if (!labelNames.value.length) return t("metrics.filter.placeholderEmpty");
    const label = labelNames.value.find((name) => !name.startsWith("_")) ?? "status";
    return t("metrics.filter.placeholder", { label: raw(label) });
  });
  return { placeholder };
}

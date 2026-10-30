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

import { computed, readonly, shallowRef, watch, type Ref } from "vue";
import { useI18nTyped } from "@/types/i18n";
import {
  isPanelTitleLoading,
  resolvePanelTitle,
  type PanelTitleContext,
} from "@/utils/dashboard/panelTitle";

/** A panel title with its variables resolved, holding the last resolved text while a referenced variable reloads. */
export const usePanelTitle = (source: {
  title: () => string | null | undefined;
  variablesData: () => any;
  context?: () => PanelTitleContext | undefined;
}): Readonly<Ref<string>> => {
  const { t } = useI18nTyped();

  const next = computed(() => {
    const title = source.title();
    const variablesData = source.variablesData();
    if (isPanelTitleLoading(title, variablesData)) return null;
    return resolvePanelTitle(
      title,
      variablesData,
      source.context?.(),
      t("dashboard.variableQueryValueSelector.all"),
    );
  });

  const display = shallowRef(source.title() ?? "");
  let lastTitle: string | null | undefined;
  watch(
    [next, source.title],
    ([resolved, title]) => {
      if (resolved !== null) display.value = resolved;
      // A new template while loading shows the template, not the old title's text.
      else if (title !== lastTitle) display.value = title ?? "";
      lastTitle = title;
    },
    { immediate: true },
  );

  return readonly(display);
};

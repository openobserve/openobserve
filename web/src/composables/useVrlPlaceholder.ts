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

import { computed } from "vue";

import { useI18nTyped } from "@/types/i18n";

/** The VRL editor placeholder: one static line that names the language. */
export function useVrlPlaceholder() {
  const { t } = useI18nTyped();
  return { placeholder: computed<string>(() => t("assistant.helper.editorPlaceholder.vrl")) };
}

/** The JavaScript editor placeholder: one static line that names the language. */
export function useJsPlaceholder() {
  const { t } = useI18nTyped();
  return { placeholder: computed<string>(() => t("assistant.helper.editorPlaceholder.js")) };
}

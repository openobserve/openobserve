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

import { useTypewriterPlaceholder } from "@/components/ai-assistant/welcome/useTypewriterPlaceholder";
import { isAssistantV2 } from "@/composables/assistant/flags";
import { useI18nTyped } from "@/types/i18n";

// The prompts are built per call, not at module scope: a module-level array would
// resolve `t()` at import time and freeze the boot locale. The `e.g.` samples stay
// literal — they are VRL/JS source the user copies, not prose.
const VRL_EXAMPLES = [
  '.status = "active"',
  'if .level == "error" { .alert = true }',
  "del(.sensitive_field)",
  ".count = int!(.count) + 1",
  ".message = downcase!(string!(.message))",
];

const JS_EXAMPLES = [
  'row.status = "active";',
  'if (row.level === "error") row.alert = true;',
  "delete row.sensitive_field;",
  "row.count = parseInt(row.count) + 1;",
];

/** The VRL editor placeholder: static on the v2 path, typed out on the legacy one. */
export function useVrlPlaceholder() {
  const { t } = useI18nTyped();
  if (isAssistantV2())
    return { placeholder: computed<string>(() => t("assistant.helper.editorPlaceholder.vrl")) };
  return useTypewriterPlaceholder(
    VRL_EXAMPLES.map((example) => t("functions.vrlFunctionPlaceholder", { example })),
  );
}

/** The JavaScript editor placeholder: static on the v2 path, typed out on the legacy one. */
export function useJsPlaceholder() {
  const { t } = useI18nTyped();
  if (isAssistantV2())
    return { placeholder: computed<string>(() => t("assistant.helper.editorPlaceholder.js")) };
  return useTypewriterPlaceholder(
    JS_EXAMPLES.map((example) => t("functions.jsFunctionPlaceholder", { example })),
  );
}

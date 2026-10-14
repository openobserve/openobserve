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

import type { EditorSuggestMode } from "@/composables/useEditorSuggestMode";

export const TAB_PICKS_FIRST_COMMAND = "o2.suggest.tabPicksFirst";

export const TAB_RULE_WHEN =
  "suggestWidgetVisible && !suggestWidgetHasFocusedSuggestion && textInputFocus";

const QUERY_LANGUAGES = new Set(["sql", "promql"]);

type MonacoApi = any;
type Disposable = { dispose: () => void };

export const isQueryLanguage = (language: string): boolean => QUERY_LANGUAGES.has(language);

export const followsKeyContract = (mode: EditorSuggestMode, language: string): boolean =>
  mode !== "off" && isQueryLanguage(language);

/** Under `off` these are Monaco's own defaults, spelled out so a live switch back to `off` restores them. */
export const suggestKeyOptions = (
  mode: EditorSuggestMode,
  language: string,
): Record<string, unknown> => {
  if (!isQueryLanguage(language)) return {};
  if (mode === "off") {
    return { suggest: { selectionMode: "always" }, acceptSuggestionOnEnter: "on" };
  }
  return {
    // Only trigger-character menus open unhighlighted; 'never' would also unhighlight typed letters.
    suggest: { selectionMode: "whenQuickSuggestion" },
    // Differs from 'on' only where the highlighted row equals the typed word.
    acceptSuggestionOnEnter: "smart",
    // true would hide every chained menu while ghost text is visible.
    inlineSuggest: { suppressSuggestions: false },
  };
};

export const focusedEditor = (monaco: MonacoApi): any =>
  monaco.editor.getEditors().find((editor: any) => editor.hasTextFocus());

let tabRule: Disposable[] | null = null;

/** Global, not per editor: the per-editor addCommand leaked a handler from a disposed editor into the next. */
export const setTabPicksFirst = (monaco: MonacoApi, enabled: boolean): void => {
  if (!enabled) {
    tabRule?.forEach((d) => d.dispose());
    tabRule = null;
    return;
  }
  if (tabRule) return;
  tabRule = [
    monaco.editor.addCommand({
      id: TAB_PICKS_FIRST_COMMAND,
      run: () => {
        const editor = focusedEditor(monaco);
        if (!editor) return;
        editor.trigger("tab", "selectNextSuggestion", {});
        editor.trigger("tab", "acceptSelectedSuggestion", {});
      },
    }),
    monaco.editor.addKeybindingRule({
      keybinding: monaco.KeyCode.Tab,
      command: TAB_PICKS_FIRST_COMMAND,
      when: TAB_RULE_WHEN,
    }),
  ];
};

export const resetKeyContractForTests = (): void => {
  setTabPicksFirst(null, false);
};

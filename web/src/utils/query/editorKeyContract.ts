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

/** Types a real space from source "keyboard", which opens the next menu unhighlighted. */
export const CHAIN_COMMAND = "o2.suggest.chainSpace";

export const ACCEPT_COMMAND = "o2.suggest.accepted";

/** Class on the container of an editor whose menus follow this contract; the widget styling and the click swallow stay inside it. */
export const QUERY_EDITOR_CLASS = "o2-query-editor";

/** Per-editor context key: set where menus carry group headers, so the navigation rules step over them. */
export const NAV_SKIP_CONTEXT_KEY = "o2SuggestNavSkip";

const NAV_WHEN = `suggestWidgetVisible && textInputFocus && ${NAV_SKIP_CONTEXT_KEY}`;

const NAV_COMMAND_PREFIX = "o2.suggest.nav.";

const MAX_SKIPS = 4;

/** Monaco's default suggest.maxVisibleSuggestions: a longer list scrolls. */
const VISIBLE_ROWS = 12;

type NavMove = "next" | "prev" | "nextPage" | "prevPage" | "first";

const NAV_COMMANDS: Record<NavMove, string> = {
  next: "selectNextSuggestion",
  prev: "selectPrevSuggestion",
  nextPage: "selectNextPageSuggestion",
  prevPage: "selectPrevPageSuggestion",
  first: "selectNextSuggestion",
};

const CLICK_EVENTS = ["mousedown", "pointerdown", "mouseup", "pointerup", "click", "dblclick"];

/** Rewrites `field ` into `fn(field, '')` after an accept that inserted nothing, so the row keeps an empty filter word and sorts below `=`. */
export const WRAP_FIELD_COMMAND = "o2.suggest.wrapField";

export type SuggestLane = "operator" | "value" | "field" | "clause";

const QUERY_LANGUAGES = new Set(["sql", "promql"]);

/** Monaco does not say which space opened a menu, so one opening this soon after the chain's space counts as chained. */
export const CHAINED_MENU_WINDOW_MS = 1000;

const BASE_TRIGGERS = [".", "(", ",", "'", '"', " "];

/** Under `off` the provider answers these with nothing, because there a menu would open highlighted on them. */
export const SQL_VALUE_TRIGGERS = ["=", "<", ">"];

type MonacoApi = any;
type Disposable = { dispose: () => void };

export interface WrapFieldTarget {
  fn: string;
  field: string;
  lineNumber: number;
  startColumn: number;
  /** str_match has values to offer, so its empty quotes open the value menu as a chain would. */
  openValues?: boolean;
}

export const isQueryLanguage = (language: string): boolean => QUERY_LANGUAGES.has(language);

export const followsKeyContract = (mode: EditorSuggestMode, language: string): boolean =>
  mode !== "off" && isQueryLanguage(language);

export const chainsInMode = (mode: EditorSuggestMode): boolean => mode === "automatic";

/** Registered once per language for every mode, since the mode can arrive after registration; never `!` alone. */
export const triggerCharactersFor = (language: string): string[] => {
  if (language === "sql") return [...BASE_TRIGGERS, ...SQL_VALUE_TRIGGERS];
  if (language === "promql") return [...BASE_TRIGGERS, "="];
  return BASE_TRIGGERS;
};

export const acceptCommand = (lane: SuggestLane | "", chain: boolean) => ({
  id: chain ? CHAIN_COMMAND : ACCEPT_COMMAND,
  title: "",
  arguments: [lane],
});

export const wrapFieldCommand = (target: WrapFieldTarget) => ({
  id: WRAP_FIELD_COMMAND,
  title: "",
  arguments: [target],
});

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
let acceptCommands: Disposable[] | null = null;

// Monaco internal (suggestWidget focus -> resolveCompletionItem, synchronous): no public API reports the focused row.
let lastResolved: any = null;
let firstOfMenu: any = null;
// The editor whose long grouped menu just opened; only its first focus may bring the header back into view.
let revealHeaderIn: any = null;
let monacoApi: MonacoApi | null = null;

/** Header and status rows carry `o2skip`, so the key rules can step over them. */
const onSkipRow = (): boolean => !!lastResolved?.o2skip;

export const noteResolvedItem = (item: any): void => {
  lastResolved = item;
  if (!revealHeaderIn || item?.o2skip) return;
  const editor = monacoApi && focusedEditor(monacoApi);
  const ours = editor?.getContainerDomNode?.()?.closest?.(`.${QUERY_EDITOR_CLASS}`);
  const target = revealHeaderIn;
  revealHeaderIn = null;
  if (!editor || editor !== target || !ours) return;
  // Monaco internal (suggestWidget reveals the preselected row at the top): one step up and back shows the first header again.
  setTimeout(() => {
    editor.trigger("o2", "selectPrevSuggestion", {});
    editor.trigger("o2", "selectNextSuggestion", {});
  }, 0);
};

/** The list's first row, so moving up onto a header there turns into moving down. */
export const noteMenuItems = (
  items: { sortText?: string; o2skip?: boolean }[],
  editor: unknown = null,
): void => {
  firstOfMenu = items.reduce<{ sortText?: string; o2skip?: boolean } | null>(
    (first, item) => (!first || String(item.sortText) < String(first.sortText) ? item : first),
    null,
  );
  revealHeaderIn = firstOfMenu?.o2skip && items.length > VISIBLE_ROWS ? editor : null;
};

/** The menu closed (Esc, blur, accept), so a pending header reveal no longer applies. */
export const forgetMenu = (): void => {
  revealHeaderIn = null;
};

const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));

const stepOverSkipRows = async (editor: any, move: NavMove): Promise<void> => {
  lastResolved = null;
  editor.trigger("keyboard", NAV_COMMANDS[move], {});
  // Monaco internal (listWidget page focus after timeout(0)): a page move that scrolls focuses its row a few ticks later.
  if (move === "nextPage" || move === "prevPage") for (let i = 0; i < 4; i++) await nextTick();
  let up = move === "prev" || move === "prevPage";
  for (let i = 0; i < MAX_SKIPS && onSkipRow(); i++) {
    if (up && lastResolved === firstOfMenu) up = false;
    lastResolved = null;
    editor.trigger("keyboard", up ? "selectPrevSuggestion" : "selectNextSuggestion", {});
  }
};

const navKeybindings = (monaco: MonacoApi) => {
  const { KeyMod: M, KeyCode: K } = monaco;
  const unfocused = `${NAV_WHEN} && !suggestWidgetHasFocusedSuggestion`;
  const rule = (keybinding: number, move: NavMove, onlyUnfocused = false) => ({
    keybinding,
    command: `${NAV_COMMAND_PREFIX}${move}`,
    when: onlyUnfocused ? unfocused : NAV_WHEN,
  });
  return [
    rule(K.DownArrow, "next"),
    rule(M.CtrlCmd | K.DownArrow, "next"),
    rule(M.WinCtrl | K.KeyN, "next"),
    rule(K.UpArrow, "prev"),
    rule(M.CtrlCmd | K.UpArrow, "prev"),
    rule(M.WinCtrl | K.KeyP, "prev"),
    rule(K.PageDown, "nextPage"),
    rule(K.PageUp, "prevPage"),
    rule(M.CtrlCmd | K.Space, "first", true),
    rule(M.WinCtrl | K.Space, "first", true),
    rule(M.CtrlCmd | K.KeyI, "first", true),
  ];
};

// Monaco internal (.monaco-list-rows): a click through a header lands there; swallowed, the editor keeps focus and the menu stays.
const swallowHeaderClick = (event: Event) => {
  const target = event.target as HTMLElement | null;
  const ours = target?.closest?.(`.${QUERY_EDITOR_CLASS} .suggest-widget`);
  if (!target?.classList?.contains("monaco-list-rows") || !ours) return;
  event.preventDefault();
  event.stopPropagation();
};

type AcceptListener = (editor: any, lane: SuggestLane | "", chained: boolean) => void;
let acceptListener: AcceptListener = () => {};

/** Global, not per editor: the per-editor addCommand leaked a handler from a disposed editor into the next. */
export const setTabPicksFirst = (monaco: MonacoApi, enabled: boolean): void => {
  if (!enabled) {
    tabRule?.forEach((d) => d.dispose());
    tabRule = null;
    return;
  }
  if (tabRule) return;
  monacoApi = monaco;
  tabRule = [
    monaco.editor.addCommand({
      id: TAB_PICKS_FIRST_COMMAND,
      run: () => {
        const editor = focusedEditor(monaco);
        if (!editor) return;
        lastResolved = null;
        editor.trigger("tab", "selectNextSuggestion", {});
        for (let i = 0; i < MAX_SKIPS && onSkipRow(); i++) {
          lastResolved = null;
          editor.trigger("tab", "selectNextSuggestion", {});
        }
        // Only header and status rows: Tab inserts nothing and closes the menu.
        if (onSkipRow()) editor.trigger("tab", "hideSuggestWidget", {});
        else editor.trigger("tab", "acceptSelectedSuggestion", {});
      },
    }),
    monaco.editor.addKeybindingRule({
      keybinding: monaco.KeyCode.Tab,
      command: TAB_PICKS_FIRST_COMMAND,
      when: TAB_RULE_WHEN,
    }),
    ...(Object.keys(NAV_COMMANDS) as NavMove[]).map((move) =>
      monaco.editor.addCommand({
        id: `${NAV_COMMAND_PREFIX}${move}`,
        run: () => {
          const editor = focusedEditor(monaco);
          return editor ? stepOverSkipRows(editor, move) : undefined;
        },
      }),
    ),
    // Monaco internal (standalone keybinding weight): rules added here outrank the suggest widget's own arrow bindings.
    monaco.editor.addKeybindingRules(navKeybindings(monaco)),
  ];
  CLICK_EVENTS.forEach((type) => document.addEventListener(type, swallowHeaderClick, true));
  tabRule.push({
    dispose: () =>
      CLICK_EVENTS.forEach((type) => document.removeEventListener(type, swallowHeaderClick, true)),
  });
};

const wrapField = (monaco: MonacoApi, editor: any, target: WrapFieldTarget) => {
  const { fn, field, lineNumber, startColumn, openValues } = target;
  const caret = editor.getPosition();
  if (!caret || caret.lineNumber !== lineNumber || caret.column < startColumn) return;
  const head = `${fn}(${field}, '`;
  const inQuotes = startColumn + head.length;
  // An end cursor state, unlike a later setPosition, is what redo restores.
  editor.executeEdits(
    WRAP_FIELD_COMMAND,
    [
      {
        range: {
          startLineNumber: lineNumber,
          startColumn,
          endLineNumber: lineNumber,
          endColumn: caret.column,
        },
        text: `${head}')`,
      },
    ],
    [new monaco.Selection(lineNumber, inQuotes, lineNumber, inQuotes)],
  );
  editor.pushUndoStop?.();
  // auto: an empty answer closes quietly instead of showing "No suggestions."
  if (openValues) editor.trigger("keyboard", "editor.action.triggerSuggest", { auto: true });
};

export const registerAcceptCommands = (monaco: MonacoApi, listener: AcceptListener): void => {
  acceptListener = listener;
  if (acceptCommands) return;
  acceptCommands = [
    monaco.editor.registerCommand(CHAIN_COMMAND, (_accessor: unknown, lane: SuggestLane) => {
      const editor = focusedEditor(monaco);
      if (!editor) return;
      acceptListener(editor, lane, true);
      // Source "keyboard" or the space is not a trigger character and no menu opens.
      editor.trigger("keyboard", "type", { text: " " });
    }),
    monaco.editor.registerCommand(ACCEPT_COMMAND, (_accessor: unknown, lane: SuggestLane | "") => {
      const editor = focusedEditor(monaco);
      if (editor) acceptListener(editor, lane, false);
    }),
    monaco.editor.registerCommand(
      WRAP_FIELD_COMMAND,
      (_accessor: unknown, target: WrapFieldTarget) => {
        const editor = focusedEditor(monaco);
        if (!editor) return;
        acceptListener(editor, "operator", false);
        wrapField(monaco, editor, target);
      },
    ),
  ];
};

export const resetKeyContractForTests = (): void => {
  setTabPicksFirst(null, false);
  lastResolved = null;
  firstOfMenu = null;
  revealHeaderIn = null;
  monacoApi = null;
  acceptCommands?.forEach((d) => d.dispose());
  acceptCommands = null;
  acceptListener = () => {};
};

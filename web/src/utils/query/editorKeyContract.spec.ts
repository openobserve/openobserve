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

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SQL_VALUE_TRIGGERS,
  acceptCommand,
  followsKeyContract,
  registerAcceptCommands,
  resetKeyContractForTests,
  setTabPicksFirst,
  suggestKeyOptions,
  triggerCharactersFor,
  forgetMenu,
  noteMenuItems,
  noteResolvedItem,
  NAV_SKIP_CONTEXT_KEY,
  QUERY_EDITOR_CLASS,
  wrapFieldCommand,
} from "./editorKeyContract";

const makeMonaco = (editors: any[] = []) => {
  const rules: any[] = [];
  const commands = new Map<string, () => void>();
  return {
    KeyCode: {
      Tab: 2,
      Space: 10,
      PageUp: 11,
      PageDown: 12,
      UpArrow: 16,
      DownArrow: 18,
      KeyI: 39,
      KeyN: 44,
      KeyP: 46,
    },
    KeyMod: { CtrlCmd: 2048, WinCtrl: 256 },
    Selection: class {
      constructor(
        public selectionStartLineNumber: number,
        public selectionStartColumn: number,
        public positionLineNumber: number,
        public positionColumn: number,
      ) {}
    },
    editor: {
      getEditors: vi.fn(() => editors),
      addCommand: vi.fn((d: { id: string; run: () => void }) => {
        commands.set(d.id, d.run);
        return { dispose: () => commands.delete(d.id) };
      }),
      addKeybindingRule: vi.fn((rule: any) => {
        rules.push(rule);
        return { dispose: () => rules.splice(rules.indexOf(rule), 1) };
      }),
      addKeybindingRules: vi.fn((list: any[]) => {
        rules.push(...list);
        return { dispose: () => list.forEach((rule) => rules.splice(rules.indexOf(rule), 1)) };
      }),
      registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
    },
    // Runs a registered command by id, as a keybinding would.
    run: (id: string) => commands.get(id)?.(),
    // Presses a key against the registered rules: a matching rule runs its command, otherwise Monaco's default runs.
    press: (keybinding: number, context: Record<string, boolean>): "rule" | "default" => {
      const holds = (when: string) =>
        when.split(" && ").every((k) => (k.startsWith("!") ? !context[k.slice(1)] : !!context[k]));
      const hits = rules.filter((r) => r.keybinding === keybinding && holds(r.when));
      if (!hits.length) return "default";
      hits.forEach((r) => commands.get(r.command)?.());
      return "rule";
    },
    pressTab(context: Record<string, boolean>): "rule" | "indent" {
      return this.press(2, context) === "rule" ? "rule" : "indent";
    },
  };
};

const UNHIGHLIGHTED_MENU = {
  suggestWidgetVisible: true,
  suggestWidgetHasFocusedSuggestion: false,
  textInputFocus: true,
};

describe("suggestKeyOptions", () => {
  it("automatic and typing ship the measured selection options for SQL and PromQL", () => {
    for (const mode of ["automatic", "typing"] as const) {
      for (const language of ["sql", "promql"]) {
        expect(suggestKeyOptions(mode, language)).toMatchObject({
          suggest: { selectionMode: "whenQuickSuggestion" },
          acceptSuggestionOnEnter: "smart",
          inlineSuggest: { suppressSuggestions: false },
        });
      }
    }
  });

  it("off is Monaco's own defaults, so switching to it restores today's editor", () => {
    expect(suggestKeyOptions("off", "sql")).toEqual({
      suggest: { selectionMode: "always" },
      acceptSuggestionOnEnter: "on",
    });
  });

  it("never touches editors outside the contract", () => {
    for (const language of ["vrl", "javascript", "json", "markdown"]) {
      expect(suggestKeyOptions("automatic", language)).toEqual({});
      expect(followsKeyContract("automatic", language)).toBe(false);
    }
  });
});

describe("the Tab rule", () => {
  beforeEach(() => resetKeyContractForTests());

  const editorWithCaret = () => ({ hasTextFocus: () => true, trigger: vi.fn() });
  const picked = (editor: any) => editor.trigger.mock.calls.map((c: any[]) => c[1]);

  it("Tab on an unhighlighted menu picks row 1", () => {
    const editor = editorWithCaret();
    const monaco = makeMonaco([editor]);
    setTabPicksFirst(monaco, true);
    expect(monaco.pressTab(UNHIGHLIGHTED_MENU)).toBe("rule");
    expect(picked(editor)).toEqual(["selectNextSuggestion", "acceptSelectedSuggestion"]);
  });

  it("Tab is left alone when a row is already highlighted or no menu is open", () => {
    const monaco = makeMonaco([editorWithCaret()]);
    setTabPicksFirst(monaco, true);
    expect(
      monaco.pressTab({ ...UNHIGHLIGHTED_MENU, suggestWidgetHasFocusedSuggestion: true }),
    ).toBe("indent");
    expect(monaco.pressTab({ ...UNHIGHLIGHTED_MENU, suggestWidgetVisible: false })).toBe("indent");
  });

  it("asking twice still accepts once per Tab", () => {
    const editor = editorWithCaret();
    const monaco = makeMonaco([editor]);
    setTabPicksFirst(monaco, true);
    setTabPicksFirst(monaco, true);
    monaco.pressTab(UNHIGHLIGHTED_MENU);
    expect(picked(editor)).toEqual(["selectNextSuggestion", "acceptSelectedSuggestion"]);
  });

  it("switching to off gives Tab back to indentation, and switching back restores the rule", () => {
    const monaco = makeMonaco([editorWithCaret()]);
    setTabPicksFirst(monaco, true);
    setTabPicksFirst(monaco, false);
    expect(monaco.pressTab(UNHIGHLIGHTED_MENU)).toBe("indent");
    setTabPicksFirst(monaco, true);
    expect(monaco.pressTab(UNHIGHLIGHTED_MENU)).toBe("rule");
  });

  it("acts only on the editor that holds the caret", () => {
    const idle = { hasTextFocus: () => false, trigger: vi.fn() };
    const focused = editorWithCaret();
    const monaco = makeMonaco([idle, focused]);
    setTabPicksFirst(monaco, true);
    monaco.pressTab(UNHIGHLIGHTED_MENU);
    expect(idle.trigger).not.toHaveBeenCalled();
    expect(picked(focused)).toHaveLength(2);
  });

  it("does nothing when no editor has focus", () => {
    const monaco = makeMonaco([{ hasTextFocus: () => false, trigger: vi.fn() }]);
    setTabPicksFirst(monaco, true);
    expect(() => monaco.pressTab(UNHIGHLIGHTED_MENU)).not.toThrow();
  });
});

describe("item commands", () => {
  beforeEach(() => resetKeyContractForTests());

  const run = (monaco: any, command: { id: string; arguments?: unknown[] }) => {
    const handler = (monaco.editor.registerCommand.mock.calls as any[]).find(
      (c) => c[0] === command.id,
    )[1];
    handler({}, ...(command.arguments ?? []));
  };

  it("the SQL trigger set adds = < > but never ! alone", () => {
    expect(triggerCharactersFor("sql")).toEqual(expect.arrayContaining(SQL_VALUE_TRIGGERS));
    expect(triggerCharactersFor("sql")).not.toContain("!");
    expect(triggerCharactersFor("promql")).toContain("=");
    expect(triggerCharactersFor("promql")).not.toContain("<");
  });

  it("accepting a chaining item types a real space from the keyboard after reporting the accept", () => {
    const order: string[] = [];
    const editor = {
      hasTextFocus: () => true,
      trigger: vi.fn((source: string, handler: string, payload: any) =>
        order.push(`${source}:${handler}:${payload.text}`),
      ),
    };
    const monaco = makeMonaco([editor]);
    const listener = vi.fn(() => order.push("listener"));
    registerAcceptCommands(monaco, listener);
    run(monaco, acceptCommand("field", true));
    expect(listener).toHaveBeenCalledWith(editor, "field", true);
    expect(order).toEqual(["listener", "keyboard:type: "]);
  });

  it("accepting any other item reports it and types nothing", () => {
    const editor = { hasTextFocus: () => true, trigger: vi.fn() };
    const monaco = makeMonaco([editor]);
    const listener = vi.fn();
    registerAcceptCommands(monaco, listener);
    run(monaco, acceptCommand("value", false));
    expect(listener).toHaveBeenCalledWith(editor, "value", false);
    expect(editor.trigger).not.toHaveBeenCalled();
  });

  // A one-line editor that applies edits and moves the caret only through the edit's end cursor state, as redo does.
  const lineEditor = (text: string, caretColumn: number) => {
    const state = { text, caret: { lineNumber: 1, column: caretColumn } };
    return {
      state,
      hasTextFocus: () => true,
      trigger: vi.fn(),
      pushUndoStop: vi.fn(),
      getPosition: () => state.caret,
      executeEdits: (_source: string, edits: any[], endCursorState?: any[]) => {
        for (const { range, text: inserted } of edits) {
          state.text =
            state.text.slice(0, range.startColumn - 1) +
            inserted +
            state.text.slice(range.endColumn - 1);
        }
        const [end] = endCursorState ?? [];
        if (end) state.caret = { lineNumber: end.positionLineNumber, column: end.positionColumn };
        return true;
      },
    };
  };
  const wrap = (editor: any, field: string, startColumn: number, openValues = false) => {
    resetKeyContractForTests();
    const monaco = makeMonaco([editor]);
    registerAcceptCommands(monaco, vi.fn());
    run(
      monaco,
      wrapFieldCommand({ fn: "str_match", field, lineNumber: 1, startColumn, openValues }),
    );
  };

  it("a match-function row rewrites `level ` into str_match(level, '') with the caret in the quotes", () => {
    const editor = lineEditor("WHERE level ", 13);
    wrap(editor, "level", 7);
    expect(editor.state.text).toBe("WHERE str_match(level, '')");
    expect(editor.state.caret.column).toBe("WHERE str_match(level, '".length + 1);
  });

  it("wraps a qualified field whole", () => {
    const editor = lineEditor("WHERE t.level ", 15);
    wrap(editor, "t.level", 7);
    expect(editor.state.text).toBe("WHERE str_match(t.level, '')");
  });

  it("opens the value menu quietly only when asked", () => {
    const quiet = lineEditor("WHERE level ", 13);
    wrap(quiet, "level", 7);
    expect(quiet.trigger).not.toHaveBeenCalled();
    const values = lineEditor("WHERE level ", 13);
    wrap(values, "level", 7, true);
    expect(values.trigger).toHaveBeenCalledWith("keyboard", "editor.action.triggerSuggest", {
      auto: true,
    });
  });

  it("does not rewrite when the caret has left the line", () => {
    const editor = lineEditor("WHERE level ", 13);
    editor.state.caret = { lineNumber: 3, column: 1 };
    wrap(editor, "level", 7);
    expect(editor.state.text).toBe("WHERE level ");
  });
});

describe("header and status rows are never a keyboard target", () => {
  beforeEach(() => resetKeyContractForTests());

  const H = (label: string) => ({ label, o2skip: true });
  const row = (label: string) => ({ label });

  // A suggest list that, like Monaco, resolves an item as it gains focus and caches only items that settle.
  const listEditor = (items: any[]) => {
    items.forEach((item, i) => (item.sortText = String(i).padStart(3, "0")));
    noteMenuItems(items);
    const state = { focus: -1, accepted: null as any };
    const focus = (i: number) => {
      state.focus = (i + items.length) % items.length;
      noteResolvedItem(items[state.focus]);
    };
    const moves: Record<string, () => void> = {
      selectNextSuggestion: () => focus(state.focus + 1),
      selectPrevSuggestion: () => focus(state.focus <= 0 ? items.length - 1 : state.focus - 1),
      selectNextPageSuggestion: () => focus(Math.min(items.length - 1, state.focus + 3)),
      selectPrevPageSuggestion: () => focus(Math.max(0, state.focus - 3)),
      acceptSelectedSuggestion: () => (state.accepted = items[state.focus]),
    };
    const editor = {
      hasTextFocus: () => true,
      trigger: vi.fn((_s: string, id: string) => moves[id]?.()),
    };
    return { editor, state, focused: () => items[state.focus]?.label };
  };

  it("Tab on a menu that starts with a header takes the first real row", () => {
    const { editor, state } = listEditor([H("Values"), row("'error'"), H("Fields"), row("level")]);
    const monaco = makeMonaco([editor]);
    setTabPicksFirst(monaco, true);
    monaco.pressTab(UNHIGHLIGHTED_MENU);
    expect(state.accepted.label).toBe("'error'");
  });

  it("Tab on a menu of only a header and a status row inserts nothing and closes the menu", () => {
    const { editor, state } = listEditor([H("Values"), H("Still loading")]);
    const monaco = makeMonaco([editor]);
    setTabPicksFirst(monaco, true);
    monaco.pressTab(UNHIGHLIGHTED_MENU);
    expect(state.accepted).toBeNull();
    expect(editor.trigger.mock.calls.map((c: any[]) => c[1])).toContain("hideSuggestWidget");
  });

  it("a long list that opens highlighted scrolls back so its first header shows", async () => {
    vi.useFakeTimers();
    const items = [H("Operators"), ...Array.from({ length: 13 }, (_, i) => row(`op${i}`))];
    const { editor } = listEditor(items);
    const host = document.createElement("div");
    host.className = QUERY_EDITOR_CLASS;
    Object.assign(editor, { getContainerDomNode: () => host });
    const monaco = makeMonaco([editor]);
    setTabPicksFirst(monaco, true);
    noteMenuItems(items, editor);
    noteResolvedItem(items[1]);
    vi.runAllTimers();
    expect(editor.trigger.mock.calls.map((c: any[]) => c[1])).toEqual([
      "selectPrevSuggestion",
      "selectNextSuggestion",
    ]);
    vi.useRealTimers();
  });

  it("never moves the highlight in another editor, or once the menu has closed", async () => {
    vi.useFakeTimers();
    const items = [H("Operators"), ...Array.from({ length: 13 }, (_, i) => row(`op${i}`))];
    const sql = listEditor(items).editor;
    Object.assign(sql, {
      getContainerDomNode: () =>
        Object.assign(document.createElement("div"), { className: QUERY_EDITOR_CLASS }),
    });
    const vrl = listEditor([row("a")]).editor;
    Object.assign(vrl, { getContainerDomNode: () => document.createElement("div") });
    const monaco = makeMonaco([vrl]);
    setTabPicksFirst(monaco, true);
    noteMenuItems(items, sql);
    noteResolvedItem({ label: "vrl row" });
    vi.runAllTimers();
    expect(vrl.trigger).not.toHaveBeenCalled();
    vi.mocked(monaco.editor.getEditors).mockReturnValue([sql]);
    noteMenuItems(items, sql);
    forgetMenu();
    noteResolvedItem(items[1]);
    vi.runAllTimers();
    expect(sql.trigger).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("Tab steps over a status row as well", () => {
    const { editor, state } = listEditor([
      H("Values"),
      H("Still loading"),
      H("Fields"),
      row("level"),
    ]);
    const monaco = makeMonaco([editor]);
    setTabPicksFirst(monaco, true);
    monaco.pressTab(UNHIGHLIGHTED_MENU);
    expect(state.accepted.label).toBe("level");
  });

  it("↓ from an unhighlighted menu and Ctrl+Space land on the first real row", async () => {
    const monaco = makeMonaco([]);
    const { editor, focused } = listEditor([
      H("Values"),
      row("'error'"),
      row("'warn'"),
      H("Fields"),
      row("level"),
    ]);
    vi.mocked(monaco.editor.getEditors).mockReturnValue([editor]);
    setTabPicksFirst(monaco, true);
    await monaco.run("o2.suggest.nav.next");
    expect(focused()).toBe("'error'");
    await monaco.run("o2.suggest.nav.next");
    await monaco.run("o2.suggest.nav.next");
    expect(focused(), "the second header is stepped over").toBe("level");
  });

  it("↑ onto the first header turns back down, so it never wraps onto a header", async () => {
    const monaco = makeMonaco([]);
    const { editor, focused } = listEditor([
      H("Values"),
      row("'error'"),
      H("Fields"),
      row("level"),
    ]);
    vi.mocked(monaco.editor.getEditors).mockReturnValue([editor]);
    setTabPicksFirst(monaco, true);
    await monaco.run("o2.suggest.nav.next");
    await monaco.run("o2.suggest.nav.prev");
    expect(focused()).toBe("'error'");
  });

  it("a page move waits for the list before stepping off a header", async () => {
    const monaco = makeMonaco([]);
    const { editor, focused } = listEditor([
      H("Values"),
      row("a"),
      row("b"),
      H("Fields"),
      row("c"),
    ]);
    vi.mocked(monaco.editor.getEditors).mockReturnValue([editor]);
    setTabPicksFirst(monaco, true);
    await monaco.run("o2.suggest.nav.next");
    await monaco.run("o2.suggest.nav.nextPage");
    expect(focused()).toBe("c");
  });

  it("takes the arrows, pages and Ctrl+Space only in an editor with grouped menus", () => {
    const monaco = makeMonaco([]);
    setTabPicksFirst(monaco, true);
    const open = { suggestWidgetVisible: true, textInputFocus: true };
    const grouped = { ...open, [NAV_SKIP_CONTEXT_KEY]: true };
    for (const key of [18, 16, 12, 11, 256 | 44, 256 | 46]) {
      expect(monaco.press(key, grouped), `key ${key}`).toBe("rule");
      expect(monaco.press(key, open), `key ${key} elsewhere`).toBe("default");
    }
    expect(monaco.press(2048 | 10, grouped), "Ctrl+Space on an unhighlighted menu").toBe("rule");
    expect(
      monaco.press(2048 | 10, { ...grouped, suggestWidgetHasFocusedSuggestion: true }),
      "Ctrl+Space with a row already highlighted stays Monaco's",
    ).toBe("default");
    setTabPicksFirst(monaco, false);
    expect(monaco.press(18, grouped)).toBe("default");
  });

  it("swallows a click that falls through a header onto the rows container", () => {
    const monaco = makeMonaco([]);
    setTabPicksFirst(monaco, true);
    const host = document.createElement("div");
    host.className = QUERY_EDITOR_CLASS;
    const widget = document.createElement("div");
    widget.className = "suggest-widget";
    host.appendChild(widget);
    const rows = document.createElement("div");
    rows.className = "monaco-list-rows";
    widget.appendChild(rows);
    document.body.appendChild(host);
    const click = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    rows.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    setTabPicksFirst(monaco, false);
    const after = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    rows.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
    host.remove();
  });

  it("leaves a click in another editor's suggest widget alone", () => {
    const monaco = makeMonaco([]);
    setTabPicksFirst(monaco, true);
    const widget = document.createElement("div");
    widget.className = "suggest-widget";
    const rows = document.createElement("div");
    rows.className = "monaco-list-rows";
    widget.appendChild(rows);
    document.body.appendChild(widget);
    const click = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    rows.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
    widget.remove();
  });
});

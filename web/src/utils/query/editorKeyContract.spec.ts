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
  followsKeyContract,
  resetKeyContractForTests,
  setTabPicksFirst,
  suggestKeyOptions,
} from "./editorKeyContract";

const makeMonaco = (editors: any[] = []) => {
  const rules: any[] = [];
  const commands = new Map<string, () => void>();
  return {
    KeyCode: { Tab: 2 },
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
      registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
    },
    // Presses Tab against the registered rules: a matching rule runs its command, otherwise Tab indents.
    pressTab: (context: Record<string, boolean>): "rule" | "indent" => {
      const holds = (when: string) =>
        when.split(" && ").every((k) => (k.startsWith("!") ? !context[k.slice(1)] : !!context[k]));
      const hits = rules.filter((r) => r.keybinding === 2 && holds(r.when));
      if (!hits.length) return "indent";
      hits.forEach((r) => commands.get(r.command)?.());
      return "rule";
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

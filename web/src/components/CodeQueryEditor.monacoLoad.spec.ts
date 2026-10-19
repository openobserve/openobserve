// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createStore } from "vuex";
import CodeQueryEditor from "./CodeQueryEditor.vue";

// Any Monaco service call before editor.all.js finishes initialises StandaloneServices without the contributions' singletons.
const load = vi.hoisted(() => {
  let release!: () => void;
  let entered!: () => void;
  const state = {
    contributionsLoaded: false,
    early: [] as string[],
    released: new Promise<void>((resolve) => (release = resolve)),
    started: new Promise<void>((resolve) => (entered = resolve)),
    release: () => release(),
    entered: () => entered(),
  };
  return state;
});

const track =
  <T>(name: string, result?: T) =>
  (..._args: unknown[]) => {
    if (!load.contributionsLoaded) load.early.push(name);
    return result;
  };

const mockModel = {
  getValue: vi.fn(() => ""),
  setValue: vi.fn(),
  getLineCount: vi.fn(() => 1),
  getLineLength: vi.fn(() => 0),
  getOffsetAt: vi.fn(() => 0),
  getPositionAt: vi.fn(() => ({ lineNumber: 1, column: 1 })),
  getLineContent: vi.fn(() => ""),
  getValueInRange: vi.fn(() => ""),
  getWordUntilPosition: vi.fn(() => ({ word: "", startColumn: 1, endColumn: 1 })),
  getValueLength: vi.fn(() => 0),
  uri: { toString: () => "inmemory://model" },
};

const mockEditor = {
  onDidChangeModelContent: vi.fn(),
  createContextKey: vi.fn(),
  addCommand: vi.fn(),
  onKeyDown: vi.fn(),
  onDidFocusEditorWidget: vi.fn(),
  onDidBlurEditorWidget: vi.fn(),
  onDidBlurEditorText: vi.fn(),
  onDidChangeCursorPosition: vi.fn(),
  createDecorationsCollection: vi.fn(() => ({ set: vi.fn(), clear: vi.fn() })),
  dispose: vi.fn(),
  getValue: vi.fn(() => ""),
  setValue: vi.fn(),
  layout: vi.fn(),
  getModel: vi.fn(() => mockModel),
  updateOptions: vi.fn(),
  hasWidgetFocus: vi.fn(() => false),
  getRawOptions: vi.fn(() => ({ readOnly: false })),
  deltaDecorations: vi.fn(() => []),
  getPosition: vi.fn(() => ({ lineNumber: 1, column: 1 })),
  trigger: vi.fn(),
  getAction: vi.fn(() => ({ run: vi.fn(() => Promise.resolve()) })),
};

vi.mock("monaco-editor/esm/vs/editor/editor.all.js", async () => {
  load.entered();
  await load.released;
  load.contributionsLoaded = true;
  return {};
});

vi.mock("monaco-editor/esm/vs/editor/editor.api", () => {
  const disposable = { dispose: () => {} };
  return {
    default: {},
    editor: {
      create: vi.fn(track("editor.create", mockEditor)),
      defineTheme: vi.fn(track("editor.defineTheme")),
      setTheme: vi.fn(track("editor.setTheme")),
      setModelMarkers: vi.fn(),
      setModelLanguage: vi.fn(),
      TrackedRangeStickiness: { NeverGrowsWhenTypingAtEdges: 1 },
      addCommand: vi.fn(track("editor.addCommand", disposable)),
      addKeybindingRule: vi.fn(track("editor.addKeybindingRule", disposable)),
      addKeybindingRules: vi.fn(track("editor.addKeybindingRules", disposable)),
      registerCommand: vi.fn(track("editor.registerCommand", disposable)),
      getEditors: vi.fn(() => []),
    },
    languages: {
      CompletionItemKind: {
        Method: 0,
        Function: 1,
        Constructor: 2,
        Field: 3,
        Variable: 4,
        Operator: 11,
        Value: 13,
        Keyword: 17,
        Text: 18,
        Snippet: 27,
      },
      CompletionItemInsertTextRule: { None: 0, KeepWhitespace: 1, InsertAsSnippet: 4 },
      register: vi.fn(),
      setMonarchTokensProvider: vi.fn(),
      setLanguageConfiguration: vi.fn(),
      registerCompletionItemProvider: vi.fn(track("languages.registerCompletion", disposable)),
      registerSignatureHelpProvider: vi.fn(track("languages.registerSignatureHelp", disposable)),
      registerHoverProvider: vi.fn(track("languages.registerHover", disposable)),
    },
    KeyMod: { CtrlCmd: 2048, WinCtrl: 256 },
    KeyCode: {
      Backspace: 1,
      Tab: 2,
      Enter: 13,
      Escape: 9,
      Space: 10,
      PageUp: 11,
      PageDown: 12,
      UpArrow: 16,
      DownArrow: 18,
      KeyI: 39,
      KeyN: 44,
      KeyP: 46,
      KeyZ: 56,
    },
    Range: class {
      constructor(...args: number[]) {
        Object.assign(this, { args });
      }
    },
  };
});

vi.mock("monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js", () => ({}));
vi.mock("@/composables/useLogs/searchState", () => ({
  default: () => ({ searchObj: { data: {}, meta: {} } }),
  searchState: () => ({ searchObj: { data: {}, meta: {} } }),
}));
vi.mock("@/composables/useNLQuery", () => ({
  useNLQuery: () => ({
    detectNaturalLanguage: vi.fn(() => false),
    generateSQL: vi.fn(() => Promise.resolve(null)),
    transformToSQL: vi.fn((_nl: string, sql: string) => sql),
    isGenerating: { value: false },
    streamingResponse: { value: "" },
  }),
}));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/composables/useNotifications", () => ({
  default: () => ({ showErrorNotification: vi.fn(), showPositiveNotification: vi.fn() }),
}));
vi.mock("@/utils/zincutils", () => ({ getImageURL: vi.fn((path: string) => `/mocked/${path}`) }));
vi.mock("@/utils/query/vrlLanguageDefinition", () => ({ vrlLanguageDefinition: {} }));

const attachHost = (id: string) => {
  const host = document.createElement("div");
  host.id = id;
  document.body.appendChild(host);
};

const mountEditor = (editorId: string) =>
  mount(CodeQueryEditor, {
    props: { editorId, query: "SELECT * FROM logs", language: "sql" },
    global: { plugins: [createStore({ state: { theme: "light" } })] },
  });

const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

describe("CodeQueryEditor Monaco loading", () => {
  it("makes an editor mounted mid-load wait until every Monaco contribution has loaded", async () => {
    const monacoApi: any = await import("monaco-editor/esm/vs/editor/editor.api");
    attachHost("editor-first");
    attachHost("editor-second");

    const first = mountEditor("editor-first");
    await load.started;
    const second = mountEditor("editor-second");
    await settle();

    expect(load.early).toEqual([]);
    expect(monacoApi.editor.create).not.toHaveBeenCalled();

    load.release();
    await vi.waitFor(() => expect(monacoApi.editor.create).toHaveBeenCalledTimes(2));
    expect(load.early).toEqual([]);

    first.unmount();
    second.unmount();
  });
});

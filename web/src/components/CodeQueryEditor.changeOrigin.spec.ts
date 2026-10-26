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

// Monaco reports a programmatic write like typing, so update:query must carry which it was — see SearchBar.programmaticClear.spec.ts for what reading it wrong costs.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createStore } from "vuex";
import CodeQueryEditor from "./CodeQueryEditor.vue";

let contentHandler: ((e: any) => void) | null = null;
let currentValue = "SELECT * FROM logs";

const mockModel = {
  getValue: vi.fn(() => currentValue),
  setValue: vi.fn((v: string) => {
    currentValue = v;
    contentHandler?.({ isFlush: true, changes: [] });
  }),
  getLineCount: vi.fn(() => 1),
  getLineLength: vi.fn(() => 0),
  pushEditOperations: vi.fn(),
  getOffsetAt: vi.fn(() => 0),
  getPositionAt: vi.fn(() => ({ lineNumber: 1, column: 1 })),
  getLineContent: vi.fn(() => ""),
  getValueInRange: vi.fn(() => ""),
  getWordUntilPosition: vi.fn(() => ({ word: "", startColumn: 1, endColumn: 1 })),
  getValueLength: vi.fn(() => currentValue.length),
  uri: { toString: () => "inmemory://model" },
};

const mockEditorObj = {
  onDidChangeModelContent: vi.fn((cb: (e: any) => void) => {
    contentHandler = cb;
  }),
  createContextKey: vi.fn(() => ({ set: vi.fn() })),
  addCommand: vi.fn(),
  addAction: vi.fn(),
  onKeyDown: vi.fn(),
  onDidFocusEditorWidget: vi.fn(),
  onDidBlurEditorWidget: vi.fn(),
  onDidBlurEditorText: vi.fn(),
  onDidChangeCursorPosition: vi.fn(),
  createDecorationsCollection: vi.fn(() => ({ set: vi.fn(), clear: vi.fn() })),
  dispose: vi.fn(),
  getValue: vi.fn(() => currentValue),
  setValue: vi.fn((v: string) => mockModel.setValue(v)),
  layout: vi.fn(),
  getModel: vi.fn(() => mockModel),
  updateOptions: vi.fn(),
  hasWidgetFocus: vi.fn(() => false),
  getRawOptions: vi.fn(() => ({ readOnly: false })),
  deltaDecorations: vi.fn(() => []),
  getPosition: vi.fn(() => ({ lineNumber: 1, column: 1 })),
  getSelections: vi.fn(() => []),
  getSelection: vi.fn(() => ({ isEmpty: () => true })),
  trigger: vi.fn(),
  pushUndoStop: vi.fn(),
  executeEdits: vi.fn(),
  getAction: vi.fn(() => ({ run: vi.fn(() => Promise.resolve()) })),
};

vi.mock("monaco-editor/esm/vs/editor/editor.all.js", () => ({}));
vi.mock("monaco-editor/esm/vs/editor/editor.api", () => {
  const disposable = { dispose: vi.fn() };
  return {
    default: {},
    editor: {
      create: vi.fn(() => mockEditorObj),
      defineTheme: vi.fn(),
      setTheme: vi.fn(),
      setModelMarkers: vi.fn(),
      setModelLanguage: vi.fn(),
      TrackedRangeStickiness: { NeverGrowsWhenTypingAtEdges: 1 },
      addCommand: vi.fn(() => disposable),
      addKeybindingRule: vi.fn(() => disposable),
      addKeybindingRules: vi.fn(() => disposable),
      registerCommand: vi.fn(() => disposable),
      getEditors: vi.fn(() => []),
    },
    languages: {
      CompletionItemKind: { Keyword: 17, Text: 18, Snippet: 27, Field: 3, Value: 13 },
      CompletionItemInsertTextRule: { None: 0, KeepWhitespace: 1, InsertAsSnippet: 4 },
      register: vi.fn(),
      setMonarchTokensProvider: vi.fn(),
      setLanguageConfiguration: vi.fn(),
      registerCompletionItemProvider: vi.fn(() => disposable),
      registerSignatureHelpProvider: vi.fn(() => disposable),
      registerHoverProvider: vi.fn(() => disposable),
    },
    KeyMod: { CtrlCmd: 2048, WinCtrl: 256 },
    KeyCode: { Enter: 13, Escape: 9, Space: 10 },
    Range: class {
      constructor(...args: number[]) {
        Object.assign(this, { args });
      }
    },
    Selection: class {
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
vi.mock("@/utils/zincutils", () => ({ getImageURL: vi.fn((p: string) => `/mocked/${p}`) }));
vi.mock("@/utils/query/vrlLanguageDefinition", () => ({ vrlLanguageDefinition: {} }));

const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

// setupEditor() looks its container up by id on the document, so the editor needs one there.
const attachHost = (id: string) => {
  const host = document.createElement("div");
  host.id = id;
  document.body.appendChild(host);
  return host;
};

const lastOrigin = (wrapper: any) => {
  const emissions = wrapper.emitted("update:query") ?? [];
  return emissions[emissions.length - 1]?.[2];
};

describe("CodeQueryEditor — update:query reports where the change came from", () => {
  let wrapper: any;

  beforeEach(async () => {
    currentValue = "SELECT * FROM logs";
    contentHandler = null;
    attachHost("origin-editor");
    wrapper = mount(CodeQueryEditor, {
      props: {
        editorId: "origin-editor",
        query: "SELECT * FROM logs",
        language: "sql",
        debounceTime: 1,
      },
      global: { plugins: [createStore({ state: { theme: "light" } })] },
    });
    await settle();
  });

  afterEach(() => {
    wrapper?.unmount();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("creates the editor, so the change handler under test is the real one", () => {
    expect(contentHandler).toBeTypeOf("function");
  });

  it("marks a write through setValue as not from the user", async () => {
    wrapper.vm.setValue("");
    await settle();

    expect(lastOrigin(wrapper)).toEqual({ fromUser: false });
  });

  it("marks typing as from the user", async () => {
    currentValue = "code = 200";
    contentHandler?.({
      isFlush: false,
      changes: [{ range: { startLineNumber: 1, startColumn: 1 }, text: "0" }],
    });
    await settle();

    expect(lastOrigin(wrapper)).toEqual({ fromUser: true });
  });

  it("reports a programmatic write that lands in the same debounce window as typing", async () => {
    // The debounce emits the latest value, so the origin has to describe that value — not whatever happened first in the window.
    currentValue = "code = 200";
    contentHandler?.({
      isFlush: false,
      changes: [{ range: { startLineNumber: 1, startColumn: 1 }, text: "0" }],
    });
    wrapper.vm.setValue("");
    await settle();

    const emissions = wrapper.emitted("update:query") ?? [];
    expect(emissions[emissions.length - 1]?.[0]).toBe("");
    expect(lastOrigin(wrapper)).toEqual({ fromUser: false });
  });

  it("does not carry a user edit over into the next programmatic write", async () => {
    currentValue = "code = 200";
    contentHandler?.({
      isFlush: false,
      changes: [{ range: { startLineNumber: 1, startColumn: 1 }, text: "0" }],
    });
    await settle();
    expect(lastOrigin(wrapper)).toEqual({ fromUser: true });

    wrapper.vm.setValue("");
    await settle();

    expect(lastOrigin(wrapper)).toEqual({ fromUser: false });
  });
});

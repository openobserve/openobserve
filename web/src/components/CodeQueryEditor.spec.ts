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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import CodeQueryEditor from "./CodeQueryEditor.vue";
import { createStore } from "vuex";

installQuasar();

// Stable mock editor instance so tests can reference it directly
const mockEditorObj = {
  onDidChangeModelContent: vi.fn(),
  createContextKey: vi.fn(),
  addCommand: vi.fn(),
  onDidFocusEditorWidget: vi.fn(),
  onDidBlurEditorWidget: vi.fn(),
  dispose: vi.fn(),
  getValue: vi.fn(() => ""),
  setValue: vi.fn(),
  layout: vi.fn(),
  getModel: vi.fn(() => ({
    getValue: vi.fn(() => ""),
    setValue: vi.fn(),
    getLineCount: vi.fn(() => 1),
    getLineLength: vi.fn(() => 0),
    pushEditOperations: vi.fn(),
    getOffsetAt: vi.fn(() => 0),
  })),
  updateOptions: vi.fn(),
  hasWidgetFocus: vi.fn(() => false),
  getRawOptions: vi.fn(() => ({ readOnly: false })),
  deltaDecorations: vi.fn(() => []),
  getPosition: vi.fn(() => ({ lineNumber: 1, column: 1 })),
  trigger: vi.fn(),
  getAction: vi.fn(() => ({ run: vi.fn(() => Promise.resolve()) })),
};

// Simple mock for monaco editor
vi.mock("monaco-editor/esm/vs/editor/editor.all.js", () => ({}));
vi.mock("monaco-editor/esm/vs/editor/editor.api", () => ({
  default: {},
  editor: {
    create: vi.fn(() => mockEditorObj),
    defineTheme: vi.fn(),
    setTheme: vi.fn(),
    setModelMarkers: vi.fn(),
  },
  languages: {
    CompletionItemKind: {},
    CompletionItemInsertTextRule: {},
    register: vi.fn(),
    setMonarchTokensProvider: vi.fn(),
    registerCompletionItemProvider: vi.fn(() => ({ dispose: vi.fn() })),
  },
  KeyMod: { CtrlCmd: 1 },
  KeyCode: { Enter: 13 },
}));

// Mock dynamic imports
vi.mock(
  "monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js",
  () => ({}),
);
vi.mock(
  "monaco-editor/esm/vs/language/json/monaco.contribution.js",
  () => ({}),
);
vi.mock(
  "monaco-editor/esm/vs/language/html/monaco.contribution.js",
  () => ({}),
);
vi.mock(
  "monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js",
  () => ({}),
);
vi.mock(
  "monaco-editor/esm/vs/basic-languages/python/python.contribution.js",
  () => ({}),
);
vi.mock(
  "monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js",
  () => ({}),
);

// Fix: component imports default from "@/composables/useLogs/searchState"
vi.mock("@/composables/useLogs/searchState", () => ({
  default: () => ({
    searchObj: { data: {}, meta: {} },
  }),
  searchState: () => ({
    searchObj: { data: {}, meta: {} },
  }),
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

vi.mock("vue-i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@/composables/useNotifications", () => ({
  default: () => ({
    showErrorNotification: vi.fn(),
    showPositiveNotification: vi.fn(),
  }),
}));

vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn((path: string) => `/mocked/${path}`),
}));

vi.mock("@/utils/query/vrlLanguageDefinition", () => ({
  vrlLanguageDefinition: {},
}));

describe("CodeQueryEditor", () => {
  let store: any;

  beforeEach(() => {
    store = createStore({
      state: {
        theme: "light",
      },
    });
    // Reset call histories on the stable editor instance so each test starts clean
    Object.values(mockEditorObj).forEach((fn) => {
      if (typeof fn === "function" && "mockClear" in fn) {
        (fn as ReturnType<typeof vi.fn>).mockClear();
      }
    });
    vi.clearAllMocks();
  });

  const createWrapper = (props: any = {}) => {
    return mount(CodeQueryEditor, {
      props: {
        editorId: "test-editor",
        query: "SELECT * FROM logs",
        ...props,
      },
      global: {
        plugins: [store],
      },
    });
  };

  describe("Component Rendering", () => {
    it("should render the component", () => {
      const wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should have query editor element", () => {
      const wrapper = createWrapper();
      expect(wrapper.find('[data-test="query-editor"]').exists()).toBe(true);
    });

    it("should apply correct editorId", () => {
      const wrapper = createWrapper({ editorId: "my-custom-editor" });
      const editor = wrapper.find('[data-test="query-editor"]');
      expect(editor.attributes("id")).toBe("my-custom-editor");
    });

    it("should have editorRef", () => {
      const wrapper = createWrapper();
      expect(wrapper.vm.editorRef).toBeDefined();
    });

    it("should have logs-query-editor class", () => {
      const wrapper = createWrapper();
      expect(wrapper.find(".logs-query-editor").exists()).toBe(true);
    });
  });

  describe("Props", () => {
    it("should accept editorId prop", () => {
      const wrapper = createWrapper({ editorId: "custom-id" });
      expect(wrapper.props("editorId")).toBe("custom-id");
    });

    it("should have default editorId", () => {
      const wrapper = createWrapper({ editorId: undefined });
      expect(wrapper.props("editorId")).toBe("editor");
    });

    it("should accept query prop", () => {
      const wrapper = createWrapper({ query: "SELECT * FROM users" });
      expect(wrapper.props("query")).toBe("SELECT * FROM users");
    });

    it("should have default query as empty string", () => {
      const wrapper = createWrapper({ query: undefined });
      expect(wrapper.props("query")).toBe("");
    });

    it("should accept showAutoComplete prop", () => {
      const wrapper = createWrapper({ showAutoComplete: false });
      expect(wrapper.props("showAutoComplete")).toBe(false);
    });

    it("should have showAutoComplete default as true", () => {
      const wrapper = createWrapper({ showAutoComplete: undefined });
      expect(wrapper.props("showAutoComplete")).toBe(true);
    });

    it("should accept keywords array prop", () => {
      const keywords = [
        { label: "SELECT", kind: "Keyword", insertText: "SELECT" },
      ];
      const wrapper = createWrapper({ keywords });
      expect(wrapper.props("keywords")).toEqual(keywords);
    });

    it("should have empty keywords array as default", () => {
      const wrapper = createWrapper({ keywords: undefined });
      expect(wrapper.props("keywords")).toEqual([]);
    });

    it("should accept suggestions array prop", () => {
      const suggestions = [{ label: () => "test", kind: "Text" }];
      const wrapper = createWrapper({ suggestions });
      expect(wrapper.props("suggestions")).toEqual(suggestions);
    });

    it("should have null suggestions as default", () => {
      const wrapper = createWrapper({ suggestions: undefined });
      expect(wrapper.props("suggestions")).toBeNull();
    });

    it("should accept debounceTime prop", () => {
      const wrapper = createWrapper({ debounceTime: 1000 });
      expect(wrapper.props("debounceTime")).toBe(1000);
    });

    it("should have default debounceTime of 500", () => {
      const wrapper = createWrapper({ debounceTime: undefined });
      expect(wrapper.props("debounceTime")).toBe(500);
    });

    it("should accept readOnly prop", () => {
      const wrapper = createWrapper({ readOnly: true });
      expect(wrapper.props("readOnly")).toBe(true);
    });

    it("should have readOnly default as false", () => {
      const wrapper = createWrapper({ readOnly: undefined });
      expect(wrapper.props("readOnly")).toBe(false);
    });

    it("should accept language prop", () => {
      const wrapper = createWrapper({ language: "json" });
      expect(wrapper.props("language")).toBe("json");
    });

    it("should have default language as sql", () => {
      const wrapper = createWrapper({ language: undefined });
      expect(wrapper.props("language")).toBe("sql");
    });

    it("should accept functions array prop", () => {
      const functions = ["count", "sum", "avg"];
      const wrapper = createWrapper({ functions });
      expect(wrapper.props("functions")).toEqual(functions);
    });

    it("should have empty functions array as default", () => {
      const wrapper = createWrapper({ functions: undefined });
      expect(wrapper.props("functions")).toEqual([]);
    });

    it("should accept fields array prop", () => {
      const fields = ["user_id", "timestamp", "message"];
      const wrapper = createWrapper({ fields });
      expect(wrapper.props("fields")).toEqual(fields);
    });

    it("should have empty fields array as default", () => {
      const wrapper = createWrapper({ fields: undefined });
      expect(wrapper.props("fields")).toEqual([]);
    });
  });

  describe("Exposed Methods", () => {
    it("should expose setValue method", () => {
      const wrapper = createWrapper();
      expect(wrapper.vm.setValue).toBeDefined();
      expect(typeof wrapper.vm.setValue).toBe("function");
    });

    it("should expose resetEditorLayout method", () => {
      const wrapper = createWrapper();
      expect(wrapper.vm.resetEditorLayout).toBeDefined();
      expect(typeof wrapper.vm.resetEditorLayout).toBe("function");
    });

    it("should expose disableSuggestionPopup method", () => {
      const wrapper = createWrapper();
      expect(wrapper.vm.disableSuggestionPopup).toBeDefined();
      expect(typeof wrapper.vm.disableSuggestionPopup).toBe("function");
    });

    it("should expose triggerAutoComplete method", () => {
      const wrapper = createWrapper();
      expect(wrapper.vm.triggerAutoComplete).toBeDefined();
      expect(typeof wrapper.vm.triggerAutoComplete).toBe("function");
    });

    it("should expose getCursorIndex method", () => {
      const wrapper = createWrapper();
      expect(wrapper.vm.getCursorIndex).toBeDefined();
      expect(typeof wrapper.vm.getCursorIndex).toBe("function");
    });

    it("should expose formatDocument method", () => {
      const wrapper = createWrapper();
      expect(wrapper.vm.formatDocument).toBeDefined();
      expect(typeof wrapper.vm.formatDocument).toBe("function");
    });

    it("should expose getModel method", () => {
      const wrapper = createWrapper();
      expect(wrapper.vm.getModel).toBeDefined();
      expect(typeof wrapper.vm.getModel).toBe("function");
    });

    it("should expose getValue method", () => {
      const wrapper = createWrapper();
      expect(wrapper.vm.getValue).toBeDefined();
      expect(typeof wrapper.vm.getValue).toBe("function");
    });

    it("should expose decorateRanges method", () => {
      const wrapper = createWrapper();
      expect(wrapper.vm.decorateRanges).toBeDefined();
      expect(typeof wrapper.vm.decorateRanges).toBe("function");
    });

    it("should expose addErrorDiagnostics method", () => {
      const wrapper = createWrapper();
      expect(wrapper.vm.addErrorDiagnostics).toBeDefined();
      expect(typeof wrapper.vm.addErrorDiagnostics).toBe("function");
    });

    it("should expose searchObj from useLogs", () => {
      const wrapper = createWrapper();
      expect(wrapper.vm.searchObj).toBeDefined();
      expect(typeof wrapper.vm.searchObj).toBe("object");
    });
  });

  describe("Emits", () => {
    it("should define update-query emit", () => {
      const wrapper = createWrapper();
      expect(wrapper.vm.$options.emits).toContain("update-query");
    });

    it("should define run-query emit", () => {
      const wrapper = createWrapper();
      expect(wrapper.vm.$options.emits).toContain("run-query");
    });

    it("should define update:query emit", () => {
      const wrapper = createWrapper();
      expect(wrapper.vm.$options.emits).toContain("update:query");
    });

    it("should define focus emit", () => {
      const wrapper = createWrapper();
      expect(wrapper.vm.$options.emits).toContain("focus");
    });

    it("should define blur emit", () => {
      const wrapper = createWrapper();
      expect(wrapper.vm.$options.emits).toContain("blur");
    });
  });

  describe("Language Support", () => {
    it("should support sql language", () => {
      const wrapper = createWrapper({ language: "sql" });
      expect(wrapper.props("language")).toBe("sql");
    });

    it("should support json language", () => {
      const wrapper = createWrapper({ language: "json" });
      expect(wrapper.props("language")).toBe("json");
    });

    it("should support html language", () => {
      const wrapper = createWrapper({ language: "html" });
      expect(wrapper.props("language")).toBe("html");
    });

    it("should support markdown language", () => {
      const wrapper = createWrapper({ language: "markdown" });
      expect(wrapper.props("language")).toBe("markdown");
    });

    it("should support python language", () => {
      const wrapper = createWrapper({ language: "python" });
      expect(wrapper.props("language")).toBe("python");
    });

    it("should support javascript language", () => {
      const wrapper = createWrapper({ language: "javascript" });
      expect(wrapper.props("language")).toBe("javascript");
    });

    it("should support promql language", () => {
      const wrapper = createWrapper({ language: "promql" });
      expect(wrapper.props("language")).toBe("promql");
    });

    it("should support vrl language", () => {
      const wrapper = createWrapper({ language: "vrl" });
      expect(wrapper.props("language")).toBe("vrl");
    });
  });

  describe("Configuration", () => {
    it("should accept different editor IDs", () => {
      const id1 = "editor-1";
      const id2 = "editor-2";
      const wrapper1 = createWrapper({ editorId: id1 });
      const wrapper2 = createWrapper({ editorId: id2 });
      expect(wrapper1.props("editorId")).toBe(id1);
      expect(wrapper2.props("editorId")).toBe(id2);
    });

    it("should handle empty query", () => {
      const wrapper = createWrapper({ query: "" });
      expect(wrapper.props("query")).toBe("");
    });

    it("should handle multi-line query", () => {
      const query = "SELECT *\nFROM users\nWHERE id = 1";
      const wrapper = createWrapper({ query });
      expect(wrapper.props("query")).toBe(query);
    });

    it("should handle complex SQL query", () => {
      const query =
        "SELECT u.name, COUNT(*) as count FROM users u JOIN orders o ON u.id = o.user_id GROUP BY u.name";
      const wrapper = createWrapper({ query });
      expect(wrapper.props("query")).toBe(query);
    });
  });

  describe("Reactivity", () => {
    it("should update when query prop changes", async () => {
      const wrapper = createWrapper({ query: "SELECT 1" });
      expect(wrapper.props("query")).toBe("SELECT 1");

      await wrapper.setProps({ query: "SELECT 2" });
      expect(wrapper.props("query")).toBe("SELECT 2");
    });

    it("should update when readOnly prop changes", async () => {
      const wrapper = createWrapper({ readOnly: false });
      expect(wrapper.props("readOnly")).toBe(false);

      await wrapper.setProps({ readOnly: true });
      expect(wrapper.props("readOnly")).toBe(true);
    });

    it("should update when language prop changes", async () => {
      const wrapper = createWrapper({ language: "sql" });
      expect(wrapper.props("language")).toBe("sql");

      await wrapper.setProps({ language: "json" });
      expect(wrapper.props("language")).toBe("json");
    });
  });

  describe("Ctrl+Enter / Cmd+Enter keyboard shortcut", () => {
    let shortcutWrapper: ReturnType<typeof mount> | null = null;
    let getElementByIdSpy: ReturnType<typeof vi.spyOn>;

    // Spy on document.getElementById so setupEditor finds the editor element
    // without needing the component attached to document. This bypasses the
    // 100ms retry-loop setTimeout. Then use vi.waitFor to poll until the
    // async setupEditor chain (dynamic imports + loadMonaco) fully completes.
    const mountAndSetup = async (props: any = {}) => {
      const fakeEditorEl = document.createElement("div");
      getElementByIdSpy = vi
        .spyOn(document, "getElementById")
        .mockReturnValue(fakeEditorEl);

      shortcutWrapper = mount(CodeQueryEditor, {
        props: {
          editorId: "test-editor",
          query: "SELECT * FROM logs",
          ...props,
        },
        global: { plugins: [store] },
      });
      // Wait until the async setupEditor completes and addCommand is recorded
      await vi.waitFor(
        () => {
          expect(mockEditorObj.addCommand).toHaveBeenCalled();
        },
        { timeout: 3000 },
      );
      return shortcutWrapper;
    };

    afterEach(() => {
      getElementByIdSpy?.mockRestore();
      shortcutWrapper?.unmount();
      shortcutWrapper = null;
    });

    it("should call addCommand with CtrlCmd+Enter keybinding", async () => {
      await mountAndSetup();
      expect(mockEditorObj.addCommand).toHaveBeenCalled();
      const firstCall = mockEditorObj.addCommand.mock.calls[0];
      // KeyMod.CtrlCmd | KeyCode.Enter = 1 | 13 (bitwise OR of the mock values)
      expect(firstCall[0]).toBe(1 | 13);
    });

    it("should emit run-query when CtrlCmd+Enter handler is invoked", async () => {
      const wrapper = await mountAndSetup();
      expect(mockEditorObj.addCommand).toHaveBeenCalled();
      const handler = mockEditorObj.addCommand.mock.calls[0][1];
      expect(typeof handler).toBe("function");
      handler();
      expect(wrapper.emitted("run-query")).toBeTruthy();
    });

    it("should register addCommand with ctrlenter context", async () => {
      await mountAndSetup();
      expect(mockEditorObj.addCommand).toHaveBeenCalled();
      const firstCall = mockEditorObj.addCommand.mock.calls[0];
      expect(firstCall[2]).toBe("ctrlenter");
    });
  });

  // Tests for the bug fix: suggestions=[] must not fall back to defaultSuggestions.
  // When a parent passes an explicit empty array (e.g. effectiveSuggestions during
  // value context), the Monaco provider must return no function suggestions.
  describe("suggestions prop — function suggestions gated by null vs []", () => {
    let getElementByIdSpy: ReturnType<typeof vi.spyOn>;

    afterEach(() => {
      getElementByIdSpy?.mockRestore();
    });

    // Snapshot the registerCompletionItemProvider call count before mounting,
    // then wait for our mount to push a new call. Using a baseline (instead of
    // vi.clearAllMocks + waiting for addCommand) avoids a race under parallel
    // CI load where a previous test's still-running setupEditor would satisfy
    // vi.waitFor on addCommand BEFORE our component had registered its provider.
    const mountAndWait = async (props: any = {}) => {
      const monacoApi = await import("monaco-editor/esm/vs/editor/editor.api");
      const registerFn = vi.mocked(
        monacoApi.languages.registerCompletionItemProvider,
      );
      const baselineIndex = registerFn.mock.calls.length;

      const fakeEl = document.createElement("div");
      getElementByIdSpy = vi
        .spyOn(document, "getElementById")
        .mockReturnValue(fakeEl);
      mount(CodeQueryEditor, {
        props: { editorId: "test-editor", query: "SELECT * FROM logs", ...props },
        global: { plugins: [store] },
      });

      await vi.waitFor(
        () => {
          expect(registerFn.mock.calls.length).toBeGreaterThan(baselineIndex);
        },
        { timeout: 5000 },
      );
      return baselineIndex;
    };

    const captureProvideCompletionItems = async (baselineIndex: number) => {
      const monacoApi = await import("monaco-editor/esm/vs/editor/editor.api");
      const calls = vi.mocked(
        monacoApi.languages.registerCompletionItemProvider,
      ).mock.calls;
      // Use the first call AFTER the baseline — that is unambiguously our mount.
      return calls[baselineIndex][1].provideCompletionItems as Function;
    };

    const callProvider = (fn: Function, text = "") => {
      const mockModel = {
        getValueInRange: vi.fn(() => text),
        getWordUntilPosition: vi.fn(() => ({ word: "", startColumn: 1, endColumn: 1 })),
      };
      return fn(mockModel, { lineNumber: 1, column: 1 });
    };

    const hasFunctionSuggestion = (result: any) =>
      result.suggestions.some(
        (s: any) =>
          typeof s.label === "string" &&
          (s.label.startsWith("match_all") || s.label.startsWith("fuzzy_match")),
      );

    it("includes function suggestions when suggestions prop is null (default)", async () => {
      const baselineIndex = await mountAndWait({ suggestions: null });
      const fn = await captureProvideCompletionItems(baselineIndex);
      const result = callProvider(fn);
      expect(hasFunctionSuggestion(result)).toBe(true);
    });

    it("includes no function suggestions when suggestions prop is [] (explicit empty)", async () => {
      const baselineIndex = await mountAndWait({ suggestions: [] });
      const fn = await captureProvideCompletionItems(baselineIndex);
      const result = callProvider(fn);
      expect(hasFunctionSuggestion(result)).toBe(false);
    });

    it("includes provided suggestions when suggestions prop has items", async () => {
      const customSuggestion = {
        label: (_kw: string) => `custom_fn('${_kw}')`,
        kind: "Text",
        insertText: (_kw: string) => `custom_fn('${_kw}')`,
      };
      const baselineIndex = await mountAndWait({ suggestions: [customSuggestion] });
      const fn = await captureProvideCompletionItems(baselineIndex);
      const result = callProvider(fn, "SELECT");
      const found = result.suggestions.some(
        (s: any) => typeof s.label === "string" && s.label.startsWith("custom_fn"),
      );
      expect(found).toBe(true);
    });
  });

  // Tests for validateDoubleQuotes.
  // The detection regex is tested directly here — this avoids async Monaco mock
  // coordination while still covering every pattern the component will flag.
  describe("validateDoubleQuotes — detection regex", () => {
    // Mirror of the regex used in validateDoubleQuotes in CodeQueryEditor.vue.
    // Update here if the regex changes in the component.
    const makeRegex = () =>
      /(?:NOT\s+LIKE|NOT\s+IN\s*\(|!=|<>|>=|<=|=|>|<|LIKE|IN\s*\()\s*("[^'"]*'|'[^'"]*"|"[^"]*")/gi;

    const findInvalidQuotes = (text: string): string[] => {
      const r = makeRegex();
      const matches: string[] = [];
      let m;
      while ((m = r.exec(text)) !== null) matches.push(m[1]);
      return matches;
    };

    // ── double-quoted values ────────────────────────────────────────────────

    it('flags = "value"', () => {
      expect(findInvalidQuotes(`WHERE http_endpoint = "test"`)).toEqual([`"test"`]);
    });

    it('flags != "value"', () => {
      expect(findInvalidQuotes(`WHERE status != "error"`)).toEqual([`"error"`]);
    });

    it('flags LIKE "%value%"', () => {
      expect(findInvalidQuotes(`WHERE msg LIKE "%error%"`)).toEqual([`"%error%"`]);
    });

    it('flags NOT LIKE "value"', () => {
      expect(findInvalidQuotes(`WHERE path NOT LIKE "%admin%"`)).toEqual([`"%admin%"`]);
    });

    it('flags IN ("value")', () => {
      expect(findInvalidQuotes(`WHERE status IN ("200")`)).toEqual([`"200"`]);
    });

    it("flags every double-quoted value across multiple conditions", () => {
      expect(
        findInvalidQuotes(`WHERE status = "200" AND env = "prod"`),
      ).toEqual([`"200"`, `"prod"`]);
    });

    it('flags double-quoted URL path: = "/api/v1/payments"', () => {
      expect(
        findInvalidQuotes(`WHERE http_endpoint = "/api/v1/payments"`),
      ).toEqual([`"/api/v1/payments"`]);
    });

    // ── mismatched quotes ───────────────────────────────────────────────────

    it('flags mismatched open-double close-single: = "value\'', () => {
      expect(findInvalidQuotes(`WHERE field = "test'`)).toEqual([`"test'`]);
    });

    it("flags mismatched open-single close-double: = 'value\"", () => {
      expect(findInvalidQuotes(`WHERE field = 'test"`)).toEqual([`'test"`]);
    });

    // ── valid cases — must NOT be flagged ────────────────────────────────────

    it("does NOT flag single-quoted values", () => {
      expect(findInvalidQuotes(`WHERE status = 'ok' AND env = 'prod'`)).toEqual([]);
    });

    it("does NOT flag numeric values", () => {
      expect(findInvalidQuotes(`WHERE status = 200 AND code >= 400`)).toEqual([]);
    });

    it('does NOT flag double-quoted table names in FROM clause', () => {
      expect(
        findInvalidQuotes(`SELECT * FROM "test_table" WHERE status = 200`),
      ).toEqual([]);
    });

    it("does NOT flag a valid URL path in single quotes", () => {
      expect(
        findInvalidQuotes(`WHERE http_endpoint = '/api/v1/payments'`),
      ).toEqual([]);
    });
  });
});

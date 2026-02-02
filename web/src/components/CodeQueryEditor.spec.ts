// Copyright 2023 OpenObserve Inc.
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

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import CodeQueryEditor from "./CodeQueryEditor.vue";
import { createStore } from "vuex";

installQuasar();

// Simple mock for monaco editor
vi.mock("monaco-editor/esm/vs/editor/editor.all.js", () => ({}));
vi.mock("monaco-editor/esm/vs/editor/editor.api", () => ({
  default: {},
  editor: {
    create: vi.fn(() => null),
    defineTheme: vi.fn(),
    setTheme: vi.fn(),
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
vi.mock("monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js", () => ({}));
vi.mock("monaco-editor/esm/vs/language/json/monaco.contribution.js", () => ({}));
vi.mock("monaco-editor/esm/vs/language/html/monaco.contribution.js", () => ({}));
vi.mock("monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js", () => ({}));
vi.mock("monaco-editor/esm/vs/basic-languages/python/python.contribution.js", () => ({}));
vi.mock("monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js", () => ({}));

vi.mock("@/composables/useLogs", () => ({
  default: () => ({
    searchObj: { data: {}, meta: {} },
  }),
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
      const keywords = [{ label: "SELECT", kind: "Keyword", insertText: "SELECT" }];
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

    it("should have empty suggestions array as default", () => {
      const wrapper = createWrapper({ suggestions: undefined });
      expect(wrapper.props("suggestions")).toEqual([]);
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
      const query = "SELECT u.name, COUNT(*) as count FROM users u JOIN orders o ON u.id = o.user_id GROUP BY u.name";
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
});

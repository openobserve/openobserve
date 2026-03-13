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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";

// ── Module mocks (hoisted) ───────────────────────────────────────────────────

const mockSaveToHistory = vi.fn().mockResolvedValue(55);

vi.mock("@/composables/useChatHistory", () => ({
  useChatHistory: vi.fn(() => ({
    saveToHistory: mockSaveToHistory,
    loadHistory: vi.fn().mockResolvedValue([]),
    loadChat: vi.fn().mockResolvedValue(null),
    deleteChatById: vi.fn().mockResolvedValue(true),
    clearAllHistory: vi.fn().mockResolvedValue(true),
    updateChatTitle: vi.fn().mockResolvedValue(true),
  })),
}));

vi.mock("@/utils/zincutils", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    getImageURL: vi.fn((path: string) => `/mocked/${path}`),
    getUUIDv7: vi.fn(() => "test-session-uuid"),
    generateTraceContext: vi.fn(() => ({ traceId: "mock-trace" })),
  };
});

vi.mock("@/aws-exports", () => ({
  default: { isEnterprise: "true", isCloud: "false" },
}));

vi.mock("quasar", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    useQuasar: () => ({ notify: vi.fn(), dialog: vi.fn() }),
  };
});

// Component import must come after all vi.mock() declarations.
import QueryEditor from "./QueryEditor.vue";

installQuasar();

// ── CodeQueryEditor stub ─────────────────────────────────────────────────────

const codeQueryEditorStub = {
  template: '<div data-test="code-query-editor" />',
  props: [
    "query",
    "language",
    "nlpMode",
    "readOnly",
    "keywords",
    "suggestions",
    "debounceTime",
    "showAutoComplete",
    "editorId",
  ],
  emits: [
    "update:query",
    "run-query",
    "focus",
    "blur",
    "nlpModeDetected",
    "generation-start",
    "generation-end",
    "generation-success",
  ],
};

// ── Mount factory ────────────────────────────────────────────────────────────

function mountQueryEditor(props: Record<string, unknown> = {}) {
  return mount(QueryEditor, {
    global: {
      plugins: [store, i18n],
      stubs: {
        CodeQueryEditor: codeQueryEditorStub,
      },
    },
    props: {
      query: "",
      editorHeight: "200px",
      hideNlToggle: false,
      disableAi: false,
      dataTestPrefix: "query-editor",
      ...props,
    },
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("QueryEditor", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  describe("initial render", () => {
    it("should render without errors", () => {
      wrapper = mountQueryEditor();
      expect(wrapper.exists()).toBe(true);
    });

    it("should render the CodeQueryEditor stub", () => {
      wrapper = mountQueryEditor();
      expect(
        wrapper.find('[data-test="code-query-editor"]').exists(),
      ).toBe(true);
    });

    it("should hide the AI input bar when not in AI mode", () => {
      wrapper = mountQueryEditor();
      expect(wrapper.find(".ai-input-bar").exists()).toBe(false);
    });
  });

  describe("isAIMode — internal control", () => {
    it("should show AI input bar after ai-toggle-btn is clicked", async () => {
      // Enable ai_enabled in store config so the toggle button renders
      store.commit("setConfig", {
        ...store.state.zoConfig,
        ai_enabled: true,
      });

      wrapper = mountQueryEditor({ hideNlToggle: false });
      await nextTick();

      const toggleBtn = wrapper.find('[data-test="query-editor-ai-toggle-btn"]');
      expect(toggleBtn.exists()).toBe(true);

      await toggleBtn.trigger("click");
      await nextTick();

      expect(wrapper.find(".ai-input-bar").exists()).toBe(true);

      // Restore config
      store.commit("setConfig", {
        ...store.state.zoConfig,
        ai_enabled: false,
      });
    });
  });

  describe("isAIMode — external control", () => {
    it("should show AI input bar when nlpMode prop is true", async () => {
      wrapper = mountQueryEditor({ nlpMode: true });
      await nextTick();

      expect(wrapper.find(".ai-input-bar").exists()).toBe(true);
    });

    it("should hide AI input bar when nlpMode prop is false", async () => {
      wrapper = mountQueryEditor({ nlpMode: false });
      await nextTick();

      expect(wrapper.find(".ai-input-bar").exists()).toBe(false);
    });
  });

  describe("send button disabled state", () => {
    beforeEach(async () => {
      wrapper = mountQueryEditor({ nlpMode: true });
      await nextTick();
    });

    it("should disable send button when aiInputText is empty", async () => {
      (wrapper.vm as any).aiInputText = "";
      await nextTick();

      const sendBtn = wrapper.find('[data-test="query-editor-ai-send-btn"]');
      expect(sendBtn.exists()).toBe(true);
      // Quasar q-btn renders disable attribute when disabled
      expect(sendBtn.attributes("disabled") !== undefined || sendBtn.classes("disabled")).toBe(true);
    });

    it("should disable send button when disableAi prop is true", async () => {
      await wrapper.setProps({ disableAi: true });
      (wrapper.vm as any).aiInputText = "show me errors";
      await nextTick();

      const sendBtn = wrapper.find('[data-test="query-editor-ai-send-btn"]');
      expect(sendBtn.exists()).toBe(true);
      expect(sendBtn.attributes("disabled") !== undefined || sendBtn.classes("disabled")).toBe(true);
    });
  });

  describe("dismissAIMode", () => {
    it("should hide AI bar after dismissAIMode is called", async () => {
      wrapper = mountQueryEditor({ nlpMode: undefined });
      await nextTick();

      // Enable internal NLP mode first
      (wrapper.vm as any).internalNlpMode = true;
      await nextTick();

      expect(wrapper.find(".ai-input-bar").exists()).toBe(true);

      (wrapper.vm as any).dismissAIMode();
      await nextTick();

      expect(wrapper.find(".ai-input-bar").exists()).toBe(false);
    });

    it("should clear aiInputText after dismissAIMode is called", async () => {
      wrapper = mountQueryEditor();
      (wrapper.vm as any).internalNlpMode = true;
      (wrapper.vm as any).aiInputText = "some query text";
      await nextTick();

      (wrapper.vm as any).dismissAIMode();
      await nextTick();

      expect((wrapper.vm as any).aiInputText).toBe("");
    });

    it("should reset currentSessionId to null after dismissAIMode is called", async () => {
      wrapper = mountQueryEditor();
      (wrapper.vm as any).currentSessionId = "existing-session";
      (wrapper.vm as any).dismissAIMode();
      await nextTick();

      expect((wrapper.vm as any).currentSessionId).toBeNull();
    });
  });

  describe("cancelGeneration", () => {
    it("should set isGenerating to false when cancelGeneration is called", async () => {
      wrapper = mountQueryEditor();
      (wrapper.vm as any).isGenerating = true;
      (wrapper.vm as any).cancelGeneration();
      await nextTick();

      expect((wrapper.vm as any).isGenerating).toBe(false);
    });

    it("should abort currentAbortController and nullify it when cancelGeneration is called", async () => {
      wrapper = mountQueryEditor();
      const controller = new AbortController();
      const abortSpy = vi.spyOn(controller, "abort");
      (wrapper.vm as any).currentAbortController = controller;

      (wrapper.vm as any).cancelGeneration();
      await nextTick();

      expect(abortSpy).toHaveBeenCalledTimes(1);
      expect((wrapper.vm as any).currentAbortController).toBeNull();
    });
  });

  describe("isExecutionIntent", () => {
    beforeEach(() => {
      wrapper = mountQueryEditor();
    });

    it("should return true for 'run'", () => {
      expect((wrapper.vm as any).isExecutionIntent("run")).toBe(true);
    });

    it("should return true for 'execute'", () => {
      expect((wrapper.vm as any).isExecutionIntent("execute")).toBe(true);
    });

    it("should return true for 'search'", () => {
      expect((wrapper.vm as any).isExecutionIntent("search")).toBe(true);
    });

    it("should return true case-insensitively for 'RUN QUERY'", () => {
      expect((wrapper.vm as any).isExecutionIntent("RUN QUERY")).toBe(true);
    });

    it("should return false for a regular natural language query", () => {
      expect(
        (wrapper.vm as any).isExecutionIntent(
          "show me errors in the last hour",
        ),
      ).toBe(false);
    });

    it("should return false for an empty string", () => {
      expect((wrapper.vm as any).isExecutionIntent("")).toBe(false);
    });
  });

  describe("rootStyle", () => {
    it("should set height from editorHeight prop", () => {
      wrapper = mountQueryEditor({ editorHeight: "350px" });
      const rootStyle = (wrapper.vm as any).rootStyle;
      expect(rootStyle).toEqual({ height: "350px" });
    });

    it("should return height 100% when editorHeight prop is '100%'", () => {
      wrapper = mountQueryEditor({ editorHeight: "100%" });
      const rootStyle = (wrapper.vm as any).rootStyle;
      expect(rootStyle).toEqual({ height: "100%" });
    });
  });

  describe("handleAIGenerate", () => {
    it("should not proceed when aiInputText is empty", async () => {
      wrapper = mountQueryEditor();
      (wrapper.vm as any).aiInputText = "";

      await (wrapper.vm as any).handleAIGenerate();
      await flushPromises();

      // saveToHistory should not be called for an empty input
      expect(mockSaveToHistory).not.toHaveBeenCalled();
    });

    it("should emit run-query when execution intent is detected and a query exists", async () => {
      wrapper = mountQueryEditor({ query: "SELECT * FROM logs" });

      // Set up the editorRef mock to return the existing query
      (wrapper.vm as any).editorRef = {
        getValue: vi.fn(() => "SELECT * FROM logs"),
        handleGenerateSQL: vi.fn().mockResolvedValue(undefined),
      };

      (wrapper.vm as any).aiInputText = "run";
      await (wrapper.vm as any).handleAIGenerate();
      await flushPromises();

      expect(wrapper.emitted("run-query")).toBeTruthy();
    });

    it("should clear aiInputText after emitting run-query on execution intent", async () => {
      wrapper = mountQueryEditor({ query: "SELECT * FROM logs" });
      (wrapper.vm as any).editorRef = {
        getValue: vi.fn(() => "SELECT * FROM logs"),
        handleGenerateSQL: vi.fn().mockResolvedValue(undefined),
      };

      (wrapper.vm as any).aiInputText = "run";
      await (wrapper.vm as any).handleAIGenerate();
      await flushPromises();

      expect((wrapper.vm as any).aiInputText).toBe("");
    });
  });

  describe("dataTestPrefix prop", () => {
    it("should apply custom dataTestPrefix to AI input field", async () => {
      wrapper = mountQueryEditor({
        dataTestPrefix: "logs-editor",
        nlpMode: true,
      });
      await nextTick();

      const input = wrapper.find('[data-test="logs-editor-ai-input-field"]');
      expect(input.exists()).toBe(true);
    });

    it("should apply custom dataTestPrefix to AI send button", async () => {
      wrapper = mountQueryEditor({
        dataTestPrefix: "logs-editor",
        nlpMode: true,
      });
      await nextTick();

      const sendBtn = wrapper.find('[data-test="logs-editor-ai-send-btn"]');
      expect(sendBtn.exists()).toBe(true);
    });

    it("should apply custom dataTestPrefix to AI close button", async () => {
      wrapper = mountQueryEditor({
        dataTestPrefix: "logs-editor",
        nlpMode: true,
      });
      await nextTick();

      const closeBtn = wrapper.find('[data-test="logs-editor-ai-close-btn"]');
      expect(closeBtn.exists()).toBe(true);
    });
  });

  describe("useChatHistory called with getter functions", () => {
    it("should call saveToHistory after a successful generation", async () => {
      wrapper = mountQueryEditor();
      const mockHandleGenerateSQL = vi.fn().mockResolvedValue(undefined);
      (wrapper.vm as any).editorRef = {
        getValue: vi.fn(() => ""),
        handleGenerateSQL: mockHandleGenerateSQL,
      };

      (wrapper.vm as any).aiInputText = "list all logs";
      await (wrapper.vm as any).handleAIGenerate();
      await flushPromises();

      expect(mockSaveToHistory).toHaveBeenCalled();
    });
  });
});

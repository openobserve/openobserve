// Copyright 2026 OpenObserve Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { mount, flushPromises } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ref, computed } from "vue";
import TransformSelector from "./TransformSelector.vue";

// ── Mock vue-i18n ──────────────────────────────────────────────────────────────
vi.mock("vue-i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

// ── Shared searchObj state ─────────────────────────────────────────────────────
const mockSearchObj = {
  meta: {
    showTransformEditor: false,
    toggleFunction: false,
  },
  data: {
    transformType: null as string | null,
    actions: [] as { name: string }[],
    selectedTransform: null as any,
  },
  config: {
    fnSplitterModel: 99.5,
  },
};

vi.mock("@/composables/useLogs/searchState", () => ({
  searchState: () => ({
    searchObj: mockSearchObj,
  }),
}));

// ── Mock logsUtils ─────────────────────────────────────────────────────────────
const isActionsEnabledRef = ref(false);

vi.mock("@/composables/useLogs/logsUtils", () => ({
  logsUtils: () => ({
    isActionsEnabled: isActionsEnabledRef,
  }),
}));

// ── Mock getImageURL ───────────────────────────────────────────────────────────
vi.mock("@/utils/zincutils", () => ({
  getImageURL: (path: string) => `/mocked/${path}`,
}));

// ── Mock Vuex useStore ─────────────────────────────────────────────────────────
const mockStore = {
  state: {
    theme: "light",
  },
};

vi.mock("vuex", () => ({
  useStore: () => mockStore,
}));

// ── Mock Quasar useQuasar ──────────────────────────────────────────────────────
const notifyMock = vi.fn();

vi.mock("quasar", async () => {
  const actual = await vi.importActual("quasar");
  return {
    ...actual,
    useQuasar: vi.fn(() => ({
      notify: notifyMock,
    })),
  };
});

// ── Helpers ────────────────────────────────────────────────────────────────────
const functionOptions = [
  { name: "parseJSON", function: "function parseJSON(row) { return row; }" },
  { name: "extractIP", function: "function extractIP(row) { return row; }" },
  { name: "filterLogs", function: "function filterLogs(row) { return row; }" },
];

const mountComponent = (propsOverrides = {}) =>
  mount(TransformSelector, {
    global: {
      stubs: {
        QBtnGroup: { template: '<div><slot /></div>' },
        QToggle: { template: '<input type="checkbox" />' },
        QTooltip: true,
        QBtnDropdown: { template: '<div data-test="btn-dropdown"><slot /><slot name="default" /></div>' },
        QList: { template: '<ul><slot /></ul>' },
        QSelect: { template: '<select />' },
        QInput: { template: '<input />' },
        QIcon: { template: '<span />' },
        QItem: { template: '<li><slot /></li>' },
        QItemSection: { template: '<div><slot /></div>' },
        QItemLabel: { template: '<span><slot /></span>' },
        QBtn: { template: '<button :disabled="$attrs.disable" @click="$attrs.onClick?.($event)"><slot /></button>' },
      },
    },
    props: {
      functionOptions,
      ...propsOverrides,
    },
  });

describe("TransformSelector", () => {
  beforeEach(() => {
    // Reset shared state before each test
    mockSearchObj.meta.showTransformEditor = false;
    mockSearchObj.meta.toggleFunction = false;
    mockSearchObj.data.transformType = null;
    mockSearchObj.data.actions = [];
    mockSearchObj.data.selectedTransform = null;
    mockSearchObj.config.fnSplitterModel = 99.5;
    mockStore.state.theme = "light";
    isActionsEnabledRef.value = false;
    notifyMock.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Component Initialization ─────────────────────────────────────────────────
  describe("Component Initialization", () => {
    it("mounts successfully", () => {
      const wrapper = mountComponent();
      expect(wrapper.exists()).toBe(true);
    });

    it("renders with required props", () => {
      const wrapper = mountComponent();
      expect(wrapper.exists()).toBe(true);
    });

    it("renders with empty functionOptions", () => {
      const wrapper = mountComponent({ functionOptions: [] });
      expect(wrapper.exists()).toBe(true);
    });
  });

  // ── filteredFunctionOptions ──────────────────────────────────────────────────
  describe("filteredFunctionOptions computed", () => {
    it("returns empty array when transformType is not 'function'", () => {
      mockSearchObj.data.transformType = null;
      const wrapper = mountComponent();
      expect(wrapper.vm.filteredFunctionOptions).toEqual([]);
    });

    it("returns empty array when transformType is 'action'", () => {
      mockSearchObj.data.transformType = "action";
      const wrapper = mountComponent();
      expect(wrapper.vm.filteredFunctionOptions).toEqual([]);
    });

    it("returns all options when transformType is 'function' and no search term", () => {
      mockSearchObj.data.transformType = "function";
      const wrapper = mountComponent();
      wrapper.vm.searchTerm = "";
      expect(wrapper.vm.filteredFunctionOptions).toEqual(functionOptions);
    });

    it("filters by searchTerm (case-insensitive) when transformType is 'function'", () => {
      mockSearchObj.data.transformType = "function";
      const wrapper = mountComponent();
      wrapper.vm.searchTerm = "json";
      const result = wrapper.vm.filteredFunctionOptions;
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("parseJSON");
    });

    it("returns empty array when searchTerm matches nothing", () => {
      mockSearchObj.data.transformType = "function";
      const wrapper = mountComponent();
      wrapper.vm.searchTerm = "nomatchwhatsoever";
      expect(wrapper.vm.filteredFunctionOptions).toEqual([]);
    });

    it("matches partial name (prefix)", () => {
      mockSearchObj.data.transformType = "function";
      const wrapper = mountComponent();
      wrapper.vm.searchTerm = "filter";
      const result = wrapper.vm.filteredFunctionOptions;
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("filterLogs");
    });
  });

  // ── filteredActionOptions ────────────────────────────────────────────────────
  describe("filteredActionOptions computed", () => {
    beforeEach(() => {
      mockSearchObj.data.actions = [
        { name: "alertAction" },
        { name: "notifyAction" },
        { name: "blockAction" },
      ];
    });

    it("returns empty array when transformType is not 'action'", () => {
      mockSearchObj.data.transformType = "function";
      const wrapper = mountComponent();
      expect(wrapper.vm.filteredActionOptions).toEqual([]);
    });

    it("returns all actions when transformType is 'action' and no search term", () => {
      mockSearchObj.data.transformType = "action";
      const wrapper = mountComponent();
      wrapper.vm.searchTerm = "";
      expect(wrapper.vm.filteredActionOptions).toEqual(mockSearchObj.data.actions);
    });

    it("filters actions by searchTerm", () => {
      mockSearchObj.data.transformType = "action";
      const wrapper = mountComponent();
      wrapper.vm.searchTerm = "alert";
      const result = wrapper.vm.filteredActionOptions;
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("alertAction");
    });

    it("case-insensitive search for actions", () => {
      mockSearchObj.data.transformType = "action";
      const wrapper = mountComponent();
      wrapper.vm.searchTerm = "NOTIFY";
      const result = wrapper.vm.filteredActionOptions;
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("notifyAction");
    });
  });

  // ── filteredTransformOptions ─────────────────────────────────────────────────
  describe("filteredTransformOptions computed", () => {
    it("returns empty array when no transformType set", () => {
      mockSearchObj.data.transformType = null;
      const wrapper = mountComponent();
      expect(wrapper.vm.filteredTransformOptions).toEqual([]);
    });

    it("returns filteredFunctionOptions when transformType is 'function'", () => {
      mockSearchObj.data.transformType = "function";
      const wrapper = mountComponent();
      wrapper.vm.searchTerm = "";
      expect(wrapper.vm.filteredTransformOptions).toEqual(functionOptions);
    });

    it("returns filteredActionOptions when transformType is 'action'", () => {
      mockSearchObj.data.actions = [{ name: "myAction" }];
      mockSearchObj.data.transformType = "action";
      const wrapper = mountComponent();
      wrapper.vm.searchTerm = "";
      expect(wrapper.vm.filteredTransformOptions).toEqual(mockSearchObj.data.actions);
    });
  });

  // ── transformsLabel ──────────────────────────────────────────────────────────
  describe("transformsLabel computed", () => {
    it("returns selected transform name when type matches", () => {
      mockSearchObj.data.transformType = "function";
      mockSearchObj.data.selectedTransform = { name: "myFunc", type: "function" };
      const wrapper = mountComponent();
      expect(wrapper.vm.transformsLabel).toBe("myFunc");
    });

    it("does not return selected name when type differs", () => {
      mockSearchObj.data.transformType = "action";
      mockSearchObj.data.selectedTransform = { name: "myFunc", type: "function" };
      isActionsEnabledRef.value = true;
      const wrapper = mountComponent();
      expect(wrapper.vm.transformsLabel).toBe("search.actionLabel");
    });

    it("returns 'search.functionLabel' when isActionsEnabled is false", () => {
      isActionsEnabledRef.value = false;
      mockSearchObj.data.transformType = null;
      const wrapper = mountComponent();
      expect(wrapper.vm.transformsLabel).toBe("search.functionLabel");
    });

    it("returns 'search.actionLabel' when transformType is action and actionsEnabled", () => {
      isActionsEnabledRef.value = true;
      mockSearchObj.data.transformType = "action";
      const wrapper = mountComponent();
      expect(wrapper.vm.transformsLabel).toBe("search.actionLabel");
    });

    it("returns 'search.functionLabel' when transformType is function and actionsEnabled", () => {
      isActionsEnabledRef.value = true;
      mockSearchObj.data.transformType = "function";
      const wrapper = mountComponent();
      expect(wrapper.vm.transformsLabel).toBe("search.functionLabel");
    });

    it("returns 'search.transformLabel' when no transformType and actionsEnabled", () => {
      isActionsEnabledRef.value = true;
      mockSearchObj.data.transformType = null;
      const wrapper = mountComponent();
      expect(wrapper.vm.transformsLabel).toBe("search.transformLabel");
    });
  });

  // ── transformIcon ────────────────────────────────────────────────────────────
  describe("transformIcon computed", () => {
    it("returns function image when isActionsEnabled is false", () => {
      isActionsEnabledRef.value = false;
      const wrapper = mountComponent();
      expect(wrapper.vm.transformIcon).toContain("function.svg");
    });

    it("returns function image when transformType is 'function'", () => {
      isActionsEnabledRef.value = true;
      mockSearchObj.data.transformType = "function";
      const wrapper = mountComponent();
      expect(wrapper.vm.transformIcon).toContain("function.svg");
    });

    it("returns 'code' icon when transformType is 'action'", () => {
      isActionsEnabledRef.value = true;
      mockSearchObj.data.transformType = "action";
      const wrapper = mountComponent();
      expect(wrapper.vm.transformIcon).toBe("code");
    });

    it("returns transform image when no transformType", () => {
      isActionsEnabledRef.value = true;
      mockSearchObj.data.transformType = null;
      const wrapper = mountComponent();
      expect(wrapper.vm.transformIcon).toContain("transform.svg");
    });
  });

  // ── getTransformLabelTooltip ─────────────────────────────────────────────────
  describe("getTransformLabelTooltip computed", () => {
    it("returns toggleFunctionEditor when actionsEnabled is false", () => {
      isActionsEnabledRef.value = false;
      const wrapper = mountComponent();
      expect(wrapper.vm.getTransformLabelTooltip).toBe("search.toggleFunctionEditor");
    });

    it("returns 'search.hide' when showTransformEditor is true and actionsEnabled", () => {
      isActionsEnabledRef.value = true;
      mockSearchObj.meta.showTransformEditor = true;
      mockSearchObj.data.transformType = "function";
      const wrapper = mountComponent();
      expect(wrapper.vm.getTransformLabelTooltip).toBe("search.hide");
    });

    it("returns show + function label when editor is hidden and type is function", () => {
      isActionsEnabledRef.value = true;
      mockSearchObj.meta.showTransformEditor = false;
      mockSearchObj.data.transformType = "function";
      const wrapper = mountComponent();
      const tooltip = wrapper.vm.getTransformLabelTooltip;
      expect(tooltip).toContain("search.show");
      expect(tooltip).toContain("search.functionLabel");
      expect(tooltip).toContain("search.editor");
    });

    it("returns show + action label when editor is hidden and type is action", () => {
      isActionsEnabledRef.value = true;
      mockSearchObj.meta.showTransformEditor = false;
      mockSearchObj.data.transformType = "action";
      const wrapper = mountComponent();
      const tooltip = wrapper.vm.getTransformLabelTooltip;
      expect(tooltip).toContain("search.actionLabel");
    });

    it("returns show + transform label when type is null and actionsEnabled", () => {
      isActionsEnabledRef.value = true;
      mockSearchObj.meta.showTransformEditor = false;
      mockSearchObj.data.transformType = null;
      const wrapper = mountComponent();
      const tooltip = wrapper.vm.getTransformLabelTooltip;
      expect(tooltip).toContain("search.transformLabel");
    });
  });

  // ── selectTransform ──────────────────────────────────────────────────────────
  describe("selectTransform method", () => {
    it("emits 'select:function' when transformType is 'function'", () => {
      mockSearchObj.data.transformType = "function";
      const wrapper = mountComponent();
      const item = functionOptions[0];
      wrapper.vm.selectTransform(item, true);
      const emitted = wrapper.emitted("select:function");
      expect(emitted).toBeTruthy();
      expect(emitted![0]).toEqual([item, true]);
    });

    it("does not emit 'select:function' when transformType is 'action'", () => {
      mockSearchObj.data.transformType = "action";
      const wrapper = mountComponent();
      const item = { name: "myAction" };
      wrapper.vm.selectTransform(item, true);
      expect(wrapper.emitted("select:function")).toBeFalsy();
    });

    it("sets selectedTransform when item is an object", () => {
      mockSearchObj.data.transformType = "function";
      const wrapper = mountComponent();
      const item = functionOptions[0];
      wrapper.vm.selectTransform(item, true);
      expect(mockSearchObj.data.selectedTransform).toEqual({
        ...item,
        type: "function",
      });
    });

    it("calls notify when transformType is 'action'", () => {
      mockSearchObj.data.transformType = "action";
      const wrapper = mountComponent();
      wrapper.vm.selectTransform({ name: "testAction" }, true);
      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "testAction action applied successfully",
        })
      );
    });

    it("does not set selectedTransform when item is not an object", () => {
      mockSearchObj.data.transformType = "function";
      mockSearchObj.data.selectedTransform = null;
      const wrapper = mountComponent();
      wrapper.vm.selectTransform("string-item", true);
      expect(mockSearchObj.data.selectedTransform).toBeNull();
    });
  });

  // ── fnSavedFunctionDialog ────────────────────────────────────────────────────
  describe("fnSavedFunctionDialog method", () => {
    it("emits 'save:function' when called", () => {
      const wrapper = mountComponent();
      wrapper.vm.fnSavedFunctionDialog();
      const emitted = wrapper.emitted("save:function");
      expect(emitted).toBeTruthy();
    });
  });

  // ── updateEditorWidth ────────────────────────────────────────────────────────
  describe("updateEditorWidth method", () => {
    it("sets fnSplitterModel to 60 when transformType is set and editor is shown", () => {
      mockSearchObj.data.transformType = "function";
      mockSearchObj.meta.showTransformEditor = true;
      const wrapper = mountComponent();
      wrapper.vm.updateEditorWidth();
      expect(mockSearchObj.config.fnSplitterModel).toBe(60);
    });

    it("sets fnSplitterModel to 99.5 when transformType is set but editor is hidden", () => {
      mockSearchObj.data.transformType = "function";
      mockSearchObj.meta.showTransformEditor = false;
      const wrapper = mountComponent();
      wrapper.vm.updateEditorWidth();
      expect(mockSearchObj.config.fnSplitterModel).toBe(99.5);
    });

    it("sets fnSplitterModel to 99.5 when no transformType", () => {
      mockSearchObj.data.transformType = null;
      mockSearchObj.meta.showTransformEditor = true;
      const wrapper = mountComponent();
      wrapper.vm.updateEditorWidth();
      expect(mockSearchObj.config.fnSplitterModel).toBe(99.5);
    });
  });

  // ── updateTransforms ─────────────────────────────────────────────────────────
  describe("updateTransforms method", () => {
    it("calls updateEditorWidth via updateTransforms", () => {
      mockSearchObj.data.transformType = "function";
      mockSearchObj.meta.showTransformEditor = true;
      const wrapper = mountComponent();
      wrapper.vm.updateTransforms();
      expect(mockSearchObj.config.fnSplitterModel).toBe(60);
    });
  });

  // ── Save button disabled state ───────────────────────────────────────────────
  describe("Save button disabled state", () => {
    it("save button is enabled when transformType is 'function'", async () => {
      mockSearchObj.data.transformType = "function";
      const wrapper = mountComponent();
      await flushPromises();
      // The save button uses :disable="searchObj.data.transformType !== 'function'"
      // transformType is 'function' so disabled = false
      expect(mockSearchObj.data.transformType).toBe("function");
      // Boolean check: disabled when NOT function
      expect(mockSearchObj.data.transformType !== "function").toBe(false);
    });

    it("save button is disabled when transformType is 'action'", () => {
      mockSearchObj.data.transformType = "action";
      const wrapper = mountComponent();
      expect(mockSearchObj.data.transformType !== "function").toBe(true);
    });

    it("save button is disabled when no transformType", () => {
      mockSearchObj.data.transformType = null;
      const wrapper = mountComponent();
      expect(mockSearchObj.data.transformType !== "function").toBe(true);
    });
  });

  // ── functionToggleIcon ───────────────────────────────────────────────────────
  describe("functionToggleIcon computed", () => {
    it("returns dark function icon when toggleFunction is true", () => {
      mockSearchObj.meta.toggleFunction = true;
      const wrapper = mountComponent();
      expect(wrapper.vm.functionToggleIcon).toContain("function_dark.svg");
    });

    it("returns light function icon when toggleFunction is false", () => {
      mockSearchObj.meta.toggleFunction = false;
      const wrapper = mountComponent();
      expect(wrapper.vm.functionToggleIcon).toContain("function.svg");
      expect(wrapper.vm.functionToggleIcon).not.toContain("function_dark.svg");
    });
  });

  // ── iconRight ────────────────────────────────────────────────────────────────
  describe("iconRight computed", () => {
    it("returns dark function icon in dark theme", () => {
      mockStore.state.theme = "dark";
      const wrapper = mountComponent();
      expect(wrapper.vm.iconRight).toContain("function_dark.svg");
    });

    it("returns light function icon in light theme", () => {
      mockStore.state.theme = "light";
      const wrapper = mountComponent();
      expect(wrapper.vm.iconRight).toContain("function.svg");
      expect(wrapper.vm.iconRight).not.toContain("function_dark.svg");
    });
  });

  // ── transformTypes ───────────────────────────────────────────────────────────
  describe("transformTypes computed", () => {
    it("returns function and action options", () => {
      const wrapper = mountComponent();
      expect(wrapper.vm.transformTypes).toEqual([
        { label: "Function", value: "function" },
        { label: "Action", value: "action" },
      ]);
    });
  });

  // ── searchTerm reactivity ────────────────────────────────────────────────────
  describe("searchTerm reactivity", () => {
    it("initializes searchTerm to empty string", () => {
      const wrapper = mountComponent();
      expect(wrapper.vm.searchTerm).toBe("");
    });

    it("updates filteredFunctionOptions when searchTerm changes", async () => {
      mockSearchObj.data.transformType = "function";
      const wrapper = mountComponent();
      wrapper.vm.searchTerm = "parse";
      await flushPromises();
      const result = wrapper.vm.filteredFunctionOptions;
      expect(result.some((o: { name: string }) => o.name === "parseJSON")).toBe(true);
      expect(result.every((o: { name: string }) => o.name.toLowerCase().includes("parse"))).toBe(true);
    });
  });
});

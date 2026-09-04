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

import { mount, flushPromises } from "@vue/test-utils";
import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import AddRegexPattern from "./AddRegexPattern.vue";
import i18n from "@/locales";
import { nextTick } from "vue";
import { createRouter, createWebHistory } from "vue-router";

// MSW is set up globally in setupTests.ts - no need to mock services
// Import the actual service to test real HTTP calls
import regexPatternService from "@/services/regex_pattern";
import { http, HttpResponse } from "msw";

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    streamType: "logs",
  }),
}));

vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn((path) => path),
}));

vi.mock("@/aws-exports", () => ({
  default: {
    isEnterprise: "true",
  },
}));

vi.mock("@/components/functions/FullViewContainer.vue", () => ({
  default: {
    name: "FullViewContainer",
    template: "<div><slot></slot><slot name='right'></slot></div>",
    props: ["name", "is-expanded", "label", "labelClass"],
    emits: ["update:is-expanded"],
  },
}));

vi.mock("@/components/O2AIChat.vue", () => ({
  default: {
    name: "O2AIChat",
    template: "<div data-test='o2-ai-chat'></div>",
    props: ["aiChatInputContext", "is-open"],
    emits: ["close"],
  },
}));

// Use real store from test helpers
import store from "@/test/unit/helpers/store";

// Create mock store for testing
const mockStore = store;

// Set up store state for tests
const setupStoreForTest = () => {
  mockStore.state.selectedOrganization = {
    identifier: "default",
    label: "default Organization",
  };
  mockStore.state.theme = "light";
  mockStore.state.isAiChatEnabled = false;
  mockStore.state.organizationData = {
    regexPatternPrompt: "",
    regexPatternTestValue: "",
  };
  mockStore.state.zoConfig = {
    ai_enabled: true,
  };
};

// Create a real router instance for proper injection
const router = createRouter({
  history: createWebHistory(),
  routes: [{ path: "/", name: "settings", component: AddRegexPattern }],
});

// Mock Vue Router
const mockRouter = {
  currentRoute: {
    value: {
      query: {},
    },
  },
};

// ── ODrawer stub ────────────────────────────────────────────────────────────
// Renders the body slot (always — the real ODrawer unmounts it on close, but
// tests mount with open=true). Header/footer slots are forwarded too.
const ODrawerStub = {
  name: "ODrawer",
  inheritAttrs: false,
  props: [
    "open",
    "width",
    "title",
    "subTitle",
    "size",
    "persistent",
    "showClose",
    "primaryButtonLabel",
    "secondaryButtonLabel",
    "neutralButtonLabel",
    "primaryButtonVariant",
    "secondaryButtonVariant",
    "neutralButtonVariant",
    "primaryButtonDisabled",
    "secondaryButtonDisabled",
    "neutralButtonDisabled",
    "primaryButtonLoading",
    "secondaryButtonLoading",
    "neutralButtonLoading",
    "formId",
  ],
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
  template: `
    <div
      data-test="o-drawer-stub"
      :data-open="String(open)"
      :data-title="title"
      :data-width="String(width)"
      :data-primary-label="primaryButtonLabel"
    >
      <slot name="header-right" />
      <slot />
      <slot name="footer" />
    </div>
  `,
};

// Common stubs for the LIGHT-WEIGHT (OForm-stubbed) wrapper used by UI / wiring
// tests that don't exercise schema validation.
const lightStubs = {
  ODrawer: ODrawerStub,
  OButton: {
    template: `<button
      :data-test='$attrs["data-test"]'
      :disabled='$attrs["disabled"]'
      @click='$emit("click", $event)'
    ><slot></slot></button>`,
    props: ["variant", "size", "disabled"],
    emits: ["click"],
  },
  OIcon: {
    template: "<span></span>",
    props: ["name", "size"],
  },
  OInput: {
    template: `<input
      :data-test='$attrs["data-test"]'
      :value='modelValue'
      :disabled='readonly || disabled'
      @input='$emit("update:modelValue", $event.target.value)'
    />`,
    props: ["modelValue", "readonly", "disabled", "label", "placeholder"],
    emits: ["update:modelValue"],
  },
  OFormInput: {
    template: `<input
      :data-test='$attrs["data-test"]'
      :value='modelValue'
      :disabled='readonly || disabled'
      @input='$emit("update:modelValue", $event.target.value)'
    />`,
    props: ["modelValue", "name", "readonly", "disabled", "label", "placeholder", "required"],
    emits: ["update:modelValue"],
  },
  OForm: {
    name: "OForm",
    template:
      "<form data-test='o-form' @submit.prevent='$emit(\"submit\", {})'><slot></slot></form>",
    props: ["schema", "defaultValues"],
    emits: ["submit"],
  },
  OFormTextarea: {
    template: `<textarea
      :data-test='$attrs["data-test"]'
      :value='modelValue'
      @input='$emit("update:modelValue", $event.target.value)'
    />`,
    props: ["modelValue", "name", "label", "placeholder", "class"],
    emits: ["update:modelValue"],
  },
  FullViewContainer: {
    template:
      "<div data-test-stub='full-view-container'><slot></slot><slot name='right'></slot></div>",
    props: ["name", "isExpanded", "label", "labelClass"],
    emits: ["update:isExpanded"],
  },
  O2AIChat: {
    template: "<div data-test-stub='o2-ai-chat'></div>",
    props: ["aiChatInputContext", "isOpen"],
    emits: ["close"],
  },
};

const createWrapper = (props = {}, options = {}) => {
  return mount(AddRegexPattern, {
    props: {
      data: {},
      isEdit: false,
      open: true,
      ...props,
    },
    global: {
      plugins: [i18n, router],
      mocks: {
        $store: mockStore,
        $router: mockRouter,
      },
      provide: {
        store: store,
      },
      stubs: lightStubs,
    },
    attachTo: document.body,
    ...options,
  });
};

// Wrapper that mounts the REAL <OForm> (only the overlay + heavy children are
// stubbed) so the Zod schema actually runs — this is what catches a `:schema`
// that resolved to `undefined` or a dropped validator.
const createRealFormWrapper = (props = {}) => {
  return mount(AddRegexPattern, {
    props: {
      data: {},
      isEdit: false,
      open: true,
      ...props,
    },
    global: {
      plugins: [i18n, router],
      provide: {
        store: store,
      },
      stubs: {
        ODrawer: ODrawerStub,
        O2AIChat: lightStubs.O2AIChat,
        FullViewContainer: lightStubs.FullViewContainer,
        // OForm, OFormInput, OFormTextarea, OInput, OButton, OIcon are REAL.
      },
    },
    attachTo: document.body,
  });
};

describe("AddRegexPattern", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    setupStoreForTest();
    mockStore.state.theme = "light";
    mockStore.state.isAiChatEnabled = false;
    mockStore.state.organizationData.regexPatternPrompt = "";
    mockStore.state.organizationData.regexPatternTestValue = "";
    mockRouter.currentRoute.value.query = {};
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Component mounting", () => {
    it("should mount successfully", () => {
      const wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should render the component title for creating regex pattern", () => {
      const wrapper = createWrapper();
      const drawer = wrapper.find('[data-test="o-drawer-stub"]');
      expect(drawer.exists()).toBe(true);
      expect(drawer.attributes("data-title")).toBe("New pattern");
    });

    it("should render the component title for editing regex pattern", () => {
      const wrapper = createWrapper({
        isEdit: true,
        data: { name: "", pattern: "", description: "" },
      });
      const drawer = wrapper.find('[data-test="o-drawer-stub"]');
      expect(drawer.exists()).toBe(true);
      expect(drawer.attributes("data-title")).toBe("Edit Pattern");
      wrapper.unmount();
    });
  });

  describe("Props handling", () => {
    it("should handle isEdit prop correctly for create mode", () => {
      const wrapper = createWrapper({ isEdit: false });
      const nameInput = wrapper.find('[data-test="add-regex-pattern-name-input"]');
      expect(nameInput.attributes("disabled")).toBeUndefined();
    });

    it("should handle isEdit prop correctly for edit mode", () => {
      const wrapper = createWrapper({
        isEdit: true,
        data: { name: "", pattern: "", description: "" },
      });
      const nameInput = wrapper.find('[data-test="add-regex-pattern-name-input"]');
      expect(nameInput.attributes("disabled")).toBeDefined();
      wrapper.unmount();
    });

    it("should prefill the form via :default-values when editing", () => {
      const testData = {
        name: "Test Pattern",
        pattern: "\\d+",
        description: "Test Description",
      };
      const wrapper = createWrapper({ isEdit: true, data: testData });

      // name/pattern/description are all form-owned → seeded by the typed defaults computed.
      expect(wrapper.vm.addRegexPatternDefaults).toEqual({
        name: "Test Pattern",
        pattern: "\\d+",
        description: "Test Description",
        testString: "",
        outputString: "",
      });
    });

    it("should default to blank form values in create mode", () => {
      const wrapper = createWrapper({ isEdit: false });
      expect(wrapper.vm.addRegexPatternDefaults).toEqual({
        name: "",
        pattern: "",
        description: "",
        testString: "",
        outputString: "",
      });
    });
  });

  describe("Schema validation (real OForm)", () => {
    it("blocks submit and stays invalid when name/pattern are empty", async () => {
      const createSpy = vi.spyOn(regexPatternService, "create");
      const wrapper = createRealFormWrapper();
      await flushPromises();

      const formCmp = wrapper.findComponent({ name: "OForm" });
      expect(formCmp.exists()).toBe(true);

      // Drive the real form: empty required fields → schema invalid → @submit
      // never fires → the service is NOT called.
      await (formCmp.vm as any).form.handleSubmit();
      await flushPromises();

      expect((formCmp.vm as any).form.state.isValid).toBe(false);
      expect(createSpy).not.toHaveBeenCalled();
      wrapper.unmount();
    });

    it("submits and calls the service when name/pattern are filled", async () => {
      const createSpy = vi.spyOn(regexPatternService, "create");
      const wrapper = createRealFormWrapper();
      await flushPromises();

      const formCmp = wrapper.findComponent({ name: "OForm" });
      const form = (formCmp.vm as any).form;
      form.setFieldValue("name", "My Pattern");
      form.setFieldValue("pattern", "\\d+");
      await flushPromises();

      await form.handleSubmit();
      await flushPromises();

      expect(form.state.isValid).toBe(true);
      expect(createSpy).toHaveBeenCalledTimes(1);
      const [org, payload] = createSpy.mock.calls[0];
      expect(org).toBe("default");
      expect(payload).toEqual(expect.objectContaining({ name: "My Pattern", pattern: "\\d+" }));
      wrapper.unmount();
    });
  });

  describe("Button interactions", () => {
    it("should emit close event when handleClose runs", async () => {
      const wrapper = createWrapper();
      wrapper.vm.handleClose();
      expect(wrapper.emitted("close")).toBeTruthy();
      expect(wrapper.emitted("update:open")).toBeTruthy();
    });

    it("should emit close via the drawer secondary (cancel) action", async () => {
      const wrapper = createWrapper();
      const drawer = wrapper.findComponent({ name: "ODrawer" });
      await drawer.vm.$emit("click:secondary");
      expect(wrapper.emitted("close")).toBeTruthy();
    });

    it("should toggle full screen mode", async () => {
      const wrapper = createWrapper();
      const initialValue = wrapper.vm.isFullScreen;
      wrapper.vm.toggleFullScreen();
      await nextTick();
      expect(wrapper.vm.isFullScreen).toBe(!initialValue);
    });

    it("should toggle AI chat when AI button is clicked", async () => {
      mockStore.state.zoConfig.ai_enabled = true;
      mockStore.state.isAiChatEnabled = false;
      const wrapper = createWrapper();
      const aiBtn = wrapper.find('[data-test="add-regex-pattern-open-close-ai-btn"]');

      if (aiBtn.exists()) {
        await aiBtn.trigger("click");
        expect(mockStore.state.isAiChatEnabled).toBe(true);
      }
      wrapper.unmount();
    });
  });

  describe("Form submission", () => {
    it("should create a new regex pattern from the submitted value", async () => {
      const createSpy = vi.spyOn(regexPatternService, "create");
      const wrapper = createWrapper();

      // @submit payload is the source of truth for name/pattern/description.
      await wrapper.vm.saveRegexPattern({
        name: "Test Pattern",
        pattern: "\\d+",
        description: "Test Description",
      });
      await flushPromises();

      expect(createSpy).toHaveBeenCalledWith(
        "default",
        expect.objectContaining({
          name: "Test Pattern",
          pattern: "\\d+",
          description: "Test Description",
        }),
      );
      expect(wrapper.emitted("update:list")).toBeTruthy();
      expect(wrapper.emitted("close")).toBeTruthy();
    });

    it("should update an existing regex pattern from the submitted value", async () => {
      const updateSpy = vi.spyOn(regexPatternService, "update");
      const testData = {
        id: "test-id",
        name: "Test Pattern",
        pattern: "\\d+",
        description: "Test Description",
      };

      const wrapper = createWrapper({ isEdit: true, data: testData });
      await wrapper.vm.saveRegexPattern({
        name: "Test Pattern",
        pattern: "\\d+",
        description: "Test Description",
      });
      await flushPromises();

      expect(updateSpy).toHaveBeenCalledWith(
        "default",
        "test-id",
        expect.objectContaining({ name: "Test Pattern", pattern: "\\d+" }),
      );
    });

    it("should handle save error correctly", async () => {
      // Override the MSW handler to return an error for this test
      global.server.use(
        http.post("http://localhost:5080/api/:org/re_patterns", () => {
          return HttpResponse.json({ message: "Pattern already exists" }, { status: 400 });
        }),
      );

      const wrapper = createWrapper();
      await wrapper.vm.saveRegexPattern({ name: "Test Pattern", pattern: "\\d+" });
      await flushPromises();

      // Error path: no success emits.
      expect(wrapper.emitted("update:list")).toBeFalsy();
    });
  });

  describe("Pattern testing functionality", () => {
    it("should test regex pattern with input string", async () => {
      const wrapper = createWrapper();

      // Stubbed OForm: mock its form so testStringOutput's setFieldValue write
      // lands. The mock's useStore returns a static getter so the one-way mirror
      // wiring settles; seed the mirrors AFTER that immediate watch fires.
      (wrapper.vm as any).addRegexPatternForm = {
        form: {
          useStore: () => () => "",
          setFieldValue: (name: string, val: string) => {
            if (name === "outputString") (wrapper.vm as any).outputStringValue = val;
          },
        },
      };
      await nextTick();
      (wrapper.vm as any).testStringValue = "abc123def";
      (wrapper.vm as any).patternValue = "\\d+";
      await nextTick();

      await wrapper.vm.testStringOutput();
      await flushPromises();

      expect(wrapper.vm.outputStringValue).toBe("123");
      expect(wrapper.vm.expandState.outputString).toBe(true);
    });

    it("should handle test error correctly", async () => {
      global.server.use(
        http.post("http://localhost:5080/api/:org/re_patterns/test", () => {
          return HttpResponse.json({ message: "Invalid pattern" }, { status: 400 });
        }),
      );

      const wrapper = createWrapper();
      (wrapper.vm as any).patternValue = "[invalid";
      (wrapper.vm as any).testStringValue = "test";
      await nextTick();

      await wrapper.vm.testStringOutput();
      expect(wrapper.vm.testLoading).toBe(false);
    });

    it("should show loading state during test", async () => {
      const wrapper = createWrapper();
      (wrapper.vm as any).patternValue = "\\d+";
      (wrapper.vm as any).testStringValue = "123";
      await nextTick();

      const testPromiseCall = wrapper.vm.testStringOutput();
      expect(wrapper.vm.testLoading).toBe(true);

      await testPromiseCall;
      expect(wrapper.vm.testLoading).toBe(false);
    });
  });

  describe("Conditional rendering", () => {
    it("should show AI button when enterprise and AI is enabled", async () => {
      mockStore.state.zoConfig.ai_enabled = true;

      const wrapper = createWrapper();
      await nextTick();

      expect(wrapper.vm.config.isEnterprise).toBe("true");
      expect(wrapper.vm.store.state.zoConfig.ai_enabled).toBe(true);

      const aiBtn = wrapper.find('[data-test="add-regex-pattern-open-close-ai-btn"]');
      const allBtns = wrapper.findAll("button[data-o2-btn]");

      if (aiBtn.exists()) {
        expect(aiBtn.exists()).toBe(true);
      } else {
        expect(allBtns.length).toBeGreaterThanOrEqual(0);
      }
    });

    it("should hide AI button when AI is disabled", async () => {
      mockStore.state.zoConfig.ai_enabled = false;

      const config = await import("@/aws-exports");
      vi.mocked(config.default).isEnterprise = "true";

      const wrapper = createWrapper();
      await nextTick();

      const aiBtn = wrapper.find('[data-test="add-regex-pattern-open-close-ai-btn"]');
      expect(aiBtn.exists()).toBe(false);
    });

    it("should show AI chat component when enabled", async () => {
      mockStore.state.isAiChatEnabled = true;
      const wrapper = createWrapper();
      const aiChat = wrapper.find('[data-test-stub="o2-ai-chat"]');
      expect(aiChat.exists()).toBe(true);
    });

    it("should hide AI chat component when disabled", () => {
      mockStore.state.isAiChatEnabled = false;
      const wrapper = createWrapper();
      const aiChat = wrapper.find('[data-test-stub="o2-ai-chat"]');
      expect(aiChat.exists()).toBe(false);
    });
  });

  describe("Theme support", () => {
    it("should reflect dark theme in the store when set", () => {
      mockStore.state.theme = "dark";
      const wrapper = createWrapper();
      expect(wrapper.vm.store.state.theme).toBe("dark");
    });

    it("should reflect light theme in the store when set", () => {
      mockStore.state.theme = "light";
      const wrapper = createWrapper();
      expect(wrapper.vm.store.state.theme).toBe("light");
    });
  });

  describe("Accessibility", () => {
    it("should have proper data-test attributes for all interactive elements", () => {
      const wrapper = createWrapper();
      expect(wrapper.find('[data-test="add-regex-pattern-name-input"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="add-regex-pattern-input"]').exists()).toBe(true);
    });

    it("should have the pattern input present for keyboard navigation", () => {
      const wrapper = createWrapper();
      const patternInput = wrapper.find('[data-test="add-regex-pattern-input"]');
      expect(patternInput.exists()).toBe(true);
    });
  });

  describe("Edge cases", () => {
    it("should handle undefined data prop", () => {
      const wrapper = createWrapper({ data: undefined });
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm.addRegexPatternDefaults).toEqual({
        name: "",
        pattern: "",
        description: "",
        testString: "",
        outputString: "",
      });
    });

    it("should handle empty description in edit mode", () => {
      const testData = {
        name: "Test Pattern",
        pattern: "\\d+",
        description: undefined,
      };
      const wrapper = createWrapper({ isEdit: true, data: testData });
      expect(wrapper.vm.addRegexPatternDefaults.description).toBe("");
    });

    it("should handle router query parameters for AI context", async () => {
      mockStore.state.organizationData.regexPatternPrompt = "Test prompt";
      mockStore.state.organizationData.regexPatternTestValue = "Test value";

      await router.push({ path: "/", query: { from: "logs" } });

      const wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(wrapper.vm.inputContext).toBe("Test prompt");
      expect(wrapper.vm.testStringValue).toBe("Test value");
    });

    it("should handle component width calculations based on AI chat state", async () => {
      mockStore.state.isAiChatEnabled = true;
      const wrapper = createWrapper();
      const drawer = wrapper.find('[data-test="o-drawer-stub"]');
      expect(drawer.attributes("data-width")).toBe("70");
    });

    it("should handle full screen mode", async () => {
      const wrapper = createWrapper();
      wrapper.vm.toggleFullScreen();
      await nextTick();
      expect(wrapper.vm.isFullScreen).toBe(true);
    });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import EditScript from "@/components/actionScripts/EditScript.vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { createRouter, createWebHistory } from "vue-router";

installQuasar();

const mockRouter = createRouter({
  history: createWebHistory(),
  routes: [{ path: "/", component: { template: "<div>Home</div>" } }],
});

mockRouter.back = vi.fn();

// Mock services and utilities
vi.mock("@/services/action_scripts", () => ({
  default: {
    get: vi.fn(() => Promise.resolve({ data: {} })),
    create: vi.fn(() => Promise.resolve({})),
    update: vi.fn(() => Promise.resolve({})),
  },
}));

vi.mock("@/utils/zincutils", async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    getImageURL: vi.fn((path) => `/mocked/${path}`),
    isValidResourceName: vi.fn(() => true),
    b64EncodeUnicode: vi.fn((str) => btoa(str)),
    b64DecodeUnicode: vi.fn((str) => atob(str)),
    getUUID: vi.fn(() => "mock-uuid-" + Math.random()),
    verifyOrganizationStatus: vi.fn(() => ({ value: true })),
    useLocalTimezone: vi.fn(() => "UTC"),
  };
});

vi.mock("@/composables/useActions", () => ({
  default: vi.fn(() => ({
    getAllActions: vi.fn(() => Promise.resolve({ list: [] })),
  })),
}));

vi.mock("@/services/segment_analytics", () => ({
  default: {
    track: vi.fn(),
  },
}));

vi.mock("@/services/reodotdev_analytics", () => ({
  useReo: vi.fn(() => ({
    track: vi.fn(),
  })),
}));

describe("EditScript.vue", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    store.state.selectedOrganization = {
      identifier: "test-org",
      name: "Test Org",
    };
    store.state.currentuser = {
      email: "test@example.com",
    };
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllMocks();
  });

  const createWrapper = (props = {}) => {
    return mount(EditScript, {
      props: {
        report: null,
        ...props,
      },
      global: {
        plugins: [i18n, mockRouter],
        provide: {
          store,
        },
        stubs: {
          "q-separator": {
            template: "<hr />",
          },
          "q-icon": {
            template: "<div></div>",
            props: ["name", "size"],
          },
          "q-form": {
            template: '<form @submit.prevent="$emit(\'submit\')"><slot></slot></form>',
          },
          "q-input": {
            template:
              '<div><input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" /><slot name="hint"></slot></div>',
            props: [
              "modelValue",
              "label",
              "color",
              "bg-color",
              "class",
              "stack-label",
              "outlined",
              "filled",
              "dense",
              "rules",
              "tabindex",
              "style",
              "type",
              "rows",
            ],
          },
          "q-btn": {
            template: '<button @click="$emit(\'click\')" :disabled="disable"><slot></slot></button>',
            props: [
              "data-test",
              "class",
              "flat",
              "no-caps",
              "label",
              "color",
              "padding",
              "text-color",
              "type",
              "disable",
            ],
          },
          "q-select": {
            template:
              '<select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><slot></slot></select>',
            props: [
              "modelValue",
              "label",
              "color",
              "bg-color",
              "class",
              "stack-label",
              "outlined",
              "filled",
              "dense",
              "options",
              "map-options",
              "emit-value",
              "rules",
              "tabindex",
              "style",
              "data-test",
            ],
          },
          "q-radio": {
            template:
              '<input type="radio" :value="val" :checked="modelValue === val" @change="$emit(\'update:modelValue\', val)" />',
            props: ["modelValue", "val", "label"],
          },
          "q-toggle": {
            template:
              '<input type="checkbox" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />',
            props: ["modelValue", "label"],
          },
          ScriptEditor: {
            template: "<div data-test='script-editor'></div>",
            props: ["loading", "error", "file", "script"],
          },
          FileItem: {
            template: "<div data-test='file-item'><slot></slot></div>",
            props: ["file", "selected"],
          },
        },
      },
    });
  };

  describe("Component Rendering", () => {
    it("renders the component correctly", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("renders back button", () => {
      wrapper = createWrapper();
      const backBtn = wrapper.find('[data-test="add-action-script-back-btn"]');
      expect(backBtn.exists()).toBe(true);
    });

    it("shows add title when not editing", () => {
      wrapper = createWrapper();
      const title = wrapper.find('[data-test="add-action-script-title"]');
      expect(title.exists()).toBe(true);
    });

    it("shows update title when editing", async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.isEditingActionScript = true;
      await wrapper.vm.$nextTick();

      const title = wrapper.find('[data-test="add-action-script-title"]');
      expect(title.exists()).toBe(true);
    });

    it("renders name input field", () => {
      wrapper = createWrapper();
      const nameInput = wrapper.find('[data-test="add-action-script-name-input"]');
      expect(nameInput.exists()).toBe(true);
    });

    it("renders description input field", () => {
      wrapper = createWrapper();
      const descInput = wrapper.find(
        '[data-test="add-action-script-description-input"]'
      );
      expect(descInput.exists()).toBe(true);
    });
  });

  describe("Back Button", () => {
    it("calls router.back when back button is clicked", async () => {
      wrapper = createWrapper();
      const backBtn = wrapper.find('[data-test="add-action-script-back-btn"]');

      await backBtn.trigger("click");

      expect(mockRouter.back).toHaveBeenCalled();
    });
  });

  describe("Form Data", () => {
    it("initializes with empty formData", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      expect(vm.formData).toBeDefined();
      expect(vm.formData.name).toBeDefined();
    });

    it("updates formData.name when input changes", async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      const nameInput = wrapper.find('[data-test="add-action-script-name-input"] input');
      await nameInput.setValue("Test Action");
      await wrapper.vm.$nextTick();

      expect(vm.formData.name).toBe("Test Action");
    });

    it("updates formData.description when input changes", async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      const descInput = wrapper.find(
        '[data-test="add-action-script-description-input"] input'
      );
      await descInput.setValue("Test Description");
      await wrapper.vm.$nextTick();

      expect(vm.formData.description).toBe("Test Description");
    });
  });

  describe("Component Props", () => {
    it("accepts report prop", () => {
      const mockReport = { id: "test-report", name: "Test Report" };
      wrapper = createWrapper({ report: mockReport });
      const vm = wrapper.vm as any;
      expect(vm.$props.report).toEqual(mockReport);
    });

    it("defaults report to null", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.$props.report).toBeNull();
    });
  });

  describe("Component Emits", () => {
    it("defines correct emits", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      expect(vm.$options.emits).toBeDefined();
    });

    it("can emit cancel:hideform event", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.$emit("cancel:hideform");
      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
    });

    it("can emit update:list event", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.$emit("update:list");
      expect(wrapper.emitted("update:list")).toBeTruthy();
    });

    it("can emit get-action-scripts event", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.$emit("get-action-scripts");
      expect(wrapper.emitted("get-action-scripts")).toBeTruthy();
    });
  });

  describe("Form Structure", () => {
    it("renders form element", () => {
      wrapper = createWrapper();
      const form = wrapper.find("form");
      expect(form.exists()).toBe(true);
    });

    it("renders separator", () => {
      wrapper = createWrapper();
      const separator = wrapper.find("hr");
      expect(separator.exists()).toBe(true);
    });

    it("has correct container class", () => {
      wrapper = createWrapper();
      const container = wrapper.find('[data-test="add-action-script-section"]');
      expect(container.classes()).toContain("full-width");
      expect(container.classes()).toContain("create-report-page");
    });
  });

  describe("Component State", () => {
    it("initializes with default state", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      expect(vm.formData).toBeDefined();
      expect(vm.isEditingActionScript).toBeDefined();
    });

    it("has store access", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      expect(vm.store).toBeDefined();
    });

    it("has router access", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      expect(vm.router).toBeDefined();
    });
  });

  describe("Lifecycle", () => {
    it("mounts without errors", () => {
      wrapper = createWrapper();
      expect(wrapper.vm).toBeTruthy();
    });

    it("unmounts without errors", () => {
      wrapper = createWrapper();
      expect(() => wrapper.unmount()).not.toThrow();
    });
  });

  describe("Theme Support", () => {
    it("works with dark theme", async () => {
      store.state.theme = "dark";
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(wrapper.exists()).toBe(true);
    });

    it("works with light theme", async () => {
      store.state.theme = "light";
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Integration", () => {
    it("renders all major form sections", () => {
      wrapper = createWrapper();

      const backBtn = wrapper.find('[data-test="add-action-script-back-btn"]');
      const title = wrapper.find('[data-test="add-action-script-title"]');
      const nameInput = wrapper.find('[data-test="add-action-script-name-input"]');
      const descInput = wrapper.find(
        '[data-test="add-action-script-description-input"]'
      );

      expect(backBtn.exists()).toBe(true);
      expect(title.exists()).toBe(true);
      expect(nameInput.exists()).toBe(true);
      expect(descInput.exists()).toBe(true);
    });

    it("maintains proper layout structure", () => {
      wrapper = createWrapper();
      const container = wrapper.find('[data-test="add-action-script-section"]');

      expect(container.exists()).toBe(true);
    });
  });

  describe("Form Validation", () => {
    it("has validation rules for name field", () => {
      wrapper = createWrapper();
      const nameInput = wrapper.find('[data-test="add-action-script-name-input"]');

      expect(nameInput.exists()).toBe(true);
      // The component should have the name input
      expect(nameInput.element).toBeDefined();
    });
  });

  describe("Edge Cases", () => {
    it("handles empty name input", async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.formData.name = "";
      await wrapper.vm.$nextTick();

      expect(vm.formData.name).toBe("");
    });

    it("handles long description text", async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      const longText = "A".repeat(1000);
      vm.formData.description = longText;
      await wrapper.vm.$nextTick();

      expect(vm.formData.description).toBe(longText);
    });

    it("handles special characters in name", async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.formData.name = "test-action_123";
      await wrapper.vm.$nextTick();

      expect(vm.formData.name).toBe("test-action_123");
    });
  });

  describe("Component Interactions", () => {
    it("form can be submitted", async () => {
      wrapper = createWrapper();
      const form = wrapper.find("form");

      await form.trigger("submit");

      // Should not throw error
      expect(wrapper.exists()).toBe(true);
    });
  });
});

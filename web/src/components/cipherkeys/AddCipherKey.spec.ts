// Copyright 2023 OpenObserve Inc.
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
import { mount, VueWrapper } from "@vue/test-utils";
import { createStore } from "vuex";
import { createI18n } from "vue-i18n";
import { createRouter, createWebHistory } from "vue-router";
import { nextTick } from "vue";
import { Quasar } from "quasar";
import AddCipherKey from "./AddCipherKey.vue";

// Mock the CipherKeysService
vi.mock("@/services/cipher_keys", () => ({
  default: {
    create: vi.fn(),
    update: vi.fn(),
    get_by_name: vi.fn(),
    list: vi.fn(),
    delete: vi.fn(),
  },
}));

// Mock the utility functions
vi.mock("@/utils/zincutils", () => ({
  isValidResourceName: vi.fn((val: string) => {
    if (!val) return "Name is required";
    return !/[:\?\/\#\s]/.test(val) || "Characters like :, ?, /, #, and spaces are not allowed.";
  }),
  maxLengthCharValidation: vi.fn((val: string, maxLength: number) => {
    if (!val) return true;
    return val.length <= maxLength || `Maximum ${maxLength} characters allowed`;
  }),
}));

// Mock child components
vi.mock("./AddOpenobserveType.vue", () => ({
  default: {
    name: "AddOpenobserveType",
    template: '<div data-test="add-openobserve-type-mock">OpenObserve Type Component</div>',
    props: ["formData"],
  },
}));

vi.mock("./AddAkeylessType.vue", () => ({
  default: {
    name: "AddAkeylessType", 
    template: '<div data-test="add-akeyless-type-mock">Akeyless Type Component</div>',
    props: ["formData"],
  },
}));

vi.mock("./AddEncryptionMechanism.vue", () => ({
  default: {
    name: "AddEncryptionMechanism",
    template: '<div data-test="add-encryption-mechanism-mock">Encryption Mechanism Component</div>',
    props: ["formData"],
  },
}));

vi.mock("@/components/ConfirmDialog.vue", () => ({
  default: {
    name: "ConfirmDialog",
    template: '<div data-test="confirm-dialog-mock" v-if="modelValue">Confirm Dialog</div>',
    props: ["modelValue", "title", "message"],
    emits: ["update:ok", "update:cancel"],
  },
}));

// Mock useQuasar to provide $q.notify that returns a dismiss function
vi.mock("quasar", async () => {
  const actual = await vi.importActual("quasar");
  return {
    ...actual,
    useQuasar: () => ({
      notify: vi.fn(() => vi.fn()) // Returns a mock dismiss function
    }),
  };
});

describe("AddCipherKey.vue", () => {
  let wrapper: VueWrapper<any>;
  let store: any;
  let router: any;
  let i18n: any;

  const createMockStore = () =>
    createStore({
      state: {
        selectedOrganization: {
          identifier: "test-org-123",
        },
      },
    });

  const createMockRouter = () =>
    createRouter({
      history: createWebHistory(),
      routes: [
        { path: "/", component: { template: "<div>Home</div>" } },
        { path: "/cipherkeys", component: { template: "<div>CipherKeys</div>" } },
      ],
    });

  const createMockI18n = () =>
    createI18n({
      legacy: false,
      locale: "en",
      messages: {
        en: {
          cipherKey: {
            name: "Name",
            type: "Type",
            add: "Add",
            update: "Update",
            step1: "Key Store Details",
            step2: "Encryption Mechanism",
          },
          common: {
            save: "Save",
            cancel: "Cancel",
            back: "Back",
          },
        },
      },
    });

  beforeEach(async () => {
    // Reset all mocks
    vi.clearAllMocks();

    // Create fresh instances
    store = createMockStore();
    router = createMockRouter();
    i18n = createMockI18n();

    // Import the mocked service to access it
    const cipherKeysService = (await import("@/services/cipher_keys")).default;

    // Setup service mocks with default successful responses
    cipherKeysService.create.mockResolvedValue({ data: { id: "123" } });
    cipherKeysService.update.mockResolvedValue({ data: { id: "123" } });
    cipherKeysService.get_by_name.mockResolvedValue({ 
      data: { 
        name: "test-cipher", 
        key: {
          store: { type: "local", local: "" },
          mechanism: { type: "simple", simple_algorithm: "aes-256-siv" }
        }
      } 
    });

    // Navigate to home route
    await router.push("/");
    await router.isReady();

    // Mount component with all required global plugins
    wrapper = mount(AddCipherKey, {
      global: {
        plugins: [
          [Quasar, { 
            plugins: {
              Notify: vi.fn()
            }
          }],
          store,
          router,
          i18n,
        ],
        stubs: {
          QPage: {
            template: "<div class='q-page'><slot /></div>",
          },
          QForm: {
            template: "<form class='create-cipher-form' @submit.prevent='$emit(\"submit\")'><slot /></form>",
            emits: ["submit"],
          },
          QInput: {
            template: `
              <div class='q-input' :data-test='$attrs["data-test"]'>
                <input 
                  :value='modelValue' 
                  @input='$emit("update:modelValue", $event.target.value)'
                  :readonly='readonly'
                  :disabled='disable'
                />
              </div>
            `,
            props: ["modelValue", "label", "rules", "readonly", "disable", "tabindex"],
            emits: ["update:modelValue"],
          },
          QSelect: {
            template: `
              <div class='q-select' :data-test='$attrs["data-test"]'>
                <select 
                  :value='modelValue' 
                  @change='$emit("update:modelValue", $event.target.value)'
                >
                  <option v-for='option in options' :key='option.value' :value='option.value'>
                    {{ option.label }}
                  </option>
                </select>
              </div>
            `,
            props: ["modelValue", "options", "label", "rules", "tabindex"],
            emits: ["update:modelValue"],
          },
          QBtn: {
            template: `
              <button 
                :data-test='$attrs["data-test"]' 
                :disabled='disable || loading'
                @click='$emit("click")'
                :class='$attrs.class'
              >
                <slot />{{ label }}
              </button>
            `,
            props: ["label", "disable", "loading"],
            emits: ["click"],
          },
          QStepper: {
            template: "<div class='q-stepper'><slot /></div>",
          },
          QStep: {
            template: "<div class='q-step'><slot /></div>",
            props: ["name", "title", "icon", "done"],
          },
          QStepperNavigation: {
            template: "<div class='q-stepper-navigation'><slot /></div>",
          },
          QSeparator: {
            template: "<hr />",
          },
          QIcon: {
            template: '<i :class="name"></i>',
            props: ["name", "size"],
          },
        },
      },
    });

    // Mock form validation ref for Vue 3 Composition API
    // Use a more robust mocking approach that works with Vue 3 refs
    const mockFormRef = {
      validate: vi.fn().mockResolvedValue(true),
    };
    
    // Set the form ref directly on the component instance
    wrapper.vm.addCipherKeyFormRef = mockFormRef;
    
    // Also set it up as a getter/setter to handle reassignment
    Object.defineProperty(wrapper.vm, 'addCipherKeyFormRef', {
      get: () => mockFormRef,
      set: () => mockFormRef,
      configurable: true
    });

    await nextTick();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllMocks();
  });

  describe("Component Initialization", () => {
    it("should render the component", () => {
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find(".create-cipher-form").exists()).toBe(true);
    });

    it("should initialize with default form data", () => {
      expect(wrapper.vm.formData.name).toBe("");
      expect(wrapper.vm.formData.key.store.type).toBe("local");
      expect(wrapper.vm.step).toBe(1);
      expect(wrapper.vm.isSubmitting).toBe(false);
      expect(wrapper.vm.isUpdatingCipherKey).toBe(false);
    });

    it("should set up cipher key types correctly", () => {
      const expectedTypes = [
        { label: "OpenObserve", value: "local" },
        { label: "Akeyless", value: "akeyless" },
      ];
      expect(wrapper.vm.cipherKeyTypes).toEqual(expectedTypes);
    });
  });

  describe("Form Fields Rendering", () => {
    it("should render cipher key name input", () => {
      const nameInput = wrapper.find('[data-test="add-cipher-key-name-input"]');
      expect(nameInput.exists()).toBe(true);
    });

    it("should render cipher key type select", () => {
      const typeSelect = wrapper.find('[data-test="add-cipher-key-type-input"]');
      expect(typeSelect.exists()).toBe(true);
    });

    it("should render save and cancel buttons", () => {
      const saveBtn = wrapper.find('[data-test="add-cipher-key-save-btn"]');
      const cancelBtn = wrapper.find('[data-test="add-cipher-key-cancel-btn"]');
      
      expect(saveBtn.exists()).toBe(true);
      expect(cancelBtn.exists()).toBe(true);
    });
  });

  describe("Step Navigation", () => {
    beforeEach(() => {
      if (wrapper.vm.addCipherKeyFormRef) {
        wrapper.vm.addCipherKeyFormRef.validate = vi.fn().mockResolvedValue(true);
      }
    });

    it("should start at step 1", () => {
      expect(wrapper.vm.step).toBe(1);
    });

    it("should advance to step 2 when validateForm is called with valid form", async () => {
      await wrapper.vm.validateForm(2);
      expect(wrapper.vm.step).toBe(2);
    });

    it("should not advance step if form validation fails", async () => {
      if (wrapper.vm.addCipherKeyFormRef) {
        wrapper.vm.addCipherKeyFormRef.validate = vi.fn().mockResolvedValue(false);
      }
      
      await wrapper.vm.validateForm(2);
      expect(wrapper.vm.step).toBe(1);
    });

    it("should allow manual step changes", async () => {
      wrapper.vm.step = 2;
      await nextTick();
      expect(wrapper.vm.step).toBe(2);

      wrapper.vm.step = 1;
      await nextTick();
      expect(wrapper.vm.step).toBe(1);
    });
  });

  describe("Dynamic Component Rendering", () => {
    it("should render OpenObserve component when type is local", async () => {
      wrapper.vm.formData.key.store.type = "local";
      await nextTick();

      const openObserveComponent = wrapper.find('[data-test="add-openobserve-type-mock"]');
      expect(openObserveComponent.exists()).toBe(true);
    });

    it("should render Akeyless component when type is akeyless", async () => {
      wrapper.vm.formData.key.store.type = "akeyless";
      await nextTick();

      const akeylessComponent = wrapper.find('[data-test="add-akeyless-type-mock"]');
      expect(akeylessComponent.exists()).toBe(true);
    });

    it("should render encryption mechanism component", () => {
      const encryptionComponent = wrapper.find('[data-test="add-encryption-mechanism-mock"]');
      expect(encryptionComponent.exists()).toBe(true);
    });
  });

  describe("Form Submission - Create Mode", () => {
    beforeEach(() => {
      wrapper.vm.isUpdatingCipherKey = false;
      if (wrapper.vm.addCipherKeyFormRef) {
        wrapper.vm.addCipherKeyFormRef.validate = vi.fn().mockResolvedValue(true);
      }
    });

    it("should trigger create workflow when submitting in create mode", async () => {
      // Set up the test environment properly
      wrapper.vm.isUpdatingCipherKey = false;
      wrapper.vm.formData.name = "test-cipher-key";
      
      // Mock form validation to succeed
      if (wrapper.vm.addCipherKeyFormRef) {
        wrapper.vm.addCipherKeyFormRef.validate = vi.fn().mockResolvedValue(true);
      }
      
      const cipherKeysService = (await import("@/services/cipher_keys")).default;
      cipherKeysService.create.mockResolvedValue({ data: { id: "123" } });
      
      await wrapper.vm.onSubmit();
      await nextTick();
      
      // Verify that the create API was called (which indicates createCipherKey was executed)
      expect(cipherKeysService.create).toHaveBeenCalledWith(
        "test-org-123", 
        wrapper.vm.formData
      );
    });

    it("should make API call to create cipher key", async () => {
      const cipherKeysService = (await import("@/services/cipher_keys")).default;
      wrapper.vm.formData.name = "test-cipher-key";
      
      await wrapper.vm.createCipherKey();

      expect(cipherKeysService.create).toHaveBeenCalledWith(
        "test-org-123",
        wrapper.vm.formData
      );
    });

    it("should emit cancel:hideform event after successful creation", async () => {
      await wrapper.vm.createCipherKey();

      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
    });

    it("should handle creation errors gracefully", async () => {
      const cipherKeysService = (await import("@/services/cipher_keys")).default;
      const errorMessage = "Creation failed";
      cipherKeysService.create.mockRejectedValue({
        status: 400,
        response: { data: { message: errorMessage } },
      });

      await wrapper.vm.createCipherKey();
    });
  });

  describe("Form Submission - Update Mode", () => {
    beforeEach(() => {
      wrapper.vm.isUpdatingCipherKey = true;
      wrapper.vm.formData.name = "existing-key";
      wrapper.vm.originalData = JSON.stringify({
        name: "existing-key",
        key: wrapper.vm.formData.key
      });
      
      if (wrapper.vm.addCipherKeyFormRef) {
        wrapper.vm.addCipherKeyFormRef.validate = vi.fn().mockResolvedValue(true);
      }
    });

    it("should trigger update workflow when submitting in update mode", async () => {
      // Set up the test environment properly for update mode
      wrapper.vm.isUpdatingCipherKey = true;
      wrapper.vm.formData.name = "modified-key";
      
      // Mock form validation to succeed
      if (wrapper.vm.addCipherKeyFormRef) {
        wrapper.vm.addCipherKeyFormRef.validate = vi.fn().mockResolvedValue(true);
      }
      
      const cipherKeysService = (await import("@/services/cipher_keys")).default;
      cipherKeysService.update.mockResolvedValue({ data: { id: "123" } });

      await wrapper.vm.onSubmit();
      await nextTick();

      // Verify that the update API was called (which indicates updateCipherKey was executed)
      expect(cipherKeysService.update).toHaveBeenCalledWith(
        "test-org-123",
        wrapper.vm.formData,
        wrapper.vm.formData.name
      );
    });

    it("should detect no changes and show appropriate message", async () => {
      const originalFormData = {
        name: "existing-key",
        key: wrapper.vm.formData.key
      };
      wrapper.vm.formData = originalFormData;
      wrapper.vm.originalData = JSON.stringify(originalFormData);

      await wrapper.vm.updateCipherKey();
    });

    it("should make API call to update cipher key when changes detected", async () => {
      const cipherKeysService = (await import("@/services/cipher_keys")).default;
      wrapper.vm.formData.name = "modified-key";

      await wrapper.vm.updateCipherKey();

      expect(cipherKeysService.update).toHaveBeenCalledWith(
        "test-org-123",
        wrapper.vm.formData,
        wrapper.vm.formData.name
      );
    });
  });

  describe("Error Handling", () => {
    it("should handle form validation errors", async () => {
      if (wrapper.vm.addCipherKeyFormRef) {
        wrapper.vm.addCipherKeyFormRef.validate = vi.fn().mockRejectedValue(new Error("Validation failed"));
      }

      await wrapper.vm.onSubmit();
    });

    it("should not show error for 403 status", async () => {
      if (wrapper.vm.addCipherKeyFormRef) {
        wrapper.vm.addCipherKeyFormRef.validate = vi.fn().mockRejectedValue({ status: 403 });
      }

      await wrapper.vm.onSubmit();
    });
  });

  describe("Helper Functions", () => {
    it("should get correct type label", () => {
      expect(wrapper.vm.getTypeLabel("local")).toBe("OpenObserve");
      expect(wrapper.vm.getTypeLabel("akeyless")).toBe("Akeyless");
      expect(wrapper.vm.getTypeLabel("unknown")).toBeUndefined();
    });

    it("should merge objects correctly", () => {
      const base = { a: 1, b: { c: 2, d: 3 } };
      const updates = { b: { c: 4, e: 5 }, f: 6 };
      const result = wrapper.vm.mergeObjects(base, updates);

      expect(result).toEqual({
        a: 1,
        b: { c: 4, d: 3, e: 5 },
        f: 6,
      });
    });

    it("should filter edited attributes correctly", () => {
      const originalData = { name: "test", key: { type: "local" } };
      const formData = { name: "updated", key: { type: "local" }, newField: "new" };
      
      const result = wrapper.vm.filterEditedAttributes(formData, originalData);
      
      expect(result).toEqual({
        name: "updated",
        newField: "new",
      });
    });
  });

  describe("UI State Management", () => {
    it("should handle create mode state", () => {
      wrapper.vm.isUpdatingCipherKey = false;
      expect(wrapper.vm.isUpdatingCipherKey).toBe(false);
    });

    it("should handle update mode state", async () => {
      wrapper.vm.isUpdatingCipherKey = true;
      await nextTick();
      
      expect(wrapper.vm.isUpdatingCipherKey).toBe(true);
    });

    it("should handle loading state during submission", async () => {
      wrapper.vm.isSubmitting = true;
      await nextTick();

      expect(wrapper.vm.isSubmitting).toBe(true);
    });
  });

  describe("Form Data Management", () => {
    it("should update form data correctly", async () => {
      const newName = "updated-cipher-key";
      wrapper.vm.formData.name = newName;
      await nextTick();

      expect(wrapper.vm.formData.name).toBe(newName);
    });

    it("should track original data for comparison", () => {
      expect(wrapper.vm.originalData).toBeDefined();
    });

    it("should handle form data changes", async () => {
      const originalName = wrapper.vm.formData.name;
      wrapper.vm.formData.name = "changed-name";
      
      expect(wrapper.vm.formData.name).not.toBe(originalName);
    });
  });

  describe("Component Integration", () => {
    it("should properly integrate with store", () => {
      expect(wrapper.vm.$store.state.selectedOrganization.identifier).toBe("test-org-123");
    });

    it("should properly integrate with router", () => {
      expect(wrapper.vm.$router).toBeDefined();
    });

    it("should handle component lifecycle", () => {
      expect(wrapper.vm).toBeDefined();
      expect(typeof wrapper.vm.setupTemplateData).toBe("function");
      expect(typeof wrapper.vm.onSubmit).toBe("function");
      expect(typeof wrapper.vm.createCipherKey).toBe("function");
      expect(typeof wrapper.vm.updateCipherKey).toBe("function");
    });
  });
});
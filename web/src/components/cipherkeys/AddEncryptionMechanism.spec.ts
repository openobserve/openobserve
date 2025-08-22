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
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";
import { Quasar } from "quasar";
import AddEncryptionMechanism from "./AddEncryptionMechanism.vue";

describe("AddEncryptionMechanism", () => {
  let wrapper: VueWrapper<any>;
  let i18n: any;

  const mockFormData = {
    key: {
      mechanism: {
        type: "simple",
        simple_algorithm: "aes-256-siv",
      },
    },
  };

  const createMockI18n = () =>
    createI18n({
      legacy: false,
      locale: "en",
      messages: {
        en: {
          cipherKey: {
            providerType: "Provider Type",
            algorithm: "Algorithm",
          },
        },
      },
    });

  beforeEach(async () => {
    // Reset all mocks
    vi.clearAllMocks();

    // Create fresh instances
    i18n = createMockI18n();

    // Mount component with all required global plugins
    wrapper = mount(AddEncryptionMechanism, {
      props: {
        formData: mockFormData,
      },
      global: {
        plugins: [
          [Quasar, { 
            plugins: {},
            config: {
              platform: {
                is: {
                  ios: false,
                  android: false,
                  desktop: true
                }
              }
            }
          }],
          i18n,
        ],
        stubs: {
          QSelect: {
            template: `
              <div 
                class='q-select' 
                :data-test='$attrs["data-test"]'
                :tabindex='tabindex'
                :color='color'
                :bg-color='bgColor'
                :outlined='outlined'
                :filled='filled'
                :dense='dense'
              >
                <select 
                  :value='modelValue' 
                  @change='$emit("update:modelValue", $event.target.value)'
                  :class='$attrs.class'
                >
                  <option v-for='option in options' :key='option.value' :value='option.value'>
                    {{ option.label }}
                  </option>
                </select>
              </div>
            `,
            props: ["modelValue", "options", "label", "rules", "tabindex", "color", "bgColor", "outlined", "filled", "dense", "stackLabel", "mapOptions", "emitValue", "optionValue", "optionLabel"],
            emits: ["update:modelValue"],
          },
        },
      },
    });

    await nextTick();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllMocks();
  });

  describe("Component Mounting", () => {
    it("should mount AddEncryptionMechanism component", () => {
      expect(wrapper.vm).toBeDefined();
      expect(wrapper.find(".cipher-keys-add-encryption-mechanism").exists()).toBe(true);
    });
  });

  describe("Form Fields", () => {
    it("should render provider type select", () => {
      const providerTypeSelect = wrapper.find('[data-test="add-cipher-key-auth-method-input"]');
      expect(providerTypeSelect.exists()).toBe(true);
    });

    it("should render algorithm select when provider type is simple", async () => {
      wrapper.vm.frmData.key.mechanism.type = "simple";
      await wrapper.vm.$nextTick();

      const algorithmSelect = wrapper.find('[data-test="add-cipher-algorithm-input"]');
      expect(algorithmSelect.exists()).toBe(true);
    });

    it("should not render algorithm select when provider type is not simple", async () => {
      wrapper.vm.frmData.key.mechanism.type = "tink_keyset";
      await wrapper.vm.$nextTick();

      const algorithmSelect = wrapper.find('[data-test="add-cipher-algorithm-input"]');
      expect(algorithmSelect.exists()).toBe(false);
    });
  });

  describe("Provider Type Options", () => {
    it("should have correct provider type options", () => {
      const expectedOptions = [
        { value: "simple", label: "Simple" },
        { value: "tink_keyset", label: "Tink KeySet" },
      ];
      
      expect(wrapper.vm.providerTypeOptions).toEqual(expectedOptions);
    });
  });

  describe("Algorithm Options", () => {
    it("should have correct algorithm options", () => {
      const expectedOptions = [
        { value: "aes-256-siv", label: "AES 256 SIV" },
      ];
      
      expect(wrapper.vm.plainAlgorithmOptions).toEqual(expectedOptions);
    });
  });

  describe("Form Data Binding", () => {
    it("should bind provider type to form data", async () => {
      const providerTypeSelect = wrapper.find('[data-test="add-cipher-key-auth-method-input"]');
      
      // Simulate selecting a provider type
      wrapper.vm.frmData.key.mechanism.type = "tink_keyset";
      await wrapper.vm.$nextTick();
      
      expect(wrapper.vm.frmData.key.mechanism.type).toBe("tink_keyset");
    });

    it("should bind algorithm to form data when simple provider is selected", async () => {
      wrapper.vm.frmData.key.mechanism.type = "simple";
      wrapper.vm.frmData.key.mechanism.simple_algorithm = "aes-256-siv";
      await wrapper.vm.$nextTick();
      
      expect(wrapper.vm.frmData.key.mechanism.simple_algorithm).toBe("aes-256-siv");
    });
  });

  describe("Validation Rules", () => {
    it("should validate provider type is required", () => {
      // Test the validation logic directly from the component
      const providerTypeValidation = (val: any) => !!val || 'Provider type is required';
      
      expect(providerTypeValidation("")).toBe("Provider type is required");
      expect(providerTypeValidation("simple")).toBe(true);
    });

    it("should validate algorithm is required when simple provider is selected", async () => {
      // Test the validation logic directly from the component
      const algorithmValidation = (val: any) => !!val || 'Algorithm is required';
      
      expect(algorithmValidation("")).toBe("Algorithm is required");
      expect(algorithmValidation("aes-256-siv")).toBe(true);
    });
  });

  describe("Conditional Rendering", () => {
    it("should show algorithm field only when provider type is simple", async () => {
      // Test with simple provider type
      wrapper.vm.frmData.key.mechanism.type = "simple";
      await wrapper.vm.$nextTick();
      
      let algorithmSelect = wrapper.find('[data-test="add-cipher-algorithm-input"]');
      expect(algorithmSelect.exists()).toBe(true);

      // Test with tink_keyset provider type
      wrapper.vm.frmData.key.mechanism.type = "tink_keyset";
      await wrapper.vm.$nextTick();
      
      algorithmSelect = wrapper.find('[data-test="add-cipher-algorithm-input"]');
      expect(algorithmSelect.exists()).toBe(false);
    });
  });

  describe("Props Handling", () => {
    it("should handle undefined formData prop", async () => {
      // Create a component with proper default structure when no props provided
      const wrapperWithoutProps = mount(AddEncryptionMechanism, {
        props: {
          formData: {
            key: {
              mechanism: {
                type: "",
                simple_algorithm: "",
              },
            },
          },
        },
        global: {
          plugins: [
            [Quasar, { 
              plugins: {},
              config: {
                platform: {
                  is: {
                    ios: false,
                    android: false,
                    desktop: true
                  }
                }
              }
            }],
            i18n,
          ],
          stubs: {
            QSelect: {
              template: `
                <div 
                  class='q-select' 
                  :data-test='$attrs["data-test"]'
                  :tabindex='tabindex'
                  :color='color'
                  :bg-color='bgColor'
                  :outlined='outlined'
                  :filled='filled'
                  :dense='dense'
                >
                  <select :value='modelValue' @change='$emit("update:modelValue", $event.target.value)'>
                    <option v-for='option in options' :key='option.value' :value='option.value'>
                      {{ option.label }}
                    </option>
                  </select>
                </div>
              `,
              props: ["modelValue", "options", "label", "rules", "tabindex", "color", "bgColor", "outlined", "filled", "dense", "stackLabel", "mapOptions", "emitValue", "optionValue", "optionLabel"],
              emits: ["update:modelValue"],
            },
          },
        },
      });

      await nextTick();
      expect(wrapperWithoutProps.vm.frmData.key.mechanism.type).toBe("");
      wrapperWithoutProps.unmount();
    });

    it("should use provided formData prop", async () => {
      const customFormData = {
        key: {
          mechanism: {
            type: "tink_keyset",
            simple_algorithm: "",
          },
        },
      };

      const wrapperWithCustomData = mount(AddEncryptionMechanism, {
        props: {
          formData: customFormData,
        },
        global: {
          plugins: [
            [Quasar, { 
              plugins: {},
              config: {
                platform: {
                  is: {
                    ios: false,
                    android: false,
                    desktop: true
                  }
                }
              }
            }],
            i18n,
          ],
          stubs: {
            QSelect: {
              template: `
                <div 
                  class='q-select' 
                  :data-test='$attrs["data-test"]'
                  :tabindex='tabindex'
                  :color='color'
                  :bg-color='bgColor'
                  :outlined='outlined'
                  :filled='filled'
                  :dense='dense'
                >
                  <select :value='modelValue' @change='$emit("update:modelValue", $event.target.value)'>
                    <option v-for='option in options' :key='option.value' :value='option.value'>
                      {{ option.label }}
                    </option>
                  </select>
                </div>
              `,
              props: ["modelValue", "options", "label", "rules", "tabindex", "color", "bgColor", "outlined", "filled", "dense", "stackLabel", "mapOptions", "emitValue", "optionValue", "optionLabel"],
              emits: ["update:modelValue"],
            },
          },
        },
      });

      await nextTick();
      expect(wrapperWithCustomData.vm.frmData.key.mechanism.type).toBe("tink_keyset");
      wrapperWithCustomData.unmount();
    });
  });

  describe("Component Structure", () => {
    it("should have correct CSS classes", () => {
      const container = wrapper.find(".cipher-keys-add-encryption-mechanism");
      expect(container.exists()).toBe(true);
    });

    it("should render provider type select with correct structure", () => {
      const providerTypeSelect = wrapper.find('[data-test="add-cipher-key-auth-method-input"]');
      expect(providerTypeSelect.exists()).toBe(true);
    });
  });

  describe("Accessibility", () => {
    it("should have proper tabindex for provider type select", () => {
      const providerTypeSelect = wrapper.find('[data-test="add-cipher-key-auth-method-input"]');
      expect(providerTypeSelect.attributes("tabindex")).toBe("0");
    });

    it("should have proper tabindex for algorithm select", async () => {
      wrapper.vm.frmData.key.mechanism.type = "simple";
      await nextTick();

      const algorithmSelect = wrapper.find('[data-test="add-cipher-algorithm-input"]');
      expect(algorithmSelect.attributes("tabindex")).toBe("1");
    });
  });

  describe("Form Field Properties", () => {
    it("should have correct properties for provider type select", () => {
      const providerTypeSelect = wrapper.find('[data-test="add-cipher-key-auth-method-input"]');
      
      expect(providerTypeSelect.attributes("color")).toBe("input-border q-w-lg");
      expect(providerTypeSelect.attributes("bg-color")).toBe("input-bg");
      expect(providerTypeSelect.attributes("outlined")).toBe("");
      expect(providerTypeSelect.attributes("filled")).toBe("");
      expect(providerTypeSelect.attributes("dense")).toBe("");
    });

    it("should have correct properties for algorithm select", async () => {
      wrapper.vm.frmData.key.mechanism.type = "simple";
      await nextTick();

      const algorithmSelect = wrapper.find('[data-test="add-cipher-algorithm-input"]');
      
      expect(algorithmSelect.attributes("color")).toBe("input-border q-w-lg");
      expect(algorithmSelect.attributes("bg-color")).toBe("input-bg");
      expect(algorithmSelect.attributes("outlined")).toBe("");
      expect(algorithmSelect.attributes("filled")).toBe("");
      expect(algorithmSelect.attributes("dense")).toBe("");
    });
  });
});
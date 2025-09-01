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

import { vi } from "vitest";
import { createI18n } from "vue-i18n";
import { createStore } from "vuex";
import { createRouter, createWebHistory } from "vue-router";
import { Quasar } from "quasar";

/**
 * Shared test fixtures for cipher key components to avoid repetitive setup
 * This consolidates common patterns found across AddCipherKey, AddAkeylessType, 
 * AddOpenobserveType, and AddEncryptionMechanism test files
 */

// Mock form data structures
export const mockCipherKeyFormData = {
  name: "",
  key: {
    store: {
      type: "local",
      local: "",
      akeyless: {
        base_url: "",
        access_id: "",
        auth: {
          type: "access_key",
          access_key: "",
          ldap: {
            username: "",
            password: "",
          },
        },
        store: {
          type: "static_secret",
          static_secret: "",
          dfc: {
            name: "",
            iv: "",
            encrypted_data: "",
          },
        },
      },
    },
    mechanism: {
      type: "simple",
      simple_algorithm: "aes-256-siv",
    },
  },
};

export const mockOpenobserveFormData = {
  isUpdate: false,
  key: {
    store: {
      type: "local",
      local: "",
      akeyless: {
        base_url: "",
        access_id: "",
        auth: {
          type: "access_key",
          access_key: "",
          ldap: {
            username: "",
            password: "",
          },
        },
        store: {
          type: "static_secret",
          static_secret: "",
          dfc: {
            name: "",
            iv: "",
            encrypted_data: "",
          },
        },
      },
    },
    mechanism: {
      type: "simple",
      simple_algorithm: "aes-256-siv",
    },
  },
};

export const mockAkeylessFormData = {
  isUpdate: false,
  key: {
    store: {
      akeyless: {
        base_url: "",
        access_id: "",
        auth: {
          type: "access_key",
          access_key: "",
          ldap: {
            username: "",
            password: "",
          },
        },
        store: {
          type: "static_secret",
          static_secret: "",
          dfc: {
            name: "",
            iv: "",
            encrypted_data: "",
          },
        },
      },
    },
  },
};

export const mockEncryptionMechanismFormData = {
  key: {
    mechanism: {
      type: "simple",
      simple_algorithm: "aes-256-siv",
    },
  },
};

// Common mock store factory
export const createMockStore = () =>
  createStore({
    state: {
      selectedOrganization: {
        identifier: "test-org-123",
      },
    },
  });

// Common mock router factory  
export const createMockRouter = () =>
  createRouter({
    history: createWebHistory(),
    routes: [
      { path: "/", component: { template: "<div>Home</div>" } },
      { path: "/cipherkeys", component: { template: "<div>CipherKeys</div>" } },
    ],
  });

// Common mock i18n factory
export const createMockI18n = () =>
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
          secret: "Secret",
          providerType: "Provider Type",
          algorithm: "Algorithm",
        },
        common: {
          save: "Save",
          cancel: "Cancel",
          back: "Back",
          update: "Update",
        },
      },
    },
  });

// Common Quasar component stubs
export const createQuasarStubs = () => ({
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
  QFieldset: {
    template: "<fieldset><slot /></fieldset>",
    props: ["legend"],
  },
});

// Common Quasar configuration
export const createQuasarConfig = () => ({
  plugins: {},
  config: {
    platform: {
      is: {
        ios: false,
        android: false,
        desktop: true,
      },
    },
  },
});

// Mock service utilities
export const mockCipherKeysService = {
  create: vi.fn(),
  update: vi.fn(),
  get_by_name: vi.fn(),
  list: vi.fn(),
  delete: vi.fn(),
};

export const mockZincUtils = {
  isValidResourceName: vi.fn((val: string) => {
    if (!val) return "Name is required";
    return !/[:\?\/\#\s]/.test(val) || "Characters like :, ?, /, #, and spaces are not allowed.";
  }),
  maxLengthCharValidation: vi.fn((val: string, maxLength: number) => {
    if (!val) return true;
    return val.length <= maxLength || `Maximum ${maxLength} characters allowed`;
  }),
  validateUrl: vi.fn((val: string) => {
    try {
      const url = new URL(val);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch (error) {
      return "Please provide correct URL.";
    }
  }),
};

/**
 * Creates a complete wrapper mounting configuration for cipher key components
 * @param component The Vue component to mount
 * @param props Component props
 * @param customStubs Additional or override stubs
 * @returns Mount configuration object
 */
export const createCipherKeyMountConfig = (
  component: any, 
  props: any, 
  customStubs: Record<string, any> = {}
) => {
  const store = createMockStore();
  const router = createMockRouter();
  const i18n = createMockI18n();
  const stubs = { ...createQuasarStubs(), ...customStubs };
  const quasarConfig = createQuasarConfig();

  return {
    component,
    props,
    global: {
      plugins: [
        [Quasar, quasarConfig],
        store,
        router,
        i18n,
      ],
      stubs,
    },
    store,
    router,
    i18n,
  };
};

/**
 * Sets up common mocks for cipher key tests
 */
export const setupCipherKeyMocks = () => {
  // Reset mocks
  vi.clearAllMocks();

  // Setup default service responses
  mockCipherKeysService.create.mockResolvedValue({ data: { id: "123" } });
  mockCipherKeysService.update.mockResolvedValue({ data: { id: "123" } });
  mockCipherKeysService.get_by_name.mockResolvedValue({
    data: {
      name: "test-cipher",
      key: {
        store: { type: "local", local: "" },
        mechanism: { type: "simple", simple_algorithm: "aes-256-siv" }
      }
    }
  });
};

/**
 * Creates a deep clone of mock data to prevent test contamination
 */
export const cloneMockData = <T>(data: T): T => JSON.parse(JSON.stringify(data));
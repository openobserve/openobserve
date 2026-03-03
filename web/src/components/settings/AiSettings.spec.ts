// Copyright 2025 OpenObserve Inc.
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
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import AiSettings from "./AiSettings.vue";
import i18n from "@/locales";
import { Dialog, Notify } from "quasar";
import { nextTick } from "vue";

installQuasar({
  plugins: [Dialog, Notify],
});

// Mock useQuasar
const mockNotify = vi.fn(() => vi.fn());
vi.mock("quasar", async () => {
  const actual = await vi.importActual("quasar");
  return {
    ...actual,
    useQuasar: () => ({
      notify: mockNotify,
    }),
  };
});

// Mock organizations service
vi.mock("@/services/organizations", () => ({
  default: {
    post_organization_settings: vi.fn(),
  },
}));

import organizations from "@/services/organizations";
const mockOrganizations = organizations as any;

// Build a minimal Vuex-like store object that satisfies the component's needs
const buildStore = (aiSettings = {}) => {
  const ai = {
    enabled: false,
    assistant_enabled: false,
    sre_enabled: false,
    evaluation_enabled: false,
    ...aiSettings,
  };

  const store: any = {
    state: {
      selectedOrganization: {
        identifier: "test-org",
      },
      organizationData: {
        organizationSettings: {
          scrape_interval: 15,
          ai,
        },
      },
    },
    dispatch: vi.fn(),
    commit: vi.fn(),
  };

  return store;
};

const createWrapper = (storeOverrides = {}, aiOrgSettings = {}) => {
  const store = buildStore(aiOrgSettings);
  Object.assign(store.state, storeOverrides);

  return mount(AiSettings, {
    global: {
      plugins: [i18n],
      provide: {
        store,
      },
      stubs: {
        QForm: {
          template:
            "<form data-test-stub='q-form' @submit.prevent=\"$emit('submit')\"><slot></slot></form>",
          emits: ["submit"],
        },
        QToggle: {
          template: `<input
            type='checkbox'
            data-test-stub='q-toggle'
            :data-test='$attrs["data-test"]'
            :checked='modelValue'
            :disabled='disable'
            @change='$emit("update:modelValue", $event.target.checked)'
          />`,
          props: ["modelValue", "disable", "label", "size", "stackLabel", "class"],
          emits: ["update:modelValue"],
        },
        QBtn: {
          template: `<button
            data-test-stub='q-btn'
            :data-test='$attrs["data-test"]'
            :type='type || "button"'
            :disabled='disable || loading'
            @click='$emit("click", $event)'
          ><slot></slot></button>`,
          props: ["disable", "loading", "label", "type", "flat", "no-caps", "class"],
          emits: ["click"],
        },
        QIcon: {
          template: "<span data-test-stub='q-icon'></span>",
          props: ["name", "size"],
        },
        QTooltip: {
          template: "<span data-test-stub='q-tooltip'><slot></slot></span>",
        },
      },
    },
    attachTo: document.body,
  });
};

describe("AiSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOrganizations.post_organization_settings.mockResolvedValue({ data: {} });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Sub-toggles disabled when master toggle is off", () => {
    it("disables assistant toggle when aiEnabled is false", () => {
      const wrapper = createWrapper({}, { enabled: false, assistant_enabled: false, sre_enabled: false, evaluation_enabled: false });
      const assistantToggle = wrapper.find('[data-test="ai-settings-ai-assistant-enabled-toggle"]');
      expect(assistantToggle.exists()).toBe(true);
      expect(assistantToggle.attributes("disabled")).toBeDefined();
      wrapper.unmount();
    });

    it("disables SRE toggle when aiEnabled is false", () => {
      const wrapper = createWrapper({}, { enabled: false });
      const sreToggle = wrapper.find('[data-test="ai-settings-ai-sre-enabled-toggle"]');
      expect(sreToggle.exists()).toBe(true);
      expect(sreToggle.attributes("disabled")).toBeDefined();
      wrapper.unmount();
    });

    it("disables evaluation toggle when aiEnabled is false", () => {
      const wrapper = createWrapper({}, { enabled: false });
      const evalToggle = wrapper.find('[data-test="ai-settings-ai-evaluation-enabled-toggle"]');
      expect(evalToggle.exists()).toBe(true);
      expect(evalToggle.attributes("disabled")).toBeDefined();
      wrapper.unmount();
    });

    it("all three sub-toggles are disabled when master toggle is off", () => {
      const wrapper = createWrapper({}, { enabled: false });

      const assistantToggle = wrapper.find('[data-test="ai-settings-ai-assistant-enabled-toggle"]');
      const sreToggle = wrapper.find('[data-test="ai-settings-ai-sre-enabled-toggle"]');
      const evalToggle = wrapper.find('[data-test="ai-settings-ai-evaluation-enabled-toggle"]');

      expect(assistantToggle.attributes("disabled")).toBeDefined();
      expect(sreToggle.attributes("disabled")).toBeDefined();
      expect(evalToggle.attributes("disabled")).toBeDefined();
      wrapper.unmount();
    });
  });

  describe("Sub-toggles enabled when master toggle is on", () => {
    it("enables assistant toggle when aiEnabled is true", async () => {
      const wrapper = createWrapper({}, { enabled: true, assistant_enabled: true });
      const masterToggle = wrapper.find('[data-test="ai-settings-ai-enabled-toggle"]');
      expect(masterToggle.attributes("checked")).toBeDefined();

      const assistantToggle = wrapper.find('[data-test="ai-settings-ai-assistant-enabled-toggle"]');
      expect(assistantToggle.attributes("disabled")).toBeUndefined();
      wrapper.unmount();
    });

    it("enables SRE toggle when aiEnabled is true", async () => {
      const wrapper = createWrapper({}, { enabled: true, sre_enabled: true });
      const sreToggle = wrapper.find('[data-test="ai-settings-ai-sre-enabled-toggle"]');
      expect(sreToggle.attributes("disabled")).toBeUndefined();
      wrapper.unmount();
    });

    it("enables evaluation toggle when aiEnabled is true", async () => {
      const wrapper = createWrapper({}, { enabled: true, evaluation_enabled: true });
      const evalToggle = wrapper.find('[data-test="ai-settings-ai-evaluation-enabled-toggle"]');
      expect(evalToggle.attributes("disabled")).toBeUndefined();
      wrapper.unmount();
    });

    it("disables sub-toggles when master toggle is turned off via interaction", async () => {
      const wrapper = createWrapper({}, { enabled: true, assistant_enabled: true });

      // Initially enabled
      const assistantToggle = wrapper.find('[data-test="ai-settings-ai-assistant-enabled-toggle"]');
      expect(assistantToggle.attributes("disabled")).toBeUndefined();

      // Simulate turning off master toggle by emitting update:modelValue with false
      const masterToggle = wrapper.find('[data-test="ai-settings-ai-enabled-toggle"]');
      await masterToggle.setValue(false);
      await nextTick();

      // Sub-toggle should now be disabled
      expect(wrapper.find('[data-test="ai-settings-ai-assistant-enabled-toggle"]').attributes("disabled")).toBeDefined();
      wrapper.unmount();
    });
  });

  describe("Initial state read from store", () => {
    it("reads ai.enabled from store", () => {
      const wrapper = createWrapper({}, { enabled: true, assistant_enabled: false, sre_enabled: false, evaluation_enabled: false });
      const masterToggle = wrapper.find('[data-test="ai-settings-ai-enabled-toggle"]');
      expect(masterToggle.attributes("checked")).toBeDefined();
      wrapper.unmount();
    });

    it("reads ai.assistant_enabled from store", () => {
      const wrapper = createWrapper({}, { enabled: true, assistant_enabled: true, sre_enabled: false, evaluation_enabled: false });
      const assistantToggle = wrapper.find('[data-test="ai-settings-ai-assistant-enabled-toggle"]');
      expect(assistantToggle.attributes("checked")).toBeDefined();
      wrapper.unmount();
    });

    it("reads ai.sre_enabled from store", () => {
      const wrapper = createWrapper({}, { enabled: true, assistant_enabled: false, sre_enabled: true, evaluation_enabled: false });
      const sreToggle = wrapper.find('[data-test="ai-settings-ai-sre-enabled-toggle"]');
      expect(sreToggle.attributes("checked")).toBeDefined();
      wrapper.unmount();
    });

    it("reads ai.evaluation_enabled from store", () => {
      const wrapper = createWrapper({}, { enabled: true, assistant_enabled: false, sre_enabled: false, evaluation_enabled: true });
      const evalToggle = wrapper.find('[data-test="ai-settings-ai-evaluation-enabled-toggle"]');
      expect(evalToggle.attributes("checked")).toBeDefined();
      wrapper.unmount();
    });

    it("initializes all toggles to false when ai settings are all false", () => {
      const wrapper = createWrapper({}, { enabled: false, assistant_enabled: false, sre_enabled: false, evaluation_enabled: false });

      const masterToggle = wrapper.find('[data-test="ai-settings-ai-enabled-toggle"]');
      const assistantToggle = wrapper.find('[data-test="ai-settings-ai-assistant-enabled-toggle"]');
      const sreToggle = wrapper.find('[data-test="ai-settings-ai-sre-enabled-toggle"]');
      const evalToggle = wrapper.find('[data-test="ai-settings-ai-evaluation-enabled-toggle"]');

      expect(masterToggle.attributes("checked")).toBeUndefined();
      expect(assistantToggle.attributes("checked")).toBeUndefined();
      expect(sreToggle.attributes("checked")).toBeUndefined();
      expect(evalToggle.attributes("checked")).toBeUndefined();
      wrapper.unmount();
    });

    it("falls back to false when ai settings are absent in store", () => {
      const store: any = {
        state: {
          selectedOrganization: { identifier: "test-org" },
          organizationData: {
            organizationSettings: {},
          },
        },
        dispatch: vi.fn(),
        commit: vi.fn(),
      };

      const wrapper = mount(AiSettings, {
        global: {
          plugins: [i18n],
          provide: { store },
          stubs: {
            QForm: { template: "<form @submit.prevent=\"$emit('submit')\"><slot></slot></form>", emits: ["submit"] },
            QToggle: {
              template: `<input type='checkbox' :data-test='$attrs["data-test"]' :checked='modelValue' :disabled='disable' @change='$emit("update:modelValue", $event.target.checked)' />`,
              props: ["modelValue", "disable"],
              emits: ["update:modelValue"],
            },
            QBtn: { template: `<button :data-test='$attrs["data-test"]'><slot></slot></button>` },
            QIcon: { template: "<span></span>" },
            QTooltip: { template: "<span><slot></slot></span>" },
          },
        },
      });

      const masterToggle = wrapper.find('[data-test="ai-settings-ai-enabled-toggle"]');
      expect(masterToggle.attributes("checked")).toBeUndefined();
      wrapper.unmount();
    });
  });

  // Helper to create wrapper with form-triggerable setup
  const createSaveWrapper = (aiOrgSettings: any) => {
    const store = buildStore(aiOrgSettings);
    return {
      store,
      wrapper: mount(AiSettings, {
        global: {
          plugins: [i18n],
          provide: { store },
          stubs: {
            QForm: {
              template: `<form data-test-stub="q-form" @submit.prevent="$emit('submit', $event)"><slot></slot></form>`,
              emits: ["submit"],
            },
            QToggle: {
              template: `<input type="checkbox" :data-test="$attrs['data-test']" :checked="modelValue" :disabled="disable" @change="$emit('update:modelValue', $event.target.checked)" />`,
              props: ["modelValue", "disable"],
              emits: ["update:modelValue"],
            },
            QBtn: {
              template: `<button :data-test="$attrs['data-test']" :type="type || 'button'" @click="$emit('click', $event)"><slot></slot></button>`,
              props: ["type", "disable", "loading"],
              emits: ["click"],
            },
            QIcon: { template: "<span></span>" },
            QTooltip: { template: "<span><slot></slot></span>" },
          },
        },
        attachTo: document.body,
      }),
    };
  };

  describe("Save button calls post_organization_settings with correct payload", () => {
    it("calls post_organization_settings with nested ai payload on save", async () => {
      const { store, wrapper } = createSaveWrapper({ enabled: true, assistant_enabled: true, sre_enabled: false, evaluation_enabled: false });

      const form = wrapper.find('[data-test-stub="q-form"]');
      await form.trigger("submit");
      await flushPromises();

      expect(mockOrganizations.post_organization_settings).toHaveBeenCalledTimes(1);
      expect(mockOrganizations.post_organization_settings).toHaveBeenCalledWith(
        "test-org",
        {
          ai: {
            enabled: true,
            assistant_enabled: true,
            sre_enabled: false,
            evaluation_enabled: false,
          },
        }
      );
      wrapper.unmount();
    });

    it("sends correct payload when all toggles are false", async () => {
      const { wrapper } = createSaveWrapper({ enabled: false, assistant_enabled: false, sre_enabled: false, evaluation_enabled: false });

      const form = wrapper.find('[data-test-stub="q-form"]');
      await form.trigger("submit");
      await flushPromises();

      expect(mockOrganizations.post_organization_settings).toHaveBeenCalledWith(
        "test-org",
        {
          ai: {
            enabled: false,
            assistant_enabled: false,
            sre_enabled: false,
            evaluation_enabled: false,
          },
        }
      );
      wrapper.unmount();
    });

    it("sends correct payload when all toggles are true", async () => {
      const { wrapper } = createSaveWrapper({ enabled: true, assistant_enabled: true, sre_enabled: true, evaluation_enabled: true });

      const form = wrapper.find('[data-test-stub="q-form"]');
      await form.trigger("submit");
      await flushPromises();

      expect(mockOrganizations.post_organization_settings).toHaveBeenCalledWith(
        "test-org",
        {
          ai: {
            enabled: true,
            assistant_enabled: true,
            sre_enabled: true,
            evaluation_enabled: true,
          },
        }
      );
      wrapper.unmount();
    });
  });

  describe("Save dispatches setOrganizationSettings to store", () => {
    it("dispatches setOrganizationSettings with nested ai object after successful save", async () => {
      const { store, wrapper } = createSaveWrapper({ enabled: true, assistant_enabled: true, sre_enabled: false, evaluation_enabled: false });

      const form = wrapper.find('[data-test-stub="q-form"]');
      await form.trigger("submit");
      await flushPromises();

      expect(store.dispatch).toHaveBeenCalledWith(
        "setOrganizationSettings",
        expect.objectContaining({
          ai: {
            enabled: true,
            assistant_enabled: true,
            sre_enabled: false,
            evaluation_enabled: false,
          },
        })
      );
      wrapper.unmount();
    });

    it("dispatches setOrganizationSettings preserving existing org settings alongside ai object", async () => {
      const { store, wrapper } = createSaveWrapper({ enabled: true, assistant_enabled: false, sre_enabled: false, evaluation_enabled: false });

      const form = wrapper.find('[data-test-stub="q-form"]');
      await form.trigger("submit");
      await flushPromises();

      // The dispatch should include existing org settings fields (scrape_interval)
      expect(store.dispatch).toHaveBeenCalledWith(
        "setOrganizationSettings",
        expect.objectContaining({ scrape_interval: 15, ai: expect.any(Object) })
      );
      wrapper.unmount();
    });
  });

  describe("Save button visibility", () => {
    it("renders the save button", () => {
      const wrapper = createWrapper();
      const saveBtn = wrapper.find('[data-test="ai-settings-save-btn"]');
      expect(saveBtn.exists()).toBe(true);
      wrapper.unmount();
    });
  });

  describe("Error handling", () => {
    it("shows a negative notification when save fails", async () => {
      mockOrganizations.post_organization_settings.mockRejectedValue(new Error("Network error"));

      const { wrapper } = createSaveWrapper({ enabled: false, assistant_enabled: false, sre_enabled: false, evaluation_enabled: false });

      const form = wrapper.find('[data-test-stub="q-form"]');
      await form.trigger("submit");
      await flushPromises();

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({ color: "negative" })
      );
      wrapper.unmount();
    });
  });
});

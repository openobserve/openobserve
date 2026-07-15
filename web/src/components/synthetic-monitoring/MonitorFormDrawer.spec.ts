// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";

// ── Mock push function declared at module scope for hoisting ─────────
const mockPush = vi.fn();

vi.mock("vue-router", () => ({
  useRouter: () => ({
    push: mockPush,
    currentRoute: { value: { query: {} } },
  }),
}));

vi.mock("vue-i18n", () => ({
  useI18n: vi.fn(() => ({
    t: (key: string) => key,
  })),
}));

import MonitorFormDrawer from "./MonitorFormDrawer.vue";
import { mockMonitorHttp } from "@/test/unit/mockData/synthetics";

// ── Stubs ────────────────────────────────────────────────────────────

const ODrawerStub = {
  props: ["open", "title", "subTitle", "size"],
  emits: ["update:open"],
  template: `<div v-if="open" data-test="monitor-form-drawer">
    <slot />
    <slot name="footer" />
  </div>`,
};

const OStepperStub = {
  props: ["modelValue", "navigable"],
  emits: ["update:modelValue"],
  template: '<div data-test="monitor-form-stepper"><slot /></div>',
};

const OStepStub = {
  props: ["name", "title", "done"],
  template: "<div><slot /></div>",
};

const OButtonStub = {
  props: ["variant", "disabled", "size"],
  emits: ["click"],
  template:
    '<button v-bind="$attrs" :disabled="disabled" @click="$emit(\'click\')"><slot /><slot name="icon-left" /></button>',
};

const OInputStub = {
  props: ["modelValue", "label"],
  emits: ["update:modelValue"],
  template:
    '<input v-bind="$attrs" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
};

const OSelectStub = {
  props: ["modelValue", "label", "options"],
  emits: ["update:modelValue"],
  template:
    '<select v-bind="$attrs" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option></select>',
};

const OCollapsibleStub = {
  props: ["title"],
  template: "<div><slot /></div>",
};

const OSwitchStub = {
  props: ["modelValue", "label", "size"],
  emits: ["update:modelValue"],
  template:
    '<input type="checkbox" v-bind="$attrs" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />',
};

const OIconStub = {
  props: ["name", "size"],
  template: "<span />",
};

const STUBS = {
  ODrawer: ODrawerStub,
  OStepper: OStepperStub,
  OStep: OStepStub,
  OButton: OButtonStub,
  OInput: OInputStub,
  OSelect: OSelectStub,
  OCollapsible: OCollapsibleStub,
  OSwitch: OSwitchStub,
  OIcon: OIconStub,
};

// ── Mount factory ────────────────────────────────────────────────────

function mountDrawer(props: Record<string, unknown> = {}) {
  return mount(MonitorFormDrawer, {
    props: {
      open: false,
      editTarget: null,
      onlinePrivateLocations: [],
      ...props,
    },
    global: { stubs: STUBS },
  });
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Click Continue N times to advance through wizard steps. */
async function advanceSteps(
  wrapper: VueWrapper,
  count: number,
) {
  for (let i = 0; i < count; i++) {
    await wrapper
      .find('[data-test="monitor-form-continue-btn"]')
      .trigger("click");
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe("MonitorFormDrawer", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  // ── Drawer open / close ──────────────────────────────────────────

  describe("drawer open/close", () => {
    it("should render the drawer when open prop is true", () => {
      wrapper = mountDrawer({ open: true });
      expect(
        wrapper.find('[data-test="monitor-form-drawer"]').exists(),
      ).toBe(true);
    });

    it("should not render the drawer when open prop is false", () => {
      wrapper = mountDrawer({ open: false });
      expect(
        wrapper.find('[data-test="monitor-form-drawer"]').exists(),
      ).toBe(false);
    });
  });

  // ── Initial render ───────────────────────────────────────────────

  describe("initial render", () => {
    beforeEach(() => {
      wrapper = mountDrawer({ open: true });
    });

    it("should render the stepper", () => {
      expect(
        wrapper.find('[data-test="monitor-form-stepper"]').exists(),
      ).toBe(true);
    });

    it("should render all six monitor type cards", () => {
      const types = ["http", "browser", "api", "tcp", "ping", "dns"];
      types.forEach((t) => {
        expect(
          wrapper
            .find(`[data-test="monitor-form-type-${t}"]`)
            .exists(),
        ).toBe(true);
      });
    });

    it("should have Back button disabled at step 0", () => {
      const backBtn = wrapper.find(
        '[data-test="monitor-form-back-btn"]',
      );
      expect(backBtn.exists()).toBe(true);
      expect(backBtn.attributes("disabled")).toBeDefined();
    });

    it("should show Continue button rather than Save at step 0", () => {
      expect(
        wrapper
          .find('[data-test="monitor-form-continue-btn"]')
          .exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="monitor-form-save-btn"]').exists(),
      ).toBe(false);
    });

    it("should default form type to HTTP", () => {
      expect(wrapper.vm.form.type).toBe("HTTP");
    });

    it("should default form interval to 1m and timeout to 5000", () => {
      expect(wrapper.vm.form.interval).toBe("1m");
      expect(wrapper.vm.form.timeout).toBe(5000);
    });

    it("should default to two preselected global locations", () => {
      expect(wrapper.vm.form.locations).toEqual([
        "us-east",
        "eu-west",
      ]);
    });

    it("should have one default statusCode assertion", () => {
      expect(wrapper.vm.form.assertions).toHaveLength(1);
      expect(wrapper.vm.form.assertions[0]).toEqual({
        type: "statusCode",
        operator: "=",
        value: "200",
      });
    });
  });

  // ── Step navigation ──────────────────────────────────────────────

  describe("step navigation", () => {
    beforeEach(() => {
      wrapper = mountDrawer({ open: true });
    });

    it("should advance to step 1 when Continue is clicked", async () => {
      await advanceSteps(wrapper, 1);
      expect(wrapper.vm.currentStep).toBe(1);
    });

    it("should enable Back button after advancing beyond step 0", async () => {
      await advanceSteps(wrapper, 1);
      const backBtn = wrapper.find(
        '[data-test="monitor-form-back-btn"]',
      );
      expect(backBtn.attributes("disabled")).toBeUndefined();
    });

    it("should return to the previous step when Back is clicked", async () => {
      await advanceSteps(wrapper, 2);
      expect(wrapper.vm.currentStep).toBe(2);
      await wrapper
        .find('[data-test="monitor-form-back-btn"]')
        .trigger("click");
      expect(wrapper.vm.currentStep).toBe(1);
    });

    it("should show Save button and hide Continue at the last step", async () => {
      await advanceSteps(wrapper, 3);
      expect(wrapper.vm.currentStep).toBe(3);
      expect(
        wrapper
          .find('[data-test="monitor-form-continue-btn"]')
          .exists(),
      ).toBe(false);
      expect(
        wrapper.find('[data-test="monitor-form-save-btn"]').exists(),
      ).toBe(true);
    });

    it("should not go below step 0 when Back is clicked at step 0", async () => {
      await wrapper
        .find('[data-test="monitor-form-back-btn"]')
        .trigger("click");
      expect(wrapper.vm.currentStep).toBe(0);
    });

    it("should track current step in the stepped modelValue", () => {
      expect(wrapper.vm.currentStep).toBe(0);
      expect(wrapper.vm.stepIdx).toBe(0);
    });
  });

  // ── Browser type special case ────────────────────────────────────

  describe("browser type special case", () => {
    beforeEach(() => {
      wrapper = mountDrawer({ open: true });
    });

    it("should navigate to synthetic-new route when Browser is selected and Continue is clicked", async () => {
      await wrapper
        .find('[data-test="monitor-form-type-browser"]')
        .trigger("click");
      expect(wrapper.vm.form.type).toBe("Browser");
      await wrapper
        .find('[data-test="monitor-form-continue-btn"]')
        .trigger("click");
      expect(mockPush).toHaveBeenCalledWith({
        name: "synthetic-new",
      });
    });

    it("should not navigate away when a non-Browser type is selected", async () => {
      // Default is HTTP — click Continue
      await wrapper
        .find('[data-test="monitor-form-continue-btn"]')
        .trigger("click");
      expect(mockPush).not.toHaveBeenCalled();
      expect(wrapper.vm.currentStep).toBe(1);
    });

    it("should hide method select when a non-HTTP/API type is selected", async () => {
      await wrapper
        .find('[data-test="monitor-form-type-tcp"]')
        .trigger("click");
      expect(wrapper.vm.form.type).toBe("TCP");
      await advanceSteps(wrapper, 1);
      expect(
        wrapper
          .find('[data-test="monitor-form-method-select"]')
          .exists(),
      ).toBe(false);
    });
  });

  // ── Form population from editTarget ──────────────────────────────

  describe("form population from editTarget", () => {
    // mockMonitorHttp (BrowserCheck) lacks top-level `type`/`interval`
    // but the component reads them from editTarget; supply them.
    const editTarget = {
      ...mockMonitorHttp,
      type: "HTTP",
      interval: "5m",
    };

    beforeEach(async () => {
      wrapper = mountDrawer({
        open: false,
        editTarget,
      });
      await wrapper.setProps({ open: true });
      await flushPromises();
    });

    it("should populate the name field from editTarget", () => {
      const nameInput = wrapper.find(
        '[data-test="monitor-form-name-input"]',
      );
      expect(nameInput.exists()).toBe(true);
      expect(
        (nameInput.element as HTMLInputElement).value,
      ).toBe("HTTP Health Check");
    });

    it("should populate the url field from editTarget", () => {
      const urlInput = wrapper.find(
        '[data-test="monitor-form-url-input"]',
      );
      expect(
        (urlInput.element as HTMLInputElement).value,
      ).toBe("https://example.com/health");
    });

    it("should set form type and interval from editTarget", () => {
      expect(wrapper.vm.form.type).toBe("HTTP");
      expect(wrapper.vm.form.interval).toBe("5m");
      expect(wrapper.vm.form.name).toBe("HTTP Health Check");
    });

    it("should start at step 1 (Configure) when editing an existing monitor", () => {
      expect(wrapper.vm.currentStep).toBe(1);
    });

    it("should show method select because type is HTTP", () => {
      expect(
        wrapper
          .find('[data-test="monitor-form-method-select"]')
          .exists(),
      ).toBe(true);
    });

    it("should have empty headers array for a freshly populated form", () => {
      expect(wrapper.vm.form.headers).toEqual([]);
    });

    it("should default alert threshold to 1 after population", () => {
      expect(wrapper.vm.form.alertThreshold).toBe(1);
    });
  });

  // ── Form reset on close ──────────────────────────────────────────

  describe("form reset on close", () => {
    it("should reset form to defaults when the drawer is reopened without editTarget", async () => {
      wrapper = mountDrawer({ open: true });

      // Fill in a custom name
      await wrapper
        .find('[data-test="monitor-form-name-input"]')
        .setValue("Custom Name");
      expect(wrapper.vm.form.name).toBe("Custom Name");

      // Close drawer
      await wrapper.setProps({ open: false });
      await flushPromises();

      // Reopen
      await wrapper.setProps({ open: true });
      await flushPromises();

      // Form should be back to defaults
      expect(wrapper.vm.form.name).toBe("");
      expect(wrapper.vm.form.type).toBe("HTTP");
      expect(wrapper.vm.currentStep).toBe(0);
    });

    it("should reset step index to 0 when reopening without editTarget", async () => {
      wrapper = mountDrawer({ open: true });

      // Advance to step 2
      await advanceSteps(wrapper, 2);
      expect(wrapper.vm.currentStep).toBe(2);

      // Close and reopen
      await wrapper.setProps({ open: false });
      await flushPromises();
      await wrapper.setProps({ open: true });
      await flushPromises();

      expect(wrapper.vm.currentStep).toBe(0);
    });
  });

  // ── Location toggling ────────────────────────────────────────────

  describe("location toggling", () => {
    beforeEach(async () => {
      wrapper = mountDrawer({ open: true });
      await advanceSteps(wrapper, 2);
    });

    it("should start with two preselected global locations", () => {
      expect(wrapper.vm.form.locations).toContain("us-east");
      expect(wrapper.vm.form.locations).toContain("eu-west");
      expect(wrapper.vm.form.locations).not.toContain("us-west");
      expect(wrapper.vm.form.locations).toHaveLength(2);
    });

    it("should add a location to the selection when clicked", async () => {
      await wrapper
        .find('[data-test="monitor-form-loc-us-west"]')
        .trigger("click");
      expect(wrapper.vm.form.locations).toContain("us-west");
      expect(wrapper.vm.form.locations).toHaveLength(3);
    });

    it("should remove a location from the selection when clicked again", async () => {
      await wrapper
        .find('[data-test="monitor-form-loc-us-east"]')
        .trigger("click");
      expect(wrapper.vm.form.locations).not.toContain("us-east");
      expect(wrapper.vm.form.locations).toHaveLength(1);
    });

    it("should render all six global location entries", () => {
      const locations = [
        "us-east",
        "us-west",
        "eu-west",
        "eu-central",
        "ap-se",
        "ap-ne",
      ];
      locations.forEach((loc) => {
        expect(
          wrapper
            .find(`[data-test="monitor-form-loc-${loc}"]`)
            .exists(),
        ).toBe(true);
      });
    });

    it("should render private location entries when onlinePrivateLocations prop is provided", async () => {
      wrapper.unmount();
      wrapper = mountDrawer({
        open: true,
        onlinePrivateLocations: [
          { id: 1, name: "Office Gateway", region: "us-east" },
          { id: 2, name: "Datacenter", region: "eu-west" },
        ],
      });
      await advanceSteps(wrapper, 2);

      expect(
        wrapper
          .find('[data-test="monitor-form-priv-loc-1"]')
          .exists(),
      ).toBe(true);
      expect(
        wrapper
          .find('[data-test="monitor-form-priv-loc-2"]')
          .exists(),
      ).toBe(true);
    });

    it("should toggle a private location on click", async () => {
      wrapper.unmount();
      wrapper = mountDrawer({
        open: true,
        onlinePrivateLocations: [
          { id: 1, name: "Office Gateway", region: "us-east" },
        ],
      });
      await advanceSteps(wrapper, 2);

      await wrapper
        .find('[data-test="monitor-form-priv-loc-1"]')
        .trigger("click");
      expect(wrapper.vm.form.locations).toContain("priv-1");

      await wrapper
        .find('[data-test="monitor-form-priv-loc-1"]')
        .trigger("click");
      expect(wrapper.vm.form.locations).not.toContain("priv-1");
    });
  });

  // ── Header add / remove ──────────────────────────────────────────

  describe("header add/remove", () => {
    beforeEach(async () => {
      wrapper = mountDrawer({ open: true });
      await advanceSteps(wrapper, 1);
    });

    it("should start with no headers", () => {
      expect(wrapper.vm.form.headers).toEqual([]);
      expect(wrapper.vm.form.headers).toHaveLength(0);
    });

    it("should add an empty header row when Add header is clicked", async () => {
      await wrapper
        .find('[data-test="monitor-form-add-header-btn"]')
        .trigger("click");
      expect(wrapper.vm.form.headers).toHaveLength(1);
      expect(wrapper.vm.form.headers[0]).toEqual({
        key: "",
        value: "",
      });
    });

    it("should render key/value inputs after adding a header", async () => {
      await wrapper
        .find('[data-test="monitor-form-add-header-btn"]')
        .trigger("click");
      expect(
        wrapper
          .find('[data-test="monitor-form-header-key-0"]')
          .exists(),
      ).toBe(true);
      expect(
        wrapper
          .find('[data-test="monitor-form-header-value-0"]')
          .exists(),
      ).toBe(true);
    });

    it("should remove a header when its remove button is clicked", async () => {
      await wrapper
        .find('[data-test="monitor-form-add-header-btn"]')
        .trigger("click");
      expect(wrapper.vm.form.headers).toHaveLength(1);
      await wrapper
        .find('[data-test="monitor-form-header-remove-0"]')
        .trigger("click");
      expect(wrapper.vm.form.headers).toHaveLength(0);
    });

    it("should support adding multiple headers", async () => {
      const addBtn = wrapper.find(
        '[data-test="monitor-form-add-header-btn"]',
      );
      await addBtn.trigger("click");
      await addBtn.trigger("click");
      await addBtn.trigger("click");
      expect(wrapper.vm.form.headers).toHaveLength(3);
      expect(
        wrapper
          .find('[data-test="monitor-form-header-key-2"]')
          .exists(),
      ).toBe(true);
    });

    it("should update header key/value via inputs", async () => {
      await wrapper
        .find('[data-test="monitor-form-add-header-btn"]')
        .trigger("click");
      await wrapper
        .find('[data-test="monitor-form-header-key-0"]')
        .setValue("Authorization");
      await wrapper
        .find('[data-test="monitor-form-header-value-0"]')
        .setValue("Bearer token");
      expect(wrapper.vm.form.headers[0]).toEqual({
        key: "Authorization",
        value: "Bearer token",
      });
    });
  });

  // ── Assertion add / remove ───────────────────────────────────────

  describe("assertion add/remove", () => {
    beforeEach(async () => {
      wrapper = mountDrawer({ open: true });
      await advanceSteps(wrapper, 3);
    });

    it("should start with one default statusCode assertion", () => {
      expect(wrapper.vm.form.assertions).toHaveLength(1);
      expect(wrapper.vm.form.assertions[0]).toEqual({
        type: "statusCode",
        operator: "=",
        value: "200",
      });
    });

    it("should add a new default assertion when Add assertion is clicked", async () => {
      await wrapper
        .find('[data-test="monitor-form-add-assertion-btn"]')
        .trigger("click");
      expect(wrapper.vm.form.assertions).toHaveLength(2);
      expect(wrapper.vm.form.assertions[1]).toEqual({
        type: "statusCode",
        operator: "=",
        value: "200",
      });
    });

    it("should remove an assertion when its remove button is clicked", async () => {
      await wrapper
        .find('[data-test="monitor-form-add-assertion-btn"]')
        .trigger("click");
      expect(wrapper.vm.form.assertions).toHaveLength(2);
      await wrapper
        .find('[data-test="monitor-form-assertion-remove-1"]')
        .trigger("click");
      expect(wrapper.vm.form.assertions).toHaveLength(1);
    });

    it("should render type, operator, and value inputs for each assertion", async () => {
      expect(
        wrapper
          .find('[data-test="monitor-form-assertion-type-0"]')
          .exists(),
      ).toBe(true);
      expect(
        wrapper
          .find('[data-test="monitor-form-assertion-op-0"]')
          .exists(),
      ).toBe(true);
      expect(
        wrapper
          .find('[data-test="monitor-form-assertion-value-0"]')
          .exists(),
      ).toBe(true);
    });
  });

  // ── Alert threshold & switches ───────────────────────────────────

  describe("alert threshold and switches", () => {
    beforeEach(async () => {
      wrapper = mountDrawer({ open: true });
      await advanceSteps(wrapper, 3);
    });

    it("should render the alert threshold input with default value 1", () => {
      const alertInput = wrapper.find(
        '[data-test="monitor-form-alert-threshold-input"]',
      );
      expect(alertInput.exists()).toBe(true);
      expect(wrapper.vm.form.alertThreshold).toBe(1);
    });

    it("should update alert threshold via the input", async () => {
      await wrapper
        .find('[data-test="monitor-form-alert-threshold-input"]')
        .setValue(3);
      expect(wrapper.vm.form.alertThreshold).toBe(3);
    });

    it("should render notify on recovery switch with default true", () => {
      const notifySwitch = wrapper.find(
        '[data-test="monitor-form-notify-recovery-switch"]',
      );
      expect(notifySwitch.exists()).toBe(true);
      expect(wrapper.vm.form.notifyOnRecovery).toBe(true);
    });

    it("should render renotify switch with default false", () => {
      const renotifySwitch = wrapper.find(
        '[data-test="monitor-form-renotify-switch"]',
      );
      expect(renotifySwitch.exists()).toBe(true);
      expect(wrapper.vm.form.renotify).toBe(false);
    });

    it("should toggle notifyOnRecovery via the switch", async () => {
      const notifySwitch = wrapper.find(
        '[data-test="monitor-form-notify-recovery-switch"]',
      );
      await notifySwitch.setValue(false);
      expect(wrapper.vm.form.notifyOnRecovery).toBe(false);
    });

    it("should toggle renotify via the switch", async () => {
      const renotifySwitch = wrapper.find(
        '[data-test="monitor-form-renotify-switch"]',
      );
      await renotifySwitch.setValue(true);
      expect(wrapper.vm.form.renotify).toBe(true);
    });
  });

  // ── Save emits ───────────────────────────────────────────────────

  describe("save emits", () => {
    beforeEach(async () => {
      wrapper = mountDrawer({ open: true });
      await advanceSteps(wrapper, 3);
    });

    it("should emit save and close the drawer when Save is clicked", async () => {
      await wrapper
        .find('[data-test="monitor-form-save-btn"]')
        .trigger("click");
      expect(wrapper.emitted("save")).toBeTruthy();
      expect(wrapper.emitted("save")).toHaveLength(1);
      expect(wrapper.emitted("update:open")).toEqual([
        [false],
      ]);
    });

    it("should show 'Create monitor' text on Save button for new monitors", () => {
      const saveBtn = wrapper.find(
        '[data-test="monitor-form-save-btn"]',
      );
      expect(saveBtn.exists()).toBe(true);
      expect(saveBtn.text()).toBe("Create monitor");
    });

    it("should show 'Save changes' text on Save button when editing", async () => {
      wrapper.unmount();
      wrapper = mountDrawer({
        open: false,
        editTarget: mockMonitorHttp,
      });
      await wrapper.setProps({ open: true });
      await flushPromises();
      // editTarget starts at step 1, advance to step 3
      await advanceSteps(wrapper, 2);

      const saveBtn = wrapper.find(
        '[data-test="monitor-form-save-btn"]',
      );
      expect(saveBtn.text()).toBe("Save changes");
    });
  });

  // ── Cancel closes drawer ─────────────────────────────────────────

  describe("cancel closes drawer", () => {
    it("should emit update:open false when Cancel is clicked", async () => {
      wrapper = mountDrawer({ open: true });
      await wrapper
        .find('[data-test="monitor-form-cancel-btn"]')
        .trigger("click");
      expect(wrapper.emitted("update:open")).toEqual([
        [false],
      ]);
    });

    it("should not emit save when Cancel is clicked", async () => {
      wrapper = mountDrawer({ open: true });
      await wrapper
        .find('[data-test="monitor-form-cancel-btn"]')
        .trigger("click");
      expect(wrapper.emitted("save")).toBeFalsy();
    });
  });

  // ── Configure step form fields ───────────────────────────────────

  describe("configure step form fields", () => {
    beforeEach(async () => {
      wrapper = mountDrawer({ open: true });
      await advanceSteps(wrapper, 1);
    });

    it("should render name, url, interval, and timeout inputs", () => {
      expect(
        wrapper
          .find('[data-test="monitor-form-name-input"]')
          .exists(),
      ).toBe(true);
      expect(
        wrapper
          .find('[data-test="monitor-form-url-input"]')
          .exists(),
      ).toBe(true);
      expect(
        wrapper
          .find('[data-test="monitor-form-interval-select"]')
          .exists(),
      ).toBe(true);
      expect(
        wrapper
          .find('[data-test="monitor-form-timeout-input"]')
          .exists(),
      ).toBe(true);
    });

    it("should render request headers collapsible section", () => {
      expect(
        wrapper.find('[data-test="monitor-form-add-header-btn"]')
          .exists(),
      ).toBe(true);
    });

    it("should set url value via input", async () => {
      const urlInput = wrapper.find(
        '[data-test="monitor-form-url-input"]',
      );
      await urlInput.setValue("https://new-url.example.com");
      expect(wrapper.vm.form.url).toBe(
        "https://new-url.example.com",
      );
    });

    it("should set name value via input", async () => {
      const nameInput = wrapper.find(
        '[data-test="monitor-form-name-input"]',
      );
      await nameInput.setValue("My Monitor");
      expect(wrapper.vm.form.name).toBe("My Monitor");
    });

    it("should render method select when type is HTTP", () => {
      const methodSelect = wrapper.find(
        '[data-test="monitor-form-method-select"]',
      );
      expect(methodSelect.exists()).toBe(true);
      expect(wrapper.vm.form.method).toBe("GET");
    });
  });
});

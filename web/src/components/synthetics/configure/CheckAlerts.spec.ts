// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import type { BrowserCheck } from "@/types/synthetics";
import { mockMonitorHttp } from "@/test/unit/mockData/synthetics";

// ── Stubs ────────────────────────────────────────────────────────────────────

const OInputStub = {
  props: ["modelValue", "type", "placeholder", "min"],
  emits: ["update:modelValue"],
  template: `<input v-bind="$attrs" :value="modelValue" :type="type" @input="$emit('update:modelValue', $event.target.value)" />`,
};

const OSelectStub = {
  name: "OSelectStub",
  props: ["modelValue", "options", "multiple", "error"],
  emits: ["update:modelValue"],
  methods: {
    onSelectChange(event: Event) {
      const target = event.target as HTMLSelectElement;
      const values = Array.from(target.selectedOptions).map((o) => o.value);
      (this as any).$emit("update:modelValue", values);
    },
    isSelected(opt: string) {
      const val = (this as any).modelValue;
      return Array.isArray(val) && val.includes(opt);
    },
  },
  template: `
    <select
      v-bind="$attrs"
      multiple
      @change="onSelectChange"
    >
      <option
        v-for="opt in options"
        :key="opt"
        :value="opt"
        :selected="isSelected(opt)"
      >{{ opt }}</option>
    </select>
  `,
};

const OIconStub = { template: "<i />" };

const OButtonStub = {
  emits: ["click"],
  template: '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>',
};

const STUBS = {
  OInput: OInputStub,
  OSelect: OSelectStub,
  OIcon: OIconStub,
  OButton: OButtonStub,
};

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockResolve = vi.fn().mockReturnValue({ href: "/alerts/destinations?action=add&org_identifier=default" });
const mockWindowOpen = vi.fn();

vi.mock("vue-i18n", () => ({
  useI18n: vi.fn(() => ({ t: (key: string) => key })),
}));

vi.mock("vue-router", () => ({
  useRouter: vi.fn(() => ({
    resolve: mockResolve,
  })),
}));

vi.mock("vuex", () => ({
  useStore: vi.fn(() => ({
    state: {
      selectedOrganization: {
        identifier: "default",
      },
    },
  })),
}));

// ── SUT import (after mocks) ────────────────────────────────────────────────

import CheckAlerts from "./CheckAlerts.vue";

// ── Mount factory ────────────────────────────────────────────────────────────

function mountCheckAlerts(
  checkOverrides: Partial<BrowserCheck> = {},
  destinations: string[] = [],
) {
  const check = { ...mockMonitorHttp, ...checkOverrides } as BrowserCheck;
  return mount(CheckAlerts, {
    props: { check, destinations },
    global: {
      stubs: STUBS,
    },
  }) as VueWrapper;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("CheckAlerts", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  describe("initial render", () => {
    it("should render the alerts heading", () => {
      wrapper = mountCheckAlerts(mockMonitorHttp, ["dest-1", "dest-2"]);

      expect(wrapper.find("h3").text()).toBe("synthetics.scheduleAlert.alerts");
    });

    it("should display failure threshold from check data", () => {
      wrapper = mountCheckAlerts(
        { alertIfFails: 3 },
        ["dest-1"],
      );

      const thresholdInput = wrapper.find(
        '[data-test="synthetics-check-alerts-threshold-input"]',
      );
      expect(thresholdInput.exists()).toBe(true);
      expect(thresholdInput.attributes("value")).toBe("3");
    });

    it("should display cooldown from check data", () => {
      wrapper = mountCheckAlerts(
        { cooldownMins: 5 },
        ["dest-1"],
      );

      const cooldownInput = wrapper.find(
        '[data-test="synthetics-check-alerts-cooldown-input"]',
      );
      expect(cooldownInput.exists()).toBe(true);
      expect(cooldownInput.attributes("value")).toBe("5");
    });

    it("should select destinations from check.notifications.destinations", () => {
      wrapper = mountCheckAlerts(
        { notifications: { destinations: ["dest-1", "dest-2"] } },
        ["dest-1", "dest-2", "dest-3"],
      );

      const select = wrapper.find(
        '[data-test="synthetics-check-alerts-destinations-select"]',
      );
      expect(select.exists()).toBe(true);

      // The stub renders <option> with :selected attribute
      const selectedOpts = select.findAll("option[selected]");
      const selectedValues = selectedOpts.map((o) => o.attributes("value"));
      expect(selectedValues).toEqual(["dest-1", "dest-2"]);
    });

    it("should not show destination validation error on mount even when destinations are empty", () => {
      // destinationError starts as false — the component only shows the error
      // after user interaction (onDestinationsChange or computed setter)
      wrapper = mountCheckAlerts(
        { notifications: { destinations: [] } },
        ["dest-1"],
      );

      expect(wrapper.text()).not.toContain(
        "synthetics.scheduleAlert.destinationRequired",
      );
    });
  });

  // ── Interactions ─────────────────────────────────────────────────────────

  describe("failure threshold input", () => {
    it("should emit update:check with updated alertIfFails when input changes", async () => {
      wrapper = mountCheckAlerts(
        { alertIfFails: 3 },
        ["dest-1"],
      );

      const thresholdInput = wrapper.find(
        '[data-test="synthetics-check-alerts-threshold-input"]',
      );
      await thresholdInput.setValue("2");

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      const lastEmit = emitted![emitted!.length - 1][0] as BrowserCheck;
      expect(lastEmit.alertIfFails).toBe(2);
    });
  });

  describe("destinations selection", () => {
    it("should emit update:check with updated destinations when selection changes", () => {
      wrapper = mountCheckAlerts(
        { notifications: { destinations: ["dest-1"] } },
        ["dest-1", "dest-2", "dest-3"],
      );

      // Emulate OSelect emitting a new array via update:modelValue.
      // We trigger the select change event directly on the <select> element.
      const selectEl = wrapper.find(
        '[data-test="synthetics-check-alerts-destinations-select"]',
      );

      // Select "dest-3" in addition to already-selected "dest-1"
      // In a real multi-select, all selected options are in selectedOptions.
      // Simulate by setting selected on options and dispatching change.
      const options = selectEl.findAll("option");
      options.forEach((opt) => {
        const val = opt.attributes("value");
        if (val === "dest-1" || val === "dest-3") {
          (opt.element as HTMLOptionElement).selected = true;
        } else {
          (opt.element as HTMLOptionElement).selected = false;
        }
      });

      selectEl.trigger("change");

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      const lastEmit = emitted![emitted!.length - 1][0] as BrowserCheck;
      expect(lastEmit.notifications.destinations).toEqual(["dest-1", "dest-3"]);
    });
  });

  describe("refresh destinations button", () => {
    it("should emit refresh:destinations when clicked", async () => {
      wrapper = mountCheckAlerts(mockMonitorHttp, ["dest-1"]);

      const refreshBtn = wrapper.find(
        '[data-test="synthetics-check-alerts-refresh-destinations-btn"]',
      );
      expect(refreshBtn.exists()).toBe(true);

      await refreshBtn.trigger("click");

      expect(wrapper.emitted("refresh:destinations")).toBeTruthy();
    });
  });

  describe("add destination button", () => {
    beforeEach(() => {
      vi.stubGlobal("open", mockWindowOpen);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("should call window.open with the correct URL when clicked", async () => {
      wrapper = mountCheckAlerts(mockMonitorHttp, ["dest-1"]);

      const addBtn = wrapper.find(
        '[data-test="synthetics-check-alerts-add-destination-btn"]',
      );
      expect(addBtn.exists()).toBe(true);

      await addBtn.trigger("click");

      expect(mockWindowOpen).toHaveBeenCalledWith(
        "/alerts/destinations?action=add&org_identifier=default",
        "_blank",
      );
    });

    it("should call router.resolve with the correct arguments", async () => {
      wrapper = mountCheckAlerts(mockMonitorHttp, ["dest-1"]);

      const addBtn = wrapper.find(
        '[data-test="synthetics-check-alerts-add-destination-btn"]',
      );
      await addBtn.trigger("click");

      expect(mockResolve).toHaveBeenCalledWith({
        name: "alertDestinations",
        query: {
          action: "add",
          org_identifier: "default",
        },
      });
    });
  });

  describe("cooldown input", () => {
    it("should emit update:check with updated cooldownMins when input changes", async () => {
      wrapper = mountCheckAlerts(
        { cooldownMins: 5 },
        ["dest-1"],
      );

      const cooldownInput = wrapper.find(
        '[data-test="synthetics-check-alerts-cooldown-input"]',
      );
      await cooldownInput.setValue("15");

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      const lastEmit = emitted![emitted!.length - 1][0] as BrowserCheck;
      expect(lastEmit.cooldownMins).toBe(15);
    });
  });

});

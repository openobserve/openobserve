// Copyright 2026 OpenObserve Inc.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";

vi.mock("vue-i18n", () => ({
  useI18n: vi.fn(() => ({ t: (key: string) => key })),
}));

import CheckLocations from "./CheckLocations.vue";
import { mockMonitorHttp, mockLocations } from "@/test/unit/mockData/synthetics";
import type { SyntheticsLocation } from "@/types/synthetics";

// ── Shared Symbol for checkbox group provide/inject ──────────────────────────
// Must be the exact same reference for both OCheckboxGroup and OCheckbox stubs.
const CKG_KEY = Symbol("checkboxGroup");

// ── Stubs ───────────────────────────────────────────────────────────────────

const OCheckboxGroupStub = {
  name: "OCheckboxGroup",
  props: {
    modelValue: { type: Array, default: () => [] },
  },
  emits: ["update:modelValue"],
  template: '<div v-bind="$attrs"><slot /></div>',
  provide(this: any) {
    const self = this;
    return {
      [CKG_KEY]: {
        get modelValue(): (string | number)[] {
          return self.modelValue ?? [];
        },
        disabled: false,
        toggle(value: string | number) {
          const current = [...(self.modelValue ?? [])];
          const idx = current.indexOf(value);
          if (idx >= 0) {
            current.splice(idx, 1);
          } else {
            current.push(value);
          }
          self.$emit("update:modelValue", current);
        },
        isChecked(value: string | number): boolean {
          return (self.modelValue ?? []).includes(value);
        },
      },
    };
  },
};

const OCheckboxStub = {
  name: "OCheckbox",
  props: {
    modelValue: { type: [Array, String, Number, Boolean], default: undefined },
    value: { type: [String, Number], default: undefined },
  },
  emits: ["update:modelValue"],
  inject: {
    group: { from: CKG_KEY, default: null },
  },
  template: `<div :data-test="$attrs['data-test']">
    <input type="checkbox" :checked="checked" @click="toggle" />
    <slot name="label" />
  </div>`,
  computed: {
    checked(this: any): boolean {
      return this.group?.isChecked(this.value) ?? false;
    },
  },
  methods: {
    toggle(this: any) {
      this.group?.toggle(this.value);
    },
  },
};

const OIconStub = {
  props: ["name", "size"],
  template: '<i v-bind="$attrs" />',
};

const STUBS = {
  OCheckboxGroup: OCheckboxGroupStub,
  OCheckbox: OCheckboxStub,
  OIcon: OIconStub,
};

// ── Mount factory ────────────────────────────────────────────────────────────

function mountCheckLocations(props: Record<string, unknown> = {}) {
  return mount(CheckLocations, {
    props: {
      check: mockMonitorHttp,
      locations: [...mockLocations],
      ...props,
    },
    global: { stubs: STUBS },
  }) as VueWrapper;
}

describe("CheckLocations", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  describe("initial render", () => {
    beforeEach(() => {
      wrapper = mountCheckLocations();
    });

    it("should render the component", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("should render the section title", () => {
      expect(wrapper.text()).toContain("synthetics.locations.title");
    });

    it("should render the checkbox group", () => {
      expect(wrapper.find('[data-test="synthetics-check-locations-group"]').exists()).toBe(true);
    });

    it("should render one checkbox per location", () => {
      expect(
        wrapper.find('[data-test="synthetics-check-locations-option-us-east-1"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="synthetics-check-locations-option-eu-west-1"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="synthetics-check-locations-option-ap-southeast-1"]').exists(),
      ).toBe(true);
    });

    it("should render location name and region in labels", () => {
      const text = wrapper.text();
      expect(text).toContain("US East (N. Virginia)");
      expect(text).toContain("us-east-1");
    });

    it("should mark pre-selected locations as checked", () => {
      // mockMonitorHttp has locations: ["us-east-1", "eu-west-1"]
      const usEastCheckbox = wrapper.find(
        '[data-test="synthetics-check-locations-option-us-east-1"] input',
      );
      const euWestCheckbox = wrapper.find(
        '[data-test="synthetics-check-locations-option-eu-west-1"] input',
      );
      const apSoutheastCheckbox = wrapper.find(
        '[data-test="synthetics-check-locations-option-ap-southeast-1"] input',
      );

      expect((usEastCheckbox.element as HTMLInputElement).checked).toBe(true);
      expect((euWestCheckbox.element as HTMLInputElement).checked).toBe(true);
      expect((apSoutheastCheckbox.element as HTMLInputElement).checked).toBe(false);
    });
  });

  describe("location selection", () => {
    beforeEach(() => {
      wrapper = mountCheckLocations();
    });

    it("should emit update:check when a location is toggled on", async () => {
      // Toggle on ap-southeast-1 (currently unchecked)
      const checkbox = wrapper.find(
        '[data-test="synthetics-check-locations-option-ap-southeast-1"] input',
      );
      await checkbox.trigger("click");
      await flushPromises();

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      const last = emitted![emitted!.length - 1][0] as any;
      expect(last.locations).toContain("ap-southeast-1");
      expect(last.locations).toContain("us-east-1");
      expect(last.locations).toContain("eu-west-1");
    });

    it("should emit update:check when a location is toggled off", async () => {
      // Toggle off us-east-1 (currently checked)
      const checkbox = wrapper.find(
        '[data-test="synthetics-check-locations-option-us-east-1"] input',
      );
      await checkbox.trigger("click");
      await flushPromises();

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      const last = emitted![emitted!.length - 1][0] as any;
      expect(last.locations).not.toContain("us-east-1");
      expect(last.locations).toContain("eu-west-1");
    });
  });

  describe("empty locations", () => {
    it("should show empty state when no locations are provided", () => {
      wrapper = mountCheckLocations({ locations: [] as SyntheticsLocation[] });

      expect(wrapper.find('[data-test="synthetics-check-locations-group"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="synthetics-check-locations-empty"]').exists()).toBe(true);
      expect(wrapper.text()).toContain("synthetics.locations.empty");
    });

    it("should not show the checkbox group when locations is empty", () => {
      wrapper = mountCheckLocations({ locations: [] as SyntheticsLocation[] });

      expect(wrapper.find('[data-test="synthetics-check-locations-group"]').exists()).toBe(false);
    });
  });

  describe("pre-selected locations", () => {
    it("should reflect pre-filled locations from the check prop", () => {
      const checkWithLocations = {
        ...mockMonitorHttp,
        locations: ["us-east-1", "ap-southeast-1"],
      };
      wrapper = mountCheckLocations({ check: checkWithLocations });

      const usEastCheckbox = wrapper.find(
        '[data-test="synthetics-check-locations-option-us-east-1"] input',
      );
      const euWestCheckbox = wrapper.find(
        '[data-test="synthetics-check-locations-option-eu-west-1"] input',
      );
      const apSoutheastCheckbox = wrapper.find(
        '[data-test="synthetics-check-locations-option-ap-southeast-1"] input',
      );

      expect((usEastCheckbox.element as HTMLInputElement).checked).toBe(true);
      expect((euWestCheckbox.element as HTMLInputElement).checked).toBe(false);
      expect((apSoutheastCheckbox.element as HTMLInputElement).checked).toBe(true);
    });

    it("should show no checkboxes checked when check has no locations", () => {
      const checkNoLocations = {
        ...mockMonitorHttp,
        locations: [] as string[],
      };
      wrapper = mountCheckLocations({ check: checkNoLocations });

      const usEastCheckbox = wrapper.find(
        '[data-test="synthetics-check-locations-option-us-east-1"] input',
      );
      const euWestCheckbox = wrapper.find(
        '[data-test="synthetics-check-locations-option-eu-west-1"] input',
      );
      const apSoutheastCheckbox = wrapper.find(
        '[data-test="synthetics-check-locations-option-ap-southeast-1"] input',
      );

      expect((usEastCheckbox.element as HTMLInputElement).checked).toBe(false);
      expect((euWestCheckbox.element as HTMLInputElement).checked).toBe(false);
      expect((apSoutheastCheckbox.element as HTMLInputElement).checked).toBe(false);
    });
  });

  describe("location icon resolution", () => {
    it("should render OIcon for generic providers", () => {
      // mockLocations all use 'aws' provider which maps to img: URL
      // The OIcon stub renders regardless
      wrapper = mountCheckLocations();
      const icons = wrapper.findAllComponents(OIconStub);
      expect(icons.length).toBeGreaterThanOrEqual(mockLocations.length);
    });
  });
});

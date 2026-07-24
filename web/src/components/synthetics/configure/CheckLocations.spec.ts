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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";

vi.mock("vue-i18n", () => ({
  useI18n: vi.fn(() => ({ t: (key: string, opts?: Record<string, unknown>) => {
    // Simple interpolation mock
    if (opts) {
      return key + " " + JSON.stringify(opts);
    }
    return key;
  } })),
}));

import CheckLocations from "./CheckLocations.vue";
import { mockMonitorHttp, mockLocations, mockPrivateLocations } from "@/test/unit/mockData/synthetics";
import type { SyntheticsLocation } from "@/types/synthetics";

// ── Shared Symbol for checkbox group provide/inject ──────────────────────────
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
  props: ["name", "size", "class"],
  template: '<i v-bind="$attrs" :data-name="name" :class="$props.class" />',
};

// Shallow stub — renders a plain <button> so native DOM events (click, etc.)
// bubble normally. The parent template's @click handler is registered as a
// native event listener and fires when the button is clicked.
const OButtonStub = {
  props: ["variant", "size", "icon", "iconLeft", "loading"],
  emits: ["click"],
  inheritAttrs: false,
  template: '<button v-bind="$attrs" :data-variant="variant" :data-icon="icon"><slot /></button>',
};

const OInputStub = {
  props: ["modelValue", "type", "placeholder", "clearable"],
  emits: ["update:modelValue"],
  template: '<input v-bind="$attrs" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
};

const SkeletonBoxStub = {
  props: ["width", "height", "variant", "rounded"],
  template: '<div v-bind="$attrs" class="skeleton-stub" />',
};

const OTooltipStub = {
  props: ["content", "side", "align"],
  template: '<div v-bind="$attrs" class="tooltip-stub"><slot /></div>',
};

const OBadgeStub = {
  props: ["variant", "size", "shape", "icon", "dot"],
  template: '<span v-bind="$attrs" :data-variant="variant"><slot /></span>',
};

const STUBS = {
  OCheckboxGroup: OCheckboxGroupStub,
  OCheckbox: OCheckboxStub,
  OIcon: OIconStub,
  OButton: OButtonStub,
  OInput: OInputStub,
  SkeletonBox: SkeletonBoxStub,
  OTooltip: OTooltipStub,
  OBadge: OBadgeStub,
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

function mountWithPrivate(props: Record<string, unknown> = {}) {
  return mount(CheckLocations, {
    props: {
      check: mockMonitorHttp,
      locations: [...mockLocations, ...mockPrivateLocations],
      allowPrivate: true,
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

  // ── Initial render ──────────────────────────────────────────────────────

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

    it("should render the refresh button with refresh icon", () => {
      const btn = wrapper.find('[data-test="synthetics-check-locations-refresh-btn"]');
      expect(btn.exists()).toBe(true);
      expect(btn.attributes("data-variant")).toBe("outline");
      expect(btn.attributes("data-icon")).toBe("refresh");
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

    it("should mark pre-selected locations as checked", () => {
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

  // ── Location selection ──────────────────────────────────────────────────

  describe("location selection", () => {
    beforeEach(() => {
      wrapper = mountCheckLocations();
    });

    it("should emit update:check when a location is toggled on", async () => {
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

  // ── Empty locations ─────────────────────────────────────────────────────

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

    it("should show the private setup CTA instead of the plain empty state when allowPrivate", () => {
      wrapper = mountCheckLocations({
        locations: [] as SyntheticsLocation[],
        allowPrivate: true,
      });

      expect(wrapper.find('[data-test="synthetics-check-locations-empty"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="synthetics-check-locations-private-empty"]').exists()).toBe(
        true,
      );
      expect(
        wrapper.find('[data-test="synthetics-check-locations-private-empty-cta"]').exists(),
      ).toBe(true);
    });

    it("should emit setup-agent from the CTA when no locations exist at all", async () => {
      wrapper = mountCheckLocations({
        locations: [] as SyntheticsLocation[],
        allowPrivate: true,
      });

      await wrapper
        .find('[data-test="synthetics-check-locations-private-empty-cta"]')
        .trigger("click");

      expect(wrapper.emitted("setup-agent")).toBeTruthy();
    });
  });

  // ── Pre-selected locations ──────────────────────────────────────────────

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

  // ── Loading skeleton ────────────────────────────────────────────────────

  describe("loading state", () => {
    it("should show skeleton when loadingLocations is true", () => {
      wrapper = mountCheckLocations({ loadingLocations: true });

      expect(wrapper.find('[data-test="synthetics-check-locations-loading"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="synthetics-check-locations-group"]').exists()).toBe(false);
    });

    it("should show loading text", () => {
      wrapper = mountCheckLocations({ loadingLocations: true });
      expect(wrapper.text()).toContain("synthetics.locations.loadingLocations");
    });

    it("should not show empty state while loading", () => {
      wrapper = mountCheckLocations({ locations: [], loadingLocations: true });
      expect(wrapper.find('[data-test="synthetics-check-locations-empty"]').exists()).toBe(false);
    });

    it("should show locations when loaded", () => {
      wrapper = mountCheckLocations({ loadingLocations: false });
      expect(wrapper.find('[data-test="synthetics-check-locations-loading"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="synthetics-check-locations-group"]').exists()).toBe(true);
    });
  });

  // ── Private section ─────────────────────────────────────────────────────

  describe("private locations", () => {
    beforeEach(() => {
      wrapper = mountWithPrivate();
    });

    it("should show the public and private section headers", () => {
      const text = wrapper.text();
      expect(text).toContain("synthetics.locations.publicTitle");
      expect(text).toContain("synthetics.locations.privateTitle");
    });

    it("should show section headers with info icons", () => {
      const text = wrapper.text();
      expect(text).toContain("synthetics.locations.publicTitle");
      expect(text).toContain("synthetics.locations.privateTitle");
      // Subtitle is now in OTooltip content prop — info icon should be present
      const infoIcons = wrapper.findAll('[data-name="info"]');
      expect(infoIcons.length).toBeGreaterThanOrEqual(2);
    });

    it("should not show private badge on rows", () => {
      // The OTag is no longer imported; privateBadge key shouldn't appear
      expect(wrapper.text()).not.toContain("synthetics.locations.privateBadge");
    });

    it("should show the new location button", () => {
      expect(
        wrapper.find('[data-test="synthetics-check-locations-new-location-btn"]').exists(),
      ).toBe(true);
    });

    it("should show per-row add agent buttons for private locations", () => {
      expect(
        wrapper.find('[data-test="synthetics-check-locations-add-agent-private-mumbai-1"]').exists(),
      ).toBe(true);
    });

    it("should emit new-location when new location button is clicked", async () => {
      // Verify the button renders with correct variant and text
      const btn = wrapper.find('[data-test="synthetics-check-locations-new-location-btn"]');
      expect(btn.exists()).toBe(true);
      expect(btn.attributes("data-variant")).toBe("primary");
      expect(btn.text()).toContain("synthetics.locations.newLocation");
    });

    it("should render per-row action button with correct variant per status", () => {
      // All per-row buttons use outline variant
      const onlineBtn = wrapper.find(
        '[data-test="synthetics-check-locations-add-agent-private-mumbai-1"]',
      );
      expect(onlineBtn.exists()).toBe(true);
      expect(onlineBtn.attributes("data-variant")).toBe("outline");
      expect(onlineBtn.text()).toContain("synthetics.locations.addAgent");

      // Pending → "Install agent"
      const pendingBtn = wrapper.find(
        '[data-test="synthetics-check-locations-add-agent-private-pending-1"]',
      );
      expect(pendingBtn.exists()).toBe(true);
      expect(pendingBtn.attributes("data-variant")).toBe("outline");
      expect(pendingBtn.text()).toContain("synthetics.locations.installAgent");
    });
  });

  // ── Status tiers ────────────────────────────────────────────────────────

  describe("status tiers", () => {
    it("should show check_circle icon for online locations", () => {
      wrapper = mountWithPrivate();
      const icon = wrapper.find('[data-test="synthetics-check-locations-status-icon-private-mumbai-1"]');
      expect(icon.exists()).toBe(true);
    });

    it("should show schedule icon for pending locations", () => {
      wrapper = mountWithPrivate();
      const icon = wrapper.find('[data-test="synthetics-check-locations-status-icon-private-pending-1"]');
      expect(icon.exists()).toBe(true);
    });

    it("should show status label badge for all private locations", () => {
      wrapper = mountWithPrivate();
      // Ready
      const readyBadge = wrapper.find('[data-test="synthetics-check-locations-status-badge-private-mumbai-1"]');
      expect(readyBadge.exists()).toBe(true);
      expect(readyBadge.attributes("data-variant")).toBe("success-outline");
      expect(readyBadge.text()).toContain("synthetics.locations.statusReady");

      // Connecting
      const connectingBadge = wrapper.find('[data-test="synthetics-check-locations-status-badge-private-pending-1"]');
      expect(connectingBadge.exists()).toBe(true);
      expect(connectingBadge.attributes("data-variant")).toBe("info-outline");
      expect(connectingBadge.text()).toContain("synthetics.locations.statusConnecting");

      // Down
      const downBadge = wrapper.find('[data-test="synthetics-check-locations-status-badge-private-down-1"]');
      expect(downBadge.exists()).toBe(true);
      expect(downBadge.attributes("data-variant")).toBe("error-outline");
      expect(downBadge.text()).toContain("synthetics.locations.statusDown");

      // Offline
      const offlineBadge = wrapper.find('[data-test="synthetics-check-locations-status-badge-private-offline-1"]');
      expect(offlineBadge.exists()).toBe(true);
      expect(offlineBadge.attributes("data-variant")).toBe("warning-outline");
      expect(offlineBadge.text()).toContain("synthetics.locations.statusOffline");
    });
  });

  // ── Agent display ───────────────────────────────────────────────────────

  describe("agent display", () => {
    beforeEach(() => {
      wrapper = mountWithPrivate();
    });

    it("should show live agent count and first agent name inline", () => {
      const text = wrapper.text();
      // private-mumbai-1 has 1 agent: "1 live agent · ag-mumbai-22"
      expect(text).toContain("synthetics.locations.liveAgents");
      expect(text).toContain("ag-mumbai-22");
    });

    it("should show +N badge when there are 2+ agents", () => {
      // private-blr-1 has 3 agents → should show +2 badge
      const badge = wrapper.find('[data-test="synthetics-check-locations-extra-agents-private-blr-1"]');
      expect(badge.exists()).toBe(true);
      expect(badge.text()).toBe("+2");
    });

    it("should not show +N badge for single-agent locations", () => {
      expect(wrapper.find('[data-test="synthetics-check-locations-extra-agents-private-mumbai-1"]').exists()).toBe(false);
    });

    it("should not show +N badge for locations without agents", () => {
      expect(wrapper.find('[data-test="synthetics-check-locations-extra-agents-private-offline-1"]').exists()).toBe(false);
    });
  });

  // ── Sorting ─────────────────────────────────────────────────────────────

  describe("private location sorting", () => {
    it("should sort online before pending before offline", () => {
      wrapper = mountWithPrivate();
      const checkboxes = wrapper.findAll('[data-test^="synthetics-check-locations-option-private-"]');
      const ids = checkboxes.map((c) => c.attributes("data-test"));
      // online (mumbai, blr) → pending (delhi) → offline (chennai) → down (kolkata)
      const mumbaiIdx = ids.indexOf("synthetics-check-locations-option-private-mumbai-1");
      const blrIdx = ids.indexOf("synthetics-check-locations-option-private-blr-1");
      const pendingIdx = ids.indexOf("synthetics-check-locations-option-private-pending-1");
      const offlineIdx = ids.indexOf("synthetics-check-locations-option-private-offline-1");
      const downIdx = ids.indexOf("synthetics-check-locations-option-private-down-1");

      expect(mumbaiIdx).toBeLessThan(pendingIdx);
      expect(blrIdx).toBeLessThan(pendingIdx);
      expect(pendingIdx).toBeLessThan(offlineIdx);
      expect(offlineIdx).toBeLessThan(downIdx);
    });
  });

  // ── Search ─────────────────────────────────────────────────────────────

  describe("search", () => {
    it("should not show search input when locations <= 6", () => {
      wrapper = mountCheckLocations();
      expect(wrapper.find('[data-test="synthetics-check-locations-search"]').exists()).toBe(false);
    });

    it("should show search input when locations > 6", () => {
      // Create 8 locations
      const manyLocations: SyntheticsLocation[] = Array.from({ length: 8 }, (_, i) => ({
        id: `loc-${i}`,
        label: `Location ${i}`,
        region: `region-${i}`,
        provider: "aws",
      }));
      wrapper = mountCheckLocations({ locations: manyLocations });
      expect(wrapper.find('[data-test="synthetics-check-locations-search"]').exists()).toBe(true);
    });
  });

  // ── Validation error ────────────────────────────────────────────────────

  describe("validation error", () => {
    it("should show validation error message when provided", () => {
      wrapper = mountCheckLocations({
        validationErrors: { locations: "Select at least one location" },
      });
      const err = wrapper.find('[data-test="synthetics-check-locations-error"]');
      expect(err.exists()).toBe(true);
      expect(err.text()).toContain("Select at least one location");
    });
  });
});

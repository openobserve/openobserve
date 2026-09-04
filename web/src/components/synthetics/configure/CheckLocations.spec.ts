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
  useI18n: vi.fn(() => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      // Simple interpolation mock
      if (opts) {
        return key + " " + JSON.stringify(opts);
      }
      return key;
    },
  })),
}));

import CheckLocations from "./CheckLocations.vue";
import {
  mockMonitorHttp,
  mockLocations,
  mockPrivateLocations,
} from "@/test/unit/mockData/synthetics";
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
// bubble normally. `click` must NOT be a declared emit: declaring it strips the
// parent's onClick from $attrs, so v-bind="$attrs" would never attach it.
const OButtonStub = {
  props: ["variant", "size", "icon", "iconLeft", "loading"],
  inheritAttrs: false,
  template:
    '<button v-bind="$attrs" :data-variant="variant" :data-icon="icon" :data-icon-left="iconLeft"><slot /></button>',
};

const OInputStub = {
  props: ["modelValue", "type", "placeholder", "clearable"],
  emits: ["update:modelValue"],
  template:
    '<input v-bind="$attrs" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
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

const OEmptyStateStub = {
  props: ["size", "icon", "title", "preset", "filtered", "actionLabel", "actionIcon"],
  emits: ["action"],
  template: `<div v-bind="$attrs" class="empty-state-stub">{{ title }}
    <button v-if="actionLabel" class="empty-state-action" @click="$emit('action')">{{ actionLabel }}</button>
  </div>`,
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
  OEmptyState: OEmptyStateStub,
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
      expect(btn.attributes("data-icon-left")).toBe("refresh");
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

    it("should emit new-location from the CTA when no locations exist at all", async () => {
      wrapper = mountCheckLocations({
        locations: [] as SyntheticsLocation[],
        allowPrivate: true,
      });

      await wrapper
        .find('[data-test="synthetics-check-locations-private-empty-cta"]')
        .trigger("click");

      expect(wrapper.emitted("new-location")).toBeTruthy();
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

    it("should not show loading text — the skeleton rows carry the state alone", () => {
      wrapper = mountCheckLocations({ loadingLocations: true });
      expect(wrapper.text()).not.toContain("synthetics.locations.loadingLocations");
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
        wrapper
          .find('[data-test="synthetics-check-locations-add-agent-private-mumbai-1"]')
          .exists(),
      ).toBe(true);
    });

    it("should emit new-location when new location button is clicked", async () => {
      const btn = wrapper.find('[data-test="synthetics-check-locations-new-location-btn"]');
      expect(btn.exists()).toBe(true);
      expect(btn.attributes("data-variant")).toBe("primary");
      expect(btn.text()).toContain("synthetics.locations.newLocation");

      await btn.trigger("click");
      expect(wrapper.emitted("new-location")).toBeTruthy();
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
      const icon = wrapper.find(
        '[data-test="synthetics-check-locations-status-icon-private-mumbai-1"]',
      );
      expect(icon.exists()).toBe(true);
    });

    it("should show schedule icon for pending locations", () => {
      wrapper = mountWithPrivate();
      const icon = wrapper.find(
        '[data-test="synthetics-check-locations-status-icon-private-pending-1"]',
      );
      expect(icon.exists()).toBe(true);
    });

    it("should show status label badge for all private locations", () => {
      wrapper = mountWithPrivate();
      // Ready
      const readyBadge = wrapper.find(
        '[data-test="synthetics-check-locations-status-badge-private-mumbai-1"]',
      );
      expect(readyBadge.exists()).toBe(true);
      expect(readyBadge.attributes("data-variant")).toBe("success-outline");
      expect(readyBadge.text()).toContain("synthetics.locations.statusReady");

      // Connecting
      const connectingBadge = wrapper.find(
        '[data-test="synthetics-check-locations-status-badge-private-pending-1"]',
      );
      expect(connectingBadge.exists()).toBe(true);
      expect(connectingBadge.attributes("data-variant")).toBe("info-outline");
      expect(connectingBadge.text()).toContain("synthetics.locations.statusConnecting");

      // Down
      const downBadge = wrapper.find(
        '[data-test="synthetics-check-locations-status-badge-private-down-1"]',
      );
      expect(downBadge.exists()).toBe(true);
      expect(downBadge.attributes("data-variant")).toBe("error-outline");
      expect(downBadge.text()).toContain("synthetics.locations.statusDown");

      // Offline
      const offlineBadge = wrapper.find(
        '[data-test="synthetics-check-locations-status-badge-private-offline-1"]',
      );
      expect(offlineBadge.exists()).toBe(true);
      expect(offlineBadge.attributes("data-variant")).toBe("warning-outline");
      expect(offlineBadge.text()).toContain("synthetics.locations.statusOffline");
    });

    it("should show a visible guidance message for every not-ready location", () => {
      wrapper = mountWithPrivate();

      const offlineWarning = wrapper.find(
        '[data-test="synthetics-check-locations-warning-private-offline-1"]',
      );
      expect(offlineWarning.exists()).toBe(true);
      expect(offlineWarning.text()).toContain("synthetics.locations.offlineMessage");

      const downWarning = wrapper.find(
        '[data-test="synthetics-check-locations-warning-private-down-1"]',
      );
      expect(downWarning.exists()).toBe(true);
      expect(downWarning.text()).toContain("synthetics.locations.downMessage");

      const pendingWarning = wrapper.find(
        '[data-test="synthetics-check-locations-warning-private-pending-1"]',
      );
      expect(pendingWarning.exists()).toBe(true);
      expect(pendingWarning.text()).toContain("synthetics.locations.connectingMessage");
    });

    it("should not show a guidance message for online locations", () => {
      wrapper = mountWithPrivate();
      expect(
        wrapper.find('[data-test="synthetics-check-locations-warning-private-mumbai-1"]').exists(),
      ).toBe(false);
    });
  });

  /**
   * Agents register with one region and their rows never replicate, so a
   * location whose agents live elsewhere arrives here with none — and used to
   * be badged "Connecting · install an agent", for an agent already installed.
   */
  describe("live status this region cannot see", () => {
    const unknownLocation: SyntheticsLocation = {
      id: "private-remote-1",
      label: "remote-prod",
      region: "remote-prod",
      provider: "",
      kind: "private",
      status: "pending",
      live_status_unknown: true,
      agent_names: [],
      live_agents: 0,
    };

    function mountWithUnknown() {
      return mount(CheckLocations, {
        props: {
          check: mockMonitorHttp,
          locations: [...mockLocations, ...mockPrivateLocations, unknownLocation],
          allowPrivate: true,
        },
        global: { stubs: STUBS },
      }) as VueWrapper;
    }

    it("should badge it neutrally rather than as connecting", () => {
      wrapper = mountWithUnknown();

      const badge = wrapper.find(
        '[data-test="synthetics-check-locations-status-badge-private-remote-1"]',
      );
      expect(badge.attributes("data-variant")).toBe("default-outline");
      expect(badge.text()).toContain("synthetics.locations.statusUnknown");
    });

    it("should say the status is unavailable here, not that an agent is missing", () => {
      wrapper = mountWithUnknown();

      const warning = wrapper.find(
        '[data-test="synthetics-check-locations-warning-private-remote-1"]',
      );
      expect(warning.text()).toContain("synthetics.locations.unknownMessage");
      expect(wrapper.text()).toContain("synthetics.locations.unknownAgents");
    });

    /** Nothing is wrong with it, so it must not sink below the locations that
     *  genuinely need attention. */
    it("should sort below ready locations and above the rest", () => {
      wrapper = mountWithUnknown();

      const ids = wrapper
        .findAll('[data-test^="synthetics-check-locations-status-badge-private-"]')
        .map((el) => el.attributes("data-test"));
      const unknownAt = ids.indexOf("synthetics-check-locations-status-badge-private-remote-1");
      const connectingAt = ids.indexOf("synthetics-check-locations-status-badge-private-pending-1");
      const readyAt = ids.indexOf("synthetics-check-locations-status-badge-private-mumbai-1");
      expect(readyAt).toBeLessThan(unknownAt);
      expect(unknownAt).toBeLessThan(connectingAt);
    });

    /** A server without super cluster never sends the flag. */
    it("should be unchanged when the flag is absent", () => {
      wrapper = mountWithPrivate();

      const badge = wrapper.find(
        '[data-test="synthetics-check-locations-status-badge-private-pending-1"]',
      );
      expect(badge.attributes("data-variant")).toBe("info-outline");
      expect(wrapper.text()).not.toContain("synthetics.locations.statusUnknown");
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
      const badge = wrapper.find(
        '[data-test="synthetics-check-locations-extra-agents-private-blr-1"]',
      );
      expect(badge.exists()).toBe(true);
      expect(badge.text()).toBe("+2");
    });

    it("should not show +N badge for single-agent locations", () => {
      expect(
        wrapper
          .find('[data-test="synthetics-check-locations-extra-agents-private-mumbai-1"]')
          .exists(),
      ).toBe(false);
    });

    it("should not show +N badge for locations without agents", () => {
      expect(
        wrapper
          .find('[data-test="synthetics-check-locations-extra-agents-private-offline-1"]')
          .exists(),
      ).toBe(false);
    });

    it("should fall back to the waiting-for-agent text for offline locations without last_seen_at", () => {
      const neverSeen: SyntheticsLocation = {
        id: "private-never-1",
        label: "never-seen",
        region: "",
        provider: "",
        kind: "private",
        status: "offline",
      };
      wrapper = mountWithPrivate({ locations: [neverSeen] });

      const row = wrapper.find('[data-test="synthetics-check-locations-option-private-never-1"]');
      expect(row.exists()).toBe(true);
      expect(row.text()).toContain("synthetics.locations.pendingAgent");
    });
  });

  // ── Sorting ─────────────────────────────────────────────────────────────

  describe("private location sorting", () => {
    it("should sort online before pending before offline", () => {
      wrapper = mountWithPrivate();
      const checkboxes = wrapper.findAll(
        '[data-test^="synthetics-check-locations-option-private-"]',
      );
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

    it("should sort recently-offline locations above long-dead ones regardless of label order", () => {
      // "aaa-dead" would win an alphabetical tie-break; only a tier-aware sort
      // ranks the recently-dropped "zzz-recent" above it.
      const dead: SyntheticsLocation = {
        id: "p-dead",
        label: "aaa-dead",
        region: "",
        provider: "",
        kind: "private",
        status: "offline",
        last_seen_at: Date.now() * 1000 - 30 * 3600 * 1_000_000, // 30h — down tier
      };
      const recent: SyntheticsLocation = {
        id: "p-recent",
        label: "zzz-recent",
        region: "",
        provider: "",
        kind: "private",
        status: "offline",
        last_seen_at: Date.now() * 1000 - 2 * 3600 * 1_000_000, // 2h — offline tier
      };
      wrapper = mountWithPrivate({ locations: [dead, recent] });

      const ids = wrapper
        .findAll('[data-test^="synthetics-check-locations-option-p-"]')
        .map((c) => c.attributes("data-test"));
      expect(ids.indexOf("synthetics-check-locations-option-p-recent")).toBeLessThan(
        ids.indexOf("synthetics-check-locations-option-p-dead"),
      );
    });
  });

  // ── Search ─────────────────────────────────────────────────────────────

  describe("search", () => {
    it("should always show the search input, even with few locations", () => {
      wrapper = mountCheckLocations();
      expect(wrapper.find('[data-test="synthetics-check-locations-search"]').exists()).toBe(true);
    });

    it("should show search input with many locations", () => {
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

    it("should keep the search row visible while loading", () => {
      wrapper = mountCheckLocations({ loadingLocations: true });
      expect(wrapper.find('[data-test="synthetics-check-locations-search"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="synthetics-check-locations-refresh-btn"]').exists()).toBe(
        true,
      );
    });

    it("should filter the location list by the search query", async () => {
      wrapper = mountCheckLocations();
      await wrapper.find('[data-test="synthetics-check-locations-search"]').setValue("us east");

      // mockLocations: "US East" matches, the others don't
      expect(
        wrapper.find('[data-test="synthetics-check-locations-option-us-east-1"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="synthetics-check-locations-option-eu-west-1"]').exists(),
      ).toBe(false);
    });

    it("should show a no-results state when the search matches nothing", async () => {
      wrapper = mountCheckLocations();
      await wrapper
        .find('[data-test="synthetics-check-locations-search"]')
        .setValue("zzz-no-such-location");

      const noResults = wrapper.find('[data-test="synthetics-check-locations-no-results"]');
      expect(noResults.exists()).toBe(true);
      expect(noResults.text()).toContain("synthetics.locations.noSearchResults");
      // The "no locations at all" empty state must not appear for a filter miss
      expect(wrapper.find('[data-test="synthetics-check-locations-empty"]').exists()).toBe(false);
    });

    it("should collapse to a single empty state with the new-location CTA when nothing matches anywhere", async () => {
      wrapper = mountWithPrivate();
      await wrapper
        .find('[data-test="synthetics-check-locations-search"]')
        .setValue("zzz-no-such-location");

      const noResults = wrapper.find('[data-test="synthetics-check-locations-no-results"]');
      expect(noResults.exists()).toBe(true);
      expect(noResults.text()).toContain("synthetics.locations.noSearchResults");
      // Per-section messages and the creation empty state give way to it
      expect(
        wrapper.find('[data-test="synthetics-check-locations-public-no-results"]').exists(),
      ).toBe(false);
      expect(
        wrapper.find('[data-test="synthetics-check-locations-private-no-results"]').exists(),
      ).toBe(false);
      expect(wrapper.find('[data-test="synthetics-check-locations-private-empty"]').exists()).toBe(
        false,
      );

      // Its action button creates a private location
      const action = noResults.find("button.empty-state-action");
      expect(action.exists()).toBe(true);
      expect(action.text()).toContain("synthetics.locations.newPrivateLocation");
      await action.trigger("click");
      expect(wrapper.emitted("new-location")).toBeTruthy();
    });

    it("should not offer the new-location action on a full miss when private locations are not allowed", async () => {
      wrapper = mountCheckLocations();
      await wrapper
        .find('[data-test="synthetics-check-locations-search"]')
        .setValue("zzz-no-such-location");

      const noResults = wrapper.find('[data-test="synthetics-check-locations-no-results"]');
      expect(noResults.exists()).toBe(true);
      expect(noResults.find("button.empty-state-action").exists()).toBe(false);
    });

    it("should show only the public no-results message when the search matches private locations only", async () => {
      wrapper = mountWithPrivate();
      await wrapper.find('[data-test="synthetics-check-locations-search"]').setValue("mumbai");

      const publicMiss = wrapper.find('[data-test="synthetics-check-locations-public-no-results"]');
      expect(publicMiss.exists()).toBe(true);
      expect(publicMiss.text()).toContain("synthetics.locations.noPublicMatches");
      expect(wrapper.find('[data-test="synthetics-check-locations-no-results"]').exists()).toBe(
        false,
      );
      expect(
        wrapper.find('[data-test="synthetics-check-locations-option-private-mumbai-1"]').exists(),
      ).toBe(true);

      // Both section headers stay visible
      const text = wrapper.text();
      expect(text).toContain("synthetics.locations.publicTitle");
      expect(text).toContain("synthetics.locations.privateTitle");
    });

    it("should show only the private no-results message when the search matches public locations only", async () => {
      wrapper = mountWithPrivate();
      await wrapper.find('[data-test="synthetics-check-locations-search"]').setValue("ireland");

      const privateMiss = wrapper.find(
        '[data-test="synthetics-check-locations-private-no-results"]',
      );
      expect(privateMiss.exists()).toBe(true);
      expect(privateMiss.text()).toContain("synthetics.locations.noPrivateMatches");
      expect(wrapper.find('[data-test="synthetics-check-locations-no-results"]').exists()).toBe(
        false,
      );
      expect(
        wrapper.find('[data-test="synthetics-check-locations-option-eu-west-1"]').exists(),
      ).toBe(true);
      expect(wrapper.find('[data-test="synthetics-check-locations-private-empty"]').exists()).toBe(
        false,
      );
    });

    it("should clear the no-results state when the query is emptied", async () => {
      wrapper = mountCheckLocations();
      const search = wrapper.find('[data-test="synthetics-check-locations-search"]');
      await search.setValue("zzz-no-such-location");
      expect(wrapper.find('[data-test="synthetics-check-locations-no-results"]').exists()).toBe(
        true,
      );

      await search.setValue("");
      expect(wrapper.find('[data-test="synthetics-check-locations-no-results"]').exists()).toBe(
        false,
      );
      expect(
        wrapper.find('[data-test="synthetics-check-locations-option-us-east-1"]').exists(),
      ).toBe(true);
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

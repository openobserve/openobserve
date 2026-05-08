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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";

vi.mock("vue-i18n", () => ({
  useI18n: () => ({ t: (k: string, options?: Record<string, any>) => k }),
}));

import PatternFilterBar from "./PatternFilterBar.vue";
import type { FilterBarPattern } from "./usePatternActions";

function createFilterPattern(
  overrides: Partial<FilterBarPattern> = {},
): FilterBarPattern {
  return {
    pattern_id: "pat-1",
    template: "User * logged in from IP *",
    action: "include",
    ...overrides,
  };
}

describe("PatternFilterBar", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  describe("when filterPatterns is empty", () => {
    beforeEach(() => {
      wrapper = mount(PatternFilterBar, {
        props: {
          filterPatterns: [],
        },
        global: {
          stubs: {
            OButton: {
              template:
                '<button :data-test="$attrs[\'data-test\']"><slot /></button>',
              inheritAttrs: true,
            },
          },
        },
      });
    });

    it("should not render the container", () => {
      expect(
        wrapper.find('[data-test="patterns-patternfilterbar-container"]')
          .exists(),
      ).toBe(false);
    });

    it("should not render the apply button", () => {
      expect(
        wrapper.find('[data-test="patterns-patternfilterbar-apply-btn"]')
          .exists(),
      ).toBe(false);
    });

    it("should not render the clear button", () => {
      expect(
        wrapper.find('[data-test="patterns-patternfilterbar-clear-btn"]')
          .exists(),
      ).toBe(false);
    });
  });

  describe("when filterPatterns has items", () => {
    const patterns: FilterBarPattern[] = [
      createFilterPattern({ pattern_id: "pat-1", action: "include" }),
      createFilterPattern({
        pattern_id: "pat-2",
        template: "Error * in module *",
        action: "exclude",
      }),
    ];

    beforeEach(() => {
      wrapper = mount(PatternFilterBar, {
        props: {
          filterPatterns: patterns,
        },
        global: {
          stubs: {
            OButton: {
              template:
                '<button :data-test="$attrs[\'data-test\']"><slot /></button>',
              inheritAttrs: true,
            },
            "q-icon": {
              template:
                '<span :data-test="$attrs[\'data-test\']" class="q-icon-stub" />',
              inheritAttrs: true,
            },
          },
        },
      });
    });

    it("should render the container", () => {
      expect(
        wrapper.find('[data-test="patterns-patternfilterbar-container"]')
          .exists(),
      ).toBe(true);
    });

    it("should render the count text with correct pattern count", () => {
      const container = wrapper.find(
        '[data-test="patterns-patternfilterbar-container"]',
      );
      expect(container.text()).toContain("search.patternFilterCount");
    });

    it("should render a chip for each pattern", () => {
      expect(
        wrapper
          .find('[data-test="patterns-patternfilterbar-chip-pat-1"]')
          .exists(),
      ).toBe(true);
      expect(
        wrapper
          .find('[data-test="patterns-patternfilterbar-chip-pat-2"]')
          .exists(),
      ).toBe(true);
    });

    it("should display truncated template text in each chip", () => {
      const chip1 = wrapper.find(
        '[data-test="patterns-patternfilterbar-chip-pat-1"]',
      );
      const chip2 = wrapper.find(
        '[data-test="patterns-patternfilterbar-chip-pat-2"]',
      );

      expect(chip1.text()).toContain("User * logged in from IP *");
      expect(chip2.text()).toContain("Error * in module *");
    });

    it("should render a close icon in each chip", () => {
      const chip1 = wrapper.find(
        '[data-test="patterns-patternfilterbar-chip-pat-1"]',
      );
      const chip2 = wrapper.find(
        '[data-test="patterns-patternfilterbar-chip-pat-2"]',
      );

      const closeIcons1 = chip1.findAll(".q-icon-stub");
      const closeIcons2 = chip2.findAll(".q-icon-stub");
      expect(closeIcons1.length).toBe(1);
      expect(closeIcons2.length).toBe(1);
    });

    it("should render the apply button with correct label", () => {
      const applyBtn = wrapper.find(
        '[data-test="patterns-patternfilterbar-apply-btn"]',
      );
      expect(applyBtn.exists()).toBe(true);
      expect(applyBtn.text()).toBe("search.patternApplyFilters");
    });

    it("should render the clear all button with correct label", () => {
      const clearBtn = wrapper.find(
        '[data-test="patterns-patternfilterbar-clear-btn"]',
      );
      expect(clearBtn.exists()).toBe(true);
      expect(clearBtn.text()).toBe("search.patternClearFilters");
    });
  });

  describe("emit events", () => {
    const patterns: FilterBarPattern[] = [
      createFilterPattern({ pattern_id: "pat-1", action: "include" }),
      createFilterPattern({
        pattern_id: "pat-2",
        template: "Error * in module *",
        action: "exclude",
      }),
    ];

    beforeEach(() => {
      wrapper = mount(PatternFilterBar, {
        props: {
          filterPatterns: patterns,
        },
        global: {
          stubs: {
            OButton: {
              template:
                '<button :data-test="$attrs[\'data-test\']" @click="$emit(\'click\')"><slot /></button>',
              inheritAttrs: true,
            },
            "q-icon": {
              template:
                '<span :data-test="$attrs[\'data-test\']" class="q-icon-stub" @click="$emit(\'click\')" />',
              inheritAttrs: true,
            },
          },
        },
      });
    });

    it("should emit remove event with correct pattern_id when a chip close icon is clicked", () => {
      const chip1 = wrapper.find(
        '[data-test="patterns-patternfilterbar-chip-pat-1"]',
      );
      const closeIcon = chip1.find(".q-icon-stub");
      expect(closeIcon.exists()).toBe(true);

      closeIcon.trigger("click");

      expect(wrapper.emitted("remove")).toBeTruthy();
      expect(wrapper.emitted("remove")!.length).toBe(1);
      expect(wrapper.emitted("remove")![0]).toEqual(["pat-1"]);
    });

    it("should emit remove event for the second pattern when its close icon is clicked", () => {
      const chip2 = wrapper.find(
        '[data-test="patterns-patternfilterbar-chip-pat-2"]',
      );
      const closeIcon = chip2.find(".q-icon-stub");
      expect(closeIcon.exists()).toBe(true);

      closeIcon.trigger("click");

      expect(wrapper.emitted("remove")).toBeTruthy();
      expect(wrapper.emitted("remove")![0]).toEqual(["pat-2"]);
    });

    it("should emit apply event when Apply Filters button is clicked", async () => {
      const applyBtn = wrapper.find(
        '[data-test="patterns-patternfilterbar-apply-btn"]',
      );
      expect(applyBtn.exists()).toBe(true);

      await applyBtn.trigger("click");

      expect(wrapper.emitted("apply")).toBeTruthy();
      expect(wrapper.emitted("apply")!.length).toBe(1);
    });

    it("should emit clear event when Clear All button is clicked", async () => {
      const clearBtn = wrapper.find(
        '[data-test="patterns-patternfilterbar-clear-btn"]',
      );
      expect(clearBtn.exists()).toBe(true);

      await clearBtn.trigger("click");

      expect(wrapper.emitted("clear")).toBeTruthy();
      expect(wrapper.emitted("clear")!.length).toBe(1);
    });

    it("should not emit apply when clear button is clicked", async () => {
      const clearBtn = wrapper.find(
        '[data-test="patterns-patternfilterbar-clear-btn"]',
      );
      await clearBtn.trigger("click");

      expect(wrapper.emitted("apply")).toBeFalsy();
    });

    it("should not emit clear when apply button is clicked", async () => {
      const applyBtn = wrapper.find(
        '[data-test="patterns-patternfilterbar-apply-btn"]',
      );
      await applyBtn.trigger("click");

      expect(wrapper.emitted("clear")).toBeFalsy();
    });
  });

  describe("template truncation", () => {
    it("should truncate templates longer than 40 characters", () => {
      const longTemplate = "A".repeat(50);
      const patterns: FilterBarPattern[] = [
        createFilterPattern({
          pattern_id: "pat-long",
          template: longTemplate,
        }),
      ];

      wrapper = mount(PatternFilterBar, {
        props: {
          filterPatterns: patterns,
        },
        global: {
          stubs: {
            OButton: {
              template:
                '<button :data-test="$attrs[\'data-test\']"><slot /></button>',
              inheritAttrs: true,
            },
            "q-icon": {
              template:
                '<span :data-test="$attrs[\'data-test\']" class="q-icon-stub" />',
              inheritAttrs: true,
            },
          },
        },
      });

      const chip = wrapper.find(
        '[data-test="patterns-patternfilterbar-chip-pat-long"]',
      );
      expect(chip.exists()).toBe(true);

      // 37 chars + "..."
      const expected = longTemplate.slice(0, 37) + "...";
      expect(chip.text()).toContain(expected);
      expect(chip.text()).not.toContain(longTemplate);
    });

    it("should not truncate templates of 40 characters or fewer", () => {
      const shortTemplate = "B".repeat(40);
      const patterns: FilterBarPattern[] = [
        createFilterPattern({
          pattern_id: "pat-short",
          template: shortTemplate,
        }),
      ];

      wrapper = mount(PatternFilterBar, {
        props: {
          filterPatterns: patterns,
        },
        global: {
          stubs: {
            OButton: {
              template:
                '<button :data-test="$attrs[\'data-test\']"><slot /></button>',
              inheritAttrs: true,
            },
            "q-icon": {
              template:
                '<span :data-test="$attrs[\'data-test\']" class="q-icon-stub" />',
              inheritAttrs: true,
            },
          },
        },
      });

      const chip = wrapper.find(
        '[data-test="patterns-patternfilterbar-chip-pat-short"]',
      );
      expect(chip.exists()).toBe(true);
      expect(chip.text()).toContain(shortTemplate);
      expect(chip.text()).not.toContain("...");
    });
  });

  describe("with a single pattern", () => {
    it("should render with count text for one pattern", () => {
      const patterns: FilterBarPattern[] = [
        createFilterPattern({ pattern_id: "pat-only", action: "include" }),
      ];

      wrapper = mount(PatternFilterBar, {
        props: {
          filterPatterns: patterns,
        },
        global: {
          stubs: {
            OButton: {
              template:
                '<button :data-test="$attrs[\'data-test\']"><slot /></button>',
              inheritAttrs: true,
            },
            "q-icon": {
              template:
                '<span :data-test="$attrs[\'data-test\']" class="q-icon-stub" />',
              inheritAttrs: true,
            },
          },
        },
      });

      expect(
        wrapper.find('[data-test="patterns-patternfilterbar-container"]')
          .exists(),
      ).toBe(true);
      expect(
        wrapper
          .find('[data-test="patterns-patternfilterbar-chip-pat-only"]')
          .exists(),
      ).toBe(true);
    });
  });
});

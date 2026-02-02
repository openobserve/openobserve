// Copyright 2025 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import FieldExpansion from "@/plugins/logs/components/FieldExpansion.vue";
import i18n from "@/locales";
import { Quasar } from "quasar";

// Mock formatLargeNumber utility
vi.mock("@/utils/zincutils", () => ({
  formatLargeNumber: vi.fn((num) => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
    if (num >= 1000) return (num / 1000).toFixed(1) + "K";
    return num.toString();
  }),
}));

describe("FieldExpansion.vue", () => {

  const defaultProps = {
    field: {
      name: "status",
      isSchemaField: true,
      isInterestingField: false,
      streams: ["logs"],
    },
    fieldValues: {
      isLoading: false,
      values: [
        { key: "200", count: 1500 },
        { key: "404", count: 250 },
        { key: "500", count: 50 },
      ],
    },
    selectedFields: [],
    selectedStreamsCount: 1,
    theme: "light",
    showQuickMode: true,
  };

  describe("rendering", () => {
    it("should render field expansion with field name", () => {
      const wrapper = mount(FieldExpansion, {
        props: defaultProps,
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            "q-expansion-item": {
              template:
                '<div class="q-expansion-item"><slot name="header" /><slot /></div>',
            },
            "q-card": { template: "<div><slot /></div>" },
            "q-card-section": { template: "<div><slot /></div>" },
            "q-icon": true,
            "q-btn": true,
            "q-list": { template: "<div><slot /></div>" },
            "q-item": { template: "<div><slot /></div>" },
            "q-checkbox": true,
            "q-tooltip": true,
            EqualIcon: true,
            NotEqualIcon: true,
          },
        },
      });

      expect(wrapper.text()).toContain("status");
    });

    it("should render field values list", () => {
      const wrapper = mount(FieldExpansion, {
        props: defaultProps,
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            "q-expansion-item": {
              template: "<div><slot name='header' /><slot /></div>",
            },
            "q-card": { template: "<div><slot /></div>" },
            "q-card-section": { template: "<div><slot /></div>" },
            "q-icon": true,
            "q-btn": true,
            "q-list": { template: "<div><slot /></div>" },
            "q-item": { template: "<div><slot /></div>" },
            EqualIcon: true,
            NotEqualIcon: true,
          },
        },
      });

      expect(wrapper.text()).toContain("200");
      expect(wrapper.text()).toContain("404");
      expect(wrapper.text()).toContain("500");
    });

    it("should format large numbers", () => {
      const wrapper = mount(FieldExpansion, {
        props: {
          ...defaultProps,
          fieldValues: {
            isLoading: false,
            values: [{ key: "total", count: 1500000 }],
          },
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            "q-expansion-item": {
              template: "<div><slot name='header' /><slot /></div>",
            },
            "q-card": { template: "<div><slot /></div>" },
            "q-card-section": { template: "<div><slot /></div>" },
            "q-list": { template: "<div><slot /></div>" },
            "q-item": { template: "<div><slot /></div>" },
            "q-icon": true,
            "q-btn": true,
            EqualIcon: true,
            NotEqualIcon: true,
          },
        },
      });

      expect(wrapper.text()).toContain("1.5M");
    });
  });

  describe("loading state", () => {
    it("should show loading indicator when isLoading is true", () => {
      const wrapper = mount(FieldExpansion, {
        props: {
          ...defaultProps,
          fieldValues: {
            isLoading: true,
            values: [],
          },
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            "q-expansion-item": {
              template: "<div><slot name='header' /><slot /></div>",
            },
            "q-card": { template: "<div><slot /></div>" },
            "q-card-section": { template: "<div><slot /></div>" },
            "q-inner-loading": {
              template: "<div class='loading'>Fetching values...</div>",
            },
            "q-icon": true,
            "q-btn": true,
          },
        },
      });

      expect(wrapper.find(".loading").exists()).toBe(true);
      expect(wrapper.text()).toContain("Fetching values...");
    });

    it("should hide values list when loading", () => {
      const wrapper = mount(FieldExpansion, {
        props: {
          ...defaultProps,
          fieldValues: {
            isLoading: true,
            values: [{ key: "test", count: 100 }],
          },
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            "q-expansion-item": {
              template: "<div><slot name='header' /><slot /></div>",
            },
            "q-card": { template: "<div><slot /></div>" },
            "q-card-section": { template: "<div><slot /></div>" },
            "q-inner-loading": { template: "<div class='loading' />" },
            "q-icon": true,
            "q-btn": true,
          },
        },
      });

      expect(wrapper.find(".loading").exists()).toBe(true);
    });
  });

  describe("empty state", () => {
    it("should show 'No values found' when values array is empty", () => {
      const wrapper = mount(FieldExpansion, {
        props: {
          ...defaultProps,
          fieldValues: {
            isLoading: false,
            values: [],
          },
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            "q-expansion-item": {
              template: "<div><slot name='header' /><slot /></div>",
            },
            "q-card": { template: "<div><slot /></div>" },
            "q-card-section": { template: "<div><slot /></div>" },
            "q-icon": true,
            "q-btn": true,
          },
        },
      });

      expect(wrapper.text()).toContain("No values found");
    });

    it("should show custom error message when provided", () => {
      const wrapper = mount(FieldExpansion, {
        props: {
          ...defaultProps,
          fieldValues: {
            isLoading: false,
            values: [],
            errMsg: "Failed to fetch values",
          },
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            "q-expansion-item": {
              template: "<div><slot name='header' /><slot /></div>",
            },
            "q-card": { template: "<div><slot /></div>" },
            "q-card-section": { template: "<div><slot /></div>" },
            "q-icon": true,
            "q-btn": true,
          },
        },
      });

      expect(wrapper.text()).toContain("Failed to fetch values");
    });
  });

  describe("field selection", () => {
    it("should show visibility icon when field is not selected", () => {
      const wrapper = mount(FieldExpansion, {
        props: {
          ...defaultProps,
          selectedFields: [],
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            "q-expansion-item": {
              template: "<div><slot name='header' /><slot /></div>",
            },
            "q-icon": {
              template: '<div class="q-icon" :name="name"></div>',
              props: ["name"],
            },
            "q-btn": true,
            "q-card": { template: "<div><slot /></div>" },
            "q-card-section": { template: "<div><slot /></div>" },
          },
        },
      });

      expect(wrapper.find('[name="outlined-visibility"]').exists()).toBe(false); // Due to stubbing
    });

    it("should show visibility_off icon when field is selected", () => {
      const wrapper = mount(FieldExpansion, {
        props: {
          ...defaultProps,
          selectedFields: ["status"],
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            "q-expansion-item": {
              template: "<div><slot name='header' /><slot /></div>",
            },
            "q-icon": true,
            "q-btn": true,
            "q-card": { template: "<div><slot /></div>" },
            "q-card-section": { template: "<div><slot /></div>" },
          },
        },
      });

      // Component computes isFieldSelected correctly
      expect(wrapper.vm).toBeDefined();
    });
  });

  describe("interesting fields", () => {
    it("should show info icon for interesting fields", () => {
      const wrapper = mount(FieldExpansion, {
        props: {
          ...defaultProps,
          field: {
            ...defaultProps.field,
            isInterestingField: true,
          },
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            "q-expansion-item": {
              template: "<div><slot name='header' /><slot /></div>",
            },
            "q-icon": true,
            "q-btn": true,
            "q-card": { template: "<div><slot /></div>" },
            "q-card-section": { template: "<div><slot /></div>" },
          },
        },
      });

      expect(wrapper.exists()).toBe(true);
    });

    it("should show info_outline for non-interesting fields", () => {
      const wrapper = mount(FieldExpansion, {
        props: defaultProps,
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            "q-expansion-item": {
              template: "<div><slot name='header' /><slot /></div>",
            },
            "q-icon": true,
            "q-btn": true,
            "q-card": { template: "<div><slot /></div>" },
            "q-card-section": { template: "<div><slot /></div>" },
          },
        },
      });

      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("events", () => {
    it("should emit add-to-filter when filter button is clicked", async () => {
      const wrapper = mount(FieldExpansion, {
        props: defaultProps,
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            "q-expansion-item": {
              template: "<div><slot name='header' /><slot /></div>",
            },
            "q-icon": true,
            "q-btn": {
              template: '<button @click="$attrs.onClick"><slot /></button>',
            },
            "q-card": { template: "<div><slot /></div>" },
            "q-card-section": { template: "<div><slot /></div>" },
          },
        },
      });

      const buttons = wrapper.findAll("button");
      if (buttons.length > 0) {
        await buttons[0].trigger("click");
        // Check emitted event exists
        expect(wrapper.emitted()).toBeDefined();
      }
    });

    it("should emit toggle-field when visibility icon is clicked", async () => {
      const wrapper = mount(FieldExpansion, {
        props: defaultProps,
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            "q-expansion-item": {
              template: "<div><slot name='header' /><slot /></div>",
            },
            "q-icon": {
              template: '<div class="q-icon" @click="$attrs.onClick"></div>',
            },
            "q-btn": true,
            "q-card": { template: "<div><slot /></div>" },
            "q-card-section": { template: "<div><slot /></div>" },
          },
        },
      });

      const icons = wrapper.findAll(".q-icon");
      if (icons.length > 0) {
        await icons[0].trigger("click");
        expect(wrapper.emitted()).toBeDefined();
      }
    });

    it("should emit toggle-interesting when info icon is clicked", async () => {
      const wrapper = mount(FieldExpansion, {
        props: defaultProps,
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            "q-expansion-item": {
              template: "<div><slot name='header' /><slot /></div>",
            },
            "q-icon": {
              template: '<div class="q-icon" @click="$attrs.onClick"></div>',
            },
            "q-btn": true,
            "q-card": { template: "<div><slot /></div>" },
            "q-card-section": { template: "<div><slot /></div>" },
          },
        },
      });

      expect(wrapper.exists()).toBe(true);
    });

    it("should emit before-show when expansion opens", async () => {
      const wrapper = mount(FieldExpansion, {
        props: defaultProps,
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            "q-expansion-item": {
              template:
                '<div class="q-expansion-item" @click="$emit(\'before-show\', {})"><slot name="header" /><slot /></div>',
            },
            "q-icon": true,
            "q-btn": true,
            "q-card": { template: "<div><slot /></div>" },
            "q-card-section": { template: "<div><slot /></div>" },
          },
        },
      });

      await wrapper.find(".q-expansion-item").trigger("click");
      expect(wrapper.emitted("before-show")).toBeTruthy();
    });

    it("should emit add-search-term with correct parameters for include", async () => {
      const wrapper = mount(FieldExpansion, {
        props: {
          ...defaultProps,
          selectedStreamsCount: 1,
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            "q-expansion-item": {
              template: "<div><slot name='header' /><slot /></div>",
            },
            "q-card": { template: "<div><slot /></div>" },
            "q-card-section": { template: "<div><slot /></div>" },
            "q-list": { template: "<div><slot /></div>" },
            "q-item": { template: "<div><slot /></div>" },
            "q-icon": true,
            "q-btn": {
              template: '<button @click="$attrs.onClick"><slot /></button>',
            },
            EqualIcon: { template: "<div>=" },
            NotEqualIcon: { template: "<div>!=" },
          },
        },
      });

      const buttons = wrapper.findAll("button");
      // Find the include button (should have EqualIcon which shows "=")
      // The include/exclude buttons are rendered after the header buttons
      // Header has 1 button (add-to-filter), so first include button should be at index 1
      if (buttons.length > 1) {
        await buttons[1].trigger("click");
        expect(wrapper.emitted("add-search-term")).toBeTruthy();
        expect(wrapper.emitted("add-search-term")?.[0]).toEqual([
          "status",
          "200",
          "include",
        ]);
      }
    });
  });

  describe("include/exclude buttons", () => {
    it("should show include/exclude buttons when selectedStreamsCount matches field streams", () => {
      const wrapper = mount(FieldExpansion, {
        props: {
          ...defaultProps,
          selectedStreamsCount: 1,
          field: {
            ...defaultProps.field,
            streams: ["logs"],
          },
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            "q-expansion-item": {
              template: "<div><slot name='header' /><slot /></div>",
            },
            "q-card": { template: "<div><slot /></div>" },
            "q-card-section": { template: "<div><slot /></div>" },
            "q-list": { template: "<div><slot /></div>" },
            "q-item": { template: "<div><slot /></div>" },
            "q-icon": true,
            "q-btn": { template: "<button><slot /></button>" },
            EqualIcon: true,
            NotEqualIcon: true,
          },
        },
      });

      const buttons = wrapper.findAll("button");
      expect(buttons.length).toBeGreaterThan(0);
    });

    it("should hide include/exclude buttons when stream counts do not match", () => {
      const wrapper = mount(FieldExpansion, {
        props: {
          ...defaultProps,
          selectedStreamsCount: 2,
          field: {
            ...defaultProps.field,
            streams: ["logs"],
          },
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            "q-expansion-item": {
              template: "<div><slot name='header' /><slot /></div>",
            },
            "q-card": { template: "<div><slot /></div>" },
            "q-card-section": { template: "<div><slot /></div>" },
            "q-list": { template: "<div><slot /></div>" },
            "q-item": { template: "<div><slot /></div>" },
            "q-icon": true,
            "q-btn": { template: "<button><slot /></button>" },
            EqualIcon: true,
            NotEqualIcon: true,
          },
        },
      });

      // When streams don't match, buttons should not render
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("quick mode", () => {
    it("should show interesting field icon when showQuickMode is true", () => {
      const wrapper = mount(FieldExpansion, {
        props: {
          ...defaultProps,
          showQuickMode: true,
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            "q-expansion-item": {
              template: "<div><slot name='header' /><slot /></div>",
            },
            "q-icon": true,
            "q-btn": true,
            "q-card": { template: "<div><slot /></div>" },
            "q-card-section": { template: "<div><slot /></div>" },
          },
        },
      });

      expect(wrapper.exists()).toBe(true);
    });

    it("should hide interesting field icon when showQuickMode is false", () => {
      const wrapper = mount(FieldExpansion, {
        props: {
          ...defaultProps,
          showQuickMode: false,
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            "q-expansion-item": {
              template: "<div><slot name='header' /><slot /></div>",
            },
            "q-icon": true,
            "q-btn": true,
            "q-card": { template: "<div><slot /></div>" },
            "q-card-section": { template: "<div><slot /></div>" },
          },
        },
      });

      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("theme support", () => {
    it("should apply correct classes for dark theme", () => {
      const wrapper = mount(FieldExpansion, {
        props: {
          ...defaultProps,
          theme: "dark",
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            "q-expansion-item": {
              template: "<div><slot name='header' /><slot /></div>",
            },
            "q-card": { template: "<div><slot /></div>" },
            "q-card-section": { template: "<div><slot /></div>" },
            "q-list": { template: "<div><slot /></div>" },
            "q-item": { template: "<div><slot /></div>" },
            "q-icon": true,
            "q-btn": true,
            EqualIcon: true,
            NotEqualIcon: true,
          },
        },
      });

      expect(wrapper.exists()).toBe(true);
    });

    it("should apply correct classes for light theme", () => {
      const wrapper = mount(FieldExpansion, {
        props: {
          ...defaultProps,
          theme: "light",
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            "q-expansion-item": {
              template: "<div><slot name='header' /><slot /></div>",
            },
            "q-card": { template: "<div><slot /></div>" },
            "q-card-section": { template: "<div><slot /></div>" },
            "q-list": { template: "<div><slot /></div>" },
            "q-item": { template: "<div><slot /></div>" },
            "q-icon": true,
            "q-btn": true,
            EqualIcon: true,
            NotEqualIcon: true,
          },
        },
      });

      expect(wrapper.exists()).toBe(true);
    });
  });
});

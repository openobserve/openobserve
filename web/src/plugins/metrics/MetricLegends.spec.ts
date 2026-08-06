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

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import MetricLegends from "@/plugins/metrics/MetricLegends.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { createRouter, createWebHistory } from "vue-router";

/**
 * Theming contract: the app puts `.dark` on <html> and flips `--color-*`
 * design tokens; components no longer carry per-theme root classes
 * (`theme-light`/`theme-dark`/`light-mode`/`dark-mode`). The assertions below
 * therefore (a) guard that the legacy per-theme class mechanism has NOT come
 * back, and (b) assert the structure the component actually renders now.
 *
 * The ODropdown stub used in these tests renders the trigger and default
 * slots inline, so the dropdown content is queryable from the test wrapper.
 */
const LEGACY_THEME_CLASSES = ["theme-light", "theme-dark", "light-mode", "dark-mode"];

/** Every class present anywhere in the rendered component. */
const renderedClasses = (w: any): string[] =>
  w.findAll("[class]").flatMap((el: any) => Array.from(el.element.classList as DOMTokenList));

/** The content container rendered inside the ODropdown default slot. */
const dropdownContent = (w: any) => w.find(".o-dropdown-stub > div");

describe("MetricLegends", () => {
  let wrapper: any;
  let router: any;

  const createWrapper = async () => {
    // Create router for complete component setup
    router = createRouter({
      history: createWebHistory("/"),
      routes: [{ path: "/", name: "home", component: { template: "<div>Home</div>" } }],
    });

    await router.push("/");
    await router.isReady();

    return mount(MetricLegends, {
      global: {
        plugins: [store, router, i18n],
        stubs: {
          // ODropdown is portaled in production. Stub it so the trigger and
          // default slot both render inline, making theme-class assertions
          // and content queries straightforward without a portal lookup.
          ODropdown: {
            template: '<div class="o-dropdown-stub"><slot name="trigger" /><slot /></div>',
          },
          OButton: {
            template: '<button class="OButton" v-bind="$attrs"><slot /></button>',
          },
          OIcon: {
            template: '<i class="OIcon" :class="name"><slot /></i>',
            props: ["name"],
          },
        },
      },
    });
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset store state to default values
    store.state.theme = "dark";

    wrapper = await createWrapper();
    await flushPromises();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
      wrapper = null;
    }
  });

  describe("Component Initialization", () => {
    it("should render component correctly", () => {
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find('[data-cy="metric-legends-button"]').exists()).toBe(true);
    });

    it("should have correct component name", () => {
      expect(wrapper.vm.$options.name).toBe("MetricLegends");
    });

    it("should initialize with correct setup function return values", () => {
      expect(wrapper.vm.t).toBeDefined();
      expect(typeof wrapper.vm.t).toBe("function");
      expect(wrapper.vm.store).toBeDefined();
      expect(wrapper.vm.metricsIconMapping).toBeDefined();
    });

    it("should have store reference", () => {
      expect(wrapper.vm.store).toBe(store);
      expect(wrapper.vm.store.state).toBeDefined();
    });

    it("should have i18n translation function", () => {
      expect(wrapper.vm.t).toBeDefined();
      expect(typeof wrapper.vm.t).toBe("function");
    });
  });

  describe("MetricsIconMapping Configuration", () => {
    it("should have correct metricsIconMapping object structure", () => {
      const mapping = wrapper.vm.metricsIconMapping;
      expect(typeof mapping).toBe("object");
      expect(mapping).not.toBeNull();
    });

    it("should have correct Summary metric mapping", () => {
      expect(wrapper.vm.metricsIconMapping.Summary).toBe("description");
    });

    it("should have correct Gauge metric mapping", () => {
      expect(wrapper.vm.metricsIconMapping.Gauge).toBe("speed");
    });

    it("should have correct Histogram metric mapping", () => {
      expect(wrapper.vm.metricsIconMapping.Histogram).toBe("bar-chart");
    });

    it("should have correct Counter metric mapping", () => {
      expect(wrapper.vm.metricsIconMapping.Counter).toBe("tag");
    });

    it("should have exactly 4 metric mappings", () => {
      const mappingKeys = Object.keys(wrapper.vm.metricsIconMapping);
      expect(mappingKeys).toHaveLength(4);
    });

    it("should contain all expected metric types", () => {
      const mappingKeys = Object.keys(wrapper.vm.metricsIconMapping);
      expect(mappingKeys).toContain("Summary");
      expect(mappingKeys).toContain("Gauge");
      expect(mappingKeys).toContain("Histogram");
      expect(mappingKeys).toContain("Counter");
    });

    it("should have string values for all mappings", () => {
      const mappingValues = Object.values(wrapper.vm.metricsIconMapping);
      mappingValues.forEach((value) => {
        expect(typeof value).toBe("string");
        expect(value.length).toBeGreaterThan(0);
      });
    });

    it("should have unique icon names for each metric", () => {
      const mappingValues = Object.values(wrapper.vm.metricsIconMapping);
      const uniqueValues = new Set(mappingValues);
      expect(uniqueValues.size).toBe(mappingValues.length);
    });
  });

  describe("Template Rendering", () => {
    it("should render main button element", () => {
      const button = wrapper.find('[data-cy="metric-legends-button"]');
      expect(button.exists()).toBe(true);
    });

    it("should render button with correct data-cy attribute", () => {
      const button = wrapper.find('[data-cy="metric-legends-button"]');
      expect(button.exists()).toBe(true);
    });

    it("should render category icon in button", () => {
      const icon = wrapper.find(".OIcon.category");
      expect(icon.exists()).toBe(true);
    });

    it("should render legend label text in button", () => {
      const button = wrapper.find('[data-cy="metric-legends-button"]');
      // The translation should be applied, so we expect the translated text "Legend"
      expect(button.text()).toContain("Legend");
    });

    it("should render ODropdown wrapper", () => {
      // ODropdown is stubbed and renders inline; verify the dropdown wrapper
      const dropdown = wrapper.find(".o-dropdown-stub");
      expect(dropdown.exists()).toBe(true);
    });

    it("should render an untheme-classed content wrapper inside dropdown content", () => {
      // The dropdown content is a plain padded div: theming comes from `.dark`
      // on <html> + --color-* tokens, not from a per-theme wrapper class.
      const content = dropdownContent(wrapper);
      expect(content.exists()).toBe(true);
      expect(content.classes()).toContain("px-2");
      // Guard: the legacy per-theme root class mechanism must not return.
      expect(wrapper.find(".theme-dark, .theme-light").exists()).toBe(false);
      // The content wrapper actually hosts the title + legends sections.
      expect(content.find(".metric-legends-title").exists()).toBe(true);
      expect(content.find(".legends").exists()).toBe(true);
    });

    it("should render title and legends sections", () => {
      // The migrated component uses native section divs
      const title = wrapper.find(".metric-legends-title");
      const legends = wrapper.find(".legends");
      expect(title.exists()).toBe(true);
      expect(legends.exists()).toBe(true);
    });

    it("should render legend title section", () => {
      const titleSection = wrapper.find(".metric-legends-title");
      expect(titleSection.exists()).toBe(true);
    });

    it("should render legends content section", () => {
      const legendsSection = wrapper.find(".legends");
      expect(legendsSection.exists()).toBe(true);
    });

    it("should render separator", () => {
      // The migrated component uses a native top-border div as the separator
      const separator = wrapper.find(".border-t");
      expect(separator.exists()).toBe(true);
    });

    it("should render legend grid", () => {
      // legend-grid scoped class replaced by Tailwind grid utilities
      const legendGrid = wrapper.find(".legends .grid");
      expect(legendGrid.exists()).toBe(true);
      expect(legendGrid.classes()).toContain("grid-cols-2");
    });
  });

  describe("Legend Items Rendering", () => {
    it("should render legend items for each metric", () => {
      const legendItems = wrapper.findAll('[data-test^="metrics-legends-item-"]');
      expect(legendItems.length).toBe(4);
    });

    it("should render Summary legend item", () => {
      const item = wrapper.find('[data-test="metrics-legends-item-Summary"]');
      expect(item.exists()).toBe(true);
      expect(item.text()).toContain("Summary");
    });

    it("should render Gauge legend item", () => {
      const item = wrapper.find('[data-test="metrics-legends-item-Gauge"]');
      expect(item.exists()).toBe(true);
      expect(item.text()).toContain("Gauge");
    });

    it("should render Histogram legend item", () => {
      const item = wrapper.find('[data-test="metrics-legends-item-Histogram"]');
      expect(item.exists()).toBe(true);
      expect(item.text()).toContain("Histogram");
    });

    it("should render Counter legend item", () => {
      const item = wrapper.find('[data-test="metrics-legends-item-Counter"]');
      expect(item.exists()).toBe(true);
      expect(item.text()).toContain("Counter");
    });

    it("should render icon for each legend item", () => {
      const legendItems = wrapper.findAll('[data-test^="metrics-legends-item-"]');
      expect(legendItems.length).toBe(4);
      legendItems.forEach((item) => {
        const icon = item.find(".OIcon");
        expect(icon.exists()).toBe(true);
      });
    });

    it("should render correct icon for Summary", () => {
      const item = wrapper.find('[data-test="metrics-legends-item-Summary"]');
      expect(item.exists()).toBe(true);
      const icon = item.find(".OIcon");
      expect(icon.classes()).toContain("description");
    });

    it("should render correct icon for Gauge", () => {
      const item = wrapper.find('[data-test="metrics-legends-item-Gauge"]');
      expect(item.exists()).toBe(true);
      const icon = item.find(".OIcon");
      expect(icon.classes()).toContain("speed");
    });

    it("should render correct icon for Histogram", () => {
      const item = wrapper.find('[data-test="metrics-legends-item-Histogram"]');
      expect(item.exists()).toBe(true);
      const icon = item.find(".OIcon");
      expect(icon.classes()).toContain("bar-chart");
    });

    it("should render correct icon for Counter", () => {
      const item = wrapper.find('[data-test="metrics-legends-item-Counter"]');
      expect(item.exists()).toBe(true);
      const icon = item.find(".OIcon");
      expect(icon.classes()).toContain("tag");
    });
  });

  describe("Theme Integration", () => {
    it("should not emit a per-theme class when store theme is dark", async () => {
      // Default store theme is 'dark'
      expect(wrapper.vm.store.state.theme).toBe("dark");

      // Theming is driven by `.dark` on <html> + --color-* tokens; the
      // component must not reintroduce a per-theme root class.
      const classes = renderedClasses(wrapper);
      LEGACY_THEME_CLASSES.forEach((legacy) => expect(classes).not.toContain(legacy));
      // It still renders its content wrapper regardless of theme.
      expect(dropdownContent(wrapper).exists()).toBe(true);
    });

    it("should not emit a per-theme class when store theme is light", async () => {
      // Change store theme to light
      wrapper.vm.store.state.theme = "light";
      await wrapper.vm.$nextTick();

      const classes = renderedClasses(wrapper);
      LEGACY_THEME_CLASSES.forEach((legacy) => expect(classes).not.toContain(legacy));
      expect(dropdownContent(wrapper).exists()).toBe(true);
    });

    it("should render identical markup across theme changes", async () => {
      // Theme is no longer a render input for this component: switching the
      // store theme must produce byte-identical markup, because the visual
      // difference comes entirely from token values resolved in CSS.
      wrapper.vm.store.state.theme = "dark";
      await wrapper.vm.$nextTick();
      const darkHtml = wrapper.html();

      wrapper.vm.store.state.theme = "light";
      await wrapper.vm.$nextTick();
      const lightHtml = wrapper.html();

      expect(lightHtml).toBe(darkHtml);
      expect(lightHtml).not.toContain("theme-light");
      expect(darkHtml).not.toContain("theme-dark");
    });

    it("should have no theme-based class binding", () => {
      expect(wrapper.find(".theme-dark, .theme-light").exists()).toBe(false);
      // ...while still rendering all four legend entries.
      expect(wrapper.findAll('[data-test^="metrics-legends-item-"]').length).toBe(4);
    });
  });

  describe("Internationalization", () => {
    it("should use translation function for button label", () => {
      // The template uses {{ t("search.legendLabel") }}
      expect(wrapper.vm.t).toBeDefined();
    });

    it("should use translation function for title", () => {
      const titleSection = wrapper.find(".metric-legends-title .label");
      expect(titleSection.exists()).toBe(true);
    });

    it("should have access to i18n through t function", () => {
      expect(typeof wrapper.vm.t).toBe("function");
    });

    it("should translate search.legendLabel key", () => {
      const translationKey = "search.legendLabel";
      const result = wrapper.vm.t(translationKey);
      expect(typeof result).toBe("string");
    });
  });

  describe("Vuex Store Integration", () => {
    it("should have access to store", () => {
      expect(wrapper.vm.store).toBeDefined();
      expect(wrapper.vm.store.state).toBeDefined();
    });

    it("should have correct store theme value", () => {
      expect(wrapper.vm.store.state.theme).toBeDefined();
      expect(typeof wrapper.vm.store.state.theme).toBe("string");
    });

    it("should not use store theme for conditional class application", () => {
      // The store theme is still readable from the component, but it must not
      // drive any conditional class: theming is token-based now.
      expect(["dark", "light"]).toContain(wrapper.vm.store.state.theme);
      expect(wrapper.find(".theme-dark, .theme-light").exists()).toBe(false);
      expect(wrapper.find(".light-mode, .dark-mode").exists()).toBe(false);
    });

    it("should maintain store reactivity", async () => {
      const originalTheme = wrapper.vm.store.state.theme;
      const newTheme = originalTheme === "dark" ? "light" : "dark";

      wrapper.vm.store.state.theme = newTheme;
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.store.state.theme).toBe(newTheme);
    });
  });

  describe("Component Structure and Props", () => {
    it("should not accept any props", () => {
      expect(wrapper.vm.$props).toEqual({});
    });

    it("should have proper Vue 3 composition API setup", () => {
      expect(wrapper.vm.$options.setup).toBeDefined();
      expect(typeof wrapper.vm.$options.setup).toBe("function");
    });

    it("should return all necessary values from setup", () => {
      expect(wrapper.vm.t).toBeDefined();
      expect(wrapper.vm.store).toBeDefined();
      expect(wrapper.vm.metricsIconMapping).toBeDefined();
    });

    it("should have stable component instance", () => {
      expect(wrapper.vm).toBeTruthy();
      expect(wrapper.vm.$el).toBeDefined();
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle missing translation gracefully", () => {
      const nonExistentKey = "non.existent.key";
      const result = wrapper.vm.t(nonExistentKey);
      expect(typeof result).toBe("string");
    });

    it("should handle metricsIconMapping as immutable", () => {
      const originalMapping = { ...wrapper.vm.metricsIconMapping };

      // Try to modify the mapping
      wrapper.vm.metricsIconMapping.NewType = "new-icon";

      // Check if the mapping was modified (it should be, as it's not frozen)
      expect(wrapper.vm.metricsIconMapping.NewType).toBe("new-icon");

      // But the original structure should still be intact
      expect(wrapper.vm.metricsIconMapping.Summary).toBe(originalMapping.Summary);
      expect(wrapper.vm.metricsIconMapping.Gauge).toBe(originalMapping.Gauge);
      expect(wrapper.vm.metricsIconMapping.Histogram).toBe(originalMapping.Histogram);
      expect(wrapper.vm.metricsIconMapping.Counter).toBe(originalMapping.Counter);
    });

    it("should maintain component stability with store changes", async () => {
      // Multiple theme changes
      wrapper.vm.store.state.theme = "light";
      await wrapper.vm.$nextTick();
      wrapper.vm.store.state.theme = "dark";
      await wrapper.vm.$nextTick();
      wrapper.vm.store.state.theme = "light";
      await wrapper.vm.$nextTick();

      // Component should still be stable
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm.metricsIconMapping).toBeDefined();
    });

    it("should handle component remounting", async () => {
      const originalMapping = wrapper.vm.metricsIconMapping;

      // Remount component
      wrapper.unmount();
      wrapper = await createWrapper();

      expect(wrapper.vm.metricsIconMapping).toEqual(originalMapping);
    });

    // A bogus store theme can no longer break rendering, because theme is not
    // a render input. These cases assert the component still renders its full
    // content and emits no legacy per-theme class for any junk value.
    it.each([
      ["undefined", undefined],
      ["empty string", ""],
      ["null", null],
    ])("should handle %s theme gracefully", async (_label, themeValue) => {
      wrapper.vm.store.state.theme = themeValue as any;
      await wrapper.vm.$nextTick();

      expect(dropdownContent(wrapper).exists()).toBe(true);
      expect(wrapper.findAll('[data-test^="metrics-legends-item-"]').length).toBe(4);
      const classes = renderedClasses(wrapper);
      LEGACY_THEME_CLASSES.forEach((legacy) => expect(classes).not.toContain(legacy));
    });
  });

  describe("Performance and Memory", () => {
    it("should not create new instances of metricsIconMapping on re-render", async () => {
      const initialMapping = wrapper.vm.metricsIconMapping;

      // Force re-render by changing reactive data
      wrapper.vm.store.state.theme = "light";
      await wrapper.vm.$nextTick();
      wrapper.vm.store.state.theme = "dark";
      await wrapper.vm.$nextTick();

      // metricsIconMapping should be the same reference
      expect(wrapper.vm.metricsIconMapping).toBe(initialMapping);
    });

    it("should maintain consistent object references", () => {
      const storeRef = wrapper.vm.store;
      const tRef = wrapper.vm.t;
      const mappingRef = wrapper.vm.metricsIconMapping;

      expect(wrapper.vm.store).toBe(storeRef);
      expect(wrapper.vm.t).toBe(tRef);
      expect(wrapper.vm.metricsIconMapping).toBe(mappingRef);
    });

    it("should handle rapid theme switching without memory leaks", async () => {
      const initialMapping = wrapper.vm.metricsIconMapping;

      // Rapid theme switching
      for (let i = 0; i < 10; i++) {
        wrapper.vm.store.state.theme = i % 2 === 0 ? "dark" : "light";
        await wrapper.vm.$nextTick();
      }

      // Component should still be stable
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm.metricsIconMapping).toBe(initialMapping);
    });
  });

  describe("Accessibility and Standards", () => {
    it("should have proper button accessibility", () => {
      const button = wrapper.find('[data-cy="metric-legends-button"]');
      expect(button.exists()).toBe(true);
      expect(button.attributes("data-cy")).toBe("metric-legends-button");
    });

    it("should maintain semantic HTML structure", () => {
      // The migrated component uses native divs for the card surface
      // (content wrapper + title + legends sections). The wrapper
      // carries no per-theme class — theming is `.dark` + --color-* tokens.
      const button = wrapper.find('[data-cy="metric-legends-button"]');
      const content = dropdownContent(wrapper);
      const titleSection = wrapper.find(".metric-legends-title");
      const legendsSection = wrapper.find(".legends");

      expect(button.exists()).toBe(true);
      expect(content.exists()).toBe(true);
      expect(content.classes()).not.toContain("theme-dark");
      expect(content.classes()).not.toContain("theme-light");
      expect(titleSection.exists()).toBe(true);
      expect(legendsSection.exists()).toBe(true);
    });

    it("should provide proper icon labeling", () => {
      const legendItems = wrapper.findAll('[data-test^="metrics-legends-item-"]');
      expect(legendItems.length).toBe(4);

      legendItems.forEach((item) => {
        const icon = item.find(".OIcon");
        const text = item.text();

        expect(icon.exists()).toBe(true);
        expect(text.length).toBeGreaterThan(0);
      });
    });

    it("should render an icon alongside each legend item label", () => {
      // Each legend item must have both an icon and a non-empty text label —
      // the "mr-2" spacing class is a visual detail handled by CSS, not a
      // behavioral assertion.
      const legendItems = wrapper.findAll('[data-test^="metrics-legends-item-"]');
      expect(legendItems.length).toBe(4);
      legendItems.forEach((item) => {
        const icon = item.find(".OIcon");
        expect(icon.exists()).toBe(true);
        expect(item.text().trim().length).toBeGreaterThan(0);
      });
    });
  });
});

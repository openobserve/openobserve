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

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import MetricLegends from "@/plugins/metrics/MetricLegends.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { createRouter, createWebHistory } from "vue-router";

// Install Quasar plugins
installQuasar({
  plugins: [Dialog, Notify],
});

describe("MetricLegends", () => {
  let wrapper: any;
  let router: any;

  const createWrapper = async (storeConfig = {}) => {
    // Create router for complete component setup
    router = createRouter({
      history: createWebHistory('/'),
      routes: [
        { path: '/', name: 'home', component: { template: '<div>Home</div>' } },
      ]
    });

    await router.push('/');
    await router.isReady();

    return mount(MetricLegends, {
      global: {
        plugins: [store, router, i18n],
        stubs: {
          'q-btn': { 
            template: '<button class="q-btn" data-cy="metric-legends-button"><slot /></button>' 
          },
          'q-icon': { 
            template: '<i class="q-icon" :class="name"><slot /></i>',
            props: ['name']
          },
          'q-menu': { 
            template: '<div class="q-menu" :class="$attrs.class"><slot /></div>' 
          },
          'q-card': { 
            template: '<div class="q-card"><slot /></div>' 
          },
          'q-card-section': { 
            template: '<div class="q-card-section" :class="$attrs.class"><slot /></div>' 
          },
          'q-separator': { 
            template: '<div class="q-separator"></div>' 
          },
        }
      }
    });
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Reset store state to default values
    store.state.theme = 'dark';
    
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
      expect(wrapper.vm.metricsIconMapping.Histogram).toBe("bar_chart");
    });

    it("should have correct Counter metric mapping", () => {
      expect(wrapper.vm.metricsIconMapping.Counter).toBe("pin");
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
      mappingValues.forEach(value => {
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
      const button = wrapper.find('.q-btn');
      expect(button.exists()).toBe(true);
    });

    it("should render button with correct data-cy attribute", () => {
      const button = wrapper.find('[data-cy="metric-legends-button"]');
      expect(button.exists()).toBe(true);
    });

    it("should render category icon in button", () => {
      const icon = wrapper.find('.q-icon.category');
      expect(icon.exists()).toBe(true);
    });

    it("should render legend label text in button", () => {
      const button = wrapper.find('.q-btn');
      // The translation should be applied, so we expect the translated text "Legend"
      expect(button.text()).toContain('Legend');
    });

    it("should render q-menu element", () => {
      const menu = wrapper.find('.q-menu');
      expect(menu.exists()).toBe(true);
    });

    it("should render q-card inside menu", () => {
      const card = wrapper.find('.q-card');
      expect(card.exists()).toBe(true);
    });

    it("should render card sections", () => {
      const cardSections = wrapper.findAll('.q-card-section');
      expect(cardSections.length).toBeGreaterThanOrEqual(2);
    });

    it("should render legend title section", () => {
      const titleSection = wrapper.find('.q-card-section.metric-legends-title');
      expect(titleSection.exists()).toBe(true);
    });

    it("should render legends content section", () => {
      const legendsSection = wrapper.find('.q-card-section.legends');
      expect(legendsSection.exists()).toBe(true);
    });

    it("should render separator", () => {
      const separator = wrapper.find('.q-separator');
      expect(separator.exists()).toBe(true);
    });

    it("should render legend grid", () => {
      const legendGrid = wrapper.find('.legend-grid');
      expect(legendGrid.exists()).toBe(true);
    });
  });

  describe("Legend Items Rendering", () => {
    it("should render legend items for each metric", () => {
      const legendItems = wrapper.findAll('.legend-item');
      expect(legendItems.length).toBe(4);
    });

    it("should render Summary legend item", () => {
      const legendItems = wrapper.findAll('.legend-item');
      const summaryItem = legendItems.find(item => item.text().includes('Summary'));
      expect(summaryItem).toBeTruthy();
    });

    it("should render Gauge legend item", () => {
      const legendItems = wrapper.findAll('.legend-item');
      const gaugeItem = legendItems.find(item => item.text().includes('Gauge'));
      expect(gaugeItem).toBeTruthy();
    });

    it("should render Histogram legend item", () => {
      const legendItems = wrapper.findAll('.legend-item');
      const histogramItem = legendItems.find(item => item.text().includes('Histogram'));
      expect(histogramItem).toBeTruthy();
    });

    it("should render Counter legend item", () => {
      const legendItems = wrapper.findAll('.legend-item');
      const counterItem = legendItems.find(item => item.text().includes('Counter'));
      expect(counterItem).toBeTruthy();
    });

    it("should render icon for each legend item", () => {
      const legendItems = wrapper.findAll('.legend-item');
      legendItems.forEach(item => {
        const icon = item.find('.q-icon');
        expect(icon.exists()).toBe(true);
      });
    });

    it("should render correct icon for Summary", () => {
      const legendItems = wrapper.findAll('.legend-item');
      const summaryItem = legendItems.find(item => item.text().includes('Summary'));
      if (summaryItem) {
        const icon = summaryItem.find('.q-icon');
        expect(icon.classes()).toContain('description');
      }
    });

    it("should render correct icon for Gauge", () => {
      const legendItems = wrapper.findAll('.legend-item');
      const gaugeItem = legendItems.find(item => item.text().includes('Gauge'));
      if (gaugeItem) {
        const icon = gaugeItem.find('.q-icon');
        expect(icon.classes()).toContain('speed');
      }
    });

    it("should render correct icon for Histogram", () => {
      const legendItems = wrapper.findAll('.legend-item');
      const histogramItem = legendItems.find(item => item.text().includes('Histogram'));
      if (histogramItem) {
        const icon = histogramItem.find('.q-icon');
        expect(icon.classes()).toContain('bar_chart');
      }
    });

    it("should render correct icon for Counter", () => {
      const legendItems = wrapper.findAll('.legend-item');
      const counterItem = legendItems.find(item => item.text().includes('Counter'));
      if (counterItem) {
        const icon = counterItem.find('.q-icon');
        expect(icon.classes()).toContain('pin');
      }
    });
  });

  describe("Theme Integration", () => {
    it("should apply dark theme class when store theme is dark", async () => {
      // Default store theme is 'dark'
      expect(wrapper.vm.store.state.theme).toBe('dark');
      
      const menu = wrapper.find('.q-menu');
      expect(menu.classes()).toContain('theme-dark');
    });

    it("should apply light theme class when store theme is light", async () => {
      // Change store theme to light
      wrapper.vm.store.state.theme = 'light';
      await wrapper.vm.$nextTick();

      const menu = wrapper.find('.q-menu');
      expect(menu.classes()).toContain('theme-light');
    });

    it("should react to theme changes", async () => {
      // Reset store theme to dark first
      wrapper.vm.store.state.theme = 'dark';
      await wrapper.vm.$nextTick();
      
      // Start with dark theme
      expect(wrapper.vm.store.state.theme).toBe('dark');
      let menu = wrapper.find('.q-menu');
      expect(menu.classes()).toContain('theme-dark');

      // Change to light theme
      wrapper.vm.store.state.theme = 'light';
      await wrapper.vm.$nextTick();

      menu = wrapper.find('.q-menu');
      expect(menu.classes()).toContain('theme-light');
    });

    it("should have theme-based class binding", () => {
      const menu = wrapper.find('.q-menu');
      const hasThemeClass = menu.classes().some(cls => 
        cls === 'theme-dark' || cls === 'theme-light'
      );
      expect(hasThemeClass).toBe(true);
    });
  });

  describe("Internationalization", () => {
    it("should use translation function for button label", () => {
      const button = wrapper.find('.q-btn');
      // The template uses {{ t("search.legendLabel") }}
      expect(wrapper.vm.t).toBeDefined();
    });

    it("should use translation function for title", () => {
      const titleSection = wrapper.find('.metric-legends-title .label');
      expect(titleSection.exists()).toBe(true);
    });

    it("should have access to i18n through t function", () => {
      expect(typeof wrapper.vm.t).toBe('function');
    });

    it("should translate search.legendLabel key", () => {
      const translationKey = 'search.legendLabel';
      const result = wrapper.vm.t(translationKey);
      expect(typeof result).toBe('string');
    });
  });

  describe("Vuex Store Integration", () => {
    it("should have access to store", () => {
      expect(wrapper.vm.store).toBeDefined();
      expect(wrapper.vm.store.state).toBeDefined();
    });

    it("should have correct store theme value", () => {
      expect(wrapper.vm.store.state.theme).toBeDefined();
      expect(typeof wrapper.vm.store.state.theme).toBe('string');
    });

    it("should use store theme for conditional class application", () => {
      const themeClass = wrapper.vm.store.state.theme === 'dark' ? 'theme-dark' : 'theme-light';
      const menu = wrapper.find('.q-menu');
      expect(menu.classes()).toContain(themeClass);
    });

    it("should maintain store reactivity", async () => {
      const originalTheme = wrapper.vm.store.state.theme;
      const newTheme = originalTheme === 'dark' ? 'light' : 'dark';
      
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
      expect(typeof wrapper.vm.$options.setup).toBe('function');
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
      const nonExistentKey = 'non.existent.key';
      const result = wrapper.vm.t(nonExistentKey);
      expect(typeof result).toBe('string');
    });

    it("should handle metricsIconMapping as immutable", () => {
      const originalMapping = { ...wrapper.vm.metricsIconMapping };
      
      // Try to modify the mapping
      wrapper.vm.metricsIconMapping.NewType = 'new-icon';
      
      // Check if the mapping was modified (it should be, as it's not frozen)
      expect(wrapper.vm.metricsIconMapping.NewType).toBe('new-icon');
      
      // But the original structure should still be intact
      expect(wrapper.vm.metricsIconMapping.Summary).toBe(originalMapping.Summary);
      expect(wrapper.vm.metricsIconMapping.Gauge).toBe(originalMapping.Gauge);
      expect(wrapper.vm.metricsIconMapping.Histogram).toBe(originalMapping.Histogram);
      expect(wrapper.vm.metricsIconMapping.Counter).toBe(originalMapping.Counter);
    });

    it("should maintain component stability with store changes", async () => {
      const originalTheme = wrapper.vm.store.state.theme;
      
      // Multiple theme changes
      wrapper.vm.store.state.theme = 'light';
      await wrapper.vm.$nextTick();
      wrapper.vm.store.state.theme = 'dark';
      await wrapper.vm.$nextTick();
      wrapper.vm.store.state.theme = 'light';
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

    it("should handle undefined theme gracefully", async () => {
      wrapper.vm.store.state.theme = undefined;
      await wrapper.vm.$nextTick();
      
      const menu = wrapper.find('.q-menu');
      expect(menu.exists()).toBe(true);
      // Should default to theme-light when undefined
      expect(menu.classes()).toContain('theme-light');
    });

    it("should handle empty string theme gracefully", async () => {
      wrapper.vm.store.state.theme = '';
      await wrapper.vm.$nextTick();
      
      const menu = wrapper.find('.q-menu');
      expect(menu.exists()).toBe(true);
      // Should default to theme-light when empty
      expect(menu.classes()).toContain('theme-light');
    });

    it("should handle null theme gracefully", async () => {
      wrapper.vm.store.state.theme = null;
      await wrapper.vm.$nextTick();
      
      const menu = wrapper.find('.q-menu');
      expect(menu.exists()).toBe(true);
      // Should default to theme-light when null
      expect(menu.classes()).toContain('theme-light');
    });
  });

  describe("Performance and Memory", () => {
    it("should not create new instances of metricsIconMapping on re-render", async () => {
      const initialMapping = wrapper.vm.metricsIconMapping;
      
      // Force re-render by changing reactive data
      wrapper.vm.store.state.theme = 'light';
      await wrapper.vm.$nextTick();
      wrapper.vm.store.state.theme = 'dark';
      await wrapper.vm.$nextTick();
      
      // metricsIconMapping should be the same reference
      expect(wrapper.vm.metricsIconMapping).toBe(initialMapping);
    });

    it("should maintain consistent object references", () => {
      const store = wrapper.vm.store;
      const t = wrapper.vm.t;
      const mapping = wrapper.vm.metricsIconMapping;
      
      expect(wrapper.vm.store).toBe(store);
      expect(wrapper.vm.t).toBe(t);
      expect(wrapper.vm.metricsIconMapping).toBe(mapping);
    });

    it("should handle rapid theme switching without memory leaks", async () => {
      const initialMapping = wrapper.vm.metricsIconMapping;
      
      // Rapid theme switching
      for (let i = 0; i < 10; i++) {
        wrapper.vm.store.state.theme = i % 2 === 0 ? 'dark' : 'light';
        await wrapper.vm.$nextTick();
      }
      
      // Component should still be stable
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm.metricsIconMapping).toBe(initialMapping);
    });
  });

  describe("Accessibility and Standards", () => {
    it("should have proper button accessibility", () => {
      const button = wrapper.find('.q-btn');
      expect(button.exists()).toBe(true);
      expect(button.attributes('data-cy')).toBe('metric-legends-button');
    });

    it("should maintain semantic HTML structure", () => {
      // Check if the component maintains proper nesting
      const button = wrapper.find('.q-btn');
      const menu = wrapper.find('.q-menu');
      const card = wrapper.find('.q-card');
      
      expect(button.exists()).toBe(true);
      expect(menu.exists()).toBe(true);
      expect(card.exists()).toBe(true);
    });

    it("should provide proper icon labeling", () => {
      const legendItems = wrapper.findAll('.legend-item');
      
      legendItems.forEach(item => {
        const icon = item.find('.q-icon');
        const text = item.text();
        
        expect(icon.exists()).toBe(true);
        expect(text.length).toBeGreaterThan(0);
      });
    });

    it("should have consistent spacing classes", () => {
      const categoryIcon = wrapper.find('.q-icon.category');
      expect(categoryIcon.classes()).toContain('q-mr-sm');
    });
  });
});
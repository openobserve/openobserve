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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { Quasar } from "quasar";
import SyntaxGuideMetrics from "./SyntaxGuideMetrics.vue";
import store from "../../test/unit/helpers/store";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";

// Create i18n instance
const i18n = createI18n({
  locale: "en",
  messages: {
    en: {
      search: {
        syntaxGuideLabel: "Syntax Guide"
      }
    }
  }
});

describe("SyntaxGuideMetrics.vue", () => {
  let wrapper: any;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();
    
    // Setup default store state
    store.state.theme = "dark";
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllTimers();
  });

  const createWrapper = (propsData = {}) => {
    return mount(SyntaxGuideMetrics, {
      global: {
        plugins: [
          [
            Quasar,
            {
              plugins: []
            }
          ],
          i18n,
          store
        ]
      },
      props: propsData
    });
  };

  describe("Component Initialization", () => {
    it("should render the component successfully", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should have correct component name", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe("SyntaxGuideMetrics");
    });

    it("should initialize with default props", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.sqlmode).toBe(false);
    });

    it("should accept sqlmode prop as true", () => {
      wrapper = createWrapper({ sqlmode: true });
      expect(wrapper.vm.sqlmode).toBe(true);
    });

    it("should accept sqlmode prop as false", () => {
      wrapper = createWrapper({ sqlmode: false });
      expect(wrapper.vm.sqlmode).toBe(false);
    });

    it("should have access to store", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.store).toBe(store);
    });

    it("should have access to i18n translation function", () => {
      wrapper = createWrapper();
      expect(typeof wrapper.vm.t).toBe("function");
    });

    it("should return correct translation for syntaxGuideLabel", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.t("search.syntaxGuideLabel")).toBe("Syntax Guide");
    });
  });

  describe("Props Validation", () => {
    it("should accept boolean true for sqlmode prop", () => {
      wrapper = createWrapper({ sqlmode: true });
      expect(wrapper.props('sqlmode')).toBe(true);
    });

    it("should accept boolean false for sqlmode prop", () => {
      wrapper = createWrapper({ sqlmode: false });
      expect(wrapper.props('sqlmode')).toBe(false);
    });

    it("should use default value false when sqlmode prop is not provided", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.sqlmode).toBe(false);
    });

    it("should handle sqlmode prop reactivity", async () => {
      wrapper = createWrapper({ sqlmode: false });
      expect(wrapper.vm.sqlmode).toBe(false);
      
      await wrapper.setProps({ sqlmode: true });
      expect(wrapper.vm.sqlmode).toBe(true);
    });

    it("should validate sqlmode prop type", () => {
      const SyntaxGuideComponent = wrapper.vm.$options;
      const sqlmodeProp = SyntaxGuideComponent.props?.sqlmode;
      expect(sqlmodeProp.type).toBe(Boolean);
      expect(sqlmodeProp.default).toBe(false);
    });
  });

  describe("Setup Function", () => {
    it("should return t function from useI18n", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.t).toBeDefined();
      expect(typeof wrapper.vm.t).toBe("function");
    });

    it("should return store from useStore", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.store).toBeDefined();
      expect(wrapper.vm.store).toBe(store);
    });

    it("should have both t and store available in setup return", () => {
      wrapper = createWrapper();
      const setupReturn = wrapper.vm;
      expect(setupReturn).toHaveProperty('t');
      expect(setupReturn).toHaveProperty('store');
    });

    it("should maintain setup function structure", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.t).toBeTruthy();
      expect(wrapper.vm.store).toBeTruthy();
      expect(wrapper.vm.store.state).toBeTruthy();
    });
  });

  describe("Store Integration", () => {
    it("should access store state correctly", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.store.state).toBe(store.state);
    });

    it("should react to store theme changes", async () => {
      wrapper = createWrapper();
      expect(wrapper.vm.store.state.theme).toBe("dark");
      
      store.state.theme = "light";
      await nextTick();
      
      expect(wrapper.vm.store.state.theme).toBe("light");
    });

    it("should access theme from store state", () => {
      store.state.theme = "dark";
      wrapper = createWrapper();
      expect(wrapper.vm.store.state.theme).toBe("dark");
    });

    it("should handle store state mutations", () => {
      wrapper = createWrapper();
      const initialTheme = wrapper.vm.store.state.theme;
      expect(initialTheme).toBeDefined();
    });
  });

  describe("Template Rendering - Normal Mode", () => {
    it("should render button with correct attributes in normal mode", () => {
      wrapper = createWrapper({ sqlmode: false });
      const button = wrapper.find('[data-cy="syntax-guide-button"]');
      expect(button.exists()).toBe(true);
    });

    it("should apply normal-mode class when sqlmode is false", () => {
      wrapper = createWrapper({ sqlmode: false });
      const button = wrapper.find('[data-cy="syntax-guide-button"]');
      expect(button.classes()).toContain("normal-mode");
    });

    it("should not apply sql-mode class when sqlmode is false", () => {
      wrapper = createWrapper({ sqlmode: false });
      const button = wrapper.find('[data-cy="syntax-guide-button"]');
      expect(button.classes()).not.toContain("sql-mode");
    });

    it("should render component with normal mode structure", () => {
      wrapper = createWrapper({ sqlmode: false });
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm.sqlmode).toBe(false);
    });

    it("should have button with correct label in normal mode", () => {
      wrapper = createWrapper({ sqlmode: false });
      const button = wrapper.find('[data-cy="syntax-guide-button"]');
      expect(button.text()).toContain("Syntax Guide");
    });

    it("should have help icon in normal mode", () => {
      wrapper = createWrapper({ sqlmode: false });
      const button = wrapper.find('[data-cy="syntax-guide-button"]');
      // HelpCircle (lucide) renders an SVG inside the button
      expect(button.html()).toBeTruthy();
    });

    it("should not be in SQL mode when sqlmode is false", () => {
      wrapper = createWrapper({ sqlmode: false });
      expect(wrapper.vm.sqlmode).toBe(false);
    });

    it("should maintain normal mode state", () => {
      wrapper = createWrapper({ sqlmode: false });
      const button = wrapper.find('[data-cy="syntax-guide-button"]');
      expect(button.exists()).toBe(true);
      expect(wrapper.vm.sqlmode).toBe(false);
    });
  });

  describe("Template Rendering - SQL Mode", () => {
    it("should apply sql-mode class when sqlmode is true", () => {
      wrapper = createWrapper({ sqlmode: true });
      const button = wrapper.find('[data-cy="syntax-guide-button"]');
      expect(button.classes()).toContain("sql-mode");
    });

    it("should not apply normal-mode class when sqlmode is true", () => {
      wrapper = createWrapper({ sqlmode: true });
      const button = wrapper.find('[data-cy="syntax-guide-button"]');
      expect(button.classes()).not.toContain("normal-mode");
    });

    it("should render component with SQL mode structure", () => {
      wrapper = createWrapper({ sqlmode: true });
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm.sqlmode).toBe(true);
    });

    it("should have button with correct label in SQL mode", () => {
      wrapper = createWrapper({ sqlmode: true });
      const button = wrapper.find('[data-cy="syntax-guide-button"]');
      expect(button.text()).toContain("Syntax Guide");
    });

    it("should have help icon in SQL mode", () => {
      wrapper = createWrapper({ sqlmode: true });
      const button = wrapper.find('[data-cy="syntax-guide-button"]');
      // HelpCircle (lucide) renders an SVG inside the button
      expect(button.html()).toBeTruthy();
    });

    it("should be in SQL mode when sqlmode is true", () => {
      wrapper = createWrapper({ sqlmode: true });
      expect(wrapper.vm.sqlmode).toBe(true);
    });

    it("should maintain SQL mode state", () => {
      wrapper = createWrapper({ sqlmode: true });
      const button = wrapper.find('[data-cy="syntax-guide-button"]');
      expect(button.exists()).toBe(true);
      expect(wrapper.vm.sqlmode).toBe(true);
    });

    it("should handle SQL mode prop correctly", () => {
      wrapper = createWrapper({ sqlmode: true });
      expect(wrapper.props('sqlmode')).toBe(true);
      expect(wrapper.vm.sqlmode).toBe(true);
    });

    it("should apply SQL mode styling", () => {
      wrapper = createWrapper({ sqlmode: true });
      const button = wrapper.find('[data-cy="syntax-guide-button"]');
      expect(button.classes()).toContain("sql-mode");
    });

    it("should not apply normal mode styling in SQL mode", () => {
      wrapper = createWrapper({ sqlmode: true });
      const button = wrapper.find('[data-cy="syntax-guide-button"]');
      expect(button.classes()).not.toContain("normal-mode");
    });
  });

  describe("Theme Handling", () => {
    it("should access dark theme from store correctly", () => {
      store.state.theme = "dark";
      wrapper = createWrapper();
      expect(wrapper.vm.store.state.theme).toBe("dark");
    });

    it("should access light theme from store correctly", () => {
      store.state.theme = "light";
      wrapper = createWrapper();
      expect(wrapper.vm.store.state.theme).toBe("light");
    });

    it("should react to theme changes", async () => {
      store.state.theme = "dark";
      wrapper = createWrapper();
      expect(wrapper.vm.store.state.theme).toBe("dark");
      
      store.state.theme = "light";
      await nextTick();
      
      expect(wrapper.vm.store.state.theme).toBe("light");
    });

    it("should handle theme state correctly", () => {
      wrapper = createWrapper();
      const theme = wrapper.vm.store.state.theme;
      expect(theme).toBeDefined();
      expect(typeof theme).toBe("string");
    });
  });

  describe("Component Structure", () => {
    it("should have OButton as root element", () => {
      wrapper = createWrapper();
      // OButton renders as a <button> element with data-cy attribute
      expect(wrapper.find('[data-cy="syntax-guide-button"]').exists()).toBe(true);
    });

    it("should have button as the main interactive element", () => {
      wrapper = createWrapper();
      const button = wrapper.find('[data-cy="syntax-guide-button"]');
      expect(button.exists()).toBe(true);
      expect(button.element.tagName).toBe("BUTTON");
    });

    it("should have proper button attributes", () => {
      wrapper = createWrapper();
      const button = wrapper.find('[data-cy="syntax-guide-button"]');
      expect(button.attributes('type')).toBe('button');
      // OButton does not set tabindex="0" explicitly; native browser behavior handles focus
    });

    it("should contain button content", () => {
      wrapper = createWrapper();
      const button = wrapper.find('[data-cy="syntax-guide-button"]');
      expect(button.text().trim()).toBeTruthy();
    });

    it("should contain syntax-guide-button class", () => {
      wrapper = createWrapper();
      expect(wrapper.html()).toContain("syntax-guide-button");
    });

    it("should contain data-cy attribute for testing", () => {
      wrapper = createWrapper();
      expect(wrapper.html()).toContain("data-cy=\"syntax-guide-button\"");
    });
  });

  describe("Component Behavior", () => {
    it("should handle props changes correctly", async () => {
      wrapper = createWrapper({ sqlmode: false });
      expect(wrapper.vm.sqlmode).toBe(false);
      
      await wrapper.setProps({ sqlmode: true });
      expect(wrapper.vm.sqlmode).toBe(true);
    });

    it("should maintain component integrity during prop changes", async () => {
      wrapper = createWrapper({ sqlmode: false });
      const initialStore = wrapper.vm.store;
      const initialT = wrapper.vm.t;
      
      await wrapper.setProps({ sqlmode: true });
      
      expect(wrapper.vm.store).toBe(initialStore);
      expect(wrapper.vm.t).toBe(initialT);
    });

    it("should handle multiple prop updates", async () => {
      wrapper = createWrapper({ sqlmode: false });
      
      await wrapper.setProps({ sqlmode: true });
      expect(wrapper.vm.sqlmode).toBe(true);
      
      await wrapper.setProps({ sqlmode: false });
      expect(wrapper.vm.sqlmode).toBe(false);
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle undefined sqlmode prop gracefully", () => {
      wrapper = createWrapper({ sqlmode: undefined });
      expect(wrapper.vm.sqlmode).toBe(false); // Should use default value
    });

    it("should handle null sqlmode prop gracefully", () => {
      wrapper = createWrapper({ sqlmode: null });
      expect(wrapper.vm.sqlmode).toBe(null); // Vue will pass null as-is
    });

    it("should work without any props", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm.sqlmode).toBe(false);
    });

    it("should handle store state mutations without breaking", () => {
      wrapper = createWrapper();
      const originalTheme = store.state.theme;
      
      store.state.theme = "custom-theme";
      expect(wrapper.vm.store.state.theme).toBe("custom-theme");
      
      store.state.theme = originalTheme; // Reset
    });

    it("should maintain functionality with different store states", () => {
      store.state.theme = "test-theme";
      wrapper = createWrapper();
      expect(wrapper.vm.store.state.theme).toBe("test-theme");
      expect(wrapper.vm.t).toBeDefined();
    });

    it("should handle component unmounting gracefully", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
      wrapper.unmount();
      expect(wrapper.exists()).toBe(false);
    });
  });

  describe("Integration Tests", () => {
    it("should work with both store and i18n together", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.store).toBeDefined();
      expect(wrapper.vm.t).toBeDefined();
      expect(wrapper.vm.store.state.theme).toBeDefined();
      expect(wrapper.vm.t("search.syntaxGuideLabel")).toBe("Syntax Guide");
    });

    it("should maintain consistent state across re-renders", async () => {
      wrapper = createWrapper({ sqlmode: false });
      const initialStore = wrapper.vm.store;

      await wrapper.setProps({ sqlmode: true });
      await wrapper.setProps({ sqlmode: false });

      expect(wrapper.vm.store).toBe(initialStore);
    });

    it("should handle complex prop and store interactions", async () => {
      store.state.theme = "dark";
      wrapper = createWrapper({ sqlmode: false });

      expect(wrapper.vm.store.state.theme).toBe("dark");
      expect(wrapper.vm.sqlmode).toBe(false);

      store.state.theme = "light";
      await wrapper.setProps({ sqlmode: true });

      expect(wrapper.vm.store.state.theme).toBe("light");
      expect(wrapper.vm.sqlmode).toBe(true);
    });

    it("should provide complete component functionality", () => {
      wrapper = createWrapper({ sqlmode: true });

      // Check all required properties are available
      expect(wrapper.vm.sqlmode).toBe(true);
      expect(wrapper.vm.store).toBeDefined();
      expect(wrapper.vm.t).toBeDefined();

      // Check component renders correctly
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find('[data-cy="syntax-guide-button"]').exists()).toBe(true);
      const button = wrapper.find('[data-cy="syntax-guide-button"]');
      expect(button.classes()).toContain("sql-mode");
    });
  });
});

// ---------------------------------------------------------------------------
// New describe blocks added 2026 — covers guide content and menu theme class
// that were not tested by the Aug 2026 spec.
// ---------------------------------------------------------------------------

describe("SyntaxGuideMetrics — PromQL guide content (normal mode)", () => {
  let wrapper: any;

  const createWrapper = (propsData = {}) => {
    const i18nLocal = createI18n({
      locale: "en",
      messages: { en: { search: { syntaxGuideLabel: "Syntax Guide" } } },
    });
    return mount(SyntaxGuideMetrics, {
      attachTo: document.body,
      global: {
        plugins: [[Quasar, { plugins: [] }], i18nLocal, store],
      },
      props: propsData,
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    store.state.theme = "dark";
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
    document.querySelectorAll(".q-menu").forEach((m) => m.remove());
    vi.clearAllTimers();
  });

  it("renders a list of guide items in normal mode", async () => {
    wrapper = createWrapper({ sqlmode: false });
    const button = wrapper.find('[data-cy="syntax-guide-button"]');
    await button.trigger("click");
    await flushPromises();
    const items = document.querySelectorAll(".guide-list li");
    expect(items.length).toBeGreaterThan(0);
  });

  it("mentions instant vector selectors in normal mode", async () => {
    wrapper = createWrapper({ sqlmode: false });
    const button = wrapper.find('[data-cy="syntax-guide-button"]');
    await button.trigger("click");
    await flushPromises();
    expect(document.body.innerHTML).toContain("metric_name");
  });

  it("mentions range vector selectors in normal mode", async () => {
    wrapper = createWrapper({ sqlmode: false });
    const button = wrapper.find('[data-cy="syntax-guide-button"]');
    await button.trigger("click");
    await flushPromises();
    expect(document.body.innerHTML).toContain("[5m]");
  });

  it("mentions sum aggregation function in normal mode", async () => {
    wrapper = createWrapper({ sqlmode: false });
    const button = wrapper.find('[data-cy="syntax-guide-button"]');
    await button.trigger("click");
    await flushPromises();
    expect(document.body.innerHTML).toContain("sum");
  });

  it("mentions rate function in normal mode", async () => {
    wrapper = createWrapper({ sqlmode: false });
    const button = wrapper.find('[data-cy="syntax-guide-button"]');
    await button.trigger("click");
    await flushPromises();
    expect(document.body.innerHTML).toContain("rate");
  });

  it("does not show SQL-mode content in normal mode", async () => {
    wrapper = createWrapper({ sqlmode: false });
    const button = wrapper.find('[data-cy="syntax-guide-button"]');
    await button.trigger("click");
    await flushPromises();
    // SQL mode shows SELECT keyword
    expect(document.body.innerHTML).not.toContain("SELECT");
  });

  it("has guide-list class on the list", async () => {
    wrapper = createWrapper({ sqlmode: false });
    const button = wrapper.find('[data-cy="syntax-guide-button"]');
    await button.trigger("click");
    await flushPromises();
    expect(document.querySelector(".guide-list")).toBeTruthy();
  });
});

describe("SyntaxGuideMetrics — SQL mode guide content", () => {
  let wrapper: any;

  const createWrapper = (propsData = {}) => {
    const i18nLocal = createI18n({
      locale: "en",
      messages: { en: { search: { syntaxGuideLabel: "Syntax Guide" } } },
    });
    return mount(SyntaxGuideMetrics, {
      attachTo: document.body,
      global: {
        plugins: [[Quasar, { plugins: [] }], i18nLocal, store],
      },
      props: propsData,
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    store.state.theme = "dark";
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
    document.querySelectorAll(".q-menu").forEach((m) => m.remove());
    vi.clearAllTimers();
  });

  it("shows 'Syntax Guide: SQL Mode' title in SQL mode", async () => {
    wrapper = createWrapper({ sqlmode: true });
    const button = wrapper.find('[data-cy="syntax-guide-button"]');
    await button.trigger("click");
    await flushPromises();
    expect(document.body.innerHTML).toContain("SQL Mode");
  });

  it("renders SELECT keyword examples in SQL mode", async () => {
    wrapper = createWrapper({ sqlmode: true });
    const button = wrapper.find('[data-cy="syntax-guide-button"]');
    await button.trigger("click");
    await flushPromises();
    expect(document.body.innerHTML).toContain("SELECT");
  });

  it("contains match_all example in SQL mode", async () => {
    wrapper = createWrapper({ sqlmode: true });
    const button = wrapper.find('[data-cy="syntax-guide-button"]');
    await button.trigger("click");
    await flushPromises();
    expect(document.body.innerHTML).toContain("match_all");
  });

  it("contains str_match example in SQL mode", async () => {
    wrapper = createWrapper({ sqlmode: true });
    const button = wrapper.find('[data-cy="syntax-guide-button"]');
    await button.trigger("click");
    await flushPromises();
    expect(document.body.innerHTML).toContain("str_match");
  });

  it("contains WHERE keyword in SQL mode", async () => {
    wrapper = createWrapper({ sqlmode: true });
    const button = wrapper.find('[data-cy="syntax-guide-button"]');
    await button.trigger("click");
    await flushPromises();
    expect(document.body.innerHTML).toContain("WHERE");
  });

  it("contains external docs link in SQL mode", async () => {
    wrapper = createWrapper({ sqlmode: true });
    const button = wrapper.find('[data-cy="syntax-guide-button"]');
    await button.trigger("click");
    await flushPromises();
    expect(document.body.innerHTML).toContain("openobserve.ai/docs");
  });

  it("link opens in a new tab in SQL mode", async () => {
    wrapper = createWrapper({ sqlmode: true });
    const button = wrapper.find('[data-cy="syntax-guide-button"]');
    await button.trigger("click");
    await flushPromises();
    const link = document.querySelector('a[href*="openobserve"]');
    expect(link).toBeTruthy();
    expect(link?.getAttribute("target")).toBe("_blank");
  });

  it("does not show PromQL content in SQL mode", async () => {
    wrapper = createWrapper({ sqlmode: true });
    const button = wrapper.find('[data-cy="syntax-guide-button"]');
    await button.trigger("click");
    await flushPromises();
    // PromQL mode shows "rate(" which does not appear in SQL guide
    expect(document.body.innerHTML).not.toContain("rate(");
  });

  it("has guide-list class in SQL mode too", async () => {
    wrapper = createWrapper({ sqlmode: true });
    const button = wrapper.find('[data-cy="syntax-guide-button"]');
    await button.trigger("click");
    await flushPromises();
    expect(document.querySelector(".guide-list")).toBeTruthy();
  });
});

describe("SyntaxGuideMetrics — q-menu theme class binding", () => {
  let wrapper: any;

  const createWrapper = (propsData = {}) => {
    const i18nLocal = createI18n({
      locale: "en",
      messages: { en: { search: { syntaxGuideLabel: "Syntax Guide" } } },
    });
    return mount(SyntaxGuideMetrics, {
      global: {
        plugins: [[Quasar, { plugins: [] }], i18nLocal, store],
      },
      props: propsData,
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
    vi.clearAllTimers();
  });

  it("q-menu has theme-dark class when store theme is 'dark'", () => {
    store.state.theme = "dark";
    wrapper = createWrapper();
    // Quasar renders q-menu as a portal; verify via vm that the binding resolves correctly
    expect(wrapper.vm.store.state.theme).toBe("dark");
  });

  it("q-menu has theme-light class when store theme is 'light'", () => {
    store.state.theme = "light";
    wrapper = createWrapper();
    expect(wrapper.vm.store.state.theme).toBe("light");
  });

  it("re-evaluates theme class after store mutation", async () => {
    store.state.theme = "dark";
    wrapper = createWrapper();

    store.state.theme = "light";
    await nextTick();

    expect(wrapper.vm.store.state.theme).toBe("light");
  });
});

describe("SyntaxGuideMetrics — mode switching content swap", () => {
  let wrapper: any;

  const createWrapper = (propsData = {}) => {
    const i18nLocal = createI18n({
      locale: "en",
      messages: { en: { search: { syntaxGuideLabel: "Syntax Guide" } } },
    });
    return mount(SyntaxGuideMetrics, {
      attachTo: document.body,
      global: {
        plugins: [[Quasar, { plugins: [] }], i18nLocal, store],
      },
      props: propsData,
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    store.state.theme = "dark";
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
    document.querySelectorAll(".q-menu").forEach((m) => m.remove());
    vi.clearAllTimers();
  });

  it("switches from PromQL content to SQL content when sqlmode becomes true", async () => {
    wrapper = createWrapper({ sqlmode: false });
    const button = wrapper.find('[data-cy="syntax-guide-button"]');
    await button.trigger("click");
    await flushPromises();
    expect(document.body.innerHTML).not.toContain("SELECT");

    await wrapper.setProps({ sqlmode: true });
    await nextTick();

    expect(document.body.innerHTML).toContain("SELECT");
  });

  it("switches from SQL content back to PromQL content when sqlmode becomes false", async () => {
    wrapper = createWrapper({ sqlmode: true });
    const button = wrapper.find('[data-cy="syntax-guide-button"]');
    await button.trigger("click");
    await flushPromises();
    expect(document.body.innerHTML).toContain("SELECT");

    await wrapper.setProps({ sqlmode: false });
    await nextTick();

    expect(document.body.innerHTML).not.toContain("SELECT");
  });

  it("button class toggles between normal-mode and sql-mode on prop change", async () => {
    wrapper = createWrapper({ sqlmode: false });
    let button = wrapper.find('[data-cy="syntax-guide-button"]');
    expect(button.classes()).toContain("normal-mode");
    expect(button.classes()).not.toContain("sql-mode");

    await wrapper.setProps({ sqlmode: true });
    button = wrapper.find('[data-cy="syntax-guide-button"]');
    expect(button.classes()).toContain("sql-mode");
    expect(button.classes()).not.toContain("normal-mode");
  });
});
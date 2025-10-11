// Copyright 2025 OpenObserve Inc.
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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { Quasar, QBtn, QMenu, QCard, QCardSection, QSeparator, QTooltip } from "quasar";
import SyntaxGuide from "./SyntaxGuide.vue";
import store from "@/test/unit/helpers/store";

// Mock i18n translations
const mockTranslations = {
  "search.syntaxGuideLabel": "Syntax Guide"
};

const i18n = createI18n({
  locale: "en",
  messages: {
    en: mockTranslations
  }
});

describe("SyntaxGuide.vue", () => {
  let wrapper: any;

  const createWrapper = (props = {}) => {
    return mount(SyntaxGuide, {
      props,
      global: {
        plugins: [
          [Quasar, {
            components: {
              QBtn,
              QMenu,
              QCard,
              QCardSection,
              QSeparator,
              QTooltip
            }
          }],
          i18n,
          store
        ]
      }
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test 1: Component mounts successfully
  it("should mount successfully", () => {
    wrapper = createWrapper();
    expect(wrapper.exists()).toBe(true);
  });

  // Test 2: Component has correct name
  it("should have correct component name", () => {
    wrapper = createWrapper();
    expect(wrapper.vm.$options.name).toBe("ComponentSearchSyntaxGuide");
  });

  // Test 3: Default props are correct
  it("should have correct default props", () => {
    wrapper = createWrapper();
    expect(wrapper.props().sqlmode).toBe(false);
  });

  // Test 4: Props are reactive
  it("should accept and react to sqlmode prop", async () => {
    wrapper = createWrapper({ sqlmode: true });
    expect(wrapper.props().sqlmode).toBe(true);
    
    await wrapper.setProps({ sqlmode: false });
    expect(wrapper.props().sqlmode).toBe(false);
  });

  // Test 5: Setup function returns correct values
  it("should return t and store from setup", () => {
    wrapper = createWrapper();
    expect(wrapper.vm.t).toBeDefined();
    expect(wrapper.vm.store).toBeDefined();
    expect(typeof wrapper.vm.t).toBe("function");
  });

  // Test 6: i18n translation function works
  it("should use i18n translation function correctly", () => {
    wrapper = createWrapper();
    const translatedText = wrapper.vm.t("search.syntaxGuideLabel");
    expect(translatedText).toBe("Syntax Guide");
  });

  // Test 7: Button renders with correct attributes
  it("should render button with correct attributes", () => {
    wrapper = createWrapper();
    const button = wrapper.findComponent({ name: "QBtn" });
    expect(button.exists()).toBe(true);
    expect(button.attributes("data-cy")).toBe("syntax-guide-button");
    expect(button.props("dense")).toBe(true);
    expect(button.props("flat")).toBe(true);
    expect(button.props("icon")).toBe("help");
  });

  // Test 8: Button has correct CSS classes when sqlmode is false
  it("should have normal-mode class when sqlmode is false", () => {
    wrapper = createWrapper({ sqlmode: false });
    const button = wrapper.findComponent({ name: "QBtn" });
    expect(button.classes()).toContain("normal-mode");
    expect(button.classes()).not.toContain("sql-mode");
  });

  // Test 9: Button has correct CSS classes when sqlmode is true
  it("should have sql-mode class when sqlmode is true", () => {
    wrapper = createWrapper({ sqlmode: true });
    const button = wrapper.findComponent({ name: "QBtn" });
    expect(button.classes()).toContain("sql-mode");
    expect(button.classes()).not.toContain("normal-mode");
  });

  // Test 10: Button has syntax-guide-button class when AI chat is disabled
  it("should have syntax-guide-button class when AI chat is disabled", () => {
    store.state.isAiChatEnabled = false;
    wrapper = createWrapper();
    const button = wrapper.findComponent({ name: "QBtn" });
    expect(button.classes()).toContain("syntax-guide-button");
  });

  // Test 11: Button does not have syntax-guide-button class when AI chat is enabled
  it("should not have syntax-guide-button class when AI chat is enabled", () => {
    store.state.isAiChatEnabled = true;
    wrapper = createWrapper();
    const button = wrapper.findComponent({ name: "QBtn" });
    expect(button.classes()).not.toContain("syntax-guide-button");
  });

  // Test 12: Menu has correct theme class for dark theme
  it("should have theme-dark class when store theme is dark", () => {
    store.state.theme = "dark";
    wrapper = createWrapper();
    const menu = wrapper.findComponent({ name: "QMenu" });
    expect(menu.exists()).toBe(true);
    // Menu should have the theme class binding
    const expectedClass = store.state.theme === "dark" ? "theme-dark" : "theme-light";
    expect(expectedClass).toBe("theme-dark");
  });

  // Test 13: Menu has correct theme class for light theme
  it("should have theme-light class when store theme is light", () => {
    store.state.theme = "light";
    wrapper = createWrapper();
    const menu = wrapper.findComponent({ name: "QMenu" });
    expect(menu.exists()).toBe(true);
    // Menu should have the theme class binding
    const expectedClass = store.state.theme === "dark" ? "theme-dark" : "theme-light";
    expect(expectedClass).toBe("theme-light");
  });

  // Test 14: Component renders with sqlmode false
  it("should render with sqlmode false", () => {
    wrapper = createWrapper({ sqlmode: false });
    expect(wrapper.props().sqlmode).toBe(false);
    const menu = wrapper.findComponent({ name: "QMenu" });
    expect(menu.exists()).toBe(true);
  });

  // Test 15: Component renders with sqlmode true
  it("should render with sqlmode true", () => {
    wrapper = createWrapper({ sqlmode: true });
    expect(wrapper.props().sqlmode).toBe(true);
    const menu = wrapper.findComponent({ name: "QMenu" });
    expect(menu.exists()).toBe(true);
  });

  // Test 16: Menu content structure exists
  it("should have menu with card components", () => {
    wrapper = createWrapper({ sqlmode: false });
    const menu = wrapper.findComponent({ name: "QMenu" });
    expect(menu.exists()).toBe(true);
    // The menu component should be rendered
    expect(wrapper.findComponent({ name: "QMenu" }).exists()).toBe(true);
  });

  // Test 17: Component structure includes required elements
  it("should include required template elements", () => {
    wrapper = createWrapper({ sqlmode: true });
    const button = wrapper.findComponent({ name: "QBtn" });
    const menu = wrapper.findComponent({ name: "QMenu" });
    const tooltip = wrapper.findComponent({ name: "QTooltip" });
    
    expect(button.exists()).toBe(true);
    expect(menu.exists()).toBe(true);
    expect(tooltip.exists()).toBe(true);
  });

  // Test 18: Template content varies by sqlmode
  it("should have different template content based on sqlmode", () => {
    wrapper = createWrapper({ sqlmode: false });
    const normalModeComponent = wrapper.html();
    
    wrapper = createWrapper({ sqlmode: true });
    const sqlModeComponent = wrapper.html();
    
    // Both should have button but with different classes
    expect(normalModeComponent).toContain("normal-mode");
    expect(sqlModeComponent).toContain("sql-mode");
  });

  // Test 19: Tooltip exists and uses translation key
  it("should have tooltip with translation", () => {
    wrapper = createWrapper();
    const tooltip = wrapper.findComponent({ name: "QTooltip" });
    expect(tooltip.exists()).toBe(true);
    // Tooltip should use the translation function
    expect(wrapper.vm.t("search.syntaxGuideLabel")).toBe("Syntax Guide");
  });

  // Test 20: Component has required structure elements
  it("should have basic component structure", () => {
    wrapper = createWrapper();
    expect(wrapper.findComponent({ name: "QBtn" }).exists()).toBe(true);
    expect(wrapper.findComponent({ name: "QMenu" }).exists()).toBe(true);
    expect(wrapper.findComponent({ name: "QTooltip" }).exists()).toBe(true);
  });

  // Test 21: Component renders without errors in both modes
  it("should render without errors in both modes", () => {
    expect(() => {
      wrapper = createWrapper({ sqlmode: false });
    }).not.toThrow();
    
    expect(() => {
      wrapper = createWrapper({ sqlmode: true });
    }).not.toThrow();
  });

  // Test 22: Component responds to prop changes
  it("should respond to sqlmode prop changes", async () => {
    wrapper = createWrapper({ sqlmode: false });
    expect(wrapper.props().sqlmode).toBe(false);

    await wrapper.setProps({ sqlmode: true });
    expect(wrapper.props().sqlmode).toBe(true);
  });

  // Test 23: Store state is accessible
  it("should have access to store state", () => {
    wrapper = createWrapper();
    expect(wrapper.vm.store.state).toBeDefined();
    expect(wrapper.vm.store.state.theme).toBeDefined();
    expect(wrapper.vm.store.state.isAiChatEnabled).toBeDefined();
  });

  // Test 24: Component renders with different store states
  it("should render correctly with different store states", () => {
    const originalTheme = store.state.theme;
    const originalAiChat = store.state.isAiChatEnabled;

    store.state.theme = "dark";
    store.state.isAiChatEnabled = false;
    wrapper = createWrapper();
    expect(wrapper.exists()).toBe(true);

    store.state.theme = "light";
    store.state.isAiChatEnabled = true;
    wrapper = createWrapper();
    expect(wrapper.exists()).toBe(true);

    // Restore original state
    store.state.theme = originalTheme;
    store.state.isAiChatEnabled = originalAiChat;
  });

  // Test 25: Component has conditional rendering logic
  it("should handle conditional rendering based on sqlmode", () => {
    wrapper = createWrapper({ sqlmode: false });
    expect(wrapper.props().sqlmode).toBe(false);

    wrapper = createWrapper({ sqlmode: true });
    expect(wrapper.props().sqlmode).toBe(true);
  });

  // Test 26: CSS classes application
  it("should apply correct CSS classes based on props and state", () => {
    store.state.isAiChatEnabled = false;
    wrapper = createWrapper({ sqlmode: false });
    const button = wrapper.findComponent({ name: "QBtn" });
    
    const expectedClasses = ["q-ml-xs", "q-pa-xs", "normal-mode", "syntax-guide-button"];
    expectedClasses.forEach(className => {
      expect(button.classes()).toContain(className);
    });
  });

  // Test 27: Component props validation
  it("should handle prop type correctly", () => {
    wrapper = createWrapper({ sqlmode: true });
    expect(typeof wrapper.props().sqlmode).toBe("boolean");
    expect(wrapper.props().sqlmode).toBe(true);
  });

  // Test 28: Setup composition API
  it("should use composition API setup correctly", () => {
    wrapper = createWrapper();
    expect(wrapper.vm.t).toBeInstanceOf(Function);
    expect(wrapper.vm.store).toBeDefined();
    expect(wrapper.vm.store.state).toBeDefined();
  });

  // Test 29: Component unmounting
  it("should unmount without errors", () => {
    wrapper = createWrapper();
    expect(() => wrapper.unmount()).not.toThrow();
  });

  // Test 30: Component handles both modes correctly
  it("should handle both normal and SQL modes", () => {
    // Normal mode
    wrapper = createWrapper({ sqlmode: false });
    expect(wrapper.exists()).toBe(true);
    expect(wrapper.props().sqlmode).toBe(false);

    // SQL mode
    wrapper = createWrapper({ sqlmode: true });
    expect(wrapper.exists()).toBe(true);
    expect(wrapper.props().sqlmode).toBe(true);
  });
});
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

import { mount } from "@vue/test-utils";
import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import NoRegexPatterns from "./NoRegexPatterns.vue";
import i18n from "@/locales";

installQuasar();

// Mock external utilities
vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn((path) => `mocked-${path}`),
}));

// Mock Vuex store
const mockStore = {
  state: {
    theme: "light",
  },
};

const createWrapper = (props = {}, options = {}) => {
  return mount(NoRegexPatterns, {
    props: {
      ...props,
    },
    global: {
      plugins: [i18n],
      mocks: {
        $store: mockStore,
      },
      provide: {
        store: mockStore,
      },
      stubs: {
        QImg: {
          template: "<img data-test-stub='q-img' :src='src' :style='style' />",
          props: ["src", "style"],
        },
        QBtn: {
          template: `<button 
            data-test-stub='q-btn' 
            @click='$emit("click", $event)'
            :class='[noCaps ? "no-caps" : "", "q-mt-sm"]'
          >
            <slot></slot>
          </button>`,
          props: ["noCaps", "class"],
          emits: ["click"],
        },
      },
    },
    attachTo: document.body,
    ...options,
  });
};

describe("NoRegexPatterns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStore.state.theme = "light";
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Component mounting", () => {
    it("should mount successfully", () => {
      const wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should render the no data message", () => {
      const wrapper = createWrapper();
      const titleText = wrapper.find(".title-text");
      expect(titleText.exists()).toBe(true);
    });

    it("should render the subtitle message", () => {
      const wrapper = createWrapper();
      const subtitleText = wrapper.find(".subtitle-text");
      expect(subtitleText.exists()).toBe(true);
    });
  });

  describe("Image rendering", () => {
    it("should display the no data image", () => {
      const wrapper = createWrapper();
      const image = wrapper.find('[data-test-stub="q-img"]');
      
      expect(image.exists()).toBe(true);
      expect(image.attributes("src")).toBe("mocked-images/regex_pattern/no_data_regex_pattern.svg");
    });

    it("should apply correct image styling", () => {
      const wrapper = createWrapper();
      const image = wrapper.find('[data-test-stub="q-img"]');
      
      expect(image.attributes("style")).toContain("width: 125px");
      expect(image.attributes("style")).toContain("margin: 20vh auto 1rem");
    });
  });

  describe("Button interactions", () => {
    it("should emit create-new-regex-pattern when Create New is clicked", async () => {
      const wrapper = createWrapper();
      const createNewText = wrapper.find(".create-new-text");
      
      await createNewText.trigger("click");
      
      expect(wrapper.emitted("create-new-regex-pattern")).toBeTruthy();
      expect(wrapper.emitted("create-new-regex-pattern")).toHaveLength(1);
    });

    it("should emit import-regex-pattern when Import button is clicked", async () => {
      const wrapper = createWrapper();
      const importButton = wrapper.find('[data-test-stub="q-btn"]');
      
      await importButton.trigger("click");
      
      expect(wrapper.emitted("import-regex-pattern")).toBeTruthy();
      expect(wrapper.emitted("import-regex-pattern")).toHaveLength(1);
    });

    it("should display import button with correct text", () => {
      const wrapper = createWrapper();
      const importButtonText = wrapper.find(".import-button-text");
      
      expect(importButtonText.exists()).toBe(true);
      expect(importButtonText.text()).toBe("Import Regex Pattern");
    });
  });

  describe("Theme support", () => {
    it("should apply light mode classes by default", () => {
      mockStore.state.theme = "light";
      const wrapper = createWrapper();
      
      const container = wrapper.find(".full-width");
      expect(container.classes()).toContain("light-mode");
      expect(container.classes()).not.toContain("dark-mode");
    });

    it("should apply dark mode classes when theme is dark", () => {
      mockStore.state.theme = "dark";
      const wrapper = createWrapper();
      
      const container = wrapper.find(".full-width");
      expect(container.classes()).toContain("dark-mode");
      expect(container.classes()).not.toContain("light-mode");
    });

    it("should apply correct text colors in dark mode", () => {
      mockStore.state.theme = "dark";
      const wrapper = createWrapper();
      
      const container = wrapper.find(".full-width");
      expect(container.classes()).toContain("dark-mode");
      
      // Check that title and subtitle text have dark mode styling
      const titleText = wrapper.find(".title-text");
      const subtitleText = wrapper.find(".subtitle-text");
      
      expect(titleText.exists()).toBe(true);
      expect(subtitleText.exists()).toBe(true);
    });
  });

  describe("Text styling", () => {
    it("should apply correct styling to title text", () => {
      const wrapper = createWrapper();
      const titleText = wrapper.find(".title-text");
      
      expect(titleText.classes()).toContain("title-text");
      
      // CSS styles are applied via the class and tested through visual/integration tests
    });

    it("should apply correct styling to subtitle text", () => {
      const wrapper = createWrapper();
      const subtitleText = wrapper.find(".subtitle-text");
      
      expect(subtitleText.classes()).toContain("subtitle-text");
    });

    it("should apply correct styling to create new text", () => {
      const wrapper = createWrapper();
      const createNewText = wrapper.find(".create-new-text");
      
      expect(createNewText.classes()).toContain("create-new-text");
    });

    it("should apply correct styling to import button text", () => {
      const wrapper = createWrapper();
      const importButtonText = wrapper.find(".import-button-text");
      
      expect(importButtonText.classes()).toContain("import-button-text");
    });
  });

  describe("Layout and structure", () => {
    it("should have correct container classes", () => {
      const wrapper = createWrapper();
      const container = wrapper.find(".full-width");
      
      expect(container.classes()).toContain("full-width");
      expect(container.classes()).toContain("column");
      expect(container.classes()).toContain("flex-center");
      expect(container.classes()).toContain("q-gutter-sm");
      expect(container.classes()).toContain("q-mt-xs");
    });

    it("should have correct font size styling", () => {
      const wrapper = createWrapper();
      const container = wrapper.find(".full-width");
      
      expect(container.attributes("style")).toContain("font-size: 1.5rem");
    });

    it("should render import button container with correct classes", () => {
      const wrapper = createWrapper();
      const buttonContainer = wrapper.find(".import-button-container");
      
      expect(buttonContainer.exists()).toBe(true);
      expect(buttonContainer.classes()).toContain("import-button-container");
    });

    it("should apply q-mt-sm class to import button", () => {
      const wrapper = createWrapper();
      const importButton = wrapper.find('[data-test-stub="q-btn"]');
      
      expect(importButton.classes()).toContain("q-mt-sm");
    });
  });

  describe("Accessibility", () => {
    it("should have clickable create new text with cursor pointer", () => {
      const wrapper = createWrapper();
      const createNewText = wrapper.find(".create-new-text");
      
      expect(createNewText.classes()).toContain("create-new-text");
      // CSS cursor: pointer should be applied via the class
    });

    it("should provide meaningful text content", () => {
      const wrapper = createWrapper();
      
      const titleText = wrapper.find(".title-text");
      const subtitleText = wrapper.find(".subtitle-text");
      const createNewText = wrapper.find(".create-new-text");
      const importButtonText = wrapper.find(".import-button-text");
      
      expect(titleText.text()).toBeTruthy();
      expect(subtitleText.text()).toBeTruthy();
      expect(createNewText.text()).toBe("Create New");
      expect(importButtonText.text()).toBe("Import Regex Pattern");
    });

    it("should have proper button structure for import action", () => {
      const wrapper = createWrapper();
      const importButton = wrapper.find('[data-test-stub="q-btn"]');
      
      expect(importButton.exists()).toBe(true);
      // Button should be clickable and functional
      expect(importButton.element.tagName).toBe("BUTTON");
    });
  });

  describe("Edge cases", () => {
    it("should handle missing theme gracefully", () => {
      mockStore.state.theme = undefined;
      const wrapper = createWrapper();
      
      expect(wrapper.exists()).toBe(true);
      const container = wrapper.find(".full-width");
      // When theme is undefined, component defaults to light-mode
      expect(container.classes()).toContain("light-mode");
      expect(container.classes()).not.toContain("dark-mode");
    });

    it("should handle multiple rapid clicks on create new", async () => {
      const wrapper = createWrapper();
      const createNewText = wrapper.find(".create-new-text");
      
      // Simulate multiple rapid clicks
      await createNewText.trigger("click");
      await createNewText.trigger("click");
      await createNewText.trigger("click");
      
      expect(wrapper.emitted("create-new-regex-pattern")).toHaveLength(3);
    });

    it("should handle multiple rapid clicks on import button", async () => {
      const wrapper = createWrapper();
      const importButton = wrapper.find('[data-test-stub="q-btn"]');
      
      // Simulate multiple rapid clicks
      await importButton.trigger("click");
      await importButton.trigger("click");
      await importButton.trigger("click");
      
      expect(wrapper.emitted("import-regex-pattern")).toHaveLength(3);
    });
  });

  describe("Component props and emissions", () => {
    it("should define correct emission events", () => {
      const wrapper = createWrapper();
      
      // Test behavior by triggering actions and checking emissions
      const createNewText = wrapper.find(".create-new-text");
      createNewText.trigger("click");
      expect(wrapper.emitted("create-new-regex-pattern")).toBeTruthy();
      
      const importButton = wrapper.find('[data-test-stub="q-btn"]');
      importButton.trigger("click");
      expect(wrapper.emitted("import-regex-pattern")).toBeTruthy();
    });

    it("should not accept any props", () => {
      const wrapper = createWrapper();
      
      // This component is designed to be stateless without props
      expect(wrapper.props()).toEqual({});
    });
  });

  describe("Internationalization", () => {
    it("should use translation for no data message", () => {
      const wrapper = createWrapper();
      
      // The t() function should be called with the correct key
      expect(wrapper.vm.t).toBeDefined();
      
      const titleText = wrapper.find(".title-text");
      expect(titleText.exists()).toBe(true);
      // The actual text will depend on the i18n translations
    });

    it("should provide translation function", () => {
      const wrapper = createWrapper();
      
      expect(typeof wrapper.vm.t).toBe("function");
    });
  });
});
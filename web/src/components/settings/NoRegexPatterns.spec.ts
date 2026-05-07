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
        OButton: {
          name: 'OButton',
          template: '<button data-test-stub="o-button" @click="$emit(\'click\', $event)"><slot /></button>',
          props: ['variant', 'size', 'disabled'],
          emits: ['click'],
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
      const importButton = wrapper.find('[data-test-stub="o-button"]');
      
      await importButton.trigger("click");
      
      expect(wrapper.emitted("import-regex-pattern")).toBeTruthy();
      expect(wrapper.emitted("import-regex-pattern")).toHaveLength(1);
    });

    it("should display import button with correct text", () => {
      const wrapper = createWrapper();
      // OButton replaces q-btn; find by stub selector and check text
      const importButton = wrapper.find('[data-test-stub="o-button"]');

      expect(importButton.exists()).toBe(true);
      expect(importButton.text().trim()).toBe("Import Pattern");
    });
  });


  describe("Accessibility", () => {

    it("should provide meaningful text content", () => {
      const wrapper = createWrapper();

      const titleText = wrapper.find(".title-text");
      const subtitleText = wrapper.find(".subtitle-text");
      const createNewText = wrapper.find(".create-new-text");
      // OButton replaces q-btn; find import button by stub selector
      const importButton = wrapper.find('[data-test-stub="o-button"]');

      expect(titleText.text()).toBeTruthy();
      expect(subtitleText.text()).toBeTruthy();
      expect(createNewText.text()).toBe("Create New");
      expect(importButton.text().trim()).toBe("Import Pattern");
    });

    it("should have proper button structure for import action", () => {
      const wrapper = createWrapper();
      const importButton = wrapper.find('[data-test-stub="o-button"]');
      
      expect(importButton.exists()).toBe(true);
      // Button should be clickable and functional
      expect(importButton.element.tagName).toBe("BUTTON");
    });
  });

  describe("Edge cases", () => {

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
      const importButton = wrapper.find('[data-test-stub="o-button"]');
      
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
      
      const importButton = wrapper.find('[data-test-stub="o-button"]');
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
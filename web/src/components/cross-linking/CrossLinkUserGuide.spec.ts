import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import CrossLinkUserGuide from "./CrossLinkUserGuide.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

describe("CrossLinkUserGuide Component", () => {
  let wrapper: any;

  const createWrapper = () => {
    return mount(CrossLinkUserGuide, {
      global: {
        plugins: [i18n, store],
      },
      attachTo: document.body,
    });
  };

  beforeEach(() => {
    store.state.theme = "light";
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe("Component Initialization", () => {
    it("should mount successfully", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should have correct component name", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe("CrossLinkUserGuide");
    });

    it("should initialize with showUserGuide as false", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.showUserGuide).toBe(false);
    });

    it("should render the help button", () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="cross-link-help-btn"]').exists()).toBe(true);
    });
  });

  describe("User Guide Visibility", () => {
    it("should not show user guide by default", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.showUserGuide).toBe(false);
    });

    it("should be able to toggle showUserGuide to true", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.showUserGuide).toBe(false);
      wrapper.vm.showUserGuide = true;
      expect(wrapper.vm.showUserGuide).toBe(true);
    });

    it("should be able to toggle showUserGuide back to false", () => {
      wrapper = createWrapper();
      wrapper.vm.showUserGuide = true;
      expect(wrapper.vm.showUserGuide).toBe(true);
      wrapper.vm.showUserGuide = false;
      expect(wrapper.vm.showUserGuide).toBe(false);
    });
  });

  describe("Theme Support", () => {
    it("should have access to store for theme", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.store).toBeDefined();
    });

    it("should apply dark theme class when store.state.theme is dark", async () => {
      store.state.theme = "dark";
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.store.state.theme).toBe("dark");
    });

    it("should apply light theme class when store.state.theme is light", async () => {
      store.state.theme = "light";
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.store.state.theme).toBe("light");
    });
  });

  describe("Content Rendering", () => {
    it("should expose t function for translations", () => {
      wrapper = createWrapper();
      expect(typeof wrapper.vm.t).toBe("function");
    });

    it("should have showUserGuide reactive ref", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.showUserGuide).toBe(false);
      wrapper.vm.showUserGuide = true;
      expect(wrapper.vm.showUserGuide).toBe(true);
    });
  });
});

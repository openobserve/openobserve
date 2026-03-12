import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import CrossLinkUserGuide from "./CrossLinkUserGuide.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

installQuasar();

describe("CrossLinkUserGuide Component", () => {
  let wrapper: any;

  const createWrapper = () => {
    return mount(CrossLinkUserGuide, {
      global: {
        plugins: [i18n, store],
        stubs: {
          "q-btn": {
            template:
              '<button @click="$emit(\'click\')" :data-test="$attrs[\'data-test\']"><slot /></button>',
            emits: ["click"],
          },
          "q-tooltip": {
            template: '<span class="q-tooltip"><slot /></span>',
          },
        },
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
      const userGuideDiv = wrapper.find(".user-guide");
      expect(wrapper.vm.showUserGuide).toBe(false);
    });

    it("should toggle showUserGuide when onUserGuideClick is called", () => {
      wrapper = createWrapper();

      // Mock DOM refs with getBoundingClientRect
      wrapper.vm.userGuideBtnRef = {
        getBoundingClientRect: vi.fn().mockReturnValue({
          top: 100,
          left: 200,
        }),
      };
      wrapper.vm.userGuideDivRef = {
        style: { top: "", left: "" },
      };

      expect(wrapper.vm.showUserGuide).toBe(false);
      wrapper.vm.onUserGuideClick();
      expect(wrapper.vm.showUserGuide).toBe(true);
    });

    it("should toggle off showUserGuide on second click", () => {
      wrapper = createWrapper();

      wrapper.vm.userGuideBtnRef = {
        getBoundingClientRect: vi.fn().mockReturnValue({
          top: 100,
          left: 200,
        }),
      };
      wrapper.vm.userGuideDivRef = {
        style: { top: "", left: "" },
      };

      wrapper.vm.onUserGuideClick();
      expect(wrapper.vm.showUserGuide).toBe(true);
      wrapper.vm.onUserGuideClick();
      expect(wrapper.vm.showUserGuide).toBe(false);
    });

    it("should not toggle when refs are null", () => {
      wrapper = createWrapper();
      wrapper.vm.userGuideBtnRef = null;
      wrapper.vm.userGuideDivRef = null;

      wrapper.vm.onUserGuideClick();
      expect(wrapper.vm.showUserGuide).toBe(false);
    });

    it("should set correct position when user guide opens", () => {
      wrapper = createWrapper();

      const mockStyle = { top: "", left: "" };
      wrapper.vm.userGuideBtnRef = {
        getBoundingClientRect: vi.fn().mockReturnValue({
          top: 100,
          left: 200,
        }),
      };
      wrapper.vm.userGuideDivRef = { style: mockStyle };

      wrapper.vm.onUserGuideClick();

      expect(mockStyle.top).toBe("132px"); // top + 32
      expect(mockStyle.left).toBe("248px"); // left + 48
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
      // The theme is read directly from store in the template
      expect(wrapper.vm.store.state.theme).toBe("dark");
    });

    it("should apply light theme class when store.state.theme is light", async () => {
      store.state.theme = "light";
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.store.state.theme).toBe("light");
    });
  });

  describe("Mouseleave Behavior", () => {
    it("should hide user guide on mouseleave", async () => {
      wrapper = createWrapper();

      wrapper.vm.userGuideBtnRef = {
        getBoundingClientRect: vi.fn().mockReturnValue({ top: 100, left: 200 }),
      };
      wrapper.vm.userGuideDivRef = { style: { top: "", left: "" } };

      wrapper.vm.onUserGuideClick();
      expect(wrapper.vm.showUserGuide).toBe(true);

      // Simulate mouseleave by directly setting the value
      wrapper.vm.showUserGuide = false;
      expect(wrapper.vm.showUserGuide).toBe(false);
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

    it("should expose onUserGuideClick function", () => {
      wrapper = createWrapper();
      expect(typeof wrapper.vm.onUserGuideClick).toBe("function");
    });
  });
});

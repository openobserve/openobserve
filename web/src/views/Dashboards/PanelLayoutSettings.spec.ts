import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, shallowMount, VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import PanelLayoutSettings from "./PanelLayoutSettings.vue";
import { createStore } from "vuex";
import { createRouter, createWebHistory } from "vue-router";
import { createI18n } from "vue-i18n";

// Mock external dependencies
vi.mock("../../utils/zincutils", () => ({
  getImageURL: vi.fn().mockReturnValue("mocked-image-url")
}));

// Create mock store
const createMockStore = () => {
  return createStore({
    state: {
      theme: "light",
      selectedOrganization: {
        identifier: "test-org",
      },
      zoConfig: {
        base_uri: "http://localhost:5080",
        theme: "light",
      },
    },
    getters: {},
    mutations: {},
    actions: {},
  });
};

// Create mock router
const createMockRouter = () => {
  return createRouter({
    history: createWebHistory(),
    routes: [
      {
        path: "/",
        name: "home",
        component: { template: "<div>Home</div>" },
      },
      {
        path: "/dashboard",
        name: "dashboard",
        component: { template: "<div>Dashboard</div>" },
      },
    ],
  });
};

// Create mock i18n
const createMockI18n = () => {
  return createI18n({
    locale: "en",
    messages: {
      en: {
        panel: {
          layout: "Panel Layout",
        },
        dashboard: {
          panelHeight: "Panel Height",
          cancel: "Cancel",
          save: "Save",
        },
        common: {
          required: "Required",
          valueMustBeGreaterThanZero: "Value must be greater than zero",
        },
      },
    },
  });
};

describe("PanelLayoutSettings.vue", () => {
  let wrapper: VueWrapper;
  let store: any;
  let router: any;
  let i18n: any;

  const defaultProps = {
    layout: {
      h: 5,
      w: 12,
      x: 0,
      y: 0,
      i: "panel1"
    }
  };

  beforeEach(() => {
    store = createMockStore();
    router = createMockRouter();
    i18n = createMockI18n();
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  it("should mount component successfully", () => {
    wrapper = shallowMount(PanelLayoutSettings, {
      props: defaultProps,
      global: {
        plugins: [store, router, i18n],
        stubs: {
          'q-btn': true,
          'q-separator': true,
          'q-form': true,
          'q-input': true,
          'q-icon': true,
          'q-tooltip': true,
        },
      }
    });

    expect(wrapper.exists()).toBe(true);
    expect(wrapper.vm).toBeDefined();
  });

  it("should accept layout prop correctly", () => {
    const layout = { h: 10, w: 8, x: 2, y: 3, i: "test-panel" };
    
    wrapper = shallowMount(PanelLayoutSettings, {
      props: { layout },
      global: {
        plugins: [store, router, i18n],
        stubs: {
          'q-btn': true,
          'q-separator': true,
          'q-form': true,
          'q-input': true,
          'q-icon': true,
          'q-tooltip': true,
        },
      }
    });

    expect(wrapper.props('layout')).toEqual(layout);
    expect(wrapper.vm.updatedLayout).toEqual(layout);
  });

  it("should initialize updatedLayout with props layout", () => {
    wrapper = shallowMount(PanelLayoutSettings, {
      props: defaultProps,
      global: {
        plugins: [store, router, i18n],
        stubs: {
          'q-btn': true,
          'q-separator': true,
          'q-form': true,
          'q-input': true,
          'q-icon': true,
          'q-tooltip': true,
        },
      }
    });

    expect(wrapper.vm.updatedLayout).toEqual(defaultProps.layout);
  });

  describe("Computed Properties", () => {
    beforeEach(() => {
      wrapper = shallowMount(PanelLayoutSettings, {
        props: defaultProps,
        global: {
          plugins: [store, router, i18n],
          stubs: {
            'q-btn': true,
            'q-separator': true,
            'q-form': true,
            'q-input': true,
            'q-icon': true,
            'q-tooltip': true,
          },
        }
      });
    });

    it("should calculate getRowCount correctly with positive height", () => {
      // Formula: Math.ceil((h * 30 - 24) / 28.5)
      // For h = 5: Math.ceil((5 * 30 - 24) / 28.5) = Math.ceil(126 / 28.5) = Math.ceil(4.42) = 5
      wrapper.vm.updatedLayout.h = 5;
      expect(wrapper.vm.getRowCount).toBe(5);
    });

    it("should return 0 when getRowCount calculation results in negative", () => {
      // Set a very small height that would result in negative count
      wrapper.vm.updatedLayout.h = 0.5; // 0.5 * 30 - 24 = -9, which is negative
      const result = wrapper.vm.getRowCount;
      expect(result == 0).toBe(true);
    });

    it("should calculate getRowCount correctly for height of 1", () => {
      // For h = 1: Math.ceil((1 * 30 - 24) / 28.5) = Math.ceil(6 / 28.5) = Math.ceil(0.21) = 1
      wrapper.vm.updatedLayout.h = 1;
      expect(wrapper.vm.getRowCount).toBe(1);
    });

    it("should calculate getRowCount correctly for large height", () => {
      // For h = 10: Math.ceil((10 * 30 - 24) / 28.5) = Math.ceil(276 / 28.5) = Math.ceil(9.68) = 10
      wrapper.vm.updatedLayout.h = 10;
      expect(wrapper.vm.getRowCount).toBe(10);
    });
  });

  describe("Methods", () => {
    beforeEach(() => {
      wrapper = shallowMount(PanelLayoutSettings, {
        props: defaultProps,
        global: {
          plugins: [store, router, i18n],
          stubs: {
            'q-btn': true,
            'q-separator': true,
            'q-form': true,
            'q-input': true,
            'q-icon': true,
            'q-tooltip': true,
          },
        }
      });
    });

    it("should emit save:layout event with updated layout when savePanelLayout is called", () => {
      // Modify the layout
      wrapper.vm.updatedLayout.h = 8;
      wrapper.vm.updatedLayout.w = 10;
      
      // Call the method
      wrapper.vm.savePanelLayout();
      
      // Check that the event was emitted with the updated layout
      const emittedEvents = wrapper.emitted('save:layout');
      expect(emittedEvents).toBeTruthy();
      expect(emittedEvents!.length).toBe(1);
      expect(emittedEvents![0][0]).toEqual({
        h: 8,
        w: 10,
        x: 0,
        y: 0,
        i: "panel1"
      });
    });

    it("should emit save:layout with a copy of updatedLayout", () => {
      const originalLayout = { ...wrapper.vm.updatedLayout };
      
      wrapper.vm.savePanelLayout();
      
      const emittedEvents = wrapper.emitted('save:layout');
      const emittedLayout = emittedEvents![0][0];
      
      // Verify it's a copy by modifying the original and checking emitted is unchanged
      wrapper.vm.updatedLayout.h = 999;
      expect(emittedLayout).toEqual(originalLayout);
      expect(emittedLayout).not.toBe(wrapper.vm.updatedLayout);
    });
  });

  describe("Template Rendering", () => {
    beforeEach(() => {
      wrapper = shallowMount(PanelLayoutSettings, {
        props: defaultProps,
        global: {
          plugins: [store, router, i18n],
          stubs: {
            'q-btn': true,
            'q-separator': true,
            'q-form': true,
            'q-input': true,
            'q-icon': true,
            'q-tooltip': true,
          },
        }
      });
    });

    it("should apply dark mode class when theme is dark", async () => {
      // Change store theme to dark
      store.state.theme = "dark";
      
      wrapper = shallowMount(PanelLayoutSettings, {
        props: defaultProps,
        global: {
          plugins: [store, router, i18n],
          stubs: {
            'q-btn': true,
            'q-separator': true,
            'q-form': true,
            'q-input': true,
            'q-icon': true,
            'q-tooltip': true,
          },
        }
      });
      
      await nextTick();
      
      const rootDiv = wrapper.find('div').element;
      expect(rootDiv.className).toContain('dark-mode');
    });

    it("should apply light mode class when theme is light", async () => {
      const rootDiv = wrapper.find('div').element;
      expect(rootDiv.className).toContain('bg-white');
      expect(rootDiv.className).not.toContain('dark-mode');
    });

    it("should display panel layout title", () => {
      expect(wrapper.text()).toContain('Panel Layout');
    });

    it("should have form element", () => {
      const form = wrapper.find('q-form-stub');
      expect(form.exists()).toBe(true);
    });

    it("should use getImageURL for close button icon", () => {
      expect(wrapper.vm.getImageURL).toBeDefined();
      expect(wrapper.vm.getImageURL('images/common/close_icon.svg')).toBe('mocked-image-url');
    });

    it("should have buttons for actions", () => {
      const buttons = wrapper.findAll('q-btn-stub');
      expect(buttons.length).toBeGreaterThan(0);
    });
  });

  describe("Edge Cases and Error Scenarios", () => {
    beforeEach(() => {
      wrapper = shallowMount(PanelLayoutSettings, {
        props: defaultProps,
        global: {
          plugins: [store, router, i18n],
          stubs: {
            'q-btn': true,
            'q-separator': true,
            'q-form': true,
            'q-input': true,
            'q-icon': true,
            'q-tooltip': true,
          },
        }
      });
    });

    it("should handle zero height correctly in getRowCount", () => {
      wrapper.vm.updatedLayout.h = 0;
      const result = wrapper.vm.getRowCount;
      expect(result == 0).toBe(true);
    });

    it("should handle very large height in getRowCount", () => {
      wrapper.vm.updatedLayout.h = 1000;
      const result = wrapper.vm.getRowCount;
      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThan(0);
    });

    it("should handle decimal heights in getRowCount", () => {
      wrapper.vm.updatedLayout.h = 2.5;
      const result = wrapper.vm.getRowCount;
      expect(typeof result).toBe('number');
      expect(Number.isInteger(result)).toBe(true);
    });

    it("should work with different layout props", () => {
      const customLayout = {
        h: 3,
        w: 6,
        x: 1,
        y: 2,
        i: "custom-panel"
      };

      wrapper = shallowMount(PanelLayoutSettings, {
        props: { layout: customLayout },
        global: {
          plugins: [store, router, i18n],
          stubs: {
            'q-btn': true,
            'q-separator': true,
            'q-form': true,
            'q-input': true,
            'q-icon': true,
            'q-tooltip': true,
          },
        }
      });

      expect(wrapper.vm.updatedLayout).toEqual(customLayout);
      expect(wrapper.vm.getRowCount).toBeGreaterThanOrEqual(0);
    });

    it("should maintain layout integrity when props change", async () => {
      const newLayout = {
        h: 7,
        w: 10,
        x: 2,
        y: 3,
        i: "updated-panel"
      };

      await wrapper.setProps({ layout: newLayout });
      // Note: The component creates a copy, so original layout should be preserved
      expect(wrapper.props('layout')).toEqual(newLayout);
    });

    it("should emit correct event name", () => {
      wrapper.vm.savePanelLayout();
      const emittedEvents = Object.keys(wrapper.emitted());
      expect(emittedEvents).toContain('save:layout');
    });

    it("should handle negative result in getRowCount calculation", () => {
      // To hit the if (count < 0) return 0 branch on line 148
      // We need count = Math.ceil((h * 30 - 24) / 28.5) < 0
      // This means h * 30 - 24 < 0, so h < 24/30 = 0.8
      wrapper.vm.updatedLayout.h = 0.7; // This should result in negative count
      const result = wrapper.vm.getRowCount;
      expect(result == 0).toBe(true);
    });
  });
});
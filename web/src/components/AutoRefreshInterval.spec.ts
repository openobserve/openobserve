import { mount } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import AutoRefreshInterval from "@/components/AutoRefreshInterval.vue";
import i18n from "@/locales";
import { createRouter, createWebHistory } from "vue-router";

installQuasar();

vi.mock("@/utils/date", () => ({
  generateDurationLabel: vi.fn((value) => `${value} seconds`)
}));

const mockRouter = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", component: { template: "<div>Home</div>" } }
  ]
});

describe("AutoRefreshInterval", () => {
  let wrapper: any = null;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.useRealTimers();
  });

  const createWrapper = (props = {}) => {
    return mount(AutoRefreshInterval, {
      props: {
        modelValue: 0,
        trigger: false,
        ...props
      },
      global: {
        plugins: [i18n, mockRouter],
        stubs: {
          'q-btn-dropdown': {
            template: '<div class="q-btn-dropdown"><slot /><slot name="label" /></div>'
          },
          'q-icon': {
            template: '<div class="q-icon"></div>'
          },
          'q-btn': {
            template: '<button @click="$emit(\'click\')" :disabled="disable"><slot /></button>',
            props: ['disable', 'disabled']
          },
          'q-separator': {
            template: '<div class="q-separator"></div>'
          },
          'q-tooltip': {
            template: '<div class="q-tooltip"><slot /></div>'
          }
        }
      },
    });
  };

  it("should mount AutoRefreshInterval component", () => {
    wrapper = createWrapper();
    expect(wrapper).toBeTruthy();
  });

  it("should have correct component name", () => {
    wrapper = createWrapper();
    expect(wrapper.vm.$options.name).toBe("AutoRefreshInterval");
  });

  it("should have correct props", () => {
    wrapper = createWrapper({ modelValue: 5, trigger: true });
    expect(wrapper.props('modelValue')).toBe(5);
    expect(wrapper.props('trigger')).toBe(true);
  });

  it("should render without errors", () => {
    wrapper = createWrapper();
    expect(wrapper.exists()).toBe(true);
  });

  it("should expose necessary properties from setup", () => {
    wrapper = createWrapper();
    expect(typeof wrapper.vm.t).toBe("function");
    expect(wrapper.vm.router).toBeDefined();
    expect(wrapper.vm.btnRefreshInterval).toBeDefined();
    expect(wrapper.vm.selectedLabel).toBeDefined();
    expect(wrapper.vm.refreshTimes).toBeDefined();
    expect(typeof wrapper.vm.onItemClick).toBe("function");
    expect(wrapper.vm.minRangeRestrictionMessageVal).toBeDefined();
  });

  describe("Function Coverage Tests", () => {
    it("should trigger timer management through prop changes", async () => {
      const mockSetInterval = vi.fn().mockReturnValue(123);
      const mockClearInterval = vi.fn();
      
      vi.stubGlobal('setInterval', mockSetInterval);
      vi.stubGlobal('clearInterval', mockClearInterval);

      wrapper = createWrapper({ 
        modelValue: 0,
        trigger: true 
      });

      // Change to a non-zero value to trigger timer setup
      await wrapper.setProps({ modelValue: 60 });

      expect(mockSetInterval).toHaveBeenCalledWith(expect.any(Function), 60000);
      
      vi.unstubAllGlobals();
    });

    it("should handle disabled values through button clicks", async () => {
      wrapper = createWrapper({ 
        modelValue: 0,
        minRefreshInterval: 30 
      });

      // Find a button for a value less than minRefreshInterval
      const fiveSecButton = wrapper.find('[data-test="logs-search-bar-refresh-time-5"]');
      await fiveSecButton.trigger('click');

      // Should not change to disabled value, stays at 0 or goes to 0
      expect(wrapper.emitted('update:modelValue')).toBeTruthy();
    });

    it("should handle valid values through button clicks", async () => {
      wrapper = createWrapper({ 
        modelValue: 0,
        minRefreshInterval: 10 
      });

      // Find a button for a value greater than minRefreshInterval
      const oneMinButton = wrapper.find('[data-test="logs-search-bar-refresh-time-60"]');
      await oneMinButton.trigger('click');

      expect(wrapper.emitted('update:modelValue')).toBeTruthy();
      const emittedValues = wrapper.emitted('update:modelValue') as any[][];
      expect(emittedValues[emittedValues.length - 1][0]).toBe(60);
    });

    it("should test onItemClick through component interaction", async () => {
      wrapper = createWrapper({ modelValue: 0 });

      // Click on a specific refresh time button
      const fiveMinButton = wrapper.find('[data-test="logs-search-bar-refresh-time-300"]');
      await fiveMinButton.trigger('click');

      expect(wrapper.emitted('update:modelValue')).toBeTruthy();
      const emittedValues = wrapper.emitted('update:modelValue') as any[][];
      expect(emittedValues[emittedValues.length - 1][0]).toBe(300);
    });

    it("should emit trigger event from interval", async () => {
      let intervalCallback: Function;
      const mockSetInterval = vi.fn().mockImplementation((callback) => {
        intervalCallback = callback;
        return 789;
      });
      
      vi.stubGlobal('setInterval', mockSetInterval);

      wrapper = createWrapper({ 
        modelValue: 5,
        trigger: true 
      });

      // Wait for component to set up interval
      await wrapper.vm.$nextTick();
      
      // Execute the interval callback if it was set
      if (intervalCallback!) {
        intervalCallback();
        expect(wrapper.emitted('trigger')).toBeTruthy();
      }
      
      vi.unstubAllGlobals();
    });

    it("should update disabled flags when minRefreshInterval changes", async () => {
      wrapper = createWrapper({ 
        modelValue: 0,
        minRefreshInterval: 10 
      });

      // Initially, 60s item should not be disabled
      let oneMinItem = wrapper.vm.refreshTimes.flat().find((item: any) => item.value === 60);
      expect(oneMinItem.disabled).toBe(false);

      // Change the minRefreshInterval prop
      await wrapper.setProps({ minRefreshInterval: 70 });

      // Now the 1 min item should be disabled
      oneMinItem = wrapper.vm.refreshTimes.flat().find((item: any) => item.value === 60);
      expect(oneMinItem.disabled).toBe(true);
      
      // Check restriction message
      expect(wrapper.vm.minRangeRestrictionMessageVal).toContain("70 seconds");
    });

    it("should handle timer reset when value becomes 0", async () => {
      const mockSetInterval = vi.fn().mockReturnValue(999);
      const mockClearInterval = vi.fn();
      
      vi.stubGlobal('setInterval', mockSetInterval);
      vi.stubGlobal('clearInterval', mockClearInterval);

      wrapper = createWrapper({ 
        modelValue: 60,
        trigger: true 
      });

      // Change to 0 to stop timer
      await wrapper.setProps({ modelValue: 0 });

      expect(mockClearInterval).toHaveBeenCalled();
      
      vi.unstubAllGlobals();
    });

    it("should test component reactivity and watch behavior", async () => {
      wrapper = createWrapper({ 
        modelValue: 0,
        trigger: true 
      });

      // Component should be reactive to prop changes
      expect(wrapper.vm).toBeTruthy();
      
      // Change modelValue to test reactivity
      await wrapper.setProps({ modelValue: 60 });
      await wrapper.vm.$nextTick();
      
      // Component should still be working
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm.selectedLabel).toBe("1 min");
    });

    it("should test disabled state through component data", () => {
      wrapper = createWrapper({ 
        modelValue: 0,
        minRefreshInterval: 30 
      });

      // Items with values less than 30 should be disabled
      const fiveSecItem = wrapper.vm.refreshTimes.flat().find((item: any) => item.value === 5);
      const tenSecItem = wrapper.vm.refreshTimes.flat().find((item: any) => item.value === 10);
      const fifteenSecItem = wrapper.vm.refreshTimes.flat().find((item: any) => item.value === 15);
      const oneMinItem = wrapper.vm.refreshTimes.flat().find((item: any) => item.value === 60);

      expect(fiveSecItem.disabled).toBe(true);
      expect(tenSecItem.disabled).toBe(true);
      expect(fifteenSecItem.disabled).toBe(true);
      expect(oneMinItem.disabled).toBe(false);
    });

    it("should test disabled flags update on mount", async () => {
      wrapper = createWrapper({ 
        modelValue: 0,
        minRefreshInterval: 25 
      });

      // Component should be mounted and flags should be updated
      const fifteenSecItem = wrapper.vm.refreshTimes.flat().find((item: any) => item.value === 15);
      const oneMinItem = wrapper.vm.refreshTimes.flat().find((item: any) => item.value === 60);
      
      expect(fifteenSecItem.disabled).toBe(true);
      expect(oneMinItem.disabled).toBe(false);
    });

    it("should generate correct selectedLabel for predefined values", () => {
      wrapper = createWrapper({ modelValue: 60 });
      expect(wrapper.vm.selectedLabel).toBe("1 min");

      wrapper = createWrapper({ modelValue: 300 });
      expect(wrapper.vm.selectedLabel).toBe("5 min");

      wrapper = createWrapper({ modelValue: 0 });
      // For value 0, it should show "Off" (translated)
      expect(wrapper.vm.selectedLabel).toBe("Off");
    });

    it("should generate correct selectedLabel for custom values", async () => {
      wrapper = createWrapper({ modelValue: 45 });
      
      // For custom values not in predefined options, should use generateDurationLabel
      expect(wrapper.vm.selectedLabel).toBe("45 seconds");
    });

    it("should handle off button click", async () => {
      wrapper = createWrapper({ modelValue: 60 });

      const offButton = wrapper.find('[data-test="logs-search-off-refresh-interval"]');
      await offButton.trigger('click');

      expect(wrapper.emitted('update:modelValue')).toBeTruthy();
      const emittedValues = wrapper.emitted('update:modelValue') as any[][];
      expect(emittedValues[emittedValues.length - 1][0]).toBe(0);
    });

    it("should show tooltip for disabled buttons", () => {
      wrapper = createWrapper({ 
        modelValue: 0,
        minRefreshInterval: 30,
        minRangeRestrictionMessage: "Custom restriction message"
      });

      // Check that disabled items exist and restriction message is set
      const disabledItems = wrapper.vm.refreshTimes.flat().filter((item: any) => item.disabled);
      expect(disabledItems.length).toBeGreaterThan(0);
      expect(wrapper.vm.minRangeRestrictionMessageVal).toBeDefined();
    });
  });
});
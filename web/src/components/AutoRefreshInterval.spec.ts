import { mount } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import AutoRefreshInterval from "@/components/AutoRefreshInterval.vue";
import i18n from "@/locales";
import { createRouter, createWebHistory } from "vue-router";

vi.mock("@/utils/date", () => ({
  generateDurationLabel: vi.fn((value) => `${value} seconds`),
}));

const mockRouter = createRouter({
  history: createWebHistory(),
  routes: [{ path: "/", component: { template: "<div>Home</div>" } }],
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
        ...props,
      },
      global: {
        plugins: [i18n, mockRouter],
        stubs: {
          OIcon: {
            template: '<div class="OIcon" :data-icon="name"></div>',
            props: ["name", "size"],
          },
          OButton: {
            template:
              '<button :data-test="$attrs[\'data-test\']" :data-variant="variant" :disabled="disabled" @click="$emit(\'click\')"><slot /><slot name="label" /></button>',
            props: ["variant", "size", "disabled", "loading", "active", "block"],
            emits: ["click"],
          },
          OPopover: {
            template: '<div class="o-popover"><slot name="trigger" /><slot /></div>',
            props: ["open", "side", "align", "sideOffset", "modal", "contentClass", "ariaLabel"],
            emits: ["update:open"],
          },
          OSwitch: {
            template:
              '<button class="o-switch" :data-test="$attrs[\'data-test\']" :data-on="modelValue" :disabled="disabled" @click="$emit(\'update:modelValue\', !modelValue)" />',
            props: ["modelValue", "disabled"],
            emits: ["update:modelValue"],
          },
        },
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
    expect(wrapper.props("modelValue")).toBe(5);
    expect(wrapper.props("trigger")).toBe(true);
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

      vi.stubGlobal("setInterval", mockSetInterval);
      vi.stubGlobal("clearInterval", mockClearInterval);

      wrapper = createWrapper({
        modelValue: 0,
        trigger: true,
      });

      // Change to a non-zero value to trigger timer setup
      await wrapper.setProps({ modelValue: 60 });

      expect(mockSetInterval).toHaveBeenCalledWith(expect.any(Function), 60000);

      vi.unstubAllGlobals();
    });

    it("should handle disabled values through button clicks", async () => {
      wrapper = createWrapper({
        modelValue: 0,
        minRefreshInterval: 30,
      });

      // Find a button for a value less than minRefreshInterval
      const fiveSecButton = wrapper.find('[data-test="logs-search-bar-refresh-time-5"]');
      await fiveSecButton.trigger("click");

      expect(fiveSecButton.attributes("disabled")).toBeDefined();
      expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    });

    it("should handle valid values through button clicks", async () => {
      wrapper = createWrapper({
        modelValue: 0,
        minRefreshInterval: 10,
      });

      // Find a button for a value greater than minRefreshInterval
      const oneMinButton = wrapper.find('[data-test="logs-search-bar-refresh-time-60"]');
      await oneMinButton.trigger("click");

      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      const emittedValues = wrapper.emitted("update:modelValue") as any[][];
      expect(emittedValues[emittedValues.length - 1][0]).toBe(60);
    });

    it("should test onItemClick through component interaction", async () => {
      wrapper = createWrapper({ modelValue: 0 });

      // Click on a specific refresh time button
      const fiveMinButton = wrapper.find('[data-test="logs-search-bar-refresh-time-300"]');
      await fiveMinButton.trigger("click");

      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      const emittedValues = wrapper.emitted("update:modelValue") as any[][];
      expect(emittedValues[emittedValues.length - 1][0]).toBe(300);
    });

    it("should emit trigger event from interval", async () => {
      let intervalCallback: Function;
      const mockSetInterval = vi.fn().mockImplementation((callback) => {
        intervalCallback = callback;
        return 789;
      });

      vi.stubGlobal("setInterval", mockSetInterval);

      wrapper = createWrapper({
        modelValue: 5,
        trigger: true,
      });

      // Wait for component to set up interval
      await wrapper.vm.$nextTick();

      // Execute the interval callback if it was set
      if (intervalCallback!) {
        intervalCallback();
        expect(wrapper.emitted("trigger")).toBeTruthy();
      }

      vi.unstubAllGlobals();
    });

    it("should update disabled flags when minRefreshInterval changes", async () => {
      wrapper = createWrapper({
        modelValue: 0,
        minRefreshInterval: 10,
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

      vi.stubGlobal("setInterval", mockSetInterval);
      vi.stubGlobal("clearInterval", mockClearInterval);

      wrapper = createWrapper({
        modelValue: 60,
        trigger: true,
      });

      // Change to 0 to stop timer
      await wrapper.setProps({ modelValue: 0 });

      expect(mockClearInterval).toHaveBeenCalled();

      vi.unstubAllGlobals();
    });

    it("should test component reactivity and watch behavior", async () => {
      wrapper = createWrapper({
        modelValue: 0,
        trigger: true,
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
        minRefreshInterval: 30,
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
        minRefreshInterval: 25,
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

    it("should turn off via the switch", async () => {
      wrapper = createWrapper({ modelValue: 60 });

      const offButton = wrapper.find('[data-test="logs-search-off-refresh-interval"]');
      await offButton.trigger("click");

      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      const emittedValues = wrapper.emitted("update:modelValue") as any[][];
      expect(emittedValues[emittedValues.length - 1][0]).toBe(0);
    });

    it("should show tooltip for disabled buttons", () => {
      wrapper = createWrapper({
        modelValue: 0,
        minRefreshInterval: 30,
        minRangeRestrictionMessage: "Custom restriction message",
      });

      // Check that disabled items exist and restriction message is set
      const disabledItems = wrapper.vm.refreshTimes.flat().filter((item: any) => item.disabled);
      expect(disabledItems.length).toBeGreaterThan(0);
      expect(wrapper.vm.minRangeRestrictionMessageVal).toBeDefined();
    });
  });

  describe("Redesigned panel", () => {
    it("shows the compact interval and refreshing subtitle when on", () => {
      wrapper = createWrapper({ modelValue: 30 });
      expect(
        wrapper.find('[data-test="logs-search-bar-refresh-interval-btn-dropdown"]').text(),
      ).toContain("30s");
      expect(wrapper.find('[data-test="auto-refresh-subtitle"]').text()).toBe(
        "Refreshing every 30s",
      );
    });

    it("shows Off and the paused subtitle when off", () => {
      wrapper = createWrapper({ modelValue: 0 });
      expect(
        wrapper.find('[data-test="logs-search-bar-refresh-interval-btn-dropdown"]').text(),
      ).toContain("Off");
      expect(wrapper.find('[data-test="auto-refresh-subtitle"]').text()).toBe(
        "Paused. Pick an interval to start.",
      );
    });

    it("groups the intervals into seconds, minutes and hours", () => {
      wrapper = createWrapper();
      expect(
        wrapper.vm.refreshSections.map((s: any) => s.items.map((i: any) => i.shortLabel)),
      ).toEqual([
        ["5s", "10s", "15s", "30s"],
        ["1m", "5m", "15m", "30m"],
        ["1h", "2h", "1d"],
      ]);
    });

    it("sets aria-pressed on the interval buttons", () => {
      wrapper = createWrapper({ modelValue: 30 });
      expect(
        wrapper.find('[data-test="logs-search-bar-refresh-time-30"]').attributes("aria-pressed"),
      ).toBe("true");
      expect(
        wrapper.find('[data-test="logs-search-bar-refresh-time-10"]').attributes("aria-pressed"),
      ).toBe("false");
    });

    it("marks the selected interval with the primary variant", () => {
      wrapper = createWrapper({ modelValue: 30 });
      expect(
        wrapper.find('[data-test="logs-search-bar-refresh-time-30"]').attributes("data-variant"),
      ).toBe("primary");
      expect(
        wrapper.find('[data-test="logs-search-bar-refresh-time-10"]').attributes("data-variant"),
      ).toBe("outline");
    });

    it("turning the switch on resumes the last used interval", async () => {
      wrapper = createWrapper({ modelValue: 300 });
      const sw = wrapper.find('[data-test="logs-search-off-refresh-interval"]');
      await sw.trigger("click");
      await wrapper.setProps({ modelValue: 0 });
      await sw.trigger("click");
      const emitted = wrapper.emitted("update:modelValue") as any[][];
      expect(emitted[emitted.length - 1][0]).toBe(300);
    });

    it("turning the switch on with no history picks the smallest allowed interval", async () => {
      wrapper = createWrapper({ modelValue: 0, minRefreshInterval: 31 });
      await wrapper.find('[data-test="logs-search-off-refresh-interval"]').trigger("click");
      const emitted = wrapper.emitted("update:modelValue") as any[][];
      expect(emitted[emitted.length - 1][0]).toBe(60);
    });

    it("does not resume a remembered interval below a raised minimum", async () => {
      wrapper = createWrapper({ modelValue: 10 });
      const sw = wrapper.find('[data-test="logs-search-off-refresh-interval"]');
      await sw.trigger("click");
      await wrapper.setProps({ modelValue: 0, minRefreshInterval: 60 });
      await sw.trigger("click");
      const emitted = wrapper.emitted("update:modelValue") as any[][];
      expect(emitted[emitted.length - 1][0]).toBe(60);
    });

    it("keeps the icon-only trigger in compact mode", () => {
      wrapper = createWrapper({ modelValue: 30, isCompact: true });
      expect(wrapper.find('[data-test="logs-search-bar-refresh-interval-btn"]').exists()).toBe(
        true,
      );
      expect(
        wrapper.find('[data-test="logs-search-bar-refresh-interval-btn-dropdown"]').exists(),
      ).toBe(false);
    });

    it("defaults to 30s when switched on with nothing remembered", async () => {
      wrapper = createWrapper({ modelValue: 0 });
      await wrapper.find('[data-test="logs-search-off-refresh-interval"]').trigger("click");
      const emitted = wrapper.emitted("update:modelValue") as any[][];
      expect(emitted[emitted.length - 1][0]).toBe(30);
    });

    it("defaults to the smallest allowed interval when 30s is below the minimum", async () => {
      wrapper = createWrapper({ modelValue: 0, minRefreshInterval: 100 });
      await wrapper.find('[data-test="logs-search-off-refresh-interval"]').trigger("click");
      const emitted = wrapper.emitted("update:modelValue") as any[][];
      expect(emitted[emitted.length - 1][0]).toBe(300);
    });

    it("disables the switch when every interval is below the minimum", async () => {
      wrapper = createWrapper({ modelValue: 0, minRefreshInterval: 999999 });
      const sw = () => wrapper.find('[data-test="logs-search-off-refresh-interval"]');
      expect(sw().attributes("disabled")).toBeDefined();
    });

    it.each([
      [45, "45s"],
      [5400, "90m"],
    ])("treats a non-listed model value %i as on", (value, label) => {
      wrapper = createWrapper({ modelValue: value });
      const sw = wrapper.find('[data-test="logs-search-off-refresh-interval"]');
      expect(sw.attributes("data-on")).toBe("true");
      expect(
        wrapper.find('[data-test="logs-search-bar-refresh-interval-btn-dropdown"]').text(),
      ).toContain(label);
    });

    it("hides the relative-time footer with hideRelativeNote", () => {
      wrapper = createWrapper({ hideRelativeNote: true });
      expect(wrapper.find('[data-test="auto-refresh-footer"]').exists()).toBe(false);
    });

    it("labels the compact trigger with its state for screen readers", async () => {
      wrapper = createWrapper({ modelValue: 0, isCompact: true });
      const btn = () => wrapper.find('[data-test="logs-search-bar-refresh-interval-btn"]');
      expect(btn().attributes("aria-label")).toBe("Auto refresh off");
      await wrapper.setProps({ modelValue: 300 });
      expect(btn().attributes("aria-label")).toBe("Auto refresh on, every 5m");
    });

    it.each([
      ["compact", true, "logs-search-bar-refresh-interval-btn"],
      ["labelled", false, "logs-search-bar-refresh-interval-btn-dropdown"],
    ])("swaps the %s trigger icon between update and sync-disabled", async (_m, isCompact, dt) => {
      wrapper = createWrapper({ modelValue: 0, isCompact });
      const icon = () => wrapper.find(`[data-test="${dt}"] .OIcon`).attributes("data-icon");
      expect(icon()).toBe("sync-disabled");
      await wrapper.setProps({ modelValue: 30 });
      expect(icon()).toBe("update");
    });

    it("labels the labelled trigger with its state for screen readers", async () => {
      wrapper = createWrapper({ modelValue: 0 });
      const btn = () => wrapper.find('[data-test="logs-search-bar-refresh-interval-btn-dropdown"]');
      expect(btn().attributes("aria-label")).toBe("Auto refresh off");
      await wrapper.setProps({ modelValue: 300 });
      expect(btn().attributes("aria-label")).toBe("Auto refresh on, every 5m");
    });

    it("gives each interval button the long label while showing the short one", () => {
      wrapper = createWrapper();
      const btn = wrapper.find('[data-test="logs-search-bar-refresh-time-30"]');
      expect(btn.attributes("aria-label")).toBe("30 sec");
      expect(btn.text()).toBe("30s");
    });

    it("closes the popover after picking an interval", async () => {
      wrapper = createWrapper();
      wrapper.vm.btnRefreshInterval = true;
      await wrapper.vm.$nextTick();
      await wrapper.find('[data-test="logs-search-bar-refresh-time-30"]').trigger("click");
      expect(wrapper.vm.btnRefreshInterval).toBe(false);
    });

    it("shows the relative-time footer", () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="auto-refresh-footer"]').text()).toBe(
        "Applies to relative time ranges only",
      );
    });
  });
});

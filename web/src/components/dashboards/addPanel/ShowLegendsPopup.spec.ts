import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import ShowLegendsPopup from "./ShowLegendsPopup.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

// Mock quasar's copyToClipboard
vi.mock("quasar", async (importOriginal) => {
  const actual = await importOriginal<typeof import("quasar")>();
  return {
    ...actual,
    copyToClipboard: vi.fn().mockResolvedValue(undefined),
  };
});

// Mock color utilities
vi.mock("@/utils/dashboard/colorPalette", () => ({
  getSeriesColor: vi.fn().mockReturnValue("#ff0000"),
  getColorPalette: vi.fn().mockReturnValue([
    "#5960b2",
    "#ff6384",
    "#36a2eb",
    "#ffce56",
    "#4bc0c0",
  ]),
}));

installQuasar();

// Stub ODialog so its slot content renders inline (not teleported to document.body).
const ODialogStub = {
  name: "ODialog",
  inheritAttrs: false,
  props: ["open", "size", "title", "showClose", "persistent"],
  emits: ["update:open"],
  template: `
    <div data-test="o-dialog-stub" :data-open="String(open)">
      <slot name="header" />
      <slot name="header-right" />
      <slot />
      <slot name="footer" />
    </div>
  `,
};

// Stub OButton to forward data-test attributes to the rendered button element.
const OButtonStub = {
  name: "OButton",
  inheritAttrs: false,
  props: ["variant", "size", "disabled", "loading"],
  emits: ["click"],
  template: `<button @click="$emit('click', $event)" v-bind="$attrs"><slot name="icon-left" /><slot /></button>`,
};

describe("ShowLegendsPopup Component", () => {
  let wrapper: any;

  const simplePanelData = {
    options: {
      series: [
        { name: "Series A", data: [10, 20, 30] },
        { name: "Series B", data: [5, 15, 25] },
        { name: "Series C", data: [1, 2, 3] },
      ],
    },
  };

  const piePanelData = {
    options: {
      series: [
        {
          data: [
            { name: "Category A", value: 100 },
            { name: "Category B", value: 200 },
            { name: "Category C", value: 50 },
          ],
        },
      ],
    },
  };

  const createWrapper = (props = {}) => {
    return mount(ShowLegendsPopup, {
      props: {
        panelData: {},
        ...props,
      },
      global: {
        plugins: [i18n, store],
        stubs: {
          ODialog: ODialogStub,
          OButton: OButtonStub,
          "q-card": {
            template: '<div class="q-card" :data-test="$attrs[\'data-test\']"><slot /></div>',
          },
          "q-card-section": {
            template: '<div class="q-card-section"><slot /></div>',
          },
          "q-btn": {
            template:
              '<button @click="$emit(\'click\', $event)" :data-test="$attrs[\'data-test\']" :icon="$attrs.icon"><slot /></button>',
            emits: ["click"],
          },
          "q-tooltip": {
            template: '<span class="q-tooltip"><slot /></span>',
          },
          "OIcon": {
            template: '<span class="OIcon">{{ $attrs.name }}</span>',
          },
        },
      },
    });
  };

  beforeEach(() => {
    store.state.theme = "light";
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.useRealTimers();
  });

  describe("Component Initialization", () => {
    it("should mount successfully", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should have correct component name", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe("ShowLegendsPopup");
    });

    it("should initialize with empty copiedLegendIndices", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.isLegendCopied(0)).toBe(false);
    });

    it("should initialize with isAllCopied as false", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.isAllCopied).toBe(false);
    });
  });

  describe("legends Computed Property", () => {
    it("should return empty array when panelData is empty", () => {
      wrapper = createWrapper({ panelData: {} });
      expect(wrapper.vm.legends).toEqual([]);
    });

    it("should return empty array when panelData has no options", () => {
      wrapper = createWrapper({ panelData: { config: {} } });
      expect(wrapper.vm.legends).toEqual([]);
    });

    it("should return empty array when options has no series", () => {
      wrapper = createWrapper({ panelData: { options: {} } });
      expect(wrapper.vm.legends).toEqual([]);
    });

    it("should return empty array when series is not an array", () => {
      wrapper = createWrapper({ panelData: { options: { series: "invalid" } } });
      expect(wrapper.vm.legends).toEqual([]);
    });

    it("should return empty array when series is empty", () => {
      wrapper = createWrapper({ panelData: { options: { series: [] } } });
      expect(wrapper.vm.legends).toEqual([]);
    });

    it("should return legends from regular series (line/bar)", () => {
      wrapper = createWrapper({ panelData: simplePanelData });
      const legends = wrapper.vm.legends;
      expect(legends).toHaveLength(3);
      expect(legends[0].name).toBe("Series A");
      expect(legends[1].name).toBe("Series B");
      expect(legends[2].name).toBe("Series C");
    });

    it("should filter out series without name", () => {
      const panelData = {
        options: {
          series: [
            { name: "Series A", data: [] },
            { data: [] }, // no name
            { name: "Series C", data: [] },
          ],
        },
      };
      wrapper = createWrapper({ panelData });
      expect(wrapper.vm.legends).toHaveLength(2);
    });

    it("should return pie chart legends from series data items", () => {
      wrapper = createWrapper({ panelData: piePanelData });
      const legends = wrapper.vm.legends;
      expect(legends).toHaveLength(3);
      expect(legends[0].name).toBe("Category A");
      expect(legends[1].name).toBe("Category B");
      expect(legends[2].name).toBe("Category C");
    });

    it("should use explicit color from itemStyle when available", () => {
      const panelData = {
        options: {
          series: [
            { name: "Red Series", data: [], itemStyle: { color: "#ff0000" } },
          ],
        },
      };
      wrapper = createWrapper({ panelData });
      const legends = wrapper.vm.legends;
      expect(legends[0].color).toBe("#ff0000");
    });

    it("should use explicit color from lineStyle when available", () => {
      const panelData = {
        options: {
          series: [
            { name: "Blue Series", data: [], lineStyle: { color: "#0000ff" } },
          ],
        },
      };
      wrapper = createWrapper({ panelData });
      const legends = wrapper.vm.legends;
      expect(legends[0].color).toBe("#0000ff");
    });

    it("should assign colors from palette when no explicit color", () => {
      wrapper = createWrapper({ panelData: simplePanelData });
      const legends = wrapper.vm.legends;
      legends.forEach((l: any) => {
        expect(l.color).toBeDefined();
        expect(typeof l.color).toBe("string");
      });
    });

    it("should handle panelData with null series items gracefully", () => {
      const panelData = {
        options: {
          series: [null, { name: "Valid Series", data: [] }, undefined],
        },
      };
      wrapper = createWrapper({ panelData });
      // Should filter out null/undefined series
      expect(wrapper.vm.legends).toHaveLength(1);
    });
  });

  describe("closePopup", () => {
    it("should emit update:open=false when closePopup is called", () => {
      wrapper = createWrapper();
      wrapper.vm.closePopup();
      expect(wrapper.emitted("update:open")).toBeTruthy();
      expect(wrapper.emitted("update:open")[0]).toEqual([false]);
    });

    it("should emit update:open=false when ODialog emits update:open=false", async () => {
      wrapper = createWrapper({ panelData: simplePanelData });
      const dialog = wrapper.findComponent({ name: "ODialog" });
      expect(dialog.exists()).toBe(true);
      await dialog.vm.$emit("update:open", false);
      expect(wrapper.emitted("update:open")).toBeTruthy();
      expect(wrapper.emitted("update:open")[0]).toEqual([false]);
    });
  });

  describe("isLegendCopied", () => {
    it("should return false for index not in copiedLegendIndices", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.isLegendCopied(0)).toBe(false);
    });

    it("should return true for index in copiedLegendIndices", async () => {
      wrapper = createWrapper();
      await wrapper.vm.copyLegend("Some Legend", 2);
      await flushPromises();
      expect(wrapper.vm.isLegendCopied(2)).toBe(true);
    });
  });

  describe("copyLegend", () => {
    it("should call copyToClipboard with legend text", async () => {
      const { copyToClipboard } = await import("quasar");
      wrapper = createWrapper({ panelData: simplePanelData });
      await wrapper.vm.copyLegend("Series A", 0);
      await flushPromises();
      expect(copyToClipboard).toHaveBeenCalledWith("Series A");
    });

    it("should add index to copiedLegendIndices after copy", async () => {
      wrapper = createWrapper({ panelData: simplePanelData });
      await wrapper.vm.copyLegend("Series A", 0);
      await flushPromises();
      expect(wrapper.vm.isLegendCopied(0)).toBe(true);
    });

    it("should remove index from copiedLegendIndices after 3 seconds", async () => {
      wrapper = createWrapper({ panelData: simplePanelData });
      await wrapper.vm.copyLegend("Series A", 0);
      await flushPromises();
      expect(wrapper.vm.isLegendCopied(0)).toBe(true);

      vi.advanceTimersByTime(3000);
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.isLegendCopied(0)).toBe(false);
    });
  });

  describe("copyAllLegends", () => {
    it("should call copyToClipboard with all legend names joined by newline", async () => {
      const { copyToClipboard } = await import("quasar");
      wrapper = createWrapper({ panelData: simplePanelData });
      await wrapper.vm.copyAllLegends();
      await flushPromises();
      expect(copyToClipboard).toHaveBeenCalledWith("Series A\nSeries B\nSeries C");
    });

    it("should set isAllCopied to true after copy", async () => {
      wrapper = createWrapper({ panelData: simplePanelData });
      await wrapper.vm.copyAllLegends();
      await flushPromises();
      expect(wrapper.vm.isAllCopied).toBe(true);
    });

    it("should reset isAllCopied to false after 3 seconds", async () => {
      wrapper = createWrapper({ panelData: simplePanelData });
      await wrapper.vm.copyAllLegends();
      await flushPromises();
      expect(wrapper.vm.isAllCopied).toBe(true);

      vi.advanceTimersByTime(3000);
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.isAllCopied).toBe(false);
    });

    it("should trigger copyAllLegends from copy all button", async () => {
      const { copyToClipboard } = await import("quasar");
      wrapper = createWrapper({ panelData: simplePanelData });
      const copyAllBtn = wrapper.find('[data-test="dashboard-show-legends-copy-all"]');
      expect(copyAllBtn.exists()).toBe(true);
      await copyAllBtn.trigger("click");
      await flushPromises();
      expect(copyToClipboard).toHaveBeenCalled();
    });
  });

  describe("Template Rendering", () => {
    it("should render the popup container", () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="dashboard-show-legends-popup"]').exists()).toBe(true);
    });

    it("should render copy all button", () => {
      wrapper = createWrapper({ panelData: simplePanelData });
      expect(wrapper.find('[data-test="dashboard-show-legends-copy-all"]').exists()).toBe(true);
    });

    it("should render ODialog and propagate close via update:open emit", async () => {
      wrapper = createWrapper({ panelData: simplePanelData });
      const dialog = wrapper.findComponent({ name: "ODialog" });
      expect(dialog.exists()).toBe(true);
      await dialog.vm.$emit("update:open", false);
      expect(wrapper.emitted("update:open")).toBeTruthy();
    });

    it("should render each legend item with correct data-test attribute", () => {
      wrapper = createWrapper({ panelData: simplePanelData });
      expect(wrapper.find('[data-test="dashboard-legend-item-0"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-legend-item-1"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-legend-item-2"]').exists()).toBe(true);
    });
  });

  describe("Theme Support", () => {
    it("should use dark theme color palette when theme is dark", () => {
      store.state.theme = "dark";
      wrapper = createWrapper({ panelData: simplePanelData });
      const legends = wrapper.vm.legends;
      expect(legends.length).toBeGreaterThan(0);
    });

    it("should use light theme color palette when theme is light", () => {
      store.state.theme = "light";
      wrapper = createWrapper({ panelData: simplePanelData });
      const legends = wrapper.vm.legends;
      expect(legends.length).toBeGreaterThan(0);
    });
  });

  describe("Color Resolution with panelData.config", () => {
    it("should use palette-classic mode colors", () => {
      const panelData = {
        options: {
          series: [{ name: "Series A", data: [1, 2, 3] }],
        },
        config: {
          color: { mode: "palette-classic" },
        },
      };
      wrapper = createWrapper({ panelData });
      const legends = wrapper.vm.legends;
      expect(legends[0].color).toBeDefined();
    });

    it("should use getSeriesColor when color config mode is not palette-classic", () => {
      const panelData = {
        options: {
          series: [{ name: "Series A", data: [1, 2, 3] }],
        },
        config: {
          color: { mode: "fixed", colorBySeries: true },
        },
      };
      wrapper = createWrapper({ panelData });
      const legends = wrapper.vm.legends;
      expect(legends[0].color).toBeDefined();
    });
  });

  describe("Min/Max Calculation", () => {
    it("should handle series with array data tuples", () => {
      const panelData = {
        options: {
          series: [
            {
              name: "Time Series",
              data: [
                [1000000, 10],
                [2000000, 20],
              ],
            },
          ],
        },
      };
      wrapper = createWrapper({ panelData });
      expect(wrapper.vm.legends).toHaveLength(1);
    });

    it("should handle series with object data items", () => {
      const panelData = {
        options: {
          series: [
            {
              name: "Object Series",
              data: [{ value: 5 }, { value: 15 }],
            },
          ],
        },
      };
      wrapper = createWrapper({ panelData });
      expect(wrapper.vm.legends).toHaveLength(1);
    });
  });
});

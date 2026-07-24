import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import NoSymbol from "@/components/icons/dashboards/NoSymbol.vue";

describe("NoSymbol.vue", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  const createWrapper = () => mount(NoSymbol, { global: { plugins: [] } });

  describe("Component Rendering", () => {
    it("renders the component correctly", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("has correct component name", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe("NoSymbol");
    });

    it("renders an SVG element", () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="dashboard-icon-no-symbol-svg"]').exists()).toBe(true);
    });

    it("has correct SVG dimensions", () => {
      wrapper = createWrapper();
      const svg = wrapper.find('[data-test="dashboard-icon-no-symbol-svg"]');
      expect(svg.attributes("width")).toBe("86");
      expect(svg.attributes("height")).toBe("90");
    });

    it("has correct viewBox", () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="dashboard-icon-no-symbol-svg"]').attributes("viewBox")).toBe(
        "0 0 86 90",
      );
    });

    it("contains a path element", () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="dashboard-icon-no-symbol-path"]').exists()).toBe(true);
    });

    it("path uses currentColor stroke", () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="dashboard-icon-no-symbol-path"]').attributes("stroke")).toBe(
        "currentColor",
      );
    });

    it("path has stroke-width of 4", () => {
      wrapper = createWrapper();
      expect(
        wrapper.find('[data-test="dashboard-icon-no-symbol-path"]').attributes("stroke-width"),
      ).toBe("4");
    });
  });

  describe("Vue 3 Integration", () => {
    it("uses defineComponent correctly", () => {
      wrapper = createWrapper();
      expect(wrapper.vm).toBeTruthy();
    });

    it("has no reactive state", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$data).toEqual({});
    });

    it("mounts without errors", () => {
      expect(() => {
        wrapper = createWrapper();
      }).not.toThrow();
    });

    it("unmounts cleanly", () => {
      wrapper = createWrapper();
      expect(() => {
        wrapper.unmount();
      }).not.toThrow();
    });

    it("has no side effects on mount", () => {
      const spy = vi.spyOn(console, "warn");
      wrapper = createWrapper();
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe("Icon Specifics", () => {
    it("renders at the SVG root level", () => {
      wrapper = createWrapper();
      expect(wrapper.element.tagName).toBe("svg");
    });

    it("has xmlns attribute", () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="dashboard-icon-no-symbol-svg"]').attributes("xmlns")).toBe(
        "http://www.w3.org/2000/svg",
      );
    });
  });
});

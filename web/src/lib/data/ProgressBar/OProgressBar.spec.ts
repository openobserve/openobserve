import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { h } from "vue";
import OProgressBar from "./OProgressBar.vue";

describe("OProgressBar", () => {
  describe("rendering", () => {
    it("renders the track and fill elements", () => {
      const wrapper = mount(OProgressBar, { props: { value: 0.5 } });
      // outer track
      expect(wrapper.find("[role='progressbar']").exists()).toBe(true);
      // fill div inside track
      expect(wrapper.find("[role='progressbar'] div").exists()).toBe(true);
    });

    it("sets fill width to value percentage", () => {
      const wrapper = mount(OProgressBar, { props: { value: 0.75 } });
      const fill = wrapper.find("[role='progressbar'] div");
      expect(fill.attributes("style")).toContain("width: 75%");
    });

    it("clamps value below 0 to 0%", () => {
      const wrapper = mount(OProgressBar, { props: { value: -0.5 } });
      const fill = wrapper.find("[role='progressbar'] div");
      expect(fill.attributes("style")).toContain("width: 0%");
    });

    it("clamps value above 1 to 100%", () => {
      const wrapper = mount(OProgressBar, { props: { value: 1.5 } });
      const fill = wrapper.find("[role='progressbar'] div");
      expect(fill.attributes("style")).toContain("width: 100%");
    });
  });

  describe("variant classes", () => {
    it("applies bg-progress-bar-default for variant=default", () => {
      const wrapper = mount(OProgressBar, { props: { value: 0.5 } });
      expect(wrapper.find("[role='progressbar'] div").classes()).toContain(
        "bg-progress-bar-default",
      );
    });

    it("applies bg-progress-bar-warning for variant=warning", () => {
      const wrapper = mount(OProgressBar, {
        props: { value: 0.9, variant: "warning" },
      });
      expect(wrapper.find("[role='progressbar'] div").classes()).toContain(
        "bg-progress-bar-warning",
      );
    });

    it("applies bg-progress-bar-danger for variant=danger", () => {
      const wrapper = mount(OProgressBar, {
        props: { value: 1, variant: "danger" },
      });
      expect(wrapper.find("[role='progressbar'] div").classes()).toContain(
        "bg-progress-bar-danger",
      );
    });
  });

  describe("size classes", () => {
    const sizes = ["xs", "sm", "md", "lg"] as const;
    const expected = { xs: "h-1", sm: "h-2", md: "h-3", lg: "h-5" };

    sizes.forEach((size) => {
      it(`applies ${expected[size]} for size="${size}"`, () => {
        const wrapper = mount(OProgressBar, { props: { value: 0.5, size } });
        expect(wrapper.find("[role='progressbar']").classes()).toContain(expected[size]);
      });
    });
  });

  describe("default slot", () => {
    it("renders slot content inside the fill", () => {
      const wrapper = mount(OProgressBar, {
        props: { value: 0.47 },
        slots: { default: () => h("span", {}, "47%") },
      });
      expect(wrapper.text()).toContain("47%");
    });

    it("does not render label span when no slot provided", () => {
      const wrapper = mount(OProgressBar, { props: { value: 0.5 } });
      // the label span only appears when $slots.default is present
      expect(wrapper.find("span.text-progress-bar-label").exists()).toBe(false);
    });
  });

  // A bar with a `start` is a SEGMENT of the track rather than a fill from its
  // edge, which is what lets a column of them read as a timeline.
  describe("start offset", () => {
    const fill = (w: ReturnType<typeof mount>) =>
      w.find("[role='progressbar'] > div").attributes("style") ?? "";

    it("fills from the track start when start is omitted", () => {
      const wrapper = mount(OProgressBar, { props: { value: 0.4 } });
      expect(fill(wrapper)).toContain("width: 40%");
      expect(fill(wrapper)).toContain("margin-inline-start: 0%");
    });

    it("offsets the fill and spans only start..value", () => {
      const wrapper = mount(OProgressBar, { props: { start: 0.25, value: 0.75 } });
      expect(fill(wrapper)).toContain("margin-inline-start: 25%");
      expect(fill(wrapper)).toContain("width: 50%");
    });

    // Negative widths paint the whole track in some engines, so an inverted
    // range must render as nothing rather than as everything.
    it("renders an empty fill when start is past value", () => {
      const wrapper = mount(OProgressBar, { props: { start: 0.8, value: 0.2 } });
      expect(fill(wrapper)).toContain("width: 0%");
    });

    it("clamps start into [0, 1]", () => {
      const wrapper = mount(OProgressBar, { props: { start: -3, value: 0.5 } });
      expect(fill(wrapper)).toContain("margin-inline-start: 0%");
      expect(fill(wrapper)).toContain("width: 50%");
    });

    it("reports the segment's magnitude as aria-valuenow, not its end", () => {
      const wrapper = mount(OProgressBar, { props: { start: 0.6, value: 0.9 } });
      expect(wrapper.find("[role='progressbar']").attributes("aria-valuenow")).toBe("30");
    });
  });

  describe("accessibility", () => {
    it("has role=progressbar", () => {
      const wrapper = mount(OProgressBar, { props: { value: 0.3 } });
      expect(wrapper.find("[role='progressbar']").exists()).toBe(true);
    });

    it("sets aria-valuenow to rounded percentage integer", () => {
      const wrapper = mount(OProgressBar, { props: { value: 0.73 } });
      expect(wrapper.find("[role='progressbar']").attributes("aria-valuenow")).toBe("73");
    });

    it("sets aria-valuemin=0 and aria-valuemax=100", () => {
      const wrapper = mount(OProgressBar, { props: { value: 0.5 } });
      const pb = wrapper.find("[role='progressbar']");
      expect(pb.attributes("aria-valuemin")).toBe("0");
      expect(pb.attributes("aria-valuemax")).toBe("100");
    });
  });
});

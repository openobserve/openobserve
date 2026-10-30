import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { raw } from "@/types/i18n";
import OCoverageMeter from "./OCoverageMeter.vue";

const find = (wrapper: ReturnType<typeof mount>, suffix: string) =>
  wrapper.find(`[data-test="dbm-coverage-meter-${suffix}"]`);

describe("OCoverageMeter", () => {
  const base = { dataTest: "dbm" } as const;

  describe("share read-out", () => {
    it("renders the measured share as whole percent", () => {
      const wrapper = mount(OCoverageMeter, { props: { ...base, value: 0.81 } });
      expect(find(wrapper, "share").text()).toBe("81%");
    });

    it("never rounds an incomplete share up to 100%", () => {
      const wrapper = mount(OCoverageMeter, { props: { ...base, value: 0.999 } });
      expect(find(wrapper, "share").text()).toBe("99%");
    });

    it("renders 100% only when coverage is exactly complete", () => {
      const wrapper = mount(OCoverageMeter, { props: { ...base, value: 1 } });
      expect(find(wrapper, "share").text()).toBe("100%");
    });

    it("shows a dash instead of a number when the share is unmeasurable", () => {
      const wrapper = mount(OCoverageMeter, { props: { ...base, state: "subset" } });
      expect(find(wrapper, "share").text()).toBe("—");
    });
  });

  describe("bar", () => {
    it("draws a filled proportion bar when measured", () => {
      const wrapper = mount(OCoverageMeter, { props: { ...base, value: 0.6 } });
      expect(find(wrapper, "bar").exists()).toBe(true);
      expect(find(wrapper, "bar-indeterminate").exists()).toBe(false);
    });

    it("draws a track-only bar for a subset, never a partial fill", () => {
      const wrapper = mount(OCoverageMeter, {
        props: { ...base, state: "subset", value: 0.6 },
      });
      expect(find(wrapper, "bar").exists()).toBe(false);
      expect(find(wrapper, "bar-indeterminate").exists()).toBe(true);
    });

    it("uses the danger fill below dangerBelow", () => {
      const wrapper = mount(OCoverageMeter, { props: { ...base, value: 0.4 } });
      expect(find(wrapper, "bar").find("div").classes()).toContain("bg-progress-bar-danger");
    });

    it("uses the warning fill between dangerBelow and warnBelow", () => {
      const wrapper = mount(OCoverageMeter, { props: { ...base, value: 0.7 } });
      expect(find(wrapper, "bar").find("div").classes()).toContain("bg-progress-bar-warning");
    });

    it("uses the default fill at or above warnBelow", () => {
      const wrapper = mount(OCoverageMeter, { props: { ...base, value: 0.9 } });
      expect(find(wrapper, "bar").find("div").classes()).toContain("bg-progress-bar-default");
    });
  });

  describe("reasoning lines", () => {
    it("renders both reasoning lines when measured", () => {
      const wrapper = mount(OCoverageMeter, {
        props: {
          ...base,
          value: 0.81,
          accountedFor: raw("81% is in the shown rows"),
          remainder: raw("19% is in other queries"),
        },
      });
      expect(find(wrapper, "accounted").text()).toBe("81% is in the shown rows");
      expect(find(wrapper, "remainder").text()).toBe("19% is in other queries");
    });

    it("replaces the reasoning lines with the state note when not measured", () => {
      const wrapper = mount(OCoverageMeter, {
        props: {
          ...base,
          state: "subset",
          accountedFor: raw("should not render"),
          stateNote: raw("This view is a top-N subset."),
        },
      });
      expect(find(wrapper, "accounted").exists()).toBe(false);
      expect(find(wrapper, "state-note").text()).toBe("This view is a top-N subset.");
    });
  });

  describe("qualifier chips", () => {
    const notes = [
      { id: "estimated", label: raw("≈ estimated"), tone: "neutral" as const },
      { id: "gap", label: raw("gap"), tone: "error" as const },
    ];

    it("renders one chip per note", () => {
      const wrapper = mount(OCoverageMeter, { props: { ...base, value: 0.9, notes } });
      expect(find(wrapper, "note-estimated").exists()).toBe(true);
      expect(find(wrapper, "note-gap").exists()).toBe(true);
    });

    it("emits note with the note id when a chip is activated", async () => {
      const wrapper = mount(OCoverageMeter, { props: { ...base, value: 0.9, notes } });
      await find(wrapper, "note-gap").trigger("click");
      expect(wrapper.emitted("note")).toEqual([["gap"]]);
    });
  });

  describe("details affordance", () => {
    it("is hidden without a label", () => {
      const wrapper = mount(OCoverageMeter, { props: { ...base, value: 0.9 } });
      expect(find(wrapper, "details").exists()).toBe(false);
    });

    it("emits details on click", async () => {
      const wrapper = mount(OCoverageMeter, {
        props: { ...base, value: 0.9, detailsLabel: raw("What's not shown") },
      });
      await find(wrapper, "details").trigger("click");
      expect(wrapper.emitted("details")).toHaveLength(1);
    });
  });

  describe("freshness", () => {
    it("tones the freshness read-out as an error when data is missing", () => {
      const wrapper = mount(OCoverageMeter, {
        props: {
          ...base,
          value: 0.9,
          freshnessLabel: raw("aggregation is behind"),
          freshnessTone: "error",
        },
      });
      expect(find(wrapper, "freshness").classes()).toContain("text-status-error-text");
    });
  });
});

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import OSkeleton from "./OSkeleton.vue";

describe("OSkeleton", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  describe("shape", () => {
    it("defaults to a 12 px chip-rounded line that fills the width", () => {
      const el = mount(OSkeleton, { props: { delay: 0 } });
      expect(el.classes()).toEqual(expect.arrayContaining(["rounded-chip", "h-3", "w-full"]));
    });

    it("block takes its height from the layout", () => {
      const el = mount(OSkeleton, { props: { shape: "block", delay: 0 } });
      expect(el.classes()).toContain("rounded-chip");
      expect(el.classes()).not.toContain("h-3");
    });

    it("circle is round and square", () => {
      const el = mount(OSkeleton, { props: { shape: "circle", delay: 0 } });
      expect(el.classes()).toEqual(expect.arrayContaining(["rounded-full", "aspect-square"]));
    });

    it("drops its default width and height when the layout sets them", () => {
      const el = mount(OSkeleton, { props: { delay: 0 }, attrs: { class: "h-5 w-24" } });
      expect(el.classes()).toEqual(expect.arrayContaining(["h-5", "w-24"]));
      expect(el.classes()).not.toContain("w-full");
      expect(el.classes()).not.toContain("h-3");
    });

    it("shimmers with the shared skeleton keyframe", () => {
      const el = mount(OSkeleton, { props: { delay: 0 } });
      expect(el.classes().some((c) => c.includes("o2-skel-shimmer"))).toBe(true);
    });
  });

  describe("delay", () => {
    it("stays invisible for 150 ms so a fast load never flashes it", async () => {
      const el = mount(OSkeleton);
      expect(el.classes()).toContain("invisible");
      vi.advanceTimersByTime(149);
      await nextTick();
      expect(el.classes()).toContain("invisible");
      vi.advanceTimersByTime(1);
      await nextTick();
      expect(el.classes()).not.toContain("invisible");
    });

    it("shows at once with delay 0", () => {
      expect(mount(OSkeleton, { props: { delay: 0 } }).classes()).not.toContain("invisible");
    });
  });

  describe("preset", () => {
    it("tableRows draws rows (5 by default)", () => {
      const el = mount(OSkeleton, { props: { preset: "tableRows", delay: 0 } });
      expect(el.attributes("data-preset")).toBe("tableRows");
      expect(el.element.children).toHaveLength(5);
      const three = mount(OSkeleton, { props: { preset: "tableRows", rows: 3 } });
      expect(three.element.children).toHaveLength(3);
    });

    it("statStrip draws one tile per count (4 by default)", () => {
      expect(mount(OSkeleton, { props: { preset: "statStrip" } }).element.children).toHaveLength(4);
      const two = mount(OSkeleton, { props: { preset: "statStrip", count: 2 } });
      expect(two.element.children).toHaveLength(2);
    });

    it("chart draws bars at a default height the layout can override", () => {
      const el = mount(OSkeleton, { props: { preset: "chart" } });
      expect(el.element.children.length).toBeGreaterThan(0);
      expect(el.classes()).toContain("h-20");
      const tall = mount(OSkeleton, { props: { preset: "chart" }, attrs: { class: "h-40" } });
      expect(tall.classes()).not.toContain("h-20");
    });

    it("is one status region for the whole layout", () => {
      const el = mount(OSkeleton, { props: { preset: "tableRows" } });
      expect(el.attributes("role")).toBe("status");
      expect(el.element.querySelectorAll("[role='status']")).toHaveLength(0);
    });
  });

  describe("accessibility", () => {
    it("is a busy, polite status with a name", () => {
      const el = mount(OSkeleton);
      expect(el.attributes("role")).toBe("status");
      expect(el.attributes("aria-busy")).toBe("true");
      expect(el.attributes("aria-live")).toBe("polite");
      expect(el.attributes("aria-label")).toBeTruthy();
    });
  });
});

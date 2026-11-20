import { describe, it, expect } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import OProgressBar from "./OProgressBar.vue";
import type { ProgressBarTone } from "./OProgressBar.types";
import { raw } from "@/types/i18n";

const fill = (w: VueWrapper) => w.get("[role='progressbar'] > div");

describe("OProgressBar", () => {
  it("is one 4 px rounded bar on the hover track", () => {
    const w = mount(OProgressBar, { props: { value: 50 } });
    expect(w.classes()).toEqual(
      expect.arrayContaining(["h-1", "rounded-full", "bg-progress-bar-track"]),
    );
  });

  it("fills to the percent given", () => {
    const w = mount(OProgressBar, { props: { value: 62 } });
    expect(fill(w).attributes("style")).toContain("width: 62%");
    expect(w.attributes("aria-valuenow")).toBe("62");
  });

  it.each([
    [-5, "0%"],
    [140, "100%"],
  ])("clamps %s to %s", (value, width) => {
    expect(fill(mount(OProgressBar, { props: { value } })).attributes("style")).toContain(
      `width: ${width}`,
    );
  });

  it("treats null as work with no known end", () => {
    const w = mount(OProgressBar, { props: { value: null } });
    expect(w.attributes("aria-valuenow")).toBeUndefined();
    expect(fill(w).attributes("style")).toBeUndefined();
    expect(
      fill(w)
        .classes()
        .some((c) => c.includes("o2-indeterminate")),
    ).toBe(true);
  });

  it.each([
    ["accent", "bg-progress-bar-default"],
    ["ok", "bg-progress-bar-success"],
    ["warn", "bg-progress-bar-warning"],
    ["err", "bg-progress-bar-danger"],
  ] as [ProgressBarTone, string][])("tone %s paints %s", (tone, cls) => {
    expect(fill(mount(OProgressBar, { props: { value: 10, tone } })).classes()).toContain(cls);
  });

  it("defaults to the accent tone", () => {
    expect(fill(mount(OProgressBar, { props: { value: 10 } })).classes()).toContain(
      "bg-progress-bar-default",
    );
  });

  it("names the bar with label", () => {
    const w = mount(OProgressBar, { props: { value: 10, label: raw("Quota used") } });
    expect(w.attributes("aria-label")).toBe("Quota used");
  });

  describe("start", () => {
    it("offsets the fill and spans only start..value", () => {
      const w = mount(OProgressBar, { props: { start: 20, value: 50 } });
      const style = fill(w).attributes("style");
      expect(style).toContain("margin-inline-start: 20%");
      expect(style).toContain("width: 30%");
      expect(w.attributes("aria-valuenow")).toBe("30");
    });

    it("renders an empty fill when start is past value", () => {
      const w = mount(OProgressBar, { props: { start: 80, value: 50 } });
      expect(fill(w).attributes("style")).toContain("width: 0%");
    });
  });

  describe("width", () => {
    it("stretches to w-full when the caller names no width", () => {
      expect(mount(OProgressBar, { props: { value: 1 } }).classes()).toContain("w-full");
    });

    it("drops w-full when the caller passes one", () => {
      const w = mount(OProgressBar, { props: { value: 1 }, attrs: { class: "w-12" } });
      expect(w.classes()).toContain("w-12");
      expect(w.classes()).not.toContain("w-full");
    });
  });
});

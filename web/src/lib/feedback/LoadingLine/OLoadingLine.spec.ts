import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import OLoadingLine from "./OLoadingLine.vue";
import { LOADER_REVEAL } from "@/lib/styles/motion";

describe("OLoadingLine", () => {
  it("keeps a 2 px strip either way so the rows below never shift", () => {
    for (const active of [true, false]) {
      expect(mount(OLoadingLine, { props: { active } }).classes()).toContain("h-0.5");
    }
  });

  it("runs an accent segment while active", () => {
    const seg = mount(OLoadingLine, { props: { active: true } }).get(
      '[data-test="o-loading-line-reveal"] > div',
    );
    expect(seg.classes()).toEqual(expect.arrayContaining(["bg-accent", "o2-motion-keep"]));
    expect(seg.classes().some((c) => c.includes("o2-indeterminate"))).toBe(true);
  });

  it("draws nothing and hides from assistive tech while idle", () => {
    const line = mount(OLoadingLine, { props: { active: false } });
    expect(line.element.children).toHaveLength(0);
    expect(line.attributes("aria-hidden")).toBe("true");
    expect(line.attributes("role")).toBeUndefined();
  });

  it("is a named progressbar while active", () => {
    const line = mount(OLoadingLine, { props: { active: true } });
    expect(line.attributes("role")).toBe("progressbar");
    expect(line.attributes("aria-label")).toBeTruthy();
  });

  it("waits out the loader delay, so a fast refresh never flashes it", () => {
    const reveal = mount(OLoadingLine, { props: { active: true } }).get(
      '[data-test="o-loading-line-reveal"]',
    );
    expect(reveal.classes()).toEqual(expect.arrayContaining(LOADER_REVEAL.split(" ")));
  });
});

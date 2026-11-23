import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import OSpinner from "./OSpinner.vue";

describe("OSpinner", () => {
  it("renders a spinning 2 px ring with an accent arc", () => {
    const ring = mount(OSpinner).get("[data-test='o-spinner-ring']");
    expect(ring.classes()).toEqual(
      expect.arrayContaining(["animate-spin", "rounded-full", "border-2", "border-t-spinner"]),
    );
  });

  it.each([
    ["sm", "size-3"],
    ["md", "size-4"],
    ["lg", "size-5"],
  ] as const)("size %s is %s", (size, cls) => {
    expect(mount(OSpinner, { props: { size } }).classes()).toContain(cls);
  });

  it("defaults to md (16 px)", () => {
    expect(mount(OSpinner).classes()).toContain("size-4");
  });

  it("keeps spinning under reduced motion", () => {
    expect(mount(OSpinner).get("[data-test='o-spinner-ring']").classes()).toContain(
      "o2-motion-keep",
    );
  });

  it("is a polite status with an accessible name", () => {
    const ring = mount(OSpinner).get("span");
    expect(ring.attributes("role")).toBe("status");
    expect(ring.attributes("aria-live")).toBe("polite");
    expect(ring.attributes("aria-label")).toBeTruthy();
  });

  it("waits out the loader delay before it shows", () => {
    const classes = mount(OSpinner).classes();
    expect(classes).toContain("delay-300");
    expect(classes).toContain("fade-in-0");
  });

  it("shows at once when instant", () => {
    expect(mount(OSpinner, { props: { instant: true } }).classes()).not.toContain("delay-300");
  });
});

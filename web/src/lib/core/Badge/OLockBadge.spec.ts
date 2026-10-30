import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import OLockBadge from "./OLockBadge.vue";
import { raw } from "@/types/i18n";

describe("OLockBadge", () => {
  it("renders a gold lock", () => {
    const wrapper = mount(OLockBadge);
    expect(wrapper.find(".text-icon-locked").exists()).toBe(true);
  });

  it("renders screen-reader text only when a label is given", () => {
    expect(mount(OLockBadge).find(".sr-only").exists()).toBe(false);
    const labelled = mount(OLockBadge, { props: { label: raw("Locked: needs X") } });
    expect(labelled.get(".sr-only").text()).toBe("Locked: needs X");
  });

  it("forwards attributes to its root", () => {
    const wrapper = mount(OLockBadge, { attrs: { "data-test": "badge" } });
    expect(wrapper.get("[data-test='badge']").classes()).toContain("absolute");
  });
});

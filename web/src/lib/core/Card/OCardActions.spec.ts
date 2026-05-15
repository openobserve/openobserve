import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import OCardActions from "./OCardActions.vue";

describe("OCardActions", () => {
  it("renders slot content", () => {
    const wrapper = mount(OCardActions, {
      slots: { default: "<button>Save</button>" },
    });
    expect(wrapper.html()).toContain("Save");
  });

  it("defaults to right alignment", () => {
    const wrapper = mount(OCardActions);
    expect(wrapper.classes().join(" ")).toContain("tw:justify-end");
  });

  it("applies left alignment", () => {
    const wrapper = mount(OCardActions, { props: { align: "left" } });
    expect(wrapper.classes().join(" ")).toContain("tw:justify-start");
  });

  it("applies center alignment", () => {
    const wrapper = mount(OCardActions, { props: { align: "center" } });
    expect(wrapper.classes().join(" ")).toContain("tw:justify-center");
  });

  it("applies between alignment", () => {
    const wrapper = mount(OCardActions, { props: { align: "between" } });
    expect(wrapper.classes().join(" ")).toContain("tw:justify-between");
  });

  it("always includes gap and padding classes", () => {
    const wrapper = mount(OCardActions);
    const classes = wrapper.classes().join(" ");
    expect(classes).toContain("tw:gap-2");
    expect(classes).toContain("tw:px-4");
    expect(classes).toContain("tw:py-3");
  });

  it("forwards extra class via attrs", () => {
    const wrapper = mount(OCardActions, { attrs: { class: "tw:shrink-0" } });
    expect(wrapper.classes()).toContain("tw:shrink-0");
  });
});

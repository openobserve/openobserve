import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import OCardSection from "./OCardSection.vue";

describe("OCardSection", () => {
  it("renders slot content", () => {
    const wrapper = mount(OCardSection, { slots: { default: "Body text" } });
    expect(wrapper.text()).toBe("Body text");
  });

  it("applies no role classes when role is omitted", () => {
    const wrapper = mount(OCardSection);
    const classes = wrapper.classes().join(" ");
    expect(classes).not.toContain("tw:flex-1");
    expect(classes).not.toContain("tw:flex-none");
    expect(classes).not.toContain("tw:p-4");
  });

  it("applies header role classes", () => {
    const wrapper = mount(OCardSection, { props: { role: "header" } });
    const classes = wrapper.classes().join(" ");
    expect(classes).toContain("tw:flex");
    expect(classes).toContain("tw:items-center");
    expect(classes).toContain("tw:flex-none");
    expect(classes).toContain("tw:px-4");
  });

  it("applies body role classes", () => {
    const wrapper = mount(OCardSection, { props: { role: "body" } });
    const classes = wrapper.classes().join(" ");
    expect(classes).toContain("tw:flex-1");
    expect(classes).toContain("tw:p-4");
    expect(classes).not.toContain("tw:overflow-y-auto");
  });

  it("applies scrollable class when role=body and scrollable=true", () => {
    const wrapper = mount(OCardSection, {
      props: { role: "body", scrollable: true },
    });
    expect(wrapper.classes().join(" ")).toContain("tw:overflow-y-auto");
  });

  it("does not add overflow when scrollable without role", () => {
    const wrapper = mount(OCardSection, { props: { scrollable: true } });
    expect(wrapper.classes().join(" ")).not.toContain("tw:overflow-y-auto");
  });

  it("applies footer role classes", () => {
    const wrapper = mount(OCardSection, { props: { role: "footer" } });
    const classes = wrapper.classes().join(" ");
    expect(classes).toContain("tw:flex-none");
    expect(classes).toContain("tw:px-4");
  });

  it("forwards extra class via attrs", () => {
    const wrapper = mount(OCardSection, {
      props: { role: "body" },
      attrs: { class: "tw:p-0" },
    });
    expect(wrapper.classes()).toContain("tw:p-0");
  });
});

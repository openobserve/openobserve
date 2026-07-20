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
    expect(classes).not.toContain("flex-1");
    expect(classes).not.toContain("flex-none");
    expect(classes).not.toContain("p-4");
  });

  it("applies header role classes", () => {
    const wrapper = mount(OCardSection, { props: { role: "header" } });
    const classes = wrapper.classes().join(" ");
    expect(classes).toContain("flex");
    expect(classes).toContain("items-center");
    expect(classes).toContain("flex-none");
    expect(classes).toContain("px-4");
  });

  it("applies body role classes", () => {
    const wrapper = mount(OCardSection, { props: { role: "body" } });
    const classes = wrapper.classes().join(" ");
    expect(classes).toContain("flex-1");
    expect(classes).toContain("p-4");
    expect(classes).not.toContain("overflow-y-auto");
  });

  it("applies scrollable class when role=body and scrollable=true", () => {
    const wrapper = mount(OCardSection, {
      props: { role: "body", scrollable: true },
    });
    expect(wrapper.classes().join(" ")).toContain("overflow-y-auto");
  });

  it("does not add overflow when scrollable without role", () => {
    const wrapper = mount(OCardSection, { props: { scrollable: true } });
    expect(wrapper.classes().join(" ")).not.toContain("overflow-y-auto");
  });

  it("applies footer role classes", () => {
    const wrapper = mount(OCardSection, { props: { role: "footer" } });
    const classes = wrapper.classes().join(" ");
    expect(classes).toContain("flex-none");
    expect(classes).toContain("px-4");
  });

  it("forwards extra class via attrs", () => {
    const wrapper = mount(OCardSection, {
      props: { role: "body" },
      attrs: { class: "p-0" },
    });
    expect(wrapper.classes()).toContain("p-0");
  });
});

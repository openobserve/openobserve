import { describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";

import ConstrainedPage from "./ConstrainedPage.vue";

const content = (wrapper: VueWrapper) => wrapper.get('[data-test="constrained-page"] > div');

describe("ConstrainedPage", () => {
  it("centers the reading column by default", () => {
    const wrapper = mount(ConstrainedPage);
    expect(content(wrapper).classes()).toContain("mx-auto");
  });

  it("pins start-aligned forms to the logical reading edge", () => {
    const wrapper = mount(ConstrainedPage, { props: { align: "start" } });
    const classes = content(wrapper).classes();

    expect(classes).toContain("me-auto");
    expect(classes).not.toContain("mr-auto");
  });
});

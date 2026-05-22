import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import OSelect from "./OSelect.vue";

describe("debug", () => {
  it("shows full html", () => {
    const wrapper = mount(OSelect, {
      props: { placeholder: "Pick one" },
    });
    expect(wrapper.html()).toBe("IMPOSSIBLE");
  });
  it("shows error message full html", () => {
    const wrapper = mount(OSelect, {
      props: { errorMessage: "Selection required" },
    });
    expect(wrapper.html()).toBe("IMPOSSIBLE");
  });
});

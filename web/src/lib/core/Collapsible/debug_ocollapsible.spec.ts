import { describe, it, expect } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import OCollapsible from "./OCollapsible.vue";

describe("debug", () => {
  it("click and check state after flushPromises", async () => {
    const wrapper = mount(OCollapsible, { props: { label: "Test" } });
    const btn = wrapper.find("button");
    await btn.trigger("click");
    await flushPromises();
    expect(wrapper.html()).toBe("IMPOSSIBLE_1");
  });

  it("defaultOpen html", () => {
    const wrapper = mount(OCollapsible, { props: { label: "Test", defaultOpen: true } });
    expect(wrapper.html()).toBe("IMPOSSIBLE_2");
  });

  it("modelValue=true html", () => {
    const wrapper = mount(OCollapsible, { props: { label: "Test", modelValue: true } });
    expect(wrapper.html()).toBe("IMPOSSIBLE_3");
  });
});

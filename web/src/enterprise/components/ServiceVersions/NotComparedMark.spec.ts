// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import NotComparedMark from "./NotComparedMark.vue";
const tooltip = { name: "OTooltip", props: ["content"], template: "<span />" };
function render(reason?: string) {
  return mount(NotComparedMark, {
    props: reason === undefined ? {} : { reason },
    global: { stubs: { OTooltip: tooltip } },
  });
}
describe("not-compared marker", () => {
  it("says not compared by default", () => {
    const wrapper = render();
    expect(wrapper.find(".sr-only").text()).toBe("not compared");
    expect(wrapper.findComponent({ name: "OTooltip" }).props("content")).toBe("not compared");
  });
  it("carries a caller's reason in the hidden label and the hover alike", () => {
    const wrapper = render("No deploy recorded");
    expect(wrapper.text()).toContain("—");
    expect(wrapper.find(".sr-only").text()).toBe("No deploy recorded");
    expect(wrapper.findComponent({ name: "OTooltip" }).props("content")).toBe("No deploy recorded");
  });
});

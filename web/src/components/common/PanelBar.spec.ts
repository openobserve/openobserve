import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import PanelBar from "./PanelBar.vue";

describe("PanelBar", () => {
  const createWrapper = (options = {}) =>
    mount(PanelBar, { slots: { default: "Panel title" }, ...options });

  it("is the 40 px panel header: subtle bottom border, no tint", () => {
    const classes = createWrapper().classes();
    expect(classes).toEqual(
      expect.arrayContaining(["min-h-10", "border-b", "border-border-subtle"]),
    );
    expect(classes.some((c) => c.startsWith("bg-"))).toBe(false);
  });

  it("owns the 13/600 title type, so a bare label needs no wrapper", () => {
    expect(createWrapper().classes()).toEqual(
      expect.arrayContaining(["text-compact", "text-text-heading", "font-semibold"]),
    );
  });

  it("renders whatever the consumer puts in the bar", () => {
    const wrapper = createWrapper({
      slots: { default: '<span class="hint">2d ago</span>' },
    });
    expect(wrapper.find(".hint").text()).toBe("2d ago");
  });

  it("merges consumer layout classes with its own", () => {
    const classes = createWrapper({ attrs: { class: "w-full flex-nowrap" } }).classes();
    expect(classes).toEqual(expect.arrayContaining(["w-full", "flex-nowrap", "min-h-10"]));
  });

  it("passes attributes such as data-test through to the bar element", () => {
    const wrapper = createWrapper({ attrs: { "data-test": "dashboard-panel-bar" } });
    expect(wrapper.attributes("data-test")).toBe("dashboard-panel-bar");
  });
});

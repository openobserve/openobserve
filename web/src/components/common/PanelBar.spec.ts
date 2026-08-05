import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import PanelBar from "./PanelBar.vue";

describe("PanelBar", () => {
  const createWrapper = (options = {}) =>
    mount(PanelBar, { slots: { default: "Panel title" }, ...options });

  it("carries the header tint, so every chart bar reads as a header", () => {
    // The whole reason this component exists: the tint used to be a copied
    // class string and three of the five bars silently missed it.
    expect(createWrapper().classes()).toContain("bg-panel-bar-bg");
  });

  it("owns the bar's box — height, padding and bottom border", () => {
    const classes = createWrapper().classes();
    expect(classes).toEqual(
      expect.arrayContaining(["min-h-7", "border-b", "border-panel-bar-border", "px-2", "py-1"]),
    );
  });

  it("divides itself from the body with its OWN border, not the app default", () => {
    // At this fill, `border-default` IS the fill colour in light mode (1.00:1)
    // and the header's bottom edge disappears. The bar therefore carries a
    // border token that moves with the fill.
    const classes = createWrapper().classes();
    expect(classes).toContain("border-panel-bar-border");
    expect(classes).not.toContain("border-border-default");
  });

  it("owns the title type, so a bare label needs no wrapper", () => {
    // SloPreviewChart passes its label as raw text with no inner element.
    const classes = createWrapper().classes();
    expect(classes).toEqual(
      expect.arrayContaining(["text-compact", "text-text-heading", "font-medium"]),
    );
  });

  it("renders whatever the consumer puts in the bar", () => {
    const wrapper = createWrapper({
      slots: { default: '<span class="hint">2d ago</span>' },
    });
    expect(wrapper.find(".hint").text()).toBe("2d ago");
  });

  it("MERGES consumer layout classes with its own instead of replacing them", () => {
    // Consumers pass layout through `class` (PanelContainer sends
    // `rounded-t-default w-full flex-nowrap`, the SLO bars send
    // `justify-between`). If fallthrough ever stopped merging, every bar would
    // lose its tint and border at once — which is exactly how the unresolved
    // component registration was caught.
    const wrapper = createWrapper({
      attrs: { class: "rounded-t-default w-full flex-nowrap" },
    });
    const classes = wrapper.classes();
    expect(classes).toEqual(expect.arrayContaining(["rounded-t-default", "w-full", "flex-nowrap"]));
    expect(classes).toEqual(
      expect.arrayContaining(["bg-panel-bar-bg", "border-panel-bar-border"]),
    );
  });

  it("passes attributes such as data-test through to the bar element", () => {
    const wrapper = createWrapper({ attrs: { "data-test": "dashboard-panel-bar" } });
    expect(wrapper.attributes("data-test")).toBe("dashboard-panel-bar");
  });
});

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import OIcon from "./OIcon.vue";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mountIcon(options: Parameters<typeof mount>[1] = {}) {
  return mount(OIcon, options);
}

// ---------------------------------------------------------------------------
// Debug
// ---------------------------------------------------------------------------
describe("OIcon — debug", () => {
  it("debug: log html, element, classes", () => {
    const wrapper = mountIcon({ props: { name: "search" } });
    const el = wrapper.element as HTMLElement;
    console.log("HTML:", wrapper.html());
    console.log("tagName:", el.tagName);
    console.log("className:", el.className);
    console.log("classes():", wrapper.classes());
    console.log("instanceof Element:", el instanceof Element);
    expect(true).toBe(true); // always pass — debug only
  });
});

// ---------------------------------------------------------------------------
// Font icon mode
// ---------------------------------------------------------------------------

describe("OIcon — font icon", () => {
  it("renders the material-icons class when name is given", () => {
    const wrapper = mountIcon({ props: { name: "search" } });
    expect(wrapper.classes()).toContain("material-icons");
  });

  it("renders the icon name as text content (glyph ligature)", () => {
    const wrapper = mountIcon({ props: { name: "search" } });
    expect(wrapper.text()).toBe("search");
  });

  it("does not render an <img> or a <slot> element", () => {
    const wrapper = mountIcon({ props: { name: "info" } });
    expect(wrapper.find("img").exists()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Image icon mode  (img: prefix)
// ---------------------------------------------------------------------------

describe("OIcon — image icon", () => {
  it("renders an <img> element for img:-prefixed names", () => {
    const wrapper = mountIcon({ props: { name: "img:/icons/logo.svg" } });
    expect(wrapper.find("img").exists()).toBe(true);
  });

  it("strips the img: prefix from the src attribute", () => {
    const wrapper = mountIcon({ props: { name: "img:/icons/logo.svg" } });
    expect(wrapper.find("img").attributes("src")).toBe("/icons/logo.svg");
  });

  it("uses an empty alt attribute (decorative)", () => {
    const wrapper = mountIcon({ props: { name: "img:/icons/logo.svg" } });
    expect(wrapper.find("img").attributes("alt")).toBe("");
  });

  it("does NOT add the material-icons class", () => {
    const wrapper = mountIcon({ props: { name: "img:/icons/logo.svg" } });
    expect(wrapper.classes()).not.toContain("material-icons");
  });
});

// ---------------------------------------------------------------------------
// Slot icon mode
// ---------------------------------------------------------------------------

describe("OIcon — slot icon", () => {
  it("renders default slot content when no name is given", () => {
    const wrapper = mountIcon({
      slots: { default: '<svg data-testid="custom-svg" />' },
    });
    expect(wrapper.find("[data-testid='custom-svg']").exists()).toBe(true);
  });

  it("does NOT add the material-icons class", () => {
    const wrapper = mountIcon({
      slots: { default: "<svg />" },
    });
    expect(wrapper.classes()).not.toContain("material-icons");
  });
});

// ---------------------------------------------------------------------------
// Size prop
// ---------------------------------------------------------------------------

describe("OIcon — size", () => {
  it.each([
    ["xs", "tw:text-icon-xs"],
    ["sm", "tw:text-icon-sm"],
    ["md", "tw:text-icon-md"],
    ["lg", "tw:text-icon-lg"],
    ["xl", "tw:text-icon-xl"],
  ])(
    "named size '%s' adds the token utility class '%s' instead of an inline style",
    (size, expectedClass) => {
      const wrapper = mountIcon({ props: { name: "info", size } });
      expect(wrapper.classes()).toContain(expectedClass);
      // Named sizes must NOT fall through to inline style
      expect((wrapper.element as HTMLElement).style.fontSize).toBe("");
    },
  );

  it("passes through a raw px value as inline font-size (no token class)", () => {
    const wrapper = mountIcon({ props: { name: "info", size: "14px" } });
    expect((wrapper.element as HTMLElement).style.fontSize).toBe("14px");
    // Should not add any icon-size class
    expect(wrapper.classes().join(" ")).not.toContain("text-icon-");
  });

  it("passes through a rem value as inline font-size", () => {
    const wrapper = mountIcon({ props: { name: "info", size: "1.5rem" } });
    expect((wrapper.element as HTMLElement).style.fontSize).toBe("1.5rem");
  });

  it("passes through an em value as inline font-size", () => {
    const wrapper = mountIcon({ props: { name: "info", size: "0.875em" } });
    expect((wrapper.element as HTMLElement).style.fontSize).toBe("0.875em");
  });

  it("applies no size class or inline style when size is omitted", () => {
    const wrapper = mountIcon({ props: { name: "info" } });
    expect((wrapper.element as HTMLElement).style.fontSize).toBe("");
    expect(wrapper.classes().join(" ")).not.toContain("text-icon-");
  });
});

// ---------------------------------------------------------------------------
// Attribute pass-through
// ---------------------------------------------------------------------------

describe("OIcon — attribute pass-through", () => {
  it("forwards aria-hidden attribute to the root element", () => {
    const wrapper = mountIcon({
      props: { name: "search" },
      attrs: { "aria-hidden": "true" },
    });
    expect(wrapper.attributes("aria-hidden")).toBe("true");
  });

  it("forwards aria-label attribute to the root element", () => {
    const wrapper = mountIcon({
      props: { name: "search" },
      attrs: { "aria-label": "Search" },
    });
    expect(wrapper.attributes("aria-label")).toBe("Search");
  });

  it("forwards data-* attributes to the root element", () => {
    const wrapper = mountIcon({
      props: { name: "info" },
      attrs: { "data-testid": "my-icon" },
    });
    expect(wrapper.attributes("data-testid")).toBe("my-icon");
  });
});

// ---------------------------------------------------------------------------
// Base classes
// ---------------------------------------------------------------------------

describe("OIcon — base classes", () => {
  it("always renders tw:inline-flex and layout utilities", () => {
    const wrapper = mountIcon({ props: { name: "info" } });
    // Verify the key layout classes are present (prefix stripped in rendered HTML)
    const classList = wrapper.classes().join(" ");
    expect(classList).toContain("inline-flex");
    expect(classList).toContain("shrink-0");
    expect(classList).toContain("leading-none");
    expect(classList).toContain("select-none");
  });
});

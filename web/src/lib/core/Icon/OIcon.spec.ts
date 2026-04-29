import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import OIcon from "./OIcon.vue";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mountIcon(options: Parameters<typeof mount>[1] = {}) {
  return mount(OIcon, options);
}

/**
 * OIcon has a root-level HTML comment in its template (documentation comment
 * that explains the three rendering modes). In Vue 3, a root-level comment
 * node + the <span> element makes the component a Fragment (multi-root).
 *
 * For Fragment components, Vue Test Utils returns the mounting container <div>
 * as `wrapper.element` instead of the component's actual root element.
 *
 * To assert on the rendered <span> and its classes/attributes we must use
 * `wrapper.find('span')` which searches inside the fragment container.
 */
function findRoot(wrapper: ReturnType<typeof mountIcon>) {
  return wrapper.find("span");
}

// ---------------------------------------------------------------------------
// Debug / structure
// ---------------------------------------------------------------------------

describe("OIcon — debug", () => {
  it("debug: log html, element, classes", () => {
    const wrapper = mountIcon({ props: { name: "search" } });
    // OIcon is a Fragment due to its root-level template comment.
    // The actual icon element is the <span> inside the fragment.
    const root = findRoot(wrapper);
    expect(root.exists()).toBe(true);
    expect((root.element as HTMLElement).tagName).toBe("SPAN");
    expect((root.element as HTMLElement).className).toContain("material-icons");
  });
});

// ---------------------------------------------------------------------------
// Font icon mode
// ---------------------------------------------------------------------------

describe("OIcon — font icon", () => {
  it("renders the material-icons class when name is given", () => {
    const wrapper = mountIcon({ props: { name: "search" } });
    // The 'material-icons' class triggers the icon font glyph rendering.
    expect(findRoot(wrapper).classes()).toContain("material-icons");
  });

  it("renders the icon name as text content (glyph ligature)", () => {
    const wrapper = mountIcon({ props: { name: "search" } });
    // The text node IS the glyph — Material Icons uses ligatures.
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
    expect(findRoot(wrapper).classes()).not.toContain("material-icons");
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
    expect(findRoot(wrapper).classes()).not.toContain("material-icons");
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
      // Named sizes map to token utility classes — never inline styles.
      expect(findRoot(wrapper).classes()).toContain(expectedClass);
      // Named sizes must NOT fall through to inline style
      expect((findRoot(wrapper).element as HTMLElement).style.fontSize).toBe(
        "",
      );
    },
  );

  it("applies no size class when size is omitted", () => {
    const wrapper = mountIcon({ props: { name: "info" } });
    expect(findRoot(wrapper).classes().join(" ")).not.toContain("text-icon-");
  });
});

// ---------------------------------------------------------------------------
// Attribute pass-through
// ---------------------------------------------------------------------------

describe("OIcon — attribute pass-through", () => {
  // OIcon uses `inheritAttrs: false` + `v-bind="$attrs"` on the <span>
  // so that consumers can attach aria / data attributes directly.

  it("forwards aria-hidden attribute to the root element", () => {
    const wrapper = mountIcon({
      props: { name: "search" },
      attrs: { "aria-hidden": "true" },
    });
    expect(findRoot(wrapper).attributes("aria-hidden")).toBe("true");
  });

  it("forwards aria-label attribute to the root element", () => {
    const wrapper = mountIcon({
      props: { name: "search" },
      attrs: { "aria-label": "Search" },
    });
    expect(findRoot(wrapper).attributes("aria-label")).toBe("Search");
  });

  it("forwards data-* attributes to the root element", () => {
    const wrapper = mountIcon({
      props: { name: "info" },
      attrs: { "data-testid": "my-icon" },
    });
    expect(findRoot(wrapper).attributes("data-testid")).toBe("my-icon");
  });
});

// ---------------------------------------------------------------------------
// Base classes
// ---------------------------------------------------------------------------

describe("OIcon — base classes", () => {
  it("always renders tw:inline-flex and layout utilities", () => {
    const wrapper = mountIcon({ props: { name: "info" } });
    // These classes are always present regardless of the icon mode.
    const classList = findRoot(wrapper).classes().join(" ");
    expect(classList).toContain("tw:inline-flex");
    expect(classList).toContain("tw:shrink-0");
    expect(classList).toContain("tw:leading-none");
    expect(classList).toContain("tw:select-none");
  });
});

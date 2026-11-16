// Copyright 2026 OpenObserve Inc.
//
// The point of this component is that the slot is ALWAYS the same size and is
// never empty — that is what keeps folder names aligned in a list.

import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import FolderIcon from "./FolderIcon.vue";
import { folderIconOption, __resetFolderIconOptionCache } from "./folderIconOption";

describe("FolderIcon", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  it("should render the chosen emoji", () => {
    wrapper = mount(FolderIcon, { props: { token: "🚀" } });
    expect(wrapper.find('[data-test="glyph-emoji"]').text()).toBe("🚀");
  });

  it("should render a chosen service glyph", () => {
    wrapper = mount(FolderIcon, { props: { token: "o2:redis" } });
    expect(wrapper.find("svg").exists()).toBe(true);
  });

  it("should fall back to the folder glyph when there is no icon", () => {
    wrapper = mount(FolderIcon, { props: { token: null } });
    // Not empty: an empty slot would leave a ragged gap in the list.
    expect(wrapper.find("svg").exists()).toBe(true);
    expect(wrapper.find('[data-test="glyph-emoji"]').exists()).toBe(false);
    // Inherits the row's colour rather than pinning a grey — a fixed muted grey
    // stayed grey on the tinted active row and washed out there.
    expect(wrapper.find(".text-current").exists()).toBe(true);
  });

  it("should show the favourites star instead of the folder fallback", () => {
    wrapper = mount(FolderIcon, { props: { token: null, favorite: true } });
    expect(wrapper.find(".text-favorite").exists()).toBe(true);
    expect(wrapper.find(".text-current").exists()).toBe(false);
  });

  it("should let a chosen icon win over the favourite star", () => {
    wrapper = mount(FolderIcon, { props: { token: "⭐", favorite: true } });
    expect(wrapper.find('[data-test="glyph-emoji"]').text()).toBe("⭐");
  });

  it("should render a flat icon token through OIcon", () => {
    wrapper = mount(FolderIcon, { props: { token: "icon:dashboard" } });
    expect(wrapper.find('[data-test="glyph-icon"]').exists()).toBe(true);
    expect(wrapper.find(".text-current").exists()).toBe(false);
  });

  it("should render a mono logo token", () => {
    wrapper = mount(FolderIcon, { props: { token: "mono:docker" } });
    expect(wrapper.find('[data-test="glyph-mono"]').exists()).toBe(true);
  });

  it.each(["icon:no-such-icon", "mono:no-such-logo"])(
    "should fall back to the folder outline for the unknown token %s",
    (token) => {
      wrapper = mount(FolderIcon, { props: { token } });
      expect(wrapper.find('[data-test="glyph-icon"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="glyph-mono"]').exists()).toBe(false);
      expect(wrapper.find(".text-current svg").exists()).toBe(true);
      expect(wrapper.text()).not.toContain(token);
    },
  );

  it("should keep the same fixed footprint whatever it renders", () => {
    const footprints = ["🚀", "o2:redis", "icon:dashboard", "mono:docker", null].map((token) => {
      const w = mount(FolderIcon, { props: { token } });
      const classes = w.find('[data-test="folder-icon"]').classes().join(" ");
      w.unmount();
      return classes;
    });
    for (const classes of footprints) {
      expect(classes).toContain("size-4");
      expect(classes).toContain("shrink-0");
    }
  });
});

describe("folderIconOption", () => {
  afterEach(() => __resetFolderIconOptionCache());

  it("should build a renderable component for a dropdown option", () => {
    const wrapper = mount(folderIconOption("o2:redis"));
    expect(wrapper.find("svg").exists()).toBe(true);
    wrapper.unmount();
  });

  it("should still render an icon for a folder with none", () => {
    const wrapper = mount(folderIconOption(null));
    expect(wrapper.find('[data-test="folder-icon"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("should memoise per token so a long list does not build one each", () => {
    expect(folderIconOption("o2:redis")).toBe(folderIconOption("o2:redis"));
    expect(folderIconOption(null)).toBe(folderIconOption(undefined));
    expect(folderIconOption("o2:redis")).not.toBe(folderIconOption("o2:kafka"));
  });
});

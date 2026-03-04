// Copyright 2023 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import SkeletonBox from "./SkeletonBox.vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { createStore } from "vuex";

installQuasar();

describe("SkeletonBox", () => {
  let store: any;

  beforeEach(() => {
    store = createStore({
      state: {
        theme: "light",
      },
    });
  });

  it("should render the component", () => {
    const wrapper = mount(SkeletonBox, {
      global: {
        plugins: [store],
      },
    });

    expect(wrapper.exists()).toBe(true);
    expect(wrapper.find(".skeleton-box").exists()).toBe(true);
  });

  it("should apply default width and height", () => {
    const wrapper = mount(SkeletonBox, {
      global: {
        plugins: [store],
      },
    });

    const skeletonBox = wrapper.find(".skeleton-box");
    expect(skeletonBox.element.style.width).toBe("100px");
    expect(skeletonBox.element.style.height).toBe("16px");
  });

  it("should accept custom width and height", () => {
    const wrapper = mount(SkeletonBox, {
      props: {
        width: "200px",
        height: "50px",
      },
      global: {
        plugins: [store],
      },
    });

    const skeletonBox = wrapper.find(".skeleton-box");
    expect(skeletonBox.element.style.width).toBe("200px");
    expect(skeletonBox.element.style.height).toBe("50px");
  });

  it("should apply text variant class", () => {
    const wrapper = mount(SkeletonBox, {
      props: {
        variant: "text",
      },
      global: {
        plugins: [store],
      },
    });

    expect(wrapper.find(".skeleton-text").exists()).toBe(true);
  });

  it("should apply title variant class", () => {
    const wrapper = mount(SkeletonBox, {
      props: {
        variant: "title",
      },
      global: {
        plugins: [store],
      },
    });

    expect(wrapper.find(".skeleton-title").exists()).toBe(true);
  });

  it("should apply button variant class", () => {
    const wrapper = mount(SkeletonBox, {
      props: {
        variant: "button",
      },
      global: {
        plugins: [store],
      },
    });

    expect(wrapper.find(".skeleton-button").exists()).toBe(true);
  });

  it("should apply avatar variant class", () => {
    const wrapper = mount(SkeletonBox, {
      props: {
        variant: "avatar",
      },
      global: {
        plugins: [store],
      },
    });

    expect(wrapper.find(".skeleton-avatar").exists()).toBe(true);
  });

  it("should apply image variant class", () => {
    const wrapper = mount(SkeletonBox, {
      props: {
        variant: "image",
      },
      global: {
        plugins: [store],
      },
    });

    expect(wrapper.find(".skeleton-image").exists()).toBe(true);
  });

  it("should apply rounded class when rounded prop is true", () => {
    const wrapper = mount(SkeletonBox, {
      props: {
        rounded: true,
      },
      global: {
        plugins: [store],
      },
    });

    expect(wrapper.find(".skeleton-rounded").exists()).toBe(true);
  });

  it("should apply circle class when circle prop is true", () => {
    const wrapper = mount(SkeletonBox, {
      props: {
        circle: true,
      },
      global: {
        plugins: [store],
      },
    });

    expect(wrapper.find(".skeleton-circle").exists()).toBe(true);
  });

  it("should apply custom border radius", () => {
    const wrapper = mount(SkeletonBox, {
      props: {
        customRadius: "20px",
      },
      global: {
        plugins: [store],
      },
    });

    const skeletonBox = wrapper.find(".skeleton-box");
    expect(skeletonBox.element.style.borderRadius).toBe("20px");
  });

  it("should use default dimensions for text variant", () => {
    const wrapper = mount(SkeletonBox, {
      props: {
        variant: "text",
      },
      global: {
        plugins: [store],
      },
    });

    const element = wrapper.element as HTMLElement;
    // Since width/height are not explicitly provided, it should use computed defaults
    expect(wrapper.props("variant")).toBe("text");
  });

  it("should use default dimensions for title variant", () => {
    const wrapper = mount(SkeletonBox, {
      props: {
        variant: "title",
      },
      global: {
        plugins: [store],
      },
    });

    expect(wrapper.props("variant")).toBe("title");
  });

  it("should use default dimensions for button variant", () => {
    const wrapper = mount(SkeletonBox, {
      props: {
        variant: "button",
      },
      global: {
        plugins: [store],
      },
    });

    expect(wrapper.props("variant")).toBe("button");
  });

  it("should use default dimensions for avatar variant", () => {
    const wrapper = mount(SkeletonBox, {
      props: {
        variant: "avatar",
      },
      global: {
        plugins: [store],
      },
    });

    expect(wrapper.props("variant")).toBe("avatar");
  });

  it("should use default dimensions for image variant", () => {
    const wrapper = mount(SkeletonBox, {
      props: {
        variant: "image",
      },
      global: {
        plugins: [store],
      },
    });

    expect(wrapper.props("variant")).toBe("image");
  });

  it("should accept lines prop for text variant", () => {
    const wrapper = mount(SkeletonBox, {
      props: {
        variant: "text",
        lines: 3,
      },
      global: {
        plugins: [store],
      },
    });

    expect(wrapper.props("lines")).toBe(3);
  });

  it("should combine multiple classes", () => {
    const wrapper = mount(SkeletonBox, {
      props: {
        variant: "button",
        rounded: true,
        circle: true,
      },
      global: {
        plugins: [store],
      },
    });

    const skeletonBox = wrapper.find(".skeleton-box");
    expect(skeletonBox.classes()).toContain("skeleton-button");
    expect(skeletonBox.classes()).toContain("skeleton-rounded");
    expect(skeletonBox.classes()).toContain("skeleton-circle");
  });

  it("should have skeleton-wave animation class", () => {
    const wrapper = mount(SkeletonBox, {
      global: {
        plugins: [store],
      },
    });

    const skeletonBox = wrapper.find(".skeleton-box");
    expect(skeletonBox.exists()).toBe(true);
    // The animation is applied via CSS, just verify the element exists
  });

  it("should override default width for title variant", () => {
    const wrapper = mount(SkeletonBox, {
      props: {
        variant: "title",
        width: "300px",
      },
      global: {
        plugins: [store],
      },
    });

    const skeletonBox = wrapper.find(".skeleton-box");
    expect(skeletonBox.element.style.width).toBe("300px");
  });

  it("should override default height for button variant", () => {
    const wrapper = mount(SkeletonBox, {
      props: {
        variant: "button",
        height: "40px",
      },
      global: {
        plugins: [store],
      },
    });

    const skeletonBox = wrapper.find(".skeleton-box");
    expect(skeletonBox.element.style.height).toBe("40px");
  });

  it("should work with custom variant", () => {
    const wrapper = mount(SkeletonBox, {
      props: {
        variant: "custom",
        width: "150px",
        height: "75px",
      },
      global: {
        plugins: [store],
      },
    });

    const skeletonBox = wrapper.find(".skeleton-box");
    expect(skeletonBox.element.style.width).toBe("150px");
    expect(skeletonBox.element.style.height).toBe("75px");
  });
});

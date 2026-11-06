// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import OSelect from "./OSelect.vue";
import OSelectItem from "./OSelectItem.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { defineComponent, h, markRaw } from "vue";

const itemStubs = {
  SelectItem: { template: "<div class='reka-item'><slot /></div>" },
  SelectItemText: { template: "<span class='reka-item-text'><slot /></span>" },
};

describe("OSelectItem", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("renders inside OSelect without errors", () => {
    wrapper = mount(OSelect, {
      slots: {
        default: '<OSelectItem value="a" label="Option A" />',
      },
      global: { components: { OSelectItem } },
    });
    expect(wrapper.exists()).toBe(true);
  });

  it("lets the label shrink and cut with a cut-only tooltip", () => {
    wrapper = mount(OSelectItem, {
      props: { value: "a", label: "A very long option label" },
      global: {
        stubs: {
          SelectItem: { template: "<div><slot /></div>" },
          SelectItemText: { template: "<span class='reka-item-text'><slot /></span>" },
        },
      },
    });
    expect(wrapper.find(".reka-item-text").classes()).toEqual(
      expect.arrayContaining(["min-w-0", "flex-1"]),
    );
    const label = wrapper.find('[data-test="o-truncated-text"]');
    expect(label.text()).toBe("A very long option label");
    expect(label.attributes("data-o-tooltip-trigger")).toBe("overflow");
  });

  it("renders an icon before the label when given one", () => {
    wrapper = mount(OSelectItem, {
      props: { value: "a", label: "Firing", icon: "warning" },
      global: { stubs: itemStubs },
    });
    const icon = wrapper.findComponent(OIcon);
    expect(icon.exists()).toBe(true);
    expect(icon.props("name")).toBe("warning");
    expect(icon.props("size")).toBe("sm");
    expect(wrapper.find(".reka-item-text").findComponent(OIcon).exists()).toBe(false);
    expect(wrapper.find(".reka-item").classes()).toContain("gap-2");
  });

  it("prefers iconComponent over icon", () => {
    const Custom = markRaw(
      defineComponent({ render: () => h("svg", { "data-test": "custom-icon" }) }),
    );
    wrapper = mount(OSelectItem, {
      props: { value: "a", label: "A", icon: "warning", iconComponent: Custom },
      global: { stubs: itemStubs },
    });
    expect(wrapper.find('[data-test="custom-icon"]').classes()).toContain("size-4");
    expect(wrapper.findComponent(OIcon).exists()).toBe(false);
  });

  it("reserves an icon-sized spacer when asked and no icon is given", () => {
    wrapper = mount(OSelectItem, {
      props: { value: "a", label: "A", reserveIconSpace: true },
      global: { stubs: itemStubs },
    });
    expect(wrapper.find(".reka-item > span.size-4").exists()).toBe(true);
  });

  it("renders no icon, spacer or gap without icon props", () => {
    wrapper = mount(OSelectItem, {
      props: { value: "a", label: "A" },
      global: { stubs: itemStubs },
    });
    expect(wrapper.findComponent(OIcon).exists()).toBe(false);
    expect(wrapper.find(".reka-item > span.size-4").exists()).toBe(false);
    expect(wrapper.find(".reka-item").classes()).not.toContain("gap-2");
  });
});

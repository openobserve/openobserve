// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import OSelect from "./OSelect.vue";
import OSelectItem from "./OSelectItem.vue";

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
});

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
});

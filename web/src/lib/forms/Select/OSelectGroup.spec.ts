// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import OSelect from "./OSelect.vue";
import OSelectGroup from "./OSelectGroup.vue";
import OSelectItem from "./OSelectItem.vue";

describe("OSelectGroup", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("renders label and items inside OSelect without errors", () => {
    wrapper = mount(OSelect, {
      slots: {
        default: `
          <OSelectGroup label="Fruits">
            <OSelectItem value="apple" label="Apple" />
          </OSelectGroup>
        `,
      },
      global: { components: { OSelectGroup, OSelectItem } },
    });
    expect(wrapper.exists()).toBe(true);
  });
});

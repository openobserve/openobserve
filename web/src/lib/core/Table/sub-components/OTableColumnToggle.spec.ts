// Copyright 2026 OpenObserve Inc.

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import type { OTableColumnDef } from "../OTable.types";
import OTableColumnToggle from "./OTableColumnToggle.vue";

const columns = [
  { id: "name", header: "Name", hideable: true },
  { id: "kind", header: "Kind", hideable: true },
] as OTableColumnDef[];

describe("OTableColumnToggle", () => {
  it("makes the button itself the menu trigger, with the hidden-count badge inside it", () => {
    const wrapper = mount(OTableColumnToggle, {
      props: { columns, columnVisibility: { kind: false } },
      attachTo: document.body,
    });
    const button = wrapper.get('[data-test="o2-table-column-toggle-btn"]');
    expect(button.element.tagName).toBe("BUTTON");
    expect(button.attributes("aria-haspopup")).toBe("menu");
    expect(button.attributes("aria-label")).toBe("Manage columns, 1 hidden");
    expect(button.find('[data-test="o2-table-column-toggle-hidden-badge"]').text()).toBe("1");
    expect(wrapper.find("div[aria-expanded]").exists()).toBe(false);
    wrapper.unmount();
  });
});

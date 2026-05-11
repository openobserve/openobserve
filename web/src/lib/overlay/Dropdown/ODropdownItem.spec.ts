import { describe, it, expect, vi } from "vitest";
import { h } from "vue";
import { mount } from "@vue/test-utils";
import ODropdown from "./ODropdown.vue";
import ODropdownItem from "./ODropdownItem.vue";

// Reka UI portals content into <body>. Disable portal for unit tests.
vi.mock("reka-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("reka-ui")>();
  return {
    ...actual,
    DropdownMenuPortal: actual.DropdownMenuContent, // render inline
  };
});

// ODropdownItem requires a MenuRoot context — mount it inside an open ODropdown
function mountItemInDropdown(
  itemProps: Record<string, unknown> = {},
  itemSlots: Record<string, () => ReturnType<typeof h>> = {},
) {
  return mount(ODropdown, {
    props: { open: true },
    slots: {
      trigger: "<button>Open</button>",
      default: { render: () => h(ODropdownItem, itemProps, itemSlots) },
    },
  });
}

describe("ODropdownItem", () => {
  it("renders slot content", () => {
    const wrapper = mountItemInDropdown(
      {},
      { default: () => h("span", "Delete") },
    );
    expect(wrapper.text()).toContain("Delete");
  });

  it("renders icon-left slot", () => {
    const wrapper = mountItemInDropdown(
      {},
      {
        "icon-left": () => h("span", { "data-testid": "icon-left" }, "←"),
      },
    );
    expect(wrapper.find('[data-testid="icon-left"]').exists()).toBe(true);
  });

  it("renders icon-right slot", () => {
    const wrapper = mountItemInDropdown(
      {},
      {
        "icon-right": () => h("span", { "data-testid": "icon-right" }, "→"),
      },
    );
    expect(wrapper.find('[data-testid="icon-right"]').exists()).toBe(true);
  });

  it("sets data-disabled when disabled=true", () => {
    const wrapper = mountItemInDropdown({ disabled: true });
    const item = wrapper.find("[data-disabled]");
    expect(item.exists()).toBe(true);
  });

  it("applies item base classes", () => {
    const wrapper = mountItemInDropdown(
      {},
      { default: () => h("span", "Action") },
    );
    const item = wrapper.find(".tw\\:text-dropdown-item-text");
    expect(item.exists()).toBe(true);
  });

  it("applies default variant classes when variant is not set", () => {
    const wrapper = mountItemInDropdown(
      {},
      { default: () => h("span", "Action") },
    );
    expect(wrapper.html()).toContain("tw:text-dropdown-item-text");
  });

  it('applies destructive variant classes when variant="destructive"', () => {
    const wrapper = mountItemInDropdown(
      { variant: "destructive" },
      { default: () => h("span", "Delete") },
    );
    expect(wrapper.html()).toContain("tw:text-dropdown-item-destructive-text");
    expect(wrapper.html()).toContain(
      "tw:data-[highlighted]:bg-dropdown-item-destructive-hover-bg",
    );
  });
});

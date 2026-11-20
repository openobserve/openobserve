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
    const wrapper = mountItemInDropdown({}, { default: () => h("span", "Delete") });
    expect(wrapper.text()).toContain("Delete");
  });

  it("renders the icon slot", () => {
    const wrapper = mountItemInDropdown(
      {},
      {
        icon: () => h("span", { "data-testid": "icon-left" }, "←"),
      },
    );
    expect(wrapper.find('[data-testid="icon-left"]').exists()).toBe(true);
  });

  it("renders the end slot", () => {
    const wrapper = mountItemInDropdown(
      {},
      {
        end: () => h("span", { "data-testid": "icon-right" }, "→"),
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
    const wrapper = mountItemInDropdown({}, { default: () => h("span", "Action") });
    const item = wrapper.find(".text-dropdown-item-text");
    expect(item.exists()).toBe(true);
  });

  it("applies default variant classes when variant is not set", () => {
    const wrapper = mountItemInDropdown({}, { default: () => h("span", "Action") });
    expect(wrapper.html()).toContain("text-dropdown-item-text");
  });

  it('applies danger classes when tone="danger"', () => {
    const wrapper = mountItemInDropdown({ tone: "danger" }, { default: () => h("span", "Delete") });
    expect(wrapper.html()).toContain("text-dropdown-item-destructive-text");
    expect(wrapper.html()).toContain("data-[highlighted]:bg-dropdown-item-destructive-hover-bg");
  });
  it("marks the chosen item of a single-choice group with a check", () => {
    const wrapper = mountItemInDropdown({ checked: true }, { default: () => h("span", "Name") });
    expect(wrapper.find('[role="menuitemradio"]').attributes("aria-checked")).toBe("true");
  });

  it("shows why a disabled item is unavailable under its label", () => {
    const wrapper = mountItemInDropdown(
      { disabled: true, disabledReason: "You can view, not edit", "data-test": "pause" },
      { default: () => h("span", "Pause") },
    );
    expect(wrapper.find('[data-test="pause-reason"]').text()).toBe("You can view, not edit");
  });

  it("draws a 32 px row in UI text", () => {
    const wrapper = mountItemInDropdown({}, { default: () => h("span", "Edit") });
    const row = wrapper.find(".min-h-control-md");
    expect(row.exists()).toBe(true);
    expect(row.classes()).toContain("text-compact");
  });
});

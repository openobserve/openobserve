import { describe, it, expect, vi } from "vitest";
import { h } from "vue";
import { mount } from "@vue/test-utils";
import ODropdown from "./ODropdown.vue";
import ODropdownItem from "./ODropdownItem.vue";
import ODropdownGroup from "./ODropdownGroup.vue";
import ODropdownSeparator from "./ODropdownSeparator.vue";

// Reka UI portals items into <body>. Disable portal for unit tests.
vi.mock("reka-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("reka-ui")>();
  return {
    ...actual,
    DropdownMenuPortal: actual.DropdownMenuContent, // render inline
  };
});

describe("ODropdown", () => {
  it("renders the trigger slot", () => {
    const wrapper = mount(ODropdown, {
      slots: { trigger: '<button data-testid="trigger">Open</button>' },
    });
    expect(wrapper.find('[data-testid="trigger"]').exists()).toBe(true);
  });

  it("is closed by default", () => {
    const wrapper = mount(ODropdown, {
      slots: {
        trigger: "<button>Open</button>",
        default: '<div data-testid="content">Menu</div>',
      },
    });
    // Content is not visible (not in DOM) when closed
    expect(wrapper.find('[data-testid="content"]').exists()).toBe(false);
  });

  it("emits update:open when the trigger is clicked", async () => {
    const wrapper = mount(ODropdown, {
      slots: { trigger: "<button>Open</button>" },
    });
    await wrapper.find("button").trigger("click");
    expect(wrapper.emitted("update:open")).toBeDefined();
  });

  it("shows content when open=true", () => {
    const wrapper = mount(ODropdown, {
      props: { open: true },
      slots: {
        trigger: "<button>Open</button>",
        default: '<div data-testid="content">Menu</div>',
      },
    });
    expect(wrapper.find('[data-testid="content"]').exists()).toBe(true);
  });
});

// ODropdownItem requires a MenuRoot context ΓÇö mount it inside an open ODropdown
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
        "icon-left": () => h("span", { "data-testid": "icon-left" }, "ΓåÉ"),
      },
    );
    expect(wrapper.find('[data-testid="icon-left"]').exists()).toBe(true);
  });

  it("renders icon-right slot", () => {
    const wrapper = mountItemInDropdown(
      {},
      {
        "icon-right": () => h("span", { "data-testid": "icon-right" }, "ΓåÆ"),
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
});

describe("ODropdownGroup", () => {
  it("renders children inside the group", () => {
    const wrapper = mount(ODropdownGroup, {
      slots: { default: '<div data-testid="item">Item</div>' },
    });
    expect(wrapper.find('[data-testid="item"]').exists()).toBe(true);
  });

  it("renders a label when label prop is provided", () => {
    const wrapper = mount(ODropdownGroup, {
      props: { label: "Actions" },
    });
    expect(wrapper.text()).toContain("Actions");
  });

  it("does not render a label element when label prop is absent", () => {
    const wrapper = mount(ODropdownGroup);
    // No label element rendered
    expect(wrapper.text().trim()).toBe("");
  });
});

describe("ODropdownSeparator", () => {
  it("renders a separator element", () => {
    const wrapper = mount(ODropdownSeparator);
    expect(wrapper.element).toBeTruthy();
  });

  it("applies separator bg class", () => {
    const wrapper = mount(ODropdownSeparator);
    expect(wrapper.classes().join(" ")).toContain("tw:bg-dropdown-separator");
  });
});

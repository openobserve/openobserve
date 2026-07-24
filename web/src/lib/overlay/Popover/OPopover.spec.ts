import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h, inject } from "vue";
import OPopover from "./OPopover.vue";
import {
  O_DROPDOWN_NESTED_KEY,
  type DropdownNestedRegistry,
} from "@/lib/overlay/Dropdown/ODropdown.context";

// Reka UI portals content into <body>. Disable portal for unit tests.
vi.mock("reka-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("reka-ui")>();
  return {
    ...actual,
    PopoverPortal: actual.PopoverContent, // render inline
  };
});

describe("OPopover", () => {
  it("renders the trigger slot", () => {
    const wrapper = mount(OPopover, {
      slots: { trigger: '<button data-testid="trigger">Open</button>' },
    });
    expect(wrapper.find('[data-testid="trigger"]').exists()).toBe(true);
  });

  it("is closed by default", () => {
    const wrapper = mount(OPopover, {
      slots: {
        trigger: "<button>Open</button>",
        default: '<div data-testid="content">Body</div>',
      },
    });
    expect(wrapper.find('[data-testid="content"]').exists()).toBe(false);
  });

  it("emits update:open when the trigger is clicked", async () => {
    const wrapper = mount(OPopover, {
      slots: { trigger: "<button>Open</button>" },
    });
    await wrapper.find("button").trigger("click");
    expect(wrapper.emitted("update:open")).toBeDefined();
  });

  it("shows content when open=true", () => {
    const wrapper = mount(OPopover, {
      props: { open: true },
      slots: {
        trigger: "<button>Open</button>",
        default: '<div data-testid="content">Body</div>',
      },
    });
    expect(wrapper.find('[data-testid="content"]').exists()).toBe(true);
  });

  it("follows the open prop back to closed", async () => {
    const wrapper = mount(OPopover, {
      props: { open: true },
      slots: {
        trigger: "<button>Open</button>",
        default: '<div data-testid="content">Body</div>',
      },
    });
    await wrapper.setProps({ open: false });
    // Reka keeps the content mounted until its exit animation settles.
    await vi.waitFor(() => expect(wrapper.find('[data-testid="content"]').exists()).toBe(false));
  });

  it("closes on a scroll outside its content", async () => {
    const wrapper = mount(OPopover, {
      attachTo: document.body,
      props: { open: false },
      slots: {
        trigger: "<button>Open</button>",
        default: '<div data-testid="content">Body</div>',
      },
    });
    await wrapper.setProps({ open: true });
    document.dispatchEvent(new Event("scroll"));
    const emitted = wrapper.emitted("update:open") ?? [];
    expect(emitted.some((args) => args[0] === false)).toBe(true);
    wrapper.unmount();
  });

  it("ignores scrolls inside its own content", async () => {
    const wrapper = mount(OPopover, {
      attachTo: document.body,
      props: { open: false },
      slots: {
        trigger: "<button>Open</button>",
        default: '<div data-testid="content">Body</div>',
      },
    });
    await wrapper.setProps({ open: true });
    const content = wrapper.get("[data-o-popover-content]");
    content.element.dispatchEvent(new Event("scroll"));
    const emitted = wrapper.emitted("update:open") ?? [];
    expect(emitted.some((args) => args[0] === false)).toBe(false);
    wrapper.unmount();
  });

  it("provides a nested-overlay registry to its content", () => {
    let registry: DropdownNestedRegistry | null = null;
    const Probe = defineComponent({
      setup() {
        registry = inject<DropdownNestedRegistry | null>(O_DROPDOWN_NESTED_KEY, null);
        return () => h("div");
      },
    });
    mount(OPopover, {
      props: { open: true },
      slots: {
        trigger: "<button>Open</button>",
        default: () => h(Probe),
      },
    });
    expect(registry).not.toBeNull();
    expect(typeof registry!.open).toBe("function");
    const release = registry!.open();
    expect(typeof release).toBe("function");
    release();
  });
});

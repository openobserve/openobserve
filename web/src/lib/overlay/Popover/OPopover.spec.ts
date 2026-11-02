import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h, inject } from "vue";
import { PopoverContent } from "reka-ui";
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

  it("overrides the breakpoint collision padding when collisionPadding is set", () => {
    const wrapper = mount(OPopover, {
      props: { open: true, collisionPadding: { top: 48, right: 8, bottom: 8, left: 8 } },
      slots: {
        trigger: "<button>Open</button>",
        default: '<div data-testid="content">Body</div>',
      },
    });
    // The mock renders PopoverPortal as PopoverContent, so the real content is the last match.
    const content = wrapper.findAllComponents(PopoverContent).at(-1)!;
    expect(content.props("collisionPadding")).toEqual({
      top: 48,
      right: 8,
      bottom: 8,
      left: 8,
    });
  });

  it("forwards open-auto-focus so a consumer can redirect initial focus", () => {
    const wrapper = mount(OPopover, {
      props: { open: true },
      slots: {
        trigger: "<button>Open</button>",
        default: '<div data-testid="content">Body</div>',
      },
    });
    const content = wrapper.findAllComponents(PopoverContent).at(-1)!;
    const event = new Event("focus");
    content.vm.$emit("open-auto-focus", event);
    expect(wrapper.emitted("open-auto-focus")?.[0]).toEqual([event]);
  });

  it("forwards outside pointerdown and focus so a consumer can keep it open for a panel it owns", () => {
    const wrapper = mount(OPopover, {
      props: { open: true },
      slots: {
        trigger: "<button>Open</button>",
        default: '<div data-testid="content">Body</div>',
      },
    });
    const content = wrapper.findAllComponents(PopoverContent).at(-1)!;
    const down = new Event("pointerdown", { cancelable: true });
    const focus = new Event("focusin", { cancelable: true });
    content.vm.$emit("pointer-down-outside", down);
    content.vm.$emit("focus-outside", focus);
    expect(wrapper.emitted("pointer-down-outside")?.[0]).toEqual([down]);
    expect(wrapper.emitted("focus-outside")?.[0]).toEqual([focus]);
    expect(down.defaultPrevented).toBe(false);
  });
});

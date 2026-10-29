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

  it("masks its content for session replay only when privacy is mask", () => {
    const plain = mount(OPopover, { props: { open: true }, slots: { default: "<p>x</p>" } });
    expect(plain.find("[data-o-popover-content]").attributes("data-dd-privacy")).toBeUndefined();
    const masked = mount(OPopover, {
      props: { open: true, privacy: "mask" },
      slots: { default: "<p>x</p>" },
    });
    expect(masked.find("[data-o-popover-content]").attributes("data-dd-privacy")).toBe("mask");
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

  it("positions by an anchor with no trigger", async () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    const wrapper = mount(OPopover, {
      props: { open: true, autoFocus: false },
      slots: {
        anchor: '<span data-testid="anchor"></span>',
        default: '<button data-testid="inside">Inside</button>',
      },
      attachTo: document.body,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(wrapper.find('[data-testid="anchor"]').exists()).toBe(true);
    expect(wrapper.find("[aria-haspopup]").exists()).toBe(false);
    wrapper.unmount();
    input.remove();
  });

  it("returns focus on close to the anchor control that opened it, not the first one", async () => {
    const wrapper = mount(OPopover, {
      props: { open: false },
      slots: {
        anchor:
          '<p data-testid="anchor"><button data-testid="one">One</button><button data-testid="two">Two</button></p>',
        default: '<button data-testid="inside">Inside</button>',
      },
      attachTo: document.body,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const two = wrapper.get('[data-testid="two"]').element as HTMLButtonElement;
    two.focus();
    await wrapper.setProps({ open: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    (document.body.querySelector('[data-testid="inside"]') as HTMLElement).focus();
    await wrapper.setProps({ open: false });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.activeElement).toBe(two);
    wrapper.unmount();
  });

  it("leaves focus where the caller already put it when the popover closes (V1)", async () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    const wrapper = mount(OPopover, {
      props: { open: false },
      slots: {
        anchor: '<p><button data-testid="one">One</button></p>',
        default: '<button data-testid="inside">Inside</button>',
      },
      attachTo: document.body,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    (wrapper.get('[data-testid="one"]').element as HTMLElement).focus();
    await wrapper.setProps({ open: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    outside.focus();
    await wrapper.setProps({ open: false });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.activeElement).toBe(outside);
    wrapper.unmount();
    outside.remove();
  });
});

import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import ODropdown from "./ODropdown.vue";

// Reka UI portals content into <body>. Disable portal for unit tests.
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

  // A caller that opens a popover from an item must be able to stop focus going back to the trigger.
  it("forwards the content's close-auto-focus event", async () => {
    const wrapper = mount(ODropdown, {
      props: { open: true },
      slots: { trigger: "<button>Open</button>", default: "<div>Menu</div>" },
    });
    const event = new Event("focus");
    // The portal is stubbed with a content component, so the real content is the inner one.
    wrapper
      .findAllComponents({ name: "DropdownMenuContent" })
      .at(-1)!
      .vm.$emit("closeAutoFocus", event);
    expect(wrapper.emitted("close-auto-focus")?.[0]).toEqual([event]);
  });
});

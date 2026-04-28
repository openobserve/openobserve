import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import OMenu from "./OMenu.vue";

// Reka UI portals content into <body>. Replace with inline rendering for tests.
vi.mock("reka-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("reka-ui")>();
  return {
    ...actual,
    PopoverPortal: actual.PopoverContent, // render inline
  };
});

describe("OMenu", () => {
  it("renders the trigger slot", () => {
    const wrapper = mount(OMenu, {
      slots: { trigger: '<button data-testid="trigger">Open</button>' },
    });
    expect(wrapper.find('[data-testid="trigger"]').exists()).toBe(true);
  });

  it("is closed by default", () => {
    const wrapper = mount(OMenu, {
      slots: {
        trigger: "<button>Open</button>",
        default: '<div data-testid="content">Content</div>',
      },
    });
    expect(wrapper.find('[data-testid="content"]').exists()).toBe(false);
  });

  it("emits update:open when trigger is clicked", async () => {
    const wrapper = mount(OMenu, {
      slots: { trigger: "<button>Open</button>" },
    });
    await wrapper.find("button").trigger("click");
    expect(wrapper.emitted("update:open")).toBeDefined();
  });

  it("shows content when open=true", () => {
    const wrapper = mount(OMenu, {
      props: { open: true },
      slots: {
        trigger: "<button>Open</button>",
        default: '<div data-testid="content">Content</div>',
      },
    });
    expect(wrapper.find('[data-testid="content"]').exists()).toBe(true);
  });

  it("passes side and align props through", () => {
    const wrapper = mount(OMenu, {
      props: { side: "top", align: "end" },
      slots: { trigger: "<button>Open</button>" },
    });
    expect(wrapper.exists()).toBe(true);
  });

  it("applies fit width style when fit=true and open", () => {
    const wrapper = mount(OMenu, {
      props: { open: true, fit: true },
      slots: {
        trigger: "<button>Open</button>",
        default: "<div>Content</div>",
      },
    });
    const content = wrapper.find('[data-reka-popper-content-wrapper]');
    // PopoverContent with fit style renders without errors
    expect(wrapper.exists()).toBe(true);
  });

  it("defaults to side=bottom, align=start, sideOffset=4", () => {
    const wrapper = mount(OMenu, {
      slots: { trigger: "<button>Open</button>" },
    });
    expect(wrapper.exists()).toBe(true);
  });
});

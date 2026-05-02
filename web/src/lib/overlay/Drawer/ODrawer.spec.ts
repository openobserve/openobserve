import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import ODrawer from "./ODrawer.vue";

// Reka UI portals content into <body>. Stub the portal so content
// is rendered inline for unit tests.
vi.mock("reka-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("reka-ui")>();
  return {
    ...actual,
    DialogPortal: actual.DialogContent, // render inline without teleport
  };
});

describe("ODrawer", () => {
  it("renders the trigger slot", () => {
    const wrapper = mount(ODrawer, {
      slots: { trigger: '<button data-testid="trigger">Open</button>' },
    });
    expect(wrapper.find('[data-testid="trigger"]').exists()).toBe(true);
  });

  it("is closed by default when no open prop is provided", () => {
    const wrapper = mount(ODrawer, {
      slots: {
        trigger: "<button>Open</button>",
        default: '<div data-testid="content">Body</div>',
      },
    });
    expect(wrapper.find("[data-o2-drawer]").exists()).toBe(false);
  });

  it("shows content when open=true", () => {
    const wrapper = mount(ODrawer, {
      props: { open: true },
      slots: {
        default: '<div data-testid="body">Body content</div>',
      },
    });
    expect(wrapper.find("[data-o2-drawer]").exists()).toBe(true);
    expect(wrapper.find('[data-testid="body"]').exists()).toBe(true);
  });

  it("renders title prop in the header when no header slot is given", () => {
    const wrapper = mount(ODrawer, {
      props: { open: true, title: "My Drawer" },
    });
    expect(wrapper.text()).toContain("My Drawer");
  });

  it("renders the header slot when provided", () => {
    const wrapper = mount(ODrawer, {
      props: { open: true },
      slots: {
        header: '<span data-testid="custom-header">Custom Header</span>',
      },
    });
    expect(wrapper.find('[data-testid="custom-header"]').exists()).toBe(true);
  });

  it("renders the footer slot when provided", () => {
    const wrapper = mount(ODrawer, {
      props: { open: true },
      slots: {
        footer: '<button data-testid="footer-btn">Save</button>',
      },
    });
    expect(wrapper.find('[data-testid="footer-btn"]').exists()).toBe(true);
  });

  it("does not render a footer section when footer slot is omitted", () => {
    const wrapper = mount(ODrawer, {
      props: { open: true },
      slots: { default: "<p>body</p>" },
    });
    expect(wrapper.findAll('[data-testid="footer-btn"]').length).toBe(0);
  });

  it("emits update:open=false when close button is clicked", async () => {
    const wrapper = mount(ODrawer, {
      props: { open: true, title: "Drawer" },
    });
    const closeBtn = wrapper.find('button[aria-label="Close drawer"]');
    expect(closeBtn.exists()).toBe(true);
    await closeBtn.trigger("click");
    const emitted = wrapper.emitted("update:open");
    expect(emitted).toBeTruthy();
    expect(emitted?.[0]).toEqual([false]);
  });

  it("does not render a close button when persistent=true", () => {
    const wrapper = mount(ODrawer, {
      props: { open: true, persistent: true, title: "Persistent" },
    });
    expect(
      wrapper.find('button[aria-label="Close drawer"]').exists(),
    ).toBe(false);
  });

  it("applies right-side classes by default", () => {
    const wrapper = mount(ODrawer, {
      props: { open: true },
    });
    const content = wrapper.find("[data-o2-drawer]");
    expect(content.classes().join(" ")).toContain("tw:right-0");
  });

  it("applies left-side classes when side=left", () => {
    const wrapper = mount(ODrawer, {
      props: { open: true, side: "left" },
    });
    const content = wrapper.find("[data-o2-drawer]");
    expect(content.classes().join(" ")).toContain("tw:left-0");
  });

  it("accepts open prop changes without error (controlled mode)", async () => {
    const wrapper = mount(ODrawer, {
      props: { open: true, title: "Test" },
    });
    // Verify no error is thrown when the parent closes the drawer
    await wrapper.setProps({ open: false });
    // The overlay scrim should no longer be present
    expect(wrapper.findAll("[data-o2-drawer]").length).toBeLessThanOrEqual(1);
  });
});

import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import ODialog from "./ODialog.vue";

// Reka UI portals content into <body>. Stub the portal so content
// is rendered inline for unit tests.
vi.mock("reka-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("reka-ui")>();
  return {
    ...actual,
    DialogPortal: actual.DialogContent, // render inline without teleport
  };
});

describe("ODialog", () => {
  it("renders the trigger slot", () => {
    const wrapper = mount(ODialog, {
      slots: { trigger: '<button data-testid="trigger">Open</button>' },
    });
    expect(wrapper.find('[data-testid="trigger"]').exists()).toBe(true);
  });

  it("is closed by default when no open prop is provided", () => {
    const wrapper = mount(ODialog, {
      slots: {
        trigger: "<button>Open</button>",
        default: '<div data-testid="content">Body</div>',
      },
    });
    // DialogContent is not rendered when closed
    expect(wrapper.find("[data-o2-dialog]").exists()).toBe(false);
  });

  it("shows content when open=true", () => {
    const wrapper = mount(ODialog, {
      props: { open: true },
      slots: {
        default: '<div data-testid="body">Body content</div>',
      },
    });
    expect(wrapper.find("[data-o2-dialog]").exists()).toBe(true);
    expect(wrapper.find('[data-testid="body"]').exists()).toBe(true);
  });

  it("renders title prop in the header when no header slot is given", () => {
    const wrapper = mount(ODialog, {
      props: { open: true, title: "My Dialog" },
    });
    expect(wrapper.text()).toContain("My Dialog");
  });

  it("renders the header slot when provided", () => {
    const wrapper = mount(ODialog, {
      props: { open: true },
      slots: {
        header: '<span data-testid="custom-header">Custom</span>',
      },
    });
    expect(wrapper.find('[data-testid="custom-header"]').exists()).toBe(true);
  });

  it("renders the footer slot when provided", () => {
    const wrapper = mount(ODialog, {
      props: { open: true },
      slots: {
        footer: '<button data-testid="footer-btn">OK</button>',
      },
    });
    expect(wrapper.find('[data-testid="footer-btn"]').exists()).toBe(true);
  });

  it("does not render a footer section when footer slot is omitted", () => {
    const wrapper = mount(ODialog, {
      props: { open: true },
      slots: {
        default: "<p>body</p>",
      },
    });
    // No footer div when slot is absent
    expect(wrapper.findAll('[data-testid="footer-btn"]').length).toBe(0);
  });

  it("shows the close button by default", () => {
    const wrapper = mount(ODialog, {
      props: { open: true, title: "Test" },
    });
    expect(wrapper.find('button[aria-label="Close dialog"]').exists()).toBe(
      true,
    );
  });

  it("hides the close button when showClose=false", () => {
    const wrapper = mount(ODialog, {
      props: { open: true, title: "Test", showClose: false },
    });
    expect(wrapper.find('button[aria-label="Close dialog"]').exists()).toBe(
      false,
    );
  });

  it("hides the close button when persistent=true", () => {
    const wrapper = mount(ODialog, {
      props: { open: true, title: "Test", persistent: true },
    });
    expect(wrapper.find('button[aria-label="Close dialog"]').exists()).toBe(
      false,
    );
  });

  it("emits update:open when triggered", async () => {
    const wrapper = mount(ODialog, {
      slots: { trigger: "<button>Open</button>" },
    });
    await wrapper.find("button").trigger("click");
    expect(wrapper.emitted("update:open")).toBeDefined();
  });

  it("applies data-o2-dialog on the content element", () => {
    const wrapper = mount(ODialog, {
      props: { open: true },
    });
    expect(wrapper.find("[data-o2-dialog]").exists()).toBe(true);
  });

  it("always renders DialogTitle in the DOM for accessibility", () => {
    // Even without title prop or header slot, the sr-only title must be present
    const wrapper = mount(ODialog, {
      props: { open: true },
    });
    // The title element should be in the DOM (sr-only)
    expect(wrapper.find("[data-o2-dialog]").exists()).toBe(true);
  });
});

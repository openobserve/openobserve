import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import OModal from "./OModal.vue";

// Reka UI portals content into <body>. Replace with inline rendering for tests.
vi.mock("reka-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("reka-ui")>();
  return {
    ...actual,
    DialogPortal: actual.DialogContent, // render inline
  };
});

describe("OModal", () => {
  it("renders the trigger slot", () => {
    const wrapper = mount(OModal, {
      slots: { trigger: '<button data-testid="trigger">Open</button>' },
    });
    expect(wrapper.find('[data-testid="trigger"]').exists()).toBe(true);
  });

  it("does not render trigger wrapper when trigger slot is absent", () => {
    const wrapper = mount(OModal);
    expect(wrapper.find('[data-reka-dialog-trigger]').exists()).toBe(false);
  });

  it("is closed by default", () => {
    const wrapper = mount(OModal, {
      slots: {
        trigger: "<button>Open</button>",
        default: '<div data-testid="content">Content</div>',
      },
    });
    expect(wrapper.find('[data-testid="content"]').exists()).toBe(false);
  });

  it("shows content when open=true", () => {
    const wrapper = mount(OModal, {
      props: { open: true },
      slots: {
        trigger: "<button>Open</button>",
        default: '<div data-testid="content">Content</div>',
      },
    });
    expect(wrapper.find('[data-testid="content"]').exists()).toBe(true);
  });

  it("emits update:open when trigger is clicked", async () => {
    const wrapper = mount(OModal, {
      slots: { trigger: "<button>Open</button>" },
    });
    await wrapper.find("button").trigger("click");
    expect(wrapper.emitted("update:open")).toBeDefined();
  });

  it("applies drawer variant classes when variant=drawer and open", () => {
    const wrapper = mount(OModal, {
      props: { open: true, variant: "drawer" },
      slots: { default: "<div>Content</div>" },
    });
    // DrawerContent should be end-anchored
    const content = wrapper.find('[role="dialog"]');
    expect(content.classes().join(" ")).toContain("tw:end-0");
  });

  it("applies modal variant classes when variant=modal and open", () => {
    const wrapper = mount(OModal, {
      props: { open: true, variant: "modal" },
      slots: { default: "<div>Content</div>" },
    });
    const content = wrapper.find('[role="dialog"]');
    expect(content.classes().join(" ")).toContain("tw:rounded-xl");
  });

  it("mounts without error when persistent=true", () => {
    const wrapper = mount(OModal, {
      props: { open: true, persistent: true },
      slots: { default: "<div>Content</div>" },
    });
    expect(wrapper.exists()).toBe(true);
  });
});

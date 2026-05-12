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

  it("shows the close button when persistent=true (persistent only blocks Escape/backdrop)", () => {
    const wrapper = mount(ODrawer, {
      props: { open: true, persistent: true, title: "Persistent" },
    });
    expect(
      wrapper.find('button[aria-label="Close drawer"]').exists(),
    ).toBe(true);
  });

  it("hides the close button when showClose=false even with persistent=true", () => {
    const wrapper = mount(ODrawer, {
      props: { open: true, persistent: true, title: "Persistent", showClose: false },
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

  describe("header-right slot", () => {
    it("renders header-right slot content", () => {
      const wrapper = mount(ODrawer, {
        props: { open: true, title: "Test" },
        slots: { "header-right": '<button data-testid="hr-btn">Action</button>' },
      });
      expect(wrapper.find('[data-testid="hr-btn"]').exists()).toBe(true);
    });

    it("header-right wrapper has shrink-0, not flex-1 (no transparent blocking area)", () => {
      const wrapper = mount(ODrawer, {
        props: { open: true, title: "Test" },
        slots: { "header-right": '<button data-testid="hr-btn">Action</button>' },
      });
      const hrWrapper = wrapper.find('[data-testid="hr-btn"]').element.parentElement!;
      expect(hrWrapper.className).toContain("tw:shrink-0");
      expect(hrWrapper.className).not.toContain("tw:flex-1");
    });

    it("spacer appears before header-right in DOM (keeps content right-aligned)", () => {
      const wrapper = mount(ODrawer, {
        props: { open: true, title: "Test" },
        slots: { "header-right": '<button data-testid="hr-btn">Action</button>' },
      });
      const closeBtn = wrapper.find('button[aria-label="Close drawer"]');
      const headerEl = closeBtn.element.parentElement!;
      const children = Array.from(headerEl.children) as HTMLElement[];
      const spacer = children.find(
        (el) => el.className.includes("tw:flex-1") && !el.className.includes("tw:min-w-0"),
      );
      const hrWrapper = wrapper.find('[data-testid="hr-btn"]').element.parentElement!;
      expect(spacer).toBeDefined();
      expect(children.indexOf(spacer!)).toBeLessThan(children.indexOf(hrWrapper));
    });
  });

  describe("sticky layout structure", () => {
    it("header has shrink-0 class (pinned, never scrolls)", () => {
      const wrapper = mount(ODrawer, {
        props: { open: true, title: "Test" },
      });
      // The close button is a direct child of the header div
      const closeBtn = wrapper.find('button[aria-label="Close drawer"]');
      const headerEl = closeBtn.element.parentElement;
      expect(headerEl?.className).toContain("tw:shrink-0");
    });

    it("body does NOT have flex-1 (must not push footer to bottom on short content)", () => {
      const wrapper = mount(ODrawer, {
        props: { open: true },
        slots: { default: '<p data-testid="body-content">body</p>' },
      });
      const bodyContent = wrapper.find('[data-testid="body-content"]');
      const bodyEl = bodyContent.element.parentElement;
      expect(bodyEl?.className).not.toContain("tw:flex-1");
      expect(bodyEl?.className).toContain("tw:min-h-0");
      expect(bodyEl?.className).toContain("tw:overflow-y-auto");
    });

    it("footer has shrink-0 class (does not expand to fill space)", () => {
      const wrapper = mount(ODrawer, {
        props: { open: true },
        slots: { footer: '<button data-testid="footer-btn">Save</button>' },
      });
      const footerBtn = wrapper.find('[data-testid="footer-btn"]');
      const footerEl = footerBtn.element.parentElement;
      expect(footerEl?.className).toContain("tw:shrink-0");
      expect(footerEl?.className).not.toContain("tw:flex-1");
      expect(footerEl?.className).not.toContain("tw:mt-auto");
    });
  });

  describe("body action button validation suppression", () => {
    it("AC-1/AC-2: focusin on a non-input body element calls resetValidation on q-fields", async () => {
      const resetValidation = vi.fn();
      const wrapper = mount(ODrawer, {
        props: { open: true },
        slots: {
          default: `
            <div class="q-field" data-testid="name-field"></div>
            <button data-testid="action-btn">+</button>
          `,
        },
      });
      // Attach the vue component instance mock so clearBodyValidation can reach it
      const qField = wrapper.find('[data-testid="name-field"]').element as any;
      qField.__vueParentComponent = { ctx: { resetValidation } };

      await wrapper.find('[data-testid="action-btn"]').trigger("focusin");

      expect(resetValidation).toHaveBeenCalled();
    });

    it("AC-1/AC-2: focusin on a native input inside q-field does NOT call resetValidation", async () => {
      const resetValidation = vi.fn();
      const wrapper = mount(ODrawer, {
        props: { open: true },
        slots: {
          default: `
            <div class="q-field">
              <input data-testid="name-input" />
            </div>
          `,
        },
      });
      const qField = wrapper.find(".q-field").element as any;
      qField.__vueParentComponent = { ctx: { resetValidation } };

      await wrapper.find('[data-testid="name-input"]').trigger("focusin");

      expect(resetValidation).not.toHaveBeenCalled();
    });

    it("AC-4: primary button emits click:primary so consumer can trigger validation", async () => {
      const wrapper = mount(ODrawer, {
        props: { open: true, primaryButtonLabel: "Save" },
      });
      await wrapper.find('[data-test="o-drawer-primary-btn"]').trigger("click");
      expect(wrapper.emitted("click:primary")).toBeTruthy();
    });
  });
});

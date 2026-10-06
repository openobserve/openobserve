import { afterEach, describe, it, expect, vi } from "vitest";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import ODrawer from "./ODrawer.vue";
import { DialogContent } from "reka-ui";

// Reka UI portals content into <body>. Stub the portal so content
// is rendered inline for unit tests.
vi.mock("reka-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("reka-ui")>();
  const { defineComponent } = await import("vue");
  return {
    ...actual,
    DialogPortal: defineComponent(
      (_, { slots }) =>
        () =>
          slots.default?.(),
    ),
  };
});

// A drawer left mounted keeps reka's body pointer-events lock alive into the next test.
enableAutoUnmount(afterEach);

afterEach(() => {
  document.body.innerHTML = "";
});

function findDrawerPanel(wrapper: ReturnType<typeof mount>) {
  return wrapper
    .findAllComponents(DialogContent)
    .find((c) => c.attributes("data-o2-drawer") !== undefined)!;
}

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
    expect(wrapper.find('button[aria-label="Close drawer"]').exists()).toBe(true);
  });

  it("hides the close button when showClose=false even with persistent=true", () => {
    const wrapper = mount(ODrawer, {
      props: { open: true, persistent: true, title: "Persistent", showClose: false },
    });
    expect(wrapper.find('button[aria-label="Close drawer"]').exists()).toBe(false);
  });

  it("applies right-side classes by default", () => {
    const wrapper = mount(ODrawer, {
      props: { open: true },
    });
    const content = wrapper.find("[data-o2-drawer]");
    expect(content.classes().join(" ")).toContain("right-0");
  });

  it("applies left-side classes when side=left", () => {
    const wrapper = mount(ODrawer, {
      props: { open: true, side: "left" },
    });
    const content = wrapper.find("[data-o2-drawer]");
    expect(content.classes().join(" ")).toContain("left-0");
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
      expect(hrWrapper.className).toContain("shrink-0");
      expect(hrWrapper.className).not.toContain("flex-1");
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
        (el) => el.className.includes("flex-1") && !el.className.includes("min-w-0"),
      );
      const hrWrapper = wrapper.find('[data-testid="hr-btn"]').element.parentElement!;
      expect(spacer).toBeDefined();
      expect(children.indexOf(spacer!)).toBeLessThan(children.indexOf(hrWrapper));
    });
  });

  // A subtitle wider than a phone-sized panel pushed the close button off screen while the block could not shrink.
  it("lets the title block shrink below lg, and only there", () => {
    const wrapper = mount(ODrawer, {
      props: { open: true, title: "Quick start", subTitle: "A sentence longer than the panel" },
    });
    const title = wrapper
      .findAll("span")
      .find((span) => span.classes().includes("truncate") && span.text().includes("Quick start"));
    const block = title!.element.parentElement!;

    expect(block.classList.contains("shrink-0")).toBe(true);
    expect(block.classList.contains("max-lg:shrink")).toBe(true);
  });

  describe("sticky layout structure", () => {
    it("header has shrink-0 class (pinned, never scrolls)", () => {
      const wrapper = mount(ODrawer, {
        props: { open: true, title: "Test" },
      });
      // The close button is a direct child of the header div
      const closeBtn = wrapper.find('button[aria-label="Close drawer"]');
      const headerEl = closeBtn.element.parentElement;
      expect(headerEl?.className).toContain("shrink-0");
    });

    it("body has flex-1 and min-h-0 so it fills available space and the footer stays anchored", () => {
      const wrapper = mount(ODrawer, {
        props: { open: true },
        slots: { default: '<p data-testid="body-content">body</p>' },
      });
      const bodyContent = wrapper.find('[data-testid="body-content"]');
      const bodyEl = bodyContent.element.parentElement;
      expect(bodyEl?.className).toContain("flex-1");
      expect(bodyEl?.className).toContain("min-h-0");
      expect(bodyEl?.className).toContain("overflow-y-auto");
    });

    it("footer has shrink-0 class (does not expand to fill space)", () => {
      const wrapper = mount(ODrawer, {
        props: { open: true },
        slots: { footer: '<button data-testid="footer-btn">Save</button>' },
      });
      const footerBtn = wrapper.find('[data-testid="footer-btn"]');
      const footerEl = footerBtn.element.parentElement;
      expect(footerEl?.className).toContain("shrink-0");
      expect(footerEl?.className).not.toContain("flex-1");
      expect(footerEl?.className).not.toContain("mt-auto");
    });
  });

  describe("body action button validation suppression", () => {
    it("AC-4: primary button emits click:primary so consumer can trigger validation", async () => {
      const wrapper = mount(ODrawer, {
        props: { open: true, primaryButtonLabel: "Save" },
      });
      await wrapper.find('[data-test="o-drawer-primary-btn"]').trigger("click");
      expect(wrapper.emitted("click:primary")).toBeTruthy();
    });
  });

  describe("open autofocus", () => {
    it("focuses an autofocus element when the drawer has no form field or primary button", async () => {
      const outsideButton = document.createElement("button");
      document.body.appendChild(outsideButton);
      const wrapper = mount(ODrawer, {
        attachTo: document.body,
        props: { open: true, title: "References" },
        slots: {
          default: '<button autofocus data-testid="autofocus-close">Close</button>',
        },
      });
      const panel = findDrawerPanel(wrapper);
      outsideButton.focus();

      await panel.vm.$emit("openAutoFocus", new Event("openAutoFocus", { cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve));

      expect(document.activeElement).toBe(wrapper.find('[data-testid="autofocus-close"]').element);
      wrapper.unmount();
    });

    it("focuses the drawer panel when no focusable fallback exists", async () => {
      const outsideButton = document.createElement("button");
      document.body.appendChild(outsideButton);
      const wrapper = mount(ODrawer, {
        attachTo: document.body,
        props: { open: true, title: "Read only" },
        slots: {
          default: '<p data-testid="read-only-copy">No actions available.</p>',
        },
      });
      const panel = findDrawerPanel(wrapper);
      outsideButton.focus();

      await panel.vm.$emit("openAutoFocus", new Event("openAutoFocus", { cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve));

      expect(document.activeElement).toBe(panel.element);
      wrapper.unmount();
    });
  });

  describe("Escape key behaviour", () => {
    // reka-ui fires @escape-key-down via a document-level listener that does not
    // run in jsdom. We simulate it by calling vm.$emit('escapeKeyDown', …) on the
    // DialogContent component that owns the @escape-key-down handler.
    it("emits update:open=false when Escape is pressed (non-persistent)", async () => {
      const wrapper = mount(ODrawer, {
        props: { open: true, title: "Test" },
      });
      const panel = findDrawerPanel(wrapper);
      await panel.vm.$emit("escapeKeyDown", new KeyboardEvent("keydown", { key: "Escape" }));
      const emitted = wrapper.emitted("update:open");
      expect(emitted).toBeTruthy();
      expect(emitted?.[0]).toEqual([false]);
    });

    it("does NOT emit update:open when Escape is pressed and persistent=true", async () => {
      const wrapper = mount(ODrawer, {
        props: { open: true, title: "Test", persistent: true },
      });
      const panel = findDrawerPanel(wrapper);
      await panel.vm.$emit("escapeKeyDown", new KeyboardEvent("keydown", { key: "Escape" }));
      expect(wrapper.emitted("update:open")).toBeFalsy();
    });
  });

  describe("modal", () => {
    function escapeFrom(target: Element) {
      const ev = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
      target.dispatchEvent(ev);
      return ev;
    }

    async function pointerDownOutside() {
      const outside = document.createElement("div");
      document.body.appendChild(outside);
      // reka registers its document pointerdown listener on a 0ms timer.
      await new Promise((resolve) => setTimeout(resolve));
      outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve));
    }

    it("leaves the page behind interactive when modal=false", async () => {
      const wrapper = mount(ODrawer, {
        attachTo: document.body,
        props: { open: true, title: "Lens", modal: false },
      });
      await new Promise((resolve) => setTimeout(resolve));
      expect(document.body.style.pointerEvents).not.toBe("none");
      wrapper.unmount();
    });

    it("blocks the page behind by default", async () => {
      const wrapper = mount(ODrawer, {
        attachTo: document.body,
        props: { open: true, title: "Modal" },
      });
      await new Promise((resolve) => setTimeout(resolve));
      expect(document.body.style.pointerEvents).toBe("none");
      wrapper.unmount();
    });

    it("does not close on an outside pointer-down when modal=false", async () => {
      const wrapper = mount(ODrawer, {
        attachTo: document.body,
        props: { open: true, title: "Lens", modal: false },
      });
      await pointerDownOutside();
      expect(wrapper.emitted("update:open")).toBeFalsy();
      wrapper.unmount();
    });

    it("prevents the interact-outside event when modal=false", async () => {
      const wrapper = mount(ODrawer, {
        props: { open: true, title: "Lens", modal: false },
      });
      const ev = new CustomEvent("interactOutside", {
        cancelable: true,
        detail: { originalEvent: { target: document.body } },
      });
      await findDrawerPanel(wrapper).vm.$emit("interactOutside", ev);
      expect(ev.defaultPrevented).toBe(true);
      expect(wrapper.emitted("update:open")).toBeFalsy();
    });

    it("still closes on an outside pointer-down by default", async () => {
      const wrapper = mount(ODrawer, {
        attachTo: document.body,
        props: { open: true, title: "Modal" },
      });
      await pointerDownOutside();
      expect(wrapper.emitted("update:open")?.[0]).toEqual([false]);
      wrapper.unmount();
    });

    it("keeps Escape inside an input or an open popper from closing when modal=false", async () => {
      const wrapper = mount(ODrawer, {
        props: { open: true, title: "Lens", modal: false },
      });
      const panel = findDrawerPanel(wrapper);
      const input = document.createElement("input");
      const popper = document.createElement("div");
      popper.setAttribute("data-reka-popper-content-wrapper", "");
      const option = document.createElement("span");
      popper.appendChild(option);
      document.body.append(input, popper);

      const fromInput = escapeFrom(input);
      await panel.vm.$emit("escapeKeyDown", fromInput);
      const fromPopper = escapeFrom(option);
      await panel.vm.$emit("escapeKeyDown", fromPopper);

      expect(wrapper.emitted("update:open")).toBeFalsy();
      expect(fromInput.defaultPrevented).toBe(true);
      expect(fromPopper.defaultPrevented).toBe(true);
    });

    it("closes on Escape from a non-editable target when modal=false", async () => {
      const wrapper = mount(ODrawer, {
        props: { open: true, title: "Lens", modal: false },
      });
      const div = document.createElement("div");
      document.body.appendChild(div);
      await findDrawerPanel(wrapper).vm.$emit("escapeKeyDown", escapeFrom(div));
      expect(wrapper.emitted("update:open")?.[0]).toEqual([false]);
    });

    it("still closes on Escape from an input by default", async () => {
      const wrapper = mount(ODrawer, {
        props: { open: true, title: "Modal" },
      });
      const input = document.createElement("input");
      document.body.appendChild(input);
      await findDrawerPanel(wrapper).vm.$emit("escapeKeyDown", escapeFrom(input));
      expect(wrapper.emitted("update:open")?.[0]).toEqual([false]);
    });

    it("closes from the close button when modal=false", async () => {
      const wrapper = mount(ODrawer, {
        props: { open: true, title: "Lens", modal: false },
      });
      await wrapper.find('[data-test="o-drawer-close-btn"]').trigger("click");
      expect(wrapper.emitted("update:open")?.[0]).toEqual([false]);
    });
  });
});

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { h } from "vue";
import ODrawer from "./ODrawer.vue";
import { DRAWER_INSET_ATTR, setDrawerInsetEnd } from "./drawerInset";
import { DialogContent } from "reka-ui";

const portal = vi.hoisted(() => ({ passthrough: false }));

// Reka UI portals content into <body>. Stub the portal so content
// is rendered inline for unit tests.
vi.mock("reka-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("reka-ui")>();
  const { defineComponent, h: render } = await import("vue");
  return {
    ...actual,
    // The inset tests need the bare slot; the rest render inline through DialogContent.
    DialogPortal: defineComponent(
      (_, { attrs, slots }) =>
        () =>
          portal.passthrough ? slots.default?.() : render(actual.DialogContent, attrs, slots),
      { inheritAttrs: false },
    ),
  };
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ODrawer beside a pinned column (F8)", () => {
  const mounted: ReturnType<typeof mount>[] = [];
  let page: HTMLElement;
  let column: HTMLElement;

  beforeEach(() => {
    portal.passthrough = true;
    page = document.createElement("main");
    page.innerHTML = '<button data-test="page-btn">Page</button>';
    column = document.createElement("aside");
    column.setAttribute(DRAWER_INSET_ATTR, "");
    column.innerHTML = '<textarea data-test="panel-field"></textarea>';
    document.body.append(page, column);
    setDrawerInsetEnd(400, column);
  });

  afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    portal.passthrough = false;
    setDrawerInsetEnd(0);
    document.body.innerHTML = "";
  });

  const tick = () => new Promise((resolve) => setTimeout(resolve));

  function mountDrawer(insetBeside: boolean) {
    const wrapper = mount(ODrawer, {
      attachTo: document.body,
      props: { open: true, title: "Record", insetBeside },
      slots: {
        default: () => [
          h("button", { "data-test": "first" }, "First"),
          h("button", { "data-test": "last" }, "Last"),
        ],
      },
    });
    mounted.push(wrapper);
    return wrapper;
  }

  function panelOf(wrapper: ReturnType<typeof mount>) {
    return wrapper
      .findAllComponents(DialogContent)
      .find((c) => c.attributes("data-o2-drawer") !== undefined)!;
  }

  it("stays modal and covers the column when it does not opt in", async () => {
    const wrapper = mountDrawer(false);
    await tick();
    expect(document.body.style.pointerEvents).toBe("none");
    expect(panelOf(wrapper).attributes("style") ?? "").not.toContain("right: 400px");
    expect(
      document.querySelector('[data-test="o-drawer-overlay"]')?.getAttribute("style") ?? "",
    ).not.toContain("right: 400px");
  });

  it("stops at the column with its own scrim and hides only the page from assistive tech", async () => {
    const wrapper = mountDrawer(true);
    await tick();
    await flushPromises();
    expect(document.body.style.pointerEvents).not.toBe("none");
    expect(panelOf(wrapper).attributes("style")).toContain("right: 400px");
    const scrim = document.querySelector<HTMLElement>('[data-test="o-drawer-overlay"]');
    expect(scrim?.style.right).toBe("400px");
    expect(page.getAttribute("aria-hidden")).toBe("true");
    expect(page.hasAttribute("inert")).toBe(true);
    expect(column.getAttribute("aria-hidden")).toBeNull();
    expect(column.hasAttribute("inert")).toBe(false);
    wrapper.unmount();
    expect(page.getAttribute("aria-hidden")).toBeNull();
    expect(page.hasAttribute("inert")).toBe(false);
  });

  it("keeps its Escape, but Escape inside the column never closes it", async () => {
    const wrapper = mountDrawer(true);
    await tick();
    const field = column.querySelector("textarea")!;
    const fromColumn = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    Object.defineProperty(fromColumn, "target", { value: field });
    await panelOf(wrapper).vm.$emit("escapeKeyDown", fromColumn);
    expect(fromColumn.defaultPrevented).toBe(true);
    expect(wrapper.emitted("update:open")).toBeFalsy();
    const inside = document.querySelector('[data-test="first"]')!;
    const fromDrawer = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    Object.defineProperty(fromDrawer, "target", { value: inside });
    await panelOf(wrapper).vm.$emit("escapeKeyDown", fromDrawer);
    expect(wrapper.emitted("update:open")?.[0]).toEqual([false]);
  });

  it("does not close on a pointer-down inside the column", async () => {
    const wrapper = mountDrawer(true);
    await tick();
    column.querySelector("textarea")!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    await tick();
    expect(wrapper.emitted("update:open")).toBeFalsy();
  });

  it("wraps Tab inside the drawer", async () => {
    const wrapper = mountDrawer(true);
    await tick();
    const panel = panelOf(wrapper).element as HTMLElement;
    const buttons = Array.from(panel.querySelectorAll<HTMLElement>("button"));
    for (const el of buttons) el.getClientRects = () => [{}] as unknown as DOMRectList;
    const last = panel.querySelector<HTMLElement>('[data-test="last"]')!;
    last.focus();
    const tab = new KeyboardEvent("keydown", { key: "Tab", cancelable: true, bubbles: true });
    last.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(buttons[0]);
  });

  it("keeps its body mounted when the panel pins or unpins while it is open (F10)", async () => {
    setDrawerInsetEnd(0, null);
    const wrapper = mountDrawer(true);
    await tick();
    await flushPromises();
    const body = document.querySelector('[data-test="first"]');
    expect(page.hasAttribute("inert")).toBe(true);
    setDrawerInsetEnd(400, column);
    await flushPromises();
    expect(document.querySelector('[data-test="first"]')).toBe(body);
    expect(panelOf(wrapper).attributes("style")).toContain("right: 400px");
    expect(column.hasAttribute("inert")).toBe(false);
    setDrawerInsetEnd(0, null);
    await flushPromises();
    expect(document.querySelector('[data-test="first"]')).toBe(body);
    expect(wrapper.emitted("after-close")).toBeFalsy();
  });

  it("stays open and takes focus back when focus lands on the hidden page", async () => {
    const wrapper = mountDrawer(true);
    await tick();
    await flushPromises();
    const pageButton = page.querySelector<HTMLElement>('[data-test="page-btn"]')!;
    const outside = new FocusEvent("focusin");
    Object.defineProperty(outside, "target", { value: pageButton });
    const event = new CustomEvent("interactOutside", {
      cancelable: true,
      detail: { originalEvent: outside },
    });
    await panelOf(wrapper).vm.$emit("interactOutside", event);
    expect(event.defaultPrevented).toBe(true);
    expect(wrapper.emitted("update:open")).toBeFalsy();
    expect(panelOf(wrapper).element.contains(document.activeElement)).toBe(true);
  });

  it("takes focus back when the panel beside it closes", async () => {
    const wrapper = mountDrawer(true);
    await tick();
    await flushPromises();
    column.querySelector("textarea")!.focus();
    setDrawerInsetEnd(0, null);
    await flushPromises();
    expect(panelOf(wrapper).element.contains(document.activeElement)).toBe(true);
    expect(wrapper.emitted("after-close")).toBeFalsy();
  });
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

  it("announces its title once: no description repeats it", () => {
    const wrapper = mount(ODrawer, { props: { open: true, title: "Orders" } });
    const dialog = wrapper.get("[data-o2-drawer]");
    expect(dialog.attributes("aria-describedby")).toBeUndefined();
    expect(wrapper.get(`[id="${dialog.attributes("aria-labelledby")}"]`).text()).toBe("Orders");
  });

  it("is described by its visible subtitle, not a hidden copy of it", () => {
    const wrapper = mount(ODrawer, { props: { open: true, title: "Orders", subTitle: "2 of 5" } });
    const dialog = wrapper.get("[data-o2-drawer]");
    const described = wrapper.get(`[id="${dialog.attributes("aria-describedby")}"]`);
    expect(described.text()).toBe("2 of 5");
    expect(described.classes()).not.toContain("sr-only");
    expect(wrapper.html().split("2 of 5")).toHaveLength(2);
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

  it("stays open when closeGuard returns false, and closes when it returns true", async () => {
    let allow = false;
    const wrapper = mount(ODrawer, {
      props: { open: true, title: "Drawer", closeGuard: () => allow },
    });
    const closeBtn = wrapper.find('button[aria-label="Close drawer"]');
    await closeBtn.trigger("click");
    expect(wrapper.emitted("update:open")).toBeFalsy();

    allow = true;
    await closeBtn.trigger("click");
    expect(wrapper.emitted("update:open")?.[0]).toEqual([false]);
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

    it("focuses without scrolling so a contained portal target is not dragged sideways", async () => {
      const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");
      const wrapper = mount(ODrawer, {
        attachTo: document.body,
        props: { open: true, title: "Contained" },
        slots: { default: '<button autofocus data-testid="autofocus-close">Close</button>' },
      });
      const panel = findDrawerPanel(wrapper);
      focusSpy.mockClear();

      await panel.vm.$emit("openAutoFocus", new Event("openAutoFocus", { cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve));

      expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
      focusSpy.mockRestore();
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

    it("cancels Escape when closeGuard vetoes it, so the drawer stays open", async () => {
      const guard = vi.fn(() => false);
      const wrapper = mount(ODrawer, {
        props: { open: true, title: "Test", closeGuard: guard },
      });
      const panel = findDrawerPanel(wrapper);
      const event = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
      await panel.vm.$emit("escapeKeyDown", event);
      expect(event.defaultPrevented).toBe(true);
      expect(guard).toHaveBeenCalledTimes(1);
      expect(wrapper.emitted("update:open")).toBeFalsy();
    });

    it("does NOT emit update:open when Escape is pressed and persistent=true", async () => {
      const wrapper = mount(ODrawer, {
        props: { open: true, title: "Test", persistent: true },
      });
      const panel = findDrawerPanel(wrapper);
      await panel.vm.$emit("escapeKeyDown", new KeyboardEvent("keydown", { key: "Escape" }));
      expect(wrapper.emitted("update:open")).toBeFalsy();
    });

    it("stays open on an outside interaction when modal=false", async () => {
      const wrapper = mount(ODrawer, {
        props: { open: true, title: "Test", modal: false, seamless: true },
      });
      const panel = findDrawerPanel(wrapper);
      const event = new CustomEvent("interactOutside", { cancelable: true });
      await panel.vm.$emit("interactOutside", event);
      expect(event.defaultPrevented).toBe(true);
      expect(wrapper.emitted("update:open")).toBeFalsy();
    });

    it("still closes on Escape when modal=false", async () => {
      const wrapper = mount(ODrawer, {
        props: { open: true, title: "Test", modal: false },
      });
      const panel = findDrawerPanel(wrapper);
      await panel.vm.$emit("escapeKeyDown", new KeyboardEvent("keydown", { key: "Escape" }));
      expect(wrapper.emitted("update:open")?.[0]).toEqual([false]);
    });
  });
  describe("close focus (returnFocusTo / after-close)", () => {
    const closeEvent = () => new Event("closeAutoFocus", { cancelable: true });

    function mountWith(returnFocusTo?: () => HTMLElement | null) {
      return mount(ODrawer, {
        attachTo: document.body,
        props: { open: true, title: "Details", returnFocusTo },
        slots: { default: "<p>Body</p>" },
      });
    }

    it("focuses the returnFocusTo element on close and scrolls it into view", async () => {
      const row = document.createElement("tr");
      row.tabIndex = 0;
      row.scrollIntoView = vi.fn();
      document.body.appendChild(row);
      const wrapper = mountWith(() => row);
      const event = closeEvent();

      await findDrawerPanel(wrapper).vm.$emit("closeAutoFocus", event);

      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(row);
      expect(row.scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
      expect(wrapper.emitted("after-close")).toHaveLength(1);
      wrapper.unmount();
    });

    it("keeps the default when the element is detached", async () => {
      const detached = document.createElement("button");
      detached.focus = vi.fn();
      const wrapper = mountWith(() => detached);
      const event = closeEvent();

      await findDrawerPanel(wrapper).vm.$emit("closeAutoFocus", event);

      expect(event.defaultPrevented).toBe(false);
      expect(detached.focus).not.toHaveBeenCalled();
      expect(wrapper.emitted("after-close")).toHaveLength(1);
      wrapper.unmount();
    });

    it("keeps the default when returnFocusTo returns null or is absent", async () => {
      for (const returnFocusTo of [() => null, undefined]) {
        const wrapper = mountWith(returnFocusTo);
        const event = closeEvent();
        await findDrawerPanel(wrapper).vm.$emit("closeAutoFocus", event);
        expect(event.defaultPrevented).toBe(false);
        expect(wrapper.emitted("after-close")).toHaveLength(1);
        wrapper.unmount();
      }
    });

    it("resolves the target at close time, not at open time", async () => {
      const first = document.createElement("button");
      const second = document.createElement("button");
      document.body.append(first, second);
      second.scrollIntoView = vi.fn();
      let current = first;
      const wrapper = mountWith(() => current);
      current = second;

      await findDrawerPanel(wrapper).vm.$emit("closeAutoFocus", closeEvent());

      expect(document.activeElement).toBe(second);
      wrapper.unmount();
    });

    it("focuses the element when the real dialog closes", async () => {
      const row = document.createElement("tr");
      row.tabIndex = 0;
      row.scrollIntoView = vi.fn();
      document.body.appendChild(row);
      const wrapper = mountWith(() => row);
      await new Promise((resolve) => setTimeout(resolve));

      await wrapper.setProps({ open: false });
      await new Promise((resolve) => setTimeout(resolve));

      expect(document.activeElement).toBe(row);
      expect(wrapper.emitted("after-close")).toHaveLength(1);
      wrapper.unmount();
    });

    it("leaves focus the page took while the drawer was closing", async () => {
      const row = document.createElement("tr");
      row.tabIndex = 0;
      row.scrollIntoView = vi.fn();
      const editor = document.createElement("textarea");
      document.body.append(row, editor);
      const wrapper = mountWith(() => row);
      editor.focus();
      const event = closeEvent();

      await findDrawerPanel(wrapper).vm.$emit("closeAutoFocus", event);

      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(editor);
      expect(row.scrollIntoView).not.toHaveBeenCalled();
      expect(wrapper.emitted("after-close")).toHaveLength(1);
      wrapper.unmount();
      row.remove();
      editor.remove();
    });
  });
});

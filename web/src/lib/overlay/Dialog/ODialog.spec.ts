import { describe, it, expect, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import ODialog from "./ODialog.vue";
import { DialogContent } from "reka-ui";

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
    expect(wrapper.find('button[aria-label="Close dialog"]').exists()).toBe(true);
  });

  it("hides the close button when showClose=false", () => {
    const wrapper = mount(ODialog, {
      props: { open: true, title: "Test", showClose: false },
    });
    expect(wrapper.find('button[aria-label="Close dialog"]').exists()).toBe(false);
  });

  it("hides the close button when persistent=true, since a forced flow cannot be dismissed", () => {
    const wrapper = mount(ODialog, {
      props: { open: true, title: "Test", persistent: true },
    });
    expect(wrapper.find('button[aria-label="Close dialog"]').exists()).toBe(false);
  });

  it("hides the close button when showClose=false even with persistent=true", () => {
    const wrapper = mount(ODialog, {
      props: { open: true, title: "Test", persistent: true, showClose: false },
    });
    expect(wrapper.find('button[aria-label="Close dialog"]').exists()).toBe(false);
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

  it("uses ariaTitle as the hidden dialog title", () => {
    const wrapper = mount(ODialog, {
      props: { open: true, ariaTitle: "Welcome", showClose: false },
    });
    const content = wrapper.findComponent(DialogContent);
    const id = content.attributes("aria-labelledby");
    expect(wrapper.find(`#${id}`).text()).toBe("Welcome");
    expect(wrapper.text().match(/Welcome/g)).toHaveLength(2);
  });

  describe("header-right slot", () => {
    it("renders header-right slot content", () => {
      const wrapper = mount(ODialog, {
        props: { open: true, title: "Test" },
        slots: { "header-right": '<button data-testid="hr-btn">Action</button>' },
      });
      expect(wrapper.find('[data-testid="hr-btn"]').exists()).toBe(true);
    });

    it("header-right wrapper has shrink-0, not flex-1 (no transparent blocking area)", () => {
      const wrapper = mount(ODialog, {
        props: { open: true, title: "Test" },
        slots: { "header-right": '<button data-testid="hr-btn">Action</button>' },
      });
      const hrWrapper = wrapper.find('[data-testid="hr-btn"]').element.parentElement!;
      expect(hrWrapper.className).toContain("shrink-0");
      expect(hrWrapper.className).not.toContain("flex-1");
    });

    it("spacer appears before header-right in DOM (keeps content right-aligned)", () => {
      const wrapper = mount(ODialog, {
        props: { open: true, title: "Test" },
        slots: { "header-right": '<button data-testid="hr-btn">Action</button>' },
      });
      const closeBtn = wrapper.find('button[aria-label="Close dialog"]');
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

  describe("sticky layout structure", () => {
    it("header has shrink-0 class (pinned, never scrolls)", () => {
      const wrapper = mount(ODialog, {
        props: { open: true, title: "Test" },
      });
      // The close button is a direct child of the header div
      const closeBtn = wrapper.find('button[aria-label="Close dialog"]');
      const headerEl = closeBtn.element.parentElement;
      expect(headerEl?.className).toContain("shrink-0");
    });

    it("body does NOT have flex-1 (must not push footer to bottom on short content)", () => {
      const wrapper = mount(ODialog, {
        props: { open: true },
        slots: { default: '<p data-testid="body-content">body</p>' },
      });
      const bodyContent = wrapper.find('[data-testid="body-content"]');
      const bodyEl = bodyContent.element.parentElement;
      expect(bodyEl?.className).not.toContain("flex-1");
      expect(bodyEl?.className).toContain("min-h-0");
      expect(bodyEl?.className).toContain("overflow-y-auto");
    });

    it("footer has shrink-0 class (does not expand to fill space)", () => {
      const wrapper = mount(ODialog, {
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
      const wrapper = mount(ODialog, {
        props: { open: true, primary: { label: "Save" } },
      });
      await wrapper.find('[data-test="o-dialog-primary-btn"]').trigger("click");
      expect(wrapper.emitted("click:primary")).toBeTruthy();
    });
  });

  describe("Escape key behaviour", () => {
    // reka-ui fires @escape-key-down via a document-level listener that does not
    // run in jsdom. We simulate it by calling vm.$emit('escapeKeyDown', …) on the
    // DialogContent component that owns the @escape-key-down handler.
    function findDialogPanel(wrapper: ReturnType<typeof mount>) {
      return wrapper
        .findAllComponents(DialogContent)
        .find((c) => c.attributes("data-o2-dialog") !== undefined)!;
    }

    it("emits update:open=false when Escape is pressed (non-persistent)", async () => {
      const wrapper = mount(ODialog, {
        props: { open: true, title: "Test" },
      });
      const panel = findDialogPanel(wrapper);
      await panel.vm.$emit("escapeKeyDown", new KeyboardEvent("keydown", { key: "Escape" }));
      const emitted = wrapper.emitted("update:open");
      expect(emitted).toBeTruthy();
      expect(emitted?.[0]).toEqual([false]);
    });

    it("stays open when Escape comes from an open dropdown or select inside it", async () => {
      const wrapper = mount(ODialog, {
        props: { open: true, title: "Test" },
      });
      const panel = findDialogPanel(wrapper);
      const popup = document.createElement("div");
      popup.setAttribute("data-reka-popper-content-wrapper", "");
      const item = document.createElement("div");
      popup.appendChild(item);
      document.body.appendChild(popup);
      const event = new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      });
      item.dispatchEvent(event);

      await panel.vm.$emit("escapeKeyDown", event);

      expect(wrapper.emitted("update:open")).toBeFalsy();
      popup.remove();
    });

    it("does NOT emit update:open when Escape is pressed and persistent=true", async () => {
      const wrapper = mount(ODialog, {
        props: { open: true, title: "Test", persistent: true },
      });
      const panel = findDialogPanel(wrapper);
      await panel.vm.$emit("escapeKeyDown", new KeyboardEvent("keydown", { key: "Escape" }));
      expect(wrapper.emitted("update:open")).toBeFalsy();
    });
  });

  // A bare printable key pressed on a non-field element inside the modal
  // (footer button, panel itself) must not bubble to the window-level shortcut
  // manager, where it would fire page shortcuts (e.g. logs "s" opening Saved
  // Views on top of an open dialog). Keys typed in inputs, modifier combos,
  // and non-printable keys (Escape) must keep propagating.
  describe("modal keystroke containment", () => {
    function dispatchKeydown(el: Element, init: KeyboardEventInit): boolean {
      const spy = vi.fn();
      document.addEventListener("keydown", spy);
      el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
      document.removeEventListener("keydown", spy);
      return spy.mock.calls.length > 0;
    }

    it("should stop a printable key pressed on a footer button from reaching document", () => {
      const wrapper = mount(ODialog, {
        attachTo: document.body,
        props: { open: true, title: "Test", primary: { label: "OK" } },
      });
      const btn = wrapper.find('[data-test="o-dialog-primary-btn"]');
      expect(btn.exists()).toBe(true);
      expect(dispatchKeydown(btn.element, { key: "s" })).toBe(false);
      wrapper.unmount();
    });

    it("should ignore a keydown with no key, as browser autofill dispatches", () => {
      const uncaught = vi.fn((e: ErrorEvent) => e.preventDefault());
      window.addEventListener("error", uncaught);
      const wrapper = mount(ODialog, {
        attachTo: document.body,
        props: { open: true, title: "Test", primary: { label: "OK" } },
      });
      const btn = wrapper.find('[data-test="o-dialog-primary-btn"]');
      btn.element.dispatchEvent(new Event("keydown", { bubbles: true, cancelable: true }));

      window.removeEventListener("error", uncaught);
      expect(uncaught).not.toHaveBeenCalled();
      wrapper.unmount();
    });

    it("should let a printable key typed inside an input propagate", () => {
      const wrapper = mount(ODialog, {
        attachTo: document.body,
        props: { open: true, title: "Test" },
        slots: { default: '<input data-testid="field" />' },
      });
      const input = wrapper.find('[data-testid="field"]');
      expect(input.exists()).toBe(true);
      expect(dispatchKeydown(input.element, { key: "s" })).toBe(true);
      wrapper.unmount();
    });

    it("should let modifier combos and non-printable keys propagate", () => {
      const wrapper = mount(ODialog, {
        attachTo: document.body,
        props: { open: true, title: "Test", primary: { label: "OK" } },
      });
      const btn = wrapper.find('[data-test="o-dialog-primary-btn"]');
      expect(dispatchKeydown(btn.element, { key: "s", ctrlKey: true })).toBe(true);
      expect(dispatchKeydown(btn.element, { key: "Escape" })).toBe(true);
      wrapper.unmount();
    });
  });
  describe("initial focus", () => {
    const openConfirm = async (props: Record<string, unknown> = {}) => {
      const wrapper = mount(ODialog, {
        attachTo: document.body,
        props: {
          open: true,
          title: "Discard?",
          primary: { label: "Discard" },
          secondary: { label: "Keep" },
          ...props,
        },
        slots: { default: "<p>Body</p>" },
      });
      await flushPromises();
      // jsdom never runs reka's mount auto-focus, so fire the event ODialog handles.
      const content = wrapper.findAllComponents(DialogContent).at(-1)!;
      content.vm.$emit("openAutoFocus", new Event("focus.autoFocusOnMount"));
      await flushPromises();
      return wrapper;
    };

    it("focuses the primary button when the body has no field", async () => {
      const wrapper = await openConfirm();
      await vi.waitFor(() =>
        expect(document.activeElement?.getAttribute("data-test")).toBe("o-dialog-primary-btn"),
      );
      wrapper.unmount();
    });

    it("focuses the secondary button when the primary is destructive, so Enter cannot run it", async () => {
      const wrapper = await openConfirm({
        primary: { label: "Discard", variant: "danger" },
      });
      await vi.waitFor(() =>
        expect(document.activeElement?.getAttribute("data-test")).toBe("o-dialog-secondary-btn"),
      );
      wrapper.unmount();
    });
  });
  describe("focus repair on body swaps", () => {
    const editing = ref(false);
    const swapping = defineComponent({
      setup() {
        return () =>
          editing.value
            ? h("div", { key: "after" }, [h("input", { "data-test": "after" })])
            : h("div", { key: "before" }, [h("input", { "data-test": "before" })]);
      },
    });

    const mountSwapping = async () => {
      editing.value = false;
      const wrapper = mount(ODialog, {
        attachTo: document.body,
        props: { open: true },
        slots: { default: () => h(swapping) },
      });
      await flushPromises();
      return wrapper;
    };

    const popoverSearch = () => {
      const popper = document.createElement("div");
      popper.setAttribute("data-reka-popper-content-wrapper", "");
      const search = document.createElement("input");
      popper.appendChild(search);
      document.body.appendChild(popper);
      return { popper, search };
    };

    it("moves focus to the swapped-in field when focus fell out of the body", async () => {
      const wrapper = await mountSwapping();
      (document.activeElement as HTMLElement | null)?.blur();
      editing.value = true;
      await flushPromises();
      await vi.waitFor(() =>
        expect(document.activeElement?.getAttribute("data-test")).toBe("after"),
      );
      wrapper.unmount();
    });

    it("keeps focus on a portaled popover search the swap opened", async () => {
      const wrapper = await mountSwapping();
      const { popper, search } = popoverSearch();
      editing.value = true;
      await nextTick();
      search.focus();
      await flushPromises();
      await new Promise((resolve) => setTimeout(resolve));
      expect(document.activeElement).toBe(search);
      popper.remove();
      wrapper.unmount();
    });
  });

  describe("fixed top and sizes", () => {
    const panelOf = (w: ReturnType<typeof mount>) =>
      w.find("[data-o2-dialog]").element as HTMLElement;

    it("sits at a fixed 12vh top and never centres vertically (O5)", async () => {
      const wrapper = mount(ODialog, { props: { open: true } });
      await flushPromises();
      const classes = panelOf(wrapper).className;
      expect(classes).toContain("top-[12vh]");
      expect(classes).not.toContain("top-1/2");
      expect(panelOf(wrapper).getAttribute("style") ?? "").not.toContain("top:");
    });

    it.each([
      ["sm", "25rem"],
      ["md", "35rem"],
      ["lg", "45rem"],
    ])("draws size %s at its fixed width", async (size, width) => {
      const wrapper = mount(ODialog, { props: { open: true, size: size as "sm" } });
      await flushPromises();
      expect(panelOf(wrapper).className).toContain(width);
      expect(panelOf(wrapper).getAttribute("data-o2-dialog-size")).toBe(size);
    });

    it("has no width or max-height escape hatch", () => {
      expect(ODialog.props).not.toHaveProperty("width");
      expect(ODialog.props).not.toHaveProperty("maxHeight");
    });
  });

  describe("footer actions", () => {
    it("puts the extra action on the left and Cancel before the primary on the right (O7)", async () => {
      const wrapper = mount(ODialog, {
        props: {
          open: true,
          primary: { label: "Save" },
          secondary: { label: "Cancel" },
          extra: { label: "Test" },
        },
      });
      await flushPromises();
      const order = wrapper
        .findAll("[data-o2-btn]")
        .map((b) => b.attributes("data-test"))
        .filter((id) => id !== "o-dialog-close-btn");
      expect(order).toEqual([
        "o-dialog-neutral-btn",
        "o-dialog-secondary-btn",
        "o-dialog-primary-btn",
      ]);
    });

    it("emits click:extra from the extra action", async () => {
      const wrapper = mount(ODialog, { props: { open: true, extra: { label: "Delete" } } });
      await wrapper.find('[data-test="o-dialog-neutral-btn"]').trigger("click");
      expect(wrapper.emitted("click:extra")).toBeTruthy();
    });

    it("keeps a disabled action focusable with its reason", async () => {
      const wrapper = mount(ODialog, {
        props: {
          open: true,
          primary: { label: "Save", disabled: true, disabledReason: "Fix 2 errors" },
        },
      });
      await flushPromises();
      const btn = wrapper.find('[data-test="o-dialog-primary-btn"]');
      expect(btn.attributes("aria-disabled")).toBe("true");
      expect(btn.attributes("aria-describedby")).toBeTruthy();
    });

    it("uses the action's own data-test", () => {
      const wrapper = mount(ODialog, {
        props: { open: true, primary: { label: "Go", dataTest: "my-go" } },
      });
      expect(wrapper.find('[data-test="my-go"]').exists()).toBe(true);
    });
  });

  describe("discard guard (V5, O8)", () => {
    function findDialogPanel(wrapper: ReturnType<typeof mount>) {
      return wrapper
        .findAllComponents(DialogContent)
        .find((c) => c.attributes("data-o2-dialog") !== undefined)!;
    }
    const escape = () => new KeyboardEvent("keydown", { key: "Escape" });

    it("asks in its own footer instead of closing when dirty", async () => {
      const wrapper = mount(ODialog, {
        props: { open: true, dirty: true, primary: { label: "Save" } },
      });
      await findDialogPanel(wrapper).vm.$emit("escapeKeyDown", escape());
      await flushPromises();
      expect(wrapper.emitted("update:open")).toBeFalsy();
      expect(wrapper.find('[data-test="o-dialog-discard-row"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="o-dialog-primary-btn"]').exists()).toBe(false);
      expect(wrapper.findAll("[data-o2-dialog]").length).toBe(1);
    });

    it("keeps editing on Keep editing and closes with a discard event on Discard", async () => {
      const wrapper = mount(ODialog, { props: { open: true, dirty: true } });
      await wrapper.find('[data-test="o-dialog-close-btn"]').trigger("click");
      await flushPromises();
      await wrapper.find('[data-test="o-dialog-keep-editing-btn"]').trigger("click");
      await flushPromises();
      expect(wrapper.find('[data-test="o-dialog-discard-row"]').exists()).toBe(false);
      expect(wrapper.emitted("update:open")).toBeFalsy();

      await wrapper.find('[data-test="o-dialog-close-btn"]').trigger("click");
      await flushPromises();
      await wrapper.find('[data-test="o-dialog-discard-btn"]').trigger("click");
      expect(wrapper.emitted("discard")).toBeTruthy();
      expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
    });

    it("closes at once when there are no edits", async () => {
      const wrapper = mount(ODialog, { props: { open: true } });
      await findDialogPanel(wrapper).vm.$emit("escapeKeyDown", escape());
      expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
    });

    it("cannot be dismissed while an action is busy", async () => {
      const wrapper = mount(ODialog, {
        props: { open: true, primary: { label: "Save", loading: true } },
      });
      await findDialogPanel(wrapper).vm.$emit("escapeKeyDown", escape());
      expect(wrapper.emitted("update:open")).toBeFalsy();
    });
  });

  describe("Enter in a form (V7)", () => {
    const pressEnter = (input: Element) => {
      const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
      input.dispatchEvent(event);
      return event.defaultPrevented;
    };

    it("lets Enter submit a single-field form", () => {
      const wrapper = mount(ODialog, {
        attachTo: document.body,
        props: { open: true },
        slots: { default: '<form><input data-testid="name" /></form>' },
      });
      expect(pressEnter(wrapper.find('[data-testid="name"]').element)).toBe(false);
      wrapper.unmount();
    });

    it("never submits a multi-field form on Enter", () => {
      const wrapper = mount(ODialog, {
        attachTo: document.body,
        props: { open: true },
        slots: { default: '<form><input data-testid="name" /><textarea /></form>' },
      });
      expect(pressEnter(wrapper.find('[data-testid="name"]').element)).toBe(true);
      wrapper.unmount();
    });
  });
});

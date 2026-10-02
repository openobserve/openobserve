import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { h, nextTick } from "vue";
import { TooltipProvider } from "reka-ui";
import OTooltip from "./OTooltip.vue";

// Reka UI portals content into <body>. Render inline for unit tests.
vi.mock("reka-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("reka-ui")>();
  return {
    ...actual,
    TooltipPortal: actual.TooltipContent, // render inline instead of portaling
  };
});

/** Mount OTooltip wrapped in TooltipProvider so TooltipRoot finds its context */
function mountTooltip(
  props: Record<string, unknown>,
  slots: Record<string, () => ReturnType<typeof h> | string> = {},
) {
  return mount({ render: () => h(TooltipProvider, () => h(OTooltip, props, slots)) });
}

describe("OTooltip", () => {
  it("renders the trigger slot", () => {
    const wrapper = mountTooltip(
      { content: "Hello" },
      { default: () => h("button", { "data-testid": "trigger" }, "Hover me") },
    );
    expect(wrapper.find('[data-testid="trigger"]').exists()).toBe(true);
  });

  it("renders content from the content prop", () => {
    const wrapper = mountTooltip(
      { content: "Tooltip text", open: true },
      { default: () => h("button", "Hover") },
    );
    expect(wrapper.text()).toContain("Tooltip text");
  });

  it("renders rich content from the #content slot", () => {
    const wrapper = mountTooltip(
      { open: true },
      {
        default: () => h("button", "Hover"),
        content: () => h("span", { "data-testid": "rich" }, "Rich content"),
      },
    );
    expect(wrapper.find('[data-testid="rich"]').exists()).toBe(true);
  });

  it("does not open when disabled", () => {
    const wrapper = mountTooltip(
      { content: "Never shown", disabled: true, open: true },
      { default: () => h("button", "Hover") },
    );
    // TooltipRoot is locked closed when disabled=true ΓÇö no role="tooltip" in DOM
    expect(wrapper.find('[role="tooltip"]').exists()).toBe(false);
  });

  // ── Hover ──────────────────────────────────────────────────────────────────
  //
  // Every test above forces `open: true`, which is why a tooltip that could
  // never open on its own went unnoticed: `open` is declared `open?: boolean`,
  // and Vue casts an ABSENT Boolean prop to `false` rather than `undefined`.
  // OTooltip's `open !== undefined` guard therefore passed, TooltipRoot was
  // handed `open: false`, and reka switched into controlled mode locked shut —
  // wrapper mode emits no update:open, so hovering left the trigger at
  // data-state="closed" forever. These two open it the way a user does.
  describe("opening on hover", () => {
    const hover = async (el: Element) => {
      el.dispatchEvent(new MouseEvent("pointermove", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 60));
      await nextTick();
    };

    it("opens in wrapper mode, where the trigger is the default slot", async () => {
      const wrapper = mount(OTooltip, {
        props: { content: "Hello", delay: 10 },
        slots: { default: () => h("button", { "data-testid": "t" }, "Hover") },
        attachTo: document.body,
      });

      const trigger = wrapper.find('[data-testid="t"]').element;
      expect(trigger.getAttribute("data-state")).toBe("closed");

      await hover(trigger);
      expect(trigger.getAttribute("data-state")).not.toBe("closed");

      wrapper.unmount();
    });

    it("opens in child mode, where it attaches to its parent element", async () => {
      const wrapper = mount(
        {
          render: () =>
            h("button", { "data-testid": "t" }, [h(OTooltip, { content: "Hello", delay: 10 })]),
        },
        { attachTo: document.body },
      );

      const trigger = wrapper.find('[data-testid="t"]').element;
      // Child mode binds its own mouseenter listener to the parent element.
      trigger.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 60));
      await nextTick();

      expect(wrapper.findComponent(OTooltip).vm.$el).toBeTruthy();
      expect(document.body.textContent).toContain("Hello");

      wrapper.unmount();
    });

    // A kept-alive page deactivates without unmounting, and a detached trigger
    // never fires `mouseleave` — so a tooltip open at the moment of a tab
    // switch survived it. Observable on RETURN: without the onDeactivated
    // close, the bubble re-rendered open with no hover at all.
    it("closes an open child-mode tooltip when its page is deactivated", async () => {
      const Page = {
        name: "TooltipPage",
        render: () =>
          h("button", { "data-testid": "t" }, [h(OTooltip, { content: "Hello", delay: 10 })]),
      };
      const Other = { name: "OtherPage", render: () => h("div", "elsewhere") };
      const wrapper = mount(
        {
          components: { Page, Other },
          data: () => ({ active: "Page" }),
          template: `<KeepAlive><component :is="active" /></KeepAlive>`,
        },
        { attachTo: document.body },
      );

      const trigger = wrapper.find('[data-testid="t"]').element;
      trigger.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 60));
      await nextTick();
      expect(document.body.textContent).toContain("Hello");

      // Switch away (deactivate) and back (reactivate) — no hover in between.
      (wrapper.vm as any).active = "Other";
      await nextTick();
      (wrapper.vm as any).active = "Page";
      await nextTick();
      await nextTick();

      expect(document.body.textContent).not.toContain("Hello");

      wrapper.unmount();
    });
  });

  // ── Overflow-only and anchored tooltips ────────────────────────────────────
  describe("overflow-only", () => {
    // jsdom has no layout, so a test sets the two widths the cut-off check compares.
    const setWidths = (el: Element, scrollWidth: number, clientWidth: number) => {
      Object.defineProperty(el, "scrollWidth", { configurable: true, value: scrollWidth });
      Object.defineProperty(el, "clientWidth", { configurable: true, value: clientWidth });
    };
    const settle = async () => {
      await new Promise((r) => setTimeout(r, 60));
      await nextTick();
    };
    const mountChild = () =>
      mount(
        {
          render: () =>
            h("span", { "data-testid": "t" }, [
              h(OTooltip, { overflowOnly: true, delay: 10 }),
              "payment-service-production-eu-west",
            ]),
        },
        { attachTo: document.body },
      );

    it("opens in child mode with the parent's own text when the parent is cut", async () => {
      const wrapper = mountChild();
      const trigger = wrapper.find('[data-testid="t"]').element;
      setWidths(trigger, 310, 200);

      trigger.dispatchEvent(new MouseEvent("mouseenter"));
      await settle();

      expect(document.body.querySelector('[data-test="o-tooltip-content"]')?.textContent).toContain(
        "payment-service-production-eu-west",
      );
      wrapper.unmount();
    });

    it("stays closed in child mode when the parent's text fits", async () => {
      const wrapper = mountChild();
      const trigger = wrapper.find('[data-testid="t"]').element;
      setWidths(trigger, 200, 200);

      trigger.dispatchEvent(new MouseEvent("mouseenter"));
      await settle();

      expect(document.body.querySelector('[data-test="o-tooltip-content"]')).toBeNull();
      wrapper.unmount();
    });

    it("opens in wrapper mode only when the wrapped trigger is cut", async () => {
      const mountWrapper = (cut: boolean) => {
        const wrapper = mount(OTooltip, {
          props: { overflowOnly: true, delay: 10 },
          slots: { default: () => h("button", { "data-testid": "t" }, "Long name") },
          attachTo: document.body,
        });
        const trigger = wrapper.find('[data-testid="t"]').element;
        setWidths(trigger, cut ? 310 : 200, 200);
        return { wrapper, trigger };
      };

      const fits = mountWrapper(false);
      fits.trigger.dispatchEvent(new MouseEvent("pointermove", { bubbles: true }));
      await settle();
      expect(fits.trigger.getAttribute("data-state")).toBe("closed");
      fits.wrapper.unmount();

      const cut = mountWrapper(true);
      cut.trigger.dispatchEvent(new MouseEvent("pointermove", { bubbles: true }));
      await settle();
      expect(cut.trigger.getAttribute("data-state")).not.toBe("closed");
      cut.wrapper.unmount();
    });

    it("marks the element it belongs to, in both modes", () => {
      const child = mountChild();
      expect(child.find('[data-testid="t"]').attributes("data-o-tooltip-trigger")).toBe("");
      child.unmount();

      const wrapped = mount(OTooltip, {
        props: { content: "Hello" },
        slots: { default: () => h("button", { "data-testid": "w" }, "Hover") },
      });
      expect(wrapped.find('[data-testid="w"]').attributes("data-o-tooltip-trigger")).toBe("");
      wrapped.unmount();
    });

    it("positions one shared tooltip on the given anchor and follows `open`", async () => {
      const anchor = document.createElement("div");
      document.body.appendChild(anchor);
      const wrapper = mount(OTooltip, {
        props: { anchor, open: true, content: "Full cell value" },
        attachTo: document.body,
      });
      await nextTick();
      expect(document.body.textContent).toContain("Full cell value");

      await wrapper.setProps({ open: false });
      // reka removes a closed bubble a few ticks after `open` turns false.
      for (let i = 0; i < 4; i++) await nextTick();
      expect(document.body.querySelector('[data-test="o-tooltip-content"]')).toBeNull();

      wrapper.unmount();
      anchor.remove();
    });
  });

  // ── Content wrapper layout ─────────────────────────────────────────────────
  //
  // The content wrapper used to be `inline-flex items-center gap-1.5`
  // unconditionally, purely to align an optional keyboard-shortcut chip. But
  // `inline-flex` turned every text run / <b> / <br> of a multi-line tooltip
  // into a separate flex item on one non-wrapping row, so each run collapsed to
  // its longest word — text wrapped into a narrow column and short leading runs
  // were vertically centred against the tall body (the "not aligned" bug seen
  // across Legend / Step / Y-Axis / VRL tooltips). Flex is now applied ONLY when
  // a shortcut is present; plain tooltips flow as normal wrapping text.
  it("does not force inline-flex on the content wrapper without a shortcut", () => {
    const wrapper = mountTooltip(
      { content: "Multi line body text", open: true },
      { default: () => h("button", "Hover") },
    );
    const contentSpan = wrapper.find('[data-test="o-tooltip-content"] > span');
    expect(contentSpan.exists()).toBe(true);
    expect(contentSpan.classes()).not.toContain("inline-flex");
  });

  it("applies inline-flex on the content wrapper when a shortcut is present", () => {
    const wrapper = mountTooltip(
      { content: "Save", open: true, shortcut: "ctrl+s" },
      { default: () => h("button", "Hover") },
    );
    const contentSpan = wrapper.find('[data-test="o-tooltip-content"] > span');
    expect(contentSpan.classes()).toContain("inline-flex");
  });

  // Both modes render a fragment (provider + portalled content), so Vue has no
  // root to fall attributes onto — call-site class/aria were silently dropped
  // with an "Extraneous non-props attributes" warning. They now land on the bubble.
  it("forwards call-site class onto the tooltip bubble", () => {
    const wrapper = mountTooltip(
      { content: "Centered", open: true, class: "text-center" },
      { default: () => h("button", "Hover") },
    );
    const bubble = wrapper.find('[data-test="o-tooltip-content"]');
    expect(bubble.exists()).toBe(true);
    expect(bubble.classes()).toContain("text-center");
  });

  it("merges a call-site style with the bubble's own styling", () => {
    const wrapper = mountTooltip(
      { content: "Wide", open: true, style: "min-width: 5rem" },
      { default: () => h("button", "Hover") },
    );
    const style = wrapper.find('[data-test="o-tooltip-content"]').attributes("style") ?? "";
    // The caller's declaration lands without discarding max-width, which the
    // component sets from its own `maxWidth` prop.
    expect(style).toContain("min-width");
    expect(style).toContain("max-width");
  });

  // e2e selects the bubble by `o-tooltip-content` in many places, so a call-site
  // data-test must not replace it.
  it("keeps its own data-test even when a call site passes one", () => {
    const wrapper = mountTooltip(
      { content: "Owned", open: true, "data-test": "caller-supplied" },
      { default: () => h("button", "Hover") },
    );
    expect(wrapper.find('[data-test="o-tooltip-content"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="caller-supplied"]').exists()).toBe(false);
  });

  it("applies contentClass to the tooltip bubble", () => {
    const wrapper = mountTooltip(
      { content: "Styled", open: true, contentClass: "my-custom-class" },
      { default: () => h("button", "Hover") },
    );
    expect(wrapper.find(".my-custom-class").exists()).toBe(true);
  });

  it("accepts side and align props without errors", () => {
    const wrapper = mountTooltip(
      { content: "Positioned", open: true, side: "right", align: "end" },
      { default: () => h("button", "Hover") },
    );
    expect(wrapper.html()).toBeTruthy();
  });
});

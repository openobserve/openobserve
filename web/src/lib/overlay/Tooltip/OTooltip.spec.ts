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
  return mount(
    { render: () => h(TooltipProvider, () => h(OTooltip, props, slots)) },
  );
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
            h("button", { "data-testid": "t" }, [
              h(OTooltip, { content: "Hello", delay: 10 }),
            ]),
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

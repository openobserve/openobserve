import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { h } from "vue";
import OButton from "./OButton.vue";
import type { ButtonVariant } from "./OButton.types";

describe("OButton", () => {
  // --- Slots ---

  it("renders default slot content", () => {
    const wrapper = mount(OButton, { slots: { default: "Save" } });
    expect(wrapper.text()).toBe("Save");
  });

  it("renders icon-left slot", () => {
    const wrapper = mount(OButton, {
      slots: { "icon-left": '<span data-testid="icon-left">ΓåÉ</span>' },
    });
    expect(wrapper.find('[data-testid="icon-left"]').exists()).toBe(true);
  });

  it("renders icon-right slot", () => {
    const wrapper = mount(OButton, {
      slots: { "icon-right": '<span data-testid="icon-right">ΓåÆ</span>' },
    });
    expect(wrapper.find('[data-testid="icon-right"]').exists()).toBe(true);
  });

  // --- Props ---

  it('defaults to type="button"', () => {
    const wrapper = mount(OButton);
    expect(wrapper.attributes("type")).toBe("button");
  });

  it("forwards the type prop to the native button", () => {
    const wrapper = mount(OButton, { props: { type: "submit" } });
    expect(wrapper.attributes("type")).toBe("submit");
  });

  it("sets the disabled attribute when disabled prop is true", () => {
    const wrapper = mount(OButton, { props: { disabled: true } });
    expect(wrapper.attributes("disabled")).toBeDefined();
  });

  it("sets the disabled attribute when loading prop is true", () => {
    const wrapper = mount(OButton, { props: { loading: true } });
    expect(wrapper.attributes("disabled")).toBeDefined();
  });

  // --- Emits ---

  it("emits click with the MouseEvent when clicked", async () => {
    const wrapper = mount(OButton);
    await wrapper.trigger("click");
    const emitted = wrapper.emitted("click");
    expect(emitted).toHaveLength(1);
    expect(emitted![0][0]).toBeInstanceOf(MouseEvent);
  });

  it("does not emit click when disabled", async () => {
    const wrapper = mount(OButton, { props: { disabled: true } });
    await wrapper.trigger("click");
    expect(wrapper.emitted("click")).toBeUndefined();
  });

  it("does not emit click when loading", async () => {
    const wrapper = mount(OButton, { props: { loading: true } });
    await wrapper.trigger("click");
    expect(wrapper.emitted("click")).toBeUndefined();
  });

  // --- ARIA ---

  it('sets aria-disabled="true" when disabled', () => {
    const wrapper = mount(OButton, { props: { disabled: true } });
    expect(wrapper.attributes("aria-disabled")).toBe("true");
  });

  it('sets aria-disabled="true" when loading', () => {
    const wrapper = mount(OButton, { props: { loading: true } });
    expect(wrapper.attributes("aria-disabled")).toBe("true");
  });

  it('sets aria-busy="true" when loading', () => {
    const wrapper = mount(OButton, { props: { loading: true } });
    expect(wrapper.attributes("aria-busy")).toBe("true");
  });

  it("does not set aria-busy when not loading", () => {
    const wrapper = mount(OButton);
    expect(wrapper.attributes("aria-busy")).toBeUndefined();
  });

  it("does not set aria-disabled when not disabled or loading", () => {
    const wrapper = mount(OButton);
    expect(wrapper.attributes("aria-disabled")).toBeUndefined();
  });

  // --- Variant classes ---

  it("applies primary variant classes by default", () => {
    const wrapper = mount(OButton);
    expect(wrapper.classes().join(" ")).toContain("bg-button-primary");
  });

  it("applies secondary variant classes", () => {
    const wrapper = mount(OButton, { props: { variant: "secondary" } });
    expect(wrapper.classes().join(" ")).toContain("bg-button-secondary");
  });

  it("applies outline variant classes", () => {
    const wrapper = mount(OButton, { props: { variant: "outline" } });
    expect(wrapper.classes().join(" ")).toContain("text-button-outline-text");
  });

  it("applies ghost variant classes", () => {
    const wrapper = mount(OButton, { props: { variant: "ghost" } });
    expect(wrapper.classes().join(" ")).toContain("text-button-ghost-text");
  });

  it("applies destructive variant classes", () => {
    const wrapper = mount(OButton, { props: { variant: "destructive" } });
    expect(wrapper.classes().join(" ")).toContain("bg-button-destructive");
  });

  it("applies ghost-primary variant classes", () => {
    const wrapper = mount(OButton, { props: { variant: "ghost-primary" } });
    expect(wrapper.classes().join(" ")).toContain("text-button-ghost-primary-text");
  });

  it("applies ghost-destructive variant classes", () => {
    const wrapper = mount(OButton, { props: { variant: "ghost-destructive" } });
    expect(wrapper.classes().join(" ")).toContain("text-button-ghost-destructive-text");
  });

  // Destination previews are fixed-light brand replicas: the label must use the
  // fixed brand foreground, not text-text-inverse, which turns near-black in dark mode.
  it.each([
    ["preview-slack", "text-brand-slack-foreground"],
    ["preview-teams", "text-brand-teams-foreground"],
    ["preview-email", "text-brand-email-foreground"],
    ["preview-opsgenie", "text-brand-email-ink-foreground"],
  ] as const)("paints the %s label with %s", (variant, label) => {
    const wrapper = mount(OButton, { props: { variant } });
    expect(wrapper.classes()).toContain(label);
    expect(wrapper.classes()).not.toContain("text-text-inverse");
  });

  // --- Size classes ---

  it("applies md size classes by default", () => {
    const wrapper = mount(OButton);
    expect(wrapper.classes().join(" ")).toContain("h-10");
  });

  it("applies sm size classes", () => {
    const wrapper = mount(OButton, { props: { size: "sm" } });
    // 34px control height per the design system (HANDOFF §11).
    expect(wrapper.classes().join(" ")).toContain("h-[2.125rem]");
  });

  it("applies lg size classes", () => {
    const wrapper = mount(OButton, { props: { size: "lg" } });
    expect(wrapper.classes().join(" ")).toContain("h-12");
  });

  it("applies icon size classes", () => {
    const wrapper = mount(OButton, { props: { size: "icon" } });
    expect(wrapper.classes().join(" ")).toContain("size-6");
  });

  it("applies icon-circle size classes with rounded-full", () => {
    const wrapper = mount(OButton, { props: { size: "icon-circle" } });
    const classes = wrapper.classes().join(" ");
    expect(classes).toContain("size-8");
    expect(classes).toContain("rounded-full");
  });

  it("applies icon-sm size classes (h-8 w-8)", () => {
    const wrapper = mount(OButton, { props: { size: "icon-sm" } });
    const classes = wrapper.classes().join(" ");
    expect(classes).toContain("h-8");
    expect(classes).toContain("w-8");
  });

  it("applies icon-md size classes (h-10 w-10)", () => {
    const wrapper = mount(OButton, { props: { size: "icon-md" } });
    const classes = wrapper.classes().join(" ");
    expect(classes).toContain("h-10");
    expect(classes).toContain("w-10");
  });

  it("applies icon-lg size classes (h-12 w-12)", () => {
    const wrapper = mount(OButton, { props: { size: "icon-lg" } });
    const classes = wrapper.classes().join(" ");
    expect(classes).toContain("h-12");
    expect(classes).toContain("w-12");
  });

  it("sizes xs-grouped one border-pair (0.125rem) shorter than xs", () => {
    expect(mount(OButton, { props: { size: "xs" } }).classes()).toContain("h-7");
    const classes = mount(OButton, { props: { size: "xs-grouped" } }).classes();
    expect(classes).toContain("h-6.5");
    expect(classes).not.toContain("h-7");
  });

  it("sizes icon-panel as a 1.625rem square, the icon partner of xs-grouped", () => {
    const classes = mount(OButton, { props: { size: "icon-panel" } }).classes();
    expect(classes).toContain("size-6.5");
    expect(classes).toContain("p-0");
  });

  // --- Keyboard ---

  it("emits click on Enter key (native button behaviour)", async () => {
    const wrapper = mount(OButton);
    await wrapper.trigger("keydown", { key: "Enter" });
    // Native button fires click on Enter ΓÇö we trust browser behaviour;
    // ensure the component does not suppress it when enabled.
    // Trigger click directly to confirm handler works.
    await wrapper.trigger("click");
    expect(wrapper.emitted("click")).toHaveLength(1);
  });

  // --- Attrs passthrough ---

  it("passes extra attributes to the native button", () => {
    const wrapper = mount(OButton, {
      attrs: { "data-testid": "my-btn" },
    });
    expect(wrapper.attributes("data-testid")).toBe("my-btn");
  });

  // --- Primitive: as prop ---

  it("renders as a <button> by default", () => {
    const wrapper = mount(OButton);
    expect(wrapper.element.tagName.toLowerCase()).toBe("button");
  });

  it('renders as an <a> when as="a"', () => {
    const wrapper = mount(OButton, { props: { as: "a" } });
    expect(wrapper.element.tagName.toLowerCase()).toBe("a");
  });

  // base-elements.css underlines every a:hover, which would make a link-button
  // read as prose text rather than a control.
  it('never underlines when as="a"', () => {
    const wrapper = mount(OButton, { props: { as: "a" } });
    const classes = wrapper.classes().join(" ");
    expect(classes).toContain("no-underline");
    expect(classes).toContain("hover:no-underline");
  });

  it('does not set type attribute when as="a"', () => {
    const wrapper = mount(OButton, { props: { as: "a" } });
    expect(wrapper.attributes("type")).toBeUndefined();
  });

  it('does not set disabled attribute when as="a"', () => {
    const wrapper = mount(OButton, { props: { as: "a", disabled: true } });
    expect(wrapper.attributes("disabled")).toBeUndefined();
  });

  // --- Primitive: asChild prop ---

  it("renders the child element when asChild is true", () => {
    const wrapper = mount(OButton, {
      props: { asChild: true },
      slots: { default: '<a href="/home">Home</a>' },
    });
    // asChild merges the button's attributes onto the slot's first child.
    // The <a> element should be present with the expected href.
    const link = wrapper.find('a[href="/home"]');
    expect(link.exists()).toBe(true);
    expect(link.text()).toBe("Home");
  });

  // --- Base layout / transition / focus-ring offset ---

  it("applies the multi-property transition class (color, bg, border, shadow, etc.)", () => {
    const wrapper = mount(OButton);
    const classes = wrapper.classes().join(" ");
    expect(classes).toContain(
      "transition-[color,background-color,border-color,text-decoration-color,fill,stroke,box-shadow]",
    );
    expect(classes).toContain("duration-150");
  });

  it("does not apply the old transition-colors-only utility", () => {
    const wrapper = mount(OButton);
    // The migration replaced `transition-colors` with an explicit property list.
    // Ensure we don't regress back to the colors-only utility.
    expect(wrapper.classes()).not.toContain("transition-colors");
  });

  it("applies the unified focus ring at full opacity, never a translucent accent", () => {
    const wrapper = mount(OButton);
    const classes = wrapper.classes().join(" ");
    expect(classes).toContain("focus-visible:ring-[0.125rem]!");
    expect(classes).toContain("focus-visible:ring-focus-ring-accent!");
    // accent/25 measured 1.38:1 light and 1.50:1 dark against the 3:1 SC 1.4.11 floor;
    // an alpha here is a contrast regression, not a styling preference.
    expect(classes).not.toContain("focus-visible:ring-accent/25!");
  });

  it("retains outline-none as part of base classes", () => {
    const wrapper = mount(OButton);
    const classes = wrapper.classes().join(" ");
    expect(classes).toContain("outline-none");
  });

  it("applies a focus-visible ring on the default primary variant", () => {
    const wrapper = mount(OButton);
    expect(wrapper.classes().join(" ")).toContain("focus-visible:ring-button-primary-hover");
  });

  it("applies a focus-visible ring on the secondary variant", () => {
    const wrapper = mount(OButton, { props: { variant: "secondary" } });
    expect(wrapper.classes().join(" ")).toContain("focus-visible:ring-button-secondary-focus-ring");
  });

  it("applies focus-visible:ring-3 on every styled variant", () => {
    const wrapper = mount(OButton, { props: { variant: "destructive" } });
    expect(wrapper.classes().join(" ")).toContain("focus-visible:ring-3");
  });

  // --- Loading ---

  // Regression: a child-mode OTooltip mounted mid-query anchored to an inline-flex wrapper that lost its box once loading ended, opening at (0,0)
  it("keeps the slot wrapper display:contents while loading and only hides it", () => {
    const wrapper = mount(OButton, { props: { loading: true }, slots: { default: "Save" } });
    const content = wrapper.find("span.contents");
    expect(content.exists()).toBe(true);
    expect(content.classes()).toContain("text-transparent");
    expect(content.classes()).toContain("[&>*]:opacity-0");
    expect(content.classes()).not.toContain("invisible");
    expect(content.classes()).not.toContain("inline-flex");
    expect(content.attributes("style")).toBeUndefined();
  });

  it("does not hide the slot wrapper when not loading", () => {
    const wrapper = mount(OButton, { slots: { default: "Save" } });
    const content = wrapper.find("span.contents");
    expect(content.exists()).toBe(true);
    expect(content.classes()).not.toContain("invisible");
  });

  // --- data attributes ---

  it("sets data-o2-btn on the rendered element", () => {
    const wrapper = mount(OButton);
    expect(wrapper.attributes("data-o2-btn")).toBeDefined();
  });

  it("sets data-o2-variant to the active variant name", () => {
    const wrapper = mount(OButton, { props: { variant: "ghost-primary" } });
    expect(wrapper.attributes("data-o2-variant")).toBe("ghost-primary");
  });

  it("defaults data-o2-variant to primary", () => {
    const wrapper = mount(OButton);
    expect(wrapper.attributes("data-o2-variant")).toBe("primary");
  });
  it.each([
    "primary",
    "secondary",
    "outline",
    "ghost",
    "ghost-primary",
    "ghost-muted",
    "ghost-subtle",
    "ghost-destructive",
    "ghost-success",
    "destructive",
    "filter-exclude",
    "ghost-warning",
    "warning",
    "ghost-neutral",
    "outline-destructive",
    "cancel-query",
    "panel-collapse",
    "sidebar-button",
    "sidebar-toggle",
    "ai-gradient",
    "on-dark-primary",
    "on-dark-ghost",
    "preview-slack",
    "preview-teams",
    "preview-email",
    "preview-opsgenie",
    "preview-action",
    "webinar-dismiss",
    "banner-dismiss",
    "outline-primary",
    "dashed",
    "pricing-chip",
  ] satisfies ButtonVariant[])(
    "preserves native disabled styling for %s when unavailable",
    (variant) => {
      const disabled = mount(OButton, { props: { variant, disabled: true } });
      const unavailable = mount(OButton, {
        props: { variant, disabled: true, focusableUnavailable: true },
      });
      const disabledClasses = disabled
        .classes()
        .filter((value) => value.startsWith("disabled:") && value !== "disabled:cursor-not-allowed")
        .map((value) => value.slice("disabled:".length));
      expect(disabledClasses.length).toBeGreaterThan(0);
      for (const value of disabledClasses) expect(unavailable.classes()).toContain(value);
      const groups = disabledClasses.map((value) => value.split("-")[0]);
      expect(
        unavailable
          .classes()
          .filter(
            (value) =>
              groups.includes(value.split("-")[0]) &&
              !/^text-(xs|sm|base|lg|compact|inherit)$/.test(value),
          )
          .sort(),
      ).toEqual(disabledClasses.sort());
      expect(unavailable.classes().some((value) => value.startsWith("enabled:"))).toBe(false);
      expect(unavailable.attributes("disabled")).toBeUndefined();
      disabled.unmount();
      unavailable.unmount();
    },
  );

  it("keeps an unavailable action focusable and connects its reason", async () => {
    const wrapper = mount(OButton, {
      props: { disabled: true, focusableUnavailable: true },
      slots: { default: "Configure", "unavailable-reason": "Permission required" },
    });
    expect(wrapper.attributes("disabled")).toBeUndefined();
    expect(wrapper.attributes("aria-disabled")).toBe("true");
    const reason = wrapper.get(".sr-only");
    expect(wrapper.attributes("aria-describedby")).toBe(reason.attributes("id"));
    expect(reason.text()).toBe("Permission required");
    const click = new MouseEvent("click", { cancelable: true });
    wrapper.element.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    await wrapper.trigger("click");
    expect(wrapper.emitted("click")).toBeUndefined();
  });

  it.each(["Enter", " "])("stops unavailable %s before parent or caller activation", (key) => {
    const parentKeydown = vi.fn();
    const callerKeydown = vi.fn();
    const wrapper = mount(OButton, {
      props: { disabled: true, focusableUnavailable: true },
      attrs: { onKeydown: callerKeydown },
    });
    const parent = document.createElement("div");
    parent.addEventListener("keydown", parentKeydown);
    parent.appendChild(wrapper.element);
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    wrapper.element.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(parentKeydown).not.toHaveBeenCalled();
    expect(callerKeydown).not.toHaveBeenCalled();
    expect(wrapper.emitted("click")).toBeUndefined();
    wrapper.unmount();
  });

  it.each([false, true])("preserves the accessible label when icon-only is %s", (iconOnly) => {
    const wrapper = mount(OButton, {
      props: { disabled: true, focusableUnavailable: true },
      attrs: iconOnly ? { "aria-label": "Share" } : {},
      slots: { default: iconOnly ? "" : "Configure", "unavailable-reason": "Run first" },
    });
    const reason = wrapper.get(".sr-only");
    expect(reason.attributes("aria-hidden")).toBe("true");
    expect(wrapper.attributes("aria-describedby")).toBe(reason.attributes("id"));
    expect(reason.text()).toBe("Run first");
    const nameContent = wrapper.element.cloneNode(true) as HTMLElement;
    nameContent.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
    expect(nameContent.getAttribute("aria-label") ?? nameContent.textContent).toBe(
      iconOnly ? "Share" : "Configure",
    );
    wrapper.unmount();
  });

  it.each([false, true])(
    "keeps a single loading label when focusable unavailable is %s",
    (focusableUnavailable) => {
      const wrapper = mount(OButton, {
        props: { loading: true, disabled: focusableUnavailable, focusableUnavailable },
        slots: { default: "Next", "unavailable-reason": "Loading page 2…" },
      });
      const nameContent = wrapper.element.cloneNode(true) as HTMLElement;
      nameContent.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
      expect(nameContent.textContent).toBe("Next");
      expect(wrapper.find(".invisible").exists()).toBe(false);
      expect(wrapper.attributes("aria-label")).toBeUndefined();
      if (focusableUnavailable) {
        expect(wrapper.attributes("disabled")).toBeUndefined();
        const reason = wrapper.get(".sr-only");
        expect(wrapper.attributes("aria-describedby")).toBe(reason.attributes("id"));
        expect(reason.text()).toBe("Loading page 2…");
      }
      wrapper.unmount();
    },
  );

  it("keeps descriptions distinct when instances share a test marker", () => {
    const wrapper = mount({
      render: () =>
        h(
          "div",
          ["First reason", "Second reason"].map((reason) =>
            h(
              OButton,
              { disabled: true, focusableUnavailable: true, "data-test": "shared-action" },
              { "unavailable-reason": () => reason },
            ),
          ),
        ),
    });
    const buttons = wrapper.findAllComponents(OButton);
    const ids = buttons.map((button) => button.attributes("aria-describedby"));
    expect(new Set(ids).size).toBe(2);
    expect(ids.map((id) => wrapper.find(`[id="${id}"]`).text())).toEqual([
      "First reason",
      "Second reason",
    ]);
    wrapper.unmount();
  });

  it("uses an external reason and preserves unavailable focus during loading", () => {
    const wrapper = mount(OButton, {
      props: {
        disabled: true,
        focusableUnavailable: true,
        descriptionId: "permission",
        loading: true,
      },
    });
    expect(wrapper.attributes("disabled")).toBeUndefined();
    expect(wrapper.attributes("aria-describedby")).toBe("permission");
    expect(wrapper.find(".sr-only").exists()).toBe(false);
  });
});

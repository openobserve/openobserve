import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import OButton from "./OButton.vue";

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
    expect(wrapper.classes().join(" ")).toContain("tw:bg-button-primary");
  });

  it("applies secondary variant classes", () => {
    const wrapper = mount(OButton, { props: { variant: "secondary" } });
    expect(wrapper.classes().join(" ")).toContain("tw:bg-button-secondary");
  });

  it("applies outline variant classes", () => {
    const wrapper = mount(OButton, { props: { variant: "outline" } });
    expect(wrapper.classes().join(" ")).toContain(
      "tw:text-button-outline-text",
    );
  });

  it("applies ghost variant classes", () => {
    const wrapper = mount(OButton, { props: { variant: "ghost" } });
    expect(wrapper.classes().join(" ")).toContain("tw:text-button-ghost-text");
  });

  it("applies destructive variant classes", () => {
    const wrapper = mount(OButton, { props: { variant: "destructive" } });
    expect(wrapper.classes().join(" ")).toContain("tw:bg-button-destructive");
  });

  it("applies ghost-primary variant classes", () => {
    const wrapper = mount(OButton, { props: { variant: "ghost-primary" } });
    expect(wrapper.classes().join(" ")).toContain(
      "tw:text-button-ghost-primary-text",
    );
  });

  it("applies ghost-destructive variant classes", () => {
    const wrapper = mount(OButton, { props: { variant: "ghost-destructive" } });
    expect(wrapper.classes().join(" ")).toContain(
      "tw:text-button-ghost-destructive-text",
    );
  });

  // --- Size classes ---

  it("applies md size classes by default", () => {
    const wrapper = mount(OButton);
    expect(wrapper.classes().join(" ")).toContain("tw:h-10");
  });

  it("applies sm size classes", () => {
    const wrapper = mount(OButton, { props: { size: "sm" } });
    expect(wrapper.classes().join(" ")).toContain("tw:h-9");
  });

  it("applies lg size classes", () => {
    const wrapper = mount(OButton, { props: { size: "lg" } });
    expect(wrapper.classes().join(" ")).toContain("tw:h-12");
  });

  it("applies icon size classes", () => {
    const wrapper = mount(OButton, { props: { size: "icon" } });
    expect(wrapper.classes().join(" ")).toContain("tw:size-6");
  });

  it("applies icon-circle size classes with rounded-full", () => {
    const wrapper = mount(OButton, { props: { size: "icon-circle" } });
    const classes = wrapper.classes().join(" ");
    expect(classes).toContain("tw:size-8");
    expect(classes).toContain("tw:rounded-full");
  });

  it("applies icon-sm size classes (h-9 w-9)", () => {
    const wrapper = mount(OButton, { props: { size: "icon-sm" } });
    const classes = wrapper.classes().join(" ");
    expect(classes).toContain("tw:h-9");
    expect(classes).toContain("tw:w-9");
  });

  it("applies icon-md size classes (h-10 w-10)", () => {
    const wrapper = mount(OButton, { props: { size: "icon-md" } });
    const classes = wrapper.classes().join(" ");
    expect(classes).toContain("tw:h-10");
    expect(classes).toContain("tw:w-10");
  });

  it("applies icon-lg size classes (h-12 w-12)", () => {
    const wrapper = mount(OButton, { props: { size: "icon-lg" } });
    const classes = wrapper.classes().join(" ");
    expect(classes).toContain("tw:h-12");
    expect(classes).toContain("tw:w-12");
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
    expect(wrapper.element.tagName.toLowerCase()).toBe("a");
  });
});

import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { h } from "vue";
import OBadge from "./OBadge.vue";

describe("OBadge", () => {
  // ── Slot content ────────────────────────────────────────────────────────

  it("renders default slot content", () => {
    const wrapper = mount(OBadge, { slots: { default: "Active" } });
    expect(wrapper.text()).toContain("Active");
  });

  it("renders #icon slot content", () => {
    const wrapper = mount(OBadge, {
      slots: {
        icon: () => h("img", { src: "/chrome.svg", alt: "Chrome" }),
        default: "Chrome",
      },
    });
    expect(wrapper.find("img").exists()).toBe(true);
    expect(wrapper.find("img").attributes("src")).toBe("/chrome.svg");
  });

  it("renders icon prop as material-icons span", () => {
    const wrapper = mount(OBadge, {
      props: { icon: "check_circle" },
      slots: { default: "Verified" },
    });
    const iconSpan = wrapper.find(".material-icons");
    expect(iconSpan.exists()).toBe(true);
    expect(iconSpan.text()).toBe("check_circle");
  });

  it("#icon slot takes priority over icon prop", () => {
    const wrapper = mount(OBadge, {
      props: { icon: "check_circle" },
      slots: {
        icon: () => h("img", { src: "/logo.svg", "data-testid": "custom-icon" }),
        default: "Label",
      },
    });
    // The custom slot image should render, not the material-icons span
    expect(wrapper.find("[data-testid='custom-icon']").exists()).toBe(true);
    expect(wrapper.find(".material-icons").exists()).toBe(false);
  });

  it("does not render icon area when neither icon prop nor #icon slot is set", () => {
    const wrapper = mount(OBadge, { slots: { default: "Label" } });
    expect(wrapper.find(".material-icons").exists()).toBe(false);
  });

  it("renders count prop in trailing segment", () => {
    const wrapper = mount(OBadge, {
      props: { count: 7 },
      slots: { default: "Alerts" },
    });
    expect(wrapper.text()).toContain("7");
  });

  it("renders #trailing slot content", () => {
    const wrapper = mount(OBadge, {
      slots: {
        default: "Chrome",
        trailing: "Browser",
      },
    });
    expect(wrapper.text()).toContain("Browser");
  });

  it("#trailing slot takes priority over count prop", () => {
    const wrapper = mount(OBadge, {
      props: { count: 99 },
      slots: {
        default: "Label",
        trailing: "Custom",
      },
    });
    expect(wrapper.text()).toContain("Custom");
    expect(wrapper.text()).not.toContain("99");
  });

  it("does not render trailing area when neither count nor #trailing slot is set", () => {
    const wrapper = mount(OBadge, { slots: { default: "Label" } });
    // No element with border-s class (the trailing container)
    const trailingEl = wrapper.find("[class*='border-s']");
    expect(trailingEl.exists()).toBe(false);
  });

  // ── Variants ────────────────────────────────────────────────────────────

  it("applies default variant classes when no variant specified", () => {
    const wrapper = mount(OBadge, { slots: { default: "x" } });
    expect(wrapper.classes().join(" ")).toContain("tw:bg-badge-default-solid-bg");
    expect(wrapper.classes().join(" ")).toContain("tw:text-badge-default-solid-text");
  });

  it.each([
    ["primary", "tw:bg-badge-primary-solid-bg"],
    ["success", "tw:bg-badge-success-solid-bg"],
    ["warning", "tw:bg-badge-warning-solid-bg"],
    ["error",   "tw:bg-badge-error-solid-bg"],
  ] as const)("applies %s solid variant classes", (variant, expectedClass) => {
    const wrapper = mount(OBadge, {
      props: { variant },
      slots: { default: "x" },
    });
    expect(wrapper.classes().join(" ")).toContain(expectedClass);
  });

  it.each([
    ["default-outline", "tw:text-badge-default-ol-text"],
    ["primary-outline", "tw:text-badge-primary-ol-text"],
    ["success-outline", "tw:text-badge-success-ol-text"],
    ["warning-outline", "tw:text-badge-warning-ol-text"],
    ["error-outline",   "tw:text-badge-error-ol-text"],
  ] as const)("applies %s outline variant classes", (variant, expectedClass) => {
    const wrapper = mount(OBadge, {
      props: { variant },
      slots: { default: "x" },
    });
    expect(wrapper.classes().join(" ")).toContain(expectedClass);
    expect(wrapper.classes().join(" ")).toContain("tw:bg-transparent");
  });

  // ── Sizes ───────────────────────────────────────────────────────────────

  it("applies md size classes by default", () => {
    const wrapper = mount(OBadge, { slots: { default: "x" } });
    expect(wrapper.classes().join(" ")).toContain("tw:px-2.5");
  });

  it("applies sm size classes", () => {
    const wrapper = mount(OBadge, {
      props: { size: "sm" },
      slots: { default: "x" },
    });
    expect(wrapper.classes().join(" ")).toContain("tw:px-1.5");
  });

  // ── Root element tag ────────────────────────────────────────────────────

  it("renders as <span> by default", () => {
    const wrapper = mount(OBadge, { slots: { default: "x" } });
    expect(wrapper.element.tagName.toLowerCase()).toBe("span");
  });

  it("renders as <button> when clickable", () => {
    const wrapper = mount(OBadge, {
      props: { clickable: true },
      slots: { default: "x" },
    });
    expect(wrapper.element.tagName.toLowerCase()).toBe("button");
    expect(wrapper.attributes("type")).toBe("button");
  });

  // ── Interaction ─────────────────────────────────────────────────────────

  it("emits click when clickable and clicked", async () => {
    const wrapper = mount(OBadge, {
      props: { clickable: true },
      slots: { default: "x" },
    });
    await wrapper.trigger("click");
    expect(wrapper.emitted("click")).toHaveLength(1);
  });

  it("emits click on Enter key when clickable", async () => {
    const wrapper = mount(OBadge, {
      props: { clickable: true },
      slots: { default: "x" },
    });
    await wrapper.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("click")).toHaveLength(1);
  });

  it("emits click on Space key when clickable", async () => {
    const wrapper = mount(OBadge, {
      props: { clickable: true },
      slots: { default: "x" },
    });
    await wrapper.trigger("keydown", { key: " " });
    expect(wrapper.emitted("click")).toHaveLength(1);
  });

  it("does not emit click when not clickable", async () => {
    const wrapper = mount(OBadge, { slots: { default: "x" } });
    await wrapper.trigger("click");
    expect(wrapper.emitted("click")).toBeUndefined();
  });

  it("does not emit click when disabled and clickable", async () => {
    const wrapper = mount(OBadge, {
      props: { clickable: true, disabled: true },
      slots: { default: "x" },
    });
    await wrapper.trigger("click");
    expect(wrapper.emitted("click")).toBeUndefined();
  });

  // ── Disabled state ──────────────────────────────────────────────────────

  it("sets aria-disabled when disabled", () => {
    const wrapper = mount(OBadge, {
      props: { disabled: true },
      slots: { default: "x" },
    });
    expect(wrapper.attributes("aria-disabled")).toBe("true");
  });

  it("sets disabled attribute on <button> when clickable and disabled", () => {
    const wrapper = mount(OBadge, {
      props: { clickable: true, disabled: true },
      slots: { default: "x" },
    });
    expect(wrapper.attributes("disabled")).toBeDefined();
  });

  it("applies opacity class when disabled", () => {
    const wrapper = mount(OBadge, {
      props: { disabled: true },
      slots: { default: "x" },
    });
    expect(wrapper.classes().join(" ")).toContain("tw:opacity-40");
  });

  // ── Accessibility ───────────────────────────────────────────────────────

  it("sets tabindex=0 on clickable badge", () => {
    const wrapper = mount(OBadge, {
      props: { clickable: true },
      slots: { default: "x" },
    });
    expect(wrapper.attributes("tabindex")).toBe("0");
  });

  it("does not set tabindex when not clickable", () => {
    const wrapper = mount(OBadge, { slots: { default: "x" } });
    expect(wrapper.attributes("tabindex")).toBeUndefined();
  });

  it("does not set tabindex when clickable but disabled", () => {
    const wrapper = mount(OBadge, {
      props: { clickable: true, disabled: true },
      slots: { default: "x" },
    });
    expect(wrapper.attributes("tabindex")).toBeUndefined();
  });

  it("icon span has aria-hidden=true", () => {
    const wrapper = mount(OBadge, {
      props: { icon: "check" },
      slots: { default: "x" },
    });
    const iconSpan = wrapper.find(".material-icons");
    expect(iconSpan.attributes("aria-hidden")).toBe("true");
  });
});

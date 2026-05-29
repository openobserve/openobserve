import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { h } from "vue";
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

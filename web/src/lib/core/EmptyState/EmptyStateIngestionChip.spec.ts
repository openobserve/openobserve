import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import EmptyStateIngestionChip from "./EmptyStateIngestionChip.vue";

describe("EmptyStateIngestionChip", () => {
  it("renders a link when href is given and emits click for a button", async () => {
    const link = mount(EmptyStateIngestionChip, { props: { href: "https://x.test" } });
    expect(link.element.tagName).toBe("A");
    const button = mount(EmptyStateIngestionChip);
    await button.trigger("click");
    expect(button.emitted("click")).toHaveLength(1);
  });

  it("keeps hover treatment when available", () => {
    expect(mount(EmptyStateIngestionChip).classes()).toContain("hover:border-accent");
  });

  it.each(["default", "ai"] as const)(
    "dims an unavailable %s chip, drops hover and blocks the action",
    async (variant) => {
      const wrapper = mount(EmptyStateIngestionChip, { props: { unavailable: true, variant } });
      expect(wrapper.attributes("aria-disabled")).toBe("true");
      expect(wrapper.attributes("disabled")).toBeUndefined();
      expect(wrapper.classes()).toContain("opacity-60");
      expect(wrapper.classes().join(" ")).not.toContain("hover:");
      expect(wrapper.classes()).not.toContain("ai-hover-btn");
      await wrapper.trigger("click");
      expect(wrapper.emitted("click")).toBeUndefined();
    },
  );

  it("renders a focusable button, not a link, when an href chip is unavailable", () => {
    const wrapper = mount(EmptyStateIngestionChip, {
      props: { href: "https://x.test", unavailable: true },
    });
    expect(wrapper.element.tagName).toBe("BUTTON");
    expect(wrapper.attributes("href")).toBeUndefined();
  });
});

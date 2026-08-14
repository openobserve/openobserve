// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import OEmojiPicker from "./OEmojiPicker.vue";
import { EMOJI_GROUPS } from "./emojiCatalog";

// The panel is portalled to document.body, so it is queried there rather than
// through the wrapper.
function panelQuery<T extends HTMLElement>(selector: string): T | null {
  return document.querySelector<T>(selector);
}
function panelQueryAll<T extends HTMLElement>(selector: string): T[] {
  return Array.from(document.querySelectorAll<T>(selector));
}

async function openPicker(wrapper: VueWrapper) {
  await wrapper.find('[data-test="emoji-picker-trigger"]').trigger("click");
  await nextTick();
  await nextTick();
}

describe("OEmojiPicker", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("should render the placeholder trigger when no emoji is selected", () => {
    wrapper = mount(OEmojiPicker, { attachTo: document.body });
    const trigger = wrapper.find('[data-test="emoji-picker-trigger"]');
    expect(trigger.exists()).toBe(true);
    expect(trigger.classes().join(" ")).toContain("border-dashed");
    expect(trigger.find("svg").exists()).toBe(true);
  });

  it("should render the selected emoji in the trigger", () => {
    wrapper = mount(OEmojiPicker, {
      props: { modelValue: "🚀" },
      attachTo: document.body,
    });
    const trigger = wrapper.find('[data-test="emoji-picker-trigger"]');
    expect(trigger.text()).toBe("🚀");
    expect(trigger.classes().join(" ")).not.toContain("border-dashed");
  });

  it("should be disabled when the disabled prop is set", () => {
    wrapper = mount(OEmojiPicker, { props: { disabled: true }, attachTo: document.body });
    const trigger = wrapper.find('[data-test="emoji-picker-trigger"]').element;
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
  });

  it("should render every catalog emoji once the panel is open", async () => {
    wrapper = mount(OEmojiPicker, { attachTo: document.body });
    await openPicker(wrapper);
    const total = EMOJI_GROUPS.reduce((sum, group) => sum + group.emojis.length, 0);
    expect(panelQueryAll("[data-emoji-cell]")).toHaveLength(total);
  });

  it("should emit update:modelValue and select when an emoji is picked", async () => {
    wrapper = mount(OEmojiPicker, { attachTo: document.body });
    await openPicker(wrapper);
    panelQuery<HTMLButtonElement>('[data-test="emoji-picker-option-prod"]')?.click();
    await nextTick();
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual(["🚀"]);
    expect(wrapper.emitted("select")?.[0]).toEqual(["🚀"]);
  });

  it("should deselect when the already-selected emoji is picked again", async () => {
    wrapper = mount(OEmojiPicker, { props: { modelValue: "🚀" }, attachTo: document.body });
    await openPicker(wrapper);
    panelQuery<HTMLButtonElement>('[data-test="emoji-picker-option-prod"]')?.click();
    await nextTick();
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([null]);
  });

  it("should emit null from the clear button, which only shows with a value", async () => {
    wrapper = mount(OEmojiPicker, { attachTo: document.body });
    await openPicker(wrapper);
    expect(panelQuery('[data-test="emoji-picker-clear"]')).toBeNull();
    wrapper.unmount();
    document.body.innerHTML = "";

    wrapper = mount(OEmojiPicker, { props: { modelValue: "🔥" }, attachTo: document.body });
    await openPicker(wrapper);
    panelQuery<HTMLButtonElement>('[data-test="emoji-picker-clear"]')?.click();
    await nextTick();
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([null]);
    expect(wrapper.emitted("select")?.[0]).toEqual([null]);
  });

  it("should filter the grid by keyword", async () => {
    wrapper = mount(OEmojiPicker, { attachTo: document.body });
    await openPicker(wrapper);
    const search = panelQuery<HTMLInputElement>('[data-test="emoji-picker-search"] input');
    expect(search).not.toBeNull();
    search!.value = "database";
    search!.dispatchEvent(new Event("input"));
    await nextTick();
    const cells = panelQueryAll("[data-emoji-cell]");
    expect(cells).toHaveLength(1);
    expect(cells[0].textContent?.trim()).toBe("🗄️");
  });

  it("should render brand glyphs as svgs alongside emoji cells", async () => {
    wrapper = mount(OEmojiPicker, { attachTo: document.body });
    await openPicker(wrapper);
    const brandCell = panelQuery('[data-test="emoji-picker-option-kubernetes"]');
    expect(brandCell?.querySelector("svg")).not.toBeNull();
    const emojiCell = panelQuery('[data-test="emoji-picker-option-prod"]');
    expect(emojiCell?.textContent?.trim()).toBe("🚀");
  });

  it("should select a brand glyph by its token", async () => {
    wrapper = mount(OEmojiPicker, { attachTo: document.body });
    await openPicker(wrapper);
    panelQuery<HTMLButtonElement>('[data-test="emoji-picker-option-redis"]')?.click();
    await nextTick();
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual(["o2:redis"]);
  });

  it("should render a selected brand glyph in the trigger", () => {
    wrapper = mount(OEmojiPicker, {
      props: { modelValue: "o2:redis" },
      attachTo: document.body,
    });
    expect(wrapper.find('[data-test="emoji-picker-trigger"]').find("svg").exists()).toBe(true);
  });

  it("should show the empty message when nothing matches", async () => {
    wrapper = mount(OEmojiPicker, { attachTo: document.body });
    await openPicker(wrapper);
    const search = panelQuery<HTMLInputElement>('[data-test="emoji-picker-search"] input');
    search!.value = "zzzznomatch";
    search!.dispatchEvent(new Event("input"));
    await nextTick();
    expect(panelQueryAll("[data-emoji-cell]")).toHaveLength(0);
    expect(panelQuery('[data-test="emoji-picker-empty"]')).not.toBeNull();
  });

  it("should give exactly one grid cell a tabindex of 0 (roving tabindex)", async () => {
    wrapper = mount(OEmojiPicker, { attachTo: document.body });
    await openPicker(wrapper);
    const focusable = panelQueryAll("[data-emoji-cell]").filter(
      (cell) => cell.getAttribute("tabindex") === "0",
    );
    expect(focusable).toHaveLength(1);
  });

  it("should park the roving cursor on the current selection when opened", async () => {
    wrapper = mount(OEmojiPicker, { props: { modelValue: "🔥" }, attachTo: document.body });
    await openPicker(wrapper);
    const focusable = panelQueryAll("[data-emoji-cell]").find(
      (cell) => cell.getAttribute("tabindex") === "0",
    );
    expect(focusable?.textContent?.trim()).toBe("🔥");
  });
});

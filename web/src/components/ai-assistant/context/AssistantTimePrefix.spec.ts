// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";

import type { TimeWindow } from "@/composables/assistant";

import OPopover from "@/lib/overlay/Popover/OPopover.vue";

import AssistantTimePrefix from "./AssistantTimePrefix.vue";

const DEFAULT: TimeWindow = { from: 0, to: 900_000, period: "15m", source: "default" };
const PAGE: TimeWindow = { from: 0, to: 3_600_000, period: "1h", source: "page" };

async function open(props: { window: TimeWindow; pageWindow?: TimeWindow | null }) {
  const wrapper = mount(AssistantTimePrefix, { props, attachTo: document.body });
  await wrapper.get('[data-test="assistant-context-chip-time"]').trigger("click");
  await flushPromises();
  const row = (id: string) =>
    document.body.querySelector<HTMLElement>(`[data-test="assistant-context-time-${id}"]`);
  return { wrapper, row };
}

enableAutoUnmount(afterEach);

describe("AssistantTimePrefix", () => {
  it("names the range and where it comes from", () => {
    const wrapper = mount(AssistantTimePrefix, { props: { window: DEFAULT } });
    const button = wrapper.get('[data-test="assistant-context-chip-time"]');
    expect(button.text()).toBe("Last 15 min");
    expect(button.attributes("aria-label")).toBe("Time range, Last 15 min, default");
  });

  it("offers no Page time on a page with no range, and draws no default tag", async () => {
    const { row } = await open({ window: DEFAULT });
    expect(row("page")).toBeNull();
    expect(row("15m")?.textContent).not.toContain("default");
    expect(row("15m")?.getAttribute("aria-checked")).toBe("true");
  });

  it("offers Page time on a page with a range, and goes back to it with null", async () => {
    const { wrapper, row } = await open({
      window: { ...PAGE, source: "custom", period: "7d" },
      pageWindow: PAGE,
    });
    expect(row("page")?.textContent).toContain("Page time");
    expect(row("7d")?.getAttribute("aria-checked")).toBe("true");
    row("page")!.click();
    await flushPromises();
    expect(wrapper.emitted("change")).toEqual([[null]]);
  });

  it("is the same assistantContext pill as the other chips", () => {
    const wrapper = mount(AssistantTimePrefix, { props: { window: DEFAULT } });
    const chip = wrapper.get('[data-test="assistant-context-chip-time"]');
    expect(chip.element.tagName).toBe("BUTTON");
    expect(chip.classes()).toContain("rounded-default");
    expect(chip.attributes("aria-haspopup")).toBe("dialog");
    expect(chip.classes()).not.toContain("pointer-coarse:min-h-11");
    expect(chip.classes()).toContain("pointer-coarse:after:-inset-y-2.5");
  });

  it("carries a ✕ only on a picked range, and a press on the open chip closes its picker", async () => {
    const remove = '[data-test="assistant-context-chip-time-remove"]';
    const picker = () => document.body.querySelector('[data-test="assistant-context-time-picker"]');
    expect(
      mount(AssistantTimePrefix, { props: { window: PAGE } })
        .find(remove)
        .exists(),
    ).toBe(false);
    const { wrapper } = await open({ window: { ...PAGE, source: "custom" } });
    expect(picker()).not.toBeNull();
    const chip = wrapper.get('[data-test="assistant-context-chip-time"]');
    // The outside-press listener is added a tick after the picker opens.
    await new Promise((resolve) => setTimeout(resolve, 0));
    chip.element.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    await flushPromises();
    expect(picker()).not.toBeNull();
    await chip.trigger("click");
    await flushPromises();
    expect(picker()).toBeNull();
    await wrapper.get(remove).trigger("click");
    expect(wrapper.emitted("change")).toEqual([[null]]);
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
  });

  it("is a radiogroup whose arrows move focus between rows and Tab reaches only the checked one", async () => {
    const { row } = await open({ window: DEFAULT });
    const group = document.body.querySelector<HTMLElement>('[role="radiogroup"]')!;
    expect(group).not.toBeNull();
    expect(row("15m")?.getAttribute("role")).toBe("radio");
    expect(row("15m")?.getAttribute("tabindex")).toBe("0");
    expect(row("1h")?.getAttribute("tabindex")).toBe("-1");
    row("15m")!.focus();
    row("15m")!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(row("1h"));
    row("1h")!.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(document.activeElement).toBe(row("custom"));
    row("custom")!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(row("15m"));
  });

  it("applies a preset at once as an override", async () => {
    const { wrapper, row } = await open({ window: DEFAULT });
    row("24h")!.click();
    await flushPromises();
    expect(wrapper.emitted("change")?.[0]?.[0]).toMatchObject({ period: "24h" });
  });

  it("keeps the popup inside the viewport and below the app header", async () => {
    const { wrapper } = await open({ window: DEFAULT });
    const popover = wrapper.findComponent(OPopover);
    expect(popover.props("collisionPadding")).toEqual({ top: 48, right: 8, bottom: 8, left: 8 });
    expect(popover.props("contentClass")).toContain(
      "max-h-[calc(var(--reka-popper-available-height",
    );
    expect(popover.props("contentClass")).toContain("overflow-y-auto");
    expect(document.body.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe(
      "Change time range",
    );
  });

  it("lists the presets and Custom Range…, with no range picker until Custom Range… is picked", async () => {
    const { row } = await open({ window: DEFAULT });
    expect(row("custom")?.textContent).toContain("Custom Range…");
    expect(row("custom")?.getAttribute("role")).toBe("radio");
    expect(row("custom")?.getAttribute("aria-checked")).toBe("false");
    expect(document.body.querySelector('[data-test="assistant-context-time-range"]')).toBeNull();
    expect(document.body.querySelector('[data-test^="datetimerange-"]')).toBeNull();
  });

  it("swaps the presets for the range picker at its own width, and applies the range it sets", async () => {
    const { wrapper, row } = await open({ window: DEFAULT });
    row("custom")!.click();
    await flushPromises();
    const range = document.body.querySelector<HTMLElement>(
      '[data-test="assistant-context-time-range"]',
    )!;
    expect(range).not.toBeNull();
    expect(row("15m")).toBeNull();
    // One surface: the picker sits in the chip's popup, with no trigger or popup of its own.
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(range.querySelector('[data-test="datetimerange-inline"]')).not.toBeNull();
    expect(document.body.querySelector('[data-test="datetimerange-trigger"]')).toBeNull();
    expect(document.body.querySelector('[data-test="datetimerange-popup"]')).toBeNull();
    expect(wrapper.findComponent(OPopover).props("contentClass")).toContain("w-80");
    expect(range.contains(document.activeElement)).toBe(true);
    range.querySelector<HTMLElement>('[data-test="datetimerange-relative-panel"] button')!.click();
    range.querySelector<HTMLElement>('[data-test="datetimerange-relative-apply"]')!.click();
    await flushPromises();
    expect(wrapper.emitted("change")?.[0]?.[0]).toMatchObject({ period: "1s" });
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
  });

  it("checks Custom Range… on a picked date range, and its picker opens on that range", async () => {
    const { row } = await open({ window: { from: 1_000, to: 2_000, source: "custom" } });
    expect(row("custom")?.getAttribute("aria-checked")).toBe("true");
    expect(row("custom")?.getAttribute("tabindex")).toBe("0");
    row("custom")!.click();
    await flushPromises();
    expect(
      document.body.querySelector('[data-test="datetimerange-absolute-panel"]'),
    ).not.toBeNull();
  });

  it("opens on the presets again after the range picker was left open", async () => {
    const { wrapper, row } = await open({ window: DEFAULT });
    row("custom")!.click();
    await flushPromises();
    const chip = wrapper.get('[data-test="assistant-context-chip-time"]');
    await chip.trigger("click");
    await flushPromises();
    await chip.trigger("click");
    await flushPromises();
    expect(row("15m")).not.toBeNull();
    expect(wrapper.findComponent(OPopover).props("contentClass")).not.toContain("w-80");
  });

  it("shows a chip-sized skeleton, not a stale range, while the page range loads", () => {
    const wrapper = mount(AssistantTimePrefix, { props: { window: DEFAULT, loading: true } });
    const skeleton = wrapper.get('[data-test="assistant-context-chip-time-skeleton"]');
    expect(skeleton.attributes("aria-hidden")).toBe("true");
    expect(skeleton.find(".h-6").exists()).toBe(true);
    expect(wrapper.find('[data-test="assistant-context-chip-time"]').exists()).toBe(false);
  });
});

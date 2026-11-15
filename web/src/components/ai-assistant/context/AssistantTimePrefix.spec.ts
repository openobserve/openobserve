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

import { parseDate } from "@internationalized/date";
import {
  DOMWrapper,
  enableAutoUnmount,
  flushPromises,
  mount,
  type VueWrapper,
} from "@vue/test-utils";
import { RangeCalendarRoot } from "reka-ui";
import { afterEach, describe, expect, it } from "vitest";

import type { TimeWindow } from "@/composables/assistant";

import OTime from "@/lib/forms/Time/OTime.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";

import AssistantTimePrefix from "./AssistantTimePrefix.vue";

const DEFAULT: TimeWindow = { from: 0, to: 900_000, period: "15m", source: "default" };
const PAGE: TimeWindow = { from: 0, to: 3_600_000, period: "1h", source: "page" };

async function open(props: {
  window: TimeWindow;
  pageWindow?: TimeWindow | null;
  timezone?: string;
}) {
  const wrapper = mount(AssistantTimePrefix, { props, attachTo: document.body });
  await wrapper.get('[data-test="assistant-context-chip-time"]').trigger("click");
  await flushPromises();
  const row = (id: string) =>
    document.body.querySelector<HTMLElement>(`[data-test="assistant-context-time-${id}"]`);
  return { wrapper, row };
}

/** Opens Custom Range… on the window given; a window with no period opens on Absolute. */
async function openRange(props: Parameters<typeof open>[0]) {
  const opened = await open(props);
  opened.row("custom")!.click();
  await flushPromises();
  return opened;
}

const inPicker = (test: string) =>
  new DOMWrapper(document.body.querySelector<HTMLElement>(`[data-test="${test}"]`)!);

const pickDates = (wrapper: VueWrapper, start: string, end?: string) =>
  wrapper.findComponent(RangeCalendarRoot).vm.$emit("update:modelValue", {
    start: parseDate(start),
    end: end ? parseDate(end) : undefined,
  });

// OTime emits both on every edit the user makes, a clock pick included.
function setTime(wrapper: VueWrapper, which: 0 | 1, value: string): void {
  const field = wrapper.findAllComponents(OTime)[which];
  field.vm.$emit("update:modelValue", value);
  field.vm.$emit("change", value);
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
    expect(range.querySelector('[data-test="datetimerange-relative-apply"]')).toBeNull();
    await flushPromises();
    expect(wrapper.emitted("change")?.[0]?.[0]).toMatchObject({ period: "1s" });
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
  });

  it("applies two picked dates over whole days and hands focus back to the chip", async () => {
    const { wrapper, row } = await open({ window: DEFAULT });
    row("custom")!.click();
    await flushPromises();
    document.body.querySelector<HTMLElement>('[data-test="datetimerange-tab-absolute"]')!.click();
    await flushPromises();
    wrapper.findComponent(RangeCalendarRoot).vm.$emit("update:modelValue", {
      start: parseDate("2026-11-13"),
      end: parseDate("2026-11-14"),
    });
    const { from, to } = wrapper.emitted("change")![0][0] as { from: number; to: number };
    expect(to - from).toBe(2 * 24 * 60 * 60_000);
    // The host swaps in the picked range in the same tick, which redraws the chip with its ✕.
    await wrapper.setProps({ window: { from, to, source: "custom" } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.activeElement).toBe(
      wrapper.get('[data-test="assistant-context-chip-time"]').element,
    );
  });

  it("hands focus back to the chip after Enter applies a range", async () => {
    const from = Date.UTC(2026, 10, 13, 9);
    const { wrapper, row } = await open({
      window: { from, to: Date.UTC(2026, 10, 14, 18), source: "custom" },
    });
    row("custom")!.click();
    await flushPromises();
    wrapper.findAllComponents(OTime)[1].vm.$emit("update:modelValue", "20:00");
    await flushPromises();
    document.body
      .querySelector('[data-test="datetimerange-end-time"] input')!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flushPromises();
    expect(wrapper.emitted("change")).toEqual([[{ from, to: Date.UTC(2026, 10, 14, 20) }]]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.activeElement).toBe(
      wrapper.get('[data-test="assistant-context-chip-time"]').element,
    );
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

  it("applies a time picked from the clock at once, and stays open for the next pick (C-01)", async () => {
    const from = Date.UTC(2026, 10, 10);
    const { wrapper } = await openRange({
      window: { from, to: Date.UTC(2026, 10, 12, 23, 59), source: "custom" },
    });
    setTime(wrapper, 1, "11:59");
    await flushPromises();
    expect(wrapper.emitted("change")).toEqual([[{ from, to: Date.UTC(2026, 10, 12, 11, 59) }]]);
    expect(
      document.body.querySelector('[data-test="assistant-context-time-range"]'),
    ).not.toBeNull();
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([true]);
  });

  it("has no time zone row and no Apply button on either tab, as the chip's own zone is the one applied (C-02)", async () => {
    await openRange({ window: { from: 1_000, to: 2_000, source: "custom" } });
    const extras = () =>
      document.body.querySelectorAll(
        '[data-test="datetimerange-timezone-trigger"], [data-test$="apply"], [data-test$="apply-btn"]',
      );
    expect(
      document.body.querySelector('[data-test="datetimerange-absolute-panel"]'),
    ).not.toBeNull();
    expect(extras()).toHaveLength(0);
    await inPicker("datetimerange-tab-relative").trigger("click");
    expect(
      document.body.querySelector('[data-test="datetimerange-relative-panel"]'),
    ).not.toBeNull();
    expect(extras()).toHaveLength(0);
  });

  it("applies two picked dates as whole days in the chip's zone, over a range that had times (C-07)", async () => {
    // 14:32 to 14:47 in Kolkata.
    const from = Date.UTC(2026, 10, 13, 9, 2);
    const { wrapper } = await openRange({
      window: { from, to: from + 15 * 60_000, source: "custom" },
      timezone: "Asia/Kolkata",
    });
    pickDates(wrapper, "2026-11-10", "2026-11-12");
    await flushPromises();
    expect(wrapper.emitted("change")).toEqual([
      [{ from: Date.UTC(2026, 10, 9, 18, 30), to: Date.UTC(2026, 10, 12, 18, 30) }],
    ]);
  });

  it("keeps a time the user set when two dates are then picked; the end left alone is a whole day (C-07)", async () => {
    const from = Date.UTC(2026, 10, 13, 9, 2);
    const { wrapper } = await openRange({
      window: { from, to: from + 15 * 60_000, source: "custom" },
      timezone: "Asia/Kolkata",
    });
    setTime(wrapper, 0, "09:00");
    pickDates(wrapper, "2026-11-10", "2026-11-12");
    await flushPromises();
    expect(wrapper.emitted("change")?.at(-1)).toEqual([
      { from: Date.UTC(2026, 10, 10, 3, 30), to: Date.UTC(2026, 10, 12, 18, 30) },
    ]);
  });

  it("applies nothing on half an entry: one date, a time while the range waits for its end, or a reversed range", async () => {
    const { wrapper } = await openRange({
      window: { from: Date.UTC(2026, 10, 13, 9), to: Date.UTC(2026, 10, 13, 18), source: "custom" },
    });
    setTime(wrapper, 1, "08:00");
    await flushPromises();
    expect(wrapper.emitted("change")).toBeUndefined();
    expect(
      document.body.querySelector('[data-test="assistant-context-time-reversed"]'),
    ).not.toBeNull();
    pickDates(wrapper, "2026-11-10");
    setTime(wrapper, 1, "19:00");
    await flushPromises();
    expect(wrapper.emitted("change")).toBeUndefined();
    pickDates(wrapper, "2026-11-10", "2026-11-10");
    await flushPromises();
    expect(wrapper.emitted("change")).toEqual([
      [{ from: Date.UTC(2026, 10, 10), to: Date.UTC(2026, 10, 10, 19) }],
    ]);
  });

  it("applies the custom relative row on a unit pick after a typed amount, never while the amount is typed", async () => {
    const { wrapper } = await openRange({ window: DEFAULT });
    expect(document.body.querySelector('[data-test="datetimerange-relative-apply"]')).toBeNull();
    const amount = inPicker("datetimerange-custom-amount");
    await amount.setValue("7");
    await amount.trigger("change");
    await amount.trigger("blur");
    expect(wrapper.emitted("change")).toBeUndefined();
    await inPicker("datetimerange-custom-unit").setValue("h");
    expect(wrapper.emitted("change")?.[0]?.[0]).toMatchObject({ period: "7h" });
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
  });

  it("stages a unit picked before the amount, then applies the custom row when the amount is left", async () => {
    const { wrapper } = await openRange({ window: DEFAULT });
    await inPicker("datetimerange-custom-unit").setValue("h");
    expect(wrapper.emitted("change")).toBeUndefined();
    const amount = inPicker("datetimerange-custom-amount");
    await amount.setValue("7");
    await amount.trigger("blur");
    expect(wrapper.emitted("change")?.[0]?.[0]).toMatchObject({ period: "7h" });
  });

  it("applies a typed amount on Enter, and not when focus moves on to the unit list", async () => {
    const { wrapper } = await openRange({ window: DEFAULT });
    const amount = inPicker("datetimerange-custom-amount");
    const unit = inPicker("datetimerange-custom-unit");
    await unit.setValue("h");
    await amount.setValue("9");
    await amount.trigger("blur", { relatedTarget: unit.element });
    expect(wrapper.emitted("change")).toBeUndefined();
    await amount.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("change")?.[0]?.[0]).toMatchObject({ period: "9h" });
  });

  it("hands focus back to the chip on Escape, and leaves it alone after a click outside", async () => {
    const { wrapper } = await open({ window: DEFAULT });
    const chip = () => wrapper.get('[data-test="assistant-context-chip-time"]').element;
    const picker = () => document.body.querySelector('[data-test="assistant-context-time-picker"]');
    expect(picker()?.contains(document.activeElement)).toBe(true);
    document.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await flushPromises();
    expect(picker()).toBeNull();
    expect(document.activeElement).toBe(chip());
    await wrapper.get('[data-test="assistant-context-chip-time"]').trigger("click");
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));
    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    await flushPromises();
    expect(picker()).toBeNull();
    expect(document.activeElement).not.toBe(chip());
  });

  it("masks the portalled picker for session replay and keeps the assistant's colour roles on it", async () => {
    await open({ window: DEFAULT });
    const picker = document.body.querySelector('[data-test="assistant-context-time-picker"]')!;
    expect(picker.closest('[data-dd-privacy="mask"]')).not.toBeNull();
    expect(picker.closest("[data-assistant-surface]")).not.toBeNull();
  });

  it("stacks its popup above the dialog it opens in", async () => {
    const wrapper = mount(AssistantTimePrefix, {
      props: { window: DEFAULT },
      global: { provide: { o2DialogDepth: 1 } },
    });
    expect(wrapper.findComponent(OPopover).props("zIndex")).toBe(7000);
  });

  it("shows a chip-sized skeleton, not a stale range, while the page range loads", () => {
    const wrapper = mount(AssistantTimePrefix, { props: { window: DEFAULT, loading: true } });
    const skeleton = wrapper.get('[data-test="assistant-context-chip-time-skeleton"]');
    expect(skeleton.attributes("aria-hidden")).toBe("true");
    expect(skeleton.find(".h-6").exists()).toBe(true);
    expect(wrapper.find('[data-test="assistant-context-chip-time"]').exists()).toBe(false);
  });
});

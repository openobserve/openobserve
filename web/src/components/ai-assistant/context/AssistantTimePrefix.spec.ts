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

import AssistantTimePrefix, { FIT_VIEWPORT_CLASS } from "./AssistantTimePrefix.vue";

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
    expect(document.activeElement).toBe(row("7d"));
    row("7d")!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(row("15m"));
  });

  it("applies a preset at once as an override", async () => {
    const { wrapper, row } = await open({ window: DEFAULT });
    row("24h")!.click();
    await flushPromises();
    expect(wrapper.emitted("change")?.[0]?.[0]).toMatchObject({ period: "24h" });
  });

  it("labels the range picker Date range", async () => {
    await open({ window: DEFAULT });
    const range = document.body.querySelector<HTMLElement>(
      '[data-test="assistant-context-time-range"]',
    );
    expect(range?.textContent).toContain("Date range");
    expect(document.body.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe(
      "Change time range",
    );
  });

  it("opens the range picker inside the one popup, which fits the room it has and keeps Apply in view", async () => {
    const { wrapper } = await open({ window: DEFAULT });
    const popover = wrapper.findComponent(OPopover);
    expect(popover.props("collisionPadding")).toBe(8);
    expect(popover.props("contentClass")).toContain(FIT_VIEWPORT_CLASS);
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.className).toContain("max-h-[var(--reka-popper-available-height,75vh)]");
    dialog.querySelector<HTMLElement>('[data-test="assistant-context-time-range"] button')!.click();
    await flushPromises();
    const panel = dialog.querySelector('[data-test="datetimerange-inline"]');
    expect(panel).not.toBeNull();
    expect(document.body.querySelector('[data-test="datetimerange-trigger"]')).toBeNull();
    expect(document.body.querySelector('[data-test="datetimerange-popup"]')).toBeNull();
    dialog.querySelector<HTMLElement>('[data-test="datetimerange-tab-absolute"]')?.click();
    await flushPromises();
    const apply = dialog.querySelector('[data-test="datetimerange-apply"]')?.parentElement;
    expect(apply?.className).toContain("sticky");
  });

  it("opens a picked date range with the picker already showing it", async () => {
    await open({ window: { from: 1_000, to: 2_000, source: "custom" } });
    expect(document.body.querySelector('[data-test="datetimerange-inline"]')).not.toBeNull();
  });

  it("shows a chip-sized skeleton, not a stale range, while the page range loads", () => {
    const wrapper = mount(AssistantTimePrefix, { props: { window: DEFAULT, loading: true } });
    const skeleton = wrapper.get('[data-test="assistant-context-chip-time-skeleton"]');
    expect(skeleton.attributes("aria-hidden")).toBe("true");
    expect(skeleton.find(".h-6").exists()).toBe(true);
    expect(wrapper.find('[data-test="assistant-context-chip-time"]').exists()).toBe(false);
  });
});

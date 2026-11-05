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

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import OnCallFitChips from "@/components/oncall/OnCallFitChips.vue";
import i18n from "@/locales";
import { raw } from "@/types/i18n";

const CHIP = 40;
const GAP = 4;
const MORE = 20;

/// jsdom has no layout, so each chip is given a fixed width laid out left to right.
function layout(rowWidth: number) {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.dataset.test === "row" ? rowWidth : 0;
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const chips = [...(this.parentElement?.querySelectorAll(":scope > [data-fit-chip]") ?? [])];
    const index = chips.indexOf(this);
    if (index >= 0) {
      const left = index * (CHIP + GAP);
      return { left, right: left + CHIP, width: CHIP } as DOMRect;
    }
    if (this.dataset.test === "oncall-fit-chips-more")
      return { left: 0, right: MORE, width: MORE } as DOMRect;
    return { left: 0, right: rowWidth, width: rowWidth } as DOMRect;
  });
  vi.spyOn(window, "getComputedStyle").mockReturnValue({
    columnGap: `${GAP}px`,
  } as CSSStyleDeclaration);
}

function render(items: string[]) {
  return mount(OnCallFitChips, {
    props: { items, tooltip: raw(items.join(" · ")), dataTest: "row" },
    slots: { item: "<template #item='{ item }'><b>{{ item }}</b></template>" },
    global: {
      plugins: [i18n],
      stubs: {
        OTag: { name: "OTag", template: "<span><slot /></span>" },
        OTooltip: { name: "OTooltip", props: ["content"], template: "<i />" },
      },
    },
    attachTo: document.body,
  });
}

const visible = (wrapper: ReturnType<typeof render>) =>
  wrapper
    .findAll("[data-fit-chip]")
    .filter((chip) => (chip.element as HTMLElement).style.display !== "none")
    .map((chip) => chip.text());

describe("OnCallFitChips", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows every chip and no +N when they all fit on one line", async () => {
    layout(200);
    const wrapper = render(["a", "b", "c"]);
    await flushPromises();
    expect(visible(wrapper)).toEqual(["a", "b", "c"]);
    expect(
      (wrapper.find('[data-test="oncall-fit-chips-more"]').element as HTMLElement).style.display,
    ).toBe("none");
  });

  // Rows stay one line high: what does not fit collapses into "+N", whose tooltip names everything.
  it("keeps the chips that fit beside +N and names them all in its tooltip", async () => {
    layout(100);
    const wrapper = render(["a", "b", "c"]);
    await flushPromises();
    expect(visible(wrapper)).toEqual(["a"]);
    const more = wrapper.find('[data-test="oncall-fit-chips-more"]');
    expect(more.text()).toBe("+2");
    expect(more.findComponent({ name: "OTooltip" }).props("content")).toBe("a · b · c");
  });

  it("always keeps one chip, so a cell is never only +N", async () => {
    layout(30);
    const wrapper = render(["a", "b"]);
    await flushPromises();
    expect(visible(wrapper)).toEqual(["a"]);
    expect(wrapper.find('[data-test="oncall-fit-chips-more"]').text()).toBe("+1");
  });
});

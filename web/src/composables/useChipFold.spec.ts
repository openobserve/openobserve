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

import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { chipFoldCount, useChipFold } from "./useChipFold";

describe("chipFoldCount", () => {
  it("keeps every chip, with no room for a more chip, when they all fit", () => {
    expect(chipFoldCount([100, 100, 100], 316, 8, 60)).toBe(3);
    expect(chipFoldCount([], 0, 8, 60)).toBe(0);
  });

  it("keeps the leading chips that fit beside the more chip and folds the rest", () => {
    expect(chipFoldCount([100, 100, 90, 90, 90], 400, 8, 60)).toBe(3);
  });

  it("folds every chip when even the first does not fit beside the more chip", () => {
    expect(chipFoldCount([500, 80], 512, 8, 60)).toBe(0);
  });

  it("folds more chips as their counts widen them", () => {
    const narrow = chipFoldCount([84, 87, 70, 73, 77, 85], 512, 8, 60);
    const wide = chipFoldCount([124, 127, 110, 113, 117, 125], 512, 8, 60);
    expect(narrow).toBe(5);
    expect(wide).toBe(3);
  });
});

describe("useChipFold", () => {
  afterEach(() => vi.restoreAllMocks());

  const Row = defineComponent({
    props: { chips: { type: Array, required: true } },
    setup(props) {
      const row = ref<HTMLElement | null>(null);
      const more = ref<HTMLElement | null>(null);
      const chips = ref(props.chips as { key: string; label: string }[]);
      const { shown } = useChipFold(row, more, chips);
      return () =>
        h("div", { ref: row, "data-test": "row" }, [
          ...chips.value.map((chip) => h("span", { "data-fold-key": chip.key }, chip.label)),
          h("span", { ref: more, "data-test": "more" }, String(shown.value)),
        ]);
    },
  });

  it("shows every chip while there is no layout to measure", async () => {
    const wrapper = mount(Row, { props: { chips: [{ key: "a", label: "1 A" }] } });
    await flushPromises();
    expect(wrapper.get('[data-test="more"]').text()).toBe(String(Number.MAX_SAFE_INTEGER));
  });

  it("measures each chip by its key against the row's width", async () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.dataset.test === "row" ? 200 : 0;
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      return { width: this.dataset.test === "more" ? 50 : 70 } as DOMRect;
    });
    const chips = ["a", "b", "c"].map((key) => ({ key, label: key }));
    const wrapper = mount(Row, { props: { chips } });
    await flushPromises();
    await nextTick();
    expect(wrapper.get('[data-test="more"]').text()).toBe("2");
  });
});

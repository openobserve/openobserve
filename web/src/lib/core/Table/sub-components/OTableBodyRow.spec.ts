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
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { defineComponent, h, ref } from "vue";
import OTableBodyRow from "./OTableBodyRow.vue";

const i18n = createI18n({ legacy: false, locale: "en", messages: { en: {} } });

const row = { index: 0, id: "0", original: { id: 1 }, getVisibleCells: () => [] };

const mountRow = (measureRowElement: (el: Element | null) => void) => {
  const expanded = ref(false);
  const Host = defineComponent({
    setup: () => () =>
      h("table", [
        h("tbody", [
          h(
            OTableBodyRow,
            {
              row: row as any,
              table: {} as any,
              expansionEnabled: true,
              isExpanded: expanded.value,
              dynamicRowHeight: true,
              virtualIndex: 0,
              measureRowElement,
            },
            { expansion: () => h("div", { "data-test": "detail" }, "detail") },
          ),
        ]),
      ]),
  });
  const wrapper = mount(Host, { global: { plugins: [i18n] } });
  return { wrapper, expanded };
};

describe("OTableBodyRow detail row measurement", () => {
  let wrapper: VueWrapper | undefined;
  afterEach(() => wrapper?.unmount());

  it("re-measures the data row when its detail row opens and closes", async () => {
    const measure = vi.fn();
    const mounted = mountRow(measure);
    wrapper = mounted.wrapper;
    measure.mockClear();

    mounted.expanded.value = true;
    await flushPromises();
    expect(wrapper.find("[data-row-expansion]").exists()).toBe(true);
    expect(measure).toHaveBeenCalledWith(wrapper.find('[data-test="o2-table-row-0"]').element);

    measure.mockClear();
    mounted.expanded.value = false;
    await flushPromises();
    expect(wrapper.find("[data-row-expansion]").exists()).toBe(false);
    expect(measure).toHaveBeenCalledWith(wrapper.find('[data-test="o2-table-row-0"]').element);
  });
});

describe("OTableBodyRow selection marking", () => {
  let wrapper: VueWrapper | undefined;
  afterEach(() => wrapper?.unmount());

  const mountSelectable = (props: Record<string, unknown>) => {
    const Host = defineComponent({
      setup: () => () =>
        h("table", [
          h("tbody", [h(OTableBodyRow, { row: row as any, table: {} as any, ...props })]),
        ]),
    });
    wrapper = mount(Host, { global: { plugins: [i18n] } });
    return wrapper.find('[data-test="o2-table-row-0"]').classes();
  };

  it("omits the hover fill classes on a selected row", () => {
    expect(mountSelectable({ isRowSelected: false })).toContain("hover:bg-table-row-hover-bg");
    const selected = mountSelectable({ isRowSelected: true, clickable: true });
    expect(selected).toContain("bg-table-row-selected-bg");
    expect(selected).not.toContain("hover:bg-table-row-hover-bg");
    expect(selected).not.toContain("focus-visible:bg-table-row-hover-bg");
  });

  it("sets the tinted secondary-text variable on selected, active, hovered and focused rows", () => {
    const tinted = "[--color-text-secondary:var(--color-table-row-text-secondary-tinted)]";
    expect(mountSelectable({ isRowSelected: true, clickable: true })).toContain(tinted);
    expect(mountSelectable({ isActive: true })).toContain(tinted);
    const idle = mountSelectable({ clickable: true });
    expect(idle).not.toContain(tinted);
    expect(idle).toEqual(expect.arrayContaining([`hover:${tinted}`, `focus-visible:${tinted}`]));
  });

  it("outlines a selected spine row instead of stacking a bar on the spine", () => {
    const classes = mountSelectable({ isRowSelected: true, statusBarColor: "red" });
    expect(classes).toContain("ring-accent");
    expect(classes).not.toContain("o2-table-row-selected-bar");
  });

  it("draws the selection bar on a selected row without a visible spine", () => {
    for (const statusBarColor of [undefined, "transparent"]) {
      const classes = mountSelectable({ isRowSelected: true, statusBarColor });
      expect(classes).toContain("o2-table-row-selected-bar");
      expect(classes).not.toContain("ring-accent");
      wrapper?.unmount();
    }
  });

  it("gives a clickable row an inset focus-visible outline and no outline transition", () => {
    const classes = mountSelectable({ clickable: true });
    expect(classes).toEqual(
      expect.arrayContaining([
        "focus-visible:outline-solid",
        "focus-visible:outline-2",
        "focus-visible:-outline-offset-2",
        "focus-visible:outline-focus-ring-accent",
      ]),
    );
    expect(classes).toContain("transition-[background-color]");
    expect(classes).not.toContain("transition-colors");
  });

  it("puts the hover-in and hover-out motion tokens on the background transition", () => {
    const classes = mountSelectable({});
    expect(classes).toContain("duration-(--duration-hover-out)");
    expect(classes).toContain("hover:duration-(--duration-hover-in)");
    expect(classes.some((c) => c.startsWith("focus-visible:outline"))).toBe(false);
  });
});

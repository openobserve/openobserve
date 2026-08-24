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

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import i18n from "@/locales";
import { raw } from "@/types/i18n";

import DbmTableToolbar from "./DbmTableToolbar.vue";

const mountToolbar = (props: Record<string, unknown> = {}, slot?: string) =>
  mount(DbmTableToolbar, {
    props: {
      search: "",
      placeholder: raw("Search…"),
      searchDataTest: "dbm-samples-search",
      ...props,
    },
    slots: slot ? { default: slot } : {},
    global: { plugins: [i18n] },
  });

describe("DbmTableToolbar", () => {
  /**
   * The row's shape is what eight tables shared: a flex row that may shrink to
   * nothing, with a FIXED-width search box that may not. Lose `w-64` and the
   * search box grows with the page, pushing the scope chips off the row.
   */
  it("keeps the search box at a fixed width inside a shrinkable row", () => {
    const wrapper = mountToolbar();

    expect(wrapper.classes()).toEqual(
      expect.arrayContaining([
        "flex",
        "min-w-0",
        "flex-1",
        "items-center",
        "gap-2",
        "overflow-hidden",
      ]),
    );
    expect(wrapper.get('[data-test="dbm-samples-search"]').element.parentElement?.className).toBe(
      "w-64 shrink-0",
    );
  });

  it("passes the page's placeholder and data-test to the search box", () => {
    const input = mountToolbar({ placeholder: raw("Find a table…") }).findComponent(OSearchInput);

    expect(input.props("placeholder")).toBe("Find a table…");
    expect(input.attributes("data-test")).toBe("dbm-samples-search");
  });

  /**
   * Databases filters an already-loaded list on every keystroke; every other
   * table refetches, so it waits. Omitting the prop must mean "no debounce" —
   * OSearchInput's own default — rather than silently adding one.
   */
  it("debounces only where the page asked for it", () => {
    expect(mountToolbar().findComponent(OSearchInput).props("debounce")).toBe(0);
    expect(mountToolbar({ debounce: 400 }).findComponent(OSearchInput).props("debounce")).toBe(400);
  });

  /**
   * Two emits, because two kinds of page listen. Everyone binds the model; only
   * the tables that REFETCH on a query change (blocked, deadlocks, top queries)
   * bind `search` to their loader.
   */
  it("reports typing as both a model update and a search", async () => {
    const wrapper = mountToolbar();
    wrapper.findComponent(OSearchInput).vm.$emit("update:modelValue", "orders");
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted("update:search")).toEqual([["orders"]]);
    expect(wrapper.emitted("search")).toEqual([["orders"]]);
  });

  /** A cleared box must report the empty string, not `undefined` down the wire. */
  it("normalises a cleared box to an empty string", async () => {
    const wrapper = mountToolbar({ search: "orders" });
    wrapper.findComponent(OSearchInput).vm.$emit("update:modelValue", null);
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted("update:search")).toEqual([[""]]);
  });

  /**
   * The controls that genuinely differ per page — scope filters, the deadlock
   * grouping toggle, the blocked perspective toggle — stay in the page and land
   * after the search box.
   */
  it("renders the page's own controls beside the search box", () => {
    const wrapper = mountToolbar({}, '<button data-test="perspective">Waiting</button>');

    expect(wrapper.find('[data-test="perspective"]').exists()).toBe(true);
  });
});

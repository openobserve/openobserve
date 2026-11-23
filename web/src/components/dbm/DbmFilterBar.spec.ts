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
import { describe, expect, it, vi } from "vitest";

import i18n from "@/locales";
import { raw } from "@/types/i18n";

import DbmFilterBar from "./DbmFilterBar.vue";
import type { DbmScopeFilter } from "./DbmScopeFilters.vue";

vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));

const filter = (key: string, value: string | null, onChange = vi.fn()): DbmScopeFilter => ({
  key,
  dimension: raw(key),
  value,
  placeholder: raw(key),
  options: [{ value: "a", label: raw("a") }],
  onChange,
});

const mountBar = (filters: DbmScopeFilter[], props: Record<string, unknown> = {}) =>
  mount(DbmFilterBar, {
    props: {
      filters,
      search: "",
      placeholder: raw("Search"),
      searchDataTest: "x-search",
      ...props,
    },
    global: { plugins: [i18n] },
  });

describe("DbmFilterBar", () => {
  it("renders one select per dimension, and no search without a data-test", () => {
    const wrapper = mountBar([filter("instance", null), filter("system", "a")], {
      searchDataTest: undefined,
    });

    expect(wrapper.find('[data-test="dbm-filter-instance"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="dbm-filter-system"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="x-search"]').exists()).toBe(false);
  });

  it("renders the search and the coverage slot", () => {
    const wrapper = mount(DbmFilterBar, {
      props: { filters: [], search: "", placeholder: raw("Search"), searchDataTest: "x-search" },
      slots: { coverage: '<div data-test="cov" />' },
      global: { plugins: [i18n] },
    });

    expect(wrapper.find('[data-test="x-search"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="cov"]').exists()).toBe(true);
  });

  it("keeps instance, engine and schema on the row and moves the rest into More Filters", () => {
    const wrapper = mountBar([
      filter("instance", null),
      filter("system", null),
      filter("namespace", null),
      filter("env", "a"),
      filter("service", null),
    ]);

    const row = wrapper.find('[data-test="dbm-filter-row"]');
    for (const key of ["instance", "system", "namespace"]) {
      expect(row.find(`[data-test="dbm-filter-${key}"]`).exists()).toBe(true);
    }
    expect(row.find('[data-test="dbm-filter-env"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="dbm-more-filters"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="dbm-more-filters-count"]').text()).toBe("1");
  });

  it("shows no More Filters button when nothing is extra", () => {
    const wrapper = mountBar([filter("instance", null)]);
    expect(wrapper.find('[data-test="dbm-more-filters"]').exists()).toBe(false);
  });
});

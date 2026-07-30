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

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";

import AlertGroupHistory from "./AlertGroupHistory.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import type { AlertGroupTransition } from "@/ts/interfaces/alert";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeTransition(overrides: Partial<AlertGroupTransition> = {}): AlertGroupTransition {
  return {
    group_key: "host=web-1",
    group_labels: "host=web-1",
    from_level: "ok",
    to_level: "critical",
    from_outcome: "resolved",
    to_outcome: "firing",
    at: 1700000000000000,
    value: 92.5,
    ...overrides,
  };
}

/** The rollup row — the only history a simple (non-multi) alert has. */
function makeRollupTransition(overrides: Partial<AlertGroupTransition> = {}): AlertGroupTransition {
  return makeTransition({
    group_key: "",
    group_labels: "",
    ...overrides,
  });
}

function mountComp(props: Record<string, any> = {}) {
  return mount(AlertGroupHistory, {
    props: {
      transitions: [makeTransition()],
      ...props,
    },
    global: {
      plugins: [i18n, store],
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AlertGroupHistory", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  describe("multi-alert mode (default, show-group-column omitted)", () => {
    it("renders the transitions table with the group column", () => {
      wrapper = mountComp();
      expect(wrapper.find('[data-test="alerts-alertgrouphistory-table"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="o2-table-th-group"]').exists()).toBe(true);
      expect(wrapper.text()).toContain("host=web-1");
    });

    it("keeps every column of the original layout", () => {
      wrapper = mountComp();
      for (const id of ["at", "group", "change", "to_outcome", "value"]) {
        expect(wrapper.find(`[data-test="o2-table-th-${id}"]`).exists()).toBe(true);
      }
    });

    it("shows the group filter chip and emits clear-filter", async () => {
      wrapper = mountComp({
        groupFilter: { group_key: "host=web-1", group_labels: "host=web-1" },
      });
      expect(wrapper.find('[data-test="alerts-alertgrouphistory-filter"]').exists()).toBe(true);
      await wrapper.find('[data-test="alerts-alertgrouphistory-clear-filter"]').trigger("click");
      expect(wrapper.emitted("clear-filter")).toHaveLength(1);
    });

    it("labels a rollup row rather than leaving the group cell blank", () => {
      wrapper = mountComp({ transitions: [makeRollupTransition()] });
      expect(wrapper.text()).toContain("All groups (rollup)");
    });
  });

  describe("simple-alert mode (show-group-column false)", () => {
    it("renders transitions without the group column", () => {
      wrapper = mountComp({
        transitions: [makeRollupTransition()],
        showGroupColumn: false,
      });
      expect(wrapper.find('[data-test="alerts-alertgrouphistory-table"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="o2-table-th-group"]').exists()).toBe(false);
      // The remaining columns are all still there.
      for (const id of ["at", "change", "to_outcome", "value"]) {
        expect(wrapper.find(`[data-test="o2-table-th-${id}"]`).exists()).toBe(true);
      }
    });

    it("renders the level change and value of a rollup transition", () => {
      wrapper = mountComp({
        transitions: [makeRollupTransition({ value: 17.336 })],
        showGroupColumn: false,
      });
      // Rounded to two decimals by formatValue.
      expect(wrapper.text()).toContain("17.34");
      // No group cell means no rollup label either.
      expect(wrapper.text()).not.toContain("All groups (rollup)");
    });

    it("shows no group filter chip", () => {
      wrapper = mountComp({
        transitions: [makeRollupTransition()],
        showGroupColumn: false,
      });
      expect(wrapper.find('[data-test="alerts-alertgrouphistory-filter"]').exists()).toBe(false);
    });
  });

  describe("empty state", () => {
    it("shows the empty state when there are no transitions", () => {
      wrapper = mountComp({ transitions: [], showGroupColumn: false });
      expect(wrapper.find('[data-test="alerts-alertgrouphistory-empty"]').exists()).toBe(true);
    });

    it("suppresses the empty state while loading", () => {
      wrapper = mountComp({
        transitions: [],
        loading: true,
        showGroupColumn: false,
      });
      expect(wrapper.find('[data-test="alerts-alertgrouphistory-empty"]').exists()).toBe(false);
    });
  });

  describe("refresh", () => {
    it("emits refresh when the refresh button is clicked", async () => {
      wrapper = mountComp();
      await wrapper.find('[data-test="alerts-alertgrouphistory-refresh"]').trigger("click");
      expect(wrapper.emitted("refresh")).toHaveLength(1);
    });
  });
});

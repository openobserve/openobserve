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

import ODimensionChip from "@/lib/core/Badge/ODimensionChip.vue";
import i18n from "@/locales";
import { raw } from "@/types/i18n";

import DbmScopeFilters, { type DbmInsightChip, type DbmScopeFilter } from "./DbmScopeFilters.vue";

const filter = (over: Partial<DbmScopeFilter> = {}): DbmScopeFilter => ({
  key: "service",
  dimension: raw("service"),
  value: "checkout",
  placeholder: raw("All services"),
  options: [{ value: "checkout", label: raw("checkout") }],
  onChange: vi.fn(),
  ...over,
});

const mountFilters = (filters: DbmScopeFilter[], insightChip: DbmInsightChip | null = null) =>
  mount(DbmScopeFilters, {
    props: { filters, insightChip },
    global: { plugins: [i18n] },
  });

describe("DbmScopeFilters", () => {
  /**
   * The chip is the app-wide ODimensionChip, so a dimension is the same colour
   * here as on the incident list. Hand-rolling the two-segment markup again is
   * exactly what this pins against.
   */
  describe("the active scope renders as standard dimension chips", () => {
    it("renders one ODimensionChip per set filter", () => {
      const wrapper = mountFilters([
        filter(),
        filter({ key: "system", dimension: raw("engine"), value: "postgresql" }),
      ]);
      expect(wrapper.findAllComponents(ODimensionChip)).toHaveLength(2);
    });

    it("skips dimensions the user has not set", () => {
      const wrapper = mountFilters([filter(), filter({ key: "env", value: null })]);
      expect(wrapper.findAllComponents(ODimensionChip)).toHaveLength(1);
    });

    /**
     * The COLOUR comes from the machine key, the LABEL from the friendly name —
     * so `service` matches the incident list even though it reads "service" and
     * `system` reads "engine".
     */
    it("colours by the machine key and labels with the friendly name", () => {
      const wrapper = mountFilters([
        filter({ key: "system", dimension: raw("engine"), value: "postgresql" }),
      ]);
      const chip = wrapper.findComponent(ODimensionChip);
      expect(chip.props("dimKey")).toBe("system");
      expect(chip.props("keyLabel")).toBe("engine");
      expect(chip.props("value")).toBe("postgresql");
    });

    it("shows both segments as text", () => {
      const wrapper = mountFilters([filter()]);
      expect(wrapper.text()).toContain("service");
      expect(wrapper.text()).toContain("checkout");
    });
  });

  describe("each chip is removable", () => {
    it("clears just that dimension", async () => {
      const onChange = vi.fn();
      const wrapper = mountFilters([filter({ onChange })]);
      await wrapper.find('[data-test="dbm-queries-scope-chip-service-remove"]').trigger("click");
      expect(onChange).toHaveBeenCalledWith(null);
    });
  });

  /**
   * The insight chip is deliberately NOT a dimension chip: it says the table was
   * narrowed by a finding, not by an axis the user picked, so it keeps the amber
   * and stays out of the dimension colour vocabulary.
   */
  describe("the insight chip stays distinct from the dimension chips", () => {
    it("is not rendered as an ODimensionChip", () => {
      const wrapper = mountFilters([filter()], {
        dimension: raw("insight"),
        label: raw("Newly expensive"),
      });
      expect(wrapper.findAllComponents(ODimensionChip)).toHaveLength(1);
      const chip = wrapper.find('[data-test="dbm-queries-scope-chip-insight"]');
      expect(chip.exists()).toBe(true);
      expect(chip.html()).toContain("bg-badge-warning-soft-bg");
      expect(chip.text()).toContain("Newly expensive");
    });

    it("emits clearInsight when removed", async () => {
      const wrapper = mountFilters([], {
        dimension: raw("insight"),
        label: raw("Newly expensive"),
      });
      await wrapper.find('[data-test="dbm-queries-scope-chip-insight-remove"]').trigger("click");
      expect(wrapper.emitted("clearInsight")).toBeTruthy();
    });

    it("is absent when no insight is active", () => {
      const wrapper = mountFilters([filter()]);
      expect(wrapper.find('[data-test="dbm-queries-scope-chip-insight"]').exists()).toBe(false);
    });
  });
});

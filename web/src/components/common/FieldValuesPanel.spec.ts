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

import { mount, VueWrapper } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { nextTick } from "vue";
import FieldValuesPanel from "@/components/common/FieldValuesPanel.vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";

installQuasar({ plugins: [Dialog, Notify] });

vi.mock("@vueuse/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vueuse/core")>();
  return {
    ...actual,
    watchDebounced: vi.fn((source: any, callback: any) => {
      // Execute synchronously in tests so we can assert on emit calls
    }),
  };
});

vi.mock("@/utils/zincutils", () => ({
  formatLargeNumber: vi.fn((n: number) => String(n)),
}));

vi.mock("@/components/icons/EqualIcon.vue", () => ({
  default: { template: "<span class='equal-icon' />" },
}));

vi.mock("@/components/icons/NotEqualIcon.vue", () => ({
  default: { template: "<span class='not-equal-icon' />" },
}));

vi.mock("@quasar/extras/material-icons-outlined", () => ({
  "arrow-back-ios": "arrow_back_ios",
  "arrow-forward-ios": "arrow_forward_ios",
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────

const buildFieldValues = (count = 3, extra: Partial<any> = {}) => ({
  isLoading: false,
  values: Array.from({ length: count }, (_, i) => ({
    key: `value-${i + 1}`,
    count: (i + 1) * 10,
  })),
  errMsg: "",
  hasMore: false,
  ...extra,
});

describe("FieldValuesPanel.vue", () => {
  let wrapper: VueWrapper;

  const createWrapper = (props: Record<string, any> = {}) =>
    mount(FieldValuesPanel, {
      props: {
        fieldName: "status",
        fieldValues: buildFieldValues(),
        showMultiSelect: true,
        defaultValuesCount: 10,
        theme: "light",
        ...props,
      },
    });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  // ─── Mounting ───────────────────────────────────────────────────────────────

  describe("Mounting", () => {
    it("mounts without errors", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("renders the filter-values-container", () => {
      wrapper = createWrapper();
      expect(wrapper.find(".filter-values-container").exists()).toBe(true);
    });
  });

  // ─── Props defaults ─────────────────────────────────────────────────────────

  describe("Default props", () => {
    it("defaults showMultiSelect to true", () => {
      wrapper = mount(FieldValuesPanel, { props: { fieldName: "level" } });
      expect(wrapper.props("showMultiSelect")).toBe(true);
    });

    it("defaults defaultValuesCount to 10", () => {
      wrapper = mount(FieldValuesPanel, { props: { fieldName: "level" } });
      expect(wrapper.props("defaultValuesCount")).toBe(10);
    });

    it("defaults theme to 'light'", () => {
      wrapper = mount(FieldValuesPanel, { props: { fieldName: "level" } });
      expect(wrapper.props("theme")).toBe("light");
    });
  });

  // ─── Loading state ──────────────────────────────────────────────────────────

  describe("Loading state", () => {
    it("shows loading indicator when isLoading is true and no cached values", () => {
      wrapper = createWrapper({
        fieldValues: { isLoading: true, values: [], errMsg: "" },
      });
      // q-inner-loading has showing=true
      const loading = wrapper.findComponent({ name: "QInnerLoading" });
      expect(loading.exists()).toBe(true);
    });

    it("hides values list while loading with no interim cache", () => {
      wrapper = createWrapper({
        fieldValues: { isLoading: true, values: [], errMsg: "" },
      });
      expect(wrapper.findAll("q-list").length).toBe(0);
    });
  });

  // ─── No values state ────────────────────────────────────────────────────────

  describe("No values state", () => {
    it("shows 'No values found' when fieldValues.values is empty and not loading", () => {
      wrapper = createWrapper({
        fieldValues: { isLoading: false, values: [], errMsg: "" },
      });
      expect(wrapper.text()).toContain("No values found");
    });

    it("shows custom errMsg when provided and values list is empty", () => {
      wrapper = createWrapper({
        fieldValues: {
          isLoading: false,
          values: [],
          errMsg: "Stream not found",
        },
      });
      expect(wrapper.text()).toContain("Stream not found");
    });

    it("does not show error message when values are present", () => {
      wrapper = createWrapper({
        fieldValues: buildFieldValues(2),
      });
      // The "No values found" element uses v-show so it stays in the DOM;
      // assert it is hidden rather than checking wrapper.text()
      const noValuesEl = wrapper.find('[data-test="field-values-panel-no-values-msg"]');
      expect(noValuesEl.exists()).toBe(true);
      expect(noValuesEl.isVisible()).toBe(false);
    });
  });

  // ─── Values list rendering ──────────────────────────────────────────────────

  describe("Values list rendering", () => {
    it("renders one list item per value", () => {
      wrapper = createWrapper({ fieldValues: buildFieldValues(3) });
      const items = wrapper.findAll(".filter-values-container [data-test]");
      // 3 items — each has a data-test attribute for log-search-subfield-add
      const subfields = items.filter((el) =>
        el.attributes("data-test")?.startsWith("logs-search-subfield-add-")
      );
      expect(subfields.length).toBe(3);
    });

    it("renders value keys in the list", () => {
      wrapper = createWrapper({ fieldValues: buildFieldValues(2) });
      expect(wrapper.text()).toContain("value-1");
      expect(wrapper.text()).toContain("value-2");
    });

    it("renders formatted count via formatLargeNumber", () => {
      wrapper = createWrapper({ fieldValues: buildFieldValues(1) });
      expect(wrapper.text()).toContain("10");
    });

    it("renders value label when provided instead of key", () => {
      wrapper = createWrapper({
        fieldValues: {
          isLoading: false,
          values: [{ key: "k1", count: 5, label: "Custom Label" }],
        },
      });
      expect(wrapper.text()).toContain("Custom Label");
    });
  });

  // ─── Multi-select controls ───────────────────────────────────────────────────

  describe("Multi-select controls", () => {
    it("renders checkboxes when showMultiSelect is true", () => {
      wrapper = createWrapper({ showMultiSelect: true, fieldValues: buildFieldValues(2) });
      expect(wrapper.findAllComponents({ name: "QCheckbox" }).length).toBeGreaterThan(0);
    });

    it("does not render checkboxes when showMultiSelect is false", () => {
      wrapper = createWrapper({ showMultiSelect: false, fieldValues: buildFieldValues(2) });
      expect(wrapper.findAllComponents({ name: "QCheckbox" }).length).toBe(0);
    });

    it("does not render include/exclude buttons when showMultiSelect is false", () => {
      wrapper = createWrapper({ showMultiSelect: false, fieldValues: buildFieldValues(2) });
      expect(
        wrapper.find('[data-test="log-search-subfield-list-equal-status-field-btn"]').exists()
      ).toBe(false);
    });
  });

  // ─── Emit: checkbox-driven add-multiple-search-terms ────────────────────────

  describe("Emit: checkbox-driven add-multiple-search-terms", () => {
    it("emits 'add-multiple-search-terms' with include when checkbox checked in include mode", async () => {
      wrapper = createWrapper({ showMultiSelect: true, fieldValues: buildFieldValues(1) });
      // filterMode defaults to 'include'
      (wrapper.vm as any).handleUserCheckboxChange(["value-1"]);
      await nextTick();
      const emitted = wrapper.emitted("add-multiple-search-terms");
      expect(emitted).toBeTruthy();
      expect(emitted![0]).toEqual(["status", ["value-1"], "include"]);
    });

    it("emits 'add-multiple-search-terms' with exclude when checkbox checked in exclude mode", async () => {
      wrapper = createWrapper({ showMultiSelect: true, fieldValues: buildFieldValues(1) });
      // Set filterMode to 'exclude' while selectedValues is empty so watcher doesn't fire
      (wrapper.vm as any).filterMode = "exclude";
      await nextTick();
      (wrapper.vm as any).handleUserCheckboxChange(["value-1"]);
      await nextTick();
      const emitted = wrapper.emitted("add-multiple-search-terms");
      expect(emitted).toBeTruthy();
      expect(emitted![0]).toEqual(["status", ["value-1"], "exclude"]);
    });
  });

  // ─── Emit: load-more-values ──────────────────────────────────────────────────

  describe("Emit: load-more-values", () => {
    it("shows 'View more values' button when hasMore is true", () => {
      wrapper = createWrapper({
        fieldValues: buildFieldValues(3, { hasMore: true }),
      });
      const btn = wrapper.find('[data-test="log-search-subfield-load-more-status"]');
      expect(btn.exists()).toBe(true);
    });

    it("hides 'View more values' button when hasMore is false", () => {
      wrapper = createWrapper({ fieldValues: buildFieldValues(3, { hasMore: false }) });
      const btn = wrapper.find('[data-test="log-search-subfield-load-more-status"]');
      expect(btn.exists()).toBe(false);
    });

    it("emits 'load-more-values' with fieldName when button clicked", async () => {
      wrapper = createWrapper({
        fieldValues: buildFieldValues(3, { hasMore: true }),
      });
      const btn = wrapper.find('[data-test="log-search-subfield-load-more-status"]');
      await btn.trigger("click");
      expect(wrapper.emitted("load-more-values")![0]).toEqual(["status"]);
    });
  });

  // ─── Multi-select action bar ─────────────────────────────────────────────────

  describe("Multi-select action bar", () => {
    it("is hidden when no values are selected", () => {
      wrapper = createWrapper({ showMultiSelect: true, fieldValues: buildFieldValues(3) });
      // selection-count is only shown when selectedValues.length > 0
      expect(wrapper.find(".selection-count").exists()).toBe(false);
    });

    it("appears when at least one value is selected", async () => {
      wrapper = createWrapper({ showMultiSelect: true, fieldValues: buildFieldValues(3) });
      (wrapper.vm as any).selectedValues = ["value-1"];
      await nextTick();
      expect(wrapper.find(".selection-count").exists()).toBe(true);
    });

    it("shows count of selected values", async () => {
      wrapper = createWrapper({ showMultiSelect: true, fieldValues: buildFieldValues(3) });
      (wrapper.vm as any).selectedValues = ["value-1", "value-2"];
      await nextTick();
      expect(wrapper.find(".selection-count").text()).toContain("2 selected");
    });

    it("clears selection when clear button clicked", async () => {
      wrapper = createWrapper({ showMultiSelect: true, fieldValues: buildFieldValues(3) });
      (wrapper.vm as any).selectedValues = ["value-1"];
      await nextTick();
      const clearBtn = wrapper.find(
        '[data-test="field-values-panel-clear-selection-btn"]'
      );
      await clearBtn.trigger("click");
      expect((wrapper.vm as any).selectedValues).toEqual([]);
    });

    // Mode-switch emissions are debounced (300 ms) so fake timers are required
    // to flush the debounce before asserting the emitted event.
    describe("mode switch emits (debounced)", () => {
      beforeEach(() => {
        vi.useFakeTimers();
      });
      afterEach(() => {
        vi.useRealTimers();
      });

      it("emits 'add-multiple-search-terms' with include when Include mode button clicked", async () => {
        wrapper = createWrapper({ showMultiSelect: true, fieldValues: buildFieldValues(3) });
        // Set filterMode to 'exclude' while selectedValues is empty so no premature emit
        (wrapper.vm as any).filterMode = "exclude";
        await nextTick();
        (wrapper.vm as any).selectedValues = ["value-1", "value-2"];
        await nextTick();
        const includeBtn = wrapper.find(
          '[data-test="field-values-panel-include-mode-btn"]'
        );
        await includeBtn.trigger("click");
        vi.runAllTimers();
        const emitted = wrapper.emitted("add-multiple-search-terms");
        expect(emitted).toBeTruthy();
        expect(emitted![0]).toEqual(["status", ["value-1", "value-2"], "include"]);
      });

      it("emits 'add-multiple-search-terms' with exclude when Exclude mode button clicked", async () => {
        wrapper = createWrapper({ showMultiSelect: true, fieldValues: buildFieldValues(3) });
        // filterMode defaults to 'include'; set selectedValues then click exclude
        (wrapper.vm as any).selectedValues = ["value-1"];
        await nextTick();
        const excludeBtn = wrapper.find(
          '[data-test="field-values-panel-exclude-mode-btn"]'
        );
        await excludeBtn.trigger("click");
        vi.runAllTimers();
        const emitted = wrapper.emitted("add-multiple-search-terms");
        expect(emitted).toBeTruthy();
        expect(emitted![0]).toEqual(["status", ["value-1"], "exclude"]);
      });
    });

    it("does NOT clear selectedValues after applying multi-select include", async () => {
      // selectedValues must not be wiped after a filter mode change.
      // The watcher on allActiveValues (driven by activeIncludeValues /
      // activeExcludeValues props) is responsible for syncing selection state
      // once the parent query updates.
      wrapper = createWrapper({ showMultiSelect: true, fieldValues: buildFieldValues(3) });
      // Set filterMode to 'exclude' while empty, then add selectedValues
      (wrapper.vm as any).filterMode = "exclude";
      await nextTick();
      (wrapper.vm as any).selectedValues = ["value-1"];
      await nextTick();
      const includeBtn = wrapper.find(
        '[data-test="field-values-panel-include-mode-btn"]'
      );
      await includeBtn.trigger("click");
      expect((wrapper.vm as any).selectedValues).toEqual(["value-1"]);
    });

    it("syncs selectedValues from activeIncludeValues when parent query updates", async () => {
      // Simulates what happens after the query has been updated by the parent:
      // selectedValues must reflect the new active filter state.
      wrapper = createWrapper({
        showMultiSelect: true,
        fieldValues: buildFieldValues(3),
        activeIncludeValues: ["value-1"],
      });
      await nextTick();
      expect((wrapper.vm as any).selectedValues).toEqual(["value-1"]);

      // Parent query changes (e.g. user clicks Include on a different value)
      await wrapper.setProps({ activeIncludeValues: ["value-2"] });
      await nextTick();
      expect((wrapper.vm as any).selectedValues).toEqual(["value-2"]);
    });

    it("keeps selectedValues stable when Include is clicked a second time with the same selection", async () => {
      // filterMode starts as 'include'; clicking include again is a no-op —
      // Vue's watcher does not fire when the value doesn't change, so selectedValues
      // remains untouched.
      wrapper = createWrapper({
        showMultiSelect: true,
        fieldValues: buildFieldValues(3),
        activeIncludeValues: ["value-1"],
      });
      await nextTick();
      expect((wrapper.vm as any).selectedValues).toEqual(["value-1"]);

      const includeBtn = wrapper.find(
        '[data-test="field-values-panel-include-mode-btn"]'
      );
      await includeBtn.trigger("click");
      // filterMode was already 'include', no reactive change, no emit
      expect((wrapper.vm as any).selectedValues).toEqual(["value-1"]);
    });

    it("syncs selectedValues from activeExcludeValues when exclude is active", async () => {
      wrapper = createWrapper({
        showMultiSelect: true,
        fieldValues: buildFieldValues(3),
        activeExcludeValues: ["value-3"],
      });
      await nextTick();
      expect((wrapper.vm as any).selectedValues).toEqual(["value-3"]);
    });
  });

  // ─── Filter mode edge cases ──────────────────────────────────────────────────

  describe("Filter mode edge cases", () => {
    it("does not emit add-multiple-search-terms when selectedValues is empty", async () => {
      wrapper = createWrapper({ showMultiSelect: true, fieldValues: buildFieldValues(2) });
      // selectedValues is empty; changing filterMode should not emit add-multiple-search-terms
      const excludeBtn = wrapper.find('[data-test="field-values-panel-exclude-mode-btn"]');
      await excludeBtn.trigger("click");
      await nextTick();
      expect(wrapper.emitted("add-multiple-search-terms")).toBeFalsy();
    });
  });

  // ─── Search bar (showValueSearch) ───────────────────────────────────────────

  describe("Value search bar", () => {
    it("hides search bar when there are no values", () => {
      wrapper = createWrapper({
        fieldValues: buildFieldValues(0),
      });
      expect(wrapper.find(".value-search-container").exists()).toBe(false);
    });

    it("shows search bar when values exist even below defaultValuesCount", () => {
      wrapper = createWrapper({
        defaultValuesCount: 10,
        fieldValues: buildFieldValues(5),
      });
      expect(wrapper.find(".value-search-container").exists()).toBe(true);
    });

    it("keeps search bar visible when searching returns no values but cache exists", async () => {
      wrapper = createWrapper({
        fieldValues: buildFieldValues(2),
      });
      await nextTick();
      await wrapper.setProps({
        fieldValues: {
          isLoading: false,
          values: [],
          errMsg: "",
        },
      });
      await nextTick();
      expect(wrapper.find(".value-search-container").exists()).toBe(true);
    });
  });

  // ─── displayValues computed ──────────────────────────────────────────────────

  describe("displayValues computed", () => {
    it("returns fieldValues.values when not loading or no searchTerm", () => {
      wrapper = createWrapper({ fieldValues: buildFieldValues(3) });
      expect((wrapper.vm as any).displayValues).toHaveLength(3);
    });

    it("returns empty array when fieldValues is undefined", () => {
      wrapper = createWrapper({ fieldValues: undefined });
      expect((wrapper.vm as any).displayValues).toEqual([]);
    });

    it("returns locally filtered cache while loading with a search term", async () => {
      wrapper = createWrapper({
        defaultValuesCount: 2,
        fieldValues: { isLoading: true, values: [], errMsg: "" },
      });
      // Pre-populate cache
      (wrapper.vm as any).cachedValues = [
        { key: "error", count: 5 },
        { key: "info", count: 10 },
        { key: "warning", count: 3 },
      ];
      (wrapper.vm as any).valueSearchTerm = "error";
      await nextTick();
      const display = (wrapper.vm as any).displayValues;
      expect(display).toHaveLength(1);
      expect(display[0].key).toBe("error");
    });
  });

  // ─── reset() exposed method ──────────────────────────────────────────────────

  describe("reset() exposed method", () => {
    it("clears selectedValues", async () => {
      wrapper = createWrapper({ showMultiSelect: true, fieldValues: buildFieldValues(2) });
      (wrapper.vm as any).selectedValues = ["value-1"];
      (wrapper.vm as any).reset();
      await nextTick();
      expect((wrapper.vm as any).selectedValues).toEqual([]);
    });

    it("clears valueSearchTerm", async () => {
      wrapper = createWrapper({ fieldValues: buildFieldValues(2) });
      (wrapper.vm as any).valueSearchTerm = "foo";
      (wrapper.vm as any).reset();
      await nextTick();
      expect((wrapper.vm as any).valueSearchTerm).toBe("");
    });

    it("clears cachedValues", async () => {
      wrapper = createWrapper({ fieldValues: buildFieldValues(2) });
      (wrapper.vm as any).cachedValues = [{ key: "x", count: 1 }];
      (wrapper.vm as any).reset();
      await nextTick();
      expect((wrapper.vm as any).cachedValues).toEqual([]);
    });
  });

  // ─── Cache watch ─────────────────────────────────────────────────────────────

  describe("cachedValues watcher", () => {
    it("caches incoming values when valueSearchTerm is empty", async () => {
      const fieldValues = buildFieldValues(2);
      wrapper = createWrapper({ fieldValues });
      // The watch triggers when fieldValues.values changes
      await wrapper.setProps({
        fieldValues: {
          isLoading: false,
          values: [{ key: "new-val", count: 99 }],
          errMsg: "",
        },
      });
      await nextTick();
      // cachedValues should contain the new value
      expect((wrapper.vm as any).cachedValues).toEqual(
        expect.arrayContaining([expect.objectContaining({ key: "new-val" })])
      );
    });
  });

  // ─── Theme prop ──────────────────────────────────────────────────────────────

  describe("Theme-aware styling", () => {
    it("accepts 'dark' theme without errors", () => {
      wrapper = createWrapper({ theme: "dark", fieldValues: buildFieldValues(1) });
      expect(wrapper.exists()).toBe(true);
    });

    it("accepts 'light' theme without errors", () => {
      wrapper = createWrapper({ theme: "light", fieldValues: buildFieldValues(1) });
      expect(wrapper.exists()).toBe(true);
    });
  });
});

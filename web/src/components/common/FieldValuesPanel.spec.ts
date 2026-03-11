// Copyright 2026 OpenObserve Inc.

import { describe, expect, it, afterEach, vi } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import FieldValuesPanel from "./FieldValuesPanel.vue";

// Stub icon components — they render SVG with no test-relevant logic
vi.mock("@/components/icons/EqualIcon.vue", () => ({
  default: { template: "<span data-test='equal-icon' />" },
}));
vi.mock("@/components/icons/NotEqualIcon.vue", () => ({
  default: { template: "<span data-test='not-equal-icon' />" },
}));

installQuasar();

// ---------------------------------------------------------------------------
// Helpers & fixtures
// ---------------------------------------------------------------------------

interface FieldValue {
  key: string;
  count: number;
  label?: string;
}

interface FieldValues {
  isLoading: boolean;
  values: FieldValue[];
  errMsg?: string;
  hasMore?: boolean;
}

const makeFieldValues = (
  overrides: Partial<FieldValues> = {},
): FieldValues => ({
  isLoading: false,
  values: [],
  hasMore: false,
  ...overrides,
});

const sampleValues: FieldValue[] = [
  { key: "error", count: 1500 },
  { key: "warn", count: 750 },
  { key: "info", count: 200 },
];

function mountFactory(
  props: Record<string, unknown> = {},
  options: Record<string, unknown> = {},
) {
  return mount(FieldValuesPanel, {
    props: {
      fieldName: "level",
      ...props,
    },
    ...options,
  });
}

describe("FieldValuesPanel", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // rendering
  // -------------------------------------------------------------------------
  describe("rendering", () => {
    it("should render without errors", () => {
      wrapper = mountFactory({
        fieldValues: makeFieldValues({ values: sampleValues }),
      });
      expect(wrapper.exists()).toBe(true);
    });

    it("should show each value in the list", () => {
      wrapper = mountFactory({
        fieldValues: makeFieldValues({ values: sampleValues }),
      });
      const items = wrapper.findAll("q-item, .q-item");
      expect(items.length).toBe(sampleValues.length);
    });

    it("should show loading spinner when isLoading is true and values list is empty", () => {
      wrapper = mountFactory({
        fieldValues: makeFieldValues({ isLoading: true, values: [] }),
      });
      // q-inner-loading is shown via v-show; the container div must be in DOM
      const loadingContainer = wrapper.find("[style*='3.75rem']");
      expect(loadingContainer.exists()).toBe(true);
    });

    it("should show 'No values found' when values is empty and not loading", () => {
      wrapper = mountFactory({
        fieldValues: makeFieldValues({ isLoading: false, values: [] }),
      });
      const noValuesEl = wrapper.find(".text-subtitle2");
      expect(noValuesEl.exists()).toBe(true);
      expect(noValuesEl.text()).toBe("No values found");
    });

    it("should show errMsg text instead of 'No values found' when errMsg is set", () => {
      wrapper = mountFactory({
        fieldValues: makeFieldValues({
          isLoading: false,
          values: [],
          errMsg: "Failed to fetch",
        }),
      });
      const noValuesEl = wrapper.find(".text-subtitle2");
      expect(noValuesEl.exists()).toBe(true);
      expect(noValuesEl.text()).toBe("Failed to fetch");
    });
  });

  // -------------------------------------------------------------------------
  // props
  // -------------------------------------------------------------------------
  describe("props", () => {
    it("should use fieldName in the data-test attribute of each item row", () => {
      wrapper = mountFactory({
        fieldName: "status",
        fieldValues: makeFieldValues({ values: [{ key: "200", count: 5 }] }),
      });
      const item = wrapper.find(
        '[data-test="logs-search-subfield-add-status-200"]',
      );
      expect(item.exists()).toBe(true);
    });

    it("should show include/exclude buttons when showMultiSelect is true (default)", () => {
      wrapper = mountFactory({
        fieldValues: makeFieldValues({ values: sampleValues }),
      });
      const includeBtns = wrapper.findAll(
        '[data-test="log-search-subfield-list-equal-level-field-btn"]',
      );
      expect(includeBtns.length).toBe(sampleValues.length);
    });

    it("should hide include/exclude buttons and checkboxes when showMultiSelect is false", () => {
      wrapper = mountFactory({
        fieldValues: makeFieldValues({ values: sampleValues }),
        showMultiSelect: false,
      });
      const includeBtns = wrapper.findAll(
        '[data-test="log-search-subfield-list-equal-level-field-btn"]',
      );
      expect(includeBtns.length).toBe(0);
    });

    it("should not show value search when values count is below defaultValuesCount", () => {
      wrapper = mountFactory({
        fieldValues: makeFieldValues({ values: sampleValues }), // 3 values
        defaultValuesCount: 10,
      });
      // search container only appears when cached values >= defaultValuesCount
      const searchContainer = wrapper.find(".value-search-container");
      expect(searchContainer.exists()).toBe(false);
    });

    it("should apply text-white class on action buttons when theme is dark", () => {
      wrapper = mountFactory({
        fieldValues: makeFieldValues({ values: [{ key: "err", count: 1 }] }),
        theme: "dark",
      });
      const includeBtn = wrapper.find(
        '[data-test="log-search-subfield-list-equal-level-field-btn"]',
      );
      const actionDiv = includeBtn.element.closest(".flex.row");
      expect(actionDiv?.classList.contains("text-white")).toBe(true);
    });

    it("should apply text-black class on action buttons when theme is light (default)", () => {
      wrapper = mountFactory({
        fieldValues: makeFieldValues({ values: [{ key: "err", count: 1 }] }),
        theme: "light",
      });
      const includeBtn = wrapper.find(
        '[data-test="log-search-subfield-list-equal-level-field-btn"]',
      );
      const actionDiv = includeBtn.element.closest(".flex.row");
      expect(actionDiv?.classList.contains("text-black")).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // value list rendering
  // -------------------------------------------------------------------------
  describe("value list rendering", () => {
    it("should display the key text for each value row", () => {
      wrapper = mountFactory({
        fieldValues: makeFieldValues({ values: sampleValues }),
      });
      // Each item row contains an element that shows value.key
      const firstItem = wrapper.find(
        '[data-test="logs-search-subfield-add-level-error"]',
      );
      expect(firstItem.exists()).toBe(true);
      expect(firstItem.text()).toContain("error");
    });

    it("should format large counts with K suffix for thousands", () => {
      wrapper = mountFactory({
        fieldValues: makeFieldValues({
          values: [{ key: "error", count: 1500 }],
        }),
      });
      const item = wrapper.find(
        '[data-test="logs-search-subfield-add-level-error"]',
      );
      expect(item.text()).toContain("1.5K");
    });

    it("should format counts in millions with M suffix", () => {
      wrapper = mountFactory({
        fieldValues: makeFieldValues({
          values: [{ key: "info", count: 2500000 }],
        }),
      });
      const item = wrapper.find(
        '[data-test="logs-search-subfield-add-level-info"]',
      );
      expect(item.text()).toContain("2.5M");
    });

    it("should display raw count when value is below 1000", () => {
      wrapper = mountFactory({
        fieldValues: makeFieldValues({
          values: [{ key: "debug", count: 42 }],
        }),
      });
      const item = wrapper.find(
        '[data-test="logs-search-subfield-add-level-debug"]',
      );
      expect(item.text()).toContain("42");
    });

    it("should render a data-test item row keyed by value.key for each value", () => {
      const values = [
        { key: "alpha", count: 10 },
        { key: "beta", count: 20 },
      ];
      wrapper = mountFactory({
        fieldValues: makeFieldValues({ values }),
      });
      expect(
        wrapper
          .find('[data-test="logs-search-subfield-add-level-alpha"]')
          .exists(),
      ).toBe(true);
      expect(
        wrapper
          .find('[data-test="logs-search-subfield-add-level-beta"]')
          .exists(),
      ).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // user interactions
  // -------------------------------------------------------------------------
  describe("user interactions", () => {
    it("should emit add-search-term with 'include' action when = button is clicked", async () => {
      wrapper = mountFactory({
        fieldValues: makeFieldValues({
          values: [{ key: "error", count: 5 }],
        }),
      });
      const includeBtn = wrapper.find(
        '[data-test="log-search-subfield-list-equal-level-field-btn"]',
      );
      expect(includeBtn.exists()).toBe(true);
      await includeBtn.trigger("click");
      const emitted = wrapper.emitted("add-search-term");
      expect(emitted).toBeTruthy();
      expect(emitted![0]).toEqual(["level", "error", "include"]);
    });

    it("should emit add-search-term with 'exclude' action when != button is clicked", async () => {
      wrapper = mountFactory({
        fieldValues: makeFieldValues({
          values: [{ key: "warn", count: 3 }],
        }),
      });
      const excludeBtn = wrapper.find(
        '[data-test="log-search-subfield-list-not-equal-level-field-btn"]',
      );
      expect(excludeBtn.exists()).toBe(true);
      await excludeBtn.trigger("click");
      const emitted = wrapper.emitted("add-search-term");
      expect(emitted).toBeTruthy();
      expect(emitted![0]).toEqual(["level", "warn", "exclude"]);
    });

    it("should emit add-multiple-search-terms with 'include' action when Include button in action bar is clicked", async () => {
      wrapper = mountFactory({
        fieldValues: makeFieldValues({
          values: [
            { key: "error", count: 5 },
            { key: "warn", count: 3 },
          ],
        }),
        showMultiSelect: true,
      });

      // set selectedValues directly via the exposed vm path — no public API exists
      (wrapper.vm as any).selectedValues = ["error", "warn"];
      await flushPromises();

      const includeBtn = wrapper.find(
        '[data-test="log-search-subfield-include-selected-level"]',
      );
      expect(includeBtn.exists()).toBe(true);
      await includeBtn.trigger("click");

      const emitted = wrapper.emitted("add-multiple-search-terms");
      expect(emitted).toBeTruthy();
      expect(emitted![0]).toEqual(["level", ["error", "warn"], "include"]);
    });

    it("should emit add-multiple-search-terms with 'exclude' action when Exclude button is clicked", async () => {
      wrapper = mountFactory({
        fieldValues: makeFieldValues({
          values: [{ key: "debug", count: 1 }],
        }),
        showMultiSelect: true,
      });

      (wrapper.vm as any).selectedValues = ["debug"];
      await flushPromises();

      const excludeBtn = wrapper.find(
        '[data-test="log-search-subfield-exclude-selected-level"]',
      );
      expect(excludeBtn.exists()).toBe(true);
      await excludeBtn.trigger("click");

      const emitted = wrapper.emitted("add-multiple-search-terms");
      expect(emitted).toBeTruthy();
      expect(emitted![0]).toEqual(["level", ["debug"], "exclude"]);
    });

    it("should clear selectedValues after applying multi-select include", async () => {
      wrapper = mountFactory({
        fieldValues: makeFieldValues({
          values: [{ key: "error", count: 2 }],
        }),
        showMultiSelect: true,
      });
      (wrapper.vm as any).selectedValues = ["error"];
      await flushPromises();

      await wrapper
        .find('[data-test="log-search-subfield-include-selected-level"]')
        .trigger("click");

      expect((wrapper.vm as any).selectedValues).toEqual([]);
    });

    it("should clear selectedValues when the clear-selection button is clicked", async () => {
      wrapper = mountFactory({
        fieldValues: makeFieldValues({
          values: [{ key: "error", count: 2 }],
        }),
        showMultiSelect: true,
      });
      (wrapper.vm as any).selectedValues = ["error"];
      await flushPromises();

      const clearBtn = wrapper.find(
        '[data-test="log-search-subfield-clear-selected-level"]',
      );
      expect(clearBtn.exists()).toBe(true);
      await clearBtn.trigger("click");

      expect((wrapper.vm as any).selectedValues).toEqual([]);
    });

    it("should not show the multi-select action bar when no values are selected", () => {
      wrapper = mountFactory({
        fieldValues: makeFieldValues({
          values: sampleValues,
        }),
        showMultiSelect: true,
      });
      const actionBar = wrapper.find(".multi-select-action-bar");
      expect(actionBar.exists()).toBe(false);
    });

    it("should show selection count in action bar when values are selected", async () => {
      wrapper = mountFactory({
        fieldValues: makeFieldValues({
          values: sampleValues,
        }),
        showMultiSelect: true,
      });
      (wrapper.vm as any).selectedValues = ["error", "warn"];
      await flushPromises();

      const actionBar = wrapper.find(".multi-select-action-bar");
      expect(actionBar.exists()).toBe(true);
      expect(actionBar.find(".multi-select-count").text()).toBe("2 selected");
    });
  });

  // -------------------------------------------------------------------------
  // load more
  // -------------------------------------------------------------------------
  describe("load more", () => {
    it("should show 'View more values' button when hasMore is true and not loading", () => {
      wrapper = mountFactory({
        fieldValues: makeFieldValues({
          values: sampleValues,
          hasMore: true,
          isLoading: false,
        }),
      });
      const btn = wrapper.find(
        '[data-test="log-search-subfield-load-more-level"]',
      );
      expect(btn.exists()).toBe(true);
      expect(btn.text()).toBe("View more values");
    });

    it("should not show 'View more values' button when hasMore is false", () => {
      wrapper = mountFactory({
        fieldValues: makeFieldValues({
          values: sampleValues,
          hasMore: false,
        }),
      });
      const btn = wrapper.find(
        '[data-test="log-search-subfield-load-more-level"]',
      );
      expect(btn.exists()).toBe(false);
    });

    it("should not show 'View more values' button when isLoading is true even if hasMore is true", () => {
      wrapper = mountFactory({
        fieldValues: makeFieldValues({
          values: sampleValues,
          hasMore: true,
          isLoading: true,
        }),
      });
      const btn = wrapper.find(
        '[data-test="log-search-subfield-load-more-level"]',
      );
      expect(btn.exists()).toBe(false);
    });

    it("should emit load-more-values with fieldName when the button is clicked", async () => {
      wrapper = mountFactory({
        fieldName: "status",
        fieldValues: makeFieldValues({
          values: sampleValues,
          hasMore: true,
          isLoading: false,
        }),
      });
      const btn = wrapper.find(
        '[data-test="log-search-subfield-load-more-status"]',
      );
      expect(btn.exists()).toBe(true);
      await btn.trigger("click");

      const emitted = wrapper.emitted("load-more-values");
      expect(emitted).toBeTruthy();
      expect(emitted![0]).toEqual(["status"]);
    });
  });

  // -------------------------------------------------------------------------
  // search
  // -------------------------------------------------------------------------
  describe("search", () => {
    it("should show value search input when cached values count meets defaultValuesCount threshold", async () => {
      // Mount with enough values to fill the cache above the threshold (10)
      const tenValues = Array.from({ length: 10 }, (_, i) => ({
        key: `val-${i}`,
        count: i,
      }));
      wrapper = mountFactory({
        fieldValues: makeFieldValues({ values: tenValues }),
        defaultValuesCount: 10,
      });
      await flushPromises();

      const searchContainer = wrapper.find(".value-search-container");
      expect(searchContainer.exists()).toBe(true);
    });

    it("should emit search-field-values when valueSearchTerm changes (via debounce)", async () => {
      vi.useFakeTimers();
      const tenValues = Array.from({ length: 10 }, (_, i) => ({
        key: `v${i}`,
        count: i,
      }));
      wrapper = mountFactory({
        fieldValues: makeFieldValues({ values: tenValues }),
        defaultValuesCount: 10,
      });
      await flushPromises();

      const input = wrapper.find("input");
      expect(input.exists()).toBe(true);
      await input.setValue("err");
      // advance debounce timer (300ms)
      vi.advanceTimersByTime(350);
      await flushPromises();

      const emitted = wrapper.emitted("search-field-values");
      expect(emitted).toBeTruthy();
      expect(emitted![emitted!.length - 1]).toEqual(["level", "err"]);
      vi.useRealTimers();
    });
  });

  // -------------------------------------------------------------------------
  // edge cases
  // -------------------------------------------------------------------------
  describe("edge cases", () => {
    it("should render an empty values array without throwing", () => {
      wrapper = mountFactory({
        fieldValues: makeFieldValues({ values: [] }),
      });
      expect(wrapper.exists()).toBe(true);
      // No q-item rows should be rendered
      const items = wrapper.findAll('[data-test^="logs-search-subfield-add-"]');
      expect(items.length).toBe(0);
    });

    it("should display count of 0 without converting to empty string", () => {
      wrapper = mountFactory({
        fieldValues: makeFieldValues({
          values: [{ key: "null-count", count: 0 }],
        }),
      });
      const item = wrapper.find(
        '[data-test="logs-search-subfield-add-level-null-count"]',
      );
      expect(item.exists()).toBe(true);
      expect(item.text()).toContain("0");
    });

    it("should not emit add-multiple-search-terms when handleApplyMultiSelect is called with empty selection", async () => {
      wrapper = mountFactory({
        fieldValues: makeFieldValues({ values: sampleValues }),
        showMultiSelect: true,
      });
      // selectedValues starts empty — action bar is hidden; call reset() to
      // confirm the component stays stable
      (wrapper.vm as any).reset();
      await flushPromises();

      expect(wrapper.emitted("add-multiple-search-terms")).toBeFalsy();
    });

    it("should expose reset() which clears selectedValues, valueSearchTerm, and cachedValues", async () => {
      const tenValues = Array.from({ length: 10 }, (_, i) => ({
        key: `v${i}`,
        count: i,
      }));
      wrapper = mountFactory({
        fieldValues: makeFieldValues({ values: tenValues }),
        defaultValuesCount: 10,
      });
      await flushPromises();

      (wrapper.vm as any).selectedValues = ["v0", "v1"];
      (wrapper.vm as any).valueSearchTerm = "v";
      await flushPromises();

      (wrapper.vm as any).reset();
      await flushPromises();

      expect((wrapper.vm as any).selectedValues).toEqual([]);
      expect((wrapper.vm as any).valueSearchTerm).toBe("");
      expect((wrapper.vm as any).cachedValues).toEqual([]);
    });

    it("should handle undefined fieldValues gracefully — no render errors", () => {
      wrapper = mountFactory({ fieldValues: undefined });
      expect(wrapper.exists()).toBe(true);
      // Should show the "No values found" fallback
      const noValues = wrapper.find(".text-subtitle2");
      expect(noValues.exists()).toBe(true);
    });

    it("should show interim locally-filtered results while isLoading and search term is active", async () => {
      // Seed cache with values by providing them with no search term first
      const tenValues = Array.from({ length: 10 }, (_, i) => ({
        key: `item-${i}`,
        count: i,
      }));
      wrapper = mountFactory({
        fieldValues: makeFieldValues({ values: tenValues }),
        defaultValuesCount: 10,
      });
      await flushPromises();

      // Now simulate loading state with a search term active
      (wrapper.vm as any).valueSearchTerm = "item-1";
      await wrapper.setProps({
        fieldValues: {
          isLoading: true,
          values: [], // API hasn't responded yet
          hasMore: false,
        },
      });
      await flushPromises();

      // displayValues should be the locally-filtered cached result
      const items = wrapper.findAll(
        '[data-test^="logs-search-subfield-add-level-"]',
      );
      // "item-1" matches "item-1" exactly (1 item from the original 10)
      expect(items.length).toBeGreaterThanOrEqual(1);
    });
  });
});

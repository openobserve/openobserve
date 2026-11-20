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

const copyMock = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@/utils/clipboard", () => ({ copyToClipboard: copyMock }));

vi.mock("@/utils/zincutils", () => ({
  formatLargeNumber: vi.fn((n: number) => String(n)),
}));

vi.mock("@/components/icons/EqualIcon.vue", () => ({
  default: { template: "<span class='equal-icon' />" },
}));

vi.mock("@/components/icons/NotEqualIcon.vue", () => ({
  default: { template: "<span class='not-equal-icon' />" },
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
      expect(wrapper.find('[data-test="field-values-panel-container"]').exists()).toBe(true);
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
      const loading = wrapper.find('[data-test="field-values-panel-loading-indicator"]');
      expect(loading.exists()).toBe(true);
    });

    it("confines the loading overlay to its own box via a positioned wrapper", () => {
      // Regression: OInnerLoading is `absolute inset-0`, so its wrapper must be a
      // positioning context. Without `relative` the overlay escaped to the
      // nearest positioned ancestor (`.o-field-list__row`) and covered the field
      // row, blocking the click that collapses/cancels the request.
      wrapper = createWrapper({
        fieldValues: { isLoading: true, values: [], errMsg: "" },
      });
      const loading = wrapper.find('[data-test="field-values-panel-loading-indicator"]');
      expect(loading.exists()).toBe(true);
      const wrapperEl = loading.element.parentElement as HTMLElement;
      expect(wrapperEl.classList.contains("relative")).toBe(true);
    });

    it("hides values list while loading with no interim cache", () => {
      wrapper = createWrapper({
        fieldValues: { isLoading: true, values: [], errMsg: "" },
      });
      // The values list is a <ul> that's always rendered, but its <li>
      // children come from v-for over displayValues.
      // With no cached values during loading, no row items should be present.
      const valueRows = wrapper.findAll('[data-test^="logs-search-subfield-add-"]');
      expect(valueRows.length).toBe(0);
    });
  });

  // ─── No values state ────────────────────────────────────────────────────────

  describe("No values state", () => {
    it("shows 'No values found' when fieldValues.values is empty and not loading", () => {
      wrapper = createWrapper({
        fieldValues: { isLoading: false, values: [], errMsg: "" },
      });
      expect(wrapper.text()).toContain("No values found.");
      expect(wrapper.text()).toContain("Try a broader time range to see values.");
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
      const items = wrapper.findAll('[data-test="field-values-panel-container"] [data-test]');
      // 3 items — each has a data-test attribute for log-search-subfield-add
      const subfields = items.filter((el) =>
        el.attributes("data-test")?.startsWith("logs-search-subfield-add-"),
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

    it("shows a multi-line value on one line, its first line, and keeps the full value for the tooltip (U12)", () => {
      wrapper = createWrapper({
        fieldValues: {
          isLoading: false,
          values: [{ key: "k1\nwith\nnewlines", count: 5 }],
        },
      });
      const text = wrapper.findComponent({ name: "OTruncatedText" });
      expect(text.props("truncate")).toBe("middle");
      expect(text.props("text")).toBe("k1\nwith\nnewlines");
      expect(text.text()).toContain("k1…");
      expect(text.text()).not.toContain("newlines\n");
    });

    it("keeps matching the full value of a multi-line value while searching (U12)", async () => {
      wrapper = createWrapper({
        fieldValues: { isLoading: false, values: [{ key: "k1\nwith\nnewlines", count: 5 }] },
      });
      await wrapper.setProps({ fieldValues: { isLoading: true, values: [], errMsg: "" } });
      (wrapper.vm as any).valueSearchTerm = "newlines";
      await nextTick();
      expect((wrapper.vm as any).displayValues).toEqual([{ key: "k1\nwith\nnewlines", count: 5 }]);
    });

    it("puts the count in a fixed-width, right-aligned column of tabular digits (U12)", () => {
      wrapper = createWrapper({ fieldValues: buildFieldValues(1) });
      const count = wrapper.find('[data-test="field-values-panel-value-count"]');
      expect(count.classes()).toEqual(
        expect.arrayContaining(["w-12", "shrink-0", "text-right", "tabular-nums"]),
      );
    });

    it("copies a value from its row action, which shows on hover and focus (U12)", async () => {
      wrapper = createWrapper({ fieldValues: buildFieldValues(1) });
      const copy = wrapper.find('[data-test="field-values-panel-copy-status-value-1"]');
      expect(copy.classes()).toEqual(
        expect.arrayContaining([
          "opacity-0",
          "group-hover:opacity-100",
          "group-focus-visible:opacity-100",
          "group-has-[:focus-visible]:opacity-100",
        ]),
      );
      await copy.trigger("click");
      expect(copyMock).toHaveBeenCalledWith("value-1", expect.any(Function));
      expect(wrapper.emitted("set-value-filters")).toBeFalsy();
    });

    it("gives the NUL-keyed missing value a readable test id and still ticks it by its key (N1)", async () => {
      wrapper = createWrapper({
        fieldName: "body_kind",
        fieldValues: { isLoading: false, values: [{ key: "\u0000null", count: 4, label: "null" }] },
      });
      const ids = wrapper.findAll("[data-test]").map((el) => el.attributes("data-test") ?? "");
      expect(ids.some((id) => id.includes("\u0000"))).toBe(false);
      const checkbox = wrapper.findComponent(
        '[data-test="field-values-panel-checkbox-body_kind-__null__"]',
      );
      expect(checkbox.exists()).toBe(true);
      expect(
        wrapper.find('[data-test="logs-search-subfield-add-body_kind-__null__"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="field-values-panel-copy-body_kind-__null__"]').exists(),
      ).toBe(true);
      checkbox.vm.$emit("update:modelValue", true);
      await nextTick();
      expect(wrapper.emitted("set-value-filters")?.[0]).toEqual(["body_kind", ["\u0000null"], []]);
    });
  });

  // ─── Multi-select controls ───────────────────────────────────────────────────

  describe("Multi-select controls", () => {
    it("renders checkboxes when showMultiSelect is true", () => {
      wrapper = createWrapper({ showMultiSelect: true, fieldValues: buildFieldValues(2) });
      expect(wrapper.findAllComponents({ name: "OCheckbox" }).length).toBeGreaterThan(0);
    });

    it("does not render checkboxes when showMultiSelect is false", () => {
      wrapper = createWrapper({ showMultiSelect: false, fieldValues: buildFieldValues(2) });
      expect(wrapper.findAllComponents({ name: "OCheckbox" }).length).toBe(0);
    });

    it("does not render include/exclude buttons when showMultiSelect is false", () => {
      wrapper = createWrapper({ showMultiSelect: false, fieldValues: buildFieldValues(2) });
      expect(
        wrapper.find('[data-test="log-search-subfield-list-equal-status-field-btn"]').exists(),
      ).toBe(false);
    });
  });

  const checkbox = (key: string) =>
    wrapper.find(`[data-test="field-values-panel-checkbox-status-${key}"] [role="checkbox"]`);
  const modeButton = (mode: "include" | "exclude") =>
    wrapper.find(`[data-test="field-values-panel-${mode}-mode-btn"]`);

  describe("One operator per field", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("ticks a value with the include mode", async () => {
      wrapper = createWrapper({ fieldValues: buildFieldValues(2) });
      await checkbox("value-1").trigger("click");
      expect(wrapper.emitted("set-value-filters")![0]).toEqual(["status", ["value-1"], []]);
    });

    it("adds a value ticked in exclude mode to the excluded list", async () => {
      wrapper = createWrapper({
        fieldValues: buildFieldValues(3),
        activeExcludeValues: ["value-1"],
      });
      await checkbox("value-2").trigger("click");
      expect(wrapper.emitted("set-value-filters")![0]).toEqual([
        "status",
        [],
        ["value-1", "value-2"],
      ]);
    });

    it("flips every ticked value when the mode switches, sending one query", async () => {
      vi.useFakeTimers();
      wrapper = createWrapper({
        fieldValues: buildFieldValues(3),
        activeIncludeValues: ["value-1", "value-2"],
      });
      await modeButton("exclude").trigger("click");
      await modeButton("include").trigger("click");
      await modeButton("exclude").trigger("click");
      expect(wrapper.emitted("set-value-filters")).toBeFalsy();
      vi.advanceTimersByTime(300);
      expect(wrapper.emitted("set-value-filters")).toEqual([
        ["status", [], ["value-1", "value-2"]],
      ]);
    });

    it("sends nothing when the mode switches with no value ticked", async () => {
      vi.useFakeTimers();
      wrapper = createWrapper({ fieldValues: buildFieldValues(2) });
      await modeButton("exclude").trigger("click");
      vi.advanceTimersByTime(300);
      expect(wrapper.emitted("set-value-filters")).toBeFalsy();
      expect(modeButton("exclude").attributes("aria-pressed")).toBe("true");
    });

    it("colours every ticked value by the mode", () => {
      wrapper = createWrapper({
        fieldValues: buildFieldValues(3),
        activeExcludeValues: ["value-1", "value-2"],
      });
      for (const key of ["value-1", "value-2"]) {
        expect(checkbox(key).attributes("data-state")).toBe("checked");
        expect(checkbox(key).classes()).toContain("data-[state=checked]:bg-error-500");
      }
      expect(checkbox("value-3").attributes("data-state")).toBe("unchecked");
    });

    it("unticks the last value and removes the field filter", async () => {
      wrapper = createWrapper({
        fieldValues: buildFieldValues(3),
        activeIncludeValues: ["value-1"],
      });
      await checkbox("value-1").trigger("click");
      expect(wrapper.emitted("remove-field-filter")![0]).toEqual(["status"]);
    });

    it("puts a hand-typed mix of = and != under one operator, as main does", async () => {
      wrapper = createWrapper({
        fieldValues: buildFieldValues(3),
        activeIncludeValues: ["value-1"],
        activeExcludeValues: ["value-2"],
      });
      expect(modeButton("exclude").attributes("aria-pressed")).toBe("true");
      await checkbox("value-3").trigger("click");
      expect(wrapper.emitted("set-value-filters")![0]).toEqual([
        "status",
        [],
        ["value-1", "value-2", "value-3"],
      ]);
    });

    it("keeps a pending switch when the parent re-renders with the same values", async () => {
      vi.useFakeTimers();
      wrapper = createWrapper({
        fieldValues: buildFieldValues(3),
        activeIncludeValues: ["value-1", "value-2"],
      });
      await modeButton("exclude").trigger("click");
      await wrapper.setProps({ activeIncludeValues: ["value-1", "value-2"] });
      vi.advanceTimersByTime(300);
      expect(modeButton("exclude").attributes("aria-pressed")).toBe("true");
      expect(wrapper.emitted("set-value-filters")).toEqual([
        ["status", [], ["value-1", "value-2"]],
      ]);
    });

    it("sends one query when a value is ticked right after a switch", async () => {
      vi.useFakeTimers();
      wrapper = createWrapper({
        fieldValues: buildFieldValues(3),
        activeIncludeValues: ["value-1"],
      });
      await modeButton("exclude").trigger("click");
      await checkbox("value-2").trigger("click");
      vi.advanceTimersByTime(300);
      expect(wrapper.emitted("set-value-filters")).toEqual([
        ["status", [], ["value-1", "value-2"]],
      ]);
    });

    it("sends nothing when the mode is switched and switched back", async () => {
      vi.useFakeTimers();
      wrapper = createWrapper({
        fieldValues: buildFieldValues(3),
        activeIncludeValues: ["value-1"],
      });
      await modeButton("exclude").trigger("click");
      await modeButton("include").trigger("click");
      vi.advanceTimersByTime(300);
      expect(wrapper.emitted("set-value-filters")).toBeFalsy();
    });

    it("starts in exclude mode when the query excludes values", () => {
      wrapper = createWrapper({
        fieldValues: buildFieldValues(2),
        activeExcludeValues: ["value-2"],
      });
      expect(modeButton("exclude").attributes("aria-pressed")).toBe("true");
    });

    it("follows the query when the parent re-parses it", async () => {
      wrapper = createWrapper({
        fieldValues: buildFieldValues(3),
        activeIncludeValues: ["value-1"],
      });
      await wrapper.setProps({ activeIncludeValues: [], activeExcludeValues: ["value-3"] });
      expect(checkbox("value-1").attributes("data-state")).toBe("unchecked");
      expect(checkbox("value-3").attributes("data-state")).toBe("checked");
      expect(modeButton("exclude").attributes("aria-pressed")).toBe("true");
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

    const loadMoreButton = () => wrapper.find('[data-test="log-search-subfield-load-more-status"]');
    const isBusy = () => loadMoreButton().attributes("aria-busy") === "true";

    const page = (extra: Record<string, unknown>) =>
      buildFieldValues(10, { hasMore: true, generation: 1, settled: 1, ...extra });

    it("stays focusable while busy: aria-busy and aria-disabled, never disabled (U2)", async () => {
      wrapper = createWrapper({ fieldValues: page({}) });
      await loadMoreButton().trigger("click");
      expect(isBusy()).toBe(true);
      expect(loadMoreButton().attributes("aria-disabled")).toBe("true");
      expect(loadMoreButton().attributes("disabled")).toBeUndefined();
    });

    it("says it is loading and shows three placeholder rows while a page loads (L1)", async () => {
      wrapper = createWrapper({ fieldValues: page({}) });
      const skeleton = () => wrapper.find('[data-test="field-values-panel-load-more-skeleton"]');
      expect(loadMoreButton().text()).toBe("View more values");
      expect(skeleton().exists()).toBe(false);
      await loadMoreButton().trigger("click");
      expect(loadMoreButton().text()).toBe("Loading more…");
      expect(loadMoreButton().find(".animate-spin").exists()).toBe(true);
      expect(skeleton().findAll(":scope > div")).toHaveLength(3);
      const list = wrapper.find('[data-test="field-values-panel-values-list"]').element;
      expect(list.compareDocumentPosition(skeleton().element)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
      await wrapper.setProps({ fieldValues: page({ generation: 2, settled: 2 }) });
      expect(loadMoreButton().text()).toBe("View more values");
      expect(skeleton().exists()).toBe(false);
    });

    it("dims the values it keeps while a refetch runs, and marks the list busy (X3)", async () => {
      wrapper = createWrapper({ fieldValues: buildFieldValues(3, { isLoading: true }) });
      const list = wrapper.find('[data-test="field-values-panel-scroll"]');
      expect(list.classes()).toContain("opacity-60");
      expect(list.attributes("aria-busy")).toBe("true");
      expect(wrapper.findAll('[data-test="field-values-panel-value-text"]')).toHaveLength(3);
      await wrapper.setProps({ fieldValues: buildFieldValues(3) });
      expect(list.classes()).not.toContain("opacity-60");
      expect(list.attributes("aria-busy")).toBeUndefined();
    });

    it("ignores clicks while a load-more is in flight (U4)", async () => {
      wrapper = createWrapper({ fieldValues: page({}) });
      await loadMoreButton().trigger("click");
      await loadMoreButton().trigger("click");
      await wrapper.setProps({ fieldValues: page({ generation: 2 }) });
      await loadMoreButton().trigger("click");
      expect(wrapper.emitted("load-more-values")).toHaveLength(1);
    });

    it("waits for a fetch still streaming before asking for the next page (U4)", async () => {
      wrapper = createWrapper({ fieldValues: page({ settled: undefined }) });
      expect(isBusy()).toBe(true);
      await loadMoreButton().trigger("click");
      expect(wrapper.emitted("load-more-values")).toBeFalsy();
      await wrapper.setProps({ fieldValues: page({}) });
      expect(isBusy()).toBe(false);
    });

    it("stops waiting when the last page adds no values", async () => {
      wrapper = createWrapper({ fieldValues: page({}) });
      await loadMoreButton().trigger("click");
      await wrapper.setProps({ fieldValues: page({ generation: 2 }) });
      expect(isBusy()).toBe(true);
      await wrapper.setProps({ fieldValues: page({ generation: 2, settled: 2, hasMore: false }) });
      expect(loadMoreButton().exists()).toBe(false);
    });

    it("stops waiting when the load-more request fails", async () => {
      wrapper = createWrapper({ fieldValues: page({}) });
      await loadMoreButton().trigger("click");
      await wrapper.setProps({
        fieldValues: page({ generation: 2, settled: 2, errMsg: "failed" }),
      });
      expect(isBusy()).toBe(false);
    });

    it("shows a failed page's error above the button, which stays to retry (F2)", async () => {
      wrapper = createWrapper({ fieldValues: page({}) });
      await loadMoreButton().trigger("click");
      await wrapper.setProps({ fieldValues: page({ generation: 2 }) });
      expect(wrapper.find('[data-test="field-values-panel-load-error"]').exists()).toBe(false);
      await wrapper.setProps({
        fieldValues: page({ generation: 2, settled: 2, errMsg: "failed" }),
      });
      expect(wrapper.find('[data-test="field-values-panel-load-error"]').text()).toBe("failed");
      expect(isBusy()).toBe(false);
      await loadMoreButton().trigger("click");
      expect(wrapper.emitted("load-more-values")).toHaveLength(2);
    });

    it("keeps waiting while one stream has grown the list and another is still running", async () => {
      wrapper = createWrapper({ fieldValues: page({}) });
      await loadMoreButton().trigger("click");
      await wrapper.setProps({
        fieldValues: buildFieldValues(15, { hasMore: true, generation: 2, settled: 1 }),
      });
      expect(isBusy()).toBe(true);
      await wrapper.setProps({
        fieldValues: buildFieldValues(18, { hasMore: true, generation: 2, settled: 2 }),
      });
      expect(isBusy()).toBe(false);
    });

    it("keeps waiting while only an earlier fetch has settled", async () => {
      wrapper = createWrapper({ fieldValues: page({ generation: 1, settled: undefined }) });
      await wrapper.setProps({ fieldValues: page({}) });
      await loadMoreButton().trigger("click");
      await wrapper.setProps({ fieldValues: page({ generation: 2, settled: 1 }) });
      expect(isBusy()).toBe(true);
    });

    it("keeps focus on the button while the next page loads and it stays (U2)", async () => {
      wrapper = mount(FieldValuesPanel, {
        props: { fieldName: "status", fieldValues: page({}) },
        attachTo: document.body,
      });
      (loadMoreButton().element as HTMLElement).focus();
      await loadMoreButton().trigger("click");
      await wrapper.setProps({ fieldValues: page({ generation: 2 }) });
      await wrapper.setProps({ fieldValues: page({ generation: 2, settled: 2 }) });
      await nextTick();
      expect(document.activeElement).toBe(loadMoreButton().element);
    });

    it("moves focus to the last value when the values run out and the button leaves (U2)", async () => {
      wrapper = mount(FieldValuesPanel, {
        props: { fieldName: "status", fieldValues: page({}) },
        attachTo: document.body,
      });
      (loadMoreButton().element as HTMLElement).focus();
      await loadMoreButton().trigger("click");
      await wrapper.setProps({ fieldValues: page({ generation: 2 }) });
      await wrapper.setProps({
        fieldValues: buildFieldValues(12, { hasMore: false, generation: 2, settled: 2 }),
      });
      await nextTick();
      expect(loadMoreButton().exists()).toBe(false);
      expect(document.activeElement).toBe(checkbox("value-12").element);
    });
  });

  // ─── Multi-select action bar ─────────────────────────────────────────────────

  describe("Multi-select action bar", () => {
    it("is hidden when no values are selected", () => {
      wrapper = createWrapper({ showMultiSelect: true, fieldValues: buildFieldValues(3) });
      expect(wrapper.find(".selection-count").exists()).toBe(false);
    });

    it("counts included and excluded values together", () => {
      wrapper = createWrapper({
        fieldValues: buildFieldValues(3),
        activeIncludeValues: ["value-1"],
        activeExcludeValues: ["value-2"],
      });
      expect(wrapper.find(".selection-count").text()).toContain("2 selected");
    });

    it("clears both lists and drops the field's filter", async () => {
      wrapper = createWrapper({
        fieldValues: buildFieldValues(3),
        activeIncludeValues: ["value-1"],
        activeExcludeValues: ["value-2"],
      });
      await wrapper.find('[data-test="field-values-panel-clear-selection-btn"]').trigger("click");
      expect((wrapper.vm as any).selectedValues).toEqual([]);
      expect(wrapper.emitted("remove-field-filter")![0]).toEqual(["status"]);
    });

    it("gives the clear button and both mode buttons a tooltip with their label (U11)", () => {
      wrapper = createWrapper({
        fieldValues: buildFieldValues(3),
        activeIncludeValues: ["value-1"],
      });
      for (const selector of [
        '[data-test="field-values-panel-clear-selection-btn"]',
        '[data-test="field-values-panel-include-mode-btn"]',
        '[data-test="field-values-panel-exclude-mode-btn"]',
      ]) {
        const button = wrapper.find(selector);
        expect(button.attributes("title")).toBeUndefined();
        expect(button.findComponent({ name: "OTooltip" }).props("content")).toBe(
          button.attributes("aria-label"),
        );
      }
    });
  });

  // ─── Value search ────────────────────────────────────────────────────────────

  describe("Value search (U5)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    const valuesList = () =>
      wrapper.find('[data-test="field-values-panel-values-list"]').element
        .parentElement as HTMLElement;

    it("sends a search after the pause and its clearing at once", async () => {
      wrapper = createWrapper({ fieldValues: buildFieldValues(3) });
      (wrapper.vm as any).valueSearchTerm = "val";
      await nextTick();
      expect(wrapper.emitted("search-field-values")).toBeFalsy();
      vi.advanceTimersByTime(300);
      expect(wrapper.emitted("search-field-values")![0]).toEqual(["status", "val"]);
      (wrapper.vm as any).valueSearchTerm = "";
      await nextTick();
      expect(wrapper.emitted("search-field-values")![1]).toEqual(["status", ""]);
    });

    it("sends nothing for a term cleared before it was sent", async () => {
      wrapper = createWrapper({ fieldValues: buildFieldValues(3) });
      (wrapper.vm as any).valueSearchTerm = "val";
      await nextTick();
      (wrapper.vm as any).valueSearchTerm = "";
      await nextTick();
      vi.advanceTimersByTime(300);
      expect(wrapper.emitted("search-field-values")).toBeFalsy();
    });

    it("puts the values list back at its scroll position once the search is cleared", async () => {
      wrapper = createWrapper({ fieldValues: buildFieldValues(30) });
      valuesList().scrollTop = 120;
      (wrapper.vm as any).valueSearchTerm = "value-2";
      await nextTick();
      vi.advanceTimersByTime(300);
      await wrapper.setProps({ fieldValues: buildFieldValues(2) });
      valuesList().scrollTop = 0;
      (wrapper.vm as any).valueSearchTerm = "";
      await nextTick();
      await wrapper.setProps({ fieldValues: buildFieldValues(30) });
      await nextTick();
      expect(valuesList().scrollTop).toBe(120);
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
    it("puts the selection back to the query's values", async () => {
      wrapper = createWrapper({ showMultiSelect: true, fieldValues: buildFieldValues(2) });
      await checkbox("value-1").trigger("click");
      expect((wrapper.vm as any).selectedValues).toEqual(["value-1"]);
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
        expect.arrayContaining([expect.objectContaining({ key: "new-val" })]),
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

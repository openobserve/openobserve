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

import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import { describe, expect, it, vi, afterEach } from "vitest";
import LabelFilterBar from "./LabelFilterBar.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import type { LabelFilter } from "@/composables/metrics/useMetricsExplorerGrid";

const createWrapper = (props: Record<string, any> = {}) =>
  mount(LabelFilterBar, {
    props: {
      filters: [] as LabelFilter[],
      labelNames: ["job", "instance", "code"],
      labelNamesLoading: false,
      schemaLoading: false,
      loadValues: vi.fn().mockResolvedValue(["api", "web"]),
      ...props,
    },
    global: {
      plugins: [i18n, store],
    },
    attachTo: document.body,
  });

/** Clicks "+ Filter", which drops straight into the label step. */
const openPicker = async (wrapper: VueWrapper<any>) => {
  await wrapper
    .find('[data-test="metrics-explorer-label-add"]')
    .trigger("click");
  await flushPromises();
};

/** The whole add flow: pick a label, then a value. No confirm step. */
const pickFilter = async (
  wrapper: VueWrapper<any>,
  label: string,
  value: string,
  operator?: string,
) => {
  await openPicker(wrapper);
  await wrapper.vm.onLabelPicked(label);
  await flushPromises();
  if (operator) wrapper.vm.draftOperator = operator;
  await wrapper.vm.onValuePicked(value);
  await flushPromises();
};

describe("LabelFilterBar", () => {
  let wrapper: VueWrapper<any>;

  afterEach(() => {
    wrapper?.unmount();
  });

  describe("chips", () => {
    it("renders a chip per active filter", () => {
      wrapper = createWrapper({
        filters: [
          { label: "job", value: "api", operator: "=" },
          { label: "code", value: "500", operator: "=" },
        ],
      });

      expect(
        wrapper.find('[data-test="metrics-explorer-label-chip-job"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="metrics-explorer-label-chip-code"]').exists(),
      ).toBe(true);
    });

    it("renders the chip as `label = value`", () => {
      wrapper = createWrapper({
        filters: [{ label: "job", value: "api", operator: "=" }],
      });

      const chip = wrapper.find(
        '[data-test="metrics-explorer-label-chip-job"]',
      );
      expect(chip.text().replace(/\s+/g, " ")).toContain("job = api");
    });

    it("defaults the operator to = when the filter omits it", () => {
      wrapper = createWrapper({
        filters: [{ label: "job", value: "api" } as LabelFilter],
      });

      const chip = wrapper.find(
        '[data-test="metrics-explorer-label-chip-job"]',
      );
      expect(chip.text().replace(/\s+/g, " ")).toContain("job = api");
    });

    it("emits remove with the WHOLE matcher, not just the label", async () => {
      // A label can carry several matchers, so the label alone does not identify
      // a chip — removing by label would take out every filter on that label.
      const filter = { label: "job", value: "api", operator: "=" };
      wrapper = createWrapper({ filters: [filter] });

      await wrapper
        .find('[data-test="metrics-explorer-label-chip-remove-job"]')
        .trigger("click");

      expect(wrapper.emitted("remove")).toBeTruthy();
      expect(wrapper.emitted("remove")![0]).toEqual([filter]);
    });

    it("renders several matchers on the SAME label as separate chips", async () => {
      // `status=~"5.."` AND `status!="503"` is the point of having four
      // operators. Keying the v-for on the label collapsed the two onto one key.
      const filters: LabelFilter[] = [
        { label: "status", value: "5..", operator: "=~" },
        { label: "status", value: "503", operator: "!=" },
      ];
      wrapper = createWrapper({ filters });

      const text = wrapper
        .find('[data-test="metrics-explorer-label-filter-bar"]')
        .text()
        .replace(/\s+/g, " ");
      expect(text).toContain("status =~ 5..");
      expect(text).toContain("status != 503");

      // ...and removing one names WHICH one.
      await wrapper
        .findAll('[data-test="metrics-explorer-label-chip-remove-status"]')[1]
        .trigger("click");
      expect(wrapper.emitted("remove")![0]).toEqual([filters[1]]);
    });

    it("renders no chips when there are no filters", () => {
      wrapper = createWrapper({ filters: [] });
      expect(
        wrapper.findAll('[data-test^="metrics-explorer-label-chip-"]'),
      ).toHaveLength(0);
    });
  });

  describe("schema loading indicator", () => {
    it("shows the indicator while membership is resolving", () => {
      wrapper = createWrapper({ schemaLoading: true });
      expect(
        wrapper
          .find('[data-test="metrics-explorer-label-schema-loading"]')
          .exists(),
      ).toBe(true);
    });

    it("hides the indicator when membership is resolved", () => {
      wrapper = createWrapper({ schemaLoading: false });
      expect(
        wrapper
          .find('[data-test="metrics-explorer-label-schema-loading"]')
          .exists(),
      ).toBe(false);
    });
  });

  describe("picker", () => {
    it("emits focus-picker the first time the + Filter button is clicked", async () => {
      wrapper = createWrapper();
      await openPicker(wrapper);
      expect(wrapper.emitted("focus-picker")).toHaveLength(1);
    });

    it("re-emits focus-picker on EVERY open, so a cleared list can reload", async () => {
      // The names are window-scoped: a range change drops them. A one-shot
      // emit (what this used to assert) left the picker saying "No options
      // found" for the rest of the page. The parent's loader dedupes, so
      // re-emitting costs nothing when the names are already there.
      wrapper = createWrapper();
      await openPicker(wrapper);
      await wrapper.vm.cancel();
      await openPicker(wrapper);
      expect(wrapper.emitted("focus-picker")).toHaveLength(2);
    });

    it("goes straight to the label step — no intermediate panel", async () => {
      wrapper = createWrapper();
      expect(
        wrapper
          .find('[data-test="metrics-explorer-label-picker-label"]')
          .exists(),
      ).toBe(false);

      await openPicker(wrapper);

      expect(
        wrapper
          .find('[data-test="metrics-explorer-label-picker-label"]')
          .exists(),
      ).toBe(true);
      // The + Filter button is replaced by the step, not stacked under a popup.
      expect(
        wrapper.find('[data-test="metrics-explorer-label-add"]').exists(),
      ).toBe(false);
    });

    it("auto-advances from label to value", async () => {
      // Picking a label is not a filter on its own, so making the user click
      // onward would be asking for a decision they already made.
      wrapper = createWrapper();
      await openPicker(wrapper);
      await wrapper.vm.onLabelPicked("job");
      await flushPromises();

      expect(
        wrapper
          .find('[data-test="metrics-explorer-label-picker-value"]')
          .exists(),
      ).toBe(true);
    });

    it("returns to the + Filter button after a filter is added", async () => {
      wrapper = createWrapper();
      await pickFilter(wrapper, "job", "api");

      expect(
        wrapper.find('[data-test="metrics-explorer-label-add"]').exists(),
      ).toBe(true);
      expect(
        wrapper
          .find('[data-test="metrics-explorer-label-picker-value"]')
          .exists(),
      ).toBe(false);
    });
  });

  describe("value suggestions", () => {
    it("calls loadValues with the picked label", async () => {
      const loadValues = vi.fn().mockResolvedValue(["api", "web"]);
      wrapper = createWrapper({ loadValues });

      await openPicker(wrapper);
      await wrapper.vm.onLabelPicked("job");
      await flushPromises();

      expect(loadValues).toHaveBeenCalledWith("job");
    });

    it("does not show the unavailable hint when suggestions load", async () => {
      wrapper = createWrapper({
        loadValues: vi.fn().mockResolvedValue(["api", "web"]),
      });

      await openPicker(wrapper);
      await wrapper.vm.onLabelPicked("job");
      await flushPromises();

      expect(
        wrapper
          .find('[data-test="metrics-explorer-label-picker-no-suggestions"]')
          .exists(),
      ).toBe(false);
    });

    it("shows the unavailable hint when loadValues resolves empty", async () => {
      wrapper = createWrapper({ loadValues: vi.fn().mockResolvedValue([]) });

      await openPicker(wrapper);
      await wrapper.vm.onLabelPicked("job");
      await flushPromises();

      expect(
        wrapper
          .find('[data-test="metrics-explorer-label-picker-no-suggestions"]')
          .text(),
      ).toContain("No suggestions");
    });

    it("shows the unavailable hint when loadValues rejects", async () => {
      wrapper = createWrapper({
        loadValues: vi.fn().mockRejectedValue(new Error("boom")),
      });

      await openPicker(wrapper);
      await wrapper.vm.onLabelPicked("job");
      await flushPromises();

      expect(
        wrapper
          .find('[data-test="metrics-explorer-label-picker-no-suggestions"]')
          .exists(),
      ).toBe(true);
    });
  });

  describe("operators", () => {
    it("defaults to =", async () => {
      wrapper = createWrapper();
      await pickFilter(wrapper, "job", "api");

      expect(wrapper.emitted("add")![0]).toEqual([
        { label: "job", value: "api", operator: "=" },
      ]);
    });

    it.each(["!=", "=~", "!~"])("carries the %s matcher", async (operator) => {
      // All four are valid PromQL matchers and buildSelector accepts them, so a
      // regex filter must reach the query untouched.
      wrapper = createWrapper();
      await pickFilter(wrapper, "pod", "web-.*", operator);

      expect(wrapper.emitted("add")![0]).toEqual([
        { label: "pod", value: "web-.*", operator },
      ]);
    });

    it("resets the operator to = for the next filter", async () => {
      wrapper = createWrapper();
      await pickFilter(wrapper, "pod", "web-.*", "=~");
      await pickFilter(wrapper, "job", "api");

      expect(wrapper.emitted("add")![1]).toEqual([
        { label: "job", value: "api", operator: "=" },
      ]);
    });
  });

  describe("adding a filter", () => {
    it("commits on value selection — there is no Add button", async () => {
      wrapper = createWrapper();
      await pickFilter(wrapper, "job", "api");

      expect(wrapper.emitted("add")).toBeTruthy();
      expect(
        wrapper
          .find('[data-test="metrics-explorer-label-picker-apply"]')
          .exists(),
      ).toBe(false);
    });

    // The hard requirement: suggestions are best-effort, the filter is not.
    it("still adds a free-text value when loadValues REJECTS", async () => {
      wrapper = createWrapper({
        loadValues: vi.fn().mockRejectedValue(new Error("network down")),
      });

      await openPicker(wrapper);
      await wrapper.vm.onLabelPicked("job");
      await flushPromises();
      await wrapper.vm.onValueCreated("typed-by-hand");
      await flushPromises();

      expect(wrapper.emitted("add")![0]).toEqual([
        { label: "job", value: "typed-by-hand", operator: "=" },
      ]);
    });

    it("still adds a free-text value when loadValues resolves empty", async () => {
      wrapper = createWrapper({ loadValues: vi.fn().mockResolvedValue([]) });

      await openPicker(wrapper);
      await wrapper.vm.onLabelPicked("instance");
      await flushPromises();
      await wrapper.vm.onValueCreated("10.0.0.1:9100");
      await flushPromises();

      expect(wrapper.emitted("add")![0]).toEqual([
        { label: "instance", value: "10.0.0.1:9100", operator: "=" },
      ]);
    });

    it("does not emit add for an empty value", async () => {
      wrapper = createWrapper();
      await openPicker(wrapper);
      await wrapper.vm.onLabelPicked("job");
      await flushPromises();
      await wrapper.vm.onValuePicked("");
      await flushPromises();

      expect(wrapper.emitted("add")).toBeFalsy();
    });
  });

  describe("label name validation", () => {
    // The PromQL selector builder throws on these by design — reject in the UI.
    const invalid = ["1job", "job-name", "job name", "job.name", "", "job!"];

    it.each(invalid)("rejects the invalid label name %j", async (name) => {
      wrapper = createWrapper();

      await openPicker(wrapper);
      await wrapper.vm.onLabelPicked(name);
      await flushPromises();
      await wrapper.vm.onValueCreated("api");
      await flushPromises();

      expect(wrapper.emitted("add")).toBeFalsy();
    });

    it("shows an inline error instead of emitting add", async () => {
      wrapper = createWrapper();

      await openPicker(wrapper);
      await wrapper.vm.onLabelPicked("job-name");
      await flushPromises();
      await wrapper.vm.onValueCreated("api");
      await flushPromises();

      expect(wrapper.emitted("add")).toBeFalsy();
      expect(wrapper.find('[role="alert"]').text()).toContain(
        "Invalid label name",
      );
      // We stay on the label step so the user can correct it — an invalid label
      // must never advance to the value step.
      expect(
        wrapper
          .find('[data-test="metrics-explorer-label-picker-label"]')
          .exists(),
      ).toBe(true);
      expect(
        wrapper
          .find('[data-test="metrics-explorer-label-picker-value"]')
          .exists(),
      ).toBe(false);
    });

    const valid = ["job", "_private", "job_name", "Job2", "__name"];

    it.each(valid)("accepts the valid label name %j", async (name) => {
      wrapper = createWrapper();

      await pickFilter(wrapper, name, "api");

      expect(wrapper.emitted("add")![0]).toEqual([
        { label: name, value: "api", operator: "=" },
      ]);
    });
  });

  /**
   * Chips are ANDed — PromQL matchers in one selector always are, and this
   * engine rejects `or` matchers outright. Two adjacent chips read equally like
   * "either of these", and that reading is always wrong, so the row says it.
   */
  describe("the AND between chips is stated, not inferred", () => {
    const ands = (w: VueWrapper<any>) =>
      w.findAll('[data-test="metrics-explorer-label-and"]');

    it("says nothing for a single chip — there is no conjunction yet", () => {
      wrapper = createWrapper({
        filters: [{ label: "pod", operator: "=", value: "api-1" }],
      });
      expect(ands(wrapper)).toHaveLength(0);
    });

    it("separates each pair — N chips get N-1 ANDs", () => {
      wrapper = createWrapper({
        filters: [
          { label: "pod", operator: "=", value: "api-1" },
          { label: "status", operator: "=~", value: "5.." },
          { label: "job", operator: "!=", value: "canary" },
        ],
      });
      expect(ands(wrapper)).toHaveLength(2);
      expect(ands(wrapper)[0].text()).toBe("and");
    });

    it("points at the regex escape hatch for anyone who wanted OR", () => {
      wrapper = createWrapper({
        filters: [
          { label: "pod", operator: "=", value: "api-1" },
          { label: "job", operator: "=", value: "web" },
        ],
      });
      // A user who reads "and" and wanted "or" needs to be told what to do
      // instead — `=~` is the only way to say it.
      expect(ands(wrapper)[0].attributes("title")).toContain("=~");
    });
  });

  /**
   * The empty-row typewriter hint.
   *
   * It sits OUTSIDE the picker's v-if/v-else-if chain. An earlier attempt put it
   * between the `+ Filter` button and the label step, which silently broke the
   * chain and rendered the button and the value picker at once — so the last test
   * here guards the structure, not just the hint.
   */
  describe("the empty filter row types a hint", () => {
    const hint = (w: VueWrapper<any>) =>
      w.find('[data-test="metrics-explorer-label-hint"]');

    it("shows on an idle, unfiltered row", () => {
      wrapper = createWrapper({ filters: [] });
      expect(hint(wrapper).exists()).toBe(true);
    });

    it("is decorative — never announced, never clickable", () => {
      wrapper = createWrapper({ filters: [] });
      // It duplicates what `+ Filter` already says, and swallowing a click on the
      // row's dead space would be worse than useless.
      expect(hint(wrapper).attributes("aria-hidden")).toBe("true");
      expect(hint(wrapper).classes()).toContain("pointer-events-none");
    });

    it("yields its width rather than pushing + Filter along the row", () => {
      wrapper = createWrapper({ filters: [] });
      const classes = hint(wrapper).classes();

      // The shared typewriter rule is `nowrap` + `ellipsis`, which only clips
      // once something BOUNDS the width. Without these the hint took its full
      // intrinsic width and shoved the button — the hint must always be what
      // gives, never the control.
      expect(classes).toContain("min-w-0");
      expect(classes).toContain("overflow-hidden");
    });

    it("yields the row once a filter exists — the chips are what the row is for", () => {
      wrapper = createWrapper({
        filters: [{ label: "pod", operator: "=", value: "api-1" }],
      });
      expect(hint(wrapper).exists()).toBe(false);
    });

    it("gets out of the way while the picker is open", async () => {
      wrapper = createWrapper({ filters: [] });
      await wrapper
        .find('[data-test="metrics-explorer-label-add"]')
        .trigger("click");
      await flushPromises();

      expect(hint(wrapper).exists()).toBe(false);
    });

    it("does not break the picker's v-if chain (+ Filter and the picker are exclusive)", async () => {
      wrapper = createWrapper({ filters: [] });
      // Both visible at once is the signature of a broken chain — it is exactly
      // what happened when this hint was first placed inside it.
      await wrapper
        .find('[data-test="metrics-explorer-label-add"]')
        .trigger("click");
      await flushPromises();

      expect(
        wrapper.find('[data-test="metrics-explorer-label-add"]').exists(),
      ).toBe(false);
      expect(
        wrapper.find('[data-test="metrics-explorer-label-picker-label"]').exists(),
      ).toBe(true);
    });
  });
});

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

import { describe, expect, it, beforeEach, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import PatternDetailsDialog from "./PatternDetailsDialog.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { PATTERN_VOLUME_CACHE } from "./usePatternVolume";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import enUS from "@/locales/languages/en-US.json";
import analytics from "@/services/product_analytics";

vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));

// Stub ODrawer so its slots render inline (no portal) and we can drive its
// emits directly. Mirrors the same shape used by other migrated specs.
const ODrawerStub = {
  name: "ODrawer",
  props: ["open", "width", "showClose", "persistent", "size", "title", "subtitle"],
  emits: ["update:open", "click:primary", "click:secondary", "click:extra"],
  template: `
    <div data-test-stub="o-drawer" :data-open="open">
      <div data-test-stub="o-drawer-title">{{ title }}</div>
      <div data-test-stub="o-drawer-subtitle">{{ subtitle }}</div>
      <template v-if="open">
        <div data-test-stub="o-drawer-header"><slot name="header" /></div>
        <div data-test-stub="o-drawer-body"><slot /></div>
        <div data-test-stub="o-drawer-footer"><slot name="footer" /></div>
      </template>
    </div>
  `,
};

// Stub OButton so we can read the disabled prop directly (the underlying
// reka-ui button does not always project a DOM `disabled` attribute), and
// click events still fire the bound @click handler.
const TooltipStub = { template: "<div><slot /></div>" };

const ContentTooltipStub = {
  name: "OTooltip",
  props: ["content", "disabled"],
  template:
    '<div data-test-stub="o-tooltip" :data-disabled="String(!!disabled)" :data-content="content"><slot /></div>',
};

const OButtonStub = {
  name: "OButton",
  props: ["variant", "size", "disabled", "loading"],
  emits: ["click"],
  inheritAttrs: false,
  template: `
    <button
      data-test-stub="o-button"
      :data-test="$attrs['data-test']"
      :disabled="disabled || null"
      @click="$emit('click', $event)"
    ><slot name="icon" /><slot /><slot name="icon-end" /></button>
  `,
};

const OTableStub = {
  name: "OTable",
  props: ["data", "columns", "rowKey", "pagination", "showGlobalFilter"],
  template: `
    <table data-test-stub="o-table">
      <thead>
        <tr>
          <th v-for="col in (columns || [])" :key="col.id">{{ col.header }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, i) in (data || [])" :key="i">
          <td><slot name="cell-name" :row="row" /></td>
          <td><slot name="cell-type" :row="row" /></td>
        </tr>
      </tbody>
    </table>
  `,
};

// Stub WildcardValuePopover — the real reka-ui Popover copies the trigger's
// class tokens via classList.add(), which throws InvalidCharacterError on
// Tailwind arbitrary-value classes (e.g. "text-[0.8125rem]") under jsdom.
// The stub keeps the component name so findComponent / $emit assertions work.
const WildcardValuePopoverStub = {
  name: "WildcardValuePopover",
  emits: ["filter-value"],
  template: '<span data-test-stub="wildcard-value-popover"><slot /></span>',
};

/** Volume the rows would already have cached for the pattern under test. */
const CACHED_VOLUME_TOTAL = 78_000;

const volumeCacheStub = {
  request: () => Promise.resolve(),
  get: () => ({
    buckets: [CACHED_VOLUME_TOTAL],
    total: CACHED_VOLUME_TOTAL,
    intervalSecs: 1680,
    loading: false,
  }),
};

const globalConfig = {
  plugins: [i18n],
  provide: { store, [PATTERN_VOLUME_CACHE as symbol]: volumeCacheStub },
  stubs: {
    ODrawer: ODrawerStub,
    OButton: OButtonStub,
    OTable: OTableStub,
    WildcardValuePopover: WildcardValuePopoverStub,
  },
};

describe("PatternDetailsDialog", () => {
  let wrapper: any;
  const mockSelectedPattern = {
    pattern: {
      pattern_id: "pattern-1",
      template: "User * logged in from IP *",
      description: "User login pattern",
      frequency: 1234,
      percentage: 45.67,
      is_anomaly: false,
      variables: [
        { index: 0, name: "username", var_type: "string" },
        { index: 1, name: "ip_address", var_type: "ip" },
      ],
      examples: [
        {
          log_message: "User john logged in from IP 192.168.1.1",
          variables: { username: "john", ip_address: "192.168.1.1" },
        },
        {
          log_message: "User jane logged in from IP 10.0.0.1",
          variables: { username: "jane", ip_address: "10.0.0.1" },
        },
      ],
    },
    index: 0,
  };

  const totalPatterns = 10;

  beforeEach(() => {
    wrapper = mount(PatternDetailsDialog, {
      props: {
        modelValue: true,
        selectedPattern: mockSelectedPattern,
        totalPatterns: totalPatterns,
      },
      global: globalConfig,
    });
  });

  it("should mount PatternDetailsDialog component", () => {
    expect(wrapper.exists()).toBe(true);
  });

  describe("Panel actions (moved from each row)", () => {
    it("renders include, exclude, and create-alert buttons", () => {
      expect(wrapper.find('[data-test="pattern-detail-include-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="pattern-detail-exclude-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="pattern-detail-create-alert-btn"]').exists()).toBe(true);
    });

    it("emits add-to-search 'include' and closes the drawer on include click", async () => {
      await wrapper.find('[data-test="pattern-detail-include-btn"]').trigger("click");
      expect(wrapper.emitted("add-to-search")![0]).toEqual([
        mockSelectedPattern.pattern,
        "include",
      ]);
      expect(wrapper.emitted("update:modelValue")![0]).toEqual([false]);
    });

    it("shows a dash with the reason for Occurrences when the volume has no distinct filter", () => {
      const w = mount(PatternDetailsDialog, {
        props: { modelValue: true, selectedPattern: mockSelectedPattern, totalPatterns },
        global: {
          ...globalConfig,
          provide: {
            store,
            [PATTERN_VOLUME_CACHE as symbol]: {
              request: () => Promise.resolve(),
              get: () => ({
                buckets: null,
                total: null,
                intervalSecs: null,
                loading: false,
                unavailableReason: "none",
              }),
            },
          },
        },
      });
      const occurrences = w.find('[data-test="pattern-detail-occurrences"]');
      expect(occurrences.text()).toBe("—");
      expect(occurrences.attributes("title")).toBe(enUS.logs.patternList.noMatchTerms);
      w.unmount();
    });

    describe("include/exclude availability", () => {
      const mountWith = (filterBlockedReason?: "none" | "shared" | null) =>
        mount(PatternDetailsDialog, {
          props: {
            modelValue: true,
            selectedPattern: mockSelectedPattern,
            totalPatterns,
            ...(filterBlockedReason === undefined ? {} : { filterBlockedReason }),
          },
          global: {
            ...globalConfig,
            stubs: { ...globalConfig.stubs, OButton, OTooltip: ContentTooltipStub },
          },
        });
      const IDS = ["include", "exclude", "create-alert"] as const;
      const btn = (w: any, id: string) => w.find(`[data-test="pattern-detail-${id}-btn"]`);
      const reasonOf = (w: any, id: string) =>
        w.find(`#${btn(w, id).attributes("aria-describedby")}`).text();
      const tooltipOf = (w: any, id: string) =>
        btn(w, id).find('[data-test-stub="o-tooltip"]').attributes("data-content");

      it("leaves all three buttons available when nothing is blocked", () => {
        const w = mountWith();
        for (const id of IDS) {
          expect(btn(w, id).attributes("aria-disabled")).toBeUndefined();
          expect(btn(w, id).attributes("aria-describedby")).toBeUndefined();
          expect(btn(w, id).find('[data-test-stub="o-tooltip"]').exists()).toBe(false);
        }
        w.unmount();
      });

      it.each([
        ["shared", enUS.logs.patternList.noDistinctTextTooltip],
        ["none", enUS.logs.patternList.noMatchTerms],
      ] as const)(
        "keeps all three buttons focusable, unavailable and described by the %s reason",
        (reason, text) => {
          const w = mountWith(reason);
          for (const id of IDS) {
            expect(btn(w, id).attributes("aria-disabled")).toBe("true");
            expect(btn(w, id).attributes("disabled")).toBeUndefined();
            expect(reasonOf(w, id)).toBe(text);
            expect(tooltipOf(w, id)).toBe(text);
          }
          w.unmount();
        },
      );

      it("emits nothing from any blocked button", async () => {
        const w = mountWith("shared");
        for (const id of IDS) await btn(w, id).trigger("click");
        expect(w.emitted("add-to-search")).toBeUndefined();
        expect(w.emitted("create-alert")).toBeUndefined();
        expect(w.emitted("update:modelValue")).toBeUndefined();
        w.unmount();
      });

      it("emits create-alert when the filter is not blocked", async () => {
        const w = mountWith(null);
        await btn(w, "create-alert").trigger("click");
        expect(w.emitted("create-alert")).toHaveLength(1);
        w.unmount();
      });
    });

    it("emits add-to-search 'exclude' on exclude click", async () => {
      await wrapper.find('[data-test="pattern-detail-exclude-btn"]').trigger("click");
      expect(wrapper.emitted("add-to-search")![0]).toEqual([
        mockSelectedPattern.pattern,
        "exclude",
      ]);
    });

    it("emits create-alert and closes the drawer on create-alert click", async () => {
      await wrapper.find('[data-test="pattern-detail-create-alert-btn"]').trigger("click");
      expect(wrapper.emitted("create-alert")![0]).toEqual([mockSelectedPattern.pattern]);
      expect(wrapper.emitted("update:modelValue")![0]).toEqual([false]);
      expect(analytics.track).toHaveBeenCalledWith("log_patterns_alert_started");
    });

    it("disables create-alert with a lock and emits nothing when the license locks alerts", async () => {
      store.state.zoConfig = { ...store.state.zoConfig, features: { alerts: "locked" } };
      try {
        const locked = mount(PatternDetailsDialog, {
          props: { modelValue: true, selectedPattern: mockSelectedPattern, totalPatterns },
          global: { ...globalConfig, stubs: { ...globalConfig.stubs, OTooltip: TooltipStub } },
        });
        const btn = locked.find('[data-test="pattern-detail-create-alert-btn"]');
        const btnComponent = locked
          .findAllComponents(OButtonStub)
          .find((c: any) => c.attributes("data-test") === "pattern-detail-create-alert-btn");
        expect(btnComponent?.props("disabled")).toBeDefined();
        expect(locked.find('[data-test="pattern-detail-create-alert-lock"]').exists()).toBe(true);
        await btn.trigger("click");
        expect(locked.emitted("create-alert")).toBeUndefined();
        locked.unmount();
      } finally {
        store.state.zoConfig = { ...store.state.zoConfig, features: {} };
      }
    });
  });

  describe("ODrawer wrapper", () => {
    it("should render the ODrawer wrapper", () => {
      expect(wrapper.find('[data-test-stub="o-drawer"]').exists()).toBe(true);
    });

    it("should pass open=true to ODrawer when modelValue is true", () => {
      const drawer = wrapper.findComponent({ name: "ODrawer" });
      expect(drawer.props("open")).toBe(true);
    });

    it("should pass the fixed xl size to ODrawer", () => {
      const drawer = wrapper.findComponent({ name: "ODrawer" });
      expect(drawer.props("size")).toBe("xl");
    });

    it("should pass the localized title to ODrawer", () => {
      const drawer = wrapper.findComponent({ name: "ODrawer" });
      expect(drawer.props("title")).toBe("Pattern details");
    });

    it("should pass the localized subTitle to ODrawer", () => {
      const drawer = wrapper.findComponent({ name: "ODrawer" });
      expect(drawer.props("subtitle")).toBe("Pattern 1 of 10");
    });

    it("should pass undefined subTitle when selectedPattern is null", () => {
      // Drawer is mounted closed so the footer slot (which dereferences
      // selectedPattern.index) is not evaluated.
      const w = mount(PatternDetailsDialog, {
        props: {
          modelValue: false,
          selectedPattern: null,
          totalPatterns: 10,
        },
        global: globalConfig,
      });
      const drawer = w.findComponent({ name: "ODrawer" });
      expect(drawer.props("subtitle")).toBeUndefined();
    });

    it("shows the pattern position once with the real drawer", async () => {
      const real = mount(PatternDetailsDialog, {
        props: {
          modelValue: true,
          selectedPattern: { ...mockSelectedPattern, index: 1 },
          totalPatterns: 17,
        },
        global: { ...globalConfig, stubs: { ...globalConfig.stubs, ODrawer: false } },
        attachTo: document.body,
      });
      await flushPromises();
      expect(document.body.innerHTML.match(/2 of 17/g)).toHaveLength(1);
      real.unmount();
    });

    it("should emit update:modelValue when ODrawer emits update:open", async () => {
      const drawer = wrapper.findComponent({ name: "ODrawer" });
      await drawer.vm.$emit("update:open", false);
      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")![0]).toEqual([false]);
    });
  });

  describe("Header (title / subtitle)", () => {
    it("should display the drawer title in the rendered header stub", () => {
      const title = wrapper.find('[data-test-stub="o-drawer-title"]');
      expect(title.text()).toBe("Pattern details");
    });

    it("should display pattern count in the subtitle stub", () => {
      const subtitle = wrapper.find('[data-test-stub="o-drawer-subtitle"]');
      expect(subtitle.text()).toBe("Pattern 1 of 10");
    });
  });

  describe("Statistics Section", () => {
    // The panel must show the pattern's real window-wide volume straight away.
    // It used to render `pattern.frequency` (the extraction sample — a few
    // hundred) while its own query ran, so the number visibly jumped.
    it("shows the cached window volume, never the extraction sample", () => {
      const text = wrapper.text();
      expect(text).toContain("Occurrences");
      expect(text).toContain("~78K");
      expect(text).not.toContain("1,234");
    });

    it("should display percentage with 2 decimal places", () => {
      const text = wrapper.text();
      expect(text).toContain("Percentage");
      expect(text).toContain("45.67%");
    });

    it("should display anomaly banner when pattern is anomaly", async () => {
      await wrapper.setProps({
        selectedPattern: {
          ...mockSelectedPattern,
          pattern: { ...mockSelectedPattern.pattern, is_anomaly: true },
        },
      });

      const text = wrapper.text();
      expect(text).toContain("This pattern is detected as a rare pattern");
    });

    it("should not display anomaly banner when pattern is not anomaly", () => {
      const text = wrapper.text();
      expect(text).not.toContain("This pattern is detected as a rare pattern");
    });
  });

  describe("Variables Summary Section", () => {
    it("should display variables summary", () => {
      const text = wrapper.text();
      expect(text).toContain("Variables");
      expect(text).toContain("2 variables detected");
    });

    it("should display fallback text when no variables are available", async () => {
      await wrapper.setProps({
        selectedPattern: {
          ...mockSelectedPattern,
          pattern: { ...mockSelectedPattern.pattern, examples: [{ variables: {} }] },
        },
      });

      const text = wrapper.text();
      expect(text).toContain("0 variables detected");
    });
  });

  describe("Template Section", () => {
    it("should display pattern template", () => {
      const text = wrapper.text();
      expect(text).toContain("Pattern template");
      expect(text).toContain("User * logged in from IP *");
    });
  });

  describe("Variables Section", () => {
    it("should display variables table when variables exist", () => {
      const table = wrapper.findComponent({ name: "OTable" });
      expect(table.exists()).toBe(true);
    });

    it("should display variables count in header", () => {
      const text = wrapper.text();
      expect(text).toContain("Variables (2)");
    });

    it("should display variable names in table", () => {
      const text = wrapper.text();
      expect(text).toContain("username");
      expect(text).toContain("ip_address");
    });

    it("should display variable types in table", () => {
      const text = wrapper.text();
      expect(text).toContain("string");
      expect(text).toContain("ip");
    });

    it("should not display variables table when no variables", async () => {
      await wrapper.setProps({
        selectedPattern: {
          ...mockSelectedPattern,
          pattern: { ...mockSelectedPattern.pattern, variables: [] },
        },
      });

      const table = wrapper.findComponent({ name: "OTable" });
      expect(table.exists()).toBe(false);
    });
  });

  describe("Examples Section", () => {
    it("should display examples section header with count", () => {
      const text = wrapper.text();
      expect(text).toContain("Example logs (2)");
    });

    it("should display all example log messages", () => {
      const text = wrapper.text();
      expect(text).toContain("User john logged in from IP 192.168.1.1");
      expect(text).toContain("User jane logged in from IP 10.0.0.1");
    });

    it("should not display examples section when no examples", async () => {
      await wrapper.setProps({
        selectedPattern: {
          ...mockSelectedPattern,
          pattern: { ...mockSelectedPattern.pattern, examples: [] },
        },
      });

      const text = wrapper.text();
      expect(text).not.toContain("Example logs");
    });
  });

  describe("Navigation Buttons (footer slot)", () => {
    it("should render the footer slot content", () => {
      const footer = wrapper.find('[data-test-stub="o-drawer-footer"]');
      expect(footer.exists()).toBe(true);
      expect(footer.find('[data-test="pattern-detail-previous-btn"]').exists()).toBe(true);
      expect(footer.find('[data-test="pattern-detail-next-btn"]').exists()).toBe(true);
    });

    it("should display previous button", () => {
      const prevBtn = wrapper.find('[data-test="pattern-detail-previous-btn"]');
      expect(prevBtn.exists()).toBe(true);
    });

    it("should display next button", () => {
      const nextBtn = wrapper.find('[data-test="pattern-detail-next-btn"]');
      expect(nextBtn.exists()).toBe(true);
    });

    it("should disable previous button on first pattern", () => {
      const prevBtn = wrapper.find('[data-test="pattern-detail-previous-btn"]');
      expect(prevBtn.attributes("disabled")).toBeDefined();
    });

    it("should enable previous button when not on first pattern", async () => {
      await wrapper.setProps({
        selectedPattern: { ...mockSelectedPattern, index: 5 },
      });

      const prevBtn = wrapper.find('[data-test="pattern-detail-previous-btn"]');
      expect(prevBtn.attributes("disabled")).toBeUndefined();
    });

    it("should disable next button on last pattern", async () => {
      await wrapper.setProps({
        selectedPattern: { ...mockSelectedPattern, index: 9 },
        totalPatterns: 10,
      });

      const nextBtn = wrapper.find('[data-test="pattern-detail-next-btn"]');
      expect(nextBtn.attributes("disabled")).toBeDefined();
    });

    it("should emit navigate event with (false, true) when previous button clicked", async () => {
      await wrapper.setProps({
        selectedPattern: { ...mockSelectedPattern, index: 5 },
      });

      const prevBtn = wrapper.find('[data-test="pattern-detail-previous-btn"]');
      await prevBtn.trigger("click");

      expect(wrapper.emitted("navigate")).toBeTruthy();
      expect(wrapper.emitted("navigate")![0]).toEqual([false, true]);
    });

    it("should emit navigate event with (true, false) when next button clicked", async () => {
      const nextBtn = wrapper.find('[data-test="pattern-detail-next-btn"]');
      await nextBtn.trigger("click");

      expect(wrapper.emitted("navigate")).toBeTruthy();
      expect(wrapper.emitted("navigate")![0]).toEqual([true, false]);
    });

    it("should display current position in footer", () => {
      const footer = wrapper.find('[data-test-stub="o-drawer-footer"]');
      expect(footer.text()).toMatch(/1\s+of\s+10/);
    });
  });

  describe("Dialog Visibility", () => {
    it("should receive correct modelValue prop", () => {
      expect(wrapper.props("modelValue")).toBe(true);
    });

    it("should render the drawer body content when selectedPattern exists", () => {
      const body = wrapper.find('[data-test-stub="o-drawer-body"]');
      expect(body.exists()).toBe(true);
      expect(body.text()).toContain("Pattern template");
    });

    it("should not render selected-pattern content when modelValue=false and selectedPattern is null", () => {
      const wrapperWithoutPattern = mount(PatternDetailsDialog, {
        props: {
          modelValue: false,
          selectedPattern: null,
          totalPatterns: 10,
        },
        global: globalConfig,
      });

      // When the drawer is closed, no body / footer slot is mounted, so no
      // pattern content should be visible.
      expect(wrapperWithoutPattern.find('[data-test-stub="o-drawer-body"]').exists()).toBe(false);
      expect(wrapperWithoutPattern.find('[data-test-stub="o-drawer-footer"]').exists()).toBe(false);
      expect(wrapperWithoutPattern.text()).not.toContain("Pattern template");
      expect(wrapperWithoutPattern.text()).not.toContain("Occurrences");
    });
  });

  // --- New tests covering functionality not previously tested ---

  describe("variableColumns definition", () => {
    it("should render Variable Name column header in variables table", () => {
      const text = wrapper.text();
      expect(text).toContain("Variable name");
    });

    it("should render Type column header in variables table", () => {
      const text = wrapper.text();
      expect(text).toContain("Type");
    });

    it("should display var_type chips for each variable row", () => {
      const text = wrapper.text();
      expect(text).toContain("string");
      expect(text).toContain("ip");
    });

    it("should fall back to var_ prefix name when variable name is absent", async () => {
      await wrapper.setProps({
        selectedPattern: {
          ...mockSelectedPattern,
          pattern: {
            ...mockSelectedPattern.pattern,
            variables: [{ index: 3, name: "", var_type: "numeric" }],
          },
        },
      });
      const text = wrapper.text();
      expect(text).toContain("var_3");
    });
  });

  describe("No variables detected fallback", () => {
    it("should display 'No variables detected' when examples array is absent", async () => {
      await wrapper.setProps({
        selectedPattern: {
          ...mockSelectedPattern,
          pattern: {
            ...mockSelectedPattern.pattern,
            examples: undefined,
          },
        },
      });
      const text = wrapper.text();
      expect(text).toContain("No variables detected");
    });

    it("should display 'No variables detected' when first example has no variables property", async () => {
      await wrapper.setProps({
        selectedPattern: {
          ...mockSelectedPattern,
          pattern: {
            ...mockSelectedPattern.pattern,
            examples: [{ log_message: "bare log" }],
          },
        },
      });
      const text = wrapper.text();
      expect(text).toContain("No variables detected");
    });
  });

  describe("update:modelValue emit", () => {
    it("should forward modelValue=false through to ODrawer's open prop", () => {
      const wrapperClosed = mount(PatternDetailsDialog, {
        props: {
          modelValue: false,
          selectedPattern: mockSelectedPattern,
          totalPatterns: 10,
        },
        global: globalConfig,
      });
      expect(wrapperClosed.props("modelValue")).toBe(false);
      const drawer = wrapperClosed.findComponent({ name: "ODrawer" });
      expect(drawer.props("open")).toBe(false);
      // No body content rendered while closed.
      expect(wrapperClosed.find('[data-test-stub="o-drawer-body"]').exists()).toBe(false);
    });
  });

  describe("LogsHighLighting in example logs", () => {
    it("should render example log entries in the examples section", () => {
      const text = wrapper.text();
      expect(text).toContain("User john logged in from IP 192.168.1.1");
    });

    it("should render all example log entries when multiple examples exist", () => {
      const text = wrapper.text();
      expect(text).toContain("User jane logged in from IP 10.0.0.1");
    });
  });

  describe("Pattern index edge cases", () => {
    it("should show 'Pattern 6 of 10' in the drawer subtitle when index is 5", async () => {
      await wrapper.setProps({
        selectedPattern: { ...mockSelectedPattern, index: 5 },
      });
      const drawer = wrapper.findComponent({ name: "ODrawer" });
      expect(drawer.props("subtitle")).toBe("Pattern 6 of 10");
    });

    it("should show '6 of 10' counter in footer when index is 5", async () => {
      await wrapper.setProps({
        selectedPattern: { ...mockSelectedPattern, index: 5 },
      });
      const footer = wrapper.find('[data-test-stub="o-drawer-footer"]');
      expect(footer.text()).toMatch(/6\s+of\s+10/);
    });

    it("should enable next button when not on last pattern", async () => {
      await wrapper.setProps({
        selectedPattern: { ...mockSelectedPattern, index: 3 },
        totalPatterns: 10,
      });
      const nextBtn = wrapper.find('[data-test="pattern-detail-next-btn"]');
      expect(nextBtn.attributes("disabled")).toBeUndefined();
    });
  });

  describe("WildcardValuePopover integration", () => {
    it("should render WildcardValuePopover component", () => {
      const popover = wrapper.findComponent({ name: "WildcardValuePopover" });
      expect(popover.exists()).toBe(true);
    });

    it("should forward filter-value event from WildcardValuePopover", async () => {
      const popover = wrapper.findComponent({ name: "WildcardValuePopover" });
      expect(popover.exists()).toBe(true);
      await popover.vm.$emit("filter-value", "192.168.1.1", "include");
      expect(wrapper.emitted("filter-value")).toBeTruthy();
      expect(wrapper.emitted("filter-value")![0]).toEqual(["192.168.1.1", "include"]);
    });
  });
});

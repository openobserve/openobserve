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
import { nextTick } from "vue";
import { mount } from "@vue/test-utils";
import PanelErrorButtons from "./PanelErrorButtons.vue";
import { createStore } from "vuex";
import i18n from "@/locales";

// Create a mock Vuex store with timezone state
const mockStore = createStore({
  state: {
    timezone: "UTC",
  },
  mutations: {},
  actions: {},
});

describe("PanelErrorButtons", () => {
  // Helper function to mount component with store
  const mountComponent = (options = {}) => {
    return mount(PanelErrorButtons, {
      global: {
        plugins: [i18n],
        provide: {
          store: mockStore,
        },
      },
      ...options,
    });
  };

  it("should render the component", () => {
    const wrapper = mountComponent();
    expect(wrapper.exists()).toBe(true);
  });

  it("should display error button when error prop is provided", () => {
    const wrapper = mountComponent({
      props: {
        error: "Sample error message",
      },
    });

    const errorButton = wrapper.find('[data-test="panel-error-data"]');
    expect(errorButton.exists()).toBe(true);
  });

  it("should not display error button when no error prop is provided", () => {
    const wrapper = mountComponent({
      props: {
        error: "",
      },
    });

    const errorButton = wrapper.find('[data-test="panel-error-data"]');
    expect(errorButton.exists()).toBe(false);
  });

  it("should display max query range warning button when provided", () => {
    const wrapper = mountComponent({
      props: {
        maxQueryRangeWarning: "Query range exceeds maximum",
      },
    });

    const warningButton = wrapper.find('[data-test="panel-max-duration-warning"]');
    expect(warningButton.exists()).toBe(true);
  });

  it("should display limit number of series warning button when provided", () => {
    const wrapper = mountComponent({
      props: {
        limitNumberOfSeriesWarningMessage: "Too many series",
      },
    });

    const warningButton = wrapper.find('[data-test="panel-limit-number-of-series-warning"]');
    expect(warningButton.exists()).toBe(true);
  });

  it("should display cached data warning button when flag is true", () => {
    const wrapper = mountComponent({
      props: {
        isCachedDataDifferWithCurrentTimeRange: true,
      },
    });

    const warningButton = wrapper.find(
      '[data-test="panel-is-cached-data-differ-with-current-time-range-warning"]',
    );
    expect(warningButton.exists()).toBe(true);
  });

  it("should display partial data warning when isPartialData is true and not loading", () => {
    const wrapper = mountComponent({
      props: {
        isPartialData: true,
        isPanelLoading: false,
      },
    });

    const warningButton = wrapper.find('[data-test="panel-partial-data-warning"]');
    expect(warningButton.exists()).toBe(true);
  });

  it("should not display partial data warning when isPanelLoading is true", () => {
    const wrapper = mountComponent({
      props: {
        isPartialData: true,
        isPanelLoading: true,
      },
    });

    const warningButton = wrapper.find('[data-test="panel-partial-data-warning"]');
    expect(warningButton.exists()).toBe(false);
  });

  it("should display last refreshed time when provided and not in viewOnly mode", () => {
    const wrapper = mountComponent({
      props: {
        lastTriggeredAt: Date.now(),
        viewOnly: false,
      },
    });

    const lastRefreshed = wrapper.find('[data-test="panel-last-refreshed-at"]');
    expect(lastRefreshed.exists()).toBe(true);
  });

  it("should not display last refreshed time in viewOnly mode", () => {
    const wrapper = mountComponent({
      props: {
        lastTriggeredAt: Date.now(),
        viewOnly: true,
      },
    });

    const lastRefreshed = wrapper.find('[data-test="panel-last-refreshed-at"]');
    expect(lastRefreshed.exists()).toBe(false);
  });

  it("should not display last refreshed time in simplifiedPanelView mode", () => {
    const wrapper = mountComponent({
      props: {
        lastTriggeredAt: Date.now(),
        simplifiedPanelView: true,
      },
    });

    const lastRefreshed = wrapper.find('[data-test="panel-last-refreshed-at"]');
    expect(lastRefreshed.exists()).toBe(false);
  });

  it("should not display anything when no props are provided", () => {
    const wrapper = mountComponent();

    expect(wrapper.find('[data-test="panel-error-data"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="panel-max-duration-warning"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="panel-partial-data-warning"]').exists()).toBe(false);
  });

  it("should display multiple warnings simultaneously", () => {
    const wrapper = mountComponent({
      props: {
        error: "Error message",
        maxQueryRangeWarning: "Range warning",
        isPartialData: true,
        isPanelLoading: false,
      },
    });

    expect(wrapper.find('[data-test="panel-error-data"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="panel-max-duration-warning"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="panel-partial-data-warning"]').exists()).toBe(true);
  });

  it("should accept null lastTriggeredAt", () => {
    const wrapper = mountComponent({
      props: {
        lastTriggeredAt: null,
      },
    });

    const lastRefreshed = wrapper.find('[data-test="panel-last-refreshed-at"]');
    expect(lastRefreshed.exists()).toBe(false);
  });

  it("should accept string timestamp for lastTriggeredAt", () => {
    const wrapper = mountComponent({
      props: {
        lastTriggeredAt: "2024-01-01T00:00:00Z",
        viewOnly: false,
      },
    });

    const lastRefreshed = wrapper.find('[data-test="panel-last-refreshed-at"]');
    expect(lastRefreshed.exists()).toBe(true);
  });

  it("should accept number timestamp for lastTriggeredAt", () => {
    const wrapper = mountComponent({
      props: {
        lastTriggeredAt: 1704067200000,
        viewOnly: false,
      },
    });

    const lastRefreshed = wrapper.find('[data-test="panel-last-refreshed-at"]');
    expect(lastRefreshed.exists()).toBe(true);
  });

  /**
   * viewOnly gates ONLY the last-refreshed chip, so a read-only embedding (the
   * curated host drawer) still surfaces every warning. Gating a warning on it
   * would silence exactly the surfaces that cannot open a panel editor to find out.
   */
  describe("a viewOnly embedding still surfaces every warning", () => {
    it("renders the range and partial-data warnings under viewOnly", () => {
      const wrapper = mountComponent({
        props: {
          maxQueryRangeWarning: "range shortened",
          isPartialData: true,
          isPanelLoading: false,
          viewOnly: true,
        },
      });

      expect(wrapper.find('[data-test="panel-max-duration-warning"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="panel-partial-data-warning"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="panel-last-refreshed-at"]').exists()).toBe(false);
    });

    // isPartialData means the LOAD was cut short (cancelled or unmounted mid-flight),
    // never that the returned rows fail to cover the window — so it stays hidden
    // while loading and says nothing about a host that started reporting late.
    it("hides the partial-data warning while the panel is still loading", () => {
      const wrapper = mountComponent({
        props: { isPartialData: true, isPanelLoading: true, viewOnly: true },
      });

      expect(wrapper.find('[data-test="panel-partial-data-warning"]').exists()).toBe(false);
    });
  });

  describe("exemplar error", () => {
    const tooltipStub = {
      OTooltip: {
        props: ["content"],
        template: "<div><slot name='content' />{{ content }}</div>",
      },
    };

    it("shows the warning with the server message and emits retry", async () => {
      const wrapper = mount(PanelErrorButtons, {
        props: { exemplarError: "scan exploded" },
        global: { plugins: [i18n], provide: { store: mockStore }, stubs: tooltipStub },
      });
      expect(wrapper.find('[data-test="dashboard-panel-exemplars-error"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-panel-exemplars-error-message"]').text()).toBe(
        "scan exploded",
      );
      await wrapper.find('[data-test="dashboard-panel-exemplars-retry"]').trigger("click");
      expect(wrapper.emitted("retry-exemplars")).toHaveLength(1);
    });

    it("renders nothing for exemplars without an error", () => {
      const wrapper = mount(PanelErrorButtons, {
        global: { plugins: [i18n], provide: { store: mockStore } },
      });
      expect(wrapper.find('[data-test="dashboard-panel-exemplars-error"]').exists()).toBe(false);
    });
  });

  describe("notice chips", () => {
    const mountAttached = (props: Record<string, unknown>) =>
      mount(PanelErrorButtons, {
        props,
        attachTo: document.body,
        global: { plugins: [i18n], provide: { store: mockStore } },
      });

    // Focus opens a reka tooltip at once, which is also the keyboard path to its content.
    const openTooltip = async (chip: Element) => {
      chip.dispatchEvent(new FocusEvent("focus"));
      await new Promise((r) => setTimeout(r, 20));
      await nextTick();
    };

    const bubble = () => document.body.querySelector('[data-test="o-tooltip-content"]');
    const inBubble = (testId: string) =>
      bubble()?.querySelector(`[data-test="${testId}"]`) as HTMLElement | null;

    afterEach(() => {
      document.body.innerHTML = "";
    });

    it("labels the series cap with the real counts and keeps the legacy test id", () => {
      const wrapper = mountAttached({
        limitNumberOfSeriesWarningMessage: "Showing 100 of 342 series to keep the chart fast",
        seriesLimit: { shown: 100, total: 342, cap: 100 },
      });
      const chip = wrapper.find('[data-test="panel-notice-chip-series-cap"]');
      expect(chip.exists()).toBe(true);
      expect(chip.element.tagName).toBe("BUTTON");
      expect(chip.text()).toBe("100/342 series");
      expect(wrapper.find('[data-test="panel-limit-number-of-series-warning"]').exists()).toBe(
        true,
      );
      wrapper.unmount();
    });

    it("shows a chart's own display cap as written, without the Top N action", async () => {
      const wrapper = mountAttached({
        seriesLimit: {
          shown: 500,
          total: 812,
          cap: 500,
          displayCapMessage: "Showing 500 of 812 rows.",
        },
        canEdit: true,
      });
      const chip = wrapper.find('[data-test="panel-notice-chip-series-cap"]');
      expect(chip.text()).toBe("Display limited");
      await openTooltip(chip.element);
      expect(bubble()?.textContent).toContain("Showing 500 of 812 rows.");
      expect(inBubble("panel-notice-action-use-top-n")).toBeNull();
      wrapper.unmount();
    });

    it("shows a capped total as a lower bound with thousands separators", async () => {
      const wrapper = mountAttached({
        seriesLimit: { shown: 100, total: 1000, cap: 100 },
        limitNumberOfSeriesWarningMessage: "x",
        serverPartial: true,
        rowsCapped: true,
      });
      const chip = wrapper.find('[data-test="panel-notice-chip-series-cap"]');
      expect(chip.text()).toBe("100/1,000+ series");
      await openTooltip(chip.element);
      expect(bubble()?.textContent).toContain(
        "Showing 100 of at least 1,000 series. Results were capped at the row limit.",
      );
      wrapper.unmount();
    });

    it("calls a partial total a lower bound too, with its own reason", async () => {
      const wrapper = mountAttached({
        seriesLimit: { shown: 100, total: 1500, cap: 100 },
        limitNumberOfSeriesWarningMessage: "x",
        serverPartial: true,
      });
      const chip = wrapper.find('[data-test="panel-notice-chip-series-cap"]');
      expect(chip.text()).toBe("100/1,500+ series");
      await openTooltip(chip.element);
      expect(bubble()?.textContent).toContain(
        "Showing 100 of at least 1,500 series. The server returned partial results.",
      );
      wrapper.unmount();
    });

    it("gives each notice in the collapsed tooltip its own actions", async () => {
      const wrapper = mountAttached({
        functionErrors: ["parse_json failed"],
        seriesLimit: { shown: 100, total: 342, cap: 100 },
        limitNumberOfSeriesWarningMessage: "x",
        serverPartial: true,
        canEdit: true,
        canRefresh: true,
        canInspect: true,
      });
      await openTooltip(wrapper.find('[data-test="panel-notice-chip-collapsed"]').element);
      const block = (id: string) => inBubble(`panel-notice-content-${id}`) as HTMLElement;
      expect(
        block("function-error").querySelector('[data-test="panel-notice-action-edit-function"]'),
      ).not.toBeNull();
      expect(
        block("function-error").querySelector('[data-test="panel-notice-action-copy-error"]'),
      ).not.toBeNull();
      expect(
        block("series-cap").querySelector('[data-test="panel-notice-action-use-top-n"]'),
      ).not.toBeNull();
      (
        block("partial").querySelector('[data-test="panel-notice-action-refresh"]') as HTMLElement
      ).click();
      await nextTick();
      expect(wrapper.emitted("refresh-panel")).toHaveLength(1);
      expect(
        bubble()?.querySelectorAll('[data-test="panel-notice-action-open-inspector"]'),
      ).toHaveLength(1);
      wrapper.unmount();
    });

    it("keeps Refresh but drops editor actions in the collapsed tooltip for viewers", async () => {
      const wrapper = mountAttached({
        seriesLimit: { shown: 100, total: 342, cap: 100 },
        limitNumberOfSeriesWarningMessage: "x",
        serverPartial: true,
        canEdit: false,
        canRefresh: true,
      });
      await openTooltip(wrapper.find('[data-test="panel-notice-chip-collapsed"]').element);
      expect(inBubble("panel-notice-action-use-top-n")).toBeNull();
      expect(inBubble("panel-notice-action-refresh")).not.toBeNull();
      wrapper.unmount();
    });

    it("falls back to a generic label when only the message is known", () => {
      const wrapper = mountAttached({ limitNumberOfSeriesWarningMessage: "Too many series" });
      expect(wrapper.find('[data-test="panel-notice-chip-series-cap"]').text()).toBe(
        "Series limited",
      );
      wrapper.unmount();
    });

    it("shows server partial and client interruption as separate chips", () => {
      const wrapper = mountAttached({
        serverPartial: true,
        isPartialData: true,
        isPanelLoading: false,
      });
      expect(wrapper.find('[data-test="panel-notice-chip-partial"]').text()).toBe("Partial");
      expect(wrapper.find('[data-test="panel-notice-chip-interrupted"]').text()).toBe(
        "Interrupted",
      );
      expect(wrapper.find('[data-test="panel-partial-data-warning"]').exists()).toBe(true);
      wrapper.unmount();
    });

    it("puts the function error first, in the error tone", () => {
      const wrapper = mountAttached({
        functionErrors: ["parse_json failed"],
        serverPartial: true,
      });
      const chips = wrapper.findAll('[data-test^="panel-notice-chip-"]');
      expect(chips[0].attributes("data-test")).toBe("panel-notice-chip-function-error");
      expect(chips[0].classes().join(" ")).toContain("badge-error-soft");
      wrapper.unmount();
    });

    it("opens a tooltip with the explanation and the editor actions for editors", async () => {
      const wrapper = mountAttached({
        seriesLimit: { shown: 100, total: 342, cap: 100 },
        limitNumberOfSeriesWarningMessage: "x",
        canEdit: true,
        canInspect: true,
      });
      await openTooltip(wrapper.find('[data-test="panel-notice-chip-series-cap"]').element);

      expect(bubble()?.textContent).toContain("Series limit reached");
      expect(bubble()?.textContent).toContain("Showing 100 of 342 series");
      inBubble("panel-notice-action-use-top-n")?.click();
      inBubble("panel-notice-action-open-inspector")?.click();
      await nextTick();

      expect(wrapper.emitted("edit-panel")).toEqual([["use-top-n"]]);
      expect(wrapper.emitted("open-inspector")).toHaveLength(1);
      wrapper.unmount();
    });

    it("hides editor actions from viewers but keeps Copy error", async () => {
      const wrapper = mountAttached({
        functionErrors: ["parse_json failed"],
        canEdit: true,
        viewOnly: true,
      });
      await openTooltip(wrapper.find('[data-test="panel-notice-chip-function-error"]').element);

      expect(inBubble("panel-notice-action-edit-function")).toBeNull();
      expect(inBubble("panel-notice-action-open-inspector")).toBeNull();
      expect(inBubble("panel-notice-action-copy-error")).not.toBeNull();
      expect(inBubble("panel-notice-detail-function-error")?.textContent).toContain(
        "parse_json failed",
      );
      wrapper.unmount();
    });

    it("emits refresh from a partial notice when the host can refresh", async () => {
      const wrapper = mountAttached({ serverPartial: true, canRefresh: true });
      await openTooltip(wrapper.find('[data-test="panel-notice-chip-partial"]').element);
      inBubble("panel-notice-action-refresh")?.click();
      await nextTick();
      expect(wrapper.emitted("refresh-panel")).toHaveLength(1);
      wrapper.unmount();
    });

    it("opens the inspector when a chip is clicked, only if the host allows it", async () => {
      const allowed = mountAttached({ serverPartial: true, canInspect: true });
      await allowed.find('[data-test="panel-notice-chip-partial"]').trigger("click");
      expect(allowed.emitted("open-inspector")).toHaveLength(1);
      allowed.unmount();

      const denied = mountAttached({ serverPartial: true });
      await denied.find('[data-test="panel-notice-chip-partial"]').trigger("click");
      expect(denied.emitted("open-inspector")).toBeUndefined();
      denied.unmount();
    });

    it("folds several chips into one N issues chip on a narrow panel bar", async () => {
      const wrapper = mountAttached({
        functionErrors: ["parse_json failed"],
        serverPartial: true,
        canInspect: true,
      });
      const collapsed = wrapper.find('[data-test="panel-notice-chip-collapsed"]');
      expect(collapsed.find('[data-test="panel-notice-chip-collapsed-label"]').text()).toBe(
        "2 issues",
      );
      expect(collapsed.attributes("aria-label")).toBe("2 issues");
      const count = collapsed.find('[data-test="panel-notice-chip-collapsed-count"]');
      expect(count.text()).toBe("2");
      expect(count.classes()).toContain("@max-[22rem]/panelbar:inline");
      expect(collapsed.find('[data-test="panel-notice-chip-collapsed-label"]').classes()).toContain(
        "@max-[22rem]/panelbar:hidden",
      );
      expect(collapsed.element.parentElement?.className).toContain(
        "@max-[36rem]/panelbar:inline-flex",
      );
      expect(
        wrapper.find('[data-test="panel-notice-chip-partial"]').element.parentElement?.className,
      ).toContain("@max-[36rem]/panelbar:hidden");

      await openTooltip(collapsed.element);
      expect(bubble()?.textContent).toContain("2 issues on this panel");
      expect(inBubble("panel-notice-content-function-error")).not.toBeNull();
      expect(inBubble("panel-notice-content-partial")).not.toBeNull();
      wrapper.unmount();
    });

    it("drops the last-refreshed time on a narrow bar before any notice chip", () => {
      const wrapper = mountAttached({ serverPartial: true, lastTriggeredAt: Date.now() });
      expect(wrapper.find('[data-test="panel-last-refreshed-at"]').classes()).toContain(
        "@max-[28rem]/panelbar:hidden",
      );
      wrapper.unmount();
    });

    it("closes the tooltip as soon as one of its actions is clicked", async () => {
      const wrapper = mountAttached({
        seriesLimit: { shown: 100, total: 342, cap: 100 },
        limitNumberOfSeriesWarningMessage: "x",
        canEdit: true,
        canInspect: true,
      });
      const chip = wrapper.find('[data-test="panel-notice-chip-series-cap"]').element;

      await openTooltip(chip);
      expect(bubble()).not.toBeNull();
      inBubble("panel-notice-action-use-top-n")?.click();
      await nextTick();
      await new Promise((r) => setTimeout(r, 20));
      expect(bubble()).toBeNull();

      await openTooltip(chip);
      expect(bubble()).not.toBeNull();
      inBubble("panel-notice-action-open-inspector")?.click();
      await nextTick();
      await new Promise((r) => setTimeout(r, 20));
      expect(bubble()).toBeNull();
      expect(wrapper.emitted("open-inspector")).toHaveLength(1);
      wrapper.unmount();
    });

    it("closes the tooltip on Copy error and on actions inside the collapsed tooltip", async () => {
      const wrapper = mountAttached({
        functionErrors: ["parse_json failed"],
        serverPartial: true,
        canRefresh: true,
      });
      await openTooltip(wrapper.find('[data-test="panel-notice-chip-function-error"]').element);
      expect(bubble()).not.toBeNull();
      inBubble("panel-notice-action-copy-error")?.click();
      await nextTick();
      await new Promise((r) => setTimeout(r, 20));
      expect(bubble()).toBeNull();

      await openTooltip(wrapper.find('[data-test="panel-notice-chip-collapsed"]').element);
      expect(bubble()).not.toBeNull();
      inBubble("panel-notice-action-refresh")?.click();
      await nextTick();
      await new Promise((r) => setTimeout(r, 20));
      expect(bubble()).toBeNull();
      expect(wrapper.emitted("refresh-panel")).toHaveLength(1);
      wrapper.unmount();
    });

    it("uses a lower fold point for a single chip", () => {
      const wrapper = mountAttached({ serverPartial: true });
      expect(
        wrapper.find('[data-test="panel-notice-chip-partial"]').element.parentElement?.className,
      ).toContain("@max-[32rem]/panelbar:hidden");
      expect(
        wrapper.find('[data-test="panel-notice-chip-collapsed"]').attributes("aria-label"),
      ).toBe("1 issue");
      wrapper.unmount();
    });
  });
});

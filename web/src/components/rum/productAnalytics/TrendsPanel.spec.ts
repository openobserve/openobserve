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

import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, KeepAlive, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createStore } from "vuex";
import TrendsPanel from "./TrendsPanel.vue";
import type { AnalyticsScope } from "@/utils/rum/productAnalyticsQueries";

const DAY_US = 86400000000;
const scope: AnalyticsScope = { app: "web", env: [], version: [], schema: { usr_email: true } };
const store = createStore({
  state: { selectedOrganization: { identifier: "org1" }, theme: "light", timezone: "UTC" },
});

type Schema = { queries: { query: string; fields: { y: { alias: string; label: string }[] } }[] };

const RendererStub = {
  name: "PanelSchemaRenderer",
  props: [
    "panelSchema",
    "selectedTimeObj",
    "searchType",
    "variablesData",
    "allowAnnotationsAPI",
    "forceLoad",
  ],
  template: "<div data-test='renderer-stub' />",
};

const mountPanel = (props: Record<string, unknown>) =>
  mount(TrendsPanel, {
    props: {
      scope,
      identity: { field: "usr_email", excluded: [] },
      series: [],
      events: [],
      range: { startUs: 0, endUs: 7 * DAY_US },
      eventsStatus: "ready",
      ...props,
    },
    global: {
      plugins: [store],
      stubs: {
        PanelSchemaRenderer: RendererStub,
        AddToDashboard: {
          name: "AddToDashboard",
          props: ["open", "panels", "dashboardPanelData", "notice"],
          template: "<div data-test='add-to-dashboard-stub' />",
        },
      },
    },
  });

const renderer = (w: ReturnType<typeof mountPanel>) => w.findComponent(RendererStub);

describe("TrendsPanel (AC-48)", () => {
  it("charts sessions per day over the analytics range through RUM search", () => {
    const w = mountPanel({});
    const r = renderer(w);
    const schema = r.props("panelSchema") as Schema;
    // No timezone is baked into histogram() (o2-enterprise#2808): a tz-aware
    // histogram() bucket comes back as local wall-clock time stamped as if
    // it were UTC, and the shared chart renderer always shifts a
    // histogram() x-axis once more for display — baking one in here would
    // apply the viewer's offset twice.
    expect(schema.queries[0].query).toContain("histogram(_timestamp, '1 day') AS x_axis_1");
    expect(schema.queries[0].fields.y[0].alias).toBe("y_axis_1");
    expect(r.props("searchType")).toBe("RUM");
    expect(r.props("allowAnnotationsAPI")).toBe(false);
    // The shape usePanelDataLoader reads: flat Dates whose getTime() is in microseconds.
    const time = r.props("selectedTimeObj") as { start_time: Date; end_time: Date };
    expect(time.start_time.getTime()).toBe(0);
    expect(time.end_time.getTime()).toBe(7 * DAY_US);
    expect(r.props("forceLoad")).toBe(true);
    expect(w.find('[data-test="rum-analytics-trends"]').text()).toContain("per day");
  });

  it("switches to weekly buckets beyond 31 days", () => {
    const w = mountPanel({ range: { startUs: 0, endUs: 40 * DAY_US } });
    expect((renderer(w).props("panelSchema") as Schema).queries[0].query).toContain("'1 week'");
  });

  it("offers Users only with an identity, and plots y_axis_2 for it", async () => {
    const w = mountPanel({});
    await w.find('[data-test="rum-analytics-trends-metric-users"]').trigger("click");
    await flushPromises();
    expect((renderer(w).props("panelSchema") as Schema).queries[0].fields.y[0].alias).toBe(
      "y_axis_2",
    );
    const anon = mountPanel({ identity: null });
    expect(anon.find('[data-test="rum-analytics-trends-metric-users"]').exists()).toBe(false);
  });

  it("falls back to Sessions when the identity goes away, so the toggle keeps a selection (W34)", async () => {
    const w = mountPanel({});
    await w.find('[data-test="rum-analytics-trends-metric-users"]').trigger("click");
    await flushPromises();
    await w.setProps({ identity: null });
    await flushPromises();
    expect(w.findComponent({ name: "OToggleGroup" }).props("modelValue")).toBe("sessions");
    await w.setProps({ identity: { field: "usr_email", excluded: [] } });
    await flushPromises();
    expect(w.findComponent({ name: "OToggleGroup" }).props("modelValue")).toBe("sessions");
  });

  it("names the icon-only Add to dashboard button (W20)", () => {
    const w = mountPanel({});
    expect(
      w.find('[data-test="rum-analytics-trends-add-dashboard-btn"]').attributes("aria-label"),
    ).toBe("Add to dashboard");
  });

  it("replaces the chart with one series per selected key, each removable as a chip", async () => {
    const series = [
      { kind: "p", key: "/web" },
      { kind: "c", key: "save" },
    ];
    const w = mountPanel({ series });
    const schema = renderer(w).props("panelSchema") as Schema;
    expect(schema.queries[0].fields.y.map((y) => y.label)).toEqual(["/web", "save"]);
    expect(w.find('[data-test="rum-analytics-trends-series-1"]').text()).toContain("save");
    await w.find('[data-test="rum-analytics-trends-series-0"] button').trigger("click");
    expect(w.emitted("update:series")?.[0]).toEqual([[{ kind: "c", key: "save" }]]);
    await w.find('[data-test="rum-analytics-trends-clear-btn"]').trigger("click");
    expect(w.emitted("update:series")?.[1]).toEqual([[]]);
  });

  const EVENT_SERIES = [
    { kind: "p", key: "/web" },
    { kind: "e", key: "evt000000001" },
  ];
  it("a named-event series is not charted while the events are loading, and its chip never shows the raw id (F38)", () => {
    const w = mountPanel({ series: EVENT_SERIES, eventsStatus: "loading" });
    expect(renderer(w).exists()).toBe(false);
    expect(w.find('[data-test="rum-analytics-trends-loading"]').exists()).toBe(true);
    expect(
      w.find('[data-test="rum-analytics-trends-add-dashboard-btn"]').attributes("disabled"),
    ).toBeDefined();
    expect(w.find('[data-test="rum-analytics-trends-series-1"]').text()).toContain(
      "Named event (not loaded)",
    );
    expect(w.text()).not.toContain("evt000000001");
  });

  it.each([
    ["failed", "rum-analytics-trends-events-unavailable"],
    ["forbidden", "rum-analytics-trends-events-forbidden"],
  ])(
    "while the events are %s only the named-event series is held and the page series still charts (F36)",
    (eventsStatus, shown) => {
      const w = mountPanel({ series: EVENT_SERIES, eventsStatus });
      expect(renderer(w).exists()).toBe(true);
      const schema = renderer(w).props("panelSchema") as Schema;
      expect(schema.queries[0].fields.y.map((y) => y.label)).toEqual(["/web"]);
      expect(schema.queries[0].query).not.toContain("1 = 0");
      expect(schema.queries[0].query).toContain("y_axis_1");
      expect(schema.queries[0].query).not.toContain("y_axis_2");
      expect(w.find(`[data-test="${shown}"]`).exists()).toBe(true);
      expect(w.text()).toContain("named-event series");
      expect(
        w.find('[data-test="rum-analytics-trends-add-dashboard-btn"]').attributes("disabled"),
      ).toBeDefined();
      expect(w.find('[data-test="rum-analytics-trends-events-retry-btn"]').exists()).toBe(
        eventsStatus === "failed",
      );
      expect(w.find('[data-test="rum-analytics-trends-series-1"]').text()).toContain(
        "Named event (not loaded)",
      );
      expect(w.text()).not.toContain("evt000000001");
    },
  );

  it("with only named-event series under failed events the notice stands alone, with no chart", () => {
    const w = mountPanel({ series: [{ kind: "e", key: "evt000000001" }], eventsStatus: "failed" });
    expect(renderer(w).exists()).toBe(false);
    expect(w.find('[data-test="rum-analytics-trends-events-unavailable"]').exists()).toBe(true);
  });

  it("charts a named-event series once the events are ready, and series without one never wait", async () => {
    const ready = mountPanel({ series: EVENT_SERIES, eventsStatus: "ready" });
    expect(renderer(ready).exists()).toBe(true);
    const plain = mountPanel({ series: [{ kind: "p", key: "/web" }], eventsStatus: "failed" });
    expect(renderer(plain).exists()).toBe(true);
    expect(plain.find('[data-test="rum-analytics-trends-events-unavailable"]').exists()).toBe(
      false,
    );
    const failed = mountPanel({ series: EVENT_SERIES, eventsStatus: "failed" });
    await failed.find('[data-test="rum-analytics-trends-events-retry-btn"]').trigger("click");
    expect(failed.emitted("retry-events")).toHaveLength(1);
  });

  it("adds the chart to a dashboard as a time-relative line panel (AC-53)", async () => {
    const w = mountPanel({});
    await w.find('[data-test="rum-analytics-trends-add-dashboard-btn"]').trigger("click");
    await flushPromises();
    const dialog = w.findComponent({ name: "AddToDashboard" });
    expect(dialog.props("open")).toBe(true);
    const panels = dialog.props("panels") as { type: string; queries: { query: string }[] }[];
    expect(panels).toHaveLength(1);
    expect(panels[0].type).toBe("line");
    expect(panels[0].queries[0].query).not.toMatch(/_timestamp >= \d/);
    expect(dialog.props("notice")).toContain("as they are now");
  });
  it("Add to dashboard does not reopen when the user comes back from the dashboard it opened (AC-53)", async () => {
    const shown = ref(true);
    const w = mount(
      defineComponent({
        setup: () => () =>
          h(
            KeepAlive,
            null,
            shown.value
              ? [
                  h(TrendsPanel, {
                    scope,
                    identity: { field: "usr_email", excluded: [] },
                    series: [],
                    events: [],
                    range: { startUs: 0, endUs: 7 * DAY_US },
                    eventsStatus: "ready",
                  }),
                ]
              : [],
          ),
      }),
      {
        global: {
          plugins: [store],
          stubs: {
            PanelSchemaRenderer: RendererStub,
            AddToDashboard: { name: "AddToDashboard", template: "<div />" },
          },
        },
      },
    );
    await w.find('[data-test="rum-analytics-trends-add-dashboard-btn"]').trigger("click");
    await flushPromises();
    expect(w.findComponent({ name: "AddToDashboard" }).exists()).toBe(true);
    shown.value = false;
    await flushPromises();
    shown.value = true;
    await flushPromises();
    expect(w.findComponent({ name: "AddToDashboard" }).exists()).toBe(false);
  });

  describe("reveal (scope addition 8, U1)", () => {
    const SERIES = [
      { kind: "p", key: "/web" },
      { kind: "c", key: "save" },
    ];
    const setMotion = (reduce: boolean) =>
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: (q: string) => ({ matches: reduce && q.includes("reduce"), media: q }),
      });
    let scroll: ReturnType<typeof vi.fn>;
    const spyScroll = () => {
      scroll = vi.fn();
      Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
        configurable: true,
        value: scroll,
      });
    };

    afterEach(() => {
      vi.useRealTimers();
      delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    });

    it("scrolls the panel into view smoothly, emphasises the new chip briefly and announces it", async () => {
      vi.useFakeTimers();
      setMotion(false);
      spyScroll();
      const w = mountPanel({ series: SERIES });
      (w.vm as unknown as { reveal: (s: { kind: string; key: string }) => void }).reveal(SERIES[1]);
      await flushPromises();
      expect(scroll).toHaveBeenCalledTimes(1);
      expect(scroll.mock.contexts[0]).toBe(w.find('[data-test="rum-analytics-trends"]').element);
      expect(scroll.mock.calls[0][0]).toEqual({ block: "nearest", behavior: "smooth" });
      const chip = w.find('[data-test="rum-analytics-trends-series-1"]');
      expect(chip.attributes("data-new")).toBe("true");
      expect(chip.classes()).toContain("outline-accent");
      expect(w.find('[data-test="rum-analytics-trends-series-0"]').attributes("data-new")).toBe(
        undefined,
      );
      const live = w.find('[data-test="rum-analytics-trends-announce"]');
      expect(live.attributes("aria-live")).toBe("polite");
      expect(live.text()).toBe("save added to the Trends chart");
      vi.advanceTimersByTime(3000);
      await flushPromises();
      expect(
        w.find('[data-test="rum-analytics-trends-series-1"]').attributes("data-new"),
      ).toBeUndefined();
    });

    it("announces a re-added series again, and clears the region when it is removed or the highlight ends (F63)", async () => {
      vi.useFakeTimers();
      setMotion(false);
      spyScroll();
      const w = mountPanel({ series: SERIES });
      const reveal = (s: { kind: string; key: string }) =>
        (w.vm as unknown as { reveal: (s: { kind: string; key: string }) => void }).reveal(s);
      const live = w.find('[data-test="rum-analytics-trends-announce"]').element;
      let mutations = 0;
      new MutationObserver((records) => (mutations += records.length)).observe(live, {
        childList: true,
        characterData: true,
        subtree: true,
      });
      reveal(SERIES[1]);
      await flushPromises();
      expect(live.textContent).toBe("save added to the Trends chart");
      await w.setProps({ series: [SERIES[0]] });
      await flushPromises();
      expect(live.textContent).toBe("");
      await w.setProps({ series: SERIES });
      reveal(SERIES[1]);
      await flushPromises();
      expect(live.textContent).toBe("save added to the Trends chart");
      const before = mutations;
      reveal(SERIES[1]);
      await flushPromises();
      expect(mutations).toBeGreaterThan(before);
      expect(live.textContent).toBe("save added to the Trends chart");
      vi.advanceTimersByTime(3000);
      await flushPromises();
      expect(live.textContent).toBe("");
      reveal(SERIES[0]);
      await flushPromises();
      await w.setProps({ series: [] });
      await flushPromises();
      expect(live.textContent).toBe("");
    });

    it("jumps without animation when the user prefers reduced motion", async () => {
      setMotion(true);
      spyScroll();
      const w = mountPanel({ series: SERIES });
      (w.vm as unknown as { reveal: (s: { kind: string; key: string }) => void }).reveal(SERIES[0]);
      await flushPromises();
      expect(scroll.mock.calls[0][0]).toEqual({ block: "nearest", behavior: "auto" });
    });
  });
});

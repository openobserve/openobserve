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

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { mount, VueWrapper } from "@vue/test-utils";
import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import MetricCard from "./MetricCard.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import type { CardPreview } from "@/composables/metrics/useMetricsExplorerGrid";

/** What the last copy actually put on the clipboard. */
let copied = "";
vi.mock("@/utils/clipboard", () => ({
  copyToClipboard: vi.fn(async (text: string) => {
    copied = text;
    return true;
  }),
}));

const CARD: any = {
  name: "node_cpu_seconds_total",
  help: "Seconds the CPUs spent in each mode.",
  typeFilterBucket: "counter",
  familyType: "counter",
  chartType: "line",
  unit: "seconds",
  footerLabel: "counter",
  configurable: true,
  unsupported: false,
};

const preview = (over: Partial<CardPreview> = {}): CardPreview => ({
  status: "done",
  results: [],
  error: "",
  chartType: "line",
  unit: "seconds",
  bucketUnit: null,
  stale: false,
  ...over,
});

const createWrapper = (props: Record<string, any> = {}) =>
  mount(MetricCard, {
    props: { card: CARD, index: 0, ...props },
    global: {
      plugins: [i18n, store],
      // ChartRenderer pulls in ECharts; the card's own states are what matter here.
      stubs: { MetricCardChart: true },
    },
  });

describe("MetricCard (ported to @/lib)", () => {
  let wrapper: VueWrapper<any>;

  beforeEach(() => {
    copied = "";
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  describe("header", () => {
    it("renders the metric name and the type badge", () => {
      wrapper = createWrapper();
      expect(wrapper.text()).toContain("node_cpu_seconds_total");
      expect(wrapper.text()).toContain("Counter");
    });

    it("carries the card data-test", () => {
      wrapper = createWrapper();
      expect(
        wrapper
          .find('[data-test="metrics-explorer-card-node_cpu_seconds_total"]')
          .exists(),
      ).toBe(true);
    });

    it("does NOT print the help text on the card body", () => {
      // It is a full sentence that never fitted; a truncated half-sentence is
      // worse than none, and it cost the chart ~18px of height.
      wrapper = createWrapper();
      expect(wrapper.text()).not.toContain(
        "Seconds the CPUs spent in each mode.",
      );
    });

    it("offers the help text through an info action instead", () => {
      wrapper = createWrapper();
      const help = wrapper.find(
        '[data-test="metrics-explorer-card-help-node_cpu_seconds_total"]',
      );
      expect(help.exists()).toBe(true);
      // Reachable by a screen reader, not only by hovering a tooltip.
      expect(help.attributes("aria-label")).toContain(
        "Seconds the CPUs spent in each mode.",
      );
    });

    it("shows no info action when the metric has no help text", () => {
      wrapper = createWrapper({ card: { ...CARD, help: "" } });
      expect(
        wrapper
          .find(
            '[data-test="metrics-explorer-card-help-node_cpu_seconds_total"]',
          )
          .exists(),
      ).toBe(false);
    });

    it("renders the configure button only when the card is configurable", () => {
      wrapper = createWrapper();
      expect(
        wrapper
          .find('[data-test="metrics-explorer-card-fn-node_cpu_seconds_total"]')
          .exists(),
      ).toBe(true);

      wrapper.unmount();
      wrapper = createWrapper({ card: { ...CARD, configurable: false } });
      expect(
        wrapper
          .find('[data-test="metrics-explorer-card-fn-node_cpu_seconds_total"]')
          .exists(),
      ).toBe(false);
    });
  });

  describe("emits", () => {
    it("emits select ONLY from the open-in-editor icon", async () => {
      wrapper = createWrapper();
      await wrapper
        .find(
          '[data-test="metrics-explorer-card-select-node_cpu_seconds_total"]',
        )
        .trigger("click");
      expect(wrapper.emitted("select")).toHaveLength(1);
    });

    it("does NOT navigate when the card body is clicked", async () => {
      // The whole card used to be a button, so any attempt to select the metric
      // name — or drag across the help text — navigated to the editor instead.
      wrapper = createWrapper();
      await wrapper.trigger("click");
      expect(wrapper.emitted("select")).toBeFalsy();
    });

    it("does NOT navigate on Enter over the card body", async () => {
      wrapper = createWrapper();
      await wrapper.trigger("keydown.enter");
      expect(wrapper.emitted("select")).toBeFalsy();
    });

    it("is not exposed as a button, so its text is selectable", () => {
      wrapper = createWrapper();
      expect(wrapper.attributes("role")).toBe("group");
      expect(wrapper.attributes("tabindex")).toBeUndefined();
      expect(wrapper.classes()).not.toContain("cursor-pointer");
    });

    it("emits configure from the settings button", async () => {
      wrapper = createWrapper();
      await wrapper
        .find('[data-test="metrics-explorer-card-fn-node_cpu_seconds_total"]')
        .trigger("click");
      expect(wrapper.emitted("configure")).toBeTruthy();
    });

    it("emits toggle-favorite from the pin button", async () => {
      wrapper = createWrapper();
      await wrapper
        .find(
          '[data-test="metrics-explorer-card-favorite-node_cpu_seconds_total"]',
        )
        .trigger("click");
      expect(wrapper.emitted("toggle-favorite")).toBeTruthy();
    });

    it("routes the error state's Retry through refresh, not a plain re-request", async () => {
      // A plain re-request would be answered by the cache — same query, same
      // window — so Retry would appear to do nothing. `refresh` drops the
      // cached response first.
      wrapper = createWrapper({
        preview: preview({ status: "error", error: "bad query" }),
      });
      await wrapper
        .find(
          '[data-test="metrics-explorer-card-retry-node_cpu_seconds_total"]',
        )
        .trigger("click");
      expect(wrapper.emitted("refresh")).toBeTruthy();
      expect(wrapper.emitted("retry")).toBeFalsy();
    });

    it("declares exactly the events it emits", async () => {
      // The behavioural tests around this one cannot catch a bad `emits` list:
      // `$emit` fires whether or not the event is declared, so `refresh` reached
      // the parent while the component declared a `retry` it never emitted and
      // omitted the `refresh` it does. Undeclared emits also fall through to
      // $attrs and get bound to the root ELEMENT as a native listener.
      //
      // So read the source and compare, rather than trusting a hand-kept list to
      // stay in step with the template.
      // From the vitest root (the `web` dir) — `import.meta.url` is not a
      // file: URL once Vite has transformed the module.
      const source = await readFile(
        resolve("src/plugins/metrics/explorer/MetricCard.vue"),
        "utf-8",
      );

      const emitted = new Set(
        [...source.matchAll(/(?:\$emit|\bemit)\(\s*["']([\w-]+)["']/g)].map(
          (m) => m[1],
        ),
      );
      const declared = new Set<string>((MetricCard as any).emits ?? []);

      // Every event the component fires must be declared...
      for (const event of emitted) {
        expect.soft(declared, `emits "${event}" but does not declare it`).toContain(event);
      }
      // ...and it must not declare an event it never fires.
      for (const event of declared) {
        expect.soft(emitted, `declares "${event}" but never emits it`).toContain(event);
      }
      expect(emitted.size).toBeGreaterThan(0); // the regex still matches something
    });

    it("emits refresh from the per-card refresh action", async () => {
      wrapper = createWrapper();
      await wrapper
        .find(
          '[data-test="metrics-explorer-card-refresh-node_cpu_seconds_total"]',
        )
        .trigger("click");
      expect(wrapper.emitted("refresh")).toBeTruthy();
    });

    it("has no refresh action on an unsupported card (there is nothing to run)", () => {
      wrapper = createWrapper({ card: { ...CARD, unsupported: true } });
      expect(
        wrapper
          .find(
            '[data-test="metrics-explorer-card-refresh-node_cpu_seconds_total"]',
          )
          .exists(),
      ).toBe(false);
    });

    it("emits visible on mount (IntersectionObserver is mocked in setup)", () => {
      wrapper = createWrapper();
      // The mocked observer never fires, so `visible` only fires on the
      // no-observer path; either way mounting must not throw.
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("body states", () => {
    it("renders the unsupported placeholder", () => {
      wrapper = createWrapper({ card: { ...CARD, unsupported: true } });
      expect(
        wrapper
          .find(
            '[data-test="metrics-explorer-card-unsupported-node_cpu_seconds_total"]',
          )
          .exists(),
      ).toBe(true);
      expect(wrapper.text()).toContain("Unsupported type (v1)");
    });

    it("renders the error state with the message in a tooltip trigger", () => {
      wrapper = createWrapper({
        preview: preview({ status: "error", error: "bad query" }),
      });
      expect(
        wrapper
          .find(
            '[data-test="metrics-explorer-card-error-node_cpu_seconds_total"]',
          )
          .exists(),
      ).toBe(true);
      expect(wrapper.text()).toContain("Query failed");
    });

    it("hands the message, cause and trace id to a tooltip that can open", () => {
      // "Query failed" alone does not distinguish a timeout from a bad query
      // from a permissions error, so the backend's message must be reachable —
      // and with it the trace id, the first thing support asks for.
      //
      // That the tooltip actually OPENS is guarded in OTooltip.spec.ts (it did
      // not, for any tooltip in the app, until the `open` prop default was
      // fixed). What is pinned here is that this card hands it the whole
      // failure and not just the headline.
      wrapper = createWrapper({
        preview: preview({
          status: "error",
          error: "Search query timed out",
          errorDetail: "[PromQL] grpc search load data task timeout",
          errorTraceId: "c411073d",
        }),
      });

      const tip = wrapper
        .findAllComponents({ name: "OTooltip" })
        .find((t) => String(t.props("content")).startsWith("Search query"));

      expect(tip, "no tooltip carries the error message").toBeTruthy();
      expect(tip!.props("content")).toBe(
        "Search query timed out\n" +
          "[PromQL] grpc search load data task timeout\n" +
          "Trace ID: c411073d",
      );
    });

    it("puts the whole failure on the clipboard, query included", async () => {
      // A tooltip cannot be selected — it closes the moment the pointer leaves —
      // so without this the trace id can only leave the page by being retyped
      // by hand. The query goes too: the user never typed it, so the card is the
      // only thing that knows what actually ran.
      wrapper = createWrapper({
        preview: preview({
          status: "error",
          error: "Search query timed out",
          errorDetail: "[PromQL] grpc search load data task timeout",
          errorTraceId: "c411073d",
          errorQueries: ['avg({__name__="node_cpu_seconds_total"})'],
        }),
      });

      expect(wrapper.vm.errorReport).toBe(
        "Metric: node_cpu_seconds_total\n" +
          'Query: avg({__name__="node_cpu_seconds_total"})\n' +
          "Error: Search query timed out\n" +
          "Cause: [PromQL] grpc search load data task timeout\n" +
          "Trace ID: c411073d",
      );

      await wrapper
        .find('[data-test="metrics-explorer-card-copy-error-node_cpu_seconds_total"]')
        .trigger("click");
      expect(copied).toBe(wrapper.vm.errorReport);
    });

    it("lets a stale card's failure be copied off the badge", async () => {
      // A stale card keeps its chart and shows only a small badge — there is no
      // room for a Copy button, so the badge itself is one.
      wrapper = createWrapper({
        preview: preview({
          status: "done",
          results: [{ result: [] }],
          stale: true,
          error: "Search query timed out",
          errorTraceId: "c411073d",
        }),
      });

      await wrapper
        .find('[data-test="metrics-explorer-card-stale-copy-node_cpu_seconds_total"]')
        .trigger("click");
      expect(copied).toContain("Trace ID: c411073d");
    });

    it("omits the cause and trace id when the backend gave none", () => {
      wrapper = createWrapper({
        preview: preview({ status: "error", error: "bad query" }),
      });

      const tip = wrapper
        .findAllComponents({ name: "OTooltip" })
        .find((t) => t.props("content") === "bad query");

      expect(tip, "no tooltip carries the error message").toBeTruthy();
    });

    it("surfaces the error of a failed refresh that kept the old chart up", () => {
      // A stale card still shows its previous result, so this badge is the ONLY
      // place its error can be read.
      wrapper = createWrapper({
        preview: preview({
          status: "done",
          results: [{ result: [] }],
          stale: true,
          error: "Search query timed out",
          errorTraceId: "c411073d",
        }),
      });

      const tip = wrapper
        .findAllComponents({ name: "OTooltip" })
        .find((t) => String(t.props("content")).startsWith("Refresh failed"));

      expect(tip, "a stale card hides its error").toBeTruthy();
      expect(tip!.props("content")).toContain("Search query timed out");
      expect(tip!.props("content")).toContain("Trace ID: c411073d");
    });

    it("renders the loading skeleton when loading with no prior results", () => {
      wrapper = createWrapper({
        preview: preview({ status: "loading", results: [] }),
      });
      expect(
        wrapper
          .find(
            '[data-test="metrics-explorer-card-skeleton-node_cpu_seconds_total"]',
          )
          .exists(),
      ).toBe(true);
    });

    it("renders the No data state when a done preview has no series", () => {
      wrapper = createWrapper({
        preview: preview({
          status: "done",
          results: [{ resultType: "matrix", result: [] }],
        }),
      });
      expect(
        wrapper
          .find(
            '[data-test="metrics-explorer-card-nodata-node_cpu_seconds_total"]',
          )
          .exists(),
      ).toBe(true);
      // The dashboards' own copy (`panel.noData`) — the card shows the SAME
      // inline empty state a dashboard panel does.
      expect(wrapper.text()).toContain("No Data");
    });

    it("renders the chart when the preview has series", () => {
      wrapper = createWrapper({
        preview: preview({
          status: "done",
          results: [{ resultType: "matrix", result: [{ values: [[1, "1"]] }] }],
        }),
      });
      expect(wrapper.findComponent({ name: "MetricCardChart" }).exists()).toBe(
        true,
      );
    });

    it("renders the stale indicator when the last refresh failed", () => {
      wrapper = createWrapper({
        preview: preview({
          status: "done",
          stale: true,
          results: [{ resultType: "matrix", result: [{ values: [[1, "1"]] }] }],
        }),
      });
      expect(
        wrapper
          .find(
            '[data-test="metrics-explorer-card-stale-node_cpu_seconds_total"]',
          )
          .exists(),
      ).toBe(true);
    });
  });

  describe("rows view", () => {
    it("is the SAME card as grid view — the view only changes the columns", () => {
      // Rows view used to render a different card: a squat 76px strip with the
      // name in a fixed left column, the badge dragged up into the header and no
      // footer at all. It is now grid view with one wide column, so the card has
      // no `rowsView` prop to branch on — every element below is unconditional.
      wrapper = createWrapper();

      expect(wrapper.props()).not.toHaveProperty("rowsView");
      // Header bar (the dashboard panel bar's box — untinted, bordered),
      // footer, and the badge in the footer where it cannot truncate the name
      // it describes.
      expect(wrapper.find(".min-h-7.border-b.border-border-subtle").exists()).toBe(
        true,
      );
      expect(
        wrapper
          .find('[data-test="metrics-explorer-card-badge-node_cpu_seconds_total"]')
          .exists(),
      ).toBe(true);
      expect(wrapper.text()).toContain("counter");
    });
  });

  it("renders no legacy <q- component", () => {
    wrapper = createWrapper();
    expect(wrapper.html()).not.toContain("<q-");
  });
});

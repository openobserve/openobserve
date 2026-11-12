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
import { nextTick } from "vue";
import { mount, VueWrapper } from "@vue/test-utils";
import { describe, expect, it, afterEach, beforeEach, onTestFinished, vi } from "vitest";
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

/** Where Create Alert navigated to. */
const routerPush = vi.hoisted(() => vi.fn());
vi.mock("vue-router", () => ({ useRouter: () => ({ push: routerPush }) }));

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

const HIDING = ["hidden", "invisible", "w-0", "opacity-0", "truncate"];
/** Every class on `el` or its ancestors that would hide or clip it, at rest or on hover / focus. */
const hidingClasses = (el: Element | null, root: Element): string[] => {
  const found: string[] = [];
  for (let node = el; node && node !== root.parentElement; node = node.parentElement)
    for (const cls of node.classList) {
      const base = cls.split(":").pop() ?? "";
      if (HIDING.includes(base) || base.startsWith("max-w-")) found.push(cls);
    }
  return found;
};

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
        wrapper.find('[data-test="metrics-explorer-card-node_cpu_seconds_total"]').exists(),
      ).toBe(true);
    });

    it("does NOT print the help text as a plain label on the card", () => {
      // It is a full sentence that never fitted; a truncated half-sentence is
      // worse than none, and it cost the chart ~18px of height. The detail view
      // carries it instead.
      wrapper = createWrapper();
      expect(wrapper.text()).not.toContain("Seconds the CPUs spent in each mode.");
    });

    it("keeps only the info icon of the old hover icons: the rest live in the detail view", () => {
      // An unlabelled row of seven icons read as noise; one labelled Drill down
      // replaced it.
      wrapper = createWrapper({ exemplarsEligible: true, exemplarsOn: false, preview: preview() });
      expect(
        wrapper.find('[data-test="metrics-explorer-card-help-node_cpu_seconds_total"]').exists(),
      ).toBe(true);
      for (const action of ["fn", "select", "favorite", "refresh", "exemplars"]) {
        expect
          .soft(
            wrapper
              .find(`[data-test="metrics-explorer-card-${action}-node_cpu_seconds_total"]`)
              .exists(),
            action,
          )
          .toBe(false);
      }
    });

    it("offers the help text through an always-visible info icon, announced in full", async () => {
      wrapper = createWrapper();
      const help = wrapper.find('[data-test="metrics-explorer-card-help-node_cpu_seconds_total"]');
      expect(help.element.tagName).toBe("BUTTON");
      expect(help.attributes("aria-label")).toContain("Seconds the CPUs spent in each mode.");
      expect(hidingClasses(help.element, wrapper.element)).toEqual([]);
      await help.trigger("click");
      expect(wrapper.emitted("open-detail")).toBeFalsy();
    });

    it("shows no info icon when the metric has no help text", () => {
      wrapper = createWrapper({ card: { ...CARD, help: "" } });
      expect(
        wrapper.find('[data-test="metrics-explorer-card-help-node_cpu_seconds_total"]').exists(),
      ).toBe(false);
    });
  });

  describe("status: the function, the unit and the freshness", () => {
    const status = (w: VueWrapper<any>) => ({
      info: w.find('[data-test="metrics-explorer-card-rest-info-node_cpu_seconds_total"]'),
      fresh: w.find('[data-test="metrics-explorer-card-data-age-node_cpu_seconds_total"]'),
    });

    it("shows the function · unit and the freshness both at rest and on hover or focus", async () => {
      // Status, not actions: the Drill down button joins them on hover, never replaces them.
      wrapper = createWrapper({
        preview: preview({ footerLabel: "sum(rate)", lastTriggeredAt: Date.now() - 33_000 }),
      });
      await wrapper.vm.$nextTick();
      const { info, fresh } = status(wrapper);
      expect(info.text()).toBe("sum(rate) · s");
      expect(fresh.text()).toMatch(/Updated \d{2}:\d{2}/);
      expect(hidingClasses(info.element, wrapper.element)).toEqual([]);
      // Only the card-width query swaps the words for the clock icon; nothing hides it on hover.
      expect(hidingClasses(fresh.element, wrapper.element)).toEqual(["@max-md/panelbar:hidden"]);
      const icon = wrapper.find(
        '[data-test="metrics-explorer-card-data-age-icon-node_cpu_seconds_total"]',
      );
      expect(hidingClasses(icon.element, wrapper.element)).toEqual(["@md/panelbar:hidden"]);
    });

    it("cuts a long name in the middle, so names that differ only at the end stay apart (CS11)", () => {
      const name = "apiserver_request_duration_seconds_count";
      wrapper = createWrapper({ card: { ...CARD, name } });
      const title = wrapper.find(`[data-test="metrics-explorer-card-title-${name}"]`);
      const head = title.find(`[data-test="metrics-explorer-card-title-head-${name}"]`);
      expect(head.text()).toBe(name.slice(0, -14));
      expect(title.text()).toBe(name);
      expect(title.findAll("span.shrink-0").map((s) => s.text())).toContain("_seconds_count");
      const tip = wrapper
        .findAllComponents({ name: "OTooltip" })
        .find((c) => c.props("content") === name);
      expect(tip).toBeDefined();

      const bucket = "apiserver_request_duration_seconds_bucket";
      wrapper.unmount();
      wrapper = createWrapper({ card: { ...CARD, name: bucket } });
      const tail = wrapper.find(
        `[data-test="metrics-explorer-card-title-${bucket}"] span.shrink-0`,
      );
      expect(tail.text()).toBe("_seconds_bucket");
    });

    describe("the middle cut's ellipsis (K3)", () => {
      const name = "apiserver_admission_webhook_request_total";
      const CHAR_PX = 8;
      const isHead = (el: Element) =>
        el.getAttribute("data-test") === `metrics-explorer-card-title-head-${name}`;
      // jsdom has no layout: the head's text is CHAR_PX a character, its box at most `room` wide.
      const layout = (room: number) => {
        const scroll = Object.getOwnPropertyDescriptor(Element.prototype, "scrollWidth")!;
        const client = Object.getOwnPropertyDescriptor(Element.prototype, "clientWidth")!;
        const width = (el: Element) => (el.textContent ?? "").length * CHAR_PX;
        Object.defineProperty(Element.prototype, "scrollWidth", {
          configurable: true,
          get() {
            return isHead(this) ? width(this) : scroll.get!.call(this);
          },
        });
        Object.defineProperty(Element.prototype, "clientWidth", {
          configurable: true,
          get() {
            return isHead(this) ? Math.min(width(this), room) : client.get!.call(this);
          },
        });
        onTestFinished(() => {
          Object.defineProperty(Element.prototype, "scrollWidth", scroll);
          Object.defineProperty(Element.prototype, "clientWidth", client);
        });
      };
      const title = () => wrapper.find(`[data-test="metrics-explorer-card-title-${name}"]`);
      const tooltip = () =>
        wrapper.findAllComponents({ name: "OTooltip" }).find((c) => c.props("content") === name);

      it.each([200, 203, 207])(
        "sits right against the tail, with no blank between them, in %ipx",
        async (room) => {
          layout(room);
          wrapper = createWrapper({ card: { ...CARD, name } });
          await nextTick();
          const head = title().find(`[data-test="metrics-explorer-card-title-head-${name}"]`);
          expect(head.text()).toBe("apiserver_admission_webh…");
          expect(head.classes()).not.toContain("truncate");
          expect(title().text()).toBe("apiserver_admission_webh…_request_total");
          expect(tooltip()!.props("disabled")).toBe(false);
        },
      );

      it("shows the whole name, with no ellipsis or tooltip, when it fits", async () => {
        layout(400);
        wrapper = createWrapper({ card: { ...CARD, name } });
        await nextTick();
        expect(title().text()).toBe(name);
        expect(tooltip()!.props("disabled")).toBe(true);
      });
    });

    it("keeps a short name whole", () => {
      wrapper = createWrapper({});
      const head = wrapper.find(
        '[data-test="metrics-explorer-card-title-node_cpu_seconds_total"] [data-test="o-truncated-text"]',
      );
      expect(head.text()).toBe("node_cpu_seconds_total");
    });

    it("drops the Drill down words on a narrow card, keeping its icon, name and tooltip (CS11)", () => {
      wrapper = createWrapper({});
      const button = wrapper.find(
        '[data-test="metrics-explorer-card-details-node_cpu_seconds_total"]',
      );
      expect(button.attributes("aria-label")).toBeTruthy();
      const words = button
        .findAll("span")
        .filter((s) => s.text() === "Drill down")
        .at(-1)!;
      expect(words.classes()).toContain("@max-md/panelbar:hidden");
    });

    it("lets the metric name give way, never the function · unit or the freshness", () => {
      wrapper = createWrapper({
        preview: preview({ footerLabel: "sum(rate)", lastTriggeredAt: Date.now() }),
      });
      const { info, fresh } = status(wrapper);
      const cluster = info.element.parentElement!;
      expect(cluster.contains(fresh.element)).toBe(true);
      expect(
        cluster.contains(
          wrapper.find('[data-test="metrics-explorer-card-details-node_cpu_seconds_total"]')
            .element,
        ),
      ).toBe(true);
      expect(cluster.className).toContain("shrink-0");
      expect(info.classes()).toContain("whitespace-nowrap");
      // The name is the row's one shrinkable element.
      const title = wrapper.find(
        '[data-test="metrics-explorer-card-title-node_cpu_seconds_total"]',
      );
      expect(title.classes()).toContain("min-w-0");
      expect(title.element.parentElement!.className).toContain("min-w-0");
      expect(title.find('[data-test="o-truncated-text"]').classes()).toContain("truncate");
      expect(title.find("[title]").exists()).toBe(false);
    });
  });

  describe("emits", () => {
    it("does NOT navigate when the card body is clicked", async () => {
      // The whole card used to be a button, so any attempt to select the metric
      // name — or drag across the help text — navigated to the editor instead.
      wrapper = createWrapper();
      await wrapper.trigger("click");
      expect(wrapper.emitted("open-detail")).toBeFalsy();
    });

    it("does NOT navigate on Enter over the card body", async () => {
      wrapper = createWrapper();
      await wrapper.trigger("keydown.enter");
      expect(wrapper.emitted("open-detail")).toBeFalsy();
    });

    it("is not exposed as a button, so its text is selectable", () => {
      wrapper = createWrapper();
      expect(wrapper.attributes("role")).toBe("group");
      expect(wrapper.attributes("tabindex")).toBeUndefined();
      expect(wrapper.classes()).not.toContain("cursor-pointer");
    });

    it("opens the detail view from one labelled Drill down button", async () => {
      wrapper = createWrapper();
      const drill = wrapper.find(
        '[data-test="metrics-explorer-card-details-node_cpu_seconds_total"]',
      );
      expect(drill.element.tagName).toBe("BUTTON");
      expect(drill.text()).toBe("Drill down");
      expect(drill.find("svg").exists()).toBe(true);
      expect(drill.attributes("aria-label")).toBe("Drill down into node_cpu_seconds_total");
      await drill.trigger("click");
      expect(wrapper.emitted("open-detail")).toEqual([[CARD]]);
    });

    it("opens the detail view from the card title", async () => {
      wrapper = createWrapper();
      await wrapper
        .find('[data-test="metrics-explorer-card-title-node_cpu_seconds_total"]')
        .trigger("click");
      expect(wrapper.emitted("open-detail")).toEqual([[CARD]]);
    });

    it("does NOT open the detail view from the card body", async () => {
      // The chart body owns drag-to-zoom, exemplar markers and right-click Create alert.
      wrapper = createWrapper();
      await wrapper.trigger("click");
      expect(wrapper.emitted("open-detail")).toBeFalsy();
    });

    it("shows Drill down at rest, not only on hover or focus", () => {
      wrapper = createWrapper();
      const drill = wrapper.find(
        '[data-test="metrics-explorer-card-details-node_cpu_seconds_total"]',
      );
      expect(hidingClasses(drill.element, wrapper.element)).toEqual([]);
      expect(wrapper.html()).not.toContain("group-hover:");
      expect(wrapper.html()).not.toContain("group-focus-within:");
    });

    it("shows the effective function, a ⚙ override included, in the header", () => {
      // An override must be visible on the card rather than silently identical
      // to the default, so the preview's label wins over the card's.
      wrapper = createWrapper({ preview: preview({ footerLabel: "sum(rate)" }) });
      const info = wrapper.find(
        '[data-test="metrics-explorer-card-rest-info-node_cpu_seconds_total"]',
      );
      expect(info.text()).toBe("sum(rate) · s");
    });

    it("routes the error state's Retry through refresh, not a plain re-request", async () => {
      // A plain re-request would be answered by the cache — same query, same
      // window — so Retry would appear to do nothing. `refresh` drops the
      // cached response first.
      wrapper = createWrapper({
        preview: preview({ status: "error", error: "bad query" }),
      });
      await wrapper
        .find('[data-test="metrics-explorer-card-retry-node_cpu_seconds_total"]')
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
        [...source.matchAll(/(?:\$emit|\bemit)\(\s*["']([\w-]+)["']/g)].map((m) => m[1]),
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
      wrapper = createWrapper({ preview: preview({ cachedDataDiffersFromTimeRange: true }) });
      await wrapper
        .find('[data-test="metrics-explorer-card-refresh-node_cpu_seconds_total"]')
        .trigger("click");
      expect(wrapper.emitted("refresh")).toBeTruthy();
    });

    it("turns the refresh action warning-colored when the data was fetched for a different window", () => {
      // Same contract as the dashboard's refresh button with unapplied variable
      // changes: the button itself carries the "this is out of date" signal.
      wrapper = createWrapper({
        preview: preview({ cachedDataDiffersFromTimeRange: true }),
      });
      const btn = wrapper.find(
        '[data-test="metrics-explorer-card-refresh-node_cpu_seconds_total"]',
      );
      expect(btn.classes().join(" ")).toContain("bg-button-warning");
    });

    it("has no refresh action when the data matches the selected window: the toolbar Refresh covers it", () => {
      wrapper = createWrapper({ preview: preview() });
      expect(
        wrapper.find('[data-test="metrics-explorer-card-refresh-node_cpu_seconds_total"]').exists(),
      ).toBe(false);
    });

    it("forces the warning refresh visible at rest — a warning nobody can see says nothing", () => {
      wrapper = createWrapper({
        preview: preview({ cachedDataDiffersFromTimeRange: true }),
      });
      const btn = wrapper.find(
        '[data-test="metrics-explorer-card-refresh-node_cpu_seconds_total"]',
      );
      expect(btn.element.parentElement?.className).not.toContain("w-0");
    });

    it("has no refresh action on an unsupported card (there is nothing to run)", () => {
      wrapper = createWrapper({
        card: { ...CARD, unsupported: true },
        preview: preview({ cachedDataDiffersFromTimeRange: true }),
      });
      expect(
        wrapper.find('[data-test="metrics-explorer-card-refresh-node_cpu_seconds_total"]').exists(),
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
          .find('[data-test="metrics-explorer-card-unsupported-node_cpu_seconds_total"]')
          .exists(),
      ).toBe(true);
      expect(wrapper.text()).toContain("Unsupported type (v1)");
    });

    it("renders the error state with the message in a tooltip trigger", () => {
      wrapper = createWrapper({
        preview: preview({ status: "error", error: "bad query" }),
      });
      expect(
        wrapper.find('[data-test="metrics-explorer-card-error-node_cpu_seconds_total"]').exists(),
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
          .find('[data-test="metrics-explorer-card-skeleton-node_cpu_seconds_total"]')
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
        wrapper.find('[data-test="metrics-explorer-card-nodata-node_cpu_seconds_total"]').exists(),
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
      expect(wrapper.findComponent({ name: "MetricCardChart" }).exists()).toBe(true);
    });

    it("shows one failure marker on a failed card: the header marker carries the error and copies it, the body badge is gone (N3)", async () => {
      wrapper = createWrapper({
        preview: preview({
          status: "done",
          results: [{ resultType: "matrix", result: [{ values: [[1, "1"]] }] }],
          stale: true,
          failedAt: Date.now(),
          lastTriggeredAt: Date.now() - 60_000,
          error: "Search query timed out",
          errorTraceId: "c411073d",
        }),
      });
      expect(
        wrapper.find('[data-test="metrics-explorer-card-stale-node_cpu_seconds_total"]').exists(),
      ).toBe(false);
      const marker = wrapper.find(
        '[data-test="metrics-explorer-card-refresh-failed-node_cpu_seconds_total"]',
      );
      expect(marker.element.tagName).toBe("BUTTON");
      const age = wrapper
        .findAllComponents({ name: "ODataAge" })
        .find((c) => c.props("short") && !c.props("iconOnly"))!;
      expect(age.props("detail")).toContain("Search query timed out");
      expect(age.props("detail")).toContain("Trace ID: c411073d");
      await marker.trigger("click");
      expect(copied).toContain("Trace ID: c411073d");
    });

    it("keeps a sparse answer's words, never an empty chart, while it reloads (CS10)", () => {
      wrapper = createWrapper({
        preview: preview({ status: "loading", results: [{ result: [] }], sparse: true }),
      });
      expect(
        wrapper.find('[data-test="metrics-explorer-card-sparse-node_cpu_seconds_total"]').exists(),
      ).toBe(true);
      expect(wrapper.findComponent({ name: "MetricCardChart" }).exists()).toBe(false);
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
        wrapper.find('[data-test="metrics-explorer-card-stale-node_cpu_seconds_total"]').exists(),
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
      // Header bar (the shared PanelBar's box — tinted and bordered), footer,
      // and the badge in the footer where it cannot truncate the name it
      // describes.
      expect(wrapper.find(".min-h-7.border-b.border-panel-bar-border").exists()).toBe(true);
      expect(
        wrapper.find('[data-test="metrics-explorer-card-badge-node_cpu_seconds_total"]').exists(),
      ).toBe(true);
      expect(wrapper.text()).toContain("counter");
    });
  });

  it("renders no legacy <q- component", () => {
    wrapper = createWrapper();
    expect(wrapper.html()).not.toContain("<q-");
  });

  /**
   * The x-axis must describe the data, not the picker.
   *
   * A relative range re-resolves against `now` on every mount, so `timeRange`
   * marches forward with the wall clock. A card painted from cache kept pinning
   * its axis to that, and appeared to drift on its own: an axis of 10:15-10:30
   * drawn over points from 09:40.
   */
  describe("the chart's axis follows the window its data came from", () => {
    const SELECTED = { start_time: 10_000, end_time: 20_000 };
    const CACHED = { start_time: 1_000, end_time: 11_000 };

    const chartTimeRange = (w: VueWrapper<any>) =>
      w.findComponent({ name: "MetricCardChart" }).props("timeRange");

    it("uses the CACHED window when the data was restored from cache", () => {
      wrapper = createWrapper({
        timeRange: SELECTED,
        preview: preview({
          results: [{ result: [{ values: [[1, "1"]] }] }],
          cachedTimeRange: CACHED,
        }),
      });

      // Not SELECTED: those points describe 1_000-11_000, and saying otherwise
      // is what made the grid look like it was drifting.
      expect(chartTimeRange(wrapper)).toEqual(CACHED);
    });

    it("uses the SELECTED window on the live path, where they are the same thing", () => {
      wrapper = createWrapper({
        timeRange: SELECTED,
        preview: preview({
          results: [{ result: [{ values: [[1, "1"]] }] }],
          cachedTimeRange: null,
        }),
      });

      expect(chartTimeRange(wrapper)).toEqual(SELECTED);
    });
  });

  /**
   * Create Alert (right-click → Create Alert) now lives in the panel component
   * itself: the card renders through PanelSchemaRenderer (inside MetricCardChart)
   * and opts in via `allow-alert-creation`, exactly as a dashboard panel does.
   * The card's only responsibility is to enable it — the menu, the panelData
   * contract and the navigation are the panel's (covered by its own tests).
   */
  describe("create alert from a right-click on the chart", () => {
    const QUERIES = [
      { expr: 'sum(rate({__name__="node_cpu_seconds_total"}[5m]))', legendTemplate: "" },
    ];
    const TIME_RANGE = { start_time: 1_000, end_time: 2_000 };

    it("opts the chart into the panel's Create Alert menu", () => {
      wrapper = createWrapper({
        queries: QUERIES,
        timeRange: TIME_RANGE,
        preview: preview({
          results: [{ result: [{ values: [[1, "1"]] }] }],
        }),
      });

      expect(wrapper.findComponent({ name: "MetricCardChart" }).props("allowAlertCreation")).toBe(
        true,
      );
    });
  });

  describe("exemplars toggle", () => {
    const toggleSel = '[data-test="metrics-explorer-card-exemplars-node_cpu_seconds_total"]';

    it("is absent on an ineligible card", () => {
      wrapper = createWrapper({ exemplarsEligible: false });
      expect(wrapper.find(toggleSel).exists()).toBe(false);
    });

    it("is absent while off: the detail view turns exemplars on", () => {
      wrapper = createWrapper({ exemplarsEligible: true, exemplarsOn: false });
      expect(wrapper.find(toggleSel).exists()).toBe(false);
    });

    it("turns exemplars off from the card while on", async () => {
      wrapper = createWrapper({ exemplarsEligible: true, exemplarsOn: true });
      await wrapper.find(toggleSel).trigger("click");
      expect(wrapper.emitted("toggle-exemplars")?.[0]?.[0]).toMatchObject({ name: CARD.name });
    });

    it("stays visible at rest while on, with its loading spinner", () => {
      wrapper = createWrapper({
        exemplarsEligible: true,
        exemplarsOn: true,
        exemplars: { status: "loading", markers: [], errorMessage: "" },
      });
      expect(wrapper.find(toggleSel).attributes("aria-pressed")).toBe("true");
      expect(
        wrapper
          .find('[data-test="metrics-explorer-card-exemplars-loading-node_cpu_seconds_total"]')
          .exists(),
      ).toBe(true);
    });

    it("marks a heatmap card's toggle as swapping to percentiles", () => {
      wrapper = createWrapper({
        exemplarsEligible: true,
        exemplarsOn: true,
        exemplarsSwapsVariant: true,
      });
      expect(wrapper.find(toggleSel).attributes("data-swaps-variant")).toBe("percentiles");
    });

    it("shows the empty indicator and the error warning", () => {
      wrapper = createWrapper({
        exemplarsEligible: true,
        exemplarsOn: true,
        exemplars: { status: "empty", markers: [], errorMessage: "" },
      });
      expect(
        wrapper
          .find('[data-test="metrics-explorer-card-exemplars-empty-node_cpu_seconds_total"]')
          .exists(),
      ).toBe(true);
      wrapper.unmount();
      wrapper = createWrapper({
        exemplarsEligible: true,
        exemplarsOn: true,
        exemplars: { status: "error", markers: [], errorMessage: "boom" },
      });
      expect(
        wrapper
          .find('[data-test="metrics-explorer-card-exemplars-error-node_cpu_seconds_total"]')
          .exists(),
      ).toBe(true);
    });

    it("hands its exemplars to the chart only while on", () => {
      const exemplars = { status: "ready", markers: [], errorMessage: "" };
      wrapper = createWrapper({
        preview: preview({
          results: [{ resultType: "matrix", result: [{ metric: {}, values: [[1, "1"]] }] }],
        }),
        exemplarsEligible: true,
        exemplarsOn: true,
        exemplars,
      });
      const chart = wrapper.findComponent({ name: "MetricCardChart" });
      expect(chart.exists()).toBe(true);
      expect(chart.props("injectedExemplars")).toEqual(exemplars);
    });
  });

  describe("one body until the first paint, and the chart kept across a window change", () => {
    const N = "node_cpu_seconds_total";
    const body = (w: VueWrapper<any>) =>
      w.find(`[data-test="metrics-explorer-card-skeleton-${N}"]`);
    const series = [{ resultType: "matrix", result: [{ metric: {}, values: [[1, "1"]] }] }];

    afterEach(() => vi.useRealTimers());

    it("shows the same static placeholder idle and loading, named Loading chart", async () => {
      wrapper = createWrapper();
      const idle = body(wrapper);
      expect(idle.attributes("role")).toBe("img");
      expect(idle.attributes("aria-label")).toBe("Loading chart");
      const idleHtml = idle.html();

      await wrapper.setProps({ preview: preview({ status: "loading", results: [] }) });
      expect(body(wrapper).exists()).toBe(true);
      expect(body(wrapper).html()).toBe(idleHtml);
      expect(body(wrapper).find(".skeleton-wave").exists()).toBe(false);
      expect(body(wrapper).find(".animate-pulse").exists()).toBe(false);
    });

    it("draws the chart at the first paint, with no placeholder left", async () => {
      wrapper = createWrapper({ preview: preview({ status: "loading", results: [] }) });
      await wrapper.setProps({ preview: preview({ status: "done", results: series }) });
      expect(body(wrapper).exists()).toBe(false);
      expect(wrapper.findComponent({ name: "MetricCardChart" }).exists()).toBe(true);
    });

    it("dims the kept chart to 60% 150 ms into a different window's load, never on a same-window refresh", async () => {
      vi.useFakeTimers();
      wrapper = createWrapper({
        preview: preview({ status: "loading", results: series, windowStale: true }),
      });
      const chart = () => wrapper.findComponent({ name: "MetricCardChart" });
      expect(chart().attributes("aria-busy")).toBe("true");
      expect(chart().classes()).not.toContain("opacity-60");
      vi.advanceTimersByTime(149);
      await wrapper.vm.$nextTick();
      expect(chart().classes()).not.toContain("opacity-60");
      vi.advanceTimersByTime(1);
      await wrapper.vm.$nextTick();
      expect(chart().classes()).toContain("opacity-60");

      await wrapper.setProps({ preview: preview({ status: "done", results: series }) });
      expect(chart().classes()).not.toContain("opacity-60");

      await wrapper.setProps({ preview: preview({ status: "loading", results: series }) });
      vi.advanceTimersByTime(500);
      await wrapper.vm.$nextTick();
      expect(chart().classes()).not.toContain("opacity-60");
      expect(chart().attributes("aria-busy")).toBeUndefined();
    });
  });

  describe("its own progress line, the one a dashboard panel draws", () => {
    const loadingProgress = (w: VueWrapper<any>) => w.findComponent({ name: "LoadingProgress" });

    it("draws its own line by default", () => {
      wrapper = createWrapper({ preview: preview({ status: "loading", results: [] }) });
      expect(loadingProgress(wrapper).exists()).toBe(true);
      expect(loadingProgress(wrapper).props("loading")).toBe(true);
    });

    it("keeps it on over a kept chart through a refresh or time change, and off once the answer lands", async () => {
      const series = [{ resultType: "matrix", result: [{ metric: {}, values: [[1, "1"]] }] }];
      wrapper = createWrapper({ preview: preview({ status: "done", results: series }) });
      expect(loadingProgress(wrapper).props("loading")).toBe(false);
      await wrapper.setProps({ preview: preview({ status: "loading", results: series }) });
      expect(loadingProgress(wrapper).props("loading")).toBe(true);
      expect(loadingProgress(wrapper).props("indeterminate")).toBe(false);
      await wrapper.setProps({ preview: preview({ status: "done", results: series }) });
      expect(loadingProgress(wrapper).props("loading")).toBe(false);
    });
  });

  describe("data age and the failed-refresh marker", () => {
    const N = "node_cpu_seconds_total";
    const series = [{ resultType: "matrix", result: [{ metric: {}, values: [[1, "1"]] }] }];

    it("shows Updated hh:mm in the header slot once the chart has drawn its first frame (M-4)", async () => {
      wrapper = createWrapper({
        preview: preview({ status: "done", results: series, lastTriggeredAt: Date.now() }),
      });
      const age = () => wrapper.find(`[data-test="metrics-explorer-card-data-age-${N}"]`);
      // Laid out but invisible (hidden from assistive tech too), so the header does not shift when it shows.
      expect(age().classes()).toContain("invisible");
      expect(age().text()).toMatch(/Updated \d{2}:\d{2}/);

      wrapper.findComponent({ name: "MetricCardChart" }).vm.$emit("painted");
      await wrapper.vm.$nextTick();
      expect(age().classes()).not.toContain("invisible");
      expect(age().attributes("data-state")).toBe("age");
      expect(age().text()).toMatch(/Updated \d{2}:\d{2}/);
    });

    it("puts the data age before Drill down, as the mockups do (CS12)", async () => {
      wrapper = createWrapper({
        preview: preview({ status: "done", results: series, lastTriggeredAt: Date.now() }),
      });
      wrapper.findComponent({ name: "MetricCardChart" }).vm.$emit("painted");
      await wrapper.vm.$nextTick();
      const html = wrapper.html();
      expect(html.indexOf(`metrics-explorer-card-data-age-${N}`)).toBeLessThan(
        html.indexOf(`metrics-explorer-card-details-${N}`),
      );
    });

    it("in a narrow card, the failed marker is its icon alone with the sentence in its tooltip (CS11)", () => {
      wrapper = createWrapper({
        preview: preview({
          status: "done",
          results: series,
          stale: true,
          failedAt: Date.now(),
          lastTriggeredAt: Date.now() - 300_000,
        }),
      });
      const words = wrapper.find(`[data-test="metrics-explorer-card-refresh-failed-${N}"]`);
      const icon = wrapper.find(`[data-test="metrics-explorer-card-refresh-failed-icon-${N}"]`);
      expect(words.classes()).toContain("@max-md/panelbar:hidden");
      expect(icon.classes()).toContain("@md/panelbar:hidden");
      expect(icon.attributes("data-state")).toBe("failed");
      expect(icon.findAll('[aria-hidden="true"]').filter((el) => el.text())).toHaveLength(0);
      expect(icon.find(".sr-only").text()).toMatch(/^Refresh failed at \d{2}:\d{2}/);
    });

    it("in a narrow card, the age is a clock icon with Updated in its tooltip, so the title keeps its room (CS11)", async () => {
      wrapper = createWrapper({
        preview: preview({ status: "done", results: series, lastTriggeredAt: Date.now() }),
      });
      wrapper.findComponent({ name: "MetricCardChart" }).vm.$emit("painted");
      await wrapper.vm.$nextTick();
      const icon = wrapper.find(`[data-test="metrics-explorer-card-data-age-icon-${N}"]`);
      expect(icon.attributes("data-state")).toBe("age");
      expect(icon.classes()).toContain("@md/panelbar:hidden");
      expect(icon.find(".sr-only").text()).toMatch(/^Updated \d{2}:\d{2}:\d{2}/);
      expect(wrapper.find(`[data-test="metrics-explorer-card-data-age-${N}"]`).classes()).toContain(
        "@max-md/panelbar:hidden",
      );
    });

    it("says Updated at once when there is no chart to wait for", () => {
      wrapper = createWrapper({
        preview: preview({ status: "done", results: [], lastTriggeredAt: Date.now() }),
      });
      expect(
        wrapper.find(`[data-test="metrics-explorer-card-data-age-${N}"]`).attributes("data-state"),
      ).toBe("age");
    });

    it("waits for the new chart's first frame again after the chart was swapped out", async () => {
      wrapper = createWrapper({
        preview: preview({ status: "done", results: series, lastTriggeredAt: Date.now() }),
      });
      wrapper.findComponent({ name: "MetricCardChart" }).vm.$emit("painted");
      await wrapper.vm.$nextTick();
      await wrapper.setProps({ preview: preview({ status: "loading", results: [] }) });
      await wrapper.setProps({
        preview: preview({ status: "done", results: series, lastTriggeredAt: Date.now() }),
      });
      expect(wrapper.find(`[data-test="metrics-explorer-card-data-age-${N}"]`).classes()).toContain(
        "invisible",
      );
    });

    it("swaps the age for a short red marker whose tooltip holds the full sentence", () => {
      const dataFrom = Date.now() - 300_000;
      wrapper = createWrapper({
        preview: preview({
          status: "done",
          results: series,
          stale: true,
          failedAt: Date.now(),
          lastTriggeredAt: dataFrom,
          error: "Forbidden",
        }),
      });
      const marker = wrapper.find(`[data-test="metrics-explorer-card-refresh-failed-${N}"]`);
      expect(marker.exists()).toBe(true);
      expect(marker.attributes("data-state")).toBe("failed");
      expect(marker.text()).toContain("Refresh failed");
      expect(marker.find(".sr-only").text()).toMatch(
        /^Refresh failed at \d{2}:\d{2} · showing data from \d{2}:\d{2}$/,
      );
      expect(marker.classes()).toContain("shrink-0");
      expect(marker.attributes("role")).toBeUndefined();
      expect(wrapper.find(`[data-test="metrics-explorer-card-data-age-${N}"]`).exists()).toBe(
        false,
      );
    });

    it("returns a failed card's kept chart to full opacity: the marker says it is not live", async () => {
      vi.useFakeTimers();
      onTestFinished(() => vi.useRealTimers());
      wrapper = createWrapper({
        preview: preview({ status: "loading", results: series, windowStale: true }),
      });
      const chart = () => wrapper.findComponent({ name: "MetricCardChart" });
      vi.advanceTimersByTime(200);
      await wrapper.vm.$nextTick();
      expect(chart().classes()).toContain("opacity-60");

      await wrapper.setProps({
        preview: preview({
          status: "done",
          results: series,
          stale: true,
          failedAt: Date.now(),
          lastTriggeredAt: Date.now() - 60_000,
          error: "Forbidden",
        }),
      });
      vi.advanceTimersByTime(500);
      await wrapper.vm.$nextTick();
      expect(chart().classes()).not.toContain("opacity-60");
      expect(chart().attributes("aria-busy")).toBeUndefined();
      expect(wrapper.find(`[data-test="metrics-explorer-card-refresh-failed-${N}"]`).exists()).toBe(
        true,
      );
    });

    it("never advances the age on a failed run: no marker or age without a time", () => {
      wrapper = createWrapper({ preview: preview({ status: "error", error: "x" }) });
      expect(wrapper.find(`[data-test="metrics-explorer-card-data-age-${N}"]`).exists()).toBe(
        false,
      );
      expect(wrapper.find(`[data-test="metrics-explorer-card-refresh-failed-${N}"]`).exists()).toBe(
        false,
      );
    });

    it("holds the age and the failed marker in one slot sized by the marker, so a failure never moves the badges (CR2-3)", () => {
      const slotOf = (w: any) => {
        const slot = w.get(`[data-test="metrics-explorer-card-age-slot-${N}"]`);
        const reserve = slot.get('[data-test="data-age-failed-reserve"]');
        return { slot, reserve, children: slot.element.children };
      };
      const dataFrom = Date.now() - 300_000;
      wrapper = createWrapper({
        preview: preview({ status: "done", results: series, lastTriggeredAt: dataFrom }),
      });
      const before = slotOf(wrapper);
      const age = before.slot.get(`[data-test="metrics-explorer-card-data-age-${N}"]`);
      wrapper = createWrapper({
        preview: preview({
          status: "done",
          results: series,
          stale: true,
          failedAt: Date.now(),
          lastTriggeredAt: dataFrom,
          error: "Forbidden",
        }),
      });
      const after = slotOf(wrapper);
      const marker = after.slot.get(`[data-test="metrics-explorer-card-refresh-failed-${N}"]`);
      for (const { slot, reserve, children } of [before, after]) {
        expect(slot.classes()).toEqual(
          expect.arrayContaining(["inline-grid", "shrink-0", "justify-items-start"]),
        );
        expect(children).toHaveLength(2);
        expect(reserve.classes()).toEqual(
          expect.arrayContaining([
            "invisible",
            "ms-1.5",
            "[grid-area:1/1]",
            "@max-md/panelbar:hidden",
          ]),
        );
      }
      expect(before.slot.classes()).toEqual(after.slot.classes());
      for (const shown of [age, marker]) {
        expect(shown.classes()).toEqual(expect.arrayContaining(["ms-1.5", "[grid-area:1/1]"]));
      }
    });
  });
});

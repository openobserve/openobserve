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

import { mount, flushPromises } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import FunctionConfigDialog from "./FunctionConfigDialog.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { getMetricDefaults } from "@/utils/metrics/metricDefaults";
import { PreviewCancelledError } from "@/composables/metrics/useMetricsPreviewQueue";

// ---------------------------------------------------------------------------
// Stubs
//
// ODialog portals its panel to document.body via reka-ui, which would put the
// component's own markup outside the wrapper. The stub renders the same three
// slots inline instead, so every assertion below still runs against the real
// markup FunctionConfigDialog renders (real ORadioGroup/ORadio/OCheckbox/
// OButton). MetricCardChart is stubbed only to keep ECharts out of jsdom.
// ---------------------------------------------------------------------------
const ODialogStub = {
  name: "ODialog",
  props: ["open", "title", "size", "persistent", "showClose"],
  emits: ["update:open"],
  template: `
    <div class="o-dialog-stub" :data-test="$attrs['data-test']" :data-open="open">
      <slot name="header" />
      <slot />
      <slot name="footer" />
    </div>
  `,
};

const MetricCardChartStub = {
  name: "MetricCardChart",
  props: [
    "results",
    "queries",
    "chartType",
    "unit",
    "unitCustom",
    "bucketUnit",
    "bucketUnitCustom",
    "color",
  ],
  template: `
    <div
      class="metric-card-chart-stub"
      :data-test="$attrs['data-test']"
      :data-series="queries.length"
      :data-chart-type="chartType"
    />
  `,
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A counter card: rate-sum / rate-avg / increase / topk. No percentiles. */
const counterDefaults = () =>
  getMetricDefaults("http_requests_total", "counter", undefined, {
    rateWindow: "4m",
    labels: ["instance", "job"],
  });

/** A classic histogram: heatmap / percentiles / count-rate. */
const histogramDefaults = () =>
  getMetricDefaults(
    "http_request_duration_seconds_bucket",
    "histogram",
    undefined,
    { rateWindow: "4m", streamNames: new Set(["http_request_duration_seconds_count"]) },
  );

const counterCard = {
  name: "http_requests_total",
  familyName: "http_requests",
  familyType: "counter",
  cardKind: "counterRate",
  typeFilterBucket: "counter",
  help: "",
  unit: "count-per-sec",
  hasData: true,
  unsupported: false,
  configurable: true,
  footerLabel: "sum(rate)",
  chartType: "line",
};

const histogramCard = {
  ...counterCard,
  name: "http_request_duration_seconds_bucket",
  familyName: "http_request_duration_seconds",
  familyType: "histogram",
  cardKind: "classicHistogramBuckets",
  typeFilterBucket: "histogram",
  unit: "seconds",
  footerLabel: "heatmap",
  chartType: "heatmap",
};

/** A query_range response with one non-empty series. */
/**
 * What the preview queue actually resolves: the chunk processor accumulates into
 * the UNWRAPPED `{resultType, result}` shape. The fixture used to carry the
 * `{data: {...}}` envelope, which nothing downstream ever sees — the dialog's
 * hand-rolled emptiness check tolerated both shapes, so the unrealistic fixture
 * went unnoticed until that check was replaced with the shared `hasSamples`.
 */
const okResult = () => ({
  resultType: "matrix",
  result: [{ metric: {}, values: [[1, "1"]] }],
});

const createWrapper = (props: Record<string, any> = {}) =>
  mount(FunctionConfigDialog, {
    props: {
      modelValue: true,
      card: counterCard,
      defaults: counterDefaults(),
      override: null,
      color: "#60a5fa",
      runPreview: vi.fn(() => Promise.resolve(okResult())),
      ...props,
    },
    global: {
      plugins: [i18n, store],
      stubs: {
        ODialog: ODialogStub,
        MetricCardChart: MetricCardChartStub,
      },
    },
    attachTo: document.body,
  });

const tile = (wrapper: any, id: string) =>
  wrapper.find(`[data-test="metrics-fn-variant-${id}"]`);

const percentileBox = (wrapper: any, variantId: string, p: number) =>
  wrapper.find(
    `[data-test="metrics-fn-percentile-${variantId}-${p}"] button[role="checkbox"]`,
  );

describe("FunctionConfigDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.state.theme = "dark";
  });

  describe("tiles", () => {
    it("renders one tile per variant", async () => {
      const defaults = counterDefaults();
      const wrapper = createWrapper({ defaults });
      await flushPromises();

      const tiles = wrapper.findAll('[data-test^="metrics-fn-variant-"]');
      expect(defaults.variants.length).toBe(4); // rate-sum, rate-avg, increase, topk
      expect(tiles).toHaveLength(defaults.variants.length);

      for (const variant of defaults.variants) {
        expect(tile(wrapper, variant.id).exists()).toBe(true);
        expect(tile(wrapper, variant.id).text()).toContain(variant.label);
      }
    });

    it("shows each variant's resolved PromQL and charts its preview", async () => {
      const defaults = counterDefaults();
      const wrapper = createWrapper({ defaults });
      await flushPromises();

      const expr = wrapper.find('[data-test="metrics-fn-expr-rate-sum"]');
      expect(expr.text()).toBe(defaults.variants[0].queries[0].expr);
      expect(expr.text()).toContain("sum(rate(");

      const chart = wrapper.find('[data-test="metrics-fn-chart-rate-sum"]');
      expect(chart.exists()).toBe(true);
    });

    it("runs one preview query per variant query on open", async () => {
      const runPreview = vi.fn(() => Promise.resolve(okResult()));
      const defaults = histogramDefaults();
      createWrapper({
        card: histogramCard,
        defaults,
        runPreview,
      });
      await flushPromises();

      // heatmap (1) + percentiles (3) + count-rate (1)
      const expected = defaults.variants.reduce(
        (n: number, v: any) => n + v.queries.length,
        0,
      );
      expect(runPreview).toHaveBeenCalledTimes(expected);
    });

    it("selects the override's variant on open, else the rule-set default", async () => {
      const plain = createWrapper();
      await flushPromises();
      expect(plain.vm.selectedId).toBe("rate-sum");

      const overridden = createWrapper({
        override: { variantId: "increase" },
      });
      await flushPromises();
      expect(overridden.vm.selectedId).toBe("increase");
    });

    it("selects a variant when its tile is clicked", async () => {
      const wrapper = createWrapper();
      await flushPromises();

      await tile(wrapper, "rate-avg").trigger("click");

      expect(wrapper.vm.selectedId).toBe("rate-avg");
    });

    it("renders an empty state for a card with no variants", async () => {
      const wrapper = createWrapper({
        defaults: { ...counterDefaults(), variants: [], configurable: false },
      });
      await flushPromises();

      expect(wrapper.find('[data-test="metrics-fn-empty"]').exists()).toBe(true);
      expect(wrapper.findAll('[data-test^="metrics-fn-variant-"]')).toHaveLength(0);
    });
  });

  describe("percentiles", () => {
    it("renders a checkbox per available percentile, checked per the rule set", async () => {
      const wrapper = createWrapper({
        card: histogramCard,
        defaults: histogramDefaults(),
      });
      await flushPromises();

      for (const p of [50, 90, 99]) {
        const box = percentileBox(wrapper, "percentiles", p);
        expect(box.exists()).toBe(true);
        expect(box.attributes("data-state")).toBe("checked");
      }
    });

    it("re-renders the tile with only the selected percentile queries", async () => {
      const runPreview = vi.fn(() => Promise.resolve(okResult()));
      const wrapper = createWrapper({
        card: histogramCard,
        defaults: histogramDefaults(),
        runPreview,
      });
      await flushPromises();
      runPreview.mockClear();

      await percentileBox(wrapper, "percentiles", 50).trigger("click");
      await flushPromises();

      // p50 dropped: only p90 and p99 are re-run, and only for this tile.
      expect(runPreview).toHaveBeenCalledTimes(2);
      const exprs = runPreview.mock.calls.map((call: any[]) => call[0]);
      expect(exprs.every((e: string) => !e.includes("0.5,"))).toBe(true);

      const chart = wrapper.find('[data-test="metrics-fn-chart-percentiles"]');
      expect(chart.attributes("data-series")).toBe("2");
    });

    it("cannot go empty — the last checked box is disabled and does nothing", async () => {
      const wrapper = createWrapper({
        card: histogramCard,
        defaults: histogramDefaults(),
      });
      await flushPromises();

      await percentileBox(wrapper, "percentiles", 50).trigger("click");
      await percentileBox(wrapper, "percentiles", 90).trigger("click");
      await flushPromises();

      const last = percentileBox(wrapper, "percentiles", 99);
      expect(last.attributes("data-state")).toBe("checked");
      expect(last.attributes("disabled")).toBeDefined();

      // Clicking it anyway must not empty the set.
      await last.trigger("click");
      await flushPromises();

      expect(percentileBox(wrapper, "percentiles", 99).attributes("data-state")).toBe(
        "checked",
      );
      expect(
        wrapper.find('[data-test="metrics-fn-chart-percentiles"]').attributes(
          "data-series",
        ),
      ).toBe("1");
    });

    it("prefills the checkbox set from a persisted override", async () => {
      const wrapper = createWrapper({
        card: histogramCard,
        defaults: histogramDefaults(),
        override: { variantId: "percentiles", options: { percentiles: [99] } },
      });
      await flushPromises();

      expect(percentileBox(wrapper, "percentiles", 99).attributes("data-state")).toBe(
        "checked",
      );
      expect(percentileBox(wrapper, "percentiles", 50).attributes("data-state")).toBe(
        "unchecked",
      );
    });
  });

  describe("apply / restore", () => {
    it("disables Apply until something changes", async () => {
      const wrapper = createWrapper();
      await flushPromises();

      const apply = wrapper.find('[data-test="metrics-fn-apply"]');
      expect(apply.attributes("disabled")).toBeDefined();

      await tile(wrapper, "increase").trigger("click");
      expect(
        wrapper.find('[data-test="metrics-fn-apply"]').attributes("disabled"),
      ).toBeUndefined();
    });

    it("emits apply with the selected variant id", async () => {
      const wrapper = createWrapper();
      await flushPromises();

      await tile(wrapper, "rate-avg").trigger("click");
      await wrapper.find('[data-test="metrics-fn-apply"]').trigger("click");

      expect(wrapper.emitted("apply")).toBeTruthy();
      expect(wrapper.emitted("apply")![0]).toEqual([{ variantId: "rate-avg" }]);
    });

    it("emits apply with the selected percentile options", async () => {
      const wrapper = createWrapper({
        card: histogramCard,
        defaults: histogramDefaults(),
      });
      await flushPromises();

      await tile(wrapper, "percentiles").trigger("click");
      await percentileBox(wrapper, "percentiles", 50).trigger("click");
      await flushPromises();

      await wrapper.find('[data-test="metrics-fn-apply"]').trigger("click");

      expect(wrapper.emitted("apply")![0]).toEqual([
        { variantId: "percentiles", options: { percentiles: [90, 99] } },
      ]);
    });

    it("emits restore with no payload", async () => {
      const wrapper = createWrapper({ override: { variantId: "increase" } });
      await flushPromises();

      await wrapper.find('[data-test="metrics-fn-restore"]').trigger("click");

      expect(wrapper.emitted("restore")).toBeTruthy();
      expect(wrapper.emitted("restore")![0]).toEqual([]);
    });

    it("closes on Cancel", async () => {
      const wrapper = createWrapper();
      await flushPromises();

      await wrapper.find('[data-test="metrics-fn-cancel"]').trigger("click");

      expect(wrapper.emitted("update:modelValue")![0]).toEqual([false]);
    });
  });

  describe("preview failures", () => {
    it("shows an error on ONLY the failing tile", async () => {
      const failing = counterDefaults().variants[1].queries[0].expr; // rate-avg
      const runPreview = vi.fn((expr: string) =>
        expr === failing
          ? Promise.reject(new Error("boom"))
          : Promise.resolve(okResult()),
      );

      const wrapper = createWrapper({ runPreview });
      await flushPromises();

      const error = wrapper.find('[data-test="metrics-fn-error-rate-avg"]');
      expect(error.exists()).toBe(true);
      expect(error.text()).toContain("Query failed");
      expect(error.attributes("title")).toBe("boom");

      // Every other tile still charts.
      expect(wrapper.find('[data-test="metrics-fn-chart-rate-sum"]').exists()).toBe(
        true,
      );
      expect(wrapper.find('[data-test="metrics-fn-chart-increase"]').exists()).toBe(
        true,
      );
      expect(wrapper.findAll('[data-test^="metrics-fn-error-"]')).toHaveLength(1);
    });

    it("retries just that tile", async () => {
      const failing = counterDefaults().variants[1].queries[0].expr;
      let fail = true;
      const runPreview = vi.fn((expr: string) =>
        expr === failing && fail
          ? Promise.reject(new Error("boom"))
          : Promise.resolve(okResult()),
      );

      const wrapper = createWrapper({ runPreview });
      await flushPromises();
      expect(wrapper.find('[data-test="metrics-fn-error-rate-avg"]').exists()).toBe(
        true,
      );

      fail = false;
      await wrapper.find('[data-test="metrics-fn-retry-rate-avg"]').trigger("click");
      await flushPromises();

      expect(wrapper.find('[data-test="metrics-fn-error-rate-avg"]').exists()).toBe(
        false,
      );
      expect(wrapper.find('[data-test="metrics-fn-chart-rate-avg"]').exists()).toBe(
        true,
      );
    });

    it("shows NO error when a preview is cancelled", async () => {
      const runPreview = vi.fn(() =>
        Promise.reject(new PreviewCancelledError("cancelled")),
      );

      const wrapper = createWrapper({ runPreview });
      await flushPromises();

      expect(wrapper.findAll('[data-test^="metrics-fn-error-"]')).toHaveLength(0);
    });

    it("shows NO error when a preview is aborted by axios", async () => {
      const canceled: any = new Error("canceled");
      canceled.name = "CanceledError";
      const runPreview = vi.fn(() => Promise.reject(canceled));

      const wrapper = createWrapper({ runPreview });
      await flushPromises();

      expect(wrapper.findAll('[data-test^="metrics-fn-error-"]')).toHaveLength(0);
    });

    it("ignores a resolution that lands after the dialog closed", async () => {
      let settle: ((value: any) => void) | null = null;
      const runPreview = vi.fn(
        () =>
          new Promise((resolve) => {
            settle = resolve;
          }),
      );

      const wrapper = createWrapper({ runPreview });
      await wrapper.setProps({ modelValue: false });
      settle?.(okResult());
      await flushPromises();

      expect(wrapper.findAll('[data-test^="metrics-fn-chart-"]')).toHaveLength(0);
    });
  });
});

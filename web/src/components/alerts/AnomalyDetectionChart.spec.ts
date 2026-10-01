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

import { describe, expect, it, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { chartColor } from "@/utils/chartTheme";
import searchService from "@/services/search";

// The _anomalies schema decides which kind columns the queries may reference;
// the fixture stands in for it, per test.
const { anomaliesSchema } = vi.hoisted(() => ({
  anomaliesSchema: { fields: [] as Array<{ name: string }>, fail: false },
}));
vi.mock("@/services/stream", () => ({
  default: {
    schema: vi.fn(async () => {
      if (anomaliesSchema.fail) throw new Error("schema unavailable");
      return { data: { schema: anomaliesSchema.fields } };
    }),
  },
}));

vi.mock("@/services/search", () => ({
  default: { search: vi.fn() },
}));

// `__esModule` is load-bearing: the component reaches this through defineAsyncComponent.
vi.mock("@/components/dashboards/panels/ChartRenderer.vue", () => ({
  __esModule: true,
  default: {
    name: "ChartRenderer",
    props: ["data"],
    template: '<div class="chart-renderer-stub" />',
  },
}));

import AnomalyDetectionChart from "@/components/alerts/AnomalyDetectionChart.vue";

const search = vi.mocked(searchService.search);

const stubs = {
  // The renderer runs a real query pipeline; the panel CONFIG handed to it is
  // what this spec is about.
  PanelSchemaRenderer: {
    name: "PanelSchemaRenderer",
    props: ["panelSchema", "selectedTimeObj", "height", "width", "variablesData", "searchType"],
    template: '<div class="panel-stub" />',
  },
};

const ANOMALY = { histogram_interval: "5m", stream_name: "logs", alert_type: "anomaly_detection" };

const HIT = {
  zo_sql_key: "2026-10-01T00:05:00",
  zo_sql_num: 12,
  anomaly_value: 12,
  expected_value: 8,
  expected_lower: 5,
  expected_upper: 11,
};

const respond = (hits: any[]) => search.mockResolvedValue({ data: { hits } } as any);

// The search result is what mounts the async ChartRenderer, a second hop in the same chain.
const settle = async () => {
  for (let i = 0; i < 6; i++) await flushPromises();
};

const mountChart = async (alert: Record<string, any> = ANOMALY, anomalyId = "cfg1") => {
  const wrapper = mount(AnomalyDetectionChart, {
    props: { alert, anomalyId },
    global: { plugins: [i18n, store], stubs },
  });
  await settle();
  return wrapper;
};

const openInternals = async (wrapper: any) => {
  await wrapper
    .find('[data-test="alerts-anomalydetectionchart-internals"] button')
    .trigger("click");
  await settle();
};

/** The schema of the nth internals panel, in render order: score, deviation. */
const schemaAt = (wrapper: any, index: number) =>
  wrapper.findAllComponents({ name: "PanelSchemaRenderer" })[index]?.props("panelSchema");

const lastSearch = () => search.mock.calls[search.mock.calls.length - 1]?.[0] as any;
const lastSql = () => lastSearch()?.query.query.sql as string;

const metricOptions = (wrapper: any) =>
  wrapper.findComponent({ name: "ChartRenderer" }).props("data").options;

let wrapper: any = null;

beforeAll(async () => {
  await import("@/components/dashboards/panels/ChartRenderer.vue");
});

beforeEach(() => {
  anomaliesSchema.fields = [];
  anomaliesSchema.fail = false;
  search.mockReset();
  respond([HIT]);
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe("AnomalyDetectionChart", () => {
  describe("metric panel", () => {
    it("queries the anomalies stream for the one config, over the whole range", async () => {
      wrapper = await mountChart();
      const request = lastSearch();
      expect(lastSql()).toContain('FROM "_anomalies"');
      expect(lastSql()).toContain("WHERE anomaly_id = 'cfg1'");
      expect(request.query.query.size).toBe(-1);
      expect(request.query.query.end_time - request.query.query.start_time).toBe(
        60 * 60 * 1000 * 1000,
      );
    });

    it("renders the band chart once the rows arrive", async () => {
      wrapper = await mountChart();
      expect(wrapper.find('[data-test="alerts-anomalydetectionchart-metric-chart"]').exists()).toBe(
        true,
      );
      expect(wrapper.findAllComponents({ name: "PanelSchemaRenderer" })).toHaveLength(0);
    });

    it("projects the bounds only when the schema carries both columns", async () => {
      anomaliesSchema.fields = [{ name: "expected_lower" }, { name: "expected_upper" }];
      wrapper = await mountChart();
      expect(lastSql()).toContain("ORDER BY created_at) AS expected_lower");
      expect(lastSql()).toContain("ORDER BY created_at) AS expected_upper");
    });

    it("leaves the bounds out when only one column exists", async () => {
      anomaliesSchema.fields = [{ name: "expected_lower" }];
      wrapper = await mountChart();
      expect(lastSql()).not.toContain("expected_lower");
    });

    it("stacks the band as lower and upper minus lower", async () => {
      anomaliesSchema.fields = [{ name: "expected_lower" }, { name: "expected_upper" }];
      wrapper = await mountChart();
      const band = metricOptions(wrapper).series.filter((s: any) => s.stack === "band");
      expect(band).toHaveLength(2);
      expect(band[0].data[0][1]).toBe(5);
      expect(band[1].data[0][1]).toBe(6);
    });

    it("draws no band for legacy rows without bounds", async () => {
      respond([{ zo_sql_key: "2026-10-01T00:05:00", zo_sql_num: 12, anomaly_value: null }]);
      wrapper = await mountChart();
      const band = metricOptions(wrapper).series.filter((s: any) => s.stack === "band");
      for (const series of band) expect(series.data[0][1]).toBeNull();
    });

    it("colours the value and the flag by meaning, through the chart tokens", async () => {
      wrapper = await mountChart();
      const series = metricOptions(wrapper).series;
      const byName = (name: string) => series.find((s: any) => s.name === name);
      expect(byName("Value").lineStyle.color).toBe(chartColor("--color-chart-series-1"));
      expect(byName("Anomaly").itemStyle.color).toBe(chartColor("--color-status-error-text"));
      const band = series.filter((s: any) => s.stack === "band")[1];
      expect(band.areaStyle.color).toBe(chartColor("--color-chart-band"));
    });

    it("gates the flag on scored rows when the kind columns exist", async () => {
      anomaliesSchema.fields = [{ name: "is_absence" }, { name: "is_partial_drop" }];
      wrapper = await mountChart();
      expect(lastSql()).toContain(
        "last_value(is_anomaly ORDER BY CASE WHEN is_absence IS NOT TRUE AND " +
          "is_partial_drop IS NOT TRUE THEN 1 ELSE 0 END, created_at)",
      );
      expect(lastSql()).toContain("AS event_value");
    });

    it("buckets at the config's detection resolution", async () => {
      wrapper = await mountChart({ ...ANOMALY, histogram_interval: "1h" });
      expect(lastSql()).toContain("histogram(_timestamp, '1h')");
    });

    it("shows the no-data state when the range holds no rows", async () => {
      respond([]);
      wrapper = await mountChart();
      expect(
        wrapper.find('[data-test="alerts-anomalydetectionchart-metric-nodata"]').exists(),
      ).toBe(true);
    });

    it("holds the query behind the schema probe, showing loading meanwhile", async () => {
      wrapper = mount(AnomalyDetectionChart, {
        props: { alert: ANOMALY, anomalyId: "cfg1" },
        global: { plugins: [i18n, store], stubs },
      });
      expect(search).not.toHaveBeenCalled();
      expect(
        wrapper.find('[data-test="alerts-anomalydetectionchart-metric-loading"]').exists(),
      ).toBe(true);
      await settle();
      expect(search).toHaveBeenCalledTimes(1);
      expect(
        wrapper.find('[data-test="alerts-anomalydetectionchart-metric-loading"]').exists(),
      ).toBe(false);
    });

    it("falls back to the legacy query when the schema fetch fails, instead of no chart", async () => {
      anomaliesSchema.fail = true;
      wrapper = await mountChart();
      expect(lastSql()).not.toContain("expected_");
      expect(lastSql()).toContain("CASE WHEN last_value(is_anomaly ORDER BY created_at) THEN");
    });

    it("re-probes the schema when the anomaly id changes", async () => {
      wrapper = await mountChart();
      expect(lastSql()).not.toContain("expected_lower");

      anomaliesSchema.fields = [{ name: "expected_lower" }, { name: "expected_upper" }];
      await wrapper.setProps({ anomalyId: "cfg2" });
      await settle();

      expect(lastSql()).toContain("ORDER BY created_at) AS expected_lower");
      expect(lastSql()).toContain("WHERE anomaly_id = 'cfg2'");
    });

    it("renders the unavailable notice instead of querying with no config id", async () => {
      wrapper = await mountChart(ANOMALY, "");
      expect(search).not.toHaveBeenCalled();
      expect(wrapper.find('[data-test="alerts-anomalydetectionchart-metric-empty"]').exists()).toBe(
        true,
      );
    });

    it("refetches over the new range when the range changes", async () => {
      wrapper = await mountChart();
      await wrapper.findComponent({ name: "OToggleGroup" }).vm.$emit("update:modelValue", "24h");
      await settle();
      const request = lastSearch();
      expect(request.query.query.end_time - request.query.query.start_time).toBe(
        24 * 60 * 60 * 1000 * 1000,
      );
    });
  });

  describe("mixed rows, as the live query returns them", () => {
    // Real server output for seeded rows: re-judged bucket, absence only, negative plus drop, legacy.
    const LIVE_HITS = [
      {
        zo_sql_key: "2026-10-01T19:20:00",
        zo_sql_num: 12,
        expected_value: 10,
        expected_lower: 5,
        expected_upper: 15,
      },
      { zo_sql_key: "2026-10-01T19:25:00", event_value: 0 },
      {
        zo_sql_key: "2026-10-01T19:30:00",
        zo_sql_num: -4,
        anomaly_value: -4,
        expected_value: -7,
        expected_lower: -10,
        expected_upper: -5,
        event_value: 1,
      },
      { zo_sql_key: "2026-10-01T19:35:00", zo_sql_num: 7 },
    ];
    const byName = (wrapper: any, name: string) =>
      metricOptions(wrapper)
        .series.filter((s: any) => s.name === name)
        .map((s: any) => s.data.map(([, v]: [number, number | null]) => v));

    beforeEach(() => {
      anomaliesSchema.fields = [
        "is_absence",
        "is_partial_drop",
        "expected_value",
        "expected_lower",
        "expected_upper",
      ].map((name) => ({ name }));
      respond(LIVE_HITS);
    });

    it("draws the latest verdict for a bucket judged twice: in band, not red", async () => {
      wrapper = await mountChart();
      const [lower, height] = byName(wrapper, "Expected range");
      const [value] = byName(wrapper, "Value");
      const [flag] = byName(wrapper, "Anomaly");
      expect([value[0], lower[0], lower[0] + height[0], flag[0]]).toEqual([12, 5, 15, null]);
    });

    it("draws no value and no band for an absence-only bucket, only its event marker", async () => {
      wrapper = await mountChart();
      const [value] = byName(wrapper, "Value");
      const [lower, height] = byName(wrapper, "Expected range");
      const [event] = byName(wrapper, "Drop / absence");
      expect([value[1], lower[1], height[1], event[1]]).toEqual([null, null, null, 0]);
    });

    it("keeps a negative reading and its negative band beside a drop in the same bucket", async () => {
      wrapper = await mountChart();
      const [value] = byName(wrapper, "Value");
      const [flag] = byName(wrapper, "Anomaly");
      const [lower, height] = byName(wrapper, "Expected range");
      const [event] = byName(wrapper, "Drop / absence");
      expect([value[2], flag[2], lower[2], height[2], event[2]]).toEqual([-4, -4, -10, 5, 1]);
    });

    it("draws a legacy bucket with no band", async () => {
      wrapper = await mountChart();
      const [value] = byName(wrapper, "Value");
      const [lower, height] = byName(wrapper, "Expected range");
      expect([value[3], lower[3], height[3]]).toEqual([7, null, null]);
    });
  });

  describe("metric request lifecycle", () => {
    const deferred = () => {
      let resolve!: (value: unknown) => void;
      const promise = new Promise((r) => (resolve = r));
      return { promise, resolve };
    };
    const valueSeries = (wrapper: any) =>
      metricOptions(wrapper).series.find((s: any) => s.name === "Value").data;

    it("drops a superseded response that resolves after the newer one", async () => {
      const stale = deferred();
      search.mockImplementationOnce(() => stale.promise as any);
      wrapper = await mountChart();
      const staleSignal = lastSearch().signal as AbortSignal;

      respond([{ ...HIT, zo_sql_num: 99 }]);
      await wrapper.findComponent({ name: "OToggleGroup" }).vm.$emit("update:modelValue", "24h");
      await settle();
      expect(staleSignal.aborted).toBe(true);
      expect(valueSeries(wrapper)[0][1]).toBe(99);

      stale.resolve({ data: { hits: [{ ...HIT, zo_sql_num: 1 }] } });
      await settle();
      expect(valueSeries(wrapper)[0][1]).toBe(99);
      expect(
        wrapper.find('[data-test="alerts-anomalydetectionchart-metric-loading"]').exists(),
      ).toBe(false);
    });

    it("aborts the in-flight request on unmount", async () => {
      search.mockImplementationOnce(() => new Promise(() => {}) as any);
      wrapper = await mountChart();
      const signal = lastSearch().signal as AbortSignal;
      expect(signal.aborted).toBe(false);
      wrapper.unmount();
      wrapper = null;
      expect(signal.aborted).toBe(true);
    });
  });

  describe("detector internals", () => {
    it("is collapsed by default, so the score and deviation panels do not mount", async () => {
      wrapper = await mountChart();
      expect(wrapper.find('[data-test="alerts-anomalydetectionchart-internals"]').text()).toContain(
        "Detector internals",
      );
      expect(wrapper.findAllComponents({ name: "PanelSchemaRenderer" })).toHaveLength(0);
    });

    it("draws score and deviation once opened", async () => {
      wrapper = await mountChart();
      await openInternals(wrapper);
      expect(wrapper.findAll('[data-test="alerts-anomalydetectionchart-score"]')).toHaveLength(1);
      expect(wrapper.findAll('[data-test="alerts-anomalydetectionchart-deviation"]')).toHaveLength(
        1,
      );
      expect(wrapper.findAllComponents({ name: "PanelSchemaRenderer" })).toHaveLength(2);
    });

    it("plots the threshold as a series, so a retrain steps it rather than flattening it", async () => {
      wrapper = await mountChart();
      await openInternals(wrapper);
      const schema = schemaAt(wrapper, 0);
      expect(schema.queries[0].fields.stream).toBe("_anomalies");
      expect(schema.queries[0].query).toContain("last_value(threshold_value ORDER BY created_at)");
      expect(schema.queries[0].fields.y).toHaveLength(2);
      expect(schema.config.mark_line).toEqual([]);
    });

    it("ranks the score panel's rows by kind when the columns exist", async () => {
      anomaliesSchema.fields = [{ name: "is_absence" }, { name: "is_partial_drop" }];
      wrapper = await mountChart();
      await openInternals(wrapper);
      expect(schemaAt(wrapper, 0).queries[0].query).toContain(
        "last_value(score ORDER BY CASE WHEN is_absence IS NOT TRUE AND " +
          "is_partial_drop IS NOT TRUE THEN 1 ELSE 0 END, created_at) END AS score_value",
      );
    });

    it("draws deviation as percentage bars", async () => {
      wrapper = await mountChart();
      await openInternals(wrapper);
      const schema = schemaAt(wrapper, 1);
      expect(schema.type).toBe("bar");
      expect(schema.config.unit).toBe("percent");
    });

    it("keeps the legacy single deviation series when the stream has no kind columns", async () => {
      wrapper = await mountChart();
      await openInternals(wrapper);
      const schema = schemaAt(wrapper, 1);
      expect(schema.queries[0].query).toContain(
        "last_value(deviation_percent ORDER BY created_at) AS deviation_value",
      );
      expect(schema.queries[0].fields.y).toHaveLength(1);
    });

    it("splits score deviation from drops and excludes the absence sentinel when the columns exist", async () => {
      anomaliesSchema.fields = [{ name: "is_absence" }, { name: "is_partial_drop" }];
      wrapper = await mountChart();
      await openInternals(wrapper);
      const schema = schemaAt(wrapper, 1);
      expect(schema.queries[0].query).toContain(
        "last_value(deviation_percent ORDER BY CASE WHEN is_absence IS NOT TRUE AND " +
          "is_partial_drop IS NOT TRUE THEN 1 ELSE 0 END, created_at) END AS deviation_value",
      );
      expect(schema.queries[0].query).toContain(
        "max(CASE WHEN is_partial_drop IS TRUE THEN deviation_percent END) AS drop_value",
      );
      expect(schema.queries[0].fields.y).toHaveLength(2);
    });

    it("feeds the renderer microseconds and moves with the range picker", async () => {
      wrapper = await mountChart();
      await openInternals(wrapper);
      await wrapper.findComponent({ name: "OToggleGroup" }).vm.$emit("update:modelValue", "24h");
      await settle();
      const times = wrapper
        .findAllComponents({ name: "PanelSchemaRenderer" })
        .map((panel: any) => panel.props("selectedTimeObj"));
      expect(times).toHaveLength(2);
      for (const time of times) {
        expect(time.end_time.getTime() - time.start_time.getTime()).toBe(
          24 * 60 * 60 * 1000 * 1000,
        );
        expect(time).toBe(times[0]);
      }
    });
  });
});

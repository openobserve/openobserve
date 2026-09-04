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

import { describe, expect, it, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { chartColor } from "@/utils/chartTheme";

import AnomalyDetectionChart from "@/components/alerts/AnomalyDetectionChart.vue";

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

const mountChart = async (alert: Record<string, any> = ANOMALY, anomalyId = "cfg1") => {
  const wrapper = mount(AnomalyDetectionChart, {
    props: { alert, anomalyId },
    global: { plugins: [i18n, store], stubs },
  });
  await flushPromises();
  return wrapper;
};

/** The schema of the nth panel, in render order: metric, score, deviation. */
const schemaAt = (wrapper: any, index: number) =>
  wrapper.findAllComponents({ name: "PanelSchemaRenderer" })[index]?.props("panelSchema");

let wrapper: any = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe("AnomalyDetectionChart", () => {
  it("draws all three readings of the detection record", async () => {
    wrapper = await mountChart();
    expect(wrapper.findAll('[data-test="alerts-anomalydetectionchart-metric"]')).toHaveLength(1);
    expect(wrapper.findAll('[data-test="alerts-anomalydetectionchart-score"]')).toHaveLength(1);
    expect(wrapper.findAll('[data-test="alerts-anomalydetectionchart-deviation"]')).toHaveLength(1);
  });

  it("queries the anomalies stream, not the alert's own stream", async () => {
    wrapper = await mountChart();
    const query = schemaAt(wrapper, 0).queries[0];
    expect(query.fields.stream).toBe("_anomalies");
    expect(query.fields.stream_type).toBe("logs");
    expect(query.query).toContain("WHERE anomaly_id = 'cfg1'");
  });

  it("colours the flagged series red and the metric blue, by series name", async () => {
    // The default hashes the series NAME into the palette, which would assign
    // "this stretch was an anomaly" a colour at random.
    const config = schemaAt((wrapper = await mountChart()), 0).config;
    const mapping = Object.fromEntries(
      config.color.colorBySeries.map((m: any) => [m.value, m.color]),
    );
    expect(mapping["Value"]).toBe(chartColor("--color-chart-series-1"));
    expect(mapping["Anomaly"]).toBe(chartColor("--color-status-error-text"));
    expect(mapping["Value"]).not.toBe(mapping["Anomaly"]);
  });

  it("shows symbols on the metric chart so a lone flagged bucket is visible", async () => {
    // A single flagged bucket is a one-point series, and a line through one
    // point draws nothing at all.
    wrapper = await mountChart();
    expect(schemaAt(wrapper, 0).config.show_symbol).toBe(true);
    expect(schemaAt(wrapper, 0).config.line_interpolation).toBe("linear");
  });

  it("leaves the flagged series null outside an anomaly, so it draws as segments", async () => {
    wrapper = await mountChart();
    const query = schemaAt(wrapper, 0).queries[0].query;
    expect(query).toContain("CASE WHEN max(CASE WHEN is_anomaly THEN 1 ELSE 0 END) = 1");
    expect(schemaAt(wrapper, 0).config.connect_nulls).toBe(false);
  });

  it("overlays the flagged buckets ON the metric line, not below it", async () => {
    wrapper = await mountChart();
    const query = schemaAt(wrapper, 0).queries[0].query;
    expect(query).not.toContain("max(CASE WHEN is_anomaly THEN actual_value END)");
    expect(query.match(/max\(actual_value\)/g)).toHaveLength(2);
  });

  it("plots the threshold as a series, so a retrain steps it rather than flattening it", async () => {
    wrapper = await mountChart();
    const schema = schemaAt(wrapper, 1);
    expect(schema.queries[0].query).toContain("max(threshold_value)");
    expect(schema.queries[0].fields.y).toHaveLength(2);
    expect(schema.config.mark_line).toEqual([]);
  });

  it("draws deviation as percentage bars", async () => {
    wrapper = await mountChart();
    const schema = schemaAt(wrapper, 2);
    expect(schema.type).toBe("bar");
    expect(schema.config.unit).toBe("percent");
  });

  it("buckets at the config's detection resolution", async () => {
    wrapper = await mountChart({ ...ANOMALY, histogram_interval: "1h" });
    expect(schemaAt(wrapper, 0).queries[0].query).toContain("histogram(_timestamp, '1h')");
  });

  it("renders the unavailable notice instead of an empty frame with no config id", async () => {
    wrapper = await mountChart(ANOMALY, "");
    expect(wrapper.findAllComponents({ name: "PanelSchemaRenderer" })).toHaveLength(0);
    expect(wrapper.find('[data-test="alerts-anomalydetectionchart-metric-empty"]').exists()).toBe(
      true,
    );
  });

  it("feeds the renderer microseconds, the convention the alert charts use", async () => {
    wrapper = await mountChart();
    const time = wrapper.findComponent({ name: "PanelSchemaRenderer" }).props("selectedTimeObj");
    const spanMs = time.end_time.getTime() - time.start_time.getTime();
    // One hour expressed in microseconds, handed to Date as if milliseconds.
    expect(spanMs).toBe(60 * 60 * 1000 * 1000);
  });

  it("moves all three charts together when the range changes", async () => {
    wrapper = await mountChart();
    const before = wrapper.findComponent({ name: "PanelSchemaRenderer" }).props("selectedTimeObj");
    await wrapper.findComponent({ name: "OToggleGroup" }).vm.$emit("update:modelValue", "24h");
    await flushPromises();

    const times = wrapper
      .findAllComponents({ name: "PanelSchemaRenderer" })
      .map((panel: any) => panel.props("selectedTimeObj"));
    expect(times).toHaveLength(3);
    for (const time of times) {
      expect(time.end_time.getTime() - time.start_time.getTime()).toBe(24 * 60 * 60 * 1000 * 1000);
      expect(time).toBe(times[0]);
    }
    expect(before.end_time.getTime() - before.start_time.getTime()).toBe(60 * 60 * 1000 * 1000);
  });
});

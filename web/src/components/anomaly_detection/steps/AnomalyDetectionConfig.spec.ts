// Copyright 2023 OpenObserve Inc.
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
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

installQuasar({ plugins: [Dialog, Notify] });

vi.mock("@/services/stream", () => ({
  default: {
    schema: vi.fn().mockResolvedValue({
      data: {
        schema: [{ name: "host" }, { name: "level" }, { name: "message" }],
      },
    }),
  },
}));

import AnomalyDetectionConfig from "@/components/anomaly_detection/steps/AnomalyDetectionConfig.vue";
import streamService from "@/services/stream";

const makeConfig = (overrides: Record<string, any> = {}) => ({
  name: "test-config",
  stream_type: "logs",
  stream_name: "my-stream",
  query_mode: "filters" as const,
  filters: [] as any[],
  custom_sql: "",
  detection_function: "count",
  histogram_interval_value: 5,
  histogram_interval_unit: "m" as const,
  schedule_interval_value: 1,
  schedule_interval_unit: "h" as const,
  detection_window_value: 1,
  detection_window_unit: "h" as const,
  training_window_days: 14,
  retrain_interval_days: 7,
  threshold: 97,
  alert_enabled: true,
  ...overrides,
});

async function mountComp(props: Record<string, any> = {}) {
  return mount(AnomalyDetectionConfig, {
    props: { config: makeConfig(), ...props },
    global: { plugins: [i18n, store] },
  });
}

describe("AnomalyDetectionConfig - rendering", () => {
  it("renders without errors", async () => {
    const w = await mountComp();
    expect(w.exists()).toBe(true);
  });

  it("renders filters query mode button", async () => {
    const w = await mountComp();
    expect(w.find('[data-test="anomaly-query-mode-filters"]').exists()).toBe(true);
  });

  it("renders custom SQL query mode button", async () => {
    const w = await mountComp();
    expect(w.find('[data-test="anomaly-query-mode-sql"]').exists()).toBe(true);
  });

  it("renders histogram interval value input", async () => {
    const w = await mountComp();
    expect(w.find('[data-test="anomaly-histogram-interval-value"]').exists()).toBe(true);
  });

  it("renders histogram interval unit select", async () => {
    const w = await mountComp();
    expect(w.find('[data-test="anomaly-histogram-interval-unit"]').exists()).toBe(true);
  });

  it("renders schedule interval value input", async () => {
    const w = await mountComp();
    expect(w.find('[data-test="anomaly-schedule-interval-value"]').exists()).toBe(true);
  });

  it("renders training window input", async () => {
    const w = await mountComp();
    expect(w.find('[data-test="anomaly-training-window"]').exists()).toBe(true);
  });

  it("renders threshold slider", async () => {
    const w = await mountComp();
    expect(w.find('[data-test="anomaly-threshold"]').exists()).toBe(true);
  });

  it("renders threshold decrement button", async () => {
    const w = await mountComp();
    expect(w.find('[data-test="anomaly-threshold-dec"]').exists()).toBe(true);
  });

  it("renders threshold increment button", async () => {
    const w = await mountComp();
    expect(w.find('[data-test="anomaly-threshold-inc"]').exists()).toBe(true);
  });
});

describe("AnomalyDetectionConfig - query mode", () => {
  it("shows detection function select in filters mode", async () => {
    const w = await mountComp({ config: makeConfig({ query_mode: "filters" }) });
    expect(w.find('[data-test="anomaly-detection-function"]').exists()).toBe(true);
  });

  it("shows custom SQL input in custom_sql mode", async () => {
    const w = await mountComp({ config: makeConfig({ query_mode: "custom_sql" }) });
    expect(w.find('[data-test="anomaly-custom-sql"]').exists()).toBe(true);
  });

  it("hides detection function in custom_sql mode", async () => {
    const w = await mountComp({ config: makeConfig({ query_mode: "custom_sql" }) });
    expect(w.find('[data-test="anomaly-detection-function"]').exists()).toBe(false);
  });

  it("hides custom SQL in filters mode", async () => {
    const w = await mountComp({ config: makeConfig({ query_mode: "filters" }) });
    expect(w.find('[data-test="anomaly-custom-sql"]').exists()).toBe(false);
  });

  it("clicking filters mode button sets query_mode to filters", async () => {
    const config = makeConfig({ query_mode: "custom_sql" });
    const w = await mountComp({ config });
    await w.find('[data-test="anomaly-query-mode-filters"]').trigger("click");
    expect(config.query_mode).toBe("filters");
  });

  it("clicking custom SQL mode button sets query_mode to custom_sql", async () => {
    const config = makeConfig({ query_mode: "filters" });
    const w = await mountComp({ config });
    await w.find('[data-test="anomaly-query-mode-sql"]').trigger("click");
    expect(config.query_mode).toBe("custom_sql");
  });
});

describe("AnomalyDetectionConfig - threshold controls", () => {
  it("shows sensitivity percentage (100 - threshold)", async () => {
    const config = makeConfig({ threshold: 97 });
    const w = await mountComp({ config });
    expect(w.text()).toContain("3%");
  });

  it("decrement button decreases threshold by 1", async () => {
    const config = makeConfig({ threshold: 95 });
    const w = await mountComp({ config });
    await w.find('[data-test="anomaly-threshold-dec"]').trigger("click");
    expect(config.threshold).toBe(94);
  });

  it("increment button increases threshold by 1", async () => {
    const config = makeConfig({ threshold: 95 });
    const w = await mountComp({ config });
    await w.find('[data-test="anomaly-threshold-inc"]').trigger("click");
    expect(config.threshold).toBe(96);
  });

  it("decrement button is disabled when threshold is 90", async () => {
    const config = makeConfig({ threshold: 90 });
    const w = await mountComp({ config });
    const decBtn = w.find('[data-test="anomaly-threshold-dec"]');
    expect(decBtn.attributes("disabled")).toBeDefined();
  });

  it("increment button is disabled when threshold is 99", async () => {
    const config = makeConfig({ threshold: 99 });
    const w = await mountComp({ config });
    const incBtn = w.find('[data-test="anomaly-threshold-inc"]');
    expect(incBtn.attributes("disabled")).toBeDefined();
  });

  it("shows High sensitivity badge when threshold <= 92", async () => {
    const config = makeConfig({ threshold: 91 });
    const w = await mountComp({ config });
    expect(w.text()).toContain("High");
  });

  it("shows Low sensitivity badge when threshold > 95", async () => {
    const config = makeConfig({ threshold: 97 });
    const w = await mountComp({ config });
    expect(w.text()).toContain("Low");
  });
});

describe("AnomalyDetectionConfig - training seasonality", () => {
  it("shows hour-of-day seasonality for training_window_days < 7", async () => {
    const config = makeConfig({ training_window_days: 5 });
    const w = await mountComp({ config });
    expect(w.text()).toContain("hour-of-day");
  });

  it("shows hour + day-of-week seasonality for training_window_days >= 7", async () => {
    const config = makeConfig({ training_window_days: 14 });
    const w = await mountComp({ config });
    expect(w.text()).toContain("hour + day-of-week");
  });
});

describe("AnomalyDetectionConfig - filters", () => {
  it("addFilter appends an empty filter to config.filters", async () => {
    const config = makeConfig({ filters: [] });
    const w = await mountComp({ config });
    (w.vm as any).addFilter();
    expect(config.filters).toHaveLength(1);
    expect(config.filters[0]).toMatchObject({ field: "", operator: "=", value: "" });
  });

  it("removeFilter removes the filter at the given index", async () => {
    const config = makeConfig({
      filters: [
        { field: "host", operator: "=", value: "localhost" },
        { field: "level", operator: "=", value: "error" },
      ],
    });
    const w = await mountComp({ config });
    (w.vm as any).removeFilter(0);
    expect(config.filters).toHaveLength(1);
    expect(config.filters[0].field).toBe("level");
  });
});

describe("AnomalyDetectionConfig - stream fields", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls streamService.schema when stream_name and stream_type are set", async () => {
    const config = makeConfig({ stream_name: "my-stream", stream_type: "logs" });
    await mountComp({ config });
    await flushPromises();
    expect(streamService.schema).toHaveBeenCalledWith("default", "my-stream", "logs");
  });

  it("does not call streamService.schema when stream_name is empty", async () => {
    vi.clearAllMocks();
    const config = makeConfig({ stream_name: "", stream_type: "logs" });
    await mountComp({ config });
    await flushPromises();
    expect(streamService.schema).not.toHaveBeenCalled();
  });

  it("populates allStreamFields after loading", async () => {
    const config = makeConfig({ stream_name: "my-stream", stream_type: "logs" });
    const w = await mountComp({ config });
    await flushPromises();
    expect((w.vm as any).allStreamFields).toContain("host");
    expect((w.vm as any).allStreamFields).toContain("level");
  });

  it("filterFieldOptions filters by keyword", async () => {
    const config = makeConfig({ stream_name: "my-stream", stream_type: "logs" });
    const w = await mountComp({ config });
    await flushPromises();
    (w.vm as any).filterFieldOptions("host", (cb: () => void) => cb());
    expect((w.vm as any).filteredStreamFields).toContain("host");
    expect((w.vm as any).filteredStreamFields).not.toContain("level");
  });

  it("filterFieldOptions returns all when filter is empty", async () => {
    const config = makeConfig({ stream_name: "my-stream", stream_type: "logs" });
    const w = await mountComp({ config });
    await flushPromises();
    (w.vm as any).filterFieldOptions("", (cb: () => void) => cb());
    expect((w.vm as any).filteredStreamFields.length).toBeGreaterThanOrEqual(3);
  });
});

describe("AnomalyDetectionConfig - validate", () => {
  it("validate returns true when formRef is null", async () => {
    const w = await mountComp();
    (w.vm as any).formRef = null;
    const result = await (w.vm as any).validate();
    expect(result).toBe(true);
  });
});

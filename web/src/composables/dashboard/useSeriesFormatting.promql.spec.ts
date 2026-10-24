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

import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import OverrideConfigPopup from "@/components/dashboards/OverrideConfigPopup.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { convertPromQLData } from "@/utils/dashboard/convertPromQLData";
import { getPromqlMetricSeriesNames } from "./useSeriesFormatting";

const promqlQuery = (legend: string) => ({
  query: "sum by (job) (rate(http_requests_total[5m]))",
  customQuery: true,
  fields: { stream: "", stream_type: "metrics", x: [], y: [], z: [], breakdown: [] },
  config: { promql_legend: legend },
});

const matrix = (labels: Record<string, string>, value: string) => ({
  resultType: "matrix",
  result: [
    {
      metric: labels,
      values: [
        [1760000000, "1"],
        [1760000060, value],
      ],
    },
  ],
});

const metricSource = (legend = "", queries = 1) => ({
  panelSchema: {
    id: "Panel_promql_metric",
    type: "metric",
    queryType: "promql",
    queries: Array.from({ length: queries }, () => promqlQuery(legend)),
    config: { unit: "", decimals: 2 },
  },
  data: Array.from({ length: queries }, (_, i) =>
    matrix({ __name__: "http_requests_total", job: i ? "web" : "api" }, String(40 + i)),
  ),
  metadata: { queries: Array.from({ length: queries }, (_, i) => ({ panelQueryIndex: i })) },
  resultMetaData: [],
});

const metricText = async (source: any, overrides: any[]) => {
  const schema = {
    ...source.panelSchema,
    config: { ...source.panelSchema.config, override_config: overrides },
  };
  const result: any = await convertPromQLData(
    schema,
    source.data,
    store,
    { value: document.createElement("div") },
    null,
    { value: [] },
    source.metadata,
    source.resultMetaData,
  );
  return result.options.series[0]._metricText;
};

describe("PromQL metric panels in Series Formatting", () => {
  let wrapper: any;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    document.body.innerHTML = "";
  });

  it("lists the name the metric value is matched by, legend format applied", async () => {
    const source = metricSource("{job} requests");
    const names = await getPromqlMetricSeriesNames(source, store);
    expect(names).toEqual(["api requests"]);
    expect(await metricText(source, [])).toBe("40.00");
    expect(
      await metricText(source, [
        {
          field: { matchBy: "series", value: names[0] },
          config: [{ type: "unit", value: { unit: "percent", customUnit: "" } }],
        },
      ]),
    ).toBe("40.00%");
  });

  it("names each query of a multi-value metric panel without a legend format", async () => {
    const source = metricSource("", 2);
    const names = await getPromqlMetricSeriesNames(source, store);
    expect(names).toHaveLength(2);
    expect(names[0]).toContain("api");
    expect(names[1]).toContain("web");
  });

  const listedInDialog = async (previewSource: any) => {
    const ChartRendererStub = defineComponent({ name: "ChartRenderer", render: () => h("div") });
    wrapper = mount(OverrideConfigPopup, {
      attachTo: document.body,
      props: {
        open: true,
        mode: "chart",
        columns: [],
        overrideConfig: { overrideConfigs: [] },
        chartType: "metric",
        seriesNames: [],
        previewSource,
      },
      global: { plugins: [i18n, store], stubs: { ChartRenderer: ChartRendererStub } },
    });
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await flushPromises();

    const trigger = document.querySelector(
      '[data-test="dashboard-series-format-add-empty-trigger"]',
    ) as HTMLElement;
    trigger.dispatchEvent(new PointerEvent("pointerdown", { button: 0, bubbles: true }));
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flushPromises();
    return Array.from(
      document.querySelectorAll('[data-test="dashboard-series-format-add-empty-name"]'),
    ).map((el) => el.getAttribute("data-series-name"));
  };

  it("shows those names in the Add series list of the real dialog", async () => {
    expect(await listedInDialog(metricSource("{job} requests"))).toEqual(["api requests"]);
  });

  it("leaves a query hidden in the editor out of the list, as the panel does", async () => {
    expect(await listedInDialog(metricSource("{job} requests", 2))).toEqual([
      "api requests",
      "web requests",
    ]);
    wrapper.unmount();
    wrapper = undefined;
    document.body.innerHTML = "";
    expect(
      await listedInDialog({ ...metricSource("{job} requests", 2), hiddenQueries: [0] }),
    ).toEqual(["web requests"]);
  });
});

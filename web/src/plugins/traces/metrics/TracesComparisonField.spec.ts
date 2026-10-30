// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createStore } from "vuex";
import i18n from "@/locales";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import { compareFields, filterTermFor, type FieldComparison } from "./traceComparison";

const { tokenColors } = vi.hoisted(() => ({
  tokenColors: {} as Record<string, string>,
}));

vi.mock("@/utils/chartTheme", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, chartColor: vi.fn((token: string) => tokenColors[token] ?? "#000000") };
});

// `__esModule` is load-bearing: the component reaches this through defineAsyncComponent.
vi.mock("@/components/dashboards/panels/ChartRenderer.vue", () => ({
  __esModule: true,
  default: {
    name: "ChartRenderer",
    props: ["data"],
    emits: ["click"],
    template: '<div class="chart-renderer-stub" />',
  },
}));

import TracesComparisonField from "./TracesComparisonField.vue";

const store = createStore({ state: { theme: "light", timezone: "UTC" } });

const categorical = (): FieldComparison => {
  const sel = Array.from({ length: 90 }, (_, i) => ({ op: `op${i % 9}`, svc: i < 60 ? "a" : "b" }));
  const base = Array.from({ length: 90 }, (_, i) => ({
    op: `op${i % 9}`,
    svc: i < 30 ? "a" : "b",
  }));
  return compareFields(sel, base, [{ name: "op", type: "Utf8" }], "duration").ranked[0];
};

// Selection piles into the top of the range, so the last bin differs most.
const numeric = (): FieldComparison => {
  const sel = Array.from({ length: 100 }, (_, i) => ({
    v: String(i < 50 ? i * 10 : 950 + (i % 5)),
  }));
  const base = Array.from({ length: 100 }, (_, i) => ({ v: String(i * 10) }));
  return compareFields(sel, base, [{ name: "v", type: "Utf8" }], "duration").ranked[0];
};

const mountField = (field: FieldComparison) =>
  mount(TracesComparisonField, {
    props: { field, noiseFloorPts: 3.2 },
    global: { plugins: [i18n, store] },
  });

const chartOptions = (w: any) => w.findComponent({ name: "ChartRenderer" }).props("data").options;
const settle = async () => {
  for (let i = 0; i < 4; i++) await flushPromises();
};

let wrapper: any = null;

beforeAll(async () => {
  await import("@/components/dashboards/panels/ChartRenderer.vue");
});

beforeEach(() => {
  tokenColors["--color-progress-bar-default"] = "#0a4ce8";
  tokenColors["--color-progress-bar-neutral"] = "#a3a3a3";
  tokenColors["--color-border-strong"] = "#525252";
  store.state.theme = "light";
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe("TracesComparisonField", () => {
  it("identifies the card by field name and carries its score", () => {
    const field = categorical();
    wrapper = mountField(field);
    const card = wrapper.find('[data-test="traces-comparison-field-op"]');
    expect(card.exists()).toBe(true);
    expect(Number(card.attributes("data-score"))).toBeCloseTo(field.score, 1);
  });

  it("draws a selection bar and a neutral baseline bar per value, both 0 to 1", () => {
    wrapper = mountField(categorical());
    const bars = wrapper.findAllComponents(OProgressBar);
    // Six values plus Other, two bars each.
    expect(bars).toHaveLength(14);
    for (let i = 0; i < bars.length; i += 2) {
      expect(bars[i].props("variant") ?? "default").toBe("default");
      expect(bars[i + 1].props("variant")).toBe("neutral");
      for (const bar of [bars[i], bars[i + 1]]) {
        expect(bar.props("value")).toBeGreaterThanOrEqual(0);
        expect(bar.props("value")).toBeLessThanOrEqual(1);
      }
    }
  });

  it("emits a value's include and exclude terms", async () => {
    const field = categorical();
    wrapper = mountField(field);
    await wrapper.find('[data-test="traces-comparison-include-op-0"]').trigger("click");
    await wrapper.find('[data-test="traces-comparison-exclude-op-0"]').trigger("click");
    expect(wrapper.emitted("apply")).toEqual([
      [filterTermFor(field, field.rows[0].bucket, "include")],
      [filterTermFor(field, field.rows[0].bucket, "exclude")],
    ]);
  });

  it("keeps a decimal for a share under 1%, so it never reads 0%", () => {
    const sel = Array.from({ length: 1000 }, (_, i) => ({
      k: i < 4 ? "rare" : i < 600 ? "a" : "b",
    }));
    const base = Array.from({ length: 1000 }, (_, i) => ({ k: i < 500 ? "a" : "b" }));
    const field = compareFields(sel, base, [{ name: "k", type: "Utf8" }], "duration").ranked[0];
    wrapper = mountField(field);
    const rare = field.rows.findIndex((r) => r.label === "rare");
    const rowText = wrapper.findAll(".grid")[rare].text();
    expect(rowText).toContain("0.4%");
  });

  it("offers no actions on the Other row", () => {
    const field = categorical();
    wrapper = mountField(field);
    const other = field.rows.length - 1;
    expect(field.rows[other].bucket.kind).toBe("other");
    expect(wrapper.find(`[data-test="traces-comparison-include-op-${other}"]`).exists()).toBe(
      false,
    );
    expect(wrapper.find(`[data-test="traces-comparison-exclude-op-${other}"]`).exists()).toBe(
      false,
    );
  });

  it("overlays the two histograms as bar series sharing the bins", async () => {
    wrapper = mountField(numeric());
    await settle();
    const o = chartOptions(wrapper);
    expect(o.series).toHaveLength(2);
    for (const s of o.series) {
      expect(s.type).toBe("bar");
      expect(s.barGap).toBe("-100%");
    }
    expect(o.series[0].itemStyle.color).toBe("#a3a3a3");
    expect(o.series[1].itemStyle.color).toBe("#0a4ce8");
  });

  it("pre-selects the most different bin and marks it", async () => {
    const field = numeric();
    wrapper = mountField(field);
    await settle();
    const o = chartOptions(wrapper);
    const marked = o.series[1].data.findIndex((d: any) => d.itemStyle?.borderColor === "#525252");
    expect(marked).toBe(field.topBin);
    await wrapper.find('[data-test="traces-comparison-bin-gte-v"]').trigger("click");
    expect(wrapper.emitted("apply")).toEqual([
      [filterTermFor(field, { kind: "bin", index: field.topBin! }, "gte")],
    ]);
  });

  it("selects a clicked bin for the >= and < actions", async () => {
    const field = numeric();
    wrapper = mountField(field);
    await settle();
    wrapper.findComponent({ name: "ChartRenderer" }).vm.$emit("click", { dataIndex: 4 });
    await settle();
    await wrapper.find('[data-test="traces-comparison-bin-gte-v"]').trigger("click");
    await wrapper.find('[data-test="traces-comparison-bin-lt-v"]').trigger("click");
    expect(wrapper.emitted("apply")).toEqual([
      [filterTermFor(field, { kind: "bin", index: 4 }, "gte")],
      [filterTermFor(field, { kind: "bin", index: 4 }, "lt")],
    ]);
  });

  it("rebuilds the histogram option on a theme flip", async () => {
    wrapper = mountField(numeric());
    await settle();
    tokenColors["--color-progress-bar-default"] = "#5586f7";
    store.state.theme = "dark";
    await settle();
    expect(chartOptions(wrapper).series[1].itemStyle.color).toBe("#5586f7");
  });
});

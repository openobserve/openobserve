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

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import ExemplarToggle from "./ExemplarToggle.vue";
import ExemplarMarkerList from "./ExemplarMarkerList.vue";

const mountToggle = (props: Record<string, unknown>) =>
  mount(ExemplarToggle, {
    props: { on: false, dataTest: "dashboard-panel-exemplars-toggle", ...props },
    global: { plugins: [i18n] },
  });

describe("ExemplarToggle", () => {
  it("reports its state through aria-pressed", () => {
    const off = mountToggle({ on: false }).find('[data-test="dashboard-panel-exemplars-toggle"]');
    expect(off.attributes("aria-pressed")).toBe("false");
    expect(off.attributes("aria-label")).toBe("Show exemplars (trace samples)");
    const on = mountToggle({ on: true, count: 21 }).find(
      '[data-test="dashboard-panel-exemplars-toggle"]',
    );
    expect(on.attributes("aria-pressed")).toBe("true");
    expect(on.attributes("aria-label")).toBe("Hide exemplars · 21 shown");
  });

  it("emits toggle on click and stays clickable while loading", async () => {
    const wrapper = mountToggle({ on: true, loading: true });
    expect(wrapper.find('[data-test="dashboard-panel-exemplars-loading"]').exists()).toBe(true);
    const button = wrapper.find('[data-test="dashboard-panel-exemplars-toggle"]');
    expect(button.attributes("disabled")).toBeUndefined();
    await button.trigger("click");
    expect(wrapper.emitted("toggle")).toHaveLength(1);
  });

  it("warns of the variant swap on a heatmap card", () => {
    const button = mountToggle({ swapsVariant: "percentiles" }).find(
      '[data-test="dashboard-panel-exemplars-toggle"]',
    );
    expect(button.attributes("data-swaps-variant")).toBe("percentiles");
    expect(button.attributes("aria-label")).toContain("Switches this card to percentiles");
  });
});

describe("ExemplarMarkerList", () => {
  const point = (id: string, x: number, queryIndexes: number[]) => ({
    marker: {
      id,
      queryIndexes,
      tsMs: 1_000,
      value: 1,
      labels: {},
      seriesLabels: {},
      traceId: `t-${id}`,
      spanId: `s-${id}`,
    },
    xPx: x,
    yPx: 40,
    clamped: false as const,
    placement: "value" as const,
  });

  it("exposes one focusable item per marker with the test bridge attributes and one Tab stop", () => {
    const wrapper = mount(ExemplarMarkerList, {
      props: { points: [point("a", 10.4, [0]), point("b", 30, [0, 1])] },
      global: { plugins: [i18n] },
    });
    expect(
      wrapper.find('[data-test="dashboard-panel-exemplar-points"]').attributes("data-count"),
    ).toBe("2");
    const items = wrapper.findAll('[data-test="dashboard-panel-exemplar-point"]');
    expect(items[0].attributes()).toMatchObject({
      "data-x-px": "10",
      "data-y-px": "40",
      "data-trace-id": "t-a",
      "data-span-id": "s-a",
      "data-query-index": "0",
      tabindex: "0",
    });
    expect(items[1].attributes("data-query-index")).toBe("0,1");
    expect(items[1].attributes("tabindex")).toBe("-1");
  });

  it("emits focus and activate for a marker", async () => {
    const wrapper = mount(ExemplarMarkerList, {
      props: { points: [point("a", 1, [0])] },
      global: { plugins: [i18n] },
    });
    const item = wrapper.find('[data-test="dashboard-panel-exemplar-point"]');
    await item.trigger("focus");
    await item.trigger("click");
    expect(wrapper.emitted("focus-marker")).toHaveLength(1);
    expect(wrapper.emitted("activate-marker")).toHaveLength(1);
  });
});

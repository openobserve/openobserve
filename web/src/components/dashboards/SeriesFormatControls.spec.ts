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
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";

// JSDOM has no layout, so the real virtualizer renders no option rows; render them all.
vi.mock("@tanstack/vue-virtual", async () => {
  const { computed, unref } = await import("vue");
  return {
    useVirtualizer: (options: any) =>
      computed(() => {
        const count = unref(options).count;
        return {
          getVirtualItems: () =>
            Array.from({ length: count }, (_, index) => ({
              index,
              key: index,
              start: index * 28,
              size: 28,
              end: (index + 1) * 28,
              lane: 0,
            })),
          getTotalSize: () => count * 28,
          scrollToIndex: () => {},
          measureElement: () => {},
        };
      }),
  };
});
import SeriesFormatControls from "@/components/dashboards/SeriesFormatControls.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import {
  emptySeriesOverrideDraft,
  serializeSeriesOverride,
} from "@/composables/dashboard/useSeriesFormatting";

describe("SeriesFormatControls series style", () => {
  let wrapper: VueWrapper<any> | undefined;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    document.body.innerHTML = "";
  });

  const mountControls = (chartType: string, override = emptySeriesOverrideDraft("name", "api")) => {
    wrapper = mount(SeriesFormatControls, {
      attachTo: document.body,
      props: { override, chartType, seriesNames: ["api", "web"] },
      global: { plugins: [i18n, store] },
    });
    return wrapper;
  };

  const option = (test: string, value: string) =>
    document.body.querySelector<HTMLElement>(
      `[data-test="dashboard-config-series-override-${test}-option"][data-test-value="${value}"]`,
    );

  it.each(["line", "area-stacked", "h-bar", "scatter"])("shows the style rows on %s", (type) => {
    const w = mountControls(type);
    for (const test of ["axis-placement", "draw-style", "line-style"]) {
      expect(w.find(`[data-test="dashboard-series-format-${test}-row"]`).exists()).toBe(true);
    }
    expect(w.find('[data-test="dashboard-config-series-override-transform"]').exists()).toBe(true);
  });

  it.each(["pie", "gauge", "metric", "state-timeline"])("hides the style rows on %s", (type) => {
    const w = mountControls(type);
    expect(w.find('[data-test="dashboard-series-format-axis-placement-row"]').exists()).toBe(false);
    expect(w.find('[data-test="dashboard-config-series-override-transform"]').exists()).toBe(false);
  });

  it("picking a placement emits a patch that serializes to an axis_placement entry", async () => {
    const draft = emptySeriesOverrideDraft("name", "api");
    const w = mountControls("line", draft);
    await flushPromises();
    await w
      .find('[data-test="dashboard-config-series-override-axis-placement-trigger"]')
      .trigger("click");
    await flushPromises();
    option("axis-placement", "right")!.click();
    await flushPromises();
    const patch = w.emitted("update")!.at(-1)![0] as any;
    expect(patch).toEqual({ axisPlacement: "right" });
    expect(serializeSeriesOverride({ ...draft, ...patch })?.config).toEqual([
      { type: "axis_placement", value: "right" },
    ]);
  });

  it("the transform switch toggles negative_y", async () => {
    const w = mountControls("line");
    await w.find('[data-test="dashboard-config-series-override-transform"]').trigger("click");
    expect(w.emitted("update")!.at(-1)![0]).toEqual({ transform: "negative_y" });
    await w.setProps({
      override: { ...emptySeriesOverrideDraft("name", "api"), transform: "negative_y" },
    });
    await w.find('[data-test="dashboard-config-series-override-transform"]').trigger("click");
    expect(w.emitted("update")!.at(-1)![0]).toEqual({ transform: null });
  });
});

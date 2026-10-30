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
      `[data-test="dashboard-series-format-${test}-option"][data-test-value="${value}"]`,
    );

  it.each(["line", "area-stacked", "bar", "h-bar"])("shows the transform row on %s", (type) => {
    const w = mountControls(type);
    expect(w.find('[data-test="dashboard-series-format-transform-row"]').exists()).toBe(true);
  });

  it.each(["pie", "gauge", "metric", "state-timeline"])("hides the style rows on %s", (type) => {
    const w = mountControls(type);
    expect(w.find('[data-test="dashboard-series-format-layout-row"]').exists()).toBe(false);
    expect(w.find('[data-test="dashboard-series-format-transform-row"]').exists()).toBe(false);
  });

  it("the Y-axis picker offers Hidden, which serializes to a y_axis entry", async () => {
    const draft = emptySeriesOverrideDraft("name", "api");
    const w = mountControls("line", draft);
    await flushPromises();
    await w.find('[data-test="dashboard-series-format-y-axis-trigger"]').trigger("click");
    await flushPromises();
    option("y-axis", "hidden")!.click();
    await flushPromises();
    const patch = w.emitted("update")!.at(-1)![0] as any;
    expect(patch.style.yAxis).toBe("hidden");
    expect(serializeSeriesOverride({ ...draft, ...patch })?.config).toEqual([
      { type: "y_axis", value: "hidden" },
    ]);
  });

  it("the transform switch toggles negative_y", async () => {
    const draft = emptySeriesOverrideDraft("name", "api");
    const w = mountControls("line", draft);
    await w.find('[data-test="dashboard-series-format-transform"]').trigger("click");
    expect((w.emitted("update")!.at(-1)![0] as any).style.transform).toBe("negative_y");
    await w.setProps({
      override: { ...draft, style: { ...draft.style, transform: "negative_y" } },
    });
    await w.find('[data-test="dashboard-series-format-transform"]').trigger("click");
    expect((w.emitted("update")!.at(-1)![0] as any).style.transform).toBeNull();
  });
});

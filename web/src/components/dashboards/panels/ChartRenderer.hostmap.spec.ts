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

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import * as echarts from "echarts/core";
import ChartRenderer from "./ChartRenderer.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import {
  buildHostmapTree,
  convertHostmapData,
  flattenHostmapTree,
  hostmapDrilldownSeries,
  layoutHostmap,
  sqlHostmapEntities,
} from "@/utils/dashboard/convertHostmapData";
import { convertPanelData } from "@/utils/dashboard/convertPanelData";

const WIDTH = 800;
const HEIGHT = 400;

const panel = {
  id: "fleet",
  type: "hostmap",
  queryType: "sql",
  config: { show_legends: true, unit: "celsius", decimals: 0 },
  queries: [
    {
      fields: {
        x: [{ alias: "x_axis_1", column: "gpu" }],
        y: [{ alias: "y_axis_1", column: "temp" }],
        breakdown: [{ alias: "breakdown_1", column: "host" }],
      },
    },
  ],
};

const rows = Array.from({ length: 24 }, (_, i) => ({
  x_axis_1: `gpu${i % 8}`,
  breakdown_1: `host-${Math.floor(i / 8)}`,
  y_axis_1: i === 5 ? null : 40 + i,
}));

const zoStore = {
  state: { timezone: "UTC", theme: "light", selectedOrganization: { identifier: "o" } },
};

describe("ChartRenderer with a host map", () => {
  let wrapper: any;

  beforeAll(() => {
    // jsdom lays nothing out, so the chart box is given a real size.
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get: () => WIDTH,
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get: () => HEIGHT,
    });
    global.IntersectionObserver = vi.fn(function () {
      return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    }) as any;
  });

  afterEach(() => wrapper?.unmount());

  const mountHostmap = async (data: any) => {
    wrapper = mount(ChartRenderer, {
      props: { data, renderType: "svg", height: "100%" },
      attachTo: document.body,
      global: {
        plugins: [i18n],
        provide: {
          store,
          hoveredSeriesState: { value: { panelId: -1 }, setIndex: vi.fn() },
        },
      },
    });
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const el = wrapper.find('[data-test="chart-renderer"]').element as HTMLElement;
    return echarts.getInstanceByDom(el)!;
  };

  it("draws one shape per cell plus framed groups through the panel converter", async () => {
    const converted: any = await convertPanelData(
      panel,
      [rows],
      zoStore,
      null,
      null,
      null,
      null,
      null,
      null,
    );
    expect(converted.chartType).toBe("hostmap");
    const chart = await mountHostmap(converted);
    expect(chart).toBeTruthy();
    const option: any = chart.getOption();
    expect(wrapper.emitted("error")).toBeUndefined();
    expect(option.series[0].data).toHaveLength(24);
    expect(option.series[1].data).toHaveLength(3);
    const svgText = wrapper.element.innerHTML;
    expect(svgText).toContain("host-0");
    expect(svgText).toContain("host-2");
  });

  it("emits the cell under the pointer on click, carrying its labels for drilldown", async () => {
    const converted: any = convertHostmapData(panel, [rows], zoStore);
    const chart = await mountHostmap(converted);

    const tree = buildHostmapTree(sqlHostmapEntities(panel, [rows], zoStore), 1, "name", "name");
    const layout = layoutHostmap(tree, WIDTH, HEIGHT - 32 - 2, "square");
    const index = 9;
    const box = layout.cells[index];
    const zr: any = chart.getZr();
    const point = { zrX: box.x + box.size / 2, zrY: 2 + box.y + box.size / 2 };
    // zrender only fires a click after a press and release on the same element.
    ["mousedown", "mouseup", "click"].forEach((name) => zr.handler.dispatch(name, { ...point }));
    await flushPromises();

    const clicks = wrapper.emitted("click") ?? [];
    expect(clicks.length).toBe(1);
    const params = clicks[0][0];
    const expected = flattenHostmapTree(tree)[index];
    expect(params.data.name).toBe(expected.name);
    expect(hostmapDrilldownSeries(params)).toMatchObject({
      __name: expected.name,
      __group: expected.groups[0],
      labels: { gpu: expected.name, host: expected.groups[0] },
    });
  });

  it("scrolls a crowded map with its rows, never turning the scroll into a time range", async () => {
    const fleet = Array.from({ length: 1024 }, (_, i) => ({
      x_axis_1: `gpu${i % 8}`,
      breakdown_1: `host-${Math.floor(i / 8)}`,
      y_axis_1: i % 90,
    }));
    const converted: any = convertHostmapData(
      panel,
      [fleet],
      zoStore,
      {},
      {
        value: { offsetWidth: WIDTH, offsetHeight: HEIGHT },
      },
    );
    expect(converted.extras.rowScroll).toBe(true);
    const chart = await mountHostmap(converted);
    expect(wrapper.emitted("error")).toBeUndefined();
    const option: any = chart.getOption();
    expect(option.dataZoom).toHaveLength(2);
    expect(option.series[1].data).toHaveLength(128);

    chart.dispatchAction({
      type: "dataZoom",
      dataZoomId: option.dataZoom[0].id,
      startValue: 200,
      endValue: 200 + option.dataZoom[0].endValue,
    });
    await flushPromises();
    expect(wrapper.emitted("updated:dataZoom")).toBeUndefined();
    expect(wrapper.emitted("error")).toBeUndefined();
  }, 20_000);
});

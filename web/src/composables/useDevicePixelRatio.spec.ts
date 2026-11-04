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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import { GridComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import {
  applyDevicePixelRatio,
  currentDevicePixelRatio,
  isFractionalDevicePixelRatio,
  useDevicePixelRatioChange,
  watchDevicePixelRatio,
} from "./useDevicePixelRatio";
import {
  fakeCanvasPainter,
  fakeDevicePixelRatio,
  type DevicePixelRatioFake,
} from "@/test/unit/helpers/devicePixelRatioFake";

describe("useDevicePixelRatio", () => {
  let display: DevicePixelRatioFake;

  beforeEach(() => {
    display = fakeDevicePixelRatio(1);
  });

  afterEach(() => {
    display.restore();
  });

  it("reads the ratio live rather than once", () => {
    expect(currentDevicePixelRatio()).toBe(1);
    display.setRatio(2);
    expect(currentDevicePixelRatio()).toBe(2);
  });

  it("reports every change, re-arming on the new ratio each time", () => {
    const onChange = vi.fn();
    watchDevicePixelRatio(onChange);

    display.setRatio(2);
    display.setRatio(1.5);
    display.setRatio(2);

    expect(onChange.mock.calls).toEqual([[2], [1.5], [2]]);
    expect(display.listenerCount()).toBe(1);
  });

  it("reports changes on Safari before 16, which has only the prefixed query and addListener", () => {
    display.restore();
    display = fakeDevicePixelRatio(1, { legacyWebKit: true });
    const onChange = vi.fn();
    const stop = watchDevicePixelRatio(onChange);

    display.setRatio(2);
    display.setRatio(1.5);

    expect(onChange.mock.calls).toEqual([[2], [1.5]]);
    expect(display.listenerCount()).toBe(1);
    stop();
    expect(display.listenerCount()).toBe(0);
  });

  it("stops listening once stopped", () => {
    const onChange = vi.fn();
    const stop = watchDevicePixelRatio(onChange);
    stop();

    display.setRatio(2);

    expect(onChange).not.toHaveBeenCalled();
    expect(display.listenerCount()).toBe(0);
  });

  it("listens only while the component is mounted", () => {
    const onChange = vi.fn();
    const wrapper = mount(
      defineComponent({
        setup() {
          useDevicePixelRatioChange(onChange);
          return () => h("div");
        },
      }),
    );
    expect(display.listenerCount()).toBe(1);

    display.setRatio(2);
    expect(onChange).toHaveBeenCalledWith(2);

    wrapper.unmount();
    expect(display.listenerCount()).toBe(0);
    display.setRatio(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe("isFractionalDevicePixelRatio", () => {
  it("is false at whole ratios and true at scaled or zoomed ones", () => {
    expect([1, 2, 3].map(isFractionalDevicePixelRatio)).toEqual([false, false, false]);
    expect([1.25, 1.5, 0.9, 1.100000023841858].map(isFractionalDevicePixelRatio)).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });
});

describe("applyDevicePixelRatio", () => {
  const chartWith = (painter: unknown) => ({ getZr: () => ({ painter }) });

  it("re-rasterizes every canvas layer at the new ratio and repaints all of it", () => {
    const painter = fakeCanvasPainter(1);

    expect(applyDevicePixelRatio(chartWith(painter), 2)).toBe(true);

    expect(painter.dpr).toBe(2);
    Object.values(painter.layers).forEach((layer) => {
      expect(layer.dpr).toBe(2);
      expect(layer.ctx.dpr).toBe(2);
      expect(layer.resize).toHaveBeenCalledWith(400, 300);
    });
    expect(painter.refresh).toHaveBeenCalledExactlyOnceWith({ paintAll: true });
  });

  it("orders the ratio update before the resize, since a layer sizes its canvas from its own ratio", () => {
    const painter = fakeCanvasPainter(1);
    const seen: number[] = [];
    painter.layers["zr_0.0"].resize.mockImplementation(function (this: { dpr: number }) {
      seen.push(this.dpr);
    });

    applyDevicePixelRatio(chartWith(painter), 1.5);

    expect(seen).toEqual([1.5]);
  });

  it("does nothing for an SVG painter", () => {
    const painter = fakeCanvasPainter(1, "svg");

    expect(applyDevicePixelRatio(chartWith(painter), 2)).toBe(false);

    expect(painter.dpr).toBe(1);
    expect(painter.refresh).not.toHaveBeenCalled();
  });

  it("does nothing when the ratio is unchanged", () => {
    const painter = fakeCanvasPainter(2);

    expect(applyDevicePixelRatio(chartWith(painter), 2)).toBe(false);

    expect(painter.layers["zr_0.0"].resize).not.toHaveBeenCalled();
    expect(painter.refresh).not.toHaveBeenCalled();
  });

  it("leaves a chart with an echarts-gl layer untouched, so its WebGL viewport stays in sync", () => {
    const painter = fakeCanvasPainter(1);
    const glLayer = { dpr: 1, resize: vi.fn() };
    painter.getLayers.mockReturnValue({ ...painter.layers, gl: glLayer });

    expect(applyDevicePixelRatio(chartWith(painter), 2)).toBe(false);

    expect(painter.dpr).toBe(1);
    expect(glLayer.dpr).toBe(1);
    expect(glLayer.resize).not.toHaveBeenCalled();
    expect(painter.layers["zr_0.0"].dpr).toBe(1);
    expect(painter.layers["zr_0.0"].resize).not.toHaveBeenCalled();
    expect(painter.refresh).not.toHaveBeenCalled();
  });

  it("touches nothing when zrender's internals are not the expected shape", () => {
    const noLayers = { ...fakeCanvasPainter(1), getLayers: undefined };
    const brokenLayer = fakeCanvasPainter(1);
    brokenLayer.getLayers.mockReturnValue({ ...brokenLayer.layers, odd: { dpr: 1, ctx: {} } });

    expect(applyDevicePixelRatio(chartWith(noLayers), 2)).toBe(false);
    expect(applyDevicePixelRatio(chartWith(brokenLayer), 2)).toBe(false);
    expect(applyDevicePixelRatio({ getZr: () => undefined }, 2)).toBe(false);
    expect(applyDevicePixelRatio(null, 2)).toBe(false);

    expect(noLayers.dpr).toBe(1);
    expect(brokenLayer.dpr).toBe(1);
    expect(brokenLayer.layers["zr_0.0"].dpr).toBe(1);
    expect(brokenLayer.layers["zr_0.0"].resize).not.toHaveBeenCalled();
    expect(brokenLayer.refresh).not.toHaveBeenCalled();
  });
});

describe("applyDevicePixelRatio on a real ECharts canvas chart", () => {
  let el: HTMLDivElement;
  let chart: echarts.ECharts;

  beforeEach(() => {
    echarts.use([LineChart, GridComponent, CanvasRenderer]);
    el = document.createElement("div");
    document.body.appendChild(el);
    chart = echarts.init(el, null, {
      renderer: "canvas",
      devicePixelRatio: 1,
      width: 400,
      height: 300,
    });
    chart.setOption({
      animation: false,
      xAxis: { type: "category", data: ["a", "b", "c"] },
      yAxis: { type: "value" },
      series: [{ type: "line", data: [1, 3, 2] }],
    });
  });

  afterEach(() => {
    chart.dispose();
    el.remove();
  });

  // The fake painter only models zrender, so an upgrade that renames its internals would pass every other spec here.
  it("re-rasterizes the canvas at the new ratio and keeps the same instance", () => {
    expect(applyDevicePixelRatio(chart, 2)).toBe(true);

    const canvases = [...el.querySelectorAll("canvas")];
    expect(canvases.length).toBeGreaterThan(0);
    canvases.forEach((canvas) => {
      expect(canvas.width).toBe(800);
      expect(canvas.height).toBe(600);
    });
    expect(chart.getDevicePixelRatio()).toBe(2);
    expect(echarts.getInstanceByDom(el)).toBe(chart);
  });

  it("builds a hover layer created after the change at the new ratio", () => {
    const before = el.querySelectorAll("canvas").length;
    applyDevicePixelRatio(chart, 2);
    (chart.getZr().painter as unknown as { getHoverLayer: () => unknown }).getHoverLayer();

    const canvases = [...el.querySelectorAll("canvas")];
    expect(canvases.length).toBe(before + 1);
    canvases.forEach((canvas) => {
      expect(canvas.width).toBe(800);
    });
  });
});

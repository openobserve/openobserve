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

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import { raw } from "@/types/i18n";
import { contrastRatio, resolveColor, resolveTokens } from "@/lib/styles/tokens/colorMath";
import K8sHexMap from "./K8sHexMap.vue";
import type { PodRow } from "./kubernetesModel";
import { groupRows } from "./mapFill";

vi.mock("@/components/dashboards/panels/ChartRenderer.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    default: defineComponent({
      name: "ChartRenderer",
      props: ["data"],
      emits: ["click"],
      setup: () => () => h("div", { "data-test": "chart-stub" }),
    }),
  };
});

const WIDTH = 1000;
const HEIGHT = 600;

const pod = (name: string, node: string, memoryPctOfLimit: number | null): PodRow =>
  ({
    key: `c/shop/${name}`,
    kind: "pod",
    cluster: "c",
    namespace: "shop",
    name,
    warnings: [],
    phase: "Running",
    ready: "true",
    status: { text: "Running", variant: "success-soft" },
    workload: null,
    node,
    restarts: 0,
    memoryPctOfLimit,
  }) as PodRow;

const ROWS = [
  pod("a", "n1", 10),
  pod("b", "n1", 95),
  pod("c", "n1", null),
  pod("d", "n2", 60),
  pod("e", "n2", 100),
];

let wrapper: VueWrapper<any>;

const mountMap = async (rows = ROWS) => {
  const groups = groupRows(rows, "node");
  wrapper = mount(K8sHexMap, {
    props: {
      entity: "pods",
      group: "node",
      fill: "memLim",
      groups,
      frameLabels: groups.map((g) => `${g.name} (${g.rows.length})`),
      label: raw("Map of 5 pods grouped by node, filled by Memory % of limit"),
    },
    global: { plugins: [i18n] },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
};

const options = () => wrapper.findComponent({ name: "ChartRenderer" }).props("data").options;

const ranges = () => ({
  x: [options().xAxis.min, options().xAxis.max],
  y: [options().yAxis.min, options().yAxis.max],
});

const canvas = () => wrapper.find('[data-test="k8s2-map-canvas"]');

// jsdom has no PointerEvent, so a MouseEvent carries the pointer fields.
const pointer = async (type: string, clientX: number, clientY: number, pointerId = 1) => {
  const event = new MouseEvent(type, { clientX, clientY, bubbles: true });
  Object.defineProperty(event, "pointerId", { value: pointerId });
  canvas().element.dispatchEvent(event);
  await wrapper.vm.$nextTick();
};

const wheel = async (deltaY: number, clientX: number, clientY: number) => {
  canvas().element.dispatchEvent(
    new WheelEvent("wheel", { deltaY, clientX, clientY, bubbles: true, cancelable: true }),
  );
  await wrapper.vm.$nextTick();
};

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => WIDTH,
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => HEIGHT,
  });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
});

afterEach(() => {
  wrapper?.unmount();
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as any).clientWidth;
  delete (HTMLElement.prototype as any).clientHeight;
});

describe("K8sHexMap (AC 52)", () => {
  it("renders one custom hex series and one frame series, with no animation and no dataZoom", async () => {
    await mountMap();
    const opt = options();
    expect(opt.animation).toBe(false);
    expect(opt.dataZoom).toBeUndefined();
    expect(opt.series).toHaveLength(2);
    const [hexes, frames] = opt.series;
    expect(hexes.type).toBe("custom");
    expect(hexes.progressive).toBe(2000);
    expect(hexes.data).toHaveLength(5);
    expect(frames.type).toBe("custom");
    expect(frames.data).toHaveLength(2);
    expect(frames.silent).toBe(true);
    expect(opt.xAxis).toMatchObject({ type: "value", show: false });
    expect(opt.yAxis).toMatchObject({ type: "value", show: false });
  });

  it("maps each centre with api.coord and the radius with api.size", async () => {
    await mountMap();
    const [hexes] = options().series;
    const api = {
      value: (dim: number) => hexes.data[0][dim],
      coord: ([x, y]: number[]) => [x * 10, -y * 10],
      size: () => [10, 10],
    };
    const shape = hexes.renderItem({ dataIndex: 0 }, api);
    expect(shape.type).toBe("polygon");
    expect(shape.shape.points).toHaveLength(6);
    const xs = shape.shape.points.map((p: number[]) => p[0]);
    const ys = shape.shape.points.map((p: number[]) => p[1]);
    const [cx, cy] = api.coord([hexes.data[0][0], hexes.data[0][1]]);
    // A regular pointy-top hex: width / height = √3 / 2.
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    expect(w / h).toBeCloseTo(Math.sqrt(3) / 2, 6);
    expect((Math.max(...xs) + Math.min(...xs)) / 2).toBeCloseTo(cx, 6);
    expect((Math.max(...ys) + Math.min(...ys)) / 2).toBeCloseTo(cy, 6);
  });

  it("sets both axis ranges from one scale, so units per pixel are equal", async () => {
    await mountMap();
    const { x, y } = ranges();
    expect((x[1] - x[0]) / WIDTH).toBeCloseTo((y[1] - y[0]) / HEIGHT, 12);
  });

  it("zooms at the cursor on wheel, pans on drag in both axes, and Reset restores the fit", async () => {
    await mountMap();
    const fitRanges = ranges();
    await wheel(-100, 250, 450);
    const zoomed = ranges();
    expect((fitRanges.x[1] - fitRanges.x[0]) / (zoomed.x[1] - zoomed.x[0])).toBeCloseTo(1.2, 9);
    const fx = fitRanges.x[0] + (250 / WIDTH) * (fitRanges.x[1] - fitRanges.x[0]);
    const zx = zoomed.x[0] + (250 / WIDTH) * (zoomed.x[1] - zoomed.x[0]);
    expect(zx).toBeCloseTo(fx, 6);

    await pointer("pointerdown", 100, 100);
    await pointer("pointermove", 140, 130);
    await pointer("pointerup", 140, 130);
    const panned = ranges();
    expect(panned.x[0]).toBeLessThan(zoomed.x[0]);
    expect(panned.y[0]).toBeGreaterThan(zoomed.y[0]);

    await wrapper.find('[data-test="k8s2-map-reset"]').trigger("click");
    expect(ranges()).toEqual(fitRanges);
  });

  it("keeps the map under the fingers on a two-finger drag that also pinches", async () => {
    await mountMap();
    await wheel(-100, 500, 300);
    const layoutAt = (r: ReturnType<typeof ranges>, px: number, py: number) => [
      r.x[0] + (px / WIDTH) * (r.x[1] - r.x[0]),
      r.y[1] - (py / HEIGHT) * (r.y[1] - r.y[0]),
    ];
    await pointer("pointerdown", 300, 300, 1);
    await pointer("pointerdown", 400, 300, 2);
    const before = layoutAt(ranges(), 350, 300);
    await pointer("pointermove", 420, 330, 2);
    const after = layoutAt(ranges(), 360, 315);
    expect(after[0]).toBeCloseTo(before[0], 6);
    expect(after[1]).toBeCloseTo(before[1], 6);
  });

  it("a press that moves under 4px emits the hex click; a drag does not", async () => {
    await mountMap();
    const chart = wrapper.findComponent({ name: "ChartRenderer" });
    await pointer("pointerdown", 100, 100);
    await pointer("pointermove", 102, 101);
    await pointer("pointerup", 102, 101);
    chart.vm.$emit("click", { seriesIndex: 0, dataIndex: 1 });
    expect(wrapper.emitted("select")).toEqual([[groupRows(ROWS, "node")[0].rows[1]]]);

    await pointer("pointerdown", 100, 100);
    await pointer("pointermove", 120, 100);
    await pointer("pointerup", 120, 100);
    chart.vm.$emit("click", { seriesIndex: 0, dataIndex: 1 });
    expect(wrapper.emitted("select")).toHaveLength(1);
  });

  it("labels the wrapper as an image and reads tooltips from a precomputed array", async () => {
    await mountMap();
    expect(canvas().attributes("role")).toBe("img");
    expect(canvas().attributes("aria-label")).toBe(
      "Map of 5 pods grouped by node, filled by Memory % of limit",
    );
    const tip = options().tooltip.formatter({ seriesIndex: 0, dataIndex: 1 });
    expect(tip).toContain("b");
    expect(tip).toContain("Memory % of limit: 95%");
    expect(options().tooltip.formatter({ seriesIndex: 0, dataIndex: 2 })).toContain(
      "Memory % of limit: No data",
    );
  });

  it("reuses the layout on a refresh that changes no keys, keeping the zoom", async () => {
    await mountMap();
    await wheel(-100, 500, 300);
    const zoomed = ranges();
    const groups = groupRows(
      ROWS.map((r) => ({ ...r, memoryPctOfLimit: 1 })),
      "node",
    );
    await wrapper.setProps({ groups });
    expect(ranges()).toEqual(zoomed);
  });
});

describe("map heat tokens", () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "../../../lib/styles/tokens");
  const themes = resolveTokens(
    ["base.css", "semantic.css", "component.css", "dark.css"].map((f) =>
      readFileSync(join(dir, f), "utf8"),
    ),
  );
  for (const theme of ["light", "dark"] as const) {
    it.each([1, 2, 3, 4, 5])(
      `--color-map-seq-%i keeps 3:1 on surface-base in ${theme}`,
      async (i) => {
        const scope = themes[theme];
        const fg = resolveColor(`--color-map-seq-${i}`, scope);
        const bg = resolveColor("--color-surface-base", scope);
        expect(fg && bg).toBeTruthy();
        expect(contrastRatio(fg!, bg!)).toBeGreaterThanOrEqual(3);
      },
    );
  }
});

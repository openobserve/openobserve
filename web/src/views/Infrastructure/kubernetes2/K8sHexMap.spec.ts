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
import { createStore } from "vuex";
import i18n from "@/locales";
import { raw } from "@/types/i18n";
import { contrastRatio, resolveColor, resolveTokens } from "@/lib/styles/tokens/colorMath";
import { iconRegistry } from "@/lib/core/Icon/OIcon.icons";
import { chartColor } from "@/utils/chartTheme";
import K8sHexMap from "./K8sHexMap.vue";
import { MAX_ZOOM } from "./hexViewport";
import type { PodRow } from "./kubernetesModel";
import type { MapGroup } from "./kubernetesQueries";
import { groupRows, statusCounts, type GroupHeader, type RowGroup } from "./mapFill";

const palette = vi.hoisted(() => ({ dark: false }));
const viewport = vi.hoisted(() => ({ mobile: false }));

vi.mock("@/composables/useBreakpoint", async () => {
  const { computed } = await import("vue");
  return { default: () => ({ isMobile: computed(() => viewport.mobile) }) };
});

// jsdom has no canvas to measure text, so every character is 7px wide here.
vi.mock("echarts/core", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    format: {
      ...actual.format,
      getTextRect: (text: string) => ({ width: String(text).length * 7 }),
    },
  };
});

vi.mock("@/utils/chartTheme", () => ({
  chartColor: (token: string) => `${palette.dark ? "dark" : "light"}:${token}`,
}));

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
let store: any;

const headersOf = (groups: RowGroup[], clickable = (g: RowGroup) => !g.special): GroupHeader[] =>
  groups.map((g) => ({
    title: g.special ? "Unscheduled" : g.name,
    count: String(g.rows.length),
    summary: statusCounts(g.rows),
    word: null,
    tip: `<b>${g.special ? "Unscheduled" : g.name}</b>`,
    clickable: clickable(g),
  }));

const mountMap = async (
  rows = ROWS,
  over: Partial<{
    group: MapGroup;
    selectedKey: string | null;
    highlight: string[];
    legend: boolean;
  }> = {},
) => {
  const group = over.group ?? "node";
  const { groups } = groupRows(rows, group);
  store = createStore({ state: { theme: "light" } });
  wrapper = mount(K8sHexMap, {
    props: {
      entity: "pods",
      group,
      fill: "memLim",
      groups,
      headers: headersOf(groups),
      highlight: over.highlight ?? [],
      selectedKey: over.selectedKey ?? null,
      label: raw("Map of 5 pods grouped by node, filled by Memory % of limit"),
    },
    slots: over.legend ? { legend: "<span>legend</span>" } : {},
    global: { plugins: [i18n, store] },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
};

const fakeApi = (data: number[], scale: number) => ({
  value: (dim: number) => data[dim],
  coord: ([x, y]: number[]) => [x * scale, -y * scale],
  size: () => [scale, scale],
});

const hexAt = (index: number, scale = 10) => {
  const [hexes] = options().series;
  return hexes.renderItem({ dataIndex: index }, fakeApi(hexes.data[index], scale));
};

const cardAt = (index: number, scale: number) => {
  const frames = options().series[1];
  return frames.renderItem({ dataIndex: index }, fakeApi(frames.data[index], scale));
};

const texts = (card: any) =>
  card.children.filter((c: any) => c.type === "text").map((c: any) => c.style.text as string);

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
    expect(frames.silent).toBeUndefined();
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

  it("zooms at the cursor on wheel, pans on drag in both axes, and Fit restores the fit", async () => {
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

    await wrapper.find('[data-test="k8s2-map-fit"]').trigger("click");
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
    expect(wrapper.emitted("select")).toEqual([[groupRows(ROWS, "node").groups[0].rows[1]]]);

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
    expect(options().tooltip.formatter({ seriesIndex: 1, dataIndex: 1 })).toBe("<b>n2</b>");
  });

  it("reuses the layout on a refresh that changes no keys, keeping the zoom", async () => {
    await mountMap();
    await wheel(-100, 500, 300);
    const zoomed = ranges();
    const { groups } = groupRows(
      ROWS.map((r) => ({ ...r, memoryPctOfLimit: 1 })),
      "node",
    );
    await wrapper.setProps({ groups });
    expect(ranges()).toEqual(zoomed);
  });
});

describe("K8sHexMap group cards (AC 83, 84, 85, 100)", () => {
  it("draws a surface-base card with a subtle stroke, a panel header band and silent text", async () => {
    await mountMap();
    const card = cardAt(0, 20);
    const [rect, band] = card.children;
    expect(rect).toMatchObject({ type: "rect", silent: true });
    expect(rect.style).toMatchObject({
      fill: chartColor("--color-surface-base"),
      stroke: chartColor("--color-border-subtle"),
      lineWidth: 1,
    });
    expect(rect.emphasis.style.stroke).toBe(chartColor("--color-border-strong"));
    expect(band.type).toBe("rect");
    expect(band.silent).toBeFalsy();
    expect(band.style.fill).toBe(chartColor("--color-surface-panel"));
    expect(band.shape.r.slice(2)).toEqual([0, 0]);
    for (const child of card.children.filter((c: any) => c.type === "text"))
      expect(child.silent).toBe(true);
  });

  it("shows both header lines at a 40 px band, line 1 at 20 px, and none at 10 px", async () => {
    await mountMap();
    const both = texts(cardAt(0, 20));
    expect(both.some((t) => t === "n1")).toBe(true);
    expect(both.some((t) => t.includes("✕") && t.includes("!") && t.includes("✓"))).toBe(true);
    const one = texts(cardAt(0, 10));
    expect(one).toContain("n1");
    expect(one.some((t) => t.includes("✓"))).toBe(false);
    expect(texts(cardAt(0, 5))).toEqual([]);
    expect(options().tooltip.formatter({ seriesIndex: 1, dataIndex: 0 })).toBe("<b>n1</b>");
  });

  it("mutes zero counts and colours the others by status", async () => {
    await mountMap();
    const line2 = texts(cardAt(0, 20)).find((t) => t.includes("✓"))!;
    const [error, warning, ok] = statusCounts(groupRows(ROWS, "node").groups[0].rows);
    const seg = (cls: string, glyph: string, n: number) =>
      `{${n === 0 ? "neutral" : cls}|${glyph} ${n}}`;
    expect(line2).toBe(
      [
        seg("error", "✕", error.count),
        seg("warning", "!", warning.count),
        seg("ok", "✓", ok.count),
      ].join("  "),
    );
    expect(ok.count).toBeGreaterThan(0);
    expect(error.count).toBe(0);
  });

  it("writes the status summary as ✕ ! ✓ with every count, zeros included", async () => {
    await mountMap();
    const line2 = texts(cardAt(0, 20)).find((t) => t.includes("✓"))!;
    const plain = line2.replace(/\{\w+\|([^}]*)\}/g, "$1");
    const [error, warning, ok] = statusCounts(groupRows(ROWS, "node").groups[0].rows);
    expect(plain).toBe(`✕ ${error.count}  ! ${warning.count}  ✓ ${ok.count}`);
  });

  it("always titles a workload card by its name at the fit, widening narrow cards to fit it", async () => {
    const names = Array.from({ length: 40 }, (_, i) => `service-number-${i}-with-a-long-name`);
    const rows = names.map((name, i) => ({
      ...pod(`${name}-x${i}`, "n1", 10),
      workload: { kind: "Deployment", name },
    }));
    await mountMap(rows as PodRow[], { group: "workload" });
    await wrapper.setProps({
      headers: wrapper.props("headers").map((h: GroupHeader) => ({
        ...h,
        word: { text: "deploy", tone: null },
      })),
    });
    const { x } = ranges();
    const scale = WIDTH / (x[1] - x[0]);
    const frames = options().series[1].data;
    for (let i = 0; i < frames.length; i++) {
      const [title, , line2] = texts(cardAt(i, scale));
      const name = wrapper.props("headers")[i].title as string;
      expect(title.length).toBeGreaterThanOrEqual(18);
      expect(name.startsWith(title.split("…")[0])).toBe(true);
      if (line2 !== undefined) expect(line2.startsWith("{neutral|deploy}")).toBe(true);
    }
  });

  it("makes only header bands hit targets, with a pointer only where a click goes somewhere", async () => {
    await mountMap();
    await wrapper.setProps({
      headers: headersOf(wrapper.props("groups"), (g) => g.name === "n1"),
    });
    expect(cardAt(0, 20).children[1].cursor).toBe("pointer");
    expect(cardAt(1, 20).children[1].cursor).toBe("default");
  });

  it("emits header clicks for clickable groups only, and never after a drag", async () => {
    await mountMap();
    await wrapper.setProps({
      headers: headersOf(wrapper.props("groups"), (g) => g.name === "n1"),
    });
    const chart = wrapper.findComponent({ name: "ChartRenderer" });
    chart.vm.$emit("click", { seriesIndex: 1, dataIndex: 0 });
    chart.vm.$emit("click", { seriesIndex: 1, dataIndex: 1 });
    expect(wrapper.emitted("header")).toEqual([[0]]);
    await pointer("pointerdown", 100, 100);
    await pointer("pointermove", 130, 100);
    await pointer("pointerup", 130, 100);
    chart.vm.$emit("click", { seriesIndex: 1, dataIndex: 0 });
    expect(wrapper.emitted("header")).toHaveLength(1);
  });
});

describe("K8sHexMap highlight, selection and hover (AC 86, 88)", () => {
  it("dims hexes outside the highlighted classes without moving any", async () => {
    await mountMap();
    const layout = options().series[0].data.map((d: number[]) => [d[0], d[1]]);
    await wrapper.setProps({ highlight: ["b5"] });
    const order: PodRow[] = wrapper.props("groups").flatMap((g: RowGroup) => g.rows);
    order.forEach((row, i) => {
      const b5 = (row.memoryPctOfLimit ?? 0) >= 100;
      expect(hexAt(i).style.opacity).toBe(b5 ? 1 : 0.2);
    });
    expect(order.filter((r) => (r.memoryPctOfLimit ?? 0) >= 100)).toHaveLength(1);
    expect(options().series[0].data.map((d: number[]) => [d[0], d[1]])).toEqual(layout);
    await wrapper.setProps({ highlight: [] });
    for (let i = 0; i < ROWS.length; i++) expect(hexAt(i).style.opacity).toBe(1);
  });

  it("outlines the selected hex in accent above its neighbours, and only it", async () => {
    await mountMap(ROWS, { selectedKey: "c/shop/b" });
    const order: PodRow[] = wrapper.props("groups").flatMap((g: RowGroup) => g.rows);
    order.forEach((row, i) => {
      const item = hexAt(i);
      expect(item.emphasis.style).toMatchObject({
        stroke: chartColor("--color-accent"),
        lineWidth: 2,
      });
      if (row.key === "c/shop/b") {
        expect(item.style).toMatchObject({ stroke: chartColor("--color-accent"), lineWidth: 2.5 });
        expect(item.z2).toBe(10);
      } else if (row.memoryPctOfLimit == null) {
        expect(item.style.stroke).toBe(chartColor("--color-border-default"));
      } else {
        expect(item.style.stroke).toBeUndefined();
      }
    });
  });
});

describe("K8sHexMap zoom cluster (AC 89)", () => {
  const centre = (r: ReturnType<typeof ranges>) => [(r.x[0] + r.x[1]) / 2, (r.y[0] + r.y[1]) / 2];
  const span = (r: ReturnType<typeof ranges>) => r.x[1] - r.x[0];

  it("zooms ×1.5 about the centre, back down to fit, and Fit restores the fit", async () => {
    await mountMap();
    const fitRanges = ranges();
    const zoomOut = () => wrapper.find('[data-test="k8s2-map-zoom-out"]');
    expect(zoomOut().attributes("disabled")).toBeDefined();
    await wrapper.find('[data-test="k8s2-map-zoom-in"]').trigger("click");
    expect(span(fitRanges) / span(ranges())).toBeCloseTo(1.5, 9);
    expect(centre(ranges())[0]).toBeCloseTo(centre(fitRanges)[0], 6);
    expect(centre(ranges())[1]).toBeCloseTo(centre(fitRanges)[1], 6);
    expect(zoomOut().attributes("disabled")).toBeUndefined();
    await zoomOut().trigger("click");
    expect(span(ranges())).toBeCloseTo(span(fitRanges), 9);
    for (let i = 0; i < 12; i++)
      await wrapper.find('[data-test="k8s2-map-zoom-in"]').trigger("click");
    expect(span(fitRanges) / span(ranges())).toBeCloseTo(MAX_ZOOM, 6);
    expect(wrapper.find('[data-test="k8s2-map-zoom-in"]').attributes("disabled")).toBeDefined();
    await wrapper.find('[data-test="k8s2-map-fit"]').trigger("click");
    expect(ranges()).toEqual(fitRanges);
    expect(wrapper.find('[data-test="k8s2-map-reset"]').exists()).toBe(false);
    expect(iconRegistry["fit-screen"]).toBeTruthy();
  });
});

describe("K8sHexMap on a phone (below md)", () => {
  const workloads = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      ...pod(`p${i}`, "n1", 10),
      workload: { kind: "Deployment", name: `service-${i}` },
    })) as PodRow[];
  const root = () => wrapper.find('[data-test="k8s2-map"]');

  beforeEach(() => {
    viewport.mobile = true;
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get: () => 343,
    });
  });
  afterEach(() => {
    viewport.mobile = false;
  });

  it("grows a titled grouping's canvas to its content, two readable cards per row", async () => {
    // A canvas taller than the content, as a whole height step usually is.
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get: () => 3000,
    });
    await mountMap(workloads(27), { group: "workload" });
    const classes = root().classes();
    const step = classes.find((c) => /^h-\d+$/.test(c));
    expect(step).toBeDefined();
    expect(classes).toEqual(expect.arrayContaining(["shrink-0", "w-full"]));
    expect(classes).not.toContain("flex-1");
    expect(wrapper.find('[data-test="k8s2-map-canvas"]').classes()).toContain("touch-pan-y");
    const frames = options().series[1].data as number[][];
    const perRow = new Map<number, number>();
    for (const f of frames) perRow.set(f[1], (perRow.get(f[1]) ?? 0) + 1);
    expect(Math.max(...perRow.values())).toBe(2);
    const units = Math.max(...frames.map((f) => -f[3]));
    const neededPx = units * 17 + 2 * 0.04 * 343 + wrapper.vm.bottomInset;
    expect(Number(step!.slice(2)) * 4).toBeGreaterThanOrEqual(neededPx);
    const { y } = ranges();
    const scale = 3000 / (y[1] - y[0]);
    expect((y[1] - 0) * scale).toBeCloseTo(0.04 * 343, 6);
  });

  const renderedScale = () => {
    const { x } = ranges();
    return 343 / (x[1] - x[0]);
  };

  it("renders a single card at exactly 17 px per unit", async () => {
    await mountMap(workloads(1), { group: "workload" });
    expect(renderedScale()).toBeCloseTo(17, 9);
  });

  it("renders two 16-pod cards side by side at 17 px per unit", async () => {
    const rows = [0, 1].flatMap((w) =>
      Array.from({ length: 16 }, (_, i) => ({
        ...pod(`p${w}-${i}`, "n1", 10),
        workload: { kind: "Deployment", name: `service-${w}` },
      })),
    ) as PodRow[];
    await mountMap(rows, { group: "workload" });
    expect(renderedScale()).toBeCloseTo(17, 9);
    const [a, b] = options().series[1].data;
    expect(b[1]).toBe(a[1]);
  });

  it("keeps 17 px per unit for 300 workloads, scrolling inside a screen-high canvas", async () => {
    const rows = Array.from({ length: 5000 }, (_, i) => ({
      ...pod(`p${i}`, "n1", 10),
      workload: { kind: "Deployment", name: `service-${i % 300}` },
    })) as PodRow[];
    await mountMap(rows, { group: "workload", legend: true });
    expect(renderedScale()).toBeCloseTo(17, 9);
    expect(root().classes()).toContain("flex-1");
    expect(wrapper.find('[data-test="k8s2-map-canvas"]').classes()).toContain("touch-none");
    expect(options().grid.bottom).toBe(wrapper.vm.bottomInset);
  });

  it("keeps node grouping on one screen", async () => {
    await mountMap(ROWS, { group: "node" });
    expect(root().classes()).toContain("flex-1");
    expect(wrapper.find('[data-test="k8s2-map-canvas"]').classes()).toContain("touch-none");
  });
});

describe("K8sHexMap overlays and theme (AC 90, 98)", () => {
  it("reserves the taller overlay plus 1rem, in the root font size", async () => {
    const heights = { legend: 40, zoom: 36 };
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get(this: HTMLElement) {
        const id = this.getAttribute("data-test");
        return id === "k8s2-map-legend"
          ? heights.legend
          : id === "k8s2-map-zoom"
            ? heights.zoom
            : 0;
      },
    });
    let fontSize = "16px";
    const real = window.getComputedStyle;
    vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element) =>
      el === document.documentElement ? ({ fontSize } as CSSStyleDeclaration) : real(el),
    );
    await mountMap(ROWS, { legend: true });
    expect(wrapper.vm.bottomInset).toBe(56);
    fontSize = "20px";
    wrapper.vm.measure();
    expect(wrapper.vm.bottomInset).toBe(60);
    delete (HTMLElement.prototype as any).offsetHeight;
    vi.restoreAllMocks();
  });

  it("re-reads the palette when the theme changes", async () => {
    await mountMap();
    const before = options();
    expect(cardAt(0, 20).children[0].style.fill).toBe("light:--color-surface-base");
    palette.dark = true;
    store.state.theme = "dark";
    await flushPromises();
    expect(options()).not.toBe(before);
    expect(cardAt(0, 20).children[0].style.fill).toBe("dark:--color-surface-base");
    palette.dark = false;
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
    it.each([
      "--color-map-seq-1",
      "--color-map-seq-2",
      "--color-map-seq-3",
      "--color-map-seq-4",
      "--color-map-seq-5",
      "--color-status-positive",
      "--color-status-warning-text",
      "--color-status-negative",
    ])(`%s keeps 3:1 on the surface-base card in ${theme} (AC 100)`, async (token) => {
      const scope = themes[theme];
      const fg = resolveColor(token, scope);
      const bg = resolveColor("--color-surface-base", scope);
      expect(fg && bg).toBeTruthy();
      expect(contrastRatio(fg!, bg!)).toBeGreaterThanOrEqual(3);
    });
  }
});

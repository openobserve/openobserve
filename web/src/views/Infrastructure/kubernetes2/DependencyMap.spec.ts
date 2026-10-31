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
import i18n from "@/locales";
import { raw } from "@/types/i18n";
import DependencyMap, { type MapEdge, type MapNode } from "./DependencyMap.vue";
import { routeEdge } from "./dependencyMapGeometry";

const setViewport = vi.fn();

// VueFlow measures the DOM, which jsdom cannot do, so this stand-in renders every node and edge through the
// map's own slots and passes the rest through.
vi.mock("@vue-flow/core", () => ({
  VueFlow: {
    name: "VueFlow",
    props: ["nodes", "edges"],
    emits: [
      "node-click",
      "edge-click",
      "pane-click",
      "node-mouse-enter",
      "node-mouse-leave",
      "edge-mouse-enter",
      "edge-mouse-leave",
      "nodes-initialized",
    ],
    template: `
      <div class="mock-vue-flow">
        <slot />
        <div v-for="n in nodes" :key="n.id" class="vue-flow__node" :data-id="n.id">
          <slot name="node-end" :id="n.id" :data="n.data" />
        </div>
        <div class="vue-flow__edge-labels" />
        <template v-for="e in edges" :key="e.id">
          <slot name="edge-flow" v-bind="{ ...e, sourceX: 100, sourceY: 0, targetX: 100, targetY: 80 }" />
        </template>
      </div>
    `,
  },
  BaseEdge: {
    name: "BaseEdge",
    props: ["id", "path", "style", "markerEnd"],
    template: "<i />",
  },
  Handle: { name: "Handle", template: "<i />" },
  MarkerType: { ArrowClosed: "arrowclosed" },
  Position: { Left: "left", Right: "right" },
  useVueFlow: () => ({
    setViewport,
    dimensions: { value: { width: 1000, height: 600 } },
    viewport: { value: { x: 0, y: 0, zoom: 1 } },
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    areNodesInitialized: { value: true },
  }),
}));
vi.mock("@vue-flow/background", () => ({ Background: { template: "<i />" } }));

const node = (id: string, x: number, clickable = true, y = 0): MapNode => ({
  id,
  position: { x, y },
  label: id,
  detail: raw("Deployment in shop"),
  title: id,
  icon: "layers",
  color: "var(--color-chart-series-1)",
  clickable,
  total: 100,
});

const edge = (source: string, target: string, total: number, directed = true): MapEdge => ({
  id: `${source}-${target}`,
  source,
  target,
  directed,
  total,
  waypoints: [],
});

// Ends stacked in one column, a card's slot apart, so each edge's label has room of its own.
const stack = (count: number) =>
  Array.from({ length: count }, (_, i) => node(`w${i}`, 0, true, i * 92));

describe("DependencyMap", () => {
  let wrapper: VueWrapper<any>;

  // A tick for the pills to reach the label layer once the map has drawn it.
  const mountMap = async (nodes: MapNode[], edges: MapEdge[]) => {
    wrapper = mount(DependencyMap, {
      props: { nodes, edges, selectedEdgeId: null, label: raw("Map") },
      global: { plugins: [i18n] },
    });
    await flushPromises();
    return wrapper;
  };

  const flow = () => wrapper.findComponent({ name: "VueFlow" });
  const baseEdge = (id: string) =>
    wrapper.findAllComponents({ name: "BaseEdge" }).find((e) => e.props("id") === id)!;
  const hoveredLabel = () => wrapper.find('[data-test="dependency-map-hovered-label"]');
  // A resting rate pill, by its edge.
  const pill = (id: string) =>
    wrapper.find(`[data-test="dependency-map-label"][data-edge="${id}"]`);
  const pills = () =>
    wrapper.findAll('[data-test="dependency-map-label"]').map((p) => p.attributes("data-edge"));
  const card = (id: string) => wrapper.find(`[data-id="${id}"] [data-test="dependency-map-node"]`);

  afterEach(() => wrapper?.unmount());

  it("leaves each edge from the side that faces its target, and loops one within a column", async () => {
    await mountMap(
      [node("a", 0), node("b", 340), node("c", 340)],
      [edge("a", "b", 10), edge("b", "a", 10), edge("b", "c", 10, false)],
    );
    const handles = flow()
      .props("edges")
      .map((e: any) => [e.id, e.sourceHandle, e.targetHandle, e.markerEnd?.type]);
    expect(handles).toEqual([
      ["a-b", "sr", "tl", "arrowclosed"],
      ["b-a", "sl", "tr", "arrowclosed"],
      ["b-c", "sr", "tr", undefined],
    ]);
    // Vue Flow hands every edge a marker reference; an undirected one draws none.
    expect(baseEdge("b-c").props("markerEnd")).toBeUndefined();
  });

  it("draws each edge along its route from the layout", async () => {
    await mountMap(
      [node("a", 0), node("b", 0, true, 200), node("c", 576)],
      [edge("a", "b", 10), { ...edge("a", "c", 10), waypoints: [{ x: 288, y: 300 }] }],
    );
    expect(baseEdge("a-b").props("path")).toBe(
      routeEdge({ x: 0, y: 0 }, { x: 0, y: 200 }, []).path,
    );
    expect(baseEdge("a-c").props("path")).toBe(
      routeEdge({ x: 0, y: 0 }, { x: 576, y: 0 }, [{ x: 288, y: 300 }]).path,
    );
  });

  it("fits the whole map, and the edges routed past it, from the fit button", async () => {
    await mountMap(
      [node("a", 0), node("b", 2000)],
      [{ ...edge("a", "b", 10), waypoints: [{ x: 1000, y: 3000 }] }],
    );
    setViewport.mockClear();
    await wrapper.find('[data-test="dependency-map-fit"]').trigger("click");
    const [view] = setViewport.mock.calls[0];
    // Tall enough for the waypoint far below the cards, so the zoom is set by height.
    expect(view.zoom).toBeLessThan(600 / 3000);
  });

  it("lists the cards for Tab in reading order, column by column", async () => {
    await mountMap([node("c", 340), node("b", 0, true, 92), node("a", 0)], []);
    expect(
      flow()
        .props("nodes")
        .map((n: any) => n.id),
    ).toEqual(["a", "b", "c"]);
  });

  it("dismisses the selection from empty map space, and lights the selected edge", async () => {
    await mountMap(
      [node("a", 0), node("b", 340, true, 92), node("c", 340)],
      [edge("a", "b", 10), edge("a", "c", 10)],
    );
    await wrapper.setProps({ selectedEdgeId: "a-b" });
    expect(baseEdge("a-b").props("style")).toMatchObject({ opacity: 1 });
    expect(baseEdge("a-b").props("style").filter).toContain("drop-shadow");
    expect(baseEdge("a-c").props("style").opacity).toBeLessThan(0.5);
    await flow().vm.$emit("pane-click");
    expect(wrapper.emitted("select")).toEqual([[null]]);
  });

  it("labels only the busiest edges with their rate", async () => {
    const ends = stack(10);
    await mountMap(
      [...ends, node("api", 340)],
      ends.map((n, i) => edge(n.id, "api", 1000 * (i + 1))),
    );
    expect(pill("w0-api").exists()).toBe(false);
    expect(pill("w1-api").exists()).toBe(false);
    expect(pill("w9-api").text()).toMatch(/KB\/s/);
    expect(pills()).toHaveLength(8);
    expect(card("api").text()).toContain("10 connections");
  });

  it("dims what a hovered card does not talk to, and its labels follow the hover", async () => {
    await mountMap(
      [node("a", 0), node("b", 340), node("c", 680)],
      [edge("a", "b", 10), edge("b", "c", 10)],
    );
    await flow().vm.$emit("node-mouse-enter", { node: { id: "a" } });
    expect(card("c").classes()).toContain("opacity-30");
    expect(card("b").classes()).not.toContain("opacity-30");
    expect(baseEdge("b-c").props("style").opacity).toBeLessThan(0.2);
    expect(pill("b-c").exists()).toBe(false);
    expect(pill("a-b").exists()).toBe(true);
    await flow().vm.$emit("node-mouse-leave");
    expect(card("c").classes()).not.toContain("opacity-30");
  });

  it("labels only a hovered hub's busiest edges", async () => {
    const ends = stack(12);
    await mountMap(
      [...ends, node("api", 340), node("db", 680)],
      [...ends.map((n, i) => edge(n.id, "api", 1000 * (i + 1))), edge("api", "db", 50_000)],
    );
    await flow().vm.$emit("node-mouse-enter", { node: { id: "api" } });
    const shown = pills();
    expect(shown).toHaveLength(8);
    expect(shown).toContain("api-db");
    expect(shown).not.toContain("w0-api");
    await flow().vm.$emit("edge-mouse-enter", { edge: { id: "w0-api" } });
    expect(hoveredLabel().text()).toMatch(/KB\/s/);
  });

  it("shows a hovered edge's rate even when it is not among the busiest", async () => {
    const ends = stack(10);
    await mountMap(
      [...ends, node("api", 340)],
      ends.map((n, i) => edge(n.id, "api", 1000 * (i + 1))),
    );
    await flow().vm.$emit("edge-mouse-enter", { edge: { id: "w1-api" } });
    expect(hoveredLabel().text()).toBe("2.0KB/s");
    expect(baseEdge("w1-api").props("style").opacity).toBe(1);
    await flow().vm.$emit("edge-mouse-leave");
    expect(hoveredLabel().exists()).toBe(false);
    expect(pill("w1-api").exists()).toBe(false);
  });

  it("keeps the other labels where they are while an edge is hovered", async () => {
    const ends = stack(10);
    await mountMap(
      [...ends, node("api", 340)],
      ends.map((n, i) => edge(n.id, "api", 1000 * (i + 1))),
    );
    const at = () =>
      Object.fromEntries(
        wrapper
          .findAll('[data-test="dependency-map-label"]')
          .map((p) => [p.attributes("data-edge"), p.attributes("style")]),
      );
    const before = at();
    const edges = flow().props("edges");
    await flow().vm.$emit("edge-mouse-enter", { edge: { id: "w0-api" } });
    // Each pill still shown is where it was; one the hovered pill would cover is hidden, not moved.
    for (const [id, style] of Object.entries(at())) expect(style).toBe(before[id]);
    // Hovering leaves Vue Flow's edges alone; the hovered label is drawn in the label layer instead.
    expect(flow().props("edges")).toBe(edges);
    expect(hoveredLabel().exists()).toBe(true);
    await flow().vm.$emit("edge-mouse-leave");
    expect(flow().props("edges")).toBe(edges);
  });

  it("hides a resting pill the hovered edge's pill would cover", async () => {
    // Two edges into one gap a few pixels apart, so their pills would sit on each other.
    await mountMap(
      [node("a", 0), node("b", 0, true, 12), node("c", 340), node("d", 340, true, 12)],
      [edge("a", "c", 2000), edge("b", "d", 10)],
    );
    expect(pills()).toEqual(["a-c"]);
    await flow().vm.$emit("edge-mouse-enter", { edge: { id: "b-d" } });
    expect(hoveredLabel().exists()).toBe(true);
    expect(pills()).toEqual([]);
  });

  it("starts a map too big to read whole at a readable zoom, from its top-left", async () => {
    await mountMap(
      Array.from({ length: 12 }, (_, i) => node(`c${i}`, i * 312)),
      [],
    );
    setViewport.mockClear();
    await flow().vm.$emit("nodes-initialized");
    const [view] = setViewport.mock.calls[0];
    expect(view.zoom).toBe(0.75);
    // The left-most card's left edge, plus the margin, at the pane's left.
    expect(view.x).toBeCloseTo(32 * 0.75);
  });

  it("treats a pill as part of its edge: hovering it lights the edge, clicking it selects the edge", async () => {
    await mountMap([node("a", 0), node("b", 340)], [edge("a", "b", 2000)]);
    await pill("a-b").trigger("mouseenter");
    expect(hoveredLabel().exists()).toBe(true);
    expect(baseEdge("a-b").props("style").opacity).toBe(1);
    await hoveredLabel().trigger("click");
    expect(wrapper.emitted("select")).toEqual([["a-b"]]);
    await hoveredLabel().trigger("mouseleave");
    expect(hoveredLabel().exists()).toBe(false);
  });

  it("refits on a resize with the floor the last fit used", async () => {
    let resized = () => {};
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resized = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    try {
      await mountMap(
        Array.from({ length: 12 }, (_, i) => node(`c${i}`, i * 312)),
        [],
      );
      await wrapper.find('[data-test="dependency-map-fit"]').trigger("click");
      const whole = setViewport.mock.calls.at(-1)![0].zoom;
      expect(whole).toBeLessThan(0.75);
      setViewport.mockClear();
      vi.useFakeTimers();
      resized();
      vi.advanceTimersByTime(200);
      expect(setViewport.mock.calls.at(-1)![0].zoom).toBe(whole);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it("makes a clickable card a named button, and leaves the others plain", async () => {
    await mountMap([node("a", 0), node("net", 340, false)], [edge("a", "net", 10)]);
    expect(card("a").attributes("role")).toBe("button");
    expect(card("a").attributes("tabindex")).toBe("0");
    expect(card("a").attributes("aria-label")).toMatch(
      /^Open details for a: Deployment in shop, 1 connection/,
    );
    expect(card("net").attributes("role")).toBeUndefined();
    expect(card("net").attributes("tabindex")).toBeUndefined();
    expect(
      flow()
        .props("nodes")
        .every((n: any) => n.focusable === false),
    ).toBe(true);
  });

  it("names its zoom buttons", async () => {
    await mountMap([node("a", 0)], []);
    const names = ["zoom-in", "zoom-out", "fit"].map((id) =>
      wrapper.find(`[data-test="dependency-map-${id}"]`).attributes("aria-label"),
    );
    expect(names).toEqual(["Zoom in", "Zoom out", "Fit to view"]);
  });

  it("opens a clickable card from Enter or Space, and not one that is not", async () => {
    await mountMap([node("a", 0), node("net", 340, false)], [edge("a", "net", 10)]);
    await card("a").trigger("keydown", { key: "Enter" });
    await card("a").trigger("keydown", { key: " " });
    await card("net").trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("open")).toEqual([["a"], ["a"]]);
  });

  it("opens a clickable card and selects an edge on click", async () => {
    await mountMap([node("a", 0), node("net", 340, false)], [edge("a", "net", 10)]);
    await flow().vm.$emit("node-click", { node: { id: "net", data: { clickable: false } } });
    await flow().vm.$emit("node-click", { node: { id: "a", data: { clickable: true } } });
    await flow().vm.$emit("edge-click", { edge: { id: "a-net" } });
    expect(wrapper.emitted("open")).toEqual([["a"]]);
    expect(wrapper.emitted("select")).toEqual([["a-net"]]);
  });
});

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
import { mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import { raw } from "@/types/i18n";
import DependencyMap, { loopPath, type MapEdge, type MapNode } from "./DependencyMap.vue";

const fitView = vi.fn();

// VueFlow measures the DOM, which jsdom cannot do, so this stand-in renders every node and edge through the
// map's own slots and passes the rest through.
vi.mock("@vue-flow/core", () => ({
  VueFlow: {
    name: "VueFlow",
    props: ["nodes", "edges"],
    emits: [
      "node-click",
      "edge-click",
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
        <template v-for="e in edges" :key="e.id">
          <slot name="edge-flow" v-bind="{ ...e, sourceX: 100, sourceY: 0, targetX: 100, targetY: 80 }" />
        </template>
      </div>
    `,
  },
  BaseEdge: { name: "BaseEdge", props: ["id", "path", "style", "label"], template: "<i />" },
  Handle: { name: "Handle", template: "<i />" },
  MarkerType: { ArrowClosed: "arrowclosed" },
  Position: { Left: "left", Right: "right" },
  getBezierPath: () => ["M0 0", 0, 0],
  useVueFlow: () => ({
    fitView,
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    areNodesInitialized: { value: true },
  }),
}));
vi.mock("@vue-flow/background", () => ({ Background: { template: "<i />" } }));

const node = (id: string, x: number, clickable = true): MapNode => ({
  id,
  position: { x, y: 0 },
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
});

describe("DependencyMap", () => {
  let wrapper: VueWrapper<any>;

  const mountMap = (nodes: MapNode[], edges: MapEdge[]) => {
    wrapper = mount(DependencyMap, {
      props: { nodes, edges, selectedEdgeId: null, label: raw("Map") },
      global: { plugins: [i18n] },
    });
    return wrapper;
  };

  const flow = () => wrapper.findComponent({ name: "VueFlow" });
  const baseEdge = (id: string) =>
    wrapper.findAllComponents({ name: "BaseEdge" }).find((e) => e.props("id") === id)!;
  const card = (id: string) => wrapper.find(`[data-id="${id}"] [data-test="dependency-map-node"]`);

  afterEach(() => wrapper?.unmount());

  it("leaves each edge from the side that faces its target, and loops one within a column", () => {
    mountMap(
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
  });

  it("bows an edge within a column out to the right, with its label at the tip", () => {
    const [path, x, y] = loopPath(100, 0, 100, 80);
    // 40 plus a quarter of the 80 between the ends.
    expect(path).toBe("M100,0 C160,0 160,80 100,80");
    expect([x, y]).toEqual([145, 40]);
    mountMap(
      [node("a", 0), node("b", 0), node("c", 340)],
      [edge("a", "b", 10), edge("a", "c", 10)],
    );
    expect(baseEdge("a-b").props("path")).toBe(path);
    expect(baseEdge("a-c").props("path")).toBe("M0 0");
  });

  it("fits the whole map from the fit button, past the zoom the automatic fit stops at", async () => {
    mountMap([node("a", 0)], []);
    fitView.mockClear();
    await wrapper.find('[data-test="dependency-map-fit"]').trigger("click");
    expect(fitView).toHaveBeenCalledWith(expect.objectContaining({ minZoom: 0.1 }));
  });

  it("labels only the busiest edges with their rate", () => {
    const ends = Array.from({ length: 10 }, (_, i) => node(`w${i}`, 0));
    mountMap(
      [...ends, node("api", 340)],
      ends.map((n, i) => edge(n.id, "api", 1000 * (i + 1))),
    );
    expect(baseEdge("w0-api").props("label")).toBeUndefined();
    expect(baseEdge("w1-api").props("label")).toBeUndefined();
    expect(baseEdge("w9-api").props("label")).toMatch(/KB\/s/);
    expect(card("api").text()).toContain("10 connections");
  });

  it("dims what a hovered card does not talk to, and its labels follow the hover", async () => {
    mountMap(
      [node("a", 0), node("b", 340), node("c", 680)],
      [edge("a", "b", 10), edge("b", "c", 10)],
    );
    await flow().vm.$emit("node-mouse-enter", { node: { id: "a" } });
    expect(card("c").classes()).toContain("opacity-30");
    expect(card("b").classes()).not.toContain("opacity-30");
    expect(baseEdge("b-c").props("style").opacity).toBeLessThan(0.2);
    expect(baseEdge("b-c").props("label")).toBeUndefined();
    expect(baseEdge("a-b").props("label")).toBeDefined();
    await flow().vm.$emit("node-mouse-leave");
    expect(card("c").classes()).not.toContain("opacity-30");
  });

  it("shows a hovered edge's rate even when it is not among the busiest", async () => {
    const ends = Array.from({ length: 10 }, (_, i) => node(`w${i}`, 0));
    mountMap(
      [...ends, node("api", 340)],
      ends.map((n, i) => edge(n.id, "api", 1000 * (i + 1))),
    );
    await flow().vm.$emit("edge-mouse-enter", { edge: { id: "w1-api" } });
    expect(baseEdge("w1-api").props("label")).toMatch(/KB\/s/);
    expect(baseEdge("w1-api").props("style").opacity).toBe(1);
    await flow().vm.$emit("edge-mouse-leave");
    expect(baseEdge("w1-api").props("label")).toBeUndefined();
  });

  it("makes a clickable card a named button, and leaves the others plain", () => {
    mountMap([node("a", 0), node("net", 340, false)], [edge("a", "net", 10)]);
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

  it("names its zoom buttons", () => {
    mountMap([node("a", 0)], []);
    const names = ["zoom-in", "zoom-out", "fit"].map((id) =>
      wrapper.find(`[data-test="dependency-map-${id}"]`).attributes("aria-label"),
    );
    expect(names).toEqual(["Zoom in", "Zoom out", "Fit to view"]);
  });

  it("opens a clickable card from Enter or Space, and not one that is not", async () => {
    mountMap([node("a", 0), node("net", 340, false)], [edge("a", "net", 10)]);
    await card("a").trigger("keydown", { key: "Enter" });
    await card("a").trigger("keydown", { key: " " });
    await card("net").trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("open")).toEqual([["a"], ["a"]]);
  });

  it("opens a clickable card and selects an edge on click", async () => {
    mountMap([node("a", 0), node("net", 340, false)], [edge("a", "net", 10)]);
    await flow().vm.$emit("node-click", { node: { id: "net", data: { clickable: false } } });
    await flow().vm.$emit("node-click", { node: { id: "a", data: { clickable: true } } });
    await flow().vm.$emit("edge-click", { edge: { id: "a-net" } });
    expect(wrapper.emitted("open")).toEqual([["a"]]);
    expect(wrapper.emitted("select")).toEqual([["a-net"]]);
  });
});

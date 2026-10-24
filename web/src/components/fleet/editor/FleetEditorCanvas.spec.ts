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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent } from "vue";
import i18n from "@/locales";
import FleetEditorCanvas from "./FleetEditorCanvas.vue";
import { seedGraph } from "./editorGraph";
import { SEEDS } from "./editorGraph.fixtures";

const flow = vi.hoisted(() => ({
  fitView: vi.fn(async () => true),
  getViewport: vi.fn(() => ({ x: 0, y: 0, zoom: 1 })),
  setViewport: vi.fn(),
  setCenter: vi.fn(),
  findNode: vi.fn(),
  dimensions: { value: { width: 800, height: 600 } },
  screenToFlowCoordinate: vi.fn(),
}));

vi.mock("@vue-flow/core", () => ({
  VueFlow: defineComponent({
    name: "VueFlow",
    emits: ["nodes-initialized", "node-click", "pane-click"],
    template: "<div data-test='vue-flow-stub' />",
  }),
  useVueFlow: () => flow,
}));

vi.mock("@vue-flow/background", () => ({
  Background: defineComponent({ name: "Background", template: "<div />" }),
  BackgroundVariant: { Dots: "dots" },
}));

const frames = () => new Promise((resolve) => setTimeout(resolve, 50));

let wrapper: VueWrapper;

async function initialize() {
  wrapper.findComponent({ name: "VueFlow" }).vm.$emit("nodes-initialized");
  await flushPromises();
  await frames();
}

beforeEach(() => {
  vi.clearAllMocks();
  wrapper = mount(FleetEditorCanvas, {
    props: {
      graph: seedGraph(),
      selectedNode: null,
      selectedPipeline: null,
      issues: {},
      dirty: false,
    },
    global: { plugins: [i18n] },
  });
});

describe("FleetEditorCanvas", () => {
  it("fits the graph below the floating toolbar", async () => {
    const height = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(56);
    await initialize();
    expect(flow.fitView).toHaveBeenCalledWith({
      padding: { top: "72px", right: "16px", bottom: "16px", left: "16px" },
      maxZoom: 1,
    });
    flow.getViewport.mockReturnValue({ x: 0, y: 0, zoom: 0.5 });
    await wrapper.find('[data-test="fleet-editor-canvas-fit"]').trigger("click");
    await frames();
    expect(flow.setViewport).toHaveBeenCalledWith({ x: 32, y: 72, zoom: 0.75 });
    height.mockRestore();
    flow.getViewport.mockReturnValue({ x: 0, y: 0, zoom: 1 });
  });

  it("fits the graph on its first measure only, so later adds keep the user's pan and zoom", async () => {
    await initialize();
    expect(flow.fitView).toHaveBeenCalledTimes(1);
    flow.fitView.mockClear();
    flow.setViewport.mockClear();
    flow.getViewport.mockReturnValue({ x: -240, y: 60, zoom: 0.6 });
    await wrapper.setProps({ graph: SEEDS["edge-minimal"]() });
    await initialize();
    expect(flow.fitView).not.toHaveBeenCalled();
    expect(flow.setViewport).not.toHaveBeenCalled();
    flow.getViewport.mockReturnValue({ x: 0, y: 0, zoom: 1 });
  });

  it("fits again after an auto layout", async () => {
    await initialize();
    await wrapper.find('[data-test="fleet-editor-canvas-auto-layout"]').trigger("click");
    await initialize();
    expect(flow.fitView).toHaveBeenCalledTimes(2);
  });

  it("pans a node the side panel hid back into view at the same zoom, and leaves a visible one alone", async () => {
    flow.getViewport.mockReturnValue({ x: 0, y: 0, zoom: 0.8 });
    const node = (x: number) => ({
      computedPosition: { x, y: 100 },
      dimensions: { width: 208, height: 60 },
    });
    const vm = wrapper.vm as unknown as { reveal: (id: string) => void };
    flow.findNode.mockReturnValue(node(100));
    vm.reveal("logs|receiver:otlp");
    await frames();
    expect(flow.setCenter).not.toHaveBeenCalled();
    flow.findNode.mockReturnValue(node(1000));
    vm.reveal("logs|exporter:debug");
    await frames();
    expect(flow.setCenter).toHaveBeenCalledWith(1104, 130, { zoom: 0.8, duration: 300 });
  });

  it("treats the strip under the toolbar as hidden and centres the node below it", async () => {
    const height = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(56);
    flow.getViewport.mockReturnValue({ x: 0, y: 0, zoom: 0.8 });
    flow.findNode.mockReturnValue({
      computedPosition: { x: 100, y: 20 },
      dimensions: { width: 208, height: 60 },
    });
    (wrapper.vm as unknown as { reveal: (id: string) => void }).reveal("logs|receiver:otlp");
    await frames();
    expect(flow.setCenter).toHaveBeenCalledWith(204, 50 - 28 / 0.8, { zoom: 0.8, duration: 300 });
    height.mockRestore();
  });

  it("offers Clear canvas as a quiet icon button that still emits clear", async () => {
    const clear = wrapper.find('[data-test="fleet-editor-canvas-clear"]');
    const button = wrapper
      .findAllComponents({ name: "OButton" })
      .find((b) => b.attributes("data-test") === "fleet-editor-canvas-clear")!;
    expect(button.props()).toMatchObject({ variant: "outline", size: "icon-sm" });
    expect(clear.attributes("aria-label")).toBe("Clear canvas");
    expect(clear.text()).toBe("");
    await clear.trigger("click");
    expect(wrapper.emitted("clear")).toHaveLength(1);
  });
});

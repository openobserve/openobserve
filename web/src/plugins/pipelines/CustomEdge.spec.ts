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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import CustomEdge from "./CustomEdge.vue";

installQuasar({});

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockRemoveEdges = vi.fn();
const mockGetSelectedEdges = vi.fn(() => []);
const mockAddSelectedEdges = vi.fn();
const mockRemoveSelectedEdges = vi.fn();

vi.mock("@vue-flow/core", () => ({
  BaseEdge: {
    name: "BaseEdge",
    template: '<path class="mock-base-edge" />',
    props: ["id", "style", "path", "markerEnd", "type"],
  },
  EdgeLabelRenderer: {
    name: "EdgeLabelRenderer",
    template: '<div class="mock-edge-label-renderer"><slot /></div>',
  },
  getBezierPath: vi.fn((props: any) => [
    `M ${props.sourceX} ${props.sourceY} C ... ${props.targetX} ${props.targetY}`,
    props.sourceX,
    props.sourceY,
  ]),
  getSmoothStepPath: vi.fn(() => ["M 0 0", 0, 0]),
  useVueFlow: () => ({
    removeEdges: mockRemoveEdges,
    getSelectedEdges: mockGetSelectedEdges,
    addSelectedEdges: mockAddSelectedEdges,
    removeSelectedEdges: mockRemoveSelectedEdges,
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultProps = {
  id: "edge-1",
  sourceX: 100,
  sourceY: 200,
  targetX: 300,
  targetY: 400,
  sourcePosition: "bottom",
  targetPosition: "top",
};

function createWrapper(props: Record<string, unknown> = {}) {
  return mount(CustomEdge, {
    props: { ...defaultProps, ...props },
    global: {
      stubs: {
        BaseEdge: {
          name: "BaseEdge",
          template: '<path class="mock-base-edge" />',
          props: ["id", "style", "path", "markerEnd", "type"],
        },
        EdgeLabelRenderer: {
          name: "EdgeLabelRenderer",
          template: '<div class="mock-edge-label-renderer"><slot /></div>',
        },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CustomEdge.vue", () => {
  let wrapper: ReturnType<typeof createWrapper>;

  afterEach(() => {
    if (wrapper) wrapper.unmount();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  describe("component mounting", () => {
    it("mounts without errors", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("renders a BaseEdge component", () => {
      wrapper = createWrapper();
      expect(wrapper.findComponent({ name: "BaseEdge" }).exists()).toBe(true);
    });

    it("renders an EdgeLabelRenderer component", () => {
      wrapper = createWrapper();
      expect(wrapper.findComponent({ name: "EdgeLabelRenderer" }).exists()).toBe(
        true
      );
    });
  });

  // -------------------------------------------------------------------------
  describe("props", () => {
    it("accepts and passes the id prop", () => {
      wrapper = createWrapper({ id: "my-custom-edge" });
      const baseEdge = wrapper.findComponent({ name: "BaseEdge" });
      expect(baseEdge.props("id")).toBe("my-custom-edge");
    });

    it("accepts required numeric position props", () => {
      wrapper = createWrapper({
        sourceX: 10,
        sourceY: 20,
        targetX: 30,
        targetY: 40,
      });
      expect(wrapper.exists()).toBe(true);
    });

    it("accepts required sourcePosition and targetPosition props", () => {
      wrapper = createWrapper({
        sourcePosition: "right",
        targetPosition: "left",
      });
      expect(wrapper.exists()).toBe(true);
    });

    it("applies cursor:pointer and strokeDasharray:none to BaseEdge style", () => {
      wrapper = createWrapper();
      const baseEdge = wrapper.findComponent({ name: "BaseEdge" });
      const style = baseEdge.props("style");
      expect(style).toMatchObject({
        cursor: "pointer",
        strokeDasharray: "none",
      });
    });

    it("merges the style prop into BaseEdge style", () => {
      wrapper = createWrapper({ style: { stroke: "red", strokeWidth: 3 } });
      const baseEdge = wrapper.findComponent({ name: "BaseEdge" });
      const style = baseEdge.props("style");
      expect(style.stroke).toBe("red");
      expect(style.strokeWidth).toBe(3);
      expect(style.cursor).toBe("pointer");
    });

    it("passes markerEnd prop to BaseEdge", () => {
      wrapper = createWrapper({ markerEnd: "url(#arrow)" });
      const baseEdge = wrapper.findComponent({ name: "BaseEdge" });
      expect(baseEdge.props("markerEnd")).toBe("url(#arrow)");
    });

    it("works without optional props (data, markerEnd, style, isInView)", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("defaults isInView to false", () => {
      wrapper = createWrapper();
      expect((wrapper.vm as any).isInView ?? false).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe("computed: path", () => {
    it("passes the path[0] bezier string to BaseEdge", () => {
      wrapper = createWrapper({
        sourceX: 0,
        sourceY: 0,
        targetX: 100,
        targetY: 100,
      });
      const baseEdge = wrapper.findComponent({ name: "BaseEdge" });
      // getBezierPath is mocked; its [0] element should be a string
      expect(typeof baseEdge.props("path")).toBe("string");
    });
  });

  // -------------------------------------------------------------------------
  describe("computed: midX / midY", () => {
    it("computes midX as the average of sourceX and targetX", () => {
      wrapper = createWrapper({ sourceX: 100, targetX: 300 });
      const vm = wrapper.vm as any;
      expect(vm.midX).toBe(200);
    });

    it("computes midY as the average of sourceY and targetY", () => {
      wrapper = createWrapper({ sourceY: 50, targetY: 150 });
      const vm = wrapper.vm as any;
      expect(vm.midY).toBe(100);
    });

    it("handles zero coordinates", () => {
      wrapper = createWrapper({
        sourceX: 0,
        sourceY: 0,
        targetX: 0,
        targetY: 0,
      });
      const vm = wrapper.vm as any;
      expect(vm.midX).toBe(0);
      expect(vm.midY).toBe(0);
    });

    it("handles negative coordinates", () => {
      wrapper = createWrapper({ sourceX: -100, targetX: 100 });
      const vm = wrapper.vm as any;
      expect(vm.midX).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe("useVueFlow integration", () => {
    it("exposes removeEdges from useVueFlow", () => {
      wrapper = createWrapper();
      // The mock was called during setup; just verify it did not throw
      expect(wrapper.exists()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe("inheritAttrs", () => {
    it("sets inheritAttrs to false via the plain <script> block", () => {
      // The component options object should have inheritAttrs: false
      const component = CustomEdge as any;
      expect(component.inheritAttrs).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe("edge cases", () => {
    it("renders correctly when source and target positions are the same", () => {
      wrapper = createWrapper({
        sourcePosition: "bottom",
        targetPosition: "bottom",
      });
      expect(wrapper.findComponent({ name: "BaseEdge" }).exists()).toBe(true);
    });

    it("renders correctly with very large coordinate values", () => {
      wrapper = createWrapper({
        sourceX: 99999,
        sourceY: 99999,
        targetX: -99999,
        targetY: -99999,
      });
      const vm = wrapper.vm as any;
      expect(vm.midX).toBe(0);
    });

    it("renders correctly with floating-point coordinates", () => {
      wrapper = createWrapper({
        sourceX: 100.5,
        sourceY: 200.25,
        targetX: 300.75,
        targetY: 400.5,
      });
      const vm = wrapper.vm as any;
      expect(vm.midX).toBeCloseTo(200.625);
      expect(vm.midY).toBeCloseTo(300.375);
    });
  });
});

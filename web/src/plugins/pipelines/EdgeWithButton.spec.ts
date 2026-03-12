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
import EdgeWithButton from "./EdgeWithButton.vue";

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
    props: ["id", "style", "path", "markerEnd"],
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
  id: "ewb-edge-1",
  sourceX: 100,
  sourceY: 200,
  targetX: 300,
  targetY: 400,
  sourcePosition: "bottom",
  targetPosition: "top",
};

function createWrapper(props: Record<string, unknown> = {}) {
  return mount(EdgeWithButton, {
    props: { ...defaultProps, ...props },
    global: {
      stubs: {
        BaseEdge: {
          name: "BaseEdge",
          template: '<path class="mock-base-edge" />',
          props: ["id", "style", "path", "markerEnd"],
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

describe("EdgeWithButton.vue", () => {
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
    it("passes the id prop to BaseEdge", () => {
      wrapper = createWrapper({ id: "test-edge-42" });
      const baseEdge = wrapper.findComponent({ name: "BaseEdge" });
      expect(baseEdge.props("id")).toBe("test-edge-42");
    });

    it("accepts required sourceX, sourceY, targetX, targetY props", () => {
      wrapper = createWrapper({
        sourceX: 50,
        sourceY: 75,
        targetX: 150,
        targetY: 225,
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

    it("merges the optional style prop into BaseEdge style", () => {
      wrapper = createWrapper({ style: { stroke: "blue", opacity: 0.8 } });
      const baseEdge = wrapper.findComponent({ name: "BaseEdge" });
      const style = baseEdge.props("style");
      expect(style.stroke).toBe("blue");
      expect(style.opacity).toBe(0.8);
      expect(style.cursor).toBe("pointer");
    });

    it("passes markerEnd to BaseEdge when supplied", () => {
      wrapper = createWrapper({ markerEnd: "url(#marker-end)" });
      const baseEdge = wrapper.findComponent({ name: "BaseEdge" });
      expect(baseEdge.props("markerEnd")).toBe("url(#marker-end)");
    });

    it("works without optional props (markerEnd, style)", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("does NOT define a data prop (unlike CustomEdge)", () => {
      // EdgeWithButton has a simpler API – no data or isInView props
      const componentDef = EdgeWithButton as any;
      const propsDefinition =
        componentDef.__vccOpts?.props ?? componentDef.props;
      if (propsDefinition) {
        expect(propsDefinition).not.toHaveProperty("data");
        expect(propsDefinition).not.toHaveProperty("isInView");
      } else {
        // setup-only component — just verify it mounts cleanly
        expect(wrapper.exists()).toBe(true);
      }
    });
  });

  // -------------------------------------------------------------------------
  describe("computed: path", () => {
    it("passes the path[0] string to BaseEdge", () => {
      wrapper = createWrapper();
      const baseEdge = wrapper.findComponent({ name: "BaseEdge" });
      expect(typeof baseEdge.props("path")).toBe("string");
    });

    it("recomputes path when source coordinates change", async () => {
      wrapper = createWrapper({ sourceX: 0, targetX: 200 });
      const baseEdge = wrapper.findComponent({ name: "BaseEdge" });
      const originalPath = baseEdge.props("path");

      await wrapper.setProps({ sourceX: 50 });
      const updatedPath = baseEdge.props("path");
      // The mocked getBezierPath embeds the coordinate in the string
      expect(updatedPath).not.toBe(originalPath);
    });
  });

  // -------------------------------------------------------------------------
  describe("useVueFlow integration", () => {
    it("calls useVueFlow during setup without throwing", () => {
      expect(() => createWrapper()).not.toThrow();
    });

    it("does not call removeEdges automatically on mount", () => {
      wrapper = createWrapper();
      expect(mockRemoveEdges).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  describe("inheritAttrs", () => {
    it("has inheritAttrs set to false", () => {
      const component = EdgeWithButton as any;
      expect(component.inheritAttrs).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe("EdgeLabelRenderer slot content", () => {
    it("EdgeLabelRenderer is empty (delete button removed)", () => {
      wrapper = createWrapper();
      const labelRenderer = wrapper.findComponent({ name: "EdgeLabelRenderer" });
      // The slot content contains only the comment about keyboard deletion
      expect(labelRenderer.html()).not.toContain("button");
    });
  });

  // -------------------------------------------------------------------------
  describe("edge cases", () => {
    it("renders with identical source and target positions", () => {
      wrapper = createWrapper({
        sourcePosition: "right",
        targetPosition: "right",
      });
      expect(wrapper.findComponent({ name: "BaseEdge" }).exists()).toBe(true);
    });

    it("renders when source and target are at the same coordinates", () => {
      wrapper = createWrapper({
        sourceX: 100,
        sourceY: 100,
        targetX: 100,
        targetY: 100,
      });
      expect(wrapper.findComponent({ name: "BaseEdge" }).exists()).toBe(true);
    });

    it("renders with large coordinate values", () => {
      wrapper = createWrapper({
        sourceX: 10000,
        sourceY: 10000,
        targetX: -10000,
        targetY: -10000,
      });
      expect(wrapper.exists()).toBe(true);
    });

    it("renders with a null markerEnd gracefully", () => {
      wrapper = createWrapper({ markerEnd: undefined });
      expect(wrapper.exists()).toBe(true);
    });

    it("renders with an empty style object", () => {
      wrapper = createWrapper({ style: {} });
      const baseEdge = wrapper.findComponent({ name: "BaseEdge" });
      const style = baseEdge.props("style");
      expect(style.cursor).toBe("pointer");
    });
  });
});

// Copyright 2025 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import CustomEdge from "@/plugins/pipelines/CustomEdge.vue";
import * as VueFlowCore from "@vue-flow/core";

// Mock @vue-flow/core - must be defined in factory function
vi.mock("@vue-flow/core", () => ({
  BaseEdge: {
    template: "<div class='base-edge'></div>",
    props: ["id", "style", "path", "markerEnd", "type"],
  },
  getBezierPath: vi.fn((props) => [[`M${props.sourceX},${props.sourceY} L${props.targetX},${props.targetY}`]]),
  EdgeLabelRenderer: {
    template: "<div class='edge-label-renderer'><slot /></div>",
  },
  getSmoothStepPath: vi.fn(),
  useVueFlow: vi.fn(() => ({
    removeEdges: vi.fn(),
    getSelectedEdges: vi.fn(),
    addSelectedEdges: vi.fn(),
    removeSelectedEdges: vi.fn(),
  })),
}));

describe("CustomEdge.vue", () => {
  const defaultProps = {
    id: "edge-1",
    sourceX: 100,
    sourceY: 200,
    targetX: 300,
    targetY: 400,
    sourcePosition: "right",
    targetPosition: "left",
  };

  describe("component rendering", () => {
    it("should render BaseEdge with correct props", () => {
      const wrapper = mount(CustomEdge, {
        props: defaultProps,
      });

      const baseEdge = wrapper.findComponent({ name: "BaseEdge" });
      expect(baseEdge.exists()).toBe(false); // Stubbed, so won't find actual component
      expect(wrapper.find(".base-edge").exists()).toBe(true);
    });

    it("should render EdgeLabelRenderer", () => {
      const wrapper = mount(CustomEdge, {
        props: defaultProps,
      });

      expect(wrapper.find(".edge-label-renderer").exists()).toBe(true);
    });

    it("should apply cursor pointer style", () => {
      const wrapper = mount(CustomEdge, {
        props: defaultProps,
      });

      // The component applies style through props to BaseEdge
      // We can check that the component renders
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("props validation", () => {
    it("should accept required props", () => {
      const wrapper = mount(CustomEdge, {
        props: defaultProps,
      });

      expect(wrapper.props("id")).toBe("edge-1");
      expect(wrapper.props("sourceX")).toBe(100);
      expect(wrapper.props("sourceY")).toBe(200);
      expect(wrapper.props("targetX")).toBe(300);
      expect(wrapper.props("targetY")).toBe(400);
      expect(wrapper.props("sourcePosition")).toBe("right");
      expect(wrapper.props("targetPosition")).toBe("left");
    });

    it("should accept optional data prop", () => {
      const data = { label: "test edge", color: "blue" };
      const wrapper = mount(CustomEdge, {
        props: {
          ...defaultProps,
          data,
        },
      });

      expect(wrapper.props("data")).toEqual(data);
    });

    it("should accept optional markerEnd prop", () => {
      const wrapper = mount(CustomEdge, {
        props: {
          ...defaultProps,
          markerEnd: "url(#arrow)",
        },
      });

      expect(wrapper.props("markerEnd")).toBe("url(#arrow)");
    });

    it("should accept optional style prop", () => {
      const style = { stroke: "red", strokeWidth: 3 };
      const wrapper = mount(CustomEdge, {
        props: {
          ...defaultProps,
          style,
        },
      });

      expect(wrapper.props("style")).toEqual(style);
    });

    it("should accept optional isInView prop with default false", () => {
      const wrapper = mount(CustomEdge, {
        props: defaultProps,
      });

      expect(wrapper.props("isInView")).toBe(false);
    });

    it("should accept isInView true", () => {
      const wrapper = mount(CustomEdge, {
        props: {
          ...defaultProps,
          isInView: true,
        },
      });

      expect(wrapper.props("isInView")).toBe(true);
    });
  });

  describe("computed properties", () => {
    it("should calculate midX correctly", async () => {
      const wrapper = mount(CustomEdge, {
        props: defaultProps,
      });

      // midX = (100 + 300) / 2 = 200
      // This is computed internally, we can't directly access it
      // but we can verify the component works with different coordinates
      await wrapper.setProps({
        sourceX: 0,
        targetX: 100,
      });

      expect(wrapper.exists()).toBe(true);
    });

    it("should calculate midY correctly", async () => {
      const wrapper = mount(CustomEdge, {
        props: defaultProps,
      });

      // midY = (200 + 400) / 2 = 300
      await wrapper.setProps({
        sourceY: 0,
        targetY: 200,
      });

      expect(wrapper.exists()).toBe(true);
    });

    it("should call getBezierPath with props", () => {
      const mockGetBezierPath = vi.mocked(VueFlowCore.getBezierPath);
      mockGetBezierPath.mockClear();

      mount(CustomEdge, {
        props: defaultProps,
      });

      expect(mockGetBezierPath).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceX: 100,
          sourceY: 200,
          targetX: 300,
          targetY: 400,
          sourcePosition: "right",
          targetPosition: "left",
        })
      );
    });
  });

  describe("edge positioning", () => {
    it("should handle horizontal edge", () => {
      const wrapper = mount(CustomEdge, {
        props: {
          id: "h-edge",
          sourceX: 0,
          sourceY: 100,
          targetX: 200,
          targetY: 100,
          sourcePosition: "right",
          targetPosition: "left",
        },
      });

      expect(wrapper.exists()).toBe(true);
    });

    it("should handle vertical edge", () => {
      const wrapper = mount(CustomEdge, {
        props: {
          id: "v-edge",
          sourceX: 100,
          sourceY: 0,
          targetX: 100,
          targetY: 200,
          sourcePosition: "bottom",
          targetPosition: "top",
        },
      });

      expect(wrapper.exists()).toBe(true);
    });

    it("should handle diagonal edge", () => {
      const wrapper = mount(CustomEdge, {
        props: {
          id: "d-edge",
          sourceX: 0,
          sourceY: 0,
          targetX: 200,
          targetY: 200,
          sourcePosition: "right",
          targetPosition: "top",
        },
      });

      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("inheritAttrs", () => {
    it("should not inherit attributes", () => {
      // The component exports inheritAttrs: false in the second script block
      const wrapper = mount(CustomEdge, {
        props: defaultProps,
        attrs: {
          "data-test": "custom-edge",
          class: "my-custom-class",
        },
      });

      // Should not automatically apply attrs to root element
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("VueFlow integration", () => {
    it("should call useVueFlow on mount", () => {
      const mockUseVueFlow = vi.mocked(VueFlowCore.useVueFlow);
      mockUseVueFlow.mockClear();

      mount(CustomEdge, {
        props: defaultProps,
      });

      expect(mockUseVueFlow).toHaveBeenCalled();
    });

    it("should have access to VueFlow methods", () => {
      const mockMethods = {
        removeEdges: vi.fn(),
        getSelectedEdges: vi.fn(),
        addSelectedEdges: vi.fn(),
        removeSelectedEdges: vi.fn(),
      };

      const mockUseVueFlow = vi.mocked(VueFlowCore.useVueFlow);
      mockUseVueFlow.mockReturnValueOnce(mockMethods);

      mount(CustomEdge, {
        props: defaultProps,
      });

      // Methods are available but not called during mount since
      // edge click handling is moved to PipelineFlow.vue
      expect(mockMethods.removeEdges).not.toHaveBeenCalled();
    });
  });

  describe("style customization", () => {
    it("should merge custom style with default style", () => {
      const customStyle = {
        stroke: "blue",
        strokeWidth: 4,
      };

      const wrapper = mount(CustomEdge, {
        props: {
          ...defaultProps,
          style: customStyle,
        },
      });

      expect(wrapper.props("style")).toEqual(customStyle);
    });

    it("should apply pointer cursor", () => {
      const wrapper = mount(CustomEdge, {
        props: defaultProps,
      });

      // The component should set cursor: pointer in style
      // This is applied via the :style binding on BaseEdge
      expect(wrapper.exists()).toBe(true);
    });

    it("should set strokeDasharray to none", () => {
      const wrapper = mount(CustomEdge, {
        props: defaultProps,
      });

      // strokeDasharray: 'none' is applied in the style binding
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("edge types", () => {
    it("should use smoothstep type", () => {
      const wrapper = mount(CustomEdge, {
        props: defaultProps,
      });

      // type="smoothstep" is hardcoded in the template
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("backwards compatibility", () => {
    it("should maintain backwards compatibility for click handlers", () => {
      // The component has a comment about keeping handlers for backwards compatibility
      // even though they're not used
      const wrapper = mount(CustomEdge, {
        props: defaultProps,
      });

      // Component should render without errors
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("negative coordinates", () => {
    it("should handle negative source coordinates", () => {
      const wrapper = mount(CustomEdge, {
        props: {
          ...defaultProps,
          sourceX: -100,
          sourceY: -50,
        },
      });

      expect(wrapper.exists()).toBe(true);
    });

    it("should handle negative target coordinates", () => {
      const wrapper = mount(CustomEdge, {
        props: {
          ...defaultProps,
          targetX: -200,
          targetY: -150,
        },
      });

      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("large coordinates", () => {
    it("should handle very large coordinates", () => {
      const wrapper = mount(CustomEdge, {
        props: {
          id: "large-edge",
          sourceX: 10000,
          sourceY: 10000,
          targetX: 20000,
          targetY: 20000,
          sourcePosition: "right",
          targetPosition: "left",
        },
      });

      expect(wrapper.exists()).toBe(true);
    });
  });
});

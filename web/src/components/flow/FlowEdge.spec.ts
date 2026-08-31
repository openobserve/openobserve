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

import { describe, it, expect, vi, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import FlowEdge from "./FlowEdge.vue";

vi.mock("@vue-flow/core", () => ({
  BaseEdge: {
    name: "BaseEdge",
    template: '<path class="mock-base-edge" />',
    props: ["id", "style", "path", "markerEnd", "type"],
  },
  // The label layer teleports to the viewport in the real lib; here it just renders
  // its slot inline so the mid-edge `+` is queryable.
  EdgeLabelRenderer: {
    name: "EdgeLabelRenderer",
    template: '<div class="mock-edge-label"><slot /></div>',
  },
  Position: { Top: "top", Right: "right", Bottom: "bottom", Left: "left" },
  getBezierPath: vi.fn((props: any) => [
    `M ${props.sourceX} ${props.sourceY} C ... ${props.targetX} ${props.targetY}`,
    props.sourceX,
    props.sourceY,
  ]),
}));

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
  return mount(FlowEdge, {
    props: { ...defaultProps, ...props },
    global: {
      stubs: {
        BaseEdge: {
          name: "BaseEdge",
          template: '<path class="mock-base-edge" />',
          props: ["id", "style", "path", "markerEnd", "type"],
        },
      },
    },
  });
}

describe("FlowEdge.vue", () => {
  let wrapper: ReturnType<typeof createWrapper>;

  afterEach(() => {
    if (wrapper) wrapper.unmount();
    vi.clearAllMocks();
  });

  describe("component mounting", () => {
    it("mounts without errors", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("renders a BaseEdge component", () => {
      wrapper = createWrapper();
      expect(wrapper.findComponent({ name: "BaseEdge" }).exists()).toBe(true);
    });
  });

  describe("props", () => {
    it("passes the id prop to BaseEdge", () => {
      wrapper = createWrapper({ id: "my-edge" });
      expect(wrapper.findComponent({ name: "BaseEdge" }).props("id")).toBe("my-edge");
    });

    it("applies cursor:pointer and strokeDasharray:none to BaseEdge style", () => {
      wrapper = createWrapper();
      const style = wrapper.findComponent({ name: "BaseEdge" }).props("style");
      expect(style).toMatchObject({ cursor: "pointer", strokeDasharray: "none" });
    });

    it("merges the style prop into BaseEdge style", () => {
      wrapper = createWrapper({ style: { stroke: "red", strokeWidth: 3 } });
      const style = wrapper.findComponent({ name: "BaseEdge" }).props("style");
      expect(style.stroke).toBe("red");
      expect(style.strokeWidth).toBe(3);
      expect(style.cursor).toBe("pointer");
    });

    it("passes markerEnd prop to BaseEdge", () => {
      wrapper = createWrapper({ markerEnd: "url(#arrow)" });
      expect(wrapper.findComponent({ name: "BaseEdge" }).props("markerEnd")).toBe("url(#arrow)");
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

  describe("computed: path", () => {
    it("passes the path[0] bezier string to BaseEdge", () => {
      wrapper = createWrapper({ sourceX: 0, sourceY: 0, targetX: 100, targetY: 100 });
      expect(typeof wrapper.findComponent({ name: "BaseEdge" }).props("path")).toBe("string");
    });
  });

  describe("inheritAttrs", () => {
    it("sets inheritAttrs to false via the plain <script> block", () => {
      expect((FlowEdge as any).inheritAttrs).toBe(false);
    });
  });

  describe("mid-edge insert + (insertable)", () => {
    const addBtn = (w: any) => w.find('[data-test="workflow-edge-add"]');

    it("does not render the insert + by default (pipelines opt out)", () => {
      wrapper = createWrapper();
      expect(addBtn(wrapper).exists()).toBe(false);
    });

    it("renders the insert + when insertable is set (Workflows opt in)", () => {
      wrapper = createWrapper({ insertable: true });
      expect(addBtn(wrapper).exists()).toBe(true);
    });

    it("emits insert with the click event when the + is clicked", async () => {
      wrapper = createWrapper({ insertable: true });
      await addBtn(wrapper).trigger("click");
      expect(wrapper.emitted("insert")).toBeTruthy();
      expect(wrapper.emitted("insert")).toHaveLength(1);
    });

    it("emits insert-enter / insert-leave as the cursor crosses the + chip", async () => {
      wrapper = createWrapper({ insertable: true });
      const chip = wrapper.find(".pointer-events-auto"); // the chip wrapper around the +
      await chip.trigger("mouseenter");
      await chip.trigger("mouseleave");
      expect(wrapper.emitted("insert-enter")).toHaveLength(1);
      expect(wrapper.emitted("insert-leave")).toHaveLength(1);
    });
  });

  describe("edge cases", () => {
    it("renders when source and target positions are the same", () => {
      wrapper = createWrapper({ sourcePosition: "bottom", targetPosition: "bottom" });
      expect(wrapper.findComponent({ name: "BaseEdge" }).exists()).toBe(true);
    });

    it("renders with very large coordinate values", () => {
      wrapper = createWrapper({
        sourceX: 99999,
        sourceY: 99999,
        targetX: -99999,
        targetY: -99999,
      });
      expect(wrapper.findComponent({ name: "BaseEdge" }).exists()).toBe(true);
    });
  });
});

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

// WorkflowNode is a THIN WRAPPER over the shared FlowNodeCard: the card frame,
// handles and icon slot are FlowNodeCard's job (covered by its own spec), so
// these tests cover what the WRAPPER owns — the node-type meta lookup
// (icon / ioType / label), the per-type body, the test-result badge, the
// hover-delete and the hover-`+` step picker.
//
// FlowNodeCard is stubbed (it renders the slots inline and records the props it
// receives); the REAL useWorkflowCanvas singleton is used so the wrapper's
// effects are asserted on actual `workflowObj` state.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import i18n from "@/locales";

vi.mock("@vue-flow/core", () => ({
  useVueFlow: () => ({
    screenToFlowCoordinate: vi.fn(() => ({ x: 0, y: 0 })),
    onNodesInitialized: vi.fn(),
    updateNode: vi.fn(),
  }),
}));

vi.mock("@/utils/zincutils", () => ({
  getImageURL: (p: string) => `mock/${p}`,
  getUUID: () => "new-uuid",
}));

vi.mock("@/services/workflows", () => ({
  default: { testWorkflow: vi.fn(), getWorkflowRun: vi.fn() },
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));

// FlowNodeCard stub — renders the three slots inline and keeps the card props
// observable so we can assert the wrapper's meta -> card mapping.
vi.mock("@/components/flow/FlowNodeCard.vue", () => ({
  default: {
    name: "FlowNodeCard",
    props: ["icon", "ioType", "hasInput", "hasOutput"],
    template: `
      <div class="flow-node-card-stub">
        <slot name="body" />
        <slot name="actions" />
        <slot name="footer" />
      </div>
    `,
  },
}));

// OTooltip portals its content; render it inline so the badge messages are
// assertable.
vi.mock("@/lib/overlay/Tooltip/OTooltip.vue", () => ({
  default: {
    name: "OTooltip",
    template: '<div class="tooltip-stub"><slot name="content" /></div>',
  },
}));

import WorkflowNode from "@/plugins/workflows/WorkflowNode.vue";
import { workflowObj } from "@/plugins/workflows/useWorkflowCanvas";
import { toast } from "@/lib/feedback/Toast/useToast";

const TRIGGER = { id: "t1", data: { node_type: "workflow_trigger" } };
const CONDITION = { id: "c1", data: { node_type: "condition" } };
const FUNCTION = { id: "f1", data: { node_type: "function" } };
const DESTINATION = { id: "d1", data: { node_type: "destination" } };

const setGraph = (nodes: any[] = [], edges: any[] = []) => {
  workflowObj.currentSelectedWorkflow = {
    id: "wf1",
    name: "wf",
    nodes,
    edges,
  } as any;
};

const mountNode = (id: string, data: any) =>
  mount(WorkflowNode as any, {
    props: { id, data },
    global: { plugins: [i18n] },
  });

const card = (wrapper: any) => wrapper.findComponent({ name: "FlowNodeCard" });

describe("WorkflowNode", () => {
  let wrapper: any = null;

  beforeEach(() => {
    vi.clearAllMocks();
    setGraph([TRIGGER, CONDITION, FUNCTION, DESTINATION], [
      { source: "t1", target: "c1" },
      { source: "c1", target: "d1" },
    ]);
    workflowObj.testRun = {
      show: false,
      input: "",
      fromNode: "",
      result: null,
      resultDrawer: { show: false, nodeId: "" },
    } as any;
    workflowObj.deleteConfirm = { show: false, nodeId: "" };
    workflowObj.stepPicker = { show: false, source: "", handle: "out" };
    workflowObj.dialog = { show: false, name: "", expand: false };
    workflowObj.currentSelectedNodeID = "";
    workflowObj.currentSelectedNodeData = null;
    workflowObj.isEditNode = false;
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.useRealTimers();
  });

  describe("meta lookup -> FlowNodeCard props", () => {
    it("maps the trigger to ioType=input (source handle only)", () => {
      wrapper = mountNode("t1", TRIGGER.data);
      expect(card(wrapper).props("ioType")).toBe("input");
      expect(card(wrapper).props("hasInput")).toBe(false);
      expect(card(wrapper).props("hasOutput")).toBe(true);
    });

    it("maps condition/function (logic) to ioType=default (both handles)", () => {
      wrapper = mountNode("c1", CONDITION.data);
      expect(card(wrapper).props("ioType")).toBe("default");
      expect(card(wrapper).props("hasInput")).toBe(true);
      expect(card(wrapper).props("hasOutput")).toBe(true);

      wrapper.unmount();
      wrapper = mountNode("f1", FUNCTION.data);
      expect(card(wrapper).props("ioType")).toBe("default");
    });

    it("maps the destination to ioType=output (target handle only)", () => {
      wrapper = mountNode("d1", DESTINATION.data);
      expect(card(wrapper).props("ioType")).toBe("output");
      expect(card(wrapper).props("hasInput")).toBe(true);
      expect(card(wrapper).props("hasOutput")).toBe(false);
    });

    it("falls back to ioType=default with both handles for an unknown node_type", () => {
      wrapper = mountNode("x1", { node_type: "not_a_type" });
      expect(card(wrapper).props("ioType")).toBe("default");
      expect(card(wrapper).props("hasInput")).toBe(true);
      expect(card(wrapper).props("hasOutput")).toBe(true);
    });

    it("survives an undefined data object", () => {
      wrapper = mountNode("x1", undefined);
      expect(wrapper.exists()).toBe(true);
      expect(card(wrapper).props("ioType")).toBe("default");
    });
  });

  describe("node icon", () => {
    it('renders the pipeline node image as an "img:<url>" glyph', () => {
      wrapper = mountNode("f1", FUNCTION.data);
      expect(card(wrapper).props("icon")).toBe(
        "img:mock/images/pipeline/transform_function.png",
      );
    });

    it("uses each type's own image", () => {
      wrapper = mountNode("d1", DESTINATION.data);
      expect(card(wrapper).props("icon")).toBe(
        "img:mock/images/pipeline/output_remote.png",
      );
    });

    it('falls back to the "help" glyph for an unknown node_type', () => {
      wrapper = mountNode("x1", { node_type: "not_a_type" });
      expect(card(wrapper).props("icon")).toBe("help");
    });
  });

  describe("data-test", () => {
    it("stamps workflow-node-<node_type> on the card root", () => {
      wrapper = mountNode("c1", CONDITION.data);
      expect(wrapper.attributes("data-test")).toBe("workflow-node-condition");
    });
  });

  describe("#body — node label", () => {
    it("shows the trigger's type title (never a config detail)", () => {
      wrapper = mountNode("t1", TRIGGER.data);
      expect(wrapper.text()).toContain("Alert Trigger");
    });

    it("shows a configured condition's rule preview as the label", () => {
      const data = {
        node_type: "condition",
        conditions: {
          filterType: "group",
          conditions: [
            {
              filterType: "condition",
              column: "level",
              operator: "=",
              value: "error",
            },
          ],
        },
      };
      wrapper = mountNode("c1", data);
      expect(wrapper.text()).toContain("level = 'error'");
    });

    it("truncates a long condition preview at 28 chars", () => {
      const data = {
        node_type: "condition",
        conditions: {
          filterType: "group",
          conditions: [
            {
              filterType: "condition",
              column: "a_very_long_column_name_here",
              operator: "=",
              value: "a_very_long_value_here",
            },
          ],
        },
      };
      wrapper = mountNode("c1", data);
      expect(wrapper.text()).toContain("...");
      expect(wrapper.find(".whitespace-nowrap").text().length).toBe(31);
    });

    it("falls back to the type title for a not-yet-configured condition", () => {
      wrapper = mountNode("c1", CONDITION.data);
      expect(wrapper.text()).toContain("Condition");
    });

    it("shows a configured destination's name as the label", () => {
      wrapper = mountNode("d1", {
        node_type: "destination",
        destination_id: "my-webhook",
      });
      expect(wrapper.text()).toContain("my-webhook");
    });

    it("falls back to the type title for a not-yet-configured destination", () => {
      wrapper = mountNode("d1", DESTINATION.data);
      expect(wrapper.text()).toContain("Destination");
    });

    it("falls back to the raw node_type when there is no meta", () => {
      wrapper = mountNode("x1", { node_type: "not_a_type" });
      expect(wrapper.text()).toContain("not_a_type");
    });
  });

  describe("#body — configured function tag", () => {
    it('renders "<name> - [RAF]" when after_flatten is true', () => {
      wrapper = mountNode("f1", {
        node_type: "function",
        name: "parse_logs",
        after_flatten: true,
      });
      expect(wrapper.text()).toContain("parse_logs");
      expect(wrapper.find("strong").text()).toBe("[RAF]");
    });

    it('renders "<name> - [RBF]" when after_flatten is false', () => {
      wrapper = mountNode("f1", {
        node_type: "function",
        name: "parse_logs",
        after_flatten: false,
      });
      expect(wrapper.find("strong").text()).toBe("[RBF]");
    });

    it("uses the plain label line (no tag) for a function with no name", () => {
      wrapper = mountNode("f1", FUNCTION.data);
      expect(wrapper.find("strong").exists()).toBe(false);
      expect(wrapper.text()).toContain("Function");
    });
  });

  describe("hover behaviour", () => {
    it("hides the action buttons until the node is hovered", () => {
      wrapper = mountNode("c1", CONDITION.data);
      const actions = wrapper.find('[data-test="workflow-node-condition-actions"]');
      expect(actions.exists()).toBe(true);
      expect(actions.element.style.display).toBe("none");
    });

    it("shows the action buttons on mouseenter", async () => {
      wrapper = mountNode("c1", CONDITION.data);
      await wrapper.trigger("mouseenter");
      expect(
        wrapper.find('[data-test="workflow-node-condition-actions"]').element.style
          .display,
      ).not.toBe("none");
    });

    it("hides them again ~200ms after mouseleave", async () => {
      vi.useFakeTimers();
      wrapper = mountNode("c1", CONDITION.data);
      await wrapper.trigger("mouseenter");
      await wrapper.trigger("mouseleave");
      // still visible immediately after leaving
      expect(
        wrapper.find('[data-test="workflow-node-condition-actions"]').element.style
          .display,
      ).not.toBe("none");
      vi.advanceTimersByTime(200);
      await nextTick();
      expect(
        wrapper.find('[data-test="workflow-node-condition-actions"]').element.style
          .display,
      ).toBe("none");
    });

    it("keeps the buttons visible when the cursor moves onto the actions bar", async () => {
      vi.useFakeTimers();
      wrapper = mountNode("c1", CONDITION.data);
      await wrapper.trigger("mouseenter");
      await wrapper.trigger("mouseleave");
      const actions = wrapper.find('[data-test="workflow-node-condition-actions"]');
      await actions.trigger("mouseenter"); // cancels the pending hide
      vi.advanceTimersByTime(500);
      await nextTick();
      expect(actions.element.style.display).not.toBe("none");
    });

    it("hides the buttons ~200ms after leaving the actions bar", async () => {
      vi.useFakeTimers();
      wrapper = mountNode("c1", CONDITION.data);
      await wrapper.trigger("mouseenter");
      const actions = wrapper.find('[data-test="workflow-node-condition-actions"]');
      await actions.trigger("mouseleave");
      vi.advanceTimersByTime(200);
      await nextTick();
      expect(actions.element.style.display).toBe("none");
    });

    it("re-hovering cancels a pending hide", async () => {
      vi.useFakeTimers();
      wrapper = mountNode("c1", CONDITION.data);
      await wrapper.trigger("mouseenter");
      await wrapper.trigger("mouseleave");
      await wrapper.trigger("mouseenter");
      vi.advanceTimersByTime(500);
      await nextTick();
      expect(
        wrapper.find('[data-test="workflow-node-condition-actions"]').element.style
          .display,
      ).not.toBe("none");
    });
  });

  describe("hover -> outgoing edge tint", () => {
    it("tints this node's outgoing edges with its role colour on hover", async () => {
      wrapper = mountNode("c1", CONDITION.data);
      await wrapper.trigger("mouseenter");
      const edge = workflowObj.currentSelectedWorkflow.edges.find(
        (e: any) => e.source === "c1",
      );
      expect(edge.style).toMatchObject({ stroke: "#f59e0b", strokeWidth: 2 });
      expect(edge.markerEnd).toMatchObject({ color: "#f59e0b" });
    });

    it("uses blue for the trigger (input) and green for the destination (output)", async () => {
      wrapper = mountNode("t1", TRIGGER.data);
      await wrapper.trigger("mouseenter");
      expect(
        workflowObj.currentSelectedWorkflow.edges.find((e: any) => e.source === "t1")
          .style.stroke,
      ).toBe("#3b82f6");
      wrapper.unmount();

      // an output node with an outgoing edge (defensive: normally terminal)
      setGraph([DESTINATION], [{ source: "d1", target: "z1" }]);
      wrapper = mountNode("d1", DESTINATION.data);
      await wrapper.trigger("mouseenter");
      expect(
        workflowObj.currentSelectedWorkflow.edges[0].style.stroke,
      ).toBe("#22c55e");
    });

    it("resets the edge to the grey token on mouseleave", async () => {
      wrapper = mountNode("c1", CONDITION.data);
      await wrapper.trigger("mouseenter");
      await wrapper.trigger("mouseleave");
      const edge = workflowObj.currentSelectedWorkflow.edges.find(
        (e: any) => e.source === "c1",
      );
      expect(edge.style.stroke).toBe("var(--color-grey-500)");
      expect(edge.markerEnd.color).toBe("var(--color-grey-500)");
    });

    it("leaves other nodes' edges untouched", async () => {
      wrapper = mountNode("c1", CONDITION.data);
      await wrapper.trigger("mouseenter");
      const other = workflowObj.currentSelectedWorkflow.edges.find(
        (e: any) => e.source === "t1",
      );
      expect(other.style).toBeUndefined();
    });

    it("uses the reset grey for an unknown node type (no role colour)", async () => {
      setGraph([{ id: "x1", data: { node_type: "not_a_type" } }], [
        { source: "x1", target: "c1" },
      ]);
      wrapper = mountNode("x1", { node_type: "not_a_type" });
      await wrapper.trigger("mouseenter");
      // no meta -> ioType defaults to "default" -> amber
      expect(workflowObj.currentSelectedWorkflow.edges[0].style.stroke).toBe(
        "#f59e0b",
      );
    });

    it("does not throw when the workflow has no edges", async () => {
      setGraph([CONDITION], undefined as any);
      wrapper = mountNode("c1", CONDITION.data);
      await expect(wrapper.trigger("mouseenter")).resolves.not.toThrow();
    });
  });

  describe("delete", () => {
    it("offers delete on the trigger too (so its kind can be swapped)", async () => {
      wrapper = mountNode("t1", TRIGGER.data);
      await wrapper.trigger("mouseenter");
      const actions = wrapper.find(
        '[data-test="workflow-node-workflow_trigger-actions"]',
      );
      expect(actions.element.style.display).not.toBe("none");
      await wrapper
        .find('[data-test="workflow-node-workflow_trigger-delete-btn"]')
        .trigger("click");
      expect(workflowObj.deleteConfirm).toEqual({ show: true, nodeId: "t1" });
      expect(toast).not.toHaveBeenCalled();
    });

    it("opens the delete confirmation for a non-trigger node", async () => {
      wrapper = mountNode("c1", CONDITION.data);
      await wrapper.trigger("mouseenter");
      await wrapper
        .find('[data-test="workflow-node-condition-delete-btn"]')
        .trigger("click");
      expect(workflowObj.deleteConfirm).toEqual({ show: true, nodeId: "c1" });
      expect(toast).not.toHaveBeenCalled();
    });
  });

  describe("click -> edit node", () => {
    it("opens the config drawer for this node", async () => {
      wrapper = mountNode("c1", CONDITION.data);
      await wrapper.trigger("click");
      expect(workflowObj.isEditNode).toBe(true);
      expect(workflowObj.currentSelectedNodeID).toBe("c1");
      expect(workflowObj.dialog.show).toBe(true);
      expect(workflowObj.dialog.name).toBe("condition");
    });

    it("does nothing when the node is not on the canvas", async () => {
      wrapper = mountNode("ghost", CONDITION.data);
      await wrapper.trigger("click");
      expect(workflowObj.dialog.show).toBe(false);
      expect(workflowObj.currentSelectedNodeID).toBe("");
    });
  });

  // The hover-`+` under the card is gone: clicking the node's SOURCE HANDLE
  // opens the step picker. Terminal (output) nodes render no source handle, so
  // there is nothing to click on them.
  describe("source handle -> step picker", () => {
    const outputClick = (w: any, x = 120, y = 240) =>
      w.findComponent({ name: "FlowNodeCard" }).vm.$emit("outputClick", {
        clientX: x,
        clientY: y,
      } as MouseEvent);

    it("opens the step picker anchored at the click for a logic node", async () => {
      wrapper = mountNode("c1", CONDITION.data);
      outputClick(wrapper, 120, 240);
      await nextTick();
      expect(workflowObj.stepPicker).toEqual({
        show: true,
        source: "c1",
        handle: "out",
        mode: "next",
        position: null,
        anchor: { x: 120, y: 240 },
      });
    });

    it("opens the step picker for the trigger too", async () => {
      wrapper = mountNode("t1", TRIGGER.data);
      outputClick(wrapper);
      await nextTick();
      expect(workflowObj.stepPicker.show).toBe(true);
      expect(workflowObj.stepPicker.source).toBe("t1");
    });

    it("renders a source handle on a logic node", () => {
      wrapper = mountNode("c1", CONDITION.data);
      expect(wrapper.findComponent({ name: "FlowNodeCard" }).props("hasOutput")).toBe(true);
    });

    it("renders NO source handle on a terminal (output) destination node", () => {
      wrapper = mountNode("d1", DESTINATION.data);
      expect(wrapper.findComponent({ name: "FlowNodeCard" }).props("hasOutput")).toBe(false);
    });

    it("does nothing on the read-only Runs canvas", async () => {
      workflowObj.readOnly = true;
      wrapper = mountNode("c1", CONDITION.data);
      outputClick(wrapper);
      await nextTick();
      expect(workflowObj.stepPicker.show).toBe(false);
      workflowObj.readOnly = false;
    });
  });

  describe("test result badge", () => {
    const setResult = (result: any) => {
      workflowObj.testRun.result = result;
    };

    it("renders no badge when there was no test run", () => {
      wrapper = mountNode("c1", CONDITION.data);
      expect(wrapper.find(".wf-test-badge").exists()).toBe(false);
    });

    it("renders no badge for a node that was not part of the run", () => {
      setResult({ errors: {}, ranNodeIds: ["t1"], blockedNodeIds: [] });
      wrapper = mountNode("c1", CONDITION.data);
      expect(wrapper.find(".wf-test-badge").exists()).toBe(false);
    });

    it("renders the green tick for a node that ran clean", () => {
      setResult({ errors: {}, ranNodeIds: ["c1"], blockedNodeIds: [] });
      wrapper = mountNode("c1", CONDITION.data);
      expect(
        wrapper.find('[data-test="workflow-node-condition-test-ok"]').exists(),
      ).toBe(true);
    });

    it("renders the grey not-verified badge for a blocked (downstream-of-error) node", () => {
      setResult({ errors: {}, ranNodeIds: ["c1"], blockedNodeIds: ["c1"] });
      wrapper = mountNode("c1", CONDITION.data);
      const badge = wrapper.find('[data-test="workflow-node-condition-test-skipped"]');
      expect(badge.exists()).toBe(true);
      expect(wrapper.text()).toContain("Not verified");
    });

    it("renders the red error badge with its messages in the tooltip", () => {
      setResult({
        errors: { c1: { error_count: 2, errors: [["boom"], ["bang"]] } },
        ranNodeIds: ["c1"],
        blockedNodeIds: [],
      });
      wrapper = mountNode("c1", CONDITION.data);
      expect(
        wrapper.find('[data-test="workflow-node-condition-test-error"]').exists(),
      ).toBe(true);
      expect(wrapper.text()).toContain("boom");
      expect(wrapper.text()).toContain("bang");
    });

    it("error wins over blocked for the same node", () => {
      setResult({
        errors: { c1: { error_count: 1, errors: [["boom"]] } },
        ranNodeIds: ["c1"],
        blockedNodeIds: ["c1"],
      });
      wrapper = mountNode("c1", CONDITION.data);
      expect(
        wrapper.find('[data-test="workflow-node-condition-test-error"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="workflow-node-condition-test-skipped"]').exists(),
      ).toBe(false);
    });

    it("shows the error count only when there is more than one error", () => {
      setResult({
        errors: { c1: { error_count: 3, errors: [["a"], ["b"], ["c"]] } },
        ranNodeIds: ["c1"],
        blockedNodeIds: [],
      });
      wrapper = mountNode("c1", CONDITION.data);
      expect(wrapper.find(".wf-test-count").text()).toBe("3");
    });

    it("hides the count badge for a single error", () => {
      setResult({
        errors: { c1: { error_count: 1, errors: [["a"]] } },
        ranNodeIds: ["c1"],
        blockedNodeIds: [],
      });
      wrapper = mountNode("c1", CONDITION.data);
      expect(wrapper.find(".wf-test-count").exists()).toBe(false);
    });

    it("falls back to the message count when error_count is absent", () => {
      setResult({
        errors: { c1: { errors: [["a"], ["b"]] } },
        ranNodeIds: ["c1"],
        blockedNodeIds: [],
      });
      wrapper = mountNode("c1", CONDITION.data);
      expect(wrapper.find(".wf-test-count").text()).toBe("2");
    });

    it("renders plain-string error entries (non-tuple shape)", () => {
      setResult({
        errors: { c1: { error_count: 2, errors: ["plain-one", "plain-two"] } },
        ranNodeIds: ["c1"],
        blockedNodeIds: [],
      });
      wrapper = mountNode("c1", CONDITION.data);
      expect(wrapper.text()).toContain("plain-one");
      expect(wrapper.text()).toContain("plain-two");
    });

    it("renders the error badge with no messages when errors is not an array", () => {
      setResult({
        errors: { c1: { error_count: 0, errors: null } },
        ranNodeIds: ["c1"],
        blockedNodeIds: [],
      });
      wrapper = mountNode("c1", CONDITION.data);
      expect(
        wrapper.find('[data-test="workflow-node-condition-test-error"]').exists(),
      ).toBe(true);
      expect(wrapper.find(".wf-test-count").exists()).toBe(false);
    });

    it("opens the per-node result drawer when the error badge is clicked", async () => {
      setResult({
        errors: { c1: { error_count: 1, errors: [["boom"]] } },
        ranNodeIds: ["c1"],
        blockedNodeIds: [],
      });
      wrapper = mountNode("c1", CONDITION.data);
      await wrapper
        .find('[data-test="workflow-node-condition-test-error"]')
        .trigger("click");
      expect(workflowObj.testRun.resultDrawer).toEqual({
        show: true,
        nodeId: "c1",
      });
    });

    it("the ok badge is not clickable (no drawer)", async () => {
      setResult({ errors: {}, ranNodeIds: ["c1"], blockedNodeIds: [] });
      wrapper = mountNode("c1", CONDITION.data);
      await wrapper
        .find('[data-test="workflow-node-condition-test-ok"]')
        .trigger("click");
      expect(workflowObj.testRun.resultDrawer.show).toBe(false);
    });

    it("reacts to a test result arriving after mount", async () => {
      wrapper = mountNode("c1", CONDITION.data);
      expect(wrapper.find(".wf-test-badge").exists()).toBe(false);
      setResult({ errors: {}, ranNodeIds: ["c1"], blockedNodeIds: [] });
      await nextTick();
      expect(
        wrapper.find('[data-test="workflow-node-condition-test-ok"]').exists(),
      ).toBe(true);
    });

    it("renders no badge when ranNodeIds is missing from the result", () => {
      setResult({ errors: {} });
      wrapper = mountNode("c1", CONDITION.data);
      expect(wrapper.find(".wf-test-badge").exists()).toBe(false);
    });
  });

  describe("undefined data (defensive: node with no data payload)", () => {
    it("renders the ok badge with an undefined type in its data-test", () => {
      workflowObj.testRun.result = {
        errors: {},
        ranNodeIds: ["c1"],
        blockedNodeIds: [],
      };
      wrapper = mountNode("c1", undefined);
      expect(
        wrapper.find('[data-test="workflow-node-undefined-test-ok"]').exists(),
      ).toBe(true);
    });

    it("renders the skipped badge with an undefined type in its data-test", () => {
      workflowObj.testRun.result = {
        errors: {},
        ranNodeIds: ["c1"],
        blockedNodeIds: ["c1"],
      };
      wrapper = mountNode("c1", undefined);
      expect(
        wrapper.find('[data-test="workflow-node-undefined-test-skipped"]').exists(),
      ).toBe(true);
    });

    it("renders the error badge (and its drawer click) with an undefined type", async () => {
      workflowObj.testRun.result = {
        errors: { c1: { error_count: 1, errors: [["boom"]] } },
        ranNodeIds: ["c1"],
        blockedNodeIds: [],
      };
      wrapper = mountNode("c1", undefined);
      const badge = wrapper.find('[data-test="workflow-node-undefined-test-error"]');
      expect(badge.exists()).toBe(true);
      await badge.trigger("click");
      expect(workflowObj.testRun.resultDrawer).toEqual({
        show: true,
        nodeId: "c1",
      });
    });

    it("renders the delete button and the actions bar with an undefined type", async () => {
      wrapper = mountNode("c1", undefined);
      await wrapper.trigger("mouseenter");
      expect(
        wrapper.find('[data-test="workflow-node-undefined-actions"]').exists(),
      ).toBe(true);
      await wrapper
        .find('[data-test="workflow-node-undefined-delete-btn"]')
        .trigger("click");
      expect(workflowObj.deleteConfirm).toEqual({ show: true, nodeId: "c1" });
    });

    it("renders no body label and does not crash (no meta)", () => {
      wrapper = mountNode("c1", undefined);
      expect(wrapper.text()).toBe("");
    });
  });
});

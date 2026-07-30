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

// Guard tests for the workflow run-history mapping (loadWorkflowRun). This is
// the most merge-sensitive workflow logic: it adapts the backend /errors/{run_id}
// response (errors as an ARRAY, per-node inputs as a MAP) into the shared
// testRun.result shape the canvas badges + step drawer read.

import { describe, it, expect, beforeEach, vi } from "vitest";
import i18nInstance from "@/locales";

// useWorkflowCanvas takes an injected translator; supplied here from the shared
// instance since this spec runs outside a component.
const t = (i18nInstance.global as any).t;

vi.mock("@/services/workflows", () => ({
  default: { getWorkflowRun: vi.fn(), testWorkflow: vi.fn() },
}));

vi.mock("@/utils/zincutils", () => ({
  getImageURL: (p: string) => p,
  getUUID: () => "uuid",
}));

vi.mock("@vue-flow/core", () => ({
  useVueFlow: () => ({
    screenToFlowCoordinate: (p: any) => p,
    onNodesInitialized: vi.fn(),
    updateNode: vi.fn(),
  }),
}));

const mockToast = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...args: any[]) => mockToast(...args),
}));

import workflowService from "@/services/workflows";
import useWorkflowCanvas, {
  workflowObj,
  loadWorkflowRun,
  executeTestRun,
  serializeWorkflow,
  currentTriggerKind,
} from "@/plugins/workflows/useWorkflowCanvas";

const triggerNode = () => ({
  id: "t1",
  type: "input",
  position: { x: 0, y: 0 },
  data: { label: "t1", node_type: "workflow_trigger" },
});

const mockRun = workflowService.getWorkflowRun as unknown as ReturnType<typeof vi.fn>;
const mockTest = workflowService.testWorkflow as unknown as ReturnType<typeof vi.fn>;

describe("loadWorkflowRun — history run response mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // trigger(n1) -> function(n2) -> destination(n3)
    workflowObj.currentSelectedWorkflow = {
      id: "wf1",
      name: "wf",
      nodes: [{ id: "n1" }, { id: "n2" }, { id: "n3" }],
      edges: [
        { source: "n1", target: "n2" },
        { source: "n2", target: "n3" },
      ],
    } as any;
    workflowObj.testRun.result = null;
  });

  it("maps errors.data (array) to a node-keyed map and node_map to nodeInputs", async () => {
    const envelope = [{ meta: { alert_name: "t" }, data: [{ a: 1 }] }];
    mockRun.mockResolvedValue({
      data: {
        errors: { run_id: "r1", data: [{ node_id: "n2", error: ["boom"] }] },
        data: { complete: envelope, node_map: { n2: envelope } },
      },
    });

    const r = await loadWorkflowRun({ orgId: "o", workflowId: "wf1", runId: "r1" });
    expect(r.ok).toBe(true);

    const res: any = workflowObj.testRun.result;
    expect(res.mode).toBe("history");
    expect(res.runId).toBe("r1");
    // array -> keyed map, in the { error_count, errors: [[msg]] } badge shape
    expect(res.errors.n2).toEqual({ error_count: 1, errors: [["boom"]] });
    // per-node input carried through verbatim (the {meta,data} envelope)
    expect(res.nodeInputs.n2).toEqual(envelope);
    expect(res.fullInput).toEqual(envelope);
    // every node counts as "ran"; n3 is downstream of the errored n2 -> blocked
    expect(res.ranNodeIds).toEqual(["n1", "n2", "n3"]);
    expect(res.blockedNodeIds).toContain("n3");
    expect(res.blockedNodeIds).not.toContain("n2");
  });

  it("normalizes a non-array error field into a single-message list", async () => {
    mockRun.mockResolvedValue({
      data: {
        errors: { data: [{ node_id: "n2", error: "single" }] },
        data: { node_map: {} },
      },
    });
    await loadWorkflowRun({ orgId: "o", workflowId: "wf1", runId: "r2" });
    expect((workflowObj.testRun.result as any).errors.n2).toEqual({
      error_count: 1,
      errors: [["single"]],
    });
  });

  it("handles a clean run (no errors) with empty maps", async () => {
    mockRun.mockResolvedValue({
      data: { errors: { data: [] }, data: { node_map: {} } },
    });
    const r = await loadWorkflowRun({ orgId: "o", workflowId: "wf1", runId: "r3" });
    expect(r.ok).toBe(true);
    const res: any = workflowObj.testRun.result;
    expect(Object.keys(res.errors)).toHaveLength(0);
    expect(res.blockedNodeIds).toHaveLength(0);
  });

  // A run can reference a node the workflow no longer has (edited/deleted since).
  // Its badge has nowhere to render, so the error would silently vanish and the
  // run would look cleaner than it was — the Runs view warns off `ghostNodeIds`.
  describe("ghost nodes (workflow edited since the run)", () => {
    it("flags run nodes that no longer exist in the graph", async () => {
      mockRun.mockResolvedValue({
        data: {
          // n2 still exists; "deleted-node" was removed from the workflow
          errors: {
            data: [
              { node_id: "n2", error: ["boom"] },
              { node_id: "deleted-node", error: ["gone"] },
            ],
          },
          data: { node_map: {} },
        },
      });
      await loadWorkflowRun({ orgId: "o", workflowId: "wf1", runId: "r1" });
      expect((workflowObj.testRun.result as any).ghostNodeIds).toEqual(["deleted-node"]);
    });

    it("also flags a ghost referenced only by node_map (no error)", async () => {
      mockRun.mockResolvedValue({
        data: {
          errors: { data: [] },
          data: { node_map: { n1: [], "old-node": [] } },
        },
      });
      await loadWorkflowRun({ orgId: "o", workflowId: "wf1", runId: "r2" });
      expect((workflowObj.testRun.result as any).ghostNodeIds).toEqual(["old-node"]);
    });

    it("is empty when the graph still matches the run", async () => {
      mockRun.mockResolvedValue({
        data: {
          errors: { data: [{ node_id: "n2", error: ["boom"] }] },
          data: { node_map: { n1: [], n3: [] } },
        },
      });
      await loadWorkflowRun({ orgId: "o", workflowId: "wf1", runId: "r3" });
      expect((workflowObj.testRun.result as any).ghostNodeIds).toEqual([]);
    });

    it("does not double-report a ghost referenced by BOTH errors and node_map", async () => {
      mockRun.mockResolvedValue({
        data: {
          errors: { data: [{ node_id: "zombie", error: ["x"] }] },
          data: { node_map: { zombie: [] } },
        },
      });
      await loadWorkflowRun({ orgId: "o", workflowId: "wf1", runId: "r4" });
      expect((workflowObj.testRun.result as any).ghostNodeIds).toEqual(["zombie"]);
    });
  });

  it("returns ok:false with the backend message on failure", async () => {
    mockRun.mockRejectedValue({ response: { data: { message: "nope" } } });
    const r = await loadWorkflowRun({ orgId: "o", workflowId: "wf1", runId: "r4" });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("nope");
  });
});

// The Save-before-Test prompt keys off `dirtyFlag`. VueFlow fires onEdgesChange
// for non-structural changes too (select/dimensions), and inspecting a run
// (hover a node → click its error badge → Esc) triggers those. Only a real edit
// (edge added/removed) should dirty the workflow — otherwise a second Test wrongly
// asks to save unchanged work.
describe("onEdgesChange — dirty flag only on structural changes", () => {
  const { onEdgesChange } = useWorkflowCanvas(t);

  beforeEach(() => {
    workflowObj.isEditWorkflow = true;
    workflowObj.dirtyFlag = false;
  });

  it("does NOT dirty on a select change (e.g. click / Esc during run inspection)", () => {
    onEdgesChange([{ type: "select", id: "e1", selected: true }]);
    expect(workflowObj.dirtyFlag).toBe(false);
  });

  it("does NOT dirty on a dimensions change", () => {
    onEdgesChange([{ type: "dimensions", id: "e1" }]);
    expect(workflowObj.dirtyFlag).toBe(false);
  });

  it("DOES dirty when an edge is added", () => {
    onEdgesChange([{ type: "add", item: { id: "e2" } }]);
    expect(workflowObj.dirtyFlag).toBe(true);
  });

  it("DOES dirty when an edge is removed", () => {
    onEdgesChange([{ type: "remove", id: "e1" }]);
    expect(workflowObj.dirtyFlag).toBe(true);
  });
});

// executeTestRun paints the ✓/✗/⊘ badges. The key invariant: only nodes that
// ACTUALLY ran (reachable from the trigger, or from the replay node) may show a
// ✓ — an unwired/disconnected node never executed and must stay badge-less. A
// failed run must also not leave the previous run's badges on screen.
describe("executeTestRun — ran-node scope + badge state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // trigger(t) -> function(f) -> destination(d); x is dropped on the canvas
    // but NOT wired to anything.
    workflowObj.currentSelectedWorkflow = {
      id: "wf1",
      name: "wf",
      nodes: [
        { id: "t", data: { node_type: "workflow_trigger" } },
        { id: "f", data: { node_type: "function" } },
        { id: "d", data: { node_type: "destination" } },
        { id: "x", data: { node_type: "function" } },
      ],
      edges: [
        { source: "t", target: "f" },
        { source: "f", target: "d" },
      ],
    } as any;
    workflowObj.testRun.result = null;
  });

  it("full run marks only nodes reachable from the trigger as ran (unwired node excluded)", async () => {
    mockTest.mockResolvedValue({ data: { errors: {} } });
    const r = await executeTestRun({ orgId: "o", inputs: [{ a: 1 }] });
    expect(r.ok).toBe(true);
    const res: any = workflowObj.testRun.result;
    expect(res.ranNodeIds.sort()).toEqual(["d", "f", "t"]);
    // the disconnected node never ran → no ✓ badge
    expect(res.ranNodeIds).not.toContain("x");
    expect(res.blockedNodeIds).toEqual([]);
  });

  it("sends the whole in-memory graph (test-without-saving), not just an id", async () => {
    mockTest.mockResolvedValue({ data: { errors: {} } });
    await executeTestRun({ orgId: "o", inputs: [{ a: 1 }], fromNode: "f" });
    const arg = mockTest.mock.calls[0][0];
    expect(arg.org_identifier).toBe("o");
    expect(arg.from_node).toBe("f");
    // no top-level workflow id — the graph rides in `workflow`
    expect(arg.id).toBeUndefined();
    expect(arg.workflow.id).toBe("wf1");
    expect(arg.workflow.nodes.map((n: any) => n.id).sort()).toEqual(["d", "f", "t", "x"]);
    expect(arg.workflow.edges).toHaveLength(2);
  });

  it("replay from a mid-graph node marks that node + everything downstream", async () => {
    mockTest.mockResolvedValue({ data: { errors: {} } });
    await executeTestRun({ orgId: "o", inputs: [{ a: 1 }], fromNode: "f" });
    const res: any = workflowObj.testRun.result;
    expect(res.ranNodeIds.sort()).toEqual(["d", "f"]);
    expect(res.ranNodeIds).not.toContain("t");
  });

  it("marks nodes downstream of an errored node as blocked (not passed)", async () => {
    mockTest.mockResolvedValue({
      data: { errors: { f: { error_count: 1, errors: [["boom"]] } } },
    });
    await executeTestRun({ orgId: "o", inputs: [{ a: 1 }] });
    const res: any = workflowObj.testRun.result;
    expect(res.blockedNodeIds).toContain("d");
    expect(res.blockedNodeIds).not.toContain("f");
  });

  it("no trigger in the graph → nothing is marked as ran", async () => {
    workflowObj.currentSelectedWorkflow.nodes = [
      { id: "a", data: { node_type: "function" } },
    ] as any;
    workflowObj.currentSelectedWorkflow.edges = [] as any;
    mockTest.mockResolvedValue({ data: { errors: {} } });
    await executeTestRun({ orgId: "o", inputs: [{ a: 1 }] });
    expect((workflowObj.testRun.result as any).ranNodeIds).toEqual([]);
  });

  it("a failed run clears the previous run's badges (result = null)", async () => {
    // seed a prior successful result
    mockTest.mockResolvedValueOnce({ data: { errors: {} } });
    await executeTestRun({ orgId: "o", inputs: [{ a: 1 }] });
    expect(workflowObj.testRun.result).not.toBeNull();
    // now a run that throws
    mockTest.mockRejectedValueOnce({ response: { data: { message: "down" } } });
    const r = await executeTestRun({ orgId: "o", inputs: [{ a: 1 }] });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("down");
    expect(workflowObj.testRun.result).toBeNull();
  });
});

// serializeWorkflow builds the backend `Workflow` object shared by both the
// create/update payload and the Test run — so testing without saving sends the
// exact same graph the editor would persist.
describe("serializeWorkflow — backend Workflow shape", () => {
  it("emits every required field and only the persisted node fields", () => {
    workflowObj.currentSelectedWorkflow = {
      id: "wf9",
      name: "  padded name  ",
      description: "desc",
      enabled: false,
      created_at: 10,
      updated_at: 20,
      nodes: [
        {
          id: "t",
          type: "input",
          position: { x: 5, y: 6 },
          data: { node_type: "workflow_trigger", trigger_kind: "alert_fired" },
          // VueFlow runtime state that must be dropped:
          dimensions: { width: 1, height: 1 },
          selected: true,
          dragging: false,
        },
      ],
      edges: [{ source: "t", target: "f" }],
    } as any;

    const wf = serializeWorkflow();
    expect(Object.keys(wf).sort()).toEqual([
      "created_at",
      "created_by",
      "description",
      "edges",
      "enabled",
      "id",
      "name",
      "nodes",
      "org_id",
      "updated_at",
    ]);
    expect(wf.name).toBe("padded name"); // trimmed
    expect(wf.enabled).toBe(false);
    expect(wf.org_id).toBe(""); // backend overrides
    expect(wf.created_by).toBe("");

    const node = wf.nodes[0];
    // persisted fields only — runtime state stripped
    expect(Object.keys(node).sort()).toEqual(["data", "id", "io_type", "meta", "position"]);
    expect(node.io_type).toBe("input");
    // trigger kind carried in meta (NodeData::WorkflowTrigger is a unit variant)
    expect(node.meta.trigger_kind).toBe("alert_fired");
    expect(node.dimensions).toBeUndefined();
    expect(node.selected).toBeUndefined();
  });

  it("defaults enabled to true and id/name to empty for a fresh graph", () => {
    workflowObj.currentSelectedWorkflow = { nodes: [], edges: [] } as any;
    const wf = serializeWorkflow();
    expect(wf.enabled).toBe(true);
    expect(wf.id).toBe("");
    expect(wf.name).toBe("");
    expect(wf.nodes).toEqual([]);
    expect(wf.edges).toEqual([]);
  });
});

describe("trigger-first guard — palette adds are blocked until a trigger exists", () => {
  const { addNodeToEnd, onDrop } = useWorkflowCanvas(t);

  beforeEach(() => {
    mockToast.mockClear();
    workflowObj.currentSelectedWorkflow.nodes = [];
    workflowObj.currentSelectedWorkflow.edges = [];
    workflowObj.currentSelectedNodeData = null;
    workflowObj.dialog = { show: false, name: "", expand: false };
  });

  it("addNodeToEnd (palette click) is blocked with a toast when no trigger exists", () => {
    addNodeToEnd("condition");
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "warning" }));
    expect(workflowObj.dialog.show).toBe(false);
    expect(workflowObj.currentSelectedNodeData).toBeNull();
  });

  it("onDrop (palette drag) is blocked with a toast when no trigger exists", () => {
    workflowObj.draggedNodeType = "function";
    onDrop({ clientX: 10, clientY: 10 } as any);
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "warning" }));
    expect(workflowObj.dialog.show).toBe(false);
    expect(workflowObj.currentSelectedNodeData).toBeNull();
  });

  it("addNodeToEnd stages a node once a trigger is present", () => {
    workflowObj.currentSelectedWorkflow.nodes = [triggerNode()];
    addNodeToEnd("condition");
    expect(mockToast).not.toHaveBeenCalled();
    expect(workflowObj.dialog.show).toBe(true);
    expect(workflowObj.currentSelectedNodeData?.data.node_type).toBe("condition");
  });

  it("onDrop stages a node once a trigger is present", () => {
    workflowObj.currentSelectedWorkflow.nodes = [triggerNode()];
    workflowObj.draggedNodeType = "function";
    onDrop({ clientX: 10, clientY: 10 } as any);
    expect(mockToast).not.toHaveBeenCalled();
    expect(workflowObj.dialog.show).toBe(true);
    expect(workflowObj.currentSelectedNodeData?.data.node_type).toBe("function");
  });
});

describe("currentTriggerKind", () => {
  const setNodes = (nodes: any[]) => {
    workflowObj.currentSelectedWorkflow = { nodes } as any;
  };

  it("returns undefined when there is no trigger node", () => {
    setNodes([{ id: "c1", data: { node_type: "condition" } }]);
    expect(currentTriggerKind()).toBeUndefined();
  });

  it("reads the kind from a fresh trigger node (data.trigger_kind)", () => {
    setNodes([
      { id: "t1", data: { node_type: "workflow_trigger", trigger_kind: "incident_event" } },
    ]);
    expect(currentTriggerKind()).toBe("incident_event");
  });

  it("falls back to meta.trigger_kind (rehydrated from the API)", () => {
    setNodes([
      {
        id: "t1",
        data: { node_type: "workflow_trigger" },
        meta: { trigger_kind: "alert_fired" },
      },
    ]);
    expect(currentTriggerKind()).toBe("alert_fired");
  });

  it("prefers data.trigger_kind over meta.trigger_kind", () => {
    setNodes([
      {
        id: "t1",
        data: { node_type: "workflow_trigger", trigger_kind: "incident_event" },
        meta: { trigger_kind: "alert_fired" },
      },
    ]);
    expect(currentTriggerKind()).toBe("incident_event");
  });
});

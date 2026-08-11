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
  // makeEdge (via commitNode) reads MarkerType.ArrowClosed for the edge marker.
  MarkerType: { ArrowClosed: "arrowclosed" },
}));

const mockToast = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...args: any[]) => mockToast(...args),
}));

import workflowService from "@/services/workflows";
import useWorkflowCanvas, {
  workflowObj,
  hydrateWorkflow,
  loadWorkflowRun,
  executeTestRun,
  serializeWorkflow,
  nodeTestInput,
  nodeTestOutputBranches,
  currentTriggerKind,
  buildStepTree,
  toggleNodeDisabled,
  undoWorkflow,
  pushWorkflowHistory,
  resetWorkflowHistory,
  tidyWorkflowLayout,
  isNodeIncomplete,
  setNodeIncomplete,
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

  it("maps errors.data (array) to a node-keyed map and input_map to the inputs map", async () => {
    const envelope = [{ meta: { alert_name: "t" }, data: [{ a: 1 }] }];
    mockRun.mockResolvedValue({
      data: {
        errors: { run_id: "r1", data: [{ node_id: "n2", error: ["boom"] }] },
        // input_map = per-node input for ALL nodes (same shape as a Test run)
        data: {
          input_map: { n1: envelope, n2: envelope, n3: envelope },
          error_node_map: { n2: envelope },
        },
      },
    });

    const r = await loadWorkflowRun({ orgId: "o", workflowId: "wf1", runId: "r1" });
    expect(r.ok).toBe(true);

    const res: any = workflowObj.testRun.result;
    expect(res.mode).toBe("history");
    expect(res.runId).toBe("r1");
    // array -> keyed map, in the { error_count, errors: [[msg]] } badge shape
    expect(res.errors.n2).toEqual({ error_count: 1, errors: [["boom"]] });
    // per-node input stored under `inputs` (drives Input + derived Output + badges)
    expect(res.inputs).toEqual({ n1: envelope, n2: envelope, n3: envelope });
    // every node counts as "ran"; n3 is downstream of the errored n2 -> blocked
    expect(res.ranNodeIds).toEqual(["n1", "n2", "n3"]);
    expect(res.blockedNodeIds).toContain("n3");
    expect(res.blockedNodeIds).not.toContain("n2");
  });

  it("falls back to error_node_map for older runs that lack input_map", async () => {
    const envelope = [{ meta: {}, data: [{ a: 1 }] }];
    mockRun.mockResolvedValue({
      data: { errors: { data: [] }, data: { error_node_map: { n2: envelope } } },
    });
    await loadWorkflowRun({ orgId: "o", workflowId: "wf1", runId: "r1b" });
    expect((workflowObj.testRun.result as any).inputs).toEqual({ n2: envelope });
  });

  it("normalizes a non-array error field into a single-message list", async () => {
    mockRun.mockResolvedValue({
      data: {
        errors: { data: [{ node_id: "n2", error: "single" }] },
        data: { error_node_map: {} },
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
      data: { errors: { data: [] }, data: { error_node_map: {} } },
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
          data: { error_node_map: {} },
        },
      });
      await loadWorkflowRun({ orgId: "o", workflowId: "wf1", runId: "r1" });
      expect((workflowObj.testRun.result as any).ghostNodeIds).toEqual(["deleted-node"]);
    });

    it("also flags a ghost referenced only by error_node_map (no error)", async () => {
      mockRun.mockResolvedValue({
        data: {
          errors: { data: [] },
          data: { error_node_map: { n1: [], "old-node": [] } },
        },
      });
      await loadWorkflowRun({ orgId: "o", workflowId: "wf1", runId: "r2" });
      expect((workflowObj.testRun.result as any).ghostNodeIds).toEqual(["old-node"]);
    });

    it("is empty when the graph still matches the run", async () => {
      mockRun.mockResolvedValue({
        data: {
          errors: { data: [{ node_id: "n2", error: ["boom"] }] },
          data: { error_node_map: { n1: [], n3: [] } },
        },
      });
      await loadWorkflowRun({ orgId: "o", workflowId: "wf1", runId: "r3" });
      expect((workflowObj.testRun.result as any).ghostNodeIds).toEqual([]);
    });

    it("does not double-report a ghost referenced by BOTH errors and error_node_map", async () => {
      mockRun.mockResolvedValue({
        data: {
          errors: { data: [{ node_id: "zombie", error: ["x"] }] },
          data: { error_node_map: { zombie: [] } },
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
    // ranSteps snapshots the executed-steps tree (structure + frozen data) so the
    // dock can persist across later edits.
    expect(res.ranSteps.map((s: any) => s.id)).toEqual(["t", "f", "d"]);
    expect(res.ranSteps.find((s: any) => s.id === "t")).toMatchObject({
      depth: 0,
      childCount: 1,
    });
    expect(res.ranSteps.find((s: any) => s.id === "f").data.node_type).toBe("function");
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

// The executed-steps tree that the results dock renders (traces-waterfall layout):
// DFS pre-order, sibling order by canvas position, and per-column connector guides.
describe("buildStepTree — executed-steps tree structure", () => {
  const nodes = [
    { id: "t", position: { x: 0, y: 0 }, data: { node_type: "workflow_trigger" } },
    { id: "f", position: { x: 0, y: 100 }, data: { node_type: "function" } },
    { id: "d", position: { x: 0, y: 200 }, data: { node_type: "destination" } },
    { id: "c", position: { x: 200, y: 100 }, data: { node_type: "condition" } },
  ];
  // t fans out to f (x=0) and c (x=200); f -> d.
  const edges = [
    { source: "t", target: "f" },
    { source: "f", target: "d" },
    { source: "t", target: "c" },
  ];

  it("computes DFS pre-order, depth, child count and connector guides", () => {
    const tree = buildStepTree(nodes, edges, ["t", "f", "d", "c"]);
    // DFS: t, then its children in canvas order (f before c), f's child d nested.
    expect(tree.map((s) => s.id)).toEqual(["t", "f", "d", "c"]);
    expect(tree.find((s) => s.id === "t")).toMatchObject({ depth: 0, childCount: 2, guides: [] });
    // f is the FIRST of two children → its rail continues (guides ends true).
    expect(tree.find((s) => s.id === "f")).toMatchObject({
      depth: 1,
      childCount: 1,
      guides: [true],
    });
    // d carries f's continuing rail (true) then its own last-child elbow (false).
    expect(tree.find((s) => s.id === "d")).toMatchObject({
      depth: 2,
      childCount: 0,
      guides: [true, false],
    });
    // c is the LAST child → elbow, no continuation.
    expect(tree.find((s) => s.id === "c")).toMatchObject({
      depth: 1,
      childCount: 0,
      guides: [false],
    });
  });

  it("bounds the tree to ran nodes and re-roots a replay subset at depth 0", () => {
    const tree = buildStepTree(nodes, edges, ["f", "d"]);
    expect(tree.map((s) => s.id)).toEqual(["f", "d"]);
    expect(tree[0]).toMatchObject({ id: "f", depth: 0 });
    expect(tree[1]).toMatchObject({ id: "d", depth: 1 });
  });
});

// The results dock persists across graph edits: only a new run or the
// explicit Clear button drops it. Editing/disabling/undoing must NOT null it.
describe("Test log persistence across graph edits", () => {
  beforeEach(() => {
    workflowObj.currentSelectedWorkflow = {
      id: "wf",
      name: "wf",
      nodes: [
        { id: "t", data: { node_type: "workflow_trigger" } },
        { id: "f", data: { node_type: "function" } },
      ],
      edges: [{ source: "t", target: "f" }],
    } as any;
    workflowObj.readOnly = false;
    workflowObj.testRun.result = {
      errors: {},
      inputs: {},
      ranNodeIds: ["t", "f"],
      ranSteps: [],
      blockedNodeIds: [],
    } as any;
    resetWorkflowHistory();
  });

  it("disabling a node keeps the run result (dock stays open)", () => {
    toggleNodeDisabled("f");
    expect(workflowObj.testRun.result).not.toBeNull();
  });

  it("undo keeps the run result", () => {
    pushWorkflowHistory();
    workflowObj.currentSelectedWorkflow.nodes.push({
      id: "g",
      data: { node_type: "function" },
    } as any);
    undoWorkflow();
    expect(workflowObj.testRun.result).not.toBeNull();
  });

  it("deleting a node keeps the run result (deleted step stays listed struck-through)", () => {
    const { deleteNode } = useWorkflowCanvas();
    deleteNode("f");
    expect(
      workflowObj.currentSelectedWorkflow.nodes.find((n: any) => n.id === "f"),
    ).toBeUndefined();
    expect(workflowObj.testRun.result).not.toBeNull();
  });
});

// Tidy lays the main tree top-down; an ORPHAN subtree (unreachable from the trigger,
// e.g. a node just dragged in and wired up before connecting to the trigger) must
// keep its own parent→child order + depth, not get flattened/reversed by array order.
describe("tidyWorkflowLayout — orphan subtree ordering", () => {
  it("lays an orphan Condition→Function chain parent-above-child (not reversed)", () => {
    // Orphan chain oc → of, with the CHILD listed BEFORE the parent in the array —
    // the old array-order stacking would have put the function above the condition.
    workflowObj.currentSelectedWorkflow = {
      id: "wf",
      name: "wf",
      nodes: [
        { id: "t", data: { node_type: "workflow_trigger" }, position: { x: 0, y: 0 } },
        { id: "c1", data: { node_type: "condition" }, position: { x: 0, y: 0 } },
        { id: "of", data: { node_type: "function" }, position: { x: 0, y: 0 } },
        { id: "oc", data: { node_type: "condition" }, position: { x: 0, y: 0 } },
      ],
      edges: [
        { source: "t", target: "c1" },
        { source: "oc", target: "of" }, // orphan subtree, not reachable from the trigger
      ],
    } as any;
    workflowObj.readOnly = false;

    expect(tidyWorkflowLayout()).toBe(true);
    const pos = (id: string) =>
      workflowObj.currentSelectedWorkflow.nodes.find((n: any) => n.id === id).position;
    // Parent condition sits ABOVE its child function (smaller y).
    expect(pos("oc").y).toBeLessThan(pos("of").y);
    // The orphan subtree is placed in its own column, clear of the main tree.
    expect(pos("oc").x).not.toBe(pos("c1").x);
  });
});

// nodeTestInput / nodeTestOutputBranches derive per-node Input and Output from the
// backend `inputs` map. Output on an edge == the child's input (single-incoming
// tree), so these two helpers power the whole step-drawer.
describe("nodeTestInput + nodeTestOutputBranches — per-node I/O derivation", () => {
  beforeEach(() => {
    // trigger(t) -> function(f) -> destination(d);  t also -> condition(c) (fan-out)
    workflowObj.currentSelectedWorkflow = {
      id: "wf1",
      name: "wf",
      nodes: [
        { id: "t", data: { node_type: "workflow_trigger" } },
        { id: "f", data: { node_type: "function", name: "fn" } },
        { id: "d", data: { node_type: "destination", destination_id: "sink" } },
        { id: "c", data: { node_type: "condition" } },
      ],
      edges: [
        { source: "t", target: "f" },
        { source: "t", target: "c" },
        { source: "f", target: "d" },
      ],
    } as any;
    workflowObj.testRun.result = {
      errors: {},
      inputs: { t: [{ x: 0 }], f: [{ x: 1 }], d: [{ x: 2 }] }, // c got nothing
      ranNodeIds: ["t", "f", "c", "d"],
      blockedNodeIds: [],
    } as any;
  });

  it("nodeTestInput returns the records a node received, null when absent", () => {
    expect(nodeTestInput("f")).toEqual([{ x: 1 }]);
    expect(nodeTestInput("c")).toBeNull(); // filtered out — not in inputs
    expect(nodeTestInput("missing")).toBeNull();
  });

  it("nodeTestInput is null when there is no run", () => {
    workflowObj.testRun.result = null as any;
    expect(nodeTestInput("f")).toBeNull();
  });

  it("nodeTestOutputBranches: a node's output == each child's input", () => {
    const branches = nodeTestOutputBranches("f");
    expect(branches).toHaveLength(1);
    expect(branches[0]).toMatchObject({ targetId: "d", nodeType: "destination" });
    expect(branches[0].records).toEqual([{ x: 2 }]); // == inputs[d]
  });

  it("fan-out yields one branch per outgoing edge; a filtered branch has null records", () => {
    const branches = nodeTestOutputBranches("t");
    expect(branches.map((b) => b.targetId).sort()).toEqual(["c", "f"]);
    const toC = branches.find((b) => b.targetId === "c")!;
    const toF = branches.find((b) => b.targetId === "f")!;
    expect(toC.records).toBeNull(); // c received nothing
    expect(toF.records).toEqual([{ x: 1 }]);
  });

  it("a terminal (destination) has no outgoing edges → no branches", () => {
    expect(nodeTestOutputBranches("d")).toEqual([]);
  });
});

// executeTestRun stores the per-node inputs map so the drawer/badges can read it.
describe("executeTestRun — stores the per-node inputs map", () => {
  it("keeps res.data.inputs on testRun.result", async () => {
    workflowObj.currentSelectedWorkflow = {
      id: "wf1",
      name: "wf",
      nodes: [{ id: "t", data: { node_type: "workflow_trigger" } }],
      edges: [],
    } as any;
    mockTest.mockResolvedValue({ data: { errors: {}, inputs: { t: [{ x: 1 }] } } });
    await executeTestRun({ orgId: "o", inputs: [{ a: 1 }] });
    expect((workflowObj.testRun.result as any).inputs).toEqual({ t: [{ x: 1 }] });
  });

  it("defaults inputs to {} when the response omits it", async () => {
    workflowObj.currentSelectedWorkflow = {
      id: "wf1",
      name: "wf",
      nodes: [{ id: "t", data: { node_type: "workflow_trigger" } }],
      edges: [],
    } as any;
    mockTest.mockResolvedValue({ data: { errors: {} } });
    await executeTestRun({ orgId: "o", inputs: [{ a: 1 }] });
    expect((workflowObj.testRun.result as any).inputs).toEqual({});
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
    // persisted fields only — runtime state stripped. is_disabled (T6) is always
    // emitted at the node root.
    expect(Object.keys(node).sort()).toEqual([
      "data",
      "id",
      "io_type",
      "is_disabled",
      "meta",
      "position",
    ]);
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

describe("placeholder / incomplete node (Configure Later)", () => {
  beforeEach(() => {
    workflowObj.readOnly = false;
    workflowObj.dirtyFlag = false;
  });

  it("isNodeIncomplete reads meta.incomplete === 'true'", () => {
    expect(isNodeIncomplete({ meta: { incomplete: "true" } })).toBe(true);
    expect(isNodeIncomplete({ meta: { incomplete: "false" } })).toBe(false);
    expect(isNodeIncomplete({ meta: {} })).toBe(false);
    expect(isNodeIncomplete({})).toBe(false);
    expect(isNodeIncomplete(null)).toBe(false);
  });

  it("setNodeIncomplete(true) sets meta.incomplete and marks the graph dirty", () => {
    const node: any = { id: "d1", data: { node_type: "destination", destination_id: "" } };
    setNodeIncomplete(node, true);
    expect(node.meta.incomplete).toBe("true");
    expect(workflowObj.dirtyFlag).toBe(true);
  });

  it("setNodeIncomplete(false) removes the meta.incomplete key (serializes clean)", () => {
    const node: any = { id: "d1", meta: { incomplete: "true", label: "Sink" } };
    setNodeIncomplete(node, false);
    expect(node.meta.incomplete).toBeUndefined();
    // other meta keys are preserved
    expect(node.meta.label).toBe("Sink");
  });

  it("meta.incomplete round-trips through serializeWorkflow", () => {
    workflowObj.currentSelectedWorkflow = {
      nodes: [
        {
          id: "d1",
          type: "output",
          position: { x: 0, y: 0 },
          data: { node_type: "destination", destination_id: "" },
          meta: { incomplete: "true" },
        },
      ],
      edges: [],
    } as any;
    const wf = serializeWorkflow();
    expect(wf.nodes[0].meta.incomplete).toBe("true");
    expect(wf.nodes[0].data.destination_id).toBe("");
  });
});

describe("hydrateWorkflow — draft flag normalization", () => {
  it("normalizes a list row's is_draft:true onto the store's isDraft", () => {
    hydrateWorkflow({ id: "d1", name: "draft wf", nodes: [], edges: [], is_draft: true });
    expect(workflowObj.currentSelectedWorkflow.isDraft).toBe(true);
  });

  it("sets isDraft false for a published row (is_draft:false)", () => {
    hydrateWorkflow({ id: "w1", name: "wf", nodes: [], edges: [], is_draft: false });
    expect(workflowObj.currentSelectedWorkflow.isDraft).toBe(false);
  });

  it("defaults isDraft to false when the row has no is_draft field", () => {
    hydrateWorkflow({ id: "w1", name: "wf", nodes: [], edges: [] });
    expect(workflowObj.currentSelectedWorkflow.isDraft).toBe(false);
  });

  it("flips isEditWorkflow on and preserves the name/graph while normalizing", () => {
    hydrateWorkflow({ id: "d1", name: "wip", nodes: [], edges: [], is_draft: true });
    expect(workflowObj.isEditWorkflow).toBe(true);
    expect(workflowObj.currentSelectedWorkflow.name).toBe("wip");
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

describe("addNodeOnEdge — insert-between spacing (T7)", () => {
  const resetStaged = () => {
    workflowObj.readOnly = false;
    workflowObj.currentSelectedNodeData = null;
    workflowObj.pendingInsert = null;
    workflowObj.pendingEdge = null;
    workflowObj.isEditNode = false;
  };

  it("places the spliced node a row below the source and nudges the target down", () => {
    const { addNodeOnEdge, commitNode } = useWorkflowCanvas(t);
    resetStaged();
    workflowObj.currentSelectedWorkflow = {
      nodes: [
        {
          id: "t",
          type: "input",
          position: { x: 100, y: 0 },
          data: { node_type: "workflow_trigger" },
        },
        {
          id: "d",
          type: "output",
          position: { x: 100, y: 160 },
          data: { node_type: "destination" },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "d" }],
    } as any;

    addNodeOnEdge("e1", "condition");
    const staged = workflowObj.currentSelectedNodeData;
    // staged a row below the source, aligned with the target column
    expect(staged.position.y).toBe(160);
    expect(staged.position.x).toBe(100);

    commitNode({});
    const wf = workflowObj.currentSelectedWorkflow;
    const inserted = wf.nodes.find((n: any) => n.id === staged.id);
    const target = wf.nodes.find((n: any) => n.id === "d");
    // new node stays a row below the source; target pushed down a full row below it
    expect(inserted.position.y).toBe(160);
    expect(target.position.y).toBe(320);
    // rewired A→new→B, old edge dropped
    expect(wf.edges.some((e: any) => e.source === "t" && e.target === staged.id)).toBe(true);
    expect(wf.edges.some((e: any) => e.source === staged.id && e.target === "d")).toBe(true);
    expect(wf.edges.some((e: any) => e.id === "e1")).toBe(false);
  });

  it("also shifts nodes downstream of the target", () => {
    const { addNodeOnEdge, commitNode } = useWorkflowCanvas(t);
    resetStaged();
    workflowObj.currentSelectedWorkflow = {
      nodes: [
        {
          id: "t",
          type: "input",
          position: { x: 100, y: 0 },
          data: { node_type: "workflow_trigger" },
        },
        {
          id: "c",
          type: "default",
          position: { x: 100, y: 160 },
          data: { node_type: "condition" },
        },
        {
          id: "d",
          type: "output",
          position: { x: 100, y: 320 },
          data: { node_type: "destination" },
        },
      ],
      edges: [
        { id: "e1", source: "t", target: "c" },
        { id: "e2", source: "c", target: "d" },
      ],
    } as any;

    // insert on the trigger→condition edge; condition AND its downstream destination shift
    addNodeOnEdge("e1", "function");
    const staged = workflowObj.currentSelectedNodeData;
    commitNode({});
    const wf = workflowObj.currentSelectedWorkflow;
    expect(wf.nodes.find((n: any) => n.id === staged.id).position.y).toBe(160);
    expect(wf.nodes.find((n: any) => n.id === "c").position.y).toBe(320);
    expect(wf.nodes.find((n: any) => n.id === "d").position.y).toBe(480);
  });

  it("does not shift a target that already has enough room", () => {
    const { addNodeOnEdge, commitNode } = useWorkflowCanvas(t);
    resetStaged();
    workflowObj.currentSelectedWorkflow = {
      nodes: [
        {
          id: "t",
          type: "input",
          position: { x: 0, y: 0 },
          data: { node_type: "workflow_trigger" },
        },
        { id: "d", type: "output", position: { x: 0, y: 400 }, data: { node_type: "destination" } },
      ],
      edges: [{ id: "e1", source: "t", target: "d" }],
    } as any;

    addNodeOnEdge("e1", "condition");
    commitNode({});
    const wf = workflowObj.currentSelectedWorkflow;
    // target already 400 below (> new node at 160 + 160 gap), so it stays put
    expect(wf.nodes.find((n: any) => n.id === "d").position.y).toBe(400);
  });
});

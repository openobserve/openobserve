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
  default: {
    getWorkflowRun: vi.fn(),
    testWorkflow: vi.fn(),
    getWorkflowHistory: vi.fn(),
    updateWorkflow: vi.fn(),
    retryWorkflow: vi.fn(),
  },
}));

vi.mock("@/utils/zincutils", () => ({
  getImageURL: (p: string) => p,
  // Unique per call: a single test may add SEVERAL nodes (a branch's two arms),
  // and a constant id would make the second add collide with the first.
  getUUID: (() => {
    let n = 0;
    return () => `uuid-${++n}`;
  })(),
}));

vi.mock("@vue-flow/core", () => ({
  useVueFlow: () => ({
    screenToFlowCoordinate: (p: any) => p,
    onNodesInitialized: vi.fn(),
    updateNode: vi.fn(),
  }),
  // makeEdge (via commitStagedNode) reads MarkerType.ArrowClosed for the edge marker.
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
  loadRunsHistory,
  isRetryableRun,
  retryBlockedReason,
  retryWorkflowRun,
  executeTestRun,
  serializeWorkflow,
  nodeTestInput,
  nodeTestOutput,
  currentTriggerKind,
  buildStepTree,
  toggleNodeDisabled,
  undoWorkflow,
  pushWorkflowHistory,
  resetWorkflowHistory,
  workflowHistory,
  tidyWorkflowLayout,
  isNodeIncomplete,
  setNodeIncomplete,
  persistTestData,
  restoreTestData,
  clearTestData,
  setNodeEditedInput,
  getNodeEditedInput,
  ADDABLE_NODE_TYPES,
  nodeMeta,
  branchUnwiredHandles,
  branchHandles,
  branchEdgeLabel,
  edgeBranchLabel,
  isTestRun,
  runInputForNode,
  humanizeNodeIds,
  markNodesFromError,
  structurallyBrokenNodes,
  setNodeName,
  setNodeComment,
  writeTestStateToNodes,
  useTestRunVisibility,
  isTestEarnedResult,
} from "@/plugins/workflows/useWorkflowCanvas";

const triggerNode = () => ({
  id: "t1",
  type: "input",
  position: { x: 0, y: 0 },
  data: { label: "t1", node_type: "workflow_trigger" },
});

const mockRun = workflowService.getWorkflowRun as unknown as ReturnType<typeof vi.fn>;
const mockTest = workflowService.testWorkflow as unknown as ReturnType<typeof vi.fn>;
const mockHistory = workflowService.getWorkflowHistory as unknown as ReturnType<typeof vi.fn>;

describe("loadRunsHistory — shared runs list for the Runs page + NDV switcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workflowObj.runsHistory = {
      list: [],
      fetchedAt: 0,
      params: { start: 0, end: 0 },
      loading: false,
    };
  });

  it("stores the fetched list, the window, and a fetchedAt stamp", async () => {
    const runs = [{ run_id: "r1", start_time: 10 }];
    mockHistory.mockResolvedValue({ data: runs });
    const r = await loadRunsHistory({ orgId: "o", workflowId: "wf1", start: 100, end: 200 });
    expect(r.ok).toBe(true);
    expect(workflowObj.runsHistory.list).toEqual(runs);
    expect(workflowObj.runsHistory.params).toEqual({ start: 100, end: 200 });
    expect(workflowObj.runsHistory.fetchedAt).toBeGreaterThan(0);
    expect(workflowObj.runsHistory.loading).toBe(false);
    // called with the passed window
    expect(mockHistory.mock.calls[0][0]).toMatchObject({ start_time: 100, end_time: 200 });
  });

  it("keeps the previous list on failure (a failed refresh must not blank it)", async () => {
    workflowObj.runsHistory.list = [{ run_id: "old" }] as any;
    mockHistory.mockRejectedValue({ response: { status: 500 } });
    const r = await loadRunsHistory({ orgId: "o", workflowId: "wf1", start: 1, end: 2 });
    expect(r).toEqual({ ok: false, status: 500 });
    expect(workflowObj.runsHistory.list).toEqual([{ run_id: "old" }]); // untouched
    expect(workflowObj.runsHistory.loading).toBe(false);
  });
});

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
    // The frozen `ranSteps` tree went with the results dock — the NDV reads the
    // live graph plus this result, so there is no snapshot to keep in sync.
    expect(res.ranSteps).toBeUndefined();
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

  it("Run Step (singleNode) sends ONLY that node as the workflow and marks only it", async () => {
    mockTest.mockResolvedValue({ data: { errors: {} } });
    await executeTestRun({ orgId: "o", inputs: [{ a: 1 }], fromNode: "f", singleNode: true });
    const arg = mockTest.mock.calls[0][0];
    // Just the one node, no edges — from_node is that node so it runs in isolation.
    expect(arg.from_node).toBe("f");
    expect(arg.workflow.nodes.map((n: any) => n.id)).toEqual(["f"]);
    expect(arg.workflow.edges).toEqual([]);
    // Only the run node counts as ran — nothing upstream/downstream executed.
    const res: any = workflowObj.testRun.result;
    expect(res.ranNodeIds).toEqual(["f"]);
  });

  it("Run Step accumulates: a second node's run keeps the first node's result", async () => {
    // Run Step on "f", then on "d" — d's run must NOT wipe f's input/output.
    mockTest.mockResolvedValue({ data: { inputs: { f: [{ a: 1 }] }, outputs: { f: [{ o: 1 }] } } });
    await executeTestRun({ orgId: "o", inputs: [{ a: 1 }], fromNode: "f", singleNode: true });
    mockTest.mockResolvedValue({ data: { inputs: { d: [{ b: 2 }] }, outputs: { d: [{ o: 2 }] } } });
    await executeTestRun({ orgId: "o", inputs: [{ b: 2 }], fromNode: "d", singleNode: true });

    const res: any = workflowObj.testRun.result;
    // both nodes' data is retained, and both are marked ran
    expect(res.inputs).toEqual({ f: [{ a: 1 }], d: [{ b: 2 }] });
    expect(res.outputs).toEqual({ f: [{ o: 1 }], d: [{ o: 2 }] });
    expect(res.ranNodeIds.sort()).toEqual(["d", "f"]);
  });

  it("Run Step refreshes only its own node (re-running clears that node's stale error)", async () => {
    mockTest.mockResolvedValue({
      data: { errors: { f: { error_count: 1, errors: [["boom"]] } }, outputs: {} },
    });
    await executeTestRun({ orgId: "o", inputs: [{ a: 1 }], fromNode: "f", singleNode: true });
    expect((workflowObj.testRun.result as any).errors.f).toBeTruthy();
    // re-run f successfully → its error clears, and it stays the only ran node
    mockTest.mockResolvedValue({ data: { inputs: { f: [{ a: 1 }] }, outputs: { f: [{ o: 9 }] } } });
    await executeTestRun({ orgId: "o", inputs: [{ a: 1 }], fromNode: "f", singleNode: true });
    const res: any = workflowObj.testRun.result;
    expect(res.errors.f).toBeUndefined();
    expect(res.outputs.f).toEqual([{ o: 9 }]);
  });

  it("Run Step into a loaded run replaces only that node's output, keeping the rest", async () => {
    // A history run is loaded (mode set) with data for every node.
    workflowObj.testRun.result = {
      mode: "history",
      runId: "r9",
      errors: {},
      inputs: { t: [{ x: 0 }], f: [{ a: 1 }], d: [{ b: 2 }] },
      outputs: { t: [{ x: 0 }], f: [{ old: 1 }], d: [{ dd: 2 }] },
      ranNodeIds: ["t", "f", "d"],
      blockedNodeIds: [],
    } as any;
    mockTest.mockResolvedValue({
      data: { inputs: { f: [{ a: 1 }] }, outputs: { f: [{ fresh: 9 }] } },
    });
    await executeTestRun({ orgId: "o", inputs: [{ a: 1 }], fromNode: "f", singleNode: true });
    const res: any = workflowObj.testRun.result;
    expect(res.outputs.f).toEqual([{ fresh: 9 }]); // this node's output REPLACED
    expect(res.outputs.d).toEqual([{ dd: 2 }]); // other nodes untouched
    expect(res.outputs.t).toEqual([{ x: 0 }]);
    expect(res.mode).toBe("history"); // surrounding context preserved
    expect(res.runId).toBe("r9");
    expect(res.ranNodeIds.sort()).toEqual(["d", "f", "t"]);
  });

  it("Run Step with an EMPTY output clears this node's stale output (not falls through)", async () => {
    workflowObj.testRun.result = {
      errors: {},
      inputs: { f: [{ a: 1 }] },
      outputs: { f: [{ stale: 1 }] }, // a previous output for f
      ranNodeIds: ["f"],
      blockedNodeIds: [],
    } as any;
    // the run emits nothing for f (e.g. it errored) — response has no `outputs.f`
    mockTest.mockResolvedValue({
      data: { errors: { f: { error_count: 1, errors: [["boom"]] } }, inputs: {}, outputs: {} },
    });
    await executeTestRun({ orgId: "o", inputs: [{ a: 1 }], fromNode: "f", singleNode: true });
    const res: any = workflowObj.testRun.result;
    expect(res.outputs.f).toBeUndefined(); // stale output CLEARED, not left behind
    expect(res.errors.f).toBeTruthy();
  });

  it("a FULL run replaces accumulated single-node results", async () => {
    mockTest.mockResolvedValue({ data: { inputs: { f: [{ a: 1 }] }, outputs: { f: [{ o: 1 }] } } });
    await executeTestRun({ orgId: "o", inputs: [{ a: 1 }], fromNode: "f", singleNode: true });
    // full run (no singleNode) → fresh result, stale single-node data gone
    mockTest.mockResolvedValue({ data: { inputs: { t: [{ x: 0 }] }, outputs: {} } });
    await executeTestRun({ orgId: "o", inputs: [{ x: 0 }] });
    const res: any = workflowObj.testRun.result;
    expect(res.inputs).toEqual({ t: [{ x: 0 }] }); // f's accumulated input is gone
    expect(res.ranNodeIds.sort()).toEqual(["d", "f", "t"]); // reachable-from-trigger
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

// nodeTestInput / nodeTestOutput read per-node Input and Output straight from the
// backend `inputs` / `outputs` maps (the backend reports each node's output
// directly). These two helpers power the whole step-drawer.
describe("nodeTestInput + nodeTestOutput — per-node I/O maps", () => {
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
      outputs: { t: [{ x: 0 }], f: [{ x: 2 }] }, // f emitted { x: 2 }; c/d emitted nothing
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

  it("nodeTestOutput returns the records a node emitted, null when absent", () => {
    expect(nodeTestOutput("f")).toEqual([{ x: 2 }]);
    expect(nodeTestOutput("c")).toBeNull(); // emitted nothing — not in outputs
    expect(nodeTestOutput("missing")).toBeNull();
  });

  it("nodeTestOutput is null when there is no run", () => {
    workflowObj.testRun.result = null as any;
    expect(nodeTestOutput("f")).toBeNull();
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

  // A never-configured (dummy) node carries only { label, node_type }. serializeNode
  // must fill a valid NodeData for it or the backend fails deserialization.
  it("dummy DESTINATION node serializes with an empty destination name", () => {
    workflowObj.currentSelectedWorkflow = {
      nodes: [
        {
          id: "d1",
          type: "output",
          position: { x: 0, y: 0 },
          data: { label: "d1", node_type: "destination" }, // no destination_id
          meta: { incomplete: "true" },
        },
      ],
      edges: [],
    } as any;
    const { data } = serializeWorkflow().nodes[0];
    expect(data.destination_id).toBe("");
    expect(data.template_override).toBeNull();
  });

  it("dummy CONDITION node serializes as a pass-through v2 rule (empty column, empty value)", () => {
    workflowObj.currentSelectedWorkflow = {
      nodes: [
        {
          id: "c1",
          type: "default",
          position: { x: 0, y: 0 },
          data: { label: "c1", node_type: "condition" }, // no conditions
          meta: { incomplete: "true" },
        },
      ],
      edges: [],
    } as any;
    const { data } = serializeWorkflow().nodes[0];
    expect(data.version).toBe(2);
    expect(data.conditions.filterType).toBe("group");
    expect(data.conditions.conditions).toHaveLength(1);
    // Empty column → backend short-circuits to always-true; value is irrelevant, so
    // it's empty (not a misleading "true" literal).
    expect(data.conditions.conditions[0]).toMatchObject({
      column: "",
      operator: "=",
      value: "",
    });
  });

  it("a CONFIGURED condition node keeps its own rule (no pass-through override)", () => {
    const conditions = { filterType: "group", logicalOperator: "AND", conditions: [] };
    workflowObj.currentSelectedWorkflow = {
      nodes: [
        {
          id: "c1",
          type: "default",
          position: { x: 0, y: 0 },
          data: { node_type: "condition", version: 2, conditions },
        },
      ],
      edges: [],
    } as any;
    const { data } = serializeWorkflow().nodes[0];
    expect(data.conditions).toEqual(conditions); // untouched
  });
});

describe("hydrateWorkflow — branch edge handles survive the round trip", () => {
  // The Rust `Edge` serializes `source_handle`; VueFlow reads `sourceHandle`. The
  // save path translates both ways, so a loaded Branch edge that keeps only the
  // snake_case key renders unrouted and fails validation on a workflow that saved fine.
  it("maps a persisted source_handle onto sourceHandle", () => {
    hydrateWorkflow({
      id: "w1",
      name: "wf",
      nodes: [
        { id: "b", data: { node_type: "branch", cases: [{ handle: "case-0" }] } },
        { id: "d", data: { node_type: "destination" } },
      ],
      edges: [{ id: "e1", source: "b", target: "d", source_handle: "case-0" }],
    });
    expect(workflowObj.currentSelectedWorkflow.edges[0].sourceHandle).toBe("case-0");
  });

  it("keeps a camelCase sourceHandle that is already normalized", () => {
    hydrateWorkflow({
      id: "w1",
      name: "wf",
      nodes: [
        { id: "b", data: { node_type: "branch", cases: [{ handle: "case-0" }] } },
        { id: "d", data: { node_type: "destination" } },
      ],
      edges: [{ id: "e1", source: "b", target: "d", sourceHandle: "case-0" }],
    });
    expect(workflowObj.currentSelectedWorkflow.edges[0].sourceHandle).toBe("case-0");
  });

  // A loaded, correctly-wired Branch must not be condemned as unrunnable.
  it("does not report a loaded branch-routed workflow as structurally broken", () => {
    hydrateWorkflow({
      id: "w1",
      name: "wf",
      nodes: [
        { id: "t", data: { node_type: "workflow_trigger" } },
        { id: "b", data: { node_type: "branch", cases: [{ handle: "case-0" }] } },
        { id: "d", data: { node_type: "destination" } },
      ],
      edges: [
        { id: "e0", source: "t", target: "b" },
        { id: "e1", source: "b", target: "d", source_handle: "case-0" },
      ],
    });
    expect(structurallyBrokenNodes()).toEqual([]);
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

  it("addNodeToEnd inserts a node on the canvas once a trigger is present", () => {
    workflowObj.currentSelectedWorkflow.nodes = [triggerNode()];
    addNodeToEnd("condition");
    expect(mockToast).not.toHaveBeenCalled();
    // Insert-immediately, panel left SHUT — so the staged selection is cleared and
    // the node must be inspected on the canvas, where it sits flagged incomplete.
    expect(workflowObj.dialog.show).toBe(false);
    const added = workflowObj.currentSelectedWorkflow.nodes.find(
      (n: any) => n.data.node_type === "condition",
    );
    expect(workflowObj.currentSelectedWorkflow.nodes).toHaveLength(2);
    expect(added?.meta?.incomplete).toBe("true");
  });

  it("onDrop inserts a node on the canvas once a trigger is present", () => {
    workflowObj.currentSelectedWorkflow.nodes = [triggerNode()];
    workflowObj.draggedNodeType = "function";
    onDrop({ clientX: 10, clientY: 10 } as any);
    expect(mockToast).not.toHaveBeenCalled();
    expect(workflowObj.dialog.show).toBe(false);
    const dropped = workflowObj.currentSelectedWorkflow.nodes.find(
      (n: any) => n.data.node_type === "function",
    );
    expect(workflowObj.currentSelectedWorkflow.nodes).toHaveLength(2);
    expect(dropped?.meta?.incomplete).toBe("true");
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
    const { addNodeOnEdge } = useWorkflowCanvas(t);
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

    // Insert-immediately: addNodeOnEdge splices the node onto the canvas now (no
    // separate commit step) and leaves the panel shut.
    addNodeOnEdge("e1", "condition");
    const wf = workflowObj.currentSelectedWorkflow;
    const inserted = wf.nodes.find((n: any) => n.data.node_type === "condition");
    // placed a row below the source, aligned with the target column
    expect(inserted.position.y).toBe(160);
    expect(inserted.position.x).toBe(100);
    const target = wf.nodes.find((n: any) => n.id === "d");
    // new node stays a row below the source; target pushed down a full row below it
    expect(inserted.position.y).toBe(160);
    expect(target.position.y).toBe(320);
    // rewired A→new→B, old edge dropped
    expect(wf.edges.some((e: any) => e.source === "t" && e.target === inserted.id)).toBe(true);
    expect(wf.edges.some((e: any) => e.source === inserted.id && e.target === "d")).toBe(true);
    expect(wf.edges.some((e: any) => e.id === "e1")).toBe(false);
  });

  it("also shifts nodes downstream of the target", () => {
    const { addNodeOnEdge } = useWorkflowCanvas(t);
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
    const wf = workflowObj.currentSelectedWorkflow;
    const inserted = wf.nodes.find((n: any) => n.data.node_type === "function");
    expect(inserted.position.y).toBe(160);
    expect(wf.nodes.find((n: any) => n.id === "c").position.y).toBe(320);
    expect(wf.nodes.find((n: any) => n.id === "d").position.y).toBe(480);
  });

  it("does not shift a target that already has enough room", () => {
    const { addNodeOnEdge } = useWorkflowCanvas(t);
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
    const wf = workflowObj.currentSelectedWorkflow;
    // target already 400 below (> new node at 160 + 160 gap), so it stays put
    expect(wf.nodes.find((n: any) => n.id === "d").position.y).toBe(400);
  });
});

// Test data must outlive a reload. `testRun.result` and the per-node edited
// inputs are memory-only today — resetWorkflowData() nulls the result and a refresh
// loses everything, so the user re-runs the whole workflow to get their I/O panes back.
// SESSION scope, never localStorage: recorded inputs/outputs carry real log lines.
describe("test data persistence — sessionStorage, keyed by workflow id", () => {
  const WF_ID = "wf-persist-1";
  const keyFor = (id: string) => `workflow-test-data:${id}`;

  const sampleResult = () => ({
    inputs: { n1: [{ meta: { alert_name: "High Error Rate" }, data: [{ log: "boom" }] }] },
    outputs: { n1: [{ meta: {}, data: [{ log: "boom" }] }] },
    errors: {},
    ranNodeIds: ["n1"],
    blockedNodeIds: [],
  });

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    workflowObj.currentSelectedWorkflow = {
      id: WF_ID,
      name: "persist me",
      nodes: [
        {
          id: "n1",
          type: "input",
          position: { x: 0, y: 0 },
          data: { node_type: "workflow_trigger" },
        },
      ],
      edges: [],
    } as any;
    workflowObj.testRun.result = null;
  });

  it("persists testRun.result to sessionStorage under the workflow id", () => {
    persistTestData();
    // nothing to store yet
    workflowObj.testRun.result = sampleResult() as any;
    persistTestData();

    const raw = sessionStorage.getItem(keyFor(WF_ID));
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw as string).result.outputs).toEqual(sampleResult().outputs);
  });

  it("never writes test data to localStorage (it can contain real log lines)", () => {
    workflowObj.testRun.result = sampleResult() as any;
    persistTestData();

    expect(sessionStorage.length).toBeGreaterThan(0);
    const leaked = Object.keys(localStorage).some((k) =>
      (localStorage.getItem(k) || "").includes("boom"),
    );
    expect(leaked).toBe(false);
  });

  it("restores testRun.result for that workflow id on load", () => {
    workflowObj.testRun.result = sampleResult() as any;
    persistTestData();

    // simulate a reload: memory wiped, storage intact
    workflowObj.testRun.result = null;
    restoreTestData(WF_ID);

    expect((workflowObj.testRun.result as any)?.inputs).toEqual(sampleResult().inputs);
    expect((workflowObj.testRun.result as any)?.outputs).toEqual(sampleResult().outputs);
  });

  // A history overlay is something the user opts into from the Runs list. Resurrecting
  // it from the session blob makes a plain Edit open wearing another run's badges.
  it("does not resurrect a history overlay on a plain editor open", () => {
    workflowObj.testRun.result = { ...sampleResult(), mode: "history", runId: "run-hist" } as any;
    persistTestData();

    workflowObj.testRun.result = null;
    restoreTestData(WF_ID);

    expect((workflowObj.testRun.result as any)?.mode).toBeUndefined();
  });

  it("keys by workflow id — another workflow's data never bleeds in", () => {
    workflowObj.testRun.result = sampleResult() as any;
    persistTestData();

    workflowObj.testRun.result = null;
    restoreTestData("some-other-workflow");

    expect(workflowObj.testRun.result).toBeNull();
  });

  it("round-trips the per-node edited inputs alongside the result", () => {
    setNodeEditedInput("n1", '[{"hand":"edited"}]');
    persistTestData();

    // Drop the in-memory copy only — clearTestData deletes the stored entry, so using
    // it here would make the restore below assert against data we just deleted.
    const { resetWorkflowData } = useWorkflowCanvas(t);
    resetWorkflowData();
    expect(getNodeEditedInput("n1")).toBeUndefined();

    restoreTestData(WF_ID);
    expect(getNodeEditedInput("n1")).toBe('[{"hand":"edited"}]');
  });

  it("survives resetWorkflowData — a reset must not lose the session's test data", () => {
    workflowObj.testRun.result = sampleResult() as any;
    setNodeEditedInput("n1", '[{"hand":"edited"}]');
    persistTestData();

    const { resetWorkflowData } = useWorkflowCanvas(t);
    resetWorkflowData();

    expect(sessionStorage.getItem(keyFor(WF_ID))).toBeTruthy();
    restoreTestData(WF_ID);
    expect((workflowObj.testRun.result as any)?.outputs).toEqual(sampleResult().outputs);
    expect(getNodeEditedInput("n1")).toBe('[{"hand":"edited"}]');
  });

  it("clearTestData removes the stored entry for that workflow", () => {
    workflowObj.testRun.result = sampleResult() as any;
    persistTestData();
    expect(sessionStorage.getItem(keyFor(WF_ID))).toBeTruthy();

    clearTestData(WF_ID);
    expect(sessionStorage.getItem(keyFor(WF_ID))).toBeNull();
  });

  it("tolerates corrupt stored JSON instead of throwing", () => {
    sessionStorage.setItem(keyFor(WF_ID), "{not json");
    expect(() => restoreTestData(WF_ID)).not.toThrow();
    expect(workflowObj.testRun.result).toBeNull();
  });

  // The in-memory edit map is a module singleton shared by every workflow the session
  // opens: unkeyed, workflow A's hand-edited input for node "n1" is served to workflow
  // B's node "n1", and the map never shrinks.
  // The map is a module singleton shared by every workflow the session opens. Loading
  // workflow B must not serve A's edit for node "n1" as B's, and the map must not grow
  // one entry per workflow visited.
  it("keys the in-memory edited inputs by workflow id — no cross-workflow bleed", () => {
    setNodeEditedInput("n1", '[{"from":"A"}]');
    persistTestData();
    expect(getNodeEditedInput("n1")).toBe('[{"from":"A"}]');

    hydrateWorkflow({ id: "wf-persist-2", name: "B", nodes: [], edges: [] });
    expect(getNodeEditedInput("n1")).toBeUndefined();

    setNodeEditedInput("n1", '[{"from":"B"}]');
    expect(getNodeEditedInput("n1")).toBe('[{"from":"B"}]');

    // Back to A: B's edit is gone and A's own comes back from session storage.
    hydrateWorkflow({ id: WF_ID, name: "persist me", nodes: [], edges: [] });
    expect(getNodeEditedInput("n1")).toBe('[{"from":"A"}]');
  });

  it("holds only one workflow's edits at a time, so the map cannot grow unbounded", () => {
    setNodeEditedInput("n1", '[{"from":"A"}]');

    hydrateWorkflow({ id: "wf-persist-2", name: "B", nodes: [], edges: [] });
    setNodeEditedInput("n2", '[{"from":"B"}]');

    // n1 belonged to the previous workflow — it must not still be resident.
    expect(getNodeEditedInput("n1")).toBeUndefined();
    expect(getNodeEditedInput("n2")).toBe('[{"from":"B"}]');
  });

  // A recorded run's outputs are unbounded — a big batch blows the ~5MB session quota
  // and the catch swallows it, so the user gets no signal that nothing was saved.
  it("skips the write when the payload exceeds the session-storage budget", () => {
    workflowObj.testRun.result = {
      inputs: {},
      outputs: { n1: [{ blob: "x".repeat(3_000_000) }] },
      errors: {},
    } as any;

    persistTestData();

    expect(sessionStorage.getItem(keyFor(WF_ID))).toBeNull();
  });

  it("reports an oversized payload instead of failing silently", () => {
    workflowObj.testRun.result = {
      inputs: {},
      outputs: { n1: [{ blob: "x".repeat(3_000_000) }] },
      errors: {},
    } as any;

    expect(persistTestData()).toEqual({ ok: false, reason: "too-large" });
  });

  it("reports success for a payload that fits", () => {
    workflowObj.testRun.result = sampleResult() as any;
    expect(persistTestData()).toEqual({ ok: true });
  });

  // The stale entry is worse than none: restoring it would resurrect the run the
  // oversized one was meant to replace.
  it("clears any stale stored entry when the new payload is too large", () => {
    workflowObj.testRun.result = sampleResult() as any;
    persistTestData();
    expect(sessionStorage.getItem(keyFor(WF_ID))).toBeTruthy();

    workflowObj.testRun.result = {
      inputs: {},
      outputs: { n1: [{ blob: "x".repeat(3_000_000) }] },
      errors: {},
    } as any;
    persistTestData();

    expect(sessionStorage.getItem(keyFor(WF_ID))).toBeNull();
  });

  it("hydrateWorkflow restores the stored test data for the workflow it loads", () => {
    workflowObj.testRun.result = sampleResult() as any;
    setNodeEditedInput("n1", '[{"hand":"edited"}]');
    persistTestData();

    const { resetWorkflowData } = useWorkflowCanvas(t);
    resetWorkflowData();
    expect(workflowObj.testRun.result).toBeNull();

    hydrateWorkflow({ id: WF_ID, name: "persist me", nodes: [], edges: [] });

    expect((workflowObj.testRun.result as any)?.outputs).toEqual(sampleResult().outputs);
    expect(getNodeEditedInput("n1")).toBe('[{"hand":"edited"}]');
  });

  it("does nothing for an unsaved workflow with no id", () => {
    workflowObj.currentSelectedWorkflow.id = "";
    workflowObj.testRun.result = sampleResult() as any;
    expect(() => persistTestData()).not.toThrow();
    expect(sessionStorage.getItem(keyFor(""))).toBeNull();
  });
});

// The Test payload survives a reload from localStorage, so its PROVENANCE has to
// survive with it — otherwise a hand-tampered payload is relabelled "Sample Input"
// by the reload and the label lies about what the author is testing against.
describe("test input provenance round-trips with the payload", () => {
  const WF_ID = "wf-prov";
  const inputKeyFor = (id: string) => `workflow-test-input:${id}`;

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    workflowObj.currentSelectedWorkflow = { id: WF_ID, name: "prov", nodes: [], edges: [] } as any;
    workflowObj.testRun.result = null;
    workflowObj.testRun.input = "";
    workflowObj.testRun.inputSource = "sample";
    workflowObj.testRun.inputRunLabel = "";
  });

  it("restores an edited payload as edited, not as the generated sample", () => {
    workflowObj.testRun.input = '[{"meta":{"alert_name":"TAMPERED"}}]';
    workflowObj.testRun.inputSource = "edited";
    persistTestData();

    workflowObj.testRun.input = "";
    workflowObj.testRun.inputSource = "sample";
    restoreTestData(WF_ID);

    expect(workflowObj.testRun.input).toBe('[{"meta":{"alert_name":"TAMPERED"}}]');
    expect(workflowObj.testRun.inputSource).toBe("edited");
  });

  it("restores a run-seeded payload with the run it came from", () => {
    workflowObj.testRun.input = '[{"from":"run"}]';
    workflowObj.testRun.inputSource = "run";
    workflowObj.testRun.inputRunLabel = "2026-01-01 10:00";
    persistTestData();

    workflowObj.testRun.inputSource = "sample";
    workflowObj.testRun.inputRunLabel = "";
    restoreTestData(WF_ID);

    expect(workflowObj.testRun.inputSource).toBe("run");
    expect(workflowObj.testRun.inputRunLabel).toBe("2026-01-01 10:00");
  });

  // Payloads written before provenance existed are bare strings in localStorage;
  // they must still restore rather than being parsed as a blob and dropped.
  it("reads a legacy bare-string payload as the generated sample", () => {
    localStorage.setItem(inputKeyFor(WF_ID), '[{"legacy":true}]');
    workflowObj.testRun.inputSource = "edited";
    restoreTestData(WF_ID);

    expect(workflowObj.testRun.input).toBe('[{"legacy":true}]');
    expect(workflowObj.testRun.inputSource).toBe("sample");
  });
});

// ── Branch node (exclusive routing: true/false, generalising to an N-way switch) ──
// The Branch is the FIRST multi-handle node on this canvas. Everything below is
// behaviour the single-handle assumptions in the canvas do NOT currently satisfy.

const branchGraph = () => {
  workflowObj.readOnly = false;
  workflowObj.currentSelectedNodeData = null;
  workflowObj.pendingEdge = null;
  workflowObj.pendingInsert = null;
  workflowObj.isEditNode = false;
  workflowObj.currentSelectedWorkflow = {
    id: "wf",
    name: "wf",
    nodes: [
      {
        id: "t1",
        type: "input",
        position: { x: 0, y: 0 },
        data: { node_type: "workflow_trigger" },
      },
      {
        id: "b1",
        type: "default",
        position: { x: 0, y: 160 },
        // Mirrors initialNodeData: a Branch is born with case-0 + else declared.
        data: {
          node_type: "branch",
          cases: [{ handle: "case-0", conditions: null }],
          else_handle: "else",
        },
      },
    ],
    edges: [{ id: "et1-b1", source: "t1", target: "b1" }],
  } as any;
};

describe("Branch node — step picker registration", () => {
  // Now offered: WorkflowBranch.vue exists, so a Branch's config body can clear the
  // meta.incomplete stamp every added node carries and Publish is reachable again.
  it('offers "branch" now that its config body exists', () => {
    expect(ADDABLE_NODE_TYPES).toContain("branch");
  });

  // Ordered right after Condition — both are `logic`, and Branch is the N-way
  // generalisation of it, so the picker reads condition → branch → function.
  it("lists branch immediately after condition in the addable order", () => {
    expect(ADDABLE_NODE_TYPES).toEqual(["condition", "branch", "function", "destination"]);
  });

  it("has node meta so the picker can render it (title, icon, non-terminal ioType)", () => {
    const m = nodeMeta("branch");
    expect(m).toBeTruthy();
    // Not an output/terminal type — a Branch must be able to connect onward.
    expect(m?.ioType).not.toBe("output");
    expect(m?.titleKey).toBeTruthy();
    expect(m?.icon).toBeTruthy();
  });

  it("leaves the existing Condition node untouched (still a single-output filter)", () => {
    expect(ADDABLE_NODE_TYPES).toContain("condition");
    expect(nodeMeta("condition")?.ioType).toBe("default");
  });
});

// P0 — the OTHER half of the unwireable-Branch bug: a manual drag from a specific
// arm must produce an edge that CARRIES that arm, or the workflow fails its own
// path validation the moment it is saved.
describe("onConnect — a manual drag keeps the arm it was dragged from", () => {
  const threeArmBranch = () => {
    branchGraph();
    const wf = workflowObj.currentSelectedWorkflow as any;
    wf.nodes[1].data.cases = [{ handle: "case-0" }, { handle: "case-1" }];
    wf.nodes.push(
      { id: "d1", type: "output", position: { x: 0, y: 320 }, data: { node_type: "destination" } },
      {
        id: "d2",
        type: "output",
        position: { x: 300, y: 320 },
        data: { node_type: "destination" },
      },
      {
        id: "d3",
        type: "output",
        position: { x: 600, y: 320 },
        data: { node_type: "destination" },
      },
    );
  };

  it("stores source_handle for every arm of a 3-path Branch", () => {
    const { onConnect } = useWorkflowCanvas(t);
    threeArmBranch();
    onConnect({ source: "b1", target: "d1", sourceHandle: "case-0" });
    onConnect({ source: "b1", target: "d2", sourceHandle: "case-1" });
    onConnect({ source: "b1", target: "d3", sourceHandle: "else" });
    const armed = (workflowObj.currentSelectedWorkflow.edges as any[]).filter(
      (e) => e.source === "b1",
    );
    expect(armed.map((e) => e.sourceHandle)).toEqual(["case-0", "case-1", "else"]);
  });

  it("gives each arm's edge a DISTINCT id so the second arm does not replace the first", () => {
    const { onConnect } = useWorkflowCanvas(t);
    threeArmBranch();
    onConnect({ source: "b1", target: "d1", sourceHandle: "case-0" });
    onConnect({ source: "b1", target: "d2", sourceHandle: "case-1" });
    const ids = (workflowObj.currentSelectedWorkflow.edges as any[])
      .filter((e) => e.source === "b1")
      .map((e) => e.id);
    expect(new Set(ids).size).toBe(2);
  });

  it("a 3-arm Branch wired arm-by-arm is NOT structurally broken", () => {
    const { onConnect } = useWorkflowCanvas(t);
    threeArmBranch();
    onConnect({ source: "b1", target: "d1", sourceHandle: "case-0" });
    onConnect({ source: "b1", target: "d2", sourceHandle: "case-1" });
    onConnect({ source: "b1", target: "d3", sourceHandle: "else" });
    expect(structurallyBrokenNodes()).toEqual([]);
  });

  // VueFlow reports the card's lone handle id ("output") when a single-output node
  // is dragged from. That is not a routable arm — persisting it would invent a
  // source_handle the backend has no path for.
  it("drops the single-output sentinel so a plain node's edge stays handle-less", () => {
    const { onConnect } = useWorkflowCanvas(t);
    threeArmBranch();
    onConnect({ source: "t1", target: "b1x", sourceHandle: "output" });
    const e = (workflowObj.currentSelectedWorkflow.edges as any[]).find((x) => x.target === "b1x");
    expect(e).toBeTruthy();
    expect(e.sourceHandle).toBeUndefined();
  });
});

describe("Branch node — addNodeAfter must not overlap the two seeded arm children", () => {
  it("puts the first case-0 child and the first else child at DIFFERENT positions", () => {
    const { addNodeAfter } = useWorkflowCanvas(t);
    branchGraph();

    addNodeAfter("b1", "case-0", "function");
    const wf = workflowObj.currentSelectedWorkflow;
    const trueChild = wf.nodes.find((n: any) => n.data.node_type === "function");

    addNodeAfter("b1", "else", "destination");
    const falseChild = wf.nodes.find((n: any) => n.data.node_type === "destination");

    expect(trueChild).toBeTruthy();
    expect(falseChild).toBeTruthy();
    // Both are the FIRST child on their own handle, so today's per-handle sibling
    // count is 0 for both and they land on exactly the same coordinates.
    expect({ x: falseChild.position.x, y: falseChild.position.y }).not.toEqual({
      x: trueChild.position.x,
      y: trueChild.position.y,
    });
  });

  it("places the case-0 child LEFT of the else child (declared handle order)", () => {
    const { addNodeAfter } = useWorkflowCanvas(t);
    branchGraph();
    addNodeAfter("b1", "case-0", "function");
    addNodeAfter("b1", "else", "destination");
    const wf = workflowObj.currentSelectedWorkflow;
    const trueChild = wf.nodes.find((n: any) => n.data.node_type === "function");
    const falseChild = wf.nodes.find((n: any) => n.data.node_type === "destination");
    expect(trueChild.position.x).toBeLessThan(falseChild.position.x);
  });

  it("keeps a plain single-output node's first child directly below it (no regression)", () => {
    const { addNodeAfter } = useWorkflowCanvas(t);
    branchGraph();
    // t1 is a genuine single-output node. Adding onto the BRANCH here would prove
    // nothing, since "out" is not one of a branch's declared handles.
    addNodeAfter("t1", "out", "condition");
    const child = workflowObj.currentSelectedWorkflow.nodes.find(
      (n: any) => n.data.node_type === "condition",
    );
    // t1 already has b1 on the same handle, so the second child offsets on x — the
    // existing single-handle fan-out the branch offset change must not disturb.
    expect(child.position.x).toBe(280);
    expect(child.position.y).toBe(160);
  });
});

// REGRESSION GUARDS, not red-phase tests. makeEdge already takes a sourceHandle
// and commitStagedNode already threads pendingEdge.sourceHandle into it, and
// serializeWorkflow translates each edge via serializeEdge — so this plumbing works
// TODAY and these assertions pass against unchanged code. They are here to pin
// the per-arm wiring the Branch depends on, so a later refactor of the add path
// cannot silently drop the handle and collapse both arms onto one edge.
describe("Branch node — edges carry their sourceHandle (regression guard)", () => {
  it("wires each child on the arm it was added from", () => {
    const { addNodeAfter } = useWorkflowCanvas(t);
    branchGraph();
    addNodeAfter("b1", "case-0", "function");
    addNodeAfter("b1", "else", "destination");
    const wf = workflowObj.currentSelectedWorkflow;
    const trueChild = wf.nodes.find((n: any) => n.data.node_type === "function");
    const falseChild = wf.nodes.find((n: any) => n.data.node_type === "destination");
    const handleFor = (target: string) =>
      wf.edges.find((e: any) => e.source === "b1" && e.target === target)?.sourceHandle;
    expect(handleFor(trueChild.id)).toBe("case-0");
    expect(handleFor(falseChild.id)).toBe("else");
  });

  it("gives the two arm edges distinct, handle-suffixed ids", () => {
    const { addNodeAfter } = useWorkflowCanvas(t);
    branchGraph();
    addNodeAfter("b1", "case-0", "function");
    addNodeAfter("b1", "else", "destination");
    const armEdges = workflowObj.currentSelectedWorkflow.edges.filter(
      (e: any) => e.source === "b1",
    );
    expect(armEdges).toHaveLength(2);
    // Distinctness is the contract; the id's exact format is makeEdge's business.
    expect(armEdges[0].id).not.toBe(armEdges[1].id);
  });
});

describe("Branch node — tidyWorkflowLayout orders subtrees by handle", () => {
  const twoArmGraph = () => {
    workflowObj.readOnly = false;
    workflowObj.currentSelectedWorkflow = {
      id: "wf",
      name: "wf",
      nodes: [
        { id: "t1", data: { node_type: "workflow_trigger" }, position: { x: 0, y: 0 } },
        { id: "b1", data: { node_type: "branch" }, position: { x: 0, y: 0 } },
        { id: "yes", data: { node_type: "function" }, position: { x: 0, y: 0 } },
        { id: "no", data: { node_type: "destination" }, position: { x: 0, y: 0 } },
      ],
      // The FALSE edge is listed FIRST — edge array order must not decide the
      // layout; the declared handle order (true before false) must.
      edges: [
        { id: "e1", source: "t1", target: "b1" },
        { id: "e3", source: "b1", target: "no", sourceHandle: "false" },
        { id: "e2", source: "b1", target: "yes", sourceHandle: "true" },
      ],
    } as any;
  };
  const pos = (id: string) =>
    workflowObj.currentSelectedWorkflow.nodes.find((n: any) => n.id === id).position;

  it("lays the `true` subtree LEFT of the `false` subtree regardless of edge order", () => {
    twoArmGraph();
    expect(tidyWorkflowLayout()).toBe(true);
    expect(pos("yes").x).toBeLessThan(pos("no").x);
  });

  it("is deterministic — running Tidy Up twice produces the identical layout", () => {
    twoArmGraph();
    tidyWorkflowLayout();
    const first = { yes: { ...pos("yes") }, no: { ...pos("no") }, b1: { ...pos("b1") } };
    tidyWorkflowLayout();
    expect({ yes: { ...pos("yes") }, no: { ...pos("no") }, b1: { ...pos("b1") } }).toEqual(first);
  });

  it("orders an N-way switch's arms by declared case order, else last", () => {
    workflowObj.readOnly = false;
    workflowObj.currentSelectedWorkflow = {
      id: "wf",
      name: "wf",
      nodes: [
        { id: "t1", data: { node_type: "workflow_trigger" }, position: { x: 0, y: 0 } },
        { id: "b1", data: { node_type: "branch" }, position: { x: 0, y: 0 } },
        { id: "c0", data: { node_type: "function" }, position: { x: 0, y: 0 } },
        { id: "c1", data: { node_type: "function" }, position: { x: 0, y: 0 } },
        { id: "el", data: { node_type: "destination" }, position: { x: 0, y: 0 } },
      ],
      edges: [
        { id: "e1", source: "t1", target: "b1" },
        { id: "e4", source: "b1", target: "el", sourceHandle: "else" },
        { id: "e3", source: "b1", target: "c1", sourceHandle: "case-1" },
        { id: "e2", source: "b1", target: "c0", sourceHandle: "case-0" },
      ],
    } as any;
    expect(tidyWorkflowLayout()).toBe(true);
    expect(pos("c0").x).toBeLessThan(pos("c1").x);
    expect(pos("c1").x).toBeLessThan(pos("el").x);
  });
});

describe("Branch node — unwired handles are flagged, but do not block publish", () => {
  it("reports the handles with no outgoing edge", () => {
    branchGraph();
    const wf = workflowObj.currentSelectedWorkflow;
    wf.nodes.push({ id: "f1", position: { x: 0, y: 320 }, data: { node_type: "function" } });
    wf.edges.push({ id: "eb1-f1-c0", source: "b1", target: "f1", sourceHandle: "case-0" });
    expect(
      branchUnwiredHandles(
        wf.nodes.find((n: any) => n.id === "b1"),
        wf.edges,
      ),
    ).toEqual(["else"]);
  });

  it("reports no unwired handles once both arms are wired", () => {
    branchGraph();
    const wf = workflowObj.currentSelectedWorkflow;
    wf.nodes.push({ id: "f1", position: { x: 0, y: 320 }, data: { node_type: "function" } });
    wf.nodes.push({ id: "d1", position: { x: 0, y: 320 }, data: { node_type: "destination" } });
    wf.edges.push({ id: "eb1-f1-c0", source: "b1", target: "f1", sourceHandle: "case-0" });
    wf.edges.push({ id: "eb1-d1-else", source: "b1", target: "d1", sourceHandle: "else" });
    expect(
      branchUnwiredHandles(
        wf.nodes.find((n: any) => n.id === "b1"),
        wf.edges,
      ),
    ).toEqual([]);
  });

  it("returns nothing for a non-branch node (single-output nodes are never flagged)", () => {
    branchGraph();
    const wf = workflowObj.currentSelectedWorkflow;
    expect(
      branchUnwiredHandles(
        wf.nodes.find((n: any) => n.id === "t1"),
        wf.edges,
      ),
    ).toEqual([]);
  });

  it("an unwired handle is NOT the incomplete/placeholder flag — it never blocks Publish", () => {
    branchGraph();
    const branch = workflowObj.currentSelectedWorkflow.nodes.find((n: any) => n.id === "b1");
    // Both handles unwired, yet the node is fully configured: `meta.incomplete` is
    // what Publish validation reads, and it must stay clear.
    expect(branchUnwiredHandles(branch, workflowObj.currentSelectedWorkflow.edges)).toEqual([
      "case-0",
      "else",
    ]);
    expect(isNodeIncomplete(branch)).toBe(false);
  });
});

describe("Branch node — per-handle test output", () => {
  beforeEach(() => {
    workflowObj.currentSelectedWorkflow = {
      id: "wf",
      name: "wf",
      nodes: [
        { id: "t1", data: { node_type: "workflow_trigger" } },
        { id: "b1", data: { node_type: "branch" } },
        { id: "f1", data: { node_type: "function" } },
      ],
      edges: [
        { id: "e1", source: "t1", target: "b1" },
        { id: "e2", source: "b1", target: "f1", sourceHandle: "true" },
      ],
    } as any;
    workflowObj.testRun.result = {
      errors: {},
      inputs: { b1: [{ x: 1 }, { x: 2 }, { x: 3 }, { x: 4 }] },
      outputs: {
        b1: { true: [{ x: 1 }, { x: 2 }, { x: 3 }], false: [{ x: 4 }] },
        f1: [{ x: 1 }],
      },
      ranNodeIds: ["t1", "b1", "f1"],
      blockedNodeIds: [],
    } as any;
  });

  it("nodeTestOutput on a branch returns every routed record, flattened in handle order", () => {
    expect(nodeTestOutput("b1")).toEqual([{ x: 1 }, { x: 2 }, { x: 3 }, { x: 4 }]);
  });

  it("SINGLE-HANDLE COMPAT: a plain node's flat outputs entry still reads back as an array", () => {
    expect(nodeTestOutput("f1")).toEqual([{ x: 1 }]);
  });
});

// The canvas (VueFlow) names this field `sourceHandle`; the Rust `Edge` struct
// names it `source_handle` and has no serde rename. serializeWorkflow must
// translate, or every Branch edge reaches the backend with no handle and
// validate_branch_node rejects the run with "must declare a source_handle".
describe("Branch node — serializeWorkflow emits snake_case source_handle", () => {
  beforeEach(() => {
    branchGraph();
  });

  it("translates sourceHandle to source_handle on the wire", () => {
    workflowObj.currentSelectedWorkflow.edges = [
      { id: "et1-b1", source: "t1", target: "b1" },
      { id: "eb1-f1", source: "b1", target: "f1", sourceHandle: "case-0" },
    ];
    const edge = serializeWorkflow().edges.find((e: any) => e.source === "b1");
    expect(edge.source_handle).toBe("case-0");
  });

  it("does not leak the camelCase key the backend cannot read", () => {
    workflowObj.currentSelectedWorkflow.edges = [
      { id: "eb1-f1", source: "b1", target: "f1", sourceHandle: "case-0" },
    ];
    const edge = serializeWorkflow().edges.find((e: any) => e.source === "b1");
    expect(edge.sourceHandle).toBeUndefined();
  });

  it("omits source_handle entirely on a plain edge so pre-existing graphs are unchanged", () => {
    workflowObj.currentSelectedWorkflow.edges = [{ id: "et1-b1", source: "t1", target: "b1" }];
    const edge = serializeWorkflow().edges.find((e: any) => e.source === "t1");
    expect("source_handle" in edge).toBe(false);
  });
});

// A dry run and a real fired-alert run are indistinguishable in run history
// today, so a rehearsal can be mistaken for a page that actually went out.
describe("isTestRun", () => {
  it("marks a run the backend recorded as Test", () => {
    expect(isTestRun({ event_type: "Test" })).toBe(true);
  });

  it("does not mark real trigger types", () => {
    for (const t of ["AlertFired", "IncidentEvent", "Webhook", "Manual", "Retry"]) {
      expect(isTestRun({ event_type: t })).toBe(false);
    }
  });

  // History rows predate the field, and a super-cluster peer may omit it.
  it("treats a missing or absent run as not a test", () => {
    expect(isTestRun({})).toBe(false);
    expect(isTestRun(null)).toBe(false);
    expect(isTestRun(undefined)).toBe(false);
  });
});

// The NDV falls back to the parent's output with `?? nodeTestOutput(...)`, which
// is only safe while this returns null (never a falsy non-null) for "never ran".
// If it ever returned undefined for a ran-but-empty node, an empty input would
// silently show the parent's records instead.
describe("nodeTestInput null contract (guards the NDV parent-output fallback)", () => {
  it("returns an empty array — not null — when a node ran and received nothing", () => {
    workflowObj.testRun.result = { inputs: { n1: [] }, outputs: {}, errors: {} } as any;
    expect(nodeTestInput("n1")).toEqual([]);
  });

  it("returns null when the node never ran, so the fallback can engage", () => {
    workflowObj.testRun.result = { inputs: {}, outputs: {}, errors: {} } as any;
    expect(nodeTestInput("n1")).toBeNull();
  });
});

// The payload typed into the Test dialog is the one thing a workflow author
// re-runs constantly, and it was the only part of the test state not persisted —
// a reload dropped it back to the generic sample.
describe("test input survives a reload", () => {
  const WF = "wf-input-persist";
  beforeEach(() => {
    sessionStorage.clear();
    workflowObj.currentSelectedWorkflow = { id: WF, name: "w", nodes: [], edges: [] } as any;
    workflowObj.testRun.result = null;
    workflowObj.testRun.input = "";
  });

  it("restores the edited test input for the same workflow", () => {
    workflowObj.testRun.input = '{"meta":{"alert_count":5000}}';
    persistTestData();
    workflowObj.testRun.input = "";
    restoreTestData(WF);
    expect(workflowObj.testRun.input).toBe('{"meta":{"alert_count":5000}}');
  });

  // Keyed per workflow — another workflow's payload must not leak in, or the
  // author silently tests workflow A with workflow B's event.
  it("does not restore another workflow's input", () => {
    workflowObj.testRun.input = '{"a":1}';
    persistTestData();
    workflowObj.testRun.input = "";
    restoreTestData("some-other-workflow");
    expect(workflowObj.testRun.input).toBe("");
  });
});

// One fetch gives the WHOLE run's per-node input_map; the Test dialog slices the
// node it needs out of it rather than fetching per step.
describe("runInputForNode — slices a loaded run's input for re-testing", () => {
  beforeEach(() => {
    workflowObj.currentSelectedWorkflow = {
      id: "wf",
      name: "w",
      nodes: [
        { id: "t1", data: { node_type: "workflow_trigger" }, position: { x: 0, y: 0 } },
        { id: "b1", data: { node_type: "branch" }, position: { x: 0, y: 1 } },
      ],
      edges: [],
    } as any;
    workflowObj.testRun.result = {
      inputs: { t1: [{ meta: { alert_count: 5000 } }], b1: [{ meta: { alert_count: 5000 } }] },
      outputs: {},
      errors: {},
    } as any;
  });

  // Run-From "beginning": the payload the workflow itself received.
  it("returns the trigger's input when no from-node is given", () => {
    expect(runInputForNode("")).toEqual([{ meta: { alert_count: 5000 } }]);
  });

  // Run-From a specific node: re-test that step with what it actually saw, which
  // is the "use input as needed" slice rather than the whole-workflow payload.
  it("returns the named node's own input when running from that node", () => {
    expect(runInputForNode("b1")).toEqual([{ meta: { alert_count: 5000 } }]);
  });

  // A node that never ran has no stored input — the caller must fall back to the
  // sample rather than silently seeding an empty array.
  it("returns null for a node absent from the run", () => {
    expect(runInputForNode("nope")).toBeNull();
  });
});

// The typed payload is authored work — it must outlive the tab the way a draft
// does. The recorded RESULT stays session-scoped: it is a snapshot of one run and
// goes stale against an edited graph, so resurrecting it days later would paint
// ✓/✗ badges for a workflow that no longer matches.
describe("test input outlives the tab; the run result does not", () => {
  const WF = "wf-storage";
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    workflowObj.currentSelectedWorkflow = { id: WF, name: "w", nodes: [], edges: [] } as any;
    workflowObj.testRun.input = "";
    workflowObj.testRun.result = null;
  });

  it("keeps the typed input in localStorage so a new tab still has it", () => {
    workflowObj.testRun.input = '{"meta":{"alert_count":5000}}';
    persistTestData();
    sessionStorage.clear(); // a brand-new tab
    workflowObj.testRun.input = "";
    restoreTestData(WF);
    expect(workflowObj.testRun.input).toBe('{"meta":{"alert_count":5000}}');
  });

  it("does not resurrect a previous tab's run result", () => {
    workflowObj.testRun.input = "{}";
    workflowObj.testRun.result = { inputs: { n1: [{ a: 1 }] }, outputs: {}, errors: {} } as any;
    persistTestData();
    sessionStorage.clear();
    workflowObj.testRun.result = null;
    restoreTestData(WF);
    expect(workflowObj.testRun.result).toBeNull();
  });
});

// Backend validation names nodes by uuid ("Edge from BranchNode 01ba56cc-aa28-…"),
// which is unreadable and unmatchable against the canvas. Only the frontend knows
// display names, so it rewrites the ids before the message is shown.
describe("humanizeNodeIds — backend errors name nodes, not uuids", () => {
  beforeEach(() => {
    workflowObj.currentSelectedWorkflow = {
      id: "wf",
      name: "w",
      nodes: [
        {
          id: "01ba56cc-aa28-4419-9efb-e39ac5aa9662",
          data: { node_type: "branch" },
          position: { x: 0, y: 0 },
        },
        {
          id: "c219fe05-ff00-4471-b466-e833308c7ed5",
          data: { node_type: "condition" },
          meta: { label: "Severity check" },
          position: { x: 0, y: 1 },
        },
      ],
      edges: [],
    } as any;
  });

  it("replaces a uuid with the node's type name", () => {
    const out = humanizeNodeIds(
      "Edge from BranchNode 01ba56cc-aa28-4419-9efb-e39ac5aa9662 must declare a source_handle",
      t,
    );
    expect(out).not.toContain("01ba56cc");
    expect(out).toContain("Branch");
  });

  // A renamed node must show the name the author gave it.
  it("prefers the author's custom name", () => {
    const out = humanizeNodeIds("node c219fe05-ff00-4471-b466-e833308c7ed5 failed");
    expect(out).toContain("Severity check");
    expect(out).not.toContain("c219fe05");
  });

  it("rewrites every id in a message naming two nodes", () => {
    const out = humanizeNodeIds(
      "Edge from BranchNode 01ba56cc-aa28-4419-9efb-e39ac5aa9662 to c219fe05-ff00-4471-b466-e833308c7ed5 must declare a source_handle",
      t,
    );
    expect(out).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
    expect(out).toContain("Severity check");
  });

  // An id the graph no longer has (deleted node, stale run) must stay legible —
  // dropping it would leave a dangling "Edge from BranchNode  to X".
  it("leaves unknown ids untouched", () => {
    const out = humanizeNodeIds("node 99999999-0000-0000-0000-000000000000 failed");
    expect(out).toContain("99999999-0000-0000-0000-000000000000");
  });

  it("passes through a message with no ids, and tolerates empty input", () => {
    expect(humanizeNodeIds("All terminal nodes must be destinations")).toBe(
      "All terminal nodes must be destinations",
    );
    expect(humanizeNodeIds("")).toBe("");
    expect(humanizeNodeIds(undefined)).toBe("");
  });
});

// A validation failure only toasted a message, leaving the author to hunt the
// offending node by uuid. The ids in the message identify it, so the same
// per-node error map the run badges already read is populated from it.
describe("markNodesFromError — the failing node and path are highlighted", () => {
  beforeEach(() => {
    workflowObj.currentSelectedWorkflow = {
      id: "wf",
      name: "w",
      nodes: [
        {
          id: "01ba56cc-aa28-4419-9efb-e39ac5aa9662",
          data: { node_type: "branch" },
          position: { x: 0, y: 0 },
        },
        {
          id: "c219fe05-ff00-4471-b466-e833308c7ed5",
          data: { node_type: "condition" },
          position: { x: 0, y: 1 },
        },
      ],
      edges: [
        {
          id: "e1",
          source: "01ba56cc-aa28-4419-9efb-e39ac5aa9662",
          target: "c219fe05-ff00-4471-b466-e833308c7ed5",
        },
      ],
    } as any;
    workflowObj.testRun.result = null;
  });

  it("flags every node the error names", () => {
    markNodesFromError(
      "Edge from BranchNode 01ba56cc-aa28-4419-9efb-e39ac5aa9662 to c219fe05-ff00-4471-b466-e833308c7ed5 must declare a source_handle",
    );
    const errs = workflowObj.testRun.result?.errors || {};
    expect(Object.keys(errs).sort()).toEqual(
      ["01ba56cc-aa28-4419-9efb-e39ac5aa9662", "c219fe05-ff00-4471-b466-e833308c7ed5"].sort(),
    );
  });

  // The badge reads error_count / errors[], so the shape must match a run error
  // or the node renders a flag with no message behind it.
  it("stores the message in the shape the node badge reads", () => {
    markNodesFromError("Edge from BranchNode 01ba56cc-aa28-4419-9efb-e39ac5aa9662 is bad");
    const e = workflowObj.testRun.result.errors["01ba56cc-aa28-4419-9efb-e39ac5aa9662"];
    expect(e.error_count).toBe(1);
    expect(String(e.errors[0])).toContain("is bad");
  });

  // Nothing to point at — a message with no ids must not wipe a real run result.
  it("leaves an existing run result alone when the error names no node", () => {
    workflowObj.testRun.result = { inputs: {}, outputs: {}, errors: {} } as any;
    markNodesFromError("All terminal nodes must be destinations");
    expect(workflowObj.testRun.result.errors).toEqual({});
  });
});

// `meta.incomplete` blocks Publish only — Draft and Test deliberately allow a
// half-built graph. But a node whose WIRING cannot execute is a different class of
// problem: it fails on the backend at run time with a uuid-bearing message. These
// are caught up front, for every node type, before a run is attempted.
describe("structurallyBrokenNodes — unrunnable wiring, any node type", () => {
  const graph = (nodes: any[], edges: any[]) => {
    workflowObj.currentSelectedWorkflow = { id: "wf", name: "w", nodes, edges } as any;
  };
  const node = (id: string, node_type: string, data: any = {}) => ({
    id,
    data: { node_type, ...data },
    position: { x: 0, y: 0 },
  });

  it("flags a Branch that routes but declares no path", () => {
    graph(
      [node("t", "workflow_trigger"), node("b", "branch"), node("d", "destination")],
      [
        { id: "e1", source: "t", target: "b" },
        { id: "e2", source: "b", target: "d" },
      ],
    );
    expect(structurallyBrokenNodes()).toContain("b");
  });

  // Configuring the Branch creates handles, but wires drawn BEFORE that keep none —
  // the exact state that produces "must declare a source_handle" at run time.
  it("flags a configured Branch whose existing edges carry no handle", () => {
    graph(
      [
        node("t", "workflow_trigger"),
        node("b", "branch", { cases: [{ handle: "case-0", conditions: {} }], else_handle: "else" }),
        node("d", "destination"),
      ],
      [
        { id: "e1", source: "t", target: "b" },
        { id: "e2", source: "b", target: "d" },
      ],
    );
    expect(structurallyBrokenNodes()).toContain("b");
  });

  it("accepts a Branch whose edges all carry a declared handle", () => {
    graph(
      [
        node("t", "workflow_trigger"),
        node("b", "branch", { cases: [{ handle: "case-0", conditions: {} }], else_handle: "else" }),
        node("d", "destination"),
      ],
      [
        { id: "e1", source: "t", target: "b" },
        { id: "e2", source: "b", target: "d", sourceHandle: "case-0" },
      ],
    );
    expect(structurallyBrokenNodes()).toEqual([]);
  });

  // An edge tagged with a handle the node no longer declares (a path was deleted)
  // is equally unroutable.
  it("flags an edge whose handle the Branch does not declare", () => {
    graph(
      [
        node("t", "workflow_trigger"),
        node("b", "branch", { cases: [{ handle: "case-0", conditions: {} }], else_handle: "else" }),
        node("d", "destination"),
      ],
      [{ id: "e2", source: "b", target: "d", sourceHandle: "case-7" }],
    );
    expect(structurallyBrokenNodes()).toContain("b");
  });

  // Every other node type has exactly ONE output, so a handle must never appear —
  // this guards the check against future multi-output types being added silently.
  it("does not flag ordinary single-output nodes", () => {
    graph(
      [
        node("t", "workflow_trigger"),
        node("c", "condition"),
        node("f", "function"),
        node("d", "destination"),
      ],
      [
        { id: "e1", source: "t", target: "c" },
        { id: "e2", source: "c", target: "f" },
        { id: "e3", source: "f", target: "d" },
      ],
    );
    expect(structurallyBrokenNodes()).toEqual([]);
  });

  // A Branch with no outgoing edges is fine — nothing is being routed yet.
  it("does not flag an unwired Branch", () => {
    graph(
      [node("t", "workflow_trigger"), node("b", "branch")],
      [{ id: "e1", source: "t", target: "b" }],
    );
    expect(structurallyBrokenNodes()).toEqual([]);
  });

  // Deleting a middle path leaves the survivors' handles non-contiguous (case-0,
  // case-2) because WorkflowBranch never re-indexes — re-deriving them by position
  // would rename case-2 to case-1 and condemn its still-wired edge as unroutable.
  it("does not flag a Branch whose surviving handles are non-contiguous", () => {
    graph(
      [
        node("t", "workflow_trigger"),
        node("b", "branch", {
          cases: [
            { handle: "case-0", conditions: {} },
            { handle: "case-2", conditions: {} },
          ],
          else_handle: "else",
        }),
        node("d", "destination"),
      ],
      [
        { id: "e1", source: "t", target: "b" },
        { id: "e2", source: "b", target: "d", sourceHandle: "case-2" },
      ],
    );
    expect(structurallyBrokenNodes()).toEqual([]);
  });
});

describe("branchHandles — handles come from the stored case, not its position", () => {
  // The stored handle is the edge's only anchor; deriving it from the array index
  // silently re-points every edge whenever a path is deleted or reordered.
  it("returns the stored handles after a middle path is deleted", () => {
    const branch = {
      id: "b",
      data: {
        node_type: "branch",
        cases: [{ handle: "case-0" }, { handle: "case-2" }],
        else_handle: "else",
      },
    };
    expect(branchHandles(branch)).toEqual(["case-0", "case-2", "else"]);
  });

  it("preserves handle identity when paths are reordered", () => {
    const branch = {
      id: "b",
      data: {
        node_type: "branch",
        cases: [{ handle: "case-1" }, { handle: "case-0" }],
        else_handle: "else",
      },
    };
    expect(branchHandles(branch)).toEqual(["case-1", "case-0", "else"]);
  });

  // Legacy rows persisted before handles existed still need a positional fallback.
  it("falls back to positional handles for cases with no stored handle", () => {
    const branch = {
      id: "b",
      data: { node_type: "branch", cases: [{}, {}], else_handle: "else" },
    };
    expect(branchHandles(branch)).toEqual(["case-0", "case-1", "else"]);
  });
});

describe("branchHandles — an unconfigured Branch offers no legacy arms", () => {
  // The old ["true","false"] fallback minted handles the drawer could never
  // declare (it only mints case-N + else), condemning every early-wired edge.
  it("returns no handles for a branch with no cases field", () => {
    expect(branchHandles({ id: "b", data: { node_type: "branch" } })).toEqual([]);
  });

  it("returns no handles for a branch with an empty cases array", () => {
    expect(branchHandles({ id: "b", data: { node_type: "branch", cases: [] } })).toEqual([]);
  });
});

describe("a new Branch node is born with a declared path", () => {
  it("addNodeAfter seeds a first case and the else arm on a fresh branch", () => {
    const { addNodeAfter } = useWorkflowCanvas(t);
    branchGraph();
    addNodeAfter("t1", "out", "branch");
    const created = workflowObj.currentSelectedWorkflow.nodes.find(
      (n: any) => n.data.node_type === "branch" && n.id !== "b1",
    );
    expect(created.data.cases).toEqual([{ handle: "case-0", conditions: null }]);
    expect(created.data.else_handle).toBe("else");
    expect(branchHandles(created)).toEqual(["case-0", "else"]);
  });

  it("wiring both seeded arms before configuring is never structurally broken", () => {
    const { addNodeAfter, onConnect } = useWorkflowCanvas(t);
    branchGraph();
    addNodeAfter("t1", "out", "branch");
    const wf = workflowObj.currentSelectedWorkflow;
    const created = wf.nodes.find((n: any) => n.data.node_type === "branch" && n.id !== "b1");
    wf.nodes.push(
      { id: "dA", position: { x: 0, y: 480 }, data: { node_type: "destination" } },
      { id: "dB", position: { x: 300, y: 480 }, data: { node_type: "destination" } },
    );
    onConnect({ source: created.id, target: "dA", sourceHandle: "case-0" });
    onConnect({ source: created.id, target: "dB", sourceHandle: "else" });
    expect(structurallyBrokenNodes()).toEqual([]);
  });

  it("does not seed cases on non-branch node types", () => {
    const { addNodeAfter } = useWorkflowCanvas(t);
    branchGraph();
    addNodeAfter("t1", "out", "condition");
    const created = workflowObj.currentSelectedWorkflow.nodes.find(
      (n: any) => n.data.node_type === "condition",
    );
    expect(created.data.cases).toBeUndefined();
    expect(created.data.else_handle).toBeUndefined();
  });
});

describe("hydrateWorkflow — heals branch edges wired before the paths existed", () => {
  // The reference wedge: a draft whose branch was wired on the legacy true/false
  // arms BEFORE cases existed, then partially configured (case-0 + its edge).
  const wedge = () => ({
    id: "w1",
    name: "wf",
    is_draft: true,
    nodes: [
      { id: "t", data: { node_type: "workflow_trigger" } },
      { id: "b", data: { node_type: "branch", cases: [{ handle: "case-0" }] } },
      { id: "d1", data: { node_type: "destination" } },
      { id: "d2", data: { node_type: "destination" } },
      { id: "d3", data: { node_type: "destination" } },
    ],
    edges: [
      { id: "e0", source: "t", target: "b" },
      { id: "e1", source: "b", target: "d1", source_handle: "true" },
      { id: "e2", source: "b", target: "d2", source_handle: "false" },
      { id: "e3", source: "b", target: "d3", source_handle: "case-0" },
    ],
  });
  const handleFor = (target: string) =>
    workflowObj.currentSelectedWorkflow.edges.find((e: any) => e.target === target)?.sourceHandle;
  const branch = () => workflowObj.currentSelectedWorkflow.nodes.find((n: any) => n.id === "b");

  it("keeps the already-valid case-0 edge untouched", () => {
    hydrateWorkflow(wedge());
    expect(handleFor("d3")).toBe("case-0");
  });

  it("maps the legacy false edge onto the else arm", () => {
    hydrateWorkflow(wedge());
    expect(handleFor("d2")).toBe("else");
  });

  it("mints a fresh case for the true edge when every case arm is taken", () => {
    hydrateWorkflow(wedge());
    expect(handleFor("d1")).toBe("case-1");
    expect(branch().data.cases.map((c: any) => c.handle)).toEqual(["case-0", "case-1"]);
  });

  it("declares the else arm the UI always offers", () => {
    hydrateWorkflow(wedge());
    expect(branch().data.else_handle).toBe("else");
  });

  it("a healed wedge is no longer structurally broken", () => {
    hydrateWorkflow(wedge());
    expect(structurallyBrokenNodes()).toEqual([]);
  });

  it("healed handles reach the save payload (no stale source_handle wins)", () => {
    hydrateWorkflow(wedge());
    const edges = serializeWorkflow().edges as any[];
    expect(edges.find((e) => e.target === "d2")?.source_handle).toBe("else");
    expect(edges.find((e) => e.target === "d1")?.source_handle).toBe("case-1");
  });

  it("a healed load leaves storedSnapshot empty so saving the fix is not a no-op", () => {
    hydrateWorkflow(wedge());
    expect(workflowObj.storedSnapshot).toBe("");
  });

  it("maps true onto the first case when that arm is free", () => {
    const wf = wedge();
    wf.edges = [
      { id: "e0", source: "t", target: "b" },
      { id: "e1", source: "b", target: "d1", source_handle: "true" },
      { id: "e2", source: "b", target: "d2", source_handle: "false" },
    ];
    hydrateWorkflow(wf);
    expect(handleFor("d1")).toBe("case-0");
    expect(handleFor("d2")).toBe("else");
    expect(branch().data.cases.map((c: any) => c.handle)).toEqual(["case-0"]);
  });

  it("seeds a first case on a never-configured branch and routes its edges", () => {
    const wf = wedge();
    (wf.nodes[1] as any).data = { node_type: "branch" };
    wf.edges = [
      { id: "e0", source: "t", target: "b" },
      { id: "e1", source: "b", target: "d1", source_handle: "true" },
      { id: "e2", source: "b", target: "d2", source_handle: "false" },
    ];
    hydrateWorkflow(wf);
    expect(branch().data.cases).toEqual([{ handle: "case-0", conditions: null }]);
    expect(branch().data.else_handle).toBe("else");
    expect(handleFor("d1")).toBe("case-0");
    expect(handleFor("d2")).toBe("else");
    expect(structurallyBrokenNodes()).toEqual([]);
  });

  it("heals a handle-less branch edge onto the first free arm", () => {
    const wf = wedge();
    wf.edges = [
      { id: "e0", source: "t", target: "b" },
      { id: "e1", source: "b", target: "d1" },
    ];
    hydrateWorkflow(wf);
    expect(handleFor("d1")).toBe("case-0");
  });

  it("leaves a fully declared workflow untouched and captures the stored snapshot", () => {
    hydrateWorkflow({
      id: "w1",
      name: "wf",
      is_draft: true,
      nodes: [
        { id: "t", data: { node_type: "workflow_trigger" } },
        {
          id: "b",
          data: { node_type: "branch", cases: [{ handle: "case-0" }], else_handle: "else" },
        },
        { id: "d1", data: { node_type: "destination" } },
        { id: "d2", data: { node_type: "destination" } },
      ],
      edges: [
        { id: "e0", source: "t", target: "b" },
        { id: "e1", source: "b", target: "d1", source_handle: "case-0" },
        { id: "e2", source: "b", target: "d2", source_handle: "else" },
      ],
    });
    expect(handleFor("d1")).toBe("case-0");
    expect(handleFor("d2")).toBe("else");
    expect(workflowObj.storedSnapshot).not.toBe("");
  });

  it("respects a branch whose declared case handles are literally true/false", () => {
    hydrateWorkflow({
      id: "w1",
      name: "wf",
      is_draft: true,
      nodes: [
        { id: "t", data: { node_type: "workflow_trigger" } },
        {
          id: "b",
          data: { node_type: "branch", cases: [{ handle: "true" }], else_handle: "else" },
        },
        { id: "d1", data: { node_type: "destination" } },
      ],
      edges: [
        { id: "e0", source: "t", target: "b" },
        { id: "e1", source: "b", target: "d1", source_handle: "true" },
      ],
    });
    expect(handleFor("d1")).toBe("true");
    expect(branch().data.cases.map((c: any) => c.handle)).toEqual(["true"]);
  });
});

describe("branchEdgeLabel — what each arm leaving a Branch routes", () => {
  const t = ((key: string, params?: any) =>
    key === "workflow.node.branchElseTitle" ? "Everything Else" : `Path ${params?.index}`) as any;

  const branch = {
    id: "b",
    data: {
      node_type: "branch",
      cases: [
        {
          handle: "case-0",
          label: "Severe (>=1000)",
          conditions: { and: [{ column: "x", operator: ">", value: "1" }] },
        },
        {
          handle: "case-2",
          label: "",
          conditions: { and: [{ column: "x", operator: ">", value: "1" }] },
        },
      ],
      else_handle: "else",
    },
  };

  it("uses the author's label when the path has one", () => {
    expect(branchEdgeLabel(branch, "case-0", t)).toBe("Severe (>=1000)");
  });

  // Position, not the handle id: `case-2` is the SECOND surviving path once a
  // middle one is deleted, and a raw handle id means nothing to a reader.
  it("numbers an unlabelled path by its position, not its handle id", () => {
    expect(branchEdgeLabel(branch, "case-2", t)).toBe("Path 2");
  });

  it("labels the else arm with the drawer's own fallback wording", () => {
    expect(branchEdgeLabel(branch, "else", t)).toBe("Everything Else");
  });

  // An empty rule evaluates TRUE, so an unset path silently swallows every record
  // before the arms below it are tried — it must not read like a configured one.
  it("flags a path whose rule was never set", () => {
    const unset = {
      id: "b2",
      data: {
        node_type: "branch",
        cases: [{ handle: "case-0", label: "Critical" }, { handle: "case-1" }],
      },
    };
    const tt = ((key: string, params?: any) =>
      key === "workflow.node.branchPathUnset"
        ? `${params?.name} · no rule set`
        : `Path ${params?.index}`) as any;
    expect(branchEdgeLabel(unset, "case-1", tt)).toBe("Path 2 · no rule set");
  });

  it("returns nothing for a non-branch source node", () => {
    const cond = { id: "c", data: { node_type: "condition" } };
    expect(branchEdgeLabel(cond, undefined, t)).toBe("");
  });

  it("returns nothing when the handle is not one this branch declares", () => {
    expect(branchEdgeLabel(branch, "case-9", t)).toBe("");
  });

  it("returns nothing for an edge that carries no sourceHandle", () => {
    expect(branchEdgeLabel(branch, undefined, t)).toBe("");
  });
});

describe("edgeBranchLabel — resolves an edge id against the live graph", () => {
  const t = ((key: string, params?: any) =>
    key === "workflow.node.branchElseTitle" ? "Everything Else" : `Path ${params?.index}`) as any;

  beforeEach(() => {
    workflowObj.currentSelectedWorkflow = {
      nodes: [
        {
          id: "b",
          data: {
            node_type: "branch",
            cases: [
              {
                handle: "case-0",
                label: "Severe",
                conditions: { and: [{ column: "x", operator: ">", value: "1" }] },
              },
              {
                handle: "case-2",
                conditions: { and: [{ column: "x", operator: ">", value: "1" }] },
              },
            ],
            else_handle: "else",
          },
        },
        { id: "c", data: { node_type: "condition" } },
        { id: "f", data: { node_type: "function" } },
      ],
      edges: [
        { id: "eb0", source: "b", target: "f", sourceHandle: "case-0" },
        { id: "eb2", source: "b", target: "f", sourceHandle: "case-2" },
        { id: "ebe", source: "b", target: "f", sourceHandle: "else" },
        { id: "ecf", source: "c", target: "f" },
      ],
    } as any;
  });

  it("labels each Branch arm", () => {
    expect(edgeBranchLabel("eb0", t)).toBe("Severe");
    expect(edgeBranchLabel("eb2", t)).toBe("Path 2");
    expect(edgeBranchLabel("ebe", t)).toBe("Everything Else");
  });

  it("leaves a Condition -> Function edge unlabelled", () => {
    expect(edgeBranchLabel("ecf", t)).toBe("");
  });

  it("returns nothing for an edge id the graph does not have", () => {
    expect(edgeBranchLabel("nope", t)).toBe("");
  });
});

// A node's ✓ is a claim about the config it ran with. Editing that config makes the
// recorded result DIRTY (n8n's term): the tick is REPLACED by an amber "retest" badge
// rather than annotated, so a stale run can never be misread as a pass. The cascade is
// n8n's — the edited node plus the first step down each arm, not the whole subtree.
describe("config edit marks the node's test result dirty", () => {
  const WF_ID = "wf-dirty";

  const seedGraph = () => {
    workflowObj.currentSelectedWorkflow = {
      id: WF_ID,
      name: "wf",
      nodes: [
        { id: "t", data: { node_type: "workflow_trigger" } },
        { id: "b", data: { node_type: "condition", conditions: { a: 1 } } },
        { id: "d", data: { node_type: "destination" } },
        { id: "deep", data: { node_type: "function" } },
        { id: "side", data: { node_type: "function" } },
      ],
      edges: [
        { id: "e1", source: "t", target: "b" },
        { id: "e2", source: "b", target: "d" },
        { id: "e3", source: "d", target: "deep" },
        { id: "e4", source: "t", target: "side" },
      ],
    } as any;
  };

  const seedResult = () => {
    workflowObj.testRun.result = {
      errors: {},
      inputs: { t: [{ x: 1 }], b: [{ x: 1 }], d: [{ x: 1 }], deep: [{ x: 1 }], side: [{ x: 1 }] },
      outputs: { t: [{ x: 1 }], b: [{ x: 1 }], d: [{ x: 1 }], deep: [{ x: 1 }], side: [{ x: 1 }] },
      ranNodeIds: ["t", "b", "d", "deep", "side"],
      blockedNodeIds: [],
      dirtyNodeIds: [],
    } as any;
  };

  const openNode = (id: string) => {
    workflowObj.currentSelectedNodeData = workflowObj.currentSelectedWorkflow.nodes.find(
      (n: any) => n.id === id,
    );
    workflowObj.currentSelectedNodeID = id;
  };

  const editB = () => {
    const { mergeNodeConfig } = useWorkflowCanvas(t);
    openNode("b");
    mergeNodeConfig({ conditions: { a: 2 } });
  };

  beforeEach(() => {
    sessionStorage.clear();
    workflowObj.readOnly = false;
    seedGraph();
    seedResult();
    resetWorkflowHistory();
  });

  it("marks the edited node dirty", () => {
    editB();
    expect((workflowObj.testRun.result as any).dirtyNodeIds).toContain("b");
  });

  it("keeps the recorded input/output so the NDV can still show what it ran with", () => {
    editB();
    const res: any = workflowObj.testRun.result;
    expect(res.inputs.b).toEqual([{ x: 1 }]);
    expect(res.outputs.b).toEqual([{ x: 1 }]);
    expect(res.ranNodeIds).toContain("b");
  });

  it("cascades to the IMMEDIATE next step only, not the whole subtree", () => {
    editB();
    const dirty: string[] = (workflowObj.testRun.result as any).dirtyNodeIds;
    expect(dirty).toContain("d");
    expect(dirty).not.toContain("deep");
  });

  it("leaves unrelated branches and upstream nodes clean", () => {
    editB();
    const dirty: string[] = (workflowObj.testRun.result as any).dirtyNodeIds;
    expect(dirty).not.toContain("t");
    expect(dirty).not.toContain("side");
  });

  it("records which node was actually edited, to distinguish the tooltip copy", () => {
    editB();
    expect((workflowObj.testRun.result as any).dirtyEditedId).toBe("b");
  });

  it("does NOT mark dirty when the payload changes nothing (open + close)", () => {
    const { mergeNodeConfig } = useWorkflowCanvas(t);
    openNode("b");
    mergeNodeConfig({ conditions: { a: 1 } });
    expect((workflowObj.testRun.result as any).dirtyNodeIds).toEqual([]);
  });

  // Verified live in the browser: stored Branch rules are the backend's v1 form
  // ({and:[…]}), and reopening the node re-emits them in the v2 UI form
  // ({filterType:"group", conditions:[…]}). Same rule, different schema — without
  // levelling both sides, merely OPENING a Branch wiped its badge.
  const V1_STORED = {
    node_type: "branch",
    cases: [
      {
        handle: "case-0",
        label: "Severe",
        conditions: {
          conditions: {
            and: [
              { column: "meta_alert_count", operator: ">=", value: "1000", ignore_case: false },
            ],
          },
        },
      },
    ],
    else_handle: "else",
  };
  const v2Emitted = (value: string) => ({
    cases: [
      {
        handle: "case-0",
        label: "Severe",
        conditions: {
          version: 2,
          conditions: {
            filterType: "group",
            logicalOperator: "AND",
            groupId: "u1",
            conditions: [
              {
                filterType: "condition",
                id: "u2",
                column: "meta_alert_count",
                operator: ">=",
                value,
                values: [],
                logicalOperator: "AND",
              },
            ],
          },
        },
      },
    ],
    else_handle: "else",
  });

  it("does NOT mark dirty when a Branch re-emits the same rules in the v2 schema", () => {
    const node = workflowObj.currentSelectedWorkflow.nodes.find((n: any) => n.id === "b");
    node.data = JSON.parse(JSON.stringify(V1_STORED));
    const { mergeNodeConfig } = useWorkflowCanvas(t);
    openNode("b");
    mergeNodeConfig(v2Emitted("1000"));

    expect((workflowObj.testRun.result as any).dirtyNodeIds).toEqual([]);
  });

  it("still marks dirty when a Branch rule's VALUE actually changes", () => {
    const node = workflowObj.currentSelectedWorkflow.nodes.find((n: any) => n.id === "b");
    node.data = JSON.parse(JSON.stringify(V1_STORED));
    const { mergeNodeConfig } = useWorkflowCanvas(t);
    openNode("b");
    mergeNodeConfig(v2Emitted("1500"));

    expect((workflowObj.testRun.result as any).dirtyNodeIds).toContain("b");
  });

  it("renaming a node keeps its result clean — a name is metadata, not config", () => {
    setNodeName(
      workflowObj.currentSelectedWorkflow.nodes.find((n: any) => n.id === "b"),
      "My Branch",
    );
    expect((workflowObj.testRun.result as any).dirtyNodeIds).toEqual([]);
  });

  it("editing a node's comment keeps its result clean", () => {
    setNodeComment(
      workflowObj.currentSelectedWorkflow.nodes.find((n: any) => n.id === "b"),
      "why this branch exists",
    );
    expect((workflowObj.testRun.result as any).dirtyNodeIds).toEqual([]);
  });

  it("only marks nodes that actually ran", () => {
    workflowObj.testRun.result = {
      errors: {},
      inputs: {},
      outputs: {},
      ranNodeIds: ["t"],
      blockedNodeIds: [],
      dirtyNodeIds: [],
    } as any;
    editB();
    expect((workflowObj.testRun.result as any).dirtyNodeIds).toEqual([]);
  });

  it("persists the dirty flag so a reload does not resurrect a clean tick", () => {
    persistTestData();
    editB();

    workflowObj.testRun.result = null;
    restoreTestData(WF_ID);

    const dirty: string[] = (workflowObj.testRun.result as any).dirtyNodeIds;
    expect(dirty).toContain("b");
    expect(dirty).toContain("d");
    expect(dirty).not.toContain("side");
  });

  it("no-ops safely when there is no recorded run", () => {
    workflowObj.testRun.result = null;
    editB();
    expect(workflowObj.testRun.result).toBeNull();
  });

  it("a full test run clears every dirty flag", async () => {
    editB();
    mockTest.mockResolvedValue({
      data: { errors: {}, inputs: { t: [{ x: 1 }] }, outputs: {} },
    });
    await executeTestRun({ orgId: "o", inputs: [{ x: 1 }] });
    expect((workflowObj.testRun.result as any).dirtyNodeIds).toEqual([]);
  });

  it("a single-node re-run clears that node's dirty flag but leaves the others", async () => {
    editB();
    mockTest.mockResolvedValue({
      data: { errors: {}, inputs: { b: [{ x: 1 }] }, outputs: { b: [{ x: 1 }] } },
    });
    await executeTestRun({ orgId: "o", inputs: [{ x: 1 }], fromNode: "b", singleNode: true });

    const dirty: string[] = (workflowObj.testRun.result as any).dirtyNodeIds;
    expect(dirty).not.toContain("b");
    expect(dirty).toContain("d");
  });
});

// The unsaved-changes guard keys off `dirtyFlag`, and the node panel commits on CLOSE
// (there is no Save button) — so a plain look-around at a Branch/Condition re-emits its
// stored rules through ConditionBuilder in the v2 UI schema. That is the SAME rule in a
// different schema, and comparing it raw made merely opening a node claim unsaved edits.
describe("useWorkflowCanvas — a no-op drawer visit must not mark the WORKFLOW dirty", () => {
  const V1_STORED = {
    node_type: "branch",
    cases: [
      {
        handle: "case-0",
        label: "Severe",
        conditions: {
          conditions: {
            and: [
              { column: "meta_alert_count", operator: ">=", value: "1000", ignore_case: false },
            ],
          },
        },
      },
    ],
    else_handle: "else",
  };

  const v2Emitted = (value: string, extraCase = false) => ({
    cases: [
      {
        handle: "case-0",
        label: "Severe",
        conditions: {
          version: 2,
          conditions: {
            filterType: "group",
            logicalOperator: "AND",
            groupId: "g1",
            conditions: [
              {
                filterType: "condition",
                id: "c1",
                column: "meta_alert_count",
                operator: ">=",
                value,
                values: [],
                logicalOperator: "AND",
              },
            ],
          },
        },
      },
      ...(extraCase ? [{ handle: "case-1", label: "Mild", conditions: { version: 2 } }] : []),
    ],
    else_handle: "else",
  });

  const openBranch = () => {
    const node = workflowObj.currentSelectedWorkflow.nodes.find((n: any) => n.id === "b");
    node.data = JSON.parse(JSON.stringify(V1_STORED));
    workflowObj.currentSelectedNodeData = node;
    workflowObj.currentSelectedNodeID = "b";
    workflowObj.dirtyFlag = false;
    resetWorkflowHistory();
  };

  beforeEach(() => {
    sessionStorage.clear();
    workflowObj.readOnly = false;
    workflowObj.testRun.result = null;
    workflowObj.currentSelectedWorkflow = {
      id: "wf-dirty",
      nodes: [
        { id: "t", data: { node_type: "workflow_trigger" } },
        { id: "b", data: { node_type: "branch" } },
        { id: "d", data: { node_type: "destination" } },
      ],
      edges: [
        { id: "e1", source: "t", target: "b" },
        { id: "e2", source: "b", target: "d" },
      ],
    } as any;
    resetWorkflowHistory();
  });

  it("stays clean when a Branch re-emits its stored v1 rules in the v2 schema", () => {
    const { mergeNodeConfig } = useWorkflowCanvas(t);
    openBranch();
    mergeNodeConfig(v2Emitted("1000"));
    expect(workflowObj.dirtyFlag).toBe(false);
  });

  it("adds no undo history for a look-around, so Ctrl+Z still targets the last real edit", () => {
    const { mergeNodeConfig } = useWorkflowCanvas(t);
    openBranch();
    mergeNodeConfig(v2Emitted("1000"));
    expect(workflowHistory.past).toEqual([]);
  });

  // The guard against over-suppression: if these go quiet the user silently loses edits,
  // because Save is never offered for a change that really happened.
  it("STILL marks dirty when a Branch rule's value genuinely changes", () => {
    const { mergeNodeConfig } = useWorkflowCanvas(t);
    openBranch();
    mergeNodeConfig(v2Emitted("4242"));
    expect(workflowObj.dirtyFlag).toBe(true);
  });

  it("STILL marks dirty when a Branch rule's operator genuinely changes", () => {
    const { mergeNodeConfig } = useWorkflowCanvas(t);
    openBranch();
    const payload = v2Emitted("1000");
    payload.cases[0].conditions.conditions.conditions[0].operator = "<";
    mergeNodeConfig(payload);
    expect(workflowObj.dirtyFlag).toBe(true);
  });

  it("STILL marks dirty when a Branch path is added", () => {
    const { mergeNodeConfig } = useWorkflowCanvas(t);
    openBranch();
    mergeNodeConfig(v2Emitted("1000", true));
    expect(workflowObj.dirtyFlag).toBe(true);
  });

  it("STILL marks dirty when a Branch path is deleted", () => {
    const { mergeNodeConfig } = useWorkflowCanvas(t);
    openBranch();
    mergeNodeConfig({ cases: [], else_handle: "else" });
    expect(workflowObj.dirtyFlag).toBe(true);
  });

  // convertV0ToV2 turns anything it does not recognise into an EMPTY group, which would
  // make every edit to such a shape compare equal and suppress the save prompt entirely.
  it("STILL marks dirty when an UNRECOGNISED condition shape changes", () => {
    const { mergeNodeConfig } = useWorkflowCanvas(t);
    const node = workflowObj.currentSelectedWorkflow.nodes.find((n: any) => n.id === "b");
    node.data = { node_type: "condition", conditions: { custom: "alpha" } };
    workflowObj.currentSelectedNodeData = node;
    workflowObj.currentSelectedNodeID = "b";
    workflowObj.dirtyFlag = false;
    mergeNodeConfig({ conditions: { custom: "beta" } });
    expect(workflowObj.dirtyFlag).toBe(true);
  });

  it("STILL marks dirty for a plain non-condition config edit", () => {
    const { mergeNodeConfig } = useWorkflowCanvas(t);
    const node = workflowObj.currentSelectedWorkflow.nodes.find((n: any) => n.id === "d");
    node.data = { node_type: "destination", destination_name: "old" };
    workflowObj.currentSelectedNodeData = node;
    workflowObj.currentSelectedNodeID = "d";
    workflowObj.dirtyFlag = false;
    mergeNodeConfig({ destination_name: "new" });
    expect(workflowObj.dirtyFlag).toBe(true);
  });

  // Metadata rides in node.meta via setNodeMeta, a path mergeNodeConfig never sees.
  it("keeps rename marking the workflow dirty", () => {
    const node = workflowObj.currentSelectedWorkflow.nodes.find((n: any) => n.id === "b");
    workflowObj.dirtyFlag = false;
    setNodeName(node, "Escalate on breach");
    expect(workflowObj.dirtyFlag).toBe(true);
  });

  it("keeps a comment edit marking the workflow dirty", () => {
    const node = workflowObj.currentSelectedWorkflow.nodes.find((n: any) => n.id === "b");
    workflowObj.dirtyFlag = false;
    setNodeComment(node, "why this branch exists");
    expect(workflowObj.dirtyFlag).toBe(true);
  });

  it("never marks dirty on the read-only Runs canvas", () => {
    const { mergeNodeConfig } = useWorkflowCanvas(t);
    openBranch();
    workflowObj.readOnly = true;
    mergeNodeConfig(v2Emitted("4242"));
    expect(workflowObj.dirtyFlag).toBe(false);
    workflowObj.readOnly = false;
  });
});

// Test state is part of the WORKFLOW DOCUMENT, not browser storage: a run one user
// records must be the run every other user sees on the same workflow, and clearing a
// browser must not silently "un-test" a workflow. Per-node summary state rides in
// `Node.meta` (strings, already round-trips to the DB); the bulky per-node
// input/output RECORDS stay client-side, since they are unbounded log lines.
describe("useWorkflowCanvas — server-side test state (Node.meta)", () => {
  const seedGraph = () => {
    workflowObj.currentSelectedWorkflow = {
      id: "wf-meta",
      name: "meta",
      nodes: [
        {
          id: "t",
          type: "input",
          data: { node_type: "workflow_trigger" },
          position: { x: 0, y: 0 },
        },
        {
          id: "b",
          type: "default",
          data: { node_type: "condition", conditions: { a: 1 } },
          position: { x: 0, y: 1 },
        },
        {
          id: "d",
          type: "output",
          data: { node_type: "destination", destination_id: "x" },
          position: { x: 0, y: 2 },
        },
      ],
      edges: [
        { id: "e1", source: "t", target: "b" },
        { id: "e2", source: "b", target: "d" },
      ],
    } as any;
  };

  const nodeById = (id: string) =>
    workflowObj.currentSelectedWorkflow.nodes.find((n: any) => n.id === id);

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    workflowObj.readOnly = false;
    seedGraph();
    workflowObj.testRun.result = null;
    resetWorkflowHistory();
  });

  it("writes per-node status into meta after a run, attributed to a run id and time", () => {
    workflowObj.testRun.result = {
      errors: { d: { error_count: 1, errors: [["boom"]] } },
      inputs: { t: [{ x: 1 }], b: [{ x: 1 }], d: [{ x: 1 }] },
      outputs: { t: [{ x: 1 }], b: [{ x: 1 }], d: [] },
      ranNodeIds: ["t", "b", "d"],
      blockedNodeIds: [],
      dirtyNodeIds: [],
      runId: "run-1",
      ranAt: 1700000000000,
    } as any;
    writeTestStateToNodes();
    expect(nodeById("b").meta.test_status).toBe("ok");
    expect(nodeById("d").meta.test_status).toBe("error");
    // Attributable: which run produced this badge, and when.
    expect(nodeById("b").meta.test_run_id).toBe("run-1");
    expect(nodeById("b").meta.test_ran_at).toBe("1700000000000");
  });

  it("records a node that ran but received no records as skipped, not a false pass", () => {
    workflowObj.testRun.result = {
      errors: {},
      inputs: { t: [{ x: 1 }], b: [] },
      outputs: {},
      ranNodeIds: ["t", "b"],
      blockedNodeIds: [],
      dirtyNodeIds: [],
      runId: "run-2",
      ranAt: 5,
    } as any;
    writeTestStateToNodes();
    expect(nodeById("b").meta.test_status).toBe("skipped");
  });

  // The persisted badge is replayed verbatim on reload, so a false green recorded
  // here outlives the run that produced it.
  it("records a never-configured node that received records as skipped, not a pass", () => {
    nodeById("d").meta = { incomplete: "true" };
    workflowObj.testRun.result = {
      errors: {},
      inputs: { t: [{ x: 1 }], b: [{ x: 1 }], d: [{ x: 1 }] },
      outputs: { t: [{ x: 1 }], b: [{ x: 1 }] },
      ranNodeIds: ["t", "b", "d"],
      blockedNodeIds: [],
      dirtyNodeIds: [],
      runId: "run-inc",
      ranAt: 13,
    } as any;
    writeTestStateToNodes();
    expect(nodeById("d").meta.test_status).toBe("skipped");
    expect(nodeById("b").meta.test_status).toBe("ok");
  });

  it("persists the dirty flag per node so a stale badge survives a reload", () => {
    workflowObj.testRun.result = {
      errors: {},
      inputs: { t: [{ x: 1 }], b: [{ x: 1 }] },
      outputs: {},
      ranNodeIds: ["t", "b"],
      blockedNodeIds: [],
      dirtyNodeIds: ["b"],
      dirtyEditedId: "b",
      runId: "run-3",
      ranAt: 7,
    } as any;
    writeTestStateToNodes();
    expect(nodeById("b").meta.test_dirty).toBe("self");
    expect(nodeById("t").meta.test_dirty).toBeUndefined();
  });

  it("marks a node dirtied by an UPSTREAM edit distinctly from one edited itself", () => {
    workflowObj.testRun.result = {
      errors: {},
      inputs: { t: [{ x: 1 }], b: [{ x: 1 }], d: [{ x: 1 }] },
      outputs: {},
      ranNodeIds: ["t", "b", "d"],
      blockedNodeIds: [],
      dirtyNodeIds: ["b", "d"],
      dirtyEditedId: "b",
      runId: "run-4",
      ranAt: 9,
    } as any;
    writeTestStateToNodes();
    expect(nodeById("b").meta.test_dirty).toBe("self");
    expect(nodeById("d").meta.test_dirty).toBe("upstream");
  });

  it("round-trips through serializeWorkflow so the state reaches the server", () => {
    workflowObj.testRun.result = {
      errors: {},
      inputs: { b: [{ x: 1 }] },
      outputs: {},
      ranNodeIds: ["b"],
      blockedNodeIds: [],
      dirtyNodeIds: [],
      runId: "run-5",
      ranAt: 11,
    } as any;
    writeTestStateToNodes();
    const sent = serializeWorkflow();
    const b = sent.nodes.find((n: any) => n.id === "b");
    expect(b.meta.test_status).toBe("ok");
    expect(b.meta.test_run_id).toBe("run-5");
  });

  // Badges describe a rehearsal against a draft. Carried into the published row they
  // read as evidence about production, which is what the run actually did NOT prove.
  it("clearTestData strips badges so publishing cannot ship rehearsal state", () => {
    workflowObj.testRun.result = {
      errors: {},
      inputs: { b: [{ x: 1 }] },
      outputs: {},
      ranNodeIds: ["b"],
      blockedNodeIds: [],
      dirtyNodeIds: [],
      runId: "run-7",
      ranAt: 12,
    } as any;
    writeTestStateToNodes();
    expect(serializeWorkflow().nodes.find((n: any) => n.id === "b").meta.test_status).toBe("ok");

    clearTestData(workflowObj.currentSelectedWorkflow.id);

    for (const node of serializeWorkflow().nodes) {
      expect(node.meta?.test_status).toBeUndefined();
      expect(node.meta?.test_run_id).toBeUndefined();
      expect(node.meta?.test_ran_at).toBeUndefined();
      expect(node.meta?.test_dirty).toBeUndefined();
    }
  });

  it("rebuilds the badge state from meta on hydrate, with NO browser storage", () => {
    hydrateWorkflow({
      id: "wf-meta",
      name: "meta",
      nodes: [
        {
          id: "b",
          data: { node_type: "condition", conditions: { a: 1 } },
          position: { x: 0, y: 0 },
          meta: { test_status: "ok", test_run_id: "run-6", test_ran_at: "13" },
        },
        {
          id: "d",
          data: { node_type: "destination", destination_id: "x" },
          position: { x: 0, y: 1 },
          meta: { test_status: "error", test_run_id: "run-6", test_ran_at: "13" },
        },
      ],
      edges: [{ id: "e", source: "b", target: "d" }],
    });
    const res: any = workflowObj.testRun.result;
    expect(res).toBeTruthy();
    expect(res.ranNodeIds).toEqual(expect.arrayContaining(["b", "d"]));
    expect(res.errors.d).toBeTruthy();
    expect(res.inputs.b?.length).toBeGreaterThan(0);
    expect(res.runId).toBe("run-6");
  });

  it("restores the dirty badge from meta on hydrate", () => {
    hydrateWorkflow({
      id: "wf-meta",
      name: "meta",
      nodes: [
        {
          id: "b",
          data: { node_type: "condition", conditions: { a: 1 } },
          position: { x: 0, y: 0 },
          meta: { test_status: "ok", test_dirty: "self", test_run_id: "r", test_ran_at: "1" },
        },
        {
          id: "d",
          data: { node_type: "destination", destination_id: "x" },
          position: { x: 0, y: 1 },
          meta: { test_status: "ok", test_dirty: "upstream", test_run_id: "r", test_ran_at: "1" },
        },
      ],
      edges: [{ id: "e", source: "b", target: "d" }],
    });
    const res: any = workflowObj.testRun.result;
    expect(res.dirtyNodeIds).toEqual(expect.arrayContaining(["b", "d"]));
    expect(res.dirtyEditedId).toBe("b");
  });

  it("leaves testRun.result null when no node carries test state", () => {
    hydrateWorkflow({
      id: "wf-meta",
      name: "meta",
      nodes: [{ id: "b", data: { node_type: "condition" }, position: { x: 0, y: 0 } }],
      edges: [],
    });
    expect(workflowObj.testRun.result).toBeNull();
  });

  it("clears the per-node meta state when test data is cleared", () => {
    workflowObj.testRun.result = {
      errors: {},
      inputs: { b: [{ x: 1 }] },
      outputs: {},
      ranNodeIds: ["b"],
      blockedNodeIds: [],
      dirtyNodeIds: [],
      runId: "run-7",
      ranAt: 15,
    } as any;
    writeTestStateToNodes();
    expect(nodeById("b").meta.test_status).toBe("ok");
    clearTestData("wf-meta");
    expect(nodeById("b").meta?.test_status).toBeUndefined();
  });

  it("does NOT mark the workflow dirty just by recording test state", () => {
    workflowObj.dirtyFlag = false;
    workflowObj.testRun.result = {
      errors: {},
      inputs: { b: [{ x: 1 }] },
      outputs: {},
      ranNodeIds: ["b"],
      blockedNodeIds: [],
      dirtyNodeIds: [],
      runId: "run-8",
      ranAt: 17,
    } as any;
    writeTestStateToNodes();
    expect(workflowObj.dirtyFlag).toBe(false);
  });
});

// Recording a run has to REACH the server on its own: the whole point is that another
// user opening the same workflow sees the badge, and they will not have run a save.
describe("useWorkflowCanvas — flushing test state to the server", () => {
  const seed = (extra: any = {}) => {
    workflowObj.currentSelectedWorkflow = {
      id: "wf-flush",
      name: "flush",
      nodes: [
        {
          id: "t",
          type: "input",
          data: { node_type: "workflow_trigger" },
          position: { x: 0, y: 0 },
        },
        {
          id: "d",
          type: "output",
          data: { node_type: "destination", destination_id: "x" },
          position: { x: 0, y: 1 },
        },
      ],
      edges: [{ id: "e", source: "t", target: "d" }],
      ...extra,
    } as any;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    workflowObj.readOnly = false;
    workflowObj.dirtyFlag = false;
    workflowObj.testRun.result = null;
    seed();
    (workflowService.testWorkflow as any).mockResolvedValue({
      data: { errors: {}, inputs: { t: [{ x: 1 }], d: [{ x: 1 }] }, outputs: {} },
    });
    (workflowService.updateWorkflow as any).mockResolvedValue({ data: {} });
  });

  it("persists the recorded state to the workflow document after a run", async () => {
    await executeTestRun({ orgId: "org", inputs: [{ x: 1 }] });
    expect(workflowService.updateWorkflow).toHaveBeenCalledTimes(1);
    const call = (workflowService.updateWorkflow as any).mock.calls[0][0];
    expect(call.id).toBe("wf-flush");
    const d = call.data.workflow.nodes.find((n: any) => n.id === "d");
    expect(d.meta.test_status).toBe("ok");
  });

  it("flushes a draft back to the DRAFT row, never promoting it to published", async () => {
    seed({ isDraft: true });
    await executeTestRun({ orgId: "org", inputs: [{ x: 1 }] });
    expect((workflowService.updateWorkflow as any).mock.calls[0][0].draft).toBe(true);
  });

  it("does NOT flush an unsaved workflow — there is no row to write to yet", async () => {
    seed({ id: "" });
    await executeTestRun({ orgId: "org", inputs: [{ x: 1 }] });
    expect(workflowService.updateWorkflow).not.toHaveBeenCalled();
  });

  it("does NOT flush while the graph has unsaved edits, which would save them silently", async () => {
    workflowObj.dirtyFlag = true;
    await executeTestRun({ orgId: "org", inputs: [{ x: 1 }] });
    expect(workflowService.updateWorkflow).not.toHaveBeenCalled();
  });

  it("keeps the run result even when the flush fails", async () => {
    (workflowService.updateWorkflow as any).mockRejectedValue(new Error("nope"));
    const r = await executeTestRun({ orgId: "org", inputs: [{ x: 1 }] });
    expect(r.ok).toBe(true);
    expect(workflowObj.testRun.result).toBeTruthy();
  });

  it("does not leave the workflow marked dirty after flushing", async () => {
    await executeTestRun({ orgId: "org", inputs: [{ x: 1 }] });
    expect(workflowObj.dirtyFlag).toBe(false);
  });
});

// ── Retry of a failed run ────────────────────────────────────────────────────
// Retry replays a run's STORED per-node input, so it only works on a run whose
// error rows were persisted. save_workflow_errors is called from execute_workflow
// alone (the real trigger path); test_workflow and retry_run only call
// record_workflow_run. So a Test run AND a Retry run both appear in history with
// no stored input, and the endpoint answers 400 "Errored run info not found".
describe("isRetryableRun — the gate that keeps retry off runs the backend must refuse", () => {
  it("accepts a failed run from a real trigger", () => {
    expect(isRetryableRun({ event_type: "AlertFired", error: "boom" })).toBe(true);
  });

  it("accepts the other real trigger types", () => {
    for (const et of ["IncidentEvent", "Webhook", "Manual"]) {
      expect(isRetryableRun({ event_type: et, error: "boom" })).toBe(true);
    }
  });

  it("rejects a SUCCESSFUL run — there is nothing to replay", () => {
    expect(isRetryableRun({ event_type: "AlertFired", error: "" })).toBe(false);
    expect(isRetryableRun({ event_type: "AlertFired" })).toBe(false);
  });

  it("rejects a failed TEST run — /test never persists the run's input", () => {
    expect(isRetryableRun({ event_type: "Test", error: "boom" })).toBe(false);
  });

  it("rejects a failed RETRY run — retry_run records the run but stores no input", () => {
    expect(isRetryableRun({ event_type: "Retry", error: "boom" })).toBe(false);
  });

  it("rejects null/undefined rather than throwing", () => {
    expect(isRetryableRun(null)).toBe(false);
    expect(isRetryableRun(undefined)).toBe(false);
  });

  it("names the blocker so a disabled affordance can say why", () => {
    expect(retryBlockedReason({ event_type: "Test", error: "boom" })).toBe("test");
    expect(retryBlockedReason({ event_type: "Retry", error: "boom" })).toBe("retry");
    expect(retryBlockedReason({ event_type: "AlertFired", error: "" })).toBe("succeeded");
    expect(retryBlockedReason({ event_type: "AlertFired", error: "boom" })).toBe("");
  });
});

describe("retryWorkflowRun", () => {
  beforeEach(() => {
    (workflowService.retryWorkflow as any).mockReset();
    (workflowService.retryWorkflow as any).mockResolvedValue({ data: {} });
  });

  it("posts the run id to the retry endpoint", async () => {
    const r = await retryWorkflowRun({ orgId: "org", workflowId: "wf", runId: "run-1" });
    expect(r.ok).toBe(true);
    expect(workflowService.retryWorkflow).toHaveBeenCalledWith({
      org_identifier: "org",
      id: "wf",
      run_id: "run-1",
      from_node: undefined,
    });
  });

  it("passes from_node so a retry can restart at one step", async () => {
    await retryWorkflowRun({
      orgId: "org",
      workflowId: "wf",
      runId: "run-1",
      fromNode: "node-a",
    });
    expect((workflowService.retryWorkflow as any).mock.calls[0][0].from_node).toBe("node-a");
  });

  it("surfaces the backend 400 message ('Errored run info not found')", async () => {
    (workflowService.retryWorkflow as any).mockRejectedValue({
      response: { status: 400, data: { message: "Errored run info not found" } },
    });
    const r = await retryWorkflowRun({ orgId: "org", workflowId: "wf", runId: "run-1" });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("Errored run info not found");
  });

  it("humanizes node uuids in the failure message", async () => {
    const prev = workflowObj.currentSelectedWorkflow;
    workflowObj.currentSelectedWorkflow = {
      id: "wf",
      name: "wf",
      nodes: [
        {
          id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          data: { node_type: "function" },
          meta: { label: "Enrich" },
        },
      ],
      edges: [],
    } as any;
    (workflowService.retryWorkflow as any).mockRejectedValue({
      response: {
        status: 400,
        data: {
          message:
            "node id aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee does not have any associated input data in the stored inputs",
        },
      },
    });
    const r = await retryWorkflowRun({ orgId: "org", workflowId: "wf", runId: "run-1" });
    workflowObj.currentSelectedWorkflow = prev;
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Enrich");
    expect(r.error).not.toContain("aaaaaaaa-bbbb");
  });

  it("refuses to call the endpoint for a run it already knows is not retryable", async () => {
    const r = await retryWorkflowRun({
      orgId: "org",
      workflowId: "wf",
      runId: "run-1",
      run: { event_type: "Test", error: "boom" },
    });
    expect(r.ok).toBe(false);
    expect(workflowService.retryWorkflow).not.toHaveBeenCalled();
  });
});

// Both run-history surfaces (the Runs table and the editor's History dropdown)
// have to make the SAME call about test runs; the switcher shipped without this
// and buried published-workflow history under a wall of rehearsals.
describe("useTestRunVisibility — one default shared by every run-history surface", () => {
  beforeEach(() => {
    workflowObj.runsHistory = {
      list: [],
      fetchedAt: 0,
      params: { start: 0, end: 0 },
      loading: false,
    } as any;
    workflowObj.currentSelectedWorkflow = { id: "wf1", nodes: [], edges: [] } as any;
  });

  it("shows test runs by default on a DRAFT — rehearsing is what a draft is for", () => {
    workflowObj.currentSelectedWorkflow.isDraft = true;
    expect(useTestRunVisibility().showTestRuns.value).toBe(true);
  });

  it("hides test runs by default once the workflow is PUBLISHED", () => {
    workflowObj.currentSelectedWorkflow.isDraft = false;
    expect(useTestRunVisibility().showTestRuns.value).toBe(false);
  });

  // A deep link mounts the surface BEFORE the workflow hydrates, so a snapshot
  // taken at setup would lock in the pre-hydration (published) default forever.
  it("tracks a workflow that hydrates as a draft after the surface mounted", () => {
    const { showTestRuns } = useTestRunVisibility();
    expect(showTestRuns.value).toBe(false);
    workflowObj.currentSelectedWorkflow.isDraft = true;
    expect(showTestRuns.value).toBe(true);
  });

  it("lets an explicit choice outrank the default, and survive a mid-session Publish", () => {
    workflowObj.currentSelectedWorkflow.isDraft = true;
    const { showTestRuns } = useTestRunVisibility();
    showTestRuns.value = false;
    expect(showTestRuns.value).toBe(false);
    workflowObj.currentSelectedWorkflow.isDraft = false;
    expect(showTestRuns.value).toBe(false);
  });

  it("counts only the test runs, so a reveal control cannot overstate what it hides", () => {
    workflowObj.runsHistory.list = [
      { run_id: "a", event_type: "Test" },
      { run_id: "b", event_type: "AlertFired" },
      { run_id: "c", event_type: "Test" },
      { run_id: "d" },
    ] as any;
    expect(useTestRunVisibility().testRunCount.value).toBe(2);
  });

  it("filters test runs out of a list while hidden, and passes them all through while shown", () => {
    workflowObj.currentSelectedWorkflow.isDraft = false;
    const list = [
      { run_id: "a", event_type: "Test" },
      { run_id: "b", event_type: "AlertFired" },
    ] as any[];
    const vis = useTestRunVisibility();
    expect(vis.visibleRuns(list).map((r: any) => r.run_id)).toEqual(["b"]);
    vis.showTestRuns.value = true;
    expect(vis.visibleRuns(list).map((r: any) => r.run_id)).toEqual(["a", "b"]);
  });

  // Two surfaces reading one module-level ref would fight each other; each caller
  // owns its own override so hiding rows in the table cannot silently reshape the
  // dropdown (and vice versa).
  it("gives each surface its own override rather than a shared module-level one", () => {
    workflowObj.currentSelectedWorkflow.isDraft = true;
    const a = useTestRunVisibility();
    const b = useTestRunVisibility();
    a.showTestRuns.value = false;
    expect(a.showTestRuns.value).toBe(false);
    expect(b.showTestRuns.value).toBe(true);
  });
});

// A canvas badge is a claim about the workflow. Every badge the editor can paint
// from its own state was earned by /workflows/test, so it must be able to say so.
describe("isTestEarnedResult — where a canvas badge's evidence came from", () => {
  it("treats an explicitly test-sourced result as test-earned", () => {
    expect(isTestEarnedResult({ source: "test" })).toBe(true);
  });

  it("does not treat a real recorded execution as test-earned", () => {
    expect(isTestEarnedResult({ mode: "history", source: "run" })).toBe(false);
  });

  // A loaded history run whose row says Test is still a rehearsal, even though it
  // arrived through the history path rather than the editor's Test button.
  it("treats a loaded history run as test-earned when the run itself was a Test", () => {
    expect(isTestEarnedResult({ mode: "history", source: "test" })).toBe(true);
  });

  it("is false for no result at all", () => {
    expect(isTestEarnedResult(null)).toBe(false);
    expect(isTestEarnedResult(undefined)).toBe(false);
  });
});

// Provenance has to be STAMPED at every point a result is created, or the badge
// falls back to guessing. These are the three creation paths.
describe("run provenance is stamped on every testRun.result", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workflowObj.currentSelectedWorkflow = {
      id: "wf1",
      nodes: [
        { id: "t1", data: { node_type: "workflow_trigger" } },
        { id: "c1", data: { node_type: "condition" } },
      ],
      edges: [{ source: "t1", target: "c1" }],
    } as any;
    workflowObj.testRun.result = null;
    workflowObj.runsHistory = {
      list: [],
      fetchedAt: 0,
      params: { start: 0, end: 0 },
      loading: false,
    } as any;
  });

  it("stamps source=test on a Test run from the editor", async () => {
    (workflowService.testWorkflow as any).mockResolvedValue({
      data: { errors: {}, inputs: { c1: [{}] }, outputs: {} },
    });
    await executeTestRun({ orgId: "default", inputs: [{}] });
    expect(isTestEarnedResult(workflowObj.testRun.result)).toBe(true);
  });

  // The run-detail endpoint carries no event_type, so provenance is resolved
  // against the shared history list the switcher already fetched.
  it("stamps source=run for a loaded history run the history list calls AlertFired", async () => {
    workflowObj.runsHistory.list = [{ run_id: "r1", event_type: "AlertFired" }] as any;
    (workflowService.getWorkflowRun as any).mockResolvedValue({ data: { errors: {}, data: {} } });
    await loadWorkflowRun({ orgId: "default", workflowId: "wf1", runId: "r1" });
    expect(isTestEarnedResult(workflowObj.testRun.result)).toBe(false);
  });

  it("stamps source=test for a loaded history run the history list calls Test", async () => {
    workflowObj.runsHistory.list = [{ run_id: "r1", event_type: "Test" }] as any;
    (workflowService.getWorkflowRun as any).mockResolvedValue({ data: { errors: {}, data: {} } });
    await loadWorkflowRun({ orgId: "default", workflowId: "wf1", runId: "r1" });
    expect(isTestEarnedResult(workflowObj.testRun.result)).toBe(true);
  });

  // Only writeTestStateToNodes persists badges to the document, and it refuses
  // history runs — so anything restored from Node.meta was necessarily a Test.
  it("restores document-persisted badges as test-earned", () => {
    workflowObj.currentSelectedWorkflow.nodes[1].meta = { test_status: "ok" };
    hydrateWorkflow(JSON.parse(JSON.stringify(workflowObj.currentSelectedWorkflow)));
    expect(isTestEarnedResult(workflowObj.testRun.result)).toBe(true);
  });
});

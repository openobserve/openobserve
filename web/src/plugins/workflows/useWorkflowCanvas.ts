/* Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

// Workflow canvas composable — a fork of plugins/pipelines/useDnD.ts.
//
// Differences from the pipeline version:
//   - Docked node palette (the shared NodePalette). Nodes can be added three
//     ways: drag-from-palette (onDragStart/onDragOver/onDrop — placed
//     unconnected, wired manually), palette click (addNodeToEnd — appends after
//     the end node and auto-wires), and the hover-`+` step picker (addNodeAfter
//     — appends after a specific node and auto-wires).
//   - Restricted, colour-coded node taxonomy (trigger / logic / action).
//   - Cycle + single-incoming validation use edge.source/target strings
//     (always present) instead of VueFlow's runtime sourceNode/targetNode.
//
// State is a module-level reactive singleton (same pattern as pipelineObj) so
// the editor, canvas, nodes and node-forms all share one object.

import { reactive } from "vue";
import { useVueFlow } from "@vue-flow/core";
import { getUUID, getImageURL } from "@/utils/zincutils";
import { toast } from "@/lib/feedback/Toast/useToast";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import { detectCycle } from "@/composables/flow/detectCycle";
import { makeEdge } from "@/composables/flow/makeEdge";
import { getTruncatedConditions } from "@/utils/conditionPreview";
import workflowService from "@/services/workflows";

export type WorkflowNodeCategory = "trigger" | "logic" | "action";

export interface WorkflowNodeMeta {
  /** Colour/behaviour family. */
  category: WorkflowNodeCategory;
  /** Small uppercase label above the title (i18n key). */
  kindKey: string;
  /** Node title (i18n key). */
  titleKey: string;
  /** Short description (i18n key), shown in the step picker. */
  descKey: string;
  /** OIcon registry name for the node's glyph (fallback when no `image`). */
  icon: IconName;
  /**
   * Node image URL — reuses the pipeline node images so the two canvases look
   * consistent. Rendered as an "img:<url>" glyph; falls back to `icon`.
   */
  image?: string;
  /**
   * VueFlow render template + handle layout (UI only — NOT persisted).
   *  - "input":  source handle only (the trigger; can't receive).
   *  - "default": source + target handles (any continuable step).
   *  - "output": target handle only (hard terminal; unused in workflows so
   *    every action can chain onward).
   * Node role for the backend is inferred from `node_type` + edges, so this
   * never goes into the saved payload.
   */
  ioType: "input" | "output" | "default";
}

// v1 palette (D2 + FD4). node_type matches the backend serde tag
// (NodeData, #[serde(tag = "node_type", rename_all = "snake_case")]).
export const WORKFLOW_NODE_TYPES: Record<string, WorkflowNodeMeta> = {
  workflow_trigger: {
    category: "trigger",
    kindKey: "workflow.node.kindTrigger",
    titleKey: "workflow.node.alertTrigger",
    descKey: "workflow.node.triggerBody",
    icon: "notifications-active",
    image: getImageURL("images/pipeline/input_stream.png"),
    ioType: "input",
  },
  condition: {
    category: "logic",
    kindKey: "workflow.node.kindLogic",
    titleKey: "workflow.node.condition",
    descKey: "workflow.node.conditionDesc",
    icon: "alt-route",
    image: getImageURL("images/pipeline/transform_condition.png"),
    ioType: "default",
  },
  function: {
    category: "logic",
    kindKey: "workflow.node.kindLogic",
    titleKey: "workflow.node.function",
    descKey: "workflow.node.functionDesc",
    icon: "code",
    image: getImageURL("images/pipeline/transform_function.png"),
    ioType: "default",
  },
  // `destination_id` holds the Pipeline (remote) Destination's name.
  destination: {
    category: "action",
    kindKey: "workflow.node.kindAction",
    titleKey: "workflow.node.sendToDestination",
    descKey: "workflow.node.destinationDesc",
    icon: "share",
    image: getImageURL("images/pipeline/output_remote.png"),
    ioType: "output",
  },
};

export const nodeMeta = (nodeType: string): WorkflowNodeMeta | undefined =>
  WORKFLOW_NODE_TYPES[nodeType];

// Node types offered by the hover-`+` StepMenu (everything but the trigger,
// which is fixed and can only be the first node).
export const ADDABLE_NODE_TYPES = ["condition", "function", "destination"];

// A node's configured detail, shown as a subtitle on the canvas card and used as
// the differentiator in the Test "Run From" dropdown. Function -> VRL function
// name, Destination -> destination name, Condition -> its rule preview (same
// formatter the pipeline condition node uses).
export const nodeConfigDetail = (data: any, maxLen = 28): string => {
  const type = data?.node_type;
  if (type === "function") return data?.name || "";
  if (type === "destination") return data?.destination_id || "";
  if (type === "condition") return getTruncatedConditions(data?.conditions, maxLen);
  return "";
};

// Trigger kinds the user chooses from when creating a workflow. `key` maps to
// the future backend WorkflowTriggerKind (B1). Only Alert Fired is enabled in
// v1; the rest are shown as "coming soon" so the picker is clearly extensible.
export interface WorkflowTriggerType {
  key: string;
  labelKey: string;
  descKey: string;
  icon: IconName;
  enabled: boolean;
}

export const WORKFLOW_TRIGGER_TYPES: WorkflowTriggerType[] = [
  {
    key: "alert_fired",
    labelKey: "workflow.triggerType.alertFired",
    descKey: "workflow.triggerType.alertFiredDesc",
    icon: "notifications-active",
    enabled: true,
  },
  {
    key: "schedule",
    labelKey: "workflow.triggerType.schedule",
    descKey: "workflow.triggerType.scheduleDesc",
    icon: "schedule",
    enabled: false,
  },
  {
    key: "webhook",
    labelKey: "workflow.triggerType.webhook",
    descKey: "workflow.triggerType.webhookDesc",
    icon: "webhook",
    enabled: false,
  },
];

const defaultDialog = {
  show: false,
  name: "",
  // When a node body needs the full-width drawer with its own footer (e.g. the
  // Function form's inline "Create New Function" editor), it flips this on; the
  // drawer widens and hides its Save/Cancel/Delete buttons.
  expand: false,
};

const defaultWorkflow = {
  id: "",
  name: "",
  description: "",
  enabled: true,
  nodes: <any>[],
  edges: <any>[],
  org: "",
};

const defaultObject = {
  dirtyFlag: false,
  isEditWorkflow: false,
  // Read-only canvas (the dedicated Runs inspection view sets this): no node
  // dragging/connecting, no hover add/delete, node clicks don't open the config
  // drawer. Run badges + the per-node result drawer stay active.
  readOnly: false,
  isEditNode: false,
  edgesChange: false,
  nodesChange: false,
  currentSelectedNodeID: "",
  currentSelectedNodeData: <any>null,
  // Edge to create when the staged node's drawer is saved (add flow).
  pendingEdge: <any>null,
  dialog: { ...defaultDialog },
  // Step picker (the searchable "add next step" dialog). The hover-`+` opens it
  // with the source node + handle; picking a type calls addNodeAfter.
  stepPicker: { show: false, source: "", handle: "out" },
  // Node type currently being dragged from the palette (drag-and-drop add).
  draggedNodeType: "",
  // Pending node-delete confirmation. Both delete entry points (hover-`x` on the
  // card and the drawer's Delete button) funnel through this so the ConfirmDialog
  // (rendered once in WorkflowEditor) can guard the removal.
  deleteConfirm: { show: false, nodeId: "" },
  // Test run state. `show` toggles the small input popup (sample payload +
  // run-from). `input`/`fromNode` persist across opens. `result` holds the last
  // run outcome — `{ errors: {nodeId: NodeErrors}, ranNodeIds, blockedNodeIds }` —
  // read by each WorkflowNode to render its ✓ / ✗ / ⊘ badge on the canvas.
  testRun: {
    show: false,
    input: "",
    // "" = run from the beginning (trigger); a node id runs from that node down.
    // Kept as "" (falsy) so consumers just check `!fromNode`. The Run-From select
    // maps "" to a display sentinel locally (see WorkflowTestDialog) — the
    // sentinel never lands here or on the API payload.
    fromNode: "",
    result: <any>null,
    // Per-node Input/Output result drawer (opened by clicking a node's badge).
    resultDrawer: { show: false, nodeId: "" },
  },
  currentSelectedWorkflow: <any>JSON.parse(JSON.stringify(defaultWorkflow)),
  workflowWithoutChange: <any>JSON.parse(JSON.stringify(defaultWorkflow)),
  nameError: false,
  nameErrorMessage: "",
};

const workflowObj = reactive(Object.assign({}, defaultObject));

export { workflowObj };

// ── Shared graph helpers ─────────────────────────────────────────────────────
// Workflows enforce one incoming edge per node (see onConnect), so the graph is
// a TREE rooted at the trigger (or from_node) — a plain BFS from the root visits
// every parent before its children (no topo sort needed; reconvergence, the only
// shape BFS gets wrong, can't exist in a tree). Used by the Test dialog's
// "Run From" ordering and the run-scope helpers below.
// Children adjacency map from edges (handles both {source,target} and
// {sourceNode,targetNode} edge shapes). Leaf nodes (no outgoing edge) are absent
// from the map — callers read it as `children.get(id) ?? []`.
//
// Example — for Trigger → Function → Destination:
//   edges: [{ source: "t", target: "f" }, { source: "f", target: "d" }]
//   returns: Map { "t" => ["f"], "f" => ["d"] }   // "d" is a leaf → not a key
export const buildChildrenMap = (edges: any[]): Map<string, string[]> => {
  const children = new Map<string, string[]>();
  for (const e of edges || []) {
    const src = e.source ?? e.sourceNode?.id;
    const tgt = e.target ?? e.targetNode?.id;
    if (!src || !tgt) continue;
    if (!children.has(src)) children.set(src, []);
    children.get(src)!.push(tgt);
  }
  return children;
};

// All node ids in BFS (flow) order from `startId` (default: the trigger).
// Workflows enforce one incoming edge per node → the graph is a TREE, so BFS
// visits every parent before its children (no topo sort needed). Nodes not
// reached from the start are appended so nothing silently drops.
//
// Example — for Trigger(t) → Function(f) → Destination(d):
//   flowOrderedNodeIds(nodes, edges)         => ["t", "f", "d"]  // from trigger
//   flowOrderedNodeIds(nodes, edges, "f")    => ["f", "d"]       // run-from "f"
export const flowOrderedNodeIds = (
  nodes: any[],
  edges: any[],
  startId?: string,
): string[] => {
  const children = buildChildrenMap(edges);
  const start =
    startId ||
    (nodes || []).find((n: any) => n.data?.node_type === "workflow_trigger")
      ?.id;
  const order: string[] = [];
  const seen = new Set<string>();
  const queue = start ? [start] : [];
  while (queue.length) {
    const cur = queue.shift()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    order.push(cur);
    for (const k of children.get(cur) ?? []) if (!seen.has(k)) queue.push(k);
  }
  for (const n of nodes || []) if (!seen.has(n.id)) order.push(n.id);
  return order;
};

// `startIds` + everything downstream of them (a Set; the starts are included).
//
// Example — for Trigger(t) → Function(f) → Destination(d):
//   reachableFrom(edges, ["f"])   => Set { "f", "d" }   // "f" and downstream
//   reachableFrom(edges, ["t"])   => Set { "t", "f", "d" }
export const reachableFrom = (
  edges: any[],
  startIds: string[],
): Set<string> => {
  const children = buildChildrenMap(edges);
  const reached = new Set<string>(startIds);
  const queue = [...startIds];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const k of children.get(cur) ?? [])
      if (!reached.has(k)) {
        reached.add(k);
        queue.push(k);
      }
  }
  return reached;
};

// Nodes downstream of (but not including) the errored nodes — they can't be
// confirmed as passed (records may not have reached them), so they show a
// neutral "not verified" badge rather than a ✓.
const downstreamOfErrorNodes = (errorIds: string[]): string[] => {
  if (!errorIds.length) return [];
  const set = reachableFrom(
    workflowObj.currentSelectedWorkflow.edges || [],
    errorIds,
  );
  for (const id of errorIds) set.delete(id);
  return [...set];
};

// Run the workflow Test (from the Test dialog or a node's Replay button) and
// store the result so each WorkflowNode paints its ✓ / ✗ / ⊘ badge. Shared so
// both entry points behave identically. The backend returns errors only — the
// step drawer (error nodes only) derives its input/output from `errors`, so
// there's no per-node node_io to carry.
export const executeTestRun = async (opts: {
  orgId: string;
  inputs: any[];
  fromNode?: string;
}): Promise<{ ok: boolean; error?: string }> => {
  const wf = workflowObj.currentSelectedWorkflow;
  try {
    const res = await workflowService.testWorkflow({
      org_identifier: opts.orgId,
      id: wf.id,
      inputs: opts.inputs,
      from_node: opts.fromNode || undefined,
    });
    const errors = res.data?.errors || {};
    // Which nodes ran: from a replay, `fromNode` + everything downstream;
    // otherwise everything reachable from the trigger. Nodes NOT reachable
    // (unwired / disconnected) never executed, so they must not paint a ✓.
    const triggerId = (wf.nodes || []).find(
      (n: any) => n.data?.node_type === "workflow_trigger",
    )?.id;
    const startId = opts.fromNode || triggerId;
    const ranNodeIds = startId
      ? [...reachableFrom(wf.edges || [], [startId])]
      : [];
    workflowObj.testRun.result = {
      errors,
      ranNodeIds,
      blockedNodeIds: downstreamOfErrorNodes(Object.keys(errors)),
    };
    return { ok: true };
  } catch (e: any) {
    // A failed run must not leave the previous run's ✓/✗ badges on screen.
    workflowObj.testRun.result = null;
    return { ok: false, error: e?.response?.data?.message };
  }
};

// Load a PAST run (from the Executions history) into the same testRun.result the
// canvas already reads — so error nodes paint ✗ and open the step drawer, but
// read-only (no editable input / Replay). The run detail carries:
//   errors.data:      [{ node_id, error: string[] }]  — errored nodes + messages
//   data.node_map:    { node_id: [{ meta, data }] }   — per-node input processed
//   data.complete:    [{ meta, data }]                — full workflow input
// The array-vs-map difference in errors.data is bridged here (each entry has its
// node_id), so it lines up with node_map by key.
export const loadWorkflowRun = async (opts: {
  orgId: string;
  workflowId: string;
  runId: string;
}): Promise<{ ok: boolean; error?: string }> => {
  const wf = workflowObj.currentSelectedWorkflow;
  try {
    const res = await workflowService.getWorkflowRun({
      org_identifier: opts.orgId,
      id: opts.workflowId,
      run_id: opts.runId,
    });
    const payload = res.data || {};

    // errors.data (array) -> map keyed by node_id, in the same
    // { error_count, errors: [[message], …] } shape the badges + drawer read.
    const errList = Array.isArray(payload.errors?.data)
      ? payload.errors.data
      : [];
    const errors: Record<string, any> = {};
    for (const e of errList) {
      // Drop null/empty messages so a message-less error entry doesn't render
      // the literal string "undefined"/"null" as an error line.
      const msgs = (Array.isArray(e.error) ? e.error : [e.error]).filter(
        Boolean,
      );
      errors[e.node_id] = {
        error_count: msgs.length,
        errors: msgs.map((m: string) => [m]),
      };
    }

    const nodeInputs = payload.data?.node_map || {};

    // GHOST NODES — the run references a node the workflow no longer has (it was
    // edited/deleted after the run). Its badge has nowhere to render, so an error
    // would silently vanish and the run would look cleaner than it was. Surface
    // them so the Runs view can say the graph no longer matches this run.
    const currentNodeIds = new Set((wf.nodes || []).map((n: any) => n.id));
    const ghostNodeIds = [
      ...new Set([...Object.keys(errors), ...Object.keys(nodeInputs)]),
    ].filter((id) => !currentNodeIds.has(id));

    workflowObj.testRun.result = {
      errors,
      // Every node "ran": upstream shows ✓, errored ✗, downstream ⊘ — via the
      // existing testStatus logic. Only ✗ nodes are clickable.
      ranNodeIds: (wf.nodes || []).map((n: any) => n.id),
      blockedNodeIds: downstreamOfErrorNodes(Object.keys(errors)),
      // Per-node input the drawer shows (read-only) for an errored node.
      nodeInputs,
      fullInput: payload.data?.complete ?? null,
      mode: "history",
      runId: opts.runId,
      ghostNodeIds,
    };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.response?.data?.message };
  }
};

// Load a workflow (a list row or API result) into the shared editor state,
// normalizing nodes/edges for VueFlow (type from node_type; edge styling). Mirrors
// the pipeline pattern where editPipeline() sets pipelineObj from the row
// synchronously — so the editor has the name + graph immediately, no re-fetch.
export const hydrateWorkflow = (wf: any) => {
  const nodes = (wf.nodes || []).map((n: any) => {
    // VueFlow render template comes from node_type (not a stored io_type).
    // Drop any legacy io_type from the node, falling back to it only for the
    // render template if node_type is somehow unknown.
    const { io_type: legacyIoType, ...rest } = n;
    const node = {
      ...rest,
      type: nodeMeta(n.data?.node_type)?.ioType || legacyIoType || "default",
    };
    // The trigger's kind lives in `meta` (strings) since its NodeData is a unit
    // variant. Rehydrate it into `data` so the form/UI can read it.
    if (node.data?.node_type === "workflow_trigger" && node.meta) {
      node.data = {
        ...node.data,
        trigger_kind:
          node.meta.trigger_kind || node.data.trigger_kind || "alert_fired",
      };
    }
    return node;
  });
  // Take styling from the shared makeEdge (arrow + grey stroke) so loaded edges
  // look identical to freshly-added ones; keep each loaded edge's own id/fields.
  const edges = (wf.edges || []).map((e: any) => {
    const src = e.source ?? e.sourceNode?.id;
    const tgt = e.target ?? e.targetNode?.id;
    const styled = makeEdge(src, tgt, e.sourceHandle);
    return { ...e, ...styled, id: e.id || styled.id };
  });
  workflowObj.currentSelectedWorkflow = { ...wf, nodes, edges };
  // Snapshot the NORMALIZED graph (VueFlow type + styled edges), not raw `wf`,
  // so any cancel/restore or dirty-compare baseline matches what's on canvas.
  workflowObj.workflowWithoutChange = JSON.parse(
    JSON.stringify(workflowObj.currentSelectedWorkflow),
  );
  workflowObj.isEditWorkflow = true;
};

export default function useWorkflowCanvas() {
  const { screenToFlowCoordinate, onNodesInitialized, updateNode } =
    useVueFlow();

  // --- edge helpers ----------------------------------------------------------
  // Edge factory + cycle detection are shared with the pipeline canvas
  // (composables/flow). `newEdge` keeps the existing name for internal callers
  // and the exported API.
  const newEdge = makeEdge;

  // --- VueFlow event handlers ------------------------------------------------
  function onNodeChange() {}

  function onNodesChange() {
    if (workflowObj.isEditWorkflow) workflowObj.nodesChange = true;
  }

  function onEdgesChange(changes: any[]) {
    // VueFlow fires this for cosmetic/interaction changes too — `select`,
    // `dimensions` — not just add/remove, and hovering a node recolours its
    // connected edges. Only a STRUCTURAL change (an edge added or removed) is a
    // real edit, so gate the dirty flag on that. Otherwise inspecting a run
    // (hover a node → click its error badge → Esc) would mark the workflow
    // unsaved and wrongly force a Save-before-Test on the next run.
    const structural = changes.some(
      (c: any) => c?.type === "add" || c?.type === "remove",
    );
    if (structural && workflowObj.isEditWorkflow) workflowObj.dirtyFlag = true;
    if (structural) workflowObj.edgesChange = true;
  }

  // Manual wiring (dragging between handles). Programmatic add uses addNodeAfter.
  function onConnect(connection: any) {
    const edges = workflowObj.currentSelectedWorkflow.edges;

    // one incoming edge per node
    if (edges.some((e: any) => e.target === connection.target)) {
      toast({
        message: "Only one incoming connection to a step is allowed",
        variant: "warning",
      });
      return;
    }

    if (detectCycle(edges, connection)) {
      toast({
        message: "This connection would create a loop",
        variant: "warning",
      });
      return;
    }

    workflowObj.currentSelectedWorkflow.edges = [
      ...edges,
      newEdge(connection.source, connection.target, connection.sourceHandle),
    ];
  }

  // The trigger starts the workflow, so it can't be a connection target.
  // Everything else is continuable (no hard terminals), so any node can be a
  // source. Role is derived from node_type, not a stored io_type.
  function validateConnection({ source, target }: any) {
    const nodes = workflowObj.currentSelectedWorkflow.nodes;
    const src = nodes.find((n: any) => n.id === source);
    const tgt = nodes.find((n: any) => n.id === target);
    if (!src || !tgt) return false;
    if (tgt.data?.node_type === "workflow_trigger") return false; // can't receive
    return true;
  }

  // Ask before removing a node — opens the ConfirmDialog (rendered in
  // WorkflowEditor) rather than deleting outright. The trigger anchors the
  // workflow, so it's rejected here without a prompt.
  function requestDeleteNode(nodeId: string) {
    const wf = workflowObj.currentSelectedWorkflow;
    const node = wf.nodes.find((n: any) => n.id === nodeId);
    if (node?.data?.node_type === "workflow_trigger") {
      toast({
        message: "The trigger starts the workflow and can't be deleted",
        variant: "warning",
      });
      return;
    }
    workflowObj.deleteConfirm = { show: true, nodeId };
  }
  function cancelDeleteNode() {
    workflowObj.deleteConfirm = { show: false, nodeId: "" };
  }

  function deleteNode(nodeId: string) {
    const wf = workflowObj.currentSelectedWorkflow;
    const node = wf.nodes.find((n: any) => n.id === nodeId);
    // The trigger anchors the workflow and can't be removed.
    if (node?.data?.node_type === "workflow_trigger") {
      toast({
        message: "The trigger starts the workflow and can't be deleted",
        variant: "warning",
      });
      return;
    }
    wf.nodes = wf.nodes.filter((n: any) => n.id !== nodeId);
    wf.edges = wf.edges.filter(
      (e: any) => e.source !== nodeId && e.target !== nodeId,
    );
    // The graph changed — prior Test badges are stale.
    workflowObj.testRun.result = null;
    if (workflowObj.currentSelectedNodeData?.id === nodeId) {
      workflowObj.currentSelectedNodeData = null;
      workflowObj.dialog.show = false;
    }
    workflowObj.deleteConfirm = { show: false, nodeId: "" };
    if (workflowObj.isEditWorkflow) workflowObj.dirtyFlag = true;
  }

  // Hover-`+` opens the step picker dialog anchored to this source + handle.
  function openStepPicker(sourceId: string, handle: string) {
    workflowObj.stepPicker = { show: true, source: sourceId, handle };
  }
  function closeStepPicker() {
    workflowObj.stepPicker = { show: false, source: "", handle: "out" };
  }

  // The node at the end of the chain (no outgoing edge) — the palette appends
  // after it. If the graph branches (multiple leaves), pick the bottom-most.
  function endNodeId(): string | undefined {
    const wf = workflowObj.currentSelectedWorkflow;
    const nodes = wf.nodes || [];
    if (!nodes.length) return undefined;
    const sources = new Set((wf.edges || []).map((e: any) => e.source));
    const leaves = nodes.filter((n: any) => !sources.has(n.id));
    const pool = leaves.length ? leaves : nodes;
    return pool.reduce((a: any, b: any) =>
      (b.position?.y ?? 0) > (a.position?.y ?? 0) ? b : a,
    ).id;
  }

  // A terminal node (output io_type, e.g. Destination) can't have children — the
  // chain ends there. Used to block appending past it from the palette / drop.
  function isTerminal(nodeId?: string): boolean {
    if (!nodeId) return false;
    const node = workflowObj.currentSelectedWorkflow.nodes.find(
      (n: any) => n.id === nodeId,
    );
    return nodeMeta(node?.data?.node_type)?.ioType === "output";
  }

  // Palette add: append a node after the chain's end node (stages + opens the
  // config drawer, same as the hover-`+`).
  function addNodeToEnd(nodeType: string) {
    const src = endNodeId();
    if (!src) return;
    if (isTerminal(src)) {
      toast({
        message: "This branch already ends in a Destination.",
        variant: "warning",
      });
      return;
    }
    addNodeAfter(src, "out", nodeType);
  }

  // ── Drag & drop (palette → canvas) ──────────────────────────────────────────
  function onDragStart(event: DragEvent, nodeType: string) {
    if (event.dataTransfer) {
      event.dataTransfer.setData("application/vueflow", nodeType);
      event.dataTransfer.effectAllowed = "move";
    }
    workflowObj.draggedNodeType = nodeType;
  }
  function onDragOver(event: DragEvent) {
    if (!workflowObj.draggedNodeType) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  }
  // Drop: stage the node AT the drop point and open its config drawer — committed
  // on Save. Unlike the palette-click / hover-`+` add, a dragged-and-dropped node
  // is placed UNCONNECTED (no auto-edge); the user wires it manually, same as the
  // pipeline canvas. (Palette click still appends+wires via addNodeToEnd.)
  function onDrop(event: DragEvent) {
    const nodeType =
      workflowObj.draggedNodeType ||
      event.dataTransfer?.getData("application/vueflow") ||
      "";
    workflowObj.draggedNodeType = "";
    const meta = nodeMeta(nodeType);
    if (!meta) return;

    const flow = screenToFlowCoordinate({ x: event.clientX, y: event.clientY });
    // Roughly center the node on the cursor (half a node card).
    const position = { x: flow.x - 120, y: flow.y - 26 };

    const id = getUUID();
    workflowObj.currentSelectedNodeData = {
      id,
      type: meta.ioType,
      position,
      data: { label: id, node_type: nodeType },
    };
    // No auto-wire on drag-drop — the node is placed where dropped and stays
    // unconnected until the user draws an edge.
    workflowObj.pendingEdge = null;
    workflowObj.currentSelectedNodeID = id;
    workflowObj.isEditNode = false;
    workflowObj.dialog.name = nodeType;
    workflowObj.dialog.expand = false;
    workflowObj.dialog.show = true;
  }

  // Hover-`+` add: STAGE a node below `sourceId` and open its config drawer. The
  // node is NOT added to the canvas here — it's committed (added + auto-wired)
  // only when the drawer is saved (commitNode), or discarded on cancel
  // (cancelNodeDrawer). Pipeline pattern. `handle` is always "out" (the single
  // output; the Condition is a filter, not a true/false branch).
  const NODE_W = 240;
  function addNodeAfter(sourceId: string, handle: string, nodeType: string) {
    const wf = workflowObj.currentSelectedWorkflow;
    const src = wf.nodes.find((n: any) => n.id === sourceId);
    const meta = nodeMeta(nodeType);
    if (!src || !meta) return;

    const id = getUUID();
    const sourceHandle = handle === "out" ? undefined : handle;
    // Offset siblings on the same output so they don't overlap (fan-out).
    const siblings = wf.edges.filter(
      (e: any) =>
        e.source === sourceId && (e.sourceHandle || undefined) === sourceHandle,
    ).length;
    const position = {
      x: (src.position?.x ?? 0) + siblings * (NODE_W + 40),
      y: (src.position?.y ?? 0) + 160,
    };

    workflowObj.currentSelectedNodeData = {
      id,
      // VueFlow render template (UI only) — derived from node_type, not stored.
      type: meta.ioType,
      position,
      data: { label: id, node_type: nodeType },
    };
    workflowObj.pendingEdge = { source: sourceId, sourceHandle };
    workflowObj.currentSelectedNodeID = id;
    workflowObj.isEditNode = false;
    workflowObj.dialog.name = nodeType;
    workflowObj.dialog.expand = false;
    workflowObj.dialog.show = true;
  }

  // Drawer Save: merge the form payload, then either update the existing node
  // (edit) or commit the staged node + its auto-wired edge (add).
  function commitNode(payload: any = {}) {
    const wf = workflowObj.currentSelectedWorkflow;
    const node = workflowObj.currentSelectedNodeData;
    if (!node) return;
    node.data = { ...node.data, ...payload };

    if (workflowObj.isEditNode) {
      const idx = wf.nodes.findIndex((n: any) => n.id === node.id);
      if (idx !== -1) wf.nodes[idx] = node;
    } else {
      wf.nodes = [...wf.nodes, node];
      if (workflowObj.pendingEdge) {
        wf.edges = [
          ...wf.edges,
          newEdge(
            workflowObj.pendingEdge.source,
            node.id,
            workflowObj.pendingEdge.sourceHandle,
          ),
        ];
      }
    }
    workflowObj.pendingEdge = null;
    workflowObj.isEditNode = false;
    workflowObj.dialog.expand = false;
    workflowObj.dialog.show = false;
    // The graph changed — prior Test badges are stale.
    workflowObj.testRun.result = null;
    if (workflowObj.isEditWorkflow) workflowObj.dirtyFlag = true;
  }

  // Drawer Cancel: discard a staged (not-yet-added) node; leave existing nodes
  // untouched.
  function cancelNodeDrawer() {
    workflowObj.pendingEdge = null;
    workflowObj.currentSelectedNodeData = null;
    workflowObj.currentSelectedNodeID = "";
    workflowObj.isEditNode = false;
    workflowObj.dialog.expand = false;
    workflowObj.dialog.show = false;
  }

  // Open an existing node's config drawer.
  function editNode(nodeId: string) {
    const node = workflowObj.currentSelectedWorkflow.nodes.find(
      (n: any) => n.id === nodeId,
    );
    if (!node) return;
    workflowObj.isEditNode = true;
    workflowObj.pendingEdge = null;
    workflowObj.currentSelectedNodeData = node;
    workflowObj.currentSelectedNodeID = nodeId;
    workflowObj.dialog.name = node.data.node_type;
    workflowObj.dialog.show = true;
  }

  function resetWorkflowData() {
    workflowObj.currentSelectedWorkflow = JSON.parse(
      JSON.stringify(defaultWorkflow),
    );
    workflowObj.workflowWithoutChange = JSON.parse(
      JSON.stringify(defaultWorkflow),
    );
    workflowObj.currentSelectedNodeData = null;
    workflowObj.currentSelectedNodeID = "";
    workflowObj.dialog = { ...defaultDialog };
    workflowObj.stepPicker = { show: false, source: "", handle: "out" };
    workflowObj.isEditWorkflow = false;
    workflowObj.isEditNode = false;
    workflowObj.dirtyFlag = false;
    workflowObj.nodesChange = false;
    workflowObj.edgesChange = false;
    // The singleton is shared between the editor and the read-only Runs view;
    // clear every transient flag so none leaks into the next open.
    workflowObj.readOnly = false;
    workflowObj.pendingEdge = null;
    workflowObj.nameError = false;
    workflowObj.nameErrorMessage = "";
    workflowObj.deleteConfirm = { show: false, nodeId: "" };
    workflowObj.testRun = {
      show: false,
      input: "",
      fromNode: "",
      result: null,
      resultDrawer: { show: false, nodeId: "" },
    };
  }

  return {
    workflowObj,
    // vue-flow events
    onNodeChange,
    onNodesChange,
    onEdgesChange,
    onConnect,
    validateConnection,
    // node ops
    openStepPicker,
    closeStepPicker,
    addNodeAfter,
    addNodeToEnd,
    endNodeId,
    onDragStart,
    onDragOver,
    onDrop,
    commitNode,
    cancelNodeDrawer,
    editNode,
    requestDeleteNode,
    cancelDeleteNode,
    deleteNode,
    resetWorkflowData,
    // helpers (exported for the StepMenu slice + tests)
    detectCycle,
    newEdge,
    // vue-flow instance passthroughs
    screenToFlowCoordinate,
    onNodesInitialized,
    updateNode,
  };
}

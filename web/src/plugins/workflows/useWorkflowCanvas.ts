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
// Differences from the pipeline version (FD1/FD2):
//   - NO node sidebar / drag-from-palette. Nodes are added programmatically via
//     the hover-`+` StepMenu (addNodeAfter, wired in a later slice), so all the
//     onDragStart/onDragOver/onDrop machinery is removed.
//   - Restricted, colour-coded node taxonomy (trigger / logic / action).
//   - Cycle + single-incoming validation use edge.source/target strings
//     (always present) instead of VueFlow's runtime sourceNode/targetNode.
//
// State is a module-level reactive singleton (same pattern as pipelineObj) so
// the editor, canvas, nodes and node-forms all share one object.

import { reactive } from "vue";
import { MarkerType, useVueFlow } from "@vue-flow/core";
import { getUUID } from "@/utils/zincutils";
import { toast } from "@/lib/feedback/Toast/useToast";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import { detectCycle } from "@/composables/flow/detectCycle";
import { makeEdge } from "@/composables/flow/makeEdge";

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
  /** OIcon registry name for the node's glyph. */
  icon: IconName;
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
    ioType: "input",
  },
  condition: {
    category: "logic",
    kindKey: "workflow.node.kindLogic",
    titleKey: "workflow.node.condition",
    descKey: "workflow.node.conditionDesc",
    icon: "alt-route",
    ioType: "default",
  },
  function: {
    category: "logic",
    kindKey: "workflow.node.kindLogic",
    titleKey: "workflow.node.function",
    descKey: "workflow.node.functionDesc",
    icon: "code",
    ioType: "default",
  },
  // Serialized node_type is `destination` — the backend NodeData::Destination
  // ({ destination_id, template_override }), where `destination_id` is the
  // Pipeline (remote) Destination's NAME. Added to `is_workflow_node()` (commit
  // "feat: add destination as a workflow node"); save-time validation checks the
  // destination exists and `is_pipeline_destination()`.
  //
  // `ioType: "output"` — the destination is a terminal *leaf* (green, no output
  // handle / hover-`+`).
  destination: {
    category: "action",
    kindKey: "workflow.node.kindAction",
    titleKey: "workflow.node.sendToDestination",
    descKey: "workflow.node.destinationDesc",
    icon: "share",
    ioType: "output",
  },
};

export const nodeMeta = (nodeType: string): WorkflowNodeMeta | undefined =>
  WORKFLOW_NODE_TYPES[nodeType];

// Node types offered by the hover-`+` StepMenu (everything but the trigger,
// which is fixed and can only be the first node).
export const ADDABLE_NODE_TYPES = ["condition", "function", "destination"];

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

// Accent colour per category (hex mirrors the design tokens; used for handle /
// edge colouring where a raw value is needed).
export const categoryColor = (category?: WorkflowNodeCategory): string => {
  switch (category) {
    case "trigger":
      return "#e0891d"; // amber
    case "logic":
      return "#4f6bed"; // blue / indigo
    case "action":
      return "#1f9d63"; // green
    default:
      return "#6b7280";
  }
};

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
  // run outcome — `{ errors: {nodeId: NodeErrors}, ranNodeIds: string[] }` — read
  // by each WorkflowNode to render its ✓ / error badge on the canvas. `progress`
  // drives the staged reveal after a run — `{ order: string[], index: number }` —
  // so nodes light up one-by-one down the graph instead of all at once (the API
  // is a fast batch; the stagger makes the run feel live). Null when idle/settled.
  testRun: {
    show: false,
    input: "",
    // "" = run from the beginning (trigger); a node id runs from that node down.
    // Kept as "" (falsy) so consumers just check `!fromNode`. The Run-From select
    // maps "" to a display sentinel locally (see WorkflowTestDialog) — the
    // sentinel never lands here or on the API payload.
    fromNode: "",
    result: <any>null,
    progress: <any>null,
  },
  currentSelectedWorkflow: <any>JSON.parse(JSON.stringify(defaultWorkflow)),
  workflowWithoutChange: <any>JSON.parse(JSON.stringify(defaultWorkflow)),
  nameError: false,
  nameErrorMessage: "",
};

const workflowObj = reactive(Object.assign({}, defaultObject));

export { workflowObj };

// ── Test-result staged playback ─────────────────────────────────────────────
// The Test API is a fast batch, so revealing every node's status at once feels
// like nothing ran. Instead we walk the ran nodes in graph order and settle each
// one after a short beat — a "running" spinner on the current step, ✓/✗ on the
// ones behind it — so the run reads as flowing through the workflow.
let playbackTimer: any = null;
const PLAYBACK_STEP_MS = 450;

export const stopTestPlayback = () => {
  if (playbackTimer) {
    clearTimeout(playbackTimer);
    playbackTimer = null;
  }
  workflowObj.testRun.progress = null;
};

// Reveal order for the ran nodes. Workflows enforce one incoming edge per node
// (see onConnect), so the graph is a TREE rooted at the trigger (or from_node) —
// a plain BFS from the root visits every parent before its children, which is all
// the reveal needs. (No topo sort: reconvergence, the only shape BFS gets wrong,
// can't exist in a tree.)
// ── Shared graph helpers (used by the reveal here + the Test dialog) ─────────
// Children adjacency map from edges (handles both {source,target} and
// {sourceNode,targetNode} edge shapes).
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

// `startIds` + everything downstream of them.
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

// Reveal order = the flow order (from the run's start node) filtered to the
// nodes that actually ran.
const orderedRunNodes = (ranNodeIds: string[]): string[] => {
  const wf = workflowObj.currentSelectedWorkflow;
  const ran = new Set(ranNodeIds);
  const ordered = flowOrderedNodeIds(
    wf.nodes || [],
    wf.edges || [],
    workflowObj.testRun.fromNode || undefined,
  ).filter((id) => ran.has(id));
  // safety: any ran id the traversal didn't cover still resolves
  for (const id of ranNodeIds) if (!ordered.includes(id)) ordered.push(id);
  return ordered;
};

// Stash the result, then advance `progress.index` down the ordered nodes.
export const startTestPlayback = (result: {
  errors: Record<string, any>;
  ranNodeIds: string[];
  blockedNodeIds?: string[];
}) => {
  stopTestPlayback();
  workflowObj.testRun.result = result;
  const order = orderedRunNodes(result.ranNodeIds);
  if (!order.length) return;
  workflowObj.testRun.progress = { order, index: 0 };
  const step = () => {
    const p = workflowObj.testRun.progress;
    if (!p) return;
    if (p.index >= p.order.length - 1) {
      workflowObj.testRun.progress = null; // last node settled → all badges final
      playbackTimer = null;
      return;
    }
    p.index += 1;
    playbackTimer = setTimeout(step, PLAYBACK_STEP_MS);
  };
  // brief beat so the popup close settles before the first step lights up
  playbackTimer = setTimeout(step, 300);
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
  const edges = (wf.edges || []).map((e: any) => ({
    ...e,
    type: "custom",
    markerEnd: { type: MarkerType.ArrowClosed, width: 20, height: 20 },
    style: { strokeWidth: 2 },
    animated: true,
  }));
  workflowObj.currentSelectedWorkflow = { ...wf, nodes, edges };
  workflowObj.workflowWithoutChange = JSON.parse(JSON.stringify(wf));
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
    if (workflowObj.isEditWorkflow) workflowObj.dirtyFlag = true;
    if (changes.length > 0) workflowObj.edgesChange = true;
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
    // The graph changed — prior Test badges (and any in-flight reveal) are stale.
    stopTestPlayback();
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
    // The graph changed — prior Test badges (and any in-flight reveal) are stale.
    stopTestPlayback();
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
    stopTestPlayback();
    workflowObj.testRun = {
      show: false,
      input: "",
      fromNode: "",
      result: null,
      progress: null,
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

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
import { DEFAULT_TRIGGER_KIND } from "./triggers";
import workflowService from "@/services/workflows";
import type { I18nKey } from "@/types/i18n";
import type { TranslateFn } from "@/types/i18n";

export type WorkflowNodeCategory = "trigger" | "logic" | "action";

export interface WorkflowNodeMeta {
  /** Colour/behaviour family. */
  category: WorkflowNodeCategory;
  /** Small uppercase label above the title (i18n key). */
  kindKey: I18nKey;
  /** Node title (i18n key). */
  titleKey: I18nKey;
  /** Short description (i18n key), shown in the step picker. */
  descKey: I18nKey;
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
    titleKey: "workflow.triggerKind.alertFired.node",
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

// Node types offered by the step picker when extending a node (everything but
// the triggers, which can only ever be the FIRST node).
export const ADDABLE_NODE_TYPES = ["condition", "function", "destination"];

// Node types offered by the empty-canvas start node. One today; the list is the
// seam where further trigger kinds land, and the picker already handles n of
// them — which is why the start node is a picker and not a fixed seeded node.
export const TRIGGER_NODE_TYPES = ["workflow_trigger"];

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

// Trigger kinds live in the registry (./triggers) — the single place a kind is
// described. Re-exported here so canvas consumers keep one import surface.
export {
  WORKFLOW_TRIGGERS,
  DEFAULT_TRIGGER_KIND,
  triggerDef,
  triggerTypeForKind,
  enabledTriggers,
  buildTriggerSampleText,
} from "./triggers";
export type { WorkflowTriggerDef } from "./triggers";

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
  // True while this is an unpublished draft (persisted via the drafts table,
  // skips graph validation). Flips to false once promoted/published. A brand-new
  // workflow starts false — it's neither a saved draft nor a published workflow
  // until the first Save-as-Draft / Publish.
  isDraft: false,
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
  // Insert-on-edge (T7): the edge to SPLICE when the staged node commits — the old
  // edge A→B is removed and A→new + new→B are created.
  pendingInsert: <any>null,
  dialog: { ...defaultDialog },
  // Step picker (the searchable "add next step" popover). Clicking a node's
  // source handle opens it with that node + handle; picking a type calls
  // addNodeAfter. `anchor` is the click point in viewport coords, so the
  // popover opens at the handle instead of centred on screen.
  // `mode` is "next" when extending a node (source + handle carry the parent)
  // and "trigger" when the empty-canvas start node was clicked, where there is
  // no parent and `position` carries where to place the first node instead.
  stepPicker: {
    show: false,
    source: "",
    handle: "out",
    mode: "next" as "next" | "trigger" | "insert",
    // "insert" mode splices onto this edge (A→B becomes A→new→B on commit).
    edgeId: "",
    position: null as { x: number; y: number } | null,
    anchor: null as { x: number; y: number } | null,
  },
  // Node rail open/closed. Lives here because the toggle sits in the canvas's
  // control stack (WorkflowCanvas) while the rail is rendered by the editor.
  // Starts CLOSED so the canvas gets the full width on open.
  showNodePalette: false,
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

// ── Dirty tracking (T8) ──────────────────────────────────────────────────────
// Mark the graph unsaved. Gated ONLY on `readOnly` (the Runs inspection canvas),
// so — unlike the old `isEditWorkflow` gate — a brand-new CREATE-mode workflow
// and node moves/renames count too. The route-leave + beforeunload guards in the
// editor read `dirtyFlag`; it starts false on load and is cleared after Save.
export const markWorkflowDirty = () => {
  if (!workflowObj.readOnly) workflowObj.dirtyFlag = true;
};

// ── Undo history (T1) ────────────────────────────────────────────────────────
// Snapshots of { nodes, edges } captured BEFORE each structural mutation, so an
// undo restores the graph exactly as it was (nodes AND their edges). Module-level
// (shared across the editor's component instances) and capped so a long build
// session can't grow it unbounded. Redo is keyboard-only (product decision), but
// the `future` stack backs it for free.
const HISTORY_LIMIT = 50;
export const workflowHistory = reactive<{ past: any[]; future: any[] }>({
  past: [],
  future: [],
});
const cloneGraph = () => ({
  nodes: JSON.parse(JSON.stringify(workflowObj.currentSelectedWorkflow.nodes || [])),
  edges: JSON.parse(JSON.stringify(workflowObj.currentSelectedWorkflow.edges || [])),
});
// Snapshot the CURRENT graph before a mutation. A new edit forks history, so the
// redo stack is cleared. No-op on the read-only canvas.
export const pushWorkflowHistory = () => {
  if (workflowObj.readOnly) return;
  workflowHistory.past.push(cloneGraph());
  if (workflowHistory.past.length > HISTORY_LIMIT) workflowHistory.past.shift();
  workflowHistory.future = [];
};
const applyGraphSnapshot = (snap: { nodes: any[]; edges: any[] }) => {
  // Reassign whole arrays so VueFlow's v-model picks up the restore.
  workflowObj.currentSelectedWorkflow.nodes = snap.nodes;
  workflowObj.currentSelectedWorkflow.edges = snap.edges;
  // The Test log deliberately PERSISTS across graph edits: it's cleared
  // only by a new run or the explicit "Clear" button. A step this undo/redo removed
  // stays listed struck-through (from the run-time snapshot). See executeTestRun.
};
export const undoWorkflow = () => {
  if (!workflowHistory.past.length) return;
  const prev = workflowHistory.past.pop();
  workflowHistory.future.push(cloneGraph());
  applyGraphSnapshot(prev);
  markWorkflowDirty();
};
export const redoWorkflow = () => {
  if (!workflowHistory.future.length) return;
  const next = workflowHistory.future.pop();
  workflowHistory.past.push(cloneGraph());
  applyGraphSnapshot(next);
  markWorkflowDirty();
};
export const resetWorkflowHistory = () => {
  workflowHistory.past = [];
  workflowHistory.future = [];
};

// ── Per-node metadata (T2 rename / T3 comment / T6 disable) ───────────────────
// All three live in node.meta (Record<string,string>) so they round-trip through
// serializeNode. Each marks the graph dirty; rename/comment are cheap live edits
// (no history entry), while a disable toggle pushes one undo snapshot.
const findWorkflowNode = (nodeId: string) =>
  (workflowObj.currentSelectedWorkflow.nodes || []).find((n: any) => n.id === nodeId);

// A node's display name (empty when never set → the card falls back to its
// config-derived label).
export const nodeCustomName = (node: any): string => node?.meta?.label || "";
export const nodeComment = (node: any): string => node?.meta?.comment || "";
// Disabled flag (T6) lives at the NODE ROOT as a boolean `is_disabled` (sibling of
// `meta`), so serializeNode sends it there. Accepts the string form too for any
// payload that round-tripped it as text.
export const isNodeDisabled = (node: any): boolean =>
  node?.is_disabled === true || node?.is_disabled === "true";

// Write meta on a node reference (staged or already on the canvas). Empty values
// drop the key so an unnamed/uncommented node serializes clean.
const setNodeMeta = (node: any, key: string, value: string) => {
  if (!node) return;
  const meta = { ...(node.meta || {}) };
  if (value) meta[key] = value;
  else delete meta[key];
  node.meta = meta;
  markWorkflowDirty();
};
export const setNodeName = (node: any, name: string) =>
  setNodeMeta(node, "label", (name || "").trim());
export const setNodeComment = (node: any, text: string) => setNodeMeta(node, "comment", text || "");

// Placeholder / "Configure Later" flag — a node the user saved without finishing
// (today: a Destination with no destination selected). Stored in `meta.incomplete`
// so it round-trips via serializeNode. Draft save allows it; Publish blocks it
// (see WorkflowEditor.validate); Test lets the backend error on it.
export const isNodeIncomplete = (node: any): boolean => node?.meta?.incomplete === "true";
export const setNodeIncomplete = (node: any, incomplete: boolean) =>
  setNodeMeta(node, "incomplete", incomplete ? "true" : "");

export const toggleNodeDisabled = (nodeId: string) => {
  const node = findWorkflowNode(nodeId);
  if (!node || workflowObj.readOnly) return;
  pushWorkflowHistory();
  // Root-level boolean (sibling of `meta`) — see serializeNode / isNodeDisabled.
  node.is_disabled = !isNodeDisabled(node);
  // The Test log persists; a now-disabled step stays listed
  // struck-through rather than clearing the whole run. See executeTestRun.
  markWorkflowDirty();
};

// ── Auto-layout / Tidy up (T9) ────────────────────────────────────────────────
const TIDY_COL = 300; // per-column horizontal spacing (node ~240 + gap)
const TIDY_ROW = 160; // vertical gap between depths (matches addNodeAfter)
const TIDY_NODE_W = 240; // fallback node width when the real one isn't measured yet
// Re-arrange the graph into a clean top-down tree. The workflow graph is a strict
// single-incoming tree (enforced in onConnect), so positions compute directly:
// depth from the trigger → y, sibling slot → column CENTRE, each parent centred
// over its children — no layout library needed. Node positions are LEFT-edge, so
// a node is centred on its column by subtracting half its (measured) width; that's
// why `getWidth` is passed in — without it a wide parent and a narrow child would
// left-align and look off-centre. Pushes one undo snapshot (single Ctrl+Z revert).
// Orphans (unreachable from the trigger, mid-build) stack in a trailing column.
export const tidyWorkflowLayout = (getWidth?: (id: string) => number | undefined): boolean => {
  const wf = workflowObj.currentSelectedWorkflow;
  const nodes = wf.nodes || [];
  if (nodes.length <= 1 || workflowObj.readOnly) return false;
  pushWorkflowHistory();
  const children = buildChildrenMap(wf.edges || []);
  const trigger = nodes.find((n: any) => n.data?.node_type === "workflow_trigger");
  const rootId = trigger?.id || nodes[0]?.id;
  // Column CENTRE x + depth for each node; converted to a left-edge position below.
  const centerX = new Map<string, number>();
  const depthOf = new Map<string, number>();
  const visited = new Set<string>();
  let nextSlot = 0;
  const layout = (id: string, depth: number): number => {
    visited.add(id);
    depthOf.set(id, depth);
    const kids = (children.get(id) ?? []).filter((k) => !visited.has(k));
    let cx: number;
    if (!kids.length) {
      cx = nextSlot * TIDY_COL;
      nextSlot++;
    } else {
      const cs = kids.map((k) => layout(k, depth + 1));
      cx = (cs[0] + cs[cs.length - 1]) / 2; // centre the parent over its children
    }
    centerX.set(id, cx);
    return cx;
  };
  if (rootId) layout(rootId, 0);
  // Orphan subtrees (unreachable from the trigger — e.g. a node just dragged in, or
  // a chain built before it's wired to the trigger). Lay each subtree ROOT out with
  // the SAME recursive tree layout so a connected orphan chain keeps its parent→child
  // order and depth, each in its own trailing columns. (The old code stacked every
  // orphan node in ONE column ordered by array index, which reversed connected pairs
  // like Condition→Function and overlapped separate orphans.)
  const hasParent = new Set<string>();
  for (const kids of children.values()) for (const k of kids) hasParent.add(k);
  for (const n of nodes) {
    // A subtree root is an unplaced node with no parent; layout() recurses into its
    // children, so deeper orphan nodes are placed by that call, not this loop.
    if (!visited.has(n.id) && !hasParent.has(n.id)) layout(n.id, 0);
  }
  // Safety net: place anything still unvisited (e.g. an orphan cycle) on its own.
  for (const n of nodes) if (!visited.has(n.id)) layout(n.id, 0);
  // Convert centre-x → left-edge position using each node's real (measured) width
  // so cards line up on their centres, not their left edges.
  wf.nodes = nodes.map((n: any) => {
    const cx = centerX.get(n.id);
    if (cx == null) return n;
    const w = getWidth?.(n.id) || TIDY_NODE_W;
    return { ...n, position: { x: cx - w / 2, y: (depthOf.get(n.id) ?? 0) * TIDY_ROW } };
  });
  markWorkflowDirty();
  return true;
};

// The kind of the current graph's trigger node — the single lookup other pieces
// (payload reference, condition fields, function sample) use to stay in sync
// with whatever trigger the workflow starts from. Returns undefined when there
// is NO trigger node (e.g. it was deleted): callers then show nothing rather
// than defaulting to a kind that isn't there. The kind lives in
// `data.trigger_kind` (fresh) or `meta.trigger_kind` (rehydrated from the API).
export const currentTriggerKind = (): string | undefined => {
  const trigger = (workflowObj.currentSelectedWorkflow?.nodes || []).find(
    (n: any) => n.data?.node_type === "workflow_trigger",
  );
  return trigger?.data?.trigger_kind || trigger?.meta?.trigger_kind;
};

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
export const flowOrderedNodeIds = (nodes: any[], edges: any[], startId?: string): string[] => {
  const children = buildChildrenMap(edges);
  const start =
    startId || (nodes || []).find((n: any) => n.data?.node_type === "workflow_trigger")?.id;
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

// A step in the executed-steps TREE (results dock). Carries the render structure —
// depth, direct-child count, and per-column "does this rail continue" flags — so
// the panel draws the traces-waterfall connector lines without re-deriving them.
export interface StepTreeNode {
  id: string;
  depth: number;
  childCount: number;
  // One flag per depth column: does the rail at that column continue below this
  // row (ancestor / this node has a following sibling)? The last entry is this
  // node's own continuation, which picks its elbow shape (└ vs ├).
  guides: boolean[];
}

// Build the ran nodes as a DFS PRE-ORDER tree (children immediately follow their
// parent so the connector rails line up). Siblings are ordered by canvas position
// (top-to-bottom, then left-to-right). `ranIds` bounds the walk to nodes that
// actually ran; unreached ran nodes (orphans / a replay's from-node) start their
// own subtree in flow order. Structure only — labels/status are resolved by the
// caller — so it's reusable for both the live-run snapshot and the history view.
export const buildStepTree = (nodes: any[], edges: any[], ranIds: string[]): StepTreeNode[] => {
  const ran = new Set<string>(ranIds);
  if (!ran.size || !(nodes || []).length) return [];
  const byId = new Map<string, any>((nodes || []).map((n: any) => [n.id, n]));
  const kidsOf: Record<string, string[]> = {};
  for (const e of edges || []) (kidsOf[e.source] ||= []).push(e.target);
  const sortKids = (ids: string[]) =>
    ids
      .filter((c) => ran.has(c) && byId.has(c))
      .sort((a, b) => {
        const na = byId.get(a);
        const nb = byId.get(b);
        return (
          (na?.position?.y ?? 0) - (nb?.position?.y ?? 0) ||
          (na?.position?.x ?? 0) - (nb?.position?.x ?? 0)
        );
      });

  const rows: StepTreeNode[] = [];
  const seen = new Set<string>();
  const visit = (id: string, depth: number, guides: boolean[]) => {
    if (seen.has(id)) return; // cycle / diamond guard
    seen.add(id);
    const kids = sortKids(kidsOf[id] || []);
    rows.push({ id, depth, childCount: kids.length, guides });
    kids.forEach((c, idx) => visit(c, depth + 1, [...guides, idx < kids.length - 1]));
  };
  // Start from each unvisited ran node in flow order — the first is the run's root
  // (trigger or replay from-node); any remainder are orphans.
  for (const id of flowOrderedNodeIds(nodes, edges).filter((id) => ran.has(id)))
    if (!seen.has(id)) visit(id, 0, []);
  return rows;
};

// `startIds` + everything downstream of them (a Set; the starts are included).
//
// Example — for Trigger(t) → Function(f) → Destination(d):
//   reachableFrom(edges, ["f"])   => Set { "f", "d" }   // "f" and downstream
//   reachableFrom(edges, ["t"])   => Set { "t", "f", "d" }
export const reachableFrom = (edges: any[], startIds: string[]): Set<string> => {
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
  const set = reachableFrom(workflowObj.currentSelectedWorkflow.edges || [], errorIds);
  for (const id of errorIds) set.delete(id);
  return [...set];
};

// Serialize one in-memory VueFlow node down to the fields the backend `Node`
// struct persists: id, io_type, position, data, and (when present) meta / style.
// Everything else on the node is VueFlow runtime state (`type`, `dimensions`,
// `handleBounds`, `computedPosition`, `selected`, `dragging`, …) and is dropped.
//
// `io_type` is derived from `node_type` (via `node.type`, the VueFlow render
// template) — the backend `Node` struct requires it (matches the pipeline
// payload); it isn't a source of truth.
const serializeNode = (node: any) => {
  const nodeType = node?.data?.node_type;
  const data = { ...(node.data || {}) };
  const meta: Record<string, string> = { ...(node.meta || {}) };

  // Trigger: NodeData::WorkflowTrigger is a unit variant, so its kind can't live
  // in `data`; carry it in `meta` (strings survive serialization).
  if (nodeType === "workflow_trigger") {
    meta.trigger_kind = data.trigger_kind || DEFAULT_TRIGGER_KIND;
  }

  const out: any = {
    id: node.id,
    io_type: node.type || "default",
    position: {
      x: node.position?.x ?? 0,
      y: node.position?.y ?? 0,
    },
    data,
    // Disabled flag (T6) sits at the NODE ROOT (sibling of `meta`), as a real
    // boolean — always sent so the backend can skip a muted node on a run.
    is_disabled: node.is_disabled === true || node.is_disabled === "true",
  };
  if (Object.keys(meta).length) out.meta = meta;
  if (node.style) out.style = node.style;
  return out;
};

// Build the backend `Workflow` object from the current in-memory graph. Shared by
// the editor's create/update payload AND the Test run (which now sends the whole
// graph so it can run WITHOUT saving). The `Workflow` struct has no serde
// defaults, so every field must be present; org_id/id/created_by are
// overridden/generated by the backend (the test endpoint assigns a throwaway id).
export const serializeWorkflow = () => {
  const wf = workflowObj.currentSelectedWorkflow;
  return {
    id: wf.id || "",
    org_id: "",
    name: (wf.name || "").trim(),
    description: wf.description || "",
    enabled: wf.enabled ?? true,
    created_at: wf.created_at || 0,
    updated_at: wf.updated_at || 0,
    created_by: "",
    nodes: (wf.nodes || []).map(serializeNode),
    edges: wf.edges || [],
  };
};

// Run the workflow Test (from the Test dialog or a node's Replay button) and
// store the result so each WorkflowNode paints its ✓ / ✗ / ⊘ badge. Shared so
// both entry points behave identically. The whole in-memory graph is sent, so a
// workflow can be tested whether or not it's been saved. The backend returns
// errors only — the step drawer (error nodes only) derives its input/output from
// `errors`, so there's no per-node node_io to carry.
export const executeTestRun = async (opts: {
  orgId: string;
  inputs: any[];
  fromNode?: string;
}): Promise<{ ok: boolean; error?: string }> => {
  const wf = workflowObj.currentSelectedWorkflow;
  try {
    // Dry-run a DRAFT when the graph is a saved draft, has unsaved edits, or was
    // never persisted — the backend then skips the strict published validation.
    const draft = !!(wf.isDraft || workflowObj.dirtyFlag || !wf.id);
    const res = await workflowService.testWorkflow({
      org_identifier: opts.orgId,
      workflow: serializeWorkflow(),
      inputs: opts.inputs,
      from_node: opts.fromNode || undefined,
      draft,
    });
    const errors = res.data?.errors || {};
    // Per-node INPUT map: node_id -> the records that node received. A node's
    // OUTPUT is derived from this (see nodeTestOutputBranches): since the graph is
    // a single-incoming tree, a child's input IS its parent's output on that edge.
    const inputs = res.data?.inputs || {};
    // Which nodes ran: from a replay, `fromNode` + everything downstream;
    // otherwise everything reachable from the trigger. Nodes NOT reachable
    // (unwired / disconnected) never executed, so they must not paint a ✓.
    const triggerId = (wf.nodes || []).find(
      (n: any) => n.data?.node_type === "workflow_trigger",
    )?.id;
    const startId = opts.fromNode || triggerId;
    const ranNodeIds = startId ? [...reachableFrom(wf.edges || [], [startId])] : [];
    // Snapshot the executed-steps TREE at run time. The results dock now persists
    // across graph edits, so a step later deleted or disabled must still
    // render — with its frozen label/icon, struck-through. We freeze the tree shape
    // (depth + connector guides) plus each step's display data/meta here; the panel
    // resolves live label/status on top (reflecting a later rename) and falls back
    // to this frozen data for a removed node. History runs don't set this — the
    // panel rebuilds the tree from the live graph there. See WorkflowResultsPanel.
    const stepById = new Map<string, any>((wf.nodes || []).map((n: any) => [n.id, n]));
    const ranSteps = buildStepTree(wf.nodes || [], wf.edges || [], ranNodeIds).map((s) => {
      const n = stepById.get(s.id);
      return {
        ...s,
        data: n?.data ? { ...n.data } : undefined,
        meta: n?.meta ? { ...n.meta } : undefined,
      };
    });
    workflowObj.testRun.result = {
      errors,
      inputs,
      ranNodeIds,
      ranSteps,
      blockedNodeIds: downstreamOfErrorNodes(Object.keys(errors)),
    };
    return { ok: true };
  } catch (e: any) {
    // A failed run must not leave the previous run's ✓/✗ badges on screen.
    workflowObj.testRun.result = null;
    return { ok: false, error: e?.response?.data?.message };
  }
};

// A single downstream branch of a node's OUTPUT: the target it feeds and the
// records that target received (== what this node emitted on that edge). `records`
// is null when the target got nothing (filtered out / never reached).
export interface NodeOutputBranch {
  targetId: string;
  nodeType: string;
  detail: string;
  records: any[] | null;
}

// The INPUT a node received on the last Test run — the raw records from the
// backend `inputs` map (shape varies by node type; rendered as-is). Null when the
// node isn't in the map (0 records reached it) or there's no run.
export const nodeTestInput = (nodeId: string): any[] | null => {
  const inputs = workflowObj.testRun.result?.inputs;
  const v = inputs?.[nodeId];
  return Array.isArray(v) ? v : null;
};

// A node's OUTPUT, per outgoing edge. The graph is a single-incoming tree, so
// each child's input came ONLY from this node — child input == this node's output
// on that branch. One entry per outgoing edge (so fan-out reads per-target); an
// empty array means a terminal node (a destination/sink) with no derivable output.
export const nodeTestOutputBranches = (nodeId: string): NodeOutputBranch[] => {
  const wf = workflowObj.currentSelectedWorkflow;
  const byId = new Map<string, any>((wf.nodes || []).map((n: any) => [n.id, n]));
  return (wf.edges || [])
    .filter((e: any) => e.source === nodeId)
    .map((e: any) => {
      const target = byId.get(e.target);
      return {
        targetId: e.target,
        nodeType: target?.data?.node_type || "",
        detail: nodeConfigDetail(target?.data, 40),
        records: nodeTestInput(e.target),
      };
    });
};

// Load a PAST run (from the Executions history) into the same testRun.result the
// canvas already reads — read-only (no editable input / Replay). The run detail
// now mirrors the Test response shape, so history shows per-node Input/Output for
// EVERY node (not just error nodes):
//   errors.data:     [{ node_id, error: string[] }]  — errored nodes + messages
//   data.input_map:  { node_id: [records] }          — per-node INPUT (all nodes)
//   data.error_node_map:   { node_id: [records] }          — legacy: errored node's input
// input_map is the same per-node `inputs` map a Test run produces, so we store it
// under the same key and the whole drawer (Input + derived Output + badges) works
// identically to Test — just read-only. Falls back to error_node_map for older runs.
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
    const errList = Array.isArray(payload.errors?.data) ? payload.errors.data : [];
    const errors: Record<string, any> = {};
    for (const e of errList) {
      // Drop null/empty messages so a message-less error entry doesn't render
      // the literal string "undefined"/"null" as an error line.
      const msgs = (Array.isArray(e.error) ? e.error : [e.error]).filter(Boolean);
      errors[e.node_id] = {
        error_count: msgs.length,
        errors: msgs.map((m: string) => [m]),
      };
    }

    // Per-node INPUT for the whole run (all nodes) — the same shape/semantics as a
    // Test run's `inputs`, so the drawer derives Output the same way. Older runs
    // only carried error_node_map (errored node's input) — fall back to that.
    const inputs = payload.data?.input_map || payload.data?.error_node_map || {};

    // GHOST NODES — the run references a node the workflow no longer has (it was
    // edited/deleted after the run). Its badge has nowhere to render, so an error
    // would silently vanish and the run would look cleaner than it was. Surface
    // them so the Runs view can say the graph no longer matches this run.
    const currentNodeIds = new Set((wf.nodes || []).map((n: any) => n.id));
    const ghostNodeIds = [...new Set([...Object.keys(errors), ...Object.keys(inputs)])].filter(
      (id) => !currentNodeIds.has(id),
    );

    workflowObj.testRun.result = {
      errors,
      // Same per-node inputs map as a Test run — drives the ✓/grey/✗ badges and the
      // drawer's Input + derived Output for every node.
      inputs,
      ranNodeIds: (wf.nodes || []).map((n: any) => n.id),
      blockedNodeIds: downstreamOfErrorNodes(Object.keys(errors)),
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
        trigger_kind: node.meta.trigger_kind || node.data.trigger_kind || DEFAULT_TRIGGER_KIND,
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
  // List rows carry `is_draft`; normalize it onto the store's `isDraft` so the
  // editor knows to save via the draft endpoints and to offer Publish.
  workflowObj.currentSelectedWorkflow = { ...wf, nodes, edges, isDraft: !!wf.is_draft };
  // Snapshot the NORMALIZED graph (VueFlow type + styled edges), not raw `wf`,
  // so any cancel/restore or dirty-compare baseline matches what's on canvas.
  workflowObj.workflowWithoutChange = JSON.parse(
    JSON.stringify(workflowObj.currentSelectedWorkflow),
  );
  workflowObj.isEditWorkflow = true;
  // A freshly-loaded workflow is clean and carries no prior local edit history.
  workflowObj.dirtyFlag = false;
  resetWorkflowHistory();
};

export default function useWorkflowCanvas(t: TranslateFn) {
  const { screenToFlowCoordinate, onNodesInitialized, updateNode } = useVueFlow();

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
    // unsaved and wrongly force a Save-before-Test on the next run. `markWorkflowDirty`
    // itself no-ops on the read-only Runs canvas.
    const structural = changes.some((c: any) => c?.type === "add" || c?.type === "remove");
    if (structural) {
      workflowObj.edgesChange = true;
      markWorkflowDirty();
    }
  }

  // Dragging a node is a structural change too (T1/T8). Snapshot on drag START
  // (positions haven't moved yet, so undo restores the exact pre-drag layout) and
  // mark dirty on drag STOP. Both no-op on the read-only Runs canvas.
  function onNodeDragStart() {
    if (workflowObj.readOnly) return;
    pushWorkflowHistory();
  }
  function onNodeDragStop() {
    if (workflowObj.readOnly) return;
    markWorkflowDirty();
  }

  // Manual wiring (dragging between handles). Programmatic add uses addNodeAfter.
  function onConnect(connection: any) {
    const edges = workflowObj.currentSelectedWorkflow.edges;

    // one incoming edge per node
    if (edges.some((e: any) => e.target === connection.target)) {
      toast({
        message: t("toastMessages.workflows.onlyOneIncomingConnectionToA"),
        variant: "warning",
      });
      return;
    }

    if (detectCycle(edges, connection)) {
      toast({
        message: t("toastMessages.workflows.thisConnectionWouldCreateALoop"),
        variant: "warning",
      });
      return;
    }

    pushWorkflowHistory();
    workflowObj.currentSelectedWorkflow.edges = [
      ...edges,
      newEdge(connection.source, connection.target, connection.sourceHandle),
    ];
    markWorkflowDirty();
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
  // WorkflowEditor) rather than deleting outright. The trigger is deletable too:
  // removing it brings back the "Choose a Trigger" start node so the user can
  // pick a different kind. Any steps that followed it stay on the canvas (the
  // user reconnects them to the new trigger), the same as deleting a source in
  // the pipeline editor.
  function requestDeleteNode(nodeId: string) {
    workflowObj.deleteConfirm = { show: true, nodeId };
  }
  function cancelDeleteNode() {
    workflowObj.deleteConfirm = { show: false, nodeId: "" };
  }

  function deleteNode(nodeId: string) {
    const wf = workflowObj.currentSelectedWorkflow;
    // Snapshot BEFORE removal so one undo brings the node AND its edges back.
    pushWorkflowHistory();
    wf.nodes = wf.nodes.filter((n: any) => n.id !== nodeId);
    wf.edges = wf.edges.filter((e: any) => e.source !== nodeId && e.target !== nodeId);
    // The Test log PERSISTS: the deleted step stays listed in the dock,
    // struck-through, from the run-time snapshot (result.ranSteps). Its canvas badge
    // is gone with the node. Cleared only by a new run or the explicit Clear button.
    if (workflowObj.currentSelectedNodeData?.id === nodeId) {
      workflowObj.currentSelectedNodeData = null;
      workflowObj.dialog.show = false;
    }
    workflowObj.deleteConfirm = { show: false, nodeId: "" };
    markWorkflowDirty();
  }

  // Hover-`+` opens the step picker dialog anchored to this source + handle.
  function openStepPicker(sourceId: string, handle: string, event?: MouseEvent) {
    workflowObj.stepPicker = {
      show: true,
      source: sourceId,
      handle,
      mode: "next",
      edgeId: "",
      position: null,
      anchor: event ? { x: event.clientX, y: event.clientY } : null,
    };
  }

  // Insert-on-edge (T7): open the step picker to splice a node onto an existing
  // edge. Picking a type calls addNodeOnEdge, which stages the node and (on commit)
  // rewires A→new→B.
  function openInsertPicker(edge: any, event?: MouseEvent) {
    if (workflowObj.readOnly || !edge?.id) return;
    workflowObj.stepPicker = {
      show: true,
      source: edge.source,
      handle: "out",
      mode: "insert",
      edgeId: edge.id,
      position: null,
      anchor: event ? { x: event.clientX, y: event.clientY } : null,
    };
  }

  // The empty-canvas start node opens the SAME picker, restricted to triggers.
  // The click point becomes the node's position, so it lands where the
  // placeholder the user clicked was sitting.
  function openTriggerPicker(event: MouseEvent) {
    workflowObj.stepPicker = {
      show: true,
      source: "",
      handle: "out",
      mode: "trigger",
      edgeId: "",
      position: screenToFlowCoordinate({ x: event.clientX, y: event.clientY }),
      anchor: { x: event.clientX, y: event.clientY },
    };
  }

  function closeStepPicker() {
    workflowObj.stepPicker = {
      show: false,
      source: "",
      handle: "out",
      mode: "next",
      edgeId: "",
      position: null,
      anchor: null,
    };
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
    return pool.reduce((a: any, b: any) => ((b.position?.y ?? 0) > (a.position?.y ?? 0) ? b : a))
      .id;
  }

  // A terminal node (output io_type, e.g. Destination) can't have children — the
  // chain ends there. Used to block appending past it from the palette / drop.
  function isTerminal(nodeId?: string): boolean {
    if (!nodeId) return false;
    const node = workflowObj.currentSelectedWorkflow.nodes.find((n: any) => n.id === nodeId);
    return nodeMeta(node?.data?.node_type)?.ioType === "output";
  }

  // A workflow must BEGIN with a trigger — it's the only source, and the palette
  // holds none (triggers come from the empty-canvas start node). So every
  // palette add (click + drop) is blocked until a trigger exists; otherwise a
  // user who drags a step onto the empty canvas strands themselves with no
  // trigger and no way to add one (the start node only shows while empty).
  function hasTrigger(): boolean {
    return workflowObj.currentSelectedWorkflow.nodes.some(
      (n: any) => n.data?.node_type === "workflow_trigger",
    );
  }
  function warnTriggerFirst() {
    toast({
      message: t("toastMessages.workflows.chooseATriggerNodeToStart"),
      variant: "warning",
    });
  }

  // Palette add: append a node after the chain's end node (stages + opens the
  // config drawer, same as the hover-`+`).
  function addNodeToEnd(nodeType: string) {
    if (!hasTrigger()) {
      warnTriggerFirst();
      return;
    }
    const src = endNodeId();
    if (!src) return;
    if (isTerminal(src)) {
      toast({
        message: t("toastMessages.workflows.thisBranchAlreadyEndsInA"),
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
      workflowObj.draggedNodeType || event.dataTransfer?.getData("application/vueflow") || "";
    workflowObj.draggedNodeType = "";
    const meta = nodeMeta(nodeType);
    if (!meta) return;

    // Trigger-first: a dropped step before any trigger exists would be a
    // dead-end (see hasTrigger). Block it and point the user at the start node.
    if (!hasTrigger()) {
      warnTriggerFirst();
      return;
    }

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
  // Start node picked: ADD the workflow's first (trigger) node to the canvas and
  // open its panel.
  //
  // Committed immediately rather than staged (the addNodeAfter / onDrop
  // pattern): a staged node only lands via commitNode, which runs from the
  // drawer's Save — and the trigger panel is a READ-ONLY payload reference with
  // no footer and no Save (WorkflowNodeDrawer's `readonlyBody`). Staged, it
  // could never be committed, so the node never appeared on the canvas.
  //
  // `triggerKind` maps to the backend WorkflowTriggerKind; the node type stays
  // "workflow_trigger" for all kinds.
  function addTriggerNode(
    nodeType: string,
    triggerKind: string,
    position: { x: number; y: number } | null,
  ) {
    const meta = nodeMeta(nodeType);
    if (!meta) return;

    // Placing the trigger is a real add — snapshot before, mark dirty after, so
    // it's undoable and the unsaved guard catches a just-started workflow.
    pushWorkflowHistory();
    const id = getUUID();
    workflowObj.currentSelectedWorkflow.nodes = [
      ...workflowObj.currentSelectedWorkflow.nodes,
      {
        id,
        type: meta.ioType,
        position: position ?? { x: 320, y: 80 },
        data: {
          label: id,
          node_type: nodeType,
          trigger_kind: triggerKind,
          alert_ids: [],
        },
      },
    ];
    markWorkflowDirty();
    // Don't auto-open the trigger's (read-only) detail panel — placing the trigger
    // shouldn't interrupt the build flow. The user can click the node to open it.
  }

  const NODE_W = 240;
  // Vertical gap between a node and the next row (matches addNodeAfter / tidy).
  const INSERT_ROW_GAP = 160;
  function addNodeAfter(sourceId: string, handle: string, nodeType: string) {
    const wf = workflowObj.currentSelectedWorkflow;
    const src = wf.nodes.find((n: any) => n.id === sourceId);
    const meta = nodeMeta(nodeType);
    if (!src || !meta) return;

    const id = getUUID();
    const sourceHandle = handle === "out" ? undefined : handle;
    // Offset siblings on the same output so they don't overlap (fan-out).
    const siblings = wf.edges.filter(
      (e: any) => e.source === sourceId && (e.sourceHandle || undefined) === sourceHandle,
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
    workflowObj.pendingInsert = null;
    workflowObj.currentSelectedNodeID = id;
    workflowObj.isEditNode = false;
    workflowObj.dialog.name = nodeType;
    workflowObj.dialog.expand = false;
    workflowObj.dialog.show = true;
  }

  // Insert-on-edge (T7): STAGE a node to be spliced onto edge A→B. On commit the
  // old edge is removed and A→new + new→B are created (see commitNode). The node is
  // positioned at the midpoint of A and B; B is nudged down so it doesn't overlap.
  function addNodeOnEdge(edgeId: string, nodeType: string) {
    const wf = workflowObj.currentSelectedWorkflow;
    const edge = (wf.edges || []).find((e: any) => e.id === edgeId);
    const meta = nodeMeta(nodeType);
    if (!edge || !meta) return;
    const src = wf.nodes.find((n: any) => n.id === edge.source);
    const tgt = wf.nodes.find((n: any) => n.id === edge.target);
    if (!src || !tgt) return;

    const id = getUUID();
    // Place the spliced node a full row below the source and aligned with the
    // target's column (so new→target reads as a straight edge). commitNode then
    // nudges the target + downstream down to keep a full row of breathing room
    // below the new node.
    const position = {
      x: tgt.position?.x ?? src.position?.x ?? 0,
      y: (src.position?.y ?? 0) + INSERT_ROW_GAP,
    };
    workflowObj.currentSelectedNodeData = {
      id,
      type: meta.ioType,
      position,
      data: { label: id, node_type: nodeType },
    };
    workflowObj.pendingEdge = null;
    workflowObj.pendingInsert = {
      edgeId,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
    };
    workflowObj.currentSelectedNodeID = id;
    workflowObj.isEditNode = false;
    workflowObj.dialog.name = nodeType;
    workflowObj.dialog.expand = false;
    workflowObj.dialog.show = true;
  }

  // Drawer Save: merge the form payload, then either update the existing node
  // (edit) or commit the staged node + its auto-wired edge (add / insert).
  function commitNode(payload: any = {}) {
    const wf = workflowObj.currentSelectedWorkflow;
    const node = workflowObj.currentSelectedNodeData;
    if (!node) return;
    // Snapshot BEFORE the add/edit so one undo reverts the whole commit.
    pushWorkflowHistory();
    node.data = { ...node.data, ...payload };

    if (workflowObj.isEditNode) {
      const idx = wf.nodes.findIndex((n: any) => n.id === node.id);
      if (idx !== -1) wf.nodes[idx] = node;
    } else if (workflowObj.pendingInsert) {
      // Splice onto the edge: drop A→B, add A→new and new→B (T7).
      const ins = workflowObj.pendingInsert;
      wf.nodes = [...wf.nodes, node];
      wf.edges = [
        ...wf.edges.filter((e: any) => e.id !== ins.edgeId),
        newEdge(ins.source, node.id, ins.sourceHandle),
        newEdge(node.id, ins.target),
      ];
      // Give the spliced node breathing room: nudge the target + everything
      // downstream of it down so there's a full row gap below the new node.
      const tgtNode = wf.nodes.find((n: any) => n.id === ins.target);
      const shift = tgtNode
        ? Math.max(0, (node.position?.y ?? 0) + INSERT_ROW_GAP - (tgtNode.position?.y ?? 0))
        : 0;
      if (shift > 0) {
        const subtree = reachableFrom(wf.edges, [ins.target]);
        wf.nodes = wf.nodes.map((n: any) =>
          subtree.has(n.id)
            ? { ...n, position: { x: n.position?.x ?? 0, y: (n.position?.y ?? 0) + shift } }
            : n,
        );
      }
    } else {
      wf.nodes = [...wf.nodes, node];
      if (workflowObj.pendingEdge) {
        wf.edges = [
          ...wf.edges,
          newEdge(workflowObj.pendingEdge.source, node.id, workflowObj.pendingEdge.sourceHandle),
        ];
      }
    }
    workflowObj.pendingEdge = null;
    workflowObj.pendingInsert = null;
    workflowObj.isEditNode = false;
    workflowObj.dialog.expand = false;
    workflowObj.dialog.show = false;
    // The Test log PERSISTS across edits — adding / inserting / editing
    // a node keeps the dock and existing badges in place instead of a jarring
    // close+reopen. A newly-added node simply has no badge (it wasn't in the run);
    // an edited node keeps its last-run badge until re-tested. Cleared only by a new
    // run or the explicit "Clear" button. See executeTestRun for the run snapshot.
    markWorkflowDirty();
  }

  // Drawer Cancel: discard a staged (not-yet-added) node; leave existing nodes
  // untouched.
  function cancelNodeDrawer() {
    workflowObj.pendingEdge = null;
    workflowObj.pendingInsert = null;
    workflowObj.currentSelectedNodeData = null;
    workflowObj.currentSelectedNodeID = "";
    workflowObj.isEditNode = false;
    workflowObj.dialog.expand = false;
    workflowObj.dialog.show = false;
  }

  // Open an existing node's config drawer.
  function editNode(nodeId: string) {
    const node = workflowObj.currentSelectedWorkflow.nodes.find((n: any) => n.id === nodeId);
    if (!node) return;
    workflowObj.isEditNode = true;
    workflowObj.pendingEdge = null;
    workflowObj.currentSelectedNodeData = node;
    workflowObj.currentSelectedNodeID = nodeId;
    workflowObj.dialog.name = node.data.node_type;
    workflowObj.dialog.show = true;
  }

  function resetWorkflowData() {
    workflowObj.currentSelectedWorkflow = JSON.parse(JSON.stringify(defaultWorkflow));
    workflowObj.workflowWithoutChange = JSON.parse(JSON.stringify(defaultWorkflow));
    workflowObj.currentSelectedNodeData = null;
    workflowObj.currentSelectedNodeID = "";
    workflowObj.dialog = { ...defaultDialog };
    // Must carry EVERY key the default object declares — a partial rewrite left
    // `mode`/`position` undefined, so `isTriggerStep` silently read false after
    // a reset.
    workflowObj.stepPicker = {
      show: false,
      source: "",
      handle: "out",
      mode: "next",
      edgeId: "",
      position: null,
      anchor: null,
    };
    workflowObj.pendingInsert = null;
    workflowObj.showNodePalette = false;
    workflowObj.isEditWorkflow = false;
    workflowObj.isEditNode = false;
    workflowObj.dirtyFlag = false;
    resetWorkflowHistory();
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
    onNodeDragStart,
    onNodeDragStop,
    onConnect,
    validateConnection,
    // node ops
    openStepPicker,
    openTriggerPicker,
    openInsertPicker,
    closeStepPicker,
    addTriggerNode,
    addNodeAfter,
    addNodeOnEdge,
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

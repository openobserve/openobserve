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

import { computed, reactive, ref } from "vue";
import { isEqual } from "lodash-es";
import { useVueFlow } from "@vue-flow/core";
import { getUUID, getImageURL } from "@/utils/zincutils";
import { toast } from "@/lib/feedback/Toast/useToast";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import { detectCycle } from "@/composables/flow/detectCycle";
import { makeEdge } from "@/composables/flow/makeEdge";
import { getTruncatedConditions } from "@/utils/conditionPreview";
import { convertV0ToV2, convertV1BEToV2, convertV1ToV2 } from "@/utils/alerts/alertDataTransforms";
import { DEFAULT_TRIGGER_KIND, triggerTypeForKind } from "./triggers";
import workflowService from "@/services/workflows";
import { raw, type I18nKey, type I18nText } from "@/types/i18n";
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
  // Fan-out: one input, one output handle per arm (see branchHandles).
  branch: {
    category: "logic",
    kindKey: "workflow.node.kindLogic",
    titleKey: "workflow.node.branch",
    descKey: "workflow.node.branchDesc",
    icon: "fork-right",
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

// One handle per configured case plus terminal `else`; other node types return [].
// The STORED handle wins: deleting or reordering a path never re-indexes the
// survivors, so deriving it from the array position would rename a live handle and
// condemn the edge still wired to it as unroutable.
export const branchHandles = (node: any): string[] => {
  if (node?.data?.node_type !== "branch") return [];
  const cases = node?.data?.cases;
  // No legacy true/false fallback: those arms can never be declared, so every edge wired on them died at publish.
  if (!Array.isArray(cases) || !cases.length) return [];
  return [...cases.map((c: any, i: number) => c?.handle || `case-${i}`), "else"];
};

// Marks the "add another path" `+` on a fully wired Branch. Never persisted: it is
// swapped for a real case handle the moment a step is picked.
export const NEW_BRANCH_PATH_HANDLE = "__new_path__";

// Mints the next free `case-N` on a Branch and returns its handle, so a canvas-added
// path is a real arm the drawer can then configure.
export const appendBranchCase = (node: any): string => {
  const cases = Array.isArray(node?.data?.cases) ? node.data.cases : [];
  const taken = new Set(cases.map((c: any) => c?.handle));
  let i = cases.length;
  while (taken.has(`case-${i}`)) i += 1;
  const handle = `case-${i}`;
  node.data = { ...node.data, cases: [...cases, { handle, conditions: null }] };
  return handle;
};

// A Branch is born with a declared first path + else: handles minted before
// configuration (the old true/false) could never be declared, condemning every
// edge wired ahead of setup.
const initialNodeData = (nodeType: string, id: string) =>
  nodeType === "branch"
    ? {
        label: id,
        node_type: nodeType,
        cases: [{ handle: "case-0", conditions: null }],
        else_handle: "else",
      }
    : { label: id, node_type: nodeType };

// A single-output card's handle id is the literal "output" — not a routable Branch arm, so persisting it would invent a path the backend does not have.
export const routableHandle = (handle?: string): string | undefined =>
  !handle || handle === "output" || handle === "out" ? undefined : handle;

// Ranks a sourceHandle so fan-out subtrees lay out in DECLARED order, not edge-array order.
export const branchHandleRank = (handle?: string): number => {
  if (!handle || handle === "output" || handle === "out") return -1;
  if (handle === "true") return 0;
  if (handle === "false") return 1;
  // Namespaced away from true/false: legacy edges keep those handles and would tie.
  const m = /^case-(\d+)$/.exec(handle);
  if (m) return 1000 + Number(m[1]);
  return handle === "else" ? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER - 1;
};

// What an arm leaving a Branch routes, for the connector label. The stored handle
// is the anchor, so an unlabelled path is numbered by its POSITION among the
// survivors — a raw `case-2` says nothing, and it is the 2nd path once a middle
// one is deleted.
// True only when the case carries at least one real rule. Both shapes are in the wild:
// v1 `{and:[…]}` (what the builder saves) and v2 `{version,conditions:{conditions:[…]}}`.
export const hasBranchRule = (kase: any): boolean => {
  // Unwrap either envelope: the v2 `{version,conditions}` and the builder's plain
  // `{conditions}` both nest the real rule one level down.
  const seen = new Set<any>();
  let c = kase?.conditions;
  while (c && typeof c === "object" && c.conditions && !seen.has(c)) {
    seen.add(c);
    c = c.conditions;
  }
  if (!c || typeof c !== "object") return false;
  const list = c.and ?? c.or ?? (Array.isArray(c) ? c : null);
  return Array.isArray(list) && list.length > 0;
};

export const branchEdgeLabel = (
  node: any,
  handle: string | undefined,
  t: TranslateFn,
): I18nText | "" => {
  if (!handle || node?.data?.node_type !== "branch") return "";
  const handles = branchHandles(node);
  const index = handles.indexOf(handle);
  if (index < 0) return "";
  if (index === handles.length - 1) return t("workflow.node.branchElseTitle");
  const kase = node?.data?.cases?.[index];
  const authored = String(kase?.label || "").trim();
  const name = authored || String(t("workflow.node.branchPathNumber", { index: index + 1 }));
  // An empty rule evaluates TRUE, so first-match-wins hands this arm every record and
  // starves the ones below it — it must never read like a configured path.
  if (!hasBranchRule(kase)) return t("workflow.node.branchPathUnset", { name });
  return authored ? raw(authored) : t("workflow.node.branchPathNumber", { index: index + 1 });
};

export const edgeBranchLabel = (edgeId: string, t: TranslateFn): I18nText | "" => {
  const wf = workflowObj.currentSelectedWorkflow;
  const edge = (wf?.edges || []).find((e: any) => e.id === edgeId);
  if (!edge) return "";
  const source = (wf?.nodes || []).find((n: any) => n.id === (edge.source ?? edge.sourceNode?.id));
  return branchEdgeLabel(source, edge.sourceHandle, t);
};

// `event_type` is the backend's WorkflowTriggerType. A dry run from the editor
// records as "Test"; without this a rehearsal is indistinguishable in history
// from a real fired-alert run that paged someone.
export const isTestRun = (run: { event_type?: string } | null | undefined): boolean =>
  run?.event_type === "Test";

// Every run-history surface (the Runs table, the editor's History dropdown) must
// make the SAME call about test runs; they drifted once and buried a published
// workflow's real runs under two dozen rehearsals. Each caller gets its OWN
// override ref so hiding rows on one surface cannot silently reshape the other.
export const useTestRunVisibility = () => {
  // Derived, not snapshotted: on a deep link the workflow hydrates AFTER the
  // surface mounts, so a snapshot would lock in the pre-hydration default.
  const defaultShowTestRuns = computed(() => !!workflowObj.currentSelectedWorkflow?.isDraft);
  // Null until the user touches the control; once set it outranks the default for
  // the session, so a refetch or a mid-session Publish cannot undo an explicit choice.
  const choice = ref<boolean | null>(null);
  const showTestRuns = computed({
    get: () => choice.value ?? defaultShowTestRuns.value,
    set: (v: boolean) => {
      choice.value = v;
    },
  });
  const testRunCount = computed(() => workflowObj.runsHistory.list.filter(isTestRun).length);
  const visibleRuns = <T extends { event_type?: string }>(list: T[]): T[] =>
    showTestRuns.value ? list : list.filter((r) => !isTestRun(r));
  return { showTestRuns, testRunCount, visibleRuns };
};

// Where a canvas badge's evidence came from. `source` is stamped at every point a
// result is created, because the run-detail endpoint carries no event_type of its own.
export const isTestEarnedResult = (result: { source?: string } | null | undefined): boolean =>
  result?.source === "test";

// The backend names a node by its `meta.label`, but falls back to the raw id when
// the author never renamed it — and it has no i18n, so it cannot say "Branch".
// Only the canvas knows both, so any backend message is rewritten before display.
// An id the graph no longer has is left alone: dropping it would leave a dangling
// "Edge from BranchNode  to X".
// Nodes whose WIRING cannot execute — a different class from `meta.incomplete`
// (which is "not finished yet" and only blocks Publish). These fail on the backend
// mid-run with a uuid-bearing message, so they are caught before a run instead.
// Branch is the only multi-output type today; the per-type shape is checked here so
// a future fan-out node has one place to declare its rule.
export const structurallyBrokenNodes = (): string[] => {
  const wf = workflowObj.currentSelectedWorkflow;
  const nodes = wf?.nodes || [];
  const edges = wf?.edges || [];
  const broken: string[] = [];
  for (const node of nodes) {
    if (node?.data?.node_type !== "branch") continue;
    const out = edges.filter((e: any) => (e.source ?? e.sourceNode?.id) === node.id);
    if (!out.length) continue; // routing nothing yet — legal
    const declared = new Set(branchHandles(node));
    const configured = Array.isArray(node?.data?.cases) && node.data.cases.length > 0;
    // Unconfigured: no declared handles at all, so any outgoing edge is unroutable.
    if (!configured) {
      broken.push(node.id);
      continue;
    }
    if (out.some((e: any) => !e.sourceHandle || !declared.has(e.sourceHandle))) {
      broken.push(node.id);
    }
  }
  return broken;
};

// The composable receives `t`; these module-level helpers run outside it, so the
// translator is captured on first use rather than threaded through every caller.
let translate: TranslateFn | undefined;
export const setWorkflowTranslator = (t: TranslateFn) => {
  translate = t;
};

const NODE_ID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export const humanizeNodeIds = (message?: string | null, t?: TranslateFn): string => {
  if (!message) return "";
  const nodes = workflowObj.currentSelectedWorkflow?.nodes || [];
  if (!nodes.length) return message;
  return message.replace(NODE_ID_RE, (id) => {
    const node = nodes.find((n: any) => n.id === id);
    if (!node) return id;
    const custom = nodeCustomName(node);
    if (custom) return custom;
    const key = nodeMeta(node?.data?.node_type)?.titleKey;
    return key && t ? t(key) : id;
  });
};

// A validation failure used to be a toast alone, leaving the author to find the
// offending node by uuid. The ids in the message identify it, so they are written
// into the SAME per-node error map the run badges already render — one highlight
// mechanism, no second rendering path. A message naming no node changes nothing.
export const markNodesFromError = (message?: string | null): void => {
  if (!message) return;
  const nodes = workflowObj.currentSelectedWorkflow?.nodes || [];
  const ids = [...new Set(message.match(NODE_ID_RE) || [])].filter((id) =>
    nodes.some((n: any) => n.id === id),
  );
  if (!ids.length) return;
  const result = workflowObj.testRun.result || { inputs: {}, outputs: {}, errors: {} };
  result.errors = result.errors || {};
  for (const id of ids) {
    result.errors[id] = { error_count: 1, errors: [[message]] };
  }
  workflowObj.testRun.result = result;
};

// Sentinel for "the test run already in memory" — its per-node inputs live in
// sessionStorage, not the server, so it is picked without a fetch.
export const LAST_TEST_RUN = "__last_test_run__";

// The input a loaded run fed to one node. `loadWorkflowRun` already fetches the
// WHOLE run's per-node map in one request, so re-testing slices the node it wants
// out of that instead of fetching per step. Empty `fromNode` means the trigger —
// the payload the workflow itself received. Null when that node isn't in the run,
// so the caller falls back to the sample rather than seeding an empty array.
export const runInputForNode = (fromNode: string): any[] | null => {
  const nodes = workflowObj.currentSelectedWorkflow?.nodes || [];
  const id = fromNode || nodes.find((n: any) => n.data?.node_type === "workflow_trigger")?.id || "";
  return id ? nodeTestInput(id) : null;
};

// Informational ONLY — a dangling arm is a legal "drop these records" path.
export const branchUnwiredHandles = (node: any, edges: any[]): string[] => {
  const handles = branchHandles(node);
  if (!handles.length) return [];
  const wired = new Set(
    (edges || [])
      .filter((e: any) => (e.source ?? e.sourceNode?.id) === node.id)
      .map((e: any) => e.sourceHandle),
  );
  return handles.filter((h) => !wired.has(h));
};

// Node types offered by the step picker when extending a node (everything but
// the triggers, which can only ever be the FIRST node).
// "branch" sits next to "condition": both are `logic`, and a Branch is the N-way
// generalisation of a Condition, so the picker reads condition → branch → function.
export const ADDABLE_NODE_TYPES = ["condition", "branch", "function", "destination"];

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
    mode: "next" as "next" | "trigger" | "action" | "insert",
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
    // Where `input` came from — a payload an author hand-edited must never keep
    // reading as the generated sample, or Test lies about what it ran against.
    inputSource: <"sample" | "run" | "edited">"sample",
    // Display label of the run `input` was seeded from; empty for the other sources.
    inputRunLabel: "",
    // Default ON: a Test must not dispatch to real destinations (paging on-call)
    // unless the author explicitly opts into a live run.
    suppressDestinations: true,
    result: <any>null,
  },
  currentSelectedWorkflow: <any>JSON.parse(JSON.stringify(defaultWorkflow)),
  workflowWithoutChange: <any>JSON.parse(JSON.stringify(defaultWorkflow)),
  // Serialized payload of the version the SERVER holds. A save that would send an
  // identical payload is a no-op the backend answers 200 to, so publishing it
  // reports a change the author never made — compared here to block that.
  storedSnapshot: "",
  nameError: false,
  nameErrorMessage: "",
  // Node ids to FLASH a "needs setup" warning ring on — set by Publish validation
  // when incomplete (dummy) nodes block publishing, so the user sees exactly which
  // steps. Transient: the canvas frames them and clears this after a few seconds.
  incompleteHighlight: <string[]>[],
  // Runs list, fetched ONCE by the Runs page (WorkflowRunsPanel) and SHARED so the
  // NDV's run switcher reuses it instead of re-hitting /history on every open. The
  // user reaches the NDV from that list, so it's already loaded; a manual Refresh
  // (with `fetchedAt` shown) re-pulls the same window when they want the latest.
  runsHistory: {
    list: <any[]>[],
    fetchedAt: 0, // ms epoch of the last successful fetch; 0 = never
    params: { start: 0, end: 0 }, // the time window the list was fetched for (µs)
    loading: false,
  },
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
//
// IDEMPOTENT: if the resolved value is unchanged, do nothing — no reassignment,
// no dirty flag. This matters now that the node panel commits its config on CLOSE
// (no Save button): opening a node and closing it re-runs the body's submit(),
// which re-asserts the same `incomplete` value; without this guard that alone
// would mark an untouched workflow dirty and trip the unsaved-changes guard.
const setNodeMeta = (node: any, key: string, value: string) => {
  if (!node) return;
  const current = node.meta || {};
  const nextVal = value || undefined;
  const curVal = current[key] || undefined;
  if (curVal === nextVal) return;
  const meta = { ...current };
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
  const children = new Map<string, Array<{ tgt: string; rank: number }>>();
  for (const e of edges || []) {
    const src = e.source ?? e.sourceNode?.id;
    const tgt = e.target ?? e.targetNode?.id;
    if (!src || !tgt) continue;
    if (!children.has(src)) children.set(src, []);
    children.get(src)!.push({ tgt, rank: branchHandleRank(e.sourceHandle) });
  }
  // Handle order decides a fan-out node's child order; the stable sort keeps edge order within a handle.
  const ordered = new Map<string, string[]>();
  for (const [src, kids] of children) {
    ordered.set(
      src,
      [...kids].sort((a, b) => a.rank - b.rank).map((k) => k.tgt),
    );
  }
  return ordered;
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

// A step in the workflow TREE (the NDV's Steps rail). Carries the render structure —
// depth, direct-child count, and per-column "does this rail continue" flags — so the
// rail draws the traces-waterfall connector lines without re-deriving them.
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

// ConditionBuilder re-renders stored rules in the v2 UI schema, so reopening a
// Branch/Condition yields a payload that is structurally unlike what was stored yet
// identical in meaning. Compare both sides in v2 form — otherwise merely OPENING such
// a node would void its badge. Mirrors the builder's own load-time conversion.
const toV2Conditions = (c: any): any => {
  if (!c || typeof c !== "object") return c;
  try {
    const clone = JSON.parse(JSON.stringify(c));
    // Only levels shapes the converters actually recognize: convertV0ToV2 collapses any
    // unrecognized object to an EMPTY group, which would hide real edits as "no change".
    if (Array.isArray(clone)) return convertV0ToV2(clone);
    if (clone.and || clone.or) return convertV1BEToV2(clone);
    if (clone.label && clone.items) return convertV1ToV2(clone);
    return clone;
  } catch {
    return c;
  }
};

// Ids and the version wrapper are builder scaffolding, never meaning; `conditions`
// payloads are levelled to v2 first so the two schemas can be compared at all.
const semanticConfig = (data: any, key?: string): any => {
  if (key === "conditions" && data && typeof data === "object" && !Array.isArray(data))
    return semanticConfig(toV2Conditions(data));
  if (Array.isArray(data)) return data.map((v) => semanticConfig(v));
  if (!data || typeof data !== "object") return data;
  return Object.fromEntries(
    Object.entries(data)
      .filter(([k]) => k !== "id" && k !== "groupId" && k !== "version")
      .map(([k, v]) => [k, semanticConfig(v, k)]),
  );
};

// A recorded ✓/✗ is a claim about the config the node ran with, so editing that config
// makes it DIRTY: the node and its immediate successors (whose input was this node's
// output). Only the first step down each arm — a re-run is what re-verifies the rest.
const dirtyScopeFrom = (nodeId: string): string[] => {
  const kids = buildChildrenMap(workflowObj.currentSelectedWorkflow.edges || []).get(nodeId) ?? [];
  return [...new Set([nodeId, ...kids])];
};

// Marks rather than deletes: the recorded input/output stays inspectable in the NDV,
// while the badge flips to the amber "needs a re-test" state instead of a stale pass.
const markTestResultDirty = (nodeId: string) => {
  const res = workflowObj.testRun.result;
  if (!res || !nodeId) return;
  const scope = dirtyScopeFrom(nodeId).filter((id) => (res.ranNodeIds || []).includes(id));
  if (!scope.length) return;
  const dirtyNodeIds = [...new Set([...(res.dirtyNodeIds || []), ...scope])];
  if (dirtyNodeIds.length === (res.dirtyNodeIds || []).length && res.dirtyEditedId === nodeId)
    return;
  workflowObj.testRun.result = { ...res, dirtyNodeIds, dirtyEditedId: nodeId };
  writeTestStateToNodes();
  persistTestData();
};

// A fresh run re-verifies these nodes, so they stop being dirty (n8n: executing a node
// again clears its dirty status).
const clearDirtyNodes = (result: any, ranIds: string[]): any => {
  const prev = result?.dirtyNodeIds || [];
  if (!prev.length) return result;
  return { ...result, dirtyNodeIds: prev.filter((id: string) => !ranIds.includes(id)) };
};

// A v2 condition group the backend reads as "pass everything through": one rule
// with an EMPTY column. The backend short-circuits an empty column to always-true
// (Condition::evaluate: `if self.column.is_empty() { return true }`) BEFORE it ever
// reads `operator`/`value`, so both are irrelevant — we send an empty value (not a
// misleading literal like "true") so it matches an unconfigured rule and round-trips
// cleanly if the draft is reopened. Used to give a never-configured (dummy) Condition
// node a valid, non-filtering `NodeData` at send time; mirrors ConditionBuilder's
// emptyGroup() shape.
const passthroughConditionGroup = () => ({
  filterType: "group",
  logicalOperator: "AND",
  groupId: getUUID(),
  conditions: [
    {
      filterType: "condition",
      column: "",
      operator: "=",
      value: "",
      values: [],
      logicalOperator: "AND",
      id: getUUID(),
    },
  ],
});

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

  // Dummy / never-configured nodes carry only { label, node_type }, but each
  // backend `NodeData` variant needs its own fields or deserialization fails.
  // Fill a valid placeholder at SEND time only (the editor node stays flagged
  // `incomplete`, so the "Set up later" badge and Publish block are unaffected):
  //   - condition  → a pass-through v2 rule (see above); records flow untouched.
  //   - destination → an empty destination name, the same shape a configured
  //     node sends ({ destination_id, template_override }).
  if (nodeType === "condition" && data.conditions == null) {
    data.version = 2;
    data.conditions = passthroughConditionGroup();
  } else if (nodeType === "destination" && typeof data.destination_id !== "string") {
    data.destination_id = "";
    if (data.template_override === undefined) data.template_override = null;
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

// VueFlow names the field `sourceHandle`; the Rust `Edge` names it `source_handle`
// with no serde rename, so an untranslated Branch edge arrives with no handle and
// validate_branch_node rejects the whole run. Omitted (not null) when absent, so
// every pre-existing handle-less edge serializes exactly as it did before.
const serializeEdge = (edge: any) => {
  const out: any = { id: edge.id, source: edge.source, target: edge.target };
  const handle = edge.source_handle ?? edge.sourceHandle;
  if (handle) out.source_handle = handle;
  return out;
};

// Build the backend `Workflow` object from the current in-memory graph. Shared by
// the editor's create/update payload AND the Test run (which now sends the whole
// graph so it can run WITHOUT saving). The `Workflow` struct has no serde
// defaults, so every field must be present; org_id/id/created_by are
// overridden/generated by the backend (the test endpoint assigns a throwaway id).
//
// `onlyNodeId` builds a SINGLE-NODE workflow (just that node, no edges) — used by
// "Run Step" to execute one node in isolation (from_node = that node's id), so
// nothing downstream runs and its output comes back on its own.
export const serializeWorkflow = (opts?: { onlyNodeId?: string }) => {
  const wf = workflowObj.currentSelectedWorkflow;
  const allNodes = wf.nodes || [];
  const nodes = opts?.onlyNodeId ? allNodes.filter((n: any) => n.id === opts.onlyNodeId) : allNodes;
  return {
    id: wf.id || "",
    org_id: "",
    name: (wf.name || "").trim(),
    description: wf.description || "",
    enabled: wf.enabled ?? true,
    created_at: wf.created_at || 0,
    updated_at: wf.updated_at || 0,
    created_by: "",
    nodes: nodes.map(serializeNode),
    edges: opts?.onlyNodeId ? [] : (wf.edges || []).map(serializeEdge),
  };
};

// Stamp the current graph as the stored version. Called on load and after every
// successful write, so the no-op comparison always names the newest saved state.
export const captureStoredSnapshot = () => {
  workflowObj.storedSnapshot = JSON.stringify(serializeWorkflow());
};

// True when saving would send exactly what the server already holds. Never true
// for an unsaved workflow — there is no stored version to be identical to.
export const isUnchangedFromStored = (): boolean =>
  !!workflowObj.currentSelectedWorkflow?.id &&
  !!workflowObj.storedSnapshot &&
  workflowObj.storedSnapshot === JSON.stringify(serializeWorkflow());

// Run the workflow Test (from the Test dialog or a node's Run Step button) and
// store the result so each WorkflowNode paints its ✓ / ✗ / ⊘ badge. Shared so
// both entry points behave identically. The whole in-memory graph is sent, so a
// workflow can be tested whether or not it's been saved. The backend returns a
// per-node `inputs` map, a per-node `outputs` map, and `errors` — the step drawer
// reads Input/Output straight from those maps.
//
// `singleNode` runs ONE node in isolation ("Run Step"): only that node is sent as
// the workflow, with from_node = its id, so nothing upstream/downstream executes —
// just this step, against the given input, and its output comes back on its own.
export const executeTestRun = async (opts: {
  orgId: string;
  inputs: any[];
  fromNode?: string;
  singleNode?: boolean;
  suppressDestinations?: boolean;
}): Promise<{ ok: boolean; error?: string }> => {
  const wf = workflowObj.currentSelectedWorkflow;
  try {
    const single = opts.singleNode && opts.fromNode ? opts.fromNode : "";
    // Dry-run a DRAFT when the graph is a saved draft, has unsaved edits, or was
    // never persisted — the backend then skips the strict published validation. A
    // single-node run is inherently a partial graph (one node, no trigger/edges),
    // so it's ALWAYS a draft, even when the parent workflow is published.
    const draft = !!(single || wf.isDraft || workflowObj.dirtyFlag || !wf.id);
    const res = await workflowService.testWorkflow({
      org_identifier: opts.orgId,
      workflow: serializeWorkflow(single ? { onlyNodeId: single } : undefined),
      inputs: opts.inputs,
      from_node: opts.fromNode || undefined,
      draft,
      suppress_destinations: opts.suppressDestinations ?? true,
    });
    const errors = res.data?.errors || {};
    // Per-node INPUT map: node_id -> the records that node received.
    const inputs = res.data?.inputs || {};
    // Per-node OUTPUT map: node_id -> the records that node emitted. The backend
    // now sends this directly (alongside `inputs`), so a node's Output is read
    // straight from here (see nodeTestOutput) rather than derived from downstream
    // inputs. Errors are still delivered the old way, via `errors`.
    const outputs = res.data?.outputs || {};

    if (single) {
      // Single-node Run Step: REPLACE just this node's input/output/error in the
      // CURRENT result, leaving every other node untouched — its fresh output
      // overwrites whatever was shown for it (a loaded history run, a prior Test, or
      // an earlier Run Step) while the rest of the view stays put. The spread keeps
      // the surrounding context (mode/runId/ghostNodeIds, other nodes' data); only
      // this node's slot is refreshed (its stale error cleared, then re-applied if
      // it failed again) and it's marked as ran.
      const base: any = workflowObj.testRun.result || {};
      const mergedErrors = { ...(base.errors || {}) };
      const mergedInputs = { ...(base.inputs || {}) };
      const mergedOutputs = { ...(base.outputs || {}) };
      // This node's slots are FULLY REPLACED by the fresh run: drop the old value
      // first, then apply the response. Critical when the step emitted nothing — an
      // empty/absent result must CLEAR the old output, not fall through to it
      // (a plain `{ ...base, ...resp }` spread leaves the stale value when `resp`
      // has no key for this node).
      delete mergedErrors[single];
      delete mergedInputs[single];
      delete mergedOutputs[single];
      Object.assign(mergedErrors, errors);
      Object.assign(mergedInputs, inputs);
      Object.assign(mergedOutputs, outputs);
      const ranNodeIds = [...new Set([...(base.ranNodeIds || []), single])];
      workflowObj.testRun.result = clearDirtyNodes(
        {
          ...base,
          errors: mergedErrors,
          inputs: mergedInputs,
          outputs: mergedOutputs,
          ranNodeIds,
          blockedNodeIds: downstreamOfErrorNodes(Object.keys(mergedErrors)),
          // A Run Step is a rehearsal even when it lands on a loaded real run, so the
          // merged result can no longer claim the real run's provenance.
          source: "test",
        },
        [single],
      );
      // A Run Step re-verifies one node, so the result describes a NEW run and the stamp
      // has to move — except over a loaded history run, whose runId identifies the stored
      // execution the rest of the view still shows and must keep pointing at.
      if (base.mode !== "history") {
        workflowObj.testRun.result.runId = newTestRunId();
        workflowObj.testRun.result.ranAt = Date.now();
      }
      writeTestStateToNodes();
      persistTestData();
      await flushTestStateToServer(opts.orgId);
      return { ok: true };
    }

    // Full Test run — replaces the result entirely (a fresh, coherent run of the
    // whole graph; stale single-node accumulations must not linger). Which nodes
    // ran: a replay is `fromNode` + everything downstream; otherwise everything
    // reachable from the trigger. Unreachable (unwired) nodes never ran → no ✓.
    const triggerId = (wf.nodes || []).find(
      (n: any) => n.data?.node_type === "workflow_trigger",
    )?.id;
    const startId = opts.fromNode || triggerId;
    const ranNodeIds = startId ? [...reachableFrom(wf.edges || [], [startId])] : [];
    workflowObj.testRun.result = {
      errors,
      inputs,
      outputs,
      ranNodeIds,
      blockedNodeIds: downstreamOfErrorNodes(Object.keys(errors)),
      dirtyNodeIds: [],
      runId: newTestRunId(),
      ranAt: Date.now(),
      // This path is /workflows/test — a rehearsal, never evidence the live workflow ran.
      source: "test",
    };
    writeTestStateToNodes();
    persistTestData();
    await flushTestStateToServer(opts.orgId);
    return { ok: true };
  } catch (e: any) {
    // A failed FULL run must not leave the previous run's ✓/✗ badges on screen. A
    // single-node run that throws (network/validation) keeps the accumulated
    // results so other nodes' Run Step outputs aren't wiped by an unrelated failure.
    if (!(opts.singleNode && opts.fromNode)) workflowObj.testRun.result = null;
    {
      const msg = e?.response?.data?.message;
      markNodesFromError(msg);
      return { ok: false, error: humanizeNodeIds(msg, translate) };
    }
  }
};

// The INPUT a node received on the last Test run — the raw records from the
// backend `inputs` map (shape varies by node type; rendered as-is). Null when the
// node isn't in the map (0 records reached it) or there's no run.
export const nodeTestInput = (nodeId: string): any[] | null => {
  const inputs = workflowObj.testRun.result?.inputs;
  const v = inputs?.[nodeId];
  return Array.isArray(v) ? v : null;
};

// The OUTPUT a node emitted on the last run — read straight from the backend
// `outputs` map (node_id -> records). Null when the node isn't in the map (never
// ran / emitted nothing) or there's no run. Replaces deriving output from
// downstream inputs: the backend now reports each node's output directly.
export const nodeTestOutput = (nodeId: string): any[] | null => {
  const v = workflowObj.testRun.result?.outputs?.[nodeId];
  if (Array.isArray(v)) return v;
  // A fan-out node reports a per-handle map instead of one flat array; flatten it
  // in handle order so the plain "what did this step emit" view still works.
  if (v && typeof v === "object") {
    return Object.keys(v)
      .sort((a, b) => branchHandleRank(a) - branchHandleRank(b))
      .flatMap((h) => (Array.isArray(v[h]) ? v[h] : []));
  }
  return null;
};

// Hand-edited test input per workflow id, then node id — the NDV's Input pane keeps
// the edit when walking between steps instead of re-seeding from the sample.
let editedInputsWorkflowId = "";
let nodeEditedInputs: Record<string, string> = {};

// Session quota is ~5MB and a recorded run's outputs are unbounded; over budget we
// clear rather than keep a stale entry that would resurrect the superseded run.
const TEST_DATA_MAX_BYTES = 2_000_000;

const testDataKey = (workflowId: string) => `workflow-test-data:${workflowId}`;
// The typed payload is authored work and belongs in localStorage — it must
// survive closing the tab the way a draft does. The recorded RESULT deliberately
// stays session-scoped: it snapshots ONE run and goes stale against an edited
// graph, so restoring it days later would paint ✓/✗ badges for a workflow that no
// longer matches.
const testInputKey = (workflowId: string) => `workflow-test-input:${workflowId}`;

// Scoping the map to one workflow at a time stops workflow A's edit for node "n1"
// being served to workflow B's node "n1", and bounds it across a long session.
const claimEditedInputs = (workflowId: string): Record<string, string> => {
  if (editedInputsWorkflowId !== workflowId) {
    editedInputsWorkflowId = workflowId;
    nodeEditedInputs = {};
  }
  return nodeEditedInputs;
};

// Reads answer from whichever workflow the map currently HOLDS, never re-claiming: a
// restore runs while the store id is still "" (reset, then load), so re-deriving the
// scope on every read would wipe what was just restored.
const readEditedInputs = (): Record<string, string> => nodeEditedInputs;

const currentWorkflowId = () => workflowObj.currentSelectedWorkflow?.id || "";

// Debounced: the Input pane calls this on every keystroke, and serializing a whole
// recorded run per character is what would make typing feel heavy.
const PERSIST_DEBOUNCE_MS = 500;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
const persistTestDataSoon = () => {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistTestData();
  }, PERSIST_DEBOUNCE_MS);
};

export const setNodeEditedInput = (nodeId: string, text: string) => {
  if (nodeId) claimEditedInputs(currentWorkflowId())[nodeId] = text;
  persistTestDataSoon();
};

export const getNodeEditedInput = (nodeId: string): string | undefined =>
  readEditedInputs()[nodeId];

export const clearNodeEditedInput = (nodeId: string) => {
  delete readEditedInputs()[nodeId];
  persistTestDataSoon();
};

// Per-node test state lives in `Node.meta` — it travels with the workflow DOCUMENT,
// so the badge one author records is the badge every other user sees, and clearing a
// browser cannot silently un-test a workflow. Strings only: `meta` is a
// HashMap<String,String> on the backend and round-trips untouched via serializeNode.
// A local run identity: the /test endpoint deliberately records nothing in run history,
// so there is no server run id to borrow and the badge still has to say WHICH run it is.
const newTestRunId = () => `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const TEST_META_KEYS = ["test_status", "test_run_id", "test_ran_at", "test_dirty"] as const;

// Strips every test key from a node's meta, dropping `meta` entirely once empty so an
// untested node serializes exactly as it did before this state existed.
const stripTestMeta = (node: any): boolean => {
  const meta = node?.meta;
  if (!meta) return false;
  let changed = false;
  for (const k of TEST_META_KEYS) {
    if (meta[k] !== undefined) {
      delete meta[k];
      changed = true;
    }
  }
  if (changed && !Object.keys(meta).length) delete node.meta;
  return changed;
};

// Per-node outcome, mirroring WorkflowNode.testStatus: a node is a real pass only when it
// actually did its job, so one that ran against nothing — or was never set up — is "skipped".
const testStatusForNode = (result: any, nodeId: string): string | null => {
  if (!result?.ranNodeIds?.includes(nodeId)) return null;
  if (result.errors?.[nodeId]) return "error";
  // A never-configured step did no work, so records reaching it are not a pass.
  const node = (workflowObj.currentSelectedWorkflow?.nodes || []).find((n: any) => n.id === nodeId);
  if (isNodeIncomplete(node)) return "skipped";
  if (result.inputs) return result.inputs[nodeId]?.length ? "ok" : "skipped";
  if (result.blockedNodeIds?.includes(nodeId)) return "skipped";
  return "ok";
};

// Pushes the recorded state to the server so ANOTHER user opening this workflow sees
// the same badges — the point of holding test state in the document. Skipped when the
// graph has unsaved edits or was never saved: writing then would silently persist the
// author's in-progress edits as a side effect of pressing Run.
const flushTestStateToServer = async (orgId: string) => {
  const wf = workflowObj.currentSelectedWorkflow;
  if (!wf?.id || workflowObj.dirtyFlag || workflowObj.readOnly) return;
  try {
    await workflowService.updateWorkflow({
      org_identifier: orgId,
      id: wf.id,
      data: {
        workflow: serializeWorkflow(),
        trigger_type: triggerTypeForKind(currentTriggerKind()),
      },
      draft: !!wf.isDraft,
    });
  } catch {
    // A failed flush must not lose the run: the badges still render from memory, and
    // the state rides along on the author's next explicit save.
  }
};

// Projects the in-memory run onto the graph so the next save carries it to the server.
// Writes meta DIRECTLY rather than via setNodeMeta: recording an outcome is not an edit
// to the workflow, and marking it dirty would trip the unsaved-changes guard.
export const writeTestStateToNodes = () => {
  const result = workflowObj.testRun.result;
  const nodes = workflowObj.currentSelectedWorkflow?.nodes || [];
  // A history run is someone else's recorded execution being previewed, not this
  // workflow's own test state — projecting it would overwrite the real badges.
  if (result?.mode === "history") return;
  const runId = result?.runId || "";
  const ranAt = result?.ranAt ? String(result.ranAt) : "";
  const editedId = result?.dirtyEditedId;
  for (const node of nodes) {
    const status = result ? testStatusForNode(result, node.id) : null;
    stripTestMeta(node);
    if (!status) continue;
    const meta = { ...(node.meta || {}) };
    meta.test_status = status;
    if (runId) meta.test_run_id = runId;
    if (ranAt) meta.test_ran_at = ranAt;
    if (result.dirtyNodeIds?.includes(node.id))
      meta.test_dirty = node.id === editedId ? "self" : "upstream";
    node.meta = meta;
  }
};

// Rebuilds the badge state from what the DOCUMENT carries, so a fresh browser (or a
// different user) sees the same ✓/✗/⊘ without any local storage. Only the per-node
// SUMMARY survives a reload this way — the recorded input/output records are not in the
// document, so a synthetic one-record marker stands in to keep `ok` reading as a pass.
const restoreTestStateFromNodes = (): boolean => {
  const nodes = workflowObj.currentSelectedWorkflow?.nodes || [];
  const tested = nodes.filter((n: any) => n.meta?.test_status);
  if (!tested.length) return false;
  const errors: Record<string, any> = {};
  const inputs: Record<string, any[]> = {};
  const ranNodeIds: string[] = [];
  const dirtyNodeIds: string[] = [];
  let dirtyEditedId = "";
  let runId = "";
  let ranAt = 0;
  for (const node of tested) {
    const meta = node.meta;
    ranNodeIds.push(node.id);
    // `translate` is bound by useWorkflowCanvas(t); hydrate can run before that, and the
    // message is replaced by the real one as soon as the records are re-fetched.
    if (meta.test_status === "error")
      errors[node.id] = {
        error_count: 1,
        errors: [[translate ? translate("workflow.test.recordedFailure") : "Recorded failure"]],
      };
    // "skipped" is the absence of records, so only a pass/failure seeds the marker.
    if (meta.test_status !== "skipped") inputs[node.id] = [{}];
    if (meta.test_dirty) {
      dirtyNodeIds.push(node.id);
      if (meta.test_dirty === "self") dirtyEditedId = node.id;
    }
    if (!runId && meta.test_run_id) runId = meta.test_run_id;
    const at = Number(meta.test_ran_at);
    if (Number.isFinite(at) && at > ranAt) ranAt = at;
  }
  workflowObj.testRun.result = {
    errors,
    inputs,
    outputs: {},
    ranNodeIds,
    blockedNodeIds: downstreamOfErrorNodes(Object.keys(errors)),
    dirtyNodeIds,
    dirtyEditedId,
    runId,
    ranAt,
    // The records themselves were never persisted; the NDV uses this to say so
    // instead of rendering an empty Input/Output pane as if the run produced nothing.
    recordsUnavailable: true,
    // Only writeTestStateToNodes persists badges here and it refuses history runs,
    // so anything the document carries was necessarily earned by a test run.
    source: "test",
  };
  return true;
};

export const clearTestData = (workflowId: string) => {
  if (!workflowId) return;
  for (const node of workflowObj.currentSelectedWorkflow?.nodes || []) stripTestMeta(node);
  try {
    sessionStorage.removeItem(testDataKey(workflowId));
    localStorage.removeItem(testInputKey(workflowId));
  } catch {
    // nothing to clear if storage is unavailable
  }
};

// The stored payload carries its provenance so a reload cannot relabel a
// hand-edited payload as the generated sample.
const serializeStoredInput = (input: string): string =>
  JSON.stringify({
    input,
    source: workflowObj.testRun.inputSource || "sample",
    runLabel: workflowObj.testRun.inputRunLabel || "",
  });

// Entries written before provenance existed are bare payload strings, not blobs;
// they restore as the generated sample rather than being dropped as unparseable.
const applyStoredInput = (stored: string) => {
  let blob: any = null;
  try {
    blob = JSON.parse(stored);
  } catch {
    blob = null;
  }
  if (!blob || typeof blob.input !== "string") {
    workflowObj.testRun.input = stored;
    workflowObj.testRun.inputSource = "sample";
    workflowObj.testRun.inputRunLabel = "";
    return;
  }
  workflowObj.testRun.input = blob.input;
  workflowObj.testRun.inputSource =
    blob.source === "run" || blob.source === "edited" ? blob.source : "sample";
  workflowObj.testRun.inputRunLabel = typeof blob.runLabel === "string" ? blob.runLabel : "";
};

// SESSION scope, never localStorage: recorded inputs/outputs carry real log lines.
export const persistTestData = (): { ok: boolean; reason?: string } => {
  const id = workflowObj.currentSelectedWorkflow?.id;
  if (!id) return { ok: false, reason: "no-workflow" };
  const payload = JSON.stringify({
    result: workflowObj.testRun.result ?? null,
    // The Test dialog's payload — the thing an author re-runs while tuning a
    // condition. Without it a reload silently reverts to the generic sample.
    input: workflowObj.testRun.input || "",
    inputSource: workflowObj.testRun.inputSource || "sample",
    inputRunLabel: workflowObj.testRun.inputRunLabel || "",
    editedInputs: editedInputsWorkflowId === id ? nodeEditedInputs : {},
  });
  if (payload.length > TEST_DATA_MAX_BYTES) {
    clearTestData(id);
    return { ok: false, reason: "too-large" };
  }
  try {
    sessionStorage.setItem(testDataKey(id), payload);
    const input = workflowObj.testRun.input || "";
    if (input) localStorage.setItem(testInputKey(id), serializeStoredInput(input));
    else localStorage.removeItem(testInputKey(id));
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  return { ok: true };
};

export const restoreTestData = (workflowId: string, opts?: { keepDocumentState?: boolean }) => {
  if (!workflowId) return;
  const edits = claimEditedInputs(workflowId);
  // Survives the tab, so it is read before (and independently of) the session blob.
  try {
    const savedInput = localStorage.getItem(testInputKey(workflowId));
    if (savedInput) applyStoredInput(savedInput);
  } catch {
    /* storage unavailable — fall through to the sample */
  }
  let saved: any = null;
  try {
    const raw = sessionStorage.getItem(testDataKey(workflowId));
    saved = raw ? JSON.parse(raw) : null;
  } catch {
    return;
  }
  if (!saved) return;
  // Re-attaching the records is only correct when the session blob describes the very
  // run the document recorded; a stale one would resurrect a superseded run's badges.
  const sameRun =
    !opts?.keepDocumentState ||
    (!!saved.result?.runId && saved.result.runId === workflowObj.testRun.result?.runId);
  // A history overlay is opt-in from the Runs list, so it must not come back on its
  // own: restoring it would open the editor wearing a past run's badges and chip.
  if (saved.result?.mode === "history") delete saved.result;
  if (saved.result && sameRun) workflowObj.testRun.result = saved.result;
  if (typeof saved.input === "string" && saved.input) {
    workflowObj.testRun.input = saved.input;
    if (saved.inputSource) workflowObj.testRun.inputSource = saved.inputSource;
    workflowObj.testRun.inputRunLabel = saved.inputRunLabel || "";
  }
  for (const [id, text] of Object.entries(saved.editedInputs || {})) {
    if (typeof text === "string") edits[id] = text;
  }
};

// Only execute_workflow (the real trigger path) calls save_workflow_errors;
// test_workflow and retry_run just record the run — so a Test and a failed Retry
// both LOOK retryable in history but answer 400 "Errored run info not found".
// Why a run cannot be retried, "" when it can — lets a disabled control say which.
export const retryBlockedReason = (
  run: { event_type?: string; error?: string } | null | undefined,
): "" | "test" | "retry" | "succeeded" => {
  if (!run) return "succeeded";
  if (run.event_type === "Test") return "test";
  if (run.event_type === "Retry") return "retry";
  if (!run.error) return "succeeded";
  return "";
};

export const isRetryableRun = (
  run: { event_type?: string; error?: string } | null | undefined,
): boolean => retryBlockedReason(run) === "";

// Replay a failed run server-side. The backend re-runs from the stored input map,
// so this creates a NEW run (event_type "Retry") rather than mutating the original —
// callers must refresh the history list afterwards. `run` is optional but, when
// given, blocks the call locally for a run the endpoint would refuse anyway.
export const retryWorkflowRun = async (opts: {
  orgId: string;
  workflowId: string;
  runId: string;
  fromNode?: string;
  run?: { event_type?: string; error?: string } | null;
}): Promise<{ ok: boolean; error?: string }> => {
  if (opts.run !== undefined && !isRetryableRun(opts.run)) {
    return { ok: false, error: "" };
  }
  try {
    await workflowService.retryWorkflow({
      org_identifier: opts.orgId,
      id: opts.workflowId,
      run_id: opts.runId,
      from_node: opts.fromNode,
    });
    return { ok: true };
  } catch (e: any) {
    const msg = e?.response?.data?.message;
    return { ok: false, error: humanizeNodeIds(msg, translate) };
  }
};

// Fetch the runs list into SHARED state (workflowObj.runsHistory), so the Runs page
// and the NDV's run switcher read one source. Stores the window it fetched for
// (`params`) and a `fetchedAt` stamp, so a later Refresh can re-pull the same
// window. On error the previous list is kept (a failed refresh shouldn't blank the
// switcher); the caller gets {ok,status} to surface load-error / permission UI.
export const loadRunsHistory = async (opts: {
  orgId: string;
  workflowId: string;
  start: number;
  end: number;
}): Promise<{ ok: boolean; status?: number }> => {
  const rh = workflowObj.runsHistory;
  rh.loading = true;
  try {
    const res = await workflowService.getWorkflowHistory({
      org_identifier: opts.orgId,
      id: opts.workflowId,
      start_time: opts.start,
      end_time: opts.end,
    });
    rh.list = Array.isArray(res.data) ? res.data : (res.data?.list ?? []);
    rh.params = { start: opts.start, end: opts.end };
    rh.fetchedAt = Date.now();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, status: e?.response?.status };
  } finally {
    rh.loading = false;
  }
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
    // Test run's `inputs`. Older runs only carried error_node_map (errored node's
    // input) — fall back to that.
    const inputs = payload.data?.input_map || payload.data?.error_node_map || {};
    // Per-node OUTPUT for the whole run — the stored counterpart of a Test run's
    // `outputs`, so the drawer reads a node's Output directly. Older runs predate
    // the output map → empty, and Output shows "run to view".
    const outputs = payload.data?.output_map || {};

    // GHOST NODES — the run references a node the workflow no longer has (it was
    // edited/deleted after the run). Its badge has nowhere to render, so an error
    // would silently vanish and the run would look cleaner than it was. Surface
    // them so the Runs view can say the graph no longer matches this run.
    const currentNodeIds = new Set((wf.nodes || []).map((n: any) => n.id));
    const ghostNodeIds = [
      ...new Set([...Object.keys(errors), ...Object.keys(inputs), ...Object.keys(outputs)]),
    ].filter((id) => !currentNodeIds.has(id));

    workflowObj.testRun.result = {
      errors,
      // Same per-node inputs/outputs maps as a Test run — drives the ✓/grey/✗
      // badges and the drawer's Input + Output for every node.
      inputs,
      outputs,
      ranNodeIds: (wf.nodes || []).map((n: any) => n.id),
      blockedNodeIds: downstreamOfErrorNodes(Object.keys(errors)),
      mode: "history",
      runId: opts.runId,
      ghostNodeIds,
      // The run-detail endpoint carries no event_type, so provenance is resolved
      // against the shared history list rather than the response itself.
      source: isTestRun(workflowObj.runsHistory.list.find((r: any) => r.run_id === opts.runId))
        ? "test"
        : "run",
    };
    return { ok: true };
  } catch (e: any) {
    {
      const msg = e?.response?.data?.message;
      markNodesFromError(msg);
      return { ok: false, error: humanizeNodeIds(msg, translate) };
    }
  }
};

// Remap one orphan branch edge to a declared arm: legacy `false` means "everything
// else", `true` means "the matching case"; anything else takes the first free arm.
// A fresh case is minted only when no free arm remains, so a healed arm is never
// double-routed and declared handles stay unique.
const healOrphanEdge = (node: any, edge: any, wired: Set<string>): void => {
  const caseHandles = (node.data.cases as any[]).map(
    (c: any, i: number) => c?.handle || `case-${i}`,
  );
  const firstFree = (handles: string[]) => handles.find((h) => !wired.has(h));
  let target: string | undefined;
  if (edge.sourceHandle === "false") target = wired.has("else") ? firstFree(caseHandles) : "else";
  else if (edge.sourceHandle === "true") target = firstFree(caseHandles);
  else target = firstFree([...caseHandles, "else"]);
  if (!target) target = appendBranchCase(node);
  wired.add(target);
  edge.sourceHandle = target;
  // serializeEdge prefers snake_case, so a stale copy would resurrect the dead handle on save.
  delete edge.source_handle;
};

// Drafts skip save-time validation, so a branch edge wired before its paths
// existed (legacy true/false arms, a deleted case, a missing handle) loads
// pointing at a handle the node does not declare — unpublishable, with no way to
// finish short of rebuilding the subtree. Heal on load instead. Returns whether
// anything changed, so the caller can keep the fix saveable (not a stored no-op).
const healBranchEdges = (nodes: any[], edges: any[]): boolean => {
  let changed = false;
  for (const node of nodes) {
    if (node?.data?.node_type !== "branch") continue;
    if (!Array.isArray(node.data.cases) || !node.data.cases.length) {
      node.data = { ...node.data, cases: [{ handle: "case-0", conditions: null }] };
      changed = true;
    }
    // The UI offers the else arm on every configured Branch; undeclared it fails publish.
    if (!node.data.else_handle) {
      node.data = { ...node.data, else_handle: "else" };
      changed = true;
    }
    const out = edges.filter((e: any) => (e.source ?? e.sourceNode?.id) === node.id);
    if (!out.length) continue;
    const declared = new Set(branchHandles(node));
    const wired = new Set<string>(
      out.map((e: any) => e.sourceHandle).filter((h: string) => declared.has(h)),
    );
    for (const edge of out) {
      if (edge.sourceHandle && declared.has(edge.sourceHandle)) continue;
      healOrphanEdge(node, edge, wired);
      changed = true;
    }
  }
  return changed;
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
    // The backend `Edge` has no serde rename, so a saved Branch edge comes back as
    // `source_handle`; without this the arm is lost on load and the workflow that
    // saved cleanly reloads as unroutable.
    const styled = makeEdge(src, tgt, e.source_handle ?? e.sourceHandle);
    return { ...e, ...styled, id: e.id || styled.id };
  });
  const healed = healBranchEdges(nodes, edges);
  // List rows carry `is_draft`; normalize it onto the store's `isDraft` so the
  // editor knows to save via the draft endpoints and to offer Publish.
  workflowObj.currentSelectedWorkflow = { ...wf, nodes, edges, isDraft: !!wf.is_draft };
  // Snapshot the NORMALIZED graph (VueFlow type + styled edges), not raw `wf`,
  // so any cancel/restore or dirty-compare baseline matches what's on canvas.
  workflowObj.workflowWithoutChange = JSON.parse(
    JSON.stringify(workflowObj.currentSelectedWorkflow),
  );
  // A healed graph differs from the server copy; a snapshot of it would make the very save that persists the fix read as a no-op.
  if (healed) workflowObj.storedSnapshot = "";
  else captureStoredSnapshot();
  workflowObj.isEditWorkflow = true;
  // A freshly-loaded workflow is clean and carries no prior local edit history.
  workflowObj.dirtyFlag = false;
  resetWorkflowHistory();
  // Claim the edit map for the workflow being loaded BEFORE restoring, so the previous
  // workflow's edits are dropped even when this one has nothing stored.
  const loadedId = workflowObj.currentSelectedWorkflow.id || "";
  claimEditedInputs(loadedId);
  // The DOCUMENT is the source of truth for which nodes are tested, so it wins over
  // this browser's session copy; the session blob only re-attaches the recorded
  // input/output records, which are too large to live in the workflow itself.
  workflowObj.testRun.result = null;
  const fromDoc = restoreTestStateFromNodes();
  restoreTestData(loadedId, { keepDocumentState: fromDoc });
};

export default function useWorkflowCanvas(t: TranslateFn) {
  translate = t;
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
      newEdge(connection.source, connection.target, routableHandle(connection.sourceHandle)),
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
    // If the deleted node's NDV is open, close it.
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

  // The empty-canvas start scaffold's second slot: the same picker restricted to
  // the addable (non-trigger) node types. Mirrors openTriggerPicker — the click
  // point becomes the placed node's position (see addActionFromStart). `mode`
  // "action" means "the workflow's FIRST step" (no parent yet), as distinct from
  // "next" (extend a specific node).
  function openActionPicker(event: MouseEvent) {
    workflowObj.stepPicker = {
      show: true,
      source: "",
      handle: "out",
      mode: "action",
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
      data: initialNodeData(nodeType, id),
      meta: { incomplete: "true" },
    };
    // No auto-wire on drag-drop — the node is placed where dropped and stays
    // unconnected until the user draws an edge.
    workflowObj.pendingEdge = null;
    workflowObj.pendingInsert = null;
    workflowObj.currentSelectedNodeID = id;
    workflowObj.dialog.name = nodeType;
    workflowObj.dialog.expand = false;
    commitStagedNode();
    closeNodeDrawer();
  }

  // Start node picked: ADD the workflow's first (trigger) node to the canvas and
  // open its panel. Like every other add now, it lands on the canvas immediately
  // (commitStagedNode is the shared path for the config nodes); the trigger is the
  // one node with a READ-ONLY panel, so there's simply nothing to commit on close.
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
    const wf = workflowObj.currentSelectedWorkflow;
    const id = getUUID();
    wf.nodes = [
      ...wf.nodes,
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
    // Empty-canvas scaffold "Action first" path: if the user placed the action
    // step BEFORE the trigger, the canvas holds exactly that one orphan step —
    // auto-wire the new trigger into it so the two-node chain the scaffold implied
    // is connected, instead of stranding an unlinked step. Guarded to the single
    // orphan case so re-adding a trigger to a larger graph never wires blindly.
    const others = wf.nodes.filter((n: any) => n.id !== id);
    if (others.length === 1) {
      const only = others[0];
      const hasIncoming = (wf.edges || []).some((e: any) => e.target === only.id);
      if (!hasIncoming && only.data?.node_type !== "workflow_trigger") {
        wf.edges = [...(wf.edges || []), newEdge(id, only.id)];
      }
    }
    markWorkflowDirty();
    // Don't auto-open the trigger's (read-only) detail panel — placing the trigger
    // shouldn't interrupt the build flow. The user can click the node to open it.
  }

  // Empty-canvas scaffold "Action" slot picked: place the workflow's FIRST step.
  // When a trigger already exists (the common flow — trigger picked first), append
  // + auto-wire after the chain end, exactly like the palette add. When there's no
  // trigger yet (the user clicked Action before Trigger), drop the step UNCONNECTED
  // at the scaffold's action-slot position; adding the trigger afterwards auto-wires
  // into it (see addTriggerNode). `position` is the click point the scaffold card
  // sat at. Like every add, the node lands as an unconfigured DUMMY — its config
  // panel opens only when the user clicks it, not on add.
  function addActionFromStart(nodeType: string, position: { x: number; y: number } | null) {
    if (hasTrigger()) {
      const src = endNodeId();
      if (src) addNodeAfter(src, "out", nodeType);
      return;
    }
    const meta = nodeMeta(nodeType);
    if (!meta) return;
    const id = getUUID();
    workflowObj.currentSelectedNodeData = {
      id,
      type: meta.ioType,
      position: position ?? { x: 320, y: 240 },
      data: initialNodeData(nodeType, id),
      meta: { incomplete: "true" },
    };
    // Unconnected — no trigger to wire from yet; the trigger add links it later.
    workflowObj.pendingEdge = null;
    workflowObj.pendingInsert = null;
    workflowObj.currentSelectedNodeID = id;
    workflowObj.dialog.name = nodeType;
    workflowObj.dialog.expand = false;
    commitStagedNode();
    closeNodeDrawer();
  }

  const NODE_W = 240;
  // Vertical gap between a node and the next row (matches addNodeAfter / tidy).
  const INSERT_ROW_GAP = 160;
  function addNodeAfter(sourceId: string, handle: string, nodeType: string) {
    const wf = workflowObj.currentSelectedWorkflow;
    const src = wf.nodes.find((n: any) => n.id === sourceId);
    const meta = nodeMeta(nodeType);
    if (!src || !meta) return;

    // The `+` on a fully wired Branch adds a PATH, so mint the case first — wiring to
    // the sentinel itself would leave the edge pointing at a handle that never exists.
    if (handle === NEW_BRANCH_PATH_HANDLE) handle = appendBranchCase(src);

    const id = getUUID();
    const sourceHandle = handle === "out" ? undefined : handle;
    // Offset siblings on the same output so they don't overlap (fan-out).
    const siblings = wf.edges.filter(
      (e: any) => e.source === sourceId && (e.sourceHandle || undefined) === sourceHandle,
    ).length;
    // Each arm needs its own column: without the handle index every arm's first child stacks up.
    const armIndex = Math.max(0, branchHandles(src).indexOf(handle));
    const position = {
      x: (src.position?.x ?? 0) + (siblings + armIndex) * (NODE_W + 40),
      y: (src.position?.y ?? 0) + 160,
    };

    workflowObj.currentSelectedNodeData = {
      id,
      // VueFlow render template (UI only) — derived from node_type, not stored.
      type: meta.ioType,
      position,
      data: initialNodeData(nodeType, id),
      // A freshly-added config node is an unconfigured placeholder until the panel
      // is closed with its payload; flag it so it shows the "Set up later" badge and
      // Publish stays blocked.
      meta: { incomplete: "true" },
    };
    workflowObj.pendingEdge = { source: sourceId, sourceHandle };
    workflowObj.pendingInsert = null;
    workflowObj.currentSelectedNodeID = id;
    workflowObj.dialog.name = nodeType;
    workflowObj.dialog.expand = false;
    // Insert-immediately (no Save button): the node lands on the canvas + auto-wires
    // now, and the panel does NOT open — adding several steps in a row shouldn't mean
    // dismissing a dialog each time. It arrives flagged incomplete ("Set up later")
    // and is configured by clicking it, which is what blocks Publish until it's done.
    commitStagedNode();
    closeNodeDrawer();
  }

  // Insert-on-edge (T7): splice a node onto edge A→B. commitStagedNode removes the
  // old edge and creates A→new + new→B immediately. The node is positioned a row
  // below A, aligned with B's column; B (and its subtree) is nudged down so it
  // doesn't overlap.
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
    // target's column (so new→target reads as a straight edge). commitStagedNode
    // then nudges the target + downstream down to keep a full row of breathing room
    // below the new node.
    const position = {
      x: tgt.position?.x ?? src.position?.x ?? 0,
      y: (src.position?.y ?? 0) + INSERT_ROW_GAP,
    };
    workflowObj.currentSelectedNodeData = {
      id,
      type: meta.ioType,
      position,
      data: initialNodeData(nodeType, id),
      meta: { incomplete: "true" },
    };
    workflowObj.pendingEdge = null;
    workflowObj.pendingInsert = {
      edgeId,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
    };
    workflowObj.currentSelectedNodeID = id;
    workflowObj.dialog.name = nodeType;
    workflowObj.dialog.expand = false;
    commitStagedNode();
    closeNodeDrawer();
  }

  // Insert the staged node (currentSelectedNodeData) onto the canvas immediately —
  // the "insert-immediately" half of the Save-less node panel. Adds the node and
  // its auto-wired edge (append via pendingEdge, or splice A→new→B via
  // pendingInsert), leaves it in EDIT mode, and does NOT touch the dialog. The panel
  // then opens on this now-real node; closing it commits the node's config
  // (applyNodeConfig). One undo reverts the whole insert (edges included).
  function commitStagedNode() {
    const wf = workflowObj.currentSelectedWorkflow;
    const node = workflowObj.currentSelectedNodeData;
    if (!node) return;
    pushWorkflowHistory();
    if (workflowObj.pendingInsert) {
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
    // The node is now a real, committed node on the canvas — edit mode from here.
    workflowObj.isEditNode = true;
    markWorkflowDirty();
  }

  // Merge the body's config payload into the already-committed node, in place,
  // WITHOUT closing the panel. Change-gated — identical data writes nothing and does
  // NOT mark dirty (e.g. open + close with no edit). Used both by the panel-close
  // commit and by the NDV Replay (which commits, then re-runs, staying open).
  function mergeNodeConfig(payload: any = {}) {
    const wf = workflowObj.currentSelectedWorkflow;
    const node = workflowObj.currentSelectedNodeData;
    if (!node) return;
    const merged = { ...node.data, ...payload };
    const previous = node.data;
    // Semantic: the builder re-emits stored v1 rules as v2, so a raw compare called a look an edit.
    if (isEqual(semanticConfig(merged), semanticConfig(previous))) return;
    pushWorkflowHistory();
    node.data = merged;
    const idx = wf.nodes.findIndex((n: any) => n.id === node.id);
    if (idx !== -1) wf.nodes[idx] = node;
    // The Test log itself PERSISTS across edits (the dock stays open); the edited node
    // and its next steps just go amber until re-tested.
    markTestResultDirty(node.id);
    markWorkflowDirty();
  }

  // Node panel CLOSE (there is no Save button): commit the config, then close.
  function applyNodeConfig(payload: any = {}) {
    mergeNodeConfig(payload);
    closeNodeDrawer();
  }

  // Close the node panel without deleting anything (the node is already on the
  // canvas — insert-immediately). Just clears the selection + dialog state.
  function closeNodeDrawer() {
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
    workflowObj.storedSnapshot = "";
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
    workflowObj.incompleteHighlight = [];
    workflowObj.runsHistory = {
      list: [],
      fetchedAt: 0,
      params: { start: 0, end: 0 },
      loading: false,
    };
    workflowObj.testRun = {
      show: false,
      input: "",
      fromNode: "",
      inputSource: "sample",
      inputRunLabel: "",
      // Must carry EVERY key the default declares: dropping this one left it
      // undefined, one refactor away from a Test dispatching to real destinations.
      suppressDestinations: true,
      result: null,
    };
    editedInputsWorkflowId = "";
    nodeEditedInputs = {};
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
    openActionPicker,
    openInsertPicker,
    closeStepPicker,
    addTriggerNode,
    addActionFromStart,
    addNodeAfter,
    addNodeOnEdge,
    addNodeToEnd,
    endNodeId,
    onDragStart,
    onDragOver,
    onDrop,
    applyNodeConfig,
    mergeNodeConfig,
    closeNodeDrawer,
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

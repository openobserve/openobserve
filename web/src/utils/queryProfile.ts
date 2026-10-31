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

import { parseQueryPlanTree, formatTime, type OperatorNode } from "@/utils/queryPlanParser";
import { formatLargeNumber, formatSizeFromMB } from "@/utils/formatters";

export const CARD_W = 236;
export const CARD_H = 76;
export const SIBLING_GAP = 28;
export const LEVEL_GAP = 44;
export const VARIANT_GAP = 32;
export const STAGE_PAD_X = 20;
export const STAGE_PAD_TOP = 64;
export const STAGE_PAD_BOTTOM = 20;
export const FOLD_H = 56;
const EDGE_LABEL_RISE = 13;
export const STRAGGLER_FACTOR = 1.8;

const NODE_SCOPE_PREFIX = "node:";
const PLACEHOLDER_SCAN = "NewEmptyExec";

export type MetricKind =
  "count" | "time" | "bytes" | "gauge" | "ratio" | "pruning" | "timestamp" | "other";

export interface ProfileMetric {
  name: string;
  kind: MetricKind | string;
  value: number;
  total?: number;
  max: number;
}

export interface ProfileNode {
  name: string;
  detail: string;
  partitions: number;
  metrics?: ProfileMetric[];
  children?: ProfileNode[];
  remote?: RemoteNodeProfile[];
}

export interface RemoteScanStats {
  files: number;
  records: number;
  original_size: number;
  compressed_size: number;
  querier_files: number;
  querier_memory_cached_files: number;
  querier_disk_cached_files: number;
  idx_scan_size: number;
  idx_took: number;
  file_list_took: number;
  aggs_cache_ratio: number;
  peak_memory_usage: number;
  wait_in_queue: number;
}

export interface RemoteNodeProfile {
  partition: number;
  node_name: string;
  node_address: string;
  role: string;
  region: string;
  cluster: string;
  start_us: number;
  first_batch_us: number;
  end_us: number;
  output_rows: number;
  output_batches: number;
  output_bytes: number;
  fetch_ns: number;
  decode_ns: number;
  assigned_files: number;
  skipped: boolean;
  error: string;
  peak_memory: number;
  scan_stats?: RemoteScanStats;
  plan?: ProfileNode;
}

export interface QueryProfile {
  version: number;
  node_name: string;
  node_address: string;
  start_us: number;
  end_us: number;
  output_rows: number;
  plan: ProfileNode;
}

export interface TookDetail {
  total: number;
  cache_took: number;
  file_list_took: number;
  wait_in_queue: number;
  idx_took: number;
  search_took: number;
}

export interface PlanHit {
  phase?: number;
  node_address?: string;
  node_name?: string;
  plan?: string;
  profile?: string | null;
  [key: string]: unknown;
}

export interface SearchStreamResult {
  hits: PlanHit[];
  /** The query failed; the stream reports this in an `error` event of a 200 response. */
  error?: string;
  took?: number;
  took_detail?: TookDetail;
  scan_size?: number;
  scan_records?: number;
  scan_files?: number;
}

export type OperatorCategory =
  "scan" | "filter" | "join" | "agg" | "sort" | "exchange" | "projection" | "remote" | "other";

/** "sum" | "max" | "node:<key>" — rescopes the numbers of operators that run on many nodes. */
export type StageScope = string;

export interface OperatorSample {
  nodeKey: string;
  computeNs: number;
  rows: number;
  metrics: ProfileMetric[];
}

export interface ProfileOperator {
  id: string;
  name: string;
  detail: string;
  category: OperatorCategory;
  partitions: number;
  parentId: string | null;
  childIds: string[];
  stageId: string | null;
  variantId: string | null;
  remoteStageId: string | null;
  samples: OperatorSample[];
  totalComputeNs: number;
  totalRows: number;
}

export type PlanSource = "profile" | "text" | "none";

export interface StageNode {
  key: string;
  name: string;
  role: string;
  /** Set only when the profile spans several clusters and the name alone does not say which. */
  cluster: string;
  /** A super-cluster entry that stands for a whole cluster, not one node. */
  clusterEntry: boolean;
  remote: RemoteNodeProfile;
  wallUs: number;
  firstBatchUs: number;
  straggler: boolean;
  variantId: string | null;
  planSource: PlanSource;
}

export type VariantRole = "querier" | "ingester" | "mixed";

export interface StageVariant {
  id: string;
  stageId: string;
  nodeKeys: string[];
  role: VariantRole;
  nodeNames: string[];
  rootOpId: string;
}

export interface ProfileStage {
  id: string;
  index: number;
  remoteOpId: string;
  parentStageId: string | null;
  nodes: StageNode[];
  variants: StageVariant[];
  medianWallUs: number;
  maxWallUs: number;
}

export interface ProfileModel {
  profile: QueryProfile;
  rootId: string;
  operators: Record<string, ProfileOperator>;
  order: string[];
  stages: ProfileStage[];
  stageById: Record<string, ProfileStage>;
  variantById: Record<string, StageVariant>;
  totalComputeNs: number;
  leaderKey: string;
  planOnly: boolean;
}

export interface BuildProfileOptions {
  /** The profile came from a plain EXPLAIN, so it carries no runtime numbers. */
  planOnly?: boolean;
}

export interface ScopedValue {
  computeNs: number;
  rows: number;
  on: boolean;
}

export interface NodeRow {
  nodeKey: string;
  name: string;
  cluster: string;
  computeNs: number;
  rows: number;
  share: number;
  straggler: boolean;
}

export interface MetricSections {
  timing: ProfileMetric[];
  pruning: ProfileMetric[];
  ratios: ProfileMetric[];
  counters: ProfileMetric[];
}

export type PhaseId = "queue" | "fileList" | "index" | "execution" | "other";

export interface QueryPhase {
  id: PhaseId;
  ms: number;
}

export interface TimelineSegment {
  stageIndex: number;
  startUs: number;
  endUs: number;
  straggler: boolean;
}

export interface TimelineRow {
  nodeKey: string;
  name: string;
  role: string;
  segments: TimelineSegment[];
  durationUs: number;
}

export interface StragglerInfo {
  nodeKey: string;
  name: string;
  stageIndex: number;
  wallUs: number;
  ratio: number;
}

export interface ProfileSummary {
  wallMs: number;
  totalComputeNs: number;
  resultRows: number;
  peakMemory: { bytes: number; node: string } | null;
  nodeCounts: { queriers: number; ingesters: number; other: number; total: number };
  leaderName: string;
  scanned: { files: number; bytes: number; rows: number } | null;
  phases: QueryPhase[] | null;
  byCategory: { category: OperatorCategory; ns: number }[];
  hotspots: string[];
  timeline: { rows: TimelineRow[]; spanUs: number };
  stragglers: StragglerInfo[];
}

export interface LayoutCard {
  opId: string;
  x: number;
  y: number;
  /** Whether the branch under this card can be collapsed, and its current state. */
  branch: "open" | "collapsed" | null;
  /** A plumbing operator the user opened from its edge, which can fold back. */
  refold: boolean;
}

export interface LayoutEdge {
  key: string;
  /** The operator whose output the parent reads; null when the child is a fold card. */
  childId: string | null;
  /** The card the edge starts at; null when the child is a fold card. */
  fromId: string | null;
  parentId: string;
  /** Plumbing operators folded onto this edge, top first. */
  folded: string[];
  path: string;
  labelX: number;
  labelY: number;
}

export type FoldKind = "branch" | "group" | "stage";

/** One card standing in for operators the canvas does not draw. */
export interface LayoutFold {
  key: string;
  kind: FoldKind;
  /** branch: the owner's children; group: the hidden siblings; stage: the stage's variant roots. */
  opIds: string[];
  /** The visible card this fold hangs under. */
  ownerId: string;
  /** Hidden by focus rather than by the user collapsing it. */
  focus: boolean;
  x: number;
  y: number;
}

export interface FoldState {
  /** Fold single-child plumbing operators onto the edge they sit on. */
  plumbing: boolean;
  /** Plumbing operators the user opened back into cards. */
  shown: ReadonlySet<string>;
  /** Operators whose branch below is hidden behind one card. */
  collapsed: ReadonlySet<string>;
  /** Operators hidden whole; hidden siblings share one card. */
  grouped: ReadonlySet<string>;
  /** Stages drawn as a single summary card. */
  stages: ReadonlySet<string>;
  focusId: string | null;
}

export interface LayoutStage {
  stageId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutVariantLabel {
  variantId: string;
  x: number;
  y: number;
  w: number;
}

export interface ProfileLayout {
  width: number;
  height: number;
  cards: LayoutCard[];
  edges: LayoutEdge[];
  stages: LayoutStage[];
  variantLabels: LayoutVariantLabel[];
  folds: LayoutFold[];
}

export interface PlanDetailEntry {
  key: string;
  value: string;
}

export interface PlanScanInfo {
  opId: string;
  stream: string;
  filters: string[];
  columns: string[];
  sortOrder: string;
}

export interface PlanSummary {
  streams: string[];
  leaderOps: number;
  remoteOps: number;
  fetch: number | null;
  scans: PlanScanInfo[];
  leaderCategories: OperatorCategory[];
}

interface PlanPart {
  nodeKey: string;
  plan: ProfileNode;
  remote: RemoteNodeProfile[];
}

interface BuildContext {
  ops: Record<string, ProfileOperator>;
  order: string[];
  stages: ProfileStage[];
  hits: PlanHit[];
  usedHits: Set<PlanHit>;
  multiCluster: boolean;
}

interface Box {
  w: number;
  h: number;
}

const CATEGORY_RULES: [RegExp, OperatorCategory][] = [
  [/^Remote\w*Exec/i, "remote"],
  [/Filter/i, "filter"],
  [/Join/i, "join"],
  [/Aggregate|Window/i, "agg"],
  [/Sort|TopK/i, "sort"],
  [/Repartition|Coalesce|Union|Interleave|Exchange|Merge/i, "exchange"],
  [/Projection/i, "projection"],
  [/DataSource|Parquet|MemTable|Memory|Scan|Empty|PlaceholderRow|Tantivy|Wal/i, "scan"],
];

/** Classifies a DataFusion operator name into the colour/legend family it belongs to. */
export function operatorCategory(name: string): OperatorCategory {
  for (const [re, category] of CATEGORY_RULES) {
    if (re.test(name)) return category;
  }
  return "other";
}

/** Short card title: the operator name without its `Exec` suffix, plus the aggregate mode. */
export function operatorLabel(op: Pick<ProfileOperator, "name" | "detail">): string {
  const variant = op.name.match(/^(\w+?)Exec\((\w+)\)$/);
  const base = variant ? variant[1] : op.name.replace(/Exec$/, "") || op.name;
  const mode =
    variant?.[2] ??
    op.detail.match(/mode=(\w+)/)?.[1] ??
    (/(^|:\s*)TopK\(/.test(op.detail) ? "TopK" : null);
  return mode ? `${base} · ${mode}` : base;
}

export function isPlaceholderScan(op: Pick<ProfileOperator, "name">): boolean {
  return op.name === PLACEHOLDER_SCAN;
}

/** Splits on commas outside brackets, parentheses, braces and quotes. */
export function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if ("([{".includes(ch)) {
      depth++;
    } else if (")]}".includes(ch)) {
      depth = Math.max(0, depth - 1);
    } else if (ch === "," && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Drops DataFusion's `@N` column indexes, `x as x` self-aliases and `Utf8("v")` literal wrappers. */
export function cleanPlanExpr(text: string): string {
  return text
    .replace(/([\w)\]"])@\d+\b/g, "$1")
    .replace(/\b([\w.]+) as \1\b/g, "$1")
    .replace(/Utf8(?:View)?\("((?:[^"\\]|\\.)*)"\)/g, "'$1'");
}

function unquote(text: string): string {
  const m = text.match(/^"((?:[^"\\]|\\.)*)"$/s);
  return m ? m[1].replace(/\\(.)/g, "$1") : text;
}

/** Items of a `[a, "b", c]` plan value, unquoted and cleaned. */
export function planList(value: string): string[] {
  const inner = value.trim().replace(/^\[(.*)\]$/s, "$1");
  return splitTopLevel(inner).map((item) => cleanPlanExpr(unquote(item)));
}

export function formatPlanValue(value: string): string {
  return /^\[.*\]$/s.test(value.trim()) ? planList(value).join(", ") : unquote(value);
}

/** Top-level `key=value` pairs of an operator line; positional parts get an empty key. */
export function parsePlanDetail(detail: string): PlanDetailEntry[] {
  const body = detail.match(/^\s*\w+:\s?(.*)$/s)?.[1];
  if (!body) return [];
  return splitTopLevel(body).map((part) => {
    const m = part.match(/^([A-Za-z_][\w.]*)=(.*)$/s);
    return m ? { key: m[1], value: cleanPlanExpr(m[2]) } : { key: "", value: cleanPlanExpr(part) };
  });
}

export function planFetch(detail: string): number | null {
  const m = detail.match(/\bfetch=(\d+)/);
  return m ? Number(m[1]) : null;
}

function entryValue(entries: PlanDetailEntry[], key: string): string {
  return entries.find((e) => e.key === key)?.value ?? "";
}

export function planScanInfo(op: Pick<ProfileOperator, "id" | "detail">): PlanScanInfo {
  const entries = parsePlanDetail(op.detail);
  const list = (key: string) => {
    const value = entryValue(entries, key);
    return value ? planList(value) : [];
  };
  return {
    opId: op.id,
    stream: unquote(entryValue(entries, "name")),
    filters: list("filters"),
    columns: list("projection"),
    sortOrder: entryValue(entries, "sort_order"),
  };
}

export function planAggregate(detail: string): { groupBy: string[]; aggr: string[] } {
  const entries = parsePlanDetail(detail);
  const list = (key: string) => {
    const value = entryValue(entries, key);
    return value ? planList(value) : [];
  };
  return { groupBy: list("gby"), aggr: list("aggr") };
}

function sortSummary(entries: PlanDetailEntry[], detail: string): string {
  const exprs = entryValue(entries, "expr") || entries.find((e) => /^\[/.test(e.value))?.value;
  const fetch = planFetch(detail);
  const parts = [exprs ? planList(exprs).join(", ") : "", fetch !== null ? `fetch=${fetch}` : ""];
  return parts.filter(Boolean).join(" · ");
}

function partitioningSummary(value: string): string {
  const m = value.match(/^(\w+)\((.*)\)$/s);
  if (!m) return value;
  const args = splitTopLevel(m[2]);
  if (args.length < 2) return `${m[1]} · ${args[0] ?? ""}`;
  return `${m[1]}(${formatPlanValue(args[0])}) · ${args[args.length - 1]}`;
}

/** Readable one-line detail for a plan card; scans, aggregates and remote scans are worded by the caller. */
export function planOperatorSummary(
  op: Pick<ProfileOperator, "name" | "detail" | "category">,
): string {
  const entries = parsePlanDetail(op.detail);
  const positional = entries.filter((e) => !e.key).map((e) => e.value);
  if (op.category === "filter") return positional[0] ?? "";
  if (op.category === "sort") return sortSummary(entries, op.detail);
  if (op.category === "projection") return formatPlanValue(entryValue(entries, "expr"));
  const partitioning = entryValue(entries, "partitioning");
  if (partitioning) return partitioningSummary(partitioning);
  return entries.map((e) => (e.key ? `${e.key}=${formatPlanValue(e.value)}` : e.value)).join(", ");
}

export function nodeScope(nodeKey: string): StageScope {
  return `${NODE_SCOPE_PREFIX}${nodeKey}`;
}

export function scopeNodeKey(scope: StageScope): string | null {
  return scope.startsWith(NODE_SCOPE_PREFIX) ? scope.slice(NODE_SCOPE_PREFIX.length) : null;
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function findMetric(metrics: ProfileMetric[] | undefined, name: string) {
  return metrics?.find((m) => m.name === name);
}

/** Operator compute time in ns: `elapsed_compute`, else `time_elapsed_processing` (scans), else 0. */
export function computeTimeNs(metrics: ProfileMetric[] | undefined): number {
  const m =
    findMetric(metrics, "elapsed_compute") ?? findMetric(metrics, "time_elapsed_processing");
  return m ? Number(m.value) || 0 : 0;
}

export function outputRows(metrics: ProfileMetric[] | undefined): number {
  return Number(findMetric(metrics, "output_rows")?.value) || 0;
}

export function isRemoteNode(node: ProfileNode): boolean {
  return /^Remote\w*Exec/i.test(node.name) || (node.remote?.length ?? 0) > 0;
}

/** Plan-shape fingerprint: the tree of operator names; nested remote scans stop the walk. */
export function planFingerprint(node: ProfileNode): string {
  if (isRemoteNode(node)) return node.name;
  const kids = (node.children ?? []).map(planFingerprint);
  return kids.length ? `${node.name}(${kids.join(",")})` : node.name;
}

export function remoteWallUs(remote: RemoteNodeProfile): number {
  return remote.end_us > remote.start_us ? remote.end_us - remote.start_us : 0;
}

/** Splits every `data:` JSON payload of an SSE body and merges hits plus response metadata. */
export function parseSearchStream(sseText: string): SearchStreamResult | null {
  if (!sseText || typeof sseText !== "string") return null;
  const merged: SearchStreamResult = { hits: [] };
  let found = false;
  let currentEvent = "";
  for (const line of sseText.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("event:")) {
      currentEvent = trimmed.substring(6).trim();
      continue;
    }
    if (!trimmed.startsWith("data:") || currentEvent === "progress") continue;
    const parsed = parseJson(trimmed.substring(5).trim());
    if (currentEvent === "error") {
      merged.error = streamErrorMessage(parsed);
      found = true;
      continue;
    }
    if (parsed && typeof parsed === "object") found = mergeStreamEvent(merged, parsed) || found;
  }
  return found ? merged : null;
}

function streamErrorMessage(event: Record<string, unknown> | null): string {
  const text = [event?.message, event?.error_detail].find((v) => typeof v === "string" && v);
  return (text as string | undefined) ?? "";
}

function parseJson(text: string): Record<string, unknown> | null {
  if (!text || text === "[[DONE]]") return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function mergeStreamEvent(merged: SearchStreamResult, event: Record<string, unknown>): boolean {
  const results = (event.results as Record<string, unknown> | undefined) ?? event;
  let found = false;
  if (Array.isArray(event.hits)) {
    merged.hits.push(...(event.hits as PlanHit[]));
    found = true;
  } else if (event.results && Array.isArray(results.hits)) {
    merged.hits.push(...(results.hits as PlanHit[]));
    found = true;
  }
  if (results.took_detail && typeof results.took_detail === "object") {
    merged.took_detail = results.took_detail as TookDetail;
  }
  for (const key of ["took", "scan_size", "scan_records", "scan_files"] as const) {
    if (typeof results[key] === "number") merged[key] = results[key] as number;
  }
  return found || results.total !== undefined;
}

/** Reads the structured profile from the phase-0 hit; null on older servers or bad JSON. */
export function extractProfile(hits: PlanHit[] | undefined): QueryProfile | null {
  const raw = hits?.find((h) => typeof h.profile === "string" && h.profile)?.profile;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as QueryProfile;
    return parsed && parsed.plan && typeof parsed.plan.name === "string" ? parsed : null;
  } catch {
    return null;
  }
}

/** Converts an old-style text plan node into the profile shape so it can join a stage. */
export function textPlanToProfile(node: OperatorNode): ProfileNode {
  const metrics: ProfileMetric[] = [];
  const ms = Number(node.metrics.elapsed_compute_ms);
  if (ms > 0) {
    metrics.push({ name: "elapsed_compute", kind: "time", value: ms * 1e6, max: ms * 1e6 });
  }
  const rows = Number(node.metrics.output_rows);
  if (rows > 0) metrics.push({ name: "output_rows", kind: "count", value: rows, max: rows });
  return {
    name: node.name,
    detail: node.fullText,
    partitions: 0,
    metrics,
    children: node.children.map(textPlanToProfile),
  };
}

function planOnlyRemote(plan: ProfileNode): RemoteNodeProfile {
  return {
    partition: 0,
    node_name: "",
    node_address: "",
    role: "",
    region: "",
    cluster: "",
    start_us: 0,
    first_batch_us: 0,
    end_us: 0,
    output_rows: 0,
    output_batches: 0,
    output_bytes: 0,
    fetch_ns: 0,
    decode_ns: 0,
    assigned_files: 0,
    skipped: false,
    error: "",
    peak_memory: 0,
    plan,
  };
}

function planRoot(nodes: OperatorNode[]): ProfileNode {
  if (nodes.length === 1) return planNodeToProfile(nodes[0]);
  return { name: "Plan", detail: "", partitions: 0, children: nodes.map(planNodeToProfile) };
}

function planNodeToProfile(node: OperatorNode): ProfileNode {
  const base = { name: node.name, detail: node.fullText, partitions: 0 };
  if (!/^Remote\w*Exec/i.test(node.name)) {
    return { ...base, children: node.children.map(planNodeToProfile) };
  }
  // the text under a remote scan is the plan every remote node runs, so it becomes one stage entry
  const remote = node.children.length ? [planOnlyRemote(planRoot(node.children))] : [];
  return { ...base, children: [], remote };
}

/** Turns a plain EXPLAIN physical plan into a profile without runtime numbers; null when it has no operators. */
export function physicalPlanToProfile(planText: string): QueryProfile | null {
  const root = parseQueryPlanTree(planText);
  if (!root.children.length) return null;
  return {
    version: 0,
    node_name: "",
    node_address: "",
    start_us: 0,
    end_us: 0,
    output_rows: 0,
    plan: planRoot(root.children),
  };
}

function fallbackPlan(remote: RemoteNodeProfile, ctx: BuildContext): ProfileNode | null {
  const hit = ctx.hits.find(
    (h) =>
      !ctx.usedHits.has(h) &&
      (h.phase ?? 0) >= 1 &&
      typeof h.plan === "string" &&
      h.plan.trim() !== "" &&
      ((!!remote.node_address && h.node_address === remote.node_address) ||
        (!!remote.node_name && h.node_name === remote.node_name)),
  );
  if (!hit) return null;
  ctx.usedHits.add(hit);
  const root = parseQueryPlanTree(hit.plan as string);
  if (!root.children.length) return null;
  if (root.children.length === 1) return textPlanToProfile(root.children[0]);
  return {
    name: "Plan",
    detail: "",
    partitions: 0,
    children: root.children.map(textPlanToProfile),
  };
}

function sampleOf(part: PlanPart, isRemote: boolean): OperatorSample {
  const metrics = part.plan.metrics ?? [];
  if (!isRemote) {
    return {
      nodeKey: part.nodeKey,
      computeNs: computeTimeNs(metrics),
      rows: outputRows(metrics),
      metrics,
    };
  }
  const decode = part.remote.reduce((a, r) => a + (r.decode_ns || 0), 0);
  const rows = findMetric(metrics, "output_rows")
    ? outputRows(metrics)
    : part.remote.reduce((a, r) => a + (r.output_rows || 0), 0);
  return { nodeKey: part.nodeKey, computeNs: decode, rows, metrics };
}

function addOperator(
  id: string,
  parts: PlanPart[],
  parentId: string | null,
  stageId: string | null,
  variantId: string | null,
  ctx: BuildContext,
): string {
  const template = parts[0].plan;
  const remote = isRemoteNode(template);
  const samples = parts.map((p) => sampleOf(p, remote));
  const op: ProfileOperator = {
    id,
    name: template.name,
    detail: template.detail ?? "",
    category: operatorCategory(template.name),
    partitions: template.partitions ?? 0,
    parentId,
    childIds: [],
    stageId,
    variantId,
    remoteStageId: null,
    samples,
    totalComputeNs: samples.reduce((a, s) => a + s.computeNs, 0),
    totalRows: samples.reduce((a, s) => a + s.rows, 0),
  };
  ctx.ops[id] = op;
  ctx.order.push(id);
  if (remote) {
    const entries = parts.flatMap((p) => p.remote);
    const stage = buildStage(entries, id, stageId, ctx);
    op.remoteStageId = stage.id;
    op.childIds = stage.variants.map((v) => v.rootOpId);
    return id;
  }
  (template.children ?? []).forEach((_, i) => {
    const childParts = parts
      .filter((p) => p.plan.children?.[i])
      .map((p) => {
        const plan = p.plan.children![i];
        return { nodeKey: p.nodeKey, plan, remote: plan.remote ?? [] };
      });
    op.childIds.push(addOperator(`${id}.${i}`, childParts, id, stageId, variantId, ctx));
  });
  return id;
}

function stageNodeKey(remote: RemoteNodeProfile, cluster: string, used: Set<string>): string {
  const name = remote.node_name || remote.node_address || `partition-${remote.partition}`;
  const base = cluster ? `${cluster}/${name}` : name;
  let key = base;
  for (let i = 1; used.has(key); i++) key = `${base}#${i}`;
  used.add(key);
  return key;
}

function collectClusters(node: ProfileNode, out: Set<string>): Set<string> {
  for (const r of node.remote ?? []) {
    if (r.cluster) out.add(r.cluster);
    if (r.plan) collectClusters(r.plan, out);
  }
  for (const c of node.children ?? []) collectClusters(c, out);
  return out;
}

function variantRole(nodes: StageNode[]): VariantRole {
  const roles = new Set(
    nodes.map((n) =>
      n.role.includes("querier") ? "querier" : n.role.includes("ingester") ? "ingester" : "other",
    ),
  );
  if (roles.size !== 1) return "mixed";
  const only = [...roles][0];
  return only === "other" ? "mixed" : only;
}

function markStragglers(nodes: StageNode[]): { medianWallUs: number; maxWallUs: number } {
  const walls = nodes.filter((n) => !n.remote.skipped && n.wallUs > 0).map((n) => n.wallUs);
  const med = median(walls);
  const canFlag = walls.length >= 2 && med > 0;
  for (const n of nodes) n.straggler = canFlag && n.wallUs > STRAGGLER_FACTOR * med;
  return { medianWallUs: med, maxWallUs: walls.length ? Math.max(...walls) : 0 };
}

function buildStage(
  entries: RemoteNodeProfile[],
  remoteOpId: string,
  parentStageId: string | null,
  ctx: BuildContext,
): ProfileStage {
  const index = ctx.stages.length + 1;
  const stage: ProfileStage = {
    id: `s${index}`,
    index,
    remoteOpId,
    parentStageId,
    nodes: [],
    variants: [],
    medianWallUs: 0,
    maxWallUs: 0,
  };
  ctx.stages.push(stage);
  const used = new Set<string>();
  const groups = new Map<string, { nodes: StageNode[]; parts: PlanPart[] }>();
  for (const remote of entries) {
    const plan = remote.plan ?? fallbackPlan(remote, ctx);
    const name = remote.node_name || remote.node_address || `#${remote.partition}`;
    // pod names repeat across clusters deployed from one chart, so the cluster tells them apart
    const clusterEntry = ctx.multiCluster && remote.cluster === remote.node_name;
    const cluster = ctx.multiCluster && !clusterEntry ? (remote.cluster ?? "") : "";
    const node: StageNode = {
      key: stageNodeKey(remote, cluster, used),
      name,
      role: remote.role ?? "",
      cluster,
      clusterEntry,
      remote,
      wallUs: remoteWallUs(remote),
      firstBatchUs: remote.first_batch_us > 0 ? remote.first_batch_us - remote.start_us : 0,
      straggler: false,
      variantId: null,
      planSource: remote.plan ? "profile" : plan ? "text" : "none",
    };
    stage.nodes.push(node);
    if (!plan) continue;
    const fp = planFingerprint(plan);
    const group = groups.get(fp) ?? { nodes: [], parts: [] };
    group.nodes.push(node);
    group.parts.push({ nodeKey: node.key, plan, remote: plan.remote ?? [] });
    groups.set(fp, group);
  }
  Object.assign(stage, markStragglers(stage.nodes));
  [...groups.values()].forEach((group, k) => {
    const variantId = `${stage.id}v${k}`;
    for (const n of group.nodes) n.variantId = variantId;
    stage.variants.push({
      id: variantId,
      stageId: stage.id,
      nodeKeys: group.nodes.map((n) => n.key),
      role: variantRole(group.nodes),
      nodeNames: group.nodes.map((n) => n.name),
      rootOpId: addOperator(variantId, group.parts, remoteOpId, stage.id, variantId, ctx),
    });
  });
  return stage;
}

export function buildProfileModel(
  profile: QueryProfile,
  hits: PlanHit[] = [],
  options: BuildProfileOptions = {},
): ProfileModel {
  const ctx: BuildContext = {
    ops: {},
    order: [],
    stages: [],
    hits,
    usedHits: new Set(),
    multiCluster: collectClusters(profile.plan, new Set()).size > 1,
  };
  const leaderKey = profile.node_name || profile.node_address || "leader";
  const rootId = addOperator(
    "op",
    [{ nodeKey: leaderKey, plan: profile.plan, remote: profile.plan.remote ?? [] }],
    null,
    null,
    null,
    ctx,
  );
  const variantById: Record<string, StageVariant> = {};
  for (const s of ctx.stages) for (const v of s.variants) variantById[v.id] = v;
  return {
    profile,
    rootId,
    operators: ctx.ops,
    order: ctx.order,
    stages: ctx.stages,
    stageById: Object.fromEntries(ctx.stages.map((s) => [s.id, s])),
    variantById,
    totalComputeNs: ctx.order.reduce((a, id) => a + ctx.ops[id].totalComputeNs, 0),
    leaderKey,
    planOnly: !!options.planOnly,
  };
}

/** The numbers an operator card shows under the current stage-metrics scope. */
export function scopedValue(op: ProfileOperator, scope: StageScope): ScopedValue {
  if (!op.stageId || scope === "sum") {
    return { computeNs: op.totalComputeNs, rows: op.totalRows, on: true };
  }
  if (scope === "max") {
    return {
      computeNs: Math.max(0, ...op.samples.map((s) => s.computeNs)),
      rows: Math.max(0, ...op.samples.map((s) => s.rows)),
      on: true,
    };
  }
  const sample = op.samples.find((s) => s.nodeKey === scopeNodeKey(scope));
  return sample
    ? { computeNs: sample.computeNs, rows: sample.rows, on: true }
    : { computeNs: 0, rows: 0, on: false };
}

export function shareOfTotal(model: ProfileModel, op: ProfileOperator): number {
  return model.totalComputeNs > 0 ? op.totalComputeNs / model.totalComputeNs : 0;
}

/** Badge tone for an operator's share of total CPU: <1% calm, <5% low, <15% notable, else hot. */
export function shareTone(share: number): "none" | "low" | "mid" | "high" {
  const pct = share * 100;
  if (pct < 1) return "none";
  if (pct < 5) return "low";
  if (pct < 15) return "mid";
  return "high";
}

function mergeMetrics(samples: OperatorSample[]): ProfileMetric[] {
  const byName = new Map<string, ProfileMetric>();
  for (const s of samples) {
    for (const m of s.metrics) {
      const cur = byName.get(m.name);
      if (!cur) {
        byName.set(m.name, { ...m });
        continue;
      }
      cur.value = m.kind === "gauge" ? Math.max(cur.value, m.value) : cur.value + m.value;
      if (m.total !== undefined) cur.total = (cur.total ?? 0) + m.total;
      cur.max = Math.max(cur.max, m.max);
    }
  }
  return [...byName.values()];
}

/** Metrics behind the detail sections: summed across nodes, the slowest node's, or one node's. */
export function metricsForScope(op: ProfileOperator, scope: StageScope): ProfileMetric[] {
  if (!op.stageId || scope === "sum") return mergeMetrics(op.samples);
  if (scope === "max") {
    const slowest = [...op.samples].sort((a, b) => b.computeNs - a.computeNs)[0];
    return slowest?.metrics ?? [];
  }
  return op.samples.find((s) => s.nodeKey === scopeNodeKey(scope))?.metrics ?? [];
}

export function metricSections(metrics: ProfileMetric[]): MetricSections {
  const sections: MetricSections = { timing: [], pruning: [], ratios: [], counters: [] };
  for (const m of metrics) {
    if (m.kind === "time") sections.timing.push(m);
    else if (m.kind === "pruning") sections.pruning.push(m);
    else if (m.kind === "ratio") sections.ratios.push(m);
    else if (m.kind !== "timestamp") sections.counters.push(m);
  }
  sections.timing.sort((a, b) => b.value - a.value);
  return sections;
}

export function stageNodeFor(
  model: ProfileModel,
  op: ProfileOperator,
  nodeKey: string,
): StageNode | undefined {
  return op.stageId ? model.stageById[op.stageId]?.nodes.find((n) => n.key === nodeKey) : undefined;
}

export function operatorNodeRows(model: ProfileModel, op: ProfileOperator): NodeRow[] {
  const total = op.totalComputeNs;
  return op.samples.map((s) => {
    const node = stageNodeFor(model, op, s.nodeKey);
    return {
      nodeKey: s.nodeKey,
      name: node?.name ?? s.nodeKey,
      cluster: node?.cluster ?? "",
      computeNs: s.computeNs,
      rows: s.rows,
      share: total > 0 ? s.computeNs / total : 0,
      straggler: node?.straggler ?? false,
    };
  });
}

export function nodeLabel(node: Pick<StageNode, "name" | "cluster">): string {
  return node.cluster ? `${node.name} · ${node.cluster}` : node.name;
}

/** max / median of a set of values; 1 when there is nothing to compare. */
export function skew(values: number[]): number {
  const med = median(values);
  if (med <= 0) return values.some((v) => v > 0) ? Infinity : 1;
  return Math.max(...values) / med;
}

function uniqueNodes(model: ProfileModel): StageNode[] {
  const seen = new Map<string, StageNode>();
  for (const s of model.stages) for (const n of s.nodes) if (!seen.has(n.key)) seen.set(n.key, n);
  return [...seen.values()];
}

function countRoles(all: StageNode[]): ProfileSummary["nodeCounts"] {
  const nodes = all.filter((n) => !n.clusterEntry);
  const counts = { queriers: 0, ingesters: 0, other: 0, total: nodes.length };
  for (const n of nodes) {
    const querier = n.role.includes("querier");
    const ingester = n.role.includes("ingester");
    if (querier) counts.queriers++;
    if (ingester) counts.ingesters++;
    if (!querier && !ingester) counts.other++;
  }
  return counts;
}

function peakMemory(model: ProfileModel): ProfileSummary["peakMemory"] {
  let best: ProfileSummary["peakMemory"] = null;
  for (const s of model.stages) {
    for (const n of s.nodes) {
      const bytes = Math.max(
        n.remote.peak_memory || 0,
        n.remote.scan_stats?.peak_memory_usage || 0,
      );
      if (bytes > 0 && (!best || bytes > best.bytes)) best = { bytes, node: nodeLabel(n) };
    }
  }
  return best;
}

function scannedTotals(
  model: ProfileModel,
  stream: Partial<SearchStreamResult>,
): ProfileSummary["scanned"] {
  const totals = { files: 0, bytes: 0, rows: 0 };
  let any = false;
  for (const s of model.stages) {
    for (const n of s.nodes) {
      const st = n.remote.scan_stats;
      if (!st) continue;
      any = true;
      totals.files += st.files || 0;
      totals.bytes += st.original_size || 0;
      totals.rows += st.records || 0;
    }
  }
  if (any) return totals;
  if (!stream.scan_size && !stream.scan_records) return null;
  return {
    files: stream.scan_files ?? 0,
    bytes: (stream.scan_size ?? 0) * 1024 * 1024,
    rows: stream.scan_records ?? 0,
  };
}

function executionMs(profile: QueryProfile): number {
  return profile.end_us > profile.start_us ? (profile.end_us - profile.start_us) / 1000 : 0;
}

/** Wall-clock phases from `took_detail`; null when the server sent none. */
export function queryPhases(
  took: TookDetail | undefined,
  profile: QueryProfile,
): QueryPhase[] | null {
  if (!took || !(took.total > 0)) return null;
  const exec = executionMs(profile) || took.search_took || 0;
  const phases: QueryPhase[] = [
    { id: "queue", ms: took.wait_in_queue || 0 },
    { id: "fileList", ms: took.file_list_took || 0 },
    { id: "index", ms: took.idx_took || 0 },
    { id: "execution", ms: exec },
  ];
  const known = phases.reduce((a, p) => a + p.ms, 0);
  phases.push({ id: "other", ms: Math.max(0, took.total - known) });
  return phases.filter((p) => p.ms > 0);
}

function categoryTotals(model: ProfileModel): ProfileSummary["byCategory"] {
  const totals = new Map<OperatorCategory, number>();
  for (const id of model.order) {
    const op = model.operators[id];
    totals.set(op.category, (totals.get(op.category) ?? 0) + op.totalComputeNs);
  }
  return [...totals.entries()]
    .filter(([, ns]) => ns > 0)
    .map(([category, ns]) => ({ category, ns }))
    .sort((a, b) => b.ns - a.ns);
}

function hotspotIds(model: ProfileModel, limit = 5): string[] {
  return model.order
    .map((id) => model.operators[id])
    .filter((op) => op.category !== "remote" && op.totalComputeNs > 0)
    .sort((a, b) => b.totalComputeNs - a.totalComputeNs)
    .slice(0, limit)
    .map((op) => op.id);
}

function timeline(model: ProfileModel): ProfileSummary["timeline"] {
  const t0 = model.profile.start_us;
  const rows = new Map<string, TimelineRow>();
  let spanEnd = model.profile.end_us;
  for (const s of model.stages) {
    for (const n of s.nodes) {
      if (n.wallUs <= 0) continue;
      const row = rows.get(n.key) ?? {
        nodeKey: n.key,
        name: nodeLabel(n),
        role: n.role,
        segments: [],
        durationUs: 0,
      };
      row.segments.push({
        stageIndex: s.index,
        startUs: Math.max(0, n.remote.start_us - t0),
        endUs: Math.max(0, n.remote.end_us - t0),
        straggler: n.straggler,
      });
      spanEnd = Math.max(spanEnd, n.remote.end_us);
      rows.set(n.key, row);
    }
  }
  for (const row of rows.values()) {
    const start = Math.min(...row.segments.map((g) => g.startUs));
    row.durationUs = Math.max(...row.segments.map((g) => g.endUs)) - start;
  }
  return { rows: [...rows.values()], spanUs: Math.max(0, spanEnd - t0) };
}

function stragglers(model: ProfileModel): StragglerInfo[] {
  return model.stages.flatMap((s) =>
    s.nodes
      .filter((n) => n.straggler)
      .map((n) => ({
        nodeKey: n.key,
        name: nodeLabel(n),
        stageIndex: s.index,
        wallUs: n.wallUs,
        ratio: s.medianWallUs > 0 ? n.wallUs / s.medianWallUs : 0,
      })),
  );
}

export function summarizeProfile(
  model: ProfileModel,
  stream: Partial<SearchStreamResult> = {},
): ProfileSummary {
  const nodes = uniqueNodes(model);
  return {
    wallMs: stream.took_detail?.total || executionMs(model.profile),
    totalComputeNs: model.totalComputeNs,
    resultRows: model.profile.output_rows,
    peakMemory: peakMemory(model),
    nodeCounts: countRoles(nodes),
    leaderName: model.profile.node_name || model.profile.node_address,
    scanned: scannedTotals(model, stream),
    phases: queryPhases(stream.took_detail, model.profile),
    byCategory: categoryTotals(model),
    hotspots: hotspotIds(model),
    timeline: timeline(model),
    stragglers: stragglers(model),
  };
}

/** What a plain EXPLAIN plan tells before it runs: streams, operator split, limit and scan pushdown. */
export function summarizePlan(model: ProfileModel): PlanSummary {
  const ops = model.order.map((id) => model.operators[id]);
  const scans = ops.filter((op) => op.category === "scan").map(planScanInfo);
  const leader = ops.filter((op) => !op.stageId);
  return {
    streams: [...new Set(scans.map((s) => s.stream).filter(Boolean))],
    leaderOps: leader.length,
    remoteOps: ops.length - leader.length,
    fetch: planFetch(model.operators[model.rootId].detail),
    scans,
    leaderCategories: [
      ...new Set(leader.filter((op) => op.category !== "remote").map((op) => op.category)),
    ],
  };
}

export function clusterNodes(
  model: ProfileModel,
): { key: string; name: string; cluster: string; role: string }[] {
  return uniqueNodes(model).map((n) => ({
    key: n.key,
    name: n.name,
    cluster: n.cluster,
    role: n.role,
  }));
}

type FoldSpec = Omit<LayoutFold, "x" | "y">;

type VisNode =
  | { kind: "op"; opId: string; folded: string[]; blocks: VisNode[] }
  | { kind: "stage"; stageId: string; variants: { variantId: string; node: VisNode }[] }
  | { kind: "fold"; fold: FoldSpec; folded: string[] };

interface FoldContext {
  model: ProfileModel;
  fold: FoldState;
  hot: Set<string>;
  related: Set<string> | null;
}

interface Link {
  x: number;
  y: number;
  stageTop: number | null;
  child: VisNode;
}

interface PlaceContext {
  model: ProfileModel;
  fold: FoldState;
  memo: WeakMap<VisNode, Box>;
  out: ProfileLayout;
}

const NO_FOLD: FoldState = {
  plumbing: false,
  shown: new Set(),
  collapsed: new Set(),
  grouped: new Set(),
  stages: new Set(),
  focusId: null,
};

const PLUMBING_RE = /^(Repartition|CoalescePartitions|CoalesceBatches|Projection|Cooperative)Exec/;
const PLUMBING_SHARE = 0.01;

export function subtreeIds(model: ProfileModel, opId: string): string[] {
  const out: string[] = [];
  const walk = (id: string) => {
    out.push(id);
    model.operators[id].childIds.forEach(walk);
  };
  walk(opId);
  return out;
}

export function ancestorIds(model: ProfileModel, opId: string): string[] {
  const out: string[] = [];
  for (let id = model.operators[opId]?.parentId; id; id = model.operators[id].parentId)
    out.push(id);
  return out;
}

/** A single-child exchange or projection too cheap to deserve its own card. */
export function isPlumbing(model: ProfileModel, op: ProfileOperator, hot: Set<string>): boolean {
  return (
    PLUMBING_RE.test(op.name) &&
    op.childIds.length === 1 &&
    !op.remoteStageId &&
    !hot.has(op.id) &&
    (model.planOnly || shareOfTotal(model, op) < PLUMBING_SHARE)
  );
}

export function hotspotSet(model: ProfileModel): Set<string> {
  return new Set(hotspotIds(model));
}

function foldsAway(ctx: FoldContext, op: ProfileOperator): boolean {
  return ctx.fold.plumbing && !ctx.fold.shown.has(op.id) && isPlumbing(ctx.model, op, ctx.hot);
}

function hiddenWhole(ctx: FoldContext, opId: string): boolean {
  return ctx.fold.grouped.has(opId) || (!!ctx.related && !ctx.related.has(opId));
}

function chainNode(ctx: FoldContext, opId: string): VisNode {
  const folded: string[] = [];
  let id = opId;
  while (foldsAway(ctx, ctx.model.operators[id])) {
    folded.push(id);
    id = ctx.model.operators[id].childIds[0];
  }
  const node = buildNode(ctx, id);
  return node.kind === "op" ? { ...node, folded } : node;
}

function groupFold(ctx: FoldContext, ownerId: string, opIds: string[]): VisNode {
  const focus = !!ctx.related && opIds.some((id) => !ctx.related!.has(id));
  const fold: FoldSpec = { key: `group-${opIds[0]}`, kind: "group", opIds, ownerId, focus };
  return { kind: "fold", fold, folded: [] };
}

function childNodes(ctx: FoldContext, op: ProfileOperator): VisNode[] {
  const hidden = op.childIds.filter((id) => hiddenWhole(ctx, id));
  const nodes: VisNode[] = [];
  for (const id of op.childIds) {
    if (!hidden.includes(id)) nodes.push(chainNode(ctx, id));
    else if (id === hidden[0]) nodes.push(groupFold(ctx, op.id, hidden));
  }
  return nodes;
}

function stageNode(ctx: FoldContext, op: ProfileOperator, stage: ProfileStage): VisNode {
  if (ctx.fold.stages.has(stage.id)) {
    const opIds = stage.variants.map((v) => v.rootOpId);
    const fold: FoldSpec = {
      key: `stage-${stage.id}`,
      kind: "stage",
      opIds,
      ownerId: op.id,
      focus: false,
    };
    return { kind: "fold", fold, folded: [] };
  }
  const variants = stage.variants.map((v) => ({
    variantId: v.id,
    node: hiddenWhole(ctx, v.rootOpId)
      ? groupFold(ctx, op.id, [v.rootOpId])
      : chainNode(ctx, v.rootOpId),
  }));
  return { kind: "stage", stageId: stage.id, variants };
}

function buildNode(ctx: FoldContext, opId: string): VisNode {
  const op = ctx.model.operators[opId];
  const node: VisNode = { kind: "op", opId, folded: [], blocks: [] };
  if (op.remoteStageId) {
    const stage = ctx.model.stageById[op.remoteStageId];
    if (stage?.variants.length) node.blocks = [stageNode(ctx, op, stage)];
  } else if (ctx.fold.collapsed.has(opId) && op.childIds.length) {
    const fold: FoldSpec = {
      key: `branch-${opId}`,
      kind: "branch",
      opIds: op.childIds,
      ownerId: opId,
      focus: false,
    };
    node.blocks = [{ kind: "fold", fold, folded: [] }];
  } else {
    node.blocks = childNodes(ctx, op);
  }
  return node;
}

function measure(memo: WeakMap<VisNode, Box>, node: VisNode): Box {
  const cached = memo.get(node);
  if (cached) return cached;
  let box: Box;
  if (node.kind === "fold") {
    box = { w: CARD_W, h: FOLD_H };
  } else if (node.kind === "stage") {
    const variants = node.variants.map((v) => measure(memo, v.node));
    box = {
      w:
        variants.reduce((a, b) => a + b.w, 0) +
        VARIANT_GAP * Math.max(0, variants.length - 1) +
        2 * STAGE_PAD_X,
      h: STAGE_PAD_TOP + Math.max(0, ...variants.map((b) => b.h)) + STAGE_PAD_BOTTOM,
    };
  } else {
    const blocks = node.blocks.map((b) => measure(memo, b));
    const childrenW =
      blocks.reduce((a, b) => a + b.w, 0) + SIBLING_GAP * Math.max(0, blocks.length - 1);
    box = {
      w: Math.max(CARD_W, childrenW),
      h: CARD_H + (blocks.length ? LEVEL_GAP + Math.max(...blocks.map((b) => b.h)) : 0),
    };
  }
  memo.set(node, box);
  return box;
}

function placeChild(p: PlaceContext, node: VisNode, left: number, top: number): number {
  if (node.kind === "op") return placeOp(p, node, left, top);
  if (node.kind === "fold") {
    p.out.folds.push({ ...node.fold, x: left, y: top });
    return left + CARD_W / 2;
  }
  return left + measure(p.memo, node).w / 2;
}

function placeStage(
  p: PlaceContext,
  node: Extract<VisNode, { kind: "stage" }>,
  left: number,
  top: number,
): Link[] {
  const box = measure(p.memo, node);
  p.out.stages.push({ stageId: node.stageId, x: left, y: top, w: box.w, h: box.h });
  const links: Link[] = [];
  let cursor = left + STAGE_PAD_X;
  for (const v of node.variants) {
    const vBox = measure(p.memo, v.node);
    p.out.variantLabels.push({
      variantId: v.variantId,
      x: cursor,
      y: top + STAGE_PAD_TOP - 20,
      w: vBox.w,
    });
    const x = placeChild(p, v.node, cursor, top + STAGE_PAD_TOP);
    links.push({ x, y: top + STAGE_PAD_TOP, stageTop: top, child: v.node });
    cursor += vBox.w + VARIANT_GAP;
  }
  return links;
}

function placeOp(
  p: PlaceContext,
  node: Extract<VisNode, { kind: "op" }>,
  left: number,
  top: number,
): number {
  const box = measure(p.memo, node);
  const widths = node.blocks.map((b) => measure(p.memo, b).w);
  const childrenW =
    widths.reduce((a, w) => a + w, 0) + SIBLING_GAP * Math.max(0, node.blocks.length - 1);
  let cursor = left + (box.w - childrenW) / 2;
  const childTop = top + CARD_H + LEVEL_GAP;
  const centers: number[] = [];
  const links: Link[] = [];
  node.blocks.forEach((block, i) => {
    if (block.kind === "stage") {
      links.push(...placeStage(p, block, cursor, childTop));
      centers.push(cursor + widths[i] / 2);
    } else {
      const x = placeChild(p, block, cursor, childTop);
      links.push({ x, y: childTop, stageTop: null, child: block });
      centers.push(x);
    }
    cursor += widths[i] + SIBLING_GAP;
  });
  const center = centers.length ? (centers[0] + centers[centers.length - 1]) / 2 : left + box.w / 2;
  const op = p.model.operators[node.opId];
  const canCollapse = op.childIds.length > 0 && !op.remoteStageId;
  p.out.cards.push({
    opId: node.opId,
    x: center - CARD_W / 2,
    y: top,
    branch: canCollapse ? (p.fold.collapsed.has(op.id) ? "collapsed" : "open") : null,
    refold: p.fold.plumbing && p.fold.shown.has(op.id),
  });
  for (const link of links) p.out.edges.push(edgeFor(link, center, top + CARD_H, node.opId));
  return center;
}

function edgeFor(link: Link, x2: number, y2: number, parentId: string): LayoutEdge {
  const { x: x1, y: y1, stageTop, child } = link;
  const fromId = child.kind === "op" ? child.opId : null;
  const folded = child.kind === "stage" ? [] : child.folded;
  const childId = folded[0] ?? fromId;
  const key = childId ?? (child.kind === "fold" ? child.fold.key : parentId);
  if (stageTop === null) {
    const my = (y1 + y2) / 2;
    return {
      key,
      childId,
      fromId,
      parentId,
      folded,
      path: `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`,
      // on the child's own column, where sibling edges cannot crowd it the way they do near the parent
      labelX: x1,
      labelY: y1 - EDGE_LABEL_RISE,
    };
  }
  const my = (stageTop + y2) / 2;
  return {
    key,
    childId,
    fromId,
    parentId,
    folded,
    path: `M${x1},${y1} L${x1},${stageTop} C${x1},${my} ${x2},${my} ${x2},${y2}`,
    labelX: x1,
    labelY: stageTop + 28,
  };
}

function relatedTo(model: ProfileModel, focusId: string | null): Set<string> | null {
  if (!focusId || !model.operators[focusId]) return null;
  return new Set([...subtreeIds(model, focusId), ...ancestorIds(model, focusId)]);
}

/** Tidy top-down layout: each subtree owns a disjoint x-range, stages box their variants side by side. */
export function layoutProfile(model: ProfileModel, fold: FoldState = NO_FOLD): ProfileLayout {
  const ctx: FoldContext = {
    model,
    fold,
    hot: hotspotSet(model),
    related: relatedTo(model, fold.focusId),
  };
  // the root has no edge above it to carry folded operators, so it is never folded away
  const root = buildNode(ctx, model.rootId);
  const memo = new WeakMap<VisNode, Box>();
  const box = measure(memo, root);
  const out: ProfileLayout = {
    width: box.w,
    height: box.h,
    cards: [],
    edges: [],
    stages: [],
    variantLabels: [],
    folds: [],
  };
  placeChild({ model, fold, memo, out }, root, 0, 0);
  return out;
}

export function formatNs(ns: number): string {
  return formatTime((Number(ns) || 0) / 1e6);
}

export function formatRows(rows: number): string {
  return formatLargeNumber(Math.round(Number(rows) || 0));
}

export function formatBytes(bytes: number): string {
  return bytes > 0 ? formatSizeFromMB(bytes / (1024 * 1024)) : "0 B";
}

/** Wall-clock `m:ss` for a running query's elapsed time. */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function formatPercent(share: number): string {
  const pct = share * 100;
  if (pct <= 0) return "0%";
  if (pct < 0.1) return "<0.1%";
  if (pct < 10) return `${pct.toFixed(1)}%`;
  return `${pct.toFixed(0)}%`;
}

export function formatMetricValue(metric: Pick<ProfileMetric, "kind">, value: number): string {
  if (metric.kind === "time") return formatNs(value);
  if (metric.kind === "bytes") return formatBytes(value);
  return Math.round(value).toLocaleString("en-US");
}

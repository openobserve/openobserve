// Copyright 2026 OpenObserve Inc.

import { getUUID } from "@/utils/uuid";

const STREAM_PLACEHOLDER = "__O2_STREAM__";

const NODE_Y_OFFSET = 120;

const NEW_PIPELINE_DESCRIPTION =
  "Adds OCSF fields (OpenObserve SIEM). Managed from Security → Sources.";

export interface PipelineNode {
  id: string;
  data: Record<string, unknown>;
  meta?: Record<string, unknown>;
  position: { x: number; y: number };
  io_type: string;
}

export interface PipelineEdge {
  id: string;
  source: string;
  target: string;
}

export interface Pipeline {
  pipeline_id?: string;
  name: string;
  description: string;
  source: Record<string, unknown>;
  nodes: PipelineNode[];
  edges: PipelineEdge[];
  version?: number;
  enabled?: boolean;
  org?: string;
  [key: string]: unknown;
}

export interface SecuritySetting {
  source_type: string;
  pack_id: string;
  pack_version: number;
  attached_at: number;
  pipeline_id: string;
  pipeline_created: boolean;
  included?: boolean | null;
}

export interface StreamForChecks {
  name: string;
  stream_type?: string;
  settings?: {
    flatten_level?: number | null;
    defined_schema_fields?: string[] | null;
  };
}

export interface AttachConfig {
  globalFlattenLevel: number;
  guaranteedColumns: string[];
}

export type ConsistencyState =
  | "mapped"
  | "pack_removed_outside"
  | "attached_without_record"
  | "pipeline_not_writing_back"
  | "pipeline_disabled";

export interface PreAttachBlock {
  code:
    | "stream_not_written"
    | "flatten_level_mismatch"
    | "global_flatten_level"
    | "schema_missing_columns"
    | "pipeline_disabled";
  streams?: string[];
  columns?: string[];
}

const edgeId = (source: string, target: string) => `e${source}-${target}`;

const edge = (source: string, target: string): PipelineEdge => ({
  id: edgeId(source, target),
  source,
  target,
});

// Lowercased for one stable name per stream; two streams differing only in case would collide here.
export const entityFunctionName = (version: number, stream: string): string =>
  `ocsf_entity_v${version}_${stream}`.toLowerCase();

export const fullFunctionName = (packId: string, version: number): string =>
  `ocsf_${packId}_v${version}`.toLowerCase();

/** The entity pack carries a per-stream product name; a full pack has no placeholder and is unchanged. */
export const entityProgram = (vrl: string, stream: string): string =>
  vrl.split(STREAM_PLACEHOLDER).join(stream);

export function ourNode(
  packId: string,
  version: number,
  funcName: string,
  pos: { x: number; y: number },
): PipelineNode {
  return {
    id: getUUID(),
    data: { node_type: "function", name: funcName, after_flatten: false, num_args: 0 },
    meta: { o2_ocsf_pack: `${packId}@${version}` },
    position: { x: pos.x, y: pos.y + NODE_Y_OFFSET },
    io_type: "default",
  };
}

/** Our node is identified only by its meta key; name and position are user-editable. */
export function findOurNode(pipeline: Pipeline): PipelineNode | null {
  for (const node of pipeline.nodes) {
    const meta = node.meta;
    if (meta && typeof meta === "object" && typeof meta.o2_ocsf_pack === "string") return node;
  }
  return null;
}

export function newPipeline(org: string, stream: string, node: PipelineNode): Pipeline {
  const source: PipelineNode = {
    id: getUUID(),
    data: {
      node_type: "stream",
      stream_name: stream,
      stream_type: "logs",
      org_id: org,
      source_type: "realtime",
    },
    position: { x: node.position.x, y: node.position.y - NODE_Y_OFFSET },
    io_type: "input",
  };
  const destination: PipelineNode = {
    id: getUUID(),
    data: { node_type: "stream", stream_name: stream, stream_type: "logs", org_id: org },
    position: { x: node.position.x, y: node.position.y + NODE_Y_OFFSET },
    io_type: "output",
  };
  return {
    name: `ocsf-${stream}`,
    description: NEW_PIPELINE_DESCRIPTION,
    org,
    source: { source_type: "realtime", org_id: org, stream_name: stream, stream_type: "logs" },
    nodes: [source, node, destination],
    edges: [edge(source.id, node.id), edge(node.id, destination.id)],
  };
}

export function insertNode(pipeline: Pipeline, node: PipelineNode): Pipeline {
  const sourceId = pipeline.nodes[0].id;
  const nodes = [...pipeline.nodes, node];
  const edges: PipelineEdge[] = [];
  let linkedSource = false;
  const rewiredTargets = new Set<string>();
  // Order is preserved because validation carries after_flatten between siblings (SDD §5.4 step 4).
  for (const e of pipeline.edges) {
    if (e.source !== sourceId) {
      edges.push(e);
      continue;
    }
    if (!linkedSource) {
      edges.push(edge(sourceId, node.id));
      linkedSource = true;
    }
    if (!rewiredTargets.has(e.target)) {
      edges.push(edge(node.id, e.target));
      rewiredTargets.add(e.target);
    }
  }
  return { ...pipeline, nodes, edges };
}

export function removeNode(pipeline: Pipeline): Pipeline {
  const our = findOurNode(pipeline);
  if (!our) return { ...pipeline, nodes: [...pipeline.nodes], edges: [...pipeline.edges] };
  const inbound = pipeline.edges.filter((e) => e.target === our.id).map((e) => e.source);
  const outbound = pipeline.edges.filter((e) => e.source === our.id).map((e) => e.target);
  const nodes = pipeline.nodes.filter((n) => n.id !== our.id);
  const edges = pipeline.edges.filter((e) => e.source !== our.id && e.target !== our.id);
  const seen = new Set(edges.map((e) => `${e.source}->${e.target}`));
  for (const source of inbound) {
    for (const target of outbound) {
      const key = `${source}->${target}`;
      if (source === target || seen.has(key)) continue;
      edges.push(edge(source, target));
      seen.add(key);
    }
  }
  return { ...pipeline, nodes, edges };
}

function writesToSourceStream(pipeline: Pipeline): boolean {
  const source = pipeline.nodes[0];
  const streamName = source?.data?.stream_name;
  const streamType = source?.data?.stream_type ?? "logs";
  return pipeline.nodes.some(
    (n) =>
      n.id !== source?.id &&
      n.data?.node_type === "stream" &&
      n.data?.stream_name === streamName &&
      (n.data?.stream_type ?? "logs") === streamType,
  );
}

/** Target stream names our pipeline routes to that are not the source stream. */
function foreignTargets(pipeline: Pipeline): string[] {
  const source = pipeline.nodes[0];
  const streamName = source?.data?.stream_name;
  const out: string[] = [];
  for (const n of pipeline.nodes) {
    if (n.id === source?.id || n.data?.node_type !== "stream") continue;
    const name = n.data?.stream_name;
    if (typeof name === "string" && name !== streamName && !out.includes(name)) out.push(name);
  }
  return out;
}

export function consistencyState(
  setting: SecuritySetting | null,
  pipeline: Pipeline | null,
): ConsistencyState {
  const hasPack = !!(setting && setting.pack_id);
  const node = pipeline ? findOurNode(pipeline) : null;
  if (pipeline && pipeline.enabled === false) return "pipeline_disabled";
  if (hasPack && !node) return "pack_removed_outside";
  if (!hasPack && node) return "attached_without_record";
  if (pipeline && !writesToSourceStream(pipeline)) return "pipeline_not_writing_back";
  return "mapped";
}

export function preAttachChecks(
  stream: StreamForChecks,
  pipeline: Pipeline | null,
  cfg: AttachConfig,
): PreAttachBlock[] {
  const blocks: PreAttachBlock[] = [];
  if (pipeline && pipeline.enabled === false) blocks.push({ code: "pipeline_disabled" });
  if (pipeline && pipeline.enabled !== false && !writesToSourceStream(pipeline)) {
    blocks.push({ code: "stream_not_written", streams: foreignTargets(pipeline) });
  }
  const flattenLevel = stream.settings?.flatten_level ?? 0;
  if (flattenLevel > 0 && flattenLevel !== cfg.globalFlattenLevel) {
    blocks.push({ code: "flatten_level_mismatch" });
  }
  if (cfg.globalFlattenLevel === 1 || cfg.globalFlattenLevel === 2) {
    blocks.push({ code: "global_flatten_level" });
  }
  const defined = stream.settings?.defined_schema_fields;
  if (defined && defined.length) {
    const missing = cfg.guaranteedColumns.filter((c) => !defined.includes(c));
    if (missing.length) blocks.push({ code: "schema_missing_columns", columns: missing });
  }
  return blocks;
}

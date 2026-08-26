// Copyright 2026 OpenObserve Inc.
//
// pipelineTerraform.ts — renders a pipeline as an `openobserve_pipeline`
// resource for the OpenObserve Terraform provider
// (https://registry.terraform.io/providers/openobserve/openobserve/latest).
//
// A pipeline is a graph, and that is the one thing this mapping has to get
// right. On the wire it is `nodes` and `edges` arrays; in the provider it is
// repeated `node` and `edge` blocks. The reshaping is mostly mechanical, with
// three places where the two vocabularies genuinely differ:
//
//   • The node's kind is `data.node_type` on the wire and `type` in the schema,
//     and everything else about a node lives one level down under `data` while
//     the schema flattens it onto the block.
//   • A function node names its transform in `data.name`; the schema calls that
//     `function_name`, because `name` on a node block would read as the node's
//     own name rather than the function it applies.
//   • A condition node's `conditions` is free-form JSON, so it goes through
//     `jsonencode()` — the same idiom the alert exporter uses for its filters.
//
// The trigger is the other asymmetry. A pipeline is either `realtime`, driven by
// records arriving in a stream, or `scheduled`, driven by a query on a cadence.
// The provider supports only `realtime` today, so a scheduled pipeline is
// reported as unsupported rather than rendered into a resource that would be
// rejected at plan time.

import type {
  ImportTarget,
  Node,
  TerraformExport,
  TerraformIdentityOptions,
  TerraformUnsupportedItem,
  TerraformUnsupportedReason,
} from "@/utils/terraform/hcl";
import {
  INDENT,
  attr,
  block,
  bool,
  document,
  importTarget,
  isFilled,
  literal,
  num,
  quote,
  resourceBlock,
  resourceLabel,
  str,
} from "@/utils/terraform/hcl";

export type PipelineTerraformOptions = TerraformIdentityOptions;

/** Node kinds the provider models. Anything else has no block to render into. */
const NODE_TYPES = new Set(["stream", "function", "condition", "remote_stream"]);

interface WireNode {
  id?: unknown;
  io_type?: unknown;
  position?: { x?: unknown; y?: unknown };
  data?: Record<string, unknown>;
}

/**
 * One `node` block.
 *
 * Attributes are emitted only where they mean something for that node kind. The
 * wire carries leftovers — a function node that still has an `org_id` from the
 * editor, say — and writing those would produce a configuration the provider
 * reads back differently from how it was written, which shows up forever as
 * drift on a resource nobody has touched.
 */
function nodeBlock(node: WireNode): Node[] {
  const data = (node.data ?? {}) as Record<string, unknown>;
  const type = String(data.node_type ?? "");
  if (!NODE_TYPES.has(type)) return [];

  const position = (node.position ?? {}) as Record<string, unknown>;
  const isStream = type === "stream";
  const isFunction = type === "function";
  const isRemote = type === "remote_stream";
  const isCondition = type === "condition";

  return block("node", [
    ...attr("id", str(node.id)),
    ...attr("type", quote(type)),
    ...attr("io_type", str(node.io_type)),
    // Cosmetic in the visual editor, but round-tripping them keeps a re-imported
    // pipeline looking the way its author laid it out.
    ...attr("position_x", num(position.x)),
    ...attr("position_y", num(position.y)),
    // A remote_stream node names the stream on the far side, so both it and a
    // plain stream node carry the stream pair.
    ...attr("stream_name", isStream || isRemote ? str(data.stream_name) : null),
    ...attr("stream_type", isStream || isRemote ? str(data.stream_type) : null),
    ...attr("function_name", isFunction ? str(data.name) : null),
    ...attr("after_flatten", isFunction ? bool(data.after_flatten) : null),
    ...attr("destination_name", isRemote ? str(data.destination_name) : null),
    ...attr(
      "conditions",
      isCondition && isFilled(data.conditions)
        ? `jsonencode(${literal(data.conditions, `${INDENT}${INDENT}`)})`
        : null,
    ),
  ]);
}

/** One `edge` block. The wire calls the ends source/target; the schema from/to. */
function edgeBlock(edge: Record<string, unknown>): Node[] {
  return block("edge", [...attr("from", str(edge.source)), ...attr("to", str(edge.target))]);
}

function pipelineResource(pipeline: Record<string, unknown>, label: string): string {
  const source = (pipeline.source ?? {}) as Record<string, unknown>;
  const nodes = Array.isArray(pipeline.nodes) ? (pipeline.nodes as WireNode[]) : [];
  const edges = Array.isArray(pipeline.edges) ? (pipeline.edges as Record<string, unknown>[]) : [];

  const body: Node[] = [
    ...attr("name", quote(String(pipeline.name ?? ""))),
    ...attr("description", str(pipeline.description)),
    // Written unconditionally, like every other exporter here: a paused pipeline
    // and a running one must not read the same.
    ...attr("enabled", String(pipeline.enabled !== false)),
    // `realtime` is the provider's default, but the pipeline's trigger is the
    // first thing a reader looks for, so it is written rather than implied.
    ...attr("source_type", quote(String(source.source_type ?? "realtime"))),
    ...attr("stream_name", str(source.stream_name)),
    ...attr("stream_type", str(source.stream_type)),
    ...nodes.flatMap(nodeBlock),
    ...edges.flatMap(edgeBlock),
  ];

  return resourceBlock("openobserve_pipeline", label, body);
}

/**
 * A pipeline the provider could not accept.
 *
 * A scheduled pipeline has a whole query and trigger surface the provider does
 * not model yet. The graph rules are the provider's own: at least two nodes, and
 * edges to join them.
 */
function unsupportedReason(pipeline: Record<string, unknown>): TerraformUnsupportedReason | null {
  const source = (pipeline.source ?? {}) as Record<string, unknown>;
  const sourceType = String(source.source_type ?? "realtime");
  if (sourceType !== "realtime") return "scheduled";
  if (!pipeline.name) return "incomplete";

  const nodes = Array.isArray(pipeline.nodes) ? pipeline.nodes : [];
  const renderable = nodes.filter((node) => nodeBlock(node as WireNode).length > 0);
  if (renderable.length < 2) return "incomplete";
  if (!Array.isArray(pipeline.edges) || !pipeline.edges.length) return "incomplete";
  return null;
}

/** The pipeline's server-assigned id, wherever the payload carries it. */
export function pipelineIdOf(pipeline: Record<string, unknown>): string {
  for (const key of ["pipeline_id", "pipelineId", "id"]) {
    const value = pipeline[key];
    if (typeof value === "string" && value !== "") return value;
  }
  return "";
}

/**
 * Converts pipeline payloads into `openobserve_pipeline` resources.
 *
 * Pipelines with no provider equivalent are reported in `unsupported` rather
 * than rendered as something that would not apply.
 */
export function pipelinesToTerraform(
  pipelines: Record<string, unknown>[],
  options: PipelineTerraformOptions = {},
): TerraformExport {
  const used = new Set<string>();
  const unsupported: TerraformUnsupportedItem[] = [];
  const resources: string[] = [];
  const imports: ImportTarget[] = [];

  pipelines.forEach((pipeline, index) => {
    if (!pipeline || typeof pipeline !== "object") return;
    const reason = unsupportedReason(pipeline);
    if (reason) {
      unsupported.push({ name: String(pipeline.name ?? ""), reason });
      return;
    }
    const label = resourceLabel(pipeline.name, used, "pipeline");
    resources.push(pipelineResource(pipeline, label));
    const id = options.ids?.[index] ?? pipelineIdOf(pipeline);
    imports.push(...importTarget("openobserve_pipeline", label, options.orgId, id));
  });

  return {
    hcl: document(resources, imports, options.orgId ?? ""),
    unsupported,
    droppedFields: [],
  };
}

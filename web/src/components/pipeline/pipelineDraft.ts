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

import { makeEdge } from "@/composables/flow/makeEdge";

export interface PipelineDraftNode {
  id: string;
  type?: string;
  io_type?: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
  meta?: unknown;
  is_disabled?: boolean;
}

export interface PipelineDraftEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

/** The pipeline fields a draft carries, also the shape hashed as the server base. */
export interface PipelineDraftContent {
  name: string;
  description: string;
  source: Record<string, unknown>;
  nodes: PipelineDraftNode[];
  edges: PipelineDraftEdge[];
}

/** The node drawer that was open; a node being added (not yet on the canvas) is carried whole. */
export interface PipelineDraftDrawer {
  type: string;
  nodeId: string | null;
  isEditNode: boolean;
  stagedNode: PipelineDraftNode | null;
  pendingSource: string | null;
}

export interface PipelineDraftData extends PipelineDraftContent {
  drawer: PipelineDraftDrawer | null;
}

interface NodeLike {
  id?: unknown;
  type?: unknown;
  io_type?: unknown;
  position?: { x?: unknown; y?: unknown } | null;
  data?: unknown;
  meta?: unknown;
  is_disabled?: unknown;
}

interface EdgeLike {
  id?: unknown;
  source?: unknown;
  target?: unknown;
  sourceHandle?: unknown;
  targetHandle?: unknown;
}

interface PipelineLike {
  name?: unknown;
  description?: unknown;
  source?: unknown;
  nodes?: NodeLike[];
  edges?: EdgeLike[];
}

const plainCopy = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? null)) as T;

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? plainCopy(value as Record<string, unknown>) : {};

// Vue Flow decorates live nodes/edges with runtime fields (dimensions, sourceNode refs), so only the saved fields are kept.
export const projectPipelineNode = (node: NodeLike): PipelineDraftNode => ({
  id: String(node.id ?? ""),
  ...(typeof node.type === "string" ? { type: node.type } : {}),
  ...(typeof node.io_type === "string" ? { io_type: node.io_type } : {}),
  position: { x: Number(node.position?.x ?? 0), y: Number(node.position?.y ?? 0) },
  data: asRecord(node.data),
  ...(node.meta === undefined ? {} : { meta: plainCopy(node.meta) }),
  ...(typeof node.is_disabled === "boolean" ? { is_disabled: node.is_disabled } : {}),
});

export const projectPipelineEdge = (edge: EdgeLike): PipelineDraftEdge => ({
  id: String(edge.id ?? ""),
  source: String(edge.source ?? ""),
  target: String(edge.target ?? ""),
  ...(typeof edge.sourceHandle === "string" ? { sourceHandle: edge.sourceHandle } : {}),
  ...(typeof edge.targetHandle === "string" ? { targetHandle: edge.targetHandle } : {}),
});

/** Run counters and state (version, enabled, paused_at) are left out, so only an edit reads as changed on server. */
export const projectPipeline = (pipeline: PipelineLike): PipelineDraftContent => ({
  name: String(pipeline.name ?? ""),
  description: String(pipeline.description ?? ""),
  source: asRecord(pipeline.source),
  nodes: (pipeline.nodes ?? []).map(projectPipelineNode),
  edges: (pipeline.edges ?? []).map(projectPipelineEdge),
});

export const restorePipelineEdge = (edge: PipelineDraftEdge) => ({
  ...makeEdge(edge.source, edge.target, edge.sourceHandle),
  id: edge.id,
  ...(edge.targetHandle ? { targetHandle: edge.targetHandle } : {}),
});

export const restorePipelineNode = (node: PipelineDraftNode): PipelineDraftNode => plainCopy(node);
